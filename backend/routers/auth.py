from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import JWTError, jwt
import bcrypt

from database import get_db, SessionLocal, ensure_user_columns
from models.user import User
from models.client import Client
from models.temp_password import TempPassword
from schemas.user import UserResponse, Token, ChangePasswordRequest
from config import settings

ensure_user_columns()

router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        if isinstance(hashed_password, str):
            hashed_bytes = hashed_password.encode('utf-8')
        else:
            hashed_bytes = hashed_password
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_bytes)
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def ensure_demo_assistant_user(db: Session):
    """
    Garantiza que exista el usuario demo de Auxiliar de Contador ('auxiliar' / 'auxiliar123')
    con rol 'accountant' (sin acceso a módulos exclusivos del Socio/Titular).
    Respeta los clientes asignados manualmente desde el módulo Usuarios / Auxiliares.
    """
    try:
        active_client_ids = [
            c.id for c in db.query(Client).filter(Client.is_active == True).order_by(Client.id.asc()).all()
        ]
        demo_user = db.query(User).filter(User.username == "auxiliar").first()
        if not demo_user:
            demo_user = User(
                username="auxiliar",
                email="auxiliar.demo@contacloud.mx",
                hashed_password=get_password_hash("auxiliar123"),
                full_name="Auxiliar Contable (Demo)",
                position="Auxiliar de Contador",
                phone="55 1234 5678",
                role="accountant",
                can_create_clients=False,
                is_active=True,
            )
            demo_user.assigned_client_ids = active_client_ids[:2]
            db.add(demo_user)
            db.commit()
            db.refresh(demo_user)
        else:
            updated = False
            if demo_user.role != "accountant":
                demo_user.role = "accountant"
                updated = True
            if not demo_user.position:
                demo_user.position = "Auxiliar de Contador"
                updated = True
            # Si tenía los 7 clientes de la semilla inicial, ajustarlo a 2 clientes como configuró el titular
            current_assigned = demo_user.assigned_client_ids or []
            if len(active_client_ids) > 2 and len(current_assigned) == len(active_client_ids):
                demo_user.assigned_client_ids = active_client_ids[:2]
                updated = True
            if updated:
                db.commit()
                db.refresh(demo_user)
        return demo_user
    except Exception:
        db.rollback()
        return None


try:
    _init_db_sess = SessionLocal()
    try:
        ensure_demo_assistant_user(_init_db_sess)
    finally:
        _init_db_sess.close()
except Exception:
    pass

def create_access_token(data: dict):
    to_encode = data.copy()
    expire_minutes = getattr(settings, 'ACCESS_TOKEN_EXPIRE_MINUTES', 1440)
    expire = datetime.utcnow() + timedelta(minutes=expire_minutes)
    to_encode.update({"exp": expire})
    secret_key = getattr(settings, 'SECRET_KEY', "insecure_secret_key")
    algorithm = getattr(settings, 'ALGORITHM', "HS256")
    encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=algorithm)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        secret_key = getattr(settings, 'SECRET_KEY', "insecure_secret_key")
        algorithm = getattr(settings, 'ALGORITHM', "HS256")
        payload = jwt.decode(token, secret_key, algorithms=[algorithm])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    if str(username).strip().lower() == "auxiliar":
        ensure_demo_assistant_user(db)

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

def require_role(*roles):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return current_user
    return role_checker

@router.post("/login", response_model=Token)
async def login(request: Request, db: Session = Depends(get_db)):
    content_type = request.headers.get("content-type", "")
    username = None
    password = None
    if "application/json" in content_type:
        try:
            body = await request.json()
            username = body.get("username")
            password = body.get("password")
        except Exception:
            pass
    if not username:
        try:
            form = await request.form()
            username = form.get("username")
            password = form.get("password")
        except Exception:
            pass

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required"
        )

    if str(username).strip().lower() == "auxiliar":
        ensure_demo_assistant_user(db)

    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    clean_pw = "".join(ch for ch in str(password).strip().lower() if ch.isalnum())
    matched_tp = None
    if len(clean_pw) == 32:
        matched_tp = (
            db.query(TempPassword)
            .filter(
                (TempPassword.token_clean == clean_pw)
                | (TempPassword.token_uuid == str(password).strip().lower())
            )
            .first()
        )

    now = datetime.utcnow()
    if matched_tp:
        if matched_tp.target_user_id and matched_tp.target_user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Esta contraseña temporal de 32 dígitos pertenece a otro usuario.",
            )
        if matched_tp.is_revoked or now >= matched_tp.expires_at:
            if matched_tp.target_user_id == user.id and user.role != "admin":
                user.is_active = False
                db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Esta contraseña temporal de 32 dígitos ya venció y ya no se permite su uso. Solicite una nueva al Socio/Titular.",
            )
        matched_tp.used_count = (matched_tp.used_count or 0) + 1
        matched_tp.last_used_at = now
        db.commit()
    else:
        if not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario o contraseña incorrectos",
                headers={"WWW-Authenticate": "Bearer"},
            )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El acceso de este usuario ha sido cancelado por el administrador",
        )
    access_token = create_access_token(data={"sub": user.username, "role": user.role, "client_id": user.client_id})
    return {
        "access_token": access_token,
        "token": access_token,
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/change-password")
def change_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual no es correcta"
        )
    if len(data.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 8 caracteres"
        )
    current_user.hashed_password = get_password_hash(data.new_password)
    db.commit()
    return {"message": "Contraseña actualizada exitosamente"}
