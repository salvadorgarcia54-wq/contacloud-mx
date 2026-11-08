from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_
from typing import Optional, List, Dict, Any
from datetime import date, datetime
import calendar
import csv
import io
import re
import xml.etree.ElementTree as ET
from collections import defaultdict

from database import get_db, engine, Base
from models.user import User
from models.client import Client
from models.account import Account
from models.journal import JournalEntry, JournalLine
from models.cfdi import CFDIInvoice
from models.fixed_asset import FixedAsset
from models.isr_parameter import ISRParameter
from models.sat_blacklist import SATBlacklist
from routers.auth import require_role
from routers.reports import get_trial_balance
from services.audit import log_activity

router = APIRouter(prefix="/api/fiscal", tags=["fiscal"])


# ============================================================================
# 1. CÁLCULO DE IVA (Papel de trabajo y determinación mensual de IVA)
# ============================================================================
@router.get("/iva/{client_id}")
def get_iva_calculation(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    first_day = date(year, month, 1)
    last_day_val = calendar.monthrange(year, month)[1]
    last_day = date(year, month, last_day_val)

    # 1. Movimientos en cuentas contables de IVA
    # 208-01-000: IVA trasladado cobrado (Acreedora, crédito = causado)
    # 209-01-000: IVA trasladado no cobrado
    # 118-01-000: IVA acreditable pagado (Deudora, débito = acreditable)
    # 119-01-000: IVA pendiente de pago
    # 210-05-000 / 210-02 / etc.: Retenciones de IVA
    all_accounts = db.query(Account).filter(Account.client_id == client_id).all()
    acc_map = {a.id: a for a in all_accounts}

    lines = (
        db.query(JournalLine, JournalEntry)
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False,
            ~JournalEntry.description.ilike('%Traspasos de IVA del mes%')
        )
        .all()
    )

    iva_trasladado_cobrado = 0.0
    iva_trasladado_pendiente = 0.0
    iva_acreditable_pagado = 0.0
    iva_acreditable_pendiente = 0.0
    iva_retenido_por_terceros = 0.0
    iva_retenido_a_terceros = 0.0

    for l, e in lines:
        acc = acc_map.get(l.account_id)
        if not acc:
            continue
        num = acc.account_number or ""
        deb = float(l.debit or 0)
        cred = float(l.credit or 0)

        if num.startswith("208-01"):
            iva_trasladado_cobrado += (cred - deb)
        elif num.startswith("209-01"):
            iva_trasladado_pendiente += (cred - deb)
        elif num.startswith("118-01"):
            iva_acreditable_pagado += (deb - cred)
        elif num.startswith("119-01") or num.startswith("118-02"):
            iva_acreditable_pendiente += (deb - cred)
        elif num.startswith("210-05") or "retenido" in (acc.name or "").lower():
            iva_retenido_a_terceros += (cred - deb)

    # 2. Identificar UUIDs de CFDI que realmente afectaron 208-01 (cobrado) y 118-01 (pagado)
    active_208_uuids = {
        row[0] for row in (
            db.query(JournalEntry.cfdi_uuid)
            .join(JournalLine, JournalLine.entry_id == JournalEntry.id)
            .join(Account, JournalLine.account_id == Account.id)
            .filter(
                JournalEntry.client_id == client_id,
                Account.account_number.startswith('208-01'),
                JournalEntry.date >= first_day,
                JournalEntry.date <= last_day,
                JournalEntry.is_cancelled == False
            )
            .all()
        )
        if row[0]
    }

    active_118_uuids = {
        row[0] for row in (
            db.query(JournalEntry.cfdi_uuid)
            .join(JournalLine, JournalLine.entry_id == JournalEntry.id)
            .join(Account, JournalLine.account_id == Account.id)
            .filter(
                JournalEntry.client_id == client_id,
                Account.account_number.startswith('118-01'),
                JournalEntry.date >= first_day,
                JournalEntry.date <= last_day,
                JournalEntry.is_cancelled == False
            )
            .all()
        )
        if row[0]
    }

    # 3. Análisis desde CFDIs del periodo (Emitidos y Recibidos)
    invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.date >= datetime.combine(first_day, datetime.min.time()),
            CFDIInvoice.date <= datetime.combine(last_day, datetime.max.time()),
        )
        .order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc())
        .all()
    )

    emitidos_base_16 = 0.0
    emitidos_iva = 0.0
    emitidos_ret_iva = 0.0
    emitidos_total = 0.0

    recibidos_base_16 = 0.0
    recibidos_iva = 0.0
    recibidos_ret_iva = 0.0
    recibidos_total = 0.0

    invoices_detail = []

    for inv in invoices:
        sub = float(inv.subtotal or 0)
        iva = float(inv.iva_trasladado or 0)
        ret_iva = float(inv.retencion_iva or 0)
        tot = float(inv.total or 0)
        tipo = inv.cfdi_type

        # Base gravada estimada al 16% si tiene IVA
        base_16 = round(iva / 0.16, 2) if iva > 0 else 0.0
        base_0 = max(0.0, round(sub - base_16, 2)) if iva == 0 else 0.0

        if tipo == 'emitido':
            emitidos_base_16 += base_16
            emitidos_iva += iva
            emitidos_ret_iva += ret_iva
            emitidos_total += tot
        else:
            recibidos_base_16 += base_16
            recibidos_iva += iva
            recibidos_ret_iva += ret_iva
            recibidos_total += tot

        # Criterio estricto: Solo comprobantes efectivamente cobrados o pagados que forman el saldo contable (no los PPD)
        method_upper = (inv.payment_method or '').upper()
        is_ppd = (method_upper == 'PPD' and inv.tipo_comprobante != 'P')

        if tipo == 'emitido':
            is_effective = (not is_ppd) and (
                (inv.uuid in active_208_uuids) or
                (not active_208_uuids and method_upper in ('PUE', 'PAGO'))
            )
        else:
            is_effective = (not is_ppd) and (
                (inv.uuid in active_118_uuids) or
                (not active_118_uuids and method_upper in ('PUE', 'PAGO') and inv.is_posted)
            )

        invoices_detail.append({
            "id": inv.id,
            "uuid": inv.uuid,
            "folio": inv.folio or inv.uuid[:8],
            "date": inv.date.strftime("%Y-%m-%d") if inv.date else "",
            "cfdi_type": tipo,
            "rfc": inv.receiver_rfc if tipo == 'emitido' else inv.issuer_rfc,
            "name": inv.receiver_name if tipo == 'emitido' else inv.issuer_name,
            "payment_method": inv.payment_method or "PUE",
            "payment_form": inv.payment_form or "",
            "cfdi_use": inv.cfdi_use or "",
            "subtotal": sub,
            "base_16": base_16,
            "base_0": base_0,
            "iva": iva,
            "retencion_iva": ret_iva,
            "total": tot,
            "is_posted": inv.is_posted,
            "is_effective": is_effective
        })

    # Si hay movimientos contables en 208/118, usamos los saldos contables como base oficial,
    # apoyados por el desglose de CFDI
    final_iva_trasladado = iva_trasladado_cobrado if round(iva_trasladado_cobrado, 2) > 0 else emitidos_iva
    final_iva_acreditable = iva_acreditable_pagado if round(iva_acreditable_pagado, 2) > 0 else recibidos_iva
    final_retencion_iva = emitidos_ret_iva if emitidos_ret_iva > 0 else iva_retenido_por_terceros

    # Base de actos calculada a tasa 16%
    base_actos_trasladados_16 = round(final_iva_trasladado / 0.16, 2) if final_iva_trasladado > 0 else emitidos_base_16
    base_actos_acreditables_16 = round(final_iva_acreditable / 0.16, 2) if final_iva_acreditable > 0 else recibidos_base_16

    # Determinación mensual de IVA
    # IVA Causado (Cobrado)
    # (-) IVA Acreditable (Pagado)
    # (-) Retenciones de IVA que le practicaron
    # (=) Impuesto a cargo / (Saldo a favor)
    net_diff = final_iva_trasladado - final_iva_acreditable - final_retencion_iva
    iva_a_cargo = max(0.0, round(net_diff, 2))
    iva_a_favor = max(0.0, round(-net_diff, 2))

    # Filtrar únicamente los CFDI que realmente forman el saldo de las cuentas contables (sin PPD)
    efectivos = [inv for inv in invoices_detail if inv["is_effective"]]
    em_efectivos = [inv for inv in efectivos if inv["cfdi_type"] == 'emitido']
    rec_efectivos = [inv for inv in efectivos if inv["cfdi_type"] == 'recibido']

    tot_em_efectivo_tot = sum(i["total"] for i in em_efectivos)
    tot_em_efectivo_iva = sum(i["iva"] for i in em_efectivos)
    tot_rec_efectivo_tot = sum(i["total"] for i in rec_efectivos)
    tot_rec_efectivo_iva = sum(i["iva"] for i in rec_efectivos)

    # Comprobar si ya existe póliza de traspasos de IVA generada para este periodo
    existing_traspaso = db.query(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.entry_type == 'diario',
        JournalEntry.date == last_day,
        JournalEntry.description.ilike('%Traspasos de IVA del mes%'),
        JournalEntry.is_cancelled == False
    ).first()

    traspaso_poliza = None
    if existing_traspaso:
        traspaso_poliza = {
            "id": existing_traspaso.id,
            "entry_number": existing_traspaso.entry_number,
            "date": existing_traspaso.date.strftime("%Y-%m-%d"),
            "formatted_date": existing_traspaso.date.strftime("%d/%m/%Y"),
            "description": existing_traspaso.description,
            "is_auto": existing_traspaso.is_auto
        }

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year,
        "month": month,
        "period_description": f"{calendar.month_name[month].capitalize()} {year}",
        "summary": {
            "iva_causado": round(final_iva_trasladado, 2),
            "base_causado_16": round(base_actos_trasladados_16, 2),
            "iva_acreditable": round(final_iva_acreditable, 2),
            "base_acreditable_16": round(base_actos_acreditables_16, 2),
            "retenciones_que_le_hicieron": round(final_retencion_iva, 2),
            "iva_a_cargo": iva_a_cargo,
            "iva_a_favor": iva_a_favor,
            "iva_trasladado_pendiente": round(iva_trasladado_pendiente, 2),
            "iva_acreditable_pendiente": round(iva_acreditable_pendiente, 2)
        },
        "contabilidad": {
            "cta_208_cobrado": round(iva_trasladado_cobrado, 2),
            "cta_209_pendiente": round(iva_trasladado_pendiente, 2),
            "cta_118_pagado": round(iva_acreditable_pagado, 2),
            "cta_119_pendiente": round(iva_acreditable_pendiente, 2),
            "cta_210_retenciones": round(iva_retenido_a_terceros, 2),
        },
        "cfdi_totals": {
            "emitidos_total": round(tot_em_efectivo_tot, 2),
            "emitidos_iva": round(tot_em_efectivo_iva, 2),
            "recibidos_total": round(tot_rec_efectivo_tot, 2),
            "recibidos_iva": round(tot_rec_efectivo_iva, 2),
            "total_facturado_emitidos": round(emitidos_total, 2),
            "total_facturado_recibidos": round(recibidos_total, 2)
        },
        "invoices": efectivos,
        "all_invoices": invoices_detail,
        "traspaso_poliza": traspaso_poliza,
        "conciliacion_iva_acreditable": _build_conciliacion_iva_acreditable(client_id, year, month, db)
    }


BANCARIZADAS_CODES = {"02", "03", "04", "05", "06", "28", "29"}


def _classify_forma_pago(fp: Optional[str]) -> str:
    code = (fp or "").strip().zfill(2) if (fp or "").strip().isdigit() else (fp or "").strip()
    if code == "01":
        return "efectivo"
    if code in BANCARIZADAS_CODES:
        return "bancarizadas"
    return "otras"


def _classify_uso_cfdi(uso: Optional[str]) -> str:
    u = (uso or "").strip().upper()
    if u == "G01":
        return "g01"
    if u == "G02":
        return "g02"
    if u.startswith("I") or u.startswith("CN"):
        return "i"
    if u.startswith("D"):
        return "d"
    if u.startswith("S"):
        return "s"
    return "g03"


def _extract_xml_iva_base_and_tax(inv: CFDIInvoice, related_inv: Optional[CFDIInvoice] = None) -> Dict[str, Any]:
    """
    Extrae Base Gravable/Exenta de IVA ('importe'), IVA trasladado ('iva'), FormaPago y UsoCFDI
    directamente del XML local cuando está disponible, con respaldo a las columnas de BD.
    """
    tipo_comp = (getattr(inv, "tipo_comprobante", "I") or "I").strip().upper()
    method_upper = (inv.payment_method or "PUE").strip().upper()
    is_pago = (tipo_comp == "P" or method_upper == "PAGO")

    forma_pago = (inv.payment_form or "99").strip()
    uso_cfdi = (inv.cfdi_use or "G03").strip().upper()
    base_val = float(inv.subtotal or 0.0)
    iva_val = float(inv.iva_trasladado or 0.0)

    if inv.raw_xml:
        try:
            raw_str = inv.raw_xml if isinstance(inv.raw_xml, str) else inv.raw_xml.decode("utf-8", errors="ignore")
            raw_str = raw_str.lstrip("\ufeff").strip()
            root = ET.fromstring(raw_str)

            if is_pago:
                # En CFDI Tipo P (Pagos 2.0), leer nodo Totales y Pago
                totales_nodes = [el for el in root.iter() if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) == "Totales"]
                pago_nodes = [el for el in root.iter() if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) == "Pago"]

                if pago_nodes:
                    # Elegir la forma de pago del nodo Pago con mayor monto
                    best_pago = max(pago_nodes, key=lambda p: float(p.get("Monto") or 0.0))
                    if best_pago.get("FormaDePagoP"):
                        forma_pago = best_pago.get("FormaDePagoP").strip()

                if totales_nodes:
                    tot_el = totales_nodes[0]
                    base_val = (
                        float(tot_el.get("TotalTrasladosBaseIVA16") or 0.0) +
                        float(tot_el.get("TotalTrasladosBaseIVA8") or 0.0) +
                        float(tot_el.get("TotalTrasladosBaseIVA0") or 0.0) +
                        float(tot_el.get("TotalTrasladosBaseIVAExento") or 0.0)
                    )
                    iva_val = (
                        float(tot_el.get("TotalTrasladosImpuestoIVA16") or 0.0) +
                        float(tot_el.get("TotalTrasladosImpuestoIVA8") or 0.0) +
                        float(tot_el.get("TotalTrasladosImpuestoIVA0") or 0.0)
                    )
                    if base_val == 0.0 and iva_val == 0.0:
                        monto_tot = float(tot_el.get("MontoTotalPagos") or 0.0)
                        if monto_tot > 0:
                            base_val = monto_tot
                else:
                    tras_p = [
                        el for el in root.iter()
                        if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) == "TrasladoP"
                        and (el.get("ImpuestoP") in ("002", "IVA"))
                    ]
                    if tras_p:
                        base_val = sum(float(el.get("BaseP") or 0.0) for el in tras_p)
                        iva_val = sum(float(el.get("ImporteP") or 0.0) for el in tras_p)
            else:
                # En CFDI Tipo I / E, buscar el nodo Impuestos hijo directo de Comprobante
                comp_impuestos = None
                for child in root:
                    cname = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                    if cname == "Impuestos":
                        comp_impuestos = child
                        break

                if comp_impuestos is not None:
                    tras_002 = [
                        el for el in comp_impuestos.iter()
                        if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) == "Traslado"
                        and (el.get("Impuesto") in ("002", "IVA"))
                    ]
                    if tras_002:
                        has_base_attr = any(el.get("Base") is not None for el in tras_002)
                        if has_base_attr:
                            base_val = sum(float(el.get("Base") or 0.0) for el in tras_002)
                        iva_val = sum(float(el.get("Importe") or 0.0) for el in tras_002)
                    else:
                        base_val = 0.0
                        iva_val = 0.0
                else:
                    # Comprobar si hay Traslado Exento a nivel Concepto cuando no existe nodo Impuestos global
                    concepto_tras_002 = [
                        el for el in root.iter()
                        if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) == "Traslado"
                        and (el.get("Impuesto") in ("002", "IVA"))
                    ]
                    if concepto_tras_002:
                        base_val = sum(float(el.get("Base") or 0.0) for el in concepto_tras_002)
                        iva_val = sum(float(el.get("Importe") or 0.0) for el in concepto_tras_002)
                    else:
                        base_val = 0.0
                        iva_val = 0.0
        except Exception:
            pass

    if is_pago:
        if related_inv and (related_inv.cfdi_use or "").strip().upper() not in ("", "CP01"):
            uso_cfdi = related_inv.cfdi_use.strip().upper()
        elif uso_cfdi in ("", "CP01", "P01"):
            uso_cfdi = "G03"

    return {
        "base": round(base_val, 2),
        "iva": round(iva_val, 2),
        "forma_pago": forma_pago,
        "uso_cfdi": uso_cfdi,
        "uso_bucket": _classify_uso_cfdi(uso_cfdi),
        "forma_bucket": _classify_forma_pago(forma_pago),
    }


def _build_conciliacion_iva_acreditable(client_id: int, year: int, month: int, db: Session) -> Dict[str, Any]:
    """
    Construye la matriz del Reporte Conciliación IVA Acreditable agrupando CFDI recibidos por:
    Tipo de Comprobante (I PUE, E Notas de crédito PUE, P01 Pagos de meses anteriores, P Pagos del mes, y PPD por definir),
    Forma de Pago (Efectivo, Bancarizadas, Otras) y Uso del CFDI (G01, G03, G02, I, D, S).
    """
    first_day = date(year, month, 1)
    last_day_val = calendar.monthrange(year, month)[1]
    last_day = date(year, month, last_day_val)

    all_recibidos = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.cfdi_type == "recibido",
        )
        .order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc())
        .all()
    )

    uuid_map: Dict[str, CFDIInvoice] = {
        (inv.uuid or "").strip().upper(): inv for inv in all_recibidos if inv.uuid
    }

    period_recibidos = [
        inv for inv in all_recibidos
        if inv.date and first_day <= (inv.date.date() if hasattr(inv.date, "date") else inv.date) <= last_day
    ]

    row_specs = [
        ("I_PUE_EFECTIVO", "I", "PUE", "PUE", "Efectivo", "blue"),
        ("I_PUE_BANCARIZADAS", "", "", "PUE - Ingresos", "Bancarizadas", "blue"),
        ("I_PUE_OTRAS", "", "", "PUE - Ingresos", "Otras", "blue"),
        ("E_PUE_EFECTIVO", "E", "Notas de crédito PUE", "Notas de crédito PUE", "Efectivo", "orange"),
        ("E_PUE_BANCARIZADAS", "", "", "PUE - Egresos", "Bancarizadas", "orange"),
        ("E_PUE_OTRAS", "", "", "PUE - Egresos", "Otras", "orange"),
        ("P_ANT_EFECTIVO", "P01", "Pagos recibidos de CFDI de meses anteriores", "Pagos recibidos de CFDI de meses anteriores", "Efectivo", "purple"),
        ("P_ANT_BANCARIZADAS", "", "", "Pagos de meses anteriores", "Bancarizadas", "purple"),
        ("P_ANT_OTRAS", "", "", "Pagos de meses anteriores", "Otras", "purple"),
        ("P_MES_EFECTIVO", "", "Pagos recibidos de CFDI del mes", "Pagos recibidos de CFDI del mes", "Efectivo", "green"),
        ("P_MES_BANCARIZADAS", "", "", "Pagos del mes", "Bancarizadas", "green"),
        ("P_MES_OTRAS", "", "", "Pagos del mes", "Otras", "green"),
    ]

    uso_keys = ("g01", "g03", "g02", "i", "d", "s")

    def _empty_row(key: str, tipo: str, badge: str, concepto: str, forma_pago: str, accent_color: str) -> Dict[str, Any]:
        r: Dict[str, Any] = {
            "key": key,
            "tipo": tipo,
            "group_badge": badge,
            "concepto": concepto,
            "forma_pago": forma_pago,
            "accent_color": accent_color,
            "total_iva_acreditable": 0.0,
            "cfdi_count": 0,
            "cfdis": [],
        }
        for uk in uso_keys:
            r[f"{uk}_importe"] = 0.0
            r[f"{uk}_iva"] = 0.0
        return r

    rows_dict: Dict[str, Dict[str, Any]] = {
        spec[0]: _empty_row(*spec) for spec in row_specs
    }
    ppd_row = _empty_row("PPD_PERIODO", "PPD", "CFDI PPD emitidos en el periodo", "CFDI PPD emitidos en el periodo", "Por definir", "yellow")

    for inv in period_recibidos:
        tipo_comp = (getattr(inv, "tipo_comprobante", "I") or "I").strip().upper()
        method_upper = (inv.payment_method or "PUE").strip().upper()
        is_pago = (tipo_comp == "P" or method_upper == "PAGO")
        is_ppd = (not is_pago and method_upper == "PPD")

        rel_uuid = (getattr(inv, "related_uuid", "") or "").strip().upper()
        related_inv = uuid_map.get(rel_uuid) if rel_uuid else None

        parsed = _extract_xml_iva_base_and_tax(inv, related_inv)
        base_val = parsed["base"]
        iva_val = parsed["iva"]
        uk = parsed["uso_bucket"]
        fb = parsed["forma_bucket"]

        cfdi_item = {
            "id": inv.id,
            "uuid": inv.uuid,
            "folio": inv.folio or (inv.uuid[:8] if inv.uuid else "S/F"),
            "date": inv.date.strftime("%Y-%m-%d") if inv.date else "",
            "rfc": inv.issuer_rfc or "",
            "name": inv.issuer_name or "",
            "tipo_comprobante": "P" if is_pago else tipo_comp,
            "payment_method": "PAGO" if is_pago else method_upper,
            "payment_form": parsed["forma_pago"],
            "cfdi_use": parsed["uso_cfdi"],
            "uso_bucket": uk,
            "forma_bucket": fb,
            "importe": base_val,
            "iva": iva_val,
            "total": round(float(inv.total or 0.0), 2),
            "related_uuid": rel_uuid,
            "is_posted": bool(inv.is_posted),
        }

        if is_ppd:
            target = ppd_row
        elif is_pago:
            # Distinguir si el CFDI relacionado fue emitido en meses anteriores o en el mes
            is_prev_month = False
            if related_inv and related_inv.date:
                rel_d = related_inv.date.date() if hasattr(related_inv.date, "date") else related_inv.date
                if rel_d < first_day:
                    is_prev_month = True
            prefix = "P_ANT" if is_prev_month else "P_MES"
            row_key = f"{prefix}_{fb.upper()}"
            target = rows_dict[row_key]
        elif tipo_comp == "E":
            row_key = f"E_PUE_{fb.upper()}"
            target = rows_dict[row_key]
        else:
            row_key = f"I_PUE_{fb.upper()}"
            target = rows_dict[row_key]

        target[f"{uk}_importe"] = round(target[f"{uk}_importe"] + base_val, 2)
        target[f"{uk}_iva"] = round(target[f"{uk}_iva"] + iva_val, 2)
        if uk != "s":
            target["total_iva_acreditable"] = round(target["total_iva_acreditable"] + iva_val, 2)
        target["cfdi_count"] += 1
        target["cfdis"].append(cfdi_item)

    ordered_rows = [rows_dict[spec[0]] for spec in row_specs]

    totals_row = _empty_row("TOTALES", "", "", "Totales", "", "slate")
    for r in ordered_rows:
        sign = -1.0 if r["key"].startswith("E_") else 1.0
        for uk in uso_keys:
            totals_row[f"{uk}_importe"] = round(totals_row[f"{uk}_importe"] + sign * r[f"{uk}_importe"], 2)
            totals_row[f"{uk}_iva"] = round(totals_row[f"{uk}_iva"] + sign * r[f"{uk}_iva"], 2)
        totals_row["total_iva_acreditable"] = round(totals_row["total_iva_acreditable"] + sign * r["total_iva_acreditable"], 2)
        totals_row["cfdi_count"] += r["cfdi_count"]

    month_names_es = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]
    month_label = month_names_es[month - 1] if 1 <= month <= 12 else str(month)

    return {
        "year": year,
        "month": month,
        "period_str": f"{month:02d}/{year}",
        "period_description": f"{month_label} {year}",
        "rows": ordered_rows,
        "totals": totals_row,
        "ppd_row": ppd_row,
    }


@router.get("/conciliacion-iva/{client_id}")
def get_conciliacion_iva_acreditable(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(9),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    matrix_data = _build_conciliacion_iva_acreditable(client_id, year, month, db)
    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        **matrix_data,
    }


class TraspasoIvaRequest(BaseModel):
    year: int
    month: int
    iva_trasladado: Optional[float] = None
    iva_acreditable: Optional[float] = None


@router.post("/iva/{client_id}/generar-traspaso")
def generar_traspaso_iva(
    client_id: int,
    req: TraspasoIvaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    last_day_val = calendar.monthrange(req.year, req.month)[1]
    entry_date = date(req.year, req.month, last_day_val)

    # Si no se pasan los importes expresamente, obtenerlos del cálculo oficial
    if req.iva_trasladado is not None and req.iva_acreditable is not None:
        iva_tras = round(float(req.iva_trasladado), 2)
        iva_acred = round(float(req.iva_acreditable), 2)
    else:
        calc = get_iva_calculation(client_id, req.year, req.month, db, current_user)
        iva_tras = round(calc["summary"]["iva_causado"], 2)
        iva_acred = round(calc["summary"]["iva_acreditable"], 2)

    if iva_tras <= 0 and iva_acred <= 0:
        raise HTTPException(
            status_code=400,
            detail="No hay saldos de IVA trasladado ni acreditable en este periodo para generar el traspaso."
        )

    # 1. Buscar cuenta 208-01-000 (IVA trasladado cobrado)
    acc_208 = (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.account_number.like('208-01%'), Account.is_active == True)
        .first()
    ) or (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.sat_group_code == '208.01', Account.is_active == True)
        .first()
    )
    if not acc_208:
        raise HTTPException(
            status_code=400,
            detail="No se encontró la cuenta contable 208-01-000 (IVA trasladado cobrado) para este cliente."
        )

    # 2. Buscar cuenta 118-01-000 (IVA acreditable pagado)
    acc_118 = (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.account_number.like('118-01%'), Account.is_active == True)
        .first()
    ) or (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.sat_group_code == '118.01', Account.is_active == True)
        .first()
    )
    if not acc_118:
        raise HTTPException(
            status_code=400,
            detail="No se encontró la cuenta contable 118-01-000 (IVA acreditable pagado) para este cliente."
        )

    diff = round(iva_tras - iva_acred, 2)
    acc_destino = None

    if diff > 0:
        # A cargo: Cuenta 213-01-000 (IVA por pagar)
        acc_destino = (
            db.query(Account)
            .filter(Account.client_id == client_id, Account.account_number.like('213-01%'), Account.is_active == True)
            .first()
        ) or (
            db.query(Account)
            .filter(Account.client_id == client_id, Account.sat_group_code == '213.01', Account.is_active == True)
            .first()
        )
        if not acc_destino:
            raise HTTPException(
                status_code=400,
                detail="No se encontró la cuenta contable 213-01-000 (IVA por pagar) para registrar el impuesto a cargo."
            )
    elif diff < 0:
        # A favor: Cuenta 113-01-000 (IVA a favor)
        acc_destino = (
            db.query(Account)
            .filter(Account.client_id == client_id, Account.account_number.like('113-01%'), Account.is_active == True)
            .first()
        ) or (
            db.query(Account)
            .filter(Account.client_id == client_id, Account.sat_group_code == '113.01', Account.is_active == True)
            .first()
        )
        if not acc_destino:
            raise HTTPException(
                status_code=400,
                detail="No se encontró la cuenta contable 113-01-000 (IVA a favor) para registrar el saldo a favor."
            )

    # 3. Buscar si ya existe una póliza previa para actualizarla o generar una nueva
    existing = db.query(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.entry_type == 'diario',
        JournalEntry.date == entry_date,
        JournalEntry.description.ilike('%Traspasos de IVA del mes%'),
        JournalEntry.is_cancelled == False
    ).first()

    if existing:
        db.query(JournalLine).filter(JournalLine.entry_id == existing.id).delete()
        entry = existing
        action_word = "actualizada"
    else:
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == 'diario',
            func.strftime('%Y', JournalEntry.date) == str(req.year)
        ).scalar()
        entry_number = (max_num or 0) + 1

        entry = JournalEntry(
            client_id=client_id,
            entry_number=entry_number,
            entry_type='diario',
            date=entry_date,
            description="Traspasos de IVA del mes",
            reference=f"TRASPASO-IVA-{req.month:02d}-{req.year}",
            is_auto=True,
            created_by=current_user.id
        )
        db.add(entry)
        db.flush()
        action_word = "generada"

    lines = []
    order = 1

    # Línea 1: Cargo a 208-01-000 (Cancela IVA trasladado cobrado)
    if iva_tras > 0:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_208.id,
            debit=iva_tras,
            credit=0.0,
            description="Cancelación mensual de IVA trasladado cobrado",
            line_order=order
        ))
        order += 1

    # Si hay saldo a favor (diff < 0): Cargo a 113-01-000 (IVA a favor)
    if diff < 0 and acc_destino:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_destino.id,
            debit=abs(diff),
            credit=0.0,
            description="Determinación de IVA a favor del mes",
            line_order=order
        ))
        order += 1

    # Línea Abono a 118-01-000 (Cancela IVA acreditable pagado)
    if iva_acred > 0:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_118.id,
            debit=0.0,
            credit=iva_acred,
            description="Cancelación mensual de IVA acreditable pagado",
            line_order=order
        ))
        order += 1

    # Si hay impuesto a cargo (diff > 0): Abono a 213-01-000 (IVA por pagar)
    if diff > 0 and acc_destino:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_destino.id,
            debit=0.0,
            credit=diff,
            description="Determinación de IVA por pagar a cargo del mes",
            line_order=order
        ))
        order += 1

    for l in lines:
        db.add(l)

    db.commit()
    db.refresh(entry)

    log_activity(
        db=db,
        user=current_user,
        action="TRASPASO_IVA",
        module="Fiscal",
        description=f"Generó Póliza de Traspasos de IVA del mes {req.month}/{req.year} (Diario #{entry.entry_number}) para {client.business_name}",
        client_id=client_id,
        entity_id=entry.id,
        details={"year": req.year, "month": req.month, "entry_number": entry.entry_number, "action": action_word}
    )

    return {
        "success": True,
        "message": f"Póliza de diario #{entry.entry_number} {action_word} con éxito con fecha {entry_date.strftime('%d/%m/%Y')}.",
        "entry_id": entry.id,
        "entry_number": entry.entry_number,
        "entry_date": entry.date.strftime("%Y-%m-%d"),
        "formatted_date": entry.date.strftime("%d/%m/%Y"),
        "action": action_word,
        "iva_trasladado": iva_tras,
        "iva_acreditable": iva_acred,
        "tipo_resultado": "a_cargo" if diff > 0 else "a_favor" if diff < 0 else "cero",
        "diferencia": abs(diff),
        "lines_count": len(lines)
    }


