from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Body
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
from lxml import etree
import re

from database import get_db
from models.cfdi import CFDIInvoice, CFDIMapping
from models.account import Account
from models.journal import JournalEntry, JournalLine
from models.client import Client
from models.user import User
from models.sat_blacklist import SATBlacklist
from routers.auth import require_role
from services.audit import log_activity
from services.cfdi_parser import (
    parse_cfdi_xml,
    get_suggested_account,
    get_default_bank_or_cash_account,
    save_cfdi_mapping,
    post_cfdi_invoice_to_journal
)

router = APIRouter(prefix="/api/cfdi", tags=["cfdi"])

SAT_REGIME_NAMES = {
    "601": "General de Ley Personas Morales",
    "603": "Personas Morales con Fines no Lucrativos",
    "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
    "606": "Arrendamiento",
    "607": "Régimen de Enajenación o Adquisición de Bienes",
    "608": "Demás ingresos",
    "610": "Residentes en el Extranjero sin Establecimiento Permanente en México",
    "611": "Ingresos por Dividendos (socios y accionistas)",
    "612": "Personas Físicas con Actividades Empresariales y Profesionales",
    "614": "Ingresos por intereses",
    "615": "Régimen de los ingresos por obtención de premios",
    "616": "Sin obligaciones fiscales",
    "620": "Sociedades Cooperativas de Producción que optan por diferir sus ingresos",
    "621": "Incorporación Fiscal",
    "622": "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
    "623": "Opcional para Grupos de Sociedades",
    "624": "Coordinados",
    "625": "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas",
    "626": "Régimen Simplificado de Confianza (RESICO)",
}

SAT_PERSONAL_DEDUCTION_USES = {
    "D01": "Honorarios médicos, dentales y gastos hospitalarios",
    "D02": "Gastos médicos por incapacidad o discapacidad",
    "D03": "Gastos funerales",
    "D04": "Donativos",
    "D05": "Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)",
    "D06": "Aportaciones voluntarias al SAR",
    "D07": "Primas por seguros de gastos médicos",
    "D08": "Gastos de transportación escolar obligatoria",
    "D09": "Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones",
    "D10": "Pagos por servicios educativos (colegiaturas)",
}


def _extract_regime_code(raw_val: Optional[str]) -> str:
    if not raw_val:
        return ""
    m = re.match(r"^(\d{3})", str(raw_val).strip())
    return m.group(1) if m else ""


def _format_regime_label(code: str) -> str:
    if not code:
        return "No especificado"
    name = SAT_REGIME_NAMES.get(code)
    return f"{code} - {name}" if name else code


