/**
 * StudyVerse V2.2.5.1 - 專業大廳專屬邏輯 (lobby-main.js)
 * 依賴：需先載入 lobby-core.js
 * 負責：手機連動 QR Code 初始化、防呆進入自習室檢查
 */

// ================= 新增：v2.2.7 裝置分流與彈窗邏輯 =================
let targetRoomUrl = '';

// 判斷是否為行動裝置
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// 攔截原本的進入教室點擊，進行分流
function handleRoomEntry(url) {
    targetRoomUrl = url;
    if (isMobileDevice()) {
        // 【情境 2】行動裝置：顯示 [A] 或 [B] 選擇彈窗
        document.getElementById('device-choice-modal').classList.remove('hidden');
        document.getElementById('device-choice-modal').classList.add('flex');
    } else {
        // 【情境 1】PC 裝置：直接顯示連動詢問彈窗
        showSyncPromptModal();
    }
}

// 顯示詢問 QR Code 連動彈窗
function showSyncPromptModal() {
    document.getElementById('device-choice-modal').classList.add('hidden');
    document.getElementById('device-choice-modal').classList.remove('flex');
    
    document.getElementById('sync-prompt-modal').classList.remove('hidden');
    document.getElementById('sync-prompt-modal').classList.add('flex');
}

// 關閉所有新加入的彈窗
function closeAllEntryModals() {
    document.getElementById('device-choice-modal').classList.add('hidden');
    document.getElementById('device-choice-modal').classList.remove('flex');
    document.getElementById('sync-prompt-modal').classList.add('hidden');
    document.getElementById('sync-prompt-modal').classList.remove('flex');
}

// 綁定彈窗內的按鈕事件
document.addEventListener('DOMContentLoaded', () => {
    
    // --- 裝置選擇彈窗 (行動裝置) 按鈕 ---
    const btnRoleMain = document.getElementById('btn-role-main');
    if (btnRoleMain) {
        // 選擇 [A] 主螢幕 -> 詢問是否掃碼連動
        btnRoleMain.addEventListener('click', showSyncPromptModal);
    }

    const btnRoleSensor = document.getElementById('btn-role-sensor');
    if (btnRoleSensor) {
        // 選擇 [B] 翻轉感測器 -> 跳轉單機翻轉模式 (套用你現有的邏輯)
        btnRoleSensor.addEventListener('click', () => {
            closeAllEntryModals();
            window.location.href = 'flip-room.html'; 
        });
    }

    // --- 連動詢問彈窗 按鈕 ---
    const btnSyncCancel = document.getElementById('btn-sync-cancel');
    if (btnSyncCancel) {
        // 取消連動 -> 以一般模式進入目標教室
        btnSyncCancel.addEventListener('click', () => {
            closeAllEntryModals();
            // 呼叫原本寫好的進入教室檢查機制
            if (typeof enterClassroomWithCheck === 'function') {
                enterClassroomWithCheck(targetRoomUrl);
            } else {
                window.location.href = targetRoomUrl;
            }
        });
    }

    const btnSyncConfirm = document.getElementById('btn-sync-confirm');
    if (btnSyncConfirm) {
        // 確定連動 -> 畫面引導至 QR Code 區塊
        btnSyncConfirm.addEventListener('click', () => {
            closeAllEntryModals();
            
            // 畫面平滑滾動到 QR Code 區塊 (對應你 HTML 裡的 id="syncModule")
            const syncModule = document.getElementById('syncModule');
            if (syncModule) {
                syncModule.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // 加入一點高光動畫提示使用者看這裡
                syncModule.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2', 'ring-offset-black', 'transition-all', 'duration-500');
                setTimeout(() => {
                    syncModule.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2', 'ring-offset-black');
                }, 2000);
            }
            
            // 備註：在這裡你的 WebSocket 應該要處於監聽狀態，
            // 當收到另一支手機掃碼成功 (deviceLinked 事件) 時，再自動執行 enterClassroomWithCheck(targetRoomUrl);
        });
    }
});
// =========================================================================

// 註冊頁面專屬初始化事件 (當 core.js 完成登入後會自動呼叫)
window.pageSpecificInit = function() {
    initSyncQRCode();
};

