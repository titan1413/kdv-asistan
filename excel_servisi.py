# excel_servisi.py
import openpyxl
from openpyxl.styles import Font, Alignment, Border, Side
import pandas as pd
from pathlib import Path
import io

class ExcelExporter:
    @staticmethod
    def sutun_ismi_normalize(sutun_adi):
        """Sütun isimlerini normalize et - Türkçe karakterleri düzelt"""
        if not sutun_adi:
            return sutun_adi
        
        # Türkçe karakterleri düzelt
        turkce_karakterler = {
            'Ý': 'I', 'Ý': 'I', 'ý': 'i', 'þ': 's', 'Þ': 'S',
            'ð': 'g', 'Ð': 'G', 'ç': 'c', 'Ç': 'C', 'ö': 'o',
            'Ö': 'O', 'ü': 'u', 'Ü': 'U', 'ı': 'i', 'İ': 'I'
        }
        
        normalized = sutun_adi
        for turkce, normal in turkce_karakterler.items():
            normalized = normalized.replace(turkce, normal)
        
        # Boşlukları ve özel karakterleri temizle
        normalized = normalized.replace(' ', '_').replace('/', '_').replace('.', '_')
        
        return normalized.upper()
    
    @staticmethod
    def sayi_temizle(deger):
        if deger is None or deger == "" or deger == "-": return 0.0
        # Eğer zaten sayı ise direkt döndür
        if isinstance(deger, (int, float)):
            return float(deger)
        s = str(deger).strip()
        if s == "": return 0.0
        # Türk sayı formatı: . (binlik ayırıcı) ve , (ondalık ayırıcı)
        # Önce binlik ayırıcıları (.) kaldır, sonra ondalık ayırıcıyı (,) . yap
        s = s.replace(".", "").replace(",", ".")
        try: return float(s)
        except: return 0.0
    
    @staticmethod
    def sayi_formatla_turkce(deger):
        """Sayıyı Türk formatında (virgüllü) string olarak döndürür"""
        if deger is None: return "0,00"
        try:
            # Sayıyı float'a çevir
            sayi = float(deger)
            # Türk formatında string'e çevir (virgül ondalık ayırıcı)
            return "{0:,.2f}".format(sayi).replace(",", "X").replace(".", ",").replace("X", ".")
        except:
            return "0,00"
    
    @staticmethod
    def turkce_sayi_temizle(deger):
        """Sadece Matrah ve KDV için Türk sayı formatını doğru ile"""
        if deger is None or deger == "" or deger == "-": return 0.0
        # Eğer zaten sayı ise direkt döndür
        if isinstance(deger, (int, float)):
            return float(deger)
        s = str(deger).strip()
        if s == "": return 0.0
        # Türk sayı formatı: . (binlik ayırıcı) ve , (ondalık ayırıcı)
        # Önce ondalık ayırıcıyı (,) noktaya çevir, sonra binlik ayırıcıları (.) kaldır
        s = s.replace(",", ".")  # Virgülü noktaya çevir
        # Son noktayı (ondalık ayırıcı) koru, diğer noktaları (binlik ayırıcılar) kaldır
        parts = s.rsplit(".", 1)  # En sağdaki noktadan böl
        if len(parts) == 2:
            integer_part = parts[0].replace(".", "")  # Binlik ayırıcıları kaldır
            decimal_part = parts[1]
            s = integer_part + "." + decimal_part
        else:
            s = s.replace(".", "")  # Nokta yoksa hepsini kaldır
        try: return float(s)
        except: return 0.0

    @classmethod
    def gıb_listesi_aktar(cls, yuklenim_data, indirilecek_sheet_data, mod="kalem"):
        """Hesaplanan verileri GİB formatında Excel'e aktarır (Web compatible)
        
        Args:
            yuklenim_data: Yüklenim tablosu verileri
            indirilecek_sheet_data: İndirilecek KDV tablosu verileri
            mod: "kalem" (Sadece Yüklenilen Kalem) veya "fatura" (Fatura Geneli Akıllı Birleştirme)
        
        Returns:
            bytes: Excel dosyasının byte verisi
        """
        try:
            if not yuklenim_data:
                raise ValueError("Aktarılacak veri bulunamadı!")

            # 1. İndirilecek KDV Verilerini Hazırla
            df_ind = pd.DataFrame(indirilecek_sheet_data)
            
            # Sayısal sütunları güvenli temizle - use column names instead of indices
            if 'MATRAH' in df_ind.columns:
                df_ind['MATRAH'] = df_ind['MATRAH'].apply(cls.turkce_sayi_temizle)
            if 'KDV' in df_ind.columns:
                df_ind['KDV'] = df_ind['KDV'].apply(cls.turkce_sayi_temizle)
            
            # Tarih, FaturaNo ve VKN sütunlarını stringe çevirip temizle (Hatalı eşleşmeyi önlemek için)
            if 'TARIH' in df_ind.columns:
                df_ind['TARIH'] = pd.to_datetime(df_ind['TARIH'], format='%d.%m.%Y', errors='coerce')
            if 'NO' in df_ind.columns:
                df_ind['NO'] = df_ind['NO'].astype(str).str.strip().str.upper() # Fatura No
            if 'VERGI_TC' in df_ind.columns:
                df_ind['VERGI_TC'] = df_ind['VERGI_TC'].astype(str).str.strip().str.upper() # VKN
            
            # --- KRİTİK DÜZELTME BÖLGESİ ---
            # Sadece geçerli tarihi olanları al ve FaturaNo + VKN + Tarih üçlüsüyle tam eşleşme sağla
            # Böylece farklı aylardaki veya farklı firmalardaki benzer fatura noları birbirine karışmaz.
            ind_ozet = df_ind.groupby(['NO', 'VERGI_TC', 'TARIH']).agg({'MATRAH': 'sum', 'KDV': 'sum'}).reset_index()
            ind_ozet.columns = ['FaturaNo', 'VKN', 'Tarih', 'GercekMatrah', 'GercekKDV']

            # Cins ve Miktar için özel aggregation fonksiyonları
            def aggregate_cins(x):
                values = [str(i).strip() for i in x if i and i != "-"]
                if not values:
                    return "-"

                # Büyük/küçük harf duyarsız temizleme
                normalized_map = {}
                for v in values:
                    normalized = v.lower().strip()
                    if normalized not in normalized_map:
                        normalized_map[normalized] = v.strip()

                unique_values = list(normalized_map.values())
                if len(unique_values) == 1:
                    return unique_values[0]
                else:
                    return " - ".join(unique_values)

            def aggregate_urun_kodu(x):
                """Birleşen faturalardaki ürün kodlarını '-' ile birleştir"""
                values = [str(i).strip() for i in x if i and i != "-"]
                if not values:
                    return "-"

                # Büyük/küçük harf duyarsız benzersiz değerler
                normalized_map = {}
                for v in values:
                    normalized = v.lower().strip()
                    if normalized not in normalized_map:
                        normalized_map[normalized] = v.strip()

                unique_values = list(normalized_map.values())
                if len(unique_values) == 1:
                    return unique_values[0]
                else:
                    return " - ".join(unique_values)
            
            def aggregate_miktar_smart(cins_values, miktar_values):
                """
                Akıllı miktar birleştirme: Aynı cins isimlerinin miktarlarını topla,
                farklı cinslerin miktarlarını ayrı ayrı listele
                """
                # Cins ve miktarları temizle
                cins_list = [str(c).strip() for c in cins_values if c and c != "-"]
                miktar_list = [str(m).strip() for m in miktar_values if m and m != "-"]
                
                if not cins_list or not miktar_list:
                    return "-"
                
                # Cins -> Miktarlar listesi eşleştirmesi (büyük/küçük harf duyarsız)
                cins_miktar_map = {}
                cins_original_map = {}  # Orijinal cins isimlerini sakla
                
                for cins, miktar in zip(cins_list, miktar_list):
                    cins_normalized = cins.lower().strip()
                    if cins_normalized not in cins_miktar_map:
                        cins_miktar_map[cins_normalized] = []
                        cins_original_map[cins_normalized] = cins.strip()
                    cins_miktar_map[cins_normalized].append(miktar)
                
                # Sonuçları oluştur
                result_cins_list = []
                result_miktar_list = []
                
                for cins_norm in cins_miktar_map:
                    result_cins_list.append(cins_original_map[cins_norm])
                    # Aynı cins için tüm miktarları sayısal olarak topla
                    toplam_miktar = sum(cls.turkce_sayi_temizle(m) for m in cins_miktar_map[cins_norm])
                    # Türk formatına çevir (nokta binlik, virgül ondalık)
                    result_miktar_list.append(cls.sayi_formatla_turkce(toplam_miktar))
                
                if len(result_cins_list) == 1:
                    return result_miktar_list[0]
                else:
                    return " - ".join(result_miktar_list)
            
            def aggregate_miktar_simple(x):
                """Basit miktar birleştirme (mod='kalem' için)"""
                values = [str(i).strip() for i in x if i and i != "-"]
                if not values:
                    return "-"
                
                unique_values = list(dict.fromkeys(values))  # Sırayı koru, tekrarları kaldır
                if len(unique_values) == 1:
                    return unique_values[0]
                else:
                    return " - ".join(unique_values)

            # Fatura Geneli modu için: İndirilecek KDV listesinden Cins ve Miktar aggregation
            # Cins ve Miktar için akıllı birleştirme
            if 'CINS' in df_ind.columns and 'MIKTAR' in df_ind.columns:
                ind_cins_agg = df_ind.groupby(['NO', 'VERGI_TC', 'TARIH']).apply(
                    lambda x: aggregate_cins(x['CINS'])
                ).reset_index()
                ind_cins_agg.columns = ['FaturaNo', 'VKN', 'Tarih', 'Cins_Agg']
                
                # Miktar için akıllı aggregation - aynı cinsleri topla
                def smart_agg_miktar_ind(group):
                    cins_list = group['CINS'].tolist()
                    miktar_list = group['MIKTAR'].tolist()
                    return aggregate_miktar_smart(cins_list, miktar_list)
                
                ind_miktar_agg = df_ind.groupby(['NO', 'VERGI_TC', 'TARIH']).apply(smart_agg_miktar_ind).reset_index()
                ind_miktar_agg.columns = ['FaturaNo', 'VKN', 'Tarih', 'Miktar_Agg']
            else:
                ind_cins_agg = None
                ind_miktar_agg = None
            
            # Sonuçları birleştir
            if ind_cins_agg is not None and ind_miktar_agg is not None:
                ind_full_agg = ind_ozet.merge(ind_cins_agg, on=['FaturaNo', 'VKN', 'Tarih'])
                ind_full_agg = ind_full_agg.merge(ind_miktar_agg, on=['FaturaNo', 'VKN', 'Tarih'])
            else:
                ind_full_agg = ind_ozet.copy()
                ind_full_agg['Cins_Agg'] = '-'
                ind_full_agg['Miktar_Agg'] = '-'

            # 2. Yüklenim Verilerini Hazırla
            df_yuk = pd.DataFrame(yuklenim_data)
            
            # Sütun isimlerini normalize et
            df_yuk.columns = [cls.sutun_ismi_normalize(str(col)) for col in df_yuk.columns]
            
            # Yüklenilen KDV için BUNYEYE_GIREN sütununu kullan
            if 'BUNYEYE_GIREN' in df_yuk.columns:
                df_yuk['Yuklenilen_Sayı'] = df_yuk['BUNYEYE_GIREN'].apply(cls.sayi_temizle)
            else:
                df_yuk['Yuklenilen_Sayı'] = 0
            
            # Tarih sütununu kullan
            if 'TARIH' in df_yuk.columns:
                df_yuk['Tarih_DT'] = pd.to_datetime(df_yuk['TARIH'], format='%d.%m.%Y', errors='coerce')
            else:
                df_yuk['Tarih_DT'] = None
            
            # Yüklenim tarafındaki verileri temizle
            df_yuk['FaturaNo'] = df_yuk['NO'].astype(str).str.strip().str.upper() if 'NO' in df_yuk.columns else ''
            df_yuk['VKN'] = df_yuk['VERGI_TC'].astype(str).str.strip().str.upper() if 'VERGI_TC' in df_yuk.columns else ''
            df_yuk['Yuklenim_Donemi'] = df_yuk['YUK_DONEM'].astype(str).str.strip() if 'YUK_DONEM' in df_yuk.columns else ''
            df_yuk['Ind_Donemi'] = df_yuk['IND_DONEM'].astype(str).str.strip() if 'IND_DONEM' in df_yuk.columns else ''
            df_yuk['Urun_Kodu'] = df_yuk['URUN_KODU'].astype(str).str.strip() if 'URUN_KODU' in df_yuk.columns else ''
            
            # SERI ve UNVAN sütunlarını da hazırla
            df_yuk['Seri'] = df_yuk['SERI'].astype(str).str.strip() if 'SERI' in df_yuk.columns else ''
            df_yuk['Unvan'] = df_yuk['UNVAN'].astype(str).str.strip() if 'UNVAN' in df_yuk.columns else ''

            # Mod'a göre aggregation fonksiyonlarını seç
            if mod == "fatura":
                # Fatura Geneli (Akıllı Birleştirme) - İndirilecek KDV listesinden Cins/Miktar al
                # Diğer sütunlar için yüklenim verilerinden aggregation
                agg_func_other = {
                    'Seri': 'first', 'Unvan': 'first',
                    'Yuklenilen_Sayı': 'sum', 'Ind_Donemi': 'first', 'Urun_Kodu': aggregate_urun_kodu
                }
                grouped = df_yuk.groupby(['FaturaNo', 'VKN', 'Tarih_DT', 'Yuklenim_Donemi'], as_index=False).agg(agg_func_other)
                
                # İndirilecek KDV'den gelen Cins ve Miktar'ı eşleştir
                if ind_cins_agg is not None and ind_miktar_agg is not None:
                    grouped = grouped.merge(
                        ind_full_agg[['FaturaNo', 'VKN', 'Tarih', 'Cins_Agg', 'Miktar_Agg']],
                        left_on=['FaturaNo', 'VKN', 'Tarih_DT'],
                        right_on=['FaturaNo', 'VKN', 'Tarih'],
                        how='left'
                    )
                    
                    # Cins ve Miktar sütunlarını indirilecek KDV'den gelenlerle değiştir
                    grouped['Cins_Agg'] = grouped['Cins_Agg'].fillna('-')
                    grouped['Miktar_Agg'] = grouped['Miktar_Agg'].fillna('-')
                else:
                    grouped['Cins_Agg'] = '-'
                    grouped['Miktar_Agg'] = '-'
            else:
                # Sadece Yüklenilen Kalem (Mevcut mantık)
                agg_func = {
                    'Seri': 'first', 'Unvan': 'first',
                    'CINS': aggregate_cins if 'CINS' in df_yuk.columns else 'first',
                    'MIKTAR': aggregate_miktar_simple if 'MIKTAR' in df_yuk.columns else 'first',
                    'Yuklenilen_Sayı': 'sum', 'Ind_Donemi': 'first', 'Yuklenim_Donemi': 'first', 'Urun_Kodu': aggregate_urun_kodu
                }
                grouped = df_yuk.groupby(['FaturaNo', 'VKN', 'Tarih_DT', 'Yuklenim_Donemi'], as_index=False).agg(agg_func)

            # 3. Excel Dosya Hazırlığı
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Yüklenim Listesi"

            ws.merge_cells('B1:T1')
            ws['B1'] = "YÜKLENİLEN KDV LİSTESİ"
            ws['B1'].font = Font(bold=True, size=14)
            ws['B1'].alignment = Alignment(horizontal='center')

            gib_headers = ["Sıra No", "Alış Faturasının Tarihi", "Alış Faturasının Serisi", "Alış Faturasının Sıra No'su", 
                           "Satıcının Adı-Soyadı / Ünvanı", "Satıcının Vergi Kimlik Numarası / TC Kimlik Numarası", 
                           "Alınan Mal ve/veya Hizmetin Cinsi", "Alınan Mal ve/veya Hizmetin Miktarı", 
                           "Alış Faturasının KDV Hariç Tutarı", "Alış Faturasının KDV'si", "Bünyeye Giren Mal ve/veya Hizmetin KDV'si",
                           "GGB No", "İşlem Türü", "Teşvik No", "Yüklenim Türü", "İnd. Dönemi", "Yük. Dönemi", "Plaka", "Şasi", "Ürün Kodu"]
            
            for c, h in enumerate(gib_headers, 2):
                cell = ws.cell(row=4, column=c, value=h)
                cell.font = Font(bold=True)
                cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
                cell.border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
            
            # 4. Verileri Eşleştir ve Yaz
            for r_idx, row in grouped.iterrows():
                row_num = r_idx + 5
                fno = str(row.get('FaturaNo', '')).strip().upper()
                vkn = str(row.get('VKN', '')).strip().upper()
                tar = row.get('Tarih_DT')
                
                # EŞLEŞTİRME: FaturaNo + VKN + Tarih (Hepsi tutmalı)
                match = ind_ozet[(ind_ozet['FaturaNo'] == fno) & 
                                 (ind_ozet['VKN'] == vkn) &
                                 (ind_ozet['Tarih'] == tar)]
                
                if not match.empty:
                    matrah_final = match['GercekMatrah'].values[0]
                    kdv_final = match['GercekKDV'].values[0]
                else:
                    # Eğer tam eşleşme bulamazsa (saat farkı vb olabilir), sadece VKN ve No ile dene
                    match_fallback = ind_ozet[(ind_ozet['FaturaNo'] == fno) & (ind_ozet['VKN'] == vkn)]
                    if not match_fallback.empty:
                        matrah_final = match_fallback['GercekMatrah'].values[0]
                        kdv_final = match_fallback['GercekKDV'].values[0]
                    else:
                        matrah_final = 0.0
                        kdv_final = 0.0

                ws.cell(row=row_num, column=2, value=r_idx + 1)
                t_cell = ws.cell(row=row_num, column=3, value=tar)
                t_cell.number_format = 'DD.MM.YYYY'
                ws.cell(row=row_num, column=4, value=str(row.get('Seri', '')))
                ws.cell(row=row_num, column=5, value=fno)
                ws.cell(row=row_num, column=6, value=str(row.get('Unvan', '')))
                ws.cell(row=row_num, column=7, value=vkn).number_format = '@'
                
                # Cins sütunu (8)
                if 'Cins_Agg' in row:
                    cins_val = row['Cins_Agg']
                elif 'CINS' in row:
                    cins_val = row['CINS']
                else:
                    cins_val = '-'
                ws.cell(row=row_num, column=8, value=str(cins_val))
                
                # Miktar sütunu (9) - string olarak bırak
                if 'Miktar_Agg' in row:
                    miktar_val = row['Miktar_Agg']
                elif 'MIKTAR' in row:
                    miktar_val = row['MIKTAR']
                else:
                    miktar_val = '-'
                if miktar_val == '-' or miktar_val is None:
                    ws.cell(row=row_num, column=9, value='-')
                else:
                    ws.cell(row=row_num, column=9, value=str(miktar_val))
                
                # Matrah (10), KDV (11), Bünyeye Giren (12) - sayı formatında
                ws.cell(row=row_num, column=10, value=matrah_final)
                ws.cell(row=row_num, column=10).number_format = '#,##0.00'
                ws.cell(row=row_num, column=11, value=kdv_final)
                ws.cell(row=row_num, column=11).number_format = '#,##0.00'
                ws.cell(row=row_num, column=12, value=row.get('Yuklenilen_Sayı', 0))
                ws.cell(row=row_num, column=12).number_format = '#,##0.00'
                
                # İşlem Türü (16)
                urun_kodu = str(row.get('Urun_Kodu', ''))
                ws.cell(row=row_num, column=16, value="2" if urun_kodu.upper() == "GG" else "1")
                ws.cell(row=row_num, column=17, value=str(row.get('Ind_Donemi', '')))
                ws.cell(row=row_num, column=18, value=str(row.get('Yuklenim_Donemi', '')))
                # Ürün Kodu sütunu (21)
                ws.cell(row=row_num, column=21, value=urun_kodu)

            for col in range(2, 23):
                ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 16

            # Save to BytesIO for web download
            output = io.BytesIO()
            wb.save(output)
            output.seek(0)
            return output.getvalue()

        except Exception as e:
            raise Exception(f"Excel oluşturma hatası: {str(e)}")

    @classmethod
    def standart_listesi_aktar(cls, sonuc_verileri):
        """İade hesaplama sonuçlarını standart Excel formatında aktarır (Web compatible)
        
        Args:
            sonuc_verileri: İade hesaplama sonuç verileri (list of lists)
        
        Returns:
            bytes: Excel dosyasının byte verisi
        """
        try:
            if not sonuc_verileri:
                raise ValueError("Aktarılacak veri bulunamadı!")

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "İade Listesi"

            # Başlık
            ws.merge_cells('B1:N1')
            ws['B1'] = "İADE HESAPLAMA SONUÇLARI"
            ws['B1'].font = Font(bold=True, size=14)
            ws['B1'].alignment = Alignment(horizontal='center')

            # Başlıklar
            headers = ["Sıra", "Tarih", "Seri", "Fatura No", "Ünvan", "VKN/TC", "Cins", "Miktar", "Matrah", "KDV", "Yüklenilen KDV", "Kalan KDV", "Dönem", "Ürün Kodu"]
            for c, h in enumerate(headers, 2):
                cell = ws.cell(row=3, column=c, value=h)
                cell.font = Font(bold=True)
                cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
                cell.border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))

            # Verileri yaz
            for r_idx, row in enumerate(sonuc_verileri):
                row_num = r_idx + 4
                # row formatı: [SIRA, TARIH, SERI, NO, UNVAN, VERGI_TC, CINS, MIKTAR, MATRAH, KDV, ONCE_YUKLENEN, KALAN_KDV, DONEM, URUN_KODU]
                ws.cell(row=row_num, column=2, value=row[0])  # Sıra
                ws.cell(row=row_num, column=3, value=row[1])  # Tarih
                ws.cell(row=row_num, column=4, value=str(row[2]))  # Seri
                ws.cell(row=row_num, column=5, value=str(row[3]))  # No
                ws.cell(row=row_num, column=6, value=str(row[4]))  # Ünvan
                ws.cell(row=row_num, column=7, value=str(row[5]))  # VKN/TC
                ws.cell(row=row_num, column=8, value=str(row[6]))  # Cins
                ws.cell(row=row_num, column=9, value=str(row[7]))  # Miktar
                ws.cell(row=row_num, column=10, value=row[8])  # Matrah
                ws.cell(row=row_num, column=10).number_format = '#,##0.00'
                ws.cell(row=row_num, column=11, value=row[9])  # KDV
                ws.cell(row=row_num, column=11).number_format = '#,##0.00'
                ws.cell(row=row_num, column=12, value=row[10])  # Yüklenilen KDV (ONCE_YUKLENEN)
                ws.cell(row=row_num, column=12).number_format = '#,##0.00'
                ws.cell(row=row_num, column=13, value=row[11])  # Kalan KDV
                ws.cell(row=row_num, column=13).number_format = '#,##0.00'
                ws.cell(row=row_num, column=14, value=str(row[12]) if len(row) > 12 else "")  # Dönem
                ws.cell(row=row_num, column=15, value=str(row[13]) if len(row) > 13 else "")  # Ürün Kodu

            # Sütun genişlikleri
            for col in range(2, 16):
                ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 16

            # Save to BytesIO for web download
            output = io.BytesIO()
            wb.save(output)
            output.seek(0)
            return output.getvalue()

        except Exception as e:
            raise Exception(f"Excel oluşturma hatası: {str(e)}")
