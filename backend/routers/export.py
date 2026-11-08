import io
import os
import re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as OpenpyxlImage
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from datetime import datetime

from models.user import User
from routers.auth import require_role

router = APIRouter(prefix="/api/export", tags=["export"])

LOGO_PATHS = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "assets", "logo.png")),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "logo.png")),
]


def _get_logo_path() -> Optional[str]:
    for p in LOGO_PATHS:
        if os.path.exists(p):
            return p
    return None


class ExcelColumnSpec(BaseModel):
    header: str
    key: str
    width: Optional[int] = 18
    align: Optional[str] = "left"      # 'left', 'right', 'center'
    format: Optional[str] = "text"     # 'text', 'money', 'number', 'percent'


class ExcelSummaryItem(BaseModel):
    label: str
    value: str


class ExcelExportRequest(BaseModel):
    filename: Optional[str] = "Papel_de_Trabajo.xlsx"
    sheet_name: Optional[str] = "Papel de Trabajo"
    title: str
    subtitle: Optional[str] = None
    business_name: Optional[str] = None
    rfc: Optional[str] = None
    period_str: Optional[str] = None
    summary_items: Optional[List[ExcelSummaryItem]] = []
    columns: List[ExcelColumnSpec]
    rows: List[Dict[str, Any]]


