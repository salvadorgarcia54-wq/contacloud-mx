from lxml import etree
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List, Dict, Any, Tuple

from models.account import Account
from models.cfdi import CFDIMapping, CFDIInvoice
from models.journal import JournalEntry, JournalLine

def parse_cfdi_xml(xml_content: bytes) -> dict:
    try:
        root = etree.fromstring(xml_content)
    except Exception as e:
        raise ValueError(f"Invalid XML: {str(e)}")

    ns = {
        'cfdi': 'http://www.sat.gob.mx/cfd/4',
        'tfd': 'http://www.sat.gob.mx/TimbreFiscalDigital'
    }
    
    # Fallback to 3.3 if needed
    if 'http://www.sat.gob.mx/cfd/3' in root.nsmap.values():
        ns['cfdi'] = 'http://www.sat.gob.mx/cfd/3'

    def get_attr(node, attr_name, default=""):
        if node is not None:
            return node.get(attr_name, default)
        return default

    # Extract Comprobante level data
    tipo_comprobante = get_attr(root, 'TipoDeComprobante', 'I').upper()
    serie = get_attr(root, 'Serie', '').strip()
    folio = get_attr(root, 'Folio', '').strip()
    full_folio = f"{serie}-{folio}" if serie and folio else (folio or serie or "S/F")

    fecha_str = get_attr(root, 'Fecha')
    try:
        fecha = datetime.strptime(fecha_str[:19], '%Y-%m-%dT%H:%M:%S')
    except:
        fecha = datetime.now()

    subtotal = float(get_attr(root, 'SubTotal', '0'))
    descuento = float(get_attr(root, 'Descuento', '0'))
    total = float(get_attr(root, 'Total', '0'))
    moneda = (get_attr(root, 'Moneda', 'MXN') or 'MXN').strip().upper()
    raw_tc_str = (get_attr(root, 'TipoCambio', '') or '').strip()
    try:
        tipo_cambio = float(raw_tc_str) if raw_tc_str else 1.0
    except Exception:
        tipo_cambio = 1.0
    if tipo_cambio <= 0:
        tipo_cambio = 1.0
    metodo_pago = get_attr(root, 'MetodoPago', 'PUE')
    forma_pago = get_attr(root, 'FormaPago', '99')

    # Emisor
    emisor_node = root.find('cfdi:Emisor', ns)
    emisor = {
        'rfc': get_attr(emisor_node, 'Rfc', '').strip().upper(),
        'nombre': get_attr(emisor_node, 'Nombre', '').strip(),
        'regimen_fiscal': get_attr(emisor_node, 'RegimenFiscal', '')
    }

    # Receptor
    receptor_node = root.find('cfdi:Receptor', ns)
    receptor = {
        'rfc': get_attr(receptor_node, 'Rfc', '').strip().upper(),
        'nombre': get_attr(receptor_node, 'Nombre', '').strip(),
        'uso_cfdi': get_attr(receptor_node, 'UsoCFDI', 'G03')
    }

    # Conceptos
    conceptos = []
    main_clave_prod_serv = ""
    main_description = ""
    conceptos_descuento_sum = 0.0
    conceptos_node = root.find('cfdi:Conceptos', ns)
    if conceptos_node is not None:
        for c_node in conceptos_node.findall('cfdi:Concepto', ns):
            clave = get_attr(c_node, 'ClaveProdServ', '').strip()
            desc = get_attr(c_node, 'Descripcion', '').strip()
            c_desc = float(get_attr(c_node, 'Descuento', '0'))
            conceptos_descuento_sum += c_desc
            if not main_clave_prod_serv and clave:
                main_clave_prod_serv = clave
            if not main_description and desc:
                main_description = desc
            conceptos.append({
                'clave_prod_serv': clave,
                'descripcion': desc,
                'cantidad': float(get_attr(c_node, 'Cantidad', '0')),
                'valor_unitario': float(get_attr(c_node, 'ValorUnitario', '0')),
                'importe': float(get_attr(c_node, 'Importe', '0')),
                'descuento': c_desc
            })

    if descuento == 0 and conceptos_descuento_sum > 0:
        descuento = conceptos_descuento_sum

    # Impuestos
    iva_trasladado = 0.0
    ieps_trasladado = 0.0
    impuestos_locales_trasladados = 0.0
    retencion_isr = 0.0
    retencion_iva = 0.0

    impuestos_node = root.find('cfdi:Impuestos', ns)
    if impuestos_node is not None:
        traslados_node = impuestos_node.find('cfdi:Traslados', ns)
        if traslados_node is not None:
            for t_node in traslados_node.findall('cfdi:Traslado', ns):
                imp = get_attr(t_node, 'Impuesto')
                imp_val = float(get_attr(t_node, 'Importe', '0'))
                if imp in ('002', 'IVA'):
                    iva_trasladado += imp_val
                elif imp in ('003', 'IEPS'):
                    ieps_trasladado += imp_val

        retenciones_node = impuestos_node.find('cfdi:Retenciones', ns)
        if retenciones_node is not None:
            for r_node in retenciones_node.findall('cfdi:Retencion', ns):
                imp = get_attr(r_node, 'Impuesto')
                imp_val = float(get_attr(r_node, 'Importe', '0'))
                if imp in ('001', 'ISR'):
                    retencion_isr += imp_val
                elif imp in ('002', 'IVA'):
                    retencion_iva += imp_val

    # Si no hubo impuestos a nivel global, intentar sumarlos de los conceptos
    if conceptos_node is not None:
        for c_node in conceptos_node.findall('cfdi:Concepto', ns):
            c_imp = c_node.find('cfdi:Impuestos', ns)
            if c_imp is not None:
                c_tras = c_imp.find('cfdi:Traslados', ns)
                if c_tras is not None:
                    for t_node in c_tras.findall('cfdi:Traslado', ns):
                        imp = get_attr(t_node, 'Impuesto')
                        imp_val = float(get_attr(t_node, 'Importe', '0'))
                        if iva_trasladado == 0 and imp in ('002', 'IVA'):
                            iva_trasladado += imp_val
                        elif ieps_trasladado == 0 and imp in ('003', 'IEPS'):
                            ieps_trasladado += imp_val
                c_ret = c_imp.find('cfdi:Retenciones', ns)
                if c_ret is not None:
                    for r_node in c_ret.findall('cfdi:Retencion', ns):
                        imp = get_attr(r_node, 'Impuesto')
                        imp_val = float(get_attr(r_node, 'Importe', '0'))
                        if retencion_isr == 0 and imp in ('001', 'ISR'):
                            retencion_isr += imp_val
                        elif retencion_iva == 0 and imp in ('002', 'IVA'):
                            retencion_iva += imp_val

    # Impuestos Locales (ej. ISH / Impuesto sobre Hospedaje / Hotelería)
    locales_nodes = root.xpath("//*[local-name()='ImpuestosLocales']//*[local-name()='TrasladosLocales']")
    for loc_node in locales_nodes:
        imp_val = float(loc_node.get('Importe') or 0.0)
        impuestos_locales_trasladados += imp_val

    if impuestos_locales_trasladados == 0:
        loc_parent = root.xpath("//*[local-name()='ImpuestosLocales']")
        if loc_parent:
            impuestos_locales_trasladados = float(loc_parent[0].get('TotaldeTraslados') or 0.0)

    # Complemento para Recepción de Pagos (Tipo 'P' o nodos Pago)
    pago_nodes = root.xpath("//*[local-name()='Pago']")
    docto_nodes = root.xpath("//*[local-name()='DoctoRelacionado']")
    is_pago = (tipo_comprobante == 'P') or (len(pago_nodes) > 0)
    
    related_uuid = ""
    related_folio = ""
    pago_monto_total = 0.0
    pago_monto_original = 0.0
    pago_iva_total = 0.0
    pago_forma_pago = forma_pago
    pago_fecha = fecha
    es_moneda_extranjera = False
    subtotal_moneda_original = round(subtotal, 2)
    descuento_moneda_original = round(descuento, 2)
    iva_moneda_original = round(iva_trasladado, 2)
    total_moneda_original = round(total, 2)

    if is_pago and pago_nodes:
        tipo_comprobante = 'P'
        pago_tc = 1.0
        pago_moneda = 'MXN'
        for p_node in pago_nodes:
            p_monto = float(p_node.get('Monto') or 0.0)
            p_mon = (p_node.get('MonedaP') or 'MXN').strip().upper()
            try:
                p_tc = float(p_node.get('TipoCambioP') or 1.0)
            except Exception:
                p_tc = 1.0
            if p_tc <= 0:
                p_tc = 1.0
            if p_mon not in ('MXN', 'XXX', ''):
                pago_moneda = p_mon
                pago_tc = p_tc
                es_moneda_extranjera = True
                pago_monto_original += p_monto
                pago_monto_total += round(p_monto * p_tc, 2)
            else:
                pago_monto_original += p_monto
                pago_monto_total += p_monto

            p_forma = p_node.get('FormaDePagoP')
            if p_forma:
                pago_forma_pago = p_forma
            p_fecha = p_node.get('FechaPago')
            if p_fecha:
                try:
                    pago_fecha = datetime.strptime(p_fecha[:19], '%Y-%m-%dT%H:%M:%S')
                except:
                    pass

        if es_moneda_extranjera:
            moneda = pago_moneda
            tipo_cambio = pago_tc

        # Documentos relacionados
        for dr_node in docto_nodes:
            dr_uuid = dr_node.get('IdDocumento') or ""
            dr_serie = dr_node.get('Serie') or ""
            dr_folio = dr_node.get('Folio') or ""
            dr_full = f"{dr_serie}-{dr_folio}" if dr_serie and dr_folio else (dr_folio or dr_serie or "")
            if not related_uuid and dr_uuid:
                related_uuid = dr_uuid
            if not related_folio and dr_full:
                related_folio = dr_full

            # Impuestos en DoctoRelacionado (CFDI 4.0 Pagos 2.0)
            tras_dr = dr_node.xpath(".//*[local-name()='TrasladoDR']")
            for t_dr in tras_dr:
                imp = t_dr.get('ImpuestoDR') or ""
                imp_val = float(t_dr.get('ImporteDR') or 0.0)
                if imp in ('002', 'IVA') and imp_val > 0:
                    pago_iva_total += round(imp_val * pago_tc, 2) if es_moneda_extranjera else imp_val

        # Impuestos a nivel Pago (ImpuestosP)
        tras_p = root.xpath("//*[local-name()='ImpuestosP']//*[local-name()='TrasladoP']")
        if pago_iva_total == 0 and tras_p:
            for t_p in tras_p:
                imp = t_p.get('ImpuestoP') or ""
                imp_val = float(t_p.get('ImporteP') or 0.0)
                if imp in ('002', 'IVA') and imp_val > 0:
                    pago_iva_total += round(imp_val * pago_tc, 2) if es_moneda_extranjera else imp_val

        # Totales en Pagos 2.0 (el nodo Totales en Pagos 2.0 ya viene expresado en MXN por norma SAT)
        totales_node = root.xpath("//*[local-name()='Totales']")
        has_pagos20_totales = len(totales_node) > 0
        if has_pagos20_totales:
            t_iva = (
                float(totales_node[0].get('TotalTrasladosImpuestoIVA16') or 0.0) +
                float(totales_node[0].get('TotalTrasladosImpuestoIVA8') or 0.0) +
                float(totales_node[0].get('TotalTrasladosImpuestoIVA0') or 0.0)
            )
            pago_iva_total = t_iva
            t_monto = float(totales_node[0].get('MontoTotalPagos') or 0.0)
            if t_monto > 0:
                pago_monto_total = t_monto

        # Si aún no tiene desglose de IVA (únicamente para CFDI 3.3 Pagos 1.0 sin nodo Totales ni TrasladoP), calcular tasa estándar 16%
        if not has_pagos20_totales and not tras_p and pago_iva_total == 0 and pago_monto_total > 0:
            pago_iva_total = round(pago_monto_total - (pago_monto_total / 1.16), 2)

        total = round(pago_monto_total, 2)
        iva_trasladado = round(pago_iva_total, 2)
        subtotal = round(max(0.0, total - iva_trasladado), 2)
        total_moneda_original = round(pago_monto_original, 2)
        forma_pago = pago_forma_pago
        metodo_pago = 'PAGO'
        fecha = pago_fecha
        main_clave_prod_serv = '84111506'
        rel_label = f"Docto Rel: {related_folio or (related_uuid[:8] if related_uuid else 'N/A')}"
        main_description = f"Complemento de Pago ({rel_label})"
    elif moneda not in ('MXN', 'XXX', '') and tipo_cambio > 0 and abs(tipo_cambio - 1.0) > 0.0001:
        # Conversión automática de Moneda Extranjera (USD, EUR, CAD, etc.) a Pesos Mexicanos (MXN) usando el TipoCambio del CFDI
        es_moneda_extranjera = True
        subtotal_moneda_original = round(subtotal, 2)
        descuento_moneda_original = round(descuento, 2)
        iva_moneda_original = round(iva_trasladado, 2)
        total_moneda_original = round(total, 2)

        subtotal = round(subtotal * tipo_cambio, 2)
        descuento = round(descuento * tipo_cambio, 2)
        iva_trasladado = round(iva_trasladado * tipo_cambio, 2)
        ieps_trasladado = round(ieps_trasladado * tipo_cambio, 2)
        impuestos_locales_trasladados = round(impuestos_locales_trasladados * tipo_cambio, 2)
        retencion_isr = round(retencion_isr * tipo_cambio, 2)
        retencion_iva = round(retencion_iva * tipo_cambio, 2)
        total = round(total * tipo_cambio, 2)

        # Ajuste fino de centavos por redondeo cambiario para que Subtotal - Descuento + Impuestos == Total exacto en MXN
        expected_tot = round(
            subtotal - descuento + iva_trasladado + ieps_trasladado + impuestos_locales_trasladados - retencion_isr - retencion_iva,
            2
        )
        diff_fx = round(total - expected_tot, 2)
        if 0 < abs(diff_fx) <= 0.20:
            subtotal = round(subtotal + diff_fx, 2)

        for c_item in conceptos:
            c_item['valor_unitario_original'] = c_item['valor_unitario']
            c_item['importe_original'] = c_item['importe']
            c_item['valor_unitario'] = round(c_item['valor_unitario'] * tipo_cambio, 2)
            c_item['importe'] = round(c_item['importe'] * tipo_cambio, 2)
            c_item['descuento'] = round(c_item['descuento'] * tipo_cambio, 2)

    # Complemento de Nómina (CFDI 4.0 / 3.3 Nomina 1.2)
    nomina_nodes = root.xpath("//*[local-name()='Nomina']")
    is_nomina = (tipo_comprobante == 'N') or (len(nomina_nodes) > 0)
    nomina_data = None

    if is_nomina:
        tipo_comprobante = 'N'
        if not main_clave_prod_serv:
            main_clave_prod_serv = '84111505'

        n_node = nomina_nodes[0] if nomina_nodes else None
        version_nomina = n_node.get('Version') or '1.2' if n_node is not None else '1.2'
        tipo_nomina_code = (n_node.get('TipoNomina') or 'O').upper() if n_node is not None else 'O'
        tipo_nomina_label = 'Ordinaria' if tipo_nomina_code == 'O' else ('Extraordinaria' if tipo_nomina_code == 'E' else tipo_nomina_code)
        fecha_pago = n_node.get('FechaPago') or '' if n_node is not None else ''
        fecha_inicial_pago = n_node.get('FechaInicialPago') or '' if n_node is not None else ''
        fecha_final_pago = n_node.get('FechaFinalPago') or '' if n_node is not None else ''
        try:
            num_dias_pagados = float(n_node.get('NumDiasPagados') or 0.0) if n_node is not None else 0.0
        except Exception:
            num_dias_pagados = 0.0

        try:
            total_percepciones = float(n_node.get('TotalPercepciones') or 0.0) if n_node is not None else 0.0
        except Exception:
            total_percepciones = 0.0

        try:
            total_deducciones = float(n_node.get('TotalDeducciones') or 0.0) if n_node is not None else 0.0
        except Exception:
            total_deducciones = 0.0

        try:
            total_otros_pagos = float(n_node.get('TotalOtrosPagos') or 0.0) if n_node is not None else 0.0
        except Exception:
            total_otros_pagos = 0.0

        # Emisor de Nómina
        n_emisor = n_node.xpath(".//*[local-name()='Emisor']") if n_node is not None else []
        registro_patronal = n_emisor[0].get('RegistroPatronal') or '' if n_emisor else ''
        rfc_patron_origen = n_emisor[0].get('RfcPatronOrigen') or '' if n_emisor else ''

        # Receptor de Nómina (Datos Generales del Trabajador)
        n_receptor = n_node.xpath(".//*[local-name()='Receptor']") if n_node is not None else []
        nr = n_receptor[0] if n_receptor else None
        curp = (nr.get('Curp') or '') if nr is not None else ''
        nss = (nr.get('NumSeguridadSocial') or '') if nr is not None else ''
        fecha_inicio_rel_laboral = (nr.get('FechaInicioRelLaboral') or '') if nr is not None else ''
        antiguedad = (nr.get('Antigüedad') or nr.get('Antiguedad') or '') if nr is not None else ''
        tipo_contrato = (nr.get('TipoContrato') or '') if nr is not None else ''
        sindicalizado = (nr.get('Sindicalizado') or '') if nr is not None else ''
        tipo_jornada = (nr.get('TipoJornada') or '') if nr is not None else ''
        tipo_regimen = (nr.get('TipoRegimen') or '') if nr is not None else ''
        num_empleado = (nr.get('NumEmpleado') or '') if nr is not None else ''
        departamento = (nr.get('Departamento') or '') if nr is not None else ''
        puesto = (nr.get('Puesto') or '') if nr is not None else ''
        riesgo_puesto = (nr.get('RiesgoPuesto') or '') if nr is not None else ''
        periodicidad_pago = (nr.get('PeriodicidadPago') or '') if nr is not None else ''
        clave_ent_fed = (nr.get('ClaveEntFed') or '') if nr is not None else ''
        try:
            salario_base_cot_apor = float(nr.get('SalarioBaseCotApor') or 0.0) if nr is not None else 0.0
        except Exception:
            salario_base_cot_apor = 0.0
        try:
            salario_diario_integrado = float(nr.get('SalarioDiarioIntegrado') or 0.0) if nr is not None else 0.0
        except Exception:
            salario_diario_integrado = 0.0

        # Percepciones
        percepciones_nodes = n_node.xpath(".//*[local-name()='Percepciones']") if n_node is not None else []
        p_parent = percepciones_nodes[0] if percepciones_nodes else None
        total_sueldos = float(p_parent.get('TotalSueldos') or 0.0) if p_parent is not None else 0.0
        total_gravado = float(p_parent.get('TotalGravado') or 0.0) if p_parent is not None else 0.0
        total_exento = float(p_parent.get('TotalExento') or 0.0) if p_parent is not None else 0.0
        percepciones_list = []
        if p_parent is not None:
            for p_item in p_parent.xpath(".//*[local-name()='Percepcion']"):
                imp_g = float(p_item.get('ImporteGravado') or 0.0)
                imp_e = float(p_item.get('ImporteExento') or 0.0)
                percepciones_list.append({
                    'tipo_percepcion': p_item.get('TipoPercepcion') or '',
                    'clave': p_item.get('Clave') or '',
                    'concepto': p_item.get('Concepto') or '',
                    'importe_gravado': round(imp_g, 2),
                    'importe_exento': round(imp_e, 2),
                    'importe_total': round(imp_g + imp_e, 2)
                })

        # Deducciones
        deducciones_nodes = n_node.xpath(".//*[local-name()='Deducciones']") if n_node is not None else []
        d_parent = deducciones_nodes[0] if deducciones_nodes else None
        total_impuestos_retenidos_nom = float(d_parent.get('TotalImpuestosRetenidos') or 0.0) if d_parent is not None else 0.0
        total_otras_deducciones_nom = float(d_parent.get('TotalOtrasDeducciones') or 0.0) if d_parent is not None else 0.0
        isr_retenido_nomina = 0.0
        imss_retenido_nomina = 0.0
        infonavit_retenido_nomina = 0.0
        otras_deducciones_nomina = 0.0
        deducciones_list = []
        if d_parent is not None:
            for d_item in d_parent.xpath(".//*[local-name()='Deduccion']"):
                t_ded = (d_item.get('TipoDeduccion') or '').strip()
                imp_d = float(d_item.get('Importe') or 0.0)
                if t_ded == '002':
                    isr_retenido_nomina += imp_d
                elif t_ded == '001':
                    imss_retenido_nomina += imp_d
                elif t_ded in ('009', '010'):
                    infonavit_retenido_nomina += imp_d
                else:
                    otras_deducciones_nomina += imp_d
                deducciones_list.append({
                    'tipo_deduccion': t_ded,
                    'clave': d_item.get('Clave') or '',
                    'concepto': d_item.get('Concepto') or '',
                    'importe': round(imp_d, 2)
                })

        if isr_retenido_nomina == 0 and total_impuestos_retenidos_nom > 0:
            isr_retenido_nomina = total_impuestos_retenidos_nom

        # Otros Pagos y Subsidio al Empleo
        otros_pagos_nodes = n_node.xpath(".//*[local-name()='OtrosPagos']") if n_node is not None else []
        op_parent = otros_pagos_nodes[0] if otros_pagos_nodes else None
        subsidio_causado = 0.0
        subsidio_entregado = 0.0
        otros_pagos_list = []
        if op_parent is not None:
            for op_item in op_parent.xpath(".//*[local-name()='OtroPago']"):
                t_op = (op_item.get('TipoOtroPago') or '').strip()
                imp_op = float(op_item.get('Importe') or 0.0)
                sub_nodes = op_item.xpath(".//*[local-name()='SubsidioAlEmpleo']")
                sub_c = float(sub_nodes[0].get('SubsidioCausado') or 0.0) if sub_nodes else 0.0
                subsidio_causado += sub_c
                if t_op == '002':
                    subsidio_entregado += imp_op
                otros_pagos_list.append({
                    'tipo_otro_pago': t_op,
                    'clave': op_item.get('Clave') or '',
                    'concepto': op_item.get('Concepto') or '',
                    'importe': round(imp_op, 2),
                    'subsidio_causado': round(sub_c, 2)
                })

        if total_percepciones == 0 and subtotal > 0:
            total_percepciones = round(subtotal - total_otros_pagos, 2)
        if total_deducciones == 0 and descuento > 0:
            total_deducciones = round(descuento, 2)

        retencion_isr = round(isr_retenido_nomina, 2)
        if fecha_final_pago and fecha_inicial_pago:
            periodo_str = f"{fecha_inicial_pago} al {fecha_final_pago}"
        elif fecha_pago:
            periodo_str = f"Pago {fecha_pago}"
        else:
            periodo_str = ""
        main_description = f"Recibo de Nómina {tipo_nomina_label} ({periodo_str}) - {receptor.get('nombre', '')}".strip()

        nomina_data = {
            'version': version_nomina,
            'tipo_nomina': tipo_nomina_code,
            'tipo_nomina_label': tipo_nomina_label,
            'fecha_pago': fecha_pago,
            'fecha_inicial_pago': fecha_inicial_pago,
            'fecha_final_pago': fecha_final_pago,
            'num_dias_pagados': round(num_dias_pagados, 2),
            'total_percepciones': round(total_percepciones, 2),
            'total_deducciones': round(total_deducciones, 2),
            'total_otros_pagos': round(total_otros_pagos, 2),
            'total_sueldos': round(total_sueldos, 2),
            'total_gravado': round(total_gravado, 2),
            'total_exento': round(total_exento, 2),
            'isr_retenido': round(isr_retenido_nomina, 2),
            'imss_retenido': round(imss_retenido_nomina, 2),
            'infonavit_retenido': round(infonavit_retenido_nomina, 2),
            'otras_deducciones': round(otras_deducciones_nomina, 2),
            'subsidio_causado': round(subsidio_causado, 2),
            'subsidio_entregado': round(subsidio_entregado, 2),
            'neto_pagado': round(total, 2),
            'registro_patronal': registro_patronal,
            'rfc_patron_origen': rfc_patron_origen,
            'curp': curp,
            'nss': nss,
            'fecha_inicio_rel_laboral': fecha_inicio_rel_laboral,
            'antiguedad': antiguedad,
            'tipo_contrato': tipo_contrato,
            'sindicalizado': sindicalizado,
            'tipo_jornada': tipo_jornada,
            'tipo_regimen': tipo_regimen,
            'num_empleado': num_empleado,
            'departamento': departamento,
            'puesto': puesto,
            'riesgo_puesto': riesgo_puesto,
            'periodicidad_pago': periodicidad_pago,
            'clave_ent_fed': clave_ent_fed,
            'salario_base_cot_apor': round(salario_base_cot_apor, 2),
            'salario_diario_integrado': round(salario_diario_integrado, 2),
            'percepciones': percepciones_list,
            'deducciones': deducciones_list,
            'otros_pagos': otros_pagos_list
        }

    # Timbre (UUID)
    uuid = ""
    complemento = root.find('cfdi:Complemento', ns)
    if complemento is not None:
        tfd = complemento.find('tfd:TimbreFiscalDigital', ns)
        if tfd is not None:
            uuid = get_attr(tfd, 'UUID')

    return {
        'uuid': uuid,
        'tipo_comprobante': tipo_comprobante,
        'is_pago': is_pago,
        'is_nomina': is_nomina,
        'nomina_data': nomina_data,
        'related_uuid': related_uuid,
        'related_folio': related_folio,
        'serie': serie,
        'folio': folio,
        'full_folio': full_folio,
        'fecha': fecha,
        'subtotal': round(subtotal, 2),
        'descuento': round(descuento, 2),
        'total': round(total, 2),
        'moneda': moneda,
        'tipo_cambio': tipo_cambio,
        'es_moneda_extranjera': es_moneda_extranjera,
        'subtotal_moneda_original': subtotal_moneda_original,
        'descuento_moneda_original': descuento_moneda_original,
        'iva_moneda_original': iva_moneda_original,
        'total_moneda_original': total_moneda_original,
        'emisor': emisor,
        'receptor': receptor,
        'metodo_pago': metodo_pago,
        'forma_pago': forma_pago,
        'conceptos': conceptos,
        'clave_prod_serv': main_clave_prod_serv,
        'description': main_description or (f"Factura {full_folio}" if full_folio else "Comprobante Fiscal"),
        'iva_trasladado': round(iva_trasladado, 2),
        'ieps_trasladado': round(ieps_trasladado, 2),
        'impuestos_locales': round(impuestos_locales_trasladados, 2),
        'retencion_isr': round(retencion_isr, 2),
        'retencion_iva': round(retencion_iva, 2),
        'impuestos': {
            'total_trasladados': iva_trasladado,
            'total_retenidos': retencion_isr + retencion_iva,
            'traslados': [{'impuesto': '002', 'importe': iva_trasladado}],
            'retenciones': [
                {'impuesto': '001', 'importe': retencion_isr},
                {'impuesto': '002', 'importe': retencion_iva}
            ]
        }
    }

