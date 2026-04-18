/**
 * tutor-client.js
 * VIP 特約教室專屬前端邏輯
 */

// ==========================================
// 全域音效與震動控制變數
// ==========================================
window.activeWarningAudio = null;
window.activeBroadcastAudio = null;
window.vibrationInterval = null; 

// ==========================================
// 1. VIP 專屬 UI 控制邏輯
// ==========================================
if (typeof window.socket === 'undefined') {
    window.socket = typeof io !== 'undefined' ? io() : null;
}
const socket = window.socket;

if (!socket) {
    console.error("❌ Socket.io 未載入！");
}

// 學生按下「我收到了」，關閉廣播並停止提示聲
window.closeSpeaker = function() {
    const overlay = document.getElementById('speaker-overlay');
    if (overlay) {
        overlay.style.display = 'none'; 
        overlay.classList.remove('flex');
        overlay.classList.add('hidden');
    }
    
    if (window.activeBroadcastAudio) {
        window.activeBroadcastAudio.pause();
        window.activeBroadcastAudio.currentTime = 0;
    }
    
    if (window.activeWarningAudio) {
        window.activeWarningAudio.pause();
        window.activeWarningAudio.currentTime = 0;
    }
    
    const player = document.getElementById('voice-player');
    if (player) {
        player.pause();
        player.currentTime = 0;
    }
};

// 學生按下「我知道了」，關閉警告並停止所有聲音與震動
window.closeViolation = function() {
    const overlay = document.getElementById('violation-overlay');
    if(overlay) overlay.style.display = 'none';

    if (window.activeWarningAudio) {
        window.activeWarningAudio.pause();
        window.activeWarningAudio.currentTime = 0;
    }
    
    if (window.vibrationInterval) {
        clearInterval(window.vibrationInterval);
        window.vibrationInterval = null;
        if (navigator.vibrate) navigator.vibrate(0); 
    }
};

// 觸發重大違規警告
window.triggerViolation = function(reason) {
    const overlay = document.getElementById('violation-overlay');
    const reasonText = document.getElementById('violation-reason');
    
    if(overlay && reasonText) {
        reasonText.innerText = reason || "系統偵測到嚴重分心或違規行為，請立即調整！";
        overlay.style.display = 'flex'; 
    }

    const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '未知學員';
    let snapImg = null;

    try {
        const video = document.querySelector('video'); 
        if (video && video.readyState === 4) {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            snapImg = canvas.toDataURL('image/jpeg', 0.5); 
        }
    } catch (e) {
        console.warn("自動截圖失敗：", e);
    }

    if (typeof socket !== 'undefined') {
        socket.emit('violation', {
            name: myName,
            type: reason || 'AI 偵測異常',
            image: snapImg
        });
    }
};

// 更新上方狀態列
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

