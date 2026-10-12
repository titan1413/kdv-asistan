from fastapi import Request, File, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
import os
import shutil
from typing import List
import uuid
from datetime import datetime
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd

from modules.kdv_utils import UPLOAD_DIR, EXCEL_DIR
from logger import log_error, log_info

# Template engine (lazy initialization to avoid conflict with main.py)
_templates = None

def get_templates():
    global _templates
    if _templates is None:
        _templates = Jinja2Templates(directory="templates")
    return _templates
try:
    from xml_engine import parse_gib_xml
except ImportError as e:
    log_error(f"xml_engine modülü yüklenemedi: {e}")
    # Fallback for testing
    def parse_gib_xml(xml_path):
        return [{"vkn": "1234567890", "unvan": "Test Firma", "tarih": "01.01.2025", "no": "TEST001", "cins": "Test Ürün", "miktar": "1", "matrah": "100.00", "kdv": "18.00", "tevkifat": "0.00"}]

# Session storage for user data (Redis-based with fallback)
from session_manager import session_manager

def get_indirilecek_kdv_page(request: Request):
    """Indirilecek KDV listesi olusturma sayfasi"""
    from fastapi.responses import FileResponse
    return FileResponse("templates/indirilecek_kdv_page.html")

async def upload_xml_files(files: List[UploadFile] = File(...), user_id: str = ""):
    """XML dosyalarünü yükler ve isler"""
    try:
        session_id = str(uuid.uuid4())
        session_data = {
            "session_id": session_id,
            "owner_user_id": user_id,
            "uploaded_files": [],
            "processed_data": [],
            "xml_total": 0,
            "xml_processed": 0,
            "xml_skipped": 0,
            "xml_errors": 0,
            "created_at": datetime.now().isoformat(),
            "download_limits": {
                "standart": {"birlestir": 1, "ayrik": 1},
                "gib_sartli": {"birlestir": 1, "ayrik": 1}
            }
        }

        # First, save all uploaded files
        xml_paths = []
        for file in files:
            if not file.filename.endswith('.xml'):
                continue

            session_data["xml_total"] += 1

            # Save uploaded file
            safe_name = Path(file.filename).name
            file_path = UPLOAD_DIR / f"{session_id}_{safe_name}"
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            session_data["uploaded_files"].append({
                "filename": file.filename
            })
            xml_paths.append(str(file_path))

        # Process XML files in parallel
        def process_single_xml(xml_path):
            try:
                result = parse_gib_xml(xml_path)
                return result, xml_path
            except Exception as e:
                print(f"Error processing {xml_path}: {e}")
                return None, xml_path

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(process_single_xml, path): path for path in xml_paths}
            for future in as_completed(futures):
                result, xml_path = future.result()

                if result is None:
                    session_data["xml_errors"] += 1
                elif isinstance(result, list):
                    session_data["processed_data"].extend(result)
                    session_data["xml_processed"] += 1
                elif isinstance(result, dict) and result.get("durum") == "ATLANDI":
                    session_data["processed_data"].append(result)
                    session_data["xml_skipped"] += 1
                else:
                    session_data["xml_errors"] += 1

        # Delete XML files after processing
        for xml_path in xml_paths:
            try:
                os.remove(xml_path)
            except Exception as e:
                print(f"Error deleting XML file {xml_path}: {e}")

        session_manager.create_session(session_id, session_data)

        return {
            "success": True,
            "session_id": session_id,
            "xml_total": session_data["xml_total"],
            "xml_processed": session_data["xml_processed"],
            "xml_skipped": session_data["xml_skipped"],
            "xml_errors": session_data["xml_errors"],
            "processed_data": session_data["processed_data"]
        }

    except Exception as e:
        from logger import log_error
        log_error(f"Dosya yükleme hatası: {e}")
        raise HTTPException(status_code=500, detail="Dosya yükleme sırasında hata oluştu.")


