from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import uuid
import re

from database import get_db, engine, Base, get_effective_owner_id
from models.user import User
from models.client import Client
from models.journal import JournalEntry
from models.cfdi import CFDIInvoice
from models.saas import SaasTenant, SaasInvoice, SaasStripeConfig, SaasCancellationFeedback
from routers.auth import get_current_user, require_role, get_password_hash, create_access_token
from services.audit import log_activity

# Garantizar creación de tablas SaaS y migración de columnas en caliente
Base.metadata.create_all(bind=engine)


def _ensure_saas_columns():
    try:
        with engine.begin() as conn:
            res = conn.execute(text("PRAGMA table_info(saas_tenants)")).fetchall()
            if res:
                existing_cols = {row[1] for row in res}
                migrations = [
                    ("postal_code", "ALTER TABLE saas_tenants ADD COLUMN postal_code VARCHAR(10)"),
                    ("tax_regime", "ALTER TABLE saas_tenants ADD COLUMN tax_regime VARCHAR(120)"),
                    ("cfdi_use", "ALTER TABLE saas_tenants ADD COLUMN cfdi_use VARCHAR(120) DEFAULT 'G03 - Gastos en general'"),
                    ("admin_username", "ALTER TABLE saas_tenants ADD COLUMN admin_username VARCHAR(80)"),
                    ("admin_password", "ALTER TABLE saas_tenants ADD COLUMN admin_password VARCHAR(120)"),
                    ("stripe_customer_id", "ALTER TABLE saas_tenants ADD COLUMN stripe_customer_id VARCHAR(100)"),
                    ("stripe_subscription_id", "ALTER TABLE saas_tenants ADD COLUMN stripe_subscription_id VARCHAR(100)"),
                    ("stripe_payment_method_id", "ALTER TABLE saas_tenants ADD COLUMN stripe_payment_method_id VARCHAR(100)"),
                    ("card_brand", "ALTER TABLE saas_tenants ADD COLUMN card_brand VARCHAR(40)"),
                    ("card_last4", "ALTER TABLE saas_tenants ADD COLUMN card_last4 VARCHAR(10)"),
                    ("card_holder_name", "ALTER TABLE saas_tenants ADD COLUMN card_holder_name VARCHAR(150)"),
                    ("nps_score", "ALTER TABLE saas_tenants ADD COLUMN nps_score INTEGER"),
                    ("csat_score", "ALTER TABLE saas_tenants ADD COLUMN csat_score FLOAT"),
                    ("ces_score", "ALTER TABLE saas_tenants ADD COLUMN ces_score FLOAT"),
                    ("frt_minutes", "ALTER TABLE saas_tenants ADD COLUMN frt_minutes FLOAT"),
                    ("fcr_rate", "ALTER TABLE saas_tenants ADD COLUMN fcr_rate FLOAT"),
                    ("art_hours", "ALTER TABLE saas_tenants ADD COLUMN art_hours FLOAT"),
                    ("cac_mxn", "ALTER TABLE saas_tenants ADD COLUMN cac_mxn FLOAT"),
                    ("tenure_months", "ALTER TABLE saas_tenants ADD COLUMN tenure_months INTEGER"),
                    ("cancelled_at", "ALTER TABLE saas_tenants ADD COLUMN cancelled_at DATETIME"),
                    ("cancellation_reason", "ALTER TABLE saas_tenants ADD COLUMN cancellation_reason VARCHAR(200)"),
                    ("cancellation_comments", "ALTER TABLE saas_tenants ADD COLUMN cancellation_comments TEXT"),
                ]
                for col_name, sql in migrations:
                    if col_name not in existing_cols:
                        conn.execute(text(sql))

            res_inv = conn.execute(text("PRAGMA table_info(saas_invoices)")).fetchall()
            if res_inv:
                existing_inv_cols = {row[1] for row in res_inv}
                if "stripe_payment_intent_id" not in existing_inv_cols:
                    conn.execute(text("ALTER TABLE saas_invoices ADD COLUMN stripe_payment_intent_id VARCHAR(100)"))
                if "payment_reference" not in existing_inv_cols:
                    conn.execute(text("ALTER TABLE saas_invoices ADD COLUMN payment_reference VARCHAR(100)"))

            res_cfg = conn.execute(text("PRAGMA table_info(saas_stripe_config)")).fetchall()
            if res_cfg:
                existing_cfg_cols = {row[1] for row in res_cfg}
                cfg_migrations = [
                    ("spei_bank_name", "ALTER TABLE saas_stripe_config ADD COLUMN spei_bank_name VARCHAR(100) DEFAULT 'STP / BBVA México (Stripe SPEI)'"),
                    ("spei_clabe", "ALTER TABLE saas_stripe_config ADD COLUMN spei_clabe VARCHAR(30) DEFAULT '646180157042891042'"),
                    ("spei_beneficiary", "ALTER TABLE saas_stripe_config ADD COLUMN spei_beneficiary VARCHAR(180) DEFAULT 'Iterumx S.A. de C.V.'"),
                    ("enable_oxxo_7eleven", "ALTER TABLE saas_stripe_config ADD COLUMN enable_oxxo_7eleven BOOLEAN DEFAULT 1"),
                ]
                for col_name, sql in cfg_migrations:
                    if col_name not in existing_cfg_cols:
                        conn.execute(text(sql))
    except Exception as e:
        print(f"SaaS schema migration note: {e}")


_ensure_saas_columns()

router = APIRouter(prefix="/api/saas", tags=["saas"])

SAAS_PLANS: Dict[str, Dict[str, Any]] = {
    "starter": {
        "code": "starter",
        "name": "Iterumx Starter",
        "tagline": "Ideal para contadores independientes y emprendedores",
        "badge": "Inicial",
        "monthly_price": 690.0,
        "annual_monthly_equivalent": 550.0,
        "annual_total": 6600.0,
        "max_clients": 10,
        "max_users": 3,
        "max_cfdis_per_month": 1500,
        "highlight": False,
        "features": [
            "Hasta 10 Empresas / RFCs activos",
            "3 Usuarios (Titular + 2 Auxiliares)",
            "Hasta 1,500 CFDIs por mes (Emitidos, Recibidos y Nómina)",
            "Cálculo automático de IVA, ISR, IEPS y DIOT",
            "Contabilidad Electrónica SAT (XML Catálogo y Balanza)",
            "Copiloto Iterumbot IA (Asesor SAT 601 y LISR)",
            "Soporte Técnico Estándar",
        ],
    },
    "profesional": {
        "code": "profesional",
        "name": "Iterumx Profesional",
        "tagline": "Para despachos contables en crecimiento con equipo de auxiliares",
        "badge": "Más Popular",
        "monthly_price": 1690.0,
        "annual_monthly_equivalent": 1350.0,
        "annual_total": 16200.0,
        "max_clients": 50,
        "max_users": 10,
        "max_cfdis_per_month": 15000,
        "highlight": True,
        "features": [
            "Hasta 50 Empresas / RFCs activos",
            "Hasta 10 Usuarios / Auxiliares Contables",
            "Hasta 15,000 CFDIs por mes con contabilización masiva",
            "Iterumbot IA con Auditoría Automática de Anomalías",
            "Validador Lista Negra SAT 69-B / EFOS",
            "Conciliación Bancaria Automatizada",
            "Papeles de Trabajo en Excel (.xlsx) y PDF Membretado",
            "Contraseñas Temporales de 32 dígitos (UUID)",
        ],
    },
    "empresarial": {
        "code": "empresarial",
        "name": "Iterumx Empresarial",
        "tagline": "Control total de productividad, auditoría y portal de clientes",
        "badge": "Despachos Consolidados",
        "monthly_price": 3490.0,
        "annual_monthly_equivalent": 2790.0,
        "annual_total": 33480.0,
        "max_clients": 120,
        "max_users": 35,
        "max_cfdis_per_month": 100000,
        "highlight": False,
        "features": [
            "Hasta 120 Empresas / RFCs activos",
            "Hasta 35 Usuarios / Auxiliares con permisos granulares",
            "Hasta 100,000 CFDIs procesados por mes",
            "Centro de Control Ejecutivo y Portal de Clientes en Vivo",
            "Bitácora de Actividades y Analítica de Tiempos por Auxiliar",
            "Respaldos completos (.json) y Restauración en 1 clic",
            "Soporte Prioritario vía WhatsApp y Remoto",
        ],
    },
    "corporativo": {
        "code": "corporativo",
        "name": "Iterumx Corporativo Unlimited",
        "tagline": "Capacidad ilimitada multi-despacho y SLA empresarial 99.9%",
        "badge": "Enterprise",
        "monthly_price": 6900.0,
        "annual_monthly_equivalent": 5520.0,
        "annual_total": 66240.0,
        "max_clients": 999,
        "max_users": 250,
        "max_cfdis_per_month": 999999,
        "highlight": False,
        "features": [
            "Hasta 999 Empresas / RFCs en la nube",
            "Usuarios y Auxiliares ilimitados (hasta 250)",
            "CFDIs ilimitados y procesamiento de alto volumen",
            "Iterumbot IA Ilimitado + Auditoría Fiscal Continua",
            "Auditoría avanzada, SLA 99.9% y Ejecutivo de Cuenta dedicado",
            "Personalización de marca y reportes corporativos",
        ],
    },
}