// 核心攔截器
const originalFetch = window.fetch;
window.fetch = async function() {
    if (arguments[0] === '/api/save-focus') {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('standalone') === 'true') {
            try {
                let options = arguments[1];
                let body = JSON.parse(options.body);
                body.roomType = 'flip-mode'; 
                options.body = JSON.stringify(body);
                arguments[1] = options;
            } catch(e) { }
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

    updateTutorStatus('normal', '連線穩定，AI 觀測中');

    const overlay = document.getElementById('startOverlay');
    if (overlay) {
        overlay.classList.remove('flex');
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
    }

    const inputGoal = document.getElementById('inputGoal');
    const inputTime = document.getElementById('inputTime');
    const inputName = document.getElementById('inputName');

    if (inputGoal) { 
        inputGoal.value = urlParams.get('goal') || "跟隨導師排程"; 
        inputGoal.dispatchEvent(new Event('input', { bubbles: true })); 
    }
    if (inputTime) { 
        inputTime.value = urlParams.get('duration') || "120"; 
        inputTime.dispatchEvent(new Event('input', { bubbles: true })); 
    }
    if (inputName) {
        inputName.value = urlParams.get('username') || localStorage.getItem('studyVerseUser') || "特約學員";
        inputName.dispatchEvent(new Event('input', { bubbles: true }));
    }

    window.addEventListener('load', () => {
        setTimeout(() => {
            const startBtn = document.getElementById('startBtn');
            if (startBtn) startBtn.click();

            if (isStandalone) {
                const myName = inputName ? inputName.value : '未知學員';
                if (typeof socket !== 'undefined') {
                    socket.emit('update_status', { name: myName, isStandalone: true });
                }
                
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
            }
        }, 500);
    });

    if (typeof socket !== 'undefined') {
        socket.on('update_rank', (users) => {
            const standaloneUsers = users.filter(u => u.isStandalone).map(u => u.name);
            
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

        socket.on('update_blackboard', (data) => {
            const blackboard = document.getElementById('blackboardContent') || document.getElementById('studentBlackboard');
            if (blackboard) {
                blackboard.innerText = data.message;
                const boardContainer = document.getElementById('blackboard');
                if (boardContainer) {
                    boardContainer.classList.add('shadow-[0_0_30px_rgba(245,158,11,0.6)]');
                    setTimeout(() => {
                        boardContainer.classList.remove('shadow-[0_0_30px_rgba(245,158,11,0.6)]');
                    }, 2000);
                }
            }
        });

        socket.on('receive_tutor_announcement', (data) => {
            const overlay = document.getElementById('speaker-overlay');
            const textEl = document.getElementById('speaker-text'); 
            const msg = data.message || data.text || "請注意導師廣播！";

            if (overlay) {
                if (textEl) textEl.innerText = msg;
                overlay.style.display = 'flex';
                overlay.style.visibility = 'visible';
                overlay.style.opacity = '1';
                overlay.style.zIndex = '99999';
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                
                if (!window.activeBroadcastAudio) {
                    window.activeBroadcastAudio = new Audio('/sounds/chime.mp3'); 
                    window.activeBroadcastAudio.loop = true; 
                }
                
                const playPromise = window.activeBroadcastAudio.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        overlay.classList.add('animate-pulse');
                        setTimeout(() => overlay.classList.remove('animate-pulse'), 4000);
                    });
                }
            } else {
                alert("🔊 導師廣播：" + msg);
            }
        });

        const handleWarning = (data) => {
            const myStudentName = document.getElementById('inputName') ? document.getElementById('inputName').value : '';
            if (data.targetName === myStudentName) {
                document.body.style.transition = "box-shadow 0.1s ease-in-out";
                document.body.style.boxShadow = "inset 0 0 120px 30px rgba(220, 38, 38, 0.95)";
                setTimeout(() => { document.body.style.boxShadow = "none"; }, 3000);

                if (!window.activeWarningAudio) {
                    window.activeWarningAudio = new Audio('/sounds/alert.mp3');
                    window.activeWarningAudio.loop = true; 
                }
                window.activeWarningAudio.currentTime = 0; 
                const playWarning = window.activeWarningAudio.play();
                if (playWarning !== undefined) {
                    playWarning.catch(e => console.log('警示聲播放被阻擋:', e));
                }

                if (typeof window.triggerViolation === 'function') {
                    window.triggerViolation(`【嚴重警告】${data.reason}\n⚠️ 此違規已永久寫入系統紀錄，無法撤銷。`);
                }
            }
        };

        socket.on('receive_warning', handleWarning);
        socket.on('receive_tutor_warning', handleWarning);

        socket.on('receive_task', (data) => {
            const myStudentName = document.getElementById('inputName') ? document.getElementById('inputName').value : '';
            if (data.targetName === myStudentName) { 
                alert(`📝 導師指派專屬任務：\n${data.task}`);
            }
        });

        // 📢 接收老師發送的文字版課表
        socket.on('receive_tutor_schedule', (data) => {
            const container = document.getElementById('studentScheduleContainer');
            const textEl = document.getElementById('studentScheduleText');
            if (container && textEl) {
                textEl.innerText = data.message;
                container.classList.remove('hidden'); 
            }
        });
    }

    setTimeout(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const room = urlParams.get('room') || urlParams.get('roomId');
        if (room && typeof socket !== 'undefined') {
            socket.emit('request_tutor_timer_sync', room);
        }
    }, 1500);
});