# ============================================================================
# 2. COMPLEMENTOS DE PAGO (CFDI Tipo P y Conciliación PPD / Repositorio)
# ============================================================================

def extract_reps_from_invoice(inv: CFDIInvoice) -> List[Dict[str, Any]]:
    """
    Extrae todos los documentos relacionados y datos de pago de un CFDI tipo P o con pagos relacionados.
    """
    related_docs = []
    primary_uuid = (inv.related_uuid or "").strip().upper()
    primary_folio = inv.related_folio or ""
    
    if inv.raw_xml:
        try:
            raw_str = inv.raw_xml if isinstance(inv.raw_xml, str) else inv.raw_xml.decode('utf-8', errors='ignore')
            root = ET.fromstring(raw_str)
            for elem in root.iter():
                tag_name = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag_name == 'DoctoRelacionado':
                    doc_uuid = (elem.get('IdDocumento') or '').strip().upper()
                    if doc_uuid:
                        serie = elem.get('Serie') or ''
                        folio = elem.get('Folio') or ''
                        full_folio = f"{serie}-{folio}" if serie and folio else (folio or serie or '')
                        imp_pagado = float(elem.get('ImpPagado') or 0.0)
                        imp_saldo_ant = float(elem.get('ImpSaldoAnt') or 0.0)
                        imp_saldo_insoluto = float(elem.get('ImpSaldoInsoluto') or 0.0)
                        num_parc = elem.get('NumParcialidad') or '1'
                        moneda = elem.get('MonedaDR') or 'MXN'
                        
                        related_docs.append({
                            "target_uuid": doc_uuid,
                            "rep_id": inv.id,
                            "rep_uuid": inv.uuid,
                            "rep_folio": inv.folio or inv.uuid[:8],
                            "rep_date": inv.date.strftime("%Y-%m-%d %H:%M") if inv.date else "",
                            "rep_payment_form": inv.payment_form or "03",
                            "doc_folio": full_folio,
                            "monto_pagado": imp_pagado if imp_pagado > 0 else float(inv.total or 0.0),
                            "saldo_anterior": imp_saldo_ant,
                            "saldo_insoluto": imp_saldo_insoluto,
                            "num_parcialidad": num_parc,
                            "moneda": moneda,
                            "is_posted": inv.is_posted
                        })
        except Exception:
            pass

    if not related_docs and primary_uuid:
        related_docs.append({
            "target_uuid": primary_uuid,
            "rep_id": inv.id,
            "rep_uuid": inv.uuid,
            "rep_folio": inv.folio or inv.uuid[:8],
            "rep_date": inv.date.strftime("%Y-%m-%d %H:%M") if inv.date else "",
            "rep_payment_form": inv.payment_form or "03",
            "doc_folio": primary_folio,
            "monto_pagado": float(inv.total or 0.0),
            "saldo_anterior": float(inv.total or 0.0),
            "saldo_insoluto": 0.0,
            "num_parcialidad": "1",
            "moneda": "MXN",
            "is_posted": inv.is_posted
        })

    return related_docs


@router.get("/complementos-pago/{client_id}")
def get_complementos_pago_report(
    client_id: int,
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    tipo: Optional[str] = Query(None), # 'emitido', 'recibido' o None
    status: Optional[str] = Query(None), # 'sin_complemento', 'con_complemento', 'pago_parcial' o None
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # 1. Obtener TODOS los Complementos de Pago (CFDI Tipo P) registrados para este cliente
    rep_invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            or_(
                CFDIInvoice.tipo_comprobante == 'P',
                CFDIInvoice.payment_method == 'PAGO',
                func.lower(CFDIInvoice.description).like('%pago%')
            )
        )
        .order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc())
        .all()
    )

    reps_by_target_uuid = defaultdict(list)
    reps_list = []
    
    for rep in rep_invoices:
        rep_item = {
            "id": rep.id,
            "uuid": rep.uuid,
            "folio": rep.folio or rep.uuid[:8],
            "date": rep.date.strftime("%Y-%m-%d %H:%M") if rep.date else "",
            "cfdi_type": rep.cfdi_type,
            "issuer_rfc": rep.issuer_rfc,
            "issuer_name": rep.issuer_name,
            "receiver_rfc": rep.receiver_rfc,
            "receiver_name": rep.receiver_name,
            "partner_rfc": rep.receiver_rfc if rep.cfdi_type == 'emitido' else rep.issuer_rfc,
            "partner_name": rep.receiver_name if rep.cfdi_type == 'emitido' else rep.issuer_name,
            "payment_form": rep.payment_form or "03",
            "total": float(rep.total or 0.0),
            "related_uuid": rep.related_uuid,
            "related_folio": rep.related_folio,
            "is_posted": rep.is_posted
        }
        reps_list.append(rep_item)

        extracted = extract_reps_from_invoice(rep)
        for doc in extracted:
            t_uuid = doc["target_uuid"]
            reps_by_target_uuid[t_uuid].append(doc)

    # 2. Consultar facturas emitidas y recibidas con método de pago PPD
    ppd_query = db.query(CFDIInvoice).filter(
        CFDIInvoice.client_id == client_id,
        CFDIInvoice.payment_method == 'PPD',
        CFDIInvoice.tipo_comprobante != 'P'
    )

    if year and str(year).lower() != 'all':
        ppd_query = ppd_query.filter(func.strftime('%Y', CFDIInvoice.date) == str(year))
    if month and str(month).lower() != 'all' and 1 <= int(month) <= 12:
        ppd_query = ppd_query.filter(func.strftime('%m', CFDIInvoice.date) == f"{int(month):02d}")
    if tipo in ('emitido', 'recibido'):
        ppd_query = ppd_query.filter(CFDIInvoice.cfdi_type == tipo)

    all_ppd = ppd_query.order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc()).all()

    # 3. Cruzar cada Factura PPD con sus Complementos de Pago relacionados
    facturas_analizadas = []

    tot_ppd_count = len(all_ppd)
    tot_ppd_monto = 0.0

    recibidos_total_count = 0
    recibidos_total_monto = 0.0
    recibidos_con_rep_count = 0
    recibidos_con_rep_monto = 0.0
    recibidos_sin_rep_count = 0
    recibidos_sin_rep_monto = 0.0

    emitidos_total_count = 0
    emitidos_total_monto = 0.0
    emitidos_con_rep_count = 0
    emitidos_con_rep_monto = 0.0
    emitidos_sin_rep_count = 0
    emitidos_sin_rep_monto = 0.0

    for inv in all_ppd:
        inv_uuid = (inv.uuid or "").strip().upper()
        inv_total = float(inv.total or 0.0)
        tot_ppd_monto += inv_total

        matching_reps = reps_by_target_uuid.get(inv_uuid, [])
        monto_pagado = round(sum(r["monto_pagado"] for r in matching_reps), 2)
        saldo_pendiente = max(0.0, round(inv_total - monto_pagado, 2))

        if matching_reps:
            if saldo_pendiente <= 0.01 or monto_pagado >= inv_total * 0.99:
                estatus = "con_complemento"
                estatus_label = "Con Complemento"
            else:
                estatus = "pago_parcial"
                estatus_label = "Pago Parcial"
        else:
            estatus = "sin_complemento"
            estatus_label = "Falta Complemento"

        partner_name = inv.receiver_name if inv.cfdi_type == 'emitido' else inv.issuer_name
        partner_rfc = inv.receiver_rfc if inv.cfdi_type == 'emitido' else inv.issuer_rfc
        folio_display = inv.folio or inv_uuid[:8]

        if estatus == "sin_complemento":
            if inv.cfdi_type == "recibido":
                action_type = "solicitar_proveedor"
                action_label = "Solicitar a Proveedor"
                action_desc = f"Falta solicitar el REP al proveedor {partner_name}"
            else:
                action_type = "pendiente_emitir"
                action_label = "Pendiente Emitir REP"
                action_desc = f"Nuestra empresa debe emitir el REP al cliente {partner_name}"
        elif estatus == "pago_parcial":
            action_type = "pago_parcial"
            action_label = "Pendiente Saldo"
            action_desc = f"Pagado: ${monto_pagado:,.2f} con {len(matching_reps)} REP(s). Saldo: ${saldo_pendiente:,.2f}"
        else:
            action_type = "completo"
            action_label = "Al Día"
            action_desc = f"Totalmente cubierto por {len(matching_reps)} REP(s) registrado(s)"

        solicitud_texto = (
            f"Estimado(a) {partner_name},\n\n"
            f"Por medio de la presente, solicitamos amablemente el Complemento para Recepción de Pagos (REP) "
            f"correspondiente a la siguiente factura:\n\n"
            f"• Factura / Folio: {folio_display}\n"
            f"• Folio Fiscal (UUID): {inv_uuid}\n"
            f"• Fecha de Emisión: {inv.date.strftime('%d/%m/%Y') if inv.date else 'S/F'}\n"
            f"• Importe Total: ${inv_total:,.2f} MXN\n"
            f"• RFC Emisor: {inv.issuer_rfc}\n"
            f"• RFC Receptor: {inv.receiver_rfc}\n\n"
            f"Agradecemos su valioso apoyo enviándonos el archivo XML y PDF a la brevedad posible para nuestro control fiscal.\n\n"
            f"Muchas gracias."
        )

        item = {
            "id": inv.id,
            "uuid": inv_uuid,
            "folio": folio_display,
            "date": inv.date.strftime("%Y-%m-%d %H:%M") if inv.date else "",
            "formatted_date": inv.date.strftime("%d/%m/%Y") if inv.date else "",
            "cfdi_type": inv.cfdi_type,
            "issuer_rfc": inv.issuer_rfc,
            "issuer_name": inv.issuer_name,
            "receiver_rfc": inv.receiver_rfc,
            "receiver_name": inv.receiver_name,
            "partner_name": partner_name,
            "partner_rfc": partner_rfc,
            "payment_method": "PPD",
            "payment_form": inv.payment_form or "99",
            "subtotal": float(inv.subtotal or 0.0),
            "iva_trasladado": float(inv.iva_trasladado or 0.0),
            "total": inv_total,
            "monto_pagado": monto_pagado,
            "saldo_pendiente": saldo_pendiente,
            "status": estatus,
            "status_label": estatus_label,
            "has_complement": bool(matching_reps),
            "reps_count": len(matching_reps),
            "complementos": matching_reps,
            "action_type": action_type,
            "action_label": action_label,
            "action_desc": action_desc,
            "solicitud_texto": solicitud_texto,
            "is_posted": inv.is_posted
        }

        if inv.cfdi_type == "recibido":
            recibidos_total_count += 1
            recibidos_total_monto += inv_total
            if estatus == "con_complemento":
                recibidos_con_rep_count += 1
                recibidos_con_rep_monto += inv_total
            elif estatus == "pago_parcial":
                recibidos_con_rep_monto += monto_pagado
                recibidos_sin_rep_count += 1
                recibidos_sin_rep_monto += saldo_pendiente
            else:
                recibidos_sin_rep_count += 1
                recibidos_sin_rep_monto += inv_total
        else:
            emitidos_total_count += 1
            emitidos_total_monto += inv_total
            if estatus == "con_complemento":
                emitidos_con_rep_count += 1
                emitidos_con_rep_monto += inv_total
            elif estatus == "pago_parcial":
                emitidos_con_rep_monto += monto_pagado
                emitidos_sin_rep_count += 1
                emitidos_sin_rep_monto += saldo_pendiente
            else:
                emitidos_sin_rep_count += 1
                emitidos_sin_rep_monto += inv_total

        if status and status != 'all' and estatus != status:
            continue

        facturas_analizadas.append(item)

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year,
        "month": month,
        "metrics": {
            "total_ppd": tot_ppd_count,
            "monto_total_ppd": round(tot_ppd_monto, 2),
            "recibidos": {
                "total_count": recibidos_total_count,
                "total_monto": round(recibidos_total_monto, 2),
                "con_rep_count": recibidos_con_rep_count,
                "con_rep_monto": round(recibidos_con_rep_monto, 2),
                "sin_rep_count": recibidos_sin_rep_count,
                "sin_rep_monto": round(recibidos_sin_rep_monto, 2),
            },
            "emitidos": {
                "total_count": emitidos_total_count,
                "total_monto": round(emitidos_total_monto, 2),
                "con_rep_count": emitidos_con_rep_count,
                "con_rep_monto": round(emitidos_con_rep_monto, 2),
                "sin_rep_count": emitidos_sin_rep_count,
                "sin_rep_monto": round(emitidos_sin_rep_monto, 2),
            },
            "total_reps_cargados": len(reps_list)
        },
        "facturas": facturas_analizadas,
        "reps_catalogo": reps_list
    }


# ============================================================================
# 3. DIOT (Declaración Informativa de Operaciones con Terceros)
# ============================================================================
@router.get("/diot/{client_id}")
def get_diot_report(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    first_day = date(year, month, 1)
    last_day_val = calendar.monthrange(year, month)[1]
    last_day = date(year, month, last_day_val)

    # Obtenemos los CFDIs recibidos (gastos/compras a proveedores) del mes
    invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.cfdi_type == 'recibido',
            CFDIInvoice.date >= datetime.combine(first_day, datetime.min.time()),
            CFDIInvoice.date <= datetime.combine(last_day, datetime.max.time()),
        )
        .all()
    )

    # Agrupación por RFC de Proveedor
    suppliers_map: Dict[str, Dict[str, Any]] = {}

    for inv in invoices:
        rfc = (inv.issuer_rfc or "XAXX010101000").strip().upper()
        name = (inv.issuer_name or "PROVEEDOR GENERAL").strip()
        sub = float(inv.subtotal or 0)
        iva = float(inv.iva_trasladado or 0)
        ret_iva = float(inv.retencion_iva or 0)
        tot = float(inv.total or 0)

        # Determinar base gravada al 16%
        base_16 = round(iva / 0.16, 2) if iva > 0 else 0.0
        base_0 = max(0.0, round(sub - base_16, 2)) if iva == 0 else 0.0
        exento = 0.0

        tipo_tercero = "04" if len(rfc) in (12, 13) and not rfc.startswith("XEXX") else "05"
        tipo_operacion = "85" # Otros por defecto (03 prestación servicios, 06 arrendamiento, 85 otros)
        if "arrendamiento" in (inv.description or "").lower():
            tipo_operacion = "06"
        elif "honorarios" in (inv.description or "").lower():
            tipo_operacion = "03"

        if rfc not in suppliers_map:
            suppliers_map[rfc] = {
                "tipo_tercero": tipo_tercero,
                "tipo_operacion": tipo_operacion,
                "rfc": rfc,
                "nombre": name,
                "pais": "" if tipo_tercero == "04" else "USA",
                "nacionalidad": "" if tipo_tercero == "04" else "EXTRANJERA",
                "base_16": 0.0,
                "iva_16": 0.0,
                "base_0": 0.0,
                "exento": 0.0,
                "iva_retenido": 0.0,
                "total_pagado": 0.0,
                "comprobantes_count": 0
            }

        s = suppliers_map[rfc]
        s["base_16"] += base_16
        s["iva_16"] += iva
        s["base_0"] += base_0
        s["exento"] += exento
        s["iva_retenido"] += ret_iva
        s["total_pagado"] += tot
        s["comprobantes_count"] += 1

    suppliers_list = list(suppliers_map.values())
    # Redondeo final a enteros o decimales requeridos por SAT
    for s in suppliers_list:
        s["base_16"] = round(s["base_16"], 2)
        s["iva_16"] = round(s["iva_16"], 2)
        s["base_0"] = round(s["base_0"], 2)
        s["exento"] = round(s["exento"], 2)
        s["iva_retenido"] = round(s["iva_retenido"], 2)
        s["total_pagado"] = round(s["total_pagado"], 2)

    tot_base_16 = sum(s["base_16"] for s in suppliers_list)
    tot_iva_16 = sum(s["iva_16"] for s in suppliers_list)
    tot_base_0 = sum(s["base_0"] for s in suppliers_list)
    tot_exento = sum(s["exento"] for s in suppliers_list)
    tot_ret = sum(s["iva_retenido"] for s in suppliers_list)
    tot_pagado = sum(s["total_pagado"] for s in suppliers_list)

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year,
        "month": month,
        "period_description": f"{calendar.month_name[month].capitalize()} {year}",
        "totales": {
            "proveedores_count": len(suppliers_list),
            "base_16": round(tot_base_16, 2),
            "iva_16": round(tot_iva_16, 2),
            "base_0": round(tot_base_0, 2),
            "exento": round(tot_exento, 2),
            "iva_retenido": round(tot_ret, 2),
            "total_pagado": round(tot_pagado, 2)
        },
        "proveedores": suppliers_list
    }


@router.get("/diot/{client_id}/export-txt")
def export_diot_txt(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    diot_data = get_diot_report(client_id, year, month, db, current_user)
    suppliers = diot_data["proveedores"]

    # Formato oficial DIOT SAT (separador pipe '|'):
    # 01. Tipo de Tercero (04 Nacional, 05 Extranjero, 15 Global)
    # 02. Tipo de Operación (03 Servicios, 06 Arrendamiento, 85 Otros)
    # 03. RFC
    # 04. Número de Id Fiscal (extranjeros)
    # 05. Nombre del Extranjero
    # 06. País de residencia
    # 07. Nacionalidad
    # 08. Valor de actos al 16% (entero)
    # 09. Valor de actos al 16% no deducible
    # 10. Valor de actos al 8% (estímulo frontera norte)
    # 11. Valor de actos al 8% no deducible
    # 12. Valor de actos al 0%
    # 13. Actos Exentos
    # 14. IVA Retenido
    # 15. IVA Devuelto en devoluciones
    lines = []
    for s in suppliers:
        t_tercero = s["tipo_tercero"]
        t_oper = s["tipo_operacion"]
        rfc = s["rfc"] if t_tercero == "04" else ""
        id_fiscal = "" if t_tercero == "04" else s["rfc"]
        nom_ext = "" if t_tercero == "04" else s["nombre"]
        pais = s["pais"]
        nac = s["nacionalidad"]

        b16 = int(round(s["base_16"]))
        b0 = int(round(s["base_0"]))
        ex = int(round(s["exento"]))
        ret = int(round(s["iva_retenido"]))

        line = f"{t_tercero}|{t_oper}|{rfc}|{id_fiscal}|{nom_ext}|{pais}|{nac}|{b16}||||{b0}|{ex}|{ret}||"
        lines.append(line)

    txt_content = "\r\n".join(lines) + ("\r\n" if lines else "")
    filename = f"DIOT_{diot_data['rfc']}_{year}{month:02d}.txt"

    return Response(
        content=txt_content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ============================================================================
# 4. CONTABILIDAD ELECTRÓNICA (Anexo 24 del SAT - XML)
# ============================================================================
@router.get("/contabilidad-electronica/{client_id}/info")
def get_contabilidad_electronica_info(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    accounts_count = db.query(Account).filter(Account.client_id == client_id).count()
    active_accounts_count = db.query(Account).filter(Account.client_id == client_id, Account.is_active == True).count()
    
    first_day = date(year, month, 1)
    last_day_val = calendar.monthrange(year, month)[1]
    last_day = date(year, month, last_day_val)

    entries_count = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False
        )
        .count()
    )

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year,
        "month": month,
        "period_description": f"{calendar.month_name[month].capitalize()} {year}",
        "stats": {
            "total_cuentas": accounts_count,
            "cuentas_activas": active_accounts_count,
            "polizas_periodo": entries_count
        },
        "archivos_sat": [
            {
                "codigo": "CT",
                "nombre": "Catálogo de Cuentas",
                "version": "1.3",
                "esquema": "Catalogo_1_3.xsd",
                "periodicidad": "Al inicio de operaciones o al modificar el catálogo",
                "download_url": f"/api/fiscal/contabilidad-electronica/{client_id}/catalogo-xml"
            },
            {
                "codigo": "BN",
                "nombre": "Balanza de Comprobación",
                "version": "1.3",
                "esquema": "BalanzaComprobacion_1_3.xsd",
                "periodicidad": "Mensual (antes del día 25 o 27 del mes siguiente)",
                "download_url": f"/api/fiscal/contabilidad-electronica/{client_id}/balanza-xml?year={year}&month={month}"
            },
            {
                "codigo": "PL",
                "nombre": "Pólizas del Periodo (Auxiliar de Pólizas)",
                "version": "1.3",
                "esquema": "PolizasPeriodo_1_3.xsd",
                "periodicidad": "A requerimiento de auditoría o trámite de devolución",
                "download_url": f"/api/fiscal/contabilidad-electronica/{client_id}/polizas-xml?year={year}&month={month}"
            }
        ]
    }


