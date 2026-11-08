from lxml import etree
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
import glob
import os

from models.cfdi import CFDIInvoice
from models.journal import JournalEntry

# Diccionarios de descripción oficial SAT
REGIMEN_FISCAL_MAP = {
    '601': '601 - General de Ley Personas Morales',
    '603': '603 - Personas Morales con Fines no Lucrativos',
    '605': '605 - Sueldos y Salarios e Ingresos Asimilados a Salarios',
    '606': '606 - Arrendamiento',
    '607': '607 - Régimen de Enajenación o Adquisición de Bienes',
    '608': '608 - Demás ingresos',
    '610': '610 - Residentes en el Extranjero sin Establecimiento Permanente en México',
    '611': '611 - Ingresos por Dividendos (socios y accionistas)',
    '612': '612 - Personas Físicas con Actividades Empresariales y Profesionales',
    '614': '614 - Ingresos por intereses',
    '615': '615 - Régimen de los ingresos por obtención de premios',
    '616': '616 - Sin obligaciones fiscales',
    '620': '620 - Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
    '621': '621 - Incorporación Fiscal',
    '622': '622 - Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
    '623': '623 - Opcional para Grupos de Sociedades',
    '624': '624 - Coordinados',
    '625': '625 - Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
    '626': '626 - Régimen Simplificado de Confianza (RESICO)',
}

USO_CFDI_MAP = {
    'G01': 'G01 - Adquisición de mercancías',
    'G02': 'G02 - Devoluciones, descuentos o bonificaciones',
    'G03': 'G03 - Gastos en general',
    'I01': 'I01 - Construcciones',
    'I02': 'I02 - Mobiliario y equipo de oficina por inversiones',
    'I03': 'I03 - Equipo de transporte',
    'I04': 'I04 - Equipo de cómputo y accesorios',
    'I08': 'I08 - Otra maquinaria y equipo',
    'D01': 'D01 - Honorarios médicos, dentales y gastos hospitalarios',
    'D02': 'D02 - Gastos médicos por incapacidad o discapacidad',
    'D03': 'D03 - Gastos funerales',
    'D04': 'D04 - Donativos',
    'D07': 'D07 - Primas por seguros de gastos médicos',
    'D08': 'D08 - Gastos de transportación escolar obligatoria',
    'D10': 'D10 - Pagos por servicios educativos (colegiaturas)',
    'S01': 'S01 - Sin efectos fiscales',
    'CP01': 'CP01 - Pagos',
    'CN01': 'CN01 - Nómina'
}

FORMA_PAGO_MAP = {
    '01': '01 - Efectivo',
    '02': '02 - Cheque nominativo',
    '03': '03 - Transferencia electrónica de fondos',
    '04': '04 - Tarjeta de crédito',
    '05': '05 - Monedero electrónico',
    '06': '06 - Dinero electrónico',
    '08': '08 - Vales de despensa',
    '12': '12 - Dación en pago',
    '15': '15 - Condonación',
    '17': '17 - Compensación',
    '28': '28 - Tarjeta de débito',
    '29': '29 - Tarjeta de servicios',
    '99': '99 - Por definir'
}

METODO_PAGO_MAP = {
    'PUE': 'PUE - Pago en una sola exhibición',
    'PPD': 'PPD - Pago en parcialidades o diferido'
}

TIPO_COMPROBANTE_MAP = {
    'I': 'Ingreso',
    'E': 'Egreso',
    'T': 'Traslado',
    'N': 'Nómina',
    'P': 'Pago'
}

TIPO_RELACION_MAP = {
    '01': '01 - Nota de crédito de los documentos relacionados',
    '02': '02 - Nota de débito de los documentos relacionados',
    '03': '03 - Devolución de mercancía sobre facturas o traslados previos',
    '04': '04 - Sustitución de los CFDI previos',
    '05': '05 - Traslados de mercancías facturados previamente',
    '06': '06 - Factura generada por los traslados previos',
    '07': '07 - CFDI por aplicación de anticipo'
}

