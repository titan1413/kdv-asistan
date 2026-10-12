# KDV Asistan - XML'den İndirilecek KDV Listesi Oluşturma

Bu uygulama, GİB XML faturalarından indirilecek KDV listesi oluşturmak için kullanılır.

## Özellikler

- **Kullanıcı Girişi**: Supabase tabanlı kimlik doğrulama
- **XML Yükleme**: GİB XML faturalarını yükleme ve işleme
- **Excel İndirme**: İşlenmiş verileri Standart veya GİB Şartlı formatında Excel olarak indirme
- **Cihaz Yönetimi**: Lisans ve cihaz limiti kontrolü

## Gereksinimler

- Python 3.12+
- Supabase hesabı (authentication için)
- Redis (isteğe bağlı, yoksa bellek içi session kullanılır)

## Kurulum

1. Depoyu klonlayın:
```bash
git clone <repo-url>
cd kdv-asistan
```

2. Sanal ortam oluşturun:
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
```

3. Bağımlılıkları yükleyin:
```bash
pip install -r requirements.txt
```

4. Environment değişkenlerini ayarlayın (`.env` dosyası oluşturun):
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
SUPABASE_ANON_KEY=your_supabase_anon_key
ALLOWED_ORIGINS=https://your-domain.com
SESSION_TTL_HOURS=8
SESSION_IDLE_MINUTES=90
```

## Yerel Çalıştırma

```bash
uvicorn main:app --reload
```

Uygulama `http://localhost:8000` adresinde çalışacaktır.

## Render.com'a Deploy

1. Bu depoyu GitHub'a push edin
2. [Render.com](https://render.com) hesabı oluşturun
3. "New +" -> "Web Service" seçin
4. GitHub reposunu bağlayın
5. `render.yaml` dosyası otomatik olarak ayarları yapılandıracaktır
6. Environment variables (Render dashboard'da ayarlayın):
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `SUPABASE_ANON_KEY`
   - `ALLOWED_ORIGINS` (sizin domaininiz)

## Domain Bağlama

Render'da deploy ettikten sonra:

1. Render dashboard'da web servisinizi açın
2. "Settings" -> "Domains" sekmesine gidin
3. "Add Domain" butonuna tıklayın
4. Domain'inizi girin
5. Render size DNS kayıtlarını verecek
6. Domain sağlayıcınızda (Cloudflare, GoDaddy, vb.) bu DNS kayıtlarını ekleyin

## Proje Yapısı

```
kdv-asistan/
├── main.py                 # FastAPI uygulaması
├── auth.py                 # Authentication modülü
├── indirilecek.py          # XML işleme ve Excel export
├── xml_engine.py           # XML parsing
├── session_manager.py      # Session yönetimi
├── security.py             # Güvenlik fonksiyonları
├── logger.py               # Logging
├── KDV_Web/                # Frontend dosyaları
│   ├── login.html
│   └── indirilecek_kdv_page.html
├── requirements.txt        # Python bağımlılıkları
└── render.yaml            # Render deploy konfigürasyonu
```

## Lisans

Bu proje telif hakkı ile korunmaktadır.
