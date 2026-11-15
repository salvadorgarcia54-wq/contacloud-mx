from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
from pydantic import BaseModel
import json

from database import get_db, ensure_user_columns, get_effective_owner_id
from models.user import User
from schemas.user import UserCreate, UserUpdate, UserResponse
from routers.auth import require_role, get_password_hash, ensure_demo_assistant_user
from routers.temp_passwords import validate_and_consume_temp_password
from services.audit import log_activity

# Ensure SQLite columns exist even on hot reload
ensure_user_columns()

router = APIRouter(prefix="/api/users", tags=["users"])


class ToggleAccessRequest(BaseModel):
    is_active: bool
    temp_password: Optional[str] = None


@router.get("", response_model=List[UserResponse])
@router.get("/", response_model=List[UserResponse])
def list_staff_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    owner_id = get_effective_owner_id(db, current_user)
    if (current_user.username or "").strip().lower() == "admin":
        ensure_demo_assistant_user(db)
    users = (
        db.query(User)
        .filter(
            User.role.in_(["admin", "accountant"]),
            User.username != "sgadmin",
            (User.id == owner_id) | (User.owner_user_id == owner_id),
        )
        .order_by(User.id.asc())
        .all()
    )
    return users


@router.post("", response_model=UserResponse)
@router.post("/", response_model=UserResponse)
def create_staff_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    owner_id = get_effective_owner_id(db, current_user)
    clean_username = (data.username or "").strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="El nombre de usuario es obligatorio")

    existing = db.query(User).filter(User.username == clean_username).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"El nombre de usuario '{clean_username}' ya está registrado"
        )

    if not data.password or len(data.password.strip()) < 4:
        raise HTTPException(
            status_code=400,
            detail="La contraseña debe tener al menos 4 caracteres"
        )

    clean_email = data.email.strip() if data.email and data.email.strip() else None
    role = data.role if data.role in ("admin", "accountant") else "accountant"

    new_user = User(
        username=clean_username,
        email=clean_email,
        hashed_password=get_password_hash(data.password.strip()),
        full_name=(data.full_name or "").strip() or clean_username,
        position=(data.position or "").strip() or "Auxiliar Contable",
        phone=(data.phone or "").strip() or None,
        photo_url=data.photo_url or None,
        can_create_clients=bool(data.can_create_clients) if role != "admin" else True,
        role=role,
        owner_user_id=owner_id,
        is_active=True if data.is_active is None else bool(data.is_active),
    )
    new_user.assigned_client_ids = data.assigned_client_ids or []

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    log_activity(
        db=db,
        user=current_user,
        action="CREAR_USUARIO",
        module="Usuarios / Auxiliares",
        description=f"Dio de alta al auxiliar {new_user.full_name} (@{new_user.username}) - {new_user.position}",
        entity_id=new_user.id,
        details={"username": new_user.username, "role": new_user.role, "position": new_user.position}
    )

    return new_user


@router.put("/{user_id}", response_model=UserResponse)
def update_staff_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if data.username is not None:
        clean_username = data.username.strip()
        if not clean_username:
            raise HTTPException(status_code=400, detail="El nombre de usuario no puede estar vacío")
        existing = db.query(User).filter(User.username == clean_username, User.id != user_id).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"El nombre de usuario '{clean_username}' ya está en uso por otro usuario"
            )
        user.username = clean_username

    if data.full_name is not None:
        user.full_name = data.full_name.strip()
    if data.position is not None:
        user.position = data.position.strip()
    if data.email is not None:
        user.email = data.email.strip() if data.email.strip() else None
    if data.phone is not None:
        user.phone = data.phone.strip() if data.phone.strip() else None
    if data.photo_url is not None:
        user.photo_url = data.photo_url if data.photo_url else None
    if data.can_create_clients is not None:
        user.can_create_clients = bool(data.can_create_clients)
    if data.assigned_client_ids is not None:
        clean_ids = [int(x) for x in data.assigned_client_ids if str(x).isdigit() or isinstance(x, int)]
        user.assigned_client_ids = clean_ids
        user.assigned_client_ids_json = json.dumps(clean_ids)
        flag_modified(user, "assigned_client_ids_json")
    if data.role is not None and data.role in ("admin", "accountant"):
        if user.id == current_user.id and data.role != "admin":
            raise HTTPException(status_code=400, detail="No puede quitarse el rol de administrador a sí mismo")
        user.role = data.role

    if data.is_active is not None:
        if user.id == current_user.id and not data.is_active:
            raise HTTPException(status_code=400, detail="No puede cancelar el acceso de su propio usuario administrador")
        user.is_active = bool(data.is_active)

    if data.password and data.password.strip():
        if len(data.password.strip()) < 4:
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres")
        user.hashed_password = get_password_hash(data.password.strip())

    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/toggle-access", response_model=UserResponse)
def toggle_user_access(
    user_id: int,
    payload: ToggleAccessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if user.id == current_user.id and not payload.is_active:
        raise HTTPException(status_code=400, detail="No puede cancelar el acceso de su propio usuario administrador")

    if not payload.is_active:
        if not payload.temp_password or not payload.temp_password.strip():
            raise HTTPException(
                status_code=403,
                detail="Se requiere una contraseña temporal vigente de 32 dígitos (UUID) para suspender o dar de baja el acceso de un auxiliar."
            )
        validate_and_consume_temp_password(db, payload.temp_password, target_user_id=user_id)

    user.is_active = bool(payload.is_active)
    db.commit()
    db.refresh(user)

    log_activity(
        db=db,
        user=current_user,
        action="ESTATUS_ACCESO",
        module="Usuarios / Auxiliares",
        description=f"{'Reactivó acceso para' if user.is_active else 'Suspendió acceso para'} el usuario @{user.username} ({user.full_name})",
        entity_id=user.id,
        details={"username": user.username, "is_active": user.is_active}
    )

    return user


@router.delete("/{user_id}")
def delete_staff_user(
    user_id: int,
    temp_password: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    if not temp_password or not temp_password.strip():
        raise HTTPException(
            status_code=403,
            detail="Se requiere una contraseña temporal vigente de 32 dígitos (UUID) para dar de baja a un auxiliar."
        )
    validate_and_consume_temp_password(db, temp_password, target_user_id=user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="No puede eliminar su propio usuario administrador")

    u_name = user.username
    u_full = user.full_name or u_name
    db.delete(user)
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="BAJA_USUARIO",
        module="Usuarios / Auxiliares",
        description=f"Dio de baja definitiva al usuario @{u_name} ({u_full})",
        entity_id=user_id,
        details={"username": u_name, "full_name": u_full}
    )

    return {"message": "Usuario eliminado exitosamente"}