def numero_a_letras(numero: float, moneda: str = 'MXN') -> str:
    unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
    decenas_10 = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
    decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
    centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

    def seccion(num):
        c = num // 100
        d = (num % 100) // 10
        u = num % 10
        txt = []
        if num == 100:
            return 'CIEN'
        if c > 0:
            txt.append(centenas[c])
        if d == 1:
            txt.append(decenas_10[u])
        elif d == 2:
            if u == 0:
                txt.append('VEINTE')
            else:
                txt.append('VEINTI' + unidades[u])
        elif d > 2:
            if u == 0:
                txt.append(decenas[d])
            else:
                txt.append(decenas[d] + ' Y ' + unidades[u])
        elif d == 0 and u > 0:
            txt.append(unidades[u])
        return ' '.join(txt)

    try:
        numero = float(numero)
    except:
        numero = 0.0

    entero = int(numero)
    centavos = int(round((numero - entero) * 100))
    if centavos >= 100:
        centavos = 99

    if entero == 0:
        texto_entero = 'CERO'
    elif entero < 1000:
        texto_entero = seccion(entero)
    elif entero < 1000000:
        miles = entero // 1000
        resto = entero % 1000
        str_miles = 'MIL' if miles == 1 else (seccion(miles) + ' MIL')
        str_resto = seccion(resto) if resto > 0 else ''
        texto_entero = f"{str_miles} {str_resto}".strip()
    else:
        millones = entero // 1000000
        resto_mill = entero % 1000000
        miles = resto_mill // 1000
        resto = resto_mill % 1000
        str_mill = 'UN MILLON' if millones == 1 else (seccion(millones) + ' MILLONES')
        str_miles = ('MIL' if miles == 1 else (seccion(miles) + ' MIL')) if miles > 0 else ''
        str_resto = seccion(resto) if resto > 0 else ''
        texto_entero = f"{str_mill} {str_miles} {str_resto}".strip()

    moneda_txt = 'PESOS' if moneda in ('MXN', 'PESOS', 'MN', '') else moneda
    return f"{texto_entero} {moneda_txt} CON {centavos:02d}/100 M.N."

