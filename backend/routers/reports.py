from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text, and_, or_
from typing import List, Optional
from datetime import date, datetime
import calendar
from collections import defaultdict

from database import get_db, get_effective_owner_id
from models.journal import JournalEntry, JournalLine
from models.account import Account, SATAccountGroup
from models.client import Client
from models.user import User
from models.cfdi import CFDIInvoice
from models.fixed_asset import FixedAsset
from routers.auth import require_role

router = APIRouter(prefix="/api/reports", tags=["reports"])

@router.get("/trial-balance/{client_id}")
def get_trial_balance(
    client_id: int,
    year: int,
    month: int,
    active_only: Optional[bool] = Query(None),
    only_with_movement: Optional[bool] = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    first_day_of_month = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    last_day_of_month = date(year, month, last_day)

    # 1. Fetch all accounts for this client to build complete tree
    all_accounts = db.query(Account).filter(Account.client_id == client_id).order_by(Account.account_number.asc()).all()

    # 2. Compute direct initial debits/credits before this month
    init_lines = db.query(
        JournalLine.account_id,
        func.sum(JournalLine.debit).label('debit'),
        func.sum(JournalLine.credit).label('credit')
    ).join(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.date < first_day_of_month,
        JournalEntry.is_cancelled == False
    ).group_by(JournalLine.account_id).all()

    direct_init = {row.account_id: {'debit': float(row.debit or 0), 'credit': float(row.credit or 0)} for row in init_lines}

    # 3. Compute direct period movements during this month
    period_lines = db.query(
        JournalLine.account_id,
        func.sum(JournalLine.debit).label('debit'),
        func.sum(JournalLine.credit).label('credit')
    ).join(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.date >= first_day_of_month,
        JournalEntry.date <= last_day_of_month,
        JournalEntry.is_cancelled == False
    ).group_by(JournalLine.account_id).all()

    direct_period = {row.account_id: {'debit': float(row.debit or 0), 'credit': float(row.credit or 0)} for row in period_lines}

    # Filter target accounts based on active_only
    # Note: Structural root accounts (level 1) and any account with direct movements or
    # children with movements must always be included in the trial balance to ensure
    # the trial balance remains balanced (Sumas Iguales cuadran).
    LEVEL_1_CODES = {
        '100-00-000', '200-00-000', '300-00-000', '400-00-000',
        '500-00-000', '600-00-000', '700-00-000', '800-00-000'
    }
    accounts_with_movements = set(direct_init.keys()) | set(direct_period.keys())
    movement_prefixes = set()
    for acc in all_accounts:
        if acc.id in accounts_with_movements:
            parts = (acc.account_number or "").split('-')
            if len(parts) >= 3:
                movement_prefixes.add(f"{parts[0]}-00-000")
                movement_prefixes.add(f"{parts[0]}-{parts[1]}-000")

    target_accounts = [
        a for a in all_accounts
        if (
            not active_only
            or a.is_active
            or a.account_number in LEVEL_1_CODES
            or a.id in accounts_with_movements
            or a.account_number in movement_prefixes
        )
    ]

    result = []
    for account in target_accounts:
        acc_num = account.account_number or ""
        parts = acc_num.split('-') if '-' in acc_num else [acc_num, '00', '000']
        while len(parts) < 3:
            parts.append('000')

        # Determine matching accounts that accumulate into this account
        if account.classification == 'Afectable':
            matching_ids = [account.id]
        else: # Acumulación
            seg1, seg2, seg3 = parts[0], parts[1], parts[2]
            if seg2 != '00' and seg3 == '000':
                # Nivel 2: acumula todas las subcuentas que coinciden con seg1-seg2-
                prefix = f"{seg1}-{seg2}-"
                matching_ids = [a.id for a in all_accounts if a.account_number.startswith(prefix)]
            elif seg2 == '00' and seg3 == '000':
                # Nivel 1: acumula cuentas de mayor
                if seg1 in ('100', '200', '300', '400', '500', '600', '700', '800'):
                    first_digit = seg1[0]
                    matching_ids = [a.id for a in all_accounts if a.account_number.startswith(first_digit)]
                else:
                    prefix = f"{seg1}-"
                    matching_ids = [a.id for a in all_accounts if a.account_number.startswith(prefix)]
            else:
                matching_ids = [a.id for a in all_accounts if a.account_number.startswith(acc_num) or a.parent_id == account.id or a.id == account.id]

            if not matching_ids:
                matching_ids = [account.id]

        tot_init_debit = sum(direct_init.get(aid, {}).get('debit', 0.0) for aid in matching_ids)
        tot_init_credit = sum(direct_init.get(aid, {}).get('credit', 0.0) for aid in matching_ids)
        tot_period_debit = sum(direct_period.get(aid, {}).get('debit', 0.0) for aid in matching_ids)
        tot_period_credit = sum(direct_period.get(aid, {}).get('credit', 0.0) for aid in matching_ids)

        is_deudora = (account.nature or "").lower().startswith('d')

        if is_deudora:
            net_init = tot_init_debit - tot_init_credit
            init_debit_col = max(0.0, net_init)
            init_credit_col = max(0.0, -net_init)
            net_final = net_init + tot_period_debit - tot_period_credit
            final_debit_col = max(0.0, net_final)
            final_credit_col = max(0.0, -net_final)
        else:
            net_init = tot_init_credit - tot_init_debit
            init_debit_col = max(0.0, -net_init)
            init_credit_col = max(0.0, net_init)
            net_final = net_init + tot_period_credit - tot_period_debit
            final_debit_col = max(0.0, -net_final)
            final_credit_col = max(0.0, net_final)

        if (parts[0] in ('100', '200', '300', '400', '500', '600', '700', '800') and parts[1] == '00' and parts[2] == '000') or account.level == 1:
            calc_level = 1
        elif parts[2] == '000':
            calc_level = 2
        else:
            calc_level = 3

        has_movement = (
            round(init_debit_col, 2) != 0 or round(init_credit_col, 2) != 0 or
            round(tot_period_debit, 2) != 0 or round(tot_period_credit, 2) != 0 or
            round(final_debit_col, 2) != 0 or round(final_credit_col, 2) != 0
        )

        if only_with_movement and not has_movement:
            continue

        result.append({
            "id": account.id,
            "account_number": account.account_number,
            "name": account.name,
            "account_name": account.name,
            "sat_code": account.sat_group_code,
            "sat_group_code": account.sat_group_code,
            "level": account.level or calc_level,
            "nature": account.nature,
            "classification": account.classification or ('Acumulación' if calc_level < 3 else 'Afectable'),
            "is_active": account.is_active,
            "initial_debit": round(init_debit_col, 2),
            "initial_credit": round(init_credit_col, 2),
            "movements_debit": round(tot_period_debit, 2),
            "movements_credit": round(tot_period_credit, 2),
            "final_debit": round(final_debit_col, 2),
            "final_credit": round(final_credit_col, 2),
            "initial_balance": round(net_init, 2),
            "debit": round(tot_period_debit, 2),
            "credit": round(tot_period_credit, 2),
            "final_balance": round(net_final, 2)
        })

    return result

@router.get("/income-statement/{client_id}")
def get_income_statement(
    client_id: int,
    year: int = Query(2026),
    month: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="No autorizado para este cliente")

    client = db.query(Client).filter(Client.id == client_id).first()
    business_name = client.business_name if client else "EMPRESA"
    rfc = client.rfc if client else ""

    if date_from and date_to:
        period_start = date_from
        period_end = date_to
        accum_start = date(period_start.year, 1, 1)
        accum_end = period_end
    elif month and 1 <= month <= 12:
        period_start = date(year, month, 1)
        last_day_val = calendar.monthrange(year, month)[1]
        period_end = date(year, month, last_day_val)
        accum_start = date(year, 1, 1)
        accum_end = period_end
    else:
        period_start = date(year, 1, 1)
        period_end = date(year, 12, 31)
        accum_start = date(year, 1, 1)
        accum_end = date(year, 12, 31)

    months_sp = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    period_str = f"del  {period_start.strftime('%d')}/{months_sp[period_start.month]}/{period_start.year}  al  {period_end.strftime('%d')}/{months_sp[period_end.month]}/{period_end.year}"
    today = date.today()
    emission_date_str = f"{today.strftime('%d')}/{months_sp[today.month]}/{today.year}"

    all_accs = db.query(Account).filter(Account.client_id == client_id).all()
    mayor_accs = {a.account_number: a for a in all_accs if a.account_number.endswith('-00-000')}

    lines = db.query(JournalLine, Account, JournalEntry.date).join(Account).join(JournalEntry).filter(
        Account.client_id == client_id,
        JournalEntry.date >= accum_start,
        JournalEntry.date <= accum_end,
        JournalEntry.is_cancelled == False,
        or_(JournalEntry.reference == None, ~JournalEntry.reference.like('CIERRE-%'))
    ).all()

    m_data = {}
    for l, a, ed in lines:
        first = a.account_number[0]
        if first not in ('4', '5', '6', '7'):
            continue
        m_num = a.account_number.split('-')[0] + '-00-000'
        m = mayor_accs.get(m_num, a)
        if m_num not in m_data:
            m_data[m_num] = {
                'code': m_num,
                'name': m.name.upper(),
                'period_deb': 0.0,
                'period_cred': 0.0,
                'accum_deb': 0.0,
                'accum_cred': 0.0
            }
        deb = float(l.debit or 0)
        cred = float(l.credit or 0)
        m_data[m_num]['accum_deb'] += deb
        m_data[m_num]['accum_cred'] += cred
        if ed >= period_start and ed <= period_end:
            m_data[m_num]['period_deb'] += deb
            m_data[m_num]['period_cred'] += cred

    # Calculate net amounts based on account type
    for m_num, d in m_data.items():
        first = m_num[0]
        p_deb, p_cred = d['period_deb'], d['period_cred']
        a_deb, a_cred = d['accum_deb'], d['accum_cred']
        
        if m_num.startswith('402'): # Devoluciones sobre ventas (nature deudora)
            d['period_amount'] = -(p_deb - p_cred)
            d['accum_amount'] = -(a_deb - a_cred)
        elif first == '4' or m_num.startswith('702') or m_num.startswith('704'):
            d['period_amount'] = p_cred - p_deb
            d['accum_amount'] = a_cred - a_deb
        elif m_num.startswith('503'): # Descuentos sobre compras (acreedora)
            d['period_amount'] = -(p_cred - p_deb)
            d['accum_amount'] = -(a_cred - a_deb)
        else: # Costos 5xx, Gastos 6xx, 701, 703
            d['period_amount'] = p_deb - p_cred
            d['accum_amount'] = a_deb - a_cred

    # 1. Ingresos: cuentas que integran directamente este importe
    ing_accs = {}
    for l, a, ed in lines:
        first = a.account_number[0]
        if first == '4' or a.account_number.startswith(('702', '704')):
            key = a.account_number
            if key not in ing_accs:
                ing_accs[key] = {
                    'code': a.account_number,
                    'name': a.name.upper(),
                    'period_deb': 0.0,
                    'period_cred': 0.0,
                    'accum_deb': 0.0,
                    'accum_cred': 0.0
                }
            deb = float(l.debit or 0)
            cred = float(l.credit or 0)
            ing_accs[key]['accum_deb'] += deb
            ing_accs[key]['accum_cred'] += cred
            if ed >= period_start and ed <= period_end:
                ing_accs[key]['period_deb'] += deb
                ing_accs[key]['period_cred'] += cred

    ing_items = []
    tot_ing_period = 0.0
    tot_ing_accum = 0.0
    for k, d in sorted(ing_accs.items()):
        if k.startswith('402'):  # Devoluciones sobre ventas
            p_net = -(d['period_deb'] - d['period_cred'])
            a_net = -(d['accum_deb'] - d['accum_cred'])
        else:
            p_net = d['period_cred'] - d['period_deb']
            a_net = d['accum_cred'] - d['accum_deb']

        if abs(p_net) > 0.001 or abs(a_net) > 0.001:
            ing_items.append({
                'code': d['code'],
                'name': f"{d['code']}  {d['name']}",
                'period': round(p_net, 2),
                'accum': round(a_net, 2)
            })
            tot_ing_period += p_net
            tot_ing_accum += a_net

    tot_ing_period = round(tot_ing_period, 2)
    tot_ing_accum = round(tot_ing_accum, 2)

    # 2. Costos y Gastos: agrupados por cuenta de mayor
    costos_items = []
    tot_costos_period = 0.0
    tot_costos_accum = 0.0

    gastos_items = []
    tot_gastos_period = 0.0
    tot_gastos_accum = 0.0

    for code, d in sorted(m_data.items()):
        if code.startswith('5'):
            if abs(d['period_amount']) > 0.001 or abs(d['accum_amount']) > 0.001:
                costos_items.append({
                    'code': d['code'],
                    'name': f"{d['code']}  {d['name']}",
                    'period': round(d['period_amount'], 2),
                    'accum': round(d['accum_amount'], 2)
                })
                tot_costos_period += d['period_amount']
                tot_costos_accum += d['accum_amount']
        elif (code.startswith('6') and not code.startswith(('607', '611'))) or code.startswith('703'):
            if abs(d['period_amount']) > 0.001 or abs(d['accum_amount']) > 0.001:
                gastos_items.append({
                    'code': d['code'],
                    'name': f"{d['code']}  {d['name']}",
                    'period': round(d['period_amount'], 2),
                    'accum': round(d['accum_amount'], 2)
                })
                tot_gastos_period += d['period_amount']
                tot_gastos_accum += d['accum_amount']

    tot_costos_period = round(tot_costos_period, 2)
    tot_costos_accum = round(tot_costos_accum, 2)

    tot_gastos_period = round(tot_gastos_period, 2)
    tot_gastos_accum = round(tot_gastos_accum, 2)

    def calc_pct(val, base):
        if not base or abs(base) < 0.001:
            return 0.0
        return round((val / base) * 100, 2)

    # Helper para totales de prefijo
    def get_acc_totals(prefix, nature='deudora'):
        tot_p_deb, tot_p_cred = 0.0, 0.0
        tot_a_deb, tot_a_cred = 0.0, 0.0
        for l, a, ed in lines:
            if a.account_number.startswith(prefix):
                deb = float(l.debit or 0)
                cred = float(l.credit or 0)
                tot_a_deb += deb
                tot_a_cred += cred
                if ed >= period_start and ed <= period_end:
                    tot_p_deb += deb
                    tot_p_cred += cred
        if nature == 'deudora':
            p_amt = tot_p_deb - tot_p_cred
            a_amt = tot_a_deb - tot_a_cred
        else: # acreedora (productos financieros)
            p_amt = tot_p_cred - tot_p_deb
            a_amt = tot_a_cred - tot_a_deb
        return round(p_amt, 2), round(a_amt, 2)

    # 3. Resultado Integral de Financiamiento (RIF) en Egresos
    g_fin_p, g_fin_a = get_acc_totals('701', 'deudora')
    p_fin_p, p_fin_a = get_acc_totals('702', 'acreedora')
    rif_net_p = round(g_fin_p - p_fin_p, 2)
    rif_net_a = round(g_fin_a - p_fin_a, 2)

    rif_group = {
        'title': 'RESULTADO INTEGRAL DE FINANCIAMIENTO',
        'gastos_financieros': {
            'code': '701-00-000',
            'name': '701-00-000  GASTOS FINANCIEROS',
            'period': g_fin_p,
            'period_pct': calc_pct(g_fin_p, tot_ing_period),
            'accum': g_fin_a,
            'accum_pct': calc_pct(g_fin_a, tot_ing_accum),
        },
        'productos_financieros': {
            'code': '702-00-000',
            'name': '702-00-000  PRODUCTOS FINANCIEROS',
            'period': p_fin_p,
            'period_pct': calc_pct(p_fin_p, tot_ing_period),
            'accum': p_fin_a,
            'accum_pct': calc_pct(p_fin_a, tot_ing_accum),
        },
        'total': rif_net_p,
        'total_period': rif_net_p,
        'total_period_pct': calc_pct(rif_net_p, tot_ing_period),
        'total_accum': rif_net_a,
        'total_accum_pct': calc_pct(rif_net_a, tot_ing_accum)
    }

    # 4. Impuestos y PTU en Egresos
    ptu_p, ptu_a = get_acc_totals('607', 'deudora')
    isr_p, isr_a = get_acc_totals('611', 'deudora')
    tax_net_p = round(ptu_p + isr_p, 2)
    tax_net_a = round(ptu_a + isr_a, 2)

    tax_group = {
        'title': 'IMPUESTOS Y PTU',
        'ptu': {
            'code': '607-00-000',
            'name': '607-00-000  PARTICIPACION DE LOS TRABAJADORES EN LAS UTILIDADES',
            'period': ptu_p,
            'period_pct': calc_pct(ptu_p, tot_ing_period),
            'accum': ptu_a,
            'accum_pct': calc_pct(ptu_a, tot_ing_accum)
        },
        'isr': {
            'code': '611-00-000',
            'name': '611-00-000  IMPUESTO SOBRE LA RENTA',
            'period': isr_p,
            'period_pct': calc_pct(isr_p, tot_ing_period),
            'accum': isr_a,
            'accum_pct': calc_pct(isr_a, tot_ing_accum)
        },
        'total_period': tax_net_p,
        'total_period_pct': calc_pct(tax_net_p, tot_ing_period),
        'total_accum': tax_net_a,
        'total_accum_pct': calc_pct(tax_net_a, tot_ing_accum)
    }

    tot_egr_period = round(tot_costos_period + tot_gastos_period + rif_net_p + tax_net_p, 2)
    tot_egr_accum = round(tot_costos_accum + tot_gastos_accum + rif_net_a + tax_net_a, 2)

    utilidad_period = round(tot_ing_period - tot_egr_period, 2)
    utilidad_accum = round(tot_ing_accum - tot_egr_accum, 2)

    for it in ing_items:
        it['period_pct'] = calc_pct(it['period'], tot_ing_period)
        it['accum_pct'] = calc_pct(it['accum'], tot_ing_accum)

    for it in costos_items:
        it['period_pct'] = calc_pct(it['period'], tot_ing_period)
        it['accum_pct'] = calc_pct(it['accum'], tot_ing_accum)

    for it in gastos_items:
        it['period_pct'] = calc_pct(it['period'], tot_ing_period)
        it['accum_pct'] = calc_pct(it['accum'], tot_ing_accum)

    ingresos_group = {
        'title': 'Ingresos',
        'items': ing_items,
        'total_period': tot_ing_period,
        'total_period_pct': calc_pct(tot_ing_period, tot_ing_period),
        'total_accum': tot_ing_accum,
        'total_accum_pct': calc_pct(tot_ing_accum, tot_ing_accum)
    }

    return {
        "business_name": business_name,
        "rfc": rfc,
        "period_str": period_str,
        "emission_date": emission_date_str,
        "date_from": period_start.isoformat(),
        "date_to": period_end.isoformat(),
        "ingresos": ingresos_group,
        "total_ingresos": {
            "period": tot_ing_period,
            "period_pct": calc_pct(tot_ing_period, tot_ing_period),
            "accum": tot_ing_accum,
            "accum_pct": calc_pct(tot_ing_accum, tot_ing_accum),
        },
        "costos": {
            "title": "COSTOS",
            "items": costos_items,
            "total_period": tot_costos_period,
            "total_period_pct": calc_pct(tot_costos_period, tot_ing_period),
            "total_accum": tot_costos_accum,
            "total_accum_pct": calc_pct(tot_costos_accum, tot_ing_accum),
        },
        "gastos": {
            "title": "GASTOS",
            "items": gastos_items,
            "total_period": tot_gastos_period,
            "total_period_pct": calc_pct(tot_gastos_period, tot_ing_period),
            "total_accum": tot_gastos_accum,
            "total_accum_pct": calc_pct(tot_gastos_accum, tot_ing_accum),
        },
        "rif": rif_group,
        "impuestos_ptu": tax_group,
        "total_egresos": {
            "period": tot_egr_period,
            "period_pct": calc_pct(tot_egr_period, tot_ing_period),
            "accum": tot_egr_accum,
            "accum_pct": calc_pct(tot_egr_accum, tot_ing_accum),
        },
        "utilidad": {
            "title": "Utilidad (o Pérdida)",
            "period": utilidad_period,
            "period_pct": calc_pct(utilidad_period, tot_ing_period),
            "accum": utilidad_accum,
            "accum_pct": calc_pct(utilidad_accum, tot_ing_accum),
        },
        # Legacy fields for safety
        "period": f"Del {period_start.strftime('%d/%m/%Y')} al {period_end.strftime('%d/%m/%Y')}",
        "costo_ventas": {
            "total": tot_costos_period,
            "items": costos_items
        },
        "utilidad_bruta": round(tot_ing_period - tot_costos_period, 2),
        "gastos_operacion": {
            "total": tot_gastos_period,
            "items": gastos_items
        },
        "utilidad_operacion": round(tot_ing_period - tot_costos_period - tot_gastos_period, 2),
        "utilidad_neta": utilidad_period,
    }

@router.get("/balance-sheet/{client_id}")
def get_balance_sheet(
    client_id: int,
    year: int = Query(...),
    month: int = Query(...),
    level: Optional[str] = Query("mayor"),  # 'mayor' (solo cuentas de mayor) | 'all' (detallado)
    show_zero: Optional[bool] = Query(False),  # Solo cuentas con saldo si False
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    client = db.query(Client).filter(Client.id == client_id).first()
    business_name = client.business_name if client else "EMPRESA"

    last_day_val = calendar.monthrange(year, month)[1]
    last_day_of_month = date(year, month, last_day_val)

    # Catálogo de cuentas del cliente para nombres oficiales de mayor
    all_client_accs = db.query(Account).filter(Account.client_id == client_id).all()
    mayor_accs_map = {
        a.account_number: a 
        for a in all_client_accs 
        if a.account_number.endswith('-00-000') or a.level == 1
    }
    
    # Agrupadores SAT oficiales como respaldo
    sat_groups = db.query(SATAccountGroup).all()
    sat_groups_map = {sg.code: sg.name for sg in sat_groups}

    def get_mayor_info(m_code: str):
        seg1 = m_code.split('-')[0]
        if m_code in mayor_accs_map:
            return m_code, mayor_accs_map[m_code].name.upper()
        if seg1 in sat_groups_map:
            return m_code, sat_groups_map[seg1].upper()
        for a in all_client_accs:
            if a.account_number.startswith(seg1):
                return m_code, a.name.upper()
        return m_code, f"CUENTA {m_code}"

    lines = db.query(JournalLine, Account).join(Account).join(JournalEntry).filter(
        Account.client_id == client_id,
        JournalEntry.date <= last_day_of_month,
        JournalEntry.is_cancelled == False
    ).all()

    activo_circulante = []
    activo_fijo = []
    pasivo_corto = []
    pasivo_largo = []
    capital_items = []

    if level == 'mayor':
        # Agrupación por Cuenta de Mayor (XXX-00-000)
        mayor_totals = {}
        for l, a in lines:
            code = str(a.account_number or a.sat_group_code or "").strip()
            first_digit = code[0] if code else ''
            if first_digit not in ('1', '2', '3'):
                continue

            seg1 = code.split('-')[0] if '-' in code else code[:3]
            m_code = f"{seg1}-00-000"

            if m_code not in mayor_totals:
                _, m_name = get_mayor_info(m_code)
                mayor_totals[m_code] = {
                    "code": m_code,
                    "name": f"{m_code}  {m_name}",
                    "seg1": seg1,
                    "debit": 0.0,
                    "credit": 0.0
                }
            mayor_totals[m_code]["debit"] += float(l.debit or 0)
            mayor_totals[m_code]["credit"] += float(l.credit or 0)

        for m_code in sorted(mayor_totals.keys()):
            item = mayor_totals[m_code]
            seg1 = item["seg1"]
            deb = item["debit"]
            cred = item["credit"]
            first_digit = m_code[0]

            if first_digit == '1':
                net = round(deb - cred, 2)
                if show_zero or abs(net) > 0.001:
                    entry = {
                        "code": item["code"],
                        "name": item["name"],
                        "amount": net
                    }
                    if seg1.isdigit() and int(seg1) >= 120:
                        activo_fijo.append(entry)
                    else:
                        activo_circulante.append(entry)
            elif first_digit == '2':
                net = round(cred - deb, 2)
                if show_zero or abs(net) > 0.001:
                    entry = {
                        "code": item["code"],
                        "name": item["name"],
                        "amount": net
                    }
                    if seg1.isdigit() and int(seg1) >= 217:
                        pasivo_largo.append(entry)
                    else:
                        pasivo_corto.append(entry)
            elif first_digit == '3':
                net = round(cred - deb, 2)
                if show_zero or abs(net) > 0.001:
                    entry = {
                        "code": item["code"],
                        "name": item["name"],
                        "amount": net
                    }
                    capital_items.append(entry)

    else:
        # Modo detallado con subcuentas individuales
        acc_totals = {}
        for l, a in lines:
            if a.id not in acc_totals:
                acc_totals[a.id] = {
                    "account": a,
                    "debit": 0.0,
                    "credit": 0.0
                }
            acc_totals[a.id]["debit"] += float(l.debit or 0)
            acc_totals[a.id]["credit"] += float(l.credit or 0)

        for item in sorted(acc_totals.values(), key=lambda x: x["account"].account_number):
            a = item["account"]
            code = str(a.account_number or a.sat_group_code or "")
            deb = item["debit"]
            cred = item["credit"]

            if code.startswith('1'):
                net = deb - cred
                if show_zero or abs(net) > 0.001:
                    seg1 = code.split('-')[0]
                    entry = {"code": a.account_number, "name": f"{a.account_number}  {a.name}", "amount": round(net, 2)}
                    if seg1.isdigit() and int(seg1) >= 120:
                        activo_fijo.append(entry)
                    else:
                        activo_circulante.append(entry)
            elif code.startswith('2'):
                net = cred - deb
                if show_zero or abs(net) > 0.001:
                    seg1 = code.split('-')[0]
                    entry = {"code": a.account_number, "name": f"{a.account_number}  {a.name}", "amount": round(net, 2)}
                    if seg1.isdigit() and int(seg1) >= 217:
                        pasivo_largo.append(entry)
                    else:
                        pasivo_corto.append(entry)
            elif code.startswith('3'):
                net = cred - deb
                if show_zero or abs(net) > 0.001:
                    capital_items.append({"code": a.account_number, "name": f"{a.account_number}  {a.name}", "amount": round(net, 2)})

    # Calcular resultado del ejercicio (Utilidad o Pérdida neta del año hasta el corte)
    first_day_of_year = date(year, 1, 1)
    is_lines = db.query(JournalLine, Account).join(Account).join(JournalEntry).filter(
        Account.client_id == client_id,
        JournalEntry.date >= first_day_of_year,
        JournalEntry.date <= last_day_of_month,
        JournalEntry.is_cancelled == False
    ).all()

    net_income = 0.0
    for l, a in is_lines:
        code = str(a.account_number or a.sat_group_code or "")
        deb = float(l.debit or 0)
        cred = float(l.credit or 0)
        if code.startswith('4') or code.startswith('7'):
            net_income += (cred - deb)
        elif code.startswith('5') or code.startswith('6'):
            net_income -= (deb - cred)

    net_income = round(net_income, 2)
    if show_zero or abs(net_income) > 0.001:
        res_code = "305-00-000" if level == 'mayor' else "305-01-000"
        capital_items.append({
            "code": res_code,
            "name": f"{res_code}  Resultado del Ejercicio {'(Utilidad)' if net_income >= 0 else '(Pérdida)'}",
            "amount": net_income
        })

    tot_act_circ = round(sum(i["amount"] for i in activo_circulante), 2)
    tot_act_fijo = round(sum(i["amount"] for i in activo_fijo), 2)
    total_activo = round(tot_act_circ + tot_act_fijo, 2)

    tot_pas_corto = round(sum(i["amount"] for i in pasivo_corto), 2)
    tot_pas_largo = round(sum(i["amount"] for i in pasivo_largo), 2)
    total_pasivo = round(tot_pas_corto + tot_pas_largo, 2)

    total_capital = round(sum(i["amount"] for i in capital_items), 2)
    total_pasivo_capital = round(total_pasivo + total_capital, 2)

    is_balanced = abs(total_activo - total_pasivo_capital) < 0.05

    return {
        "business_name": business_name,
        "rfc": client.rfc if client else "",
        "year": year,
        "month": month,
        "level": level,
        "as_of_date": f"{last_day_val} de {last_day_of_month.strftime('%B')} de {year}",
        "activo_circulante": {
            "total": tot_act_circ,
            "items": activo_circulante
        },
        "activo_fijo": {
            "total": tot_act_fijo,
            "items": activo_fijo
        },
        "total_activo": total_activo,
        "pasivo_corto": {
            "total": tot_pas_corto,
            "items": pasivo_corto
        },
        "pasivo_largo": {
            "total": tot_pas_largo,
            "items": pasivo_largo
        },
        "total_pasivo": total_pasivo,
        "capital": {
            "total": total_capital,
            "items": capital_items
        },
        "total_capital": total_capital,
        "total_pasivo_capital": total_pasivo_capital,
        "is_balanced": is_balanced,
        "activos": {"total": total_activo, "detail": activo_circulante + activo_fijo},
        "pasivos": {"total": total_pasivo, "detail": pasivo_corto + pasivo_largo}
    }

@router.get("/account-ledger/{client_id}")
def get_account_ledger(
    client_id: int,
    account_id: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    filter_mode: Optional[str] = Query("with_balance_or_movements"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if date_from is None:
        date_from = date(datetime.now().year, 1, 1)
    if date_to is None:
        date_to = date.today()

    client = db.query(Client).filter(Client.id == client_id).first()
    business_name = client.business_name if client else "Empresa"
    rfc = client.rfc if client else ""

    all_client_accs = db.query(Account).filter(Account.client_id == client_id).order_by(Account.account_number).all()
    if not all_client_accs:
        raise HTTPException(status_code=404, detail="No hay cuentas registradas para este cliente")

    rubros = {'100-00-000', '200-00-000', '300-00-000', '400-00-000', '500-00-000', '600-00-000', '700-00-000', '800-00-000'}

    # 1. Pre-fetch prior balances lines in one query
    prior_lines = db.query(JournalLine.account_id, JournalLine.debit, JournalLine.credit).join(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.date < date_from,
        JournalEntry.is_cancelled == False
    ).all()
    prior_by_acc = defaultdict(list)
    for l in prior_lines:
        prior_by_acc[l.account_id].append(l)

    # 2. Pre-fetch period movements in one query
    period_lines = db.query(
        JournalLine.id, JournalLine.account_id, JournalLine.debit, JournalLine.credit, JournalLine.description,
        JournalEntry.id.label('entry_id'), JournalEntry.date, JournalEntry.entry_number, JournalEntry.entry_type,
        JournalEntry.reference, JournalEntry.cfdi_uuid, JournalEntry.description.label('entry_desc')
    ).join(JournalEntry).filter(
        JournalEntry.client_id == client_id,
        JournalEntry.date >= date_from,
        JournalEntry.date <= date_to,
        JournalEntry.is_cancelled == False
    ).order_by(JournalEntry.date, JournalEntry.entry_number, JournalLine.id).all()

    period_by_acc = defaultdict(list)
    active_acc_ids = set()
    for l in period_lines:
        period_by_acc[l.account_id].append(l)
        active_acc_ids.add(l.account_id)

    # Helper to get leaf/afectable subaccounts under a mayor account
    def get_leaf_subaccounts(mayor_acc):
        prefix = mayor_acc.account_number.split('-')[0] + '-'
        all_children = [a for a in all_client_accs if a.account_number.startswith(prefix) and a.id != mayor_acc.id]
        if not all_children:
            return [mayor_acc]
        parent_ids = {a.parent_id for a in all_children if a.parent_id is not None}
        leaves = [a for a in all_children if a.classification == 'Afectable' or a.id in active_acc_ids or a.id not in parent_ids]
        if not leaves:
            leaves = all_children
        if mayor_acc.id in active_acc_ids and mayor_acc not in leaves:
            leaves.insert(0, mayor_acc)
        return leaves

    target_single_acc = None
    if account_id and account_id not in ('all', '', 'null', 'None'):
        try:
            target_id = int(account_id)
            target_single_acc = db.query(Account).filter(Account.id == target_id, Account.client_id == client_id).first()
        except ValueError:
            target_single_acc = next((a for a in all_client_accs if a.account_number == account_id), None)

    if target_single_acc:
        if target_single_acc.account_number in rubros:
            first_digit = target_single_acc.account_number[0]
            mayores = [a for a in all_client_accs if a.account_number.startswith(first_digit) and a.account_number.endswith('-00-000') and a.account_number not in rubros]
            is_specific_sub = False
        elif target_single_acc.account_number.endswith('-00-000'):
            mayores = [target_single_acc]
            is_specific_sub = False
        else:
            m_code = target_single_acc.account_number.split('-')[0] + '-00-000'
            parent_m = next((a for a in all_client_accs if a.account_number == m_code), target_single_acc)
            mayores = [parent_m]
            is_specific_sub = True
    else:
        mayores = [a for a in all_client_accs if a.account_number.endswith('-00-000') and a.account_number not in rubros]
        is_specific_sub = False

    results = []
    for m in mayores:
        if target_single_acc and is_specific_sub:
            leaves = [target_single_acc]
        else:
            leaves = get_leaf_subaccounts(m)

        subaccounts = []
        for sub in leaves:
            is_d = (sub.nature or m.nature or '').lower().startswith('d')
            p_lines = prior_by_acc.get(sub.id, [])
            init_deb = sum(float(l.debit or 0) for l in p_lines)
            init_cred = sum(float(l.credit or 0) for l in p_lines)
            sub_init = (init_deb - init_cred) if is_d else (init_cred - init_deb)

            m_lines = period_by_acc.get(sub.id, [])
            running = sub_init
            movs = []
            for l in m_lines:
                deb = float(l.debit or 0)
                cred = float(l.credit or 0)
                row_init = running
                if is_d:
                    running += (deb - cred)
                else:
                    running += (cred - deb)
                row_final = running

                e_type = (l.entry_type or 'Diario').capitalize()
                if e_type.lower() == 'ingreso': e_type = 'Ingresos'
                elif e_type.lower() == 'egreso': e_type = 'Egresos'

                movs.append({
                    'id': l.id,
                    'date': l.date.isoformat() if hasattr(l.date, 'isoformat') else str(l.date),
                    'entry_id': l.entry_id,
                    'entry_number': l.entry_number,
                    'entry_type': e_type,
                    'reference': l.reference or (l.cfdi_uuid[:8] if l.cfdi_uuid else ''),
                    'cfdi_uuid': l.cfdi_uuid or '',
                    'account_number': sub.account_number,
                    'account_name': sub.name,
                    'description': l.description or l.entry_desc or 'Sin concepto',
                    'debit': round(deb, 2),
                    'credit': round(cred, 2),
                    'initial_balance': round(row_init, 2),
                    'final_balance': round(row_final, 2),
                    'running_balance': round(row_final, 2)
                })

            tot_deb = round(sum(m['debit'] for m in movs), 2)
            tot_cred = round(sum(m['credit'] for m in movs), 2)
            sub_final = round(running, 2)

            has_movements = len(movs) > 0 or tot_deb > 0.001 or tot_cred > 0.001
            has_balance = abs(sub_init) > 0.001 or abs(sub_final) > 0.001
            has_activity = has_movements or has_balance

            inc_sub = False
            if filter_mode == 'all':
                inc_sub = True
            elif filter_mode == 'with_movements_only':
                inc_sub = has_movements
            else: # with_balance_or_movements
                inc_sub = has_activity

            if inc_sub:
                subaccounts.append({
                    'id': sub.id,
                    'account_number': sub.account_number,
                    'account_name': sub.name,
                    'nature': sub.nature,
                    'classification': sub.classification or 'Afectable',
                    'initial_balance': round(sub_init, 2),
                    'total_debit': tot_deb,
                    'total_credit': tot_cred,
                    'final_balance': sub_final,
                    'movements': movs,
                    'movements_count': len(movs)
                })

        is_main_d = (m.nature or '').lower().startswith('d')
        m_init = round(sum(s['initial_balance'] for s in subaccounts), 2)
        m_deb = round(sum(s['total_debit'] for s in subaccounts), 2)
        m_cred = round(sum(s['total_credit'] for s in subaccounts), 2)
        m_fin = round((m_init + m_deb - m_cred) if is_main_d else (m_init - m_deb + m_cred), 2)

        inc_m = False
        if filter_mode == 'all':
            inc_m = True
        elif filter_mode == 'with_movements_only':
            inc_m = any(len(s['movements']) > 0 for s in subaccounts)
        else: # with_balance_or_movements
            inc_m = len(subaccounts) > 0 or abs(m_init) > 0.001 or m_deb > 0 or m_cred > 0 or abs(m_fin) > 0.001

        if inc_m:
            results.append({
                'id': m.id,
                'account_id': m.id,
                'account_number': m.account_number,
                'account_name': m.name,
                'nature': m.nature,
                'level': m.level,
                'classification': m.classification or 'Acumulación',
                'initial_balance': m_init,
                'total_debit': m_deb,
                'total_credit': m_cred,
                'final_balance': m_fin,
                'subaccounts': subaccounts,
                'subaccounts_count': len(subaccounts),
                'subaccounts_summary': subaccounts,
                'subaccounts_detail': subaccounts,
                'movements': [mov for sub in subaccounts for mov in sub['movements']]
            })

    grand_total = {
        'initial_balance': round(sum(m['initial_balance'] for m in results), 2),
        'total_debit': round(sum(m['total_debit'] for m in results), 2),
        'total_credit': round(sum(m['total_credit'] for m in results), 2),
        'final_balance': round(sum(m['final_balance'] for m in results), 2)
    }

    first_res = results[0] if results else None

    return {
        'business_name': business_name,
        'rfc': rfc,
        'currency': 'Peso Mexicano',
        'date_from': date_from.isoformat() if hasattr(date_from, 'isoformat') else str(date_from),
        'date_to': date_to.isoformat() if hasattr(date_to, 'isoformat') else str(date_to),
        'filter_mode': filter_mode,
        'emission_date': date.today().isoformat(),
        'is_all': (target_single_acc is None),
        'accounts_count': len(results),
        'accounts': results,
        'grand_total': grand_total,
        # Backward compatibility fields if a single account was requested:
        'account_id': first_res['id'] if first_res else None,
        'account_number': first_res['account_number'] if first_res else None,
        'account_name': first_res['account_name'] if first_res else None,
        'initial_balance': first_res['initial_balance'] if first_res else 0.0,
        'total_debit': first_res['total_debit'] if first_res else 0.0,
        'total_credit': first_res['total_credit'] if first_res else 0.0,
        'final_balance': first_res['final_balance'] if first_res else 0.0,
        'subaccounts_count': first_res['subaccounts_count'] if first_res else 0,
        'subaccounts_summary': first_res['subaccounts_summary'] if first_res else [],
        'subaccounts_detail': first_res['subaccounts_detail'] if first_res else [],
        'movements': first_res['movements'] if first_res else []
    }


def _evaluate_client_obligations(db: Session, client_id: int, year: int, month: int) -> dict:
    """
    Evalúa el Semáforo de Obligaciones Contables y Fiscales de un cliente en un periodo (año/mes):
    1. Balanza cuadrada
    2. IVA traspasado
    3. Depreciación aplicada
    4. DIOT generada / lista
    """
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])

    # 1. Balanza cuadrada (cargos == abonos del periodo y acumulado)
    period_totals = (
        db.query(
            func.sum(JournalLine.debit).label("deb"),
            func.sum(JournalLine.credit).label("cred"),
            func.count(func.distinct(JournalEntry.id)).label("entries_cnt"),
        )
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False,
        )
        .first()
    )
    p_deb = float(period_totals.deb or 0.0) if period_totals else 0.0
    p_cred = float(period_totals.cred or 0.0) if period_totals else 0.0
    entries_cnt = int(period_totals.entries_cnt or 0) if period_totals else 0
    diff_balanza = round(abs(p_deb - p_cred), 2)

    if entries_cnt == 0:
        balanza_status = "pendiente"
        balanza_label = "Sin movimientos en el mes"
    elif diff_balanza <= 0.02:
        balanza_status = "cumplido"
        balanza_label = f"Cuadrada ({entries_cnt} pólizas)"
    else:
        balanza_status = "alerta"
        balanza_label = f"Diferencia ${diff_balanza:,.2f}"

    # 2. IVA traspasado
    traspaso_entry = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False,
            or_(
                JournalEntry.description.ilike("%Traspasos de IVA%"),
                JournalEntry.description.ilike("%Traspaso de IVA%"),
                JournalEntry.reference.ilike("%TRASPASO-IVA%"),
            ),
        )
        .first()
    )
    iva_movs_cnt = (
        db.query(func.count(JournalLine.id))
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .join(Account, JournalLine.account_id == Account.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False,
            or_(
                Account.account_number.startswith("118-01"),
                Account.account_number.startswith("208-01"),
            ),
        )
        .scalar()
        or 0
    )
    if traspaso_entry:
        iva_status = "cumplido"
        iva_label = f"Traspasado (Póliza #{traspaso_entry.entry_number})"
    elif iva_movs_cnt > 0:
        iva_status = "pendiente"
        iva_label = "Pendiente de traspaso"
    else:
        iva_status = "cumplido" if entries_cnt > 0 else "pendiente"
        iva_label = "Sin saldo IVA pendiente" if entries_cnt > 0 else "Sin movimientos"

    # 3. Depreciación aplicada
    active_assets_cnt = (
        db.query(func.count(FixedAsset.id))
        .filter(FixedAsset.client_id == client_id, FixedAsset.is_active == True)
        .scalar()
        or 0
    )
    depr_entry = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= first_day,
            JournalEntry.date <= last_day,
            JournalEntry.is_cancelled == False,
            or_(
                JournalEntry.description.ilike("%Depreciaci%"),
                JournalEntry.reference.ilike("%DEPRECIAC%"),
            ),
        )
        .first()
    )
    if depr_entry:
        depr_status = "cumplido"
        depr_label = f"Aplicada (Póliza #{depr_entry.entry_number})"
    elif active_assets_cnt > 0:
        depr_status = "pendiente"
        depr_label = f"Pendiente ({active_assets_cnt} activos)"
    else:
        depr_status = "cumplido"
        depr_label = "Sin activos sujetos a depr."

    # 4. DIOT generada / lista (CFDIs recibidos del mes contabilizados + movimientos 118-01)
    dt_start = datetime(year, month, 1, 0, 0, 0)
    dt_end = datetime(year, month, calendar.monthrange(year, month)[1], 23, 59, 59)
    unposted_recibidos = (
        db.query(func.count(CFDIInvoice.id))
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.cfdi_type == "recibido",
            CFDIInvoice.date >= dt_start,
            CFDIInvoice.date <= dt_end,
            or_(CFDIInvoice.is_posted == False, CFDIInvoice.journal_entry_id == None),
        )
        .scalar()
        or 0
    )
    if unposted_recibidos > 0:
        diot_status = "pendiente"
        diot_label = f"{unposted_recibidos} CFDI(s) recibidos sin póliza"
    elif iva_movs_cnt > 0 or entries_cnt > 0:
        diot_status = "cumplido"
        diot_label = "Lista para exportar TXT"
    else:
        diot_status = "pendiente"
        diot_label = "Sin operaciones registradas"

    return {
        "balanza_cuadrada": {"status": balanza_status, "label": balanza_label, "diff": diff_balanza},
        "iva_traspasado": {"status": iva_status, "label": iva_label},
        "depreciacion_aplicada": {
            "status": depr_status,
            "label": depr_label,
            "active_assets": active_assets_cnt,
        },
        "diot_generada": {
            "status": diot_status,
            "label": diot_label,
            "unposted_recibidos": unposted_recibidos,
        },
    }


