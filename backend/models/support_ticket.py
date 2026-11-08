from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from datetime import datetime
from database import Base


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String(30), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String(100), nullable=False)
    user_full_name = Column(String(150), nullable=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    client_name = Column(String(250), nullable=True)
    category = Column(String(80), nullable=False, default="Falla o Error en Sistema")
    priority = Column(String(30), nullable=False, default="Media")  # Baja, Media, Alta, Urgente
    module_name = Column(String(100), nullable=True)
    subject = Column(String(250), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default="Abierto")  # Abierto, En Proceso, Resuelto, Cerrado
    resolution_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class SupportConfig(Base):
    __tablename__ = "support_config"

    id = Column(Integer, primary_key=True, index=True)
    support_name = Column(String(150), default="Mesa de Ayuda — García Salas Asesores de Negocio")
    whatsapp_number = Column(String(30), default="5215500000000")
    support_email = Column(String(150), default="soporte@garciasalas.mx")
    support_phone = Column(String(50), default="(55) 0000-0000")
    business_hours = Column(String(150), default="Lunes a Viernes de 9:00 a 18:00 hrs")
    remote_tool = Column(String(100), default="AnyDesk / TeamViewer")
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