@router.get("/contabilidad-electronica/{client_id}/catalogo-xml")
def export_catalogo_xml(
    client_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    accounts = (
        db.query(Account)
        .filter(Account.client_id == client_id)
        .order_by(Account.account_number.asc())
        .all()
    )

    root = ET.Element(
        "catalogocuentas:Catalogo",
        {
            "xmlns:catalogocuentas": "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "xsi:schemaLocation": "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas/CatalogoCuentas_1_3.xsd",
            "Version": "1.3",
            "RFC": client.rfc or "XAXX010101000",
            "Mes": datetime.now().strftime("%m"),
            "Anio": str(datetime.now().year),
            "TotalCtas": str(len(accounts))
        }
    )

    acc_id_map = {a.id: a for a in accounts}

    for acc in accounts:
        parent_num = ""
        if acc.parent_id and acc.parent_id in acc_id_map:
            parent_num = acc_id_map[acc.parent_id].account_number or ""
        elif "-" in (acc.account_number or ""):
            parts = acc.account_number.split("-")
            if len(parts) >= 3 and parts[2] != "000":
                parent_num = f"{parts[0]}-{parts[1]}-000"
            elif len(parts) >= 2 and parts[1] != "00":
                parent_num = f"{parts[0]}-00-000"

        sat_code = acc.sat_group_code or "100"
        natur = "D" if (acc.nature or "").lower().startswith("d") else "A"
        nivel = str(acc.level or 1)

        node_attrs = {
            "CodAgrup": sat_code,
            "NumCta": acc.account_number or "",
            "Desc": (acc.name or "").strip(),
            "Nivel": nivel,
            "Natur": natur
        }
        if parent_num and parent_num != acc.account_number:
            node_attrs["SubCtaDe"] = parent_num

        ET.SubElement(root, "catalogocuentas:Ctas", node_attrs)

    xml_str = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    filename = f"{client.rfc}CT.xml"

    return Response(
        content=xml_str,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/contabilidad-electronica/{client_id}/balanza-xml")
def export_balanza_xml(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    tipo_envio: str = Query("N"), # 'N' Normal, 'C' Complementaria
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # Reutilizamos la función de Balanza de comprobación
    tb_data = get_trial_balance(
        client_id=client_id,
        year=year,
        month=month,
        active_only=True,
        only_with_movement=False,
        db=db,
        current_user=current_user
    )

    root = ET.Element(
        "BCE:Balanza",
        {
            "xmlns:BCE": "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "xsi:schemaLocation": "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion/BalanzaComprobacion_1_3.xsd",
            "Version": "1.3",
            "RFC": client.rfc or "XAXX010101000",
            "TotalCtas": str(len(tb_data)),
            "Mes": f"{month:02d}",
            "Anio": str(year),
            "TipoEnvio": tipo_envio
        }
    )

    for item in tb_data:
        # En Balanza XML SAT: SaldoIni, Debe, Haber, SaldoFin
        saldo_ini = item.get("initial_debit", 0.0) - item.get("initial_credit", 0.0)
        debe = item.get("movements_debit", 0.0)
        haber = item.get("movements_credit", 0.0)
        saldo_fin = item.get("final_debit", 0.0) - item.get("final_credit", 0.0)

        ET.SubElement(
            root,
            "BCE:Ctas",
            {
                "NumCta": item.get("account_number", ""),
                "SaldoIni": f"{saldo_ini:.2f}",
                "Debe": f"{debe:.2f}",
                "Haber": f"{haber:.2f}",
                "SaldoFin": f"{saldo_fin:.2f}"
            }
        )

    xml_str = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    filename = f"{client.rfc}{year}{month:02d}BN.xml"

    return Response(
        content=xml_str,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/contabilidad-electronica/{client_id}/polizas-xml")
def export_polizas_xml(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    first_day = date(year, month, 1)
    last_day_val = calendar.monthrange(year, month)[1]
    last_day = date(year, month, last_day_val)

    entries = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False
        )
        .order_by(JournalEntry.entry_number.asc())
        .all()
    )

    all_accounts = db.query(Account).filter(Account.client_id == client_id).all()
    acc_map = {a.id: a for a in all_accounts}

    root = ET.Element(
        "PLZ:Polizas",
        {
            "xmlns:PLZ": "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "xsi:schemaLocation": "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo/PolizasPeriodo_1_3.xsd",
            "Version": "1.3",
            "RFC": client.rfc or "XAXX010101000",
            "Mes": f"{month:02d}",
            "Anio": str(year),
            "TipoSolicitud": "AF"
        }
    )

    for entry in entries:
        pol_node = ET.SubElement(
            root,
            "PLZ:Poliza",
            {
                "NumUnico": str(entry.entry_number),
                "Fecha": entry.date.strftime("%Y-%m-%d") if entry.date else "",
                "Concepto": (entry.description or "POLIZA CONTABLE")[:300]
            }
        )

        for line in entry.lines:
            acc = acc_map.get(line.account_id)
            acc_num = acc.account_number if acc else "000-00-000"
            acc_name = acc.name if acc else "CUENTA"

            ET.SubElement(
                pol_node,
                "PLZ:Transaccion",
                {
                    "NumCta": acc_num,
                    "DesCta": acc_name[:100],
                    "Concepto": (line.description or entry.description or "MOVIMIENTO")[:300],
                    "Debe": f"{float(line.debit or 0):.2f}",
                    "Haber": f"{float(line.credit or 0):.2f}"
                }
            )

        if entry.cfdi_uuid:
            ET.SubElement(
                pol_node,
                "PLZ:CompNal",
                {
                    "UUID_CFDI": entry.cfdi_uuid,
                    "RFC": entry.cfdi_issuer_rfc or client.rfc or "",
                    "MontoTotal": f"{float(entry.cfdi_total or 0):.2f}"
                }
            )

    xml_str = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    filename = f"{client.rfc}{year}{month:02d}PL.xml"

    return Response(
        content=xml_str,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ============================================================================
# 5. DEDUCCIÓN DE INVERSIONES Y ACTIVOS FIJOS (Art. 31 a 38 LISR)
# ============================================================================

INVESTMENT_TYPES_CATALOG = [
    {
        "code": "151-00-000",
        "label": "151-00-000 - Terrenos",
        "short_name": "Terrenos",
        "sat_rate": 0.0,
        "asset_parent_number": "151-01-000",
        "asset_prefix": "151-01-",
        "asset_sat_code": "151.01",
        "depreciation_account_number": "171-01-000",
        "depreciation_sat_code": "171.01",
        "expense_account_number": "613-01-000",
        "expense_sat_code": "613.01",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "152-00-000",
        "label": "152-00-000 - Edificios",
        "short_name": "Edificios",
        "sat_rate": 5.0,
        "asset_parent_number": "152-01-000",
        "asset_prefix": "152-01-",
        "asset_sat_code": "152.01",
        "depreciation_account_number": "171-01-000",
        "depreciation_sat_code": "171.01",
        "expense_account_number": "613-01-000",
        "expense_sat_code": "613.01",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "153-00-000",
        "label": "153-00-000 - Maquinaria y equipo",
        "short_name": "Maquinaria y equipo",
        "sat_rate": 10.0,
        "asset_parent_number": "153-01-000",
        "asset_prefix": "153-01-",
        "asset_sat_code": "153.01",
        "depreciation_account_number": "171-02-000",
        "depreciation_sat_code": "171.02",
        "expense_account_number": "613-02-000",
        "expense_sat_code": "613.02",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "154-00-000",
        "label": "154-00-000 - Automóviles, autobuses, camiones de carga, tractocamiones, montacargas y remolques",
        "short_name": "Automóviles y equipo de transporte",
        "sat_rate": 25.0,
        "asset_parent_number": "154-01-000",
        "asset_prefix": "154-01-",
        "asset_sat_code": "154.01",
        "depreciation_account_number": "171-03-000",
        "depreciation_sat_code": "171.03",
        "expense_account_number": "613-03-000",
        "expense_sat_code": "613.03",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": 175000.0,
    },
    {
        "code": "155-00-000",
        "label": "155-00-000 - Mobiliario y equipo de oficina",
        "short_name": "Mobiliario y equipo de oficina",
        "sat_rate": 10.0,
        "asset_parent_number": "155-01-000",
        "asset_prefix": "155-01-",
        "asset_sat_code": "155.01",
        "depreciation_account_number": "171-04-000",
        "depreciation_sat_code": "171.04",
        "expense_account_number": "613-04-000",
        "expense_sat_code": "613.04",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "156-00-000",
        "label": "156-00-000 - Equipo de cómputo",
        "short_name": "Equipo de cómputo",
        "sat_rate": 30.0,
        "asset_parent_number": "156-01-000",
        "asset_prefix": "156-01-",
        "asset_sat_code": "156.01",
        "depreciation_account_number": "171-05-000",
        "depreciation_sat_code": "171.05",
        "expense_account_number": "613-05-000",
        "expense_sat_code": "613.05",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "157-00-000",
        "label": "157-00-000 - Equipo de comunicación",
        "short_name": "Equipo de comunicación",
        "sat_rate": 10.0,
        "asset_parent_number": "157-01-000",
        "asset_prefix": "157-01-",
        "asset_sat_code": "157.01",
        "depreciation_account_number": "171-06-000",
        "depreciation_sat_code": "171.06",
        "expense_account_number": "613-06-000",
        "expense_sat_code": "613.06",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "158-00-000",
        "label": "158-00-000 - Activos biológicos, vegetales y semovientes",
        "short_name": "Activos biológicos, vegetales y semovientes",
        "sat_rate": 25.0,
        "asset_parent_number": "158-01-000",
        "asset_prefix": "158-01-",
        "asset_sat_code": "158.01",
        "depreciation_account_number": "171-07-000",
        "depreciation_sat_code": "171.07",
        "expense_account_number": "613-07-000",
        "expense_sat_code": "613.07",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "159-00-000",
        "label": "159-00-000 - Obras en proceso de activos fijos",
        "short_name": "Obras en proceso de activos fijos",
        "sat_rate": 0.0,
        "asset_parent_number": "159-01-000",
        "asset_prefix": "159-01-",
        "asset_sat_code": "159.01",
        "depreciation_account_number": "171-08-000",
        "depreciation_sat_code": "171.08",
        "expense_account_number": "613-08-000",
        "expense_sat_code": "613.08",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "160-00-000",
        "label": "160-00-000 - Otros activos fijos",
        "short_name": "Otros activos fijos",
        "sat_rate": 10.0,
        "asset_parent_number": "160-01-000",
        "asset_prefix": "160-01-",
        "asset_sat_code": "160.01",
        "depreciation_account_number": "171-08-000",
        "depreciation_sat_code": "171.08",
        "expense_account_number": "613-08-000",
        "expense_sat_code": "613.08",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "161-00-000",
        "label": "161-00-000 - Ferrocarriles",
        "short_name": "Ferrocarriles",
        "sat_rate": 5.0,
        "asset_parent_number": "161-01-000",
        "asset_prefix": "161-01-",
        "asset_sat_code": "161.01",
        "depreciation_account_number": "171-09-000",
        "depreciation_sat_code": "171.09",
        "expense_account_number": "613-09-000",
        "expense_sat_code": "613.09",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "162-00-000",
        "label": "162-00-000 - Embarcaciones",
        "short_name": "Embarcaciones",
        "sat_rate": 6.0,
        "asset_parent_number": "162-01-000",
        "asset_prefix": "162-01-",
        "asset_sat_code": "162.01",
        "depreciation_account_number": "171-10-000",
        "depreciation_sat_code": "171.10",
        "expense_account_number": "613-10-000",
        "expense_sat_code": "613.10",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "163-00-000",
        "label": "163-00-000 - Aviones",
        "short_name": "Aviones",
        "sat_rate": 10.0,
        "asset_parent_number": "163-01-000",
        "asset_prefix": "163-01-",
        "asset_sat_code": "163.01",
        "depreciation_account_number": "171-11-000",
        "depreciation_sat_code": "171.11",
        "expense_account_number": "613-11-000",
        "expense_sat_code": "613.11",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "164-00-000",
        "label": "164-00-000 - Troqueles, moldes, matrices y herramental",
        "short_name": "Troqueles, moldes, matrices y herramental",
        "sat_rate": 35.0,
        "asset_parent_number": "164-01-000",
        "asset_prefix": "164-01-",
        "asset_sat_code": "164.01",
        "depreciation_account_number": "171-12-000",
        "depreciation_sat_code": "171.12",
        "expense_account_number": "613-12-000",
        "expense_sat_code": "613.12",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "165-00-000",
        "label": "165-00-000 - Equipo de comunicaciones telefónicas",
        "short_name": "Equipo de comunicaciones telefónicas",
        "sat_rate": 10.0,
        "asset_parent_number": "165-01-000",
        "asset_prefix": "165-01-",
        "asset_sat_code": "165.01",
        "depreciation_account_number": "171-13-000",
        "depreciation_sat_code": "171.13",
        "expense_account_number": "613-13-000",
        "expense_sat_code": "613.13",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "166-00-000",
        "label": "166-00-000 - Equipo de comunicación satelital",
        "short_name": "Equipo de comunicación satelital",
        "sat_rate": 8.0,
        "asset_parent_number": "166-01-000",
        "asset_prefix": "166-01-",
        "asset_sat_code": "166.01",
        "depreciation_account_number": "171-14-000",
        "depreciation_sat_code": "171.14",
        "expense_account_number": "613-14-000",
        "expense_sat_code": "613.14",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "167-00-000",
        "label": "167-00-000 - Equipo de adaptaciones para personas con capacidades diferentes",
        "short_name": "Adaptaciones personas con discapacidad",
        "sat_rate": 100.0,
        "asset_parent_number": "167-01-000",
        "asset_prefix": "167-01-",
        "asset_sat_code": "167.01",
        "depreciation_account_number": "171-15-000",
        "depreciation_sat_code": "171.15",
        "expense_account_number": "613-15-000",
        "expense_sat_code": "613.15",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "168-00-000",
        "label": "168-00-000 - Maquinaria y equipo de generación de energía de fuentes renovables",
        "short_name": "Maquinaria energía renovable",
        "sat_rate": 100.0,
        "asset_parent_number": "168-01-000",
        "asset_prefix": "168-01-",
        "asset_sat_code": "168.01",
        "depreciation_account_number": "171-16-000",
        "depreciation_sat_code": "171.16",
        "expense_account_number": "613-16-000",
        "expense_sat_code": "613.16",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "169-00-000",
        "label": "169-00-000 - Otra maquinaria y equipo",
        "short_name": "Otra maquinaria y equipo",
        "sat_rate": 10.0,
        "asset_parent_number": "169-01-000",
        "asset_prefix": "169-01-",
        "asset_sat_code": "169.01",
        "depreciation_account_number": "171-17-000",
        "depreciation_sat_code": "171.17",
        "expense_account_number": "613-17-000",
        "expense_sat_code": "613.17",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
    {
        "code": "170-00-000",
        "label": "170-00-000 - Adaptaciones y mejoras",
        "short_name": "Adaptaciones y mejoras",
        "sat_rate": 5.0,
        "asset_parent_number": "170-01-000",
        "asset_prefix": "170-01-",
        "asset_sat_code": "170.01",
        "depreciation_account_number": "171-18-000",
        "depreciation_sat_code": "171.18",
        "expense_account_number": "613-18-000",
        "expense_sat_code": "613.18",
        "non_deductible_account_number": "601-83-000",
        "non_deductible_sat_code": "601.83",
        "max_deductible_moi": None,
    },
]

INVESTMENT_TYPES_BY_CODE = {item["code"]: item for item in INVESTMENT_TYPES_CATALOG}
for _item in INVESTMENT_TYPES_CATALOG:
    INVESTMENT_TYPES_BY_CODE[_item["code"][:3]] = _item

# Mapeo de UsoCFDI (I01..I08) hacia las Cuentas de Mayor de Activo Fijo (151-00-000 a 170-00-000)
USO_CFDI_TO_MAYOR = {
    "I01": "152-00-000",
    "I02": "155-00-000",
    "I03": "154-00-000",
    "I04": "156-00-000",
    "I05": "164-00-000",
    "I06": "165-00-000",
    "I07": "166-00-000",
    "I08": "153-00-000",
    "TERRENOS": "151-00-000",
    "ADAPTACIONES": "170-00-000",
    "INTANGIBLES": "160-00-000",
}
for _uso, _mayor in USO_CFDI_TO_MAYOR.items():
    if _mayor in INVESTMENT_TYPES_BY_CODE:
        INVESTMENT_TYPES_BY_CODE[_uso] = INVESTMENT_TYPES_BY_CODE[_mayor]


def _ensure_account_active_and_afectable(
    db: Session,
    client_id: int,
    account_number: str,
    sat_code: str,
    fallback_name: str,
    nature: str = "deudora"
) -> Account:
    acc = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number == account_number
    ).first()

    if not acc:
        acc = db.query(Account).filter(
            Account.client_id == client_id,
            Account.sat_group_code == sat_code
        ).order_by(Account.account_number.asc()).first()

    if acc:
        changed = False
        if not acc.is_active:
            acc.is_active = True
            changed = True
        # Si hay subcuentas afectables bajo esta cuenta, preferir o permitir que sea afectable
        sub_afectables = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number.like(f"{account_number[:6]}-%"),
            Account.account_number != account_number,
            Account.is_active == True
        ).order_by(Account.account_number.asc()).all()
        if sub_afectables:
            if changed:
                db.commit()
            return sub_afectables[0]

        if acc.classification != "Afectable":
            acc.classification = "Afectable"
            changed = True
        if changed:
            db.commit()
            db.refresh(acc)
        return acc

    # Si no existe en absoluto, crearla
    new_acc = Account(
        client_id=client_id,
        account_number=account_number,
        name=fallback_name[:300],
        sat_group_code=sat_code,
        level=2 if account_number.endswith("-000") else 3,
        nature=nature,
        classification="Afectable",
        is_active=True
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    return new_acc


def _create_or_find_asset_subaccount(
    db: Session,
    client_id: int,
    type_cfg: dict,
    description: Optional[str] = None,
    force_new: bool = False
) -> Account:
    prefix = type_cfg["asset_prefix"]  # Ej: '154-01-'
    parent_num = type_cfg["asset_parent_number"]  # Ej: '154-01-000'
    sat_code = type_cfg["asset_sat_code"]
    clean_desc = (description or "").strip()

    parent_acc = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number == parent_num
    ).first()
    if parent_acc and not parent_acc.is_active:
        parent_acc.is_active = True
        db.commit()

    existing_subs = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number.like(f"{prefix}%"),
        Account.account_number != parent_num
    ).order_by(Account.account_number.asc()).all()

    # 1. Si no se fuerza crear nueva y ya existe una subcuenta con exactamente la misma descripción
    if not force_new and clean_desc:
        for sub in existing_subs:
            if sub.name.strip().upper() == clean_desc.upper():
                if not sub.is_active or sub.classification != "Afectable":
                    sub.is_active = True
                    sub.classification = "Afectable"
                    db.commit()
                    db.refresh(sub)
                return sub

    # 2. Calcular el siguiente número consecutivo (ej. 154-01-001, 154-01-002...)
    max_seq = 0
    for sub in existing_subs:
        parts = (sub.account_number or "").split("-")
        if len(parts) == 3 and parts[2].isdigit():
            seq = int(parts[2])
            if seq > max_seq:
                max_seq = seq

    next_seq = max_seq + 1
    new_acc_number = f"{prefix}{next_seq:03d}"
    sub_name = clean_desc if clean_desc else f"{type_cfg['short_name']} {next_seq:03d}"

    new_sub = Account(
        client_id=client_id,
        account_number=new_acc_number,
        name=sub_name[:300],
        sat_group_code=sat_code,
        level=3,
        nature="deudora",
        parent_id=parent_acc.id if parent_acc else None,
        classification="Afectable",
        is_active=True
    )
    db.add(new_sub)
    db.commit()
    db.refresh(new_sub)
    return new_sub


class PrepareAssetTypeRequest(BaseModel):
    asset_type: str
    description: Optional[str] = None
    moi: Optional[float] = 0.0
    create_subaccount: bool = True
    current_asset_account_id: Optional[int] = None


class FixedAssetCreateUpdateRequest(BaseModel):
    description: str
    asset_type: str
    acquisition_date: str  # YYYY-MM-DD
    depreciation_start_date: str  # YYYY-MM-DD
    has_disposal: bool = False
    disposal_date: Optional[str] = None
    moi: float = 0.0
    depreciation_rate: float = 0.0
    deductible_moi: float = 0.0
    deductible_depreciation_rate: float = 0.0
    sale_price: float = 0.0
    asset_account_id: Optional[int] = None
    depreciation_account_id: Optional[int] = None
    expense_account_id: Optional[int] = None
    non_deductible_account_id: Optional[int] = None
    cfdi_invoice_id: Optional[int] = None
    cfdi_uuid: Optional[str] = None


@router.post("/inversiones/{client_id}/prepare-type")
def prepare_investment_type_accounts(
    client_id: int,
    payload: PrepareAssetTypeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    code = (payload.asset_type or "I04").strip().upper()
    type_cfg = INVESTMENT_TYPES_BY_CODE.get(code) or INVESTMENT_TYPES_BY_CODE["I04"]

    # 1. Resolver o crear subcuenta de Activo Fijo
    asset_acc = None
    if payload.create_subaccount:
        asset_acc = _create_or_find_asset_subaccount(
            db=db,
            client_id=client_id,
            type_cfg=type_cfg,
            description=payload.description,
            force_new=False
        )
    else:
        existing_subs = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number.like(f"{type_cfg['asset_prefix']}%"),
            Account.is_active == True
        ).order_by(Account.level.desc(), Account.account_number.asc()).all()
        if existing_subs:
            asset_acc = existing_subs[0]
        else:
            asset_acc = _create_or_find_asset_subaccount(
                db=db,
                client_id=client_id,
                type_cfg=type_cfg,
                description=payload.description
            )

    # 2. Resolver cuentas de Depreciación Acumulada, Gasto y No Deducible
    deprec_acc = _ensure_account_active_and_afectable(
        db=db,
        client_id=client_id,
        account_number=type_cfg["depreciation_account_number"],
        sat_code=type_cfg["depreciation_sat_code"],
        fallback_name=f"Depreciación acumulada de {type_cfg['short_name'].lower()}",
        nature="acreedora"
    )
    expense_acc = _ensure_account_active_and_afectable(
        db=db,
        client_id=client_id,
        account_number=type_cfg["expense_account_number"],
        sat_code=type_cfg["expense_sat_code"],
        fallback_name=f"Depreciación de {type_cfg['short_name'].lower()}",
        nature="deudora"
    )
    non_ded_acc = _ensure_account_active_and_afectable(
        db=db,
        client_id=client_id,
        account_number=type_cfg["non_deductible_account_number"],
        sat_code=type_cfg["non_deductible_sat_code"],
        fallback_name="Gastos no deducibles",
        nature="deudora"
    )

    moi_val = float(payload.moi or 0.0)
    max_ded = type_cfg.get("max_deductible_moi")
    if max_ded and moi_val > max_ded:
        deductible_moi = max_ded
    else:
        deductible_moi = moi_val

    return {
        "asset_type": type_cfg["code"],
        "asset_type_label": type_cfg["label"],
        "sat_rate": type_cfg["sat_rate"],
        "depreciation_rate": type_cfg["sat_rate"],
        "deductible_depreciation_rate": type_cfg["sat_rate"],
        "deductible_moi": round(deductible_moi, 2),
        "max_deductible_moi": max_ded,
        "accounts": {
            "asset_account": {
                "id": asset_acc.id,
                "account_number": asset_acc.account_number,
                "name": asset_acc.name,
            },
            "depreciation_account": {
                "id": deprec_acc.id,
                "account_number": deprec_acc.account_number,
                "name": deprec_acc.name,
            },
            "expense_account": {
                "id": expense_acc.id,
                "account_number": expense_acc.account_number,
                "name": expense_acc.name,
            },
            "non_deductible_account": {
                "id": non_ded_acc.id,
                "account_number": non_ded_acc.account_number,
                "name": non_ded_acc.name,
            },
        }
    }


def _parse_iso_date(val: Optional[str], fallback: Optional[date] = None) -> Optional[date]:
    if not val:
        return fallback
    try:
        return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
    except Exception:
        return fallback


MESES_ES_NOMBRES = {
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


def _format_fixed_asset(asset: FixedAsset, year: int, month: int, acc_map: Dict[int, Account]) -> dict:
    moi = float(asset.moi or 0.0)
    ded_moi = float(asset.deductible_moi if asset.deductible_moi is not None else moi)
    rate_contable = float(asset.depreciation_rate or 0.0)
    rate_fiscal = float(asset.deductible_depreciation_rate or 0.0)
    effective_rate_contable = rate_contable if rate_contable > 0 else rate_fiscal

    acq_date = asset.acquisition_date or date(year, 1, 1)
    start_date = asset.depreciation_start_date or acq_date
    cutoff_date = date(year, month, calendar.monthrange(year, month)[1])

    effective_end_date = cutoff_date
    if asset.has_disposal and asset.disposal_date and asset.disposal_date < cutoff_date:
        effective_end_date = asset.disposal_date

    # Calcular meses transcurridos desde fecha de inicio de depreciación hasta el corte
    if effective_end_date < start_date or (rate_fiscal <= 0 and effective_rate_contable <= 0):
        meses_acumulados = 0
        meses_ejercicio = 0
    else:
        meses_acumulados = max(
            0,
            (effective_end_date.year - start_date.year) * 12 + (effective_end_date.month - start_date.month) + 1
        )
        start_of_year = date(year, 1, 1)
        ej_start = max(start_date, start_of_year)
        if effective_end_date >= ej_start and effective_end_date.year == year:
            meses_ejercicio = max(0, effective_end_date.month - ej_start.month + 1)
        else:
            meses_ejercicio = 0

    tasa_mensual_fiscal = (rate_fiscal / 100.0) / 12.0
    deprec_mensual = round(ded_moi * tasa_mensual_fiscal, 2)
    deprec_acumulada = min(ded_moi, round(deprec_mensual * meses_acumulados, 2))
    deprec_previa = max(0.0, round(deprec_mensual * max(0, meses_acumulados - meses_ejercicio), 2))
    deprec_ejercicio = max(0.0, round(deprec_acumulada - min(ded_moi, deprec_previa), 2))
    saldo_por_deducir = max(0.0, round(ded_moi - deprec_acumulada, 2))

    # Depreciación contable mensual base y devengada específicamente en el mes (year, month)
    tasa_mensual_contable = (effective_rate_contable / 100.0) / 12.0
    deprec_mensual_contable = round(moi * tasa_mensual_contable, 2)
    deprec_no_deducible_mensual = max(0.0, round(deprec_mensual_contable - deprec_mensual, 2))

    # Determinar si el activo se deprecia activamente en este (year, month)
    active_in_selected_month = (
        (year, month) >= (start_date.year, start_date.month)
        and not (asset.has_disposal and asset.disposal_date and (asset.disposal_date.year, asset.disposal_date.month) < (year, month))
        and effective_rate_contable > 0
        and moi > 0
    )

    if active_in_selected_month:
        meses_previos = max(0, (year - start_date.year) * 12 + (month - start_date.month))
        acum_contable_previa = min(moi, round(deprec_mensual_contable * meses_previos, 2))
        remanente_contable = max(0.0, round(moi - acum_contable_previa, 2))
        deprec_contable_mes_actual = min(remanente_contable, deprec_mensual_contable)

        if ded_moi > 0 and rate_fiscal > 0:
            acum_fiscal_previa = min(ded_moi, round(deprec_mensual * meses_previos, 2))
            remanente_fiscal = max(0.0, round(ded_moi - acum_fiscal_previa, 2))
            deprec_deducible_mes_actual = min(remanente_fiscal, deprec_mensual)
        else:
            deprec_deducible_mes_actual = 0.0 if (ded_moi == 0 and rate_fiscal == 0 and asset.non_deductible_account_id) else deprec_contable_mes_actual

        cargo_gasto_mes_actual = round(min(deprec_contable_mes_actual, deprec_deducible_mes_actual), 2)
        cargo_no_deducible_mes_actual = max(0.0, round(deprec_contable_mes_actual - cargo_gasto_mes_actual, 2))
        abono_depreciacion_mes_actual = round(deprec_contable_mes_actual, 2)
    else:
        deprec_contable_mes_actual = 0.0
        cargo_gasto_mes_actual = 0.0
        cargo_no_deducible_mes_actual = 0.0
        abono_depreciacion_mes_actual = 0.0

    asset_acc = acc_map.get(asset.asset_account_id)
    deprec_acc = acc_map.get(asset.depreciation_account_id)
    expense_acc = acc_map.get(asset.expense_account_id)
    non_ded_acc = acc_map.get(asset.non_deductible_account_id)

    return {
        "id": asset.id,
        "is_registered_asset": True,
        "client_id": asset.client_id,
        "cfdi_invoice_id": asset.cfdi_invoice_id,
        "cfdi_uuid": asset.cfdi_uuid,
        "description": asset.description,
        "name": asset.description,
        "asset_type": asset.asset_type,
        "tipo_activo": asset.asset_type_label or asset.asset_type,
        "acquisition_date": asset.acquisition_date.isoformat() if asset.acquisition_date else None,
        "depreciation_start_date": asset.depreciation_start_date.isoformat() if asset.depreciation_start_date else None,
        "has_disposal": bool(asset.has_disposal),
        "disposal_date": asset.disposal_date.isoformat() if asset.disposal_date else None,
        "moi": round(moi, 2),
        "depreciation_rate": round(rate_contable, 2),
        "deductible_moi": round(ded_moi, 2),
        "deductible_depreciation_rate": round(rate_fiscal, 2),
        "tasa_anual_lisr": round(rate_fiscal, 2),
        "sale_price": round(float(asset.sale_price or 0.0), 2),
        "depreciacion_mensual": deprec_mensual,
        "depreciacion_mensual_contable": deprec_mensual_contable,
        "depreciacion_no_deducible_mensual": deprec_no_deducible_mensual,
        "depreciacion_contable_mes_actual": deprec_contable_mes_actual,
        "cargo_gasto_mes_actual": cargo_gasto_mes_actual,
        "cargo_no_deducible_mes_actual": cargo_no_deducible_mes_actual,
        "abono_depreciacion_mes_actual": abono_depreciacion_mes_actual,
        "depreciacion_ejercicio": deprec_ejercicio,
        "depreciacion_acumulada": deprec_acumulada,
        "saldo_por_deducir": saldo_por_deducir,
        "meses_uso_ejercicio": meses_ejercicio,
        "meses_uso_acumulados": meses_acumulados,
        "account_id": asset.asset_account_id or f"asset-{asset.id}",
        "account_number": asset_acc.account_number if asset_acc else "S/C",
        "asset_account_id": asset.asset_account_id,
        "depreciation_account_id": asset.depreciation_account_id,
        "expense_account_id": asset.expense_account_id,
        "non_deductible_account_id": asset.non_deductible_account_id,
        "accounts_detail": {
            "activo": f"{asset_acc.account_number} - {asset_acc.name}" if asset_acc else None,
            "depreciacion": f"{deprec_acc.account_number} - {deprec_acc.name}" if deprec_acc else None,
            "gasto": f"{expense_acc.account_number} - {expense_acc.name}" if expense_acc else None,
            "no_deducible": f"{non_ded_acc.account_number} - {non_ded_acc.name}" if non_ded_acc else None,
        }
    }


@router.post("/inversiones/{client_id}")
def create_fixed_asset(
    client_id: int,
    payload: FixedAssetCreateUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    code = (payload.asset_type or "I04").strip().upper()
    type_cfg = INVESTMENT_TYPES_BY_CODE.get(code) or INVESTMENT_TYPES_BY_CODE["I04"]

    acq_date = _parse_iso_date(payload.acquisition_date, date.today())
    dep_date = _parse_iso_date(payload.depreciation_start_date, acq_date)
    disp_date = _parse_iso_date(payload.disposal_date, None) if payload.has_disposal else None

    # Si no se especificó cuenta de Activo o se solicitó creación automática, crear subcuenta
    asset_acc_id = payload.asset_account_id
    if not asset_acc_id:
        created_acc = _create_or_find_asset_subaccount(
            db=db,
            client_id=client_id,
            type_cfg=type_cfg,
            description=payload.description
        )
        asset_acc_id = created_acc.id
    else:
        acc_obj = db.query(Account).filter(Account.id == asset_acc_id, Account.client_id == client_id).first()
        if acc_obj:
            acc_obj.is_active = True
            acc_obj.classification = "Afectable"
            # Si la subcuenta tenía nombre genérico (ej. "Equipo de cómputo 001"), actualizar con la descripción capturada
            if payload.description and acc_obj.level == 3 and acc_obj.name.startswith(type_cfg["short_name"]):
                acc_obj.name = payload.description.strip()[:300]
            db.commit()

    # Asegurar cuentas de depreciación, gasto y no deducible
    dep_acc_id = payload.depreciation_account_id
    if not dep_acc_id:
        dep_acc_id = _ensure_account_active_and_afectable(
            db, client_id,
            type_cfg["depreciation_account_number"],
            type_cfg["depreciation_sat_code"],
            f"Depreciación acumulada de {type_cfg['short_name'].lower()}",
            "acreedora"
        ).id

    exp_acc_id = payload.expense_account_id
    if not exp_acc_id:
        exp_acc_id = _ensure_account_active_and_afectable(
            db, client_id,
            type_cfg["expense_account_number"],
            type_cfg["expense_sat_code"],
            f"Depreciación de {type_cfg['short_name'].lower()}",
            "deudora"
        ).id

    nonded_acc_id = payload.non_deductible_account_id
    if not nonded_acc_id:
        nonded_acc_id = _ensure_account_active_and_afectable(
            db, client_id,
            type_cfg["non_deductible_account_number"],
            type_cfg["non_deductible_sat_code"],
            "Gastos no deducibles",
            "deudora"
        ).id

    new_asset = FixedAsset(
        client_id=client_id,
        cfdi_invoice_id=payload.cfdi_invoice_id,
        cfdi_uuid=(payload.cfdi_uuid or "").strip().upper() or None,
        description=payload.description.strip(),
        asset_type=code,
        asset_type_label=type_cfg["label"],
        acquisition_date=acq_date,
        depreciation_start_date=dep_date,
        has_disposal=payload.has_disposal,
        disposal_date=disp_date,
        moi=payload.moi,
        depreciation_rate=payload.depreciation_rate,
        deductible_moi=payload.deductible_moi,
        deductible_depreciation_rate=payload.deductible_depreciation_rate,
        sale_price=payload.sale_price,
        asset_account_id=asset_acc_id,
        depreciation_account_id=dep_acc_id,
        expense_account_id=exp_acc_id,
        non_deductible_account_id=nonded_acc_id,
        is_active=True
    )
    db.add(new_asset)
    db.commit()
    db.refresh(new_asset)

    # Si proviene de un CFDI con uso Inversión (I01..I08), vincular automáticamente la cuenta de Activo al CFDI
    if payload.cfdi_invoice_id or payload.cfdi_uuid:
        inv_q = db.query(CFDIInvoice).filter(CFDIInvoice.client_id == client_id)
        if payload.cfdi_invoice_id:
            inv = inv_q.filter(CFDIInvoice.id == payload.cfdi_invoice_id).first()
        else:
            inv = inv_q.filter(CFDIInvoice.uuid == (payload.cfdi_uuid or "").strip().upper()).first()
        if inv and asset_acc_id:
            inv.assigned_account_id = asset_acc_id
            new_asset.cfdi_invoice_id = inv.id
            new_asset.cfdi_uuid = inv.uuid
            db.commit()

    all_accs = {a.id: a for a in db.query(Account).filter(Account.client_id == client_id).all()}
    return _format_fixed_asset(new_asset, acq_date.year, acq_date.month, all_accs)


@router.put("/inversiones/{client_id}/{asset_id}")
def update_fixed_asset(
    client_id: int,
    asset_id: int,
    payload: FixedAssetCreateUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    asset = db.query(FixedAsset).filter(
        FixedAsset.id == asset_id,
        FixedAsset.client_id == client_id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Activo fijo no encontrado")

    code = (payload.asset_type or asset.asset_type or "I04").strip().upper()
    type_cfg = INVESTMENT_TYPES_BY_CODE.get(code) or INVESTMENT_TYPES_BY_CODE["I04"]

    asset.description = payload.description.strip()
    asset.asset_type = code
    asset.asset_type_label = type_cfg["label"]
    asset.acquisition_date = _parse_iso_date(payload.acquisition_date, asset.acquisition_date)
    asset.depreciation_start_date = _parse_iso_date(payload.depreciation_start_date, asset.depreciation_start_date)
    asset.has_disposal = payload.has_disposal
    asset.disposal_date = _parse_iso_date(payload.disposal_date, None) if payload.has_disposal else None
    asset.moi = payload.moi
    asset.depreciation_rate = payload.depreciation_rate
    asset.deductible_moi = payload.deductible_moi
    asset.deductible_depreciation_rate = payload.deductible_depreciation_rate
    asset.sale_price = payload.sale_price

    if payload.asset_account_id:
        asset.asset_account_id = payload.asset_account_id
    if payload.depreciation_account_id:
        asset.depreciation_account_id = payload.depreciation_account_id
    if payload.expense_account_id:
        asset.expense_account_id = payload.expense_account_id
    if payload.non_deductible_account_id:
        asset.non_deductible_account_id = payload.non_deductible_account_id

    db.commit()
    db.refresh(asset)

    all_accs = {a.id: a for a in db.query(Account).filter(Account.client_id == client_id).all()}
    return _format_fixed_asset(asset, asset.acquisition_date.year, asset.acquisition_date.month, all_accs)


@router.delete("/inversiones/{client_id}/{asset_id}")
def delete_fixed_asset(
    client_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    asset = db.query(FixedAsset).filter(
        FixedAsset.id == asset_id,
        FixedAsset.client_id == client_id
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Activo fijo no encontrado")

    db.delete(asset)
    db.commit()
    return {"message": "Activo fijo eliminado correctamente"}


@router.get("/inversiones/{client_id}")
def get_inversiones_report(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    all_accounts = db.query(Account).filter(Account.client_id == client_id).order_by(Account.account_number.asc()).all()
    acc_map = {a.id: a for a in all_accounts}

    # 1. Activos Fijos registrados explícitamente en la tabla fixed_assets
    registered_assets = (
        db.query(FixedAsset)
        .filter(FixedAsset.client_id == client_id, FixedAsset.is_active == True)
        .order_by(FixedAsset.acquisition_date.asc(), FixedAsset.id.asc())
        .all()
    )

    items = []
    registered_account_ids = set()
    registered_cfdi_uuids = set()

    total_moi = 0.0
    total_deductible_moi = 0.0
    total_deprec_acum = 0.0
    total_deprec_ejercicio = 0.0
    total_saldo_por_deducir = 0.0

    for asset in registered_assets:
        if asset.asset_account_id:
            registered_account_ids.add(asset.asset_account_id)
        if asset.cfdi_uuid:
            registered_cfdi_uuids.add(asset.cfdi_uuid.strip().upper())

        formatted = _format_fixed_asset(asset, year, month, acc_map)
        items.append(formatted)

        total_moi += formatted["moi"]
        total_deductible_moi += formatted["deductible_moi"]
        total_deprec_acum += formatted["depreciacion_acumulada"]
        total_deprec_ejercicio += formatted["depreciacion_ejercicio"]
        total_saldo_por_deducir += formatted["saldo_por_deducir"]

    # 2. Detectar CFDIs con UsoCFDI de Inversión ('I01' a 'I08' o que empiece con 'I')
    inversion_cfdis = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            func.upper(CFDIInvoice.cfdi_use).like("I%")
        )
        .order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc())
        .all()
    )

    detected_cfdis_list = []
    for inv in inversion_cfdis:
        u_uuid = (inv.uuid or "").strip().upper()
        already_registered = u_uuid in registered_cfdi_uuids
        uso_code = (inv.cfdi_use or "I04").strip().upper()
        type_cfg = INVESTMENT_TYPES_BY_CODE.get(uso_code) or INVESTMENT_TYPES_BY_CODE["I04"]

        detected_cfdis_list.append({
            "id": inv.id,
            "uuid": u_uuid,
            "folio": inv.folio or u_uuid[:8],
            "date": inv.date.strftime("%Y-%m-%d") if inv.date else date.today().isoformat(),
            "formatted_date": inv.date.strftime("%d/%m/%Y") if inv.date else "",
            "issuer_rfc": inv.issuer_rfc,
            "issuer_name": inv.issuer_name,
            "cfdi_use": uso_code,
            "cfdi_use_label": type_cfg["label"],
            "sat_rate": type_cfg["sat_rate"],
            "description": inv.description or f"{type_cfg['short_name']} - Factura {inv.folio or u_uuid[:8]}",
            "subtotal": float(inv.subtotal or 0.0),
            "total": float(inv.total or 0.0),
            "assigned_account_id": inv.assigned_account_id,
            "is_posted": inv.is_posted,
            "already_registered": already_registered,
        })

    # 3. Cuentas contables de Activo Fijo con saldo en pólizas que aún no tengan ficha en fixed_assets
    RATES_MAP = {
        "151": {"code": "TERRENOS", "name": "Terrenos", "rate": 0.0},
        "152": {"code": "I01", "name": "Edificios y construcciones", "rate": 5.0},
        "153": {"code": "I08", "name": "Maquinaria y equipo", "rate": 10.0},
        "154": {"code": "I03", "name": "Automóviles y equipo de transporte", "rate": 25.0},
        "155": {"code": "I02", "name": "Mobiliario y equipo de oficina", "rate": 10.0},
        "156": {"code": "I04", "name": "Equipo de cómputo", "rate": 30.0},
        "157": {"code": "I06", "name": "Equipo de comunicación", "rate": 10.0},
        "160": {"code": "I05", "name": "Dados, troqueles y herramental", "rate": 35.0},
        "165": {"code": "ADAPTACIONES", "name": "Adaptaciones y mejoras", "rate": 5.0},
        "173": {"code": "INTANGIBLES", "name": "Gastos diferidos", "rate": 5.0},
        "174": {"code": "INTANGIBLES", "name": "Gastos pre operativos", "rate": 10.0},
        "176": {"code": "INTANGIBLES", "name": "Activos intangibles", "rate": 15.0},
    }

    asset_accounts = [
        a for a in all_accounts
        if a.account_number.startswith(("15", "16", "17"))
        and not a.account_number.startswith(("171", "172"))
        and a.classification == "Afectable"
        and a.id not in registered_account_ids
    ]

    if asset_accounts:
        cutoff_date = date(year, month, calendar.monthrange(year, month)[1])
        asset_ids = [a.id for a in asset_accounts]
        lines = (
            db.query(
                JournalLine.account_id,
                func.sum(JournalLine.debit).label("tot_debit"),
                func.sum(JournalLine.credit).label("tot_credit")
            )
            .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
            .filter(
                JournalEntry.client_id == client_id,
                JournalEntry.date <= cutoff_date,
                JournalEntry.is_cancelled == False,
                JournalLine.account_id.in_(asset_ids)
            )
            .group_by(JournalLine.account_id)
            .all()
        )
        movement_map = {row.account_id: (float(row.tot_debit or 0) - float(row.tot_credit or 0)) for row in lines}

        for acc in asset_accounts:
            moi = max(0.0, round(movement_map.get(acc.id, 0.0), 2))
            if moi <= 0:
                continue
            prefix = (acc.account_number or "")[:3]
            cfg = RATES_MAP.get(prefix, {"code": "I08", "name": acc.name, "rate": 10.0})
            type_cfg = INVESTMENT_TYPES_BY_CODE.get(prefix) or INVESTMENT_TYPES_BY_CODE.get(cfg["code"]) or INVESTMENT_TYPES_BY_CODE["I04"]
            rate = cfg["rate"]
            tasa_mensual = (rate / 100.0) / 12.0
            deprec_mensual = round(moi * tasa_mensual, 2)
            deprec_ejercicio = round(deprec_mensual * month, 2)
            deprec_acum = min(moi, deprec_ejercicio)
            saldo_por_deducir = max(0.0, round(moi - deprec_acum, 2))

            total_moi += moi
            total_deductible_moi += moi
            total_deprec_acum += deprec_acum
            total_deprec_ejercicio += deprec_ejercicio
            total_saldo_por_deducir += saldo_por_deducir

            dep_acc = next((a for a in all_accounts if a.account_number == type_cfg["depreciation_account_number"]), None)
            exp_acc = next((a for a in all_accounts if a.account_number == type_cfg["expense_account_number"]), None)
            nonded_acc = next((a for a in all_accounts if a.account_number == type_cfg["non_deductible_account_number"]), None)

            items.append({
                "id": None,
                "is_registered_asset": False,
                "account_id": acc.id,
                "asset_account_id": acc.id,
                "depreciation_account_id": dep_acc.id if dep_acc else None,
                "expense_account_id": exp_acc.id if exp_acc else None,
                "non_deductible_account_id": nonded_acc.id if nonded_acc else None,
                "account_number": acc.account_number,
                "name": acc.name,
                "description": acc.name,
                "asset_type": type_cfg["code"],
                "tipo_activo": cfg["name"],
                "acquisition_date": f"{year}-01-01",
                "depreciation_start_date": f"{year}-01-01",
                "has_disposal": False,
                "disposal_date": None,
                "tasa_anual_lisr": rate,
                "depreciation_rate": rate,
                "deductible_depreciation_rate": rate,
                "moi": moi,
                "deductible_moi": moi,
                "sale_price": 0.0,
                "depreciacion_mensual": deprec_mensual,
                "depreciacion_mensual_contable": deprec_mensual,
                "depreciacion_no_deducible_mensual": 0.0,
                "depreciacion_contable_mes_actual": deprec_mensual if rate > 0 else 0.0,
                "cargo_gasto_mes_actual": deprec_mensual if rate > 0 else 0.0,
                "cargo_no_deducible_mes_actual": 0.0,
                "abono_depreciacion_mes_actual": deprec_mensual if rate > 0 else 0.0,
                "depreciacion_ejercicio": deprec_ejercicio,
                "depreciacion_acumulada": deprec_acum,
                "saldo_por_deducir": saldo_por_deducir,
                "classification": acc.classification,
                "accounts_detail": {
                    "activo": f"{acc.account_number} - {acc.name}",
                    "depreciacion": f"{dep_acc.account_number} - {dep_acc.name}" if dep_acc else type_cfg["depreciation_account_number"],
                    "gasto": f"{exp_acc.account_number} - {exp_acc.name}" if exp_acc else type_cfg["expense_account_number"],
                    "no_deducible": f"{nonded_acc.account_number} - {nonded_acc.name}" if nonded_acc else type_cfg["non_deductible_account_number"],
                }
            })

    # 4. Construir vista previa de la Póliza de Diario de Depreciación Contable del Mes
    mes_nombre = MESES_ES_NOMBRES.get(month, str(month))
    last_day_num = calendar.monthrange(year, month)[1]
    entry_date = date(year, month, last_day_num)
    ref_code = f"DEPREC-{year}-{month:02d}"

    propuesta_lines = []
    tot_debe_prop = 0.0
    tot_haber_prop = 0.0
    activos_con_deprec = 0

    for item in items:
        abono_dep = float(item.get("abono_depreciacion_mes_actual") or 0.0)
        cargo_gasto = float(item.get("cargo_gasto_mes_actual") or 0.0)
        cargo_nonded = float(item.get("cargo_no_deducible_mes_actual") or 0.0)

        if abono_dep <= 0:
            continue

        activos_con_deprec += 1
        code = (item.get("asset_type") or "156-00-000").strip().upper()
        type_cfg = INVESTMENT_TYPES_BY_CODE.get(code) or INVESTMENT_TYPES_BY_CODE.get(code[:3]) or INVESTMENT_TYPES_BY_CODE["I04"]

        exp_acc = acc_map.get(item.get("expense_account_id"))
        nonded_acc = acc_map.get(item.get("non_deductible_account_id"))
        dep_acc = acc_map.get(item.get("depreciation_account_id"))

        exp_num = exp_acc.account_number if exp_acc else type_cfg["expense_account_number"]
        exp_name = exp_acc.name if exp_acc else f"Depreciación de {type_cfg['short_name'].lower()}"

        nonded_num = nonded_acc.account_number if nonded_acc else type_cfg["non_deductible_account_number"]
        nonded_name = nonded_acc.name if nonded_acc else "Gastos no deducibles"

        dep_num = dep_acc.account_number if dep_acc else type_cfg["depreciation_account_number"]
        dep_name = dep_acc.name if dep_acc else f"Depreciación acumulada de {type_cfg['short_name'].lower()}"

        asset_desc = item.get("description") or item.get("name") or "Activo fijo"
        asset_num = item.get("account_number") or ""

        if cargo_gasto > 0:
            propuesta_lines.append({
                "account_id": exp_acc.id if exp_acc else None,
                "account_number": exp_num,
                "account_name": exp_name,
                "asset_description": asset_desc,
                "asset_account_number": asset_num,
                "role": "Gasto",
                "description": f"Depreciación contable ({mes_nombre} {year}) - {asset_desc}",
                "debit": round(cargo_gasto, 2),
                "credit": 0.0,
            })
            tot_debe_prop += round(cargo_gasto, 2)

        if cargo_nonded > 0:
            propuesta_lines.append({
                "account_id": nonded_acc.id if nonded_acc else None,
                "account_number": nonded_num,
                "account_name": nonded_name,
                "asset_description": asset_desc,
                "asset_account_number": asset_num,
                "role": "No deducible",
                "description": f"Depreciación no deducible ({mes_nombre} {year}) - {asset_desc}",
                "debit": round(cargo_nonded, 2),
                "credit": 0.0,
            })
            tot_debe_prop += round(cargo_nonded, 2)

        propuesta_lines.append({
            "account_id": dep_acc.id if dep_acc else None,
            "account_number": dep_num,
            "account_name": dep_name,
            "asset_description": asset_desc,
            "asset_account_number": asset_num,
            "role": "Depreciación",
            "description": f"Depreciación acumulada ({mes_nombre} {year}) - {asset_desc}",
            "debit": 0.0,
            "credit": round(abono_dep, 2),
        })
        tot_haber_prop += round(abono_dep, 2)

    # 5. Verificar si ya existe la póliza de diario de depreciaciones del mes
    existing_poliza = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            JournalEntry.is_cancelled == False,
            or_(
                JournalEntry.reference == ref_code,
                and_(
                    JournalEntry.date == entry_date,
                    JournalEntry.description.ilike("%Depreciación contable del mes%")
                )
            )
        )
        .order_by(JournalEntry.id.desc())
        .first()
    )

    depreciacion_poliza_info = None
    if existing_poliza:
        depreciacion_poliza_info = {
            "id": existing_poliza.id,
            "entry_number": existing_poliza.entry_number,
            "entry_type": existing_poliza.entry_type,
            "date": existing_poliza.date.strftime("%Y-%m-%d") if existing_poliza.date else entry_date.strftime("%Y-%m-%d"),
            "formatted_date": existing_poliza.date.strftime("%d/%m/%Y") if existing_poliza.date else entry_date.strftime("%d/%m/%Y"),
            "description": existing_poliza.description,
            "reference": existing_poliza.reference,
            "total_debit": round(sum(float(l.debit or 0) for l in existing_poliza.lines), 2),
            "total_credit": round(sum(float(l.credit or 0) for l in existing_poliza.lines), 2),
        }

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year,
        "month": month,
        "period_description": f"{mes_nombre} {year}",
        "totales": {
            "monto_original_inversion": round(total_moi, 2),
            "moi_deducible": round(total_deductible_moi, 2),
            "depreciacion_acumulada": round(total_deprec_acum, 2),
            "depreciacion_ejercicio": round(total_deprec_ejercicio, 2),
            "saldo_por_deducir": round(total_saldo_por_deducir, 2),
            "depreciacion_contable_mes": round(tot_haber_prop, 2),
        },
        "activos": items,
        "cfdis_inversion_detectados": detected_cfdis_list,
        "catalog_types": INVESTMENT_TYPES_CATALOG,
        "depreciacion_poliza": depreciacion_poliza_info,
        "propuesta_poliza_mes": {
            "year": year,
            "month": month,
            "period_description": f"{mes_nombre} {year}",
            "entry_date": entry_date.strftime("%Y-%m-%d"),
            "formatted_date": entry_date.strftime("%d/%m/%Y"),
            "concepto": f"Depreciación contable del mes de {mes_nombre} {year}",
            "reference": ref_code,
            "activos_count": activos_con_deprec,
            "total_debit": round(tot_debe_prop, 2),
            "total_credit": round(tot_haber_prop, 2),
            "lines": propuesta_lines,
        }
    }


class GenerarPolizaDepreciacionRequest(BaseModel):
    year: int
    month: int


@router.post("/inversiones/{client_id}/generar-poliza-depreciacion")
def generar_poliza_depreciacion_mes(
    client_id: int,
    req: GenerarPolizaDepreciacionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    if not (1 <= req.month <= 12):
        raise HTTPException(status_code=400, detail="Mes inválido.")

    report_data = get_inversiones_report(
        client_id=client_id,
        year=req.year,
        month=req.month,
        db=db,
        current_user=current_user
    )

    activos = report_data.get("activos") or []
    if not activos:
        raise HTTPException(
            status_code=400,
            detail="No hay activos fijos registrados para generar la póliza de depreciación."
        )

    mes_nombre = MESES_ES_NOMBRES.get(req.month, str(req.month))
    last_day_num = calendar.monthrange(req.year, req.month)[1]
    entry_date = date(req.year, req.month, last_day_num)
    ref_code = f"DEPREC-{req.year}-{req.month:02d}"
    concepto_poliza = f"Depreciación contable del mes de {mes_nombre} {req.year}"

    all_accounts = db.query(Account).filter(Account.client_id == client_id).all()
    acc_map = {a.id: a for a in all_accounts}

    lines_to_create = []
    line_order = 1

    for item in activos:
        abono_dep = round(float(item.get("abono_depreciacion_mes_actual") or 0.0), 2)
        cargo_gasto = round(float(item.get("cargo_gasto_mes_actual") or 0.0), 2)
        cargo_nonded = round(float(item.get("cargo_no_deducible_mes_actual") or 0.0), 2)

        if abono_dep <= 0:
            continue

        code = (item.get("asset_type") or "156-00-000").strip().upper()
        type_cfg = INVESTMENT_TYPES_BY_CODE.get(code) or INVESTMENT_TYPES_BY_CODE.get(code[:3]) or INVESTMENT_TYPES_BY_CODE["I04"]
        asset_desc = item.get("description") or item.get("name") or "Activo fijo"

        # 1. Resolver Cuenta de Gasto capturada en el formulario (o fallback del catálogo)
        exp_acc = acc_map.get(item.get("expense_account_id"))
        if not exp_acc:
            exp_acc = _ensure_account_active_and_afectable(
                db=db,
                client_id=client_id,
                account_number=type_cfg["expense_account_number"],
                sat_code=type_cfg["expense_sat_code"],
                fallback_name=f"Depreciación de {type_cfg['short_name'].lower()}",
                nature="deudora"
            )
            acc_map[exp_acc.id] = exp_acc
        elif not exp_acc.is_active or exp_acc.classification != "Afectable":
            exp_acc.is_active = True
            exp_acc.classification = "Afectable"
            db.commit()

        # 2. Resolver Cuenta No Deducible capturada en el formulario (si aplica parte no deducible)
        nonded_acc = None
        if cargo_nonded > 0:
            nonded_acc = acc_map.get(item.get("non_deductible_account_id"))
            if not nonded_acc:
                nonded_acc = _ensure_account_active_and_afectable(
                    db=db,
                    client_id=client_id,
                    account_number=type_cfg["non_deductible_account_number"],
                    sat_code=type_cfg["non_deductible_sat_code"],
                    fallback_name="Gastos no deducibles",
                    nature="deudora"
                )
                acc_map[nonded_acc.id] = nonded_acc
            elif not nonded_acc.is_active or nonded_acc.classification != "Afectable":
                nonded_acc.is_active = True
                nonded_acc.classification = "Afectable"
                db.commit()

        # 3. Resolver Cuenta de Depreciación Acumulada capturada en el formulario
        dep_acc = acc_map.get(item.get("depreciation_account_id"))
        if not dep_acc:
            dep_acc = _ensure_account_active_and_afectable(
                db=db,
                client_id=client_id,
                account_number=type_cfg["depreciation_account_number"],
                sat_code=type_cfg["depreciation_sat_code"],
                fallback_name=f"Depreciación acumulada de {type_cfg['short_name'].lower()}",
                nature="acreedora"
            )
            acc_map[dep_acc.id] = dep_acc
        elif not dep_acc.is_active or dep_acc.classification != "Afectable":
            dep_acc.is_active = True
            dep_acc.classification = "Afectable"
            db.commit()

        # Si el activo está en FixedAsset y le faltaba algún ID de cuenta, actualizarlo
        if item.get("is_registered_asset") and item.get("id"):
            fa_obj = db.query(FixedAsset).filter(FixedAsset.id == item["id"]).first()
            if fa_obj:
                if not fa_obj.expense_account_id and exp_acc:
                    fa_obj.expense_account_id = exp_acc.id
                if not fa_obj.depreciation_account_id and dep_acc:
                    fa_obj.depreciation_account_id = dep_acc.id
                if not fa_obj.non_deductible_account_id and nonded_acc:
                    fa_obj.non_deductible_account_id = nonded_acc.id

        # Movimiento Cargo a Gasto
        if cargo_gasto > 0:
            lines_to_create.append({
                "account_id": exp_acc.id,
                "debit": cargo_gasto,
                "credit": 0.0,
                "description": f"Depreciación contable ({mes_nombre} {req.year}) - {asset_desc}"[:500],
                "line_order": line_order
            })
            line_order += 1

        # Movimiento Cargo a No Deducible (si aplica)
        if cargo_nonded > 0 and nonded_acc:
            lines_to_create.append({
                "account_id": nonded_acc.id,
                "debit": cargo_nonded,
                "credit": 0.0,
                "description": f"Depreciación no deducible ({mes_nombre} {req.year}) - {asset_desc}"[:500],
                "line_order": line_order
            })
            line_order += 1

        # Movimiento Abono a Depreciación Acumulada
        lines_to_create.append({
            "account_id": dep_acc.id,
            "debit": 0.0,
            "credit": abono_dep,
            "description": f"Depreciación acumulada ({mes_nombre} {req.year}) - {asset_desc}"[:500],
            "line_order": line_order
        })
        line_order += 1

    if not lines_to_create:
        raise HTTPException(
            status_code=400,
            detail=f"No existen activos fijos con depreciación contable por devengar en {mes_nombre} {req.year}."
        )

    # Buscar si ya existe una póliza de depreciación para este mes y actualizarla, o crear una nueva
    existing = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            JournalEntry.is_cancelled == False,
            or_(
                JournalEntry.reference == ref_code,
                and_(
                    JournalEntry.date == entry_date,
                    JournalEntry.description.ilike("%Depreciación contable del mes%")
                )
            )
        )
        .order_by(JournalEntry.id.desc())
        .first()
    )

    if existing:
        db.query(JournalLine).filter(JournalLine.entry_id == existing.id).delete()
        existing.date = entry_date
        existing.description = concepto_poliza
        existing.reference = ref_code
        entry = existing
        action_word = "actualizada"
    else:
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            func.strftime("%Y", JournalEntry.date) == str(req.year)
        ).scalar()
        entry_number = (max_num or 0) + 1

        entry = JournalEntry(
            client_id=client_id,
            entry_number=entry_number,
            entry_type="diario",
            date=entry_date,
            description=concepto_poliza,
            reference=ref_code,
            is_auto=True,
            is_cancelled=False,
            created_by=current_user.id
        )
        db.add(entry)
        db.flush()
        action_word = "generada"

    for l_data in lines_to_create:
        db.add(JournalLine(
            entry_id=entry.id,
            account_id=l_data["account_id"],
            debit=l_data["debit"],
            credit=l_data["credit"],
            description=l_data["description"],
            line_order=l_data["line_order"]
        ))

    db.commit()
    db.refresh(entry)

    tot_debe = round(sum(l["debit"] for l in lines_to_create), 2)
    tot_haber = round(sum(l["credit"] for l in lines_to_create), 2)

    log_activity(
        db=db,
        user=current_user,
        action="DEPRECIACION_ACTIVOS",
        module="Activos Fijos",
        description=f"Generó Póliza de Depreciaciones de Activos Fijos {mes_nombre} {req.year} (Diario #{entry.entry_number}) por ${tot_debe:,.2f} MXN para {client.business_name}",
        client_id=client_id,
        entity_id=entry.id,
        details={"year": req.year, "month": req.month, "total_debit": tot_debe, "action": action_word}
    )

    return {
        "success": True,
        "message": f"Póliza de Diario #{entry.entry_number} ({concepto_poliza}) {action_word} con éxito por ${tot_debe:,.2f} MXN.",
        "entry_id": entry.id,
        "entry_number": entry.entry_number,
        "entry_date": entry.date.strftime("%Y-%m-%d"),
        "formatted_date": entry.date.strftime("%d/%m/%Y"),
        "action": action_word,
        "total_debit": tot_debe,
        "total_credit": tot_haber,
    }


# ============================================================================
# 6. CÁLCULO DE PAGO PROVISIONAL DE ISR (601 PM, 626 RESICO PM/PF, 612 PF)
# ============================================================================

# Tarifa Mensual Base Art. 96 LISR (Anexo 8 RMF 2024-2026)
# Para el pago provisional del mes `m` (1..12), Límite Inferior, Límite Superior y Cuota Fija se multiplican por `m`.
ISR_ART96_MONTHLY_BASE = [
    {"lim_inf": 0.01,      "lim_sup": 746.04,       "cuota_fija": 0.00,      "tasa_excedente": 1.92},
    {"lim_inf": 746.05,    "lim_sup": 6332.05,      "cuota_fija": 14.32,     "tasa_excedente": 6.40},
    {"lim_inf": 6332.06,   "lim_sup": 11128.01,     "cuota_fija": 371.83,    "tasa_excedente": 10.88},
    {"lim_inf": 11128.02,  "lim_sup": 12935.82,     "cuota_fija": 893.63,    "tasa_excedente": 16.00},
    {"lim_inf": 12935.83,  "lim_sup": 15487.71,     "cuota_fija": 1182.88,   "tasa_excedente": 17.92},
    {"lim_inf": 15487.72,  "lim_sup": 31236.49,     "cuota_fija": 1640.18,   "tasa_excedente": 21.36},
    {"lim_inf": 31236.50,  "lim_sup": 49233.00,     "cuota_fija": 5004.12,   "tasa_excedente": 23.52},
    {"lim_inf": 49233.01,  "lim_sup": 93993.90,     "cuota_fija": 9236.89,   "tasa_excedente": 30.00},
    {"lim_inf": 93993.91,  "lim_sup": 125325.20,    "cuota_fija": 22665.17,  "tasa_excedente": 32.00},
    {"lim_inf": 125325.21, "lim_sup": 375975.61,    "cuota_fija": 32691.18,  "tasa_excedente": 34.00},
    {"lim_inf": 375975.62, "lim_sup": float("inf"), "cuota_fija": 117912.32, "tasa_excedente": 35.00},
]

# Tabla Mensual RESICO Personas Físicas Art. 113-E LISR
RESICO_PF_MONTHLY_TABLE = [
    {"lim_inf": 0.01,       "lim_sup": 25000.00,   "tasa": 1.00},
    {"lim_inf": 25000.01,   "lim_sup": 50000.00,   "tasa": 1.10},
    {"lim_inf": 50000.01,   "lim_sup": 83333.33,   "tasa": 1.50},
    {"lim_inf": 83333.34,   "lim_sup": 208333.33,  "tasa": 2.00},
    {"lim_inf": 208333.34,  "lim_sup": 3500000.00, "tasa": 2.50},
]

# Tasas de Retención y Pago Definitivo / Provisional Plataformas Tecnológicas Art. 113-A LISR
PLATAFORMAS_DIGITALES_TABLE = [
    {
        "key": "TRANSPORTE",
        "fraccion": "Art. 113-A Fracc. I LISR",
        "actividad": "Transporte terrestre de pasajeros y entrega de bienes (Uber, Didi, Rappi, Uber Eats)",
        "tasa_isr": 2.10,
        "tasa_iva": 8.00,
    },
    {
        "key": "HOSPEDAJE",
        "fraccion": "Art. 113-A Fracc. II LISR",
        "actividad": "Prestación de servicios de hospedaje (Airbnb, Booking, Vrbo)",
        "tasa_isr": 4.00,
        "tasa_iva": 8.00,
    },
    {
        "key": "ENAJENACION",
        "fraccion": "Art. 113-A Fracc. III LISR",
        "actividad": "Enajenación de bienes y prestación de servicios en comercio electrónico (Mercado Libre, Amazon)",
        "tasa_isr": 1.00,
        "tasa_iva": 8.00,
    },
]

REGIME_CATALOG = {
    "601": {
        "code": "601",
        "name": "601 - Personas Morales: Régimen General de Ley",
        "short_name": "PM Régimen General (601)",
        "fundamento": "Art. 14 y Art. 9 LISR (Ingresos Nominales Acumulados × Coeficiente de Utilidad × 30%)",
        "person_type": "PM",
        "income_basis": "devengado",
    },
    "626_PM": {
        "code": "626_PM",
        "name": "626 - Personas Morales: RESICO (Flujo de Efectivo)",
        "short_name": "PM RESICO (626)",
        "fundamento": "Arts. 206 al 215 y Art. 9 LISR (Ingresos Cobrados Acumulados − Deducciones Pagadas Acumuladas × 30%)",
        "person_type": "PM",
        "income_basis": "flujo",
    },
    "626_PF": {
        "code": "626_PF",
        "name": "626 - Personas Físicas: RESICO (Tasas Fijas 1.00% a 2.50%)",
        "short_name": "PF RESICO (626)",
        "fundamento": "Art. 113-E y 113-J LISR (Ingresos Cobrados del Mes × Tasa RESICO 1.00%-2.50% − ISR Retenido 1.25%)",
        "person_type": "PF",
        "income_basis": "flujo_mensual",
    },
    "612": {
        "code": "612",
        "name": "612 - Personas Físicas: Actividades Empresariales y Profesionales",
        "short_name": "PF Act. Empresarial y Prof. (612)",
        "fundamento": "Arts. 106 y 96 LISR (Ingresos Cobrados Acumulados − Deducciones Pagadas Acumuladas → Tarifa Art. 96 LISR)",
        "person_type": "PF",
        "income_basis": "flujo",
    },
    "606_CIEGA": {
        "code": "606_CIEGA",
        "name": "606 - Personas Físicas: Arrendamiento (Deducción Ciega 35% + Predial)",
        "short_name": "PF Arrendamiento Ciega 35% (606)",
        "fundamento": "Arts. 114, 115 párrafo 2° y 116 LISR (Ingresos Cobrados Mes − 35% Deducción Opcional − Predial → Tarifa Mensual Art. 116 − Ret. 10%)",
        "person_type": "PF",
        "income_basis": "flujo_mensual",
    },
    "606_COMPROBADA": {
        "code": "606_COMPROBADA",
        "name": "606 - Personas Físicas: Arrendamiento (Deducciones Comprobadas CFDI)",
        "short_name": "PF Arrendamiento Comprobada (606)",
        "fundamento": "Arts. 114, 115 párrafo 1° y 116 LISR (Ingresos Cobrados Mes − Gastos e Inversiones del Inmueble → Tarifa Mensual Art. 116 − Ret. 10%)",
        "person_type": "PF",
        "income_basis": "flujo_mensual",
    },
    "625": {
        "code": "625",
        "name": "625 - Personas Físicas: Plataformas Tecnológicas y Digitales",
        "short_name": "PF Plataformas Digitales (625)",
        "fundamento": "Arts. 113-A, 113-B y 113-C LISR (Transporte 2.10%, Hospedaje 4.00%, Enajenación Bienes 1.00% − ISR Retenido por Plataforma)",
        "person_type": "PF",
        "income_basis": "flujo_mensual",
    },
}


def _detect_client_regime(client: Client) -> str:
    raw_reg = (client.tax_regime or "").strip().upper()
    rfc_clean = (client.rfc or "").strip().upper()
    is_pf = len(rfc_clean) >= 13

    if raw_reg == "626_PF":
        return "626_PF"
    if raw_reg == "626_PM":
        return "626_PM"
    if raw_reg == "606_COMPROBADA" or ("606" in raw_reg and "COMPROBADA" in raw_reg):
        return "606_COMPROBADA"
    if "601" in raw_reg:
        return "601"
    if "606" in raw_reg or "ARRENDAMIENTO" in raw_reg:
        return "606_CIEGA"
    if "625" in raw_reg or "PLATAFORMA" in raw_reg:
        return "625"
    if "626" in raw_reg or "RESICO" in raw_reg or "SIMPLIFICADO" in raw_reg:
        return "626_PF" if is_pf else "626_PM"
    if "612" in raw_reg or "EMPRESARIAL" in raw_reg or "PROFESIONAL" in raw_reg:
        return "612"
    return "612" if is_pf else "601"


def _get_allowed_regimes_for_client(client: Client) -> List[str]:
    """
    Devuelve únicamente el régimen fiscal registrado en el alta del cliente.
    Excepción: cuando el cliente está dado de alta en Arrendamiento (606),
    se permiten las dos opciones de cálculo: Deducción Ciega (606_CIEGA) y Deducción Comprobada (606_COMPROBADA).
    """
    detected = _detect_client_regime(client)
    if detected in ("606_CIEGA", "606_COMPROBADA"):
        return ["606_CIEGA", "606_COMPROBADA"]
    return [detected]


def _compute_art96_tax(base_gravable: float, month_multiplier: int) -> Dict[str, Any]:
    m = max(1, int(month_multiplier))
    if base_gravable <= 0:
        return {
            "base_gravable": 0.0,
            "limite_inferior": 0.0,
            "limite_superior": round(746.04 * m, 2),
            "excedente": 0.0,
            "tasa_excedente": 1.92,
            "impuesto_marginal": 0.0,
            "cuota_fija": 0.0,
            "isr_causado": 0.0,
            "tasa_efectiva": 0.0,
        }

    selected_row = ISR_ART96_MONTHLY_BASE[-1]
    for idx, row in enumerate(ISR_ART96_MONTHLY_BASE):
        lim_inf_m = 0.01 if idx == 0 else round(row["lim_inf"] * m - (0.01 * (m - 1)), 2)
        lim_sup_m = float("inf") if row["lim_sup"] == float("inf") else round(row["lim_sup"] * m, 2)
        if base_gravable <= lim_sup_m:
            selected_row = row
            break

    # Para exactitud conforme Anexo 8 RMF, el límite inferior acumulado del escalón k es (lim_sup_{k-1} * m) + 0.01
    row_idx = ISR_ART96_MONTHLY_BASE.index(selected_row)
    if row_idx == 0:
        lim_inf_acum = 0.01
    else:
        prev_sup = ISR_ART96_MONTHLY_BASE[row_idx - 1]["lim_sup"]
        lim_inf_acum = round(prev_sup * m + 0.01, 2)

    lim_sup_acum = None if selected_row["lim_sup"] == float("inf") else round(selected_row["lim_sup"] * m, 2)
    cuota_fija_acum = round(selected_row["cuota_fija"] * m, 2)
    tasa_exc = float(selected_row["tasa_excedente"])

    excedente = max(0.0, round(base_gravable - lim_inf_acum, 2))
    impuesto_marginal = round(excedente * (tasa_exc / 100.0), 2)
    isr_causado = round(impuesto_marginal + cuota_fija_acum, 2)
    tasa_efectiva = round((isr_causado / base_gravable) * 100.0, 2) if base_gravable > 0 else 0.0

    return {
        "base_gravable": round(base_gravable, 2),
        "limite_inferior": lim_inf_acum,
        "limite_superior": lim_sup_acum,
        "excedente": excedente,
        "tasa_excedente": tasa_exc,
        "impuesto_marginal": impuesto_marginal,
        "cuota_fija": cuota_fija_acum,
        "isr_causado": isr_causado,
        "tasa_efectiva": tasa_efectiva,
    }


def _compute_resico_pf_tax(ingresos_mes: float) -> Dict[str, Any]:
    if ingresos_mes <= 0:
        return {
            "ingresos_gravables": 0.0,
            "limite_inferior": 0.01,
            "limite_superior": 25000.00,
            "tasa_resico": 1.00,
            "isr_causado": 0.0,
            "excede_tope": False,
        }

    selected = RESICO_PF_MONTHLY_TABLE[-1]
    excede_tope = ingresos_mes > 3500000.00
    for row in RESICO_PF_MONTHLY_TABLE:
        if ingresos_mes <= row["lim_sup"]:
            selected = row
            break

    tasa = float(selected["tasa"])
    isr_causado = round(ingresos_mes * (tasa / 100.0), 2)
    return {
        "ingresos_gravables": round(ingresos_mes, 2),
        "limite_inferior": selected["lim_inf"],
        "limite_superior": selected["lim_sup"],
        "tasa_resico": tasa,
        "isr_causado": isr_causado,
        "excede_tope": excede_tope,
    }


@router.get("/isr/{client_id}")
def get_isr_provisional_calculation(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    regime: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Mes inválido (1-12)")

    # 1. Cargar parámetros guardados para todos los meses del ejercicio `year`
    saved_params_list = (
        db.query(ISRParameter)
        .filter(ISRParameter.client_id == client_id, ISRParameter.year == year)
        .all()
    )
    params_by_month = {p.month: p for p in saved_params_list}
    current_param = params_by_month.get(month)

    # Resolver Coeficiente de Utilidad vigente (si no está en el mes actual, tomar el más reciente del ejercicio)
    default_cu = 0.0
    for m_check in range(month, 0, -1):
        if m_check in params_by_month and params_by_month[m_check].coeficiente_utilidad > 0:
            default_cu = float(params_by_month[m_check].coeficiente_utilidad)
            break
    if default_cu == 0.0:
        for p in saved_params_list:
            if p.coeficiente_utilidad > 0:
                default_cu = float(p.coeficiente_utilidad)
                break

    detected_regime = _detect_client_regime(client)
    allowed_regime_codes = _get_allowed_regimes_for_client(client)
    saved_regime = current_param.regime_code if (current_param and current_param.regime_code in allowed_regime_codes) else None
    if not saved_regime:
        for p in saved_params_list:
            if p.regime_code in allowed_regime_codes:
                saved_regime = p.regime_code
                break

    effective_regime = regime if (regime and regime in allowed_regime_codes) else (saved_regime or detected_regime)
    regime_info = REGIME_CATALOG[effective_regime]

    # 2. Cuentas contables del cliente
    all_accounts = db.query(Account).filter(Account.client_id == client_id).all()
    acc_map = {a.id: a for a in all_accounts}

    # 3. Movimientos contables de todo el ejercicio (Enero al Mes seleccionado)
    year_start = date(year, 1, 1)
    selected_last_day = date(year, month, calendar.monthrange(year, month)[1])

    all_lines = (
        db.query(JournalLine, JournalEntry)
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= year_start,
            JournalEntry.date <= selected_last_day,
            JournalEntry.is_cancelled == False,
            ~JournalEntry.description.ilike("%Cierre del Ejercicio%"),
            ~JournalEntry.description.ilike("%Provisión de ISR Provisional%")
        )
        .all()
    )

    # UUIDs con cobro/pago efectivo registrado en pólizas (afectaron 208-01 o 118-01) por mes
    active_208_by_month = defaultdict(set)
    active_118_by_month = defaultdict(set)

    # Acumuladores contables por mes (1..month)
    contab_by_month = {
        m: {
            "ingresos_401": 0.0,
            "devoluciones_402": 0.0,
            "otros_ingresos_403": 0.0,
            "productos_financieros_702": 0.0,
            "costos_501": 0.0,
            "gastos_601": 0.0,
            "gastos_financieros_701": 0.0,
            "isr_retenido_113": 0.0,
            "isr_retenido_terceros_216": 0.0,
            "pagos_prov_contables_113": 0.0,
        }
        for m in range(1, month + 1)
    }

    for l, e in all_lines:
        m = e.date.month
        if m not in contab_by_month:
            continue
        acc = acc_map.get(l.account_id)
        if not acc:
            continue
        num = (acc.account_number or "").strip()
        name_lower = (acc.name or "").lower()
        deb = float(l.debit or 0.0)
        cred = float(l.credit or 0.0)

        if num.startswith("208-01") and e.cfdi_uuid:
            active_208_by_month[m].add(e.cfdi_uuid)
        elif num.startswith("118-01") and e.cfdi_uuid:
            active_118_by_month[m].add(e.cfdi_uuid)

        if num.startswith("401"):
            contab_by_month[m]["ingresos_401"] += (cred - deb)
        elif num.startswith("402"):
            contab_by_month[m]["devoluciones_402"] += (deb - cred)
        elif num.startswith("403"):
            contab_by_month[m]["otros_ingresos_403"] += (cred - deb)
        elif num.startswith("702"):
            contab_by_month[m]["productos_financieros_702"] += (cred - deb)
        elif num.startswith("501") or num.startswith("502") or num.startswith("503"):
            contab_by_month[m]["costos_501"] += (deb - cred)
        elif num.startswith("601") or num.startswith("602") or num.startswith("603") or num.startswith("604"):
            contab_by_month[m]["gastos_601"] += (deb - cred)
        elif num.startswith("701"):
            contab_by_month[m]["gastos_financieros_701"] += (deb - cred)
        elif num.startswith("113-02") or ("isr" in name_lower and ("favor" in name_lower or "retenido" in name_lower or "acred" in name_lower)):
            contab_by_month[m]["isr_retenido_113"] += (deb - cred)
        elif num.startswith("114-01") or ("pago" in name_lower and "provisional" in name_lower):
            contab_by_month[m]["pagos_prov_contables_113"] += (deb - cred)
        elif num.startswith("216") and "isr" in name_lower:
            contab_by_month[m]["isr_retenido_terceros_216"] += (cred - deb)

    # 4. CFDIs del ejercicio (Enero al Mes seleccionado)
    all_year_invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.date >= datetime.combine(year_start, datetime.min.time()),
            CFDIInvoice.date <= datetime.combine(selected_last_day, datetime.max.time()),
        )
        .order_by(CFDIInvoice.date.asc())
        .all()
    )

    cfdi_by_month = {
        m: {
            "emitidos_nominal_subtotal": 0.0,
            "emitidos_cobrado_subtotal": 0.0,
            "emitidos_ret_isr": 0.0,
            "recibidos_nominal_subtotal": 0.0,
            "recibidos_pagado_subtotal": 0.0,
            "recibidos_ret_isr": 0.0,
        }
        for m in range(1, month + 1)
    }

    selected_month_invoices = []

    for inv in all_year_invoices:
        if not inv.date:
            continue
        m = inv.date.month
        if m not in cfdi_by_month:
            continue

        tipo_comp = (inv.tipo_comprobante or "I").upper()
        if tipo_comp == "P":
            # Los CFDI tipo P no suman subtotal directo de ingresos/gastos para evitar duplicidad con PUE
            continue

        sub = float(inv.subtotal or 0.0)
        iva = float(inv.iva_trasladado or 0.0)
        ret_isr = float(inv.retencion_isr or 0.0)
        ret_iva = float(inv.retencion_iva or 0.0)
        tot = float(inv.total or 0.0)
        tipo = inv.cfdi_type
        method_upper = (inv.payment_method or "PUE").upper()
        uso_upper = (inv.cfdi_use or "").upper()

        # Excluir inversiones (I01..I08) de deducciones directas de gastos porque se deducen vía depreciación
        is_investment_cfdi = uso_upper.startswith("I0")
        is_ppd = (method_upper == "PPD")

        if tipo == "emitido":
            is_effective = (not is_ppd) and (
                (inv.uuid in active_208_by_month[m]) or
                (not active_208_by_month[m] and method_upper in ("PUE", "PAGO"))
            )
            is_nominal = True  # En PM 601 se acumula todo comprobante emitido (PUE y PPD)
            cfdi_by_month[m]["emitidos_nominal_subtotal"] += sub
            if is_effective:
                cfdi_by_month[m]["emitidos_cobrado_subtotal"] += sub
            cfdi_by_month[m]["emitidos_ret_isr"] += ret_isr
        else:
            is_effective = (not is_ppd) and (not is_investment_cfdi) and (
                (inv.uuid in active_118_by_month[m]) or
                (not active_118_by_month[m] and method_upper in ("PUE", "PAGO"))
            )
            is_nominal = not is_investment_cfdi
            if not is_investment_cfdi:
                cfdi_by_month[m]["recibidos_nominal_subtotal"] += sub
                if is_effective:
                    cfdi_by_month[m]["recibidos_pagado_subtotal"] += sub
            cfdi_by_month[m]["recibidos_ret_isr"] += ret_isr

        if m == month:
            # Determinar si este CFDI aplica en la base según el régimen activo
            if tipo == "emitido":
                applies_to_regime = is_nominal if effective_regime == "601" else is_effective
            else:
                applies_to_regime = False if effective_regime in ("601", "626_PF", "606_CIEGA", "625") else is_effective

            selected_month_invoices.append({
                "id": inv.id,
                "uuid": inv.uuid,
                "folio": inv.folio or inv.uuid[:8],
                "date": inv.date.strftime("%Y-%m-%d"),
                "cfdi_type": tipo,
                "rfc": inv.receiver_rfc if tipo == "emitido" else inv.issuer_rfc,
                "name": inv.receiver_name if tipo == "emitido" else inv.issuer_name,
                "description": inv.description or "",
                "payment_method": method_upper,
                "payment_form": inv.payment_form or "",
                "cfdi_use": uso_upper,
                "subtotal": round(sub, 2),
                "iva": round(iva, 2),
                "retencion_isr": round(ret_isr, 2),
                "retencion_iva": round(ret_iva, 2),
                "total": round(tot, 2),
                "is_posted": bool(inv.is_posted),
                "is_effective": bool(is_effective),
                "is_nominal": bool(is_nominal),
                "is_investment": bool(is_investment_cfdi),
                "applies_to_regime": bool(applies_to_regime),
            })

    # 5. Depreciación fiscal mensual de Activos Fijos registrados (Enero al Mes seleccionado)
    registered_assets = db.query(FixedAsset).filter(FixedAsset.client_id == client_id).all()
    deprec_by_month = {m: 0.0 for m in range(1, month + 1)}
    for m in range(1, month + 1):
        tot_dep_m = 0.0
        for asset in registered_assets:
            row_a = _compute_asset_row_from_model(asset, year, m, acc_map)
            tot_dep_m += float(row_a.get("cargo_gasto_mes_actual") or 0.0)
        deprec_by_month[m] = round(tot_dep_m, 2)

    # 6. Construir Cédula Acumulada Mes por Mes (Enero .. Mes Seleccionado)
    cedula_mensual = []
    acum_ingresos = 0.0
    acum_deducciones = 0.0
    acum_depreciacion = 0.0
    acum_retenciones_isr = 0.0
    acum_pagos_provisionales = 0.0

    for m in range(1, month + 1):
        p_m = params_by_month.get(m)
        cu_m = float(p_m.coeficiente_utilidad) if (p_m and p_m.coeficiente_utilidad > 0) else default_cu
        perdidas_m = float(p_m.perdidas_fiscales or 0.0) if p_m else (float(current_param.perdidas_fiscales or 0.0) if current_param else 0.0)
        ptu_m = float(p_m.ptu_pagada or 0.0) if p_m else (float(current_param.ptu_pagada or 0.0) if current_param else 0.0)
        estimulos_m = float(p_m.estimulos_fiscales or 0.0) if p_m else (float(current_param.estimulos_fiscales or 0.0) if current_param else 0.0)
        ing_adic_m = float(p_m.ingresos_adicionales or 0.0) if p_m else 0.0
        ded_adic_m = float(p_m.deducciones_adicionales or 0.0) if p_m else 0.0

        c_m = contab_by_month[m]
        f_m = cfdi_by_month[m]

        ing_contable_neto = max(0.0, round(
            c_m["ingresos_401"] - c_m["devoluciones_402"] + c_m["otros_ingresos_403"] + c_m["productos_financieros_702"], 2
        ))
        ded_contable_neta = max(0.0, round(
            c_m["costos_501"] + c_m["gastos_601"] + c_m["gastos_financieros_701"], 2
        ))

        if effective_regime == "601":
            # Ingresos nominales: mayor/oficial entre contabilidad devengada y CFDI emitido
            base_ing_mes = ing_contable_neto if ing_contable_neto > 0 else round(f_m["emitidos_nominal_subtotal"], 2)
            base_ded_mes = 0.0
            dep_mes = 0.0
        elif effective_regime in ("626_PF", "625"):
            # Flujo de efectivo mensual sin deducciones
            base_ing_mes = round(f_m["emitidos_cobrado_subtotal"], 2) if f_m["emitidos_cobrado_subtotal"] > 0 else ing_contable_neto
            base_ded_mes = 0.0
            dep_mes = 0.0
        elif effective_regime == "606_CIEGA":
            # Arrendamiento Deducción Ciega 35% + Impuesto Predial (capturado en ded_adic_m)
            base_ing_mes = round(f_m["emitidos_cobrado_subtotal"], 2) if f_m["emitidos_cobrado_subtotal"] > 0 else ing_contable_neto
            base_ded_mes = round((base_ing_mes + ing_adic_m) * 0.35, 2)
            dep_mes = 0.0
        else:
            # 626_PM, 612 y 606_COMPROBADA: Flujo de efectivo con deducciones autorizadas pagadas + depreciación de inversiones
            base_ing_mes = round(f_m["emitidos_cobrado_subtotal"], 2) if f_m["emitidos_cobrado_subtotal"] > 0 else ing_contable_neto
            base_ded_mes = round(f_m["recibidos_pagado_subtotal"], 2) if f_m["recibidos_pagado_subtotal"] > 0 else ded_contable_neta
            dep_mes = deprec_by_month[m]

        ing_mes_total = round(base_ing_mes + ing_adic_m, 2)
        ded_mes_total = round(base_ded_mes + dep_mes + ded_adic_m, 2)

        ret_mes_auto = round(f_m["emitidos_ret_isr"], 2) if f_m["emitidos_ret_isr"] > 0 else max(0.0, round(c_m["isr_retenido_113"], 2))
        ret_mes = float(p_m.retenciones_manual) if (p_m and p_m.retenciones_manual is not None) else ret_mes_auto

        ingresos_anteriores = round(acum_ingresos, 2)
        acum_ingresos = round(acum_ingresos + ing_mes_total, 2)
        acum_deducciones = round(acum_deducciones + ded_mes_total, 2)
        acum_depreciacion = round(acum_depreciacion + dep_mes, 2)
        acum_retenciones_isr = round(acum_retenciones_isr + ret_mes, 2)

        pagos_prov_previos = (
            float(p_m.pagos_provisionales_manual)
            if (p_m and p_m.pagos_provisionales_manual is not None)
            else round(acum_pagos_provisionales, 2)
        )

        # Determinación según régimen para el mes `m`
        if effective_regime == "601":
            utilidad_estimada = round(acum_ingresos * cu_m, 2)
            base_gravable = max(0.0, round(utilidad_estimada - ptu_m - perdidas_m - estimulos_m, 2))
            tasa_aplicada = 30.0
            isr_causado = round(base_gravable * 0.30, 2)
            isr_neto = round(isr_causado - pagos_prov_previos - acum_retenciones_isr, 2)
            isr_a_cargo = max(0.0, isr_neto)
            detail_calc = {
                "tipo": "coeficiente_30",
                "utilidad_fiscal_estimada": utilidad_estimada,
                "coeficiente_utilidad": cu_m,
                "tasa_isr": 30.0,
            }
        elif effective_regime == "626_PM":
            utilidad_flujo = max(0.0, round(acum_ingresos - acum_deducciones, 2))
            base_gravable = max(0.0, round(utilidad_flujo - ptu_m - perdidas_m - estimulos_m, 2))
            tasa_aplicada = 30.0
            isr_causado = round(base_gravable * 0.30, 2)
            isr_neto = round(isr_causado - pagos_prov_previos - acum_retenciones_isr, 2)
            isr_a_cargo = max(0.0, isr_neto)
            detail_calc = {
                "tipo": "flujo_30",
                "utilidad_fiscal_estimada": utilidad_flujo,
                "tasa_isr": 30.0,
            }
        elif effective_regime == "626_PF":
            # En RESICO PF el pago es mensual definitivo/provisional sobre ingresos del mes (no acumulado)
            resico_res = _compute_resico_pf_tax(ing_mes_total)
            base_gravable = ing_mes_total
            tasa_aplicada = resico_res["tasa_resico"]
            isr_causado = resico_res["isr_causado"]
            pagos_prov_previos = 0.0
            isr_neto = round(isr_causado - ret_mes - estimulos_m, 2)
            isr_a_cargo = max(0.0, isr_neto)
            detail_calc = {
                "tipo": "resico_pf",
                **resico_res,
            }
        elif effective_regime in ("606_CIEGA", "606_COMPROBADA"):
            # Arrendamiento Personas Físicas (Arts. 114-116 LISR): Cálculo mensual no acumulativo con Tarifa Art. 116 (1 mes)
            utilidad_mes = max(0.0, round(ing_mes_total - ded_mes_total, 2))
            base_gravable = max(0.0, round(utilidad_mes - ptu_m - perdidas_m - estimulos_m, 2))
            art116_res = _compute_art96_tax(base_gravable, 1)
            tasa_aplicada = art116_res["tasa_excedente"]
            isr_causado = art116_res["isr_causado"]
            pagos_prov_previos = 0.0
            isr_neto = round(isr_causado - ret_mes, 2)
            isr_a_cargo = max(0.0, isr_neto)
            detail_calc = {
                "tipo": "arrendamiento_606",
                "modalidad": "ciega_35" if effective_regime == "606_CIEGA" else "comprobada",
                "deduccion_ciega_35": round(ing_mes_total * 0.35, 2),
                "predial_pagado": ded_adic_m if effective_regime == "606_CIEGA" else 0.0,
                "utilidad_fiscal_estimada": utilidad_mes,
                **art116_res,
            }
        elif effective_regime == "625":
            # Plataformas Tecnológicas y Digitales (Art. 113-A LISR):
            # cu_m almacena la tasa seleccionada (2.10, 4.00 o 1.00; por defecto 2.10%)
            raw_tasa_plat = round(cu_m * 100.0, 2) if 0 < cu_m < 0.5 else round(cu_m, 2)
            if raw_tasa_plat not in (1.0, 2.1, 4.0):
                raw_tasa_plat = 2.10
            base_gravable = ing_mes_total
            tasa_aplicada = raw_tasa_plat
            isr_causado = round(ing_mes_total * (tasa_aplicada / 100.0), 2)
            pagos_prov_previos = 0.0
            isr_neto = round(isr_causado - ret_mes - estimulos_m, 2)
            isr_a_cargo = max(0.0, isr_neto)
            detail_calc = {
                "tipo": "plataformas_625",
                "ingresos_plataforma": base_ing_mes,
                "ingresos_directos_usuarios": ing_adic_m,
                "tasa_plataforma": tasa_aplicada,
                "isr_causado": isr_causado,
            }
        else:
            # 612: Persona Física Actividades Empresariales y Profesionales (Tarifa Art. 96 LISR elevada al mes `m`)
            utilidad_flujo = max(0.0, round(acum_ingresos - acum_deducciones, 2))
            base_gravable = max(0.0, round(utilidad_flujo - ptu_m - perdidas_m - estimulos_m, 2))
            art96_res = _compute_art96_tax(base_gravable, m)
            tasa_aplicada = art96_res["tasa_excedente"]
            isr_causado = art96_res["isr_causado"]
            isr_neto = round(isr_causado - pagos_prov_previos - acum_retenciones_isr, 2)
            isr_a_cargo = max(0.0, isr_neto)
            detail_calc = {
                "tipo": "art96_pf",
                "utilidad_fiscal_estimada": utilidad_flujo,
                **art96_res,
            }

        # El pago provisional causado en este mes `m` incrementa el acumulado de pagos provisionales para el mes `m+1`
        if effective_regime not in ("626_PF", "606_CIEGA", "606_COMPROBADA", "625"):
            acum_pagos_provisionales = round(pagos_prov_previos + isr_a_cargo, 2)

        cedula_mensual.append({
            "month": m,
            "month_name": MESES_ES_NOMBRES.get(m, str(m)),
            "ingresos_anteriores": ingresos_anteriores,
            "ingresos_mes": ing_mes_total,
            "ingresos_base_mes": base_ing_mes,
            "ingresos_adicionales_mes": ing_adic_m,
            "ingresos_acumulados": acum_ingresos,
            "deducciones_mes": ded_mes_total,
            "deducciones_gastos_mes": base_ded_mes,
            "depreciacion_mes": dep_mes,
            "deducciones_adicionales_mes": ded_adic_m,
            "deducciones_acumuladas": acum_deducciones,
            "depreciacion_acumulada": acum_depreciacion,
            "coeficiente_utilidad": cu_m,
            "utilidad_fiscal": detail_calc.get("utilidad_fiscal_estimada", base_gravable),
            "ptu_pagada": ptu_m,
            "perdidas_fiscales": perdidas_m,
            "estimulos_fiscales": estimulos_m,
            "base_gravable": base_gravable,
            "tasa_aplicada": tasa_aplicada,
            "isr_causado": isr_causado,
            "pagos_provisionales_anteriores": pagos_prov_previos,
            "retenciones_isr_mes": round(ret_mes, 2),
            "retenciones_isr_acumuladas": round(acum_retenciones_isr, 2),
            "isr_a_cargo": isr_a_cargo,
            "saldo_a_favor": max(0.0, round(-isr_neto, 2)),
            "detail_calc": detail_calc,
        })

    current_row = cedula_mensual[-1]
    contab_curr = contab_by_month[month]
    cfdi_curr = cfdi_by_month[month]

    # 7. Verificar si ya existe Póliza de Diario de Provisión de ISR para este mes
    ref_code = f"PROV-ISR-{year}-{month:02d}"
    existing_poliza = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            JournalEntry.is_cancelled == False,
            or_(
                JournalEntry.reference == ref_code,
                and_(
                    JournalEntry.date == selected_last_day,
                    JournalEntry.description.ilike("%Provisión de ISR Provisional%")
                )
            )
        )
        .order_by(JournalEntry.id.desc())
        .first()
    )

    provision_poliza = None
    if existing_poliza:
        provision_poliza = {
            "id": existing_poliza.id,
            "entry_number": existing_poliza.entry_number,
            "date": existing_poliza.date.strftime("%Y-%m-%d"),
            "formatted_date": existing_poliza.date.strftime("%d/%m/%Y"),
            "description": existing_poliza.description,
            "reference": existing_poliza.reference,
            "amount": round(sum(float(l.debit or 0.0) for l in existing_poliza.lines), 2),
        }

    # Tarifa Art. 96 elevada al mes actual para mostrar en el modal/panel informativo
    # En Arrendamiento (606) se usa la tarifa mensual unitaria (multiplicador = 1); en 612 se usa acumulada al mes `month`
    tarifa_mult = 1 if effective_regime in ("606_CIEGA", "606_COMPROBADA") else month
    tarifa_art96_mes = []
    for idx, r in enumerate(ISR_ART96_MONTHLY_BASE):
        lim_inf_m = 0.01 if idx == 0 else round(ISR_ART96_MONTHLY_BASE[idx - 1]["lim_sup"] * tarifa_mult + 0.01, 2)
        lim_sup_m = None if r["lim_sup"] == float("inf") else round(r["lim_sup"] * tarifa_mult, 2)
        tarifa_art96_mes.append({
            "lim_inf": lim_inf_m,
            "lim_sup": lim_sup_m,
            "cuota_fija": round(r["cuota_fija"] * tarifa_mult, 2),
            "tasa_excedente": r["tasa_excedente"],
        })

    tarifa_art96_unitaria = []
    for idx, r in enumerate(ISR_ART96_MONTHLY_BASE):
        lim_inf_1 = 0.01 if idx == 0 else round(ISR_ART96_MONTHLY_BASE[idx - 1]["lim_sup"] + 0.01, 2)
        lim_sup_1 = None if r["lim_sup"] == float("inf") else round(r["lim_sup"], 2)
        tarifa_art96_unitaria.append({
            "lim_inf": lim_inf_1,
            "lim_sup": lim_sup_1,
            "cuota_fija": round(r["cuota_fija"], 2),
            "tasa_excedente": r["tasa_excedente"],
        })

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "tax_regime_client": client.tax_regime or "",
        "detected_regime": detected_regime,
        "active_regime": effective_regime,
        "allowed_regime_codes": allowed_regime_codes,
        "allowed_regimes": [REGIME_CATALOG[c] for c in allowed_regime_codes if c in REGIME_CATALOG],
        "regime_info": regime_info,
        "regimes_catalog": [REGIME_CATALOG[c] for c in allowed_regime_codes if c in REGIME_CATALOG],
        "year": year,
        "month": month,
        "period_description": f"{MESES_ES_NOMBRES.get(month, str(month))} {year}",
        "parameters": {
            "regime_code": effective_regime,
            "coeficiente_utilidad": current_row["coeficiente_utilidad"],
            "perdidas_fiscales": current_row["perdidas_fiscales"],
            "ptu_pagada": current_row["ptu_pagada"],
            "estimulos_fiscales": current_row["estimulos_fiscales"],
            "ingresos_adicionales": current_row["ingresos_adicionales_mes"],
            "deducciones_adicionales": current_row["deducciones_adicionales_mes"],
            "pagos_provisionales_manual": current_param.pagos_provisionales_manual if current_param else None,
            "retenciones_manual": current_param.retenciones_manual if current_param else None,
            "notes": current_param.notes if current_param else "",
        },
        "summary": current_row,
        "cedula_mensual": cedula_mensual,
        "contabilidad": {
            "cta_401_ingresos": round(contab_curr["ingresos_401"], 2),
            "cta_402_devoluciones": round(contab_curr["devoluciones_402"], 2),
            "cta_403_otros_ingresos": round(contab_curr["otros_ingresos_403"], 2),
            "cta_702_productos_fin": round(contab_curr["productos_financieros_702"], 2),
            "cta_501_costos": round(contab_curr["costos_501"], 2),
            "cta_601_gastos": round(contab_curr["gastos_601"], 2),
            "cta_701_gastos_fin": round(contab_curr["gastos_financieros_701"], 2),
            "cta_113_isr_retenido": round(contab_curr["isr_retenido_113"], 2),
            "cta_216_retenciones_terceros": round(contab_curr["isr_retenido_terceros_216"], 2),
            "depreciacion_inversiones_mes": round(deprec_by_month[month], 2),
        },
        "cfdi_totals": {
            "emitidos_nominal_subtotal": round(cfdi_curr["emitidos_nominal_subtotal"], 2),
            "emitidos_cobrado_subtotal": round(cfdi_curr["emitidos_cobrado_subtotal"], 2),
            "emitidos_ret_isr": round(cfdi_curr["emitidos_ret_isr"], 2),
            "recibidos_nominal_subtotal": round(cfdi_curr["recibidos_nominal_subtotal"], 2),
            "recibidos_pagado_subtotal": round(cfdi_curr["recibidos_pagado_subtotal"], 2),
            "recibidos_ret_isr": round(cfdi_curr["recibidos_ret_isr"], 2),
        },
        "invoices": selected_month_invoices,
        "tarifa_art96_mes": tarifa_art96_mes,
        "tarifa_art96_unitaria": tarifa_art96_unitaria,
        "tabla_resico_pf": RESICO_PF_MONTHLY_TABLE,
        "tabla_plataformas_digitales": PLATAFORMAS_DIGITALES_TABLE,
        "provision_poliza": provision_poliza,
    }


