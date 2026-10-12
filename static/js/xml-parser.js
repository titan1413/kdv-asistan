// Client-side XML Parser for GIB Invoices (UBL-TR v1.2.1)
// Follows exact UblTr schema hierarchy with strict namespace + direct-child traversal.
// Schema reference: https://github.com/hkutluay/UblTr

class GIBXMLParser {
    constructor() {
        this.CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
        this.CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
        // GIB ÖTV tip kodları: Liste I=0071, II=0072, III=0073, IV=0074, genel=9077
        this.OTV_KODLARI = new Set(['0071', '0072', '0073', '0074', '9077']);
    }

    // ─── Low-level DOM Helpers ───────────────────────────────────────────────────
    // All traversal is namespace-aware and limited to DIRECT children only.
    // This prevents accidental matches in deeply nested structures.

    // Returns the first direct child matching the given namespace + localName.
    _child(parent, ns, localName) {
        if (!parent) return null;
        for (const el of parent.children) {
            if (el.namespaceURI === ns && el.localName === localName) return el;
        }
        return null;
    }

    // Returns all direct children matching the given namespace + localName.
    _children(parent, ns, localName) {
        if (!parent) return [];
        const result = [];
        for (const el of parent.children) {
            if (el.namespaceURI === ns && el.localName === localName) result.push(el);
        }
        return result;
    }

    // Returns trimmed textContent of a direct child, or '' if not found.
    _text(parent, ns, localName) {
        const el = this._child(parent, ns, localName);
        return el ? (el.textContent?.trim() || '') : '';
    }

    // ─── Number Conversion ────────────────────────────────────────────────────

    toFloat(val) {
        if (!val) return 0.0;
        let s = String(val).trim();
        if (!s) return 0.0;
        if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        else if (s.includes(',')) s = s.replace(',', '.');
        const v = parseFloat(s);
        if (isNaN(v)) return 0.0;
        if (Math.abs(v) > 999999999.99) return v > 0 ? 999999999.99 : -999999999.99;
        return v;
    }

    // ─── Product Name Validator ───────────────────────────────────────────────

    isActualName(text) {
        if (!text || text.length < 2) return false;
        if (text.length === 2 && /^[A-Za-zçÇğĞıİöÖşŞüÜ]+$/.test(text)) return false;
        if (/^[0-9.\- ]+$/.test(text)) return false;
        if (/^[A-ZÇĞİÖŞÜa-zçğıöşü]+\s*[-–]\s*\d+\s*$/.test(text)) return false;
        const letters = (text.match(/[a-zA-ZçÇğĞıİöÖşŞüÜ]/g) || []).length;
        const digits  = (text.match(/[0-9]/g) || []).length;
        if (text.includes(' ') && letters >= digits && letters > 0) return true;
        if (letters > 0 && digits === 0) return true;
        if (letters > 0 && digits > 0 && !text.includes(' ')) return false;
        return letters > digits;
    }

    // ─── Entry Point ──────────────────────────────────────────────────────────

