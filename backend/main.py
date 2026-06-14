import os
import uuid
import json
import tempfile
import logging
import stripe

logging.basicConfig(level=logging.INFO)
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, Response
from sqlalchemy.orm import Session
from generator import generate_cards_stream, parse_tsv
from exporter import export_to_apkg
from database import get_db, SessionModel, CardModel, DemoCard

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

def validate_input_length(word_count: int, plan: str) -> tuple[bool, str]:
    if plan == 'free' and word_count > 1000:
        return False, f"Free plan supports up to 1,000 words. Your text has {word_count} words."
    if word_count > 9000:
        return False, f"Maximum input is 9,000 words. Your text has {word_count} words."
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
    source_material: str = Form(...),
    language: str = Form(default="English"),
    timezone: str = Form(default="UTC"),
    x_user_id: str = Header(...),          # Kräver autentisering — ingen anonym fallback
    db: Session = Depends(get_db)
):
    word_count = count_words(source_material)

    # 1. Hämta användarens plan för inputvalidering
    try:
        quota_response = supabase.rpc(
            'get_quota_status',
            {'p_user_id': x_user_id, 'p_timezone': timezone}
        ).execute()
        plan = quota_response.data.get('plan', 'free')
    except Exception as e:
        return sse_error(f"Quota check failed: {str(e)}")

    # 2. Validera inputlängd mot plan
    valid, error_msg = validate_input_length(word_count, plan)
    if not valid:
        return sse_error(error_msg)

    # 3. Förbruka kvot via atomisk RPC (INNAN generering startar)
    #    OBS: Om Claude-anropet senare misslyckas förlorar användaren
    #    en generering. Rollback är inte implementerat i MVP.
    try:
        consume_response = supabase.rpc(
            'consume_generation',
            {
                'p_user_id':   x_user_id,
                'p_word_count': word_count,
                'p_timezone':  timezone
            }
        ).execute()
    except Exception as e:
        return sse_error(f"Quota consumption failed: {str(e)}")

    if not consume_response.data.get('success'):
        return sse_error(
            'quota_exceeded',
            daily_remaining=consume_response.data.get('daily_remaining', 0),
            quick_refill_remaining=consume_response.data.get('quick_refill_remaining', 0)
        )

    # 4. Skapa DB-session (efter kvotcheck — undviker tomma sessioner vid kvotfel)
    db_session = SessionModel(user_id=x_user_id)
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    session_id = str(db_session.id)

    import asyncio
    import queue
    import threading

    chunk_queue = queue.Queue()
    DONE_SENTINEL = object()
    ERROR_SENTINEL = object()

    def run_generator():
        try:
            for chunk in generate_cards_stream(source_material, language):
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
            while True:
                try:
                    item = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: chunk_queue.get(timeout=120)
                    )
                except queue.Empty:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Timeout – ingen respons från Claude.'})}\n\n"
                    return

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
                        logging.info(f"RAW LINE: {repr(stripped_line[:100])}")
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
                yield f"data: {json.dumps({'type': 'error', 'message': 'Inga kort kunde parsas.'})}\n\n"
                return

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
                        deck=card.get('deck', 'Huvudmeny'),
                        logg=card.get('logg', ''),
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

        elif product_type == 'pro':
            supabase.table('user_quotas').upsert({
                'user_id': user_id,
                'plan': 'pro',
                'daily_generations_limit': 3
            }).execute()

    elif event.type == 'customer.subscription.deleted':
        metadata = safe_metadata(event.data.object)
        user_id = metadata.get('user_id')

        if user_id:
            supabase.table('user_quotas').update({
                'plan': 'free',
                'daily_generations_limit': 1
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

    if product_type == 'quick_refill':
        price_data = {
            "currency": "sek",
            "unit_amount": 2900,  # 29 kr i ören
            "product_data": {"name": "Dimindo Quick Refill — 5 generations"},
        }
        mode = "payment"
    else:
        price_data = {
            "currency": "sek",
            "unit_amount": 9900,  # 99 kr i ören
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


# ── /api/upload ───────────────────────────────────────────────────────────────

def get_user_id(x_user_id: str = Header(None)):
    if not x_user_id or x_user_id == "":
        return "anonymous_user"
    return x_user_id

@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id)
):
    """Tar emot uppladdad fil och returnerar textinnehåll."""
    content_type = file.content_type or ""
    filename = file.filename or ""

    if filename.endswith(".txt") or "text" in content_type:
        content = await file.read()
        return {"text": content.decode("utf-8", errors="ignore")}

    elif filename.endswith(".pdf") or "pdf" in content_type:
        try:
            import pymupdf
            content = await file.read()
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            doc = pymupdf.open(tmp_path)
            text = ""
            for page in doc:
                text += page.get_text()
            doc.close()
            os.unlink(tmp_path)
            return {"text": text}
        except ImportError:
            raise HTTPException(
                status_code=400,
                detail="PDF-stöd kräver pymupdf. Kör: pip install pymupdf"
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Filformat stöds inte. Använd .txt eller .pdf"
        )


# ── /api/cards/{session_id} ───────────────────────────────────────────────────

@app.get("/api/cards/{session_id}")
async def get_cards(
    session_id: str,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    """Returnerar alla kort för en session."""
    cards = db.query(CardModel).filter(
        CardModel.session_id == session_id,
        CardModel.user_id == user_id
    ).order_by(CardModel.position).all()

    return {"cards": [
        {
            "text": c.text,
            "extra": c.extra,
            "tags": c.tags,
            "deck": c.deck,
            "logg": c.logg,
            "approved": c.approved,
            "id": str(c.id)
        }
        for c in cards
    ]}


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

    cards_data = [
        {
            "text": c.text,
            "extra": c.extra or "",
            "tags": c.tags or "",
            "deck": c.deck or "Huvudmeny",
            "logg": c.logg or "",
            "bild": ""
        }
        for c in cards
    ]

    output_path = f"/tmp/dimindo_{session_id}.apkg"
    export_to_apkg(cards_data, output_path)

    return FileResponse(
        path=output_path,
        filename="dimindo_export.apkg",
        media_type="application/octet-stream"
    )


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