def find_account(db: Session, client_id: int, sat_code_prefix: str) -> Optional[Account]:
    return db.query(Account).filter(
        Account.client_id == client_id,
        Account.is_active == True,
        Account.sat_group_code.like(f"{sat_code_prefix}%")
    ).order_by(Account.account_number.asc()).first()

def get_iva_account_for_cfdi(
    db: Session,
    client_id: int,
    cfdi_type: str,
    payment_method: Optional[str],
    payment_form: Optional[str]
) -> Tuple[Optional[Account], str]:
    """
    Determina la cuenta contable y descripción de IVA según las instrucciones exactas:
    
    FACTURAS EMITIDAS:
      - Cuando el método de pago sea PPD: Registra el IVA en la cuenta 209-01-000 (IVA trasladado no cobrado)
      - Cuando el método de pago sea PUE:
          * Si la forma de pago es 01 (efectivo): Registra el IVA en la cuenta 208-01-000 (IVA trasladado cobrado)
          * Otras formas de pago en PUE (03 transferencia, etc.): Registra el IVA en la cuenta 208-01-000 (IVA trasladado cobrado)
          
    FACTURAS RECIBIDAS:
      - Cuando el método de pago sea PPD: Registra el IVA en la cuenta 119-01-000 (IVA pendiente de pago)
      - Cuando el método de pago sea PUE:
          * Si la forma de pago es 01 (efectivo): Registra el IVA en la cuenta 118-01-000 (IVA acreditable pagado)
          * Otras formas de pago en PUE (03 transferencia, etc.): Registra el IVA en la cuenta 118-01-000 (IVA acreditable pagado)
    """
    method = (payment_method or '').strip().upper()
    form = (payment_form or '').strip()

    if cfdi_type == 'emitido':
        if method == 'PPD':
            target_acc = '209-01-000'
            sat_code = '209.01'
            desc = 'IVA Trasladado No Cobrado (PPD)'
        else:
            target_acc = '208-01-000'
            sat_code = '208.01'
            desc = 'IVA Trasladado Cobrado (Efectivo)' if (form == '01' or form.startswith('01')) else 'IVA Trasladado Cobrado (PUE)'
    else:
        # recibido
        if method == 'PPD':
            target_acc = '119-01-000'
            sat_code = '119.01'
            desc = 'IVA Pendiente de Pago (PPD)'
        else:
            target_acc = '118-01-000'
            sat_code = '118.01'
            desc = 'IVA Acreditable Pagado (Efectivo)' if (form == '01' or form.startswith('01')) else 'IVA Acreditable Pagado (PUE)'

    # 1. Buscar directamente por número de cuenta exacto
    acc = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number == target_acc
    ).first()
    if acc:
        if not acc.is_active:
            acc.is_active = True
            db.commit()
        return acc, desc

    # 2. Buscar por código agrupador SAT exacto
    acc = db.query(Account).filter(
        Account.client_id == client_id,
        Account.sat_group_code == sat_code
    ).first()
    if acc:
        if not acc.is_active:
            acc.is_active = True
            db.commit()
        return acc, desc

    # 3. Fallback
    fallback_acc = find_account(db, client_id, sat_code.split('.')[0])
    return fallback_acc, desc