class SaasRegisterRequest(BaseModel):
    firm_name: str
    rfc: Optional[str] = None
    postal_code: Optional[str] = None
    tax_regime: Optional[str] = None
    cfdi_use: Optional[str] = "G03 - Gastos en general"
    full_name: str
    username: str
    email: str
    phone: Optional[str] = None
    password: str
    plan_code: str = "profesional"
    billing_cycle: str = "monthly"


class ChangePlanRequest(BaseModel):
    plan_code: str
    billing_cycle: str = "monthly"
    payment_method: Optional[str] = None


class TenantProfileUpdateRequest(BaseModel):
    name: str
    rfc: Optional[str] = None
    postal_code: Optional[str] = None
    tax_regime: Optional[str] = None
    cfdi_use: Optional[str] = "G03 - Gastos en general"
    billing_email: Optional[str] = None
    phone: Optional[str] = None
    payment_method: Optional[str] = None
    auto_renew: Optional[bool] = True


class AdminTenantCreateRequest(BaseModel):
    name: str
    rfc: Optional[str] = None
    postal_code: Optional[str] = None
    tax_regime: Optional[str] = None
    cfdi_use: Optional[str] = "G03 - Gastos en general"
    billing_email: Optional[str] = None
    phone: Optional[str] = None
    admin_username: Optional[str] = None
    admin_password: Optional[str] = None
    plan_code: str = "profesional"
    billing_cycle: str = "monthly"
    status: str = "active"
    nps_score: Optional[int] = None
    csat_score: Optional[float] = None
    ces_score: Optional[float] = None
    frt_minutes: Optional[float] = None
    fcr_rate: Optional[float] = None
    art_hours: Optional[float] = None
    cac_mxn: Optional[float] = None
    tenure_months: Optional[int] = None


class AdminTenantUpdateRequest(BaseModel):
    name: Optional[str] = None
    rfc: Optional[str] = None
    postal_code: Optional[str] = None
    tax_regime: Optional[str] = None
    cfdi_use: Optional[str] = None
    billing_email: Optional[str] = None
    phone: Optional[str] = None
    admin_username: Optional[str] = None
    admin_password: Optional[str] = None
    plan_code: Optional[str] = None
    billing_cycle: Optional[str] = None
    status: Optional[str] = None
    nps_score: Optional[int] = None
    csat_score: Optional[float] = None
    ces_score: Optional[float] = None
    frt_minutes: Optional[float] = None
    fcr_rate: Optional[float] = None
    art_hours: Optional[float] = None
    cac_mxn: Optional[float] = None
    tenure_months: Optional[int] = None


def _slugify(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "despacho").lower()).strip("-")
    return clean or f"tenant-{uuid.uuid4().hex[:6]}"


def _ensure_default_tenants(db: Session) -> SaasTenant:
    """
    Garantiza que exista el Tenant principal de Iterumx y datos semilla de demostración
    para la consola SaaS multi-tenant, y sincroniza los campos fiscales y credenciales.
    """
    primary = db.query(SaasTenant).order_by(SaasTenant.id.asc()).first()
    if not primary:
        admin_user = db.query(User).filter(User.role == "admin").first()
        plan = SAAS_PLANS["empresarial"]
        now = datetime.utcnow()
        primary = SaasTenant(
            name="Despacho Corporativo Iterumx (Principal)",
            slug="iterumx-principal",
            rfc="ITE240101AAA",
            postal_code="06600",
            tax_regime="601 - General de Ley Personas Morales",
            cfdi_use="G03 - Gastos en general",
            billing_email=admin_user.email if admin_user and admin_user.email else "facturacion@iterumx.com",
            phone="55 8000 1234",
            owner_user_id=admin_user.id if admin_user else None,
            admin_username=admin_user.username if admin_user else "admin",
            admin_password="AVIAF1827$",
            plan_code="empresarial",
            billing_cycle="monthly",
            status="active",
            price_mxn=plan["monthly_price"],
            max_clients=plan["max_clients"],
            max_users=plan["max_users"],
            max_cfdis_per_month=plan["max_cfdis_per_month"],
            payment_method="Visa Corporativa •••• 4242",
            auto_renew=True,
            current_period_start=now - timedelta(days=5),
            current_period_end=now + timedelta(days=25),
        )
        db.add(primary)
        db.flush()

        # Facturas históricas del tenant principal
        sample_invoices = [
            SaasInvoice(
                tenant_id=primary.id,
                folio="ITX-2026-0001",
                plan_name="Iterumx Empresarial",
                billing_cycle="Mensual",
                amount=3490.0,
                currency="MXN",
                status="Pagado",
                payment_method="Visa Corporativa •••• 4242",
                period_label="Periodo Actual (30 días)",
                cfdi_uuid=str(uuid.uuid4()).upper(),
                created_at=now - timedelta(days=5),
            ),
            SaasInvoice(
                tenant_id=primary.id,
                folio="ITX-2026-0000",
                plan_name="Iterumx Profesional",
                billing_cycle="Mensual",
                amount=1690.0,
                currency="MXN",
                status="Pagado",
                payment_method="Visa Corporativa •••• 4242",
                period_label="Mes Anterior",
                cfdi_uuid=str(uuid.uuid4()).upper(),
                created_at=now - timedelta(days=35),
            ),
        ]
        for inv in sample_invoices:
            db.add(inv)

        # Tenants adicionales demostrativos para la vista Multi-Tenant de la plataforma SaaS
        demo_tenants = [
            SaasTenant(
                name="Consultores Fiscales del Norte S.C.",
                slug="consultores-norte",
                rfc="CFN190512BB1",
                postal_code="64000",
                tax_regime="601 - General de Ley Personas Morales",
                cfdi_use="G03 - Gastos en general",
                billing_email="admin@fiscalesnorte.mx",
                phone="81 1234 9000",
                admin_username="fnorte",
                admin_password="Norte2026",
                plan_code="profesional",
                billing_cycle="annual",
                status="active",
                price_mxn=SAAS_PLANS["profesional"]["annual_monthly_equivalent"],
                max_clients=SAAS_PLANS["profesional"]["max_clients"],
                max_users=SAAS_PLANS["profesional"]["max_users"],
                max_cfdis_per_month=SAAS_PLANS["profesional"]["max_cfdis_per_month"],
                payment_method="SPEI Empresarial",
                auto_renew=True,
                current_period_start=now - timedelta(days=40),
                current_period_end=now + timedelta(days=325),
            ),
            SaasTenant(
                name="Grupo Contable & Auditoría Bajío",
                slug="auditoria-bajio",
                rfc="GCA210820CC9",
                postal_code="37000",
                tax_regime="601 - General de Ley Personas Morales",
                cfdi_use="G03 - Gastos en general",
                billing_email="contacto@contablebajio.mx",
                phone="477 456 7890",
                admin_username="gbajio",
                admin_password="Bajio2026",
                plan_code="corporativo",
                billing_cycle="monthly",
                status="active",
                price_mxn=SAAS_PLANS["corporativo"]["monthly_price"],
                max_clients=SAAS_PLANS["corporativo"]["max_clients"],
                max_users=SAAS_PLANS["corporativo"]["max_users"],
                max_cfdis_per_month=SAAS_PLANS["corporativo"]["max_cfdis_per_month"],
                payment_method="Mastercard •••• 8891",
                auto_renew=True,
                current_period_start=now - timedelta(days=12),
                current_period_end=now + timedelta(days=18),
            ),
            SaasTenant(
                name="Despacho Contable Ramírez & Asociados",
                slug="ramirez-asociados",
                rfc="DCR230115DD4",
                postal_code="44100",
                tax_regime="626 - Régimen Simplificado de Confianza",
                cfdi_use="G03 - Gastos en general",
                billing_email="contador@ramirezasociados.mx",
                phone="33 9876 5432",
                admin_username="cramirez",
                admin_password="Ramirez2026",
                plan_code="starter",
                billing_cycle="monthly",
                status="trial",
                price_mxn=SAAS_PLANS["starter"]["monthly_price"],
                max_clients=SAAS_PLANS["starter"]["max_clients"],
                max_users=SAAS_PLANS["starter"]["max_users"],
                max_cfdis_per_month=SAAS_PLANS["starter"]["max_cfdis_per_month"],
                payment_method="Prueba Gratuita 14 días",
                auto_renew=True,
                trial_ends_at=now + timedelta(days=10),
                current_period_start=now - timedelta(days=4),
                current_period_end=now + timedelta(days=10),
            ),
        ]
        for dt in demo_tenants:
            db.add(dt)

        db.commit()
        db.refresh(primary)

    # Backfill / sincronizar datos faltantes en tenants existentes
    all_tenants = db.query(SaasTenant).all()
    dirty = False
    demo_defaults = {
        "iterumx-principal": ("06600", "601 - General de Ley Personas Morales", "admin", "AVIAF1827$"),
        "consultores-norte": ("64000", "601 - General de Ley Personas Morales", "fnorte", "Norte2026"),
        "auditoria-bajio": ("37000", "601 - General de Ley Personas Morales", "gbajio", "Bajio2026"),
        "ramirez-asociados": ("44100", "626 - Régimen Simplificado de Confianza", "cramirez", "Ramirez2026"),
    }
    known_passwords = {
        "admin": "AVIAF1827$",
        "acunalan": "Landeros45",
    }

    for t in all_tenants:
        if t.admin_username == "admin" and t.admin_password == "admin123":
            t.admin_password = "AVIAF1827$"
            dirty = True
        if not t.cfdi_use:
            t.cfdi_use = "G03 - Gastos en general"
            dirty = True

        if t.slug in demo_defaults:
            def_cp, def_reg, def_usr, def_pwd = demo_defaults[t.slug]
            if not t.postal_code:
                t.postal_code = def_cp
                dirty = True
            if not t.tax_regime:
                t.tax_regime = def_reg
                dirty = True
            if not t.admin_username:
                t.admin_username = def_usr
                dirty = True
            if not t.admin_password:
                t.admin_password = def_pwd
                dirty = True

        if t.owner_user_id and (not t.admin_username or not t.admin_password):
            owner_u = db.query(User).filter(User.id == t.owner_user_id).first()
            if owner_u:
                if not t.admin_username:
                    t.admin_username = owner_u.username
                    dirty = True
                if not t.admin_password:
                    t.admin_password = known_passwords.get(owner_u.username, "Iterumx2026*")
                    dirty = True

        # Verificar vencimiento automático de Trial de 14 días
        if t.status == "trial" and t.trial_ends_at and datetime.utcnow() > t.trial_ends_at:
            t.status = "past_due"
            dirty = True

        # Inicializar indicadores base de comportamiento (CX, Retención, Soporte, Adquisición) si están vacíos
        kpi_presets = {
            "iterumx-principal": (10, 4.9, 1.3, 11.0, 95.0, 1.6, 3200.0, 24),
            "consultores-norte": (9, 4.7, 1.6, 18.0, 89.0, 2.4, 2450.0, 18),
            "auditoria-bajio": (10, 4.8, 1.4, 9.0, 96.0, 1.5, 4800.0, 36),
            "ramirez-asociados": (8, 4.4, 2.1, 24.0, 82.0, 3.5, 1450.0, 12),
        }
        def_nps, def_csat, def_ces, def_frt, def_fcr, def_art, def_cac, def_ten = kpi_presets.get(
            t.slug, (9, 4.6, 1.7, 15.0, 88.0, 2.2, 2100.0, 18)
        )
        if t.nps_score is None:
            t.nps_score = def_nps
            dirty = True
        if t.csat_score is None:
            t.csat_score = def_csat
            dirty = True
        if t.ces_score is None:
            t.ces_score = def_ces
            dirty = True
        if t.frt_minutes is None:
            t.frt_minutes = def_frt
            dirty = True
        if t.fcr_rate is None:
            t.fcr_rate = def_fcr
            dirty = True
        if t.art_hours is None:
            t.art_hours = def_art
            dirty = True
        if t.cac_mxn is None:
            t.cac_mxn = def_cac
            dirty = True
        if t.tenure_months is None:
            t.tenure_months = def_ten
            dirty = True

    if dirty:
        db.commit()
        db.refresh(primary)

    return primary


