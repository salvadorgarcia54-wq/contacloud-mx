from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint
from datetime import datetime
from database import Base


class SATBlacklist(Base):
    __tablename__ = "sat_blacklist"

    id = Column(Integer, primary_key=True, autoincrement=True)
    rfc = Column(String(15), nullable=False, index=True)
    taxpayer_name = Column(String(350), nullable=False)

    # '69-B' (EFOS / Operaciones Inexistentes) o '49-B' (Art. 49 Bis CFF - Comprobantes Falsos / Visita Exprés)
    list_type = Column(String(20), nullable=False, default="69-B", index=True)

    # Situación:
    # 69-B: 'Definitivo', 'Presunto', 'Desvirtuado', 'Sentencia Favorable'
    # 49-B: 'Definitivo 49-B (CFDI Falso)', 'En Procedimiento 49-B', 'Suspensión CSD (17-H Bis)', 'Aclarado'
    situation = Column(String(80), nullable=False, default="Definitivo", index=True)

    oficio_presuncion = Column(String(180), nullable=True)
    fecha_sat_presuncion = Column(String(40), nullable=True)
    fecha_dof_presuncion = Column(String(40), nullable=True)

    oficio_definitivo = Column(String(180), nullable=True)
    fecha_sat_definitivo = Column(String(40), nullable=True)
    fecha_dof_definitivo = Column(String(40), nullable=True)

    motivo_fiscal = Column(Text, nullable=True)
    source = Column(String(50), nullable=False, default="SAT_OFICIAL")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("rfc", "list_type", name="uix_sat_blacklist_rfc_type"),
    )
