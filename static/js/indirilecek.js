document.addEventListener('alpine:init', () => {
    Alpine.data('indirilecekTabApp', () => ({
        file: null,
        uploading: false,
        loadingData: false,
        progress: 0,
        progressText: '',
        processedData: [],
        errorMessages: [],
        sessionId: '',
        currentPage: 1,
        itemsPerPage: 50,
        isDragging: false,
        filterSIRA: '',
        filterTARIH: '',
        filterNO: '',
        filterUNVAN: '',
        filterCINS: '',
        filterMIKTAR: '',
        filterMATRAH: '',
        filterKDV: '',
        filterURUN_KODU: '',
        filterGGB: '',
        filterDONEM: '',
        selectedStartMonth: 'Ocak',
        selectedEndMonth: 'Ocak',
        selectedYear: '',
        availableYears: [],
        months: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
        missingUrunKodu: [],
        showUrunKoduModal: false,
        savingUrunKodlari: false,
        showErrorModal: false,
        selectedItems: new Set(),
        deleting: false,
        pendingMissingUrunKodu: null,

        init() {
            this.$nextTick(() => {
                this.processedData = [];
                this.loadAvailableYears();
            });
        },

        async loadAvailableYears() {
            // Only use static years - don't fetch all data
            const yearSet = new Set();
            for (let y = 2023; y <= 2030; y++) {
                yearSet.add(y.toString());
            }
            this.availableYears = Array.from(yearSet).sort().reverse();
        },

        monthToNumber(monthName) {
            const monthMap = {
                'Ocak': '01', 'Şubat': '02', 'Mart': '03', 'Nisan': '04',
                'Mayıs': '05', 'Haziran': '06', 'Temmuz': '07', 'Ağustos': '08',
                'Eylül': '09', 'Ekim': '10', 'Kasım': '11', 'Aralık': '12'
            };
            return monthMap[monthName];
        },

        async loadDataFromAPI() {
            if (!this.selectedStartMonth || !this.selectedEndMonth || !this.selectedYear) {
                alert('Lütfen başlangıç ayı, bitiş ayı ve yılı seçin');
                return;
            }
            try {
                this.loadingData = true;
                const token = localStorage.getItem('session_token') || '';
                const mukId = localStorage.getItem('active_mukellef_id') || '';
                const dId = localStorage.getItem('active_donem_id') || '';
                if (!mukId || !dId) return;

                const headers = { 'Authorization': `Bearer ${token}` };
                if (mukId) headers['X-Mukellef-Id'] = mukId;
                if (dId) headers['X-Donem-Id'] = dId;

                const startMonthNum = this.monthToNumber(this.selectedStartMonth);
                const endMonthNum = this.monthToNumber(this.selectedEndMonth);
                const url = `/api/indirilecek-data?start_month=${startMonthNum}&end_month=${endMonthNum}&year=${this.selectedYear}`;
                const response = await fetch(url, { headers: headers });
                const result = await response.json();

                if (result.success) {
                    this.processedData = result.processed_data || [];
                    this.errorMessages = result.error_messages || [];
                    this.updateParentData('processedData', this.processedData);
                    this.updateParentData('errorMessages', this.errorMessages);
                }
            } catch (error) {
                console.log('API data load error:', error);
            } finally {
                this.loadingData = false;
            }
        },

        async refreshData() {
            await this.loadDataFromAPI();
        },

        loadDataFromParent() {
            try {
                let parentApp = window.yuklenenApp;
                if (parentApp && parentApp.tabDataStores && parentApp.tabDataStores.indirilecek) {
                    this.processedData = parentApp.tabDataStores.indirilecek.processedData || [];
                    this.sessionId = parentApp.tabDataStores.indirilecek.sessionId || '';
                    this.errorMessages = parentApp.tabDataStores.indirilecek.errorMessages || [];
                    this.currentPage = parentApp.tabDataStores.indirilecek.currentPage || 1;
                    // Don't restore showErrorModal state - only show after new upload
                }
            } catch (error) {
                console.log('Parent data load error:', error);
            }
        },

        handleDrop(e) {
            e.preventDefault();
            this.isDragging = false;
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
            if (files.length > 0) {
                this.file = files[0];
                this.uploadFile();
            }
        },

        handleFileSelect(e) {
            const files = Array.from(e.target.files).filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
            if (files.length > 0) {
                this.file = files[0];
                this.uploadFile();
            }
        },

        async uploadFile() {
            if (!this.file) return;
            this.uploading = true;
            this.progress = 0;
            this.progressText = 'Dosya yukleniyor...';
            this.errorMessages = [];
            this.processedData = [];

            try {
                const formData = new FormData();
                formData.append('file', this.file);
                const progressInterval = setInterval(() => {
                    if (this.progress < 90) {
                        this.progress += Math.random() * 20;
                        this.progressText = `Isleniyor... ${Math.round(this.progress)}%`;
                    }
                }, 500);

                const _indToken = localStorage.getItem('session_token') || '';
                const _indMukId = localStorage.getItem('active_mukellef_id') || '';
                const _indDId = localStorage.getItem('active_donem_id') || '';
                const _indHeaders = { 'Authorization': `Bearer ${_indToken}` };
                if (_indMukId) _indHeaders['X-Mukellef-Id'] = _indMukId;
                if (_indDId) _indHeaders['X-Donem-Id'] = _indDId;
                const response = await fetch('/upload-indirilecek-excel', {
                    method: 'POST',
                    headers: _indHeaders,
                    body: formData
                });
                clearInterval(progressInterval);
                const result = await response.json();

                if (result.success) {
                    this.processedData = result.processed_data || [];
                    this.sessionId = result.session_id;
                    this.errorMessages = result.error_messages || [];
                    this.progress = 100;
                    this.progressText = 'Islem tamamlandi';
                    this.updateParentData('processedData', result.processed_data || []);
                    this.updateParentData('sessionId', result.session_id);
                    this.updateParentData('errorMessages', result.error_messages || []);
                    this.updateParentData('uploading', false);
                    if (this.errorMessages.length > 0) {
                        this.progressText = `Islem tamamlandi (${this.errorMessages.length} hata)`;
                        this.showErrorModal = true;
                    }
                    // Eksik ürün kodu varsa sakla, hata modalı kapatılınca göster
                    const missing = result.missing_urun_kodu || [];
                    if (missing.length > 0) {
                        this.pendingMissingUrunKodu = missing.map(g => ({ ...g, urun_kodu: '' }));
                    } else {
                        this.pendingMissingUrunKodu = null;
                    }
                    // Hata yoksa ve eksik ürün kodu varsa doğrudan göster
                    if (this.errorMessages.length === 0 && this.pendingMissingUrunKodu) {
                        this.missingUrunKodu = this.pendingMissingUrunKodu;
                        this.showUrunKoduModal = true;
                        this.pendingMissingUrunKodu = null;
                    }
                } else {
                    this.errorMessages = [result.error || 'Bilinmeyen hata'];
                    this.progress = 0;
                    this.progressText = 'Hata olustu';
                    this.showErrorModal = true;
                }
            } catch (error) {
                console.error('Upload error:', error);
                this.errorMessages = ['Dosya yukleme hatasi: ' + error.message];
                this.progress = 0;
                this.progressText = 'Hata olustu';
                this.showErrorModal = true;
            } finally {
                this.uploading = false;
            }
        },

        async saveUrunKodlari() {
            if (this.savingUrunKodlari) return;
            // Sadece kodu girilmiş olanları gönder
            const itemsToSave = this.missingUrunKodu.filter(g => g.urun_kodu.trim() !== '');
            if (itemsToSave.length === 0) return;
            this.savingUrunKodlari = true;
            try {
                const token = localStorage.getItem('session_token') || '';
                const mukId = localStorage.getItem('active_mukellef_id') || '';
                const dId = localStorage.getItem('active_donem_id') || '';
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
                if (mukId) headers['X-Mukellef-Id'] = mukId;
                if (dId) headers['X-Donem-Id'] = dId;
                const r = await fetch('/api/urun-listesi/upsert', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ items: itemsToSave })
                });
                const result = await r.json();
                if (result.success) {
                    if (result.updated_data) {
                        this.processedData = result.updated_data;
                        this.updateParentData('processedData', result.updated_data);
                    }
                    // Kodu girilen satırları listeden çıkar, girilmeyenler kalır
                    this.missingUrunKodu = this.missingUrunKodu.filter(g => g.urun_kodu.trim() === '');
                    // Tüm kodlar girilince otomatik kapat
                    if (this.missingUrunKodu.length === 0) {
                        this.showUrunKoduModal = false;
                    }
                } else {
                    alert('Kaydetme hatası: ' + (result.error || 'Bilinmeyen hata'));
                }
            } catch (e) {
                alert('Bağlantı hatası: ' + e.message);
            } finally {
                this.savingUrunKodlari = false;
            }
        },

        updateParentData(key, value) {
            try {
                let parentApp = window.yuklenenApp;
                if (parentApp && parentApp.tabDataStores && parentApp.tabDataStores.indirilecek) {
                    parentApp.tabDataStores.indirilecek[key] = value;
                    if (parentApp.saveData) parentApp.saveData();
                }
            } catch (error) {
                console.log('Parent data update error:', error);
            }
        },

        get hasFilters() {
            return !!(this.filterSIRA || this.filterTARIH || this.filterNO || this.filterUNVAN ||
                      this.filterCINS || this.filterMIKTAR || this.filterMATRAH || this.filterKDV || this.filterURUN_KODU ||
                      this.filterGGB || this.filterDONEM);
        },

        get filteredData() {
            return (this.processedData || []).filter(item => (
                (!this.filterSIRA    || String(item.SIRA     || '').toLowerCase().includes(this.filterSIRA.toLowerCase())) &&
                (!this.filterTARIH  || String(item.TARIH    || '').toLowerCase().includes(this.filterTARIH.toLowerCase())) &&
                (!this.filterNO     || String(item.NO       || '').toLowerCase().includes(this.filterNO.toLowerCase())) &&
                (!this.filterUNVAN  || String(item.UNVAN    || '').toLowerCase().includes(this.filterUNVAN.toLowerCase())) &&
                (!this.filterCINS   || String(item.CINS     || '').toLowerCase().includes(this.filterCINS.toLowerCase())) &&
                (!this.filterMIKTAR || String(item.MIKTAR   || '').toLowerCase().includes(this.filterMIKTAR.toLowerCase())) &&
                (!this.filterMATRAH || String(item.MATRAH   || '').includes(this.filterMATRAH)) &&
                (!this.filterKDV    || String(item.KDV      || '').includes(this.filterKDV)) &&
                (!this.filterURUN_KODU || String(item.URUN_KODU || '').toLowerCase().includes(this.filterURUN_KODU.toLowerCase())) &&
                (!this.filterGGB    || String(item.GGB      || '').toLowerCase().includes(this.filterGGB.toLowerCase())) &&
                (!this.filterDONEM  || String(item.DONEM    || '').toLowerCase().includes(this.filterDONEM.toLowerCase()))
            ));
        },

        clearFilters() {
            this.filterSIRA = '';
            this.filterTARIH = '';
            this.filterNO = '';
            this.filterUNVAN = '';
            this.filterCINS = '';
            this.filterMIKTAR = '';
            this.filterMATRAH = '';
            this.filterKDV = '';
            this.filterURUN_KODU = '';
            this.filterGGB = '';
            this.filterDONEM = '';
            this.currentPage = 1;
        },

        get totalPages() {
            return Math.ceil(this.filteredData.length / (this.itemsPerPage || 50));
        },

        get paginatedData() {
            const data = this.filteredData;
            const start = (this.currentPage - 1) * this.itemsPerPage;
            return data.slice(start, start + this.itemsPerPage);
        },

        previousPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.updateParentData('currentPage', this.currentPage);
            }
        },

        nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.updateParentData('currentPage', this.currentPage);
            }
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

        get totalKDV() {
            return this.processedData.reduce((sum, item) => sum + parseFloat(item.KDV || 0), 0);
        },

        goToPage(page) {
            if (page >= 1 && page <= this.totalPages) {
                this.currentPage = page;
                this.updateParentData('currentPage', this.currentPage);
            }
        },

        formatCurrency(value) {
            if (!value || value === 0) return '0,00';
            return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(value);
        },

        truncateText(text, maxLength = 50) {
            if (!text) return '';
            return text.length <= maxLength ? text : text.substring(0, maxLength) + '...';
        },

        async exportExcel() {
            if (window.yuklenenApp) {
                window.yuklenenApp.activeTab = 'indirilecek';
                await window.yuklenenApp.exportExcel();
            }
        },

        get selectedCount() {
            return this.selectedItems.size;
        },

        get allFilteredSelected() {
            if (this.filteredData.length === 0) return false;
            return this.filteredData.every(item => this.isItemSelected(item));
        },

        getItemKey(item) {
            return `${item.SIRA}-${item.NO}-${item.TARIH}-${item.XML_NO || ''}`;
        },

        isItemSelected(item) {
            return this.selectedItems.has(this.getItemKey(item));
        },

        toggleItemSelection(item) {
            const key = this.getItemKey(item);
            if (this.selectedItems.has(key)) {
                this.selectedItems.delete(key);
            } else {
                this.selectedItems.add(key);
            }
        },

        selectAllFiltered() {
            this.filteredData.forEach(item => {
                this.selectedItems.add(this.getItemKey(item));
            });
        },

        deselectAll() {
            this.selectedItems.clear();
        },

        toggleSelectAll() {
            if (this.allFilteredSelected) {
                this.deselectAll();
            } else {
                this.selectAllFiltered();
            }
        },

        async deleteSelected() {
            if (this.selectedCount === 0) return;
            if (!confirm(`${this.selectedCount} kaydı silmek istediğinize emin misiniz?`)) return;

            this.deleting = true;
            try {
                const token = localStorage.getItem('session_token') || '';
                const mukId = localStorage.getItem('active_mukellef_id') || '';
                const dId = localStorage.getItem('active_donem_id') || '';

                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
                if (mukId) headers['X-Mukellef-Id'] = mukId;
                if (dId) headers['X-Donem-Id'] = dId;

                const selectedKeys = Array.from(this.selectedItems);
                const response = await fetch('/api/indirilecek/delete-selected', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ selected_keys: selectedKeys })
                });

                const result = await response.json();
                if (result.success) {
                    this.selectedItems.clear();
                    await this.loadDataFromAPI();
                } else {
                    alert('Silme hatası: ' + (result.error || 'Bilinmeyen hata'));
                }
            } catch (error) {
                console.error('Delete error:', error);
                alert('Bağlantı hatası: ' + error.message);
            } finally {
                this.deleting = false;
            }
        },

        closeErrorModal() {
            this.showErrorModal = false;
            // Bekleyen eksik ürün kodu varsa göster
            if (this.pendingMissingUrunKodu && this.pendingMissingUrunKodu.length > 0) {
                this.missingUrunKodu = this.pendingMissingUrunKodu;
                this.showUrunKoduModal = true;
                this.pendingMissingUrunKodu = null;
            }
        }
    }));
});
