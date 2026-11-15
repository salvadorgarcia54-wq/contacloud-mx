from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional, List, Dict, Any
from datetime import date, datetime
import calendar
import unicodedata
import re

from database import get_db
from models.user import User
from models.client import Client
from models.account import Account, SATAccountGroup
from models.journal import JournalEntry, JournalLine
from models.cfdi import CFDIInvoice
from routers.auth import get_current_user

router = APIRouter(prefix="/api/iterumbot", tags=["iterumbot"])

MONTHS_ES = {
    1: "Enero",
    2: "Febrero",
    3: "Marzo",
    4: "Abril",
    5: "Mayo",
    6: "Junio",
    7: "Julio",
    8: "Agosto",
    9: "Septiembre",
    10: "Octubre",
    11: "Noviembre",
    12: "Diciembre",
}

MONTH_NAME_TO_INT = {
    "enero": 1,
    "ene": 1,
    "febrero": 2,
    "feb": 2,
    "marzo": 3,
    "mar": 3,
    "abril": 4,
    "abr": 4,
    "mayo": 5,
    "may": 5,
    "junio": 6,
    "jun": 6,
    "julio": 7,
    "jul": 7,
    "agosto": 8,
    "ago": 8,
    "septiembre": 9,
    "setiembre": 9,
    "sep": 9,
    "octubre": 10,
    "oct": 10,
    "noviembre": 11,
    "nov": 11,
    "diciembre": 12,
    "dic": 12,
}

