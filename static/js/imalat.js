// Imalat Tab App - Burada tanımlı çünkü innerHTML ile yüklenen scriptler çalışmaz
function imalatTabApp() {
    return {
        baslamaTarihi: '',
        urunSayisi: 5,
        urunKodlari: ['', '', '', '', ''],
        urunKoduSuggestions: {},
        urunKoduSuggestionIndex: {},
        urunKoduUyari: null,
        donemler: [],
        sessionId: '',
        sampleExcelCooldown: 0,
        
        init() {
            this.sessionId = localStorage.getItem('imalat_session_id');
            if (!this.sessionId) {
                this.sessionId = 'imalat_' + Date.now();
                localStorage.setItem('imalat_session_id', this.sessionId);
            }
            window.addEventListener('imalat-tab-activated', () => this.loadData());
            this.loadData();
        },
        
        get urunListesi() {
            return Array.from({length: this.urunSayisi}, (_, i) => `Ürün ${i + 1}`);
        },
        
        get flatDonemRows() {
            let rows = [];
            for (let dIndex = 0; dIndex < this.donemler.length; dIndex++) {
                const donem = this.donemler[dIndex];
                // 1. Satır: Ürün Miktarları
                rows.push({
                    id: `um-${dIndex}`,
                    dIndex: dIndex,
                    etiket: donem.donemAdi,
                    isImalatTarihi: false
                });
                // 2. Satır: İmalat Tarihleri
                rows.push({
                    id: `it-${dIndex}`,
                    dIndex: dIndex,
                    etiket: `${donem.donemAdi} imalat tarihi`,
                    isImalatTarihi: true
                });
            }
            return rows;
        },
        
        createEmptyArray(size, fillValue) {
            return new Array(size).fill(fillValue);
        },
        
        async syncDonemlerFromMukellef() {
            const mukId = localStorage.getItem('active_mukellef_id') || '';
            const activeDonemId = localStorage.getItem('active_donem_id') || '';
            if (!mukId || !activeDonemId) return;
            const token = localStorage.getItem('session_token') || '';
            try {
                const r = await fetch(`/api/mukellef/${mukId}/donem/list`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await r.json();
                if (!d.success || !d.donemler || d.donemler.length === 0) return;
                const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                               'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                // Sadece aktif dönemi işle, tüm dönemler değil
                const activeDonem = d.donemler.find(donem => donem.id === activeDonemId);
                if (!activeDonem) return;
                const monthRows = this.parseEtiketToMonths(activeDonem.etiket, aylar);
                // Aktif dönemin aylarını belirle (temizlik için)
                const expectedMonths = new Set(monthRows);
                // Aktif döneme ait olmayan ayları temizle
                this.donemler = this.donemler.filter(m => expectedMonths.has(m.donemAdi));
                let added = false;
                for (const rowName of monthRows) {
                    if (!this.donemler.some(m => m.donemAdi === rowName)) {
                        this.donemler.push({
                            donemAdi: rowName,
                            urunMiktarlari: this.createEmptyArray(this.urunSayisi, ''),
                            imalatTarihleri: this.createEmptyArray(this.urunSayisi, ''),
                            genelGider: '0,00',
                            satisTarihi: ''
                        });
                        added = true;
                    }
                }
                if (added || this.donemler.length !== monthRows.length) this.saveData();
            } catch (e) {
                console.error('syncDonemlerFromMukellef error:', e);
            }
        },

        parseEtiketToMonths(etiket, aylar) {
            const months = [];
            const lastSlashIdx = etiket.lastIndexOf('/');
            if (lastSlashIdx === -1) return months;
            const yil = etiket.substring(lastSlashIdx + 1).trim();
            const monthsPart = etiket.substring(0, lastSlashIdx).trim();
            if (monthsPart.includes('-')) {
                const dashIdx = monthsPart.indexOf('-');
                const startName = monthsPart.substring(0, dashIdx).trim();
                const endName = monthsPart.substring(dashIdx + 1).trim();
                const startIdx = aylar.indexOf(startName);
                const endIdx = aylar.indexOf(endName);
                if (startIdx !== -1 && endIdx !== -1) {
                    for (let i = startIdx; i <= endIdx; i++) {
                        months.push(`${yil}/${String(i + 1).padStart(2, '0')}`);
                    }
                }
            } else {
                const monthIdx = aylar.indexOf(monthsPart);
                if (monthIdx !== -1) {
                    months.push(`${yil}/${String(monthIdx + 1).padStart(2, '0')}`);
                }
            }
            return months;
        },
        
        urunEkle() {
            this.urunSayisi++;
            this.urunKodlari.push('');
            for (let donem of this.donemler) {
                donem.urunMiktarlari.push('0,00');
                donem.imalatTarihleri.push('');
            }
            this.saveData();
        },
        
        urunSil() {
            if (this.urunSayisi <= 1) return;
            if (confirm('Son ürünü silmek istediğinize emin misiniz?')) {
                this.urunSayisi--;
                this.urunKodlari.pop();
                for (let donem of this.donemler) {
                    donem.urunMiktarlari.pop();
                    donem.imalatTarihleri.pop();
                }
                this.saveData();
            }
        },
        
        urunSilIndex(index) {
            if (this.urunSayisi <= 1) return;
            if (confirm(`Ürün ${index + 1} silinecek. Emin misiniz?`)) {
                this.urunSayisi--;
                this.urunKodlari.splice(index, 1);
                for (let donem of this.donemler) {
                    donem.urunMiktarlari.splice(index, 1);
                    donem.imalatTarihleri.splice(index, 1);
                }
                this.saveData();
            }
        },
        
        tarihleriYay() {
            const tarih = this.baslamaTarihi.trim().replace(/\//g, '.');
            if (!tarih) {
                alert('Lütfen önce yaymak istediğiniz tarihi giriniz!');
                return;
            }
            for (let donem of this.donemler) {
                for (let j = 0; j < this.urunSayisi; j++) {
                    donem.imalatTarihleri[j] = tarih;
                }
            }
            this.saveData();
        },

        baslamaTarihiKontrol(event) {
            const input = event.target;

            // Keydown event için özel kontrol
            if (event.type === 'keydown') {
                const key = event.key;
                // Enter, Backspace, Delete, Tab, Escape, rakam, nokta, slash karakterlerine izin ver
                const allowedKeys = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                const isDigit = /^\d$/.test(key);
                const isSeparator = key === '.' || key === '/';

                if (!allowedKeys.includes(key) && !isDigit && !isSeparator) {
                    event.preventDefault();
                    return;
                }

                // Enter tuşu için tarihleriYay fonksiyonunu çağır
                if (key === 'Enter') {
                    event.preventDefault();
                    this.tarihleriYay();
                    return;
                }

                // Geçerli değeri al ve yeni basılan tuşu simüle et
                if (isDigit) {
                    const currentValue = input.value;
                    const newValue = currentValue + key;
                    
                    // Ayırıcıyı belirle
                    const hasDot = currentValue.includes('.');
                    const hasSlash = currentValue.includes('/');
                    const separator = hasSlash ? '/' : '.';
                    
                    // Yeni değerden sadece rakamları al
                    const allDigits = newValue.replace(/[^0-9]/g, '');
                    
                    // Gün kontrolü (ilk 2 rakam)
                    if (allDigits.length === 1) {
                        const firstDayDigit = parseInt(allDigits[0]);
                        // İlk gün rakamı 0-3 olmalı
                        if (firstDayDigit > 3) {
                            event.preventDefault();
                            return;
                        }
                    }
                    if (allDigits.length === 2) {
                        const day = parseInt(allDigits.substring(0, 2));
                        // Gün 01-31 arası olmalı
                        if (day < 1 || day > 31) {
                            event.preventDefault();
                            return;
                        }
                    }
                    
                    // Ay kontrolü (3-4. rakamlar)
                    if (allDigits.length === 3) {
                        const monthFirstDigit = parseInt(allDigits[2]);
                        // Ayın ilk rakamı 0-1 olmalı
                        if (monthFirstDigit > 1) {
                            event.preventDefault();
                            return;
                        }
                    }
                    if (allDigits.length === 4) {
                        const month = parseInt(allDigits.substring(2, 4));
                        // Ay 01-12 arası olmalı
                        if (month < 1 || month > 12) {
                            event.preventDefault();
                            return;
                        }
                    }
                }
            }

            // Input event için değer kontrolü ve auto-format
            let value = input.value;
            
            // Sadece rakam, nokta ve slash karakterlerine izin ver
            let cleaned = value.replace(/[^0-9./]/g, '');
            
            // Hangi ayırıcı kullanıldığını belirle (ilk bulunan ayırıcıya göre)
            const hasDot = cleaned.includes('.');
            const hasSlash = cleaned.includes('/');
            
            // İkisini birden kullanmasına izin verme - ilk bulunana göre karar ver
            if (hasDot && hasSlash) {
                // İlk bulunanı koru, diğerini kaldır
                const dotIndex = cleaned.indexOf('.');
                const slashIndex = cleaned.indexOf('/');
                if (dotIndex < slashIndex) {
                    cleaned = cleaned.replace(/\//g, '');
                } else {
                    cleaned = cleaned.replace(/\./g, '');
                }
            }
            
            const separator = hasDot && !hasSlash ? '.' : (hasSlash && !hasDot ? '/' : '.');
            
            // Rakamları al
            const digits = cleaned.replace(/[^0-9]/g, '');
            
            // Maksimum 8 rakam (ggmmaaaa)
            let limitedDigits = digits.substring(0, 8);
            
            // Değer sınırlamaları uygula
            if (limitedDigits.length >= 1) {
                const firstDayDigit = parseInt(limitedDigits[0]);
                if (firstDayDigit > 3) {
                    limitedDigits = limitedDigits.substring(0, 0); // Sil
                }
            }
            if (limitedDigits.length >= 2) {
                const day = parseInt(limitedDigits.substring(0, 2));
                if (day > 31) {
                    limitedDigits = limitedDigits.substring(0, 1); // İkinci rakamı sil
                }
            }
            if (limitedDigits.length >= 3) {
                const monthFirstDigit = parseInt(limitedDigits[2]);
                if (monthFirstDigit > 1) {
                    limitedDigits = limitedDigits.substring(0, 2); // Üçüncü rakamı sil
                }
            }
            if (limitedDigits.length >= 4) {
                const month = parseInt(limitedDigits.substring(2, 4));
                if (month > 12 || month < 1) {
                    limitedDigits = limitedDigits.substring(0, 3); // Dördüncü rakamı sil
                }
            }
            
            // Auto-format: gg.aa.yyyy veya gg/aa/yyyy
            let formatted = '';
            if (limitedDigits.length >= 1) {
                // Gün (1-2 karakter)
                formatted = limitedDigits.substring(0, 2);
            }
            if (limitedDigits.length >= 3) {
                // Ay (3-4 karakter) - ayırıcı ekle
                formatted += separator + limitedDigits.substring(2, 4);
            }
            if (limitedDigits.length >= 5) {
                // Yıl (5-8 karakter) - ayırıcı ekle
                formatted += separator + limitedDigits.substring(4, 8);
            }
            
            // Değerleri güncelle
            input.value = formatted;
            this.baslamaTarihi = formatted;
        },

        handleBaslamaTarihiEnter(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.tarihleriYay();
            }
        },
        
        async urunKoduKontrol(colIndex) {
            const val = this.urunKodlari[colIndex];
            if (!val || val.trim() === '') return;
            const valUpper = val.trim().toUpperCase();
            for (let i = 0; i < this.urunSayisi; i++) {
                if (i !== colIndex && this.urunKodlari[i] && this.urunKodlari[i].trim().toUpperCase() === valUpper) {
                    alert(`'${valUpper}' kodlu ürün zaten tabloda mevcut!`);
                    this.urunKodlari[colIndex] = '';
                    return;
                }
            }
            this.urunKodlari[colIndex] = valUpper;
            const mukId = localStorage.getItem('active_mukellef_id') || '';
            if (mukId) {
                try {
                    const token = localStorage.getItem('session_token') || '';
                    const r = await fetch(`/api/urun-listesi/check-kod?kod=${encodeURIComponent(valUpper)}`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Mukellef-Id': mukId }
                    });
                    const data = await r.json();
                    if (!data.exists) {
                        this.urunKoduUyari = `Ürün ${colIndex + 1} "${valUpper}" ürün listesinde bulunamamıştır.`;
                    }
                } catch (e) { /* API hatası - uyarı verme */ }
            }
            this.saveData();
        },
        
        urunMiktariKontrol(dIndex, cIndex) {
            const donem = this.donemler[dIndex];
            let val = donem.urunMiktarlari[cIndex];
            
            if (!val || val.trim() === '' || val.trim() === '-') {
                donem.urunMiktarlari[cIndex] = '0,00';
            } else {
                let cleanVal = val.replace(/\./g, '').replace(',', '.');
                let num = parseFloat(cleanVal);
                if (isNaN(num)) {
                    donem.urunMiktarlari[cIndex] = '0,00';
                } else {
                    donem.urunMiktarlari[cIndex] = num.toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                }
            }
            this.saveData();
        },
        
        imalatTarihiInputKontrol(dIndex, cIndex, event) {
            const input = event.target;
            let value = input.value;

            // Sadece rakam, nokta ve slash karakterlerine izin ver
            let cleaned = value.replace(/[^0-9./]/g, '');

            // Hangi ayırıcı kullanıldığını belirle
            const hasDot = cleaned.includes('.');
            const hasSlash = cleaned.includes('/');

            // İkisini birden kullanmasına izin verme
            if (hasDot && hasSlash) {
                const dotIndex = cleaned.indexOf('.');
                const slashIndex = cleaned.indexOf('/');
                if (dotIndex < slashIndex) {
                    cleaned = cleaned.replace(/\//g, '');
                } else {
                    cleaned = cleaned.replace(/\./g, '');
                }
            }

            const separator = cleaned.includes('/') ? '/' : '.';
            const digits = cleaned.replace(/[^0-9]/g, '');
            let ld = digits.substring(0, 8);

            // Gün kontrolü
            if (ld.length >= 1 && parseInt(ld[0]) > 3) ld = '';
            if (ld.length >= 2 && (parseInt(ld.substring(0, 2)) < 1 || parseInt(ld.substring(0, 2)) > 31)) ld = ld.substring(0, 1);
            // Ay kontrolü
            if (ld.length >= 3 && parseInt(ld[2]) > 1) ld = ld.substring(0, 2);
            if (ld.length >= 4 && (parseInt(ld.substring(2, 4)) < 1 || parseInt(ld.substring(2, 4)) > 12)) ld = ld.substring(0, 3);

            // Auto-format: GG.AA.YYYY
            let formatted = ld.substring(0, Math.min(2, ld.length));
            if (ld.length >= 3) formatted += separator + ld.substring(2, Math.min(4, ld.length));
            if (ld.length >= 5) formatted += separator + ld.substring(4, 8);

            input.value = formatted;
            this.donemler[dIndex].imalatTarihleri[cIndex] = formatted;
        },

        imalatTarihiKontrol(dIndex, cIndex) {
            const donem = this.donemler[dIndex];
            let val = donem.imalatTarihleri[cIndex];
            if (!val || val.trim() === '') return;
            val = val.trim().replace(/\//g, '.');
            
            // Eğer tarih formatında ise (gg.aa.yyyy veya gg-aa-yyyy), düzelt
            if (val.includes('-') || val.includes('.')) {
                // Tarih formatını normalize et
                const parts = val.replace(/\./g, '-').split('-');
                if (parts.length === 3) {
                    const day = parts[0].padStart(2, '0');
                    const month = parts[1].padStart(2, '0');
                    const year = parts[2].split(' ')[0]; // Saat kısmını kaldır
                    val = `${day}.${month}.${year}`;
                }
            }
            
            donem.imalatTarihleri[cIndex] = val;
            this.saveData();
        },
        
        genelGiderInputKontrol(dIndex, event) {
            const input = event.target;
            let value = input.value;
            
            // Sadece rakam, virgül ve noktaya izin ver
            let cleaned = value.replace(/[^0-9.,]/g, '');
            
            // Birden fazla ayırıcı varsa sadece ilkini koru
            const firstComma = cleaned.indexOf(',');
            const firstDot = cleaned.indexOf('.');
            
            if (firstComma !== -1 && firstDot !== -1) {
                // İkisi de varsa, sonrakileri kaldır
                if (firstComma < firstDot) {
                    cleaned = cleaned.substring(0, firstDot + 1) + cleaned.substring(firstDot + 1).replace(/[.,]/g, '');
                } else {
                    cleaned = cleaned.substring(0, firstComma + 1) + cleaned.substring(firstComma + 1).replace(/[.,]/g, '');
                }
            } else if (firstComma !== -1) {
                cleaned = cleaned.substring(0, firstComma + 1) + cleaned.substring(firstComma + 1).replace(/,/g, '');
            } else if (firstDot !== -1) {
                cleaned = cleaned.substring(0, firstDot + 1) + cleaned.substring(firstDot + 1).replace(/\./g, '');
            }
            
            // Sayıya çevir ve 0-100 sınırla
            let cleanVal = cleaned.replace(/\./g, '').replace(',', '.');
            let num = parseFloat(cleanVal);
            
            if (!isNaN(num)) {
                if (num > 100) {
                    // 100'ü aşıyorsa, sadece ilk 3 karakteri al (100 için)
                    const digitsOnly = cleaned.replace(/[^0-9]/g, '');
                    if (digitsOnly.length > 3) {
                        cleaned = cleaned.substring(0, cleaned.length - 1);
                    }
                    // Eğer hala 100'den büyükse, 100 yap
                    cleanVal = cleaned.replace(/\./g, '').replace(',', '.');
                    num = parseFloat(cleanVal);
                    if (num > 100) {
                        cleaned = '100';
                    }
                }
                if (num < 0) {
                    cleaned = '0';
                }
            }
            
            input.value = cleaned;
            this.donemler[dIndex].genelGider = cleaned;
        },

        donemGGKontrol(dIndex) {
            const donem = this.donemler[dIndex];
            let val = donem.genelGider;
            if (!val || val.trim() === '') {
                donem.genelGider = '0,00';
            } else {
                let cleanVal = val.replace(/\\./g, '').replace(',', '.');
                let num = parseFloat(cleanVal);
                if (isNaN(num)) {
                    donem.genelGider = '0,00';
                } else {
                    // 0-100 arası sınırla
                    num = Math.max(0, Math.min(100, num));
                    donem.genelGider = num.toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                }
            }
            this.saveData();
        },
        
        donemSatisTarihiKontrol(dIndex) {
            const donem = this.donemler[dIndex];
            let val = donem.satisTarihi;
            if (!val) return;
            val = val.trim().replace(/\//g, '.');
            
            // Eğer tarih formatında ise (gg.aa.yyyy veya gg-aa-yyyy), düzelt
            if (val.includes('-') || val.includes('.')) {
                // Tarih formatını normalize et
                const parts = val.replace(/\./g, '-').split('-');
                if (parts.length === 3) {
                    const day = parts[0].padStart(2, '0');
                    const month = parts[1].padStart(2, '0');
                    const year = parts[2].split(' ')[0]; // Saat kısmını kaldır
                    val = `${day}.${month}.${year}`;
                }
            }
            
            donem.satisTarihi = val;
            this.saveData();
        },
        
        async fetchUrunKoduSuggestions(cIndex, q) {
            if (!q || q.length < 1) {
                this.urunKoduSuggestions = { ...this.urunKoduSuggestions, [cIndex]: [] };
                return;
            }
            const token = localStorage.getItem('session_token') || '';
            const mukId = localStorage.getItem('active_mukellef_id') || '';
            const headers = { 'Authorization': `Bearer ${token}` };
            if (mukId) headers['X-Mukellef-Id'] = mukId;
            try {
                const r = await fetch(`/api/urun-listesi/search-kodlar?q=${encodeURIComponent(q)}`, { headers });
                const data = await r.json();
                this.urunKoduSuggestions = { ...this.urunKoduSuggestions, [cIndex]: data.items || [] };
                this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [cIndex]: -1 };
            } catch (e) {
                this.urunKoduSuggestions = { ...this.urunKoduSuggestions, [cIndex]: [] };
                this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [cIndex]: -1 };
            }
        },

        selectUrunKodu(cIndex, kodu) {
            this.urunKodlari[cIndex] = kodu;
            this.urunKoduSuggestions = { ...this.urunKoduSuggestions, [cIndex]: [] };
            this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [cIndex]: -1 };
            this.urunKoduKontrol(cIndex);
        },

        closeUrunKoduSuggestions(cIndex) {
            this.urunKoduSuggestions = { ...this.urunKoduSuggestions, [cIndex]: [] };
            this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [cIndex]: -1 };
        },

        // Klavye navigasyonu - input'tan cikinca sonraki hucreye git
        handleCellKeydown(event, type, indices) {
            const key = event.key;

            // urunKodu dropdown klavye navigasyonu
            if (type === 'urunKodu') {
                const _sugg = this.urunKoduSuggestions[indices.cIndex] || [];
                const _idx = this.urunKoduSuggestionIndex[indices.cIndex] ?? -1;
                if (key === 'Escape') {
                    this.urunKoduSuggestions = { ...this.urunKoduSuggestions, [indices.cIndex]: [] };
                    this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [indices.cIndex]: -1 };
                    return;
                }
                if (_sugg.length > 0 && key === 'ArrowDown') {
                    event.preventDefault();
                    this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [indices.cIndex]: Math.min(_idx + 1, _sugg.length - 1) };
                    return;
                }
                if (_sugg.length > 0 && key === 'ArrowUp') {
                    event.preventDefault();
                    this.urunKoduSuggestionIndex = { ...this.urunKoduSuggestionIndex, [indices.cIndex]: Math.max(_idx - 1, -1) };
                    return;
                }
                if (_sugg.length > 0 && key === 'Enter' && _idx >= 0) {
                    event.preventDefault();
                    this.selectUrunKodu(indices.cIndex, _sugg[_idx]);
                    return;
                }
            }
            
            // Enter - sonraki satira gec
            if (key === 'Enter') {
                event.preventDefault();
                this.moveToNextCell(type, indices);
                return;
            }
            
            // Yon tuslari
            if (key === 'ArrowDown') {
                event.preventDefault();
                this.moveToNextRow(type, indices);
            } else if (key === 'ArrowUp') {
                event.preventDefault();
                this.moveToPrevRow(type, indices);
            } else if (key === 'ArrowRight') {
                event.preventDefault();
                this.moveToNextCol(type, indices);
            } else if (key === 'ArrowLeft') {
                event.preventDefault();
                this.moveToPrevCol(type, indices);
            }
        },
        
        moveToNextCell(type, indices) {
            if (type === 'urunKodu') {
                // Urun kodu satirinda - yana gec
                if (indices.cIndex < this.urunSayisi - 1) {
                    this.focusInput(`uk-0-${indices.cIndex + 1}`);
                }
            } else if (type === 'urunMiktari') {
                const { dIndex, cIndex } = indices;
                if (cIndex < this.urunSayisi - 1) {
                    this.focusInput(`um-${dIndex}-${cIndex + 1}`);
                }
            } else if (type === 'imalatTarihi') {
                const { dIndex, cIndex } = indices;
                if (cIndex < this.urunSayisi - 1) {
                    this.focusInput(`it-${dIndex}-${cIndex + 1}`);
                }
            } else if (type === 'genelGider') {
                this.focusInput(`st-${indices.dIndex}`);
            } else if (type === 'satisTarihi') {
                // Sonraki donemin ilk hucreye git
                if (indices.dIndex < this.donemler.length - 1) {
                    this.focusInput(`um-${indices.dIndex + 1}-0`);
                }
            }
        },
        
        moveToNextRow(type, indices) {
            if (type === 'urunKodu') {
                // Urun kodu satirindan ilk donemin urun miktari satirina
                if (this.donemler.length > 0) {
                    this.focusInput(`um-0-${indices.cIndex}`);
                }
            } else if (type === 'urunMiktari') {
                const { dIndex, cIndex } = indices;
                // Ayni donemin imalat tarihi satirina
                this.focusInput(`it-${dIndex}-${cIndex}`);
            } else if (type === 'imalatTarihi') {
                const { dIndex, cIndex } = indices;
                // Sonraki donemin urun miktari satirina
                if (dIndex < this.donemler.length - 1) {
                    this.focusInput(`um-${dIndex + 1}-${cIndex}`);
                }
            } else if (type === 'genelGider') {
                // Ayni donemin imalat tarihi satirinin ilk hucreye
                this.focusInput(`it-${indices.dIndex}-0`);
            } else if (type === 'satisTarihi') {
                // Sonraki donemin satis tarihine
                if (indices.dIndex < this.donemler.length - 1) {
                    this.focusInput(`st-${indices.dIndex + 1}`);
                }
            }
        },
        
        moveToPrevRow(type, indices) {
            if (type === 'urunMiktari') {
                const { dIndex, cIndex } = indices;
                if (dIndex === 0) {
                    // Ilk donemse urun kodu satirina
                    this.focusInput(`uk-0-${cIndex}`);
                } else {
                    // Onceki donemin imalat tarihine
                    this.focusInput(`it-${dIndex - 1}-${cIndex}`);
                }
            } else if (type === 'imalatTarihi') {
                const { dIndex, cIndex } = indices;
                // Ayni donemin urun miktari satirina
                this.focusInput(`um-${dIndex}-${cIndex}`);
            } else if (type === 'genelGider') {
                // Urun miktari satirina (son sutun)
                this.focusInput(`um-${indices.dIndex}-${this.urunSayisi - 1}`);
            } else if (type === 'satisTarihi') {
                // Ayni donemin genel giderine
                this.focusInput(`gg-${indices.dIndex}`);
            }
        },
        
        moveToNextCol(type, indices) {
            if (type === 'urunKodu') {
                if (indices.cIndex < this.urunSayisi - 1) {
                    this.focusInput(`uk-0-${indices.cIndex + 1}`);
                }
            } else if (type === 'urunMiktari') {
                const { dIndex, cIndex } = indices;
                if (cIndex < this.urunSayisi - 1) {
                    this.focusInput(`um-${dIndex}-${cIndex + 1}`);
                } else {
                    // Son sutundaysa genel gider'e git
                    this.focusInput(`gg-${dIndex}`);
                }
            } else if (type === 'imalatTarihi') {
                const { dIndex, cIndex } = indices;
                if (cIndex < this.urunSayisi - 1) {
                    this.focusInput(`it-${dIndex}-${cIndex + 1}`);
                }
            } else if (type === 'genelGider') {
                // Satis tarihine git
                this.focusInput(`st-${indices.dIndex}`);
            }
        },
        
        moveToPrevCol(type, indices) {
            if (type === 'urunKodu') {
                if (indices.cIndex > 0) {
                    this.focusInput(`uk-0-${indices.cIndex - 1}`);
                }
            } else if (type === 'urunMiktari') {
                const { dIndex, cIndex } = indices;
                if (cIndex > 0) {
                    this.focusInput(`um-${dIndex}-${cIndex - 1}`);
                }
            } else if (type === 'imalatTarihi') {
                const { dIndex, cIndex } = indices;
                if (cIndex > 0) {
                    this.focusInput(`it-${dIndex}-${cIndex - 1}`);
                }
            } else if (type === 'genelGider') {
                // Son urun miktari'na git
                this.focusInput(`um-${indices.dIndex}-${this.urunSayisi - 1}`);
            } else if (type === 'satisTarihi') {
                // Genel gider'e git
                this.focusInput(`gg-${indices.dIndex}`);
            }
        },
        
        focusInput(inputId) {
            this.$nextTick(() => {
                const input = document.querySelector(`[data-input-id="${inputId}"]`);
                if (input) {
                    input.focus();
                    input.select();
                }
            });
        },
        
        saveData() {
            const data = {
                urunSayisi: this.urunSayisi,
                urunKodlari: this.urunKodlari,
                donemler: this.donemler,
                sessionId: this.sessionId
            };
            const _iToken = localStorage.getItem('session_token') || '';
            const _iMukId = localStorage.getItem('active_mukellef_id') || '';
            const _iDId = localStorage.getItem('active_donem_id') || '';
            const _iHeaders = {'Content-Type': 'application/json', 'Authorization': `Bearer ${_iToken}`};
            if (_iMukId) _iHeaders['X-Mukellef-Id'] = _iMukId;
            if (_iDId) _iHeaders['X-Donem-Id'] = _iDId;
            fetch('/imalat/save-data', {
                method: 'POST',
                headers: _iHeaders,
                body: JSON.stringify(data)
            }).catch(e => console.error('Save error:', e));
        },
        
        async loadData() {
            try {
                const _ilToken = localStorage.getItem('session_token') || '';
                const _ilMukId = localStorage.getItem('active_mukellef_id') || '';
                const _ilDId = localStorage.getItem('active_donem_id') || '';
                const _ilHeaders = { 'Authorization': `Bearer ${_ilToken}` };
                if (_ilMukId) _ilHeaders['X-Mukellef-Id'] = _ilMukId;
                if (_ilDId) _ilHeaders['X-Donem-Id'] = _ilDId;
                const response = await fetch('/imalat/get-data', { headers: _ilHeaders });
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data) {
                        const data = result.data;
                        this.urunSayisi = data.urunSayisi || 5;
                        this.urunKodlari = data.urunKodlari || ['', '', '', '', ''];
                        this.donemler = data.donemler || [];
                        
                        // Eski veri uyumlulugu: urunKodlari varsa urunMiktarlari'na donustur
                        for (let donem of this.donemler) {
                            if (donem.urunKodlari && !donem.urunMiktarlari) {
                                donem.urunMiktarlari = donem.urunKodlari.map(() => '0,00');
                                delete donem.urunKodlari;
                            }
                            // urunMiktarlari yoksa varsayilan degerlerle olustur
                            if (!donem.urunMiktarlari) {
                                donem.urunMiktarlari = this.createEmptyArray(this.urunSayisi, '0,00');
                            }
                            if (!donem.imalatTarihleri) {
                                donem.imalatTarihleri = this.createEmptyArray(this.urunSayisi, '');
                            }
                        }
                    } else {
                        this.urunSayisi = 5;
                        this.urunKodlari = ['', '', '', '', ''];
                        this.donemler = [];
                    }
                }
            } catch (e) {
                console.error('Load error:', e);
                this.urunSayisi = 5;
                this.urunKodlari = ['', '', '', '', ''];
                this.donemler = [];
            }
            await this.syncDonemlerFromMukellef();
        },
        
        async kaydet() {
            await this.saveData();
            alert('Veriler kaydedildi!');
        },
        
        async excelExport() {
            try {
                const _imalatToken = localStorage.getItem('session_token') || '';
                const _imalatMukId = localStorage.getItem('active_mukellef_id') || '';
                const _imalatDId = localStorage.getItem('active_donem_id') || '';
                const _imalatHeaders = {'Content-Type': 'application/json', 'Authorization': `Bearer ${_imalatToken}`};
                if (_imalatMukId) _imalatHeaders['X-Mukellef-Id'] = _imalatMukId;
                if (_imalatDId) _imalatHeaders['X-Donem-Id'] = _imalatDId;
                const response = await fetch('/imalat/export-excel', {
                    method: 'POST',
                    headers: _imalatHeaders,
                    body: JSON.stringify({
                        urunSayisi: this.urunSayisi,
                        urunKodlari: this.urunKodlari,
                        donemler: this.donemler
                    })
                });
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'imalat_listesi.xlsx';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } else {
                    alert('Excel export hatasi!');
                }
            } catch (e) {
                alert('Excel export hatasi: ' + e.message);
            }
        },
        
        downloadSampleExcel() {
            if (this.sampleExcelCooldown > 0) return;
            const link = document.createElement('a');
            link.href = '/imalat/sample-excel';
            link.download = 'ornek_imalat_listesi.xlsx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            this.sampleExcelCooldown = 60;
            const timer = setInterval(() => {
                this.sampleExcelCooldown--;
                if (this.sampleExcelCooldown <= 0) clearInterval(timer);
            }, 1000);
        },
        
        isDragging: false,
        
        handleDrop(e) {
            e.preventDefault();
            this.isDragging = false;
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
            if (files.length > 0) {
                this.uploadFile(files[0]);
            }
        },
        
        handleFileSelect(e) {
            const files = Array.from(e.target.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
            if (files.length > 0) {
                this.uploadFile(files[0]);
            }
        },
        
        uploadFile(file) {
            const formData = new FormData();
            formData.append('file', file);
            
            const _iuToken = localStorage.getItem('session_token') || '';
            const _iuMukId = localStorage.getItem('active_mukellef_id') || '';
            const _iuDId = localStorage.getItem('active_donem_id') || '';
            const _iuHeaders = { 'Authorization': `Bearer ${_iuToken}` };
            if (_iuMukId) _iuHeaders['X-Mukellef-Id'] = _iuMukId;
            if (_iuDId) _iuHeaders['X-Donem-Id'] = _iuDId;
            fetch('/imalat/upload-excel', {
                method: 'POST',
                headers: _iuHeaders,
                body: formData
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    this.urunSayisi = result.data.urunSayisi || 5;
                    this.urunKodlari = result.data.urunKodlari || ['', '', '', '', ''];
                    this.donemler = result.data.donemler || [];
                    
                    // Tarihleri formatla - saat bilgisini kaldir
                    for (let donem of this.donemler) {
                        // İmalat tarihleri
                        for (let i = 0; i < donem.imalatTarihleri.length; i++) {
                            let val = donem.imalatTarihleri[i];
                            if (val && val.includes(' ')) {
                                // Saat bilgisini kaldir
                                val = val.split(' ')[0];
                                // Formatla: gg.aa.yyyy
                                if (val.includes('-')) {
                                    const parts = val.split('-');
                                    if (parts.length === 3) {
                                        val = `${parts[2]}.${parts[1]}.${parts[0]}`;
                                    }
                                }
                                donem.imalatTarihleri[i] = val;
                            }
                        }
                        
                        // Satış tarihi
                        if (donem.satisTarihi && donem.satisTarihi.includes(' ')) {
                            let val = donem.satisTarihi.split(' ')[0];
                            if (val.includes('-')) {
                                const parts = val.split('-');
                                if (parts.length === 3) {
                                    val = `${parts[2]}.${parts[1]}.${parts[0]}`;
                                }
                            }
                            donem.satisTarihi = val;
                        }
                    }
                    
                    this.saveData();
                    alert('Excel dosyası başarıyla yüklendi!');
                } else {
                    alert('Excel yükleme hatası: ' + (result.error || 'Bilinmeyen hata'));
                }
            })
            .catch(e => {
                alert('Excel yükleme hatası: ' + e.message);
            });
            
            // Input'u temizle
            if (this.$refs.fileInput) {
                this.$refs.fileInput.value = '';
            }
        }
    }
}