def get_default_bank_or_cash_account(db: Session, client_id: int, payment_form: Optional[str]) -> Optional[int]:
    """
    Retorna el ID de la cuenta contable de Bancos o Caja para complementos de pago:
    - Si la forma de pago es 01 (efectivo): sugiere cuenta de Caja (101-01-000 o afectable bajo 101).
    - Otras formas de pago (03 transferencia, etc.): sugiere cuenta de Bancos (102-01-001 o 102-01-000).
    """
    clean_form = (payment_form or '').strip()
    if clean_form == '01' or clean_form.startswith('01'):
        caja = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number.like('101%'),
            Account.is_active == True
        ).order_by(Account.classification.desc(), Account.account_number.asc()).first()
        if caja:
            return caja.id

    # Buscar subcuenta afectable de Bancos nacionales (ej. 102-01-001)
    bank_acc = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number.like('102-01-%'),
        Account.account_number != '102-01-000',
        Account.is_active == True
    ).order_by(Account.classification.desc(), Account.account_number.asc()).first()
    
    if not bank_acc:
        # Fallback a Bancos nacionales 102-01-000
        bank_acc = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number == '102-01-000'
        ).first()

    if not bank_acc:
        bank_acc = find_account(db, client_id, '102')

    return bank_acc.id if bank_acc else None

