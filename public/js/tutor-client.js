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

    if (typeof socket !== 'undefined') {
        // 接收導師黑板公告 (原有保留)
        socket.on('receive_tutor_announcement', (data) => {
            const blackboard = document.getElementById('blackboardContent');
            if (blackboard) {
                blackboard.innerText = data.message;
                // 加一點閃爍動畫提示學生黑板更新了
                const boardContainer = document.getElementById('blackboard');
                if (boardContainer) {
                    boardContainer.classList.add('shadow-[0_0_30px_rgba(245,158,11,0.6)]');
                    setTimeout(() => {
                        boardContainer.classList.remove('shadow-[0_0_30px_rgba(245,158,11,0.6)]');
                    }, 2000);
                }
            }
        });

        // 接收導師的重大違規警告 (原有保留)
        socket.on('receive_tutor_warning', (data) => {
            const myName = document.getElementById('inputName').value;
            // 如果警告的對象是我
            if (data.targetName === myName) {
                window.triggerViolation(data.reason || "導師已向您發出嚴重警告，請立即調整狀態！");
            }
        });

        // ==========================================
        // 新增：接收導師互動與廣播事件
        // ==========================================

        // 1. 監聽大喇叭廣播
        socket.on('receive_broadcast_alert', (data) => {
            alert(`📢 導師廣播：\n${data.message}`);
            // 若您有提示音效，可在此觸發
            // new Audio('/sounds/alert.mp3').play();
        });

        // 2. 監聽黑板公告更新
        socket.on('update_blackboard', (data) => {
            // 假設學生端有一個顯示黑板的 HTML 標籤 ID 是 studentBlackboard
            const blackboard = document.getElementById('studentBlackboard'); 
            if (blackboard) {
                blackboard.innerText = data.message;
            }
        });

        // 3. 監聽導師警告 (因為後端是廣播給所有人，所以這裡要判斷是不是警告自己)
        socket.on('receive_warning', (data) => {
            const myStudentName = document.getElementById('inputName') ? document.getElementById('inputName').value : '';
            if (data.targetName === myStudentName) { 
                alert(`⚠️ 導師警告：\n${data.reason}`);
                
                // 可選：讓畫面閃爍紅光的特效
                document.body.style.transition = "background-color 0.2s";
                document.body.style.backgroundColor = "rgba(220, 38, 38, 0.5)"; // 紅色
                setTimeout(() => {
                    document.body.style.backgroundColor = ""; // 恢復原狀
                }, 1500);
            }
        });

        // 4. 監聽個別指派任務
        socket.on('receive_task', (data) => {
            const myStudentName = document.getElementById('inputName') ? document.getElementById('inputName').value : '';
            if (data.targetName === myStudentName) { 
                alert(`📝 導師指派專屬任務：\n${data.task}`);
            }
        });
    }
});