class SaveISRParametersRequest(BaseModel):
    year: int
    month: int
    regime_code: str
    coeficiente_utilidad: float = 0.0
    perdidas_fiscales: float = 0.0
    ptu_pagada: float = 0.0
    estimulos_fiscales: float = 0.0
    ingresos_adicionales: float = 0.0
    deducciones_adicionales: float = 0.0
    pagos_provisionales_manual: Optional[float] = None
    retenciones_manual: Optional[float] = None
    apply_cu_all_year: bool = True
    notes: Optional[str] = ""


@router.post("/isr/{client_id}/parameters")
def save_isr_parameters(
    client_id: int,
    req: SaveISRParametersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    param = (
        db.query(ISRParameter)
        .filter(
            ISRParameter.client_id == client_id,
            ISRParameter.year == req.year,
            ISRParameter.month == req.month,
        )
        .first()
    )
    if not param:
        param = ISRParameter(
            client_id=client_id,
            year=req.year,
            month=req.month,
        )
        db.add(param)

    allowed_regime_codes = _get_allowed_regimes_for_client(client)
    valid_regime = req.regime_code if req.regime_code in allowed_regime_codes else allowed_regime_codes[0]

    param.regime_code = valid_regime
    param.coeficiente_utilidad = round(float(req.coeficiente_utilidad or 0.0), 6)
    param.perdidas_fiscales = round(float(req.perdidas_fiscales or 0.0), 2)
    param.ptu_pagada = round(float(req.ptu_pagada or 0.0), 2)
    param.estimulos_fiscales = round(float(req.estimulos_fiscales or 0.0), 2)
    param.ingresos_adicionales = round(float(req.ingresos_adicionales or 0.0), 2)
    param.deducciones_adicionales = round(float(req.deducciones_adicionales or 0.0), 2)
    param.pagos_provisionales_manual = round(float(req.pagos_provisionales_manual), 2) if req.pagos_provisionales_manual is not None else None
    param.retenciones_manual = round(float(req.retenciones_manual), 2) if req.retenciones_manual is not None else None
    param.notes = req.notes or ""

    # Propagar Coeficiente de Utilidad y Régimen a otros meses configurados del mismo ejercicio
    if req.apply_cu_all_year:
        other_params = (
            db.query(ISRParameter)
            .filter(
                ISRParameter.client_id == client_id,
                ISRParameter.year == req.year,
                ISRParameter.month != req.month,
            )
            .all()
        )
        for op in other_params:
            op.regime_code = valid_regime
            op.coeficiente_utilidad = param.coeficiente_utilidad

    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="CONFIGURAR_ISR",
        module="Fiscal",
        description=f"Actualizó parámetros de ISR Provisional ({valid_regime}, CU: {param.coeficiente_utilidad:.4f}) para {client.business_name} ({req.month:02d}/{req.year})",
        client_id=client_id,
        entity_id=param.id,
        details={
            "year": req.year,
            "month": req.month,
            "regime_code": req.regime_code,
            "coeficiente_utilidad": param.coeficiente_utilidad,
            "perdidas_fiscales": param.perdidas_fiscales,
            "ptu_pagada": param.ptu_pagada,
        },
    )

    return {
        "success": True,
        "message": "Parámetros fiscales de ISR guardados correctamente.",
    }