def get_or_create_partner_account(db: Session, client_id: int, partner_type: str, rfc: str, name: str) -> Account:
    """
    Busca o da de alta automáticamente la subcuenta de Cliente (105-01-XXX) o Proveedor (201-01-XXX)
    de forma consecutiva y con clasificación 'Afectable'.
    """
    clean_name = (name or "").strip()
    clean_rfc = (rfc or "").strip().upper()

    if partner_type == 'cliente':
        base_prefix = '105-01-'
        sat_code = '105.01'
        nature = 'deudora'
        default_parent_acc = '105-01-000'
    else:
        base_prefix = '201-01-'
        sat_code = '201.01'
        nature = 'acreedora'
        default_parent_acc = '201-01-000'

    # 1. Buscar si ya existe una cuenta afectable bajo este prefijo que coincida con el nombre o RFC
    existing = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number.like(f"{base_prefix}%"),
        Account.account_number != f"{base_prefix}000"
    ).all()

    for acc in existing:
        acc_name_norm = acc.name.upper()
        if clean_rfc and clean_rfc in acc_name_norm:
            return acc
        if clean_name and (clean_name.upper() == acc_name_norm or clean_name.upper() in acc_name_norm):
            return acc

    # 2. Si no existe, calcular el siguiente consecutivo (ej. 105-01-001, 105-01-002...)
    max_num = 0
    for acc in existing:
        parts = acc.account_number.split('-')
        if len(parts) == 3 and parts[2].isdigit():
            val = int(parts[2])
            if val > max_num:
                max_num = val

    next_num = max_num + 1
    new_account_number = f"{base_prefix}{str(next_num).zfill(3)}"

    # Buscar cuenta padre
    parent_account = db.query(Account).filter(
        Account.client_id == client_id,
        Account.account_number == default_parent_acc
    ).first()

    account_display_name = f"{clean_name} ({clean_rfc})" if clean_rfc and clean_rfc not in clean_name else clean_name

    new_account = Account(
        client_id=client_id,
        account_number=new_account_number,
        name=account_display_name[:300],
        sat_group_code=sat_code,
        level=3,
        nature=nature,
        classification='Afectable',
        is_active=True,
        parent_id=parent_account.id if parent_account else None
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    return new_account

def get_suggested_account(db: Session, client_id: int, mapping_type: str, rfc: str, clave_prod_serv: str) -> Optional[int]:
    """
    Retorna el ID de la cuenta contable recordada para este RFC + ClaveProdServ si existe
    y es una cuenta afectable válida. No precarga cuentas genéricas ciegas.
    """
    clean_rfc = (rfc or "").strip().upper()
    clean_clave = (clave_prod_serv or "").strip()

    def _is_valid_mapped_acc(acc_id: int) -> bool:
        if not acc_id:
            return False
        acc = db.query(Account).filter(Account.id == acc_id, Account.client_id == client_id).first()
        if not acc or not acc.is_active:
            return False
        return True

    # 1. Buscar mapeo exacto por RFC + ClaveProdServ
    if clean_rfc and clean_clave:
        mapping = db.query(CFDIMapping).filter(
            CFDIMapping.client_id == client_id,
            CFDIMapping.mapping_type == mapping_type,
            CFDIMapping.rfc == clean_rfc,
            CFDIMapping.clave_prod_serv == clean_clave
        ).first()
        if mapping and _is_valid_mapped_acc(mapping.account_id):
            return mapping.account_id

    # 2. Buscar mapeo por RFC (cualquier producto del mismo proveedor/cliente)
    if clean_rfc:
        mapping = db.query(CFDIMapping).filter(
            CFDIMapping.client_id == client_id,
            CFDIMapping.mapping_type == mapping_type,
            CFDIMapping.rfc == clean_rfc
        ).order_by(CFDIMapping.updated_at.desc()).first()
        if mapping and _is_valid_mapped_acc(mapping.account_id):
            return mapping.account_id

    # 3. Para CFDI de Nómina, sugerir automáticamente la cuenta afectable de Sueldos y Salarios (601-01-000)
    if mapping_type == 'nomina' or clean_clave == '84111505':
        acc_nom = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number == '601-01-000',
            Account.is_active == True
        ).first()
        if acc_nom and acc_nom.classification == 'Afectable':
            return acc_nom.id
        acc_nom_fallback = db.query(Account).filter(
            Account.client_id == client_id,
            Account.sat_group_code == '601.01',
            Account.classification == 'Afectable',
            Account.is_active == True
        ).first()
        if acc_nom_fallback:
            return acc_nom_fallback.id

    # No precargar cuenta genérica en el recuadro; debe permanecer vacía para que el usuario elija la cuenta contable válida
    return None