def _evaluate_cfdi_received_validators(inv: CFDIInvoice, client: Optional[Client]) -> dict:
    expected_code = _extract_regime_code(client.tax_regime if client else "")
    expected_label = _format_regime_label(expected_code) if expected_code else (client.tax_regime if client and client.tax_regime else "")

    receiver_code = ""
    is_fuel_cfdi = False
    has_fuel_complement = False
    fuel_complement_info = None

    clave_main = (inv.clave_prod_serv or "").strip()
    tipo_comp = (getattr(inv, "tipo_comprobante", "I") or "I").upper()
    payment_form_code = (inv.payment_form or "").strip()
    cfdi_use_code = (inv.cfdi_use or "").strip().upper()

    if inv.cfdi_type == "recibido" and tipo_comp != "P":
        if clave_main.startswith(("151015", "151017", "151018")):
            is_fuel_cfdi = True

    raw_xml = getattr(inv, "raw_xml", None) or ""
    if raw_xml and inv.cfdi_type == "recibido":
        try:
            root = etree.fromstring(raw_xml.encode("utf-8"))
            if not payment_form_code:
                payment_form_code = (root.get("FormaPago") or "").strip()
            rec_nodes = root.xpath("//*[local-name()='Receptor']")
            if rec_nodes:
                receiver_code = _extract_regime_code(rec_nodes[0].get("RegimenFiscalReceptor", ""))
                if not cfdi_use_code:
                    cfdi_use_code = (rec_nodes[0].get("UsoCFDI") or "").strip().upper()

            if tipo_comp != "P":
                if not is_fuel_cfdi:
                    for c_node in root.xpath("//*[local-name()='Concepto']"):
                        c_clave = (c_node.get("ClaveProdServ") or "").strip()
                        if c_clave.startswith(("151015", "151017", "151018")):
                            is_fuel_cfdi = True
                            if not clave_main:
                                clave_main = c_clave
                            break

                if is_fuel_cfdi:
                    # Buscar Complemento Concepto HidroYPetro o Complementos de Combustible / EstadoDeCuentaCombustible / ConsumoDeCombustibles
                    hyp_nodes = root.xpath(
                        "//*[local-name()='HidroYPetro' or local-name()='EstadoDeCuentaCombustible' or local-name()='ConsumoDeCombustibles' or local-name()='GastosHidrocarburos' or local-name()='IngresosHidrocarburos']"
                    )
                    if hyp_nodes:
                        has_fuel_complement = True
                        node = hyp_nodes[0]
                        tag_name = etree.QName(node).localname
                        fuel_complement_info = {
                            "type": tag_name,
                            "numero_permiso": node.get("NumeroPermiso") or node.get("numeroPermiso") or "",
                            "clave_hyp": node.get("ClaveHYP") or "",
                            "subproducto": node.get("SubProductoHYP") or "",
                        }
        except Exception:
            # Fallback por expresiones regulares si el XML tiene algún detalle de codificación
            m_reg = re.search(r'RegimenFiscalReceptor="(\d{3})"', raw_xml)
            if m_reg:
                receiver_code = m_reg.group(1)
            if is_fuel_cfdi and re.search(r"(HidroYPetro|EstadoDeCuentaCombustible|ConsumoDeCombustibles)", raw_xml):
                has_fuel_complement = True

    receiver_label = _format_regime_label(receiver_code) if receiver_code else ""
    regime_mismatch = bool(
        inv.cfdi_type == "recibido"
        and receiver_code
        and expected_code
        and receiver_code != expected_code
    )
    regime_validation_message = (
        f"Régimen Fiscal del Receptor en el CFDI ({receiver_label}) no coincide con el régimen registrado en el alta del cliente ({expected_label})."
        if regime_mismatch
        else ""
    )

    missing_fuel_complement = bool(
        inv.cfdi_type == "recibido"
        and tipo_comp != "P"
        and is_fuel_cfdi
        and not has_fuel_complement
    )
    if missing_fuel_complement:
        fuel_validation_message = (
            f"Comprobante de combustible (Clave SAT {clave_main or '151015'}) NO contiene su Complemento de Combustible "
            f"(HidroYPetro / ConsumoDeCombustibles / EstadoDeCuentaCombustible) en el XML."
        )
    elif is_fuel_cfdi and has_fuel_complement:
        perm = (fuel_complement_info or {}).get("numero_permiso")
        fuel_validation_message = (
            f"Comprobante de combustible con Complemento {fuel_complement_info.get('type', 'HidroYPetro')} válido"
            + (f" (Permiso: {perm})" if perm else "")
        )
    else:
        fuel_validation_message = ""

    # Validador 3: Combustible pagado en efectivo (FormaPago 01) — En ningún caso debe ser en efectivo (Art. 27 Fracc. III LISR)
    fuel_paid_in_cash = bool(
        inv.cfdi_type == "recibido"
        and tipo_comp != "P"
        and is_fuel_cfdi
        and payment_form_code == "01"
    )
    fuel_cash_validation_message = (
        "Comprobante de combustible pagado en Efectivo (FormaPago 01). En ningún caso el consumo de combustible debe pagarse en efectivo para ser deducible de ISR y acreditable de IVA (Art. 27 Fracc. III LISR), sin importar el monto."
        if fuel_paid_in_cash
        else ""
    )

    # Validador 4: Uso CFDI con Clave D (Deducciones Personales D01..D10)
    is_personal_deduction_use = bool(
        inv.cfdi_type == "recibido"
        and tipo_comp != "P"
        and cfdi_use_code.startswith("D")
    )
    use_desc = SAT_PERSONAL_DEDUCTION_USES.get(cfdi_use_code, "Deducción Personal")
    personal_deduction_use_label = f"{cfdi_use_code} - {use_desc}" if is_personal_deduction_use else ""
    personal_deduction_validation_message = (
        f"Clave de Uso CFDI '{personal_deduction_use_label}' detectada. Corresponde a una Deducción Personal (Declaración Anual de Persona Física) y no a una deducción autorizada operativa mensual."
        if is_personal_deduction_use
        else ""
    )

    return {
        "receiver_tax_regime": receiver_code,
        "receiver_tax_regime_label": receiver_label,
        "expected_client_regime": expected_code,
        "expected_client_regime_label": expected_label,
        "regime_mismatch": regime_mismatch,
        "regime_validation_message": regime_validation_message,
        "is_fuel_cfdi": is_fuel_cfdi,
        "has_fuel_complement": has_fuel_complement,
        "missing_fuel_complement": missing_fuel_complement,
        "fuel_complement_info": fuel_complement_info,
        "fuel_validation_message": fuel_validation_message,
        "fuel_paid_in_cash": fuel_paid_in_cash,
        "fuel_cash_validation_message": fuel_cash_validation_message,
        "is_personal_deduction_use": is_personal_deduction_use,
        "personal_deduction_use_label": personal_deduction_use_label,
        "personal_deduction_validation_message": personal_deduction_validation_message,
    }


