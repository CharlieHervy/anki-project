import os
from sqlalchemy import create_engine, Column, String, Boolean, Integer, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.sql import func
from dotenv import load_dotenv

load_dotenv()

engine = create_engine(
    "postgresql+psycopg2://",
    connect_args={
        "host": os.environ.get("DB_HOST"),
        "port": int(os.environ.get("DB_PORT", 6543)),
        "database": os.environ.get("DB_NAME"),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
        "sslmode": "require",
    },
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class SessionModel(Base):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
    cards = relationship("CardModel", back_populates="session", cascade="all, delete")


class CardModel(Base):
    __tablename__ = "cards"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.id"), nullable=False)
    user_id = Column(String, nullable=False)
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False)
    extra = Column(String)
    tags = Column(String)
    deck = Column(String)
    logg = Column(String)
    approved = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    session = relationship("SessionModel", back_populates="cards")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()