def save_cfdi_mapping(db: Session, client_id: int, mapping_type: str, rfc: str, clave_prod_serv: str, account_id: int):
    """
    Guarda o actualiza la memoria contable para el RFC y ClaveProdServ.
    """
    clean_rfc = (rfc or "").strip().upper()
    clean_clave = (clave_prod_serv or "").strip()
    if not clean_rfc or not account_id:
        return

    # No guardar mapeos a cuentas inactivas
    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc or not acc.is_active:
        return
    clean_clave = (clave_prod_serv or "").strip()
    if not clean_rfc or not account_id:
        return

    mapping = db.query(CFDIMapping).filter(
        CFDIMapping.client_id == client_id,
        CFDIMapping.mapping_type == mapping_type,
        CFDIMapping.rfc == clean_rfc,
        CFDIMapping.clave_prod_serv == clean_clave
    ).first()

    if mapping:
        mapping.account_id = account_id
        mapping.updated_at = datetime.utcnow()
    else:
        mapping = CFDIMapping(
            client_id=client_id,
            mapping_type=mapping_type,
            rfc=clean_rfc,
            clave_prod_serv=clean_clave,
            account_id=account_id
        )
        db.add(mapping)
    db.commit()

def post_cfdi_invoice_to_journal(db: Session, invoice: CFDIInvoice, current_user_id: int) -> JournalEntry:
    """
    Genera la póliza cuadrada con los datos del CFDI, creando automáticamente la subcuenta
    consecutiva de cliente/proveedor y guardando la memoria contable.
    """
    if invoice.is_posted and invoice.journal_entry_id:
        existing_entry = db.query(JournalEntry).filter(JournalEntry.id == invoice.journal_entry_id).first()
        if existing_entry:
            return existing_entry

    is_pago_complement = (
        (getattr(invoice, 'tipo_comprobante', None) or '').upper() == 'P' or
        (invoice.clave_prod_serv or '').strip() == '84111506' or
        (invoice.payment_method or '').upper() == 'PAGO'
    )
    is_nomina_cfdi = (
        invoice.cfdi_type == 'nomina' or
        (getattr(invoice, 'tipo_comprobante', None) or '').upper() == 'N' or
        (invoice.clave_prod_serv or '').strip() == '84111505'
    )

    if not invoice.assigned_account_id:
        if is_pago_complement:
            bank_id = get_default_bank_or_cash_account(db, invoice.client_id, invoice.payment_form)
            if bank_id:
                invoice.assigned_account_id = bank_id
                db.commit()
        elif is_nomina_cfdi:
            nom_acc_id = get_suggested_account(db, invoice.client_id, 'nomina', invoice.receiver_rfc, '84111505')
            if nom_acc_id:
                invoice.assigned_account_id = nom_acc_id
                db.commit()
        if not invoice.assigned_account_id:
            raise ValueError("Debe seleccionar una cuenta contable antes de generar la póliza.")

    acc_check = db.query(Account).filter(Account.id == invoice.assigned_account_id, Account.client_id == invoice.client_id).first()
    if not acc_check or not acc_check.is_active:
        raise ValueError("La cuenta contable seleccionada es inválida o inactiva. Elija una cuenta válida.")

    lines_data = []
    subtotal = float(invoice.subtotal or 0)
    total = float(invoice.total or 0)
    iva = float(invoice.iva_trasladado or 0)
    ret_isr = float(invoice.retencion_isr or 0)
    ret_iva = float(invoice.retencion_iva or 0)

    # Si el CFDI está en moneda extranjera (ej. USD, EUR), asegurar que los importes de la póliza estén convertidos a MXN con el TipoCambio del CFDI
    fx_note = ""
    if getattr(invoice, 'raw_xml', None):
        try:
            parsed_fx = parse_cfdi_xml(invoice.raw_xml.encode('utf-8'))
            if parsed_fx.get('es_moneda_extranjera'):
                mon_code = parsed_fx.get('moneda', 'USD')
                tc_val = float(parsed_fx.get('tipo_cambio') or 1.0)
                orig_tot = float(parsed_fx.get('total_moneda_original') or 0.0)
                subtotal = float(parsed_fx.get('subtotal') or subtotal)
                total = float(parsed_fx.get('total') or total)
                iva = float(parsed_fx.get('iva_trasladado') or iva)
                ret_isr = float(parsed_fx.get('retencion_isr') or ret_isr)
                ret_iva = float(parsed_fx.get('retencion_iva') or ret_iva)
                # Actualizar en BD para que todas las vistas y reportes reflejen MXN
                invoice.subtotal = subtotal
                invoice.iva_trasladado = iva
                invoice.retencion_isr = ret_isr
                invoice.retencion_iva = ret_iva
                invoice.total = total
                db.flush()
                fx_note = f" [{mon_code} ${orig_tot:,.2f} × TC ${tc_val:.4f}]"
        except Exception:
            pass

    folio_label = invoice.folio or "S/F"
    short_uuid = invoice.uuid[:8]

    entry_reference = (folio_label or "CFDI")[:150]

    if is_pago_complement:
        # -------------------------------------------------------------
        # TRATAMIENTO CONTABLE DE COMPLEMENTOS DE RECEPCIÓN DE PAGOS
        # Enlace fiscal y de conciliación con bancos (NO duplica ingresos/gastos)
        # -------------------------------------------------------------
        # Rescatar importes reales si total es 0
        if total <= 0:
            raw_to_parse = getattr(invoice, 'raw_xml', None)
            if not raw_to_parse:
                import glob
                for p in glob.glob('C:/Users/MAQRFDCSVDR01/Downloads/*.xml'):
                    try:
                        with open(p, 'rb') as fp:
                            c = fp.read()
                        if invoice.uuid.lower().encode() in c.lower():
                            raw_to_parse = c.decode('utf-8', errors='ignore')
                            invoice.raw_xml = raw_to_parse
                            break
                    except Exception:
                        pass
            if raw_to_parse:
                parsed_xml = parse_cfdi_xml(raw_to_parse.encode('utf-8'))
                if parsed_xml.get('total', 0) > 0:
                    total = float(parsed_xml['total'])
                    subtotal = float(parsed_xml.get('subtotal', 0))
                    iva = float(parsed_xml.get('iva_trasladado', 0))
                    invoice.total = total
                    invoice.subtotal = subtotal
                    invoice.iva_trasladado = iva
                    invoice.related_uuid = parsed_xml.get('related_uuid')
                    invoice.related_folio = parsed_xml.get('related_folio')
                    invoice.tipo_comprobante = parsed_xml.get('tipo_comprobante', 'P')
                    db.commit()

        rel_uuid = getattr(invoice, 'related_uuid', None) or ""
        rel_folio = getattr(invoice, 'related_folio', None) or ""

        # Si aún no tiene IVA desgolsado, buscar en BD la factura original PPD para calcular el IVA proporcional
        if iva == 0 and rel_uuid:
            orig = db.query(CFDIInvoice).filter(
                CFDIInvoice.client_id == invoice.client_id,
                CFDIInvoice.uuid == rel_uuid
            ).first()
            if orig and float(orig.total or 0) > 0 and float(orig.iva_trasladado or 0) > 0:
                prop = total / float(orig.total)
                iva = round(float(orig.iva_trasladado) * prop, 2)
            elif total > 0:
                iva = round(total - (total / 1.16), 2)
        elif iva == 0 and total > 0:
            iva = round(total - (total / 1.16), 2)

        # Resolver cuenta de Bancos o Caja (debe ser estrictamente cuenta de efectivo/banco 101/102)
        bank_acc = None
        if invoice.assigned_account_id:
            candidate = db.query(Account).filter(Account.id == invoice.assigned_account_id).first()
            if candidate and (candidate.account_number.startswith(('101', '102')) or (candidate.sat_group_code and candidate.sat_group_code.startswith(('101', '102')))):
                bank_acc = candidate

        if not bank_acc:
            bank_id = get_default_bank_or_cash_account(db, invoice.client_id, invoice.payment_form)
            bank_acc = db.query(Account).filter(Account.id == bank_id).first() if bank_id else None

        if not bank_acc:
            bank_acc = db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.account_number.like('102-01-%'),
                Account.account_number != '102-01-000',
                Account.is_active == True
            ).first()

        if not bank_acc:
            bank_acc = db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.account_number == '102-01-000'
            ).first()

        if not bank_acc:
            bank_acc = find_account(db, invoice.client_id, '102') or find_account(db, invoice.client_id, '101')
        rel_label = f"Factura {rel_folio} {rel_uuid[:8]}" if rel_folio or rel_uuid else folio_label
        entry_reference = (f"DoctoRel: {rel_uuid}" if rel_uuid else (rel_folio or folio_label))[:150]

        if invoice.cfdi_type == 'emitido':
            # 1. Tratamiento contable de Complementos Emitidos (Cobros a Clientes):
            # - Registra entrada de dinero en bancos.
            # - Disminuye cuenta por cobrar del cliente (105-01-XXX).
            # - Reclasifica IVA no cobrado (209-01-000) a IVA cobrado (208-01-000).
            # - Póliza de Ingreso vinculada a UUID original y UUID complemento.
            entry_type = 'ingreso'
            desc = f"Cobro {rel_label} (Comp. Pago {folio_label}) - {invoice.receiver_name or ''}".strip()
            partner_acc = get_or_create_partner_account(
                db, invoice.client_id, 'cliente', invoice.receiver_rfc, invoice.receiver_name
            )

            # 1. Cargo a Bancos / Caja
            lines_data.append({
                "account_id": bank_acc.id if bank_acc else partner_acc.id,
                "debit": total,
                "credit": 0.0,
                "description": f"Cobro en bancos / Comp. Pago {folio_label} - {invoice.receiver_name or ''}"[:500]
            })

            # 2. Abono a Clientes (disminuye cuenta por cobrar)
            lines_data.append({
                "account_id": partner_acc.id,
                "debit": 0.0,
                "credit": total,
                "description": f"Cobro factura {rel_label}"[:500]
            })

            # 3 y 4. Reclasificación de IVA (209 -> 208)
            if iva > 0:
                acc_209, _ = get_iva_account_for_cfdi(db, invoice.client_id, 'emitido', 'PPD', None)
                acc_208, _ = get_iva_account_for_cfdi(db, invoice.client_id, 'emitido', 'PUE', invoice.payment_form)
                if acc_209 and acc_208:
                    lines_data.append({
                        "account_id": acc_209.id,
                        "debit": iva,
                        "credit": 0.0,
                        "description": f"Cancelación IVA trasladado no cobrado por cobro {rel_label}"[:500]
                    })
                    lines_data.append({
                        "account_id": acc_208.id,
                        "debit": 0.0,
                        "credit": iva,
                        "description": f"IVA efectivamente cobrado / causado para declaración"[:500]
                    })

        else:
            # 2. Tratamiento contable de Complementos Recibidos (Pagos a Proveedores):
            # - Registra salida de dinero en bancos.
            # - Cancela cuenta por pagar del proveedor (201-01-XXX).
            # - Reclasifica IVA pendiente de pago (119-01-000) a IVA acreditable pagado (118-01-000).
            # - Póliza de Egreso vinculada a UUID original y UUID complemento.
            entry_type = 'egreso'
            desc = f"Pago {rel_label} (Comp. Pago {folio_label}) - {invoice.issuer_name or ''}".strip()
            partner_acc = get_or_create_partner_account(
                db, invoice.client_id, 'proveedor', invoice.issuer_rfc, invoice.issuer_name
            )

            # 1. Cargo a Proveedores (cancela cuenta por pagar)
            lines_data.append({
                "account_id": partner_acc.id,
                "debit": total,
                "credit": 0.0,
                "description": f"Liquidación cuenta por pagar {rel_label} - {invoice.issuer_name or ''}"[:500]
            })

            # 2. Abono a Bancos / Caja
            lines_data.append({
                "account_id": bank_acc.id if bank_acc else partner_acc.id,
                "debit": 0.0,
                "credit": total,
                "description": f"Salida de bancos pago {folio_label} a {invoice.issuer_name or ''}"[:500]
            })

            # 3 y 4. Reclasificación de IVA (119 -> 118)
            if iva > 0:
                acc_118, _ = get_iva_account_for_cfdi(db, invoice.client_id, 'recibido', 'PUE', invoice.payment_form)
                acc_119, _ = get_iva_account_for_cfdi(db, invoice.client_id, 'recibido', 'PPD', None)
                if acc_118 and acc_119:
                    lines_data.append({
                        "account_id": acc_118.id,
                        "debit": iva,
                        "credit": 0.0,
                        "description": f"IVA acreditable efectivamente pagado para deducción fiscal"[:500]
                    })
                    lines_data.append({
                        "account_id": acc_119.id,
                        "debit": 0.0,
                        "credit": iva,
                        "description": f"Cancelación IVA pendiente de pago de factura original {rel_label}"[:500]
                    })

    elif is_nomina_cfdi:
        # -------------------------------------------------------------
        # TRATAMIENTO CONTABLE DE CFDI DE NÓMINA (SUELDOS Y SALARIOS)
        # -------------------------------------------------------------
        entry_type = 'egreso' if (invoice.payment_method or '').upper() == 'PUE' else 'diario'
        emp_name = invoice.receiver_name or "Trabajador"
        emp_rfc = invoice.receiver_rfc or ""
        desc = f"Nómina {folio_label} {short_uuid} - {emp_name} ({emp_rfc})".strip()

        nomina_info = {}
        if getattr(invoice, 'raw_xml', None):
            try:
                parsed_nom = parse_cfdi_xml(invoice.raw_xml.encode('utf-8'))
                nomina_info = parsed_nom.get('nomina_data') or {}
            except Exception:
                nomina_info = {}

        total_percepciones = float(nomina_info.get('total_percepciones') or 0.0)
        total_otros_pagos = float(nomina_info.get('total_otros_pagos') or 0.0)
        total_deducciones = float(nomina_info.get('total_deducciones') or 0.0)
        isr_nom = float(nomina_info.get('isr_retenido') or ret_isr or 0.0)
        imss_nom = float(nomina_info.get('imss_retenido') or 0.0)
        infonavit_nom = float(nomina_info.get('infonavit_retenido') or 0.0)
        otras_ded_nom = float(nomina_info.get('otras_deducciones') or 0.0)

        cargo_nomina = round(total_percepciones + total_otros_pagos, 2)
        if cargo_nomina <= 0:
            cargo_nomina = round(subtotal if subtotal > 0 else (total + isr_nom), 2)

        # 1. Cargo a la cuenta de Gasto de Sueldos y Salarios seleccionada (ej. 601-01-000)
        lines_data.append({
            "account_id": invoice.assigned_account_id,
            "debit": cargo_nomina,
            "credit": 0.0,
            "description": f"Sueldos y salarios {folio_label} - {emp_name}"[:500]
        })

        # 2. Abono a ISR Retenido por Sueldos y Salarios (216-01-000 Impuestos retenidos de ISR por sueldos y salarios)
        isr_ret_acc = db.query(Account).filter(
            Account.client_id == invoice.client_id,
            Account.account_number == '216-01-000'
        ).first()
        if not isr_ret_acc:
            isr_ret_acc = db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.sat_group_code == '216.01'
            ).first() or find_account(db, invoice.client_id, '216')
        if isr_ret_acc and (not isr_ret_acc.is_active or isr_ret_acc.classification != 'Afectable'):
            isr_ret_acc.is_active = True
            isr_ret_acc.classification = 'Afectable'
            db.commit()

        if isr_nom > 0 and isr_ret_acc:
            lines_data.append({
                "account_id": isr_ret_acc.id,
                "debit": 0.0,
                "credit": round(isr_nom, 2),
                "description": f"ISR retenido por salarios - {emp_name}"[:500]
            })

        # 3. Abono a Retenciones de IMSS a los trabajadores (216-11-000 Retenciones de IMSS a los trabajadores)
        imss_ret_acc = db.query(Account).filter(
            Account.client_id == invoice.client_id,
            Account.account_number == '216-11-000'
        ).first()
        if not imss_ret_acc:
            imss_ret_acc = db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.sat_group_code == '216.11'
            ).first() or db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.account_number == '211-01-000'
            ).first() or find_account(db, invoice.client_id, '211') or isr_ret_acc
        if imss_ret_acc and (not imss_ret_acc.is_active or imss_ret_acc.classification != 'Afectable'):
            imss_ret_acc.is_active = True
            imss_ret_acc.classification = 'Afectable'
            db.commit()

        resto_deducciones = round(max(0.0, (cargo_nomina - total) - (isr_nom if (isr_nom > 0 and isr_ret_acc) else 0.0)), 2)
        if resto_deducciones > 0.01 and imss_ret_acc:
            ded_desc_parts = []
            if imss_nom > 0:
                ded_desc_parts.append("Cuota obrera IMSS")
            if infonavit_nom > 0:
                ded_desc_parts.append("Infonavit")
            if otras_ded_nom > 0 or not ded_desc_parts:
                ded_desc_parts.append("Otras deducciones nómina")
            lines_data.append({
                "account_id": imss_ret_acc.id,
                "debit": 0.0,
                "credit": resto_deducciones,
                "description": f"{' / '.join(ded_desc_parts)} - {emp_name}"[:500]
            })

        # 4. Abono a 210-01-000 Provisión de sueldos y salarios por pagar por el Neto Pagado al trabajador
        prov_sueldos_acc = db.query(Account).filter(
            Account.client_id == invoice.client_id,
            Account.account_number == '210-01-000'
        ).first()
        if not prov_sueldos_acc:
            prov_sueldos_acc = db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.sat_group_code == '210.01'
            ).first() or find_account(db, invoice.client_id, '210')
        if prov_sueldos_acc and (not prov_sueldos_acc.is_active or prov_sueldos_acc.classification != 'Afectable'):
            prov_sueldos_acc.is_active = True
            prov_sueldos_acc.classification = 'Afectable'
            db.commit()

        lines_data.append({
            "account_id": prov_sueldos_acc.id if prov_sueldos_acc else invoice.assigned_account_id,
            "debit": 0.0,
            "credit": round(total, 2),
            "description": f"Provisión de sueldos y salarios por pagar {folio_label} - {emp_name}"[:500]
        })

        # Guardar mapeo inteligente para este empleado
        save_cfdi_mapping(
            db, invoice.client_id, 'nomina', emp_rfc, invoice.clave_prod_serv or '84111505', invoice.assigned_account_id
        )

    elif invoice.cfdi_type == 'emitido':
        # Emitido: Ventas a Clientes
        partner_acc = get_or_create_partner_account(
            db, invoice.client_id, 'cliente', invoice.receiver_rfc, invoice.receiver_name
        )
        entry_type = 'ingreso' if (invoice.payment_method or '').upper() == 'PUE' else 'diario'
        desc = f"Factura {folio_label} {short_uuid} - {invoice.receiver_name or ''}".strip()

        # 1. Cargo: Cuenta del Cliente (105-01-XXX) por el Total a cobrar
        lines_data.append({
            "account_id": partner_acc.id,
            "debit": total,
            "credit": 0.0,
            "description": f"Cliente {invoice.receiver_name or ''}"[:500]
        })

        # 2. Abono: Cuenta de Ingresos seleccionada por el Subtotal
        lines_data.append({
            "account_id": invoice.assigned_account_id,
            "debit": 0.0,
            "credit": subtotal,
            "description": f"Venta {folio_label} - {invoice.description or ''}"[:500]
        })

        # 3. Abono: IVA Trasladado (209-01-000 si PPD, 208-01-000 si PUE / 01 efectivo)
        if iva > 0:
            iva_acc, iva_desc = get_iva_account_for_cfdi(
                db, invoice.client_id, 'emitido', invoice.payment_method, invoice.payment_form
            )
            if iva_acc:
                lines_data.append({
                    "account_id": iva_acc.id,
                    "debit": 0.0,
                    "credit": iva,
                    "description": iva_desc
                })

        # 3b. Abono: IEPS Trasladado en Ventas (209-02-000 si PPD, 208-02-000 si PUE)
        ieps_emitido_val = 0.0
        if getattr(invoice, 'raw_xml', None):
            try:
                p_xml = parse_cfdi_xml(invoice.raw_xml.encode('utf-8'))
                ieps_emitido_val = float(p_xml.get('ieps_trasladado') or 0.0)
            except Exception:
                pass
        if ieps_emitido_val > 0:
            is_ppd_em = (invoice.payment_method or '').strip().upper() == 'PPD'
            ieps_acc_num = '209-02-000' if is_ppd_em else '208-02-000'
            ieps_sat_code = '209.02' if is_ppd_em else '208.02'
            ieps_em_acc = db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.account_number == ieps_acc_num
            ).first() or db.query(Account).filter(
                Account.client_id == invoice.client_id,
                Account.sat_group_code == ieps_sat_code
            ).first()
            if ieps_em_acc:
                if not ieps_em_acc.is_active or ieps_em_acc.classification != 'Afectable':
                    ieps_em_acc.is_active = True
                    ieps_em_acc.classification = 'Afectable'
                    db.commit()
                lines_data.append({
                    "account_id": ieps_em_acc.id,
                    "debit": 0.0,
                    "credit": round(ieps_emitido_val, 2),
                    "description": f"IEPS Trasladado {'No Cobrado (PPD)' if is_ppd_em else 'Cobrado (PUE)'} {folio_label}"[:500]
                })

        # 4. Si hay retenciones en ventas (ej. RESICO personas físicas con retención 1.25% ISR / IVA retenido):
        if ret_isr > 0:
            isr_acc = find_account(db, invoice.client_id, '109') or find_account(db, invoice.client_id, '113')
            if isr_acc:
                lines_data.append({
                    "account_id": isr_acc.id,
                    "debit": ret_isr,
                    "credit": 0.0,
                    "description": "ISR Retenido a favor"
                })

        if ret_iva > 0:
            ret_iva_acc = find_account(db, invoice.client_id, '109') or find_account(db, invoice.client_id, '113')
            if ret_iva_acc:
                lines_data.append({
                    "account_id": ret_iva_acc.id,
                    "debit": ret_iva,
                    "credit": 0.0,
                    "description": "IVA Retenido a favor"
                })

        # Guardar mapeo inteligente
        save_cfdi_mapping(
            db, invoice.client_id, 'emitido', invoice.receiver_rfc, invoice.clave_prod_serv, invoice.assigned_account_id
        )

    else:
        # Recibido: Gastos y Compras de Proveedores
        partner_acc = get_or_create_partner_account(
            db, invoice.client_id, 'proveedor', invoice.issuer_rfc, invoice.issuer_name
        )
        entry_type = 'egreso' if (invoice.payment_method or '').upper() == 'PUE' else 'diario'
        desc = f"Gasto/Compra {folio_label} {short_uuid} - {invoice.issuer_name or ''}".strip()

        # 1. Cargo: Cuenta de Gasto/Costo seleccionada por el Subtotal
        lines_data.append({
            "account_id": invoice.assigned_account_id,
            "debit": subtotal,
            "credit": 0.0,
            "description": f"Gasto {folio_label} - {invoice.description or ''}"[:500]
        })

        # 2. Cargo: IVA Acreditable (119-01-000 si PPD, 118-01-000 si PUE / 01 efectivo)
        if iva > 0:
            iva_acc, iva_desc = get_iva_account_for_cfdi(
                db, invoice.client_id, 'recibido', invoice.payment_method, invoice.payment_form
            )
            if iva_acc:
                lines_data.append({
                    "account_id": iva_acc.id,
                    "debit": iva,
                    "credit": 0.0,
                    "description": iva_desc
                })

        # 2b. Cargo: IEPS / Impuesto sobre Hotelería / Otros Impuestos y Derechos (Cuenta 601-58-000)
        otros_imp_acc = db.query(Account).filter(
            Account.client_id == invoice.client_id,
            Account.account_number == '601-58-000'
        ).first()
        if not otros_imp_acc:
            otros_imp_acc = find_account(db, invoice.client_id, '601.58')

        ieps_val = 0.0
        locales_val = 0.0
        descuento_val = 0.0
        parsed_xml = {}
        if getattr(invoice, 'raw_xml', None):
            try:
                parsed_xml = parse_cfdi_xml(invoice.raw_xml.encode('utf-8'))
                ieps_val = float(parsed_xml.get('ieps_trasladado') or 0.0)
                locales_val = float(parsed_xml.get('impuestos_locales') or 0.0)
                descuento_val = float(parsed_xml.get('descuento') or 0.0)
            except Exception:
                pass

        if ieps_val > 0 and otros_imp_acc:
            lines_data.append({
                "account_id": otros_imp_acc.id,
                "debit": round(ieps_val, 2),
                "credit": 0.0,
                "description": f"IEPS telecomunicaciones {folio_label}"[:500]
            })

        if locales_val > 0 and otros_imp_acc:
            lines_data.append({
                "account_id": otros_imp_acc.id,
                "debit": round(locales_val, 2),
                "credit": 0.0,
                "description": f"Impuesto sobre hotelería {folio_label}"[:500]
            })

        # Descuentos / Diferencias por descuento otorgado por el proveedor
        current_debit = sum(l['debit'] for l in lines_data)
        expected_payable = round(total + ret_isr + ret_iva, 2)
        diff_discount = round(current_debit - expected_payable, 2)
        if descuento_val <= 0.01 and diff_discount > 0.01:
            descuento_val = diff_discount

        if descuento_val > 0.01:
            uso = (getattr(invoice, 'cfdi_use', '') or parsed_xml.get('receptor', {}).get('uso_cfdi', '') or '').strip().upper()
            is_mercancias = (uso == 'G01' or 'ADQUISICION' in uso or 'MERCANC' in uso)

            if is_mercancias:
                disc_acc = db.query(Account).filter(
                    Account.client_id == invoice.client_id,
                    Account.account_number == '503-01-000'
                ).first()
                if not disc_acc:
                    disc_acc = find_account(db, invoice.client_id, '503.01') or find_account(db, invoice.client_id, '503')
                
                target_disc_acc_id = disc_acc.id if disc_acc else invoice.assigned_account_id
                disc_desc = f"Descuentos sobre compras {folio_label}"
            else:
                # Caso uso Gastos en general (G03) u otros: cuenta de gasto seleccionada en el generador de pólizas
                target_disc_acc_id = invoice.assigned_account_id
                disc_desc = f"Descuento en gasto {folio_label} - {invoice.description or ''}"

            lines_data.append({
                "account_id": target_disc_acc_id,
                "debit": 0.0,
                "credit": round(descuento_val, 2),
                "description": disc_desc[:500]
            })

        # Cuadre de seguridad por otros impuestos si aún existe diferencia entre total y débitos
        current_debit = sum(l['debit'] for l in lines_data)
        current_credit_disc = round(descuento_val, 2)
        expected_debit = round(total + ret_isr + ret_iva + current_credit_disc, 2)
        diff_tax = round(expected_debit - current_debit, 2)
        if diff_tax > 0.01 and otros_imp_acc:
            lines_data.append({
                "account_id": otros_imp_acc.id,
                "debit": diff_tax,
                "credit": 0.0,
                "description": f"Otros impuestos y derechos {folio_label}"[:500]
            })

        # 3. Abono: Cuenta del Proveedor (201-01-XXX) por el Total
        lines_data.append({
            "account_id": partner_acc.id,
            "debit": 0.0,
            "credit": total,
            "description": f"Proveedor {invoice.issuer_name or ''}"[:500]
        })

        # 4. Abono: Retenciones por pagar si existen
        if ret_isr > 0:
            isr_ret_acc = find_account(db, invoice.client_id, '210')
            if isr_ret_acc:
                lines_data.append({
                    "account_id": isr_ret_acc.id,
                    "debit": 0.0,
                    "credit": ret_isr,
                    "description": "ISR Retenido por pagar"
                })

        if ret_iva > 0:
            iva_ret_acc = find_account(db, invoice.client_id, '210')
            if iva_ret_acc:
                lines_data.append({
                    "account_id": iva_ret_acc.id,
                    "debit": 0.0,
                    "credit": ret_iva,
                    "description": "IVA Retenido por pagar"
                })

        # Guardar mapeo inteligente
        save_cfdi_mapping(
            db, invoice.client_id, 'recibido', invoice.issuer_rfc, invoice.clave_prod_serv, invoice.assigned_account_id
        )

    # Validar cuadre exacto de partida doble
    total_debit = round(sum(l['debit'] for l in lines_data), 2)
    total_credit = round(sum(l['credit'] for l in lines_data), 2)
    diff = round(abs(total_debit - total_credit), 2)
    if 0 < diff <= 0.25 and len(lines_data) > 0:
        # Ajuste exacto de centavos (incluyendo redondeo por tipo de cambio) para garantizar partida doble perfecta
        if total_debit > total_credit:
            lines_data[-1]['credit'] = round(lines_data[-1]['credit'] + diff, 2)
        else:
            lines_data[-1]['debit'] = round(lines_data[-1]['debit'] + diff, 2)
    elif diff > 0.25:
        raise ValueError(f"La póliza generada presenta un descuadre de ${diff:.2f} (Debe: ${total_debit:.2f}, Haber: ${total_credit:.2f}).")

    if fx_note and fx_note not in desc:
        desc = f"{desc}{fx_note}"

    # Calcular consecutivo automático según tipo y año
    year = invoice.date.year
    max_num = db.query(func.max(JournalEntry.entry_number)).filter(
        JournalEntry.client_id == invoice.client_id,
        JournalEntry.entry_type == entry_type,
        func.strftime('%Y', JournalEntry.date) == str(year)
    ).scalar()
    entry_number = (max_num or 0) + 1

    entry = JournalEntry(
        client_id=invoice.client_id,
        entry_number=entry_number,
        entry_type=entry_type,
        date=invoice.date.date() if isinstance(invoice.date, datetime) else invoice.date,
        description=desc[:500],
        reference=entry_reference[:150],
        cfdi_uuid=invoice.uuid,
        cfdi_issuer_rfc=invoice.issuer_rfc,
        cfdi_issuer_name=invoice.issuer_name,
        cfdi_receiver_rfc=invoice.receiver_rfc,
        cfdi_total=total,
        is_auto=True,
        is_cancelled=False,
        created_by=current_user_id
    )
    db.add(entry)
    db.flush()

    for idx, l in enumerate(lines_data):
        line = JournalLine(
            entry_id=entry.id,
            account_id=l['account_id'],
            debit=l['debit'],
            credit=l['credit'],
            description=l['description'],
            line_order=idx + 1
        )
        db.add(line)

    invoice.is_posted = True
    invoice.journal_entry_id = entry.id
    db.commit()
    db.refresh(entry)
    return entry

