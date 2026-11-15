from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta
import uuid
import calendar

from database import get_db, engine, Base, get_effective_owner_id
from models.user import User
from models.client import Client
from models.temp_password import TempPassword
from routers.auth import require_role, get_password_hash
from services.audit import log_activity

# Asegurar que la tabla temp_passwords exista aunque el servidor recargue en caliente
Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/api/temp-passwords", tags=["temp-passwords"])


class TempPasswordCreateRequest(BaseModel):
    purpose: str = "general"  # 'general' | 'baja_cliente' | 'baja_auxiliar' | 'acceso_auxiliar' | 'acceso_cliente'
    duration_value: int = 30
    duration_unit: str = "minutes"  # 'minutes' | 'hours' | 'days' | 'months'
    target_user_id: Optional[int] = None
    target_client_id: Optional[int] = None
    notes: Optional[str] = None
    recipient_email: Optional[str] = None
    recipient_phone: Optional[str] = None
    apply_as_login_password: Optional[bool] = False


class VerifyTempPasswordRequest(BaseModel):
    token: str
    purpose: Optional[str] = None


def _add_months(dt: datetime, months: int) -> datetime:
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def compute_expiration(now: datetime, value: int, unit: str) -> datetime:
    val = max(1, int(value or 1))
    u = (unit or "minutes").strip().lower()
    if u in ("minute", "minutes", "minuto", "minutos"):
        return now + timedelta(minutes=val)
    if u in ("hour", "hours", "hora", "horas"):
        return now + timedelta(hours=val)
    if u in ("day", "days", "dia", "dias", "día", "días"):
        return now + timedelta(days=val)
    if u in ("month", "months", "mes", "meses"):
        return _add_months(now, val)
    return now + timedelta(minutes=val)


def normalize_token_clean(raw: str) -> str:
    if not raw:
        return ""
    return "".join(ch for ch in raw.strip().lower() if ch.isalnum())


def validate_and_consume_temp_password(
    db: Session,
    raw_token: str,
    expected_purpose: Optional[str] = None,
    target_client_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
) -> TempPassword:
    clean = normalize_token_clean(raw_token)
    if len(clean) != 32:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña de autorización debe tener exactamente 32 dígitos (formato UUID)."
        )

    record = (
        db.query(TempPassword)
        .filter(
            (TempPassword.token_clean == clean)
            | (TempPassword.token_uuid == raw_token.strip().lower())
        )
        .first()
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La contraseña de 32 dígitos ingresada no existe o no es válida."
        )

    now = datetime.utcnow()
    if record.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta contraseña de 32 dígitos fue revocada por el Socio/Titular y ya no puede utilizarse."
        )

    if now >= record.expires_at:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta contraseña de 32 dígitos ya venció por tiempo y ya no se permite su uso. Solicite una nueva al Socio/Titular."
        )

    if target_client_id and record.target_client_id and record.target_client_id != target_client_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta contraseña de 32 dígitos fue generada exclusivamente para otro cliente."
        )

    if target_user_id and record.target_user_id and record.target_user_id != target_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta contraseña de 32 dígitos fue generada exclusivamente para otro usuario/auxiliar."
        )

    record.used_count = (record.used_count or 0) + 1
    record.last_used_at = now
    db.commit()
    db.refresh(record)
    return record


def _serialize_temp_password(tp: TempPassword, users_map: dict, clients_map: dict) -> dict:
    now = datetime.utcnow()
    is_expired = now >= tp.expires_at
    if tp.is_revoked:
        status_str = "revoked"
    elif is_expired:
        status_str = "expired"
    else:
        status_str = "active"

    remaining_seconds = max(0, int((tp.expires_at - now).total_seconds())) if status_str == "active" else 0
    target_user = users_map.get(tp.target_user_id) if tp.target_user_id else None
    target_client = clients_map.get(tp.target_client_id) if tp.target_client_id else None

    return {
        "id": tp.id,
        "token_uuid": tp.token_uuid,
        "token_clean": tp.token_clean,
        "purpose": tp.purpose,
        "target_user_id": tp.target_user_id,
        "target_user_name": f"{target_user.full_name or target_user.username} (@{target_user.username})" if target_user else None,
        "target_client_id": tp.target_client_id,
        "target_client_name": f"{target_client.rfc} - {target_client.business_name}" if target_client else None,
        "duration_value": tp.duration_value,
        "duration_unit": tp.duration_unit,
        "notes": tp.notes,
        "recipient_email": tp.recipient_email,
        "recipient_phone": tp.recipient_phone,
        "created_at": tp.created_at.isoformat() + "Z" if tp.created_at else None,
        "expires_at": tp.expires_at.isoformat() + "Z" if tp.expires_at else None,
        "is_revoked": bool(tp.is_revoked),
        "is_expired": is_expired,
        "status": status_str,
        "remaining_seconds": remaining_seconds,
        "used_count": tp.used_count or 0,
        "last_used_at": tp.last_used_at.isoformat() + "Z" if tp.last_used_at else None,
    }


