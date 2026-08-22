import os
import uuid
import json
import asyncio
import logging
import shutil
import tempfile
import stripe

logging.basicConfig(level=logging.INFO)
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request, Query
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, Response
from sqlalchemy.orm import Session
from generator import generate_cards_stream, parse_tsv, review_cards, build_image_blocks
from exporter import export_to_apkg
from database import get_db, SessionModel, CardModel, CardImageModel, DemoCard
import storage
import card_image_storage

app = FastAPI()

# ── Supabase (service role — bypasses RLS) ──────────────────────────────────
supabase: Client = create_client(
    os.environ.get("SUPABASE_URL", ""),
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
)

# ── Stripe ───────────────────────────────────────────────────────────────────
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# ── CORS ─────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://anki-project-three.vercel.app",
    "https://www.dimindo.com",
    "https://dimindo.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.options("/{rest_of_path:path}")
async def preflight_handler(request: Request, rest_of_path: str):
    origin = request.headers.get("origin", "")
    response = Response()
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, x-user-id, Accept, Origin"
    return response


# ── Hjälpfunktioner för kvotsystemet ─────────────────────────────────────────

def count_words(text: str) -> int:
    return len(text.split())

def validate_input_length(word_count: int, plan: str, qr_remaining: int = 0) -> tuple[bool, str]:
    """
    Validerar inputlängd mot plan och Quick Refill-status.

    - free utan QR-krediter:  max 2 000 ord
    - free med QR-krediter:   max 3 000 ord (QR-poolens tak)
    - pro:                    max 9 000 ord
    - admin:                  obegränsat
    - okänd plan:             strängaste taket (2 000 ord) som säkerhetsnät
    """
    if plan == 'admin':
        return True, ""

    if plan == 'free':
        if qr_remaining > 0:
            if word_count > 3000:
                return False, (
                    f"With Quick Refill credits, the Free plan supports up to 3,000 words. "
                    f"Your text has {word_count} words."
                )
        else:
            if word_count > 2000:
                return False, (
                    f"The Free plan supports up to 2,000 words. "
                    f"Your text has {word_count} words."
                )
        return True, ""

    if plan == 'pro':
        if word_count > 9000:
            return False, (
                f"The Pro plan supports up to 9,000 words. "
                f"Your text has {word_count} words."
            )
        return True, ""

    # Okänd plan — fall tillbaka till strängaste taket
    if word_count > 2000:
        return False, (
            f"This plan supports up to 2,000 words. "
            f"Your text has {word_count} words."
        )
    return True, ""

def sse_error(message: str, **kwargs) -> StreamingResponse:
    """Returnerar ett SSE-felmeddelande som StreamingResponse."""
    payload = {"type": "error", "message": message, **kwargs}
    return StreamingResponse(
        iter([f"data: {json.dumps(payload)}\n\n"]),
        media_type="text/event-stream"
    )