// [專業大廳專屬] 進入教室前的綜合防呆檢查
window.enterClassroomWithCheck = function(roomUrl) {
    // 偵測使用者當下是否正在使用行動裝置 (手機/平板)
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobileDevice) {
        // (1) 跳出詢問是否進入單機翻轉
        const goStandalone = confirm("📱 偵測到您正在使用手機！\n\n是否進入「單機翻轉大廳」選擇專屬教室或隊伍？\n(將獲得專屬游擊隊標記與計分)");
        
        if (goStandalone) {
            // (2) 若按「是」則跳轉至「手機翻轉大廳」
            window.location.href = '/flip-room.html';
        } else {
            // (3) 若按「否」則依原專業大廳邏輯進入教室
            if (typeof openSetupModal === 'function') {
                openSetupModal(roomUrl);
            } else if (typeof showRoomSetup === 'function') {
                showRoomSetup(roomUrl);
            } else {
                window.location.href = roomUrl;
            }
        }
    } else {
        // 非手機設備，依原專業大廳邏輯進入教室
        if (typeof openSetupModal === 'function') {
            openSetupModal(roomUrl);
        } else if (typeof showRoomSetup === 'function') {
            showRoomSetup(roomUrl);
        } else {
            window.location.href = roomUrl;
        }
    }
};