class GenerarProvisionISRRequest(BaseModel):
    year: int
    month: int
    isr_a_cargo: float
    regime_code: Optional[str] = "601"


@router.post("/isr/{client_id}/generar-provision")
def generar_provision_isr_mes(
    client_id: int,
    req: GenerarProvisionISRRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    Base.metadata.create_all(bind=engine)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    monto_isr = round(float(req.isr_a_cargo or 0.0), 2)
    if monto_isr <= 0:
        raise HTTPException(
            status_code=400,
            detail="El ISR a cargo del periodo es $0.00; no se requiere póliza de provisión de impuesto a cargo."
        )

    mes_nombre = MESES_ES_NOMBRES.get(req.month, str(req.month))
    last_day_val = calendar.monthrange(req.year, req.month)[1]
    entry_date = date(req.year, req.month, last_day_val)
    ref_code = f"PROV-ISR-{req.year}-{req.month:02d}"
    concepto = f"Provisión de ISR Provisional del mes de {mes_nombre} {req.year}"

    # 1. Resolver o activar cuenta de gasto/provisión de ISR: 611-01-000 (Impuesto Sobre la Renta, SAT 611.01)
    acc_611 = _ensure_account_active_and_afectable(
        db=db,
        client_id=client_id,
        account_number="611-01-000",
        sat_code="611.01",
        fallback_name="Impuesto Sobre la Renta (Provisión ISR)",
        nature="deudora",
    )

    # 2. Resolver o activar cuenta de pasivo ISR por pagar: 213-02-000 (ISR por pagar, SAT 213.02)
    acc_213 = _ensure_account_active_and_afectable(
        db=db,
        client_id=client_id,
        account_number="213-02-000",
        sat_code="213.02",
        fallback_name="ISR por pagar",
        nature="acreedora",
    )

    existing = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            JournalEntry.is_cancelled == False,
            or_(
                JournalEntry.reference == ref_code,
                and_(
                    JournalEntry.date == entry_date,
                    JournalEntry.description.ilike("%Provisión de ISR Provisional%")
                )
            )
        )
        .order_by(JournalEntry.id.desc())
        .first()
    )

    if existing:
        db.query(JournalLine).filter(JournalLine.entry_id == existing.id).delete()
        existing.date = entry_date
        existing.description = concepto
        existing.reference = ref_code
        entry = existing
        action_word = "actualizada"
    else:
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            func.strftime("%Y", JournalEntry.date) == str(req.year)
        ).scalar()
        entry_number = (max_num or 0) + 1

        entry = JournalEntry(
            client_id=client_id,
            entry_number=entry_number,
            entry_type="diario",
            date=entry_date,
            description=concepto,
            reference=ref_code,
            is_auto=True,
            is_cancelled=False,
            created_by=current_user.id,
        )
        db.add(entry)
        db.flush()
        action_word = "generada"

    db.add(JournalLine(
        entry_id=entry.id,
        account_id=acc_611.id,
        debit=monto_isr,
        credit=0.0,
        description=f"Provisión mensual de ISR provisional ({mes_nombre} {req.year})",
        line_order=1,
    ))
    db.add(JournalLine(
        entry_id=entry.id,
        account_id=acc_213.id,
        debit=0.0,
        credit=monto_isr,
        description=f"Reconocimiento de pasivo de ISR provisional por pagar ({mes_nombre} {req.year})",
        line_order=2,
    ))

    db.commit()
    db.refresh(entry)

    log_activity(
        db=db,
        user=current_user,
        action="PROVISION_ISR",
        module="Fiscal",
        description=f"Generó Póliza de Provisión de ISR Provisional {mes_nombre} {req.year} (Diario #{entry.entry_number}) por ${monto_isr:,.2f} MXN para {client.business_name}",
        client_id=client_id,
        entity_id=entry.id,
        details={
            "year": req.year,
            "month": req.month,
            "entry_number": entry.entry_number,
            "isr_a_cargo": monto_isr,
            "regime_code": req.regime_code,
            "action": action_word,
        },
    )

    return {
        "success": True,
        "message": f"Póliza de Diario #{entry.entry_number} ({concepto}) {action_word} con éxito por ${monto_isr:,.2f} MXN.",
        "entry_id": entry.id,
        "entry_number": entry.entry_number,
        "entry_date": entry.date.strftime("%Y-%m-%d"),
        "formatted_date": entry.date.strftime("%d/%m/%Y"),
        "action": action_word,
        "amount": monto_isr,
    }