# ── /api/generate ─────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate(
    source_material: str = Form(default=""),
    upload_id: str = Form(default=""),
    language: str = Form(default="English"),
    timezone: str = Form(default="UTC"),
    x_user_id: str = Header(...),          # Kräver autentisering — ingen anonym fallback
    db: Session = Depends(get_db)
):
    # ── Upplösningspunkten. Efter denna vet resten av flödet bara .text/.images ──
    # Gaten körs om här och inte bara i /api/upload: upload_id är en referens
    # till serverlagrad data, så den måste auktoriseras vid varje användning.
    #
    # Både gaten och upplösningen måste bli SSE-fel, inte HTTP-fel: klienten
    # läser svaret som en event-stream, så ett rått 403 skulle tolkas som en
    # tom ström och misslyckas tyst.
    try:
        if upload_id:
            require_multimodal_access(x_user_id)
        src = await asyncio.to_thread(
            resolve_source,
            source_material, upload_id, "", x_user_id
        )
    except HTTPException as e:
        return sse_error(str(e.detail))

    if not src.text.strip():
        return sse_error("No source material provided.")

    source_material = src.text
    word_count = count_words(source_material)

    # 1. Hämta användarens plan + pooler för inputvalidering
    try:
        quota_response = supabase.rpc(
            'get_quota_status',
            {'p_user_id': x_user_id, 'p_timezone': timezone}
        ).execute()
        plan = quota_response.data.get('plan', 'free')
        # ── ÄNDRING 2: extrahera quick_refill_remaining explicit ─────────────
        qr_remaining = quota_response.data.get('quick_refill_remaining', 0)
        monthly_remaining = quota_response.data.get('monthly_remaining', 0)
    except Exception as e:
        return sse_error(f"Quota check failed: {str(e)}")

    # 2. Validera inputlängd mot plan + QR-status
    valid, error_msg = validate_input_length(word_count, plan, qr_remaining)
    if not valid:
        return sse_error(error_msg)

    # ── ÄNDRING 3: pool-tvång + blockering av ogiltigt Pro-fall ──────────────
    # Free med >2 000 ord och QR-krediter → tvinga QR-poolen (auto-select 2).
    force_quick_refill = (
        plan == 'free' and
        word_count > 2000 and
        qr_remaining > 0
    )

    # Pro med tom månadspool + QR-krediter men text > 3 000 ord → blockera.
    # QR-poolen tillåter aldrig mer än 3 000 ord (oavsett plan).
    if plan == 'pro' and monthly_remaining == 0 and qr_remaining > 0 and word_count > 3000:
        # Sidoeffekt 6 åtgärdad: formatera datumet i Python — råa ISO-strängen
        # (2026-07-27T00:00:00+00:00) får aldrig nå användaren.
        next_reset_raw = quota_response.data.get('monthly_reset_at')
        try:
            reset_date = datetime.fromisoformat(next_reset_raw).strftime("%B %d")
        except (TypeError, ValueError):
            reset_date = "your next billing date"
        return sse_error(
            f"Your monthly generation pool is empty. Quick Refill supports texts up to 3,000 words. "
            f"Shorten your text or wait for your pool to reset on {reset_date}."
        )

    # 3. Förbruka kvot via atomisk RPC (INNAN generering startar)
    #    OBS: Om Claude-anropet senare misslyckas förlorar användaren
    #    en generering. Rollback är inte implementerat i MVP.
    try:
        consume_response = supabase.rpc(
            'consume_generation',
            {
                'p_user_id':            x_user_id,
                'p_word_count':         word_count,
                'p_timezone':           timezone,
                # ── ÄNDRING 4: skicka force_quick_refill till RPC ────────────
                'p_force_quick_refill': force_quick_refill
            }
        ).execute()
    except Exception as e:
        return sse_error(f"Quota consumption failed: {str(e)}")

    # ── Felhantering efter consume_generation ────────────────────────────────
    if not consume_response.data.get('success'):
        data = consume_response.data
        reason = data.get('reason', 'quota_exceeded')

        # QR-poolens 3 000-ordstak nått via Pro med DELVIS tömd månadspool
        # (det fall main.py-blocket ovan inte ser, eftersom monthly_remaining > 0).
        # Eget läsbart meddelande som degraderar snyggt även innan frontend
        # fått en handler för reason. Frontend bör dispatcha på `reason`,
        # inte på `message`.
        if reason == 'qr_word_limit_exceeded':
            return sse_error(
                "Quick Refill supports texts up to 3,000 words. "
                "Shorten your text to use a Quick Refill credit, "
                "or wait for your monthly pool to reset.",
                reason=reason,
                monthly_remaining=data.get('monthly_remaining', 0),
                quick_refill_remaining=data.get('quick_refill_remaining', 0)
            )

        return sse_error(
            'quota_exceeded',
            reason=reason,
            lifetime_remaining=data.get('lifetime_remaining', 0),
            monthly_remaining=data.get('monthly_remaining', 0),
            quick_refill_remaining=data.get('quick_refill_remaining', 0)
        )

    # 4. Skapa DB-session (efter kvotcheck — undviker tomma sessioner vid kvotfel)
    db_session = SessionModel(user_id=x_user_id, source_material=source_material)
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    session_id = str(db_session.id)

    # 4b. Bildläge: flytta sidorna från staging till den permanenta
    #     sessions-sökvägen. Måste ske efter att session_id finns, och innan
    #     genereringen startar — /api/explain läser dem därifrån senare.
    if src.is_images:
        try:
            moved = await asyncio.to_thread(
                storage.promote_staging_to_session, upload_id, x_user_id, session_id
            )
            logging.info(f"[UPLOAD] promoted {moved} page(s) to session {session_id}")
        except Exception:
            # Genereringen kan fortsätta på de redan inlästa bilderna i minnet;
            # det som går förlorat är chattens källförankring i granskningsvyn.
            logging.exception("Promoting staged pages to session storage failed")

    import queue
    import threading

    chunk_queue = queue.Queue()
    DONE_SENTINEL = object()
    ERROR_SENTINEL = object()

    def run_generator():
        try:
            for chunk in generate_cards_stream(source_material, language, src.images):
                chunk_queue.put(chunk)
            chunk_queue.put(DONE_SENTINEL)
        except Exception as e:
            chunk_queue.put((ERROR_SENTINEL, str(e)))

    async def event_stream():
        full_tsv = ""
        stream_buffer = ""
        title_saved = False

        yield f"data: {json.dumps({'type': 'session_id', 'session_id': session_id})}\n\n"

        thread = threading.Thread(target=run_generator, daemon=True)
        thread.start()

        try:
            silence_seconds = 0
            MAX_SILENCE = 600

            while True:
                try:
                    item = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: chunk_queue.get(timeout=15)
                    )
                    silence_seconds = 0
                except queue.Empty:
                    silence_seconds += 15
                    if not thread.is_alive() or silence_seconds >= MAX_SILENCE:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Timeout – ingen respons från Claude.'})}\n\n"
                        return
                    yield ": keepalive\n\n"
                    continue

                if item is DONE_SENTINEL:
                    break
                elif isinstance(item, tuple) and item[0] is ERROR_SENTINEL:
                    yield f"data: {json.dumps({'type': 'error', 'message': item[1]})}\n\n"
                    return
                else:
                    full_tsv += item
                    stream_buffer += item

                    while '\n' in stream_buffer:
                        line, stream_buffer = stream_buffer.split('\n', 1)
                        stripped_line = line.strip()
                        if not title_saved and stripped_line.startswith('TITLE:'):
                            title_saved = True
                            extracted_title = stripped_line[len('TITLE:'):].strip()
                            db_title = next(get_db())
                            try:
                                db_title.query(SessionModel).filter(
                                    SessionModel.id == db_session.id
                                ).update({'title': extracted_title})
                                db_title.commit()
                            except Exception:
                                db_title.rollback()
                            finally:
                                db_title.close()
                            continue  # TITLE-raden når aldrig parse_tsv
                        for card in parse_tsv(line):
                            yield f"data: {json.dumps({'type': 'card', 'data': {'text': card['text'], 'extra': card['extra'], 'logg': card['logg']}})}\n\n"

            # Hantera sista raden om Claude avslutar utan \n
            if stream_buffer.strip():
                for card in parse_tsv(stream_buffer):
                    yield f"data: {json.dumps({'type': 'card', 'data': {'text': card['text'], 'extra': card['extra'], 'logg': card['logg']}})}\n\n"

            if not full_tsv.strip():
                yield f"data: {json.dumps({'type': 'error', 'message': 'Claude returnerade ingen output.'})}\n\n"
                return

            cards = parse_tsv(full_tsv)

            if not cards:
                no_cards_payload = json.dumps({'type': 'error', 'message': "We couldn't find anything to turn into cards. Try a text with clearer facts or statements."})
                yield f"data: {no_cards_payload}\n\n"
                return

            yield f"data: {json.dumps({'type': 'reviewing'})}\n\n"

            indices_to_remove = await asyncio.to_thread(
                review_cards, source_material, cards, src.images
            )
            if indices_to_remove:
                remove_set = set(indices_to_remove)
                cards = [card for i, card in enumerate(cards) if (i + 1) not in remove_set]

            db2 = next(get_db())
            try:
                for i, card in enumerate(cards):
                    db_card = CardModel(
                        session_id=db_session.id,
                        user_id=x_user_id,
                        position=i,
                        text=card.get('text', ''),
                        extra=card.get('extra', ''),
                        tags=card.get('tags', ''),
                        deck=card.get('deck', ''),
                        logg=card.get('logg', ''),
                        card_type=card.get('card_type', 'cloze'),
                        approved=True
                    )
                    db2.add(db_card)
                db2.commit()
            except Exception as db_error:
                db2.rollback()
                yield f"data: {json.dumps({'type': 'error', 'message': f'Databasfel: {str(db_error)}'})}\n\n"
                return
            finally:
                db2.close()

            yield f"data: {json.dumps({'type': 'done', 'card_count': len(cards)})}\n\n"

        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


# ── /api/quota ────────────────────────────────────────────────────────────────