class AssignAccountRequest(BaseModel):
    invoice_id: int
    account_id: int

class GenerateEntryRequest(BaseModel):
    invoice_id: int
    account_id: Optional[int] = None

class BatchGenerateRequest(BaseModel):
    invoice_ids: List[int]

def _format_invoice_response(inv: CFDIInvoice, db: Session, client_obj: Optional[Client] = None) -> dict:
    if client_obj is None and inv.client_id:
        client_obj = db.query(Client).filter(Client.id == inv.client_id).first()

    validators = _evaluate_cfdi_received_validators(inv, client_obj)

    account_info = None
    if inv.assigned_account_id:
        acc = db.query(Account).filter(Account.id == inv.assigned_account_id).first()
        if acc:
            account_info = {
                "id": acc.id,
                "account_number": acc.account_number,
                "name": acc.name,
                "classification": acc.classification
            }

    entry_info = None
    if inv.is_posted and inv.journal_entry_id:
        entry = db.query(JournalEntry).filter(JournalEntry.id == inv.journal_entry_id).first()
        if entry:
            entry_info = {
                "id": entry.id,
                "entry_number": entry.entry_number,
                "entry_type": entry.entry_type,
                "date": entry.date.isoformat() if hasattr(entry.date, 'isoformat') else str(entry.date)
            }

    is_nomina_inv = (
        inv.cfdi_type == 'nomina' or
        (getattr(inv, 'tipo_comprobante', '') or '').upper() == 'N' or
        (inv.clave_prod_serv or '').strip() == '84111505'
    )
    partner_rfc = (inv.receiver_rfc if (inv.cfdi_type in ('emitido', 'nomina') or is_nomina_inv) else inv.issuer_rfc) or ""
    partner_name = (inv.receiver_name if (inv.cfdi_type in ('emitido', 'nomina') or is_nomina_inv) else inv.issuer_name) or ""

    nomina_data = None
    moneda = "MXN"
    tipo_cambio = 1.0
    es_moneda_extranjera = False
    subtotal_moneda_original = float(inv.subtotal or 0)
    iva_moneda_original = float(inv.iva_trasladado or 0)
    total_moneda_original = float(inv.total or 0)

    if getattr(inv, 'raw_xml', None):
        try:
            parsed_xml = parse_cfdi_xml(inv.raw_xml.encode('utf-8'))
            if is_nomina_inv:
                nomina_data = parsed_xml.get('nomina_data')
            moneda = parsed_xml.get('moneda') or "MXN"
            tipo_cambio = float(parsed_xml.get('tipo_cambio') or 1.0)
            es_moneda_extranjera = bool(parsed_xml.get('es_moneda_extranjera', False))
            subtotal_moneda_original = float(parsed_xml.get('subtotal_moneda_original') or inv.subtotal or 0)
            iva_moneda_original = float(parsed_xml.get('iva_moneda_original') or inv.iva_trasladado or 0)
            total_moneda_original = float(parsed_xml.get('total_moneda_original') or inv.total or 0)
            if es_moneda_extranjera and tipo_cambio > 0:
                expected_mxn_total = float(parsed_xml.get('total') or 0)
                if expected_mxn_total > 0 and abs(float(inv.total or 0) - expected_mxn_total) > 0.05:
                    inv.subtotal = float(parsed_xml.get('subtotal') or 0)
                    inv.iva_trasladado = float(parsed_xml.get('iva_trasladado') or 0)
                    inv.retencion_isr = float(parsed_xml.get('retencion_isr') or 0)
                    inv.retencion_iva = float(parsed_xml.get('retencion_iva') or 0)
                    inv.total = expected_mxn_total
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
        except Exception:
            pass

    sat_alerts = []
    if partner_rfc:
        try:
            bl_entries = (
                db.query(SATBlacklist)
                .filter(func.upper(SATBlacklist.rfc) == partner_rfc.strip().upper())
                .all()
            )
            for b in bl_entries:
                sat_alerts.append({
                    "id": b.id,
                    "rfc": b.rfc,
                    "list_type": b.list_type,
                    "situation": b.situation,
                    "oficio": b.oficio_definitivo or b.oficio_presuncion or "",
                    "fecha_dof": b.fecha_dof_definitivo or b.fecha_dof_presuncion or "",
                    "motivo": b.motivo_fiscal or "",
                })
        except Exception:
            pass

    return {
        "id": inv.id,
        "client_id": inv.client_id,
        "cfdi_type": inv.cfdi_type,
        "uuid": inv.uuid,
        "folio": inv.folio or "S/F",
        "date": inv.date.isoformat() if hasattr(inv.date, 'isoformat') else str(inv.date),
        "issuer_rfc": inv.issuer_rfc,
        "issuer_name": inv.issuer_name,
        "receiver_rfc": inv.receiver_rfc,
        "receiver_name": inv.receiver_name,
        "partner_name": partner_name,
        "partner_rfc": partner_rfc,
        "sat_alerts": sat_alerts,
        "payment_method": inv.payment_method or "PUE",
        "payment_form": inv.payment_form or "99",
        "cfdi_use": inv.cfdi_use or ("CN01" if is_nomina_inv else "G03"),
        "clave_prod_serv": inv.clave_prod_serv or "",
        "description": inv.description or "",
        "subtotal": float(inv.subtotal or 0),
        "iva_trasladado": float(inv.iva_trasladado or 0),
        "retencion_isr": float(inv.retencion_isr or 0),
        "retencion_iva": float(inv.retencion_iva or 0),
        "total": float(inv.total or 0),
        "moneda": moneda,
        "tipo_cambio": tipo_cambio,
        "es_moneda_extranjera": es_moneda_extranjera,
        "subtotal_moneda_original": subtotal_moneda_original,
        "iva_moneda_original": iva_moneda_original,
        "total_moneda_original": total_moneda_original,
        "otros_impuestos": round(max(0.0, float(inv.total or 0) - (float(inv.subtotal or 0) + float(inv.iva_trasladado or 0) - float(inv.retencion_isr or 0) - float(inv.retencion_iva or 0))), 2) if inv.cfdi_type == 'recibido' and getattr(inv, 'tipo_comprobante', 'I') not in ('P', 'N') else 0.0,
        "assigned_account_id": inv.assigned_account_id,
        "account": account_info,
        "tipo_comprobante": getattr(inv, 'tipo_comprobante', 'I') or 'I',
        "nomina_data": nomina_data,
        "related_uuid": getattr(inv, 'related_uuid', None),
        "related_folio": getattr(inv, 'related_folio', None),
        "is_posted": inv.is_posted,
        "journal_entry": entry_info,
        "created_at": inv.created_at.isoformat() if hasattr(inv.created_at, 'isoformat') else str(inv.created_at),
        **validators,
    }

