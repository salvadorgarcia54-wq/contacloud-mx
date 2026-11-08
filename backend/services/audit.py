from typing import Optional, Any
from sqlalchemy.orm import Session
import json
from datetime import datetime
from models.audit_log import AuditLog
from models.user import User
from models.client import Client

BASE_ACTION_SECONDS = {
    "CREAR_POLIZA": 180,
    "EDITAR_POLIZA": 120,
    "ELIMINAR_POLIZA": 45,
    "CIERRE_EJERCICIO": 300,
    "REVERTIR_CIERRE": 90,
    "CARGA_CFDI": 95,
    "ELIMINAR_CFDI": 35,
    "DEPURAR_CFDIS": 60,
    "CREAR_CLIENTE": 150,
    "BAJA_CLIENTE": 60,
    "DESCARGAR_RESPALDO": 60,
    "RESTAURAR_RESPALDO": 120,
    "CREAR_USUARIO": 120,
    "ESTATUS_ACCESO": 45,
    "BAJA_USUARIO": 60,
    "TRASPASO_IVA": 150,
    "DEPRECIACION_ACTIVOS": 150,
    "GENERAR_CLAVE_TEMPORAL_UUID": 60,
}


def estimate_action_seconds(action: str, prev_dt: Optional[datetime], curr_dt: datetime) -> int:
    base = BASE_ACTION_SECONDS.get(action, 120)
    if prev_dt and curr_dt > prev_dt:
        diff = int((curr_dt - prev_dt).total_seconds())
        # Si está dentro de la misma sesión de trabajo (entre 15 seg y 45 min)
        if 15 <= diff <= 2700:
            return min(diff, 1800)
        # Si fue una operación en lote en el mismo segundo/minuto (< 15 seg), asignar fracción o base corta
        if 0 < diff < 15:
            return max(20, min(base // 2, 60))
    return base


def log_activity(
    db: Session,
    user: Optional[User],
    action: str,
    module: str,
    description: str,
    client_id: Optional[int] = None,
    client_name: Optional[str] = None,
    client_rfc: Optional[str] = None,
    entity_id: Optional[Any] = None,
    details: Optional[Any] = None,
    ip_address: Optional[str] = None,
    duration_seconds: Optional[int] = None,
    commit: bool = True
) -> Optional[AuditLog]:
    try:
        username = user.username if user else "sistema"
        user_full_name = user.full_name if user else "Sistema Automatizado"
        user_role = user.role if user else "system"
        user_id = user.id if user else None

        if client_id and (not client_name or not client_rfc):
            try:
                cl = db.query(Client).filter(Client.id == client_id).first()
                if cl:
                    client_name = client_name or cl.business_name
                    client_rfc = client_rfc or cl.rfc
            except Exception:
                pass

        details_str = None
        if details is not None:
            if isinstance(details, (dict, list)):
                try:
                    details_str = json.dumps(details, ensure_ascii=False)
                except Exception:
                    details_str = str(details)
            else:
                details_str = str(details)

        now = datetime.utcnow()
        computed_duration = duration_seconds
        if computed_duration is None:
            prev_log = None
            if user_id:
                prev_log = (
                    db.query(AuditLog)
                    .filter(AuditLog.user_id == user_id)
                    .order_by(AuditLog.created_at.desc())
                    .first()
                )
            computed_duration = estimate_action_seconds(
                action, prev_log.created_at if prev_log else None, now
            )

        log_entry = AuditLog(
            user_id=user_id,
            username=username,
            user_full_name=user_full_name,
            user_role=user_role,
            client_id=client_id,
            client_name=client_name,
            client_rfc=client_rfc,
            action=action,
            module=module,
            entity_id=str(entity_id) if entity_id is not None else None,
            description=description,
            details=details_str,
            ip_address=ip_address,
            duration_seconds=computed_duration,
            created_at=now
        )
        db.add(log_entry)
        if commit:
            db.commit()
        return log_entry
    except Exception as e:
        print(f"Error logging activity: {e}")
        return None
