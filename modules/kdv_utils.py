import re
import os
from pathlib import Path
import pandas as pd

from logger import log_error, log_info

UPLOAD_DIR = Path("uploads")
EXCEL_DIR = Path("excel_exports")
TEMP_DATA_DIR = Path("temp_data")

UPLOAD_DIR.mkdir(exist_ok=True)
EXCEL_DIR.mkdir(exist_ok=True)
TEMP_DATA_DIR.mkdir(exist_ok=True)


def tarih_standartla(t) -> str:
    """Tarihi GG.AA.YYYY formatina güvenli sekilde cevirir."""
    if not t or pd.isna(t) or str(t).strip() == "" or str(t).lower() == "nan":
        return ""
    try:
        t_str = str(t).strip().replace('.0', '')

        # Excel sayisal tarih formati (45664 gibi)
        if t_str.replace('.', '', 1).isdigit() and len(t_str) < 7:
            return pd.to_datetime(float(t_str), unit='D', origin='1899-12-30').strftime('%d.%m.%Y')

        # ISO formati (yyyy-mm-dd) önce dene
        if "-" in t_str and t_str.find("-") == 4:
            return pd.to_datetime(t_str).strftime('%d.%m.%Y')

        # Bilinen formatlari sirayla dene (Türk formati öncelikli)
        for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
            try:
                return pd.to_datetime(t_str, format=fmt).strftime('%d.%m.%Y')
            except Exception:
                continue

        # Belirsiz durumlarda gün-ay sirasini (dayfirst) zorla
        return pd.to_datetime(t_str, dayfirst=True).strftime('%d.%m.%Y')
    except Exception:
        return str(t)


def temizle(s) -> float:
    """Matrah, KDV ve Miktari finansal standartlara (float) cevirir."""
    if not s or pd.isna(s):
        return 0.0
    # Metni temizle: TL, AD, KG gibi birimleri ve bosluklari sil
    s = re.sub(r'[a-zA-ZçÇğĞıİöÖşŞüÜ\s]', '', str(s))
    if not s:
        return 0.0

    # Türk formati (1.250,50) kontrolü ve dönüsümü
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")

    try:
        return round(float(s), 2)
    except Exception:
        return 0.0


def format_tr_sayi(deger) -> str:
    """Sayiyi Türk formati (1.234,56) olarak metne dönüstürür."""
    try:
        sayi = deger if isinstance(deger, (float, int)) else temizle(deger)
        if sayi == 0:
            return "0,00"
        return "{:,.2f}".format(sayi).replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "0,00"


def cleanup_temp_file(file_path) -> None:
    """Geçici dosyayı güvenli şekilde siler ve sonucu loglar."""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
            log_info(f"Geçici dosya silindi: {file_path}")
        except Exception as e:
            log_error(f"Geçici dosya silinemedi {file_path}: {e}")