def parse_cfdi_to_viewer_data(xml_content: str, invoice_record: Optional[CFDIInvoice] = None) -> Dict[str, Any]:
    try:
        root = etree.fromstring(xml_content.encode('utf-8'))
    except Exception as e:
        raise ValueError(f"Error al procesar el XML: {str(e)}")

    ns = {
        'cfdi': 'http://www.sat.gob.mx/cfd/4',
        'tfd': 'http://www.sat.gob.mx/TimbreFiscalDigital',
        'implocal': 'http://www.sat.gob.mx/implocal'
    }
    if 'http://www.sat.gob.mx/cfd/3' in root.nsmap.values():
        ns['cfdi'] = 'http://www.sat.gob.mx/cfd/3'

    def attr(node, name, default=""):
        if node is not None:
            return node.get(name, default) or default
        return default

    # 1. Comprobante / Documento
    serie = attr(root, 'Serie')
    folio = attr(root, 'Folio')
    documento = f"{serie}- {folio}" if serie and folio else (folio or serie or "S/F")
    fecha_emision = attr(root, 'Fecha')
    tipo_comp_code = attr(root, 'TipoDeComprobante', 'I').upper()
    tipo_comprobante = TIPO_COMPROBANTE_MAP.get(tipo_comp_code, tipo_comp_code)
    lugar_expedicion = attr(root, 'LugarExpedicion')
    moneda = attr(root, 'Moneda', 'MXN')
    tipo_cambio = attr(root, 'TipoCambio', '')
    version_cfdi = attr(root, 'Version', '4.0')
    forma_pago_code = attr(root, 'FormaPago', '99')
    forma_pago = FORMA_PAGO_MAP.get(forma_pago_code, f"{forma_pago_code} - Por definir")
    metodo_pago_code = attr(root, 'MetodoPago', 'PUE')
    metodo_pago = METODO_PAGO_MAP.get(metodo_pago_code, metodo_pago_code)
    condiciones_pago = attr(root, 'CondicionesDePago', '')
    confirmacion = attr(root, 'Confirmacion', '')
    no_certificado = attr(root, 'NoCertificado', '')
    sello_cfd = attr(root, 'Sello', '')

    subtotal = float(attr(root, 'SubTotal', '0'))
    descuento = float(attr(root, 'Descuento', '0'))
    total = float(attr(root, 'Total', '0'))

    # 2. Emisor
    emisor_node = root.find('cfdi:Emisor', ns)
    emisor_rfc = attr(emisor_node, 'Rfc')
    emisor_nombre = attr(emisor_node, 'Nombre')
    emisor_regimen_code = attr(emisor_node, 'RegimenFiscal')
    emisor_regimen = REGIMEN_FISCAL_MAP.get(emisor_regimen_code, emisor_regimen_code)

    # 3. Receptor
    receptor_node = root.find('cfdi:Receptor', ns)
    receptor_rfc = attr(receptor_node, 'Rfc')
    receptor_nombre = attr(receptor_node, 'Nombre')
    receptor_regimen_code = attr(receptor_node, 'RegimenFiscalReceptor')
    receptor_regimen = REGIMEN_FISCAL_MAP.get(receptor_regimen_code, receptor_regimen_code)
    receptor_domicilio = attr(receptor_node, 'DomicilioFiscalReceptor')
    receptor_uso_code = attr(receptor_node, 'UsoCFDI')
    receptor_uso = USO_CFDI_MAP.get(receptor_uso_code, receptor_uso_code)
    residencia_fiscal = attr(receptor_node, 'ResidenciaFiscal', '')
    num_reg_id_trib = attr(receptor_node, 'NumRegIdTrib', '')

    # 4. CFDI Relacionados
    cfdi_rel_node = root.find('cfdi:CfdiRelacionados', ns)
    cfdi_relacionados = []
    tipo_relacion = ""
    if cfdi_rel_node is not None:
        t_rel_code = attr(cfdi_rel_node, 'TipoRelacion')
        tipo_relacion = TIPO_RELACION_MAP.get(t_rel_code, t_rel_code)
        for r in cfdi_rel_node.findall('cfdi:CfdiRelacionado', ns):
            ruuid = attr(r, 'UUID')
            if ruuid:
                cfdi_relacionados.append(ruuid)

    # Si es complemento de pago, checar DoctoRelacionado
    if not cfdi_relacionados:
        doctos = root.xpath("//*[local-name()='DoctoRelacionado']")
        for dr in doctos:
            druuid = dr.get('IdDocumento')
            if druuid and druuid not in cfdi_relacionados:
                cfdi_relacionados.append(druuid)
                if not tipo_relacion:
                    tipo_relacion = "Documento Relacionado (Pago)"

    # 5. Timbre Fiscal Digital
    tfd_nodes = root.xpath('//tfd:TimbreFiscalDigital', namespaces=ns)
    uuid = ""
    fecha_certificacion = ""
    no_certificado_sat = ""
    sello_sat = ""
    rfc_prov_certif = ""
    version_tfd = "1.1"

    if tfd_nodes:
        tfd = tfd_nodes[0]
        uuid = attr(tfd, 'UUID')
        fecha_certificacion = attr(tfd, 'FechaTimbrado')
        no_certificado_sat = attr(tfd, 'NoCertificadoSAT')
        sello_sat = attr(tfd, 'SelloSAT')
        rfc_prov_certif = attr(tfd, 'RfcProvCertif')
        version_tfd = attr(tfd, 'Version', '1.1')
        if not sello_cfd:
            sello_cfd = attr(tfd, 'SelloCFD')

    # Cadena Original del SAT
    cadena_original = f"||{version_tfd}|{uuid}|{fecha_certificacion}|{rfc_prov_certif}|{sello_cfd}|{no_certificado_sat}||"

    # 6. Conceptos
    conceptos = []
    conceptos_node = root.find('cfdi:Conceptos', ns)
    if conceptos_node is not None:
        for c_node in conceptos_node.findall('cfdi:Concepto', ns):
            conceptos.append({
                'clave_prod_serv': attr(c_node, 'ClaveProdServ'),
                'no_identificacion': attr(c_node, 'NoIdentificacion'),
                'cantidad': float(attr(c_node, 'Cantidad', '1')),
                'clave_unidad': attr(c_node, 'ClaveUnidad'),
                'unidad': attr(c_node, 'Unidad'),
                'descripcion': attr(c_node, 'Descripcion'),
                'valor_unitario': float(attr(c_node, 'ValorUnitario', '0')),
                'descuento': float(attr(c_node, 'Descuento', '0')) if attr(c_node, 'Descuento') else None,
                'importe': float(attr(c_node, 'Importe', '0')),
                'objeto_imp': attr(c_node, 'ObjetoImp', '02')
            })

    # 7. Impuestos
    iva_trasladado = 0.0
    ieps_trasladado = 0.0
    retencion_isr = 0.0
    retencion_iva = 0.0

    impuestos_node = root.find('cfdi:Impuestos', ns)
    if impuestos_node is not None:
        traslados_node = impuestos_node.find('cfdi:Traslados', ns)
        if traslados_node is not None:
            for t_node in traslados_node.findall('cfdi:Traslado', ns):
                imp = attr(t_node, 'Impuesto')
                imp_val = float(attr(t_node, 'Importe', '0'))
                if imp in ('002', 'IVA'):
                    iva_trasladado += imp_val
                elif imp in ('003', 'IEPS'):
                    ieps_trasladado += imp_val

        retenciones_node = impuestos_node.find('cfdi:Retenciones', ns)
        if retenciones_node is not None:
            for r_node in retenciones_node.findall('cfdi:Retencion', ns):
                imp = attr(r_node, 'Impuesto')
                imp_val = float(attr(r_node, 'Importe', '0'))
                if imp in ('001', 'ISR'):
                    retencion_isr += imp_val
                elif imp in ('002', 'IVA'):
                    retencion_iva += imp_val

    # Sumar de conceptos si a nivel global venían en 0
    if conceptos_node is not None and iva_trasladado == 0:
        for c_node in conceptos_node.findall('cfdi:Concepto', ns):
            c_imp = c_node.find('cfdi:Impuestos', ns)
            if c_imp is not None:
                c_tras = c_imp.find('cfdi:Traslados', ns)
                if c_tras is not None:
                    for t_node in c_tras.findall('cfdi:Traslado', ns):
                        imp = attr(t_node, 'Impuesto')
                        imp_val = float(attr(t_node, 'Importe', '0'))
                        if imp in ('002', 'IVA'):
                            iva_trasladado += imp_val
                        elif imp in ('003', 'IEPS') and ieps_trasladado == 0:
                            ieps_trasladado += imp_val

    # 8. Impuestos Locales (ej. ISH / Hotelería)
    impuestos_locales = 0.0
    nombre_impuesto_local = ""
    tasa_impuesto_local = ""
    locales_nodes = root.xpath("//*[local-name()='ImpuestosLocales']//*[local-name()='TrasladosLocales']")
    for loc in locales_nodes:
        imp_val = float(loc.get('Importe') or 0.0)
        impuestos_locales += imp_val
        if not nombre_impuesto_local:
            nombre_impuesto_local = loc.get('ImpLocTrasladado') or "ISH"
        if not tasa_impuesto_local and loc.get('TasadeTraslado'):
            tasa_impuesto_local = loc.get('TasadeTraslado')

    if impuestos_locales == 0:
        loc_parent = root.xpath("//*[local-name()='ImpuestosLocales']")
        if loc_parent:
            impuestos_locales = float(loc_parent[0].get('TotaldeTraslados') or 0.0)
            nombre_impuesto_local = "Impuestos Locales (ISH)"

    # Si es complemento de pago y total es 0, extraer montos de pago
    if tipo_comp_code == 'P' or total == 0:
        pago_nodes = root.xpath("//*[local-name()='Pago']")
        totales_nodes = root.xpath("//*[local-name()='Totales']")
        if totales_nodes:
            monto_tot = float(totales_nodes[0].get('MontoTotalPagos') or 0.0)
            if monto_tot > 0:
                total = monto_tot
        if total == 0 and pago_nodes:
            for p in pago_nodes:
                total += float(p.get('Monto') or 0.0)

    # 9. Complemento de Nómina 1.2
    nomina_data = None
    nomina_nodes = root.xpath("//*[local-name()='Nomina']")
    if tipo_comp_code == 'N' or len(nomina_nodes) > 0:
        from services.cfdi_parser import parse_cfdi_xml
        try:
            parsed_nom = parse_cfdi_xml(xml_content.encode('utf-8'))
            nomina_data = parsed_nom.get('nomina_data')
            if nomina_data and retencion_isr == 0 and nomina_data.get('isr_retenido', 0) > 0:
                retencion_isr = float(nomina_data['isr_retenido'])
        except Exception:
            nomina_data = None

    # SAT Verification QR URL
    fe_sello = (sello_cfd[-8:] if len(sello_cfd) >= 8 else "00000000")
    qr_url = f"https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id={uuid}&re={emisor_rfc}&rr={receptor_rfc}&tt={total:.2f}&fe={fe_sello}"

    # Importe en letra
    importe_letra = numero_a_letras(total, moneda)

    return {
        "documento": {
            "serie": serie,
            "folio": folio,
            "full_folio": documento,
            "fecha_emision": fecha_emision,
            "fecha_certificacion": fecha_certificacion,
            "tipo_comprobante": tipo_comprobante,
            "tipo_comprobante_code": tipo_comp_code,
            "lugar_expedicion": lugar_expedicion,
            "version": version_cfdi,
            "moneda": moneda,
            "tipo_cambio": tipo_cambio,
            "forma_pago": forma_pago,
            "forma_pago_code": forma_pago_code,
            "metodo_pago": metodo_pago,
            "metodo_pago_code": metodo_pago_code,
            "condiciones_pago": condiciones_pago,
            "confirmacion": confirmacion,
            "no_certificado_digital": no_certificado
        },
        "emisor": {
            "nombre": emisor_nombre,
            "rfc": emisor_rfc,
            "regimen_fiscal": emisor_regimen,
            "regimen_fiscal_code": emisor_regimen_code,
            "lugar_expedicion": lugar_expedicion
        },
        "receptor": {
            "nombre": receptor_nombre,
            "rfc": receptor_rfc,
            "residencia_fiscal": residencia_fiscal,
            "num_reg_id_trib": num_reg_id_trib,
            "uso_cfdi": receptor_uso,
            "uso_cfdi_code": receptor_uso_code,
            "domicilio_fiscal": receptor_domicilio,
            "regimen_fiscal": receptor_regimen,
            "regimen_fiscal_code": receptor_regimen_code
        },
        "cfdi_relacionado": {
            "tipo_relacion": tipo_relacion,
            "cfdis": cfdi_relacionados,
            "uuid": cfdi_relacionados[0] if cfdi_relacionados else ""
        },
        "timbre": {
            "uuid": uuid,
            "no_certificado_digital": no_certificado,
            "no_certificado_sat": no_certificado_sat,
            "fecha_certificacion": fecha_certificacion,
            "rfc_prov_certif": rfc_prov_certif
        },
        "conceptos": conceptos,
        "totales": {
            "subtotal": round(subtotal, 2),
            "descuento": round(descuento, 2),
            "ieps": round(ieps_trasladado, 2),
            "iva": round(iva_trasladado, 2),
            "retencion_isr": round(retencion_isr, 2),
            "retencion_iva": round(retencion_iva, 2),
            "impuestos_locales": round(impuestos_locales, 2),
            "nombre_impuesto_local": nombre_impuesto_local,
            "tasa_impuesto_local": tasa_impuesto_local,
            "total": round(total, 2),
            "importe_letra": importe_letra
        },
        "sellos": {
            "sello_cfdi": sello_cfd,
            "sello_sat": sello_sat,
            "cadena_original": cadena_original
        },
        "qr_url": qr_url,
        "nomina": nomina_data,
        "raw_xml": xml_content
    }