@router.get("/executive-dashboard/{client_id}")
def get_executive_dashboard(
    client_id: int,
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant", "client")),
):
    """
    Centro de Control Ejecutivo 100% en Tiempo Real para Dashboard.jsx y ClientPortal.jsx:
    1. Indicadores Financieros Reales del Cliente Seleccionado:
       - Ingresos del mes vs Egresos del mes
       - Utilidad Neta acumulada del ejercicio
       - Saldo en Bancos (102), Cuentas por Cobrar (105), Cuentas por Pagar (201)
       - CFDIs sin contabilizar y Complementos de Pago pendientes
    2. Serie mensual comparativa de los 12 meses del año (Ingresos vs Costos y Gastos).
    3. Semáforo de obligaciones del cliente activo y de la cartera del despacho.
    """
    if current_user.role == "client" and current_user.client_id != client_id:
        raise HTTPException(status_code=403, detail="No autorizado para consultar este cliente")

    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    # Si no se envía año/mes, detectar automáticamente el último periodo con pólizas o usar fecha actual
    latest_entry = (
        db.query(JournalEntry)
        .filter(JournalEntry.client_id == client_id, JournalEntry.is_cancelled == False)
        .order_by(JournalEntry.date.desc())
        .first()
    )
    today = date.today()
    eff_year = year if year else (latest_entry.date.year if latest_entry and latest_entry.date else today.year)
    eff_month = month if (month and 1 <= month <= 12) else (latest_entry.date.month if latest_entry and latest_entry.date else today.month)

    first_day_month = date(eff_year, eff_month, 1)
    last_day_month = date(eff_year, eff_month, calendar.monthrange(eff_year, eff_month)[1])
    year_start = date(eff_year, 1, 1)
    year_end = date(eff_year, 12, 31)

    # 1. Consultar todas las líneas contables hasta el cierre del mes seleccionado para saldos de Balance (102, 105, 201)
    balance_lines = (
        db.query(
            Account.account_number,
            Account.name,
            Account.nature,
            func.sum(JournalLine.debit).label("deb"),
            func.sum(JournalLine.credit).label("cred"),
        )
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .join(Account, JournalLine.account_id == Account.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date <= last_day_month,
            JournalEntry.is_cancelled == False,
            or_(
                Account.account_number.startswith("102"),
                Account.account_number.startswith("105"),
                Account.account_number.startswith("201"),
            ),
        )
        .group_by(Account.id, Account.account_number, Account.name, Account.nature)
        .all()
    )

    saldo_bancos_102 = 0.0
    cuentas_por_cobrar_105 = 0.0
    cuentas_por_pagar_201 = 0.0

    for acc_num, acc_name, acc_nat, deb_val, cred_val in balance_lines:
        num = acc_num or ""
        d = float(deb_val or 0.0)
        c = float(cred_val or 0.0)
        if num.startswith("102"):
            saldo_bancos_102 += (d - c)
        elif num.startswith("105"):
            cuentas_por_cobrar_105 += (d - c)
        elif num.startswith("201"):
            cuentas_por_pagar_201 += (c - d)

    # 2. Movimientos de Resultados (cuentas 4xx, 5xx, 6xx, 7xx) durante todo el año para KPIs y gráfica de 12 meses
    result_lines = (
        db.query(
            Account.account_number,
            JournalEntry.date,
            JournalLine.debit,
            JournalLine.credit,
        )
        .join(JournalEntry, JournalLine.entry_id == JournalEntry.id)
        .join(Account, JournalLine.account_id == Account.id)
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= year_start,
            JournalEntry.date <= year_end,
            JournalEntry.is_cancelled == False,
            or_(JournalEntry.reference == None, ~JournalEntry.reference.like("CIERRE-%")),
        )
        .all()
    )

    months_labels = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    monthly_buckets = {
        m_idx: {"ingresos": 0.0, "costos": 0.0, "gastos": 0.0}
        for m_idx in range(1, 13)
    }

    for acc_num, e_date, deb_val, cred_val in result_lines:
        if not acc_num or not e_date:
            continue
        first_digit = acc_num[0]
        if first_digit not in ("4", "5", "6", "7"):
            continue
        m_idx = e_date.month
        d = float(deb_val or 0.0)
        c = float(cred_val or 0.0)

        if acc_num.startswith("402"):
            monthly_buckets[m_idx]["ingresos"] += -(d - c)
        elif first_digit == "4" or acc_num.startswith(("702", "704")):
            monthly_buckets[m_idx]["ingresos"] += (c - d)
        elif acc_num.startswith("503"):
            monthly_buckets[m_idx]["costos"] += -(c - d)
        elif first_digit == "5":
            monthly_buckets[m_idx]["costos"] += (d - c)
        elif first_digit == "6" or acc_num.startswith(("701", "703")):
            monthly_buckets[m_idx]["gastos"] += (d - c)

    # Conteo de pólizas por mes en el año
    entries_by_month_rows = (
        db.query(
            func.strftime("%m", JournalEntry.date).label("m_str"),
            func.count(JournalEntry.id).label("cnt"),
        )
        .filter(
            JournalEntry.client_id == client_id,
            JournalEntry.date >= year_start,
            JournalEntry.date <= year_end,
            JournalEntry.is_cancelled == False,
        )
        .group_by("m_str")
        .all()
    )
    entries_by_month = {int(r.m_str): int(r.cnt or 0) for r in entries_by_month_rows if r.m_str}

    monthly_series = []
    ingresos_acumulados = 0.0
    egresos_acumulados = 0.0

    for m_idx in range(1, 13):
        ing = round(monthly_buckets[m_idx]["ingresos"], 2)
        cos = round(monthly_buckets[m_idx]["costos"], 2)
        gas = round(monthly_buckets[m_idx]["gastos"], 2)
        egr = round(cos + gas, 2)
        uti = round(ing - egr, 2)

        if m_idx <= eff_month:
            ingresos_acumulados += ing
            egresos_acumulados += egr

        monthly_series.append({
            "month": m_idx,
            "label": months_labels[m_idx - 1],
            "ingresos": ing,
            "costos": cos,
            "gastos": gas,
            "egresos": egr,
            "utilidad": uti,
            "polizas_count": entries_by_month.get(m_idx, 0),
        })

    current_m = monthly_series[eff_month - 1]
    ingresos_mes = current_m["ingresos"]
    costos_mes = current_m["costos"]
    gastos_mes = current_m["gastos"]
    egresos_mes = current_m["egresos"]
    utilidad_mes = current_m["utilidad"]
    utilidad_neta_acumulada = round(ingresos_acumulados - egresos_acumulados, 2)

    # 3. CFDIs sin contabilizar y Complementos de Pago pendientes
    unposted_cfdis = (
        db.query(CFDIInvoice)
        .filter(
            CFDIInvoice.client_id == client_id,
            or_(CFDIInvoice.is_posted == False, CFDIInvoice.journal_entry_id == None),
        )
        .all()
    )
    cfdis_sin_contabilizar_count = len(unposted_cfdis)
    cfdis_sin_contabilizar_total = round(sum(float(c.total or 0.0) for c in unposted_cfdis), 2)

    # Complementos de pago pendientes: Facturas PPD sin CFDI tipo 'P' relacionado + CFDIs tipo 'P' sin contabilizar
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
        .filter(
            CFDIInvoice.client_id == client_id,
            CFDIInvoice.tipo_comprobante == "P",
        )
        .all()
    )
    covered_ppd_uuids = {
        (p.related_uuid or "").strip().upper()
        for p in payment_complements
        if p.related_uuid
    }
    ppd_without_complement = [
        inv for inv in ppd_invoices if (inv.uuid or "").strip().upper() not in covered_ppd_uuids
    ]
    unposted_complements = [
        p for p in payment_complements if not p.is_posted or p.journal_entry_id is None
    ]
    complementos_pendientes_count = len(ppd_without_complement) + len(unposted_complements)
    complementos_pendientes_monto = round(
        sum(float(inv.total or 0.0) for inv in ppd_without_complement)
        + sum(float(p.total or 0.0) for p in unposted_complements),
        2,
    )

    total_journals_year = sum(entries_by_month.values())
    journals_month = entries_by_month.get(eff_month, 0)

    obligations = _evaluate_client_obligations(db, client_id, eff_year, eff_month)

    months_full_sp = [
        "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]

    return {
        "client": {
            "id": client.id,
            "rfc": client.rfc,
            "business_name": client.business_name,
            "tax_regime": client.tax_regime or "",
        },
        "period": {
            "year": eff_year,
            "month": eff_month,
            "month_name": months_full_sp[eff_month],
            "label": f"{months_full_sp[eff_month]} {eff_year}",
        },
        "kpis": {
            "ingresos_mes": ingresos_mes,
            "costos_mes": costos_mes,
            "gastos_mes": gastos_mes,
            "egresos_mes": egresos_mes,
            "utilidad_mes": utilidad_mes,
            "ingresos_acumulados": round(ingresos_acumulados, 2),
            "egresos_acumulados": round(egresos_acumulados, 2),
            "utilidad_neta_acumulada": utilidad_neta_acumulada,
            "saldo_bancos_102": round(saldo_bancos_102, 2),
            "cuentas_por_cobrar_105": round(cuentas_por_cobrar_105, 2),
            "cuentas_por_pagar_201": round(cuentas_por_pagar_201, 2),
            "cfdis_sin_contabilizar_count": cfdis_sin_contabilizar_count,
            "cfdis_sin_contabilizar_total": cfdis_sin_contabilizar_total,
            "complementos_pendientes_count": complementos_pendientes_count,
            "complementos_pendientes_monto": complementos_pendientes_monto,
            "ppd_sin_complemento_count": len(ppd_without_complement),
            "complementos_sin_poliza_count": len(unposted_complements),
            "polizas_mes": journals_month,
            "polizas_anio": total_journals_year,
        },
        "monthly_series": monthly_series,
        "obligations": obligations,
    }


@router.get("/executive-portfolio-obligations")
def get_executive_portfolio_obligations(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "accountant")),
):
    """
    Devuelve el Semáforo de Obligaciones para todos los clientes activos del despacho/auxiliar.
    """
    owner_id = get_effective_owner_id(db, current_user)
    clients_q = db.query(Client).filter(Client.is_active == True, Client.owner_user_id == owner_id).order_by(Client.id.asc()).all()
    if current_user.role != "admin":
        allowed = set(current_user.assigned_client_ids or [])
        clients_q = [c for c in clients_q if c.id in allowed]

    today = date.today()
    items = []
    for c in clients_q:
        latest_e = (
            db.query(JournalEntry)
            .filter(JournalEntry.client_id == c.id, JournalEntry.is_cancelled == False)
            .order_by(JournalEntry.date.desc())
            .first()
        )
        eff_y = year if year else (latest_e.date.year if latest_e and latest_e.date else today.year)
        eff_m = month if (month and 1 <= month <= 12) else (latest_e.date.month if latest_e and latest_e.date else today.month)
        ob = _evaluate_client_obligations(db, c.id, eff_y, eff_m)
        items.append({
            "client_id": c.id,
            "rfc": c.rfc,
            "business_name": c.business_name,
            "tax_regime": c.tax_regime or "",
            "year": eff_y,
            "month": eff_m,
            "obligations": ob,
        })
    return {"items": items}

