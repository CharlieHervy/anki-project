"""
Supabase Storage för användartillagda kortbilder.

Bucket: card-images (private — inga policies, endast service role).
Egen modul, inte en andra bucket i storage.py: sidbilderna där har en helt
annan livscykel (staging → session, sveps automatiskt) medan kortbilder är
permanenta och raderas explicit av användaren. Att blanda dem skulle göra
storage.py:s dokumenterade sökvägskontrakt osant.

Auktoriseringsmodellen är densamma som för session-source-images: appen
använder Clerk, inte Supabase Auth, så det finns ingen auth.uid() att skriva
RLS-policies mot. Ägarkontrollen ligger i main.py och MÅSTE ha körts innan
någon funktion här anropas.

Sökväg
    <user_id>/<session_id>/<card_id>/<uuid4-hex>.<ext>

Varje segment är ett id som backend redan verifierat. Filnamnet kommer från
uuid4, aldrig från den uppladdade filens namn — inget klientinput når sökvägen.
"""

import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logger = logging.getLogger(__name__)

BUCKET = "card-images"

# Format Anki renderar i alla versioner som är i bruk. WebP stöds från
# Anki 2.1.50; kollar man inte in det här får man en bild som visas i
# granskningsvyn men är en trasig ruta i Anki.
EXTENSION_BY_MEDIA_TYPE = {
    "image/png":  "png",
    "image/jpeg": "jpg",
    "image/gif":  "gif",
    "image/webp": "webp",
}
MEDIA_TYPE_BY_EXTENSION = {
    "png":  "image/png",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "gif":  "image/gif",
    "webp": "image/webp",
}

# Per bild, inte per kort. En urklippsskärmdump ligger på 0,1–1 MB, ett
# mobilfoto på 2–5 MB. Taket finns för att en enstaka rå kamerabild inte ska
# blåsa upp .apkg-filen — inte som kvotlogik.
MAX_IMAGE_BYTES = 10 * 1024 * 1024

# Exporten laddar ner varje bild en gång. Sekventiellt blir 60 bilder en
# halvminut död tid i requesten; åtta parallella hämtningar räcker för att
# nedladdningen aldrig är det som dominerar exporten.
DOWNLOAD_WORKERS = 8

_client: Client = create_client(
    os.environ.get("SUPABASE_URL", ""),
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _bucket():
    return _client.storage.from_(BUCKET)


def extension_for_media_type(media_type: str) -> str | None:
    """None = formatet stöds inte. Anroparen avgör om det ska bli 400 eller fallback."""
    return EXTENSION_BY_MEDIA_TYPE.get((media_type or "").lower().split(";")[0].strip())


def media_type_for_filename(filename: str) -> str | None:
    """Reservväg när webbläsaren skickar tom content-type (förekommer vid drag & drop)."""
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    return MEDIA_TYPE_BY_EXTENSION.get(ext)


def extension_of(storage_path: str) -> str:
    """Filändelsen i en lagrad sökväg. Används för att namnge filen i .apkg-paketet."""
    return storage_path.rsplit(".", 1)[-1].lower() if "." in storage_path else "png"


def put_card_image(
    user_id: str,
    session_id: str,
    card_id: str,
    media_type: str,
    data: bytes,
) -> str:
    """
    Lagrar en bild och returnerar dess storage_path. Anroparen MÅSTE ha
    verifierat att card_id tillhör en session som ägs av user_id.
    """
    ext = extension_for_media_type(media_type) or "png"
    path = f"{user_id}/{session_id}/{card_id}/{uuid.uuid4().hex}.{ext}"

    # storage3 2.31.0 defaultar content-type till text/plain;charset=UTF-8.
    # Utan explicit värde serveras bilden med fel MIME-typ via den signerade
    # URL:en och visas inte i <img>.
    _bucket().upload(
        path=path,
        file=data,
        file_options={"content-type": media_type, "upsert": "true"},
    )
    return path


def delete_card_image(storage_path: str) -> None:
    """
    Bästa-möjliga radering. Anropas efter att DB-raden är borta: en kvarlämnad
    fil utan rad är osynlig och ofarlig, en rad utan fil ger en trasig
    miniatyr och en export som saknar bilden.
    """
    try:
        _bucket().remove([storage_path])
    except Exception:
        logger.exception(f"Card image delete failed: {storage_path}")


def delete_card_images(storage_paths: list[str]) -> None:
    if not storage_paths:
        return
    try:
        _bucket().remove(storage_paths)
    except Exception:
        logger.exception(f"Card image batch delete failed ({len(storage_paths)} paths)")


def sign_urls(storage_paths: list[str], expires_in: int) -> dict[str, str]:
    """
    Ett enda anrop för hela sessionens bilder — create_signed_urls tar en lista,
    så granskningsvyn kostar en round-trip oavsett antal kort.

    Returnerar {storage_path: url}. Sökvägar som inte kunde signeras utelämnas;
    frontend renderar då en platshållare i stället för en trasig bild.
    """
    if not storage_paths:
        return {}

    try:
        results = _bucket().create_signed_urls(storage_paths, expires_in)
    except Exception:
        logger.exception(f"Signing {len(storage_paths)} card image URL(s) failed")
        return {}

    urls: dict[str, str] = {}
    for requested, item in zip(storage_paths, results):
        if item.get("error"):
            logger.warning(f"Signed URL error for {requested}: {item['error']}")
            continue
        url = item.get("signedURL") or item.get("signedUrl")
        if not url:
            continue
        # API:t ekar tillbaka path, men ordningen är kontraktet — matcha på
        # den och låt path vara en kontroll, inte nyckeln.
        urls[item.get("path") or requested] = url
        urls.setdefault(requested, url)
    return urls


def download_to_dir(targets: dict[str, str], dest_dir: str) -> set[str]:
    """
    Hämtar bilderna i {storage_path: filnamn} parallellt och skriver var och en
    direkt till dest_dir. Returnerar de storage_paths som lyckades.

    Skriver till disk i stället för att returnera bytes: exporten kan röra
    dussintals bilder, och att hålla allihop i minnet samtidigt skulle skala
    med hela sessionens bildvikt i stället för med en bild per arbetartråd.
    genanki läser ändå filerna från disk vid paketeringen.

    Sökvägar som inte gick att läsa saknas i svaret — exporten hoppar över dem
    hellre än att fallera helt.
    """
    if not targets:
        return set()

    def _one(item: tuple[str, str]) -> str | None:
        storage_path, filename = item
        try:
            data = _bucket().download(storage_path)
        except Exception:
            logger.exception(f"Card image download failed: {storage_path}")
            return None
        try:
            with open(os.path.join(dest_dir, filename), "wb") as f:
                f.write(data)
        except OSError:
            logger.exception(f"Writing card image to disk failed: {filename}")
            return None
        return storage_path

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        results = pool.map(_one, targets.items())

    return {path for path in results if path is not None}