// ============================================================================
// 🚀 VIP 專屬：監聽來自 ai-core.js 的違規廣播
// ============================================================================
document.addEventListener('CameraViolation', (e) => {
    const { name, reason } = e.detail; 
    let snapImg = null;
    try {
        const videoElementObj = document.querySelector('video'); 
        if (videoElementObj && videoElementObj.readyState === 4) {
            const canvas = document.createElement('canvas');
            canvas.width = videoElementObj.videoWidth;
            canvas.height = videoElementObj.videoHeight;
            canvas.getContext('2d').drawImage(videoElementObj, 0, 0, canvas.width, canvas.height);
            snapImg = canvas.toDataURL('image/jpeg', 0.5); 
        }
    } catch (error) {}

    if (typeof socket !== 'undefined') {
        socket.emit('violation', { name: name, type: reason, image: snapImg });
    }
});

document.addEventListener('TabSwitchedViolation', (e) => {
    const { name } = e.detail;
    if (typeof socket !== 'undefined') {
        socket.emit('tab_switched', { name: name });
        socket.emit('violation', { name: name, type: '🚫 切換分頁 (離開自習室畫面)', image: null });
    }
});

function forceHideBreakButton() {
    const allButtons = document.querySelectorAll('button');
    allButtons.forEach(btn => {
        if (btn.innerText.includes('休息') || btn.textContent.includes('休息')) {
            btn.classList.add('hidden');
            btn.style.display = 'none';
        }
    });
}

// ============================================================================
// 🚨 終極修正版：完全複製教師端的「文字解析自動排程」引擎
// ============================================================================

// 1. 完全照抄老師的文字讀取邏輯
function getStudentLiveScheduleConfig() {
    const displayExt = document.getElementById('studentScheduleText')?.innerText || "";
    
    let config = {
        totalPeriods: 3,
        classDuration: 20 * 60,
        breakDuration: 10 * 60,
        startTime: new Date().getTime(),
        isValid: false 
    };

    const timeMatch = displayExt.match(/(\d{2}):(\d{2})~/);
    if (timeMatch) {
        const startDay = new Date();
        startDay.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        config.startTime = startDay.getTime();
        config.isValid = true; 
    }

    const periodMatch = displayExt.match(/分 (\d+) 節課/);
    const durationMatch = displayExt.match(/每節課 (\d+) 分鐘/);
    const breakMatch = displayExt.match(/休息 (\d+) 分鐘/);

    if (periodMatch) config.totalPeriods = parseInt(periodMatch[1]);
    if (durationMatch) config.classDuration = parseInt(durationMatch[1]) * 60;
    if (breakMatch) config.breakDuration = parseInt(breakMatch[1]) * 60;

    return config;
}

let studentAutoTimerInterval = null;

// 2. 啟動計時器 (每秒執行)
function initStudentAutoTimer() {
    if (studentAutoTimerInterval) clearInterval(studentAutoTimerInterval);
    studentAutoTimerInterval = setInterval(updateStudentTimerLogic, 1000);
    updateStudentTimerLogic();
}

