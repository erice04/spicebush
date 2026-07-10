import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def normalize_database_url(url: str) -> str:
    """Neon and some hosts still hand out postgres://; SQLAlchemy wants postgresql://."""
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://") :]
    return url


DATABASE_URL = normalize_database_url(
    os.getenv("DATABASE_URL", "sqlite:///./spicebush.db")
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