# Catálogo experto de sugerencias de cuentas de gastos 601-xx-xxx y topes LISR / LIVA
SAT_EXPENSE_AND_TAX_KNOWLEDGE = [
    {
        "keywords": ["automovil", "automoviles", "auto", "autos", "coche", "vehiculo", "vehiculos", "camioneta", "arrendamiento de auto", "leasing"],
        "title": "Automóviles, Equipo de Transporte y Arrendamiento (Art. 28 fracc. XIII y Art. 36 fracc. II LISR)",
        "sat_accounts": [
            {"code": "154-01-000", "sat_code": "154.01", "name": "Automóviles, autobuses, camiones de carga y tractocamiones (Activo Fijo)"},
            {"code": "601-55-000", "sat_code": "601.55", "name": "Mantenimiento y conservación de equipo de transporte"},
            {"code": "601-46-000", "sat_code": "601.46", "name": "Arrendamiento de equipo de transporte (personas morales / físicas)"},
            {"code": "601-83-000", "sat_code": "601.83", "name": "Gastos no deducibles (por el excedente del tope fiscal)"},
        ],
        "lisr_rules": [
            "Tope de inversión deducible (Art. 36 fracc. II LISR): Hasta $175,000.00 MXN para automóviles de combustión interna.",
            "Automóviles eléctricos, híbridos o de hidrógeno: Tope ampliado hasta $250,000.00 MXN.",
            "Tope en arrendamiento puro / leasing (Art. 28 fracc. XIII LISR): Hasta $200.00 MXN diarios por vehículo de combustión interna, o hasta $285.00 MXN diarios para eléctricos/híbridos.",
            "Proporción deducible de gastos e IVA (Art. 5 LIVA): Los combustibles, mantenimiento, seguros y el IVA acreditable sólo son deducibles/acreditables en la proporción que represente el tope ($175,000 o $250,000) frente al valor original de la inversión (MOI).",
        ],
    },
    {
        "keywords": ["viatico", "viaticos", "viaje", "viajes", "hospedaje", "hotel", "boleto de avion", "avion", "alimentacion", "kilometraje"],
        "title": "Viáticos y Gastos de Viaje (Art. 28 fracc. V LISR)",
        "sat_accounts": [
            {"code": "601-49-000", "sat_code": "601.49", "name": "Viáticos y gastos de viaje (alimentación, hospedaje y transporte foráneo)"},
            {"code": "601-83-000", "sat_code": "601.83", "name": "Gastos no deducibles (excedentes de topes diarios de viáticos)"},
        ],
        "lisr_rules": [
            "Faja de distancia mínima: Deben erogarse fuera de una faja de 50 kilómetros que circunde el establecimiento del contribuyente.",
            "Relación laboral o de servicios: El beneficiario debe tener relación de trabajo con la empresa o prestar servicios profesionales.",
            "Tope en Alimentación: Hasta $750.00 MXN diarios por beneficiario en territorio nacional y hasta $1,500.00 MXN diarios en el extranjero (acompañado de CFDI de hospedaje o transporte).",
            "Tope en Hospedaje: Sin límite en territorio nacional; en el extranjero hasta $3,850.00 MXN diarios (acompañado de comprobante de transporte).",
            "Tope en Renta de Automóvil en viaje: Hasta $850.00 MXN diarios en México o en el extranjero (acompañado de hospedaje o transporte).",
        ],
    },
    {
        "keywords": ["restaurante", "restaurantes", "consumo", "comida", "alimentos", "bar", "comedor", "atencion a clientes"],
        "title": "Consumos en Restaurantes y Bares (Art. 28 fracc. XX LISR)",
        "sat_accounts": [
            {"code": "601-50-000", "sat_code": "601.50", "name": "Atención a clientes / Consumos en restaurantes (8.5% deducible)"},
            {"code": "601-83-000", "sat_code": "601.83", "name": "Gastos no deducibles (91.5% no deducible en consumos de restaurante)"},
        ],
        "lisr_rules": [
            "Consumos en bares: 100% NO deducibles en ningún caso.",
            "Consumos en restaurantes: Sólo es deducible el 8.5% del consumo (el 91.5% restante es NO deducible y debe enviarse a la cuenta 601-83 Gastos no deducibles).",
            "Requisito obligatorio de pago: Para deducir el 8.5%, el pago debe realizarse exclusivamente mediante tarjeta de crédito, débito, servicios o monedero electrónico autorizado (nunca en efectivo).",
            "IVA Acreditable (Art. 5 fracc. I LIVA): El IVA del consumo en restaurante sólo es acreditable en la misma proporción deducible para ISR (8.5%).",
            "Excepción: Si cumplen todos los requisitos de Viáticos y Gastos de Viaje (>50 km, relación laboral y comprobante de transporte/hospedaje), aplican los límites de viáticos ($750/día).",
        ],
    },
    {
        "keywords": ["gasolina", "combustible", "combustibles", "diesel", "lubricante", "lubricantes", "peaje", "casetas"],
        "title": "Combustibles y Lubricantes (Art. 27 fracc. III LISR)",
        "sat_accounts": [
            {"code": "601-48-000", "sat_code": "601.48", "name": "Combustibles y lubricantes"},
            {"code": "601-57-000", "sat_code": "601.57", "name": "Peajes y transporte local"},
        ],
        "lisr_rules": [
            "Requisito estricto (Art. 27 fracc. III LISR): Todo gasto en combustibles para vehículos marítimos, aéreos y terrestres debe pagarse SIEMPRE con tarjeta de crédito/débito, transferencia SPEI, cheque nominativo o monedero electrónico autorizado por el SAT, incluso si el monto es menor a $2,000.00 MXN.",
            "Si se paga en efectivo (Forma de pago '01' en el CFDI), es 100% NO deducible para ISR y su IVA NO es acreditable.",
        ],
    },
    {
        "keywords": ["honorario", "honorarios", "asimilados", "abogado", "contador", "consultoria", "asesoria", "persona fisica"],
        "title": "Honorarios, Asesoría y Servicios Profesionales (Art. 27 fracc. VIII y Art. 106 LISR)",
        "sat_accounts": [
            {"code": "601-26-000", "sat_code": "601.26", "name": "Honorarios a personas físicas residentes en el país"},
            {"code": "601-28-000", "sat_code": "601.28", "name": "Honorarios a personas morales"},
            {"code": "601-30-000", "sat_code": "601.30", "name": "Honorarios y asistencia técnica"},
            {"code": "216-03-000", "sat_code": "216.03", "name": "Retenciones de ISR por servicios profesionales (10%) / RESICO (1.25%)"},
            {"code": "216-10-000", "sat_code": "216.10", "name": "Retenciones de IVA (2/3 partes = 10.6667%)"},
        ],
        "lisr_rules": [
            "Deducción al cobro efectivo (Art. 27 fracc. VIII LISR): Los pagos a personas físicas, contribuyentes del RESICO o Sociedades Civiles (S.C.) sólo son deducibles cuando hayan sido efectivamente erogados en el ejercicio.",
            "Retenciones cuando una Persona Moral paga a Persona Física: Retención del 10% de ISR (o 1.25% si la PF tributa en RESICO) y 2/3 partes del IVA (10.6667%).",
        ],
    },
    {
        "keywords": ["papeleria", "oficina", "telefono", "internet", "luz", "cfe", "agua", "limpieza", "seguros", "fianzas", "publicidad", "propaganda", "arrendamiento", "renta", "sueldos", "nomina", "imss", "infonavit", "601"],
        "title": "Guía Rápida de Cuentas de Gastos Generales (Código Agrupador SAT 601.xx)",
        "sat_accounts": [
            {"code": "601-01-000", "sat_code": "601.01", "name": "Sueldos y salarios"},
            {"code": "601-26-000", "sat_code": "601.26", "name": "Honorarios a personas físicas"},
            {"code": "601-45-000", "sat_code": "601.45", "name": "Arrendamiento de inmuebles (Renta de oficinas/locales)"},
            {"code": "601-48-000", "sat_code": "601.48", "name": "Combustibles y lubricantes"},
            {"code": "601-49-000", "sat_code": "601.49", "name": "Viáticos y gastos de viaje"},
            {"code": "601-51-000", "sat_code": "601.51", "name": "Agua"},
            {"code": "601-52-000", "sat_code": "601.52", "name": "Energía eléctrica (CFE)"},
            {"code": "601-53-000", "sat_code": "601.53", "name": "Vigilancia y seguridad"},
            {"code": "601-54-000", "sat_code": "601.54", "name": "Limpieza"},
            {"code": "601-55-000", "sat_code": "601.55", "name": "Mantenimiento y conservación"},
            {"code": "601-56-000", "sat_code": "601.56", "name": "Papelería y artículos de oficina"},
            {"code": "601-57-000", "sat_code": "601.57", "name": "Seguros y fianzas"},
            {"code": "601-66-000", "sat_code": "601.66", "name": "Propaganda y publicidad (Marketing)"},
            {"code": "601-68-000", "sat_code": "601.68", "name": "Teléfonos, internet y telecomunicaciones"},
            {"code": "601-83-000", "sat_code": "601.83", "name": "Gastos no deducibles (Sin requisitos fiscales)"},
            {"code": "601-84-000", "sat_code": "601.84", "name": "Otros gastos generales"},
        ],
        "lisr_rules": [
            "Estrictamente indispensables (Art. 27 fracc. I LISR): El gasto debe estar vinculado al giro del negocio y amparado con CFDI 4.0 vigente.",
            "Pagos mayores a $2,000.00 MXN (Art. 27 fracc. III LISR): Deben efectuarse mediante transferencia electrónica (SPEI), cheque nominativo o tarjeta bancaria para ser deducibles.",
        ],
    },
]


