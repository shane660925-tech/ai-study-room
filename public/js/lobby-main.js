/**
 * StudyVerse V2.2.5.1 - 專業大廳專屬邏輯 (lobby-main.js)
 * 依賴：需先載入 lobby-core.js
 * 負責：手機連動 QR Code 初始化、防呆進入自習室檢查
 */

// ================= 新增：v2.2.7 裝置分流與彈窗邏輯 =================
let targetRoomUrl = '';
window.isDeviceLinked = false; 

// =========================================================================
// (1) QR Code 攔截器：不管系統哪個角落產生 QR Code，自動把 ID 綁進網址
// =========================================================================
if (typeof QRCode !== 'undefined') {
    const originalQRCode = QRCode;
    QRCode = function(el, options) {
        // 修正處 A：增加導覽列姓名檢查並改為預設「學員」
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

    // A. 處理所有輸入框 (鎖定並替換)
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

    // B. 👉 處理純文字 (將「歡迎回來，COMMANDER」等字眼動態替換)
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walk.nextNode()) {
        // 為了避免大小寫問題，統一掃描大寫 COMMANDER 並替換
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

document.addEventListener('DOMContentLoaded', () => {
    const btnRoleMain = document.getElementById('btn-role-main');
    if (btnRoleMain) {
        btnRoleMain.addEventListener('click', showSyncPromptModal);
    }

    const btnRoleSensor = document.getElementById('btn-role-sensor');
    if (btnRoleSensor) {
        btnRoleSensor.addEventListener('click', () => {
            closeAllEntryModals();
            // 👉 修改這裡：跳轉單機模式時，把名字帶進網址
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

window.pageSpecificInit = function() {
    initSyncQRCode();
};

window.enterClassroomWithCheck = function(roomUrl) {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobileDevice) {
        const goStandalone = confirm("📱 偵測到您正在使用手機！\n\n是否進入「單機翻轉大廳」選擇專屬教室或隊伍？\n(將獲得專屬游擊隊標記與計分)");
        
        if (goStandalone) {
            // 👉 修改這裡：跳轉單機模式時，把名字帶進網址
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
    
    console.log('✅ 收到手機連線訊號，等待翻轉！', data);
    
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
        console.log("💻 收到手機翻轉成功的訊號！");
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
            const nextBtn = buttons.find(btn => 
                (btn.innerText.includes('下一步') || btn.innerText.includes('完成') || btn.innerText.includes('繼續')) && 
                !btn.closest('.hidden') && 
                window.getComputedStyle(btn).display !== 'none'
            );
            
            if (nextBtn) {
                isTeamModalOpen = true;
                setTimeout(() => nextBtn.click(), 300); 
            }
        });

        if (!isTeamModalOpen && targetRoomUrl) {
            console.log('準備打開教室設定：', targetRoomUrl);
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
        // 修正處 B：增加導覽列姓名檢查並改為預設「學員」
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