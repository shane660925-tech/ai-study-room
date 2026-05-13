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

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

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

        if (user.role === 'teacher' && user.teacher_status === 'approved') {
            if (typeof openTeacherSetupModal === 'function') {
                openTeacherSetupModal();
            }
            return;
        }

        if (user.teacher_status === 'pending') {
            alert('你的教師申請目前審核中，請等待平台管理員審核。');
            return;
        }

        if (user.teacher_status === 'rejected') {
            alert('你的教師申請未通過，如需重新申請，請修改資料後再次送出。');
            return;
        }

        alert('此功能限通過審核的教師使用。請先在大廳送出教師申請。');

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

    const btnRoleMain = document.getElementById('btn-role-main');
    if (btnRoleMain) {
        btnRoleMain.addEventListener('click', showSyncPromptModal);
    }

    const btnRoleSensor = document.getElementById('btn-role-sensor');
    if (btnRoleSensor) {
        btnRoleSensor.addEventListener('click', () => {
            closeAllEntryModals();
            const currentName = localStorage.getItem('studyVerseUser') || '';
            window.location.href = `/flip-room.html?name=${encodeURIComponent(currentName)}`; 
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
                <button onclick="enterThemeRoom('${targetUrl}')"
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

window.enterThemeRoom = function(targetUrl) {
    const modal = document.getElementById('themeRoomModal');
    if (modal) modal.remove();

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

/**
 * 核心邏輯整合：修改原本的套接字監聽器
 * 找到您原本 lobby-main.js 中的 socket.on('deviceLinked', ...) 和 socket.on('mobile_sync_update', ...)
 * 並用下方的代碼「覆蓋」或「整合」進去。
 */

// A. 整合進 deviceLinked (手機掃描成功)
const originalSocketOnDeviceLinked = socket.listeners('deviceLinked')[0]; 
// 註：如果 originalSocketOnDeviceLinked 的獲取方式不適用您的環境，請直接在您原本的 socket.on('deviceLinked', ...) 函式體內最前面加入以下判斷邏輯。

socket.on('deviceLinked', (data) => {
    // 執行原本的邏輯 (sidebar 更新等)
    if (originalSocketOnDeviceLinked) originalSocketOnDeviceLinked(data);

    // --- 新增VIP入口邏輯 ---
    if (isProcessingTutorEntry) {
        // 更新彈窗 UI 到步驟 2
        
        // 1. 標記步驟 1 完成
        document.getElementById('tutor-step-1').classList.add('border-green-500', 'bg-green-950/30');
        document.getElementById('tutor-step-1-icon').classList.add('bg-green-600', 'text-white');
        document.getElementById('tutor-step-1-status').innerText = '連動成功！';
        document.getElementById('tutor-step-1-status').classList.add('text-green-400');
        document.getElementById('tutor-step-1-check').classList.remove('hidden');

        // 2. 啟用步驟 2 提示翻轉
        document.getElementById('tutor-step-2').classList.remove('opacity-50');
        document.getElementById('tutor-step-2').classList.add('border-yellow-500/50'); // 黃色邊框提示
        document.getElementById('tutor-step-2-icon').classList.add('bg-yellow-600', 'text-white');
        document.getElementById('tutor-step-2-status').innerText = '請將手機螢幕朝下放置在桌上';
        document.getElementById('tutor-step-2-status').classList.add('text-yellow-400');
    }
});


// B. 整合進 mobile_sync_update (狀態更新，含翻轉完成)
// 請找到檔案中原本的此段落，將 VIP 入口邏輯加入到 data.type === 'FLIP_COMPLETED' 判斷中

socket.on('mobile_sync_update', (data) => {
    if (data.type === 'FLIP_COMPLETED') {
        
        // --- 新增 VIP 入口跳轉邏輯 ---
        if (isProcessingTutorEntry) {
            // 1. 更新步驟 2 UI 為完成
            document.getElementById('tutor-step-2').classList.remove('border-yellow-500/50');
            document.getElementById('tutor-step-2').classList.add('border-green-500', 'bg-green-950/30');
            document.getElementById('tutor-step-2-icon').classList.remove('bg-yellow-600');
            document.getElementById('tutor-step-2-icon').classList.add('bg-green-600');
            document.getElementById('tutor-step-2-status').innerText = '翻轉檢測完成！即將進入教室';
            document.getElementById('tutor-step-2-status').classList.remove('text-yellow-400');
            document.getElementById('tutor-step-2-status').classList.add('text-green-400');
            document.getElementById('tutor-step-2-check').classList.remove('hidden');

            // 2. 隱藏 QR Code，顯示跳轉中
            document.getElementById('tutor-qrcode-container').classList.add('hidden');
            document.getElementById('tutor-redirect-notice').classList.remove('hidden');

            // 3. 延遲一小段時間讓使用者看到成功狀態，然後跳轉
            setTimeout(() => {
                isProcessingTutorEntry = false; 
                // 👇 改為使用 targetRoomUrl，這樣才會帶上 ?room=XXXX 參數
                window.location.href = targetRoomUrl || '/tutor-room.html'; 
            }, 1500);

            return; // 攔截原本的邏輯，不執行下方的大廳彈窗或自動進入 targetRoomUrl
        }
        // --- VIP 邏輯結束 ---


        // ... 以下是您檔案中原本就有的 FLIP_COMPLETED 邏輯 (alert, syncModule 更新, 隊伍彈窗點擊等) ...
        alert("✅ 連動成功！手機已確認朝下置放。"); 
        // ... (省略原本的代碼) ...
    }
});

// 開啟教師排課彈窗 (後續可加上權限驗證 API)
window.openTeacherSetupModal = function() {
    const modal = document.getElementById('teacher-setup-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

// 教師生成房間並跳轉
window.generateTeacherRoom = function() {
    const size = document.getElementById('teacherRoomSize').value;
    const periods = document.getElementById('teacherPeriods').value;
    const periodTime = document.getElementById('teacherPeriodTime').value;
    const restTime = document.getElementById('teacherRestTime').value;
    const startTime = document.getElementById('teacherStartTime').value;

    if (!periods || !periodTime || !restTime || !startTime) {
        alert("請將排課設定填寫完整！");
        return;
    }

    // 隨機生成一組 6 碼的教室代碼
    const roomCode = 'VIP-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // 【修正點】：將排程資料存入 localStorage，Key 使用動態 roomCode 以供同步
    const scheduleData = {
        roomCode,
        size,
        periods: parseInt(periods),
        periodTime: parseInt(periodTime),
        restTime: parseInt(restTime),
        startTime
    };
    
    // 使用具備房間代碼的 Key 進行存儲，解決 Dashboard 讀取問題
    localStorage.setItem(`tutor_schedule_${roomCode}`, JSON.stringify(scheduleData));

    // 發送給 Socket 建立獨立房間
    if (typeof socket !== 'undefined') {
        socket.emit('create_tutor_room', scheduleData);
    }

    try {
        navigator.clipboard.writeText(roomCode);
        alert(`建立成功！您的教室代碼為：${roomCode}\n(代碼已自動為您複製)\n請將此代碼分享給學生。`);
    } catch(e) {
        alert(`建立成功！您的教室代碼為：${roomCode}\n請將此代碼分享給學生。`);
    }
    
    // 跳轉至教師控制台，並帶上代碼參數
    window.location.href = `/tutor-dashboard.html?room=${roomCode}`;
};

// ================= 新增：VIP 特約教室代碼驗證與專屬跳轉 =================
window.verifyAndEnterTutorRoom = function() {
    const codeInput = document.getElementById('tutorRoomCode');
    const roomCode = codeInput ? codeInput.value.trim() : '';

    if (!roomCode) {
        alert("請先輸入教師提供的教室代碼！");
        return;
    }

    // 驗證成功後，將代碼存入 sessionStorage
    sessionStorage.setItem('currentTutorRoomCode', roomCode);
    targetRoomUrl = `/tutor-room.html?room=${roomCode}`; 
    
    // 手機防呆檢查
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        alert("⚠️ 特約教室需要使用「電腦」進入，並將手機作為翻轉輔助鏡頭。請改用電腦開啟此網頁！");
        return;
    }

    // 1. 關閉普通教室彈窗 (避免重疊)
    const normalModal = document.getElementById('device-modal');
    if (normalModal) {
        normalModal.classList.add('hidden');
        normalModal.classList.remove('flex');
    }

    // 2. 開啟特約專屬彈窗
    const qrContainer = document.getElementById('tutor-qrcode-container');
    const tutorModal = document.getElementById('tutor-auth-modal') || 
                       document.getElementById('tutorModal') || 
                       (qrContainer ? qrContainer.closest('.fixed') : null);

    if (tutorModal) {
        tutorModal.classList.remove('hidden');
        tutorModal.classList.add('flex', 'z-[100]');
        
        // ====== 關鍵修復：手動生成通往 mobile.html 的 QR Code ======
        if (qrContainer) {
            qrContainer.innerHTML = ''; // 清空原本的預設圖示
            
            // 取得使用者名稱與 Socket ID 以產生專屬網址
            const username = localStorage.getItem('studyVerseUser') || '學員';
            const syncToken = typeof socket !== 'undefined' ? socket.id : '';
            
            // 組合正確的 mobile.html 網址
            const mobileUrl = `${window.location.origin}/mobile.html?name=${encodeURIComponent(username)}&sync=${syncToken}`;
            
            // 繪製 QR Code (使用黑底白字符合您的 UI 風格，若掃描不易可對調顏色)
            new QRCode(qrContainer, {
                text: mobileUrl,
                width: 160,
                height: 160,
                colorDark: "#ffffff", 
                colorLight: "#000000" 
            });
        } else {
            console.error("找不到用來放 QR Code 的容器 (tutor-qrcode-container)！");
        }
        
        // 觸發連動監聽
        if (typeof initMobileSync === 'function') initMobileSync();
    } else {
        alert("找不到特約專屬彈窗！請檢查 HTML 結構。");
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
        <div class="glass-panel p-6 rounded-3xl flex flex-col border border-white/5 opacity-40 grayscale-[0.5] cursor-not-allowed relative overflow-hidden">
            <div class="absolute top-2 right-4 text-[10px] font-bold text-gray-500 tracking-widest">尚未解鎖</div>
            <div class="w-12 h-12 bg-gray-500/20 rounded-xl flex items-center justify-center text-gray-400 text-2xl mb-4">
                <i class="fas fa-lock"></i>
            </div>
            <h3 class="text-xl font-black text-gray-400 mb-1">線上課程</h3>
            <p class="text-gray-600 text-xs mb-4 flex-1">此專區僅限已購課程學員進入。請先至官網選購課程以開啟權限。</p>
            <div class="w-full text-center bg-white/5 py-2 rounded-lg text-xs font-bold text-gray-500 border border-white/5">未獲得授權</div>
        </div>
    `;

    if (!username) {
        container.innerHTML = dimmedCardHTML;
        return;
    }

    try {
        const response = await fetch(`/api/my-courses?username=${encodeURIComponent(username)}`);
        const courses = await response.json();

        if (courses.length === 0) {
            container.innerHTML = dimmedCardHTML;
            return;
        }

        // --- [修改] 不管有幾門課，大廳只顯示一個總入口卡片 ---
        container.innerHTML = ''; 
        const card = document.createElement('div');
        card.className = "glass-panel p-6 rounded-3xl room-card flex flex-col border border-white/5 group cursor-pointer transition-all hover:border-cyan-500/50";
        // 點擊後改為呼叫彈窗函式，並把課程資料傳進去
        card.onclick = () => showCoursesModal(courses); 
        card.innerHTML = `
            <div class="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center text-cyan-400 text-2xl mb-4 group-hover:bg-cyan-500 group-hover:text-white transition-all">
                <i class="fas fa-layer-group"></i>
            </div>
            <h3 class="text-xl font-black text-white mb-1">線上課程</h3>
            <p class="text-gray-500 text-xs mb-4 flex-1">您擁有 <span class="text-cyan-400 font-bold">${courses.length}</span> 門已解鎖課程。點擊開啟課程清單並進入教室。</p>
            <div class="w-full text-center bg-white/5 group-hover:bg-cyan-600 py-2 rounded-lg text-xs font-bold text-white transition-all">選擇課程</div>
        `;
        container.appendChild(card);

    } catch (err) {
        console.error("載入課程失敗:", err);
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

function startIntroTutorial() {
    const introCompleted =
    localStorage.getItem('studyVerseIntroCompleted');

if (introCompleted === 'true') {
    return;
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

    localStorage.setItem(
        'studyVerseIntroCompleted',
        'true'
    );

    const username =
        localStorage.getItem('studyVerseUser');

    if (username) {

        try {

            await fetch('/api/intro-complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username
                })
            });

        } catch (err) {

            console.error(
                '新手導覽完成同步失敗:',
                err
            );
        }
    }

    clearIntroHighlight();
}

setTimeout(() => {
    startIntroTutorial();
}, 2500);

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