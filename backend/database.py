from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base
from config import settings

engine_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False, "timeout": 30}

engine = create_engine(settings.DATABASE_URL, **engine_args)

if settings.DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def ensure_user_columns():
    try:
        with engine.begin() as conn:
            res = conn.execute(text("PRAGMA table_info(users)")).fetchall()
            if not res:
                return
            existing_cols = {row[1] for row in res}
            migrations = [
                ("position", "ALTER TABLE users ADD COLUMN position VARCHAR(100)"),
                ("phone", "ALTER TABLE users ADD COLUMN phone VARCHAR(50)"),
                ("photo_url", "ALTER TABLE users ADD COLUMN photo_url TEXT"),
                ("can_create_clients", "ALTER TABLE users ADD COLUMN can_create_clients BOOLEAN DEFAULT 0"),
                ("assigned_client_ids", "ALTER TABLE users ADD COLUMN assigned_client_ids TEXT DEFAULT '[]'"),
            ]
            for col_name, sql in migrations:
                if col_name not in existing_cols:
                    conn.execute(text(sql))

            res_clients = conn.execute(text("PRAGMA table_info(clients)")).fetchall()
            if res_clients:
                existing_client_cols = {row[1] for row in res_clients}
                if "postal_code" not in existing_client_cols:
                    conn.execute(text("ALTER TABLE clients ADD COLUMN postal_code VARCHAR(10)"))

            res_audit = conn.execute(text("PRAGMA table_info(audit_logs)")).fetchall()
            if res_audit:
                existing_audit_cols = {row[1] for row in res_audit}
                if "duration_seconds" not in existing_audit_cols:
                    conn.execute(text("ALTER TABLE audit_logs ADD COLUMN duration_seconds INTEGER"))
    except Exception as e:
        print(f"Schema migration note: {e}")

def init_db():
    Base.metadata.create_all(bind=engine)
    ensure_user_columns()
