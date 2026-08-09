"""
Supabase Storage för bildbaserat källmaterial.

Bucket: session-source-images (private — inga policies, endast service role).
Auktorisering sker i applikationskoden, inte via RLS: appen använder Clerk,
inte Supabase Auth, så det finns ingen auth.uid() att skriva policies mot.
Samma modell som redan gäller för user_quotas, sessions och cards.

Sökvägar
    <user_id>/<session_id>/page_001.png     permanent, skapas i /api/generate
    <user_id>/<session_id>/meta.json
    _staging/<token>/page_001.png           tillfälligt, skapas i /api/upload
    _staging/<token>/meta.json

token = "<YYYYMMDDTHHMMSSZ>__<uuid4-hex>". Tidsstämpeln ligger i namnet med
avsikt: storage3.list() returnerar mapp-poster utan tillförlitlig created_at,
så sweepen skulle annars behöva ett extra anrop per mapp för att se åldern.
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logger = logging.getLogger(__name__)

BUCKET = "session-source-images"
STAGING_PREFIX = "_staging"
STAGING_MAX_AGE_HOURS = 24

# storage3 2.31.0 defaultar list() till limit=100. Vi sätter alltid ett eget
# tak — ett dokument kan ha 30 sidor och _staging kan ha många mappar.
LIST_LIMIT = 1000

# storage3 2.31.0 defaultar content-type till text/plain;charset=UTF-8.
# Utan explicit värde lagras PNG-filer med fel MIME-typ.
EXTENSION_BY_MEDIA_TYPE = {
    "image/png":  "png",
    "image/jpeg": "jpg",
}
MEDIA_TYPE_BY_EXTENSION = {v: k for k, v in EXTENSION_BY_MEDIA_TYPE.items()}

# Token från klienten når en sökväg — validera strikt mot path traversal.
STAGING_TOKEN_RE = re.compile(r"^\d{8}T\d{6}Z__[0-9a-f]{32}$")

_client: Client = create_client(
    os.environ.get("SUPABASE_URL", ""),
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _bucket():
    return _client.storage.from_(BUCKET)


def _new_staging_token() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}__{uuid.uuid4().hex}"


def _staging_token_age(token: str) -> timedelta | None:
    try:
        created = datetime.strptime(token.split("__", 1)[0], "%Y%m%dT%H%M%SZ")
    except (ValueError, IndexError):
        return None
    return datetime.now(timezone.utc) - created.replace(tzinfo=timezone.utc)


def is_valid_staging_token(token: str) -> bool:
    return bool(token) and bool(STAGING_TOKEN_RE.match(token))


def _page_name(index: int, media_type: str) -> str:
    ext = EXTENSION_BY_MEDIA_TYPE.get(media_type, "png")
    return f"page_{index:03d}.{ext}"


def _media_type_for(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    return MEDIA_TYPE_BY_EXTENSION.get(ext, "image/png")


def _upload(path: str, data: bytes, content_type: str) -> None:
    _bucket().upload(
        path=path,
        file=data,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def _list(prefix: str) -> list[dict]:
    try:
        return _bucket().list(prefix, {"limit": LIST_LIMIT}) or []
    except Exception:
        logger.exception(f"Storage list failed for prefix {prefix}")
        return []


def _remove_folder(prefix: str) -> None:
    """
    storage3.remove() tar exakta objektsökvägar — det finns ingen
    prefix-radering. Listar därför innehållet först.
    """
    names = [e["name"] for e in _list(prefix) if e.get("name")]
    if not names:
        return
    try:
        _bucket().remove([f"{prefix}/{n}" for n in names])
    except Exception:
        logger.exception(f"Storage remove failed for prefix {prefix}")


# ── Staging: uppladdning innan en session finns ──────────────────────────────

def put_staging_pages(
    user_id: str,
    filename: str,
    pages: list[tuple[str, bytes]],
) -> str:
    """Lagrar sidbilder tillfälligt. Returnerar den opaka token klienten skickar tillbaka."""
    token = _new_staging_token()
    folder = f"{STAGING_PREFIX}/{token}"

    for i, (media_type, data) in enumerate(pages, start=1):
        _upload(f"{folder}/{_page_name(i, media_type)}", data, media_type)

    meta = {
        "user_id":    user_id,
        "filename":   filename,
        "page_count": len(pages),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _upload(f"{folder}/meta.json", json.dumps(meta).encode("utf-8"), "application/json")
    return token


def read_staging_meta(token: str) -> dict | None:
    if not is_valid_staging_token(token):
        return None
    try:
        raw = _bucket().download(f"{STAGING_PREFIX}/{token}/meta.json")
    except Exception:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def load_staging_pages(token: str) -> list[tuple[str, bytes]]:
    if not is_valid_staging_token(token):
        return []
    return _load_pages(f"{STAGING_PREFIX}/{token}")


def promote_staging_to_session(token: str, user_id: str, session_id: str) -> int:
    """
    Flyttar sidbilderna från staging till den permanenta sessions-sökvägen.
    move() är server-side, så inga bytes passerar backend. Returnerar antal sidor.
    """
    if not is_valid_staging_token(token):
        return 0

    src = f"{STAGING_PREFIX}/{token}"
    dst = f"{user_id}/{session_id}"
    moved = 0

    for entry in _list(src):
        name = entry.get("name")
        if not name:
            continue
        try:
            _bucket().move(f"{src}/{name}", f"{dst}/{name}")
            if name != "meta.json":
                moved += 1
        except Exception:
            logger.exception(f"Storage move failed: {src}/{name}")

    _remove_folder(src)  # tar eventuella rester om något move misslyckades
    return moved


# ── Permanent: sessionens bilder ─────────────────────────────────────────────

def load_session_pages(user_id: str, session_id: str) -> list[tuple[str, bytes]]:
    """
    Hämtar sidbilderna för en session. Anroparen MÅSTE ha verifierat att
    sessionen tillhör user_id innan detta anropas — sökvägen byggs av det
    verifierade id:t, aldrig av klientinput.
    """
    return _load_pages(f"{user_id}/{session_id}")


def delete_session_images(user_id: str, session_id: str) -> None:
    """
    Raderar en sessions bilder. Ingen anropare idag — det finns ingen
    radera-session-endpoint. Ligger här så kopplingen blir en rad den dagen
    en sådan byggs.
    """
    _remove_folder(f"{user_id}/{session_id}")


# ── Städning ─────────────────────────────────────────────────────────────────

def sweep_stale_staging(max_age_hours: int = STAGING_MAX_AGE_HOURS) -> int:
    """
    Raderar staging-mappar äldre än max_age_hours. Uppladdningar som aldrig
    ledde till en generering blir annars kvar för alltid. Anropas lat vid
    varje ny bilduppladdning — ingen scheduler behövs.
    """
    removed = 0
    cutoff = timedelta(hours=max_age_hours)

    for entry in _list(STAGING_PREFIX):
        token = entry.get("name")
        if not token or not is_valid_staging_token(token):
            continue
        age = _staging_token_age(token)
        if age is not None and age > cutoff:
            _remove_folder(f"{STAGING_PREFIX}/{token}")
            removed += 1

    if removed:
        logger.info(f"[STORAGE] swept {removed} stale staging folder(s)")
    return removed


# ── Delad ────────────────────────────────────────────────────────────────────

def _load_pages(folder: str) -> list[tuple[str, bytes]]:
    """Läser sidbilderna i en mapp i sidordning. meta.json hoppas över."""
    names = sorted(
        e["name"] for e in _list(folder)
        if e.get("name") and e["name"].startswith("page_")
    )

    pages: list[tuple[str, bytes]] = []
    for name in names:
        try:
            data = _bucket().download(f"{folder}/{name}")
        except Exception:
            logger.exception(f"Storage download failed: {folder}/{name}")
            continue
        pages.append((_media_type_for(name), data))
    return pages