    parseXML(xmlString, filename) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) throw new Error('XML parse error: ' + parseError.textContent);
            return this._parseInvoice(xmlDoc.documentElement, filename);
        } catch (err) {
            console.error(`GIBXMLParser error (${filename}):`, err);
            return null;
        }
    }

    // ─── Invoice Level (InvoiceType) ──────────────────────────────────────────
    // Schema path: Invoice
    //   cbc:ID, cbc:IssueDate, cbc:InvoiceTypeCode
    //   cac:AccountingSupplierParty
    //   cac:TaxTotal[]
    //   cac:PricingExchangeRate
    //   cac:LegalMonetaryTotal
    //   cac:InvoiceLine[]  |  cac:CreditNoteLine[]

    _parseInvoice(root, filename) {
        const { CBC, CAC } = this;

        // cbc:ID → Fatura No (first direct child <cbc:ID> of root)
        const faturaNo = this._text(root, CBC, 'ID');

        // cbc:IssueDate → Tarih
        const tarih = this._parseTarih(this._text(root, CBC, 'IssueDate'));

        // cbc:InvoiceTypeCode
        const fTipi = this._text(root, CBC, 'InvoiceTypeCode').toUpperCase();

        // cac:AccountingSupplierParty > cac:Party
        const { vkn, unvan } = this._parseSupplierParty(
            this._child(root, CAC, 'AccountingSupplierParty')
        );

        // İstisna kodu: Invoice > cac:TaxTotal[] > cac:TaxSubtotal[] > cac:TaxCategory
        //   > cbc:TaxExemptionReasonCode / cbc:TaxExemptionReason
        const { istisnaKodu, istisnaMetni } = this._parseIstisna(root);

        // Skip conditions - mark but continue processing
        let faturaDurumu = null;
        let faturaNedeni = null;

        if (fTipi === 'IADE') {
            faturaDurumu = 'ATLANDI';
            faturaNedeni = 'İADE FATURASI';
        }
        if (istisnaKodu === '701' || istisnaMetni.includes('11/1-c')) {
            faturaDurumu = 'ATLANDI';
            faturaNedeni = 'İHRAÇ KAYITLI (701)';
        }

        // Döviz kuru
        const fiiliKur = this._parseFiiliKur(root);

        // cac:InvoiceLine[] veya cac:CreditNoteLine[]
        let lineEls = this._children(root, CAC, 'InvoiceLine');
        if (lineEls.length === 0) lineEls = this._children(root, CAC, 'CreditNoteLine');
        if (lineEls.length === 0) return [];

        // --- GLOBAL İSKONTO OKUMA ---
        const lmtEl = this._child(root, CAC, 'LegalMonetaryTotal');
        const allowanceTotalEl = lmtEl ? this._child(lmtEl, CBC, 'AllowanceTotalAmount') : null;
        const globalIskonto = allowanceTotalEl ? this.toFloat(allowanceTotalEl.textContent) : 0.0;

        const out = [];
        let toplamSatirIskonto = 0.0;
        for (const lineEl of lineEls) {
            const satirIskonto = this._processLine(lineEl, vkn, unvan, tarih, faturaNo, fiiliKur, out, faturaDurumu, faturaNedeni);
            toplamSatirIskonto += satirIskonto;
        }

        // --- GLOBAL İSKONTO DAĞITIMI ---
        if (Math.abs(toplamSatirIskonto - globalIskonto) < 0.05) {
            // Satır iskontoları global iskontoyu kapsıyor (CommercialInvoice senaryosu)
            // Mevcut matrahlar doğru, hiçbir şey yapma
        } else if (toplamSatirIskonto < 0.01 && globalIskonto > 0.01) {
            // Satır iskontosu yok ama global iskonto var (kullanıcının sorunu)
            // Global iskontoyu satırlara oranlı dağıt
            const toplamMatrah = out.reduce((sum, s) => sum + s.matrah, 0);
            if (toplamMatrah > 0) {
                for (const satir of out) {
                    const oran = satir.matrah / toplamMatrah;
                    const ekIskonto = Math.round(globalIskonto * oran * 100) / 100;
                    satir.matrah = Math.round((satir.matrah - ekIskonto) * 100) / 100;
                    // KDV'yi yeniden hesapla
                    if (satir.kdv > 0 && satir.matrah > 0) {
                        const kdvOrani = Math.round((satir.kdv / (satir.matrah + ekIskonto)) * 100 * 100) / 100;
                        satir.kdv = Math.round(satir.matrah * kdvOrani / 100 * 100) / 100;
                    }
                }
            }
        }

        return out;
    }

    // ─── Tarih ────────────────────────────────────────────────────────────────

    _parseTarih(raw) {
        if (!raw) return '';
        const tp = raw.split('-');
        if (tp.length === 3) {
            const y = parseInt(tp[0]), m = parseInt(tp[1]), d = parseInt(tp[2]);
            if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                return `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.${y}`;
            }
        }
        return raw;
    }

    // ─── Supplier Party ───────────────────────────────────────────────────────
    // Schema: AccountingSupplierParty > cac:Party
    //   cac:PartyIdentification[] > cbc:ID[@schemeID=VKN|TCKN]
    //   cbc:RegistrationName  |  cac:PartyName > cbc:Name  |  cac:Person

    _parseSupplierParty(supplierEl) {
        const { CBC, CAC } = this;
        let vkn = '', unvan = 'Bilinmiyor';
        if (!supplierEl) return { vkn, unvan };

        const partyEl = this._child(supplierEl, CAC, 'Party');
        if (!partyEl) return { vkn, unvan };

        // VKN / TCKN
        for (const pi of this._children(partyEl, CAC, 'PartyIdentification')) {
            const idEl = this._child(pi, CBC, 'ID');
            if (!idEl) continue;
            const scheme = (idEl.getAttribute('schemeID') || '').toUpperCase();
            if (scheme === 'VKN' || scheme === 'TCKN') {
                vkn = idEl.textContent?.trim() || '';
                break;
            }
        }
        if (!vkn) {
            const idEl = this._child(partyEl, CBC, 'ID');
            if (idEl) vkn = idEl.textContent?.trim() || '';
        }

        // Ünvan: RegistrationName > PartyName/Name > Person
        const regName = this._text(partyEl, CBC, 'RegistrationName');
        if (regName) {
            unvan = regName;
        } else {
            const partyNameEl = this._child(partyEl, CAC, 'PartyName');
            const nameVal = partyNameEl ? this._text(partyNameEl, CBC, 'Name') : '';
            if (nameVal) {
                unvan = nameVal;
            } else {
                const personEl = this._child(partyEl, CAC, 'Person');
                if (personEl) {
                    const ad = `${this._text(personEl, CBC, 'FirstName')} ${this._text(personEl, CBC, 'FamilyName')}`.trim();
                    unvan = ad || 'Bilinmiyor';
                }
            }
        }

        return { vkn, unvan };
    }

    // ─── İstisna Kodu ─────────────────────────────────────────────────────────
    // Schema: Invoice > cac:TaxTotal[] > cac:TaxSubtotal[] > cac:TaxCategory
    //   > cbc:TaxExemptionReasonCode, cbc:TaxExemptionReason

    _parseIstisna(root) {
        const { CBC, CAC } = this;
        let istisnaKodu = '', istisnaMetni = '';
        for (const tt of this._children(root, CAC, 'TaxTotal')) {
            for (const st of this._children(tt, CAC, 'TaxSubtotal')) {
                const catEl = this._child(st, CAC, 'TaxCategory');
                if (!catEl) continue;
                const kod  = this._text(catEl, CBC, 'TaxExemptionReasonCode');
                const metin = this._text(catEl, CBC, 'TaxExemptionReason');
                if (kod)   istisnaKodu  = kod;
                if (metin) istisnaMetni = metin;
            }
        }
        return { istisnaKodu, istisnaMetni };
    }

    // ─── Kur Hesaplama ────────────────────────────────────────────────────────
    // Schema: Invoice > cac:LegalMonetaryTotal > cbc:TaxExclusiveAmount[@currencyID]
    //   Kur kaynakları (öncelik sırasıyla):
    //   1) Invoice > cac:TaxTotal[] > cac:TaxSubtotal[] > cbc:TaxableAmount[@currencyID='TRY']
    //   2) Invoice > cac:PricingExchangeRate > cbc:CalculationRate

    _parseFiiliKur(root) {
        const { CBC, CAC } = this;
        let fiiliKur = 1.0;

        const lmtEl = this._child(root, CAC, 'LegalMonetaryTotal');
        const taxExclEl = lmtEl ? this._child(lmtEl, CBC, 'TaxExclusiveAmount') : null;
        if (!taxExclEl) return fiiliKur;

        const paraBirimi = taxExclEl.getAttribute('currencyID') || 'TRY';
        const anaMatrah  = this.toFloat(taxExclEl.textContent);
        if (paraBirimi === 'TRY' || anaMatrah <= 0) return fiiliKur;

        outer: for (const tt of this._children(root, CAC, 'TaxTotal')) {
            for (const st of this._children(tt, CAC, 'TaxSubtotal')) {
                const taEl = this._child(st, CBC, 'TaxableAmount');
                if (taEl && taEl.getAttribute('currencyID') === 'TRY') {
                    const tlMatrah = this.toFloat(taEl.textContent);
                    if (tlMatrah > 0) { fiiliKur = tlMatrah / anaMatrah; break outer; }
                }
            }
        }

        if (fiiliKur === 1.0) {
            // Önce TaxExchangeRate (vergi döviz kuru) kullan
            const taxRateEl = this._child(root, CAC, 'TaxExchangeRate');
            const taxRateValueEl = taxRateEl ? this._child(taxRateEl, CBC, 'CalculationRate') : null;
            if (taxRateValueEl) {
                const rate = this.toFloat(taxRateValueEl.textContent);
                if (rate > 0) fiiliKur = rate;
            } else {
                // TaxExchangeRate yoksa PricingExchangeRate (fiyatlandırma döviz kuru) kullan
                const perEl = this._child(root, CAC, 'PricingExchangeRate');
                const rateEl = perEl ? this._child(perEl, CBC, 'CalculationRate') : null;
                if (rateEl) {
                    const rate = this.toFloat(rateEl.textContent);
                    if (rate > 0) fiiliKur = rate;
                }
            }
        }

        return fiiliKur;
    }

    // ─── InvoiceLine İşleme ───────────────────────────────────────────────────
    // Schema: InvoiceLine
    //   cbc:Note[]
    //   cbc:InvoicedQuantity
    //   cbc:LineExtensionAmount[@currencyID]
    //   cac:AllowanceCharge[]
    //   cac:TaxTotal  (TEKİL — array DEĞİL)
    //     cac:TaxSubtotal[]
    //       cbc:TaxableAmount, cbc:Percent, cbc:TaxAmount
    //       cac:TaxCategory > cac:TaxScheme > cbc:TaxTypeCode
    //   cac:WithholdingTaxTotal[]  (DİZİ)
    //     cbc:TaxAmount[@currencyID]
    //   cac:Item > cbc:Name, cbc:Description
    //   cac:SubInvoiceLine[]  (öz-yinelemeli)

    _processLine(lineEl, vkn, unvan, tarih, faturaNo, fiiliKur, out, faturaDurumu, faturaNedeni) {
        const { CBC, CAC } = this;

        // SubInvoiceLine varsa bu satırı atla, alt satırları işle
        const subLines = this._children(lineEl, CAC, 'SubInvoiceLine');
        if (subLines.length > 0) {
            for (const sub of subLines) {
                this._processLine(sub, vkn, unvan, tarih, faturaNo, fiiliKur, out, faturaDurumu, faturaNedeni);
            }
            return;
        }

        // cbc:InvoicedQuantity
        const miktar = this._parseMiktar(this._child(lineEl, CBC, 'InvoicedQuantity'));

        // cbc:LineExtensionAmount
        const leaEl = this._child(lineEl, CBC, 'LineExtensionAmount');
        let satirBrut = this.toFloat(leaEl?.textContent);
        if (leaEl && (leaEl.getAttribute('currencyID') || 'TRY') !== 'TRY') {
            satirBrut = parseFloat((satirBrut * fiiliKur).toFixed(2));
        }

        // cac:TaxTotal (TEKİL — doğrudan çocuk)
        const lineTaxTotalEl = this._child(lineEl, CAC, 'TaxTotal');

        // NOT: skipAllowance mantığı kaldırıldı. TaxableAmount ≈ LineExtensionAmount
        // kontrolü satır iskontosunun zaten düşüldüğü anlamına gelmez.
        // Global iskonto dağıtım mantığı bu durumu ele alır.
        let skipAllowance = false;

        // cac:AllowanceCharge[] → iskonto (ChargeIndicator = false)
        let satirIskonto = 0.0;
        let lineExtensionIsDiscounted = false; // LineExtensionAmount zaten iskonto düşülmüş mü?
        if (!skipAllowance) {
            for (const ac of this._children(lineEl, CAC, 'AllowanceCharge')) {
                const ci = this._child(ac, CBC, 'ChargeIndicator');
                if (ci?.textContent !== 'false') continue;
                const amtEl = this._child(ac, CBC, 'Amount');
                if (!amtEl) continue;
                let acVal = this.toFloat(amtEl.textContent);
                if ((amtEl.getAttribute('currencyID') || 'TRY') !== 'TRY') {
                    acVal = parseFloat((acVal * fiiliKur).toFixed(2));
                }
                const baEl = this._child(ac, CBC, 'BaseAmount');
                if (baEl) {
                    let baVal = this.toFloat(baEl.textContent);
                    if ((baEl.getAttribute('currencyID') || 'TRY') !== 'TRY') {
                        baVal = parseFloat((baVal * fiiliKur).toFixed(2));
                    }
                    // Eğer satirBrut + acVal ≈ BaseAmount ise, LineExtensionAmount zaten iskonto düşülmüş
                    if (Math.abs(satirBrut + acVal - baVal) < 0.05) {
                        lineExtensionIsDiscounted = true;
                    }
                }
                if (acVal > satirBrut) continue;
                satirIskonto += acVal;
            }
        }

        // ÖTV (Liste I-IV: 0071-0074, genel: 9077) — cac:TaxTotal > cac:TaxSubtotal
        let otvTutar = 0.0;
        if (lineTaxTotalEl) {
            for (const st of this._children(lineTaxTotalEl, CAC, 'TaxSubtotal')) {
                if (!this.OTV_KODLARI.has(this._getTaxTypeCode(st))) continue;
                const taEl = this._child(st, CBC, 'TaxAmount');
                if (!taEl) break;
                let val = this.toFloat(taEl.textContent);
                if ((taEl.getAttribute('currencyID') || 'TRY') !== 'TRY') {
                    val = parseFloat((val * fiiliKur).toFixed(2));
                }
                otvTutar = val;
                break;
            }
        }

        // KDV Matrahı
        // Eğer LineExtensionAmount zaten iskonto düşülmüşse, satirIskonto'yu düşme
        const lMatrah = parseFloat((satirBrut - (lineExtensionIsDiscounted ? 0 : satirIskonto) + otvTutar).toFixed(2));

        // KDV (TaxTypeCode = 0015)
        const { lKdv } = this._parseKDV(lineEl, lineTaxTotalEl, lMatrah);

        // cac:WithholdingTaxTotal[] (DİZİ — doğrudan çocuklar)
        const lTevkifat = this._parseTevkifat(lineEl, fiiliKur);

        // cac:Item + cbc:Note[] → cins
        const itemEl  = this._child(lineEl, CAC, 'Item');
        const noteEls = this._children(lineEl, CBC, 'Note');
        const cins    = this._parseCins(itemEl, noteEls);

        out.push({ vkn, unvan, tarih, no: faturaNo, cins, miktar, matrah: lMatrah, kdv: lKdv, tevkifat: lTevkifat, durum: faturaDurumu, neden: faturaNedeni });

        return satirIskonto;
    }

    // ─── TaxTypeCode Okuyucu ──────────────────────────────────────────────────
    // Schema: TaxSubtotal > cac:TaxCategory > cac:TaxScheme > cbc:TaxTypeCode

    _getTaxTypeCode(taxSubtotalEl) {
        const { CBC, CAC } = this;
        const catEl    = this._child(taxSubtotalEl, CAC, 'TaxCategory');
        const schemeEl = catEl ? this._child(catEl, CAC, 'TaxScheme') : null;
        return schemeEl ? this._text(schemeEl, CBC, 'TaxTypeCode') : '';
    }

    // ─── Miktar ───────────────────────────────────────────────────────────────

    _parseMiktar(qtyEl) {
        if (!qtyEl) return 0.0;
        const raw = qtyEl.textContent || '0';
        let qty = this.toFloat(raw.replace(/[^0-9.,]/g, ''));
        if (qty < 0) qty = Math.abs(qty);
        if (qty > 999999999.99) qty = 999999999.99;
        const groups = raw.replace(/\./g, '').match(/\d+/g);
        if (groups && groups.length > 1 && raw.includes(' ')) qty = 0.0;
        return qty;
    }

    // ─── KDV ──────────────────────────────────────────────────────────────────
    // 1. Satır düzeyindeki TaxTotal > TaxSubtotal[@TaxTypeCode=0015]
    // 2. Yoksa fatura düzeyindeki TaxTotal[] içinde en yüksek matrahlı 0015

    _parseKDV(lineEl, lineTaxTotalEl, lMatrah) {
        const { CBC, CAC } = this;
        let kdvOrani = 0.0, kdvBulundu = false;

        if (lineTaxTotalEl) {
            for (const st of this._children(lineTaxTotalEl, CAC, 'TaxSubtotal')) {
                if (this._getTaxTypeCode(st) !== '0015') continue;
                kdvOrani   = this.toFloat(this._child(st, CBC, 'Percent')?.textContent);
                kdvBulundu = true;
                break;
            }
        }

        if (!kdvBulundu) {
            const root = lineEl.ownerDocument.documentElement;
            const kdvOranlari = [];
            for (const tt of this._children(root, CAC, 'TaxTotal')) {
                for (const st of this._children(tt, CAC, 'TaxSubtotal')) {
                    if (this._getTaxTypeCode(st) !== '0015') continue;
                    const oran   = this.toFloat(this._child(st, CBC, 'Percent')?.textContent);
                    const matrah = this.toFloat(this._child(st, CBC, 'TaxableAmount')?.textContent);
                    if (oran > 0 && matrah > 0) kdvOranlari.push({ oran, matrah });
                }
            }
            if (kdvOranlari.length > 0) {
                kdvOrani = kdvOranlari.reduce((max, x) => x.matrah > max.matrah ? x : max).oran;
            }
        }

        const lKdv = kdvOrani > 0 ? parseFloat((lMatrah * kdvOrani / 100).toFixed(2)) : 0.0;
        return { kdvOrani, lKdv };
    }

    // ─── Tevkifat ─────────────────────────────────────────────────────────────
    // Schema: InvoiceLine > cac:WithholdingTaxTotal[] > cbc:TaxAmount[@currencyID]
    // WithholdingTaxTotal bir DİZİ — tüm elemanların TaxAmount'ları toplanır.

    _parseTevkifat(lineEl, fiiliKur) {
        const { CBC, CAC } = this;
        let total = 0.0;
        for (const wtt of this._children(lineEl, CAC, 'WithholdingTaxTotal')) {
            const taEl = this._child(wtt, CBC, 'TaxAmount');
            if (!taEl) continue;
            let val = this.toFloat(taEl.textContent);
            if ((taEl.getAttribute('currencyID') || 'TRY') !== 'TRY') {
                val = parseFloat((val * fiiliKur).toFixed(2));
            }
            total += val;
        }
        return parseFloat(total.toFixed(2));
    }

    // ─── Cins (Ürün Adı) ─────────────────────────────────────────────────────
    // Schema: InvoiceLine > cac:Item > cbc:Name, cbc:Description
    //         InvoiceLine > cbc:Note[]  (dizi — tüm notlar taranır)

    _parseCins(itemEl, noteEls) {
        const { CBC } = this;
        const nameVal = itemEl ? this._text(itemEl, CBC, 'Name')        : '';
        const descVal = itemEl ? this._text(itemEl, CBC, 'Description') : '';

        const noteVals = [];
        for (const n of noteEls) {
            const raw = n.textContent?.trim() || '';
            if (!/^(Birim[_:]|ACK:|#NoPrint#|IND[1-6]\|m\||DigerVergiToplami:)/i.test(raw)) {
                noteVals.push(raw);
            }
        }

        for (const c of [nameVal, descVal, ...noteVals]) {
            if (this.isActualName(c)) return c;
        }

        if (nameVal && descVal) {
            if (nameVal.includes(' ') && !descVal.includes(' ')) return nameVal;
            if (descVal.includes(' ') && !nameVal.includes(' ')) return descVal;
            return nameVal.length >= descVal.length ? nameVal : descVal;
        }

        return nameVal || descVal || noteVals[0] || '---';
    }
}

// Export for use in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GIBXMLParser;
}
