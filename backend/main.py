import os
import uuid
import json
import tempfile
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from generator import generate_cards_stream, parse_tsv
from exporter import export_to_apkg
from database import get_db, SessionModel, CardModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Asterisken säger till Railway att godkänna din Vercel-sida direkt!
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def get_user_id(x_user_id: str = Header(...)):
    """Hämtar user_id från request header."""
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Ej autentiserad")
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

    full_tsv = ""

    async def event_stream():
        nonlocal full_tsv

        yield f"data: {json.dumps({'type': 'session_id', 'session_id': session_id})}\n\n"

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            def run_generator():
                chunks = []
                for chunk in generate_cards_stream(source_material):
                    chunks.append(chunk)
                return chunks

            chunks = await loop.run_in_executor(None, run_generator)

            for chunk in chunks:
                full_tsv += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunk})}\n\n"

            if not full_tsv.strip():
                yield f"data: {json.dumps({'type': 'error', 'message': 'Claude returnerade ingen output. Försök igen.'})}\n\n"
                return

            cards = parse_tsv(full_tsv)

            if not cards:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Inga kort kunde parsas. Kontrollera källmaterialet.'})}\n\n"
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

        except Exception as e:
            error_msg = str(e)
            if 'timeout' in error_msg.lower():
                yield f"data: {json.dumps({'type': 'error', 'message': 'Förfrågan tog för lång tid.'})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'message': f'Fel: {error_msg}'})}\n\n"

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