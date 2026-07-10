/**
 * StudyVerse V2.2.5.1 - 專業大廳專屬邏輯 (lobby-main.js)
 * 依賴：需先載入 lobby-core.js
 * 負責：手機連動 QR Code 初始化、防呆進入自習室檢查
 */

// ================= 新增：v2.2.7 裝置分流與彈窗邏輯 =================
let targetRoomUrl = '';
window.isDeviceLinked = false; 
let rollCallTimer = null; // 點名計時器變數

async function checkCurrentUserStatusOrLogout(username) {
    if (!username) return false;

    try {
        const res = await fetch(`/api/auth/check-user?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!res.ok || data.blocked) {
            localStorage.removeItem('studyVerseUser');
localStorage.removeItem('studyVerseSessionId');
localStorage.removeItem('studyVerseRole');

localStorage.removeItem('username');
localStorage.removeItem('studyverse_username');
localStorage.removeItem('currentUser');
localStorage.removeItem('studyVerseIntroCompleted');
sessionStorage.clear();

            alert(data.error || '此帳號目前無法使用。');
            window.location.href = '/';
            return false;
        }

        return true;

    } catch (err) {
        console.error('使用者狀態檢查失敗:', err);
        return true;
    }
}
// =========================================================================
// (1) QR Code 攔截器：不管系統哪個角落產生 QR Code，自動把 ID 綁進網址
// =========================================================================
if (typeof QRCode !== 'undefined') {
    const originalQRCode = QRCode;
    QRCode = function(el, options) {
        const username = localStorage.getItem('studyVerseUser') || document.getElementById('navName')?.innerText || '學員';
        const syncToken = typeof socket !== 'undefined' ? socket.id : ''; 
        
        if (typeof options === 'string' && options.includes('mobile.html')) {
            if (!options.includes('name=')) options += (options.includes('?') ? '&' : '?') + 'name=' + encodeURIComponent(username);
            if (!options.includes('sync=')) options += '&sync=' + syncToken;
        } else if (typeof options === 'object' && options.text && options.text.includes('mobile.html')) {
            if (!options.text.includes('name=')) options.text += (options.text.includes('?') ? '&' : '?') + 'name=' + encodeURIComponent(username);
            if (!options.text.includes('sync=')) options.text += '&sync=' + syncToken;
        }
        return new originalQRCode(el, options);
    };
    QRCode.CorrectLevel = originalQRCode.CorrectLevel;
}

// =========================================================================
// (2) 全域彈窗巡邏員：每 0.5 秒掃描畫面，替換 Commander 並鎖定名字輸入框
// =========================================================================
setInterval(() => {
    const username = localStorage.getItem('studyVerseUser');
    if (!username) return;

    const textInputs = document.querySelectorAll('input[type="text"]');
    textInputs.forEach(input => {
        if (input.id === 'setupName' && document.getElementById('loginOverlay') && !document.getElementById('loginOverlay').classList.contains('hidden')) return;
        
        const inputId = input.id.toLowerCase();
        if (input.value === 'Commander' || (inputId.includes('name') && !inputId.includes('team'))) {
            input.value = username;
            input.readOnly = true; 
            input.classList.add('bg-gray-800', 'text-gray-400', 'cursor-not-allowed', 'opacity-80', 'pointer-events-none');
        }
    });

    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walk.nextNode()) {
        if (node.nodeValue.includes('COMMANDER')) {
            node.nodeValue = node.nodeValue.replace(/COMMANDER/g, username);
        }
    }
}, 500);

// =========================================================
// Student Profile Modal
// 暱稱 / 真實姓名：第一次進大廳強制填寫，之後點頭像可修改
// =========================================================

window.studyVerseProfile = null;

function normalizeProfileInput(value) {
    return String(value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function updateLobbyProfileDisplay(profile) {
    if (!profile) return;

    window.studyVerseProfile = profile;

    const displayName = profile.nickname || profile.username || '學員';
    localStorage.setItem('studyVerseNickname', displayName);
localStorage.setItem('studyVerseRealName', profile.real_name || '');

    const navName = document.getElementById('navName');
    if (navName) {
        navName.innerText = displayName;
    }

    const navAvatar = document.getElementById('navAvatar');
    if (navAvatar) {
        navAvatar.src =
            `https://api.dicebear.com/7.x/big-smile/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=b6e3f4`;
    }
}

window.fetchStudyVerseProfile = async function() {
    const username = localStorage.getItem('studyVerseUser');

    if (!username) return null;

    try {
        const res = await fetch(`/api/profile?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            console.error('讀取個人資料失敗:', data);
            return null;
        }

        updateLobbyProfileDisplay(data.profile);
        return data.profile;

    } catch (err) {
        console.error('讀取個人資料失敗:', err);
        return null;
    }
};

window.openStudyVerseProfileModal = function(force = false) {
    const username = localStorage.getItem('studyVerseUser');
    const role = localStorage.getItem('studyVerseRole') || 'student';

    if (!username) return;

    // 教師 / 管理員先不強制填學生個資
    if (role === 'teacher' || role === 'admin' || role === 'teacher_pending') {
        return;
    }

    const oldModal = document.getElementById('studyVerseProfileModal');
    if (oldModal) oldModal.remove();

    const profile = window.studyVerseProfile || {};
    const nickname = normalizeProfileInput(profile.nickname || username);
    const realName = normalizeProfileInput(profile.real_name || '');

    const modal = document.createElement('div');
    modal.id = 'studyVerseProfileModal';
    modal.className =
        'fixed inset-0 z-[100001] flex items-center justify-center bg-black/85 backdrop-blur-md p-4';

    modal.innerHTML = `
        <div class="w-full max-w-lg bg-[#0f172a] border border-blue-400/30 rounded-3xl shadow-2xl overflow-hidden">
            <div class="p-7 border-b border-white/10 bg-gradient-to-b from-blue-500/10 to-transparent">
                <div class="text-blue-300 text-xs font-black tracking-[0.2em] uppercase mb-3">
                    Student Profile
                </div>

                <h2 class="text-3xl font-black text-white mb-3">
                    完成你的個人資料
                </h2>

                <p class="text-gray-300 text-sm leading-relaxed">
                    <b class="text-white">暱稱</b>會顯示在沉浸式自習室、主題教室、小隊共學與一般排行榜。<br>
                    <b class="text-white">真實姓名</b>只會用於特約教室、課程報名、教師點名、白名單辨識，以及未來 Google Meet 課程驗證。
                    一般公開共學場景不會顯示你的真實姓名。
                </p>

                ${force ? `
                    <div class="mt-4 rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-4 text-yellow-200 text-xs font-bold leading-relaxed">
                        第一次進入大廳需要先完成這兩項資料，完成後才能開始使用功能。
                    </div>
                ` : ''}
            </div>

            <div class="p-7 grid gap-4">
                <div>
                    <label class="block text-xs font-black text-blue-300 mb-2 tracking-widest uppercase">
                        暱稱 nickname
                    </label>
                    <input
                        id="profileNicknameInput"
                        value="${nickname.replace(/"/g, '&quot;')}"
                        maxlength="20"
                        class="w-full bg-black/60 border border-white/10 focus:border-blue-400 outline-none rounded-2xl px-4 py-4 text-white font-bold"
                        placeholder="請輸入暱稱">
                    <p class="mt-2 text-[11px] text-gray-500">
                        暱稱不可重複，會顯示在一般自習與共學場景。
                    </p>
                </div>

                <div>
                    <label class="block text-xs font-black text-green-300 mb-2 tracking-widest uppercase">
                        真實姓名 real name
                    </label>
                    <input
                        id="profileRealNameInput"
                        value="${realName.replace(/"/g, '&quot;')}"
                        maxlength="30"
                        class="w-full bg-black/60 border border-white/10 focus:border-green-400 outline-none rounded-2xl px-4 py-4 text-white font-bold"
                        placeholder="請輸入真實姓名">
                    <p class="mt-2 text-[11px] text-gray-500">
                        真實姓名會用於教師辨識、特約教室、報名與白名單，不會顯示在一般自習室。
                    </p>
                </div>

                <div id="profileMessage" class="hidden text-sm font-bold rounded-2xl px-4 py-3"></div>

                <button
                    id="saveProfileBtn"
                    onclick="saveStudyVerseProfile(${force ? 'true' : 'false'})"
                    class="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl transition-all">
                    儲存並進入大廳
                </button>

                <div class="grid ${force ? 'grid-cols-1' : 'grid-cols-2'} gap-3">
                    ${force ? '' : `
                        <button
                            onclick="closeStudyVerseProfileModal()"
                            class="w-full bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 rounded-2xl transition-all">
                            取消
                        </button>
                    `}

                    <button
                        onclick="logout()"
                        class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 font-bold py-3 rounded-2xl transition-all">
                        登出
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    setTimeout(() => {
        const input = document.getElementById(realName ? 'profileNicknameInput' : 'profileRealNameInput');
        if (input) input.focus();
    }, 80);
};

window.closeStudyVerseProfileModal = function() {
    const modal = document.getElementById('studyVerseProfileModal');
    if (modal) modal.remove();
};

window.saveStudyVerseProfile = async function(force = false) {
    const username = localStorage.getItem('studyVerseUser');
    const nickname = normalizeProfileInput(document.getElementById('profileNicknameInput')?.value);
    const realName = normalizeProfileInput(document.getElementById('profileRealNameInput')?.value);
    const messageBox = document.getElementById('profileMessage');
    const saveBtn = document.getElementById('saveProfileBtn');

    function showMessage(text, type = 'error') {
        if (!messageBox) return;
        messageBox.classList.remove('hidden');
        messageBox.className =
            type === 'success'
                ? 'text-sm font-bold rounded-2xl px-4 py-3 bg-green-500/10 text-green-300 border border-green-500/20'
                : 'text-sm font-bold rounded-2xl px-4 py-3 bg-red-500/10 text-red-300 border border-red-500/20';
        messageBox.innerText = text;
    }

    if (!username) {
        showMessage('登入狀態異常，請重新登入。');
        return;
    }

    if (!nickname) {
        showMessage('請填寫暱稱。');
        return;
    }

    if (!realName) {
        showMessage('請填寫真實姓名。');
        return;
    }

    if (nickname.length < 2 || nickname.length > 20) {
        showMessage('暱稱請輸入 2～20 個字。');
        return;
    }

    if (realName.length < 2 || realName.length > 30) {
        showMessage('真實姓名請輸入 2～30 個字。');
        return;
    }

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = '儲存中...';
        }

        const res = await fetch('/api/profile/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                nickname,
                real_name: realName
            })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || '儲存個人資料失敗');
        }

        updateLobbyProfileDisplay(data.profile);

        showMessage('個人資料已儲存。', 'success');

        setTimeout(() => {
            closeStudyVerseProfileModal();

            if (force && typeof window.applyLobbySubscriptionVisualLocks === 'function') {
                window.applyLobbySubscriptionVisualLocks();
            }
        }, 450);

    } catch (err) {
        showMessage(err.message || '儲存個人資料失敗');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = '儲存並進入大廳';
        }
    }
};

window.ensureStudyVerseProfileCompleted = async function(options = {}) {
    const force = options.force === true;
    const username = localStorage.getItem('studyVerseUser');
    const role = localStorage.getItem('studyVerseRole') || 'student';

    if (!username) return false;

    if (role === 'teacher' || role === 'admin' || role === 'teacher_pending') {
        return true;
    }

    const profile = await window.fetchStudyVerseProfile();

    if (!profile) {
        return false;
    }

    if (profile.profile_completed === true) {
        return true;
    }

    window.openStudyVerseProfileModal(force);
    return false;
};

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

window.isStudyVerseBetaMode = function() {
    const access = window.studyVerseAccess || {};
    const storedAccessLevel = localStorage.getItem('studyVerseAccessLevel');

    return (
        access.betaMode === true ||
        access.accessLevel === 'beta' ||
        storedAccessLevel === 'beta'
    );
};

window.showBetaModeBanner = function() {
    if (!window.isStudyVerseBetaMode()) return;

    if (document.getElementById('studyVerseBetaBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'studyVerseBetaBanner';
    banner.className =
        'fixed bottom-5 left-1/2 -translate-x-1/2 z-[99999] max-w-[92vw] bg-yellow-400 text-gray-950 px-5 py-3 rounded-2xl shadow-2xl text-xs sm:text-sm font-black border border-yellow-200';

    banner.innerHTML = `
        <i class="fas fa-flask mr-2"></i>
        封閉測試中：目前開放功能暫時免費使用，不計算正式 14 天免費體驗。
    `;

    document.body.appendChild(banner);

    setTimeout(() => {
        banner.remove();
    }, 6500);
};

// =========================================================
// Student Subscription Guard
// free / expired：只能使用沉浸式教室
// trial / pro：可使用完整功能
// 教師 / admin / teacher_pending：不受學生訂閱限制
// =========================================================
window.isStudentFullFeatureUnlocked = function() {
    const role = localStorage.getItem('studyVerseRole') || 'student';
    const username = localStorage.getItem('studyVerseUser') || '';

    // 教師 / 管理員 / 審核中教師不受學生訂閱限制
    if (role === 'teacher' || role === 'admin' || role === 'teacher_pending') {
        return true;
    }

    const access = window.studyVerseAccess || {};

        if (window.isStudyVerseBetaMode && window.isStudyVerseBetaMode()) {
        return true;
    }

    // 優先相信本頁剛從 API 拿到的權限，而且必須是同一個 username
    if (access.username && access.username === username) {
        return access.canUseFullFeatures === true;
    }

    // 備援讀 localStorage，但也必須確認是同一個 username，避免上一個帳號殘留 true
    const storedAccessUsername = localStorage.getItem('studyVerseAccessUsername');
    const storedCanUseFullFeatures =
        localStorage.getItem('studyVerseCanUseFullFeatures') === 'true';

    if (storedAccessUsername && storedAccessUsername === username) {
        return storedCanUseFullFeatures === true;
    }

    // 沒有明確權限資料時，學生一律先當免費版
    return false;
};

window.openSubscriptionPage = function() {
    const username =
        localStorage.getItem('studyVerseUser') ||
        localStorage.getItem('username') ||
        '';

    if (username) {
        window.location.href = `/subscribe.html?username=${encodeURIComponent(username)}`;
    } else {
        window.location.href = '/subscribe.html';
    }
};

window.markSubscriptionIntroSeen = async function() {
    const username = localStorage.getItem('studyVerseUser');

    if (!username) return;

    try {
        const res = await fetch('/api/subscription/intro-seen', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username })
        });

        const data = await res.json();

        if (!res.ok) {
            console.error('訂閱介紹已看過同步失敗:', data);
        }

        localStorage.setItem(`studyVerseSubscriptionIntroSeen:${username}`, 'true');

        if (window.studyVerseAccess) {
            window.studyVerseAccess.hasSeenSubscriptionIntro = true;
        }

    } catch (err) {
        console.error('訂閱介紹已看過同步失敗:', err);
        localStorage.setItem(`studyVerseSubscriptionIntroSeen:${username}`, 'true');
    }
};