async def upload_json_data(request: Request, user_id: str = "", mukellef_id: str = "", donem_id: str = ""):
    """Client-side parsed JSON data accepts - new endpoint for client-side parsing"""
    try:
        data = await request.json()

        session_id = str(uuid.uuid4())
        processed_data = data.get("processed_data", [])
        xml_total = data.get("xml_total", 0)
        xml_processed = data.get("xml_processed", 0)
        xml_skipped = data.get("xml_skipped", 0)
        xml_errors = data.get("xml_errors", 0)
        
        session_data = {
            "session_id": session_id,
            "owner_user_id": user_id,
            "uploaded_files": [],
            "processed_data": processed_data,
            "xml_total": xml_total,
            "xml_processed": xml_processed,
            "xml_skipped": xml_skipped,
            "xml_errors": xml_errors,
            "created_at": datetime.now().isoformat(),
            "download_limits": {
                "standart": {"birlestir": 1, "ayrik": 1},
                "gib_sartli": {"birlestir": 1, "ayrik": 1}
            }
        }

        session_manager.create_session(session_id, session_data)

        return {
            "success": True,
            "session_id": session_id,
            "xml_total": session_data["xml_total"],
            "xml_processed": session_data["xml_processed"],
            "xml_skipped": session_data["xml_skipped"],
            "xml_errors": session_data["xml_errors"],
            "processed_data": session_data["processed_data"]
        }

    except Exception as e:
        import traceback
        from logger import log_error
        error_detail = traceback.format_exc()
        log_error(f"JSON veri işleme hatası: {e}\n{error_detail}")
        raise HTTPException(status_code=500, detail=f"Veri işleme sırasında hata oluştu: {str(e)}")

async def get_session_data_debug(session_id: str):
    """Debug için session verilerini göster"""
    data = session_manager.get_session(session_id)
    if data is None:
        return {"error": "Session not found"}
    return {
        "session_id": session_id,
        "xml_total": data.get("xml_total", 0),
        "xml_processed": data.get("xml_processed", 0),
        "xml_skipped": data.get("xml_skipped", 0),
        "xml_errors": data.get("xml_errors", 0),
        "total_items": len(data.get("processed_data", [])),
        "sample_items": data.get("processed_data", [])[:3],
        "all_items": data.get("processed_data", [])
    }