// 3. 核心計時邏輯 (已解決「最後一節課不休息」的問題)
function updateStudentTimerLogic() {
    const SESSION_CONFIG = getStudentLiveScheduleConfig();
    
    if (!SESSION_CONFIG.isValid) {
        updateStudentTimerUI("00:00", "等待排程", "未開始", 0);
        return;
    }

    const now = new Date().getTime();
    const elapsedSeconds = Math.floor((now - SESSION_CONFIG.startTime) / 1000);
    
    if (elapsedSeconds < 0) {
        updateStudentTimerUI("00:00", "準備上課", "未開始", 0);
        return;
    }

    const cycleDuration = SESSION_CONFIG.classDuration + SESSION_CONFIG.breakDuration;
    const currentCycle = Math.floor(elapsedSeconds / cycleDuration);
    const timeInCycle = elapsedSeconds % cycleDuration;
    
    let currentPeriod = currentCycle + 1;

    // 🔥 修正 1：如果已經超過總節數，直接結束
    if (currentPeriod > SESSION_CONFIG.totalPeriods) {
        updateStudentTimerUI("00:00", "課程結束", "已結束", 100);
        return;
    }

    // 🔥 修正 2：如果到了「最後一節課」的「上課時間結束點」，直接判定「已結束」，跳過最後的休息時間！
    if (currentPeriod === SESSION_CONFIG.totalPeriods && timeInCycle >= SESSION_CONFIG.classDuration) {
        updateStudentTimerUI("00:00", "課程結束", "已結束", 100);
        return;
    }

    let periodName = "";
    let remainingTime = 0;
    let isBreak = false;
    let progress = 0;

    if (timeInCycle < SESSION_CONFIG.classDuration) {
        isBreak = false;
        periodName = `第 ${currentPeriod} 節課`;
        remainingTime = SESSION_CONFIG.classDuration - timeInCycle;
        progress = (timeInCycle / SESSION_CONFIG.classDuration) * 100;
    } else {
        isBreak = true;
        periodName = `第 ${currentPeriod} 節休息`;
        remainingTime = cycleDuration - timeInCycle;
        progress = ((timeInCycle - SESSION_CONFIG.classDuration) / SESSION_CONFIG.breakDuration) * 100;
    }

    const mins = Math.floor(remainingTime / 60).toString().padStart(2, '0');
    const secs = (remainingTime % 60).toString().padStart(2, '0');
    const timeString = `${mins}:${secs}`;

    updateStudentTimerUI(timeString, periodName, isBreak ? "休息中" : "進行中", progress);
}

// 4. 更新學生端專屬 VIP 琥珀金 UI (配合新的 html ID 樣式)
function updateStudentTimerUI(time, label, status, progress) {
    const timerDisplay = document.getElementById('studentTimerDisplay');
    const periodLabel = document.getElementById('studentPeriodLabel');
    const statusBadge = document.getElementById('studentStatusBadge');
    const progressBar = document.getElementById('studentProgressBar');

    if (timerDisplay) {
        timerDisplay.innerText = time;
        if (status === "進行中") {
            timerDisplay.classList.add('text-red-400');
            timerDisplay.classList.remove('text-emerald-400', 'text-white');
        } else if (status === "休息中") {
            timerDisplay.classList.add('text-emerald-400');
            timerDisplay.classList.remove('text-red-400', 'text-white');
        } else {
            timerDisplay.classList.add('text-white');
            timerDisplay.classList.remove('text-red-400', 'text-emerald-400');
        }
    }
    
    if (periodLabel) periodLabel.innerText = label;
    
    if (statusBadge) {
        statusBadge.innerText = status;
        if (status === "休息中") {
            statusBadge.className = "text-[10px] bg-emerald-900/30 text-emerald-400 px-2.5 py-1 rounded-md border border-emerald-500/30 font-bold uppercase tracking-widest shadow-sm";
        } else if (status === "進行中") {
            statusBadge.className = "text-[10px] bg-red-900/30 text-red-400 px-2.5 py-1 rounded-md border border-red-500/30 font-bold uppercase tracking-widest shadow-sm";
        } else {
            statusBadge.className = "text-[10px] bg-gray-800/80 text-gray-400 px-2.5 py-1 rounded-md border border-gray-700 font-bold uppercase tracking-widest shadow-sm";
        }
    }
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        progressBar.className = status === "休息中" 
            ? "h-full bg-emerald-500 transition-all duration-1000 relative shadow-[0_0_10px_rgba(16,185,129,0.5)]" 
            : "h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-1000 relative shadow-[0_0_10px_rgba(245,158,11,0.5)]";
    }
}

// 5. 確保網頁載入後，無條件啟動監測迴圈！
document.addEventListener('DOMContentLoaded', () => {
    initStudentAutoTimer();
});