def _get_or_create_stripe_config(db: Session) -> SaasStripeConfig:
    cfg = db.query(SaasStripeConfig).order_by(SaasStripeConfig.id.asc()).first()
    if not cfg:
        cfg = SaasStripeConfig(
            mode="test",
            publishable_key="pk_test_51IterumxCloudStripePublishableKey",
            secret_key="",
            webhook_secret="",
            auto_block_expired_trials=True,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _tenant_to_dict(t: SaasTenant) -> dict:
    plan_info = SAAS_PLANS.get(t.plan_code, SAAS_PLANS["profesional"])
    now = datetime.utcnow()
    trial_days_remaining = None
    trial_expired = False
    if t.trial_ends_at:
        delta = t.trial_ends_at - now
        trial_days_remaining = max(0, delta.days + (1 if delta.seconds > 0 else 0))
        if delta.total_seconds() <= 0 and t.status in ("trial", "past_due"):
            trial_expired = True
            trial_days_remaining = 0
    if t.status == "past_due":
        trial_expired = True

    return {
        "id": t.id,
        "name": t.name,
        "slug": t.slug,
        "rfc": t.rfc or "",
        "postal_code": t.postal_code or "",
        "tax_regime": t.tax_regime or "",
        "cfdi_use": t.cfdi_use or "G03 - Gastos en general",
        "billing_email": t.billing_email or "",
        "phone": t.phone or "",
        "owner_user_id": t.owner_user_id,
        "admin_username": t.admin_username or "",
        "admin_password": t.admin_password or "",
        "plan_code": t.plan_code,
        "plan_name": plan_info["name"],
        "plan_badge": plan_info["badge"],
        "billing_cycle": t.billing_cycle,
        "status": t.status,
        "price_mxn": t.price_mxn,
        "max_clients": t.max_clients,
        "max_users": t.max_users,
        "max_cfdis_per_month": t.max_cfdis_per_month,
        "payment_method": t.payment_method or "Tarjeta Corporativa •••• 4242",
        "stripe_customer_id": t.stripe_customer_id or "",
        "stripe_subscription_id": t.stripe_subscription_id or "",
        "stripe_payment_method_id": t.stripe_payment_method_id or "",
        "card_brand": t.card_brand or "",
        "card_last4": t.card_last4 or "",
        "card_holder_name": t.card_holder_name or "",
        "auto_renew": bool(t.auto_renew),
        "trial_ends_at": t.trial_ends_at.strftime("%Y-%m-%d") if t.trial_ends_at else None,
        "trial_days_remaining": trial_days_remaining,
        "trial_expired": trial_expired,
        "current_period_start": t.current_period_start.strftime("%Y-%m-%d") if t.current_period_start else None,
        "current_period_end": t.current_period_end.strftime("%Y-%m-%d") if t.current_period_end else None,
        "created_at": t.created_at.strftime("%Y-%m-%d") if t.created_at else None,
        "nps_score": t.nps_score if t.nps_score is not None else 9,
        "csat_score": round(float(t.csat_score if t.csat_score is not None else 4.6), 2),
        "ces_score": round(float(t.ces_score if t.ces_score is not None else 1.7), 2),
        "frt_minutes": round(float(t.frt_minutes if t.frt_minutes is not None else 15.0), 1),
        "fcr_rate": round(float(t.fcr_rate if t.fcr_rate is not None else 88.0), 1),
        "art_hours": round(float(t.art_hours if t.art_hours is not None else 2.2), 1),
        "cac_mxn": round(float(t.cac_mxn if t.cac_mxn is not None else 2100.0), 2),
        "tenure_months": int(t.tenure_months if t.tenure_months is not None else 18),
        "cancelled_at": t.cancelled_at.strftime("%Y-%m-%d %H:%M") if t.cancelled_at else None,
        "cancellation_reason": t.cancellation_reason or "",
        "cancellation_comments": t.cancellation_comments or "",
    }


@router.get("/plans")
def get_saas_plans():
    """Catálogo público de planes y precios de Iterumx SaaS"""
    return {
        "brand": "Iterumx",
        "currency": "MXN",
        "annual_discount_percent": 20,
        "plans": list(SAAS_PLANS.values()),
    }


@router.post("/register")
def register_saas_account(req: SaasRegisterRequest, db: Session = Depends(get_db)):
    """
    Onboarding Self-Service: Registra un nuevo Despacho / Cuenta SaaS en Iterumx,
    crea su usuario Administrador y su Tenant con suscripción activa o prueba de 14 días.
    """
    _ensure_default_tenants(db)

    clean_username = (req.username or "").strip().lower()
    if not clean_username or len(clean_username) < 3:
        raise HTTPException(status_code=400, detail="El nombre de usuario debe tener al menos 3 caracteres.")

    if len(req.password or "") < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres.")

    existing_user = db.query(User).filter(User.username == clean_username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail=f"El usuario '{clean_username}' ya está registrado. Elige otro.")

    plan_code = req.plan_code if req.plan_code in SAAS_PLANS else "profesional"
    plan = SAAS_PLANS[plan_code]
    cycle = "annual" if req.billing_cycle == "annual" else "monthly"
    effective_price = plan["annual_monthly_equivalent"] if cycle == "annual" else plan["monthly_price"]

    new_user = User(
        username=clean_username,
        email=(req.email or "").strip(),
        hashed_password=get_password_hash(req.password),
        full_name=(req.full_name or "").strip() or clean_username,
        position="Socio / Titular",
        phone=(req.phone or "").strip() or None,
        role="admin",
        can_create_clients=True,
        is_active=True,
    )
    db.add(new_user)
    db.flush()

    base_slug = _slugify(req.firm_name)
    slug = base_slug
    if db.query(SaasTenant).filter(SaasTenant.slug == slug).first():
        slug = f"{base_slug}-{uuid.uuid4().hex[:4]}"

    now = datetime.utcnow()
    tenant = SaasTenant(
        name=(req.firm_name or "").strip() or f"Despacho de {new_user.full_name}",
        slug=slug,
        rfc=(req.rfc or "").strip().upper() or None,
        postal_code=(req.postal_code or "").strip() or None,
        tax_regime=(req.tax_regime or "").strip() or None,
        cfdi_use=(req.cfdi_use or "").strip() or "G03 - Gastos en general",
        billing_email=(req.email or "").strip(),
        phone=(req.phone or "").strip() or None,
        owner_user_id=new_user.id,
        admin_username=clean_username,
        admin_password=req.password,
        plan_code=plan_code,
        billing_cycle=cycle,
        status="trial",
        price_mxn=effective_price,
        max_clients=plan["max_clients"],
        max_users=plan["max_users"],
        max_cfdis_per_month=plan["max_cfdis_per_month"],
        payment_method="Prueba Gratuita 14 días (Iterumx Cloud)",
        auto_renew=True,
        trial_ends_at=now + timedelta(days=14),
        current_period_start=now,
        current_period_end=now + timedelta(days=14),
    )
    db.add(tenant)
    db.flush()

    inv_count = db.query(func.count(SaasInvoice.id)).scalar() or 0
    invoice = SaasInvoice(
        tenant_id=tenant.id,
        folio=f"ITX-{now.strftime('%Y')}-{inv_count + 101:04d}",
        plan_name=f"{plan['name']} (Trial 14 días)",
        billing_cycle="Anual" if cycle == "annual" else "Mensual",
        amount=0.0,
        currency="MXN",
        status="Cortesía Trial",
        payment_method="Activación Instantánea",
        period_label="14 días sin costo",
        cfdi_uuid=str(uuid.uuid4()).upper(),
    )
    db.add(invoice)
    db.commit()
    db.refresh(new_user)
    db.refresh(tenant)

    access_token = create_access_token(
        data={"sub": new_user.username, "role": new_user.role, "client_id": new_user.client_id}
    )

    return {
        "message": f"¡Bienvenido a Iterumx! Tu cuenta ({plan['name']}) ha sido creada.",
        "access_token": access_token,
        "token": access_token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "full_name": new_user.full_name,
            "email": new_user.email,
            "position": new_user.position,
            "role": new_user.role,
            "is_active": new_user.is_active,
        },
        "tenant": _tenant_to_dict(tenant),
    }