window.showSubscriptionIntroModalOnce = async function() {
    const username = localStorage.getItem('studyVerseUser');
    const role = localStorage.getItem('studyVerseRole') || 'student';

    if (!username) return;

    // 教師 / admin / 審核中教師不跳學生訂閱介紹
    if (role === 'teacher' || role === 'admin' || role === 'teacher_pending') {
        return;
    }

    const localSeenKey = `studyVerseSubscriptionIntroSeen:${username}`;

    if (localStorage.getItem(localSeenKey) === 'true') {
        return;
    }

    try {
        const res = await fetch(
            `/api/subscription/status?username=${encodeURIComponent(username)}`
        );

        const data = await res.json();

        if (!res.ok) {
            console.error('讀取訂閱介紹狀態失敗:', data);
            return;
        }

                if (data.betaMode === true || data.accessLevel === 'beta') {
            localStorage.setItem(localSeenKey, 'true');
            if (typeof window.showBetaModeBanner === 'function') {
                window.showBetaModeBanner();
            }
            return;
        }

        if (data.has_seen_subscription_intro === true) {
            localStorage.setItem(localSeenKey, 'true');
            return;
        }

        let oldModal = document.getElementById('subscriptionIntroModal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.id = 'subscriptionIntroModal';
        modal.className = 'fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4';

        modal.innerHTML = `
            <div class="w-full max-w-lg bg-[#0f172a] border border-yellow-400/30 rounded-3xl shadow-2xl overflow-hidden">
                <div class="p-7 border-b border-white/10 bg-gradient-to-b from-yellow-500/10 to-transparent">
                    <div class="text-yellow-300 text-xs font-black tracking-[0.2em] uppercase mb-3">
                        Study Verse Plan
                    </div>

                    <h2 class="text-3xl font-black text-white mb-3">
                        你的 14 天完整體驗已啟用
                    </h2>

                    <p class="text-gray-300 text-sm leading-relaxed">
                        免費體驗期間可以使用完整功能。體驗結束後，免費版仍可使用
                        <b class="text-white">沉浸式自習室</b> 與
                        <b class="text-white">線上課程</b>；
                        若想繼續使用主題教室、小隊共學與特約教室，可選擇訂閱方案。
                    </p>
                </div>

                <div class="p-7 grid gap-3">
                    <button
                        id="btnViewSubscriptionPlans"
                        class="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black py-4 rounded-2xl transition-all">
                        查看我的方案
                    </button>

                    <button
                        id="btnCloseSubscriptionIntro"
                        class="w-full bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-4 rounded-2xl transition-all">
                        稍後再說，先進入大廳
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const btnViewPlans = document.getElementById('btnViewSubscriptionPlans');
const btnClose = document.getElementById('btnCloseSubscriptionIntro');

if (btnViewPlans) {
    btnViewPlans.addEventListener('click', async () => {
        await window.markSubscriptionIntroSeen();
        modal.remove();
        window.openSubscriptionPage();
    });
}

if (btnClose) {
    btnClose.addEventListener('click', async () => {
        await window.markSubscriptionIntroSeen();
        modal.remove();
    });
}

    } catch (err) {
        console.error('顯示訂閱方案介紹失敗:', err);
    }
};

window.showSubscriptionUpgradePrompt = function(featureName = '此功能') {
    
        if (window.isStudyVerseBetaMode && window.isStudyVerseBetaMode()) {
        if (typeof window.showBetaModeBanner === 'function') {
            window.showBetaModeBanner();
        }
        return;
    }

    const username = localStorage.getItem('studyVerseUser') || '';

    const goSubscribe = confirm(
        `🔒 ${featureName} 是訂閱版功能。\n\n` +
        `免費版目前可以使用「沉浸式自習室」。\n` +
        `14 天體驗期或訂閱中可使用主題教室、小隊共學、特約教室與課程功能。\n\n` +
        `是否前往查看方案？`
    );

    if (goSubscribe) {
        window.openSubscriptionPage();
    }
};

window.requireFullFeaturesForStudent = function(featureName = '此功能') {
    if (window.isStudentFullFeatureUnlocked()) {
        return true;
    }

    window.showSubscriptionUpgradePrompt(featureName);
    return false;
};

// =========================================================
// Free Plan Visual Locks
// 免費版：進階功能卡片變暗、上鎖、點擊顯示升級提示
// 注意：課程商店目前不鎖，因為免費版也開放課程功能
// =========================================================
window.lockLobbyFeatureElement = function(element, featureName = '此功能') {
    if (!element || element.dataset.subscriptionVisualLocked === 'true') return;

    element.dataset.subscriptionVisualLocked = 'true';

    const isHeaderTeamLink =
        element.matches &&
        element.matches('header a[href="team-lobby.html"], header a[data-original-href="team-lobby.html"]');

    // Header 的「切換至組隊大廳」只鎖那顆按鈕，不往上鎖整個 header
    const card = isHeaderTeamLink
        ? element
        : (
            element.closest('.room-card') ||
            element.closest('.glass-panel') ||
            element
        );

    if (!card || card.dataset.subscriptionCardLocked === 'true') return;

    card.dataset.subscriptionCardLocked = 'true';

    card.classList.add(
        'opacity-40',
        'grayscale',
        'cursor-not-allowed',
        'relative'
    );

    card.style.position = 'relative';

    // 只有一般功能卡需要 overflow hidden；header 按鈕不要亂改版面
    if (!isHeaderTeamLink) {
        card.style.overflow = 'hidden';
    }

    if (isHeaderTeamLink) {
        element.dataset.originalHref = element.getAttribute('href') || 'team-lobby.html';
        element.removeAttribute('href');
        element.setAttribute('role', 'button');
        element.innerHTML = '<i class="fas fa-lock"></i> 組隊大廳';
        element.title = '訂閱版功能';
        element.classList.add(
            'border-yellow-400/30',
            'text-yellow-300',
            'bg-yellow-500/10'
        );
    } else {
        const lockBadge = document.createElement('div');
        lockBadge.className =
            'absolute top-3 right-3 z-20 bg-black/80 border border-yellow-400/50 text-yellow-300 text-[10px] font-black px-3 py-1 rounded-full shadow-lg backdrop-blur-md';
        lockBadge.innerHTML = '<i class="fas fa-lock mr-1"></i> 訂閱版';

        card.appendChild(lockBadge);

        const actionText = card.querySelector('button, .w-full.text-center, a');
        if (actionText) {
            actionText.classList.add('bg-gray-700', 'text-gray-400');
        }
    }

    const blockClick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        window.showSubscriptionUpgradePrompt(featureName);
        return false;
    };

    card.addEventListener('click', blockClick, true);
};

window.applyLobbySubscriptionVisualLocks = function() {
   
        if (window.isStudyVerseBetaMode && window.isStudyVerseBetaMode()) {
        return;
    }

    if (window.isStudentFullFeatureUnlocked()) {
        return;
    }

    const lockTargets = [
        {
            selector: '[onclick*="showThemeRoomModal"]',
            featureName: '限時主題教室'
        },
        {
            selector: '[onclick*="loadAndShowTeamModal"]',
            featureName: '小隊共學'
        },
        {
            selector: '[onclick*="verifyAndEnterTutorRoom"]',
            featureName: 'VIP 特約指導'
        },
        {
            selector: 'header a[href="team-lobby.html"]',
            featureName: '組隊大廳'
        }
    ];

    lockTargets.forEach(item => {
        document.querySelectorAll(item.selector).forEach(el => {
            window.lockLobbyFeatureElement(el, item.featureName);
        });
    });
};

function handleRoomEntry(url) {
    targetRoomUrl = url;
    
    if (sessionStorage.getItem('mobileLinked') === 'true') {
        if (typeof openSetupModal === 'function') {
            openSetupModal(targetRoomUrl);
        } else if (typeof showRoomSetup === 'function') {
            showRoomSetup(targetRoomUrl);
        } else {
            window.location.href = targetRoomUrl;
        }
        return;
    }

    if (window.isDeviceLinked) {
        alert("⏳ 等待手機翻轉中...\n\n請將手機「螢幕朝下」蓋在桌上，系統偵測到後就會自動帶您進入教室！");
        return; 
    }

    if (isMobileDevice()) {
        document.getElementById('device-choice-modal').classList.remove('hidden');
        document.getElementById('device-choice-modal').classList.add('flex');
    } else {
        showSyncPromptModal();
    }
}

function showSyncPromptModal() {
    document.getElementById('device-choice-modal').classList.add('hidden');
    document.getElementById('device-choice-modal').classList.remove('flex');
    
    document.getElementById('sync-prompt-modal').classList.remove('hidden');
    document.getElementById('sync-prompt-modal').classList.add('flex');
}

function closeAllEntryModals() {
    document.getElementById('device-choice-modal').classList.add('hidden');
    document.getElementById('device-choice-modal').classList.remove('flex');
    document.getElementById('sync-prompt-modal').classList.add('hidden');
    document.getElementById('sync-prompt-modal').classList.remove('flex');
}

// ================= 新增：導師密碼驗證邏輯 =================

// 顯示密碼驗證彈窗
window.showTeacherPasswordModal = async function() {
    const username = localStorage.getItem('studyVerseUser');

    if (!username) {
        alert('請先登入後再使用教師功能。');
        return;
    }

    try {
        const res = await fetch(`/api/auth/check-user?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!res.ok || !data.user) {
            alert(data.error || '無法確認教師資格。');
            return;
        }

        const user = data.user;

        // 已通過教師
if (user.role === 'teacher' || user.role === 'admin') {

    if (typeof openTeacherSetupModal === 'function') {
        openTeacherSetupModal();
    }

    return;
}

// 教師審核中
if (user.role === 'teacher_pending') {

    alert('你的教師申請目前審核中，請等待平台管理員審核。');

    return;
}

/// 一般學生
alert('此功能限通過審核的教師使用。請先使用「教師註冊 / 開課申請」送出資料，並等待管理員審核通過。');

return;

    } catch (err) {
        console.error('教師權限檢查失敗:', err);
        alert('教師權限檢查失敗，請稍後再試。');
    }
};

// 關閉密碼驗證彈窗
window.closeTeacherPasswordModal = function() {
    document.getElementById('teacher-password-modal').classList.add('hidden');
    document.getElementById('teacher-password-modal').classList.remove('flex');
};

// 驗證輸入的密碼
window.verifyTeacherPassword = function() {
    const pwdInput = document.getElementById('teacher-password-input');
    const password = pwdInput ? pwdInput.value : '';
    
    // 判斷密碼是否正確
    if (password === 'tutor-professor101') {
        // 密碼正確：關閉密碼彈窗，並呼叫原本的設定教室排程彈窗
        closeTeacherPasswordModal();
        if (typeof openTeacherSetupModal === 'function') {
            openTeacherSetupModal(); 
        }
    } else {
        // 密碼錯誤
        alert('密碼錯誤！您不具備導師權限，無法建立特約教室。');
    }
};

// 支援按下 Enter 鍵也能觸發驗證
document.addEventListener('DOMContentLoaded', () => {
    const pwdInput = document.getElementById('teacher-password-input');
    if (pwdInput) {
        pwdInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                verifyTeacherPassword();
            }
        });
    }
});
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
    // 監聽點名事件
    if (typeof socket !== 'undefined') {
        socket.on('admin_action', (data) => {
            console.log('收到來自老師的動作:', data);
            if (data.action === 'start_roll_call') {
                // 這裡觸發顯示彈窗的 function
                showRollCallModal(data.duration); 
            }
        });
    }

        const teamLobbyHeaderLink = document.querySelector('header a[href="team-lobby.html"]');
    if (teamLobbyHeaderLink) {
        teamLobbyHeaderLink.addEventListener('click', function(e) {
            if (!window.requireFullFeaturesForStudent('組隊大廳')) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }, true);
    }

    const btnRoleMain = document.getElementById('btn-role-main');
    if (btnRoleMain) {
        btnRoleMain.addEventListener('click', showSyncPromptModal);
    }

    const btnRoleSensor = document.getElementById('btn-role-sensor');
    if (btnRoleSensor) {
        btnRoleSensor.addEventListener('click', () => {
            closeAllEntryModals();
            const currentUsername = localStorage.getItem('studyVerseUser') || '';
const currentDisplayName =
    window.studyVerseProfile?.nickname ||
    document.getElementById('navName')?.innerText ||
    currentUsername;

window.location.href =
    `/flip-room.html?username=${encodeURIComponent(currentUsername)}` +
    `&name=${encodeURIComponent(currentUsername)}` +
    `&displayName=${encodeURIComponent(currentDisplayName)}`;
        });
    }

    const btnSyncCancel = document.getElementById('btn-sync-cancel');
    if (btnSyncCancel) {
        btnSyncCancel.addEventListener('click', () => {
            closeAllEntryModals();
            if (typeof enterClassroomWithCheck === 'function') {
                enterClassroomWithCheck(targetRoomUrl);
            } else {
                window.location.href = targetRoomUrl;
            }
        });
    }

    const btnSyncConfirm = document.getElementById('btn-sync-confirm');
    if (btnSyncConfirm) {
        btnSyncConfirm.addEventListener('click', () => {
            closeAllEntryModals();
            const syncModule = document.getElementById('syncModule');
            if (syncModule) {
                syncModule.scrollIntoView({ behavior: 'smooth', block: 'center' });
                syncModule.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2', 'ring-offset-black', 'transition-all', 'duration-500');
                setTimeout(() => {
                    syncModule.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2', 'ring-offset-black');
                }, 2000);
            }
        });
    }
});

window.pageSpecificInit = async function() {
    const username = localStorage.getItem('studyVerseUser');

    const userOk = await checkCurrentUserStatusOrLogout(username);
    if (!userOk) return;

    const canContinue = await checkPrivacyConsent();
    if (!canContinue) return;

    initSyncQRCode();
    initLineBindQRCode();

    if (typeof window.applyLobbySubscriptionVisualLocks === 'function') {
        window.applyLobbySubscriptionVisualLocks();
    }

    if (typeof window.showBetaModeBanner === 'function') {
        window.showBetaModeBanner();
    }

    const runProfileAndPlan = async () => {
        if (typeof window.ensureStudyVerseProfileCompleted === 'function') {
            const profileReady = await window.ensureStudyVerseProfileCompleted({
                force: true
            });

            if (!profileReady) {
                return;
            }
        }

        if (typeof window.showSubscriptionIntroModalOnce === 'function') {
            window.showSubscriptionIntroModalOnce();
        }
    };

    const introKey = `studyVerseIntroCompleted:${username}`;
    const localIntroCompleted = localStorage.getItem(introKey) === 'true';

    let serverIntroCompleted = false;

    try {
        const res = await fetch(`/api/auth/check-user?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        serverIntroCompleted = data?.user?.has_seen_intro === true;
    } catch (err) {
        console.error('讀取新手導覽狀態失敗:', err);
    }

    const introCompleted = localIntroCompleted || serverIntroCompleted;

    if (!introCompleted && typeof startIntroTutorial === 'function') {
        requestAnimationFrame(() => {
            startIntroTutorial();
        });

        return;
    }

    await runProfileAndPlan();
};

async function checkPrivacyConsent() {
    const username = localStorage.getItem('studyVerseUser');

    if (!username) {
        return false;
    }

    try {
        const res = await fetch(`/api/user-stats?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!res.ok || !data.user) {
            return false;
        }

        if (!data.user.privacy_consent_at) {
            window.location.href = '/privacy-consent.html';
            return false;
        }

        return true;

    } catch (err) {
        console.error('檢查隱私同意狀態失敗:', err);
        return false;
    }
}

window.enterClassroomWithCheck = async function(roomUrl) {
    const username = localStorage.getItem('studyVerseUser');
    const userOk = await checkCurrentUserStatusOrLogout(username);
    if (!userOk) return;
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobileDevice) {
        const goStandalone = confirm("📱 偵測到您正在使用手機！\n\n是否進入「單機翻轉大廳」選擇專屬教室或隊伍？\n(將獲得專屬游擊隊標記與計分)");
        if (goStandalone) {
            const currentName = localStorage.getItem('studyVerseUser') || '';
            window.location.href = `/flip-room.html?name=${encodeURIComponent(currentName)}`;
        } else {
            if (typeof openSetupModal === 'function') {
                openSetupModal(roomUrl);
            } else if (typeof showRoomSetup === 'function') {
                showRoomSetup(roomUrl);
            } else {
                window.location.href = roomUrl;
            }
        }
    } else {
        if (typeof openSetupModal === 'function') {
            openSetupModal(roomUrl);
        } else if (typeof showRoomSetup === 'function') {
            showRoomSetup(roomUrl);
        } else {
            window.location.href = roomUrl;
        }
    }
};

