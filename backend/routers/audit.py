from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, asc, or_
from typing import Optional, List
from datetime import datetime, timedelta
from pydantic import BaseModel

from database import get_db, ensure_user_columns
from models.audit_log import AuditLog
from models.user import User
from models.client import Client
from routers.auth import require_role
from services.audit import estimate_action_seconds, BASE_ACTION_SECONDS

ensure_user_columns()

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])


class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int]
    username: str
    user_full_name: Optional[str]
    user_role: Optional[str]
    client_id: Optional[int]
    client_name: Optional[str]
    client_rfc: Optional[str]
    action: str
    module: str
    entity_id: Optional[str]
    description: str
    details: Optional[str]
    ip_address: Optional[str]
    duration_seconds: Optional[int] = 120
    created_at: datetime

    class Config:
        from_attributes = True


def _ensure_durations_populated(db: Session):
    """
    Si existen registros históricos sin duration_seconds, calcula y persiste su tiempo invertido
    con base en la secuencia cronológica de cada auxiliar.
    """
    missing = db.query(AuditLog).filter(AuditLog.duration_seconds == None).order_by(asc(AuditLog.created_at)).all()
    if not missing:
        return
    last_dt_by_user = {}
    for row in missing:
        uid = row.user_id or 0
        prev_dt = last_dt_by_user.get(uid)
        row.duration_seconds = estimate_action_seconds(row.action, prev_dt, row.created_at)
        last_dt_by_user[uid] = row.created_at
    try:
        db.commit()
    except Exception:
        db.rollback()


def _apply_common_filters(
    query,
    current_user: User,
    user_id: Optional[int] = None,
    client_id: Optional[int] = None,
    module: Optional[str] = None,
    action: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    if current_user.role == "accountant":
        query = query.filter(AuditLog.user_id == current_user.id)
    elif user_id:
        query = query.filter(AuditLog.user_id == user_id)

    if client_id:
        query = query.filter(AuditLog.client_id == client_id)

    if module and module != "ALL":
        query = query.filter(AuditLog.module == module)

    if action and action != "ALL":
        query = query.filter(AuditLog.action == action)

    if date_from:
        try:
            d_from = datetime.strptime(date_from, "%Y-%m-%d")
            query = query.filter(AuditLog.created_at >= d_from)
        except Exception:
            pass

    if date_to:
        try:
            d_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(AuditLog.created_at < d_to)
        except Exception:
            pass

    if search:
        s = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(AuditLog.description).like(s),
                func.lower(AuditLog.username).like(s),
                func.lower(AuditLog.user_full_name).like(s),
                func.lower(AuditLog.client_name).like(s),
                func.lower(AuditLog.client_rfc).like(s),
                func.lower(AuditLog.module).like(s),
                func.lower(AuditLog.action).like(s),
            )
        )
    return query