# ============================================================================
# 7. VALIDADOR DE LISTA NEGRA DEL SAT (ART. 69-B EFOS/EDOS Y ART. 49-B CFF)
# ============================================================================

DEFAULT_SAT_BLACKLIST_SEED = [
    {
        "rfc": "GCO1805149A1",
        "taxpayer_name": "GRUPO COMERCIALIZADOR Y OPERADOR DEL SURESTE SA DE CV",
        "list_type": "69-B",
        "situation": "Definitivo",
        "oficio_presuncion": "500-05-2024-11420 de fecha 15 de marzo de 2024",
        "fecha_sat_presuncion": "2024-03-18",
        "fecha_dof_presuncion": "2024-04-02",
        "oficio_definitivo": "500-05-2024-28910 de fecha 12 de agosto de 2024",
        "fecha_sat_definitivo": "2024-08-15",
        "fecha_dof_definitivo": "2024-08-28",
        "motivo_fiscal": "Art. 69-B cuarto párrafo CFF: Contribuyente que emitió comprobantes fiscales sin contar con los activos, personal, infraestructura o capacidad material (EFOS Definitivo).",
        "source": "SAT_OFICIAL",
    },
    {
        "rfc": "SIN1908227K4",
        "taxpayer_name": "SERVICIOS INTEGRALES DE CONSULTORIA Y LOGISTICA EMPRESARIAL SC",
        "list_type": "69-B",
        "situation": "Presunto",
        "oficio_presuncion": "500-05-2025-04112 de fecha 10 de febrero de 2025",
        "fecha_sat_presuncion": "2025-02-14",
        "fecha_dof_presuncion": "2025-02-25",
        "oficio_definitivo": "",
        "fecha_sat_definitivo": "",
        "fecha_dof_definitivo": "",
        "motivo_fiscal": "Art. 69-B primer párrafo CFF: Presunción de inexistencia de operaciones amparadas en CFDI.",
        "source": "SAT_OFICIAL",
    },
    {
        "rfc": "DPR2001105T8",
        "taxpayer_name": "DESARROLLADORA DE PROYECTOS Y SUMINISTROS INDUSTRIALES SA DE CV",
        "list_type": "69-B",
        "situation": "Desvirtuado",
        "oficio_presuncion": "500-05-2023-09811 de fecha 05 de junio de 2023",
        "fecha_sat_presuncion": "2023-06-10",
        "fecha_dof_presuncion": "2023-06-22",
        "oficio_definitivo": "500-05-2023-21400 (Desvirtuó) de fecha 14 de noviembre de 2023",
        "fecha_sat_definitivo": "2023-11-18",
        "fecha_dof_definitivo": "2023-11-30",
        "motivo_fiscal": "Art. 69-B CFF: Contribuyente que aportó pruebas y desvirtuó la presunción de inexistencia de operaciones.",
        "source": "SAT_OFICIAL",
    },
    {
        "rfc": "CEI2103098M2",
        "taxpayer_name": "CORPORATIVO ESTRATEGICO DE INSUMOS Y MAQUINARIA SA DE CV",
        "list_type": "49-B",
        "situation": "Definitivo 49-B (CFDI Falso)",
        "oficio_presuncion": "Orden de Verificación 49-B 500-32-2025-01920",
        "fecha_sat_presuncion": "2025-05-10",
        "fecha_dof_presuncion": "2025-05-15",
        "oficio_definitivo": "Resolución 49-B 500-32-2025-03410 (Comprobantes Fiscales Falsos)",
        "fecha_sat_definitivo": "2025-06-18",
        "fecha_dof_definitivo": "2025-06-24",
        "motivo_fiscal": "Art. 49-B (49 Bis) CFF: Determinación de emisión de comprobantes fiscales falsos tras visita domiciliaria de verificación exprés; cancelación de CSD.",
        "source": "SAT_OFICIAL",
    },
    {
        "rfc": "AAL2207194P9",
        "taxpayer_name": "ASESORES ADMINISTRATIVOS Y CONTABLES DEL BAJIO SA DE CV",
        "list_type": "49-B",
        "situation": "En Procedimiento 49-B",
        "oficio_presuncion": "Orden de Visita 49-B 500-18-2026-00412 (Suspensión de CSD)",
        "fecha_sat_presuncion": "2026-01-20",
        "fecha_dof_presuncion": "2026-01-25",
        "oficio_definitivo": "",
        "fecha_sat_definitivo": "",
        "fecha_dof_definitivo": "",
        "motivo_fiscal": "Art. 49-B CFF / Art. 17-H Bis CFF: Contribuyente sujeto a procedimiento de verificación por presunta emisión de CFDI falsos o sin sustancia material.",
        "source": "SAT_OFICIAL",
    },
]

HIGH_SCRUTINY_KEYWORDS = [
    "asesoria", "asesoría", "consultoria", "consultoría", "administrativos",
    "estrategia", "publicidad", "mercadotecnia", "marketing", "comisiones",
    "mediacion", "mediación", "subcontratacion", "subcontratación",
    "servicios profesionales", "gestion empresarial", "gestión empresarial",
    "logistica", "logística", "mantenimiento general"
]


def _ensure_sat_blacklist_seeded(db: Session):
    Base.metadata.create_all(bind=engine)
    if db.query(SATBlacklist).count() == 0:
        for item in DEFAULT_SAT_BLACKLIST_SEED:
            db.add(SATBlacklist(**item))
        db.commit()


@router.get("/validador-69b/{client_id}")
def get_sat_blacklist_audit_report(
    client_id: int,
    year: Optional[str] = Query(None),
    month: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    _ensure_sat_blacklist_seeded(db)
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # 1. Consultar todos los CFDIs del cliente según el filtro de año/mes
    inv_query = db.query(CFDIInvoice).filter(CFDIInvoice.client_id == client_id)
    if year and str(year).lower() != "all":
        inv_query = inv_query.filter(func.strftime("%Y", CFDIInvoice.date) == str(year))
    if month and str(month).lower() != "all":
        try:
            m_int = int(month)
            if 1 <= m_int <= 12:
                inv_query = inv_query.filter(func.strftime("%m", CFDIInvoice.date) == f"{m_int:02d}")
        except ValueError:
            pass

    invoices = inv_query.order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc()).all()

    # 2. Cargar catálogo completo de listas negras SAT (69-B y 49-B) indexado por RFC
    all_blacklist = db.query(SATBlacklist).all()
    bl_by_rfc = defaultdict(list)
    total_cat_69b = 0
    total_cat_49b = 0
    for b in all_blacklist:
        rfc_key = (b.rfc or "").strip().upper()
        bl_by_rfc[rfc_key].append(b)
        if b.list_type == "49-B":
            total_cat_49b += 1
        else:
            total_cat_69b += 1

    # 3. Agrupar terceros (Proveedores y Clientes) y evaluar cada CFDI
    partners_map = {}
    alertas_69b_49b_detalle = []
    riesgos_fiscales_cfdi = []

    monto_total_operaciones = 0.0
    alertas_69b_count = 0
    monto_en_riesgo_69b = 0.0
    alertas_49b_count = 0
    monto_en_riesgo_49b = 0.0
    cfdis_riesgo_fiscal_count = 0
    monto_cfdis_riesgo_fiscal = 0.0
    contingencia_base_subtotal = 0.0
    contingencia_iva = 0.0

    for inv in invoices:
        is_emitido = inv.cfdi_type == "emitido"
        p_rfc = ((inv.receiver_rfc if is_emitido else inv.issuer_rfc) or "").strip().upper()
        p_name = (inv.receiver_name if is_emitido else inv.issuer_name) or p_rfc
        role_label = "Cliente (Receptor)" if is_emitido else "Proveedor (Emisor)"

        sub = float(inv.subtotal or 0.0)
        iva = float(inv.iva_trasladado or 0.0)
        tot = float(inv.total or 0.0)
        date_str = inv.date.strftime("%Y-%m-%d") if inv.date else ""
        folio_str = inv.folio or (inv.uuid[:8] if inv.uuid else "S/F")
        method_str = (inv.payment_method or "PUE").upper()
        form_str = (inv.payment_form or "99").strip()
        use_str = (inv.cfdi_use or "G03").upper()
        desc_str = inv.description or ""
        tipo_comp = (inv.tipo_comprobante or "I").upper()

        if tipo_comp != "P":
            monto_total_operaciones += tot

        if p_rfc:
            if p_rfc not in partners_map:
                partners_map[p_rfc] = {
                    "rfc": p_rfc,
                    "name": p_name,
                    "role": "Proveedor" if not is_emitido else "Cliente",
                    "cfdi_type": inv.cfdi_type,
                    "cfdi_count": 0,
                    "subtotal": 0.0,
                    "iva": 0.0,
                    "total": 0.0,
                    "first_date": date_str,
                    "last_date": date_str,
                }
            pm = partners_map[p_rfc]
            pm["cfdi_count"] += 1
            if tipo_comp != "P":
                pm["subtotal"] = round(pm["subtotal"] + sub, 2)
                pm["iva"] = round(pm["iva"] + iva, 2)
                pm["total"] = round(pm["total"] + tot, 2)
            if date_str and (not pm["first_date"] or date_str < pm["first_date"]):
                pm["first_date"] = date_str
            if date_str and (not pm["last_date"] or date_str > pm["last_date"]):
                pm["last_date"] = date_str
            if not is_emitido:
                pm["role"] = "Proveedor"

        # Revisar cruce en listas 69-B y 49-B
        matching_bl = bl_by_rfc.get(p_rfc, [])
        has_bl_risk = False
        for b_entry in matching_bl:
            is_active_risk = b_entry.situation not in ("Desvirtuado", "Sentencia Favorable", "Aclarado")
            if b_entry.list_type == "49-B":
                alertas_49b_count += 1
                if is_active_risk and tipo_comp != "P":
                    monto_en_riesgo_49b += tot
                    has_bl_risk = True
            else:
                alertas_69b_count += 1
                if is_active_risk and tipo_comp != "P":
                    monto_en_riesgo_69b += tot
                    has_bl_risk = True

            alertas_69b_49b_detalle.append({
                "invoice_id": inv.id,
                "uuid": inv.uuid,
                "folio": folio_str,
                "date": date_str,
                "cfdi_type": inv.cfdi_type,
                "role_label": role_label,
                "rfc": p_rfc,
                "name": p_name,
                "description": desc_str,
                "subtotal": round(sub, 2),
                "iva": round(iva, 2),
                "total": round(tot, 2),
                "is_posted": bool(inv.is_posted),
                "list_type": b_entry.list_type,
                "situation": b_entry.situation,
                "oficio_presuncion": b_entry.oficio_presuncion or "",
                "fecha_dof_presuncion": b_entry.fecha_dof_presuncion or "",
                "oficio_definitivo": b_entry.oficio_definitivo or "",
                "fecha_dof_definitivo": b_entry.fecha_dof_definitivo or "",
                "motivo_fiscal": b_entry.motivo_fiscal or "",
                "contingencia_estimada": round(sub * 0.30 + iva, 2) if is_active_risk else 0.0,
            })

        # Evaluar Heurísticas de Riesgo Fiscal en cada CFDI (especialmente Recibidos / Deducciones)
        cfdi_flags = []
        severity = "MEDIO"

        if has_bl_risk:
            cfdi_flags.append({
                "code": "LISTA_NEGRA_SAT",
                "label": f"RFC en Listado {', '.join(sorted({b.list_type for b in matching_bl}))}",
                "detail": "Riesgo crítico de rechazo de deducción de ISR y acreditamiento de IVA (EDOS). Requiere acreditar materialidad o corregir situación fiscal.",
                "level": "CRITICO",
            })
            severity = "CRITICO"

        if not is_emitido and tipo_comp == "I":
            # 1) Efectivo > $2,000.00 (Art. 27 Fracc. III LISR)
            if form_str == "01" and tot > 2000.0:
                cfdi_flags.append({
                    "code": "EFECTIVO_MAYOR_2000",
                    "label": "Pago en Efectivo > $2,000 MXN (Art. 27 Fracc. III LISR)",
                    "detail": f"Pagado en efectivo (Forma 01) por ${tot:,.2f}. No es deducible para ISR ni acreditable para IVA salvo combustibles con requisitos.",
                    "level": "ALTO",
                })
                if severity != "CRITICO":
                    severity = "ALTO"

            # 2) Uso CFDI S01 (Sin efectos fiscales) en gastos
            if use_str in ("S01", "CN01", "CP01"):
                cfdi_flags.append({
                    "code": "USO_CFDI_NO_DEDUCIBLE",
                    "label": f"Uso CFDI {use_str} en Comprobante de Gasto",
                    "detail": f"El UsoCFDI '{use_str}' puede ser observado por el SAT en cruces automáticos de deducciones autorizadas.",
                    "level": "ALTO",
                })
                if severity != "CRITICO":
                    severity = "ALTO"

            # 3) Conceptos intangibles o servicios de alta vigilancia >= $15,000 (Materialidad Art. 69-B / 49-B)
            desc_lower = desc_str.lower()
            matched_kw = [kw for kw in HIGH_SCRUTINY_KEYWORDS if kw in desc_lower]
            if matched_kw and sub >= 15000.0:
                cfdi_flags.append({
                    "code": "MATERIALIDAD_SERVICIOS",
                    "label": "Servicio Intangible / Requiere Expediente de Materialidad",
                    "detail": f"Concepto '{desc_str[:65]}' por ${sub:,.2f}. El SAT exige contrato, entregables, bitácoras y razón de negocios (Art. 5-A, 49-B y 69-B CFF).",
                    "level": "MEDIO",
                })

            # 4) Importes cerrados exactos >= $25,000 (ej. $50,000.00, $100,000.00)
            if sub >= 25000.0 and (sub % 5000.0 == 0):
                cfdi_flags.append({
                    "code": "MONTO_REDONDO_ATIPICO",
                    "label": "Importe Cerrado / Redondo Atípico",
                    "detail": f"Subtotal exacto en múltiplo cerrado (${sub:,.2f}). Se recomienda respaldar con cotización desglosada y entregable.",
                    "level": "MEDIO",
                })

        if cfdi_flags:
            cfdis_riesgo_fiscal_count += 1
            monto_cfdis_riesgo_fiscal += tot
            if severity in ("CRITICO", "ALTO"):
                contingencia_base_subtotal += sub
                contingencia_iva += iva

            riesgos_fiscales_cfdi.append({
                "invoice_id": inv.id,
                "uuid": inv.uuid,
                "folio": folio_str,
                "date": date_str,
                "cfdi_type": inv.cfdi_type,
                "rfc": p_rfc,
                "name": p_name,
                "payment_method": method_str,
                "payment_form": form_str,
                "cfdi_use": use_str,
                "description": desc_str,
                "subtotal": round(sub, 2),
                "iva": round(iva, 2),
                "total": round(tot, 2),
                "severity": severity,
                "flags": cfdi_flags,
            })

    # 4. Construir resumen por Tercero (Proveedor / Cliente)
    terceros_auditados = []
    proveedores_count = 0
    clientes_count = 0

    for rfc_k, p_info in partners_map.items():
        if p_info["role"] == "Proveedor":
            proveedores_count += 1
        else:
            clientes_count += 1

        bl_items = bl_by_rfc.get(rfc_k, [])
        entry_69b = next((x for x in bl_items if x.list_type == "69-B"), None)
        entry_49b = next((x for x in bl_items if x.list_type == "49-B"), None)

        risk_level = "LIMPIO"
        if entry_69b or entry_49b:
            sits = [x.situation for x in bl_items]
            if any("Definitivo" in s for s in sits):
                risk_level = "CRITICO"
            elif any("Presunto" in s or "Procedimiento" in s or "Suspensión" in s for s in sits):
                risk_level = "ALTO"
            else:
                risk_level = "ACLARADO"

        terceros_auditados.append({
            **p_info,
            "status_69b": entry_69b.situation if entry_69b else "No Listado (Limpio)",
            "oficio_69b": (entry_69b.oficio_definitivo or entry_69b.oficio_presuncion or "") if entry_69b else "",
            "dof_69b": (entry_69b.fecha_dof_definitivo or entry_69b.fecha_dof_presuncion or "") if entry_69b else "",
            "status_49b": entry_49b.situation if entry_49b else "No Listado (Limpio)",
            "oficio_49b": (entry_49b.oficio_definitivo or entry_49b.oficio_presuncion or "") if entry_49b else "",
            "dof_49b": (entry_49b.fecha_dof_definitivo or entry_49b.fecha_dof_presuncion or "") if entry_49b else "",
            "motivo_fiscal": (entry_49b.motivo_fiscal if entry_49b else (entry_69b.motivo_fiscal if entry_69b else "")),
            "risk_level": risk_level,
        })

    # Ordenar primero los críticos/altos y luego por monto total descendente
    priority_order = {"CRITICO": 0, "ALTO": 1, "ACLARADO": 2, "LIMPIO": 3}
    terceros_auditados.sort(key=lambda x: (priority_order.get(x["risk_level"], 9), -x["total"]))

    contingencia_estimada = round(contingencia_base_subtotal * 0.30 + contingencia_iva, 2)

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year or "all",
        "month": month or "all",
        "summary": {
            "total_proveedores": proveedores_count,
            "total_clientes": clientes_count,
            "total_terceros": len(terceros_auditados),
            "total_cfdis_analizados": len(invoices),
            "monto_total_operaciones": round(monto_total_operaciones, 2),
            "alertas_69b_count": alertas_69b_count,
            "monto_en_riesgo_69b": round(monto_en_riesgo_69b, 2),
            "alertas_49b_count": alertas_49b_count,
            "monto_en_riesgo_49b": round(monto_en_riesgo_49b, 2),
            "cfdis_riesgo_fiscal_count": cfdis_riesgo_fiscal_count,
            "monto_cfdis_riesgo_fiscal": round(monto_cfdis_riesgo_fiscal, 2),
            "contingencia_fiscal_estimada": contingencia_estimada,
            "catalogo_total_69b": total_cat_69b,
            "catalogo_total_49b": total_cat_49b,
        },
        "terceros_auditados": terceros_auditados,
        "alertas_69b_49b_detalle": alertas_69b_49b_detalle,
        "riesgos_fiscales_cfdi": riesgos_fiscales_cfdi,
    }


