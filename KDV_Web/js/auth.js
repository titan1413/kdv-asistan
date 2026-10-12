// js/auth.js

const SUPABASE_URL = window.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";

let _supabase;
try {
    const { createClient } = window.supabase;
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabaseClient = _supabase;
} catch (e) {
    console.error("Supabase başlatılamadı:", e);
}

const registerTexts = document.getElementById('registerTexts');
const afterDownloadTexts = document.getElementById('afterDownloadTexts');
let userEmailForVerify = "";

const regForm = document.getElementById('registerForm');
const msgLabel = document.getElementById('formMessage');
const submitBtn = document.getElementById('submitBtn');
const otpArea = document.getElementById('otpArea');

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('nav button[onclick^="showSection"]').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('text-slate-600');
    });
    const activeBtn = document.querySelector(`nav button[onclick="showSection('${sectionId}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('bg-blue-600', 'text-white');
        activeBtn.classList.remove('text-slate-600');
    }
}

function togglePassword(id) {
    const input = document.getElementById(id);
    const eye = document.getElementById('eye-' + id);
    if (input && input.type === "password") {
        input.type = "text";
        eye.classList.replace('fa-eye', 'fa-eye-slash');
    } else if (input) {
        input.type = "password";
        eye.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

if (regForm) {
    regForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 
        const fullName = document.getElementById('regFullName').value.trim();
        const phone = document.getElementById('regPhone').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        userEmailForVerify = email;

        const termsCheck = document.getElementById('termsCheck');
        if (!termsCheck.checked) {
            alert("Lütfen kullanım koşullarını ve KVKK metnini onaylayınız.");
            submitBtn.disabled = false;
            return;
        }

        if (fullName.length > 100 || email.length > 50 || password.length > 20) {
            msgLabel.innerText = "Hata: Karakter sınırı aşıldı!";
            msgLabel.style.color = "red";
            return;
        }

        msgLabel.innerText = "İşlem yapılıyor...";
        msgLabel.style.color = "blue";
        submitBtn.disabled = true;

        try {
            // Use main app API for registration
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    full_name: fullName,
                    email: email,
                    password: password,
                    phone: phone
                })
            });

            const data = await response.json();

            if (data.success) {
                msgLabel.innerText = data.message || "Kayıt Başarılı! Lütfen e-postanıza gelen kodu girin.";
                msgLabel.style.color = "green";
                regForm.classList.add('hidden');
                otpArea.classList.remove('hidden'); 
                startTimer();
            } else {
                msgLabel.innerText = "Hata: " + (data.error || "Kayıt başarısız");
                msgLabel.style.color = "red";
                submitBtn.disabled = false;
            }
        } catch (err) {
            console.error("Sistem hatası:", err);
            msgLabel.innerText = "Bağlantı hatası!";
            msgLabel.style.color = "red";
            submitBtn.disabled = false;
        }
    });
}


document.getElementById('verifyBtn')?.addEventListener('click', async () => {
    const token = document.getElementById('verifyCode').value.trim();
    if (token.length < 6) {
        msgLabel.innerText = "Lütfen 6 haneli kodu girin.";
        msgLabel.style.color = "red";
        return;
    }
    msgLabel.innerText = "Kod doğrulanıyor...";
    msgLabel.style.color = "blue";
    try {
        
        const { data, error } = await _supabase.auth.verifyOtp({
            email: userEmailForVerify,
            token: token,
            type: 'signup'
        });

        if (error) {
            msgLabel.innerText = "Hata: Kod yanlış!";
            msgLabel.style.color = "red";
        } else {
     
            await saveAgreementAndLog(data.user.id, userEmailForVerify);

            msgLabel.innerText = "Doğrulandı! İndirme butonu aktif edildi.";
            msgLabel.style.color = "green";
            otpArea.classList.add('hidden');
            if(registerTexts) registerTexts.classList.add('hidden');
            if(afterDownloadTexts) afterDownloadTexts.classList.remove('hidden');
        }
    } catch (err) {
        msgLabel.innerText = "Doğrulama hatası!";
        msgLabel.style.color = "red";
    }
});


let countdown;
function startTimer() {
    let timeLeft = 60;
    const secondsLabel = document.getElementById('seconds');
    const timerText = document.getElementById('timerText');
    const resendBtn = document.getElementById('resendBtn');
    if(!secondsLabel || !resendBtn || !timerText) return;
    resendBtn.classList.add('hidden');
    timerText.classList.remove('hidden');
    secondsLabel.innerText = timeLeft;
    clearInterval(countdown);
    countdown = setInterval(() => {
        timeLeft--;
        secondsLabel.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(countdown);
            timerText.classList.add('hidden');
            resendBtn.classList.remove('hidden');
        }
    }, 1000);
}

document.getElementById('resendBtn')?.addEventListener('click', async () => {
    msgLabel.innerText = "Yeni kod gönderiliyor...";
    msgLabel.style.color = "blue";
    const { error } = await _supabase.auth.signInWithOtp({ email: userEmailForVerify });
    if (error) {
        msgLabel.innerText = "Hata: " + error.message;
        msgLabel.style.color = "red";
    } else {
        msgLabel.innerText = "Yeni kod gönderildi!";
        msgLabel.style.color = "green";
        startTimer();
    }
});


const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const savedEmail = localStorage.getItem('remembered_email');
    if (savedEmail) {
        const emailInput = document.getElementById('loginEmail');
        const rememberChk = document.getElementById('rememberMe');
        if (emailInput) emailInput.value = savedEmail;
        if (rememberChk) rememberChk.checked = true;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const loginMsg = document.getElementById('loginMessage');
        const loginBtn = document.getElementById('loginBtn');
        const rememberMe = document.getElementById('rememberMe')?.checked;
        if (rememberMe) {
            localStorage.setItem('remembered_email', email);
        } else {
            localStorage.removeItem('remembered_email');
        }

        if(loginMsg) { loginMsg.innerText = "Cihaz tanımlanıyor..."; loginMsg.style.color = "blue"; }
        if(loginBtn) loginBtn.disabled = true;

        let device_id = null;
        let device_name = 'Web Tarayıcısı';
        try {
            let savedId = localStorage.getItem('device_fingerprint');
            // Eski tahmin edilebilir fallback değerleri temizle
            if (savedId && savedId.startsWith('web-fallback-')) {
                localStorage.removeItem('device_fingerprint');
                savedId = null;
            }
            if (!savedId) {
                const fp = new BrowserFingerprint();
                savedId = await fp.generate();
                localStorage.setItem('device_fingerprint', savedId);
            }
            device_id = savedId;
            const ua = navigator.userAgent;
            let browser = 'Tarayıcı';
            if (ua.includes('Edg')) browser = 'Edge';
            else if (ua.includes('Chrome')) browser = 'Chrome';
            else if (ua.includes('Firefox')) browser = 'Firefox';
            else if (ua.includes('Safari')) browser = 'Safari';
            let os = 'OS';
            if (ua.includes('Windows')) os = 'Windows';
            else if (ua.includes('Mac')) os = 'macOS';
            else if (ua.includes('Linux')) os = 'Linux';
            else if (ua.includes('Android')) os = 'Android';
            else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
            device_name = `${browser} / ${os}`;
        } catch (fpErr) {
            console.warn("Fingerprint oluşturulamadı:", fpErr);
        }

        // Fingerprint başarısızsa bu tarayıcı için benzersiz UUID üret ve sakla
        if (!device_id) {
            device_id = localStorage.getItem('device_fallback_id');
            if (!device_id) {
                device_id = 'web-' + crypto.randomUUID();
                localStorage.setItem('device_fallback_id', device_id);
            }
        }

        if(loginMsg) loginMsg.innerText = "Giriş yapılıyor...";

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    device_id: device_id,
                    device_name: device_name
                })
            });

            const data = await response.json();

            if (data.success) {
                // Session token'ı kaydet
                if (data.session_token) {
                    localStorage.setItem('session_token', data.session_token);
                }
                // Login başarılı, Supabase Auth ile oturum aç
                const { data: authData, error: authError } = await _supabase.auth.signInWithPassword({ email, password });

                if (authError) {
                    if(loginMsg) {
                        loginMsg.innerText = "Hata: " + authError.message;
                        loginMsg.style.color = "red";
                    }
                    if(loginBtn) loginBtn.disabled = false;
                } else {
                    window.location.href = '/indirilecek-kdv';
                }
            } else {
                if(loginMsg) {
                    loginMsg.innerText = data.error || "Giriş başarısız!";
                    loginMsg.style.color = "red";
                }
                if(loginBtn) loginBtn.disabled = false;
            }
        } catch (err) {
            console.error("Login hatası:", err);
            if(loginMsg) {
                loginMsg.innerText = "Bağlantı hatası oluştu.";
                loginMsg.style.color = "red";
            }
            if(loginBtn) loginBtn.disabled = false;
        }
    });
}

// ...
window.addEventListener('load', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    const isDashboard = window.location.pathname.includes('dashboard');
    const body = document.getElementById('mainBody'); // HTML'e verdiğimiz ID

    if (session) {
        if (isDashboard) {
            // Dashboard'daysa verileri yükle
            await showDashboard(session.user);
            
            // VERİLER YÜKLENDİ, ŞİMDİ PERDEYİ AÇ
            if (body) {
                body.classList.remove('opacity-0');
                body.classList.add('opacity-100');
            }
        }
    } else {
        if (isDashboard) {
            // Giriş yoksa perdeyi hiç açmadan login'e gönder
            window.location.href = '/login';
        }
    }
    checkSessionValidity();
    setInterval(checkSessionValidity, 60000);

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            checkSessionValidity();
        }
    });
});

const _SESSION_REASON_MESSAGES = {
    'expired':   'Oturumunuzun süresi doldu (8 saat). Lütfen tekrar giriş yapın.',
    'idle':      '90 dakika işlem yapılmadığı için oturum otomatik kapatıldı.',
    'not_found': 'Oturumunuz geçersiz. Lütfen tekrar giriş yapın.',
    'revoked':   'Başka bir cihazdan giriş yapıldığı için oturumunuz sonlandırıldı.',
};

async function checkSessionValidity() {
    const token = localStorage.getItem('session_token');
    if (!token) return;
    try {
        const res = await fetch('/api/verify-session', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.valid) {
            localStorage.removeItem('session_token');
            try { await _supabase.auth.signOut(); } catch (_) {}
            const msg = _SESSION_REASON_MESSAGES[data.reason] || 'Oturumunuz sonlandırıldı.';
            alert(msg);
            window.location.href = '/login';
        }
    } catch (e) {
        console.warn('Session kontrol hatası:', e);
    }
}

async function showDashboard(user) {
    try {
        if(document.getElementById('userEmailLabel')) document.getElementById('userEmailLabel').innerText = user.email;
        if(document.getElementById('userName')) document.getElementById('userName').innerText = (user.user_metadata && user.user_metadata.name) ? user.user_metadata.name : (user.email || "Kullanıcı");

        // Frontend'deki authenticated Supabase client ile doğrudan sorgula
        // (Backend'de anon key ile RLS engelleniyordu; service key gereksinimini önlemek için)
        try {
            const profileRes = await _supabase.from('profiles').select('*').eq('id', user.id).single();
            const devicesRes = await _supabase.from('user_devices').select('device_name,added_at').eq('user_id', user.id);

            if (profileRes.error) console.warn('Profil sorgu uyarısı:', profileRes.error.message);
            if (devicesRes.error) console.warn('Cihaz sorgu uyarısı:', devicesRes.error.message);

            updateLicenseUI(profileRes.data || null);
            renderDevices(devicesRes.data || []);
        } catch (queryErr) {
            console.error('Supabase dashboard sorgu hatası:', queryErr);
            updateLicenseUI(null);
            renderDevices([]);
        }

        showSection('profileSection');
    } catch (e) {
        console.error('Dashboard yüklenirken hata oluştu:', e);
    }
}

function updateLicenseUI(profile) {
    const statusEl = document.getElementById('licenseStatus');
    const typeEl = document.getElementById('licenseType');
    const daysEl = document.getElementById('daysLeft');
    const expiryEl = document.getElementById('licenseExpiry');

    if (!profile) {
        if(statusEl) { statusEl.innerText = "Atanmamış"; statusEl.style.color = "gray"; }
        if(typeEl) typeEl.innerText = "-";
        if(daysEl) daysEl.innerText = "-";
        if(expiryEl) expiryEl.innerText = "-";
        return;
    }

    let bitis = null;
    if (profile.lisans_bitis) {
        bitis = new Date(profile.lisans_bitis);
        if(typeEl) typeEl.innerText = profile.paket_adi || "Tam Sürüm";
    } else {
        if(typeEl) typeEl.innerText = profile.paket_adi || "Lisans Atanmamış";
        if(statusEl) { statusEl.innerText = "Pasif"; statusEl.style.color = "gray"; }
        if(daysEl) daysEl.innerText = "-";
        if(expiryEl) expiryEl.innerText = "-";
        return;
    }

    if (bitis) {
        if(expiryEl) expiryEl.innerText = bitis.toLocaleDateString('tr-TR');
        const fark = bitis - new Date();
        const kalanGun = Math.ceil(fark / (1000 * 60 * 60 * 24));

        if (kalanGun > 0) {
            if(statusEl) { statusEl.innerText = "Aktif"; statusEl.style.color = "green"; }
            if(daysEl) daysEl.innerText = kalanGun + " Gün";
        } else {
            if(statusEl) { statusEl.innerText = "Süresi Doldu"; statusEl.style.color = "red"; }
            if(daysEl) daysEl.innerText = "0 Gün";
        }
    }
}

async function updatePassword() {
    const oldPass = document.getElementById('oldPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const msg = document.getElementById('passMessage');
    const btn = document.getElementById('passUpdateBtn');

    if (newPass.length < 6) {
        msg.innerText = "Yeni şifre en az 6 karakter olmalıdır.";
        msg.style.color = "red";
        return;
    }

    btn.disabled = true;
    btn.innerText = "Doğrulanıyor...";
    msg.innerText = "";

    try {
       
        const { data: { user } } = await _supabase.auth.getUser();
        const { error: signInError } = await _supabase.auth.signInWithPassword({
            email: user.email,
            password: oldPass
        });

        if (signInError) {
            msg.innerText = "Mevcut şifreniz hatalı!";
            msg.style.color = "red";
            btn.disabled = false;
            btn.innerText = "Değişiklikleri Kaydet";
            return;
        }

        
        const { error: updateError } = await _supabase.auth.updateUser({ 
            password: newPass 
        });

        if (updateError) {
            msg.innerText = "Güncelleme hatası: " + updateError.message;
            msg.style.color = "red";
        } else {
            msg.innerText = "Şifreniz başarıyla güncellendi!";
            msg.style.color = "green";
            document.getElementById('oldPassword').value = "";
            document.getElementById('newPassword').value = "";
        }
    } catch (err) {
        msg.innerText = "Beklenmedik bir hata oluştu.";
        msg.style.color = "red";
    } finally {
        btn.disabled = false;
        btn.innerText = "Değişiklikleri Kaydet";
    }
}


async function logout() {
    localStorage.removeItem('session_token');
    await _supabase.auth.signOut();
    window.location.href = '/login';
}

function renderDevices(devices) {
    const tableBody = document.getElementById('deviceTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    if (devices && devices.length > 0) {
        devices.forEach(device => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-white/10 transition border-b border-white/10';

            const nameCell = document.createElement('td');
            nameCell.className = 'p-4 font-medium text-white/90';
            nameCell.textContent = device.device_name || 'İsimsiz Cihaz';

            const dateCell = document.createElement('td');
            dateCell.className = 'p-4 text-white/60';
            dateCell.textContent = device.added_at ? new Date(device.added_at).toLocaleDateString('tr-TR') : '-';

            const statusCell = document.createElement('td');
            statusCell.className = 'p-4 text-center';
            statusCell.innerHTML = '<span class="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-xs font-bold font-sans">YETKİLİ</span>';

            row.appendChild(nameCell);
            row.appendChild(dateCell);
            row.appendChild(statusCell);
            tableBody.appendChild(row);
        });
    } else {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.setAttribute('colspan', '3');
        emptyCell.className = 'p-8 text-center text-white/40 italic';
        emptyCell.textContent = 'Henüz kayıtlı masaüstü cihazı bulunamadı.';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
    }
}

function closeContractModal() {
    const modal = document.getElementById('contractModal');
    if (modal) {
        modal.classList.add('hidden');
        document.getElementById('modalContent').innerHTML = "";
    }
}

async function openContract(type) {
    const modal = document.getElementById('contractModal');
    const title = document.getElementById('modalTitle');
    const content = document.getElementById('modalContent');

    if (!modal || !title || !content) return;

    title.innerHTML = type === 'membership' ? '<i class="fas fa-file-signature mr-2 text-blue-600"></i> Kullan\u0131m Ko\u015fullar\u0131' : '<i class="fas fa-shield-alt mr-2 text-blue-600"></i> KVKK Ayd\u0131nlatma Metni';
    content.innerHTML = '<div class="flex items-center justify-center py-10 text-slate-400"><i class="fas fa-spinner fa-spin mr-2"></i> Belge haz\u0131rlan\u0131yor...</div>';

    modal.classList.remove('hidden');

    try {
        const fileName = type === 'membership' ? 'sozlesme.txt' : 'kvkk.txt';
        const response = await fetch(`${fileName}?v=${new Date().getTime()}`);
        
        if (response.ok) {
            const text = await response.text();
            const div = document.createElement('div');
            div.className = 'whitespace-pre-line text-slate-700';
            div.textContent = text;
            content.innerHTML = '';
            content.appendChild(div);
        } else {
            content.innerHTML = `
                <div class="py-8 text-center">
                    <i class="fas fa-exclamation-triangle text-amber-400 text-4xl mb-4"></i>
                    <p class="text-slate-800 font-bold mb-2 text-lg">Belgeye Erişilemedi</p>
                    <p class="text-slate-500 leading-relaxed">
                        Teknik bir aksaklık sebebiyle talep edilen metin şu an yüklenemiyor. <br>
                        Lütfen daha sonra tekrar deneyiniz veya yönetici ile iletişime geçiniz.
                    </p>
                </div>`;
        }
    } catch (err) {
        content.innerHTML = `
            <div class="py-8 text-center text-slate-500 italic">
                <i class="fas fa-lock text-slate-300 text-4xl mb-4"></i>
                <p>Güvenli bağlantı üzerinden metin doğrulanıyor...</p>
           </div>`;
    }
}

window.addEventListener('click', (event) => {
    const modal = document.getElementById('contractModal');
    if (event.target === modal) {
        closeContractModal();
    }
});


async function saveAgreementAndLog(userId, email) {
    let userIp = '0.0.0.0';
    try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        userIp = ipData.ip;
    } catch (e) { console.error("IP alınamadı"); }

    const fullName = document.getElementById('regFullName')?.value.trim() || "";
    const phone = document.getElementById('regPhone')?.value.trim() || "";

    const { error: profileError } = await _supabase
        .from('profiles')
        .insert([{
            id: userId,
            name: fullName,
            email: email,
            phone: phone,
            license_type: 'onay_bekliyor',
            paket_adi: 'İncelemede',
            deneme_baslangic: null,
            lisans_bitis: null
        }]);

   
    const { error: agreementError } = await _supabase
        .from('user_agreements')
        .insert([{
            user_id: userId,
            version: 'v1.0-membership-kvkk',
            ip_address: userIp
        }]);

    const { error: logError } = await _supabase
        .from('user_logs')
        .insert([{
            user_id: userId,
            action_type: 'SIGNUP',
            description: `${email} kayıt oldu.`,
            ip_address: userIp
        }]);

    if (profileError || agreementError || logError) {
        console.error("Kayıt sırasında hata oluştu:", { profileError, agreementError, logError });
    } else {
        console.log("Profil, Sözleşme ve Log başarıyla oluşturuldu.");
    }
}