def generate_journal_entry_from_cfdi(cfdi_data: dict, client_id: int, db: Session) -> dict:
    """Compatibilidad con endpoints existentes"""
    tipo = cfdi_data.get('tipo_comprobante', 'I').upper()
    lines = []
    warnings = []
    subtotal = cfdi_data.get('subtotal', 0)
    total = cfdi_data.get('total', 0)
    iva = cfdi_data.get('iva_trasladado', 0)

    if tipo == 'I':
        entry_type = 'ingreso'
        desc = f"Factura {cfdi_data.get('full_folio', '')} {cfdi_data.get('uuid', '')[:8]} - {cfdi_data.get('receptor', {}).get('nombre', '')}"
        partner_acc = get_or_create_partner_account(
            db, client_id, 'cliente', cfdi_data.get('receptor', {}).get('rfc', ''), cfdi_data.get('receptor', {}).get('nombre', '')
        )
        lines.append({"account_id": partner_acc.id, "debit": total, "credit": 0.0, "description": "Cliente"})
        ing_acc = find_account(db, client_id, '401')
        if ing_acc:
            lines.append({"account_id": ing_acc.id, "debit": 0.0, "credit": subtotal, "description": "Venta"})
        if iva > 0:
            iva_acc, iva_desc = get_iva_account_for_cfdi(
                db, client_id, 'emitido', cfdi_data.get('metodo_pago'), cfdi_data.get('forma_pago')
            )
            if iva_acc:
                lines.append({"account_id": iva_acc.id, "debit": 0.0, "credit": iva, "description": iva_desc})
    else:
        entry_type = 'egreso'
        desc = f"Gasto {cfdi_data.get('full_folio', '')} {cfdi_data.get('uuid', '')[:8]} - {cfdi_data.get('emisor', {}).get('nombre', '')}"
        gas_acc = find_account(db, client_id, '601') or find_account(db, client_id, '501')
        if gas_acc:
            lines.append({"account_id": gas_acc.id, "debit": subtotal, "credit": 0.0, "description": "Gasto"})
        if iva > 0:
            iva_acc, iva_desc = get_iva_account_for_cfdi(
                db, client_id, 'recibido', cfdi_data.get('metodo_pago'), cfdi_data.get('forma_pago')
            )
            if iva_acc:
                lines.append({"account_id": iva_acc.id, "debit": iva, "credit": 0.0, "description": iva_desc})
        
        ieps_val = float(cfdi_data.get('ieps_trasladado') or 0.0)
        locales_val = float(cfdi_data.get('impuestos_locales') or 0.0)
        otros_imp_acc = db.query(Account).filter(
            Account.client_id == client_id,
            Account.account_number == '601-58-000'
        ).first() or find_account(db, client_id, '601.58')

        if ieps_val > 0 and otros_imp_acc:
            lines.append({"account_id": otros_imp_acc.id, "debit": ieps_val, "credit": 0.0, "description": "IEPS telecomunicaciones"})
        if locales_val > 0 and otros_imp_acc:
            lines.append({"account_id": otros_imp_acc.id, "debit": locales_val, "credit": 0.0, "description": "Impuesto sobre hotelería"})

        # Descuentos / Diferencias
        descuento_val = float(cfdi_data.get('descuento') or 0.0)
        current_debit = sum(l['debit'] for l in lines)
        diff_disc = round(current_debit - total, 2)
        if descuento_val <= 0.01 and diff_disc > 0.01:
            descuento_val = diff_disc

        if descuento_val > 0.01:
            uso = (cfdi_data.get('receptor', {}).get('uso_cfdi') or '').strip().upper()
            is_mercancias = (uso == 'G01' or 'ADQUISICION' in uso or 'MERCANC' in uso)
            if is_mercancias:
                disc_acc = db.query(Account).filter(Account.client_id == client_id, Account.account_number == '503-01-000').first() or find_account(db, client_id, '503')
                disc_id = disc_acc.id if disc_acc else (gas_acc.id if gas_acc else None)
                disc_label = "Descuentos sobre compras"
            else:
                disc_id = gas_acc.id if gas_acc else None
                disc_label = "Descuento en gasto"
            if disc_id:
                lines.append({"account_id": disc_id, "debit": 0.0, "credit": round(descuento_val, 2), "description": disc_label})

        partner_acc = get_or_create_partner_account(
            db, client_id, 'proveedor', cfdi_data.get('emisor', {}).get('rfc', ''), cfdi_data.get('emisor', {}).get('nombre', '')
        )
        lines.append({"account_id": partner_acc.id, "debit": 0.0, "credit": total, "description": "Proveedor"})

    return {
        "entry_type": entry_type,
        "date": cfdi_data.get('fecha', datetime.now()),
        "description": desc,
        "cfdi_uuid": cfdi_data.get('uuid'),
        "cfdi_issuer_rfc": cfdi_data.get('emisor', {}).get('rfc'),
        "cfdi_issuer_name": cfdi_data.get('emisor', {}).get('nombre'),
        "cfdi_receiver_rfc": cfdi_data.get('receptor', {}).get('rfc'),
        "cfdi_total": total,
        "lines": lines,
        "warnings": warnings
    }