@router.post("/xlsx")
def generate_professional_xlsx(
    req: ExcelExportRequest,
    current_user: User = Depends(require_role("admin", "accountant", "client"))
):
    wb = openpyxl.Workbook()
    ws = wb.active
    clean_sheet = re.sub(r'[\\/*?:\[\]]', '', (req.sheet_name or "Reporte"))[:31] or "Reporte"
    ws.title = clean_sheet
    ws.views.sheetView[0].showGridLines = True

    # Paleta corporativa Garcia Salas (Azul Rey)
    navy_header_fill = PatternFill(start_color="005EB8", end_color="005EB8", fill_type="solid")
    sub_header_fill = PatternFill(start_color="004C97", end_color="004C97", fill_type="solid")
    section_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
    subtotal_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    total_fill = PatternFill(start_color="DBEAFE", end_color="DBEAFE", fill_type="solid")
    zebra_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    kpi_label_fill = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")

    font_firm = Font(name="Calibri", size=11, bold=True, color="005EB8")
    font_title = Font(name="Calibri", size=14, bold=True, color="0F172A")
    font_company = Font(name="Calibri", size=11, bold=True, color="334155")
    font_meta = Font(name="Calibri", size=9, italic=True, color="475569")

    font_th = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    font_regular = Font(name="Calibri", size=10, bold=False, color="0F172A")
    font_bold = Font(name="Calibri", size=10, bold=True, color="0F172A")
    font_total = Font(name="Calibri", size=10, bold=True, color="005EB8")

    thin_side = Side(style="thin", color="CBD5E1")
    med_top = Side(style="thin", color="0F172A")
    double_bottom = Side(style="double", color="0F172A")

    border_data = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    border_subtotal = Border(top=med_top, bottom=med_top, left=thin_side, right=thin_side)
    border_total = Border(top=med_top, bottom=double_bottom, left=thin_side, right=thin_side)

    num_cols = max(len(req.columns), 4)

    # Reservar altura en filas 1..4 para el membrete y el logotipo en A1:B4
    ws.row_dimensions[1].height = 19
    ws.row_dimensions[2].height = 20
    ws.row_dimensions[3].height = 18
    ws.row_dimensions[4].height = 18

    start_title_col = 3 if num_cols >= 4 else 2
    end_title_col = num_cols

    ws.cell(row=1, column=start_title_col, value="GARCIA SALAS — ASESORES DE NEGOCIO | PAPEL DE TRABAJO CONTABLE Y FISCAL").font = font_firm
    ws.cell(row=2, column=start_title_col, value=(req.title or "REPORTE FINANCIERO").upper()).font = font_title

    company_line = req.business_name or ""
    if req.rfc:
        company_line = f"{company_line}   (RFC: {req.rfc})" if company_line else f"RFC: {req.rfc}"
    ws.cell(row=3, column=start_title_col, value=company_line).font = font_company

    meta_parts = []
    if req.period_str:
        meta_parts.append(f"Periodo: {req.period_str}")
    if req.subtitle:
        meta_parts.append(req.subtitle)
    meta_parts.append(f"Emitido: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    ws.cell(row=4, column=start_title_col, value="  |  ".join(meta_parts)).font = font_meta

    current_row = 6

    # Bloque de KPIs / Resumen si existe
    if req.summary_items:
        ws.row_dimensions[current_row].height = 18
        ws.row_dimensions[current_row + 1].height = 20
        col_idx = 1
        for item in req.summary_items[:num_cols]:
            c_lbl = ws.cell(row=current_row, column=col_idx, value=item.label)
            c_lbl.font = Font(name="Calibri", size=8, bold=True, color="475569")
            c_lbl.fill = kpi_label_fill
            c_lbl.border = border_data
            c_lbl.alignment = Alignment(horizontal="center", vertical="center")

            c_val = ws.cell(row=current_row + 1, column=col_idx, value=item.value)
            c_val.font = Font(name="Calibri", size=10, bold=True, color="0F172A")
            c_val.fill = kpi_label_fill
            c_val.border = border_data
            c_val.alignment = Alignment(horizontal="center", vertical="center")
            col_idx += 1
        current_row += 3

    # Encabezados de Tabla
    header_row = current_row
    ws.row_dimensions[header_row].height = 25
    for idx, col_spec in enumerate(req.columns, start=1):
        cell = ws.cell(row=header_row, column=idx, value=col_spec.header)
        cell.font = font_th
        cell.fill = navy_header_fill
        cell.alignment = Alignment(
            horizontal=col_spec.align if col_spec.align in ("left", "right", "center") else "center",
            vertical="center",
            wrap_text=True
        )
        cell.border = border_data

    current_row += 1

    # Renglones de Datos
    for r_idx, row_data in enumerate(req.rows):
        ws.row_dimensions[current_row].height = 19
        row_type = row_data.get("_rowType", "normal")  # 'normal', 'section', 'subtotal', 'total'
        is_bold = bool(row_data.get("_bold", False)) or row_type in ("section", "subtotal", "total")

        for c_idx, col_spec in enumerate(req.columns, start=1):
            raw_val = row_data.get(col_spec.key, "")
            cell = ws.cell(row=current_row, column=c_idx)

            # Formatear valor numérico si corresponde
            if col_spec.format in ("money", "currency", "number", "integer", "percent") and raw_val not in (None, "", "-"):
                try:
                    num_val = float(raw_val)
                    cell.value = num_val
                    if col_spec.format in ("money", "currency"):
                        cell.number_format = '$#,##0.00;($#,##0.00);"-"'
                    elif col_spec.format == "percent":
                        cell.number_format = '0.00"%"'
                    elif col_spec.format == "integer":
                        cell.number_format = '#,##0'
                    else:
                        cell.number_format = '#,##0.00'
                except Exception:
                    cell.value = str(raw_val)
            else:
                cell.value = "" if raw_val is None else str(raw_val)

            # Alineación
            align_h = col_spec.align or ("right" if col_spec.format in ("money", "currency", "number", "integer", "percent") else "left")
            cell.alignment = Alignment(horizontal=align_h, vertical="center")

            # Estilo según tipo de fila
            if row_type == "total":
                cell.font = font_total
                cell.fill = total_fill
                cell.border = border_total
            elif row_type == "subtotal":
                cell.font = font_bold
                cell.fill = subtotal_fill
                cell.border = border_subtotal
            elif row_type == "section":
                cell.font = font_bold
                cell.fill = section_fill
                cell.border = border_data
            else:
                cell.font = font_bold if is_bold else font_regular
                if r_idx % 2 == 1:
                    cell.fill = zebra_fill
                cell.border = border_data

        current_row += 1

    # Pie de Papel de Trabajo (Firmas de Elaboración y Revisión)
    current_row += 2
    ws.cell(
        row=current_row,
        column=1,
        value=f"Papel de trabajo generado por: {current_user.full_name or current_user.username} ({current_user.position or 'Despacho Garcia Salas'})"
    ).font = font_meta

    # Ajustar anchos de columna respetando espacio para el logo en A y B
    for idx, col_spec in enumerate(req.columns, start=1):
        col_letter = get_column_letter(idx)
        base_w = col_spec.width or 18
        if idx == 1 and base_w < 16:
            base_w = 16
        ws.column_dimensions[col_letter].width = base_w

    # Configurar márgenes amplios de impresión y numeración de páginas "Página 1 de N"
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.paperSize = ws.PAPERSIZE_LETTER
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.85
    ws.page_margins.right = 0.85
    ws.page_margins.top = 0.90
    ws.page_margins.bottom = 0.90
    ws.page_margins.header = 0.40
    ws.page_margins.footer = 0.40
    ws.oddFooter.left.text = "Garcia Salas — Asesores de Negocio"
    ws.oddFooter.right.text = "Página &P de &N"

    # Insertar logotipo corporativo de forma nativa con openpyxl + Pillow
    logo_path = _get_logo_path()
    if logo_path:
        try:
            xl_logo = OpenpyxlImage(logo_path)
            orig_w = xl_logo.width or 200
            orig_h = xl_logo.height or 100
            target_h = 72
            target_w = int(target_h * (orig_w / orig_h))
            xl_logo.height = target_h
            xl_logo.width = target_w
            ws.add_image(xl_logo, "A1")
        except Exception as e:
            print("Warning adding logo to Excel:", e)

    buf = io.BytesIO()
    wb.save(buf)
    final_bytes = buf.getvalue()

    safe_filename = re.sub(r'[^a-zA-Z0-9_.\-]', '_', req.filename or "Papel_de_Trabajo.xlsx")
    if not safe_filename.lower().endswith(".xlsx"):
        safe_filename += ".xlsx"

    return Response(
        content=final_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"'
        }
    )