def _normalize(text: str) -> str:
    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _format_mxn(val: float) -> str:
    return f"${float(val or 0.0):,.2f} MXN"


def _resolve_period_from_text(
    db: Session,
    client_id: Optional[int],
    query_text: str,
    explicit_year: Optional[int] = None,
    explicit_month: Optional[int] = None,
) -> tuple[int, int]:
    norm = _normalize(query_text)
    detected_year = explicit_year
    detected_month = explicit_month

    year_match = re.search(r"\b(202[3-9])\b", norm)
    if year_match:
        detected_year = int(year_match.group(1))

    for m_name, m_num in MONTH_NAME_TO_INT.items():
        if re.search(rf"\b{m_name}\b", norm):
            detected_month = m_num
            break

    today = date.today()
    latest_entry = None
    if client_id:
        latest_entry = (
            db.query(JournalEntry)
            .filter(JournalEntry.client_id == client_id, JournalEntry.is_cancelled == False)
            .order_by(JournalEntry.date.desc())
            .first()
        )

    eff_year = detected_year or (latest_entry.date.year if latest_entry and latest_entry.date else today.year)
    eff_month = (
        detected_month
        if (detected_month and 1 <= detected_month <= 12)
        else (latest_entry.date.month if latest_entry and latest_entry.date else today.month)
    )
    return eff_year, eff_month