@router.get("")
@router.get("/")
def get_audit_logs(
    user_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    module: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    _ensure_durations_populated(db)
    query = _apply_common_filters(
        db.query(AuditLog),
        current_user=current_user,
        user_id=user_id,
        client_id=client_id,
        module=module,
        action=action,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )

    total = query.count()
    offset = (page - 1) * page_size
    items = query.order_by(desc(AuditLog.created_at)).offset(offset).limit(page_size).all()

    return {
        "items": [AuditLogResponse.from_orm(it) for it in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
    }


@router.get("/time-analytics")
def get_time_analytics(
    user_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    module: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Calcula los tiempos invertidos en cada actividad, en cada cliente y por cada auxiliar
    dentro del periodo y filtros seleccionados.
    """
    _ensure_durations_populated(db)
    query = _apply_common_filters(
        db.query(AuditLog),
        current_user=current_user,
        user_id=user_id,
        client_id=client_id,
        module=module,
        action=action,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    rows = query.order_by(asc(AuditLog.created_at)).all()

    total_seconds = 0
    total_activities = len(rows)

    client_agg = {}
    activity_agg = {}
    module_agg = {}
    user_agg = {}

    for r in rows:
        dur = int(r.duration_seconds or BASE_ACTION_SECONDS.get(r.action, 120))
        total_seconds += dur

        # 1. Por Cliente
        cid = r.client_id or 0
        c_key = str(cid)
        if c_key not in client_agg:
            client_agg[c_key] = {
                "client_id": r.client_id,
                "client_name": r.client_name or "Administrativo / General del Despacho",
                "client_rfc": r.client_rfc or "SIN-RFC",
                "activities_count": 0,
                "total_seconds": 0,
                "journals_count": 0,
                "cfdis_count": 0,
                "other_count": 0,
                "users_set": set(),
                "last_activity_at": None,
            }
        ca = client_agg[c_key]
        ca["activities_count"] += 1
        ca["total_seconds"] += dur
        if r.action in ("CREAR_POLIZA", "EDITAR_POLIZA", "ELIMINAR_POLIZA"):
            ca["journals_count"] += 1
        elif r.action in ("CARGA_CFDI", "ELIMINAR_CFDI", "DEPURAR_CFDIS"):
            ca["cfdis_count"] += 1
        else:
            ca["other_count"] += 1
        if r.user_full_name or r.username:
            ca["users_set"].add(r.user_full_name or r.username)
        ca["last_activity_at"] = r.created_at.isoformat() if r.created_at else ca["last_activity_at"]

        # 2. Por Actividad (Acción + Módulo)
        a_key = f"{r.module}::{r.action}"
        if a_key not in activity_agg:
            activity_agg[a_key] = {
                "action": r.action,
                "module": r.module,
                "activities_count": 0,
                "total_seconds": 0,
                "clients_set": set(),
            }
        aa = activity_agg[a_key]
        aa["activities_count"] += 1
        aa["total_seconds"] += dur
        if r.client_name:
            aa["clients_set"].add(r.client_name)

        # 3. Por Módulo
        m_key = r.module or "General"
        if m_key not in module_agg:
            module_agg[m_key] = {
                "module": m_key,
                "activities_count": 0,
                "total_seconds": 0,
            }
        module_agg[m_key]["activities_count"] += 1
        module_agg[m_key]["total_seconds"] += dur

        # 4. Por Usuario / Auxiliar
        u_key = str(r.user_id or r.username)
        if u_key not in user_agg:
            user_agg[u_key] = {
                "user_id": r.user_id,
                "username": r.username,
                "full_name": r.user_full_name or r.username,
                "role": r.user_role,
                "activities_count": 0,
                "total_seconds": 0,
                "clients_set": set(),
            }
        ua = user_agg[u_key]
        ua["activities_count"] += 1
        ua["total_seconds"] += dur
        if r.client_id:
            ua["clients_set"].add(r.client_id)

    by_client = []
    for c in client_agg.values():
        cnt = c["activities_count"]
        secs = c["total_seconds"]
        by_client.append({
            "client_id": c["client_id"],
            "client_name": c["client_name"],
            "client_rfc": c["client_rfc"],
            "activities_count": cnt,
            "total_seconds": secs,
            "avg_seconds": round(secs / cnt) if cnt > 0 else 0,
            "percentage": round((secs / total_seconds) * 100, 1) if total_seconds > 0 else 0,
            "journals_count": c["journals_count"],
            "cfdis_count": c["cfdis_count"],
            "other_count": c["other_count"],
            "users_involved": sorted(list(c["users_set"])),
            "last_activity_at": c["last_activity_at"],
        })
    by_client.sort(key=lambda x: x["total_seconds"], reverse=True)

    by_activity = []
    for a in activity_agg.values():
        cnt = a["activities_count"]
        secs = a["total_seconds"]
        by_activity.append({
            "action": a["action"],
            "module": a["module"],
            "activities_count": cnt,
            "total_seconds": secs,
            "avg_seconds": round(secs / cnt) if cnt > 0 else 0,
            "percentage": round((secs / total_seconds) * 100, 1) if total_seconds > 0 else 0,
            "clients_count": len(a["clients_set"]),
        })
    by_activity.sort(key=lambda x: x["total_seconds"], reverse=True)

    by_module = []
    for m in module_agg.values():
        cnt = m["activities_count"]
        secs = m["total_seconds"]
        by_module.append({
            "module": m["module"],
            "activities_count": cnt,
            "total_seconds": secs,
            "avg_seconds": round(secs / cnt) if cnt > 0 else 0,
            "percentage": round((secs / total_seconds) * 100, 1) if total_seconds > 0 else 0,
        })
    by_module.sort(key=lambda x: x["total_seconds"], reverse=True)

    by_user = []
    for u in user_agg.values():
        cnt = u["activities_count"]
        secs = u["total_seconds"]
        by_user.append({
            "user_id": u["user_id"],
            "username": u["username"],
            "full_name": u["full_name"],
            "role": u["role"],
            "activities_count": cnt,
            "total_seconds": secs,
            "avg_seconds": round(secs / cnt) if cnt > 0 else 0,
            "percentage": round((secs / total_seconds) * 100, 1) if total_seconds > 0 else 0,
            "clients_count": len(u["clients_set"]),
        })
    by_user.sort(key=lambda x: x["total_seconds"], reverse=True)

    return {
        "total_seconds": total_seconds,
        "total_activities": total_activities,
        "avg_seconds_per_activity": round(total_seconds / total_activities) if total_activities > 0 else 0,
        "by_client": by_client,
        "by_activity": by_activity,
        "by_module": by_module,
        "by_user": by_user,
    }


@router.delete("/by-period")
def delete_audit_logs_by_period(
    date_from: Optional[str] = Query(None, description="Fecha inicial YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="Fecha final YYYY-MM-DD"),
    user_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    module: Optional[str] = Query(None),
    delete_all: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Elimina permanentemente las actividades registradas en el periodo indicado.
    Exclusivo para el Socio / Titular (admin).
    """
    if not delete_all and not date_from and not date_to:
        raise HTTPException(
            status_code=400,
            detail="Seleccione el rango de fechas del periodo a borrar o confirme borrar todo el historial."
        )

    query = db.query(AuditLog)

    if date_from:
        try:
            d_from = datetime.strptime(date_from, "%Y-%m-%d")
            query = query.filter(AuditLog.created_at >= d_from)
        except Exception:
            raise HTTPException(status_code=400, detail="Formato de fecha inicial inválido (use YYYY-MM-DD)")

    if date_to:
        try:
            d_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(AuditLog.created_at < d_to)
        except Exception:
            raise HTTPException(status_code=400, detail="Formato de fecha final inválido (use YYYY-MM-DD)")

    if user_id:
        query = query.filter(AuditLog.user_id == user_id)

    if client_id:
        query = query.filter(AuditLog.client_id == client_id)

    if module and module != "ALL":
        query = query.filter(AuditLog.module == module)

    deleted_count = query.delete(synchronize_session=False)
    db.commit()

    return {
        "deleted_count": deleted_count,
        "message": f"Se eliminaron permanentemente {deleted_count} actividades del periodo seleccionado.",
    }


@router.delete("/{log_id}")
def delete_single_audit_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Elimina un registro individual de la bitácora. Exclusivo para el Socio / Titular (admin).
    """
    item = db.query(AuditLog).filter(AuditLog.id == log_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Registro de actividad no encontrado")
    db.delete(item)
    db.commit()
    return {"message": "Actividad eliminada permanentemente"}


@router.get("/stats")
def get_audit_stats(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    _ensure_durations_populated(db)
    now = datetime.utcnow()
    since_date = now - timedelta(days=days)
    today_start = datetime(now.year, now.month, now.day)

    total_all = db.query(func.count(AuditLog.id)).scalar() or 0
    total_period = db.query(func.count(AuditLog.id)).filter(AuditLog.created_at >= since_date).scalar() or 0
    total_today = db.query(func.count(AuditLog.id)).filter(AuditLog.created_at >= today_start).scalar() or 0

    users_db = db.query(User).filter(User.role.in_(["admin", "accountant"])).all()
    user_stats = []

    for u in users_db:
        u_logs = db.query(AuditLog).filter(AuditLog.user_id == u.id)
        u_period_logs = u_logs.filter(AuditLog.created_at >= since_date)

        total_actions = u_period_logs.count()
        total_seconds = (
            db.query(func.sum(AuditLog.duration_seconds))
            .filter(AuditLog.user_id == u.id, AuditLog.created_at >= since_date)
            .scalar()
            or 0
        )
        journals_created = u_period_logs.filter(AuditLog.action == "CREAR_POLIZA").count()
        journals_edited = u_period_logs.filter(AuditLog.action == "EDITAR_POLIZA").count()
        journals_deleted = u_period_logs.filter(AuditLog.action == "ELIMINAR_POLIZA").count()
        cfdis_uploaded = u_period_logs.filter(AuditLog.action == "CARGA_CFDI").count()
        period_closes = u_period_logs.filter(AuditLog.action.in_(["CIERRE_EJERCICIO", "REVERTIR_CIERRE"])).count()
        backups = u_period_logs.filter(AuditLog.action.in_(["DESCARGAR_RESPALDO", "RESTAURAR_RESPALDO"])).count()

        last_activity = u_logs.order_by(desc(AuditLog.created_at)).first()

        user_stats.append({
            "user_id": u.id,
            "username": u.username,
            "full_name": u.full_name or u.username,
            "position": u.position or ("Administrador Titular" if u.role == "admin" else "Auxiliar Contable"),
            "role": u.role,
            "is_active": u.is_active,
            "photo_url": u.photo_url,
            "total_actions": total_actions,
            "total_seconds": int(total_seconds),
            "journals_created": journals_created,
            "journals_edited": journals_edited,
            "journals_deleted": journals_deleted,
            "cfdis_uploaded": cfdis_uploaded,
            "period_closes": period_closes,
            "backups": backups,
            "last_activity_at": last_activity.created_at.isoformat() if last_activity else None,
            "last_activity_desc": last_activity.description if last_activity else "Sin actividad registrada",
        })

    user_stats.sort(key=lambda x: x["total_actions"], reverse=True)

    module_counts_query = (
        db.query(AuditLog.module, func.count(AuditLog.id))
        .filter(AuditLog.created_at >= since_date)
        .group_by(AuditLog.module)
        .order_by(desc(func.count(AuditLog.id)))
        .all()
    )
    module_stats = [{"module": m, "count": c} for m, c in module_counts_query]

    recent_query = db.query(AuditLog).order_by(desc(AuditLog.created_at)).limit(15).all()
    recent_logs = [AuditLogResponse.from_orm(it) for it in recent_query]

    return {
        "days": days,
        "total_all": total_all,
        "total_period": total_period,
        "total_today": total_today,
        "user_stats": user_stats,
        "module_stats": module_stats,
        "recent_logs": recent_logs,
    }
