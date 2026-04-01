/**
 * StudyVerse V2.2.5.1 - 專業大廳專屬邏輯 (lobby-main.js)
 * 依賴：需先載入 lobby-core.js
 * 負責：手機連動 QR Code 初始化、防呆進入自習室檢查
 */

// 註冊頁面專屬初始化事件 (當 core.js 完成登入後會自動呼叫)
window.pageSpecificInit = function() {
    initSyncQRCode();
};

// [專業大廳專屬] 進入教室前的綜合防呆檢查
window.enterClassroomWithCheck = function(roomUrl) {
    // 🌟 新增：偵測使用者當下是否正在使用行動裝置 (手機/平板)
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobileDevice) {
        // 如果是手機，直接詢問是否進入單機翻轉模式
        const goStandalone = confirm("📱 偵測到您正在使用手機！\n\n是否直接以「單機翻轉模式」進入該自習室或小隊？\n(將獲得專屬游擊隊標記與計分)");
        
        if (goStandalone) {
            // 將想去的教室 URL 當作參數 (targetRoom) 傳遞給 mobile.html
            window.location.href = `/mobile.html?standalone=true&targetRoom=${encodeURIComponent(roomUrl)}`;
        } else {
            // 不使用翻轉模式，當作一般網頁進入
            window.location.href = roomUrl;
        }
        return; // 結束執行，不再往下跑電腦版的 QR Code 邏輯
    }

    // ==========================================
    // 以下是原本的「電腦端」防呆與 QR Code 邏輯
    // ==========================================
    
    // 依賴於 core.js 中的 isMobileConnected 與 isMobileFlipped 變數
    if (isMobileConnected && isMobileFlipped) {
        window.location.href = roomUrl;
        return;
    }

    if (isMobileConnected && !isMobileFlipped) {
        alert("📍 偵測到手機已連動，但尚未「翻轉蓋上」！\n請先將手機螢幕朝下放置，即可啟動深度專注模式並進入教室。");
        return;
    }

    const userChoice = confirm("💡 系統提示：連動手機進入「翻轉模式」可以獲得額外加分且減少 AI 誤判！\n\n是否要現在掃描 QR Code 連動手機？");
    
    if (userChoice) {
        const qrSection = document.querySelector('#syncModule'); 
        if (qrSection) {
            qrSection.scrollIntoView({ behavior: 'smooth' });
            qrSection.classList.add('ring-4', 'ring-blue-500', 'animate-pulse');
            setTimeout(() => qrSection.classList.remove('animate-pulse'), 3000);
            alert("請掃描右側藍色區塊內的 QR Code。連動成功後，狀態將自動更新！");
        } else {
            // 如果畫面上剛好沒有 QR Code 區塊，直接開新視窗顯示手機端網址
            window.open('/mobile.html', '_blank');
        }
    } else {
        window.location.href = roomUrl;
    }
};

// [專業大廳專屬] 初始化手機連動 QR Code
function initSyncQRCode() {
    const qrcodeContainer = document.getElementById("qrcode");
    if(!qrcodeContainer) return;
    
    const baseUrl = window.location.origin; 
    const mobileUrl = `${baseUrl}/mobile.html`;
    
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