@router.get("")
@router.get("/")
def list_temp_passwords(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    owner_id = get_effective_owner_id(db, current_user)
    items = (
        db.query(TempPassword)
        .filter(TempPassword.created_by_id == owner_id)
        .order_by(TempPassword.id.desc())
        .limit(200)
        .all()
    )
    users = db.query(User).filter((User.id == owner_id) | (User.owner_user_id == owner_id)).all()
    clients = db.query(Client).filter(Client.owner_user_id == owner_id).all()
    users_map = {u.id: u for u in users}
    clients_map = {c.id: c for c in clients}
    return [_serialize_temp_password(tp, users_map, clients_map) for tp in items]


@router.post("")
@router.post("/")
def create_temp_password(
    data: TempPasswordCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if data.duration_value is None or int(data.duration_value) < 1:
        raise HTTPException(status_code=400, detail="La duración debe ser mayor o igual a 1")

    now = datetime.utcnow()
    expires_at = compute_expiration(now, int(data.duration_value), data.duration_unit)

    raw_uuid = str(uuid.uuid4()).lower()
    clean_32 = raw_uuid.replace("-", "")

    target_user = None
    target_client = None
    recipient_email = (data.recipient_email or "").strip() or None
    recipient_phone = (data.recipient_phone or "").strip() or None

    if data.target_user_id:
        target_user = db.query(User).filter(User.id == data.target_user_id).first()
        if target_user:
            if not recipient_email and target_user.email:
                recipient_email = target_user.email
            if not recipient_phone and target_user.phone:
                recipient_phone = target_user.phone

    if data.target_client_id:
        target_client = db.query(Client).filter(Client.id == data.target_client_id).first()
        if target_client:
            if not recipient_email and target_client.email:
                recipient_email = target_client.email
            if not recipient_phone and target_client.phone:
                recipient_phone = target_client.phone

    new_tp = TempPassword(
        token_uuid=raw_uuid,
        token_clean=clean_32,
        purpose=data.purpose or "general",
        target_user_id=data.target_user_id,
        target_client_id=data.target_client_id,
        duration_value=int(data.duration_value),
        duration_unit=data.duration_unit,
        notes=(data.notes or "").strip() or None,
        recipient_email=recipient_email,
        recipient_phone=recipient_phone,
        created_by_id=current_user.id,
        created_at=now,
        expires_at=expires_at,
        is_revoked=False,
        used_count=0,
    )
    db.add(new_tp)

    # Si se indicó aplicar también como contraseña temporal de inicio de sesión del auxiliar o cliente
    if data.apply_as_login_password and target_user and target_user.id != current_user.id:
        target_user.hashed_password = get_password_hash(raw_uuid)
        target_user.is_active = True

    db.commit()
    db.refresh(new_tp)

    users_map = {target_user.id: target_user} if target_user else {}
    clients_map = {target_client.id: target_client} if target_client else {}

    log_activity(
        db=db,
        user=current_user,
        action="GENERAR_CLAVE_TEMPORAL_UUID",
        module="Contraseñas Temporales (UUID)",
        description=f"Generó contraseña de 32 dígitos ({raw_uuid[:8]}...) con vigencia de {data.duration_value} {data.duration_unit}",
        entity_id=new_tp.id,
        client_id=data.target_client_id,
        details={
            "purpose": data.purpose,
            "duration_value": data.duration_value,
            "duration_unit": data.duration_unit,
            "expires_at": expires_at.isoformat() + "Z",
        },
    )

    return _serialize_temp_password(new_tp, users_map, clients_map)


@router.post("/verify")
def verify_temp_password(
    data: VerifyTempPasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant")),
):
    tp = validate_and_consume_temp_password(db, data.token, expected_purpose=data.purpose)
    return {
        "valid": True,
        "token_uuid": tp.token_uuid,
        "purpose": tp.purpose,
        "expires_at": tp.expires_at.isoformat() + "Z",
    }


@router.post("/{tp_id}/revoke")
def revoke_temp_password(
    tp_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    tp = db.query(TempPassword).filter(TempPassword.id == tp_id).first()
    if not tp:
        raise HTTPException(status_code=404, detail="Contraseña temporal no encontrada")

    tp.is_revoked = True
    db.commit()
    db.refresh(tp)

    users = db.query(User).all()
    clients = db.query(Client).all()
    return _serialize_temp_password(tp, {u.id: u for u in users}, {c.id: c for c in clients})


@router.delete("/{tp_id}")
def delete_temp_password(
    tp_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    tp = db.query(TempPassword).filter(TempPassword.id == tp_id).first()
    if not tp:
        raise HTTPException(status_code=404, detail="Contraseña temporal no encontrada")

    db.delete(tp)
    db.commit()
    return {"message": "Registro de contraseña temporal eliminado"}
