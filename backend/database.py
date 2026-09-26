from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv
import os

load_dotenv()

def _use_psycopg2(url):
    """SQLAlchemy 2.1 maps a plain postgresql:// URL to psycopg v3, which needs libpq/psycopg-binary.
    We ship psycopg2-binary (works on Windows with no system libs), so pin that driver explicitly."""
    if url:
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg2://" + url[len(prefix):]
    return url


DATABASE_URL = _use_psycopg2(os.getenv("DATABASE_URL"))

engine = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) if engine else None
Base = declarative_base()


def get_db():
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not set. Add it to backend/.env")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after the first deploy. create_all() only creates missing TABLES,
# so columns added to tables that already exist (e.g. on Neon) must be added here.
NEW_COLUMNS = [
    ("student_profile", "rating", "INTEGER NOT NULL DEFAULT 1200"),
    ("question", "topic", "VARCHAR(100)"),
    ("quiz", "class_level", "VARCHAR(20)"),
    ("quiz", "chapter", "VARCHAR(200)"),
]


def ensure_columns(bind) -> None:
    """Idempotently add any NEW_COLUMNS missing from existing tables."""
    inspector = inspect(bind)
    with bind.begin() as conn:
        for table, column, ddl in NEW_COLUMNS:
            if table not in inspector.get_table_names():
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                print(f"[startup] Added column {table}.{column}")
