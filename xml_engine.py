try:
    from lxml import etree as ET
except ImportError:
    import xml.etree.ElementTree as ET
import os
import re # Miktar ve metin kontrolü için gerekli
import logging
logging.disable(logging.INFO)  # INFO logları tamamen kapat
from logger import log_info, log_error, log_warning


def parse_gib_xml(xml_yolu):
    filename = os.path.basename(xml_yolu)
    try:
        log_info(f"XML parsing başlatılıyor: {filename}")
        
        # Namespace tanımlarını tam yap
        ns = {
            'inv': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
            'cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
            'cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
            'ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'
        }
        
        # XML'i encoding-safe yöntemle yükle (UTF-8 BOM ve encoding problemleri için)
        with open(xml_yolu, 'rb') as f:
            content = f.read()
        
        # UTF-8 BOM karakterini temizle
        if content.startswith(b'\xef\xbb\xbf'):
            content = content[3:]
        
        # Decode işlemi - önce UTF-8 dene, hata verirse fallback encoding kullan
        try:
            xml_string = content.decode('utf-8')
        except UnicodeDecodeError:
            try:
                xml_string = content.decode('windows-1254')
            except UnicodeDecodeError:
                xml_string = content.decode('iso-8859-9')
        
        # XML declaration'ı ve ParseError yaratabilecek geçersiz kontrol karakterlerini sil
        xml_string = re.sub(r'^<\?xml[^>]+\?>', '', xml_string).strip()
        xml_string = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', xml_string)
        
        # XML string'den parse et
        root = ET.fromstring(xml_string)
        
        # Bellek tasarrufu için gereksiz büyük düğümleri temizle
        # Bu düğümler XSLT görsel verisi ve imza içerir, belleği şişirir
        for elem in root.findall('.//cac:AdditionalDocumentReference', ns):
            elem.clear()
        for elem in root.findall('.//cbc:EmbeddedDocumentBinaryObject', ns):
            elem.clear()
        for elem in root.findall('.//ext:UBLExtensions', ns):
            elem.clear()
        
        log_info(f"XML yüklendi ve gereksiz düğümler temizlendi: {filename}")

        # 1. VKN / TCKN
        vkn = ""
        id_list = root.findall('.//cac:AccountingSupplierParty//cac:PartyIdentification/cbc:ID', ns)
        for id_el in id_list:
            scheme = id_el.get('schemeID', '').upper()
            if scheme in ['VKN', 'TCKN']:
                vkn = str(id_el.text).strip() if id_el.text else ""
                break
        if not vkn:
            vkn_el = root.find('.//cac:AccountingSupplierParty//cbc:ID', ns)
            vkn = str(vkn_el.text).strip() if (vkn_el is not None and vkn_el.text) else ""

        # 2. Ünvan
        unvan = "Bilinmiyor"
        party = root.find('.//cac:AccountingSupplierParty/cac:Party', ns)
        if party is not None:
            reg_name = party.find('.//cbc:RegistrationName', ns)
            party_name = party.find('.//cac:PartyName/cbc:Name', ns)
            person = party.find('.//cac:Person', ns)
            if reg_name is not None and reg_name.text:
                unvan = reg_name.text
            elif party_name is not None and party_name.text:
                unvan = party_name.text
            elif person is not None:
                f = person.find('./cbc:FirstName', ns)
                l = person.find('./cbc:FamilyName', ns)
                f_text = f.text if f is not None and f.text else ""
                l_text = l.text if l is not None and l.text else ""
                unvan = f"{f_text} {l_text}".strip()
                if not unvan:
                    unvan = "Bilinmiyor"

        # 3. Tarih ve Fatura No
        t_el = root.find('.//cbc:IssueDate', ns)
        tarih = ""
        if t_el is not None and t_el.text:
            tp = t_el.text.split("-")
            if len(tp) == 3:
                try:
                    yil, ay, gun = int(tp[0]), int(tp[1]), int(tp[2])
                    # Tarih validasyonu: mantıklı tarih aralığını kontrol et
                    if 1900 <= yil <= 2100 and 1 <= ay <= 12 and 1 <= gun <= 31:
                        tarih = f"{gun:02d}.{ay:02d}.{yil}"
                    else:
                        tarih = t_el.text  # Geçersizse orijinali kullan
                except:
                    tarih = t_el.text  # Hata durumunda orijinali kullan
            else:
                tarih = t_el.text
        
        f_no_el = root.find('.//cbc:ID', ns)
        f_no = str(f_no_el.text).strip() if (f_no_el is not None and f_no_el.text) else ""

        # 4. Sayısal Dönüştürücü
        def to_float(val_str):
            try:
                if not val_str: return 0.0
                s = str(val_str).strip()
                if "." in s and "," in s:
                    s = s.replace(".", "").replace(",", ".")
                elif "," in s:
                    s = s.replace(",", ".")
                val = float(s)
                # Range kontrolü: aşırı büyük veya negatif değerleri sınırla
                if abs(val) > 999999999.99:
                    return 999999999.99 if val > 0 else -999999999.99
                return val
            except:
                return 0.0

        # 5. Yardımcı Fonksiyon: Gerçek mal ismi mi yoksa stok/GTİP kodu mu?
        def is_actual_name(text):
            if not text or len(text) < 2: return False
            if len(text) == 2 and text.isalpha(): return False
            if re.match(r'^[0-9.\- ]+$', text): return False
            letters = len(re.findall(r'[a-zA-ZçÇğĞıİöÖşŞüÜ]', text))
            digits = len(re.findall(r'[0-9]', text))
            if " " in text and letters > digits: return True
            if letters > 0 and digits == 0: return True
            if letters > 0 and digits > 0 and " " not in text: return False
            return letters > digits

        # --- KUR HESAPLAMA (DÖVİZLİ FATURA KONTROLÜ) ---
        fiili_kur = 1.0
        total_matrah_el = root.find('.//cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount', ns)
        if total_matrah_el is not None:
            ana_matrah = to_float(total_matrah_el.text)
            para_birimi = total_matrah_el.get('currencyID', 'TRY')

            if para_birimi != 'TRY' and ana_matrah > 0:
                # Toplam matrahın TL karşılığını vergi bloğundan çekip oranlıyoruz
                tl_matrah_el = root.find(".//cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount[@currencyID='TRY']", ns)
                if tl_matrah_el is not None:
                    tl_matrah = to_float(tl_matrah_el.text)
                    if tl_matrah >= 0 and ana_matrah > 0:  # Negatif kur kontrolü ve sıfıra bölme hatası
                        fiili_kur = tl_matrah / ana_matrah
                else:
                    # Vergi bloğunda yoksa önce TaxExchangeRate (vergi döviz kuru) kullan
                    tax_rate_el = root.find('.//cac:TaxExchangeRate/cbc:CalculationRate', ns)
                    if tax_rate_el is not None:
                        kur_degeri = to_float(tax_rate_el.text)
                        if kur_degeri > 0:  # Pozitif kur kontrolü
                            fiili_kur = kur_degeri
                    else:
                        # TaxExchangeRate yoksa PricingExchangeRate (fiyatlandırma döviz kuru) kullan
                        pricing_rate_el = root.find('.//cac:PricingExchangeRate/cbc:CalculationRate', ns)
                        if pricing_rate_el is not None:
                            kur_degeri = to_float(pricing_rate_el.text)
                            if kur_degeri > 0:  # Pozitif kur kontrolü
                                fiili_kur = kur_degeri

        if fiili_kur != 1.0:
            log_info(f"Fiili kur hesaplandı: {fiili_kur:.4f} - {filename}")

        # --- İADE VE İHRAÇ KAYITLI (701) KONTROLÜ ---
        f_tipi_el = root.find('.//cbc:InvoiceTypeCode', ns)
        f_tipi = f_tipi_el.text.upper() if (f_tipi_el is not None and f_tipi_el.text is not None) else ""

        # İstisna kodu: Invoice > cac:TaxTotal[] > cac:TaxSubtotal[] > cac:TaxCategory
        #   > cbc:TaxExemptionReasonCode / cbc:TaxExemptionReason
        istisna_kodu = ""
        istisna_metni = ""
        for _tt in root.findall('./cac:TaxTotal', ns):
            for _st in _tt.findall('./cac:TaxSubtotal', ns):
                _cat = _st.find('./cac:TaxCategory', ns)
                if _cat is not None:
                    _kod = (_cat.findtext('./cbc:TaxExemptionReasonCode', default="", namespaces=ns) or "").strip()
                    _metin = (_cat.findtext('./cbc:TaxExemptionReason', default="", namespaces=ns) or "").strip()
                    if _kod: istisna_kodu = _kod
                    if _metin: istisna_metni = _metin

     
        if f_tipi == "IADE":
            log_warning(f"Fatura atlandı (İADE): {filename} - No: {f_no}, VKN: {vkn}")
            # Continue processing but mark as İADE
            fatura_durumu = "ATLANDI"
            fatura_nedeni = "İADE FATURASI"
        elif istisna_kodu == "701" or "11/1-c" in istisna_metni:
            log_warning(f"Fatura atlandı (İhraç Kayıtlı): {filename} - No: {f_no}, VKN: {vkn}")
            # Continue processing but mark as İHRAC_KAYITLI
            fatura_durumu = "ATLANDI"
            fatura_nedeni = "İHRAÇ KAYITLI (701)"
        else:
            fatura_durumu = None
            fatura_nedeni = None

        # 6. Satırları İşleme - Önce tanımla ki alt iskonto hesabı için kullanılabilsin
        fatura_satirlari = []
        lines = root.findall('.//cac:InvoiceLine', ns)
        log_info(f"InvoiceLine sayısı: {len(lines)} - {filename}")
        if not lines:
            lines = root.findall('.//cac:CreditNoteLine', ns)
            log_info(f"CreditNoteLine sayısı: {len(lines)} - {filename}")

        # --- GLOBAL ALT İSKONTO HESABI ---
        global_iskonto = 0.0
        allowance_total_el = root.find('.//cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount', ns)
        if allowance_total_el is not None:
            global_iskonto = to_float(allowance_total_el.text)
            log_info(f"Global iskonto tutarı: {global_iskonto:.2f} - {filename}")

        # Satır iskontoları toplamını hesaplamak için değişken
        toplam_satir_iskonto = 0.0

        # cac:SubInvoiceLine desteği: sadece yaprak satırları (SubInvoiceLine'ı olmayan) işle
        def _collect_leaf(line_el):
            subs = line_el.findall('./cac:SubInvoiceLine', ns)
            if subs:
                result = []
                for s in subs:
                    result.extend(_collect_leaf(s))
                return result
            return [line_el]

        lines_to_process = []
        for _l in lines:
            lines_to_process.extend(_collect_leaf(_l))
        log_info(f"İşlenecek yaprak satır sayısı: {len(lines_to_process)} - {filename}")

        for line in lines_to_process:
            item_name_el = line.find('./cac:Item/cbc:Name', ns)
            item_desc_el = line.find('./cac:Item/cbc:Description', ns)
            
            name_val = item_name_el.text.strip() if item_name_el is not None and item_name_el.text else ""
            desc_val = item_desc_el.text.strip() if item_desc_el is not None and item_desc_el.text else ""
            # cbc:Note[] DİZİ — tüm notlar taranır, metadata prefixleri hariç
            note_vals = []
            for _n in line.findall('./cbc:Note', ns):
                _raw = (_n.text or "").strip()
                if _raw and not re.match(r'^(Birim[_:]|ACK:|#NoPrint#|IND[1-6]\|m\||DigerVergiToplami:)', _raw, re.IGNORECASE):
                    note_vals.append(_raw)
            note_val = note_vals[0] if note_vals else ""

            # --- CİNS SEÇME HİYERARŞİSİ ---
            cins_adaylari = [name_val, desc_val] + note_vals
            cins = ""
            for aday in cins_adaylari:
                if is_actual_name(aday):
                    cins = aday
                    break
            
            if not cins:
                if name_val and desc_val:
                    if " " in name_val and " " not in desc_val: cins = name_val
                    elif " " in desc_val and " " not in name_val: cins = desc_val
                    else: cins = name_val if len(name_val) >= len(desc_val) else desc_val
                else:
                    cins = name_val or desc_val or (note_vals[0] if note_vals else "") or "---"

            # --- MİKTAR KONTROLÜ ---
            qty_raw = line.findtext('./cbc:InvoicedQuantity', default="0", namespaces=ns)
            qty_clean = "".join(re.findall(r'[0-9.,]', str(qty_raw)))
            qty = to_float(qty_clean)
            # Negatif miktarları pozitife çevir ve aşırı büyük değerleri sınırla
            if qty < 0:
                qty = abs(qty)
            if qty > 999999999.99:
                qty = 999999999.99
            # Birden fazla rakam grubu varsa ve boşluk varsa sıfırla (hatalı format)
            if len(re.findall(r'\d+', str(qty_raw).replace(".", ""))) > 1 and " " in str(qty_raw).strip():
                qty = 0.0

            # --- MATRAH VE İSKONTO KONTROLÜ (TL ÇEVRİMLİ) ---
            # a) Satır Brüt = LineExtensionAmount * fiili_kur
            satir_brut = to_float(line.findtext('./cbc:LineExtensionAmount', default="0", namespaces=ns))
            satir_brut_currency = line.find('./cbc:LineExtensionAmount', ns).get('currencyID', 'TRY') if line.find('./cbc:LineExtensionAmount', ns) is not None else 'TRY'
            
            # Döviz çevrimi
            if satir_brut_currency != 'TRY':
                satir_brut = round(satir_brut * fiili_kur, 2)
            
            # b) Satır bazlı AllowanceCharge (İskonto) kontrolü
            satir_iskonto_tutar = 0.0
            line_extension_is_discounted = False  # LineExtensionAmount zaten iskonto düşülmüş mü?
            allowance_charges = line.findall('./cac:AllowanceCharge', ns)
            for ac in allowance_charges:
                charge_indicator = ac.find('./cbc:ChargeIndicator', ns)
                if charge_indicator is not None and charge_indicator.text == 'false':
                    ac_amount = ac.find('./cbc:Amount', ns)
                    if ac_amount is not None and ac_amount.text:
                        ac_currency = ac_amount.get('currencyID', 'TRY')
                        ac_val = to_float(ac_amount.text)
                        if ac_currency != 'TRY':
                            ac_val = round(ac_val * fiili_kur, 2)
                        # BaseAmount kontrolü: LineExtensionAmount zaten iskonto düşülmüş mü?
                        base_amount_el = ac.find('./cbc:BaseAmount', ns)
                        if base_amount_el is not None and base_amount_el.text:
                            base_val = to_float(base_amount_el.text)
                            if ac_currency != 'TRY':
                                base_val = round(base_val * fiili_kur, 2)
                            if abs(satir_brut + ac_val - base_val) < 0.05:
                                line_extension_is_discounted = True
                        # Guard: İskonto satır tutarını geçiyorsa zaten net yazılmış.
                        if ac_val > satir_brut:
                            continue
                        satir_iskonto_tutar += ac_val

            # Satır iskontosunu toplama ekle
            toplam_satir_iskonto += satir_iskonto_tutar
            
            # c) ÖTV = Varsa satırdaki ÖTV kodlu vergi tutarı * fiili_kur
            # GIB ÖTV tip kodları: Liste I=0071, II=0072, III=0073, IV=0074, genel=9077
            OTV_KODLARI = {'0071', '0072', '0073', '0074', '9077'}
            otv_tutar = 0.0
            tax_subtotals = line.findall('./cac:TaxTotal/cac:TaxSubtotal', ns)
            for ts in tax_subtotals:
                # TaxTypeCode is inside TaxCategory/TaxScheme
                tax_type = ts.findtext('./cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode', default="", namespaces=ns)
                if tax_type in OTV_KODLARI:
                    otv_amt = ts.find('./cbc:TaxAmount', ns)
                    if otv_amt is not None and otv_amt.text:
                        otv_currency = otv_amt.get('currencyID', 'TRY')
                        otv_val = to_float(otv_amt.text)
                        if otv_currency != 'TRY':
                            otv_val = round(otv_val * fiili_kur, 2)
                        otv_tutar = otv_val
                        log_info(f"ÖTV bulundu: {otv_tutar} - {filename}")
                    break
            
            # d) KDV Matrah = Satır Brüt - (Satır İskonto veya 0) + ÖTV
            # Eğer LineExtensionAmount zaten iskonto düşülmüşse, satır iskontosunu düşme
            l_matrah = round(satir_brut - (0 if line_extension_is_discounted else satir_iskonto_tutar) + otv_tutar, 2)

            # --- KDV HESAPLAMA HİYERARŞİSİ ---
            l_kdv = 0.0
            kdv_orani = 0.0
            kdv_bulundu = False  # Satırda KDV (0% dahil) bilgisi var mı?
            
            # Satır içindeki TaxSubtotal bloklarını dolaş (sadece KDV için)
            tax_subtotals_line = line.findall('./cac:TaxTotal/cac:TaxSubtotal', ns)
            
            for ts_line in tax_subtotals_line:
                percent_el = ts_line.find('./cbc:Percent', ns)
                oran = to_float(percent_el.text) if percent_el is not None else 0.0
                
                # Sadece KDV (0015) oranını al, ÖTV'yi (9077) atla
                tax_type = ts_line.findtext('./cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode', default="", namespaces=ns)
                if tax_type == "0015":
                    kdv_orani = oran  # 0% da olsa kabul et
                    kdv_bulundu = True
                    log_info(f"Satır KDV oranı bulundu: %{kdv_orani} - {filename}")
                    break
            
            # Eğer satırda hiç KDV bilgisi yoksa (TaxSubtotal yoksa), genel oranı kullan
            if not kdv_bulundu:
                log_info(f"Genel TaxTotal'dan KDV oranı aranıyor - {filename}")
                # Fatura genelindeki TaxTotal bloğundan KDV oranlarını bul
                general_tax_subtotals = root.findall('.//cac:TaxTotal/cac:TaxSubtotal', ns)
                kdv_oranlari = []
                for gts in general_tax_subtotals:
                    g_percent_el = gts.find('./cbc:Percent', ns)
                    g_taxable_amt = gts.find('./cbc:TaxableAmount', ns)
                    g_tax_type = gts.findtext('./cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode', default="", namespaces=ns)
                    oran = to_float(g_percent_el.text) if g_percent_el is not None else 0.0
                    matrah = to_float(g_taxable_amt.text) if g_taxable_amt is not None else 0.0
                    
                    # Sadece KDV (0015) oranlarını al, ÖTV'yi (9077) atla
                    if oran > 0 and matrah > 0 and g_tax_type == "0015":
                        kdv_oranlari.append({'oran': oran, 'matrah': matrah})
                        log_info(f"Genel KDV oranı bulundu: %{oran}, matrah: {matrah} - {filename}")
                
                # Birden fazla KDV oranı varsa, en yüksek matrahlı (baskın) oranı seç
                if kdv_oranlari:
                    baskin_oran = max(kdv_oranlari, key=lambda x: x['matrah'])
                    kdv_orani = baskin_oran['oran']
                    log_info(f"Baskın KDV oranı seçildi: %{kdv_orani} - {filename}")
                else:
                    # Hiç KDV oranı bulunamadıysa 0 kabul et
                    kdv_orani = 0.0
                    log_warning(f"Hiç KDV oranı bulunamadı - {filename}")
            
            # e) KDV = round(Final Matrah * (kdv_orani / 100), 2)
            if kdv_orani > 0:
                l_kdv = round(l_matrah * (kdv_orani / 100), 2)

            # --- TEVKİFAT KONTROLÜ (TL ÇEVRİMLİ) ---
            # cac:WithholdingTaxTotal[] DİZİ — tüm elemanların TaxAmount'ları toplanır
            l_tevkifat_raw = 0.0
            for _wtt in line.findall('./cac:WithholdingTaxTotal', ns):
                _ta_el = _wtt.find('./cbc:TaxAmount', ns)
                if _ta_el is not None and _ta_el.text:
                    _val = to_float(_ta_el.text)
                    if _ta_el.get('currencyID', 'TRY') != 'TRY':
                        _val = round(_val * fiili_kur, 2)
                    l_tevkifat_raw += _val
            l_tevkifat = round(l_tevkifat_raw, 2)

            fatura_satirlari.append({
                "vkn": vkn, "unvan": unvan, "tarih": tarih, "no": f_no,
                "cins": cins, "miktar": qty, "matrah": l_matrah, "kdv": l_kdv, "tevkifat": l_tevkifat,
                "durum": fatura_durumu, "neden": fatura_nedeni
            })

        # --- GLOBAL İSKONTO DAĞITIMI ---
        # Satır iskontoları toplamı ile global iskonto karşılaştırması
        log_info(f"Satır iskontoları toplamı: {toplam_satir_iskonto:.2f}, Global iskonto: {global_iskonto:.2f} - {filename}")

        if abs(toplam_satir_iskonto - global_iskonto) < 0.05:
            # Satır iskontoları global iskontoyu kapsıyor (CommercialInvoice senaryosu)
            # Mevcut matrahlar doğru, hiçbir şey yapma
            log_info(f"Satır iskontoları global iskontoyu kapsıyor, mevcut matrahlar kullanılıyor - {filename}")
        elif toplam_satir_iskonto < 0.01 and global_iskonto > 0.01:
            # Satır iskontosu yok ama global iskonto var (kullanıcının sorunu)
            # Global iskontoyu satırlara oranlı dağıt
            log_info(f"Satır iskontosu yok, global iskonto satırlara dağıtılıyor - {filename}")
            toplam_matrah = sum(s['matrah'] for s in fatura_satirlari)
            if toplam_matrah > 0:
                for satir in fatura_satirlari:
                    oran = satir['matrah'] / toplam_matrah
                    satir_ek_iskonto = round(global_iskonto * oran, 2)
                    satir['matrah'] = round(satir['matrah'] - satir_ek_iskonto, 2)
                    # KDV'yi yeniden hesapla
                    if satir['kdv'] > 0 and satir['matrah'] > 0:
                        # KDV oranını mevcut KDV'den geri hesapla
                        kdv_orani = round((satir['kdv'] / (satir['matrah'] + satir_ek_iskonto)) * 100, 2)
                        satir['kdv'] = round(satir['matrah'] * kdv_orani / 100, 2)
                    log_info(f"Satır iskonto dağıtımı: {satir['cins']}, matrah: {satir['matrah']}, ek iskonto: {satir_ek_iskonto} - {filename}")
        else:
            # Ara durum: Satır iskontoları var ama global iskontoyu tam kapsamıyor
            # Mevcut mantığı koru, sadece logla
            log_info(f"Ara durum: Satır iskontoları var ama global iskontoyu tam kapsamıyor - {filename}")

        log_info(f"Parse sonuç: {len(fatura_satirlari)} satır - {filename}")
        return fatura_satirlari
    except Exception as e:
        import traceback
        error_detail = f"XML parsing hatası: {e}\n{traceback.format_exc()}"
        log_error(f"{error_detail} - Dosya: {filename}")
        print(f"Hata ({filename}):\n{error_detail}")
        return None