async def export_excel(session_id: str, export_type: str = "standart", combine_rows: bool = False, user_id: str = "", manually_processed_keys: list = None):
    """Excel dosyasü olarak disa aktarir"""
    if manually_processed_keys is None:
        manually_processed_keys = []
    
    try:

        session_data = session_manager.get_session(session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail="Oturum bulunamadi")

        owner = session_data.get("owner_user_id", "")
        if user_id and (not owner or owner != user_id):
            raise HTTPException(status_code=403, detail="Bu oturuma erişim yetkiniz yok.")


        limits = session_data.get("download_limits", {})

        # Indirme hakkini kontrol et
        mode_key = "birlestir" if combine_rows else "ayrik"
        type_limits = limits.get(export_type, {})
        remaining = type_limits.get(mode_key, 0)

        if remaining <= 0:
            raise HTTPException(status_code=403, detail=f"{export_type} Daha önce bu exceli indirdiğiniz için tekrar indirilemiyor.")

        # Hakkı düşür
        type_limits[mode_key] = remaining - 1
        limits[export_type] = type_limits
        session_data["download_limits"] = limits
        session_manager.update_session(session_id, session_data)
        
        raw_processed_data = [item for item in session_data["processed_data"] if isinstance(item, dict) and "vkn" in item]

        # Validate and clean data
        cleaned_data = []
        for idx, item in enumerate(raw_processed_data):
            try:
                cleaned_item = {
                    "vkn": str(item.get('vkn', '') or ""),
                    "unvan": str(item.get('unvan', '') or ""),
                    "tarih": str(item.get('tarih', '') or ""),
                    "no": str(item.get('no', '') or ""),
                    "cins": str(item.get('cins', '') or ""),
                    "miktar": str(item.get('miktar', '') or ""),
                    "matrah": float(item.get('matrah', 0) or 0),
                    "kdv": float(item.get('kdv', 0) or 0),
                    "tevkifat": float(item.get('tevkifat', 0) or 0),
                    "xml_no": str(item.get('xml_no', '') or "")
                }
                cleaned_data.append(cleaned_item)
            except Exception as e:
                continue
        
        raw_processed_data = cleaned_data
        
        if not raw_processed_data:
            raise HTTPException(status_code=400, detail="Disa aktarilacak veri bulunamadi")
        
        # Apply row combining if requested
        if combine_rows:
            # Combine rows by invoice number (same logic as frontend)
            grouped = {}
            for idx, item in enumerate(raw_processed_data):
                key = f"{item.get('no', '')}_{item.get('tarih', '')}_{item.get('vkn', '')}"
                if key not in grouped:
                    grouped[key] = {
                        "vkn": item.get('vkn', ''),
                        "unvan": item.get('unvan', ''),
                        "tarih": item.get('tarih', ''),
                        "no": item.get('no', ''),
                        "cins": [],
                        "miktar": [],
                        "matrah": 0,
                        "kdv": 0,
                        "tevkifat": 0,
                        "xml_no": item.get('xml_no', 0),
                        "manuallyProcessed": key in manually_processed_keys
                    }
                grouped[key]["cins"].append(item.get('cins', ''))
                grouped[key]["miktar"].append(str(item.get('miktar', '')))
                grouped[key]["matrah"] += float(item.get('matrah', 0))
                grouped[key]["kdv"] += float(item.get('kdv', 0))
                grouped[key]["tevkifat"] += float(item.get('tevkifat', 0))
                # Mark as manually processed if any item in the group is
                if key in manually_processed_keys:
                    grouped[key]["manuallyProcessed"] = True
            
            processed_data = []
            for item in grouped.values():
                processed_data.append({
                    "vkn": item["vkn"],
                    "unvan": item["unvan"],
                    "tarih": item["tarih"],
                    "no": item["no"],
                    "cins": " - ".join(item["cins"]),
                    "miktar": " - ".join(item["miktar"]),
                    "matrah": round(item["matrah"], 2),
                    "kdv": round(item["kdv"], 2),
                    "tevkifat": round(item["tevkifat"], 2),
                    "xml_no": item["xml_no"],
                    "manuallyProcessed": item.get("manuallyProcessed", False)
                })
        else:
            processed_data = raw_processed_data
        
        
        # Create DataFrame
        df = pd.DataFrame(processed_data)
        
        # Format data for export
        if export_type == "gib_sartli":
            # GIB Sartli Excel formati
            filename = f"gib_sartli_kdv_{session_id[:8]}.xlsx"
            output = BytesIO()
            
            headers = ["", "SIRA NO", "BELGE TARiHi", "BELGE SERiSi", "BELGE SiRA NO", "SATICININ ÜNVANI", 
                       "SATICININ VKN/TCKN", "MAL/HiZMET CiNSi", "MiKTARI", "MATRAH", "KDV", "TEVKiFAT HARiÇ", "M", "N", "O", "DÖNEM"]
            
            rows = []
            for i, item in enumerate(processed_data, 1):
                if float(item.get('kdv', 0)) >= 0.01:
                    t = str(item.get('tarih', '')).split('.')
                    donem = f"{t[2]}{t[1]}" if len(t) == 3 else ""
                    
                    matrah_val = float(item.get('matrah', 0))
                    kdv_val = float(item.get('kdv', 0))
                    tevkifat_val = float(item.get('tevkifat', 0))
                    tevkifat_haric_kdv = kdv_val - tevkifat_val
                    
                    row = ["", i, item.get('tarih', '') or "", "", item.get('no', '') or "", 
                           (item.get('unvan') or "")[:72], item.get('vkn', '') or "", 
                           (item.get('cins') or "")[:100], item.get('miktar', '') or "", 
                           item.get('matrah', 0), item.get('kdv', 0), tevkifat_haric_kdv, 
                           tevkifat_val, "", "", donem]
                    rows.append(row)
            
            df_export = pd.DataFrame(rows)
            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                df_export.to_excel(writer, index=False, header=False, startrow=4, sheet_name='KDV_Listesi')
                
                workbook = writer.book
                worksheet = writer.sheets['KDV_Listesi']
                
                h_fmt = workbook.add_format({'bold': True, 'align': 'center', 'border': 1, 'bg_color': '#E0E0E0'})
                num_fmt = workbook.add_format({'num_format': '#,##0.00'})
                
                for col_num, value in enumerate(headers):
                    worksheet.write(3, col_num, value, h_fmt)
                
                worksheet.set_column('F:F', 45)
                worksheet.set_column('G:G', 16)
                worksheet.set_column('H:H', 40)
                worksheet.set_column('I:I', 20)
                
                for r_idx in range(len(rows)):
                    worksheet.write_number(r_idx + 4, 9, rows[r_idx][9], num_fmt)
                    worksheet.write_number(r_idx + 4, 10, rows[r_idx][10], num_fmt)
                    worksheet.write_number(r_idx + 4, 11, rows[r_idx][11], num_fmt)
                    worksheet.write_number(r_idx + 4, 12, rows[r_idx][12], num_fmt)
        
        else:
            # Standart Excel formati (desktop uygulamas gibi)
            filename = f"standart_kdv_{session_id[:8]}.xlsx"
            output = BytesIO()
            
            headers = ["", "SIRA NO", "BELGE TARiHi", "BELGE SERiSi", "BELGE SiRA NO", "SATICININ ÜNVANI", 
                       "SATICININ VKN/TCKN", "MAL/HiZMET CiNSi", "MiKTARI", "MATRAH", "KDV", "TEVKiFAT HARiÇ", "M", "N", "O", "DÖNEM", "ÜRÜN KODU", "XML NO"]
            
            rows = []
            for i, s in enumerate(processed_data, 1):
                kdv_val = float(s.get('kdv', 0))
                # Check if manually processed (for Standart export only)
                item_key = f"{s.get('no', '')}_{s.get('tarih', '')}_{s.get('vkn', '')}"
                is_manually_processed = item_key in manually_processed_keys
                
                if kdv_val == 0 and not is_manually_processed:
                    continue
                t = str(s.get('tarih', '')).split('.')
                donem = f"{t[2]}{t[1]}" if len(t) == 3 else ""
                
                matrah_val = float(s.get('matrah', 0))
                kdv_val = float(s.get('kdv', 0))
                tevkifat_val = float(s.get('tevkifat', 0))
                tevkifat_haric_kdv = kdv_val - tevkifat_val
                
                row = ["", i, s.get('tarih', '') or "", "", s.get('no', '') or "", 
                       (s.get('unvan') or "")[:72], s.get('vkn', '') or "", 
                       (s.get('cins') or "")[:100], s.get('miktar', '') or "", 
                       s.get('matrah', 0), s.get('kdv', 0), tevkifat_haric_kdv, 
                       tevkifat_val, "", "", donem, "", str(s.get('xml_no', '') or "")]
                rows.append(row)
            
            df_export = pd.DataFrame(rows)
            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                df_export.to_excel(writer, index=False, header=False, startrow=4, sheet_name='KDV_Listesi')
                
                workbook = writer.book
                worksheet = writer.sheets['KDV_Listesi']
                
                h_fmt = workbook.add_format({'bold': True, 'align': 'center', 'border': 1, 'bg_color': '#E0E0E0'})
                num_fmt = workbook.add_format({'num_format': '#,##0.00'})
                txt_fmt = workbook.add_format({'num_format': '@'})
                
                for col_num, value in enumerate(headers):
                    worksheet.write(3, col_num, value, h_fmt)
                
                worksheet.set_column('F:F', 45)
                worksheet.set_column('G:G', 16, txt_fmt)
                worksheet.set_column('H:H', 40, txt_fmt)
                worksheet.set_column('I:I', 20, txt_fmt)
                
                for r_idx in range(len(rows)):
                    worksheet.write_number(r_idx + 4, 9, rows[r_idx][9], num_fmt)
                    worksheet.write_number(r_idx + 4, 10, rows[r_idx][10], num_fmt)
                    worksheet.write_number(r_idx + 4, 11, rows[r_idx][11], num_fmt)
                    worksheet.write_number(r_idx + 4, 12, rows[r_idx][12], num_fmt)
        
        output.seek(0)
        return StreamingResponse(
            output,
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        import traceback
        from logger import log_error
        log_error(f"Excel dışa aktarma hatası: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Excel dosyası oluşturulurken hata oluştu.")

async def get_session_data(session_id: str, user_id: str = ""):
    """Oturum verilerini getirir"""
    session_data = session_manager.get_session(session_id)
    if session_data is None:
        raise HTTPException(status_code=404, detail="Oturum bulunamadi")

    owner = session_data.get("owner_user_id", "")
    if user_id and (not owner or owner != user_id):
        raise HTTPException(status_code=403, detail="Bu oturuma erişim yetkiniz yok.")

    return session_data

async def reset_download_limits(session_id: str, user_id: str = ""):
    """Indirme haklarini sifirlar - mod degistiginde cagrılır"""
    session_data = session_manager.get_session(session_id)
    if session_data is None:
        raise HTTPException(status_code=404, detail="Oturum bulunamadi")

    owner = session_data.get("owner_user_id", "")
    if user_id and (not owner or owner != user_id):
        raise HTTPException(status_code=403, detail="Bu oturuma erişim yetkiniz yok.")

    session_data["download_limits"] = {
        "standart": {"birlestir": 1, "ayrik": 1},
        "gib_sartli": {"birlestir": 1, "ayrik": 1}
    }
    session_manager.update_session(session_id, session_data)

    return {"success": True, "message": "Indirme haklari sifirlandi"}