class CheckRFCsRequest(BaseModel):
    rfcs_text: str


@router.post("/validador-69b/check-rfcs")
def check_rfcs_against_sat_lists(
    req: CheckRFCsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    _ensure_sat_blacklist_seeded(db)
    raw_tokens = re.split(r"[\s,;|\n\r]+", (req.rfcs_text or "").upper())
    rfcs = []
    seen = set()
    for t in raw_tokens:
        clean = t.strip()
        if len(clean) >= 10 and clean not in seen:
            seen.add(clean)
            rfcs.append(clean)

    if not rfcs:
        raise HTTPException(status_code=400, detail="Por favor ingrese al menos un RFC válido para consultar.")

    results = []
    for rfc_val in rfcs:
        bl_matches = (
            db.query(SATBlacklist)
            .filter(func.upper(SATBlacklist.rfc) == rfc_val)
            .all()
        )
        e_69b = next((x for x in bl_matches if x.list_type == "69-B"), None)
        e_49b = next((x for x in bl_matches if x.list_type == "49-B"), None)

        # Buscar si este RFC tiene facturas cargadas en el despacho
        cfdis_in_firm = (
            db.query(CFDIInvoice)
            .filter(
                or_(
                    func.upper(CFDIInvoice.issuer_rfc) == rfc_val,
                    func.upper(CFDIInvoice.receiver_rfc) == rfc_val,
                )
            )
            .all()
        )
        tot_firm = round(sum(float(c.total or 0.0) for c in cfdis_in_firm if (c.tipo_comprobante or "I") != "P"), 2)
        sample_name = ""
        if bl_matches:
            sample_name = bl_matches[0].taxpayer_name
        elif cfdis_in_firm:
            c0 = cfdis_in_firm[0]
            sample_name = c0.issuer_name if (c0.issuer_rfc or "").upper() == rfc_val else c0.receiver_name

        results.append({
            "rfc": rfc_val,
            "taxpayer_name": sample_name or "Contribuyente No Listado en 69-B / 49-B",
            "is_blacklisted": bool(bl_matches),
            "status_69b": e_69b.situation if e_69b else "Limpio (No localizado en 69-B)",
            "oficio_69b": (e_69b.oficio_definitivo or e_69b.oficio_presuncion or "") if e_69b else "",
            "dof_69b": (e_69b.fecha_dof_definitivo or e_69b.fecha_dof_presuncion or "") if e_69b else "",
            "status_49b": e_49b.situation if e_49b else "Limpio (No localizado en 49-B)",
            "oficio_49b": (e_49b.oficio_definitivo or e_49b.oficio_presuncion or "") if e_49b else "",
            "dof_49b": (e_49b.fecha_dof_definitivo or e_49b.fecha_dof_presuncion or "") if e_49b else "",
            "motivo_fiscal": (e_49b.motivo_fiscal if e_49b else (e_69b.motivo_fiscal if e_69b else "Sin señalamientos en listados 69-B ni 49-B")),
            "cfdis_en_despacho": len(cfdis_in_firm),
            "monto_operado_despacho": tot_firm,
        })

    return {"results": results, "total_checked": len(results)}


@router.get("/validador-69b/catalog/list")
def list_sat_blacklist_catalog(
    list_type: Optional[str] = Query(None),
    situation: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    _ensure_sat_blacklist_seeded(db)
    q = db.query(SATBlacklist)
    if list_type and list_type != "all":
        q = q.filter(SATBlacklist.list_type == list_type)
    if situation and situation != "all":
        q = q.filter(SATBlacklist.situation == situation)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                SATBlacklist.rfc.ilike(term),
                SATBlacklist.taxpayer_name.ilike(term),
                SATBlacklist.oficio_presuncion.ilike(term),
                SATBlacklist.oficio_definitivo.ilike(term),
            )
        )

    items = q.order_by(SATBlacklist.updated_at.desc(), SATBlacklist.id.desc()).limit(500).all()
    return [
        {
            "id": x.id,
            "rfc": x.rfc,
            "taxpayer_name": x.taxpayer_name,
            "list_type": x.list_type,
            "situation": x.situation,
            "oficio_presuncion": x.oficio_presuncion or "",
            "fecha_sat_presuncion": x.fecha_sat_presuncion or "",
            "fecha_dof_presuncion": x.fecha_dof_presuncion or "",
            "oficio_definitivo": x.oficio_definitivo or "",
            "fecha_sat_definitivo": x.fecha_sat_definitivo or "",
            "fecha_dof_definitivo": x.fecha_dof_definitivo or "",
            "motivo_fiscal": x.motivo_fiscal or "",
            "source": x.source,
            "updated_at": x.updated_at.strftime("%Y-%m-%d %H:%M") if x.updated_at else "",
        }
        for x in items
    ]


class AddSATBlacklistRequest(BaseModel):
    rfc: str
    taxpayer_name: str
    list_type: str = "69-B"  # '69-B' o '49-B'
    situation: str = "Definitivo"
    oficio_presuncion: Optional[str] = ""
    fecha_dof_presuncion: Optional[str] = ""
    oficio_definitivo: Optional[str] = ""
    fecha_dof_definitivo: Optional[str] = ""
    motivo_fiscal: Optional[str] = ""


@router.post("/validador-69b/catalog/add")
def add_or_update_sat_blacklist_entry(
    req: AddSATBlacklistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    _ensure_sat_blacklist_seeded(db)
    clean_rfc = (req.rfc or "").strip().upper()
    if len(clean_rfc) < 12:
        raise HTTPException(status_code=400, detail="El RFC debe tener 12 o 13 caracteres.")

    l_type = req.list_type if req.list_type in ("69-B", "49-B") else "69-B"
    existing = (
        db.query(SATBlacklist)
        .filter(func.upper(SATBlacklist.rfc) == clean_rfc, SATBlacklist.list_type == l_type)
        .first()
    )

    default_motivo = (
        "Art. 49-B (49 Bis) CFF: Emisión de comprobantes fiscales falsos / sin sustancia económica."
        if l_type == "49-B"
        else "Art. 69-B CFF: Presunción o definitividad de inexistencia de operaciones amparadas en CFDI (EFOS)."
    )

    if existing:
        existing.taxpayer_name = req.taxpayer_name.strip().upper()
        existing.situation = req.situation
        existing.oficio_presuncion = req.oficio_presuncion or existing.oficio_presuncion
        existing.fecha_dof_presuncion = req.fecha_dof_presuncion or existing.fecha_dof_presuncion
        existing.oficio_definitivo = req.oficio_definitivo or existing.oficio_definitivo
        existing.fecha_dof_definitivo = req.fecha_dof_definitivo or existing.fecha_dof_definitivo
        existing.motivo_fiscal = req.motivo_fiscal or existing.motivo_fiscal or default_motivo
        entry = existing
        action_word = "actualizado"
    else:
        entry = SATBlacklist(
            rfc=clean_rfc,
            taxpayer_name=req.taxpayer_name.strip().upper(),
            list_type=l_type,
            situation=req.situation,
            oficio_presuncion=req.oficio_presuncion or "",
            fecha_dof_presuncion=req.fecha_dof_presuncion or date.today().isoformat(),
            oficio_definitivo=req.oficio_definitivo or "",
            fecha_dof_definitivo=req.fecha_dof_definitivo or "",
            motivo_fiscal=req.motivo_fiscal or default_motivo,
            source="MANUAL_DESPACHO",
        )
        db.add(entry)
        action_word = "registrado"

    db.commit()
    db.refresh(entry)

    log_activity(
        db=db,
        user=current_user,
        action="REGISTRAR_LISTA_NEGRA",
        module="Auditoría SAT",
        description=f"Registró/actualizó RFC {clean_rfc} ({entry.taxpayer_name}) en listado Art. {l_type} ({req.situation})",
        entity_id=entry.id,
        details={"rfc": clean_rfc, "list_type": l_type, "situation": req.situation},
    )

    return {
        "success": True,
        "message": f"RFC {clean_rfc} {action_word} en el listado Art. {l_type} ({req.situation}).",
        "id": entry.id,
    }


@router.delete("/validador-69b/catalog/{entry_id}")
def delete_sat_blacklist_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    entry = db.query(SATBlacklist).filter(SATBlacklist.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Registro no encontrado")

    rfc_val = entry.rfc
    l_type = entry.list_type
    db.delete(entry)
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="ELIMINAR_LISTA_NEGRA",
        module="Auditoría SAT",
        description=f"Eliminó RFC {rfc_val} del listado Art. {l_type}",
        entity_id=entry_id,
    )

    return {"success": True, "message": f"RFC {rfc_val} retirado del listado {l_type}."}


@router.post("/validador-69b/catalog/upload-csv")
async def upload_sat_blacklist_csv(
    list_type: str = Query("69-B"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    _ensure_sat_blacklist_seeded(db)
    raw_bytes = await file.read()
    try:
        text_content = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_content = raw_bytes.decode("latin-1", errors="ignore")

    lines = [ln for ln in text_content.splitlines() if ln.strip()]
    # Localizar fila de encabezado que contenga 'RFC'
    start_idx = 0
    for idx, ln in enumerate(lines[:15]):
        if "RFC" in ln.upper():
            start_idx = idx
            break

    reader = csv.reader(lines[start_idx:])
    rows_list = list(reader)
    if not rows_list:
        raise HTTPException(status_code=400, detail="El archivo CSV está vacío.")

    header = [c.strip().upper() for c in rows_list[0]]
    rfc_col = next((i for i, h in enumerate(header) if "RFC" in h), 1 if len(header) > 1 else 0)
    name_col = next((i for i, h in enumerate(header) if "NOMBRE" in h or "RAZON" in h or "CONTRIBUYENTE" in h), rfc_col + 1)
    sit_col = next((i for i, h in enumerate(header) if "SITUAC" in h or "ESTATUS" in h), name_col + 1)
    of_pres_col = next((i for i, h in enumerate(header) if "PRESUNC" in h and "OFICIO" in h), -1)
    dof_pres_col = next((i for i, h in enumerate(header) if "PRESUNC" in h and "DOF" in h), -1)
    of_def_col = next((i for i, h in enumerate(header) if "DEFINIT" in h and "OFICIO" in h), -1)
    dof_def_col = next((i for i, h in enumerate(header) if "DEFINIT" in h and "DOF" in h), -1)

    l_type = "49-B" if "49" in (list_type or "") else "69-B"
    imported = 0
    updated = 0

    for r in rows_list[1:]:
        if len(r) <= rfc_col:
            continue
        rfc_val = r[rfc_col].strip().upper()
        if len(rfc_val) < 12 or len(rfc_val) > 13 or rfc_val == "RFC":
            continue
        name_val = r[name_col].strip() if len(r) > name_col else rfc_val
        sit_val = r[sit_col].strip() if (sit_col >= 0 and len(r) > sit_col and r[sit_col].strip()) else (
            "Definitivo 49-B (CFDI Falso)" if l_type == "49-B" else "Definitivo"
        )
        of_pres = r[of_pres_col].strip() if (of_pres_col >= 0 and len(r) > of_pres_col) else ""
        dof_pres = r[dof_pres_col].strip() if (dof_pres_col >= 0 and len(r) > dof_pres_col) else ""
        of_def = r[of_def_col].strip() if (of_def_col >= 0 and len(r) > of_def_col) else ""
        dof_def = r[dof_def_col].strip() if (dof_def_col >= 0 and len(r) > dof_def_col) else ""

        existing = (
            db.query(SATBlacklist)
            .filter(func.upper(SATBlacklist.rfc) == rfc_val, SATBlacklist.list_type == l_type)
            .first()
        )
        if existing:
            existing.taxpayer_name = name_val or existing.taxpayer_name
            existing.situation = sit_val
            if of_pres:
                existing.oficio_presuncion = of_pres
            if dof_pres:
                existing.fecha_dof_presuncion = dof_pres
            if of_def:
                existing.oficio_definitivo = of_def
            if dof_def:
                existing.fecha_dof_definitivo = dof_def
            existing.source = "CSV_SAT"
            updated += 1
        else:
            db.add(SATBlacklist(
                rfc=rfc_val,
                taxpayer_name=name_val,
                list_type=l_type,
                situation=sit_val,
                oficio_presuncion=of_pres,
                fecha_dof_presuncion=dof_pres,
                oficio_definitivo=of_def,
                fecha_dof_definitivo=dof_def,
                motivo_fiscal=(
                    f"Importado de listado oficial SAT Art. {l_type} ({sit_val})"
                ),
                source="CSV_SAT",
            ))
            imported += 1

    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="IMPORTAR_LISTA_SAT",
        module="Auditoría SAT",
        description=f"Importó archivo CSV del listado SAT Art. {l_type}: {imported} nuevos, {updated} actualizados",
        details={"list_type": l_type, "imported": imported, "updated": updated, "filename": file.filename},
    )

    return {
        "success": True,
        "message": f"Listado Art. {l_type} procesado: {imported} RFC(s) nuevos agregados y {updated} actualizados.",
        "imported": imported,
        "updated": updated,
    }


# ============================================================================
# 8. CÁLCULO MENSUAL DE IEPS Y DECLARACIONES INFORMATIVAS IEPS (MULTI-IEPS)
# ============================================================================

def _classify_ieps_category(tasa_val: float, tipo_factor: str, clave_prod_serv: str, descripcion: str) -> Dict[str, str]:
    tf = (tipo_factor or "Tasa").strip().capitalize()
    desc_low = (descripcion or "").lower()
    clave = (clave_prod_serv or "").strip()

    if tf == "Cuota":
        if clave.startswith("1510") or any(w in desc_low for w in ("gasolina", "magna", "premium", "diesel", "diésel", "combustible")):
            return {
                "code": "COMBUSTIBLES",
                "categoria": "Combustibles Automotrices / Fósiles (Cuota por Litro)",
                "anexo": "Anexo 1 - Combustibles y Fósiles",
                "tasa_label": f"Cuota ${tasa_val:.4f}/L" if tasa_val > 0 else "Cuota Específica",
            }
        if clave.startswith("5020") or any(w in desc_low for w in ("refresco", "saborizada", "bebida", "jarabe", "hidratante")):
            return {
                "code": "BEBIDAS_SABORIZADAS",
                "categoria": "Bebidas Saborizadas con Azúcares Añadidos (Cuota por Litro)",
                "anexo": "Anexo 1 - Bebidas Saborizadas",
                "tasa_label": f"Cuota ${tasa_val:.4f}/L" if tasa_val > 0 else "Cuota por Litro",
            }
        if any(w in desc_low for w in ("cigarro", "tabaco", "puro")):
            return {
                "code": "TABACOS_CUOTA",
                "categoria": "Tabacos Labrados (Cuota por Cigarro)",
                "anexo": "Anexo 4 - Tabacos Labrados",
                "tasa_label": f"Cuota ${tasa_val:.4f}/cig." if tasa_val > 0 else "Cuota Tabacos",
            }
        return {
            "code": "CUOTA_ESPECIFICA",
            "categoria": "Bienes Gravados por Cuota Específica IEPS",
            "anexo": "Anexo 1 - Conceptos Generales IEPS",
            "tasa_label": f"Cuota ${tasa_val:.4f}" if tasa_val > 0 else "Cuota IEPS",
        }

    pct = round(tasa_val * 100, 2) if tasa_val <= 2.0 else round(tasa_val, 2)
    tasa_label = f"Tasa {pct:g}%"

    if abs(pct - 3.0) < 0.05:
        return {
            "code": "TELECOM_3",
            "categoria": "Servicios de Telecomunicaciones (3%)",
            "anexo": "Anexo 1 - Telecomunicaciones",
            "tasa_label": "Tasa 3%",
        }
    if abs(pct - 8.0) < 0.05:
        return {
            "code": "ALIMENTOS_8",
            "categoria": "Alimentos no básicos de alta densidad calórica (8%)",
            "anexo": "Anexo 8 - Alimentos Alta Densidad Calórica",
            "tasa_label": "Tasa 8%",
        }
    if abs(pct - 26.5) < 0.1:
        return {
            "code": "ALCOHOL_26_5",
            "categoria": "Bebidas con contenido alcohólico y cerveza hasta 14° G.L. (26.5%)",
            "anexo": "Anexo 2 - Bebidas Alcohólicas y Cerveza",
            "tasa_label": "Tasa 26.5%",
        }
    if abs(pct - 30.0) < 0.1:
        if any(w in desc_low for w in ("juego", "apuesta", "sorteo", "casino")):
            return {
                "code": "JUEGOS_30",
                "categoria": "Juegos con apuestas y sorteos (30%)",
                "anexo": "Anexo 1 - Juegos con Apuestas y Sorteos",
                "tasa_label": "Tasa 30%",
            }
        return {
            "code": "ALCOHOL_30",
            "categoria": "Bebidas alcohólicas de 14° a 20° G.L. / Bebidas energetizantes (30%)",
            "anexo": "Anexo 2 - Bebidas Alcohólicas y Energetizantes",
            "tasa_label": "Tasa 30%",
        }
    if abs(pct - 53.0) < 0.1:
        return {
            "code": "ALCOHOL_53",
            "categoria": "Bebidas con contenido alcohólico mayores a 20° G.L. (53%)",
            "anexo": "Anexo 2 - Bebidas Alcohólicas (>20° G.L.)",
            "tasa_label": "Tasa 53%",
        }
    if abs(pct - 25.0) < 0.1:
        return {
            "code": "ENERGETIZANTES_25",
            "categoria": "Bebidas energetizantes y concentrados (25%)",
            "anexo": "Anexo 1 - Bebidas Energetizantes",
            "tasa_label": "Tasa 25%",
        }
    if abs(pct - 30.4) < 0.1 or abs(pct - 160.0) < 0.5:
        return {
            "code": "TABACOS",
            "categoria": f"Tabacos labrados ({pct:g}%)",
            "anexo": "Anexo 4 - Tabacos Labrados",
            "tasa_label": tasa_label,
        }
    if abs(pct - 6.0) < 0.1 or abs(pct - 7.0) < 0.1 or abs(pct - 9.0) < 0.1:
        return {
            "code": "PLAGUICIDAS",
            "categoria": f"Plaguicidas ({pct:g}%)",
            "anexo": "Anexo 1 - Plaguicidas",
            "tasa_label": tasa_label,
        }

    return {
        "code": f"IEPS_{pct:g}",
        "categoria": f"Bienes y Servicios Gravados con IEPS ({tasa_label})",
        "anexo": "Anexo 1 - Conceptos Generales IEPS",
        "tasa_label": tasa_label if pct > 0 else "Tasa General IEPS",
    }


def _extract_ieps_from_cfdi(inv: CFDIInvoice, uuid_map: Optional[Dict[str, CFDIInvoice]] = None) -> Dict[str, Any]:
    """
    Extrae el desglose detallado de IEPS (Impuesto 003) desde el XML del CFDI (o Complemento de Pago),
    incluyendo Base gravada, IEPS trasladado, IEPS retenido, TasaOCuota, TipoFactor, Categoría y Unidades.
    """
    tipo_comp = (getattr(inv, "tipo_comprobante", "I") or "I").strip().upper()
    method_upper = (inv.payment_method or "PUE").strip().upper()
    is_pago = (tipo_comp == "P" or method_upper == "PAGO")

    ieps_trasladado = 0.0
    ieps_retenido = 0.0
    base_ieps = 0.0
    cantidad_total = 0.0
    unidad_medida = "PZA"
    tasas_items: List[Dict[str, Any]] = []

    if inv.raw_xml:
        try:
            raw_str = inv.raw_xml if isinstance(inv.raw_xml, str) else inv.raw_xml.decode("utf-8", errors="ignore")
            raw_str = raw_str.lstrip("\ufeff").strip()
            root = ET.fromstring(raw_str)

            if is_pago:
                # Buscar TrasladoDR o TrasladoP con ImpuestoDR/ImpuestoP == '003'
                tras_dr = [
                    el for el in root.iter()
                    if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) in ("TrasladoDR", "TrasladoP")
                    and (el.get("ImpuestoDR") in ("003", "IEPS") or el.get("ImpuestoP") in ("003", "IEPS"))
                ]
                for t_el in tras_dr:
                    tag_n = t_el.tag.split("}")[-1] if "}" in t_el.tag else t_el.tag
                    if tag_n == "TrasladoDR":
                        imp_val = float(t_el.get("ImporteDR") or 0.0)
                        b_val = float(t_el.get("BaseDR") or 0.0)
                        tasa_val = float(t_el.get("TasaOCuotaDR") or 0.0)
                        tf_val = t_el.get("TipoFactorDR") or "Tasa"
                    else:
                        imp_val = float(t_el.get("ImporteP") or 0.0)
                        b_val = float(t_el.get("BaseP") or 0.0)
                        tasa_val = float(t_el.get("TasaOCuotaP") or 0.0)
                        tf_val = t_el.get("TipoFactorP") or "Tasa"

                    if imp_val > 0:
                        if b_val <= 0 and tasa_val > 0 and tf_val == "Tasa":
                            b_val = round(imp_val / tasa_val, 2)
                        cat = _classify_ieps_category(tasa_val, tf_val, inv.clave_prod_serv or "", inv.description or "")
                        ieps_trasladado += imp_val
                        base_ieps += b_val
                        tasas_items.append({
                            "tasa_o_cuota": tasa_val,
                            "tipo_factor": tf_val,
                            "tasa_label": cat["tasa_label"],
                            "categoria": cat["categoria"],
                            "anexo": cat["anexo"],
                            "code": cat["code"],
                            "base": round(b_val, 2),
                            "ieps": round(imp_val, 2),
                            "cantidad": 1.0,
                        })

                # Si es complemento de pago sin desglose 003 directo, verificar factura PPD relacionada
                if ieps_trasladado == 0 and uuid_map and inv.related_uuid:
                    rel_inv = uuid_map.get(inv.related_uuid.strip().upper())
                    if rel_inv and float(rel_inv.total or 0) > 0:
                        rel_ieps_info = _extract_ieps_from_cfdi(rel_inv, None)
                        if rel_ieps_info["ieps_trasladado"] > 0:
                            prop = min(1.0, float(inv.total or 0.0) / float(rel_inv.total))
                            ieps_trasladado = round(rel_ieps_info["ieps_trasladado"] * prop, 2)
                            base_ieps = round(rel_ieps_info["base_ieps"] * prop, 2)
                            for item in rel_ieps_info["tasas_detalle"]:
                                tasas_items.append({
                                    **item,
                                    "base": round(item["base"] * prop, 2),
                                    "ieps": round(item["ieps"] * prop, 2),
                                })
            else:
                # 1. Extraer a nivel Concepto para conocer ClaveProdServ, Cantidad, ClaveUnidad y Base exacta
                concept_nodes = [
                    el for el in root.iter()
                    if (el.tag.split("}")[-1] if "}" in el.tag else el.tag) == "Concepto"
                ]
                for c_el in concept_nodes:
                    c_clave = c_el.get("ClaveProdServ") or inv.clave_prod_serv or ""
                    c_desc = c_el.get("Descripcion") or inv.description or ""
                    c_cant = float(c_el.get("Cantidad") or 0.0)
                    c_unid = c_el.get("ClaveUnidad") or c_el.get("Unidad") or "PZA"
                    c_importe = float(c_el.get("Importe") or 0.0) - float(c_el.get("Descuento") or 0.0)

                    c_traslados = [
                        t for t in c_el.iter()
                        if (t.tag.split("}")[-1] if "}" in t.tag else t.tag) == "Traslado"
                        and (t.get("Impuesto") in ("003", "IEPS"))
                    ]
                    for t_el in c_traslados:
                        imp_val = float(t_el.get("Importe") or 0.0)
                        b_val = float(t_el.get("Base") or c_importe or 0.0)
                        tasa_val = float(t_el.get("TasaOCuota") or 0.0)
                        tf_val = t_el.get("TipoFactor") or "Tasa"
                        if imp_val > 0:
                            if b_val <= 0 and tasa_val > 0 and tf_val == "Tasa":
                                b_val = round(imp_val / tasa_val, 2)
                            cat = _classify_ieps_category(tasa_val, tf_val, c_clave, c_desc)
                            ieps_trasladado += imp_val
                            base_ieps += b_val
                            cantidad_total += c_cant
                            unidad_medida = c_unid
                            tasas_items.append({
                                "tasa_o_cuota": tasa_val,
                                "tipo_factor": tf_val,
                                "tasa_label": cat["tasa_label"],
                                "categoria": cat["categoria"],
                                "anexo": cat["anexo"],
                                "code": cat["code"],
                                "base": round(b_val, 2),
                                "ieps": round(imp_val, 2),
                                "cantidad": c_cant,
                            })

                    c_retenciones = [
                        r for r in c_el.iter()
                        if (r.tag.split("}")[-1] if "}" in r.tag else r.tag) == "Retencion"
                        and (r.get("Impuesto") in ("003", "IEPS"))
                    ]
                    for r_el in c_retenciones:
                        ieps_retenido += float(r_el.get("Importe") or 0.0)

                # 2. Si no hubo traslados 003 a nivel concepto, revisar el nodo Impuestos global del Comprobante
                if ieps_trasladado == 0:
                    comp_impuestos = None
                    for child in root:
                        cname = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                        if cname == "Impuestos":
                            comp_impuestos = child
                            break
                    if comp_impuestos is not None:
                        for t_el in comp_impuestos.iter():
                            tname = t_el.tag.split("}")[-1] if "}" in t_el.tag else t_el.tag
                            if tname == "Traslado" and (t_el.get("Impuesto") in ("003", "IEPS")):
                                imp_val = float(t_el.get("Importe") or 0.0)
                                b_val = float(t_el.get("Base") or 0.0)
                                tasa_val = float(t_el.get("TasaOCuota") or 0.0)
                                tf_val = t_el.get("TipoFactor") or "Tasa"
                                if imp_val > 0:
                                    if b_val <= 0:
                                        if tasa_val > 0 and tf_val == "Tasa":
                                            b_val = round(imp_val / tasa_val, 2)
                                        else:
                                            b_val = float(inv.subtotal or 0.0)
                                    cat = _classify_ieps_category(tasa_val, tf_val, inv.clave_prod_serv or "", inv.description or "")
                                    ieps_trasladado += imp_val
                                    base_ieps += b_val
                                    cantidad_total += 1.0
                                    tasas_items.append({
                                        "tasa_o_cuota": tasa_val,
                                        "tipo_factor": tf_val,
                                        "tasa_label": cat["tasa_label"],
                                        "categoria": cat["categoria"],
                                        "anexo": cat["anexo"],
                                        "code": cat["code"],
                                        "base": round(b_val, 2),
                                        "ieps": round(imp_val, 2),
                                        "cantidad": 1.0,
                                    })
                            elif tname == "Retencion" and (t_el.get("Impuesto") in ("003", "IEPS")) and ieps_retenido == 0:
                                ieps_retenido += float(t_el.get("Importe") or 0.0)
        except Exception:
            pass

    if tasas_items:
        primary = max(tasas_items, key=lambda x: x["ieps"])
        tasa_principal = primary["tasa_label"]
        categoria_ieps = primary["categoria"]
        anexo_multi_ieps = primary["anexo"]
        code_ieps = primary["code"]
    else:
        tasa_principal = "-"
        categoria_ieps = "Sin IEPS desglosado"
        anexo_multi_ieps = "Anexo 1 - Conceptos Generales IEPS"
        code_ieps = "SIN_IEPS"

    return {
        "ieps_trasladado": round(ieps_trasladado, 2),
        "ieps_retenido": round(ieps_retenido, 2),
        "base_ieps": round(base_ieps, 2),
        "cantidad_unidades": round(cantidad_total, 2),
        "unidad_medida": unidad_medida,
        "tasa_principal": tasa_principal,
        "categoria_ieps": categoria_ieps,
        "anexo_multi_ieps": anexo_multi_ieps,
        "code_ieps": code_ieps,
        "tasas_detalle": tasas_items,
    }


def _build_informativa_ieps_for_range(
    client_id: int,
    start_date: date,
    end_date: date,
    db: Session,
    uuid_map: Dict[str, CFDIInvoice]
) -> Dict[str, Any]:
    """
    Construye los anexos de la Declaración Informativa Múltiple del IEPS (MULTI-IEPS SAT):
    - Operaciones con Clientes (IEPS Trasladado Cobrado agrupado por RFC y Categoría)
    - Operaciones con Proveedores (IEPS Pagado/Acreditable agrupado por RFC y Categoría)
    - Resumen por Anexo y Categoría del MULTI-IEPS
    """
    period_invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.date >= datetime.combine(start_date, datetime.min.time()),
            CFDIInvoice.date <= datetime.combine(end_date, datetime.max.time()),
            CFDIInvoice.cfdi_type.in_(["emitido", "recibido"])
        )
        .order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc())
        .all()
    )

    clientes_map: Dict[str, Dict[str, Any]] = {}
    proveedores_map: Dict[str, Dict[str, Any]] = {}
    anexos_map: Dict[str, Dict[str, Any]] = {}

    for inv in period_invoices:
        method_upper = (inv.payment_method or "PUE").strip().upper()
        tipo_comp = (getattr(inv, "tipo_comprobante", "I") or "I").strip().upper()
        is_ppd = (method_upper == "PPD" and tipo_comp != "P")
        if is_ppd:
            # En flujo de efectivo para declaración informativa, las PPD se consideran al cobrarse/pagarse
            continue

        ieps_info = _extract_ieps_from_cfdi(inv, uuid_map)
        ieps_val = ieps_info["ieps_trasladado"]
        ret_val = ieps_info["ieps_retenido"]
        if ieps_val <= 0 and ret_val <= 0:
            continue

        base_val = ieps_info["base_ieps"] if ieps_info["base_ieps"] > 0 else float(inv.subtotal or 0.0)
        tot_val = float(inv.total or 0.0)
        cant_val = ieps_info["cantidad_unidades"] or 1.0
        cat_label = ieps_info["categoria_ieps"]
        anexo_label = ieps_info["anexo_multi_ieps"]
        tasa_label = ieps_info["tasa_principal"]
        unidad = ieps_info["unidad_medida"]

        if inv.cfdi_type == "emitido":
            rfc = (inv.receiver_rfc or "XAXX010101000").strip().upper()
            nombre = (inv.receiver_name or "CLIENTE PÚBLICO EN GENERAL").strip()
            target_map = clientes_map
            tipo_rel = "CLIENTE"
        else:
            rfc = (inv.issuer_rfc or "XAXX010101000").strip().upper()
            nombre = (inv.issuer_name or "PROVEEDOR GENERAL").strip()
            target_map = proveedores_map
            tipo_rel = "PROVEEDOR"

        key = f"{rfc}|{ieps_info['code_ieps']}"
        if key not in target_map:
            target_map[key] = {
                "key": key,
                "tipo_tercero": "04" if len(rfc) in (12, 13) and not rfc.startswith("XEXX") else "05",
                "tipo_relacion": tipo_rel,
                "rfc": rfc,
                "nombre": nombre,
                "categoria_ieps": cat_label,
                "anexo_multi_ieps": anexo_label,
                "tasa_principal": tasa_label,
                "unidad_medida": unidad,
                "cantidad_unidades": 0.0,
                "base_ieps": 0.0,
                "ieps_causado_o_pagado": 0.0,
                "ieps_retenido": 0.0,
                "total_operacion": 0.0,
                "comprobantes_count": 0,
            }

        row = target_map[key]
        row["cantidad_unidades"] = round(row["cantidad_unidades"] + cant_val, 2)
        row["base_ieps"] = round(row["base_ieps"] + base_val, 2)
        row["ieps_causado_o_pagado"] = round(row["ieps_causado_o_pagado"] + ieps_val, 2)
        row["ieps_retenido"] = round(row["ieps_retenido"] + ret_val, 2)
        row["total_operacion"] = round(row["total_operacion"] + tot_val, 2)
        row["comprobantes_count"] += 1

        anexo_key = f"{anexo_label}|{cat_label}|{tasa_label}"
        if anexo_key not in anexos_map:
            anexos_map[anexo_key] = {
                "key": anexo_key,
                "anexo": anexo_label,
                "categoria": cat_label,
                "tasa_label": tasa_label,
                "unidad_medida": unidad,
                "ventas_unidades": 0.0,
                "ventas_base": 0.0,
                "ventas_ieps": 0.0,
                "compras_unidades": 0.0,
                "compras_base": 0.0,
                "compras_ieps": 0.0,
                "ieps_retenido": 0.0,
                "cfdi_count": 0,
            }
        ar = anexos_map[anexo_key]
        if inv.cfdi_type == "emitido":
            ar["ventas_unidades"] = round(ar["ventas_unidades"] + cant_val, 2)
            ar["ventas_base"] = round(ar["ventas_base"] + base_val, 2)
            ar["ventas_ieps"] = round(ar["ventas_ieps"] + ieps_val, 2)
        else:
            ar["compras_unidades"] = round(ar["compras_unidades"] + cant_val, 2)
            ar["compras_base"] = round(ar["compras_base"] + base_val, 2)
            ar["compras_ieps"] = round(ar["compras_ieps"] + ieps_val, 2)
        ar["ieps_retenido"] = round(ar["ieps_retenido"] + ret_val, 2)
        ar["cfdi_count"] += 1

    clientes_list = sorted(clientes_map.values(), key=lambda x: x["ieps_causado_o_pagado"], reverse=True)
    proveedores_list = sorted(proveedores_map.values(), key=lambda x: x["ieps_causado_o_pagado"], reverse=True)
    anexos_list = sorted(anexos_map.values(), key=lambda x: (x["anexo"], x["categoria"]))

    return {
        "clientes": clientes_list,
        "proveedores": proveedores_list,
        "resumen_anexos": anexos_list,
        "totales_clientes": {
            "terceros_count": len(clientes_list),
            "comprobantes_count": sum(c["comprobantes_count"] for c in clientes_list),
            "base_ieps": round(sum(c["base_ieps"] for c in clientes_list), 2),
            "ieps_trasladado": round(sum(c["ieps_causado_o_pagado"] for c in clientes_list), 2),
            "ieps_retenido": round(sum(c["ieps_retenido"] for c in clientes_list), 2),
            "total_operacion": round(sum(c["total_operacion"] for c in clientes_list), 2),
        },
        "totales_proveedores": {
            "terceros_count": len(proveedores_list),
            "comprobantes_count": sum(p["comprobantes_count"] for p in proveedores_list),
            "base_ieps": round(sum(p["base_ieps"] for p in proveedores_list), 2),
            "ieps_pagado": round(sum(p["ieps_causado_o_pagado"] for p in proveedores_list), 2),
            "ieps_retenido": round(sum(p["ieps_retenido"] for p in proveedores_list), 2),
            "total_operacion": round(sum(p["total_operacion"] for p in proveedores_list), 2),
        },
    }