// [專業大廳專屬] 初始化手機連動 QR Code (修正版，加上識別碼)
function initSyncQRCode() {
    const qrcodeContainer = document.getElementById("qrcode");
    if(!qrcodeContainer) return;
    
    // 使用 socket.id 讓手機知道要跟哪個大廳連動
    // 確保這裡抓得到 socket，如果你的 socket 變數名稱不同請記得修改
    const syncToken = typeof socket !== 'undefined' ? socket.id : ''; 
    
    const baseUrl = window.location.origin; 
    // 把專屬 ID 塞進網址裡，例如： https://你的網域/mobile.html?sync=abc123xyz
    const mobileUrl = `${baseUrl}/mobile.html?sync=${syncToken}`;
    
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

// [專業大廳專屬] 複製手機連結
window.copyMobileUrl = function() {
    const baseUrl = window.location.origin;
    const mobileUrl = `${baseUrl}/mobile.html`;
    navigator.clipboard.writeText(mobileUrl).then(() => {
        alert('手機連動網址已複製到剪貼簿！');
    });
};

// =========================================================================
// [新增] 專業大廳專屬：動態載入組隊模組 (Dynamic Loading for Team Modals)
// =========================================================================

window.loadAndShowTeamModal = async function(modalType) {
    // 抓取觸發點擊的按鈕，用於顯示載入狀態
    const btn = window.event ? window.event.currentTarget : null;
    let originalText = '';
    
    if (btn) {
        originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 載入中...';
        btn.disabled = true;
    }

    try {
        // 1. 動態載入組隊專屬 CSS (如果還沒載入過)
        if (!document.getElementById('team-css-link')) {
            const link = document.createElement('link');
            link.id = 'team-css-link';
            link.rel = 'stylesheet';
            link.href = '/css/lobby-team.css';
            document.head.appendChild(link);
        }

        // 2. 動態載入彈窗 UI 元件 (team-modals.js)
        if (!customElements.get('team-modals')) {
            await loadScriptAsync('/js/team-modals.js');
            // 將標籤注入畫面，這會觸發 Web Component 渲染出三個隱藏的 Modal
            const modalContainer = document.createElement('team-modals');
            document.body.appendChild(modalContainer);
        }

        // 3. 動態載入組隊邏輯 (lobby-team.js)
        // 用 window.executeJoinTeam 來判斷是否已經載入過
        if (!window.executeJoinTeam) {
            await loadScriptAsync('/js/lobby-team.js');
        }

        // 4. 顯示對應的 Modal
        // 為了確保 Web Component 有足夠時間渲染，用一小段延遲或是直接抓取
        setTimeout(() => {
            const targetId = modalType === 'create' ? 'createTeamModal' : 'joinTeamModal';
            const targetModal = document.getElementById(targetId);
            
            if (targetModal) {
                targetModal.classList.remove('hidden');
                targetModal.classList.add('flex');
            } else {
                // 如果元件還沒來得及渲染，降級使用 lobby-team.js 內建的開啟函數
                if (modalType === 'create' && typeof window.openCreateTeamModal === 'function') {
                    window.openCreateTeamModal();
                } else if (modalType === 'join' && typeof window.openJoinTeamModal === 'function') {
                    window.openJoinTeamModal();
                }
            }
        }, 50); // 給予 DOM 50 毫秒的渲染時間

    } catch (error) {
        console.error("載入組隊模組失敗:", error);
        alert("載入失敗，請稍後再試！");
    } finally {
        // 恢復按鈕原本的狀態
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
};

// 輔助函式：非同步動態載入 Script
function loadScriptAsync(src) {
    return new Promise((resolve, reject) => {
        // 如果已經有這個 script 就不要重複加入
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

// =========================================================================
// [新增] 大廳端 Socket 監聽：切換狀態 (手機光環)
// =========================================================================

socket.on("status_updated", (data) => {
    // 假設你的每個學生頭像都有一個對應的 ID，例如 "user-card-王小明"
    const userCard = document.getElementById(`user-card-${data.name}`); 
    
    if (userCard) {
        if (data.isFlipped) {
            // 1. 掛上手機翻轉的專屬 CSS
            userCard.classList.add('is-mobile-flip');
            
            // 2. 更改滑鼠懸停提示 (Tooltip)
            userCard.setAttribute('title', '📱 手機翻轉深度專注中 (積分 x0.5)');
            
            // 3. 如果你的卡片內有文字狀態欄，也可以一併更新
            const statusText = userCard.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = "游擊隊專注中";
                statusText.style.color = "#3b82f6";
            }
        } else {
            // 偵測到手機拿起或未翻轉，移除專屬 CSS
            userCard.classList.remove('is-mobile-flip');
            userCard.setAttribute('title', data.status === "FOCUSED" ? '在線專注中' : '一般狀態');
            
            const statusText = userCard.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = data.status === "FOCUSED" ? "專注中" : "閒置";
                statusText.style.color = ""; // 恢復預設顏色
            }
        }
    }
});

// =========================================================================
// [新增] 社會性死亡特效：接收 flip_failed 事件
// =========================================================================

socket.on('flip_failed', (data) => {
    const userName = data.name;

    // 1. 碎裂與灰階特效：尋找大廳中的該名學生卡片
    const userCard = document.getElementById(`user-card-${userName}`);
    if (userCard) {
        // 掛上碎裂動畫 class
        userCard.classList.add('flip-failed-shatter');

        // 更改狀態文字為陣亡
        const statusText = userCard.querySelector('.status-text');
        if (statusText) {
            statusText.innerHTML = "💔 專注陣亡";
            statusText.style.color = "#ef4444"; // 警告紅
        }

        // 10秒後解除碎裂特效 (若想讓他永遠灰階直到重連，可把這段 setTimeout 刪除)
        setTimeout(() => {
            userCard.classList.remove('flip-failed-shatter');
        }, 10000);
    }

    // 2. 聊天室系統廣播 (請確認你聊天室的容器 ID，這裡預設為 chat-messages)
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
        chatBox.scrollTop = chatBox.scrollHeight; // 自動捲動到最底
    }

    // 3. 【其它加碼】全大廳播放玻璃碎裂音效
    const shatterSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2855/2855-preview.mp3');
    shatterSound.volume = 0.6;
    shatterSound.play().catch(() => {});

    // 4. 【其它加碼】頂部公開處刑跑馬燈 (Toast)
    showPublicShamingToast(userName);
});

// 注入專屬的「社會性死亡」CSS 特效與動畫
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
        pointer-events: none; /* 陣亡後短暫禁止點擊 */
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
    setTimeout(() => toast.remove(), 5000); // 5秒後自動移除
}

// =========================================================================
// [新增] 監聽手機掃碼連動成功事件
// =========================================================================
socket.on('deviceLinked', (data) => {
    console.log('✅ 收到手機連動成功訊號！', data);
    
    // 給予畫面提示 (可選，讓使用者知道連動成功了)
    const syncModule = document.getElementById('syncModule');
    if (syncModule) {
        syncModule.classList.add('ring-4', 'ring-green-500'); // 變成綠色框
        setTimeout(() => syncModule.classList.remove('ring-4', 'ring-green-500'), 2000);
    }

    // 自動進入剛才選擇的目標教室！
    if (targetRoomUrl) {
        console.log('準備進入教室：', targetRoomUrl);
        // 確保彈窗都關閉
        closeAllEntryModals();
        
        // 執行進入教室的動作 (稍微延遲 0.5 秒，讓使用者看到綠色成功提示)
        setTimeout(() => {
            if (typeof enterClassroomWithCheck === 'function') {
                enterClassroomWithCheck(targetRoomUrl);
            } else {
                window.location.href = targetRoomUrl;
            }
        }, 500);
    } else {
        // 如果他只是單純在首頁掃碼，還沒點擊任何教室
        alert("✅ 手機連動成功！現在您可以點擊進入任何一間教室了。");
    }
});