function initSyncQRCode() {
    const qrcodeContainer = document.getElementById("qrcode");
    if(!qrcodeContainer) return;
    
    const syncToken = typeof socket !== 'undefined' ? socket.id : ''; 
    const userName = localStorage.getItem('studyVerseUser') || document.getElementById('navName')?.innerText || '';
    
    const baseUrl = window.location.origin; 
    const mobileUrl = `${baseUrl}/mobile.html?sync=${syncToken}&name=${encodeURIComponent(userName)}`;
    
    qrcodeContainer.innerHTML = "";
    new QRCode(qrcodeContainer, {
        text: mobileUrl,
        width: 140,
        height: 140,
        colorDark : "#0f172a",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

async function initLineBindQRCode() {
    const qrcodeContainer = document.getElementById("lineBindQrcode");
    const statusText = document.getElementById("lineBindStatus");

    if (!qrcodeContainer) return;

    const username =
        localStorage.getItem('studyVerseUser') ||
        document.getElementById('navName')?.innerText ||
        '';

    if (!username) {
        if (statusText) statusText.textContent = '請先登入後產生綁定 QR code';
        return;
    }

    try {
        const res = await fetch(`/api/line-bind-info?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '取得 LINE 綁定資訊失敗');
        }

        qrcodeContainer.innerHTML = "";

        new QRCode(qrcodeContainer, {
            text: data.bindUrl,
            width: 140,
            height: 140,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        if (statusText) {
            statusText.textContent = '掃描後可完成 LINE 一鍵綁定';
        }

    } catch (err) {
        console.error("LINE 綁定 QR code 載入失敗:", err);

        if (statusText) {
            statusText.textContent = 'LINE 綁定 QR code 載入失敗';
        }
    }
}

async function showThemeRoomModal() {
    if (!window.requireFullFeaturesForStudent('限時主題教室')) return;

    let oldModal = document.getElementById('themeRoomModal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'themeRoomModal';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';

    modal.innerHTML = `
        <div class="bg-[#111827] w-full max-w-lg rounded-3xl border border-blue-500/30 shadow-2xl overflow-hidden relative">

            <button onclick="document.getElementById('themeRoomModal').remove()"
                    class="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 z-10">
                <i class="fas fa-times"></i>
            </button>

            <div class="p-6 border-b border-gray-800 bg-gradient-to-b from-blue-900/30 to-transparent">
                <h2 class="text-2xl font-black text-white flex items-center gap-2">
                    <i class="fas fa-chalkboard text-blue-400"></i>
                    限時主題教室
                </h2>
                <p class="text-gray-400 text-xs mt-2">
                    請選擇目前開放中的主題教室。不同主題教室彼此隔離，不會互相看到。
                </p>
            </div>

            <div id="themeRoomList" class="p-6 max-h-[65vh] overflow-y-auto">
                <div class="flex flex-col items-center justify-center py-10 text-gray-500">
                    <div class="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"></div>
                    <p class="text-xs tracking-widest uppercase">正在載入主題教室...</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    await loadThemeRoomModalList();
}

window.showThemeRoomModal = showThemeRoomModal;

async function loadThemeRoomModalList() {
    const list = document.getElementById('themeRoomList');
    if (!list) return;

    try {
        const res = await fetch('/api/theme-rooms');
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '取得主題教室失敗');
        }

        const rooms = data.rooms || [];

        if (rooms.length === 0) {
            list.innerHTML = `
                <div class="text-center py-10">
                    <div class="w-14 h-14 bg-gray-500/20 rounded-2xl flex items-center justify-center text-gray-400 text-2xl mx-auto mb-4">
                        <i class="fas fa-door-closed"></i>
                    </div>
                    <h3 class="text-white font-black mb-2">目前沒有開放中的主題教室</h3>
                    <p class="text-gray-500 text-xs">請等待官方開放新的衝刺教室。</p>
                </div>
            `;
            return;
        }

        list.innerHTML = rooms.map(room => {
            const title = room.name || '主題教室';
            const description = room.description || '官方開放中的主題教室。';
            const badge = room.badge_text || '限時開放';
            const slug = room.slug;
            const roomPage = room.room_page || 'managed-room.html';
            const onlineCount = room.online_count || 0;

            const targetUrl = `${roomPage}?theme=${encodeURIComponent(slug)}`;

            return `
                <button onclick="enterThemeRoom('${targetUrl}', '${slug}', '${String(title).replace(/'/g, "\\'")}')"
                        class="w-full bg-white/5 hover:bg-blue-500/10 border border-white/10 hover:border-blue-500/50 p-5 rounded-2xl mb-4 text-left transition-all group">

                    <div class="flex items-start gap-4">
                        <div class="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-400 text-2xl group-hover:bg-blue-500 group-hover:text-white transition-all">
                            <i class="fas fa-users-viewfinder"></i>
                        </div>

                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <h3 class="text-white font-black text-lg">${title}</h3>
                                <span class="text-[9px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-black">
                                    ${badge}
                                </span>
                            </div>

                            <p class="text-gray-500 text-xs leading-relaxed mb-3">
                                ${description}
                            </p>

                            <div class="flex items-center justify-between">
                                <span class="text-green-400 text-xs font-bold">
                                    <i class="fas fa-circle text-[8px] mr-1"></i>
                                    目前 ${onlineCount} 人
                                </span>

                                <span class="text-blue-400 text-xs font-black group-hover:text-blue-300">
                                    進入教室 →
                                </span>
                            </div>
                        </div>
                    </div>
                </button>
            `;
        }).join('');

    } catch (err) {
        console.error('主題教室列表載入失敗:', err);

        list.innerHTML = `
            <div class="text-center py-10">
                <div class="w-14 h-14 bg-red-500/20 rounded-2xl flex items-center justify-center text-red-400 text-2xl mx-auto mb-4">
                    <i class="fas fa-triangle-exclamation"></i>
                </div>
                <h3 class="text-red-300 font-black mb-2">主題教室載入失敗</h3>
                <p class="text-gray-500 text-xs">請稍後重新整理頁面。</p>
            </div>
        `;
    }
}

window.enterThemeRoom = function(targetUrl, slug, name) {
    if (!window.requireFullFeaturesForStudent('限時主題教室')) return;

    const modal = document.getElementById('themeRoomModal');
    if (modal) modal.remove();

    // 加入主題教室小隊：選完主題後，再開手機連動 / 略過連動
    if (window.pendingThemeTeamJoinData) {
        const data = window.pendingThemeTeamJoinData;
        window.pendingThemeTeamJoinData = null;

        if (typeof window.joinSpecificTeam === 'function') {
            window.joinSpecificTeam(
                data.teamId,
                data.teamName,
                targetUrl,
                'selected_theme_room'
            );
        }

        return;
    }

    // 建立主題教室小隊：沿用前面已做的建立流程
    if (window.pendingSquadCreateData) {
        window.executeThemeRoomTeamCreation({
            targetUrl,
            slug,
            name
        });

        return;
    }

    handleRoomEntry(targetUrl);
};

window.copyMobileUrl = function() {
    const baseUrl = window.location.origin;
    const mobileUrl = `${baseUrl}/mobile.html`;
    navigator.clipboard.writeText(mobileUrl).then(() => {
        alert('手機連動網址已複製到剪貼簿！');
    });
};

window.cancelDeviceSync = function() {
    window.isDeviceLinked = false;
    sessionStorage.removeItem('mobileLinked');
    localStorage.removeItem('mobileLinked');
    
    const userName = localStorage.getItem('studyVerseUser') || document.getElementById('navName')?.innerText || '';
    if (typeof socket !== 'undefined') {
        socket.emit('mobile_sync_update', { type: 'FORCE_DISCONNECT', studentName: userName });
    }
    
    const syncModule = document.getElementById('syncModule');
    if (syncModule) {
        syncModule.innerHTML = `
            <div class="text-blue-500 text-xs font-black mb-4 flex items-center gap-2">
                <i class="fas fa-qrcode"></i> 手機連動 QR CODE
            </div>
            <div id="qrcode" class="p-2 bg-white rounded-xl shadow-2xl shadow-blue-500/20"></div>
            <p class="text-[10px] text-gray-500 mt-4 leading-relaxed">請用手機掃描並完成翻轉<br>即可在 AI 教室中獲得誤判豁免</p>
            <button onclick="copyMobileUrl()" class="mt-4 text-[10px] text-blue-500 font-mono underline hover:text-blue-400 transition-colors">COPY MOBILE LINK</button>
        `;
        initSyncQRCode();
    }
};

window.loadAndShowTeamModal = async function(modalType) {
    if (!window.requireFullFeaturesForStudent('小隊共學')) return;

    const btn = window.event ? window.event.currentTarget : null;
    let originalText = '';
    
    if (btn) {
        originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 載入中...';
        btn.disabled = true;
    }

    try {
        if (!document.getElementById('team-css-link')) {
            const link = document.createElement('link');
            link.id = 'team-css-link';
            link.rel = 'stylesheet';
            link.href = '/css/lobby-team.css';
            document.head.appendChild(link);
        }

        if (!customElements.get('team-modals')) {
            await loadScriptAsync('/js/team-modals.js');
            const modalContainer = document.createElement('team-modals');
            document.body.appendChild(modalContainer);
        }

        if (!window.executeJoinTeam) {
            await loadScriptAsync('/js/lobby-team.js');
        }

        setTimeout(() => {
            const targetId = modalType === 'create' ? 'createTeamModal' : 'joinTeamModal';
            const targetModal = document.getElementById(targetId);
            
            if (targetModal) {
                targetModal.classList.remove('hidden');
                targetModal.classList.add('flex');
            } else {
                if (modalType === 'create' && typeof window.openCreateTeamModal === 'function') {
                    window.openCreateTeamModal();
                } else if (modalType === 'join' && typeof window.openJoinTeamModal === 'function') {
                    window.openJoinTeamModal();
                }
            }
        }, 50); 

    } catch (error) {
        console.error("載入組隊模組失敗:", error);
        alert("載入失敗，請稍後再試！");
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
};

function loadScriptAsync(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
}

socket.on("status_updated", (data) => {
    const userCard = document.getElementById(`user-card-${data.name}`); 
    if (userCard) {
        if (data.isFlipped) {
            userCard.classList.add('is-mobile-flip');
            userCard.setAttribute('title', '📱 手機翻轉深度專注中 (積分 x0.5)');
            const statusText = userCard.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = "游擊隊專注中";
                statusText.style.color = "#3b82f6";
            }
        } else {
            userCard.classList.remove('is-mobile-flip');
            userCard.setAttribute('title', data.status === "FOCUSED" ? '在線專注中' : '一般狀態');
            const statusText = userCard.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = data.status === "FOCUSED" ? "專注中" : "閒置";
                statusText.style.color = ""; 
            }
        }
    }
});

socket.on('flip_failed', (data) => {
    const currentRoomCode =
        new URLSearchParams(window.location.search).get('room') ||
        new URLSearchParams(window.location.search).get('roomId') ||
        window.currentTutorRoomCode ||
        window.currentRoomCode;

    const eventRoom =
        data?.roomId ||
        data?.room ||
        data?.roomCode;

    if (eventRoom && currentRoomCode && eventRoom !== currentRoomCode) {
        console.log("⏭️ 忽略非本教室 flip_failed:", {
            currentRoomCode,
            eventRoom,
            data
        });
        return;
    }

    const userName = data.name;
    const userCard = document.getElementById(`user-card-${userName}`);

    if (userCard) {
        userCard.classList.add('flip-failed-shatter');

        const statusText = userCard.querySelector('.status-text');
        if (statusText) {
            statusText.innerHTML = "💔 專注陣亡";
            statusText.style.color = "#ef4444";
        }

        setTimeout(() => {
            userCard.classList.remove('flip-failed-shatter');
        }, 10000);
    }

    const chatBox = document.getElementById('chat-messages');
    if (chatBox) {
        const msgEl = document.createElement('div');
        msgEl.className = 'w-full text-center my-3';
        msgEl.innerHTML = `
            <span class="inline-block bg-red-950/80 text-red-300 text-xs px-4 py-1.5 rounded-full border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.5)]">
                🚨 系統廣播：<b>${userName}</b> 忍不住拿起了手機，翻轉專注中斷！
            </span>
        `;
        chatBox.appendChild(msgEl);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    const shatterSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2855/2855-preview.mp3');
    shatterSound.volume = 0.6;
    shatterSound.play().catch(() => {});

    showPublicShamingToast(userName);
});
const shamingStyle = document.createElement('style');
shamingStyle.innerHTML = `
    @keyframes shatterAndShake {
        0% { transform: translate(2px, 1px) rotate(0deg); filter: grayscale(0%); }
        10% { transform: translate(-1px, -2px) rotate(-2deg); filter: grayscale(20%); }
        20% { transform: translate(-3px, 0px) rotate(2deg); filter: grayscale(40%); }
        30% { transform: translate(3px, 2px) rotate(0deg); filter: grayscale(60%); }
        40% { transform: translate(1px, -1px) rotate(2deg); filter: grayscale(80%); }
        50% { transform: translate(-1px, 2px) rotate(-2deg); filter: grayscale(100%) sepia(30%) hue-rotate(-50deg) saturate(300%); box-shadow: 0 0 25px rgba(239,68,68,0.9); border-color: #ef4444; }
        100% { transform: translate(0, 0) rotate(0deg); filter: grayscale(100%); opacity: 0.5; border-color: #52525b; }
    }
    .flip-failed-shatter {
        animation: shatterAndShake 0.6s forwards;
        pointer-events: none; 
    }
    .shaming-toast {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(90deg, rgba(127,29,29,0.95), rgba(220,38,38,0.95));
        color: white;
        padding: 12px 24px;
        border-radius: 50px;
        font-weight: 900;
        font-size: 16px;
        z-index: 999999;
        box-shadow: 0 10px 30px rgba(220, 38, 38, 0.6);
        display: flex;
        align-items: center;
        gap: 12px;
        animation: slideDownOut 4.5s forwards;
    }
    @keyframes slideDownOut {
        0% { top: -60px; opacity: 0; transform: translate(-50%, -20px); }
        10% { top: 20px; opacity: 1; transform: translate(-50%, 0); }
        85% { top: 20px; opacity: 1; transform: translate(-50%, 0); }
        100% { top: -60px; opacity: 0; transform: translate(-50%, -20px); }
    }
`;
document.head.appendChild(shamingStyle);

function showPublicShamingToast(userName) {
    const toast = document.createElement('div');
    toast.className = 'shaming-toast';
    toast.innerHTML = `<i class="fas fa-skull-crossbones animate-bounce text-xl text-black"></i> <span>快看！<b>${userName}</b>剛剛放棄了專注！</span> <i class="fas fa-hand-point-down text-xl text-black"></i>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000); 
}

socket.on('deviceLinked', (data) => {
    console.log("✅ [Lobby] 收到 deviceLinked:", data);

    if (sessionStorage.getItem('mobileLinked') === 'true') return;
    window.isDeviceLinked = true;
    closeAllEntryModals();  
    
    const syncModule = document.getElementById('syncModule');
    if (syncModule) {
        syncModule.classList.add('ring-4', 'ring-blue-500');
        syncModule.innerHTML = `
            <div class="text-green-500 text-sm font-black mb-4 flex items-center gap-2 justify-center">
                <i class="fas fa-link"></i> 已與手機連線成功
            </div>
            <div class="p-4 bg-blue-900/40 rounded-xl border border-blue-500/30 text-white font-bold animate-pulse">
                <i class="fas fa-mobile-alt mb-2 text-2xl"></i><br>請將手機螢幕朝下蓋在桌上<br>以進入教室
            </div>
            <button onclick="cancelDeviceSync()" class="mt-4 text-xs text-red-400 hover:text-red-300 transition-colors underline flex items-center justify-center gap-1 mx-auto w-full">
                <i class="fas fa-times-circle"></i> 取消連線並重置
            </button>
        `;
    }
});

socket.on('mobile_sync_update', (data) => {
    console.log("✅ [Lobby] 收到 mobile_sync_update:", data);
    if (data.type === 'FLIP_COMPLETED') {
        alert("✅ 連動成功！手機已確認朝下置放。"); 
        const syncModule = document.getElementById('syncModule');
        if (syncModule) {
            syncModule.classList.remove('ring-4', 'ring-blue-500');
            syncModule.innerHTML = `
                <div class="text-green-500 text-sm font-black mb-4 flex items-center gap-2 justify-center">
                    <i class="fas fa-check-circle"></i> 連動且翻轉完成
                </div>
                <div class="p-4 bg-green-500/10 rounded-xl border border-green-500/30 text-green-400 font-bold text-sm">
                    📱 AI 誤判豁免已啟用
                </div>
                <p class="text-[10px] text-gray-500 mt-4 leading-relaxed">您的手機正在作為翻轉感測器運作中<br>請勿將手機翻回正面</p>
            `;
        }
        sessionStorage.setItem('mobileLinked', 'true');
        localStorage.setItem('mobileLinked', 'true');
        window.isDeviceLinked = true;

        let isTeamModalOpen = false;
        const openModals = Array.from(document.querySelectorAll('.fixed.inset-0')).filter(m => !m.classList.contains('hidden') && window.getComputedStyle(m).display !== 'none');
        
        openModals.forEach(modal => {
            const buttons = Array.from(modal.querySelectorAll('button'));
            const nextBtn = buttons.find(btn => (btn.innerText.includes('下一步') || btn.innerText.includes('完成') || btn.innerText.includes('繼續')) && !btn.closest('.hidden') && window.getComputedStyle(btn).display !== 'none');
            if (nextBtn) {
                isTeamModalOpen = true;
                setTimeout(() => nextBtn.click(), 300); 
            }
        });

        if (!isTeamModalOpen && targetRoomUrl) {
            setTimeout(() => {
                if (typeof openSetupModal === 'function') {
                    openSetupModal(targetRoomUrl);
                } else if (typeof showRoomSetup === 'function') {
                    showRoomSetup(targetRoomUrl);
                } else {
                    window.location.href = targetRoomUrl;
                }
            }, 500); 
        }
    }
});

window.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem('mobileLinked');
    sessionStorage.removeItem('mobileLinked');
    window.isDeviceLinked = false;

    setTimeout(() => {
        const userName = localStorage.getItem('studyVerseUser') || document.getElementById('navName')?.innerText || '學員';
        if (typeof socket !== 'undefined' && userName) {
            socket.emit('mobile_sync_update', { type: 'FORCE_DISCONNECT', studentName: userName });
        }
    }, 500);

    const syncModule = document.getElementById('syncModule');
    if (syncModule) {
        syncModule.innerHTML = `
            <div class="text-blue-500 text-xs font-black mb-4 flex items-center gap-2">
                <i class="fas fa-qrcode"></i> 手機連動 QR CODE
            </div>
            <div id="qrcode" class="p-2 bg-white rounded-xl shadow-2xl shadow-blue-500/20"></div>
            <p class="text-[10px] text-gray-500 mt-4 leading-relaxed">請用手機掃描並完成翻轉<br>即可在 AI 教室中獲得誤判豁免</p>
            <button onclick="copyMobileUrl()" class="mt-4 text-[10px] text-blue-500 font-mono underline hover:text-blue-400 transition-colors">COPY MOBILE LINK</button>
        `;
        if (typeof initSyncQRCode === 'function') {
            initSyncQRCode();
        }
    }
});

// =========================================================================
// (3) 新增：點名系統邏輯
// =========================================================================
function showRollCallModal(duration) {
    const overlay = document.getElementById('rollcall-overlay');
    const timerText = document.getElementById('rollcall-timer-text');
    const timerBar = document.getElementById('rollcall-timer-bar');
    const checkInBtn = document.getElementById('check-in-btn');

    if (!overlay || !timerText) return;

    let timeLeft = duration;
    overlay.classList.remove('hidden');

    // 倒數計時邏輯
    clearInterval(rollCallTimer);
    rollCallTimer = setInterval(() => {
        timeLeft--;
        timerText.innerText = timeLeft;
        
        // 更新進度條長度
        if (timerBar) {
            const percent = (timeLeft / duration) * 100;
            timerBar.style.width = `${percent}%`;
        }

        if (timeLeft <= 0) {
            autoFailRollCall();
        }
    }, 1000);

    // 簽到按鈕點擊
    if (checkInBtn) {
        checkInBtn.onclick = () => {
            submitCheckIn();
        };
    }
}

function submitCheckIn() {
    if (typeof socket !== 'undefined') {
        socket.emit('student_check_in', {
            timestamp: Date.now(),
            status: 'SUCCESS'
        });
    }
    closeRollCall();
}

function autoFailRollCall() {
    if (typeof socket !== 'undefined') {
        socket.emit('student_check_in', {
            timestamp: Date.now(),
            status: 'MISSED'
        });
    }
    closeRollCall();
}

function closeRollCall() {
    clearInterval(rollCallTimer);
    const overlay = document.getElementById('rollcall-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// =========================================================================
// (4) 新增：VIP 特約教室雙重認證入口邏輯
// =========================================================================

// 記錄當前是否正在進行特約教室驗證流程
let isProcessingTutorEntry = false;

/**
 * 打開特約教室驗證彈窗
 */
function openTutorRoomSetup() {
    isProcessingTutorEntry = true;
    
    // 1. 顯示彈窗
    const modal = document.getElementById('tutor-setup-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // 2. 初始化 UI 狀態 (重置所有步驟)
    resetTutorModalUI();

    // 3. 生成針對導師教室連動的 QR Code
    initTutorSpecificQRCode();
}

/**
 * 關閉特約教室驗證彈窗
 */
function closeTutorSetupModal() {
    isProcessingTutorEntry = false;
    const modal = document.getElementById('tutor-setup-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * 重置彈窗 UI 到初始狀態
 */
function resetTutorModalUI() {
    // 步驟 1 重置
    document.getElementById('tutor-step-1').classList.remove('border-green-500', 'bg-green-950/30');
    document.getElementById('tutor-step-1-icon').classList.remove('bg-green-600', 'text-white');
    document.getElementById('tutor-step-1-status').innerText = '等待掃描...';
    document.getElementById('tutor-step-1-status').classList.remove('text-green-400');
    document.getElementById('tutor-step-1-check').classList.add('hidden');

    // 步驟 2 重置
    document.getElementById('tutor-step-2').classList.add('opacity-50');
    document.getElementById('tutor-step-2').classList.remove('border-green-500', 'bg-green-950/30', 'border-yellow-500/50');
    document.getElementById('tutor-step-2-icon').classList.remove('bg-green-600', 'bg-yellow-600', 'text-white');
    document.getElementById('tutor-step-2-status').innerText = '等待步驟一完成...';
    document.getElementById('tutor-step-2-status').classList.remove('text-green-400', 'text-yellow-400');
    document.getElementById('tutor-step-2-check').classList.add('hidden');

    // 區塊重置
    document.getElementById('tutor-qrcode-container').classList.remove('hidden');
    document.getElementById('tutor-redirect-notice').classList.add('hidden');
}

/**
 * 生成特約教室專用的 QR Code
 * 這裡可以選擇是否要在網址中加入特定參數告訴 mobile.html 這是去 VIP 教室
 */
function initTutorSpecificQRCode() {
    const qrcodeContainer = document.getElementById("tutor-qrcode");
    if(!qrcodeContainer) return;
    
    qrcodeContainer.innerHTML = ""; // 清空舊的

    const syncToken = typeof socket !== 'undefined' ? socket.id : ''; 
    const userName = localStorage.getItem('studyVerseUser') || '學員';
    
    const baseUrl = window.location.origin; 
    // 網址指向 mobile.html，加入 target=tutor 參數 (選擇性，供 mobile.html UI 切換用)
    const mobileUrl = `${baseUrl}/mobile.html?sync=${syncToken}&name=${encodeURIComponent(userName)}&target=tutor`;
    
    // 生成 QR Code (樣式與大廳 sidebar 保持一致)
    new QRCode(qrcodeContainer, {
        text: mobileUrl,
        width: 140,
        height: 140,
        colorDark : "#0f172a",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

window.enterMyTutorDashboard = async function() {
    const username = localStorage.getItem('studyVerseUser');

    if (!username) {
        alert('請先登入後再進入教師端。');
        return;
    }

    try {
        const userRes = await fetch(`/api/auth/check-user?username=${encodeURIComponent(username)}`);
        const userData = await userRes.json();

        if (!userRes.ok || !userData.user) {
            alert(userData.error || '無法確認教師資格。');
            return;
        }

        const user = userData.user;

        if (
            user.role !== 'teacher' &&
            user.role !== 'admin'
        ) {
            alert('此功能限通過審核的教師使用。');
            return;
        }

        if (
            user.role === 'teacher' &&
            user.teacher_status !== 'approved'
        ) {
            alert('你的教師資格尚未通過審核。');
            return;
        }

        const scheduleRes = await fetch(`/api/tutor-schedules?teacherUsername=${encodeURIComponent(username)}`);
        const scheduleData = await scheduleRes.json();

        if (
            !scheduleRes.ok ||
            !scheduleData.success ||
            !Array.isArray(scheduleData.schedules) ||
            scheduleData.schedules.length === 0
        ) {
            alert('目前找不到你的特約教室排程，請先設定教室排程。');
            return;
        }

        const latestSchedule = scheduleData.schedules[0];
        const roomCode = latestSchedule.room_code;

        if (!roomCode) {
            alert('排程資料缺少教室代碼，請重新建立排程。');
            return;
        }

        window.location.href =
            `/tutor-dashboard.html?room=${encodeURIComponent(roomCode)}&teacher=${encodeURIComponent(username)}`;

    } catch (err) {
        console.error('進入教師端失敗:', err);
        alert('進入教師端失敗，請稍後再試。');
    }
};

// 開啟教師排課彈窗 (後續可加上權限驗證 API)
window.openTeacherSetupModal = function() {
    const modal = document.getElementById('teacher-setup-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.toggleTeacherWeekday = function(button) {
    if (!button) return;

    const isSelected = button.dataset.selected === 'true';

    if (isSelected) {
        button.dataset.selected = 'false';
        button.classList.remove('bg-blue-600', 'text-white', 'border-blue-300', 'shadow-[0_0_15px_rgba(59,130,246,0.35)]');
        button.classList.add('bg-black', 'text-gray-400', 'border-blue-500/30');
    } else {
        button.dataset.selected = 'true';
        button.classList.remove('bg-black', 'text-gray-400', 'border-blue-500/30');
        button.classList.add('bg-blue-600', 'text-white', 'border-blue-300', 'shadow-[0_0_15px_rgba(59,130,246,0.35)]');
    }
};

function getSelectedTeacherWeekdays() {
    return Array.from(document.querySelectorAll('.teacher-weekday-btn'))
        .filter(btn => btn.dataset.selected === 'true')
        .map(btn => Number(btn.dataset.weekday))
        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
}

// 教師生成房間並跳轉
// 教師生成房間並跳轉
window.generateTeacherRoom = async function() {
    const size = document.getElementById('teacherRoomSize')?.value || '10';
    const periods = document.getElementById('teacherPeriods')?.value;
    const periodTime = document.getElementById('teacherPeriodTime')?.value;
    const restTime = document.getElementById('teacherRestTime')?.value;
    const startTime = document.getElementById('teacherStartTime')?.value;

    const startDate = document.getElementById('teacherProgramStartDate')?.value || '';
    const endDate = document.getElementById('teacherProgramEndDate')?.value || '';
    const roomNote = document.getElementById('teacherRoomNote')?.value.trim() || '';

    const weekdays = getSelectedTeacherWeekdays();
    const allowStudentScheduleChoice =
    document.getElementById('allowStudentScheduleChoiceCheckbox')?.checked === true;

    if (!startDate || !endDate) {
        alert('請選擇週期開始日期與結束日期。');
        return;
    }

    if (endDate < startDate) {
        alert('結束日期不能早於開始日期。');
        return;
    }

    if (weekdays.length === 0) {
        alert('請至少選擇一個每週上課日。');
        return;
    }

    if (!periods || !periodTime || restTime === '' || !startTime) {
        alert('請將時間、堂數、每堂分鐘與休息分鐘填寫完整。');
        return;
    }

    const username = localStorage.getItem('studyVerseUser');

    if (!username) {
        alert('請先登入後再建立教師教室。');
        return;
    }

    try {
        const res = await fetch('/api/tutor-programs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
    teacherUsername: username,
    roomTitle: roomNote || '特約教室',
    title: roomNote || '特約教室',
    roomNote,
    roomSize: size,
    maxStudents: Number(size),
    startDate,
    endDate,
    weekdays,
    periods: parseInt(periods, 10),
    classMinutes: parseInt(periodTime, 10),
    restMinutes: parseInt(restTime, 10),
    startTime,
    allowStudentScheduleChoice,
    allow_student_schedule_choice: allowStudentScheduleChoice
})
        });

        const data = await res.json();

        if (
            !res.ok ||
            !data.success ||
            !data.program ||
            !Array.isArray(data.schedules) ||
            data.schedules.length === 0
        ) {
            alert(data.error || '建立週期特約教室失敗，請確認排程資料。');
            return;
        }

        const firstSchedule = data.schedules[0];
        const roomCode = firstSchedule.room_code;

        if (!roomCode) {
            alert('週期教室已建立，但第一堂課缺少教室代碼，請重新整理後到教師端查看。');
            return;
        }

        const scheduleData = {
    roomCode,
    room_code: roomCode,

    programId: data.program?.id || firstSchedule.program_id || null,
    program_id: data.program?.id || firstSchedule.program_id || null,
    programRoomCode: data.program?.room_code || null,
    program_room_code: data.program?.room_code || null,

    teacherUsername: username,
    teacher_username: username,
    roomTitle: firstSchedule.room_title || data.program?.title || '特約教室',
    roomNote: firstSchedule.room_note || data.program?.room_note || roomNote || '',
    roomSize: firstSchedule.room_size || size,

    periods: Number(firstSchedule.periods || periods || 1),
    periodTime: Number(firstSchedule.class_minutes || periodTime || 50),
    classMinutes: Number(firstSchedule.class_minutes || periodTime || 50),
    restTime: Number(firstSchedule.rest_minutes || restTime || 10),
    restMinutes: Number(firstSchedule.rest_minutes || restTime || 10),

    startTime: firstSchedule.start_time || startTime,
    scheduledDate: firstSchedule.scheduled_date,
    scheduled_date: firstSchedule.scheduled_date,

    requiresWhitelist: firstSchedule.requires_whitelist === true,
    requires_whitelist: firstSchedule.requires_whitelist === true,

    status: firstSchedule.status || 'scheduled',
    id: firstSchedule.id
};

        localStorage.setItem(`tutor_schedule_${roomCode}`, JSON.stringify(scheduleData));

        const modal = document.getElementById('teacher-setup-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        alert(
            `✅ 週期特約教室建立成功！\n\n` +
            `共產生 ${data.scheduleCount || data.schedules.length} 次上課房間。\n` +
            `課程報名代碼：${data.program.room_code}\n` +
            `第一堂教室代碼：${roomCode}\n\n` +
            `接下來會進入教師端，你也可以從下拉選單切換其他日期的教室。`
        );

        window.location.href =
            `/tutor-dashboard.html?room=${encodeURIComponent(roomCode)}&teacher=${encodeURIComponent(username)}`;

    } catch (err) {
        console.error('建立週期特約教室失敗:', err);
        alert('建立週期特約教室失敗，請稍後再試。');
    }
};

// ================= 新增：VIP 特約教室代碼驗證與專屬跳轉 =================
window.verifyAndEnterTutorRoom = async function() {
    if (!window.requireFullFeaturesForStudent('VIP 特約指導')) return;

    const codeInput = document.getElementById('tutorRoomCode');
const roomCode = codeInput ? codeInput.value.trim().toUpperCase() : '';

    if (!roomCode) {
        alert("請先輸入教師提供的教室代碼！");
        return;
    }

    try {
       const username =
    localStorage.getItem('studyVerseUser') ||
    localStorage.getItem('username') ||
    '';

const sessionId =
    localStorage.getItem('studyVerseSessionId') ||
    '';

if (!username || !sessionId) {
    alert('登入狀態已失效，請重新登入');
    localStorage.removeItem('studyVerseUser');
    localStorage.removeItem('studyVerseSessionId');
    localStorage.removeItem('studyVerseRole');
    localStorage.removeItem('username');
    localStorage.removeItem('studyverse_username');
    localStorage.removeItem('currentUser');
    sessionStorage.clear();
    window.location.href = '/';
    return;
}

const res = await fetch(
    `/api/tutor-schedules/by-code/${encodeURIComponent(roomCode)}?username=${encodeURIComponent(username)}`,
    {
        headers: {
            'X-StudyVerse-Session-Id': sessionId
        }
    }
);

const data = await res.json();

if (!res.ok || !data.success || !data.schedule) {
    if (data.forceLogout === true) {
        alert(data.error || '此帳號已在其他裝置登入，請重新登入');

        localStorage.removeItem('studyVerseUser');
        localStorage.removeItem('studyVerseSessionId');
        localStorage.removeItem('studyVerseRole');
        localStorage.removeItem('username');
        localStorage.removeItem('studyverse_username');
        localStorage.removeItem('currentUser');

        sessionStorage.clear();
        window.location.href = '/';
        return;
    }

    alert(data.error || '找不到此特約教室，請確認代碼是否正確。');
    return;
}

        const schedule = data.schedule;
        const actualRoomCode = schedule.room_code;

        const scheduleData = {
    roomCode: actualRoomCode,
    room_code: actualRoomCode,

    inputCode: roomCode,
    input_code: roomCode,

    resolvedFrom: data.resolved_from || 'schedule_code',
    resolved_from: data.resolved_from || 'schedule_code',

    programId: data.program?.id || schedule.program_id || null,
    program_id: data.program?.id || schedule.program_id || null,
    programRoomCode: data.program?.room_code || null,
    program_room_code: data.program?.room_code || null,

    teacherUsername: schedule.teacher_username,
    teacher_username: schedule.teacher_username,
    roomTitle: schedule.room_title || data.program?.title || '特約教室',
    roomNote: schedule.room_note || data.program?.room_note || '',

    roomSize: schedule.room_size,
    periods: Number(schedule.periods || 1),
    periodTime: Number(schedule.class_minutes || 50),
    classMinutes: Number(schedule.class_minutes || 50),
    restTime: Number(schedule.rest_minutes || 10),
    restMinutes: Number(schedule.rest_minutes || 10),

    startTime: schedule.start_time,
    scheduledDate: schedule.scheduled_date,
    scheduled_date: schedule.scheduled_date,

    requiresWhitelist: schedule.requires_whitelist === true,
    requires_whitelist: schedule.requires_whitelist === true,

    status: schedule.status,
    id: schedule.id
};

        sessionStorage.setItem('currentTutorRoomCode', actualRoomCode);
localStorage.setItem(`tutor_schedule_${actualRoomCode}`, JSON.stringify(scheduleData));

targetRoomUrl = `/tutor-room.html?room=${encodeURIComponent(actualRoomCode)}`;

        const normalModal = document.getElementById('device-modal');
        if (normalModal) {
            normalModal.classList.add('hidden');
            normalModal.classList.remove('flex');
        }

        const qrContainer = document.getElementById('tutor-qrcode-container');
        const tutorModal = document.getElementById('tutor-auth-modal') ||
                           document.getElementById('tutorModal') ||
                           (qrContainer ? qrContainer.closest('.fixed') : null);

        if (tutorModal) {
            tutorModal.classList.remove('hidden');
            tutorModal.classList.add('flex', 'z-[100]');

            if (qrContainer) {
                qrContainer.innerHTML = '';

                const username = localStorage.getItem('studyVerseUser') || '學員';
                const syncToken = typeof socket !== 'undefined' ? socket.id : '';

                const mobileUrl =
    `${window.location.origin}/mobile.html?name=${encodeURIComponent(username)}&sync=${syncToken}&target=tutor&room=${encodeURIComponent(actualRoomCode)}`;

                new QRCode(qrContainer, {
                    text: mobileUrl,
                    width: 160,
                    height: 160,
                    colorDark: "#ffffff",
                    colorLight: "#000000"
                });
            }
        } else {
            alert("找不到特約教室連動彈窗，請檢查 HTML 結構。");
        }

    } catch (err) {
        console.error('驗證特約教室代碼失敗:', err);
        alert('驗證特約教室代碼失敗，請稍後再試。');
    }
};

// 若手機連動成功並翻轉，將會跳轉至 targetRoomUrl (已夾帶 roomCode)，成功避開一般教室的彈窗！
// ================= 新增：自動計算下課時間 =================
function calculateTeacherEndTime() {
    const periods = parseInt(document.getElementById('teacherPeriods').value) || 0;
    const periodTime = parseInt(document.getElementById('teacherPeriodTime').value) || 0;
    const restTime = parseInt(document.getElementById('teacherRestTime').value) || 0;
    const startTimeVal = document.getElementById('teacherStartTime').value;

    const container = document.getElementById('endTimeDisplayContainer');
    const timeDisplay = document.getElementById('calculatedEndTime');

    if (periods > 0 && periodTime > 0 && startTimeVal) {
        // 計算總分鐘數: (節數 * 每節時間) + ((節數 - 1) * 休息時間)
        const totalMinutes = (periods * periodTime) + ((periods > 1) ? (periods - 1) * restTime : 0);
        
        const [hours, minutes] = startTimeVal.split(':').map(Number);
        let date = new Date();
        date.setHours(hours, minutes, 0, 0);
        date.setMinutes(date.getMinutes() + totalMinutes);

        const endHours = String(date.getHours()).padStart(2, '0');
        const endMins = String(date.getMinutes()).padStart(2, '0');
        
        timeDisplay.innerText = `${endHours}:${endMins}`;
        container.classList.remove('hidden');
        container.classList.add('flex');
    } else {
        container.classList.add('hidden');
        container.classList.remove('flex');
    }
}

// 監聽輸入框變化以即時計算
document.addEventListener('DOMContentLoaded', () => {
    const inputs = ['teacherPeriods', 'teacherPeriodTime', 'teacherRestTime', 'teacherStartTime'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calculateTeacherEndTime);
    });
});

/**
 * 執行 Google Meet 跳轉 (符合 Chrome 線上商店安全性規範)
 */
function enterCourseMeet(meetId) {
    const username = localStorage.getItem('studyVerseUser') || "未知學生";
    
    // 將名字編碼並附加為 URL 參數，供擴充套件讀取
    const encodedName = encodeURIComponent(username);
    const targetUrl = `https://meet.google.com/${meetId}?sv_user_name=${encodedName}`;
    
    console.log("正在跳轉至會議:", targetUrl);
    window.open(targetUrl, '_blank');
}

/**
 * 從後端白名單載入課程按鈕
 */
async function refreshCourseList() {
    const username = localStorage.getItem('studyVerseUser');
    const container = document.getElementById('course-list-container');
    if (!container) return;

    const dimmedCardHTML = `
        <div class="glass-panel p-6 rounded-3xl flex flex-col border border-white/5 opacity-40 grayscale-[0.5] cursor-not-allowed relative overflow-hidden min-h-[200px]">
            <div class="absolute top-2 right-4 text-[10px] font-bold text-gray-500 tracking-widest">尚未解鎖</div>
            <div class="w-12 h-12 bg-gray-500/20 rounded-xl flex items-center justify-center text-gray-400 text-2xl mb-4">
                <i class="fas fa-lock"></i>
            </div>
            <h3 class="text-xl font-black text-gray-400 mb-1">線上課程</h3>
            <p class="text-gray-600 text-xs mb-4 flex-1">
                此專區僅限已購買課程的帳號使用。請先至課程商店購買課程。
            </p>
            <div class="w-full text-center bg-white/5 py-2 rounded-lg text-xs font-bold text-gray-500 border border-white/5">
                未獲得授權
            </div>
        </div>
    `;

    if (!username) {
        container.innerHTML = dimmedCardHTML;
        return;
    }

    try {
        const response = await fetch(`/api/courses/enrolled?username=${encodeURIComponent(username)}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || '取得已購課程失敗');
        }

        const courses = data.courses || [];

        if (courses.length === 0) {
            container.innerHTML = dimmedCardHTML;
            return;
        }

        container.innerHTML = '';

        const card = document.createElement('div');
        card.className = `
            glass-panel p-6 rounded-3xl room-card flex flex-col
            border border-cyan-500/30 group cursor-pointer
            transition-all hover:border-cyan-500/60 min-h-[200px]
        `;

        card.onclick = () => showPurchasedCoursesModal(courses);

        card.innerHTML = `
            <div class="absolute top-2 right-4 text-[10px] font-bold text-cyan-400 tracking-widest">
                已解鎖
            </div>

            <div class="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center text-cyan-400 text-2xl mb-4 group-hover:bg-cyan-500 group-hover:text-white transition-all">
                <i class="fas fa-layer-group"></i>
            </div>

            <h3 class="text-xl font-black text-white mb-1">線上課程</h3>

            <p class="text-gray-500 text-xs mb-4 flex-1">
                你目前擁有 <span class="text-cyan-400 font-bold">${courses.length}</span> 門已購買課程。點擊查看課程清單。
            </p>

            <div class="w-full text-center bg-white/5 group-hover:bg-cyan-600 py-2 rounded-lg text-xs font-bold text-white transition-all">
                查看我的課程
            </div>
        `;

        container.appendChild(card);

    } catch (err) {
        console.error('載入已購課程失敗:', err);
        container.innerHTML = dimmedCardHTML;
    }
}

/**
 * [新增] 顯示課程選擇彈窗
 */
function showCoursesModal(courses) {
    // 1. 如果已經有彈窗存在，先移除避免重複
    const oldModal = document.getElementById('courseSelectionModal');
    if (oldModal) oldModal.remove();

    // 2. 建立新彈窗容器
    const modal = document.createElement('div');
    modal.id = 'courseSelectionModal';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in';
    
    // 3. 根據學生擁有的課程，動態生成清單按鈕
    const courseButtonsHTML = courses.map(course => `
        <button onclick="enterCourseMeet('${course.meetId}')" class="w-full bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500 p-4 rounded-xl flex items-center gap-4 transition-all group mb-3 text-left">
            <div class="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center text-cyan-400 group-hover:text-cyan-300">
                <i class="fas ${course.icon || 'fa-play-circle'}"></i>
            </div>
            <div class="flex-1">
                <h4 class="text-white font-bold text-sm mb-1">${course.name}</h4>
                <p class="text-gray-500 text-[10px]">點擊跳轉至 Google Meet 教室</p>
            </div>
            <i class="fas fa-external-link-alt text-gray-600 group-hover:text-cyan-400 text-sm"></i>
        </button>
    `).join('');

    // 4. 組合彈窗的 HTML 結構
    modal.innerHTML = `
        <div class="bg-[#111827] w-full max-w-md rounded-3xl border border-gray-800 shadow-2xl overflow-hidden relative scale-95 animate-scale-up">
            <button onclick="document.getElementById('courseSelectionModal').remove()" class="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 z-10">
                <i class="fas fa-times"></i>
            </button>
            <div class="p-6 border-b border-gray-800 bg-gradient-to-b from-cyan-900/20 to-transparent">
                <h2 class="text-xl font-black text-white flex items-center gap-2">
                    <i class="fas fa-layer-group text-cyan-500"></i>
                    我的線上課程
                </h2>
                <p class="text-gray-400 text-xs mt-1">請選擇您現在要進入的課程教室</p>
            </div>
            <div class="p-6 max-h-[60vh] overflow-y-auto">
                ${courseButtonsHTML}
            </div>
        </div>
    `;

    // 5. 將彈窗加入畫面中
    document.body.appendChild(modal);
}

// 確保網頁載入時觸發更新
document.addEventListener('DOMContentLoaded', () => {
    refreshCourseList(); 
});

// =========================================================================
// (5) 新手導覽系統 Intro Tutorial v2
// =========================================================================

const introSteps = [
    {
        target: '#intro-ai-rooms',
        title: '歡迎來到 STUDY VERSE',
        description: '這裡是 AI 自習空間。你可以進入沉浸式自習室、模擬線上教室與線上課程。'
    },
    {
        target: '#syncModule',
        title: '手機連動系統',
        description: '掃描 QR Code 後將手機翻面，可降低 AI 誤判並獲得專注加成。'
    },
    {
        target: '#lineBindModule',
        title: 'LINE 學習紀錄綁定',
        description: '綁定 LINE 後，可接收每日學習總結與重要提醒。家長或學生本人都可綁定。'
    },
    {
        target: '#intro-standalone-mode',
        title: '單機翻轉模式',
        description: '即使沒有電腦，也能直接用手機進入專注模式與游擊隊挑戰。'
    },
    {
    target: '#intro-team-system',
    title: '小組學習加成',
    description:
        '可以創建或加入小組，和朋友一起專注學習。小組成員一起自習時，學習經驗值會獲得加成。'
},
    {
    target: '#intro-vip-system',
    title: 'VIP 特約教室',
    description:
        '教師開課後會產生專屬教室代碼，學生輸入代碼即可進入指定教室學習。'
},
    {
        target: '#intro-mission-logs',
        title: 'Mission Logs',
        description: '這裡會記錄你的專注時數、任務紀錄與學習成長軌跡。'
    }
];

let currentIntroStep = 0;
let currentIntroTarget = null;

async function startIntroTutorial() {
    const username = localStorage.getItem('studyVerseUser');

    if (!username) return;

    const loginOverlay = document.getElementById('loginOverlay');
    const registerOverlay = document.getElementById('registerOverlay');

    if (
        loginOverlay &&
        !loginOverlay.classList.contains('hidden')
    ) {
        return;
    }

    if (
        registerOverlay &&
        !registerOverlay.classList.contains('hidden')
    ) {
        return;
    }

    const introKey = `studyVerseIntroCompleted:${username}`;

    if (localStorage.getItem(introKey) === 'true') {
        return;
    }

    try {
        const res = await fetch(`/api/auth/check-user?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (data.user && data.user.has_seen_intro === true) {
            localStorage.setItem(introKey, 'true');
            return;
        }
    } catch (err) {
        console.warn('新手導覽狀態檢查失敗，改用本機判斷:', err);
    }

    injectIntroStyle();
    showIntroStep(0);
}

function injectIntroStyle() {
    if (document.getElementById('intro-style')) return;

    const style = document.createElement('style');
    style.id = 'intro-style';
    style.innerHTML = `
        .intro-highlight-target {
            position: relative !important;
            z-index: 1000001 !important;
            box-shadow: 0 0 0 4px rgba(59,130,246,0.95), 0 0 45px rgba(59,130,246,0.9) !important;
            border-radius: 24px !important;
            background: rgba(17,24,39,0.98) !important;
        }
    `;
    document.head.appendChild(style);
}

function clearIntroHighlight() {
    if (currentIntroTarget) {
        currentIntroTarget.classList.remove('intro-highlight-target');
        currentIntroTarget = null;
    }

    const oldOverlay = document.getElementById('intro-overlay');
    if (oldOverlay) oldOverlay.remove();
}

function showIntroStep(index) {
    clearIntroHighlight();

    currentIntroStep = index;
    const step = introSteps[index];

    if (!step) {
        finishIntroTutorial();
        return;
    }

    const target = document.querySelector(step.target);

    if (!target) {
        showIntroStep(index + 1);
        return;
    }

    currentIntroTarget = target;
    target.classList.add('intro-highlight-target');

    target.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });

    setTimeout(() => {
        renderIntroOverlay(step, index, target);
    }, 450);
}

function renderIntroOverlay(step, index, target) {
    const rect = target.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.id = 'intro-overlay';

    const wideTargets = [
    '#intro-ai-rooms',
    '#intro-team-system',
    '#intro-vip-system'
];

const isWideTarget = wideTargets.includes(introSteps[index].target);

const cardWidth = isWideTarget
    ? Math.min(320, window.innerWidth - 32)
    : Math.min(460, window.innerWidth - 32);

const cardHeight = isWideTarget ? 360 : 240;
const margin = 24;

    const candidates = isWideTarget
    ? [
        { top: rect.top, left: rect.right + margin },
        { top: rect.top, left: rect.left - cardWidth - margin },
        { top: margin, left: window.innerWidth - cardWidth - margin },
        { top: window.innerHeight - cardHeight - margin, left: window.innerWidth - cardWidth - margin },
        { top: window.innerHeight - cardHeight - margin, left: margin }
    ]
    : [
        { top: rect.bottom + margin, left: rect.left },
        { top: rect.top - cardHeight - margin, left: rect.left },
        { top: rect.top, left: rect.right + margin },
        { top: rect.top, left: rect.left - cardWidth - margin },
        { top: window.innerHeight - cardHeight - margin, left: margin },
        { top: window.innerHeight - cardHeight - margin, left: window.innerWidth - cardWidth - margin },
        { top: margin, left: margin },
        { top: margin, left: window.innerWidth - cardWidth - margin }
    ];

    function isOverlapping(card) {
        const cardRect = {
            left: card.left,
            right: card.left + cardWidth,
            top: card.top,
            bottom: card.top + cardHeight
        };

        return !(
            cardRect.right < rect.left ||
            cardRect.left > rect.right ||
            cardRect.bottom < rect.top ||
            cardRect.top > rect.bottom
        );
    }

    const bestPosition =
        candidates.find(pos =>
            pos.top >= margin &&
            pos.left >= margin &&
            pos.left + cardWidth <= window.innerWidth - margin &&
            pos.top + cardHeight <= window.innerHeight - margin &&
            !isOverlapping(pos)
        ) || {
            top: window.innerHeight - cardHeight - margin,
            left: margin
        };

    overlay.innerHTML = `
        <div class="fixed inset-0 bg-black/75 z-[999999] pointer-events-none"></div>

        <div
    class="fixed bg-[#111827] border border-blue-500/40 rounded-3xl p-6 z-[1000002] shadow-2xl flex flex-col"
            style="
                top:${bestPosition.top}px;
                left:${bestPosition.left}px;
                width:${cardWidth}px;
                min-height:${cardHeight}px;
            ">

            <div class="text-blue-400 text-xs font-black tracking-widest mb-2">
                STUDY VERSE GUIDE
            </div>

            <h2 class="text-2xl font-black text-white mb-3">
                ${step.title}
            </h2>

            <p class="text-sm text-gray-300 leading-relaxed mb-6">
    ${step.description}
</p>

<div class="flex-1"></div>

<div class="flex justify-between items-center">
                <div class="text-xs text-gray-500">
                    ${index + 1} / ${introSteps.length}
                </div>

                <div class="flex gap-3">
                    <button
                        onclick="skipIntroTutorial()"
                        class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm">
                        跳過
                    </button>

                    <button
                        onclick="nextIntroStep()"
                        class="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm">
                        ${index === introSteps.length - 1 ? '開始學習' : '下一步'}
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

window.nextIntroStep = function() {
    showIntroStep(currentIntroStep + 1);
};

window.skipIntroTutorial = function() {
    finishIntroTutorial();
};

async function finishIntroTutorial() {
    const username = localStorage.getItem('studyVerseUser');

    if (username) {
        const introKey = `studyVerseIntroCompleted:${username}`;
        localStorage.setItem(introKey, 'true');

        try {
            const res = await fetch('/api/intro-complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username })
            });

            const data = await res.json();

            if (!res.ok) {
                console.error('新手導覽完成同步失敗:', data);
            }

        } catch (err) {
            console.error('新手導覽完成同步失敗:', err);
        }
    }

    clearIntroHighlight();

    if (typeof window.ensureStudyVerseProfileCompleted === 'function') {
        const profileReady = await window.ensureStudyVerseProfileCompleted({
            force: true
        });

        if (!profileReady) {
            return;
        }
    }

    if (typeof window.showSubscriptionIntroModalOnce === 'function') {
        window.showSubscriptionIntroModalOnce();
    }
}

window.openTeacherApplyModal = function() {
    const modal = document.getElementById('teacher-apply-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeTeacherApplyModal = function() {
    const modal = document.getElementById('teacher-apply-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.submitTeacherApply = async function() {
    const username = localStorage.getItem('studyVerseUser');
    const teacher_subject = document.getElementById('teacherApplySubject')?.value.trim();
    const teacher_intro = document.getElementById('teacherApplyIntro')?.value.trim();

    if (!username) {
        alert('請先登入後再申請教師資格。');
        return;
    }

    if (!teacher_subject || !teacher_intro) {
        alert('請填寫教學科目與自我介紹。');
        return;
    }

    try {
        const res = await fetch('/api/teacher/apply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                teacher_subject,
                teacher_intro
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '教師申請送出失敗');
        }

        alert('教師申請已送出，請等待平台管理員審核。');
        closeTeacherApplyModal();

    } catch (err) {
        alert(err.message);
    }
};

async function loadUnreadNotifications() {
    const username =
    localStorage.getItem('studyVerseUser') ||
    localStorage.getItem('username') ||
    localStorage.getItem('studyverse_username') ||
    localStorage.getItem('currentUser');
    if (!username) return;

    try {
        const res = await fetch(`/api/notifications?username=${encodeURIComponent(username)}`);
        const data = await res.json();

        if (!res.ok) return;

        const unreadNotifications = (data.notifications || []).filter(n => !n.is_read);

if (unreadNotifications.length === 0) return;

showNotificationModal(unreadNotifications);

    } catch (err) {
        console.error('讀取站內通知失敗:', err);
    }
}

function showNotificationModal(notifications) {
    const oldModal = document.getElementById('notificationModal');
    if (oldModal) oldModal.remove();

    const ids = notifications.map(n => n.id);

    const modal = document.createElement('div');
    modal.id = 'notificationModal';
    modal.className = 'fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4';

    modal.innerHTML = `
        <div class="bg-[#111827] border border-blue-500/30 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h2 class="text-2xl font-black text-white mb-4">
                <i class="fas fa-bell text-yellow-400 mr-2"></i>
                你有新的通知
            </h2>

            <div class="space-y-4 max-h-[55vh] overflow-y-auto">
                ${notifications.map(n => `
                    <div class="bg-black/40 border border-white/10 rounded-2xl p-4">
                        <h3 class="text-blue-400 font-black mb-2">${escapeNotificationHtml(n.title)}</h3>
                        <p class="text-gray-300 text-sm leading-relaxed whitespace-pre-line">${escapeNotificationHtml(n.message)}</p>
                        <p class="text-gray-500 text-[10px] mt-3">
                            ${new Date(n.created_at).toLocaleString('zh-TW')}
                        </p>
                    </div>
                `).join('')}
            </div>

            <button onclick="markNotificationsRead(${JSON.stringify(ids)})"
                    class="w-full mt-6 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all">
                我知道了
            </button>
        </div>
    `;

    document.body.appendChild(modal);
}

async function markNotificationsRead(ids) {
    try {
        await Promise.all(
            ids.map(id =>
                fetch('/api/notifications/read', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        notificationId: id
                    })
                })
            )
        );

        notifications = notifications.map(n => {
            if (ids.includes(n.id)) {
                n.is_read = true;
            }
            return n;
        });

        if (typeof renderNotifications === 'function') {
            renderNotifications();
        }

    } catch (err) {
        console.error('通知已讀失敗:', err);
    }

    const modal = document.getElementById('notificationModal');
    if (modal) modal.remove();
}

function escapeNotificationHtml(str) {
    return String(str || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

setTimeout(() => {
    loadUnreadNotifications();
}, 2500);

// =========================
// 通知中心系統
// =========================

let notifications = [];

async function loadNotifications() {
    try {
        const username = localStorage.getItem('studyVerseUser');

        if (!username) return;

        const res = await fetch(`/api/notifications?username=${encodeURIComponent(username)}`);

        const data = await res.json();

        notifications = data.notifications || [];

        renderNotifications();

    } catch (err) {
        console.error('❌ 載入通知失敗:', err);
    }
}

function renderNotifications() {
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notificationBadge');

    if (!list || !badge) return;

    // 未讀數量
    const unreadCount = notifications.filter(n => !n.is_read).length;

    // 顯示紅點
    if (unreadCount > 0) {
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    // 無通知
    if (notifications.length === 0) {
        list.innerHTML = `
            <div class="p-6 text-center text-gray-500 text-xs">
                尚無通知
            </div>
        `;
        return;
    }

    // 生成通知列表
    list.innerHTML = notifications.map(notification => {
        const isUnread = !notification.is_read;

        return `
            <div 
                onclick="markNotificationRead(${notification.id})"
                class="p-4 hover:bg-white/5 transition-all cursor-pointer ${isUnread ? 'bg-blue-500/5' : ''}"
            >
                <div class="flex items-start gap-3">

                    <div class="mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                        isUnread ? 'bg-blue-400' : 'bg-gray-600'
                    }"></div>

                    <div class="flex-1 min-w-0">

                        <div class="flex items-center justify-between gap-3 mb-1">
                            <h4 class="text-sm font-bold text-white truncate">
                                ${notification.title || '系統通知'}
                            </h4>

                            <span class="text-[10px] text-gray-500 whitespace-nowrap">
                                ${formatNotificationTime(notification.created_at)}
                            </span>
                        </div>

                        <p class="text-xs text-gray-400 leading-relaxed whitespace-pre-line">
    ${notification.message || ''}
</p>

                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function formatNotificationTime(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);

    return date.toLocaleDateString('zh-TW', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function markNotificationRead(notificationId) {
    try {
        await fetch('/api/notifications/read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                notificationId
            })
        });

        notifications = notifications.map(n => {
            if (n.id === notificationId) {
                n.is_read = true;
            }
            return n;
        });

        renderNotifications();

    } catch (err) {
        console.error('❌ 標記通知已讀失敗:', err);
    }
}

