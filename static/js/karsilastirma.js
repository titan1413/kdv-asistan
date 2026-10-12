document.addEventListener('alpine:init', () => {
    Alpine.data('karsilastirmaTabApp', () => ({
        calculating: false,
        progress: 0,
        progressText: '',
        progressMessage: 'Hesaplanıyor...',
        progressDetail: 'Veriler işleniyor',
        processedData: [],
        oransalFaturalar: [],
        currentPage: 1,
        itemsPerPage: 50,
        hasIndirilecekData: false,
        hasYuklenilenData: false,
        hasResultData: false,
        noMatchMessage: null,
        sessionId: '',
        pollingInterval: null,
        filterSIRA: '',
        filterTARIH: '',
        filterSERI: '',
        filterNO: '',
        filterUNVAN: '',
        filterVERGI_TC: '',
        filterCINS: '',
        filterMIKTAR: '',
        filterMATRAH: '',
        filterKDV: '',
        filterONCE_YUKLENEN: '',
        filterKALAN_KDV: '',
        filterDONEM: '',
        filterURUN_KODU: '',

        init() {
            this.checkDataAvailability();
        },

        startPolling() {
            if (this.pollingInterval) clearInterval(this.pollingInterval);
            this.pollingInterval = setInterval(() => this.checkDataAvailability(), 30000);
        },

        stopPolling() {
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
        },

        async checkDataAvailability() {
            try {
                const token = localStorage.getItem('session_token') || '';
                const mukId = localStorage.getItem('active_mukellef_id') || '';
                const dId = localStorage.getItem('active_donem_id') || '';
                const headers = { 'Authorization': `Bearer ${token}` };
                if (mukId) headers['X-Mukellef-Id'] = mukId;
                if (dId) headers['X-Donem-Id'] = dId;
                const response = await fetch('/check-data-availability', {
                    headers: headers
                });
                const result = await response.json();
                this.hasIndirilecekData = result.has_indirilecek && result.ind_count > 0;
                this.hasYuklenilenData = result.has_yuklenilen && result.yuk_count > 0;
                console.log('Data availability:', { ind: this.hasIndirilecekData, yuk: this.hasYuklenilenData });
            } catch (error) {
                console.log('Data check error:', error);
            }
        },

        async hesaplaKarsilastir() {
            if (!this.hasIndirilecekData) {
                alert('Önce İndirilecek KDV listesini yükleyin!');
                return;
            }

            this.calculating = true;
            this.progress = 0;
            this.progressText = 'Veriler hazırlanıyor...';
            this.progressMessage = 'Veriler hazırlanıyor...';
            this.progressDetail = 'Fatura verileri okunuyor';
            this.oransalFaturalar = [];
            this.startPolling();

            try {
                // Simulate progress updates
                const steps = [
                    { percent: 10, message: 'Veriler doğrulanıyor...', detail: 'Fatura verileri okunuyor' },
                    { percent: 30, message: 'Karşılaştırma yapılıyor...', detail: 'Yüklenilen veriler işleniyor' },
                    { percent: 50, message: 'Hesaplama devam ediyor...', detail: 'Oransal dağılım hesaplanıyor' },
                    { percent: 70, message: 'Sonuçlar hazırlanıyor...', detail: 'Kalan KDV hesaplanıyor' },
                    { percent: 90, message: 'Neredeyse bitti...', detail: 'Son düzenlemeler yapılıyor' }
                ];

                let stepIndex = 0;
                const progressInterval = setInterval(() => {
                    if (stepIndex < steps.length && this.calculating) {
                        this.progress = steps[stepIndex].percent;
                        this.progressMessage = steps[stepIndex].message;
                        this.progressDetail = steps[stepIndex].detail;
                        this.progressText = steps[stepIndex].message;
                        stepIndex++;
                    } else {
                        clearInterval(progressInterval);
                    }
                }, 500);

                const token = localStorage.getItem('session_token') || '';
                const mukId = localStorage.getItem('active_mukellef_id') || '';
                const dId = localStorage.getItem('active_donem_id') || '';
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
                if (mukId) headers['X-Mukellef-Id'] = mukId;
                if (dId) headers['X-Donem-Id'] = dId;
                const response = await fetch('/calculate-karsilastirma', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({})
                });

                clearInterval(progressInterval);

                const result = await response.json();

                if (result.success) {
                    this.processedData = result.processed_data || [];
                    this.oransalFaturalar = result.oransal_faturalar || [];
                    this.hasResultData = this.processedData.length > 0;
                    this.noMatchMessage = this.processedData.length === 0
                        ? 'Karşılaştırma tamamlandı fakat eşleşen fatura bulunamadı. İndirilecek ve Yüklenilen verilerin tarih/no/VKN/tutar bilgilerini kontrol edin.'
                        : null;
                    if (window.yuklenenApp?.tabDataStores?.hazir !== undefined) {
                        if (!window.yuklenenApp.tabDataStores.hazir.sessionId) {
                            window.yuklenenApp.tabDataStores.hazir.sessionId = 'hazir_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        }
                        if (window.yuklenenApp.saveData) window.yuklenenApp.saveData();
                    }
                    this.progress = 100;
                    this.progressText = 'İşlem tamamlandı';
                    this.progressMessage = 'İşlem tamamlandı';
                    this.progressDetail = 'Sonuçlar hazır';


                    if (this.oransalFaturalar.length > 0) {
                        this.progressText = `İşlem tamamlandı (${this.oransalFaturalar.length} oransal fatura)`;
                        this.progressMessage = `İşlem tamamlandı (${this.oransalFaturalar.length} oransal fatura)`;
                        this.progressDetail = 'Oransal dağılım uygulandı';
                    }
                } else {
                    this.noMatchMessage = null;
                    alert(result.error || 'Bir hata oluştu');
                    this.progress = 0;
                    this.progressMessage = 'Hata oluştu';
                    this.progressDetail = 'İşlem başarısız';
                }
            } catch (error) {
                console.error('Calculation error:', error);
                alert('Karşılaştırma sırasında hata oluştu: ' + error.message);
                this.progress = 0;
                this.progressMessage = 'Hata oluştu';
                this.progressDetail = 'Bağlantı hatası';
            } finally {
                this.calculating = false;
                this.stopPolling();
            }
        },

        get hasFilters() {
            return !!(this.filterSIRA || this.filterTARIH || this.filterSERI || this.filterNO ||
                      this.filterUNVAN || this.filterVERGI_TC || this.filterCINS || this.filterMIKTAR ||
                      this.filterMATRAH || this.filterKDV || this.filterONCE_YUKLENEN ||
                      this.filterKALAN_KDV || this.filterDONEM || this.filterURUN_KODU);
        },

        get filteredData() {
            return (this.processedData || []).filter(item => (
                (!this.filterSIRA          || String(item.SIRA          || '').toLowerCase().includes(this.filterSIRA.toLowerCase())) &&
                (!this.filterTARIH         || String(item.TARIH         || '').toLowerCase().includes(this.filterTARIH.toLowerCase())) &&
                (!this.filterSERI          || String(item.SERI          || '').toLowerCase().includes(this.filterSERI.toLowerCase())) &&
                (!this.filterNO            || String(item.NO            || '').toLowerCase().includes(this.filterNO.toLowerCase())) &&
                (!this.filterUNVAN         || String(item.UNVAN         || '').toLowerCase().includes(this.filterUNVAN.toLowerCase())) &&
                (!this.filterVERGI_TC      || String(item.VERGI_TC      || '').toLowerCase().includes(this.filterVERGI_TC.toLowerCase())) &&
                (!this.filterCINS          || String(item.CINS          || '').toLowerCase().includes(this.filterCINS.toLowerCase())) &&
                (!this.filterMIKTAR        || String(item.MIKTAR        || '').toLowerCase().includes(this.filterMIKTAR.toLowerCase())) &&
                (!this.filterMATRAH        || String(item.MATRAH        || '').includes(this.filterMATRAH)) &&
                (!this.filterKDV           || String(item.KDV           || '').includes(this.filterKDV)) &&
                (!this.filterONCE_YUKLENEN || String(item.ONCE_YUKLENEN || '').includes(this.filterONCE_YUKLENEN)) &&
                (!this.filterKALAN_KDV     || String(item.KALAN_KDV    || '').includes(this.filterKALAN_KDV)) &&
                (!this.filterDONEM         || String(item.DONEM         || '').toLowerCase().includes(this.filterDONEM.toLowerCase())) &&
                (!this.filterURUN_KODU     || String(item.URUN_KODU     || '').toLowerCase().includes(this.filterURUN_KODU.toLowerCase()))
            ));
        },

        clearFilters() {
            this.filterSIRA = '';
            this.filterTARIH = '';
            this.filterSERI = '';
            this.filterNO = '';
            this.filterUNVAN = '';
            this.filterVERGI_TC = '';
            this.filterCINS = '';
            this.filterMIKTAR = '';
            this.filterMATRAH = '';
            this.filterKDV = '';
            this.filterONCE_YUKLENEN = '';
            this.filterKALAN_KDV = '';
            this.filterDONEM = '';
            this.filterURUN_KODU = '';
            this.currentPage = 1;
        },

        get totalPages() {
            return Math.ceil(this.filteredData.length / this.itemsPerPage);
        },

        get paginatedData() {
            const data = this.filteredData;
            const start = (this.currentPage - 1) * this.itemsPerPage;
            return data.slice(start, start + this.itemsPerPage);
        },

        get currentPageInfo() {
            const filtered = this.filteredData;
            const total = filtered.length;
            if (total === 0) return { start: 0, end: 0, count: 0, total: 0, totalAll: (this.processedData || []).length };
            const start = (this.currentPage - 1) * this.itemsPerPage + 1;
            const end = Math.min(this.currentPage * this.itemsPerPage, total);
            const count = end - start + 1;
            return { start, end, count, total, totalAll: (this.processedData || []).length };
        },

        get pageNumbers() {
            const pages = [];
            const maxVisible = 5;
            let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
            let end = Math.min(this.totalPages, start + maxVisible - 1);
            
            if (end - start + 1 < maxVisible) {
                start = Math.max(1, end - maxVisible + 1);
            }
            
            for (let i = start; i <= end; i++) {
                pages.push(i);
            }
            return pages;
        },

        get totalKalanKDV() {
            return this.processedData.reduce((sum, item) => sum + parseFloat(item.KALAN_KDV || 0), 0);
        },

        get totalOnceYuklenen() {
            return this.processedData.reduce((sum, item) => sum + parseFloat(item.ONCE_YUKLENEN || 0), 0);
        },

        get totalKDV() {
            return this.processedData.reduce((sum, item) => sum + parseFloat(item.KDV || 0), 0);
        },

        goToPage(page) {
            if (page >= 1 && page <= this.totalPages) {
                this.currentPage = page;
            }
        },

        previousPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
            }
        },

        nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
            }
        },

        formatCurrency(value) {
            if (!value || value === 0) return '0,00';
            return new Intl.NumberFormat('tr-TR', {
                style: 'currency',
                currency: 'TRY'
            }).format(value);
        },

        truncateText(text, maxLength = 50) {
            if (!text) return '';
            if (text.length <= maxLength) return text;
            return text.substring(0, maxLength) + '...';
        },

        async exportExcel() {
            if (!this.hasResultData) {
                alert('Önce listeyi oluşturun.');
                return;
            }

            try {
                const token = localStorage.getItem('session_token') || '';
                const mukId = localStorage.getItem('active_mukellef_id') || '';
                const dId = localStorage.getItem('active_donem_id') || '';
                const headers = { 'Authorization': `Bearer ${token}` };
                if (mukId) headers['X-Mukellef-Id'] = mukId;
                if (dId) headers['X-Donem-Id'] = dId;
                const response = await fetch('/export-karsilastirma-excel', {
                    headers: headers
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const contentDisposition = response.headers.get('content-disposition');
                    let filename = 'karsilastirma_sonuc.xlsx';
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                        if (filenameMatch) filename = filenameMatch[1];
                    }
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } else if (response.status === 403) {
                    const data = await response.json();
                    const errorMsg = data.error || 'Daha önce bu exceli indirdiğiniz için indirilemiyor.';
                    alert(errorMsg);
                } else {
                    throw new Error('Excel dosyası indirilemedi');
                }
            } catch (error) {
                console.error('Export error:', error);
                alert('Excel aktarımı sırasında hata oluştu: ' + error.message);
            }
        }
    }));
});
