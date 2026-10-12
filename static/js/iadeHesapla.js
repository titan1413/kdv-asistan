// İade Hesapla Tab App - Global olarak tanımla
window.iadeHesaplaApp = function() {
    return {
        stokTutari: '0,00',
        yontem: 'FIFO',
        sonucVerileri: [],
        toplamYuklenim: 0,
        isCalculating: false,
        progressMessage: 'Hesaplanıyor...',
        progressDetail: 'Veriler işleniyor',
        progressPercent: 0,
        sessionId: '',

        initApp() {
            // Persist session ID across page reloads
            this.sessionId = localStorage.getItem('iade_session_id');
            if (!this.sessionId) {
                this.sessionId = 'session_' + Date.now();
                localStorage.setItem('iade_session_id', this.sessionId);
            }
            
            // Load saved data if exists
            this.loadSavedData();
        },

        formatStokTutari() {
            // Format the stock amount with Turkish number format
            let val = this.stokTutari.replace(/\./g, '').replace(',', '.');
            let num = parseFloat(val) || 0;
            this.stokTutari = num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        formatTL(sayi) {
            return parseFloat(sayi).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
        },

        async hesaplamayiTetikle() {
            if (this.isCalculating) return;
            
            this.isCalculating = true;
            this.progressPercent = 0;
            this.progressMessage = 'Veriler doğrulanıyor...';
            this.progressDetail = 'Hesaplama motoru başlatılıyor';

            try {
                // Simulate progress updates
                this.simulateProgress();
                
                // Call backend API
                const _iadToken = localStorage.getItem('session_token') || '';
                const _iadMukId = localStorage.getItem('active_mukellef_id') || '';
                const _iadDId = localStorage.getItem('active_donem_id') || '';
                const _iadHeaders = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_iadToken}`
                };
                if (_iadMukId) _iadHeaders['X-Mukellef-Id'] = _iadMukId;
                if (_iadDId) _iadHeaders['X-Donem-Id'] = _iadDId;
                const response = await fetch('/iade-hesapla/calculate', {
                    method: 'POST',
                    headers: _iadHeaders,
                    body: JSON.stringify({
                        stok_tutari: this.stokTutari,
                        yontem: this.yontem
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    // Use actual data from calculation engine
                    this.sonucVerileri = result.sonuc_verileri || [];
                    this.toplamYuklenim = result.toplam_yuklenim || 0;
                    
                    // Save data
                    await this.saveData();
                    
                    // Log warning if any (no alert)
                    if (result.uyari_metni) {
                        console.warn('Uyarılar:', result.uyari_metni);
                    }
                } else {
                    // Show error
                    alert('Hata:\n\n' + result.error);
                    this.sonucVerileri = [];
                    this.toplamYuklenim = 0;
                }
            } catch (error) {
                console.error('Hesaplama hatası:', error);
                alert('Hesaplama sırasında bir hata oluştu: ' + error.message);
            } finally {
                this.isCalculating = false;
                this.progressPercent = 100;
            }
        },

        simulateProgress() {
            const steps = [
                { percent: 10, message: 'Veriler doğrulanıyor...', detail: 'Fatura verileri okunuyor' },
                { percent: 30, message: 'Hesaplama motoru çalışıyor...', detail: 'İmalat tablosu işleniyor' },
                { percent: 50, message: 'Hesaplama devam ediyor...', detail: 'Yüklenimler hesaplanıyor' },
                { percent: 70, message: 'Sonuçlar hazırlanıyor...', detail: 'Satırlar biçimlendiriliyor' },
                { percent: 90, message: 'Neredeyse bitti...', detail: 'Son düzenlemeler yapılıyor' }
            ];

            let stepIndex = 0;
            const interval = setInterval(() => {
                if (stepIndex < steps.length && this.isCalculating) {
                    this.progressPercent = steps[stepIndex].percent;
                    this.progressMessage = steps[stepIndex].message;
                    this.progressDetail = steps[stepIndex].detail;
                    stepIndex++;
                } else {
                    clearInterval(interval);
                }
            }, 500);
        },

        async gibExcelAktar() {
            // Placeholder for GIB Excel export
            alert('GİB Excel export özelliği daha sonra eklenecek');
        },

        async standartExcelAktar() {
            // Placeholder for Standard Excel export
            alert('Standart Excel export özelliği daha sonra eklenecek');
        },

        async saveData() {
            try {
                const _sdToken = localStorage.getItem('session_token') || '';
                const _sdMukId = localStorage.getItem('active_mukellef_id') || '';
                const _sdDId = localStorage.getItem('active_donem_id') || '';
                const _sdHeaders = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_sdToken}`
                };
                if (_sdMukId) _sdHeaders['X-Mukellef-Id'] = _sdMukId;
                if (_sdDId) _sdHeaders['X-Donem-Id'] = _sdDId;
                await fetch('/iade-hesapla/save-data', {
                    method: 'POST',
                    headers: _sdHeaders,
                    body: JSON.stringify({
                        stok_tutari: this.stokTutari,
                        yontem: this.yontem,
                        sonuc_verileri: this.sonucVerileri,
                        toplam_yuklenim: this.toplamYuklenim
                    })
                });
            } catch (error) {
                console.error('Veri kaydetme hatası:', error);
            }
        },

        async loadSavedData() {
            try {
                const _ldToken = localStorage.getItem('session_token') || '';
                const _ldMukId = localStorage.getItem('active_mukellef_id') || '';
                const _ldDId = localStorage.getItem('active_donem_id') || '';
                const _ldHeaders = { 'Authorization': `Bearer ${_ldToken}` };
                if (_ldMukId) _ldHeaders['X-Mukellef-Id'] = _ldMukId;
                if (_ldDId) _ldHeaders['X-Donem-Id'] = _ldDId;
                const response = await fetch('/iade-hesapla/get-data', {
                    headers: _ldHeaders
                });
                const data = await response.json();
                
                if (data.stok_tutari) {
                    this.stokTutari = data.stok_tutari;
                    this.yontem = data.yontem || 'FIFO';
                    this.sonucVerileri = data.sonuc_verileri || [];
                    this.toplamYuklenim = data.toplam_yuklenim || 0;
                }
            } catch (error) {
                console.error('Veri yükleme hatası:', error);
            }
        }
    }
}
