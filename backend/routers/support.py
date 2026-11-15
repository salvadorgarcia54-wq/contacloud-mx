from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime

from database import get_db, engine, Base, get_effective_owner_id
from models.user import User
from models.client import Client
from models.support_ticket import SupportTicket, SupportConfig
from routers.auth import get_current_user, require_role
from services.audit import log_activity

# Garantizar creación de tablas en caliente (hot-reload)
Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/api/support", tags=["support"])


class SupportTicketCreate(BaseModel):
    category: str
    priority: str = "Media"
    module_name: Optional[str] = None
    client_id: Optional[int] = None
    subject: str
    description: str


class SupportTicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    resolution_notes: Optional[str] = None


class SupportConfigUpdate(BaseModel):
    support_name: str
    whatsapp_number: str
    support_email: str
    support_phone: str
    business_hours: str
    remote_tool: str


def _get_or_create_config(db: Session) -> SupportConfig:
    cfg = db.query(SupportConfig).first()
    if not cfg:
        cfg = SupportConfig(
            support_name="Mesa de Ayuda — Iterumx",
            whatsapp_number="5215500000000",
            support_email="soporte@iterumx.com",
            support_phone="(55) 0000-0000",
            business_hours="Lunes a Viernes de 9:00 a 18:00 hrs",
            remote_tool="AnyDesk / TeamViewer",
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _ticket_to_dict(t: SupportTicket) -> dict:
    return {
        "id": t.id,
        "folio": t.folio,
        "user_id": t.user_id,
        "username": t.username,
        "user_full_name": t.user_full_name or t.username,
        "client_id": t.client_id,
        "client_name": t.client_name,
        "category": t.category,
        "priority": t.priority,
        "module_name": t.module_name,
        "subject": t.subject,
        "description": t.description,
        "status": t.status,
        "resolution_notes": t.resolution_notes or "",
        "created_at": t.created_at.strftime("%Y-%m-%d %H:%M") if t.created_at else "",
        "updated_at": t.updated_at.strftime("%Y-%m-%d %H:%M") if t.updated_at else "",
    }


@router.get("/info")
def get_support_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cfg = _get_or_create_config(db)
    is_super_admin = (current_user.username or "").strip().lower() == "admin"
    owner_id = get_effective_owner_id(db, current_user)
    if is_super_admin:
        total_clients = db.query(func.count(Client.id)).filter(Client.is_active == True).scalar() or 0
        open_tickets = (
            db.query(func.count(SupportTicket.id))
            .filter(SupportTicket.status.in_(["Abierto", "En Proceso"]))
            .scalar()
            or 0
        )
    else:
        total_clients = (
            db.query(func.count(Client.id))
            .filter(Client.is_active == True, Client.owner_user_id == owner_id)
            .scalar()
            or 0
        )
        tenant_uids = [
            uid for (uid,) in db.query(User.id).filter((User.id == owner_id) | (User.owner_user_id == owner_id)).all()
        ]
        open_tickets = (
            db.query(func.count(SupportTicket.id))
            .filter(
                SupportTicket.user_id.in_(tenant_uids or [current_user.id]),
                SupportTicket.status.in_(["Abierto", "En Proceso"]),
            )
            .scalar()
            or 0
        )

    return {
        "config": {
            "support_name": cfg.support_name,
            "whatsapp_number": cfg.whatsapp_number,
            "support_email": cfg.support_email,
            "support_phone": cfg.support_phone,
            "business_hours": cfg.business_hours,
            "remote_tool": cfg.remote_tool,
        },
        "diagnostics": {
            "api_status": "Operativo (Iterumx Cloud)",
            "db_status": "Conectada (Multi-Empresa)",
            "app_version": "Iterumx v2.0",
            "total_clients": total_clients,
            "open_tickets": open_tickets,
            "server_time": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        },
    }


@router.put("/config")
def update_support_config(
    data: SupportConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    cfg = _get_or_create_config(db)
    cfg.support_name = data.support_name.strip()
    cfg.whatsapp_number = data.whatsapp_number.strip()
    cfg.support_email = data.support_email.strip()
    cfg.support_phone = data.support_phone.strip()
    cfg.business_hours = data.business_hours.strip()
    cfg.remote_tool = data.remote_tool.strip()
    db.commit()
    db.refresh(cfg)

    log_activity(
        db=db,
        user=current_user,
        action="ACTUALIZAR_CONFIG_SOPORTE",
        module="Soporte Técnico",
        description="Actualizó los datos de contacto de Soporte Técnico",
    )

    return {
        "success": True,
        "message": "Datos de contacto de Soporte Técnico actualizados correctamente.",
        "config": {
            "support_name": cfg.support_name,
            "whatsapp_number": cfg.whatsapp_number,
            "support_email": cfg.support_email,
            "support_phone": cfg.support_phone,
            "business_hours": cfg.business_hours,
            "remote_tool": cfg.remote_tool,
        },
    }


@router.get("/tickets")
def list_support_tickets(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(SupportTicket)
    is_super_admin = (current_user.username or "").strip().lower() == "admin"
    if current_user.role == "client":
        query = query.filter(SupportTicket.user_id == current_user.id)
    elif not is_super_admin:
        owner_id = get_effective_owner_id(db, current_user)
        tenant_uids = [
            uid for (uid,) in db.query(User.id).filter((User.id == owner_id) | (User.owner_user_id == owner_id)).all()
        ]
        query = query.filter(SupportTicket.user_id.in_(tenant_uids or [current_user.id]))
    if status and status != "all":
        query = query.filter(SupportTicket.status == status)

    tickets = query.order_by(SupportTicket.id.desc()).all()
    return [_ticket_to_dict(t) for t in tickets]


@router.post("/tickets")
def create_support_ticket(
    req: SupportTicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not req.subject.strip() or not req.description.strip():
        raise HTTPException(status_code=400, detail="El asunto y la descripción son obligatorios.")

    client_label = None
    if req.client_id:
        c = db.query(Client).filter(Client.id == req.client_id).first()
        if c:
            client_label = f"{c.rfc} - {c.business_name}"

    max_id = db.query(func.max(SupportTicket.id)).scalar() or 0
    folio = f"SOP-{datetime.now().strftime('%Y%m')}-{max_id + 1:04d}"

    ticket = SupportTicket(
        folio=folio,
        user_id=current_user.id,
        username=current_user.username,
        user_full_name=current_user.full_name or current_user.username,
        client_id=req.client_id,
        client_name=client_label,
        category=req.category,
        priority=req.priority,
        module_name=req.module_name or "General",
        subject=req.subject.strip(),
        description=req.description.strip(),
        status="Abierto",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    log_activity(
        db=db,
        user=current_user,
        action="CREAR_TICKET_SOPORTE",
        module="Soporte Técnico",
        description=f"Generó ticket de soporte {folio}: {ticket.subject}",
        client_id=req.client_id,
        entity_id=ticket.id,
    )

    return _ticket_to_dict(ticket)


@router.put("/tickets/{ticket_id}")
def update_support_ticket(
    ticket_id: int,
    req: SupportTicketUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant")),
):
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket de soporte no encontrado.")

    if req.status is not None:
        ticket.status = req.status
    if req.priority is not None:
        ticket.priority = req.priority
    if req.resolution_notes is not None:
        ticket.resolution_notes = req.resolution_notes

    ticket.updated_at = datetime.now()
    db.commit()
    db.refresh(ticket)

    log_activity(
        db=db,
        user=current_user,
        action="ACTUALIZAR_TICKET_SOPORTE",
        module="Soporte Técnico",
        description=f"Actualizó ticket {ticket.folio} a estado '{ticket.status}'",
        client_id=ticket.client_id,
        entity_id=ticket.id,
    )

    return _ticket_to_dict(ticket)


@router.delete("/tickets/{ticket_id}")
def delete_support_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket de soporte no encontrado.")

    folio = ticket.folio
    db.delete(ticket)
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="ELIMINAR_TICKET_SOPORTE",
        module="Soporte Técnico",
        description=f"Eliminó el ticket de soporte {folio}",
    )

    return {"success": True, "message": f"Ticket {folio} eliminado correctamente."}
