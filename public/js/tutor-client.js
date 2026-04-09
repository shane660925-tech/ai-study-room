/**
 * tutor-client.js
 * VIP 特約教室專屬前端邏輯
 */

// ==========================================
// 1. VIP 專屬 UI 控制邏輯
// ==========================================

// 關閉重大違規警告 (由 HTML onclick 觸發)
window.closeViolation = function() {
    const overlay = document.getElementById('violation-overlay');
    if(overlay) overlay.style.display = 'none';
};

// 觸發重大違規警告 (供外部 AI 偵測模組呼叫)
window.triggerViolation = function(reason) {
    const overlay = document.getElementById('violation-overlay');
    const reasonText = document.getElementById('violation-reason');
    if(overlay && reasonText) {
        reasonText.innerText = reason || "系統偵測到嚴重分心或違規行為，請立即調整！";
        overlay.style.display = 'flex'; 
    }
};

// 更新上方狀態列 (供外部呼叫)
// 範例用法：updateTutorStatus('normal', '監測中'); 或 updateTutorStatus('red', '異常！');
window.updateTutorStatus = function(statusType, text) {
    const statusBar = document.getElementById('status-bar');
    const statusText = document.getElementById('status-text');
    
    if (statusBar && statusText) {
        statusText.innerText = text;
        if (statusType === 'red') {
            statusBar.classList.add('status-red');
        } else {
            statusBar.classList.remove('status-red');
        }
    }
};

// ==========================================
// 2. 核心攔截器 (翻轉模式計分邏輯)
// ==========================================
const originalFetch = window.fetch;
window.fetch = async function() {
    if (arguments[0] === '/api/save-focus') {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('standalone') === 'true') {
            try {
                let options = arguments[1];
                let body = JSON.parse(options.body);
                body.roomType = 'flip-mode'; // 強制覆寫 roomType
                options.body = JSON.stringify(body);
                arguments[1] = options;
            } catch(e) { 
                console.error("Fetch intercept error:", e); 
            }
        }
    }
    return originalFetch.apply(this, arguments);
};

// ==========================================
// 3. 頁面初始化與 Socket 監聽
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isStandalone = urlParams.get('standalone') === 'true';

    // 初始狀態設定為監測中
    updateTutorStatus('normal', '連線穩定，AI 觀測中');

    if (isStandalone) {
        const overlay = document.getElementById('startOverlay');
        if (overlay) {
            overlay.classList.remove('flex');
            overlay.classList.add('hidden');
        }
        
        if (urlParams.get('goal')) document.getElementById('inputGoal').value = urlParams.get('goal');
        if (urlParams.get('duration')) document.getElementById('inputTime').value = urlParams.get('duration');
        if (urlParams.get('username')) document.getElementById('inputName').value = urlParams.get('username');

        window.addEventListener('load', () => {
            setTimeout(() => {
                const startBtn = document.getElementById('startBtn');
                if (startBtn) startBtn.click();

                // 📱 通知全伺服器：我是 VIP 手機端！
                const myName = document.getElementById('inputName').value;
                if (typeof socket !== 'undefined') {
                    socket.emit('update_status', { name: myName, isStandalone: true });
                }
                
                // 變更自己的視窗為直立式
                const myFrame = document.getElementById('myDeskFrame');
                if (myFrame) {
                    myFrame.classList.remove('aspect-video');
                    myFrame.classList.add('is-mobile-flip');
                    if(!myFrame.querySelector('.mobile-badge')) {
                        const badge = document.createElement('div');
                        badge.className = 'mobile-badge';
                        badge.innerHTML = '<i class="fas fa-mobile-alt animate-pulse"></i> VIP 手機端';
                        myFrame.appendChild(badge);
                    }
                }
            }, 500);
        });
    }

    // 👁️ 監聽全服名單：將其他單機模式使用者的視窗變成長方形
    if (typeof socket !== 'undefined') {
        socket.on('update_rank', (users) => {
            const standaloneUsers = users.filter(u => u.isStandalone).map(u => u.name);
            
            // 延遲一下讓 room-ui.js 先生成 DOM
            setTimeout(() => {
                const allFrames = document.querySelectorAll('#othersContainer .aspect-video, #othersContainer .is-mobile-flip');
                allFrames.forEach(frame => {
                    const textContent = frame.textContent || "";
                    const isUserStandalone = standaloneUsers.some(name => textContent.includes(name));
                    
                    if (isUserStandalone) {
                        frame.classList.remove('aspect-video');
                        frame.classList.add('is-mobile-flip');
                        if (!frame.querySelector('.mobile-badge')) {
                            const badge = document.createElement('div');
                            badge.className = 'mobile-badge';
                            badge.innerHTML = '<i class="fas fa-mobile-alt animate-pulse"></i> 手機端';
                            frame.appendChild(badge);
                        }
                    } else {
                        frame.classList.add('aspect-video');
                        frame.classList.remove('is-mobile-flip');
                        const badge = frame.querySelector('.mobile-badge');
                        if (badge) badge.remove();
                    }
                });
            }, 800);
        });
    }
});