@router.post("/{client_id}/upload")
async def upload_cfdi_files(
    client_id: int,
    type: str = Query('emitido'),  # 'emitido', 'recibido' o 'nomina'
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    cfdi_type = type.lower().strip()
    if cfdi_type not in ('emitido', 'recibido', 'nomina'):
        raise HTTPException(status_code=400, detail="El tipo de CFDI debe ser 'emitido', 'recibido' o 'nomina'")

    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Empresa activa no encontrada")

    client_rfc = (client.rfc or "").strip().upper()
    client_name = client.business_name or client.legal_name or client_rfc

    processed = []
    errors = []

    for file in files:
        if not file.filename.lower().endswith('.xml'):
            errors.append(f"{file.filename}: No es un archivo XML válido (.xml).")
            continue

        try:
            content = await file.read()
            data = parse_cfdi_xml(content)

            uuid = (data.get('uuid') or "").strip().upper()
            if not uuid:
                errors.append(f"{file.filename}: No contiene un Timbre Fiscal Digital (UUID) válido.")
                continue

            issuer_rfc = (data.get('emisor', {}).get('rfc') or "").strip().upper()
            receiver_rfc = (data.get('receptor', {}).get('rfc') or "").strip().upper()
            folio_str = data.get('full_folio') or uuid[:8]
            is_xml_nomina = bool(data.get('is_nomina') or (data.get('tipo_comprobante') or '').upper() == 'N')
            effective_cfdi_type = cfdi_type

            # 1. Validación estricta por pestaña (Emitidos, Recibidos, Nómina)
            if cfdi_type == 'nomina':
                # La pestaña Nómina SOLO lee comprobantes tipo Nómina (TipoDeComprobante="N" / Complemento de Nómina)
                if not is_xml_nomina:
                    errors.append(
                        f"{file.filename} (Folio: {folio_str}): Esta pestaña solo lee CFDI de Nómina (TipoDeComprobante='N'). "
                        f"Este archivo es de tipo '{data.get('tipo_comprobante')}'; cárguelo en 'CFDI Emitidos' o 'CFDI Recibidos'."
                    )
                    continue
                if issuer_rfc != client_rfc:
                    errors.append(
                        f"{file.filename} (Folio: {folio_str}): En CFDI de Nómina la empresa activa ({client_rfc} - {client_name}) debe figurar como Patrón Emisor. "
                        f"El RFC emisor del XML es '{issuer_rfc}'."
                    )
                    continue
            elif cfdi_type == 'emitido':
                if is_xml_nomina:
                    errors.append(
                        f"{file.filename} (Folio: {folio_str}): Este comprobante es un CFDI de NÓMINA (TipoDeComprobante='N'). "
                        f"Por favor cárguelo exclusivamente en la 3ra pestaña 'CFDI de Nómina'."
                    )
                    continue
                # En pestaña 'Emitidos': La empresa activa DEBE ser el Emisor del CFDI
                if issuer_rfc != client_rfc:
                    if receiver_rfc == client_rfc:
                        errors.append(
                            f"{file.filename} (Folio: {folio_str}): Este comprobante es un CFDI RECIBIDO (la empresa {client_rfc} figura como Receptor). "
                            f"Por favor cárguelo en la pestaña 'CFDI Recibidos'."
                        )
                    else:
                        errors.append(
                            f"{file.filename} (Folio: {folio_str}): No pertenece a la empresa activa ({client_rfc} - {client_name}). "
                            f"El RFC emisor es '{issuer_rfc}' y el receptor es '{receiver_rfc}'."
                        )
                    continue
            elif cfdi_type == 'recibido':
                if is_xml_nomina:
                    errors.append(
                        f"{file.filename} (Folio: {folio_str}): Este comprobante es un CFDI de NÓMINA (TipoDeComprobante='N'). "
                        f"Por favor cárguelo exclusivamente en la 3ra pestaña 'CFDI de Nómina'."
                    )
                    continue
                # En pestaña 'Recibidos': La empresa activa DEBE ser el Receptor del CFDI
                if receiver_rfc != client_rfc:
                    if issuer_rfc == client_rfc:
                        errors.append(
                            f"{file.filename} (Folio: {folio_str}): Este comprobante es un CFDI EMITIDO (la empresa {client_rfc} figura como Emisor). "
                            f"Por favor cárguelo en la pestaña 'CFDI Emitidos'."
                        )
                    else:
                        errors.append(
                            f"{file.filename} (Folio: {folio_str}): No pertenece a la empresa activa ({client_rfc} - {client_name}). "
                            f"El RFC receptor es '{receiver_rfc}' y el emisor es '{issuer_rfc}'."
                        )
                    continue

            # 2. Validación estricta de duplicados
            # a) Verificar si ya fue cargado previamente en la tabla de facturas CFDIInvoice
            existing = db.query(CFDIInvoice).filter(
                CFDIInvoice.client_id == client_id,
                CFDIInvoice.uuid == uuid
            ).first()

            if existing:
                if (float(existing.total or 0) == 0 and float(data.get('total', 0)) > 0) or (not existing.is_posted):
                    # Actualizar registro existente con los datos completos del XML
                    existing.cfdi_type = effective_cfdi_type
                    existing.subtotal = data.get('subtotal', 0)
                    existing.iva_trasladado = data.get('iva_trasladado', 0)
                    existing.retencion_isr = data.get('retencion_isr', existing.retencion_isr)
                    existing.total = data.get('total', 0)
                    existing.tipo_comprobante = data.get('tipo_comprobante', existing.tipo_comprobante)
                    existing.related_uuid = data.get('related_uuid', existing.related_uuid)
                    existing.related_folio = data.get('related_folio', existing.related_folio)
                    existing.payment_method = data.get('metodo_pago', existing.payment_method)
                    existing.payment_form = data.get('forma_pago', existing.payment_form)
                    existing.raw_xml = content.decode('utf-8', errors='ignore')
                    if data.get('tipo_comprobante') == 'P' or data.get('is_pago'):
                        existing.assigned_account_id = get_default_bank_or_cash_account(db, client_id, data.get('forma_pago'))
                    elif effective_cfdi_type == 'nomina' and not existing.assigned_account_id:
                        existing.assigned_account_id = get_suggested_account(db, client_id, 'nomina', receiver_rfc, '84111505')
                    db.commit()
                    processed.append(_format_invoice_response(existing, db, client))
                    continue

                if existing.is_posted and existing.journal_entry_id:
                    entry = db.query(JournalEntry).filter(JournalEntry.id == existing.journal_entry_id).first()
                    entry_lbl = f"Póliza #{entry.entry_number} ({entry.entry_type.upper()})" if entry else f"Póliza ID {existing.journal_entry_id}"
                    errors.append(
                        f"{file.filename} (Folio: {existing.folio or uuid[:8]}): Ya se encuentra cargado previamente y cuenta con la {entry_lbl} generada. No se duplican registros."
                    )
                else:
                    errors.append(
                        f"{file.filename} (Folio: {existing.folio or uuid[:8]}): Ya se encuentra cargado previamente en la lista de comprobantes (UUID: {uuid}). No se duplican registros."
                    )
                continue

            # b) Verificar si el UUID ya se encuentra registrado en pólizas directamente (JournalEntry)
            existing_entry = db.query(JournalEntry).filter(
                JournalEntry.client_id == client_id,
                JournalEntry.cfdi_uuid == uuid,
                JournalEntry.is_cancelled == False
            ).first()
            if existing_entry:
                errors.append(
                    f"{file.filename}: El folio fiscal {uuid} ya se encuentra contabilizado en la Póliza #{existing_entry.entry_number} ({existing_entry.entry_type.upper()}). No se duplican registros."
                )
                continue

            # 3. Asignación sugerida por memoria de RFC y ClaveProdServ (o Bancos/Caja si es Pago)
            if data.get('tipo_comprobante') == 'P' or data.get('is_pago'):
                suggested_acc_id = get_default_bank_or_cash_account(db, client_id, data.get('forma_pago'))
            else:
                rfc_target = receiver_rfc if effective_cfdi_type in ('emitido', 'nomina') else issuer_rfc
                clave_target = data.get('clave_prod_serv', '')
                suggested_acc_id = get_suggested_account(db, client_id, effective_cfdi_type, rfc_target, clave_target)

            clave_target = data.get('clave_prod_serv', '')

            # Crear nuevo registro de comprobante
            new_invoice = CFDIInvoice(
                client_id=client_id,
                cfdi_type=effective_cfdi_type,
                uuid=uuid,
                folio=data.get('full_folio'),
                date=data.get('fecha'),
                issuer_rfc=issuer_rfc,
                issuer_name=data['emisor']['nombre'],
                receiver_rfc=receiver_rfc,
                receiver_name=data['receptor']['nombre'],
                payment_method=data.get('metodo_pago'),
                payment_form=data.get('forma_pago'),
                cfdi_use=data['receptor'].get('uso_cfdi'),
                clave_prod_serv=clave_target,
                description=data.get('description'),
                subtotal=data.get('subtotal', 0),
                iva_trasladado=data.get('iva_trasladado', 0),
                retencion_isr=data.get('retencion_isr', 0),
                retencion_iva=data.get('retencion_iva', 0),
                total=data.get('total', 0),
                assigned_account_id=suggested_acc_id,
                tipo_comprobante=data.get('tipo_comprobante', 'I'),
                related_uuid=data.get('related_uuid'),
                related_folio=data.get('related_folio'),
                raw_xml=content.decode('utf-8', errors='ignore'),
                is_posted=False
            )
            db.add(new_invoice)
            db.commit()
            db.refresh(new_invoice)
            processed.append(_format_invoice_response(new_invoice, db, client))

        except Exception as e:
            errors.append(f"{file.filename}: {str(e)}")

    if processed:
        log_activity(
            db=db,
            user=current_user,
            action="CARGA_CFDI",
            module="CFDIs",
            description=f"Cargó exitosamente {len(processed)} CFDI(s) ({cfdi_type.capitalize()}) para {client_name}",
            client_id=client_id,
            client_name=client_name,
            client_rfc=client_rfc,
            details={"cfdi_type": cfdi_type, "processed_count": len(processed), "errors_count": len(errors)}
        )

    blacklist_warnings = []
    for p_inv in processed:
        for al in (p_inv.get("sat_alerts") or []):
            blacklist_warnings.append({
                "uuid": p_inv["uuid"],
                "folio": p_inv["folio"],
                "rfc": p_inv["partner_rfc"],
                "name": p_inv["partner_name"],
                "total": p_inv["total"],
                "list_type": al["list_type"],
                "situation": al["situation"],
                "oficio": al["oficio"],
            })

    return {
        "success_count": len(processed),
        "invoices": processed,
        "errors": errors,
        "blacklist_warnings": blacklist_warnings,
    }

@router.get("/{client_id}/list")
def list_cfdi_invoices(
    client_id: int,
    type: str = Query('emitido'),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    is_posted: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    req_type = type.lower().strip()
    if req_type == 'nomina':
        query = db.query(CFDIInvoice).filter(
            CFDIInvoice.client_id == client_id,
            (CFDIInvoice.cfdi_type == 'nomina') | (CFDIInvoice.tipo_comprobante == 'N')
        )
    elif req_type == 'emitido':
        query = db.query(CFDIInvoice).filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.cfdi_type == 'emitido',
            (CFDIInvoice.tipo_comprobante != 'N') | (CFDIInvoice.tipo_comprobante == None)
        )
    else:
        query = db.query(CFDIInvoice).filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.cfdi_type == req_type
        )
    if is_posted is not None:
        query = query.filter(CFDIInvoice.is_posted == is_posted)

    if year:
        query = query.filter(func.strftime('%Y', CFDIInvoice.date) == str(year))
    if month:
        query = query.filter(func.strftime('%m', CFDIInvoice.date) == f"{month:02d}")

    client = db.query(Client).filter(Client.id == client_id).first()
    invoices = query.order_by(CFDIInvoice.date.asc(), CFDIInvoice.id.asc()).all()
    return [_format_invoice_response(inv, db, client) for inv in invoices]