function showCourseUnlockedToast() {
    const oldToast = document.getElementById('courseUnlockedToast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = 'courseUnlockedToast';
    toast.className =
        'fixed top-5 left-1/2 -translate-x-1/2 z-[100000] bg-cyan-500/95 text-white px-5 py-3 rounded-2xl shadow-2xl font-black text-sm border border-cyan-200/40';

    toast.innerHTML = `
        <i class="fas fa-circle-check mr-2"></i>
        線上課程已開通，已更新到你的大廳
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3600);
}

// 頁面載入後讀取通知，並監聽即時通知
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        loadNotifications();
    }, 1200);

    if (typeof socket !== 'undefined') {
        socket.on('new_notification', async (notification) => {
    if (!notification || !notification.id) return;

    const exists = notifications.some(n => n.id === notification.id);
    if (exists) return;

    notifications.unshift(notification);
    renderNotifications();

    showNotificationModal([notification]);

    if (
        notification.type === 'course_payment_approved' ||
        (
            notification.type === 'payment_approved' &&
            String(notification.title || '').includes('線上課程')
        )
    ) {
        await refreshCourseList();

        if (
            document.getElementById('courseStoreModal') &&
            typeof loadCourseStoreModalList === 'function'
        ) {
            await loadCourseStoreModalList();
        }

        showCourseUnlockedToast();
    }
});
socket.on('course_access_updated', async (payload) => {
    const currentUsername =
        localStorage.getItem('studyVerseUser') ||
        localStorage.getItem('username') ||
        '';

    if (!payload || payload.username !== currentUsername) {
        return;
    }

    await refreshCourseList();

    if (
        document.getElementById('courseStoreModal') &&
        typeof loadCourseStoreModalList === 'function'
    ) {
        await loadCourseStoreModalList();
    }

    showCourseUnlockedToast();
});
    }
});

window.showCourseStoreModal = async function() {
    let oldModal = document.getElementById('courseStoreModal');
    if (oldModal) oldModal.remove();

    window.currentCourseStoreTab = 'courses';

    const modal = document.createElement('div');
    modal.id = 'courseStoreModal';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';

    modal.innerHTML = `
        <div id="courseStoreModalBox" class="bg-[#111827] w-full max-w-2xl rounded-3xl border border-cyan-500/30 shadow-2xl overflow-hidden relative">

            <button onclick="document.getElementById('courseStoreModal').remove()"
                    class="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 z-10">
                <i class="fas fa-times"></i>
            </button>

            <div class="p-6 border-b border-gray-800 bg-gradient-to-b from-cyan-900/30 to-transparent">
                <h2 class="text-2xl font-black text-white flex items-center gap-2">
                    <i class="fas fa-store text-cyan-400"></i>
                    課程商店
                </h2>
                <p id="courseStoreSubtitle" class="text-gray-400 text-xs mt-2">
                    免費版也可以購買線上課程；特約教室需 trial / pro 權限才能報名。
                </p>

                <div class="grid grid-cols-2 gap-3 mt-5">
                    <button id="courseStoreTabCourses"
                            onclick="setCourseStoreTab('courses')"
                            class="course-store-tab bg-cyan-600 text-white border border-cyan-400/50 py-3 rounded-2xl text-xs font-black transition-all">
                        <i class="fas fa-book-open mr-1"></i>
                        線上課程
                    </button>

                    <button id="courseStoreTabTutorPrograms"
                            onclick="setCourseStoreTab('tutorPrograms')"
                            class="course-store-tab bg-white/5 text-gray-400 border border-white/10 hover:border-yellow-400/40 hover:text-yellow-300 py-3 rounded-2xl text-xs font-black transition-all">
                        <i class="fas fa-chalkboard-teacher mr-1"></i>
                        特約教室
                    </button>
                </div>
            </div>

            <div id="courseStoreModalList" class="p-6 max-h-[65vh] overflow-y-auto">
                <div class="flex flex-col items-center justify-center py-10 text-gray-500">
                    <div class="w-10 h-10 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
                    <p class="text-xs tracking-widest uppercase">正在載入課程...</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    await loadCourseStoreModalList();
};
let courseStoreCache = [];
let tutorProgramStoreCache = [];
window.currentCourseStoreTab = 'courses';
function getCurrentCourseStoreUsername() {
    return (
        localStorage.getItem('studyVerseUser') ||
        localStorage.getItem('username') ||
        ''
    );
}

function setCourseStoreModalMode(mode = 'list') {
    const box = document.getElementById('courseStoreModalBox');
    const list = document.getElementById('courseStoreModalList');

    if (!box) return;

    if (mode === 'detail') {
        box.className =
            'bg-[#111827] w-[94vw] max-w-[1180px] rounded-3xl border border-cyan-500/30 shadow-2xl overflow-hidden relative';

        if (list) {
            list.className = 'p-5 max-h-[72vh] overflow-y-auto';
        }

        return;
    }

    box.className =
        'bg-[#111827] w-full max-w-2xl rounded-3xl border border-cyan-500/30 shadow-2xl overflow-hidden relative';

    if (list) {
        list.className = 'p-6 max-h-[65vh] overflow-y-auto';
    }
}

window.setCourseStoreTab = async function(tabName) {
    window.currentCourseStoreTab = tabName;

    if (tabName === 'tutorPrograms') {
        await loadTutorProgramStoreModalList();
        return;
    }

    await loadCourseStoreModalList();
};

function updateCourseStoreTabButtons(activeTab) {
    const coursesBtn = document.getElementById('courseStoreTabCourses');
    const tutorBtn = document.getElementById('courseStoreTabTutorPrograms');
    const subtitle = document.getElementById('courseStoreSubtitle');

    if (coursesBtn) {
        coursesBtn.className = activeTab === 'courses'
            ? 'course-store-tab bg-cyan-600 text-white border border-cyan-400/50 py-3 rounded-2xl text-xs font-black transition-all'
            : 'course-store-tab bg-white/5 text-gray-400 border border-white/10 hover:border-cyan-400/40 hover:text-cyan-300 py-3 rounded-2xl text-xs font-black transition-all';
    }

    if (tutorBtn) {
        tutorBtn.className = activeTab === 'tutorPrograms'
            ? 'course-store-tab bg-yellow-500 text-black border border-yellow-300/60 py-3 rounded-2xl text-xs font-black transition-all'
            : 'course-store-tab bg-white/5 text-gray-400 border border-white/10 hover:border-yellow-400/40 hover:text-yellow-300 py-3 rounded-2xl text-xs font-black transition-all';
    }

    if (subtitle) {
        subtitle.innerText = activeTab === 'tutorPrograms'
            ? '報名制特約教室需 trial / pro 權限。報名成功後會收到站內通知與課程代碼。'
            : '請選擇目前開放購買的線上課程，點擊後前往結帳頁。';
    }
}

function renderCourseStoreLoading(iconClass = 'fa-circle-notch', text = '正在載入...') {
    const list = document.getElementById('courseStoreModalList');
    if (!list) return;

    list.innerHTML = `
        <div class="flex flex-col items-center justify-center py-10 text-gray-500">
            <div class="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-4">
                <i class="fas ${iconClass} fa-spin text-xl"></i>
            </div>
            <p class="text-xs tracking-widest uppercase">${text}</p>
        </div>
    `;
}

function parseTutorProgramTimeToMinutes(timeText) {
    const raw = String(timeText || '').slice(0, 5);

    if (!raw.includes(':')) return null;

    const [hours, minutes] = raw.split(':').map(Number);

    if (
        Number.isNaN(hours) ||
        Number.isNaN(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        return null;
    }

    return hours * 60 + minutes;
}

function formatTutorProgramMinutes(totalMinutes) {
    const minutesInDay = 24 * 60;
    const safeTotal = ((Number(totalMinutes || 0) % minutesInDay) + minutesInDay) % minutesInDay;

    const hours = Math.floor(safeTotal / 60);
    const minutes = safeTotal % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getTutorProgramTotalMinutes(program) {
    const periods = Number(program?.periods || 1);
    const classMinutes = Number(program?.class_minutes || 50);
    const restMinutes = Number(program?.rest_minutes || 10);

    return (
        periods * classMinutes +
        ((periods > 1) ? (periods - 1) * restMinutes : 0)
    );
}

function getTutorProgramTimeRangeText(program) {
    const startMinutes = parseTutorProgramTimeToMinutes(program?.start_time);

    if (startMinutes === null) {
        return '尚未設定';
    }

    const endMinutes = startMinutes + getTutorProgramTotalMinutes(program);

    return `${formatTutorProgramMinutes(startMinutes)} – ${formatTutorProgramMinutes(endMinutes)}`;
}

function getTutorProgramSummaryText(program) {
    const periods = Number(program?.periods || 1);
    const classMinutes = Number(program?.class_minutes || 50);
    const restMinutes = Number(program?.rest_minutes || 10);

    if (periods <= 1) {
        return `1 堂｜每堂 ${classMinutes} 分`;
    }

    return `${periods} 堂｜每堂 ${classMinutes} 分｜休息 ${restMinutes} 分`;
}

function buildTutorProgramTimeline(program) {
    const timeline = [];
    const startMinutes = parseTutorProgramTimeToMinutes(program?.start_time);

    if (startMinutes === null) return timeline;

    const periods = Number(program?.periods || 1);
    const classMinutes = Number(program?.class_minutes || 50);
    const restMinutes = Number(program?.rest_minutes || 10);

    let cursor = startMinutes;

    for (let i = 1; i <= periods; i++) {
        const classStart = cursor;
        const classEnd = classStart + classMinutes;

        timeline.push({
            type: 'class',
            label: `第 ${i} 堂`,
            start: formatTutorProgramMinutes(classStart),
            end: formatTutorProgramMinutes(classEnd)
        });

        cursor = classEnd;

        if (i < periods && restMinutes > 0) {
            const restStart = cursor;
            const restEnd = restStart + restMinutes;

            timeline.push({
                type: 'rest',
                label: '休息',
                start: formatTutorProgramMinutes(restStart),
                end: formatTutorProgramMinutes(restEnd)
            });

            cursor = restEnd;
        }
    }

    return timeline;
}

function renderTutorProgramTimelineHtml(program) {
    const timeline = buildTutorProgramTimeline(program);

    if (timeline.length === 0) {
        return `
            <div class="text-xs text-gray-500">
                尚無可顯示的時刻表。
            </div>
        `;
    }

    return timeline.map(item => {
        const isRest = item.type === 'rest';

        const iconClass = isRest ? 'fa-mug-hot' : 'fa-book-open';
        const textClass = isRest ? 'text-green-300' : 'text-yellow-300';
        const bgClass = isRest ? 'bg-green-500/10 border-green-400/20' : 'bg-yellow-500/10 border-yellow-400/20';

        return `
            <div class="${bgClass} border rounded-2xl px-4 py-3 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-black/30 flex items-center justify-center ${textClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div>
                        <div class="${textClass} font-black text-sm">${item.label}</div>
                        <div class="text-gray-500 text-[10px] uppercase tracking-widest">
                            ${isRest ? 'Break Time' : 'Class Time'}
                        </div>
                    </div>
                </div>

                <div class="text-white font-mono font-black text-sm">
                    ${item.start} – ${item.end}
                </div>
            </div>
        `;
    }).join('');
}

function getTutorPeriodRows(program) {
    const timeline = buildTutorProgramTimeline(program)
        .filter(item => item.type === 'class');

    return timeline.map((item, index) => ({
        periodNumber: index + 1,
        label: `第 ${index + 1} 堂`,
        start: item.start,
        end: item.end
    }));
}

function getTutorScheduleWeekday(schedule) {
    const dateText = String(schedule?.scheduled_date || '').slice(0, 10);

    if (!dateText) return null;

    const date = new Date(`${dateText}T00:00:00+08:00`);

    if (Number.isNaN(date.getTime())) return null;

    return date.getDay(); // 0 日，1 一，2 二...
}

function getTutorWeekdayColumns(program) {
    const weekdayNames = {
        1: '星期一',
        2: '星期二',
        3: '星期三',
        4: '星期四',
        5: '星期五',
        6: '星期六',
        0: '星期日'
    };

    const programWeekdays = Array.isArray(program.weekdays)
        ? program.weekdays.map(day => Number(day))
        : [];

    const displayOrder = [1, 2, 3, 4, 5, 6, 0];

    return displayOrder
        .filter(day => programWeekdays.includes(day))
        .map(day => ({
            weekday: day,
            label: weekdayNames[day]
        }));
}

function getSchedulesByWeekday(program) {
    const schedules = Array.isArray(program.schedules)
        ? program.schedules
        : [];

    const map = new Map();

    schedules.forEach(schedule => {
        const weekday = getTutorScheduleWeekday(schedule);

        if (weekday === null) return;

        if (!map.has(weekday)) {
            map.set(weekday, []);
        }

        map.get(weekday).push(schedule);
    });

    return map;
}

function renderTutorScheduleChoiceHtml(program) {
    if (program.allowStudentScheduleChoice !== true) {
        return '';
    }

    const periodRows = getTutorPeriodRows(program);
    const weekdayColumns = getTutorWeekdayColumns(program);
    const schedulesByWeekday = getSchedulesByWeekday(program);

    if (periodRows.length === 0 || weekdayColumns.length === 0) {
        return `
            <div class="bg-red-500/10 border border-red-400/20 rounded-2xl p-4 mb-5 text-xs text-red-200 font-bold">
                <i class="fas fa-circle-exclamation mr-1"></i>
                目前沒有可選擇的星期與堂數，請聯絡教師確認排課設定。
            </div>
        `;
    }

    return `
        <div class="bg-black/30 border border-yellow-400/20 rounded-2xl p-5 mb-6">
            <div class="flex items-center justify-between gap-3 mb-4">
                <div>
                    <div class="text-yellow-300 text-xs font-black tracking-widest uppercase">
                        選擇每週上課堂數
                    </div>
                    <p class="text-gray-500 text-[11px] mt-1 leading-relaxed">
                        橫排是星期，直排是第幾堂。可只選星期一第 1 堂、星期二第 2 堂，不必報名整場。
                    </p>
                </div>

                <span class="shrink-0 text-[10px] bg-yellow-500/10 text-yellow-200 border border-yellow-400/20 px-2 py-1 rounded-full font-black">
                    自選模式
                </span>
            </div>

            <div class="w-full overflow-visible">
                <table class="w-full table-fixed border-separate [border-spacing:6px_10px]">
                    <thead>
                        <tr>
                            <th class="w-[132px] text-left text-[11px] text-gray-500 font-black px-2 py-2">
                                堂數 / 星期
                            </th>

                            ${weekdayColumns.map(column => `
                                <th class="text-center text-[12px] text-yellow-300 font-black px-1 py-2 bg-yellow-500/10 border border-yellow-400/20 rounded-xl whitespace-nowrap">
                                    ${escapeCourseStoreHtml(column.label)}
                                </th>
                            `).join('')}
                        </tr>
                    </thead>

                    <tbody>
                        ${periodRows.map(period => `
                            <tr>
                                <th class="align-top text-left bg-white/5 border border-white/10 rounded-xl px-3 py-3">
                                    <div class="text-white text-sm font-black">
                                        ${escapeCourseStoreHtml(period.label)}
                                    </div>
                                    <div class="text-gray-500 text-[11px] font-mono mt-1">
                                        ${escapeCourseStoreHtml(period.start)}–${escapeCourseStoreHtml(period.end)}
                                    </div>
                                </th>

                                ${weekdayColumns.map(column => {
                                    const weekdaySchedules = schedulesByWeekday.get(column.weekday) || [];
                                    const hasSchedules = weekdaySchedules.length > 0;

                                    if (!hasSchedules) {
                                        return `
                                            <td class="text-center bg-white/5 border border-white/5 rounded-xl px-1 py-3 opacity-30 align-top">
                                                <span class="text-[10px] text-gray-600">無課</span>
                                            </td>
                                        `;
                                    }

                                    const cellScheduleCount = weekdaySchedules.length;

                                    const cellMaxStudents = weekdaySchedules.reduce((max, schedule) => {
                                        return Math.max(max, Number(schedule.max_students || 0));
                                    }, 0);

                                    const remainingNumbers = weekdaySchedules
                                        .map(schedule => Number(schedule.remaining_slots))
                                        .filter(value => Number.isFinite(value));

                                    const cellRemainingSlots = remainingNumbers.length > 0
                                        ? Math.min(...remainingNumbers)
                                        : null;

                                    const isCellFull =
                                        cellMaxStudents > 0 &&
                                        cellRemainingSlots !== null &&
                                        cellRemainingSlots <= 0;

                                    const cellEnrolledCount =
    cellMaxStudents > 0 && cellRemainingSlots !== null
        ? Math.max(0, cellMaxStudents - cellRemainingSlots)
        : 0;

const capacityText = cellMaxStudents > 0
    ? `${cellEnrolledCount}/${cellMaxStudents}`
    : '不限';

                                    const cellValue = `${column.weekday}:${period.periodNumber}`;

                                    return `
                                        <td class="text-center bg-white/5 hover:bg-yellow-500/10 border border-white/10 hover:border-yellow-400/40 rounded-xl px-1 py-3 transition-all align-top ${isCellFull ? 'opacity-50' : ''}">
                                            <label class="${isCellFull ? 'cursor-not-allowed' : 'cursor-pointer'} flex flex-col items-center justify-center gap-2 min-h-[86px]">
                                                <input
                                                    type="checkbox"
                                                    class="tutor-period-choice w-5 h-5 accent-yellow-400"
                                                    value="${cellValue}"
                                                    data-weekday="${column.weekday}"
                                                    data-period-number="${period.periodNumber}"
                                                    ${isCellFull ? 'disabled' : ''}>

                                                <span class="${isCellFull ? 'text-red-300' : 'text-yellow-200'} text-[11px] font-black whitespace-nowrap">
    ${escapeCourseStoreHtml(capacityText)}
</span>

                                                <span class="text-[10px] text-gray-500 whitespace-nowrap">
                                                    共 ${cellScheduleCount} 次
                                                </span>
                                            </label>
                                        </td>
                                    `;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="mt-3 text-[11px] text-gray-500 leading-relaxed">
                例如勾選「星期一 × 第 1 堂」，系統會自動幫你報名開課期間內所有星期一的第 1 堂。
            </div>
        </div>
    `;
}

function getSelectedTutorPeriodChoicesFromDetail() {
    return Array.from(document.querySelectorAll('.tutor-period-choice:checked'))
        .map(input => ({
            weekday: Number(input.dataset.weekday),
            periodNumber: Number(input.dataset.periodNumber)
        }))
        .filter(item =>
            Number.isInteger(item.weekday) &&
            item.weekday >= 0 &&
            item.weekday <= 6 &&
            Number.isInteger(item.periodNumber) &&
            item.periodNumber >= 1
        );
}

async function loadCourseStoreModalList() {
    const list = document.getElementById('courseStoreModalList');
    if (!list) return;

    setCourseStoreModalMode('list');

    updateCourseStoreTabButtons('courses');
    renderCourseStoreLoading('fa-book-open', '正在載入線上課程...');

    const username = getCurrentCourseStoreUsername();

    try {
        const res = await fetch(
            `/api/courses/store?username=${encodeURIComponent(username)}`
        );

        const data = await res.json();

        if (!res.ok || data.success === false) {
            throw new Error(data.error || '取得課程商店失敗');
        }

        const courses = data.courses || [];
        courseStoreCache = courses;

        if (courses.length === 0) {
            list.innerHTML = `
                <div class="text-center py-10">
                    <div class="w-14 h-14 bg-gray-500/20 rounded-2xl flex items-center justify-center text-gray-400 text-2xl mx-auto mb-4">
                        <i class="fas fa-box-open"></i>
                    </div>
                    <h3 class="text-white font-black mb-2">目前沒有開放中的課程</h3>
                    <p class="text-gray-500 text-xs">請等待教師或平台開放新的線上課程。</p>
                </div>
            `;
            return;
        }

        list.innerHTML = courses.map(course => {
            const title = escapeCourseStoreHtml(course.course_name || '未命名課程');
            const teacher = escapeCourseStoreHtml(course.teacher_username || 'STUDY VERSE');
            const subject = escapeCourseStoreHtml(course.subject || '線上課程');
            const intro = escapeCourseStoreHtml(course.intro || '點擊查看課程詳情。');
            const price = Number(course.price || 0);

            const isEnrolled = course.is_enrolled === true;
            const hasPendingOrder = course.has_pending_order === true;

            const courseActionText = isEnrolled
                ? '已購買'
                : hasPendingOrder
                    ? '付款審核中'
                    : '查看詳情 →';

            const actionTextClass = isEnrolled
                ? 'text-green-400'
                : hasPendingOrder
                    ? 'text-yellow-300'
                    : 'text-cyan-400 group-hover:text-cyan-300';

            const statusBadgeHTML = isEnrolled
                ? `
                    <span class="text-[10px] bg-green-500/20 text-green-300 px-2 py-1 rounded-full font-black whitespace-nowrap border border-green-500/30">
                        已購買
                    </span>
                `
                : hasPendingOrder
                    ? `
                        <span class="text-[10px] bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded-full font-black whitespace-nowrap border border-yellow-400/30">
                            審核中
                        </span>
                    `
                    : `
                        <span class="text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded-full font-black whitespace-nowrap">
                            NT$${price}
                        </span>
                    `;

            return `
                <button onclick="showCourseDetail('${course.id}')"
                        class="w-full bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/50 p-5 rounded-2xl mb-4 text-left transition-all group">

                    <div class="flex items-start gap-4">
                        <div class="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center text-cyan-400 text-2xl group-hover:bg-cyan-500 group-hover:text-white transition-all">
                            <i class="fas fa-book-open"></i>
                        </div>

                        <div class="flex-1">
                            <div class="flex items-center justify-between gap-2 mb-1">
                                <h3 class="text-white font-black text-lg">${title}</h3>
                                ${statusBadgeHTML}
                            </div>

                            <p class="text-cyan-300 text-xs mb-2">
                                ${subject}｜${teacher}
                            </p>

                            <p class="text-gray-500 text-xs leading-relaxed mb-3">
                                ${intro}
                            </p>

                            <div class="text-right ${actionTextClass} text-xs font-black">
                                ${courseActionText}
                            </div>
                        </div>
                    </div>
                </button>
            `;
        }).join('');

    } catch (err) {
        console.error('課程商店彈窗載入失敗:', err);

        list.innerHTML = `
            <div class="text-center py-10">
                <div class="w-14 h-14 bg-red-500/20 rounded-2xl flex items-center justify-center text-red-400 text-2xl mx-auto mb-4">
                    <i class="fas fa-triangle-exclamation"></i>
                </div>
                <h3 class="text-red-300 font-black mb-2">課程載入失敗</h3>
                <p class="text-gray-500 text-xs">請稍後重新整理頁面。</p>
            </div>
        `;
    }
}

async function loadTutorProgramStoreModalList() {
    const list = document.getElementById('courseStoreModalList');
    if (!list) return;

    setCourseStoreModalMode('list');

    updateCourseStoreTabButtons('tutorPrograms');
    renderCourseStoreLoading('fa-chalkboard-teacher', '正在載入特約教室...');

    const username = getCurrentCourseStoreUsername();

    try {
        const res = await fetch(
            `/api/tutor-programs/store?username=${encodeURIComponent(username)}`
        );

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || '取得特約教室列表失敗');
        }

        const programs = data.programs || [];
        tutorProgramStoreCache = programs;

        const canEnrollTutorProgram = data.canEnrollTutorProgram === true;
        const accessLevel = data.accessLevel || 'free';

        let topNotice = '';

        if (!canEnrollTutorProgram) {
            topNotice = `
                <div class="mb-5 bg-yellow-500/10 border border-yellow-400/30 rounded-2xl p-4 text-xs text-yellow-100 leading-relaxed">
                    <div class="font-black text-yellow-300 mb-1">
                        <i class="fas fa-lock mr-1"></i>
                        特約教室為 trial / pro 功能
                    </div>
                    <p>
                        你目前的權限是 <b>${escapeCourseStoreHtml(accessLevel)}</b>。
                        你仍然可以查看特約教室資訊，也可以購買線上課程；若要報名特約教室，請升級方案。
                    </p>
                    <button onclick="openSubscriptionPage()"
                            class="mt-3 bg-yellow-400 hover:bg-yellow-300 text-black font-black px-4 py-2 rounded-xl transition-all">
                        查看方案
                    </button>
                </div>
            `;
        }

        if (programs.length === 0) {
            list.innerHTML = `
                ${topNotice}
                <div class="text-center py-10">
                    <div class="w-14 h-14 bg-gray-500/20 rounded-2xl flex items-center justify-center text-gray-400 text-2xl mx-auto mb-4">
                        <i class="fas fa-door-closed"></i>
                    </div>
                    <h3 class="text-white font-black mb-2">目前沒有開放報名的特約教室</h3>
                    <p class="text-gray-500 text-xs">請等待教師開放新的週期特約教室。</p>
                </div>
            `;
            return;
        }

        list.innerHTML = `
            ${topNotice}
            ${programs.map(program => {
                const title = escapeCourseStoreHtml(program.title || '特約教室');
                const teacher = escapeCourseStoreHtml(program.teacher_name || program.teacher_username || '教師');
                const note = escapeCourseStoreHtml(program.room_note || '教師尚未提供備註');
                const weekdays = escapeCourseStoreHtml(program.weekdays_text || '尚未設定');
                const capacity = escapeCourseStoreHtml(program.capacity_text || '0 / 不限');
                const timeRange = escapeCourseStoreHtml(getTutorProgramTimeRangeText(program));
const summaryText = escapeCourseStoreHtml(getTutorProgramSummaryText(program));
const startDate = escapeCourseStoreHtml(program.start_date || '尚未設定');
const endDate = escapeCourseStoreHtml(program.end_date || '尚未設定');

                let badgeHtml = '';

                if (program.is_enrolled) {
                    badgeHtml = `<span class="text-[10px] bg-green-500/20 text-green-300 border border-green-400/30 px-2 py-1 rounded-full font-black">已報名</span>`;
                } else if (program.is_full) {
                    badgeHtml = `<span class="text-[10px] bg-red-500/20 text-red-300 border border-red-400/30 px-2 py-1 rounded-full font-black">額滿</span>`;
                } else if (!canEnrollTutorProgram) {
                    badgeHtml = `<span class="text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-400/30 px-2 py-1 rounded-full font-black">需升級</span>`;
                } else {
                    badgeHtml = `<span class="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-1 rounded-full font-black">可報名</span>`;
                }

                return `
                    <button onclick="showTutorProgramDetail('${program.id}')"
                            class="w-full bg-white/5 hover:bg-yellow-500/10 border border-white/10 hover:border-yellow-500/50 p-5 rounded-2xl mb-4 text-left transition-all group">

                        <div class="flex items-start gap-4">
                            <div class="w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center text-yellow-400 text-2xl group-hover:bg-yellow-500 group-hover:text-black transition-all">
                                <i class="fas fa-chalkboard-teacher"></i>
                            </div>

                            <div class="flex-1">
                                <div class="flex items-start justify-between gap-3 mb-1">
                                    <h3 class="text-white font-black text-lg">${title}</h3>
                                    ${badgeHtml}
                                </div>

                                <p class="text-gray-400 text-xs mb-3">
                                    教師：${teacher}
                                </p>

                                <p class="text-gray-500 text-xs leading-relaxed mb-4 line-clamp-2">
                                    ${note}
                                </p>

                                <div class="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
                                    <div class="bg-black/30 rounded-xl px-3 py-2">
                                        <span class="text-gray-500">日期</span>
                                        <div class="text-white font-bold mt-1">${startDate} ~ ${endDate}</div>
                                    </div>

                                    <div class="bg-black/30 rounded-xl px-3 py-2">
                                        <span class="text-gray-500">星期</span>
                                        <div class="text-yellow-300 font-bold mt-1">${weekdays}</div>
                                    </div>

                                    <div class="bg-black/30 rounded-xl px-3 py-2">
    <span class="text-gray-500">時間</span>
    <div class="text-white font-bold mt-1">${timeRange}</div>
</div>

<div class="bg-black/30 rounded-xl px-3 py-2">
    <span class="text-gray-500">名額</span>
    <div class="text-green-300 font-bold mt-1">${capacity}</div>
</div>

<div class="mt-3 bg-yellow-500/10 border border-yellow-400/20 rounded-xl px-3 py-2 text-[11px] text-yellow-100 font-bold">
    <i class="fas fa-clock mr-1 text-yellow-300"></i>
    ${summaryText}
</div>
                            </div>
                        </div>
                    </button>
                `;
            }).join('')}
        `;

    } catch (err) {
        console.error('特約教室列表載入失敗:', err);

        list.innerHTML = `
            <div class="text-center py-10">
                <div class="w-14 h-14 bg-red-500/20 rounded-2xl flex items-center justify-center text-red-400 text-2xl mx-auto mb-4">
                    <i class="fas fa-triangle-exclamation"></i>
                </div>
                <h3 class="text-red-300 font-black mb-2">特約教室載入失敗</h3>
                <p class="text-gray-500 text-xs">請稍後重新整理頁面。</p>
            </div>
        `;
    }
}

window.showTutorProgramDetail = function(programId) {
    const list = document.getElementById('courseStoreModalList');
    if (!list) return;

    setCourseStoreModalMode('detail');

    const program = tutorProgramStoreCache.find(item => item.id === programId);

    if (!program) {
        alert('找不到特約教室資料，請重新開啟課程商店。');
        return;
    }

    const title = escapeCourseStoreHtml(program.title || '特約教室');
    const teacher = escapeCourseStoreHtml(program.teacher_name || program.teacher_username || '教師');
    const note = escapeCourseStoreHtml(program.room_note || '教師尚未提供備註');
    const weekdays = escapeCourseStoreHtml(program.weekdays_text || '尚未設定');
    const capacity = escapeCourseStoreHtml(program.capacity_text || '0 / 不限');
    const timeRange = escapeCourseStoreHtml(getTutorProgramTimeRangeText(program));
const timelineHtml = renderTutorProgramTimelineHtml(program);
const scheduleChoiceHtml = renderTutorScheduleChoiceHtml(program);

const periods = Number(program.periods || 1);
const classMinutes = Number(program.class_minutes || 50);
const restMinutes = Number(program.rest_minutes || 10);

    let actionButton = '';

        if (program.is_enrolled && program.allowStudentScheduleChoice !== true) {
        actionButton = `
            <button disabled
                    class="flex-1 bg-green-500/20 text-green-300 border border-green-400/30 font-black py-3 rounded-xl cursor-not-allowed">
                已報名
            </button>
        `;
    } else if (program.is_full) {
        actionButton = `
            <button disabled
                    class="flex-1 bg-red-500/20 text-red-300 border border-red-400/30 font-black py-3 rounded-xl cursor-not-allowed">
                已額滿
            </button>
        `;
    } else if (program.can_enroll !== true) {
        actionButton = `
            <button onclick="openSubscriptionPage()"
                    class="flex-1 bg-yellow-400 hover:bg-yellow-300 text-black font-black py-3 rounded-xl transition-all">
                升級後報名
            </button>
        `;
    } else {
        actionButton = `
            <button onclick="enrollTutorProgram('${program.id}')"
        class="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 rounded-xl transition-all">
    報名特約教室
</button>
        `;
    }

    list.innerHTML = `
        <div class="space-y-4">
            <button onclick="loadTutorProgramStoreModalList()"
                    class="text-xs text-yellow-400 hover:text-yellow-300 font-bold mb-2">
                ← 返回特約教室列表
            </button>

            <div class="bg-white/5 border border-yellow-500/30 rounded-3xl p-5 lg:p-6">
                <div class="flex items-start gap-4 mb-5">
                    <div class="w-14 h-14 bg-yellow-500/20 rounded-2xl flex items-center justify-center text-yellow-400 text-2xl">
                        <i class="fas fa-chalkboard-teacher"></i>
                    </div>

                    <div class="flex-1">
                        <h3 class="text-2xl font-black text-white mb-1">${title}</h3>
                        <p class="text-gray-400 text-xs">教師：${teacher}</p>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 text-xs mb-5">
                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">日期區間</span>
                        <div class="text-white font-bold mt-1">${program.start_date || '尚未設定'} ~ ${program.end_date || '尚未設定'}</div>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">每週上課日</span>
                        <div class="text-yellow-300 font-bold mt-1">${weekdays}</div>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3">
    <span class="text-gray-500">上課時段</span>
    <div class="text-white font-bold mt-1">${timeRange}</div>
</div>

                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">名額</span>
                        <div class="text-green-300 font-bold mt-1">${capacity}</div>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">堂數</span>
                        <div class="text-white font-bold mt-1">${periods} 堂</div>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">每堂 / 休息</span>
                        <div class="text-white font-bold mt-1">${classMinutes} 分 / ${restMinutes} 分</div>
                    </div>
                </div>

                <div class="bg-black/30 border border-white/10 rounded-2xl p-4 mb-5">
    <div class="text-gray-500 text-xs font-bold mb-3">
        <i class="fas fa-calendar-day mr-1"></i>
        每次上課時刻表
    </div>

    <div class="space-y-2">
        ${timelineHtml}
    </div>
</div>

                <div class="bg-black/30 border border-white/10 rounded-2xl p-4 mb-5">
                    <div class="text-gray-500 text-xs font-bold mb-2">教師備註</div>
                    <p class="text-gray-200 text-sm leading-relaxed">${note}</p>
                </div>

                ${scheduleChoiceHtml}

                <div class="bg-yellow-500/10 border border-yellow-400/30 rounded-2xl p-4 text-xs text-yellow-100 leading-relaxed mb-5">
                    報名成功後，系統會將你加入白名單，並透過大廳通知告知課程代碼。正式進入限制會在下一步接上。
                </div>

                <div class="flex gap-3">
                    <button onclick="loadTutorProgramStoreModalList()"
                            class="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 rounded-xl transition-all">
                        返回
                    </button>

                    ${actionButton}
                </div>
            </div>
        </div>
    `;
};

window.enrollTutorProgram = async function(programId) {
    const username = getCurrentCourseStoreUsername();

    if (!username) {
        alert('請先登入後再報名特約教室。');
        return;
    }

    const program = tutorProgramStoreCache.find(item => item.id === programId);

    if (!program) {
        alert('找不到特約教室資料，請重新開啟課程商店。');
        return;
    }

    const allowScheduleChoice = program.allowStudentScheduleChoice === true;

    if (program.is_enrolled && !allowScheduleChoice) {
        const roomCode = program.room_code || program.program_room_code || '未取得';

        alert(
            `你已經報名過此特約教室。\n\n` +
            `課程代碼：${roomCode}\n\n` +
            `請在大廳輸入此代碼進入特約教室。`
        );

        return;
    }

    if (program.is_full) {
        alert('此特約教室已額滿。');
        return;
    }

    if (program.can_enroll !== true) {
        const goSubscribe = confirm(
            '此特約教室需要 trial / pro 權限才能報名。\n\n是否前往查看方案？'
        );

        if (goSubscribe && typeof openSubscriptionPage === 'function') {
            openSubscriptionPage();
        }

        return;
    }

    let selectedPeriodChoices = [];

if (allowScheduleChoice) {
    selectedPeriodChoices = getSelectedTutorPeriodChoicesFromDetail();

    if (selectedPeriodChoices.length === 0) {
        alert('請至少選擇一個星期與堂數。');
        return;
    }
}

    const confirmText = allowScheduleChoice
        ? (
            `確定要報名「${program.title || '特約教室'}」嗎？\n\n` +
            `教師：${program.teacher_name || program.teacher_username || '教師'}\n` +
            `你將選擇 ${selectedPeriodChoices.length} 個每週固定上課時段。\n\n` +
            `報名成功後，請使用課程代碼進入特約教室。`
        )
        : (
            `確定要報名「${program.title || '特約教室'}」嗎？\n\n` +
            `教師：${program.teacher_name || program.teacher_username || '教師'}\n` +
            `日期：${program.start_date} ~ ${program.end_date}\n` +
            `星期：${program.weekdays_text || '未設定'}\n` +
            `時間：${getTutorProgramTimeRangeText(program)}`
        );

    const confirmEnroll = confirm(confirmText);

    if (!confirmEnroll) return;

    try {
        const res = await fetch('/api/tutor-programs/enroll', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                programId,
                selectedPeriodChoices: allowScheduleChoice ? selectedPeriodChoices : undefined
            })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            alert(data.error || '報名失敗，請稍後再試。');
            return;
        }

        const roomCode =
            data.program?.room_code ||
            program.room_code ||
            '未取得';

        alert(
            `✅ 報名成功！\n\n` +
            (
                allowScheduleChoice
                    ? `已選擇 ${selectedPeriodChoices.length} 個每週固定上課時段。\n\n`
                    : `你已加入此特約教室白名單。\n\n`
            ) +
            `課程代碼：${roomCode}\n\n` +
            `請在大廳輸入此代碼進入特約教室。`
        );

        if (typeof loadNotifications === 'function') {
            await loadNotifications();
        }

        await loadTutorProgramStoreModalList();

    } catch (err) {
        console.error('報名特約教室失敗:', err);
        alert('報名特約教室失敗，請稍後再試。');
    }
};

window.goToCourseCheckout = function(courseId) {
    const username =
        localStorage.getItem('studyVerseUser') ||
        localStorage.getItem('username') ||
        '';

    if (!username) {
        alert('請先登入後再購買課程。');
        return;
    }

    const course = courseStoreCache.find(item => item.id === courseId);

    if (course?.is_enrolled === true) {
        alert('你已經購買並開通這門課。');
        return;
    }

    if (course?.has_pending_order === true) {
        alert('這門課已有匯款訂單正在等待審核，請勿重複購買。');
        return;
    }

    window.location.href =
        `/checkout.html?username=${encodeURIComponent(username)}&courseId=${encodeURIComponent(courseId)}`;
};

function escapeCourseStoreHtml(str) {
    return String(str || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

window.showCourseDetail = function(courseId) {
    const list = document.getElementById('courseStoreModalList');
    if (!list) return;

    const course = courseStoreCache.find(c => c.id === courseId);

    if (!course) {
        alert('找不到課程資料，請重新開啟課程商店。');
        return;
    }

    const title = escapeCourseStoreHtml(course.course_name || '未命名課程');
    const teacher = escapeCourseStoreHtml(course.teacher_username || 'STUDY VERSE');
    const subject = escapeCourseStoreHtml(course.subject || '線上課程');
    const intro = escapeCourseStoreHtml(course.intro || '尚未提供課程介紹');
    const price = Number(course.price || 0);
    const maxStudents = Number(course.max_students || 0);
    const enrolledCount = Number(course.enrolled_count || 0);

    const isEnrolled = course.is_enrolled === true;
    const hasPendingOrder = course.has_pending_order === true;
    const canBuy = course.can_buy !== false && !isEnrolled && !hasPendingOrder;

    const startDate = course.start_date || '尚未設定';
    const endDate = course.end_date || '尚未設定';
    const weeklyDay = course.weekly_day || '尚未設定';
    const startTime = course.start_time || '尚未設定';

    const capacityText = maxStudents > 0
        ? `${enrolledCount} / ${maxStudents}`
        : `${enrolledCount} / 不限`;

    let statusText = '可購買';
    let statusClass = 'text-cyan-300';

    if (isEnrolled) {
        statusText = '已購買';
        statusClass = 'text-green-300';
    } else if (hasPendingOrder) {
        statusText = '付款審核中';
        statusClass = 'text-yellow-300';
    }

    let actionButtonHTML = '';

    if (isEnrolled) {
        actionButtonHTML = `
            <button disabled
                    class="flex-1 bg-green-600/30 text-green-300 font-bold py-3 rounded-xl border border-green-500/30 cursor-not-allowed">
                已購買
            </button>
        `;
    } else if (hasPendingOrder) {
        actionButtonHTML = `
            <button disabled
                    class="flex-1 bg-yellow-500/20 text-yellow-300 font-bold py-3 rounded-xl border border-yellow-400/30 cursor-not-allowed">
                付款審核中
            </button>
        `;
    } else if (canBuy) {
        actionButtonHTML = `
            <button onclick="goToCourseCheckout('${course.id}')"
                    class="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl transition-all">
                確認購買
            </button>
        `;
    } else {
        actionButtonHTML = `
            <button disabled
                    class="flex-1 bg-gray-600/30 text-gray-400 font-bold py-3 rounded-xl border border-gray-500/30 cursor-not-allowed">
                暫不可購買
            </button>
        `;
    }

    list.innerHTML = `
        <div class="space-y-4">
            <button onclick="loadCourseStoreModalList()"
                    class="text-xs text-cyan-400 hover:text-cyan-300 font-bold mb-2">
                ← 返回課程列表
            </button>

            <div class="bg-white/5 border border-cyan-500/30 rounded-3xl p-6">
                <div class="w-14 h-14 bg-cyan-500/20 rounded-2xl flex items-center justify-center text-cyan-400 text-2xl mb-4">
                    <i class="fas fa-book-open"></i>
                </div>

                <h3 class="text-2xl font-black text-white mb-2">${title}</h3>

                <p class="text-xs text-cyan-300 mb-4">
                    ${subject}｜開課教師：${teacher}
                </p>

                <div class="grid grid-cols-1 gap-3 text-xs text-gray-300 mb-5">
                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">課程資訊</span>
                        <p class="text-white mt-1 leading-relaxed">${intro}</p>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3">
                        <span class="text-gray-500">開課時間</span>
                        <p class="text-white mt-1">
                            ${startDate} ~ ${endDate}<br>
                            每週：${weeklyDay}｜開始時間：${startTime}
                        </p>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3 flex justify-between">
                        <span class="text-gray-500">開課人數</span>
                        <span class="text-white font-black">${capacityText}</span>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3 flex justify-between">
                        <span class="text-gray-500">課程價格</span>
                        <span class="text-green-400 font-black">NT$${price}</span>
                    </div>

                    <div class="bg-black/30 rounded-xl p-3 flex justify-between">
                        <span class="text-gray-500">購買狀態</span>
                        <span class="${statusClass} font-black">${statusText}</span>
                    </div>
                </div>

                <div class="flex gap-3">
                    <button onclick="loadCourseStoreModalList()"
                            class="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 rounded-xl transition-all">
                        返回列表
                    </button>

                    ${actionButtonHTML}
                </div>
            </div>
        </div>
    `;
};

window.showPurchasedCoursesModal = function(courses) {
    let oldModal = document.getElementById('purchasedCoursesModal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'purchasedCoursesModal';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';

    const courseButtonsHTML = courses.map(course => {
        const title = escapeCourseStoreHtml(course.course_name || '未命名課程');
        const teacher = escapeCourseStoreHtml(course.teacher_username || 'STUDY VERSE');
        const subject = escapeCourseStoreHtml(course.subject || '線上課程');
        const intro = escapeCourseStoreHtml(course.intro || '尚未提供課程介紹');

        return `
            <button onclick="enterPurchasedCourse('${course.id}', '${course.course_room_code || ''}', '${course.google_meet_url || ''}')"
                    class="w-full bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/50 p-5 rounded-2xl mb-4 text-left transition-all group">

                <div class="flex items-start gap-4">
                    <div class="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center text-cyan-400 text-2xl group-hover:bg-cyan-500 group-hover:text-white transition-all">
                        <i class="fas fa-book-open"></i>
                    </div>

                    <div class="flex-1">
                        <h3 class="text-white font-black text-lg mb-1">${title}</h3>

                        <p class="text-cyan-300 text-xs mb-2">
                            ${subject}｜教師：${teacher}
                        </p>

                        <p class="text-gray-500 text-xs leading-relaxed mb-3">
                            ${intro}
                        </p>

                        <div class="text-right text-cyan-400 text-xs font-black group-hover:text-cyan-300">
                            進入課程 →
                        </div>
                    </div>
                </div>
            </button>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="bg-[#111827] w-full max-w-lg rounded-3xl border border-cyan-500/30 shadow-2xl overflow-hidden relative">

            <button onclick="document.getElementById('purchasedCoursesModal').remove()"
                    class="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 z-10">
                <i class="fas fa-times"></i>
            </button>

            <div class="p-6 border-b border-gray-800 bg-gradient-to-b from-cyan-900/30 to-transparent">
                <h2 class="text-2xl font-black text-white flex items-center gap-2">
                    <i class="fas fa-layer-group text-cyan-400"></i>
                    我的線上課程
                </h2>
                <p class="text-gray-400 text-xs mt-2">
                    以下是你已購買並解鎖的課程。
                </p>
            </div>

            <div class="p-6 max-h-[65vh] overflow-y-auto">
                ${courseButtonsHTML}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
};

window.enterPurchasedCourse = function(courseId, courseRoomCode, googleMeetUrl) {
    if (googleMeetUrl && googleMeetUrl !== 'null') {
        window.open(googleMeetUrl, '_blank');
        return;
    }

    if (courseRoomCode && courseRoomCode !== 'null') {
        window.location.href = `/tutor-room.html?roomCode=${encodeURIComponent(courseRoomCode)}&standalone=true`;
        return;
    }

    alert('此課程尚未設定教室入口，請聯繫教師或平台管理員。');
};

// =========================================================
// Teacher Lobby Guard
// 教師登入後，只保留「專屬導師開局」與「課程商店」可用
// 不動 server.js、不動 roomMode、不動特約教室生命週期
// =========================================================

window.isTeacherLobbyRole = function() {
    const role = localStorage.getItem('studyVerseRole');
    return role === 'teacher' || role === 'teacher_pending';
};

window.showTeacherLobbyLockedAlert = function() {
    alert('教師帳號僅能使用「專屬導師開局」與「課程商店」。學生自習、主題教室、組隊與單機翻轉功能已鎖定。');
};

window.lockTeacherLobbyFeatureCard = function(card, label = '教師帳號已鎖定') {
    if (!card || card.dataset.teacherLocked === 'true') return;

    card.dataset.teacherLocked = 'true';
    card.dataset.lockLabel = label;

    card.classList.add('teacher-lobby-card-locked');

    card.removeAttribute('onclick');

    if (card.tagName === 'A') {
        card.dataset.originalHref = card.getAttribute('href') || '';
        card.removeAttribute('href');
        card.setAttribute('role', 'button');
    }

    card.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        window.showTeacherLobbyLockedAlert();
        return false;
    }, true);
};

window.applyTeacherLobbyRestrictions = function() {
    if (!window.isTeacherLobbyRole()) return;

    document.body.classList.add('teacher-lobby-locked');

    // Header：鎖住「切換至組隊大廳」，避免從上方直接進 team-lobby
    const teamLobbyHeaderLink = document.querySelector('header a[href="team-lobby.html"]');
    if (teamLobbyHeaderLink && teamLobbyHeaderLink.dataset.teacherLocked !== 'true') {
        teamLobbyHeaderLink.dataset.teacherLocked = 'true';
        teamLobbyHeaderLink.removeAttribute('href');
        teamLobbyHeaderLink.classList.add('teacher-lobby-link-locked');
        teamLobbyHeaderLink.innerHTML = '<i class="fas fa-lock"></i> 組隊大廳已鎖定';

        teamLobbyHeaderLink.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.showTeacherLobbyLockedAlert();
            return false;
        }, true);
    }

    // AI 自習空間：沉浸式自習室
    window.lockTeacherLobbyFeatureCard(
        document.querySelector('[onclick="handleRoomEntry(\'immersive-room.html\')"]'),
        '教師帳號不可進入'
    );

    // AI 自習空間：限時主題教室
    window.lockTeacherLobbyFeatureCard(
        document.querySelector('[onclick="showThemeRoomModal()"]'),
        '教師帳號不可進入'
    );

    // 社群組隊：小組競賽大廳
    window.lockTeacherLobbyFeatureCard(
        document.querySelector('[onclick="loadAndShowTeamModal(\'join\')"]'),
        '教師帳號不可使用'
    );

    // 社群組隊：創建專屬小隊
    window.lockTeacherLobbyFeatureCard(
        document.querySelector('[onclick="loadAndShowTeamModal(\'create\')"]'),
        '教師帳號不可使用'
    );

    // VIP 特約指導：學生輸入邀請碼入口
    const vipStudentEntryCard = document.querySelector('#intro-vip-system > div:first-child');
    window.lockTeacherLobbyFeatureCard(vipStudentEntryCard, '教師帳號不可進入');

    if (vipStudentEntryCard) {
        vipStudentEntryCard.querySelectorAll('input, button').forEach(el => {
            el.disabled = true;
            el.classList.add('cursor-not-allowed', 'opacity-60');
        });
    }

    // 單機翻轉模式
    window.lockTeacherLobbyFeatureCard(
        document.getElementById('intro-standalone-mode'),
        '教師帳號不可使用'
    );
};

document.addEventListener('DOMContentLoaded', () => {
    // 第一次：DOM 載入後鎖定靜態卡片
    setTimeout(() => {
        window.applyTeacherLobbyRestrictions();
    }, 300);

    // 第二次：等待課程 / 元件動態渲染後再補鎖一次
    setTimeout(() => {
        window.applyTeacherLobbyRestrictions();
    }, 1500);
});