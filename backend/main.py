import os
import uuid
import json
import tempfile
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, Response
from sqlalchemy.orm import Session
from generator import generate_cards_stream, parse_tsv
from exporter import export_to_apkg
from database import get_db, SessionModel, CardModel

app = FastAPI()

# 1. Standard-CORS för vanliga anrop
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

# 3. Den uppdaterade användarfunktionen med fallback för MVP
def get_user_id(x_user_id: str = Header(None)):
    if not x_user_id or x_user_id == "":
        return "anonymous_user"
    return x_user_id


@app.post("/api/generate")
async def generate(
    source_material: str = Form(...),
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db)
):
    db_session = SessionModel(user_id=user_id)
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
            for chunk in generate_cards_stream(source_material):
                chunk_queue.put(chunk)
            chunk_queue.put(DONE_SENTINEL)
        except Exception as e:
            chunk_queue.put((ERROR_SENTINEL, str(e)))

    async def event_stream():
        full_tsv = ""

        yield f"data: {json.dumps({'type': 'session_id', 'session_id': session_id})}\n\n"

        # Starta generatorn i en bakgrundstråd
        thread = threading.Thread(target=run_generator, daemon=True)
        thread.start()

        try:
            while True:
                # Hämta nästa chunk utan att blockera event loop
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
                    yield f"data: {json.dumps({'type': 'chunk', 'text': item})}\n\n"

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
                        user_id=user_id,
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

    if not card:
        raise HTTPException(status_code=404, detail="Kort hittades inte")

    if "approved" in body:
        card.approved = body["approved"]
        db.commit()

    return {"ok": True}


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

    output_path = f"/tmp/techtona_{session_id}.apkg"
    export_to_apkg(cards_data, output_path)

    return FileResponse(
        path=output_path,
        filename="techtona_export.apkg",
        media_type="application/octet-stream"
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}