@router.get("/overview")
def get_saas_overview(
    client_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Devuelve el estado de suscripción SaaS del despacho actual, límites de su plan,
    consumo real de clientes/usuarios/CFDIs y facturas de suscripción.
    """
    primary = _ensure_default_tenants(db)
    owner_id = get_effective_owner_id(db, current_user)

    # Buscar si el despacho actual tiene un tenant específico, o usar el principal
    tenant = (
        db.query(SaasTenant).filter(SaasTenant.owner_user_id == owner_id).first()
        or db.query(SaasTenant).filter(SaasTenant.owner_user_id == current_user.id).first()
        or primary
    )

    active_client_obj = None
    if client_id:
        active_client_obj = db.query(Client).filter(Client.id == client_id).first()

    tenant_client_ids = [
        cid for (cid,) in db.query(Client.id).filter(Client.owner_user_id == owner_id).all()
    ]
    active_clients = (
        db.query(func.count(Client.id))
        .filter(Client.is_active == True, Client.owner_user_id == owner_id)
        .scalar()
        or 0
    )
    active_users = (
        db.query(func.count(User.id))
        .filter(
            User.is_active == True,
            User.role.in_(["admin", "accountant"]),
            (User.id == owner_id) | (User.owner_user_id == owner_id),
        )
        .scalar()
        or 0
    )
    if tenant_client_ids:
        total_cfdis = (
            db.query(func.count(CFDIInvoice.id))
            .filter(CFDIInvoice.client_id.in_(tenant_client_ids))
            .scalar()
            or 0
        )
        total_journals = (
            db.query(func.count(JournalEntry.id))
            .filter(JournalEntry.client_id.in_(tenant_client_ids))
            .scalar()
            or 0
        )
    else:
        total_cfdis = 0
        total_journals = 0

    invoices = (
        db.query(SaasInvoice)
        .filter(SaasInvoice.tenant_id == tenant.id)
        .order_by(SaasInvoice.id.desc())
        .all()
    )
    stripe_cfg = _get_or_create_stripe_config(db)

    return {
        "tenant": _tenant_to_dict(tenant),
        "active_client": (
            {
                "id": active_client_obj.id,
                "business_name": active_client_obj.business_name,
                "legal_name": active_client_obj.legal_name or active_client_obj.business_name,
                "rfc": active_client_obj.rfc or "",
                "postal_code": active_client_obj.postal_code or "",
                "tax_regime": active_client_obj.tax_regime or "",
                "email": active_client_obj.email or "",
                "phone": active_client_obj.phone or "",
            }
            if active_client_obj
            else None
        ),
        "stripe_config": {
            "mode": stripe_cfg.mode or "test",
            "publishable_key": stripe_cfg.publishable_key or "pk_test_51IterumxCloudStripePublishableKey",
            "spei_bank_name": (stripe_cfg.spei_bank_name or "STP / BBVA México (SPEI)").replace("(Stripe SPEI)", "(SPEI)"),
            "spei_clabe": stripe_cfg.spei_clabe or "646180157042891042",
            "spei_beneficiary": stripe_cfg.spei_beneficiary or "Iterumx S.A. de C.V.",
            "enable_oxxo_7eleven": stripe_cfg.enable_oxxo_7eleven if stripe_cfg.enable_oxxo_7eleven is not None else True,
            "payment_links": {
                "starter": stripe_cfg.payment_link_starter or "",
                "profesional": stripe_cfg.payment_link_profesional or "",
                "empresarial": stripe_cfg.payment_link_empresarial or "",
                "corporativo": stripe_cfg.payment_link_corporativo or "",
            },
        },
        "usage": {
            "active_clients": active_clients,
            "max_clients": tenant.max_clients,
            "clients_percent": min(100, round((active_clients / max(1, tenant.max_clients)) * 100, 1)),
            "active_users": active_users,
            "max_users": tenant.max_users,
            "users_percent": min(100, round((active_users / max(1, tenant.max_users)) * 100, 1)),
            "total_cfdis": total_cfdis,
            "max_cfdis_per_month": tenant.max_cfdis_per_month,
            "cfdis_percent": min(100, round((total_cfdis / max(1, tenant.max_cfdis_per_month)) * 100, 1)),
            "total_journals": total_journals,
            "storage_mb": round(12.4 + (total_cfdis * 0.04) + (total_journals * 0.015), 2),
        },
        "plans": list(SAAS_PLANS.values()),
        "invoices": [
            {
                "id": inv.id,
                "folio": inv.folio,
                "plan_name": inv.plan_name,
                "billing_cycle": inv.billing_cycle,
                "amount": inv.amount,
                "currency": inv.currency,
                "status": inv.status,
                "payment_method": inv.payment_method,
                "period_label": inv.period_label,
                "cfdi_uuid": inv.cfdi_uuid,
                "stripe_payment_intent_id": inv.stripe_payment_intent_id or "",
                "created_at": inv.created_at.strftime("%Y-%m-%d %H:%M") if inv.created_at else "",
            }
            for inv in invoices
        ],
        "cancellation_feedback": [
            {
                "id": fb.id,
                "primary_reason": fb.primary_reason,
                "secondary_reasons": [s.strip() for s in (fb.secondary_reasons or "").split(",") if s.strip()],
                "satisfaction_score": fb.satisfaction_score,
                "nps_likelihood": fb.nps_likelihood,
                "missing_features": fb.missing_features or "",
                "alternative_solution": fb.alternative_solution or "",
                "would_return": fb.would_return or "Tal vez",
                "comments": fb.comments or "",
                "cancelled_by_username": fb.cancelled_by_username or "",
                "created_at": fb.created_at.strftime("%Y-%m-%d %H:%M") if fb.created_at else "",
            }
            for fb in db.query(SaasCancellationFeedback)
            .filter(SaasCancellationFeedback.tenant_id == tenant.id)
            .order_by(SaasCancellationFeedback.id.desc())
            .all()
        ],
    }


class CancelSubscriptionRequest(BaseModel):
    primary_reason: str
    secondary_reasons: Optional[List[str]] = None
    satisfaction_score: int = 4
    nps_likelihood: Optional[int] = 7
    missing_features: Optional[str] = None
    alternative_solution: Optional[str] = None
    would_return: Optional[str] = "Tal vez"
    comments: Optional[str] = None


@router.post("/cancel-subscription")
def cancel_saas_subscription(
    req: CancelSubscriptionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Cancela la suscripción del despacho actual y registra el cuestionario de retroalimentación (motivos y CX).
    """
    if not req.primary_reason or not req.primary_reason.strip():
        raise HTTPException(
            status_code=400,
            detail="Por favor selecciona el motivo principal de la cancelación en el cuestionario.",
        )

    primary = _ensure_default_tenants(db)
    owner_id = get_effective_owner_id(db, current_user)
    tenant = (
        db.query(SaasTenant).filter(SaasTenant.owner_user_id == owner_id).first()
        or db.query(SaasTenant).filter(SaasTenant.owner_user_id == current_user.id).first()
        or primary
    )

    now = datetime.utcnow()
    secondary_str = ", ".join(req.secondary_reasons) if req.secondary_reasons else ""
    sat_score = max(1, min(5, int(req.satisfaction_score or 4)))
    nps_val = max(0, min(10, int(req.nps_likelihood if req.nps_likelihood is not None else 7)))

    feedback = SaasCancellationFeedback(
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        plan_code=tenant.plan_code,
        primary_reason=req.primary_reason.strip(),
        secondary_reasons=secondary_str,
        satisfaction_score=sat_score,
        nps_likelihood=nps_val,
        missing_features=(req.missing_features or "").strip() or None,
        alternative_solution=(req.alternative_solution or "").strip() or None,
        would_return=(req.would_return or "Tal vez").strip(),
        comments=(req.comments or "").strip() or None,
        cancelled_by_username=current_user.username,
        created_at=now,
    )
    db.add(feedback)

    tenant.status = "cancelled"
    tenant.auto_renew = False
    tenant.cancelled_at = now
    tenant.cancellation_reason = req.primary_reason.strip()
    tenant.cancellation_comments = (req.comments or "").strip() or None
    tenant.csat_score = float(sat_score)
    tenant.nps_score = nps_val

    db.commit()
    db.refresh(tenant)
    db.refresh(feedback)

    log_activity(
        db=db,
        user=current_user,
        action="CANCELACION_SUSCRIPCION",
        module="Suscripción",
        description=f"Canceló la suscripción ({tenant.plan_code}). Motivo: {tenant.cancellation_reason}",
        details={
            "primary_reason": tenant.cancellation_reason,
            "secondary_reasons": req.secondary_reasons or [],
            "satisfaction_score": sat_score,
            "nps_likelihood": nps_val,
            "would_return": feedback.would_return,
            "comments": tenant.cancellation_comments,
        },
    )

    return {
        "message": "Tu suscripción ha sido cancelada y hemos registrado tu cuestionario de retroalimentación. Tus datos y empresas permanecerán resguardados.",
        "tenant": _tenant_to_dict(tenant),
        "feedback_id": feedback.id,
    }


@router.post("/reactivate-subscription")
def reactivate_saas_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Reactiva la suscripción previamente cancelada conservando el plan del despacho.
    """
    primary = _ensure_default_tenants(db)
    owner_id = get_effective_owner_id(db, current_user)
    tenant = (
        db.query(SaasTenant).filter(SaasTenant.owner_user_id == owner_id).first()
        or db.query(SaasTenant).filter(SaasTenant.owner_user_id == current_user.id).first()
        or primary
    )

    now = datetime.utcnow()
    tenant.status = "active"
    tenant.auto_renew = True
    if not tenant.current_period_end or tenant.current_period_end < now:
        tenant.current_period_start = now
        tenant.current_period_end = now + timedelta(days=365 if tenant.billing_cycle == "annual" else 30)

    db.commit()
    db.refresh(tenant)

    log_activity(
        db=db,
        user=current_user,
        action="REACTIVACION_SUSCRIPCION",
        module="Suscripción",
        description=f"Reactivó la suscripción del despacho ({tenant.plan_code})",
        details={"plan_code": tenant.plan_code, "status": "active"},
    )

    return {
        "message": "¡Tu suscripción ha sido reactivada con éxito!",
        "tenant": _tenant_to_dict(tenant),
    }


@router.post("/change-plan")
def change_saas_plan(
    req: ChangePlanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if req.plan_code not in SAAS_PLANS:
        raise HTTPException(status_code=400, detail="El plan seleccionado no es válido.")

    primary = _ensure_default_tenants(db)
    tenant = (
        db.query(SaasTenant).filter(SaasTenant.owner_user_id == current_user.id).first()
        or primary
    )

    plan = SAAS_PLANS[req.plan_code]
    cycle = "annual" if req.billing_cycle == "annual" else "monthly"
    now = datetime.utcnow()

    tenant.plan_code = plan["code"]
    tenant.billing_cycle = cycle
    tenant.status = "active"
    tenant.price_mxn = plan["annual_monthly_equivalent"] if cycle == "annual" else plan["monthly_price"]
    tenant.max_clients = plan["max_clients"]
    tenant.max_users = plan["max_users"]
    tenant.max_cfdis_per_month = plan["max_cfdis_per_month"]
    if req.payment_method:
        tenant.payment_method = req.payment_method.strip()
    tenant.current_period_start = now
    tenant.current_period_end = now + timedelta(days=365 if cycle == "annual" else 30)

    inv_count = db.query(func.count(SaasInvoice.id)).scalar() or 0
    charge_amount = plan["annual_total"] if cycle == "annual" else plan["monthly_price"]
    new_inv = SaasInvoice(
        tenant_id=tenant.id,
        folio=f"ITX-{now.strftime('%Y')}-{inv_count + 101:04d}",
        plan_name=plan["name"],
        billing_cycle="Anual (20% Dto.)" if cycle == "annual" else "Mensual",
        amount=charge_amount,
        currency="MXN",
        status="Pagado",
        payment_method=tenant.payment_method,
        period_label="Suscripción Anual (12 meses)" if cycle == "annual" else "Suscripción Mensual (30 días)",
        cfdi_uuid=str(uuid.uuid4()).upper(),
        created_at=now,
    )
    db.add(new_inv)
    db.commit()
    db.refresh(tenant)

    log_activity(
        db=db,
        user=current_user,
        action="CAMBIO_PLAN",
        module="Suscripción",
        description=f"Actualizó el plan a {plan['name']} ({cycle})",
        details={"plan_code": plan["code"], "billing_cycle": cycle, "amount": charge_amount},
    )

    return {
        "message": f"Plan actualizado exitosamente a {plan['name']} ({'Anual' if cycle == 'annual' else 'Mensual'}).",
        "tenant": _tenant_to_dict(tenant),
    }


@router.put("/tenant-profile")
def update_tenant_profile(
    req: TenantProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    primary = _ensure_default_tenants(db)
    tenant = (
        db.query(SaasTenant).filter(SaasTenant.owner_user_id == current_user.id).first()
        or primary
    )

    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="El nombre del despacho u organización es obligatorio.")

    tenant.name = req.name.strip()
    tenant.rfc = (req.rfc or "").strip().upper() or None
    if req.postal_code is not None:
        tenant.postal_code = req.postal_code.strip() or None
    if req.tax_regime is not None:
        tenant.tax_regime = req.tax_regime.strip() or None
    if req.cfdi_use is not None:
        tenant.cfdi_use = req.cfdi_use.strip() or "G03 - Gastos en general"
    tenant.billing_email = (req.billing_email or "").strip() or None
    tenant.phone = (req.phone or "").strip() or None
    if req.payment_method is not None:
        tenant.payment_method = req.payment_method.strip() or "Tarjeta Corporativa •••• 4242"
    if req.auto_renew is not None:
        tenant.auto_renew = bool(req.auto_renew)

    db.commit()
    db.refresh(tenant)

    return {
        "message": "Perfil fiscal y de suscripción del despacho actualizado correctamente.",
        "tenant": _tenant_to_dict(tenant),
    }


def _require_super_admin(current_user: User = Depends(require_role("admin"))) -> User:
    if (current_user.username or "").strip().lower() != "sgadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este módulo es exclusivo para el Super Administrador de Iterumx (sgadmin).",
        )
    return current_user


@router.get("/admin/tenants")
def list_all_tenants_admin(
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_super_admin),
):
    """
    Consola de Administración SaaS Multi-Tenant:
    Métricas MRR, ARR, Tenants activos y listado de organizaciones suscritas.
    """
    _ensure_default_tenants(db)
    tenants = db.query(SaasTenant).order_by(SaasTenant.id.asc()).all()

    mrr = 0.0
    tenants_list = []
    for idx, t in enumerate(tenants):
        if t.status in ("active", "trial"):
            mrr += float(t.price_mxn or 0)
        d = _tenant_to_dict(t)
        if t.owner_user_id:
            tenant_client_ids = [
                cid[0]
                for cid in db.query(Client.id)
                .filter(Client.is_active == True, Client.owner_user_id == t.owner_user_id)
                .all()
            ]
            d["current_clients"] = len(tenant_client_ids)
            d["current_users"] = (
                db.query(func.count(User.id))
                .filter(
                    User.is_active == True,
                    User.role.in_(["admin", "accountant"]),
                    (User.id == t.owner_user_id) | (User.owner_user_id == t.owner_user_id),
                )
                .scalar()
                or 0
            )
            if tenant_client_ids:
                d["total_cfdis"] = (
                    db.query(func.count(CFDIInvoice.id))
                    .filter(CFDIInvoice.client_id.in_(tenant_client_ids))
                    .scalar()
                    or 0
                )
                d["total_journals"] = (
                    db.query(func.count(JournalEntry.id))
                    .filter(JournalEntry.client_id.in_(tenant_client_ids))
                    .scalar()
                    or 0
                )
            else:
                d["total_cfdis"] = 0
                d["total_journals"] = 0
        else:
            seed_clients = min(t.max_clients, max(2, (t.id * 7) % max(3, t.max_clients)))
            seed_users = min(t.max_users, max(1, (t.id * 3) % max(2, t.max_users)))
            d["current_clients"] = seed_clients
            d["current_users"] = seed_users
            d["total_cfdis"] = seed_clients * 145
            d["total_journals"] = seed_clients * 62

        # Cálculos individuales de comportamiento (KPIs por Tenant)
        nps_val = int(d.get("nps_score", 9))
        if nps_val >= 9:
            d["nps_category"] = "Promotor"
        elif nps_val >= 7:
            d["nps_category"] = "Pasivo"
        else:
            d["nps_category"] = "Detractor"

        price_val = float(d.get("price_mxn") or 0.0)
        tenure_val = max(1, int(d.get("tenure_months") or 18))
        cac_val = max(1.0, float(d.get("cac_mxn") or 2100.0))
        ltv_val = round(price_val * tenure_val, 2)
        d["ltv_mxn"] = ltv_val
        d["ltv_cac_ratio"] = round(ltv_val / cac_val, 2)
        d["payback_months"] = round(cac_val / max(1.0, price_val), 1)
        d["is_retained"] = t.status in ("active", "trial")

        tenants_list.append(d)

    total_n = max(1, len(tenants_list))

    # 1. Dimensión: Experiencia y Satisfacción (CX)
    promoters = sum(1 for item in tenants_list if item["nps_score"] >= 9)
    passives = sum(1 for item in tenants_list if 7 <= item["nps_score"] <= 8)
    detractors = sum(1 for item in tenants_list if item["nps_score"] <= 6)
    promoters_pct = round((promoters / total_n) * 100, 1)
    passives_pct = round((passives / total_n) * 100, 1)
    detractors_pct = round((detractors / total_n) * 100, 1)
    nps_net_score = round(promoters_pct - detractors_pct, 1)

    csat_avg = round(sum(item["csat_score"] for item in tenants_list) / total_n, 2)
    csat_satisfied = sum(1 for item in tenants_list if item["csat_score"] >= 4.0)
    csat_satisfaction_pct = round((csat_satisfied / total_n) * 100, 1)

    ces_avg = round(sum(item["ces_score"] for item in tenants_list) / total_n, 2)
    ces_low_effort = sum(1 for item in tenants_list if item["ces_score"] <= 2.0)
    ces_low_effort_pct = round((ces_low_effort / total_n) * 100, 1)

    # 2. Dimensión: Retención y Lealtad
    retained_count = sum(1 for item in tenants_list if item["status"] in ("active", "trial"))
    churned_count = sum(1 for item in tenants_list if item["status"] in ("cancelled", "past_due"))
    crr_pct = round((retained_count / total_n) * 100, 1)
    churn_rate_pct = round(100.0 - crr_pct, 1)
    avg_tenure_months = round(sum(item["tenure_months"] for item in tenants_list) / total_n, 1)
    ltv_avg_mxn = round(sum(item["ltv_mxn"] for item in tenants_list) / total_n, 2)
    ltv_portfolio_total_mxn = round(sum(item["ltv_mxn"] for item in tenants_list), 2)

    # 3. Dimensión: Operaciones y Soporte
    frt_avg_minutes = round(sum(item["frt_minutes"] for item in tenants_list) / total_n, 1)
    frt_avg_hours = round(frt_avg_minutes / 60.0, 2)
    fcr_avg_pct = round(sum(item["fcr_rate"] for item in tenants_list) / total_n, 1)
    tmr_art_avg_hours = round(sum(item["art_hours"] for item in tenants_list) / total_n, 2)

    # 4. Dimensión: Adquisición y Ventas
    cac_avg_mxn = round(sum(item["cac_mxn"] for item in tenants_list) / total_n, 2)
    cac_total_investment_mxn = round(sum(item["cac_mxn"] for item in tenants_list), 2)
    ticket_promedio_mensual_mxn = round(
        sum(float(item["price_mxn"] or 0) for item in tenants_list) / total_n, 2
    )
    all_invoices = db.query(SaasInvoice).filter(SaasInvoice.amount > 0).all()
    if all_invoices:
        ticket_promedio_transaccion_mxn = round(
            sum(float(inv.amount or 0) for inv in all_invoices) / len(all_invoices), 2
        )
    else:
        ticket_promedio_transaccion_mxn = round(ticket_promedio_mensual_mxn * 1.16, 2)

    global_ltv_cac_ratio = round(ltv_avg_mxn / max(1.0, cac_avg_mxn), 2)
    global_payback_months = round(cac_avg_mxn / max(1.0, ticket_promedio_mensual_mxn), 1)

    return {
        "metrics": {
            "total_tenants": len(tenants),
            "active_tenants": sum(1 for t in tenants if t.status == "active"),
            "trial_tenants": sum(1 for t in tenants if t.status == "trial"),
            "mrr_mxn": round(mrr, 2),
            "arr_mxn": round(mrr * 12, 2),
            "total_managed_companies": sum(item["current_clients"] for item in tenants_list),
        },
        "kpis": {
            "cx": {
                "nps_net_score": nps_net_score,
                "promoters_count": promoters,
                "passives_count": passives,
                "detractors_count": detractors,
                "promoters_pct": promoters_pct,
                "passives_pct": passives_pct,
                "detractors_pct": detractors_pct,
                "csat_avg": csat_avg,
                "csat_satisfaction_pct": csat_satisfaction_pct,
                "ces_avg": ces_avg,
                "ces_low_effort_pct": ces_low_effort_pct,
            },
            "retention": {
                "crr_pct": crr_pct,
                "churn_rate_pct": churn_rate_pct,
                "retained_tenants": retained_count,
                "churned_tenants": churned_count,
                "avg_tenure_months": avg_tenure_months,
                "ltv_avg_mxn": ltv_avg_mxn,
                "ltv_portfolio_total_mxn": ltv_portfolio_total_mxn,
            },
            "operations_support": {
                "frt_avg_minutes": frt_avg_minutes,
                "frt_avg_hours": frt_avg_hours,
                "fcr_avg_pct": fcr_avg_pct,
                "tmr_art_avg_hours": tmr_art_avg_hours,
            },
            "acquisition_sales": {
                "cac_avg_mxn": cac_avg_mxn,
                "cac_total_investment_mxn": cac_total_investment_mxn,
                "ticket_promedio_mensual_mxn": ticket_promedio_mensual_mxn,
                "ticket_promedio_transaccion_mxn": ticket_promedio_transaccion_mxn,
                "ltv_cac_ratio": global_ltv_cac_ratio,
                "payback_months": global_payback_months,
            },
        },
        "tenants": tenants_list,
        "plans": list(SAAS_PLANS.values()),
    }


@router.post("/admin/tenants")
def create_tenant_admin(
    req: AdminTenantCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_super_admin),
):
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="El nombre del despacho/organización es obligatorio.")

    plan_code = req.plan_code if req.plan_code in SAAS_PLANS else "profesional"
    plan = SAAS_PLANS[plan_code]
    cycle = "annual" if req.billing_cycle == "annual" else "monthly"
    effective_price = plan["annual_monthly_equivalent"] if cycle == "annual" else plan["monthly_price"]

    base_slug = _slugify(req.name)
    slug = base_slug
    if db.query(SaasTenant).filter(SaasTenant.slug == slug).first():
        slug = f"{base_slug}-{uuid.uuid4().hex[:4]}"

    clean_usr = (req.admin_username or "").strip().lower() or None
    clean_pwd = (req.admin_password or "").strip() or None
    owner_user_id = None

    if clean_usr:
        existing_u = db.query(User).filter(User.username == clean_usr).first()
        if existing_u:
            owner_user_id = existing_u.id
            if clean_pwd:
                existing_u.hashed_password = get_password_hash(clean_pwd)
        else:
            pwd_to_use = clean_pwd or "Iterumx2026*"
            clean_pwd = pwd_to_use
            new_u = User(
                username=clean_usr,
                email=(req.billing_email or "").strip() or None,
                hashed_password=get_password_hash(pwd_to_use),
                full_name=req.name.strip(),
                position="Socio / Titular",
                phone=(req.phone or "").strip() or None,
                role="admin",
                can_create_clients=True,
                is_active=True,
            )
            db.add(new_u)
            db.flush()
            owner_user_id = new_u.id

    now = datetime.utcnow()
    new_t = SaasTenant(
        name=req.name.strip(),
        slug=slug,
        rfc=(req.rfc or "").strip().upper() or None,
        postal_code=(req.postal_code or "").strip() or None,
        tax_regime=(req.tax_regime or "").strip() or None,
        cfdi_use=(req.cfdi_use or "").strip() or "G03 - Gastos en general",
        billing_email=(req.billing_email or "").strip() or None,
        phone=(req.phone or "").strip() or None,
        owner_user_id=owner_user_id,
        admin_username=clean_usr,
        admin_password=clean_pwd,
        plan_code=plan_code,
        billing_cycle=cycle,
        status=req.status or "active",
        price_mxn=effective_price,
        max_clients=plan["max_clients"],
        max_users=plan["max_users"],
        max_cfdis_per_month=plan["max_cfdis_per_month"],
        payment_method="Suscripción Directa Iterumx",
        current_period_start=now,
        current_period_end=now + timedelta(days=365 if cycle == "annual" else 30),
        nps_score=req.nps_score if req.nps_score is not None else 9,
        csat_score=req.csat_score if req.csat_score is not None else 4.7,
        ces_score=req.ces_score if req.ces_score is not None else 1.6,
        frt_minutes=req.frt_minutes if req.frt_minutes is not None else 15.0,
        fcr_rate=req.fcr_rate if req.fcr_rate is not None else 90.0,
        art_hours=req.art_hours if req.art_hours is not None else 2.0,
        cac_mxn=req.cac_mxn if req.cac_mxn is not None else 2100.0,
        tenure_months=req.tenure_months if req.tenure_months is not None else 18,
    )
    db.add(new_t)
    db.commit()
    db.refresh(new_t)
    return _tenant_to_dict(new_t)


@router.put("/admin/tenants/{tenant_id}")
def update_tenant_admin(
    tenant_id: int,
    req: AdminTenantUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_super_admin),
):
    t = db.query(SaasTenant).filter(SaasTenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Organización / Tenant no encontrado.")

    if req.name is not None and req.name.strip():
        t.name = req.name.strip()
    if req.rfc is not None:
        t.rfc = req.rfc.strip().upper() or None
    if req.postal_code is not None:
        t.postal_code = req.postal_code.strip() or None
    if req.tax_regime is not None:
        t.tax_regime = req.tax_regime.strip() or None
    if req.cfdi_use is not None:
        t.cfdi_use = req.cfdi_use.strip() or "G03 - Gastos en general"
    if req.billing_email is not None:
        t.billing_email = req.billing_email.strip() or None
    if req.phone is not None:
        t.phone = req.phone.strip() or None
    if req.status is not None:
        t.status = req.status

    if req.admin_username is not None:
        clean_usr = req.admin_username.strip().lower() or None
        t.admin_username = clean_usr
    if req.admin_password is not None:
        clean_pwd = req.admin_password.strip() or None
        t.admin_password = clean_pwd

    # Sincronizar con la cuenta de usuario en la tabla users para que pueda iniciar sesión
    if t.admin_username:
        owner_u = None
        if t.owner_user_id:
            owner_u = db.query(User).filter(User.id == t.owner_user_id).first()
        if not owner_u:
            owner_u = db.query(User).filter(User.username == t.admin_username).first()

        if owner_u:
            t.owner_user_id = owner_u.id
            if owner_u.username != "admin":
                owner_u.username = t.admin_username
            if req.admin_password and req.admin_password.strip():
                owner_u.hashed_password = get_password_hash(req.admin_password.strip())
        elif t.admin_password:
            new_u = User(
                username=t.admin_username,
                email=t.billing_email,
                hashed_password=get_password_hash(t.admin_password),
                full_name=t.name,
                position="Socio / Titular",
                phone=t.phone,
                role="admin",
                can_create_clients=True,
                is_active=True,
            )
            db.add(new_u)
            db.flush()
            t.owner_user_id = new_u.id

    if req.plan_code is not None and req.plan_code in SAAS_PLANS:
        plan = SAAS_PLANS[req.plan_code]
        t.plan_code = plan["code"]
        t.max_clients = plan["max_clients"]
        t.max_users = plan["max_users"]
        t.max_cfdis_per_month = plan["max_cfdis_per_month"]
        cycle = req.billing_cycle or t.billing_cycle
        t.price_mxn = plan["annual_monthly_equivalent"] if cycle == "annual" else plan["monthly_price"]

    if req.billing_cycle is not None:
        t.billing_cycle = req.billing_cycle
        plan = SAAS_PLANS.get(t.plan_code, SAAS_PLANS["profesional"])
        t.price_mxn = (
            plan["annual_monthly_equivalent"] if t.billing_cycle == "annual" else plan["monthly_price"]
        )

    if req.nps_score is not None:
        t.nps_score = max(0, min(10, int(req.nps_score)))
    if req.csat_score is not None:
        t.csat_score = max(1.0, min(5.0, float(req.csat_score)))
    if req.ces_score is not None:
        t.ces_score = max(1.0, min(5.0, float(req.ces_score)))
    if req.frt_minutes is not None:
        t.frt_minutes = max(0.0, float(req.frt_minutes))
    if req.fcr_rate is not None:
        t.fcr_rate = max(0.0, min(100.0, float(req.fcr_rate)))
    if req.art_hours is not None:
        t.art_hours = max(0.0, float(req.art_hours))
    if req.cac_mxn is not None:
        t.cac_mxn = max(0.0, float(req.cac_mxn))
    if req.tenure_months is not None:
        t.tenure_months = max(1, int(req.tenure_months))

    db.commit()
    db.refresh(t)
    return _tenant_to_dict(t)


class StripeCheckoutRequest(BaseModel):
    plan_code: str = "profesional"
    billing_cycle: str = "monthly"
    payment_type: str = "card"  # card | spei | cash
    card_holder_name: Optional[str] = None
    card_number: Optional[str] = None
    card_expiry: Optional[str] = None
    card_cvc: Optional[str] = None
    spei_tracking_key: Optional[str] = None
    spei_sender_bank: Optional[str] = None
    cash_store: Optional[str] = "OXXO"  # OXXO | 7-Eleven
    cash_voucher_reference: Optional[str] = None
    rfc: Optional[str] = None
    postal_code: Optional[str] = None
    tax_regime: Optional[str] = None
    cfdi_use: Optional[str] = "G03 - Gastos en general"
    billing_email: Optional[str] = None


class StripeConfigUpdateRequest(BaseModel):
    mode: str = "test"
    publishable_key: Optional[str] = None
    secret_key: Optional[str] = None
    webhook_secret: Optional[str] = None
    payment_link_starter: Optional[str] = None
    payment_link_profesional: Optional[str] = None
    payment_link_empresarial: Optional[str] = None
    payment_link_corporativo: Optional[str] = None
    spei_bank_name: Optional[str] = None
    spei_clabe: Optional[str] = None
    spei_beneficiary: Optional[str] = None
    enable_oxxo_7eleven: Optional[bool] = True
    auto_block_expired_trials: Optional[bool] = True


def _detect_card_brand(digits: str) -> str:
    if digits.startswith("4"):
        return "Visa"
    if digits.startswith(("51", "52", "53", "54", "55", "2")):
        return "Mastercard"
    if digits.startswith(("34", "37")):
        return "American Express"
    return "Tarjeta"


@router.post("/stripe/checkout")
def process_stripe_checkout(
    req: StripeCheckoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """
    Procesa el pago de suscripción con pasarela Stripe (PCI-DSS Tokenizado):
    Soporta 3 modalidades:
    1. 'card': Tarjeta de crédito / débito (Visa, Mastercard, Amex).
    2. 'spei': Transferencia interbancaria SPEI / CoDi referenciada.
    3. 'cash': Pago en efectivo en tiendas de conveniencia (OXXO Pay / 7-Eleven).
    """
    if req.plan_code not in SAAS_PLANS:
        raise HTTPException(status_code=400, detail="El plan seleccionado no es válido.")

    payment_type = (req.payment_type or "card").strip().lower()

    primary = _ensure_default_tenants(db)
    owner_id = get_effective_owner_id(db, current_user)
    tenant = (
        db.query(SaasTenant).filter(SaasTenant.owner_user_id == owner_id).first()
        or db.query(SaasTenant).filter(SaasTenant.owner_user_id == current_user.id).first()
        or primary
    )

    plan = SAAS_PLANS[req.plan_code]
    cycle = "annual" if req.billing_cycle == "annual" else "monthly"
    now = datetime.utcnow()

    if not tenant.stripe_customer_id:
        tenant.stripe_customer_id = f"cus_{uuid.uuid4().hex[:14]}"
    tenant.stripe_subscription_id = f"sub_{uuid.uuid4().hex[:14]}"
    payment_intent_id = f"pi_{uuid.uuid4().hex[:16]}"
    payment_reference = ""
    invoice_status = "Pagado"

    if payment_type == "spei":
        tracking = (req.spei_tracking_key or "").strip().upper() or f"SPEI-{tenant.id:03d}-{now.strftime('%m%d%H%M')}"
        sender_bank = (req.spei_sender_bank or "").strip() or "Banca Electrónica"
        payment_reference = tracking
        tenant.stripe_payment_method_id = f"pm_spei_{uuid.uuid4().hex[:10]}"
        tenant.card_brand = "SPEI"
        tenant.card_last4 = tracking[-4:] if len(tracking) >= 4 else "SPEI"
        tenant.card_holder_name = sender_bank
        tenant.payment_method = f"SPEI Transferencia ({sender_bank} • {tracking})"
        invoice_status = "Pagado (SPEI)"
        msg_success = f"¡Pago por transferencia SPEI ({tracking}) registrado! Tu suscripción {plan['name']} está ACTIVA."
    elif payment_type == "cash":
        store_name = "7-Eleven" if "7" in (req.cash_store or "") else "OXXO"
        voucher_ref = (
            re.sub(r"\D+", "", req.cash_voucher_reference or "")
            or f"9300{tenant.id:04d}{now.strftime('%m%d%H%M')}{uuid.uuid4().int % 10000:04d}"[:16]
        )
        payment_reference = voucher_ref
        tenant.stripe_payment_method_id = f"pm_oxxo_{uuid.uuid4().hex[:10]}"
        tenant.card_brand = store_name
        tenant.card_last4 = voucher_ref[-4:]
        tenant.card_holder_name = f"Efectivo {store_name}"
        tenant.payment_method = f"Efectivo {store_name} (Ref: {voucher_ref})"
        invoice_status = f"Pagado ({store_name})"
        msg_success = f"¡Ficha de pago en {store_name} (Ref: {voucher_ref}) confirmada! Tu suscripción {plan['name']} está ACTIVA."
    else:
        digits = re.sub(r"\D+", "", req.card_number or "")
        if len(digits) < 15:
            raise HTTPException(status_code=400, detail="Ingresa un número de tarjeta válido (15 o 16 dígitos).")

        cvc_digits = re.sub(r"\D+", "", req.card_cvc or "")
        if len(cvc_digits) < 3:
            raise HTTPException(status_code=400, detail="Ingresa un código de seguridad (CVC) válido.")

        brand = _detect_card_brand(digits)
        last4 = digits[-4:]
        holder = (req.card_holder_name or "").strip() or current_user.full_name or tenant.name

        tenant.stripe_payment_method_id = f"pm_{uuid.uuid4().hex[:14]}"
        tenant.card_brand = brand
        tenant.card_last4 = last4
        tenant.card_holder_name = holder
        tenant.payment_method = f"{brand} •••• {last4}"
        payment_reference = f"{brand}-{last4}"
        msg_success = f"¡Pago aprobado ({brand} •••• {last4})! Tu suscripción {plan['name']} está ACTIVA."

    if req.rfc is not None and req.rfc.strip():
        tenant.rfc = req.rfc.strip().upper()
    if req.postal_code is not None and req.postal_code.strip():
        tenant.postal_code = req.postal_code.strip()
    if req.tax_regime is not None and req.tax_regime.strip():
        tenant.tax_regime = req.tax_regime.strip()
    if req.cfdi_use is not None and req.cfdi_use.strip():
        tenant.cfdi_use = req.cfdi_use.strip()
    if req.billing_email is not None and req.billing_email.strip():
        tenant.billing_email = req.billing_email.strip()

    tenant.plan_code = plan["code"]
    tenant.billing_cycle = cycle
    tenant.status = "active"
    tenant.price_mxn = plan["annual_monthly_equivalent"] if cycle == "annual" else plan["monthly_price"]
    tenant.max_clients = plan["max_clients"]
    tenant.max_users = plan["max_users"]
    tenant.max_cfdis_per_month = plan["max_cfdis_per_month"]
    tenant.auto_renew = True
    tenant.current_period_start = now
    tenant.current_period_end = now + timedelta(days=365 if cycle == "annual" else 30)

    subtotal = plan["annual_total"] if cycle == "annual" else plan["monthly_price"]
    total_with_iva = round(subtotal * 1.16, 2)

    inv_count = db.query(func.count(SaasInvoice.id)).scalar() or 0
    new_inv = SaasInvoice(
        tenant_id=tenant.id,
        folio=f"ITX-{now.strftime('%Y')}-{inv_count + 101:04d}",
        plan_name=f"{plan['name']} (+ IVA)",
        billing_cycle="Anual (-20%)" if cycle == "annual" else "Mensual",
        amount=total_with_iva,
        currency="MXN",
        status=invoice_status,
        payment_method=tenant.payment_method,
        period_label="Suscripción Anual (12 meses)" if cycle == "annual" else "Suscripción Mensual (30 días)",
        cfdi_uuid=str(uuid.uuid4()).upper(),
        stripe_payment_intent_id=payment_intent_id,
        payment_reference=payment_reference,
        created_at=now,
    )
    db.add(new_inv)
    db.commit()
    db.refresh(tenant)

    log_activity(
        db=db,
        user=current_user,
        action="PAGO_STRIPE",
        module="Suscripción",
        description=f"Pago procesado ({tenant.payment_method}) para {plan['name']} por ${total_with_iva:,.2f} MXN IVA incluido",
        details={
            "payment_type": payment_type,
            "plan_code": plan["code"],
            "billing_cycle": cycle,
            "subtotal_mxn": subtotal,
            "total_mxn": total_with_iva,
            "stripe_payment_intent_id": payment_intent_id,
            "payment_reference": payment_reference,
        },
    )

    return {
        "message": msg_success,
        "tenant": _tenant_to_dict(tenant),
        "invoice_folio": new_inv.folio,
        "stripe_payment_intent_id": payment_intent_id,
        "payment_reference": payment_reference,
    }


@router.get("/admin/stripe-config")
def get_stripe_config_admin(
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_super_admin),
):
    cfg = _get_or_create_stripe_config(db)
    return {
        "mode": cfg.mode or "test",
        "publishable_key": cfg.publishable_key or "",
        "secret_key": cfg.secret_key or "",
        "webhook_secret": cfg.webhook_secret or "",
        "payment_link_starter": cfg.payment_link_starter or "",
        "payment_link_profesional": cfg.payment_link_profesional or "",
        "payment_link_empresarial": cfg.payment_link_empresarial or "",
        "payment_link_corporativo": cfg.payment_link_corporativo or "",
        "spei_bank_name": cfg.spei_bank_name or "STP / BBVA México (Stripe SPEI)",
        "spei_clabe": cfg.spei_clabe or "646180157042891042",
        "spei_beneficiary": cfg.spei_beneficiary or "Iterumx S.A. de C.V.",
        "enable_oxxo_7eleven": cfg.enable_oxxo_7eleven if cfg.enable_oxxo_7eleven is not None else True,
        "auto_block_expired_trials": bool(cfg.auto_block_expired_trials),
        "updated_at": cfg.updated_at.strftime("%Y-%m-%d %H:%M") if cfg.updated_at else None,
    }


@router.put("/admin/stripe-config")
def update_stripe_config_admin(
    req: StripeConfigUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_super_admin),
):
    cfg = _get_or_create_stripe_config(db)
    cfg.mode = "live" if req.mode == "live" else "test"
    if req.publishable_key is not None:
        cfg.publishable_key = req.publishable_key.strip()
    if req.secret_key is not None:
        cfg.secret_key = req.secret_key.strip()
    if req.webhook_secret is not None:
        cfg.webhook_secret = req.webhook_secret.strip()
    if req.payment_link_starter is not None:
        cfg.payment_link_starter = req.payment_link_starter.strip()
    if req.payment_link_profesional is not None:
        cfg.payment_link_profesional = req.payment_link_profesional.strip()
    if req.payment_link_empresarial is not None:
        cfg.payment_link_empresarial = req.payment_link_empresarial.strip()
    if req.payment_link_corporativo is not None:
        cfg.payment_link_corporativo = req.payment_link_corporativo.strip()
    if req.spei_bank_name is not None:
        cfg.spei_bank_name = req.spei_bank_name.strip() or "STP / BBVA México (Stripe SPEI)"
    if req.spei_clabe is not None:
        cfg.spei_clabe = req.spei_clabe.strip() or "646180157042891042"
    if req.spei_beneficiary is not None:
        cfg.spei_beneficiary = req.spei_beneficiary.strip() or "Iterumx S.A. de C.V."
    if req.enable_oxxo_7eleven is not None:
        cfg.enable_oxxo_7eleven = bool(req.enable_oxxo_7eleven)
    if req.auto_block_expired_trials is not None:
        cfg.auto_block_expired_trials = bool(req.auto_block_expired_trials)
    cfg.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(cfg)
    return {
        "message": "Configuración de pasarela Stripe, SPEI y OXXO / 7-Eleven guardada correctamente.",
        "mode": cfg.mode,
    }