@router.post("/{client_id}/assign-account")
def assign_cfdi_account(
    client_id: int,
    payload: AssignAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    invoice = db.query(CFDIInvoice).filter(
        CFDIInvoice.id == payload.invoice_id,
        CFDIInvoice.client_id == client_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Comprobante no encontrado")

    account = db.query(Account).filter(
        Account.id == payload.account_id,
        Account.client_id == client_id,
        Account.is_active == True
    ).first()
    if not account:
        raise HTTPException(status_code=400, detail="Cuenta contable inválida para esta empresa")

    invoice.assigned_account_id = payload.account_id
    db.commit()

    # Guardar en la memoria de mapeo inteligente para futuras cargas
    is_nomina_inv = (invoice.cfdi_type == 'nomina' or (getattr(invoice, 'tipo_comprobante', '') or '').upper() == 'N')
    rfc = invoice.receiver_rfc if (invoice.cfdi_type == 'emitido' or is_nomina_inv) else invoice.issuer_rfc
    map_type = 'nomina' if is_nomina_inv else invoice.cfdi_type
    save_cfdi_mapping(
        db, client_id, map_type, rfc, invoice.clave_prod_serv, payload.account_id
    )

    return _format_invoice_response(invoice, db)

@router.post("/{client_id}/generate-entry")
def generate_entry_from_cfdi(
    client_id: int,
    payload: GenerateEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    invoice = db.query(CFDIInvoice).filter(
        CFDIInvoice.id == payload.invoice_id,
        CFDIInvoice.client_id == client_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Comprobante no encontrado")

    if invoice.is_posted:
        return {
            "message": "La póliza para este comprobante ya había sido generada.",
            "invoice": _format_invoice_response(invoice, db)
        }

    if payload.account_id:
        invoice.assigned_account_id = payload.account_id

    if not invoice.assigned_account_id:
        raise HTTPException(status_code=400, detail="Debe asignar una cuenta contable antes de generar la póliza.")

    if invoice.date:
        inv_year = invoice.date.year
        closing_entry = db.query(JournalEntry).filter(
            JournalEntry.client_id == client_id,
            JournalEntry.reference == f"CIERRE-{inv_year}",
            JournalEntry.is_cancelled == False
        ).first()
        if closing_entry:
            assigned_acc = db.query(Account).filter(Account.id == invoice.assigned_account_id).first()
            acc_num = (assigned_acc.account_number or "").strip() if assigned_acc else ""
            if acc_num and acc_num[0] in ("4", "5", "6", "7"):
                raise HTTPException(
                    status_code=400,
                    detail=f"El ejercicio {inv_year} ya cuenta con Póliza de Cierre (#{closing_entry.entry_number}). No se permite generar movimientos en cuentas de resultados ({acc_num}) de un ejercicio cerrado."
                )

    try:
        entry = post_cfdi_invoice_to_journal(db, invoice, current_user.id)
        db.refresh(invoice)
        return {
            "message": "Póliza generada exitosamente",
            "entry_id": entry.id,
            "entry_number": entry.entry_number,
            "entry_type": entry.entry_type,
            "invoice": _format_invoice_response(invoice, db)
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error al generar póliza: {str(e)}")

@router.post("/{client_id}/batch-generate")
def batch_generate_entries(
    client_id: int,
    payload: BatchGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    invoices = db.query(CFDIInvoice).filter(
        CFDIInvoice.client_id == client_id,
        CFDIInvoice.id.in_(payload.invoice_ids),
        CFDIInvoice.is_posted == False
    ).all()

    success_count = 0
    errors = []

    for inv in invoices:
        if not inv.assigned_account_id:
            errors.append(f"{inv.folio or inv.uuid[:8]}: No tiene cuenta contable asignada.")
            continue

        acc = db.query(Account).filter(Account.id == inv.assigned_account_id, Account.client_id == client_id).first()
        if not acc or not acc.is_active:
            errors.append(f"{inv.folio or inv.uuid[:8]}: Cuenta contable no válida o inactiva.")
            continue

        try:
            post_cfdi_invoice_to_journal(db, inv, current_user.id)
            success_count += 1
        except Exception as e:
            errors.append(f"{inv.folio or inv.uuid[:8]}: {str(e)}")

    return {
        "success_count": success_count,
        "errors": errors
    }

@router.delete("/{client_id}/invoice/{invoice_id}")
def delete_invoice(
    client_id: int,
    invoice_id: int,
    delete_entry: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    inv = db.query(CFDIInvoice).filter(
        CFDIInvoice.id == invoice_id,
        CFDIInvoice.client_id == client_id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Comprobante no encontrado")

    if delete_entry:
        linked_entries = db.query(JournalEntry).filter(
            JournalEntry.client_id == client_id,
            (JournalEntry.id == inv.journal_entry_id) | (JournalEntry.cfdi_uuid == inv.uuid)
        ).all()
        for entry in linked_entries:
            db.query(JournalLine).filter(JournalLine.entry_id == entry.id).delete()
            db.delete(entry)
    elif inv.is_posted and inv.journal_entry_id:
        raise HTTPException(status_code=400, detail="No se puede eliminar un comprobante que ya tiene póliza generada")

    inv_folio = inv.folio or inv.uuid[:8]
    inv_uuid = inv.uuid
    inv_type = inv.cfdi_type
    db.delete(inv)
    db.commit()

    log_activity(
        db=db,
        user=current_user,
        action="ELIMINAR_CFDI",
        module="CFDIs",
        description=f"Eliminó CFDI {inv_type.capitalize()} Folio {inv_folio} ({inv_uuid})",
        client_id=client_id,
        entity_id=inv_uuid
    )

    return {"message": "Comprobante eliminado de la lista"}

@router.post("/{client_id}/clear-invoices")
def clear_client_invoices(
    client_id: int,
    type: Optional[str] = Query(None),
    delete_entries: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant"))
):
    query = db.query(CFDIInvoice).filter(CFDIInvoice.client_id == client_id)
    if type and type in ('emitido', 'recibido', 'nomina'):
        if type == 'nomina':
            query = query.filter((CFDIInvoice.cfdi_type == 'nomina') | (CFDIInvoice.tipo_comprobante == 'N'))
        else:
            query = query.filter(CFDIInvoice.cfdi_type == type)

    invoices = query.all()
    count = len(invoices)
    for inv in invoices:
        if delete_entries:
            linked_entries = db.query(JournalEntry).filter(
                JournalEntry.client_id == client_id,
                (JournalEntry.id == inv.journal_entry_id) | (JournalEntry.cfdi_uuid == inv.uuid)
            ).all()
            for entry in linked_entries:
                db.query(JournalLine).filter(JournalLine.entry_id == entry.id).delete()
                db.delete(entry)
        db.delete(inv)

    db.commit()

    if count > 0:
        log_activity(
            db=db,
            user=current_user,
            action="DEPURAR_CFDIS",
            module="CFDIs",
            description=f"Eliminó {count} comprobante(s) CFDI ({type or 'todos'}) de la empresa",
            client_id=client_id,
            details={"deleted_count": count, "type": type}
        )

    return {"message": f"Se eliminaron {count} comprobantes de la lista", "deleted_count": count}

@router.get("/viewer/{identifier}")
def get_cfdi_viewer(
    identifier: str,
    db: Session = Depends(get_db)
):
    from services.cfdi_viewer_service import get_cfdi_viewer_data
    try:
        return get_cfdi_viewer_data(db, identifier)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al procesar CFDI para visualización: {str(e)}")