def _build_client_audit(db: Session, client_id: int, year: int, month: int) -> Dict[str, Any]:
    """
    Ejecuta la Auditoría Automática de Anomalías con IA sobre el cliente activo:
    1. Saldos contrarios a su naturaleza (Bancos/Caja en negativo, Clientes en negativo, IVA pendiente negativo, etc.).
    2. CFDIs cargados en el mes (y en el año) que aún no tienen póliza contable generada.
    3. Revisión de partida doble en balanza.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    first_day_month = date(year, month, 1)
    last_day_month = date(year, month, calendar.monthrange(year, month)[1])

    # 1. Evaluar saldos acumulados al corte del periodo por cuenta de mayor y subcuenta
    acc_balances = (
        db.query(
            Account.id,
            Account.account_number,
            Account.name,
            Account.nature,
            Account.sat_group_code,
            func.sum(JournalLine.debit).label("deb"),
            func.sum(JournalLine.credit).label("cred"),
        )
        .join(JournalLine, JournalLine.account_id == Account.id)
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date <= last_day_month,
            JournalEntry.is_cancelled == False,
        )
        .group_by(
            Account.id,
            Account.account_number,
            Account.name,
            Account.nature,
            Account.sat_group_code,
        )
        .all()
    )

    contrary_balances = []
    for acc_id, acc_num, acc_name, acc_nat, sat_code, deb_val, cred_val in acc_balances:
        num = (acc_num or "").strip()
        if not num or num[0] not in ("1", "2", "3"):
            continue
        # Ignorar cuentas complementarias de activo (Depreciación acumulada 171 / Estimación cobro dudoso 108)
        if num.startswith(("171", "172", "173", "108", "304", "305")):
            continue

        d = float(deb_val or 0.0)
        c = float(cred_val or 0.0)
        nat_lower = (acc_nat or "").lower()
        is_deudora = "deud" in nat_lower or (num[0] == "1" and "acreed" not in nat_lower)

        saldo = round((d - c) if is_deudora else (c - d), 2)
        if saldo < -0.05:
            if num.startswith("101"):
                cause = "Caja / Efectivo con saldo negativo (salidas mayores a las entradas registradas)."
            elif num.startswith("102"):
                cause = "Cuenta bancaria en negativo (sobregiro contable o depósitos pendientes de contabilizar)."
            elif num.startswith("105"):
                cause = "Cliente con saldo negativo (cobros duplicados o complementos aplicados sin factura origen)."
            elif num.startswith(("118", "119")):
                cause = "IVA acreditable / pendiente de acreditar en negativo (traspaso mayor al IVA pagado en CFDI)."
            elif num.startswith("201"):
                cause = "Proveedor con saldo negativo / deudor (pagos registrados mayores a los CFDIs recibidos)."
            elif num.startswith(("208", "209")):
                cause = "IVA trasladado con saldo contrario a su naturaleza acreedora."
            else:
                cause = f"Saldo contrario a su naturaleza ({'Deudora' if is_deudora else 'Acreedora'})."

            contrary_balances.append({
                "account_id": acc_id,
                "account_number": num,
                "name": acc_name,
                "nature": "Deudora" if is_deudora else "Acreedora",
                "balance": saldo,
                "explanation": cause,
            })

    # 2. CFDIs sin póliza contable (del mes seleccionado y totales)
    unposted_month_cfdis = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.date >= datetime.combine(first_day_month, datetime.min.time()),
            CFDIInvoice.date <= datetime.combine(last_day_month, datetime.max.time()),
            or_(CFDIInvoice.is_posted == False, CFDIInvoice.journal_entry_id == None),
        )
        .order_by(CFDIInvoice.date.desc())
        .all()
    )

    unposted_all_cfdis = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            or_(CFDIInvoice.is_posted == False, CFDIInvoice.journal_entry_id == None),
        )
        .order_by(CFDIInvoice.date.desc())
        .all()
    )

    def _serialize_cfdi(inv: CFDIInvoice) -> Dict[str, Any]:
        counterparty = inv.receiver_name if inv.cfdi_type == "emitido" else inv.issuer_name
        counterparty_rfc = inv.receiver_rfc if inv.cfdi_type == "emitido" else inv.issuer_rfc
        return {
            "id": inv.id,
            "uuid": inv.uuid,
            "folio": inv.folio or (inv.uuid or "")[:8],
            "date": inv.date.strftime("%Y-%m-%d") if inv.date else "",
            "cfdi_type": inv.cfdi_type,
            "tipo_comprobante": inv.tipo_comprobante or "I",
            "payment_method": inv.payment_method or "PUE",
            "counterparty_rfc": counterparty_rfc or "S/RFC",
            "counterparty_name": counterparty or "Sin nombre",
            "total": round(float(inv.total or 0.0), 2),
        }

    # 3. Proveedores y clientes con facturas PPD sin complemento de pago (tipo 'P')
    ppd_invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.payment_method == "PPD",
            or_(CFDIInvoice.tipo_comprobante == "I", CFDIInvoice.tipo_comprobante == None),
        )
        .all()
    )
    payment_complements = (
        db.query(CFDIInvoice)
        .filter(CFDIInvoice.client_id == client_id, CFDIInvoice.tipo_comprobante == "P")
        .all()
    )
    covered_uuids = {
        (p.related_uuid or "").strip().upper() for p in payment_complements if p.related_uuid
    }
    ppd_pending = [
        inv for inv in ppd_invoices if (inv.uuid or "").strip().upper() not in covered_uuids
    ]
    ppd_providers_map: Dict[str, Dict[str, Any]] = {}
    for inv in ppd_pending:
        if inv.cfdi_type == "recibido":
            key = inv.issuer_rfc or "SIN-RFC"
            if key not in ppd_providers_map:
                ppd_providers_map[key] = {
                    "rfc": key,
                    "name": inv.issuer_name or key,
                    "count": 0,
                    "total": 0.0,
                }
            ppd_providers_map[key]["count"] += 1
            ppd_providers_map[key]["total"] = round(
                ppd_providers_map[key]["total"] + float(inv.total or 0.0), 2
            )

    ppd_providers_list = sorted(
        ppd_providers_map.values(), key=lambda x: x["total"], reverse=True
    )

    return {
        "client": {
            "id": client.id,
            "rfc": client.rfc,
            "business_name": client.business_name,
        },
        "period": {
            "year": year,
            "month": month,
            "month_name": MONTHS_ES.get(month, ""),
            "label": f"{MONTHS_ES.get(month, '')} {year}",
        },
        "contrary_balances_count": len(contrary_balances),
        "contrary_balances": contrary_balances[:15],
        "unposted_month_count": len(unposted_month_cfdis),
        "unposted_month_total": round(sum(float(c.total or 0.0) for c in unposted_month_cfdis), 2),
        "unposted_month_items": [_serialize_cfdi(c) for c in unposted_month_cfdis[:10]],
        "unposted_all_count": len(unposted_all_cfdis),
        "unposted_all_total": round(sum(float(c.total or 0.0) for c in unposted_all_cfdis), 2),
        "unposted_all_items": [_serialize_cfdi(c) for c in unposted_all_cfdis[:10]],
        "ppd_pending_count": len(ppd_pending),
        "ppd_pending_total": round(sum(float(c.total or 0.0) for c in ppd_pending), 2),
        "ppd_providers": ppd_providers_list[:10],
    }


class IterumbotChatRequest(BaseModel):
    message: str
    client_id: Optional[int] = None
    year: Optional[int] = None
    month: Optional[int] = None


@router.get("/audit/{client_id}")
def get_iterumbot_audit(
    client_id: int,
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    eff_year, eff_month = _resolve_period_from_text(db, client_id, "", year, month)
    return _build_client_audit(db, client_id, eff_year, eff_month)


@router.post("/chat")
def chat_with_iterumbot(
    req: IterumbotChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Motor Conversacional de Iterumbot — Copiloto Contable y Fiscal con IA:
    1. Consultas en lenguaje natural sobre el cliente activo (Utilidad, Ingresos/Egresos, Proveedores PPD, IVA a cargo/favor, Bancos).
    2. Auditoría automática de anomalías con IA (Saldos contrarios a su naturaleza y CFDIs sin póliza).
    3. Asesoría de Código Agrupador SAT (601-xx-xxx) y topes LISR / LIVA.
    """
    raw_msg = (req.message or "").strip()
    norm = _normalize(raw_msg)

    eff_client_id = req.client_id or (current_user.client_id if current_user.role == "client" else None)
    eff_year, eff_month = _resolve_period_from_text(db, eff_client_id, raw_msg, req.year, req.month)
    month_label = f"{MONTHS_ES.get(eff_month, '')} {eff_year}"

    client = db.query(Client).filter(Client.id == eff_client_id).first() if eff_client_id else None

    # =========================================================================
    # CASO 1: ASESORÍA DE CÓDIGO AGRUPADOR SAT (601-xx-xxx) Y TOPES LISR / LIVA
    # =========================================================================
    for topic in SAT_EXPENSE_AND_TAX_KNOWLEDGE:
        if any(kw in norm for kw in topic["keywords"]):
            lines_md = [
                f"### 📚 Asesoría Fiscal y Contable — {topic['title']}",
                "",
                "#### 1. Cuentas Contables y Código Agrupador SAT Recomendados:",
            ]
            # Si hay cliente activo, verificar si esas cuentas existen en su catálogo real
            client_acc_map = {}
            if client:
                c_accs = db.query(Account).filter(Account.client_id == client.id).all()
                client_acc_map = {a.account_number: a.name for a in c_accs}

            for acc in topic["sat_accounts"]:
                in_catalog = " *(Activa en catálogo del cliente)*" if acc["code"] in client_acc_map else ""
                lines_md.append(
                    f"- **`{acc['code']}`** (Agrupador SAT `{acc['sat_code']}`): {acc['name']}{in_catalog}"
                )

            lines_md.append("")
            lines_md.append("#### 2. Reglas de Deducibilidad (LISR) y Acreditamiento (LIVA):")
            for rule in topic["lisr_rules"]:
                lines_md.append(f"- {rule}")

            return {
                "bot_name": "Iterumbot",
                "intent": "sat_lisr_advisor",
                "reply": "\n".join(lines_md),
                "quick_links": (
                    [{"label": "Ir al Catálogo de Cuentas", "path": f"/accounts/{client.id}"}]
                    if client
                    else []
                ),
            }

    # Si pregunta específicamente por una cuenta del catálogo SAT
    if any(w in norm for w in ["codigo agrupador", "agrupador sat", "a que cuenta", "que cuenta 601", "tope de deducibilidad", "deducibilidad", "lisr"]):
        sat_matches = (
            db.query(SATAccountGroup)
            .filter(SATAccountGroup.code.startswith("601"))
            .limit(12)
            .all()
        )
        lines_md = [
            "### 📚 Asesoría de Código Agrupador SAT (`601-xx-xxx`) y LISR / LIVA",
            "Para clasificar gastos generales de operación conforme al Anexo 24 del SAT y la LISR:",
            "",
            "- **Automóviles (Art. 36 fracc. II y 28 fracc. XIII LISR)**: Tope de inversión de **$175,000 MXN** (combustión) o **$250,000 MXN** (eléctricos/híbridos). Renta diaria hasta **$200 / $285 MXN**.",
            "- **Viáticos y Gastos de Viaje (Art. 28 fracc. V LISR)**: Fuera de faja de 50 km. Alimentación hasta **$750 MXN/día** en México y **$1,500 MXN/día** en el extranjero.",
            "- **Consumos en Restaurantes (Art. 28 fracc. XX LISR)**: Sólo **8.5% deducible** pagando con tarjeta (el **91.5%** va a `601-83-000 Gastos no deducibles`).",
            "",
            "#### Principales subcuentas del rubro `601 Gastos Generales`:",
        ]
        for sg in sat_matches:
            sub = sg.code.split(".")[1] if "." in sg.code else "00"
            lines_md.append(f"- **`601-{sub}-000`** (SAT `{sg.code}`): {sg.name}")
        return {
            "bot_name": "Iterumbot",
            "intent": "sat_lisr_advisor",
            "reply": "\n".join(lines_md),
            "quick_links": (
                [{"label": "Ver Catálogo de Cuentas", "path": f"/accounts/{client.id}"}]
                if client
                else []
            ),
        }

    # Para consultas financieras o de auditoría del cliente activo, verificar que haya un cliente seleccionado
    if not client:
        return {
            "bot_name": "Iterumbot",
            "intent": "no_client_selected",
            "reply": (
                "Hola, soy **Iterumbot**, tu Copiloto Contable y Fiscal con IA.\n\n"
                "Para responder consultas sobre **utilidad acumulada, proveedores con PPD pendientes, cálculo de IVA o auditoría de anomalías**, "
                "selecciona primero una empresa en el selector superior de la pantalla de **Inicio**.\n\n"
                "Mientras tanto, puedes preguntarme cualquier duda de **Código Agrupador SAT (`601-xx-xxx`) o topes de deducibilidad LISR / LIVA** (automóviles, viáticos, restaurantes, combustibles, honorarios)."
            ),
            "quick_links": [{"label": "Ir a Inicio para seleccionar cliente", "path": "/"}],
        }

    # =========================================================================
    # CASO 2: AUDITORÍA AUTOMÁTICA DE ANOMALÍAS CON IA
    # =========================================================================
    if any(
        w in norm
        for w in [
            "auditoria",
            "anomalia",
            "anomalias",
            "naturaleza",
            "negativo",
            "negativos",
            "sin poliza",
            "sin contabilizar",
            "revisar contabilidad",
        ]
    ):
        audit = _build_client_audit(db, client.id, eff_year, eff_month)
        lines_md = [
            f"### 🔍 Auditoría Automática con IA — {client.rfc} ({client.business_name})",
            f"Periodo auditado: **{audit['period']['label']}**",
            "",
            f"#### 1. Saldos Contrarios a su Naturaleza ({audit['contrary_balances_count']} detectados):",
        ]
        if audit["contrary_balances"]:
            for cb in audit["contrary_balances"][:8]:
                lines_md.append(
                    f"- ⚠️ **`{cb['account_number']}` {cb['name']}** ({cb['nature']}): Saldo **{_format_mxn(cb['balance'])}** — *{cb['explanation']}*"
                )
        else:
            lines_md.append(
                "- ✅ Todas las cuentas de Activo, Pasivo y Capital respetan su naturaleza contable al corte del periodo."
            )

        lines_md.append("")
        lines_md.append(
            f"#### 2. CFDIs sin Póliza Contable Generada ({audit['unposted_month_count']} en {audit['period']['month_name']} / {audit['unposted_all_count']} acumulados):"
        )
        if audit["unposted_month_items"]:
            for cf in audit["unposted_month_items"][:6]:
                lines_md.append(
                    f"- 📄 **{cf['date']}** | `{cf['cfdi_type'].upper()}` | **{cf['counterparty_name']}** ({cf['counterparty_rfc']}) | **{_format_mxn(cf['total'])}**"
                )
        elif audit["unposted_all_items"]:
            lines_md.append(
                f"- En **{audit['period']['label']}** no hay CFDIs pendientes, pero existen **{audit['unposted_all_count']} CFDI(s)** sin póliza en otros meses por **{_format_mxn(audit['unposted_all_total'])}**:"
            )
            for cf in audit["unposted_all_items"][:5]:
                lines_md.append(
                    f"  - 📄 **{cf['date']}** | `{cf['cfdi_type'].upper()}` | **{cf['counterparty_name']}** | **{_format_mxn(cf['total'])}**"
                )
        else:
            lines_md.append("- ✅ El 100% de los CFDIs cargados cuentan con su póliza contable generada.")

        return {
            "bot_name": "Iterumbot",
            "intent": "anomaly_audit",
            "reply": "\n".join(lines_md),
            "audit_data": audit,
            "quick_links": [
                {"label": "Ver Balanza de Comprobación", "path": f"/trial-balance/{client.id}"},
                {"label": "Ir a Cargar / Contabilizar CFDI", "path": f"/cfdi-upload/{client.id}"},
            ],
        }

    # =========================================================================
    # CASO 3: PROVEEDORES / FACTURAS PPD PENDIENTES DE COMPLEMENTO DE PAGO
    # =========================================================================
    if any(w in norm for w in ["ppd", "complemento", "complementos", "rep", "proveedor", "proveedores"]):
        audit = _build_client_audit(db, client.id, eff_year, eff_month)
        lines_md = [
            f"### 📑 Facturas PPD Pendientes de Complemento de Pago (REP) — {client.rfc}",
            f"Cliente activo: **{client.business_name}**",
            "",
            f"- **Total de CFDIs PPD sin complemento relacionado**: **{audit['ppd_pending_count']} comprobante(s)**",
            f"- **Importe total pendiente de REP**: **{_format_mxn(audit['ppd_pending_total'])}**",
            "",
            "#### Proveedores con Facturas PPD Pendientes de Complemento de Pago:",
        ]
        if audit["ppd_providers"]:
            for idx, prov in enumerate(audit["ppd_providers"][:10], start=1):
                lines_md.append(
                    f"{idx}. **{prov['name']}** (`{prov['rfc']}`) — **{prov['count']} CFDI(s) PPD** por **{_format_mxn(prov['total'])}**"
                )
        else:
            lines_md.append(
                "- ✅ No se encontraron proveedores con facturas recibidas PPD pendientes de complemento de pago."
            )

        return {
            "bot_name": "Iterumbot",
            "intent": "ppd_providers",
            "reply": "\n".join(lines_md),
            "quick_links": [
                {"label": "Abrir Módulo de Complementos de Pago", "path": f"/fiscal-complementos/{client.id}"},
            ],
        }

    # =========================================================================
    # CASO 4: CÁLCULO DE IVA A CARGO O A FAVOR DEL MES
    # =========================================================================
    if "iva" in norm:
        first_day = date(eff_year, eff_month, 1)
        last_day = date(eff_year, eff_month, calendar.monthrange(eff_year, eff_month)[1])

        iva_lines = (
            db.query(
                Account.account_number,
                func.sum(JournalLine.debit).label("deb"),
                func.sum(JournalLine.credit).label("cred"),
            )
            .join(JournalLine, JournalLine.account_id == Account.id)
            .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
            .filter(
                JournalEntry.client_id == client.id,
                JournalEntry.date >= first_day,
                JournalEntry.date <= last_day,
                JournalEntry.is_cancelled == False,
                ~JournalEntry.description.ilike("%Traspasos de IVA del mes%"),
            )
            .group_by(Account.account_number)
            .all()
        )

        iva_trasladado_208 = 0.0
        iva_acreditable_118 = 0.0
        iva_retenido = 0.0

        for acc_num, deb_val, cred_val in iva_lines:
            num = acc_num or ""
            d = float(deb_val or 0.0)
            c = float(cred_val or 0.0)
            if num.startswith("208-01"):
                iva_trasladado_208 += (c - d)
            elif num.startswith("118-01"):
                iva_acreditable_118 += (d - c)
            elif num.startswith("210-05") or num.startswith("216-10"):
                iva_retenido += (c - d)

        iva_neto = round(iva_trasladado_208 - iva_acreditable_118 - iva_retenido, 2)
        if iva_neto > 0:
            resultado_label = f"IVA A CARGO del periodo por {_format_mxn(iva_neto)}"
        elif iva_neto < 0:
            resultado_label = f"IVA A FAVOR del periodo por {_format_mxn(abs(iva_neto))}"
        else:
            resultado_label = "Sin saldo de IVA a cargo ni a favor ($0.00 MXN)"

        lines_md = [
            f"### 🧮 Determinación de IVA en {month_label} — {client.rfc} ({client.business_name})",
            "",
            f"- **IVA Trasladado Cobrado (`208-01`)**: **{_format_mxn(iva_trasladado_208)}**",
            f"- **(-) IVA Acreditable Pagado (`118-01`)**: **{_format_mxn(iva_acreditable_118)}**",
            f"- **(-) Retenciones de IVA**: **{_format_mxn(iva_retenido)}**",
            f"- **Resultado del Periodo ({month_label})**: **{resultado_label}**",
        ]
        return {
            "bot_name": "Iterumbot",
            "intent": "iva_query",
            "reply": "\n".join(lines_md),
            "quick_links": [
                {"label": "Ver Papel de Trabajo de IVA", "path": f"/fiscal-iva/{client.id}"},
                {"label": "Ver Conciliación IVA Acreditable", "path": f"/fiscal-conciliacion-iva/{client.id}"},
            ],
        }

    # =========================================================================
    # CASO 5: UTILIDAD ACUMULADA / INGRESOS / EGRESOS / BANCOS DEL CLIENTE ACTIVO
    # =========================================================================
    from routers.reports import get_executive_dashboard

    exec_summary = get_executive_dashboard(
        client_id=client.id,
        year=eff_year,
        month=eff_month,
        db=db,
        current_user=current_user,
    )
    kpis = exec_summary.get("kpis", {})
    p_info = exec_summary.get("period", {})

    lines_md = [
        f"### 📊 Resumen Financiero y Fiscal en Vivo — {client.rfc} ({client.business_name})",
        f"Periodo consultado: **{p_info.get('label', month_label)}**",
        "",
        f"- **Utilidad Neta Acumulada ({eff_year})**: **{_format_mxn(kpis.get('utilidad_neta_acumulada', 0))}**",
        f"- **Ingresos Acumulados ({eff_year})**: **{_format_mxn(kpis.get('ingresos_acumulados', 0))}**",
        f"- **Egresos Acumulados ({eff_year})**: **{_format_mxn(kpis.get('egresos_acumulados', 0))}**",
        f"- **Resultado del Mes ({p_info.get('month_name', '')})**: Ingresos **{_format_mxn(kpis.get('ingresos_mes', 0))}** vs. Egresos **{_format_mxn(kpis.get('egresos_mes', 0))}** → Utilidad Mensual **{_format_mxn(kpis.get('utilidad_mes', 0))}**",
        "",
        "#### Posición de Liquidez y Cartera al Corte:",
        f"- **Saldo en Bancos (`102`)**: **{_format_mxn(kpis.get('saldo_bancos_102', 0))}**",
        f"- **Cuentas por Cobrar (`105`)**: **{_format_mxn(kpis.get('cuentas_por_cobrar_105', 0))}**",
        f"- **Cuentas por Pagar (`201`)**: **{_format_mxn(kpis.get('cuentas_por_pagar_201', 0))}**",
        f"- **CFDIs sin contabilizar**: **{kpis.get('cfdis_sin_contabilizar_count', 0)} CFDI(s)** ({_format_mxn(kpis.get('cfdis_sin_contabilizar_total', 0))})",
        f"- **Complementos de Pago pendientes (PPD)**: **{kpis.get('complementos_pendientes_count', 0)} pendiente(s)** ({_format_mxn(kpis.get('complementos_pendientes_monto', 0))})",
    ]

    return {
        "bot_name": "Iterumbot",
        "intent": "financial_summary",
        "reply": "\n".join(lines_md),
        "quick_links": [
            {"label": "Ver Estado de Resultados", "path": f"/income-statement/{client.id}"},
            {"label": "Ver Balance General", "path": f"/balance-sheet/{client.id}"},
            {"label": "Ver Complementos PPD", "path": f"/fiscal-complementos/{client.id}"},
        ],
    }