@app.get("/api/quota")
async def get_quota(
    x_user_id: str = Header(...),
    timezone: str = Query(default="UTC")
):
    """Returnerar kvotstatistik för inloggad användare."""
    try:
        result = supabase.rpc(
            'get_quota_status',
            {'p_user_id': x_user_id, 'p_timezone': timezone}
        ).execute()
        return result.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quota fetch failed: {str(e)}")


# ── /api/stripe/webhook ───────────────────────────────────────────────────────

@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    """
    Hanterar Stripe-events.
    checkout.session.completed → Quick Refill eller Pro-aktivering
    customer.subscription.deleted → Nedgradering till free
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    # Verifiera signatur — returnerar 400 vid manipulerat payload
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook error: {str(e)}")

    def safe_metadata(obj) -> dict:
        """
        Extraherar metadata från ett Stripe-objekt utan antaganden om
        StripeObject-implementationen. getattr undviker AttributeError
        oavsett SDK-version. .items() är tillförlitligare än dict() eller
        nyckeliteration för att materialisera ett StripeObject till en dict.
        """
        if not obj:
            return {}
        raw = getattr(obj, "metadata", None)
        if not raw:
            return {}
        try:
            return dict(raw.items())
        except Exception:
            # Sista fallback: direkt attributåtkomst per känd nyckel
            result = {}
            for k in ("user_id", "product_type"):
                v = getattr(raw, k, None)
                if v is not None:
                    result[k] = v
            return result

    if event.type == 'checkout.session.completed':
        session = event.data.object
        metadata = safe_metadata(session)
        user_id = metadata.get('user_id')
        product_type = metadata.get('product_type')

        if not user_id or not product_type:
            # Saknad metadata — returnera 200 så Stripe inte retryar
            return {"status": "ignored", "reason": "missing metadata"}

        if product_type == 'quick_refill':
            supabase.rpc('add_quick_refill', {'p_user_id': user_id}).execute()

        # ── Pro-aktivering med billing anniversary ───────────────────────────
        elif product_type == 'pro':
            from datetime import datetime, timezone
            subscription_id = session.subscription
            subscription = stripe.Subscription.retrieve(subscription_id)
            period_end = datetime.fromtimestamp(
                subscription.current_period_end, tz=timezone.utc
            ).isoformat()
            supabase.table('user_quotas').upsert({
                'user_id':                    user_id,
                'plan':                       'pro',
                'monthly_generations_used':   0,
                'monthly_generations_limit':  20,
                'monthly_reset_at':           period_end,
            }).execute()

    # ── Nedgradering till free ───────────────────────────────────────────────
    elif event.type == 'customer.subscription.deleted':
        metadata = safe_metadata(event.data.object)
        user_id = metadata.get('user_id')

        if user_id:
            supabase.table('user_quotas').update({
                'plan':                         'free',
                'lifetime_generations_used':    0,
                'monthly_generations_used':     0,
                'monthly_reset_at':             None,
            }).eq('user_id', user_id).execute()

    return {"status": "ok"}


# ── /api/stripe/create-checkout ──────────────────────────────────────────────

@app.post("/api/stripe/create-checkout")
async def create_checkout(
    product_type: str = Form(...),
    x_user_id: str = Header(...)
):
    """
    Skapar en Stripe Checkout-session och returnerar redirect-URL.
    MVP: inline price_data skapar en ny Stripe-produkt per session.
    Framtida förbättring: ersätt med fasta price_id från Stripe Dashboard.
    """
    if product_type not in ('pro', 'quick_refill'):
        raise HTTPException(status_code=400, detail="Invalid product type")

    # ── ÄNDRING 5: valuta SEK → USD ──────────────────────────────────────────
    if product_type == 'quick_refill':
        price_data = {
            "currency": "usd",
            "unit_amount": 599,  # $5.99 (cent)
            "product_data": {"name": "Dimindo Quick Refill — 5 generations"},
        }
        mode = "payment"
    else:
        price_data = {
            "currency": "usd",
            "unit_amount": 999,  # $9.99 (cent)
            "recurring": {"interval": "month"},
            "product_data": {"name": "Dimindo Pro"},
        }
        mode = "subscription"

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{"price_data": price_data, "quantity": 1}],
            mode=mode,
            success_url="https://dimindo.com?payment=success&product=" + product_type,
            cancel_url="https://dimindo.com",
            metadata={"user_id": x_user_id, "product_type": product_type},
        )
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")

    return {"url": session.url}


# ── /api/sessions ─────────────────────────────────────────────────────────────

@app.get("/api/sessions")
async def get_sessions(
    x_user_id: str = Header(...),
    db: Session = Depends(get_db)
):
    """Returnerar alla sessioner för inloggad användare, senaste först."""
    sessions = db.query(SessionModel)\
        .filter(SessionModel.user_id == x_user_id)\
        .order_by(SessionModel.created_at.desc())\
        .all()

    result = []
    for s in sessions:
        card_count = db.query(CardModel)\
            .filter(CardModel.session_id == s.id)\
            .count()
        result.append({
            "session_id": str(s.id),
            "title": s.title or "Untitled session",
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "card_count": card_count
        })
    return result


# ── /api/sessions/{session_id}/source ────────────────────────────────────────

@app.get("/api/sessions/{session_id}/source")
async def get_session_source(
    session_id: str,
    x_user_id: str = Header(...),
    db: Session = Depends(get_db)
):
    """Returnerar källmaterialet för en specifik session."""
    session = db.query(SessionModel).filter(
        SessionModel.id == session_id,
        SessionModel.user_id == x_user_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"source_material": session.source_material or ""}


class ExplainCardItem(BaseModel):
    text: str
    extra: str = ""

class ExplainMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str

class ExplainRequest(BaseModel):
    source_material: str
    cards: list[ExplainCardItem]
    messages: list[ExplainMessage]
    # Bildläge: nyckeln till serverlagrade sidbilder. Ägarkontrolleras innan
    # den används — annars kunde ett gissat id läsa någon annans sidor.
    session_id: str = ""


# ── /api/explain ──────────────────────────────────────────────────────────────

@app.post("/api/explain")
async def explain(
    body: ExplainRequest,
    x_user_id: str = Header(...),
    db: Session = Depends(get_db)
):
    """
    Session-scoped AI-chatt i granskningsvyn.
    Inget kvotavdrag. Ingen streaming. Svarar på studentens språk.

    I bildläge får chatten sidorna nedskalade till 1568 px och körs på
    Haiku 4.5. Generering och granskning kör kvar på full upplösning — de
    avgör kortens korrekthet. Chatten har hela kortlistan i kontexten och
    använder sidorna som referens, så den lägre upplösningen räcker.
    Textläget är oförändrat: Haiku 4.5, samma max_tokens, ingen cache_control.
    """
    from generator import client

    # ── Ägarkontroll innan någon serverlagrad data rörs ──────────────────────
    source_images = None
    if body.session_id:
        owned = db.query(SessionModel).filter(
            SessionModel.id == body.session_id,
            SessionModel.user_id == x_user_id
        ).first()
        if owned:
            src = await asyncio.to_thread(
                resolve_source, body.source_material, "", body.session_id, x_user_id
            )
            if src.images:
                source_images = await asyncio.to_thread(
                    downscale_pages, src.images, CHAT_IMAGE_MAX_EDGE
                )

    cards_text = "\n\n".join(
        f"Card {i + 1}:\nFront: {c.text}\nBack: {c.extra}"
        for i, c in enumerate(body.cards)
    )

    # I bildläge hålls kortlistan UTANFÖR systemprompten. Systemprompten
    # renderas före bilderna, och caching är en prefixmatchning: låg kortlistan
    # kvar här skulle varje redigering, godkännande eller decknamn-ändring
    # invalidera de cachade sidbilderna och tvinga fram en ny skrivning på
    # ~4 800 tokens per sida. Kortlistan flyttas i stället till user-meddelandet,
    # bakom cache-brytpunkten, där en ändring bara kostar sitt eget textblock.
    cards_section = "" if source_images else f"GENERATED FLASHCARDS:\n{cards_text}\n\n"

    system_prompt = (
      "You are a knowledgeable study assistant embedded in Dimindo, "
        "an AI-powered flashcard application.\n\n"
        "The student is currently reviewing flashcards on a specific topic. "
        "Use the source material and flashcards below as context to understand "
        "what the student is studying — but draw freely on your full knowledge "
        "to explain, connect, and expand on any concept they ask about.\n\n"
        f"SOURCE MATERIAL:\n{body.source_material}\n\n"
        f"{cards_section}"
        "Instructions:\n"
        "- Always respond in the same language the student writes in.\n"
        "- Be concise by default. Expand only when the student explicitly "
        "asks for a detailed explanation.\n"
        "- Make connections to related concepts, causes, and consequences "
        "even if they are not mentioned in the source material.\n"
        "- Reference specific card content when it aids understanding, "
        "but never limit your answer to what the cards say.\n\n"
        "When the student explains a concept or mechanism in their own words "
        "(rather than asking you to explain it to them), do not simply confirm "
        "that they are correct. Instead:\n"
        "- Briefly acknowledge what the student got right before addressing "
        "the weak point — one clause is enough, this isn't the place for a "
        "full recap. The goal is that the student leaves knowing both what "
        "held up and what to sharpen, not just the correction in isolation.\n"
        "- Identify the single weakest or least precise part of their explanation "
        "— the claim you are least confident is fully correct, a vague or "
        "hand-wavy step, a missing causal link, or a term used imprecisely. "
        "Name it specifically and explain why it's the weak point.\n"
        "- Where possible, surface the weak point as a targeted question "
        "rather than a direct correction — let the student close the gap "
        "themselves. Use a direct correction only when the point is a "
        "factual error, not a vague or imprecise step.\n"
        "- If the explanation contains an actual error, lead with that rather "
        "than a softer 'weak point' framing — don't understate a real mistake "
        "to be polite.\n"
        "- If every part of the explanation is genuinely solid, say so plainly "
        "and briefly — do not invent a weakness to seem rigorous. Manufactured "
        "criticism is worse than none; it teaches the student to distrust "
        "correct reasoning.\n"
        "- If the explanation is too brief or vague to meaningfully evaluate, "
        "ask a clarifying question instead of critiquing brevity itself as if "
        "it were an error.\n"
        "- Keep this to one weak point per response, not an exhaustive critique. "
        "The goal is to sharpen one thing at a time, not overwhelm them.\n"
        "- This does not apply when the student is asking you a direct question "
        "or requesting an explanation — only when they are the one explaining "
        "the concept to you."
    )

    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    if source_images and messages:
        # Historiken skickas hel vid varje anrop, så bilderna måste med varje
        # gång — annars tappar chatten källförankringen efter första svaret.
        #
        # Ordningen i första meddelandet är det som avgör kostnaden:
        #
        #   system (statisk)                    ─┐
        #   sidbilder … cache_control            ├─ cachat prefix, stabilt
        #                                       ─┘
        #   kortlistan                          ─┐ bakom brytpunkten:
        #   användarens fråga                   ─┘ ändras fritt, kostar sitt eget
        #
        # Kortlistan ändras varje gång ett kort godkänns, redigeras eller får
        # nytt decknamn. Låg den före brytpunkten skrevs sidbilderna om varje
        # gång — ~20x kostnaden per meddelande.
        image_blocks = build_image_blocks(source_images)
        image_blocks[-1]["cache_control"] = {"type": "ephemeral", "ttl": "1h"}

        tail = []
        if cards_text:
            tail.append({"type": "text", "text": f"GENERATED FLASHCARDS:\n{cards_text}"})
        tail.append({"type": "text", "text": messages[0]["content"]})

        messages[0] = {"role": "user", "content": image_blocks + tail}

        # Haiku 4.5, inte Sonnet 5: sidorna är nedskalade till 1568 px, vilket
        # är precis Haikus visionklass, och chatten har kortlistan i kontexten.
        # Haiku tänker inte alls — inga thinking-tokens att betala för — och
        # kostar $1/$5 per MTok mot Sonnet 5:s $3/$15.
        # Beta-namespacet: cache_control med ttl ligger i beta-typerna.
        def call():
            return client.beta.messages.create(
                model="claude-haiku-4-5",
                max_tokens=2048,
                system=system_prompt,
                messages=messages,
                betas=["prompt-caching-2024-07-31"],
            )
    else:
        # Textläget: oförändrat mot tidigare — samma namespace, modell och tak.
        def call():
            return client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=2048,
                system=system_prompt,
                messages=messages,
            )

    try:
        response = await asyncio.to_thread(call)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

    # Cache-träffar syns bara här. cache_read ≫ cache_creation från och med
    # andra meddelandet betyder att prefixet håller; ett cache_creation som
    # återkommer på varje tur betyder att något invaliderar det.
    usage = response.usage
    logging.info(
        f"[EXPLAIN] mode={'images' if source_images else 'text'} "
        f"pages={len(source_images) if source_images else 0} "
        f"turns={len(body.messages)} "
        f"input={usage.input_tokens} "
        f"output={usage.output_tokens} "
        f"cache_creation={getattr(usage, 'cache_creation_input_tokens', 0)} "
        f"cache_read={getattr(usage, 'cache_read_input_tokens', 0)}"
    )

    if not response.content:
        raise HTTPException(status_code=500, detail="Empty response from AI")

    # I bildläge är content[0] ett thinking-block, inte texten.
    answer = "".join(
        block.text for block in response.content
        if getattr(block, "type", "") == "text"
    )
    if not answer.strip():
        raise HTTPException(status_code=500, detail="Empty response from AI")

    return {"response": answer}


# ── /api/upload ───────────────────────────────────────────────────────────────

def get_user_id(x_user_id: str = Header(None)):
    if not x_user_id or x_user_id == "":
        return "anonymous_user"
    return x_user_id


# ── Multimodal extraktion (skannade PDF:er och foton av anteckningar) ────────
#
# Kärnlogiken nedan är plan-agnostisk: detektion, rendering och transkribering
# vet ingenting om planer. Hela behörighetsskillnaden ligger i
# require_multimodal_access(), som anropas på ett ställe per kodväg. Tas den
# raden bort blir funktionen publik utan att något annat behöver skrivas om.

# 200 DPI ger ~2340 px långsida för A4/Letter — under Claudes tak på 2576 px,
# och tillräckligt skarpt för brödtext i en skannad sida. Högre DPI skalas ner
# av API:t ändå och köper ingen fidelitet.
VISION_RENDER_DPI = 200

# Tumnaglar till frontend — enda sättet för användaren att se att rätt sidor lästes.
THUMBNAIL_DPI = 25
MAX_THUMBNAILS = 5

# Chatten får nedskalade sidkopior. Generering och granskning kör kvar på full
# upplösning: de avgör om korten blir korrekta. Chatten har hela kortlistan i
# kontexten och använder sidorna som referens, inte som transkriberingsmål —
# därför räcker den lägre visionklassens 1568 px, vilket i sin tur gör att
# chatten kan köra Haiku 4.5 i stället för Sonnet 5.
CHAT_IMAGE_MAX_EDGE = 1568

# Kostnadsräcke, inte kvotlogik: en skannad sida är ~1 bild ≈ tusentals
# input-tokens. Höj medvetet, inte av misstag.
MAX_VISION_PAGES = 30

# Textlagerdetektion — gäller ENBART icke-admin. Admin routas alltid till
# vision-vägen, eftersom ett existerande textlager inte säger något om att
# läsordningen går att lita på.
# En sida med färre tecken än så här efter trim räknas som "utan textlager".
SCANNED_MIN_CHARS_PER_PAGE = 10
# Andel sådana sidor som gör att hela dokumentet klassas som skannat.
SCANNED_PAGE_RATIO = 0.5

IMAGE_MEDIA_TYPES = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
}

MULTIMODAL_GATED_MESSAGE = (
    "Scanned documents aren't supported yet — this feature is in testing"
)


def lookup_plan(user_id: str) -> str:
    """
    Läser plan-fältet ur user_quotas.

    Medvetet INTE get_quota_status-RPC:n som /api/generate använder: den tar
    p_timezone och räknar om resetfönster. Det är en sidoeffekt en
    uppladdning inte ska trigga. Här behövs bara plan.

    Fail-closed: okänd användare eller fel mot Supabase ger 'free'.
    """
    if not user_id or user_id == "anonymous_user":
        return "free"
    try:
        result = (
            supabase.table("user_quotas")
            .select("plan")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception:
        logging.exception("Plan lookup failed for upload gate")
        return "free"
    rows = result.data or []
    if not rows:
        return "free"
    return rows[0].get("plan") or "free"


def require_multimodal_access(user_id: str) -> None:
    """Tunn behörighetskontroll — enda stället där multimodal-vägen är plan-beroende."""
    if lookup_plan(user_id) != "admin":
        raise HTTPException(status_code=403, detail=MULTIMODAL_GATED_MESSAGE)


# ── Kortbilder (bilder användaren lägger på ett kort i granskningsvyn) ───────
#
# Samma uppdelning som multimodal-vägen ovan: lagring, export och rendering är
# plan-agnostiska. Hela behörighetsskillnaden ligger i
# require_card_image_access(), som anropas på ett ställe per skrivande kodväg.
# Tas de raderna bort blir funktionen publik utan att något annat skrivs om.

CARD_IMAGE_GATED_MESSAGE = (
    "Card images aren't supported yet — this feature is in testing"
)

# Tak per kort. Inte kvotlogik — ett kort med tjugo bilder är ett trasigt kort,
# och taket håller .apkg-storleken förutsägbar.
MAX_IMAGES_PER_CARD = 8

# Livslängd på de signerade miniatyr-URL:erna i GET /api/cards. En timme täcker
# en normal granskningssession utan omladdning; kortare TTL:er ger trasiga
# miniatyrer mitt i granskningen, längre håller en läckt URL giltig i onödan.
# URL:erna signeras om vid varje sidladdning, så kostnaden är ett anrop.
CARD_IMAGE_URL_TTL_SECONDS = 3600


def require_card_image_access(user_id: str) -> None:
    """Tunn behörighetskontroll — enda stället där kortbilder är plan-beroende."""
    if lookup_plan(user_id) != "admin":
        raise HTTPException(status_code=403, detail=CARD_IMAGE_GATED_MESSAGE)


def parse_uuid(value: str, what: str) -> uuid.UUID:
    """
    Sökvägssegment når en UUID-kolumn i WHERE. Ett trasigt värde skulle annars
    bli 'invalid input syntax for type uuid' från psycopg2 — ett 500 där 404
    är det korrekta svaret.
    """
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail=f"{what} hittades inte")


def load_owned_card(
    db: Session, session_id: str, card_id: str, user_id: str
) -> CardModel:
    """
    Ägarkontrollen för allt som rör ett korts bilder: kortet måste finnas,
    ligga i den angivna sessionen och tillhöra den anropande användaren.
    Sökvägen i Storage byggs sedan av de här verifierade id:na.
    """
    card = db.query(CardModel).filter(
        CardModel.id == parse_uuid(card_id, "Kort"),
        CardModel.session_id == parse_uuid(session_id, "Session"),
        CardModel.user_id == user_id,
    ).first()
    if not card:
        raise HTTPException(status_code=404, detail="Kort hittades inte")
    return card


def load_card_images(db: Session, card_ids: list) -> dict[str, list[CardImageModel]]:
    """
    Alla bilder för en lista kort i EN fråga, grupperade per kort-id.

    Medvetet inte lazy-laddade relationer: granskningsvyn hämtar hela
    sessionen på en gång, och card.images per kort skulle ge en fråga per kort
    (N+1). Signeringen av URL:erna batchas på samma sätt i anroparen.
    """
    if not card_ids:
        return {}

    rows = (
        db.query(CardImageModel)
        .filter(CardImageModel.card_id.in_(card_ids))
        .order_by(CardImageModel.card_id, CardImageModel.position, CardImageModel.created_at)
        .all()
    )

    grouped: dict[str, list[CardImageModel]] = {}
    for row in rows:
        grouped.setdefault(str(row.card_id), []).append(row)
    return grouped


def render_pdf_pages(doc, page_count: int) -> list[tuple[str, bytes]]:
    """Renderar varje sida till PNG. Returnerar (media_type, bytes) per sida."""
    pages = []
    for n in range(page_count):
        pix = doc[n].get_pixmap(dpi=VISION_RENDER_DPI)
        pages.append(("image/png", pix.tobytes("png")))
    return pages


def downscale_pages(
    pages: list[tuple[str, bytes]],
    max_edge: int,
) -> list[tuple[str, bytes]]:
    """
    Skalar ned sidbilder så längsta sidan blir max_edge px. Bildtokens skalar
    med ytan, så 200 DPI → 1568 px är ungefär en halvering.

    Misslyckas nedskalningen används originalet — en dyrare bild är bättre än
    ingen bild.
    """
    import io
    import pymupdf

    out: list[tuple[str, bytes]] = []
    for media_type, raw in pages:
        try:
            pix = pymupdf.Pixmap(io.BytesIO(raw))
            longest = max(pix.width, pix.height)
            if longest <= max_edge:
                out.append((media_type, raw))
                continue
            scale = max_edge / longest
            small = pymupdf.Pixmap(
                pix, int(pix.width * scale), int(pix.height * scale), False
            )
            out.append(("image/png", small.tobytes("png")))
        except Exception:
            logging.exception("Page downscale failed — using full-size page")
            out.append((media_type, raw))
    return out


def build_thumbnails(pages: list[tuple[str, bytes]]) -> list[str]:
    """
    Små data-URI:er för bilaga-panelen i frontend. Renderas om från
    originalbytes så att panelen aldrig laddar fullstora sidor.
    """
    import base64
    import io

    thumbs: list[str] = []
    for media_type, raw in pages[:MAX_THUMBNAILS]:
        try:
            import pymupdf
            pix = pymupdf.Pixmap(io.BytesIO(raw))
            scale = THUMBNAIL_DPI / VISION_RENDER_DPI
            small = pymupdf.Pixmap(pix, int(pix.width * scale), int(pix.height * scale), False)
            data = small.tobytes("png")
        except Exception:
            # Tumnaglar är kosmetiska — misslyckas de ska uppladdningen ändå gå igenom.
            continue
        thumbs.append(
            "data:image/png;base64," + base64.standard_b64encode(data).decode("ascii")
        )
    return thumbs


# ── resolve_source: en upplösningspunkt för text- och bildläge ───────────────

class ResolvedSource:
    """
    Normaliserar källmaterialet så att resten av flödet slipper veta vilket
    läge som gäller.

    .text   matar ordräkning, consume_generation, SessionModel.source_material,
            /api/sessions/{id}/source och /api/explain. I bildläge en läsbar
            platshållare — aldrig tom sträng.
    .images når bara generate_cards_stream(), review_cards() och /api/explain.
    """

    def __init__(self, text: str, images: list[tuple[str, bytes]] | None = None,
                 filename: str = ""):
        self.text = text
        self.images = images or None
        self.filename = filename

    @property
    def is_images(self) -> bool:
        return bool(self.images)


def resolve_source(
    source_material: str = "",
    upload_id: str = "",
    session_id: str = "",
    user_id: str = "",
) -> ResolvedSource:
    """
    Tre anropare:
      /api/generate  → upload_id  (staging, innan sessionen finns)
      /api/explain   → session_id (permanent, efter att sessionen skapats)
      textläge       → source_material, oförändrat
    """
    if upload_id:
        meta = storage.read_staging_meta(upload_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Upload not found or expired.")
        if meta.get("user_id") != user_id:
            raise HTTPException(status_code=404, detail="Upload not found or expired.")

        images = storage.load_staging_pages(upload_id)
        if not images:
            raise HTTPException(status_code=404, detail="Upload not found or expired.")

        filename = meta.get("filename", "document")
        return ResolvedSource(
            text=f"[Image-based source: {filename}, {len(images)} page(s)]",
            images=images,
            filename=filename,
        )

    if session_id:
        # Anroparen ansvarar för ägarkontrollen innan detta anropas.
        images = storage.load_session_pages(user_id, session_id)
        if images:
            return ResolvedSource(
                text=source_material,
                images=images,
            )

    return ResolvedSource(text=source_material)


async def stage_pages(
    user_id: str,
    filename: str,
    pages: list[tuple[str, bytes]],
) -> dict:
    """
    Lägger sidbilderna i staging och returnerar referensen frontend skickar
    vidare till /api/generate. Ingen modell anropas här — Opus 4.8 ser sidorna
    först i genereringssteget.
    """
    import asyncio

    # Lat städning av övergivna uppladdningar. Fel här får aldrig stoppa
    # en giltig uppladdning.
    try:
        await asyncio.to_thread(storage.sweep_stale_staging)
    except Exception:
        logging.exception("Staging sweep failed")

    try:
        upload_id = await asyncio.to_thread(
            storage.put_staging_pages, user_id, filename, pages
        )
    except Exception as e:
        logging.exception("Staging upload failed")
        raise HTTPException(
            status_code=502,
            detail=f"Could not store the uploaded pages: {str(e)}"
        )

    thumbnails = await asyncio.to_thread(build_thumbnails, pages)

    logging.info(f"[UPLOAD] staged {len(pages)} page(s) as {upload_id}")
    return {
        "mode":       "images",
        "upload_id":  upload_id,
        "filename":   filename,
        "page_count": len(pages),
        "thumbnails": thumbnails,
    }


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id)
):
    """
    Tar emot uppladdad fil och returnerar textinnehåll.

    .txt och digitalt skapade PDF:er går textvägen som tidigare, för alla
    planer. Skannade PDF:er och bilder går multimodal-vägen, som är gatead.
    """
    import asyncio

    content_type = file.content_type or ""
    filename = (file.filename or "").lower()
    ext = os.path.splitext(filename)[1]

    # ── Bilder: alltid bildläge, ingen textdetektion behövs ──────────────────
    if ext in IMAGE_MEDIA_TYPES or content_type.startswith("image/"):
        media_type = IMAGE_MEDIA_TYPES.get(ext, content_type)
        if media_type not in set(IMAGE_MEDIA_TYPES.values()):
            raise HTTPException(
                status_code=400,
                detail="Image format not supported. Use .jpg or .png"
            )

        require_multimodal_access(user_id)

        content = await file.read()
        return await stage_pages(
            user_id, file.filename or "image", [(media_type, content)]
        )

    if ext == ".txt" or "text" in content_type:
        content = await file.read()
        return {
            "mode": "text",
            "text": content.decode("utf-8", errors="ignore"),
            "extraction": "text",
        }

    if ext == ".pdf" or "pdf" in content_type:
        try:
            import pymupdf
        except ImportError:
            raise HTTPException(
                status_code=400,
                detail="PDF-stöd kräver pymupdf. Kör: pip install pymupdf"
            )

        content = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            doc = pymupdf.open(tmp_path)
            try:
                page_texts = [page.get_text() for page in doc]

                page_count = doc.page_count

                if not page_count:
                    raise HTTPException(
                        status_code=400,
                        detail="Could not read any pages from this PDF."
                    )

                # Admin kör alltid vision-vägen — ingen textlagerdetektion.
                # Ett textlager kan finnas och ändå ha fel läsordning: ett bråk
                # exporterat från Word/LaTeX ligger som separata textobjekt, och
                # pymupdf läser "A = b·h" och "2" som två rader. Att textlagret
                # FINNS säger ingenting om att ordningen går att lita på, och
                # det går inte att avgöra i förväg.
                #
                # Alla andra planer: oförändrad detektion. Digitala PDF:er går
                # textvägen precis som tidigare, dokument utan textlager möter
                # gaten.
                if lookup_plan(user_id) != "admin":
                    page_texts = [page.get_text() for page in doc]
                    sparse = sum(
                        1 for t in page_texts
                        if len(t.strip()) < SCANNED_MIN_CHARS_PER_PAGE
                    )
                    if sparse <= len(page_texts) * SCANNED_PAGE_RATIO:
                        return {
                            "mode": "text",
                            "text": "".join(page_texts),
                            "extraction": "pymupdf",
                        }
                    require_multimodal_access(user_id)  # → 403

                # Blockera, fall INTE tillbaka till textvägen. En tyst
                # degradering till den kända opålitliga extraktionen är exakt
                # felet vi just spårade upp.
                if page_count > MAX_VISION_PAGES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"This document has {page_count} pages. Vision mode "
                            f"supports up to {MAX_VISION_PAGES} pages — please "
                            "split the document or contact support."
                        )
                    )

                images = await asyncio.to_thread(
                    render_pdf_pages, doc, page_count
                )
            finally:
                doc.close()
        finally:
            os.unlink(tmp_path)

        return await stage_pages(user_id, file.filename or "document.pdf", images)

    raise HTTPException(
        status_code=400,
        detail="Filformat stöds inte. Använd .txt, .pdf, .jpg eller .png"
    )


# ── /api/cards/{session_id} ───────────────────────────────────────────────────

@app.get("/api/cards/{session_id}")
async def get_cards(
    session_id: str,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """
    Returnerar alla kort för en session, med varje korts bilder.

    images_enabled speglar samma gate som skrivendpointerna. Frontend kan inte
    läsa planen här (kvoten hämtas bara i upload-vyn, och en session som öppnas
    via ?session_id= går direkt till granskning), så flaggan följer med svaret
    i stället — servern förblir den auktoritativa gaten.
    """
    cards = db.query(CardModel).filter(
        CardModel.session_id == session_id,
        CardModel.user_id == user_id
    ).order_by(CardModel.position).all()

    images_by_card = load_card_images(db, [c.id for c in cards])

    # Ett signeringsanrop för hela sessionen, inte ett per bild — annars kostar
    # granskningsvyn en round-trip per miniatyr.
    all_paths = [img.storage_path for imgs in images_by_card.values() for img in imgs]
    signed: dict[str, str] = {}
    if all_paths:
        signed = await asyncio.to_thread(
            card_image_storage.sign_urls, all_paths, CARD_IMAGE_URL_TTL_SECONDS
        )

    plan = await asyncio.to_thread(lookup_plan, user_id)

    return {
        "images_enabled": plan == "admin",
        "cards": [
            {
                "text": c.text,
                "extra": c.extra,
                "tags": c.tags,
                "deck": c.deck,
                "logg": c.logg,
                "approved": c.approved,
                "card_type": c.card_type or 'cloze',
                "id": str(c.id),
                "images": [
                    {
                        "id": str(img.id),
                        "url": signed.get(img.storage_path),
                        "position": img.position,
                    }
                    for img in images_by_card.get(str(c.id), [])
                ],
            }
            for c in cards
        ],
    }


# ── /api/cards/{session_id}/{card_id}/images ─────────────────────────────────

@app.post("/api/cards/{session_id}/{card_id}/images")
async def add_card_image(
    session_id: str,
    card_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """
    Lägger en bild på ett kort. Samma endpoint för dropp och klistra-in —
    frontend paketerar urklippets bilddata som en fil innan den skickar.
    """
    require_card_image_access(user_id)
    card = load_owned_card(db, session_id, card_id, user_id)

    # Vissa webbläsare skickar tom content-type vid drag & drop; filändelsen
    # är då enda ledtråden.
    media_type = (file.content_type or "").lower().split(";")[0].strip()
    if not card_image_storage.extension_for_media_type(media_type):
        media_type = card_image_storage.media_type_for_filename(file.filename or "") or ""
    if not card_image_storage.extension_for_media_type(media_type):
        raise HTTPException(
            status_code=400,
            detail="Image format not supported. Use PNG, JPG, GIF or WebP."
        )

    existing = load_card_images(db, [card.id]).get(str(card.id), [])
    if len(existing) >= MAX_IMAGES_PER_CARD:
        raise HTTPException(
            status_code=400,
            detail=f"A card can hold at most {MAX_IMAGES_PER_CARD} images."
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The image file was empty.")
    if len(data) > card_image_storage.MAX_IMAGE_BYTES:
        limit_mb = card_image_storage.MAX_IMAGE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Images must be smaller than {limit_mb} MB."
        )

    try:
        path = await asyncio.to_thread(
            card_image_storage.put_card_image,
            user_id, str(card.session_id), str(card.id), media_type, data,
        )
    except Exception as e:
        logging.exception("Card image upload failed")
        raise HTTPException(
            status_code=502,
            detail=f"Could not store the image: {str(e)}"
        )

    row = CardImageModel(
        card_id=card.id,
        storage_path=path,
        position=(existing[-1].position + 1) if existing else 0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    signed = await asyncio.to_thread(
        card_image_storage.sign_urls, [path], CARD_IMAGE_URL_TTL_SECONDS
    )
    return {
        "id": str(row.id),
        "url": signed.get(path),
        "position": row.position,
    }


@app.delete("/api/cards/{session_id}/{card_id}/images/{image_id}")
async def delete_card_image(
    session_id: str,
    card_id: str,
    image_id: str,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """Tar bort en bild från kortet: DB-raden först, sedan filen."""
    require_card_image_access(user_id)
    card = load_owned_card(db, session_id, card_id, user_id)

    row = db.query(CardImageModel).filter(
        CardImageModel.id == parse_uuid(image_id, "Bild"),
        CardImageModel.card_id == card.id,
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Bild hittades inte")

    # Raden bort först. En fil utan rad är osynlig och ofarlig; en rad utan fil
    # ger en trasig miniatyr och en export som tyst tappar bilden.
    path = row.storage_path
    db.delete(row)
    db.commit()

    await asyncio.to_thread(card_image_storage.delete_card_image, path)
    return {"ok": True}


# ── /api/cards/{session_id}/{card_id}/content ─────────────────────────────────

@app.patch("/api/cards/{session_id}/{card_id}/content")
async def update_card_content(
    session_id: str,
    card_id: str,
    body: dict,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """Uppdaterar textinnehållet i ett kort."""
    card = db.query(CardModel).filter(
        CardModel.id == card_id,
        CardModel.user_id == user_id
    ).first()

    if not card:
        raise HTTPException(status_code=404, detail="Kort hittades inte")

    if "text" in body:
        card.text = body["text"]
    if "extra" in body:
        card.extra = body["extra"]
    if "deck" in body:
        card.deck = body["deck"]
    if "approved" in body:
        card.approved = body["approved"]

    db.commit()
    return {"ok": True}


# ── /api/export/{session_id} ──────────────────────────────────────────────────

@app.post("/api/export/{session_id}")
async def export(
    session_id: str,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """Exporterar godkända kort som .apkg-fil."""
    cards = db.query(CardModel).filter(
        CardModel.session_id == session_id,
        CardModel.user_id == user_id,
        CardModel.approved == True
    ).order_by(CardModel.position).all()

    if not cards:
        raise HTTPException(status_code=400, detail="Inga godkända kort att exportera")

    # Bilderna hämtas ur Storage och skrivs till en temporär mapp som genanki
    # läser vid paketeringen. Mappen raderas så fort .apkg-filen är skriven.
    images_by_card = load_card_images(db, [c.id for c in cards])
    media_dir, media_files, bild_by_card = await collect_export_media(images_by_card)
    output_path = f"/tmp/dimindo_{session_id}.apkg"

    try:
        cards_data = [
            {
                "text": c.text,
                "extra": c.extra or "",
                "tags": c.tags or "",
                "deck": c.deck or "",
                "logg": c.logg or "",
                "bild": bild_by_card.get(str(c.id), ""),
                "card_type": c.card_type or 'cloze'
            }
            for c in cards
        ]

        await asyncio.to_thread(export_to_apkg, cards_data, output_path, media_files)
    finally:
        if media_dir:
            shutil.rmtree(media_dir, ignore_errors=True)

    return FileResponse(
        path=output_path,
        filename="dimindo_export.apkg",
        media_type="application/octet-stream"
    )


async def collect_export_media(
    images_by_card: dict[str, list[CardImageModel]],
) -> tuple[str | None, list[str], dict[str, str]]:
    """
    Materialiserar kortbilderna på disk inför paketeringen.

    Returnerar (temporär mapp, filsökvägar till genanki, Bild-HTML per kort-id).

    genanki lagrar mediefiler under enbart sitt basename, så namnen måste vara
    unika i hela paketet. Namnet byggs därför av kortets id plus bildens
    position — inte av originalfilnamnet, som skulle kollidera så fort två kort
    fick var sin 'image.png' inklistrad. Samma kort exporterat två gånger ger
    samma namn, vilket är önskvärt: Anki skriver då över med identiskt innehåll
    i stället för att samla dubbletter i mediemappen.
    """
    if not any(images_by_card.values()):
        return None, [], {}

    # Namnen bestäms först, så nedladdningen kan skriva rakt till slutfilen.
    filenames: dict[str, str] = {}
    for card_id, images in images_by_card.items():
        for index, img in enumerate(images):
            ext = card_image_storage.extension_of(img.storage_path)
            filenames[img.storage_path] = (
                f"dimindo-{uuid.UUID(card_id).hex}-{index:02d}.{ext}"
            )

    media_dir = tempfile.mkdtemp(prefix="dimindo_media_")
    fetched = await asyncio.to_thread(
        card_image_storage.download_to_dir, filenames, media_dir
    )

    media_files: list[str] = []
    bild_by_card: dict[str, str] = {}

    for card_id, images in images_by_card.items():
        tags: list[str] = []
        for img in images:
            if img.storage_path not in fetched:
                # Bilden gick inte att läsa. Hellre ett kort utan den bilden
                # än en export som fallerar helt.
                logging.warning(f"[EXPORT] skipping unreadable image {img.storage_path}")
                continue
            filename = filenames[img.storage_path]
            media_files.append(os.path.join(media_dir, filename))
            tags.append(f'<img src="{filename}">')
        if tags:
            bild_by_card[card_id] = "".join(tags)

    logging.info(f"[EXPORT] packaged {len(media_files)} card image(s)")
    return media_dir, media_files, bild_by_card


# ── /api/health ───────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ── /api/demo/cards ───────────────────────────────────────────────────────────

VALID_DEMO_SUBJECTS = {"biology", "history", "chemistry", "medicine"}

@app.get("/api/demo/cards")
async def get_demo_cards(
    subject: str,
    db: Session = Depends(get_db)
):
    if subject not in VALID_DEMO_SUBJECTS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid subject. Valid values: {', '.join(sorted(VALID_DEMO_SUBJECTS))}"
        )

    cards = (
        db.query(DemoCard)
        .filter(DemoCard.subject == subject)
        .order_by(DemoCard.position)
        .all()
    )

    if not cards:
        raise HTTPException(status_code=404, detail="No demo cards found for subject.")

    return [
        {
            "id": str(card.id),
            "subject": card.subject,
            "text": card.text,
            "extra": card.extra,
            "highlight_phrase": card.highlight_phrase,
            "position": card.position,
            "approved": True,
        }
        for card in cards
    ]