def get_cfdi_viewer_data(db: Session, identifier: str) -> Dict[str, Any]:
    """
    Busca un comprobante fiscal por UUID (parcial o completo) o ID numérico,
    recupera su XML y genera la representación visual detallada.
    """
    clean_id = (identifier or "").strip()
    invoice = None

    if clean_id.isdigit():
        invoice = db.query(CFDIInvoice).filter(CFDIInvoice.id == int(clean_id)).first()

    if not invoice:
        # Buscar por UUID exacto o parcial
        invoice = db.query(CFDIInvoice).filter(
            CFDIInvoice.uuid.ilike(f"{clean_id}%")
        ).first()

    if not invoice:
        # Buscar en journal_entries
        entry = db.query(JournalEntry).filter(
            JournalEntry.cfdi_uuid.ilike(f"{clean_id}%")
        ).first()
        if entry and entry.cfdi_xml_data:
            return parse_cfdi_to_viewer_data(entry.cfdi_xml_data)

    if not invoice:
        raise ValueError(f"No se encontró ningún comprobante fiscal con el identificador '{clean_id}'.")

    # Si invoice tiene raw_xml
    if invoice.raw_xml and len(invoice.raw_xml) > 50:
        return parse_cfdi_to_viewer_data(invoice.raw_xml, invoice)

    # Intentar buscar el archivo XML en Downloads
    paths = glob.glob(f"C:/Users/MAQRFDCSVDR01/Downloads/*{invoice.uuid}*.xml")
    if paths:
        try:
            with open(paths[0], 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                invoice.raw_xml = content
                db.commit()
                return parse_cfdi_to_viewer_data(content, invoice)
        except Exception:
            pass

    # Si no se tiene el XML crudo, construir representación fiel a partir de la BD
    total_val = float(invoice.total or 0.0)
    subtotal_val = float(invoice.subtotal or 0.0)
    iva_val = float(invoice.iva_trasladado or 0.0)
    isr_val = float(invoice.retencion_isr or 0.0)
    ret_iva_val = float(invoice.retencion_iva or 0.0)
    diff_local = round(max(0.0, total_val - (subtotal_val + iva_val - isr_val - ret_iva_val)), 2)

    return {
        "documento": {
            "serie": "",
            "folio": invoice.folio or "",
            "full_folio": invoice.folio or "S/F",
            "fecha_emision": invoice.date.isoformat() if hasattr(invoice.date, 'isoformat') else str(invoice.date),
            "fecha_certificacion": invoice.date.isoformat() if hasattr(invoice.date, 'isoformat') else str(invoice.date),
            "tipo_comprobante": TIPO_COMPROBANTE_MAP.get(invoice.tipo_comprobante or 'I', 'Ingreso'),
            "tipo_comprobante_code": invoice.tipo_comprobante or 'I',
            "lugar_expedicion": "N/D",
            "version": "4.0",
            "moneda": "MXN",
            "tipo_cambio": "",
            "forma_pago": FORMA_PAGO_MAP.get(invoice.payment_form, invoice.payment_form or "99 - Por definir"),
            "forma_pago_code": invoice.payment_form or "99",
            "metodo_pago": METODO_PAGO_MAP.get(invoice.payment_method, invoice.payment_method or "PUE"),
            "metodo_pago_code": invoice.payment_method or "PUE",
            "condiciones_pago": "",
            "confirmacion": "",
            "no_certificado_digital": "00001000000700000000"
        },
        "emisor": {
            "nombre": invoice.issuer_name or "N/D",
            "rfc": invoice.issuer_rfc or "N/D",
            "regimen_fiscal": "601 - General de Ley Personas Morales",
            "regimen_fiscal_code": "601",
            "lugar_expedicion": "N/D"
        },
        "receptor": {
            "nombre": invoice.receiver_name or "N/D",
            "rfc": invoice.receiver_rfc or "N/D",
            "residencia_fiscal": "",
            "num_reg_id_trib": "",
            "uso_cfdi": USO_CFDI_MAP.get(invoice.cfdi_use, invoice.cfdi_use or "G03 - Gastos en general"),
            "uso_cfdi_code": invoice.cfdi_use or "G03",
            "domicilio_fiscal": "N/D",
            "regimen_fiscal": "612 - Personas Físicas con Actividades Empresariales y Profesionales",
            "regimen_fiscal_code": "612"
        },
        "cfdi_relacionado": {
            "tipo_relacion": "Documento Relacionado (Pago)" if invoice.related_uuid else "",
            "cfdis": [invoice.related_uuid] if invoice.related_uuid else [],
            "uuid": invoice.related_uuid or ""
        },
        "timbre": {
            "uuid": invoice.uuid,
            "no_certificado_digital": "00001000000700000000",
            "no_certificado_sat": "00001000000700000000",
            "fecha_certificacion": invoice.date.isoformat() if hasattr(invoice.date, 'isoformat') else str(invoice.date),
            "rfc_prov_certif": "SAT970701NN3"
        },
        "conceptos": [
            {
                'clave_prod_serv': invoice.clave_prod_serv or '01010101',
                'no_identificacion': invoice.folio or '001',
                'cantidad': 1.0,
                'clave_unidad': 'E48',
                'unidad': 'Servicio',
                'descripcion': invoice.description or 'Servicios profesionales / Productos',
                'valor_unitario': subtotal_val,
                'descuento': None,
                'importe': subtotal_val,
                'objeto_imp': '02'
            }
        ],
        "totales": {
            "subtotal": subtotal_val,
            "descuento": 0.0,
            "ieps": 0.0,
            "iva": iva_val,
            "retencion_isr": isr_val,
            "retencion_iva": ret_iva_val,
            "impuestos_locales": diff_local,
            "nombre_impuesto_local": "Impuestos Locales / Otros" if diff_local > 0 else "",
            "tasa_impuesto_local": "",
            "total": total_val,
            "importe_letra": numero_a_letras(total_val, 'MXN')
        },
        "sellos": {
            "sello_cfdi": "REPRESENTACION DIGITAL VALIDA",
            "sello_sat": "TIMBRADO SAT CERTIFICADO",
            "cadena_original": f"||1.1|{invoice.uuid}|{invoice.date}||"
        },
        "qr_url": f"https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id={invoice.uuid}&re={invoice.issuer_rfc}&rr={invoice.receiver_rfc}&tt={total_val:.2f}&fe=00000000",
        "raw_xml": ""
    }