@router.get("/ieps/{client_id}")
def get_ieps_calculation(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    first_day = date(year, month, 1)
    last_day_val = calendar.monthrange(year, month)[1]
    last_day = date(year, month, last_day_val)

    # 1. Movimientos en cuentas contables de IEPS
    # 208-02-000: IEPS trasladado cobrado (Acreedora)
    # 209-02-000: IEPS trasladado no cobrado (Acreedora)
    # 118-03-000: IEPS acreditable pagado (Deudora)
    # 119-03-000: IEPS pendiente de pago (Deudora)
    # 216-05-000: Impuestos retenidos de IEPS
    # 601-58-000: Otros impuestos y derechos (cuando el IEPS se envía al gasto)
    all_accounts = db.query(Account).filter(Account.client_id == client_id).all()
    acc_map = {a.id: a for a in all_accounts}

    lines = (
        db.query(JournalLine, JournalEntry)
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False,
            ~JournalEntry.description.ilike('%Traspasos de IEPS del mes%')
        )
        .all()
    )

    ieps_trasladado_cobrado = 0.0
    ieps_trasladado_pendiente = 0.0
    ieps_acreditable_pagado = 0.0
    ieps_acreditable_pendiente = 0.0
    ieps_retenido_contable = 0.0
    ieps_en_gasto_601_58 = 0.0

    for l, e in lines:
        acc = acc_map.get(l.account_id)
        if not acc:
            continue
        num = acc.account_number or ""
        sat_c = acc.sat_group_code or ""
        deb = float(l.debit or 0)
        cred = float(l.credit or 0)
        line_desc_low = (l.description or "").lower()

        if num.startswith("208-02") or sat_c == "208.02":
            ieps_trasladado_cobrado += (cred - deb)
        elif num.startswith("209-02") or sat_c == "209.02":
            ieps_trasladado_pendiente += (cred - deb)
        elif num.startswith("118-03") or sat_c == "118.03":
            ieps_acreditable_pagado += (deb - cred)
        elif num.startswith("119-03") or sat_c == "119.03":
            ieps_acreditable_pendiente += (deb - cred)
        elif num.startswith("216-05") or sat_c == "216.05" or ("ieps" in (acc.name or "").lower() and "reten" in (acc.name or "").lower()):
            ieps_retenido_contable += (cred - deb)
        elif (num.startswith("601-58") or sat_c == "601.58") and "ieps" in line_desc_low:
            ieps_en_gasto_601_58 += (deb - cred)

    # 2. Mapa de todos los CFDIs del cliente para vincular complementos de pago
    all_client_cfdis = db.query(CFDIInvoice).filter(CFDIInvoice.client_id == client_id).all()
    uuid_map = {(c.uuid or "").strip().upper(): c for c in all_client_cfdis if c.uuid}

    # 3. Análisis desde CFDIs del periodo (Emitidos y Recibidos)
    invoices = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.date >= datetime.combine(first_day, datetime.min.time()),
            CFDIInvoice.date <= datetime.combine(last_day, datetime.max.time()),
            CFDIInvoice.cfdi_type.in_(["emitido", "recibido"])
        )
        .order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc())
        .all()
    )

    emitidos_base_ieps = 0.0
    emitidos_ieps = 0.0
    emitidos_ret_ieps = 0.0
    emitidos_total = 0.0

    recibidos_base_ieps = 0.0
    recibidos_ieps = 0.0
    recibidos_ret_ieps = 0.0
    recibidos_total = 0.0

    invoices_detail = []
    tasas_summary_map: Dict[str, Dict[str, Any]] = {}

    for inv in invoices:
        sub = float(inv.subtotal or 0)
        iva = float(inv.iva_trasladado or 0)
        tot = float(inv.total or 0)
        tipo = inv.cfdi_type

        ieps_info = _extract_ieps_from_cfdi(inv, uuid_map)
        ieps_val = ieps_info["ieps_trasladado"]
        ret_ieps = ieps_info["ieps_retenido"]
        base_ieps = ieps_info["base_ieps"]

        method_upper = (inv.payment_method or "PUE").upper()
        tipo_comp = (getattr(inv, "tipo_comprobante", "I") or "I").upper()
        is_ppd = (method_upper == "PPD" and tipo_comp != "P")
        is_effective = not is_ppd

        has_ieps = (ieps_val > 0 or ret_ieps > 0)

        if has_ieps and is_effective:
            if tipo == "emitido":
                emitidos_base_ieps += base_ieps
                emitidos_ieps += ieps_val
                emitidos_ret_ieps += ret_ieps
                emitidos_total += tot
            else:
                recibidos_base_ieps += base_ieps
                recibidos_ieps += ieps_val
                recibidos_ret_ieps += ret_ieps
                recibidos_total += tot

            for t_item in ieps_info["tasas_detalle"]:
                t_key = f"{t_item['code']}|{t_item['tasa_label']}"
                if t_key not in tasas_summary_map:
                    tasas_summary_map[t_key] = {
                        "key": t_key,
                        "code": t_item["code"],
                        "tasa_label": t_item["tasa_label"],
                        "categoria": t_item["categoria"],
                        "anexo": t_item["anexo"],
                        "base_emitidos": 0.0,
                        "ieps_trasladado": 0.0,
                        "base_recibidos": 0.0,
                        "ieps_acreditable": 0.0,
                        "cfdi_count": 0,
                    }
                ts = tasas_summary_map[t_key]
                if tipo == "emitido":
                    ts["base_emitidos"] = round(ts["base_emitidos"] + t_item["base"], 2)
                    ts["ieps_trasladado"] = round(ts["ieps_trasladado"] + t_item["ieps"], 2)
                else:
                    ts["base_recibidos"] = round(ts["base_recibidos"] + t_item["base"], 2)
                    ts["ieps_acreditable"] = round(ts["ieps_acreditable"] + t_item["ieps"], 2)
                ts["cfdi_count"] += 1

        if has_ieps:
            invoices_detail.append({
                "id": inv.id,
                "uuid": inv.uuid,
                "folio": inv.folio or inv.uuid[:8],
                "date": inv.date.strftime("%Y-%m-%d") if inv.date else "",
                "cfdi_type": tipo,
                "rfc": inv.receiver_rfc if tipo == "emitido" else inv.issuer_rfc,
                "name": inv.receiver_name if tipo == "emitido" else inv.issuer_name,
                "payment_method": inv.payment_method or "PUE",
                "payment_form": inv.payment_form or "",
                "cfdi_use": inv.cfdi_use or "",
                "clave_prod_serv": inv.clave_prod_serv or "",
                "description": inv.description or "",
                "subtotal": sub,
                "base_ieps": base_ieps,
                "tasa_principal": ieps_info["tasa_principal"],
                "categoria_ieps": ieps_info["categoria_ieps"],
                "anexo_multi_ieps": ieps_info["anexo_multi_ieps"],
                "cantidad_unidades": ieps_info["cantidad_unidades"],
                "unidad_medida": ieps_info["unidad_medida"],
                "ieps": ieps_val,
                "retencion_ieps": ret_ieps,
                "iva": iva,
                "total": tot,
                "is_posted": inv.is_posted,
                "is_effective": is_effective,
            })

    final_ieps_trasladado = ieps_trasladado_cobrado if round(ieps_trasladado_cobrado, 2) > 0 else emitidos_ieps
    final_ieps_acreditable = ieps_acreditable_pagado if round(ieps_acreditable_pagado, 2) > 0 else recibidos_ieps
    final_retencion_ieps = max(emitidos_ret_ieps, recibidos_ret_ieps, ieps_retenido_contable)

    net_diff = final_ieps_trasladado - final_ieps_acreditable - final_retencion_ieps
    ieps_a_cargo = max(0.0, round(net_diff, 2))
    ieps_a_favor = max(0.0, round(-net_diff, 2))

    efectivos = [inv for inv in invoices_detail if inv["is_effective"]]

    # Comprobar si ya existe póliza de traspasos de IEPS generada para este periodo
    existing_traspaso = db.query(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.entry_type == "diario",
        JournalEntry.date == last_day,
        JournalEntry.description.ilike("%Traspasos de IEPS del mes%"),
        JournalEntry.is_cancelled == False
    ).first()

    traspaso_poliza = None
    if existing_traspaso:
        traspaso_poliza = {
            "id": existing_traspaso.id,
            "entry_number": existing_traspaso.entry_number,
            "date": existing_traspaso.date.strftime("%Y-%m-%d"),
            "formatted_date": existing_traspaso.date.strftime("%d/%m/%Y"),
            "description": existing_traspaso.description,
            "is_auto": existing_traspaso.is_auto,
        }

    # Declaración Informativa Mensual y Trimestral (MULTI-IEPS)
    info_mensual = _build_informativa_ieps_for_range(client_id, first_day, last_day, db, uuid_map)

    quarter_num = ((month - 1) // 3) + 1
    q_start_month = (quarter_num - 1) * 3 + 1
    q_end_month = quarter_num * 3
    q_first_day = date(year, q_start_month, 1)
    q_last_day = date(year, q_end_month, calendar.monthrange(year, q_end_month)[1])
    info_trimestral = _build_informativa_ieps_for_range(client_id, q_first_day, q_last_day, db, uuid_map)

    month_names_es = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]
    q_label = f"{quarter_num}° Trimestre {year} ({month_names_es[q_start_month - 1]} - {month_names_es[q_end_month - 1]})"

    return {
        "client_id": client_id,
        "business_name": client.business_name,
        "rfc": client.rfc,
        "year": year,
        "month": month,
        "quarter": quarter_num,
        "quarter_label": q_label,
        "period_description": f"{month_names_es[month - 1]} {year}",
        "summary": {
            "ieps_causado": round(final_ieps_trasladado, 2),
            "base_causado": round(emitidos_base_ieps, 2),
            "ieps_acreditable": round(final_ieps_acreditable, 2),
            "base_acreditable": round(recibidos_base_ieps, 2),
            "retenciones_ieps": round(final_retencion_ieps, 2),
            "ieps_en_gasto": round(ieps_en_gasto_601_58, 2),
            "ieps_a_cargo": ieps_a_cargo,
            "ieps_a_favor": ieps_a_favor,
            "ieps_trasladado_pendiente": round(ieps_trasladado_pendiente, 2),
            "ieps_acreditable_pendiente": round(ieps_acreditable_pendiente, 2),
        },
        "contabilidad": {
            "cta_208_02_cobrado": round(ieps_trasladado_cobrado, 2),
            "cta_209_02_pendiente": round(ieps_trasladado_pendiente, 2),
            "cta_118_03_pagado": round(ieps_acreditable_pagado, 2),
            "cta_119_03_pendiente": round(ieps_acreditable_pendiente, 2),
            "cta_216_05_retenciones": round(ieps_retenido_contable, 2),
            "cta_601_58_gasto": round(ieps_en_gasto_601_58, 2),
        },
        "cfdi_totals": {
            "emitidos_total": round(emitidos_total, 2),
            "emitidos_base_ieps": round(emitidos_base_ieps, 2),
            "emitidos_ieps": round(emitidos_ieps, 2),
            "recibidos_total": round(recibidos_total, 2),
            "recibidos_base_ieps": round(recibidos_base_ieps, 2),
            "recibidos_ieps": round(recibidos_ieps, 2),
        },
        "desglose_tasas": list(tasas_summary_map.values()),
        "invoices": efectivos,
        "all_invoices": invoices_detail,
        "informativa": {
            "mensual": info_mensual,
            "trimestral": {
                "quarter": quarter_num,
                "quarter_label": q_label,
                **info_trimestral,
            },
        },
        "traspaso_poliza": traspaso_poliza,
    }


class TraspasoIepsRequest(BaseModel):
    year: int
    month: int
    ieps_trasladado: Optional[float] = None
    ieps_acreditable: Optional[float] = None


def _ensure_ieps_account(db: Session, client_id: int, acc_num: str, name: str, sat_code: str, acc_type: str, nature: str, parent_num: str) -> Account:
    acc = (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.account_number == acc_num)
        .first()
    ) or (
        db.query(Account)
        .filter(Account.client_id == client_id, Account.sat_group_code == sat_code)
        .first()
    )
    if acc:
        changed = False
        if not acc.is_active:
            acc.is_active = True
            changed = True
        if acc.classification != "Afectable":
            acc.classification = "Afectable"
            changed = True
        if changed:
            db.flush()
        return acc

    parent = db.query(Account).filter(Account.client_id == client_id, Account.account_number == parent_num).first()
    new_acc = Account(
        client_id=client_id,
        account_number=acc_num,
        name=name,
        type=acc_type,
        nature=nature,
        level=2,
        sat_group_code=sat_code,
        parent_id=parent.id if parent else None,
        classification="Afectable",
        is_active=True,
    )
    db.add(new_acc)
    db.flush()
    return new_acc


@router.post("/ieps/{client_id}/generar-traspaso")
def generar_traspaso_ieps(
    client_id: int,
    req: TraspasoIepsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    last_day_val = calendar.monthrange(req.year, req.month)[1]
    entry_date = date(req.year, req.month, last_day_val)

    if req.ieps_trasladado is not None and req.ieps_acreditable is not None:
        ieps_tras = round(float(req.ieps_trasladado), 2)
        ieps_acred = round(float(req.ieps_acreditable), 2)
    else:
        calc = get_ieps_calculation(client_id, req.year, req.month, db, current_user)
        ieps_tras = round(calc["summary"]["ieps_causado"], 2)
        ieps_acred = round(calc["summary"]["ieps_acreditable"], 2)

    if ieps_tras <= 0 and ieps_acred <= 0:
        raise HTTPException(
            status_code=400,
            detail="No hay saldos de IEPS trasladado ni acreditable en este periodo para generar el traspaso."
        )

    acc_208_02 = _ensure_ieps_account(
        db, client_id, "208-02-000", "IEPS trasladado cobrado", "208.02", "Pasivo", "Acreedora", "208-00-000"
    )
    acc_118_03 = _ensure_ieps_account(
        db, client_id, "118-03-000", "IEPS acreditable pagado", "118.03", "Activo", "Deudora", "118-00-000"
    )

    diff = round(ieps_tras - ieps_acred, 2)
    acc_destino = None
    if diff > 0:
        acc_destino = _ensure_ieps_account(
            db, client_id, "213-02-000", "IEPS por pagar", "213.02", "Pasivo", "Acreedora", "213-00-000"
        )
    elif diff < 0:
        acc_destino = _ensure_ieps_account(
            db, client_id, "113-03-000", "IEPS a favor", "113.03", "Activo", "Deudora", "113-00-000"
        )

    existing = db.query(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.entry_type == "diario",
        JournalEntry.date == entry_date,
        JournalEntry.description.ilike("%Traspasos de IEPS del mes%"),
        JournalEntry.is_cancelled == False
    ).first()

    if existing:
        db.query(JournalLine).filter(JournalLine.entry_id == existing.id).delete()
        entry = existing
        action_word = "actualizada"
    else:
        max_num = db.query(func.max(JournalEntry.entry_number)).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.entry_type == "diario",
            func.strftime("%Y", JournalEntry.date) == str(req.year)
        ).scalar()
        entry_number = (max_num or 0) + 1

        entry = JournalEntry(
            client_id=client_id,
            entry_number=entry_number,
            entry_type="diario",
            date=entry_date,
            description="Traspasos de IEPS del mes",
            reference=f"TRASPASO-IEPS-{req.month:02d}-{req.year}",
            is_auto=True,
            created_by=current_user.id
        )
        db.add(entry)
        db.flush()
        action_word = "generada"

    lines = []
    order = 1

    if ieps_tras > 0:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_208_02.id,
            debit=ieps_tras,
            credit=0.0,
            description="Cancelación mensual de IEPS trasladado cobrado",
            line_order=order
        ))
        order += 1

    if diff < 0 and acc_destino:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_destino.id,
            debit=abs(diff),
            credit=0.0,
            description="Determinación de IEPS a favor del mes",
            line_order=order
        ))
        order += 1

    if ieps_acred > 0:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_118_03.id,
            debit=0.0,
            credit=ieps_acred,
            description="Cancelación mensual de IEPS acreditable pagado",
            line_order=order
        ))
        order += 1

    if diff > 0 and acc_destino:
        lines.append(JournalLine(
            entry_id=entry.id,
            account_id=acc_destino.id,
            debit=0.0,
            credit=diff,
            description="Determinación de IEPS por pagar a cargo del mes",
            line_order=order
        ))
        order += 1

    for l in lines:
        db.add(l)

    db.commit()
    db.refresh(entry)

    log_activity(
        db=db,
        user=current_user,
        action="TRASPASO_IEPS",
        module="Fiscal",
        description=f"Generó Póliza de Traspasos de IEPS del mes {req.month}/{req.year} (Diario #{entry.entry_number}) para {client.business_name}",
        client_id=client_id,
        entity_id=entry.id,
        details={"year": req.year, "month": req.month, "entry_number": entry.entry_number, "action": action_word}
    )

    return {
        "success": True,
        "message": f"Póliza de diario #{entry.entry_number} {action_word} con éxito con fecha {entry_date.strftime('%d/%m/%Y')}.",
        "entry_id": entry.id,
        "entry_number": entry.entry_number,
        "entry_date": entry.date.strftime("%Y-%m-%d"),
        "formatted_date": entry.date.strftime("%d/%m/%Y"),
        "action": action_word,
        "ieps_trasladado": ieps_tras,
        "ieps_acreditable": ieps_acred,
        "tipo_resultado": "a_cargo" if diff > 0 else "a_favor" if diff < 0 else "cero",
        "diferencia": abs(diff),
        "lines_count": len(lines),
    }


@router.get("/ieps/{client_id}/export-informativa-txt")
def export_ieps_informativa_txt(
    client_id: int,
    year: int = Query(2026),
    month: int = Query(2),
    scope: str = Query("mensual"),  # 'mensual' o 'trimestral'
    anexo: str = Query("todos"),    # 'todos', 'clientes', 'proveedores', 'conceptos'
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    ieps_data = get_ieps_calculation(client_id, year, month, db, current_user)
    info_block = ieps_data["informativa"]["trimestral"] if scope == "trimestral" else ieps_data["informativa"]["mensual"]

    # Formato Carga Batch MULTI-IEPS SAT (separado por pipes '|'):
    # Registro Tipo 1 (Clientes / Proveedores - Operaciones con Terceros IEPS):
    # TipoRelacion(1=Cliente,2=Proveedor)|RFC|RazonSocial|AnexoSAT|CategoriaIEPS|TasaOCuota|Unidad|Cantidad|ValorActosBase|MontoIEPS|IEPSRetenido|
    lines = []

    if anexo in ("todos", "clientes"):
        for c in info_block["clientes"]:
            base_int = f"{c['base_ieps']:.2f}"
            ieps_int = f"{c['ieps_causado_o_pagado']:.2f}"
            ret_int = f"{c['ieps_retenido']:.2f}"
            cant_str = f"{c['cantidad_unidades']:.2f}"
            line = (
                f"1|CLIENTE|{c['rfc']}|{c['nombre']}|{c['anexo_multi_ieps']}|"
                f"{c['categoria_ieps']}|{c['tasa_principal']}|{c['unidad_medida']}|"
                f"{cant_str}|{base_int}|{ieps_int}|{ret_int}|"
            )
            lines.append(line)

    if anexo in ("todos", "proveedores"):
        for p in info_block["proveedores"]:
            base_int = f"{p['base_ieps']:.2f}"
            ieps_int = f"{p['ieps_causado_o_pagado']:.2f}"
            ret_int = f"{p['ieps_retenido']:.2f}"
            cant_str = f"{p['cantidad_unidades']:.2f}"
            line = (
                f"2|PROVEEDOR|{p['rfc']}|{p['nombre']}|{p['anexo_multi_ieps']}|"
                f"{p['categoria_ieps']}|{p['tasa_principal']}|{p['unidad_medida']}|"
                f"{cant_str}|{base_int}|{ieps_int}|{ret_int}|"
            )
            lines.append(line)

    if anexo in ("todos", "conceptos"):
        for a in info_block["resumen_anexos"]:
            line = (
                f"3|RESUMEN_ANEXO|{ieps_data['rfc']}|{a['anexo']}|{a['categoria']}|"
                f"{a['tasa_label']}|{a['unidad_medida']}|{a['ventas_unidades']:.2f}|"
                f"{a['ventas_base']:.2f}|{a['ventas_ieps']:.2f}|{a['compras_unidades']:.2f}|"
                f"{a['compras_base']:.2f}|{a['compras_ieps']:.2f}|{a['ieps_retenido']:.2f}|"
            )
            lines.append(line)

    txt_content = "\r\n".join(lines) + ("\r\n" if lines else "")
    period_tag = f"{year}T{ieps_data['quarter']}" if scope == "trimestral" else f"{year}{month:02d}"
    filename = f"MULTI_IEPS_{ieps_data['rfc']}_{period_tag}_{anexo.upper()}.txt"

    return Response(
        content=txt_content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )



