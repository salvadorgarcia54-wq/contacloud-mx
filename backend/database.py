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

_SCHEMA_MIGRATED = False

def ensure_user_columns():
    global _SCHEMA_MIGRATED
    if _SCHEMA_MIGRATED:
        return
    _SCHEMA_MIGRATED = True
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
                ("owner_user_id", "ALTER TABLE users ADD COLUMN owner_user_id INTEGER"),
            ]
            for col_name, sql in migrations:
                if col_name not in existing_cols:
                    conn.execute(text(sql))

            res_clients = conn.execute(text("PRAGMA table_info(clients)")).fetchall()
            if res_clients:
                existing_client_cols = {row[1] for row in res_clients}
                if "postal_code" not in existing_client_cols:
                    conn.execute(text("ALTER TABLE clients ADD COLUMN postal_code VARCHAR(10)"))
                if "owner_user_id" not in existing_client_cols:
                    conn.execute(text("ALTER TABLE clients ADD COLUMN owner_user_id INTEGER"))

            res_audit = conn.execute(text("PRAGMA table_info(audit_logs)")).fetchall()
            if res_audit:
                existing_audit_cols = {row[1] for row in res_audit}
                if "duration_seconds" not in existing_audit_cols:
                    conn.execute(text("ALTER TABLE audit_logs ADD COLUMN duration_seconds INTEGER"))

            # Identificar el usuario admin principal (por defecto id=1 / username='admin')
            admin_row = conn.execute(
                text("SELECT id FROM users WHERE username = 'admin' ORDER BY id ASC LIMIT 1")
            ).fetchone()
            if not admin_row:
                admin_row = conn.execute(
                    text("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
                ).fetchone()
            primary_admin_id = int(admin_row[0]) if admin_row else 1

            # Asignar los auxiliares previos sin owner_user_id al admin principal
            conn.execute(
                text("UPDATE users SET owner_user_id = :admin_id WHERE role = 'accountant' AND owner_user_id IS NULL"),
                {"admin_id": primary_admin_id},
            )

            # Si algún cliente fue creado según la bitácora por un usuario específico, asignarle su dueño
            if res_audit and res_clients:
                conn.execute(
                    text("""
                        UPDATE clients
                        SET owner_user_id = (
                            SELECT COALESCE(u.owner_user_id, u.id)
                            FROM audit_logs al
                            JOIN users u ON u.id = al.user_id
                            WHERE al.client_id = clients.id
                              AND al.action = 'CREAR_CLIENTE'
                              AND al.user_id IS NOT NULL
                            ORDER BY al.id ASC
                            LIMIT 1
                        )
                        WHERE owner_user_id IS NULL
                    """)
                )

            # Asignar los clientes previos sin owner_user_id al admin principal
            conn.execute(
                text("UPDATE clients SET owner_user_id = :admin_id WHERE owner_user_id IS NULL"),
                {"admin_id": primary_admin_id},
            )
    except Exception as e:
        print(f"Schema migration note: {e}")


def get_effective_owner_id(db, user) -> int:
    """
    Devuelve el ID del Socio/Titular (owner_user_id) al que pertenece el usuario actual.
    Garantiza aislamiento multi-tenant entre distintas cuentas registradas.
    """
    if not user:
        return 1
    role = (getattr(user, "role", "") or "").strip().lower()
    if role == "admin":
        return int(user.id)
    owner_id = getattr(user, "owner_user_id", None)
    if owner_id:
        return int(owner_id)
    # Fallback al admin principal usando la misma sesión db
    row = db.execute(text("SELECT id FROM users WHERE username = 'admin' ORDER BY id ASC LIMIT 1")).fetchone()
    return int(row[0]) if row else int(user.id)

def init_db():
    Base.metadata.create_all(bind=engine)
    ensure_user_columns()
