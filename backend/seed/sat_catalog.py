import os
import openpyxl
from sqlalchemy.orm import Session
from models.account import SATAccountGroup

EXCEL_PATHS = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'catalogo_sat.xlsx')),
    r'C:\Users\MAQRFDCSVDR01\OneDrive\Documentos\catalogo_sat.xlsx'
]

def load_official_sat_catalog():
    excel_path = None
    for p in EXCEL_PATHS:
        if os.path.exists(p):
            excel_path = p
            break
            
    if not excel_path:
        return []
        
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))[1:]
    
    items = []
    seen = set()
    for r in rows:
        if not r[0]:
            continue
        raw_code = str(r[0]).strip()
        name = str(r[1]).strip() if r[1] else ''
        
        if '.' in raw_code:
            base, sub = raw_code.split('.')
            seg2 = (sub + '0') if len(sub) == 1 else sub.zfill(2)[:2]
            code = f"{base}.{seg2}"
            level = 2
            parent_code = base
        else:
            code = raw_code
            level = 1 if code in ('100', '200', '300', '400', '500', '600', '700', '800') else 2
            parent_code = None if level == 1 else f"{code[0]}00"
            
        first_digit = code[0]
        type_map = {
            '1': 'activo',
            '2': 'pasivo',
            '3': 'capital',
            '4': 'ingreso',
            '5': 'costo',
            '6': 'gasto',
            '7': 'rif',
            '8': 'orden'
        }
        acc_type = type_map.get(first_digit, 'activo')
        
        if acc_type == 'activo':
            if any(code.startswith(p) for p in ('108', '116', '171', '172', '183', '189')):
                nature = 'acreedora'
            else:
                nature = 'deudora'
        elif acc_type == 'pasivo':
            nature = 'acreedora'
        elif acc_type == 'capital':
            if any(code.startswith(p) for p in ('304.02', '305.02', '306.02')):
                nature = 'deudora'
            else:
                nature = 'acreedora'
        elif acc_type == 'ingreso':
            if code.startswith('402'):
                nature = 'deudora'
            else:
                nature = 'acreedora'
        elif acc_type == 'costo':
            if code.startswith('503'):
                nature = 'acreedora'
            else:
                nature = 'deudora'
        elif acc_type == 'gasto':
            nature = 'deudora'
        elif acc_type == 'rif':
            if code.startswith('701') or code.startswith('703'):
                nature = 'deudora'
            else:
                nature = 'acreedora'
        else:
            nature = 'deudora'
            
        if code in seen:
            continue
        seen.add(code)
        
        items.append({
            "code": code,
            "name": name,
            "level": level,
            "nature": nature,
            "account_type": acc_type,
            "parent_code": parent_code
        })
    return items

def seed_sat_catalog(db: Session):
    existing_count = db.query(SATAccountGroup).count()
    if existing_count < 1000:
        items = load_official_sat_catalog()
        existing = {g.code: g for g in db.query(SATAccountGroup).all()}
        for item in items:
            code = item['code']
            if code in existing:
                g = existing[code]
                g.name = item['name']
                g.level = item['level']
                g.nature = item['nature']
                g.account_type = item['account_type']
                g.parent_code = item['parent_code']
            else:
                db.add(SATAccountGroup(**item))
        db.commit()
