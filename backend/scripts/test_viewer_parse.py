import sqlite3
from lxml import etree
import math

# Catalogs for descriptions
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

    moneda_txt = 'PESOS' if moneda in ('MXN', 'PESOS', 'MN') else moneda
    return f"{texto_entero} {moneda_txt} CON {centavos:02d}/100 M.N."

print('Test 4999.99:', numero_a_letras(4999.99))
print('Test 423.67:', numero_a_letras(423.67))
