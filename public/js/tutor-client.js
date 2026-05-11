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

// 🚀 新增：音效狀態鎖與前次狀態紀錄 (音效物件將在計時器內動態載入)
window.hasPlayedStartAudio = false; 
window.previousClassStatus = null;  

// 保險起見，宣告全域 AI 暫停變數，準備與計時器連動
if (typeof window.isAIPaused === 'undefined') window.isAIPaused = false;

// ==========================================
// 🚀 新增：電腦端主動倒數全域變數與邏輯
// ==========================================
// 紀錄手機最後一次回報的狀態（預設為 true 代表蓋上）
window.currentPhoneFlipped = true; 
window.desktopWarningTimer = null;
window.desktopWarningCount = 5;

// === 電腦端主動倒數邏輯 ===
window.startDesktopCountdown = function() {
    // 如果已經在倒數中，就不重複觸發
    if (window.desktopWarningTimer) return; 
    
    window.desktopWarningCount = 5;
    
    console.log("⚠️ 電腦端啟動強制倒數！");
    const overlay = document.getElementById('flipWarningOverlay');
    const alertSound = document.getElementById('alertSound');
    if (overlay) overlay.classList.remove('hidden');
    if (alertSound) {
        alertSound.currentTime = 0;
        alertSound.play().catch(e => console.log('音效播放被阻擋', e));
    }

    window.desktopWarningTimer = setInterval(() => {
        window.desktopWarningCount--;
        
        console.log(`倒數: ${window.desktopWarningCount}`);
        const warningNum = document.getElementById('warningNum');
        if (warningNum) warningNum.innerText = window.desktopWarningCount;
        
        if (window.desktopWarningCount <= 0) {
            window.stopDesktopCountdown();
            
            // 🚨 倒數結束，電腦端主動判定違規！
            const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '未知學員';
            
            // 同步寫入結算扣分
            if (typeof window.totalViolationCount !== 'undefined') window.totalViolationCount++;
            if (typeof window.violationDetails !== 'undefined') {
                window.violationDetails["📱 手機翻轉中斷"] = (window.violationDetails["📱 手機翻轉中斷"] || 0) + 1;
            }

            if (typeof socket !== 'undefined' && socket.connected) {
                // 發送踢出指令給伺服器，並通知大廳
                socket.emit('flip_failed', { name: myName });
                socket.emit('violation', { 
                    name: myName, 
                    type: '🚨 翻轉中斷 (強制踢出教室)', 
                    image: null 
                });
            }
            
            setTimeout(async () => {
                alert("🚨 嚴重違規！您已被強制登出教室！");
                if (typeof window.endSession === 'function') {
                    await window.endSession();
                } else {
                    window.location.href = 'index.html';
                }
            }, 100);
        }
    }, 1000);
};

window.stopDesktopCountdown = function() {
    if (window.desktopWarningTimer) {
        clearInterval(window.desktopWarningTimer);
        window.desktopWarningTimer = null;
        
        console.log("✅ 手機已蓋回，取消電腦端倒數");
        const overlay = document.getElementById('flipWarningOverlay');
        const alertSound = document.getElementById('alertSound');
        if (overlay) overlay.classList.add('hidden');
        if (alertSound) {
            alertSound.pause();
            alertSound.currentTime = 0;
        }
    }
};

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
    image: snapImg,
    roomId: getTutorRoomCode()
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

    const roomCode = urlParams.get('room') || urlParams.get('roomId'); 
if (typeof socket !== 'undefined') {
    if (roomCode) {
        socket.emit('join_room', roomCode);

        const tutorName =
            urlParams.get('username') ||
            localStorage.getItem('studyVerseUser') ||
            document.getElementById('inputName')?.value ||
            '特約學員';

        socket.emit('join_tutor_room', {
            username: tutorName,
            roomId: roomCode,
            deviceType: 'pc',
            role: 'student'
        });

        console.log(`🚪 特約學生已加入房間: ${roomCode} / ${tutorName}`);
    }

        // 🚀 新增：攔截手機的即時狀態
        socket.on('update_status', (data) => {
            const myName = document.getElementById('inputName')?.value || localStorage.getItem('studyVerseUser');
            if (data.name === myName && data.isFlipped !== undefined) {
                // 更新電腦端認知的「手機狀態」
                window.currentPhoneFlipped = data.isFlipped;
                
                if (!window.isAIPaused && !window.currentPhoneFlipped) {
                    // 情境 A：正在上課中，學生卻把手機翻開 -> 立刻啟動電腦端倒數
                    if (typeof window.startDesktopCountdown === 'function') window.startDesktopCountdown();
                } else if (window.currentPhoneFlipped) {
                    // 情境 B：學生乖乖把手機蓋回去了 -> 停止電腦端倒數
                    if (typeof window.stopDesktopCountdown === 'function') window.stopDesktopCountdown();
                }
            }
        });
    }

    function getTutorRoomCode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || params.get('roomId') || window.currentTutorRoomCode || null;
}

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

        socket.on('student_feedback', (data) => {
            const myUsername = document.getElementById('inputName') ? document.getElementById('inputName').value : localStorage.getItem('studyVerseUser');
            
            if (data.target === myUsername) { 
                const iconUI = document.createElement('div');
                iconUI.className = "fixed inset-0 flex items-center justify-center z-[9999] pointer-events-none";
                
                if (data.type === 'thumb_up') {
                    iconUI.innerHTML = `<div class="text-[15rem] text-green-500 drop-shadow-[0_0_40px_#22c55e] animate-ping"><i class="fas fa-thumbs-up"></i></div>`;
                    new Audio('/sounds/cheer.mp3').play().catch(e => console.log('音效播放被阻擋', e)); 
                } else if (data.type === 'cross') {
                    iconUI.innerHTML = `<div class="text-[15rem] text-red-500 drop-shadow-[0_0_40px_#ef4444] animate-ping"><i class="fas fa-times"></i></div>`;
                    new Audio('/sounds/wrong.mp3').play().catch(e => console.log('音效播放被阻擋', e)); 
                }

                document.body.appendChild(iconUI);

                setTimeout(() => {
                    iconUI.remove();
                }, 3000);
            }
        });

        socket.on('receive_tutor_schedule', (data) => {
            const container = document.getElementById('studentScheduleContainer');
            const textEl = document.getElementById('studentScheduleText');
            if (container && textEl) {
                textEl.innerText = data.message;
                container.classList.remove('hidden'); 
            }
        });

        const handleTutorBroadcast = (data) => {
            const messageText = typeof data === 'string' ? data : data.message;

            try {
                const alertSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                alertSound.volume = 0.7;
                const playPromise = alertSound.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => console.warn("音效播放被阻擋"));
                }
            } catch(e) {}

            const uniqueId = 'vip-marquee-' + Date.now();
            document.querySelectorAll('.tutor-marquee-container').forEach(el => el.remove());

            const container = document.createElement('div');
            container.id = uniqueId;
            container.className = 'tutor-marquee-container'; 
            container.style.position = 'fixed';
            container.style.top = '90px';        
            container.style.right = '30px';      
            container.style.left = 'auto';       
            container.style.transform = 'none';  
            container.style.width = 'calc(100vw - 360px)'; 
            container.style.maxWidth = 'none';  
            container.style.height = '60px'; 
            container.style.zIndex = '9999';
            container.style.overflow = 'hidden';
            container.style.background = 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)'; 
            container.style.border = '2px solid #FDE047';        
            container.style.boxShadow = '0 8px 25px rgba(234, 88, 12, 0.4)'; 
            container.style.color = '#FFFFFF';                  
            container.style.borderRadius = '12px';
            container.style.padding = '0 20px'; 
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.gap = '15px';
            container.style.transition = 'opacity 0.5s ease';

            let avatarUrl = "https://api.dicebear.com/7.x/avataaars/svg?seed=Teacher&backgroundColor=b6e3f4"; 
            if (messageText.includes('怪獸')) {
                avatarUrl = "https://api.dicebear.com/7.x/bottts/svg?seed=monster&backgroundColor=ffdfbf";
            } else if (messageText.includes('熊')) {
                avatarUrl = "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f43b.svg";
            } else if (messageText.includes('突擊') || messageText.includes('檢查')) {
                avatarUrl = "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f47b.svg"; 
            } else if (messageText.includes('系統') || messageText.includes('監控')) {
                avatarUrl = "https://api.dicebear.com/7.x/avataaars/svg?seed=Jocelyn&backgroundColor=c0aede"; 
            }

            const avatarImg = document.createElement('img');
            avatarImg.src = avatarUrl;
            avatarImg.style.width = '45px';
            avatarImg.style.height = '45px';
            avatarImg.style.borderRadius = '50%';
            avatarImg.style.background = 'rgba(255,255,255,0.2)';
            avatarImg.style.padding = '4px';
            avatarImg.style.flexShrink = '0';
            avatarImg.style.zIndex = '10';
            avatarImg.alt = 'Avatar';

            const textWrapper = document.createElement('div');
            textWrapper.style.flex = '1';
            textWrapper.style.position = 'relative';
            textWrapper.style.height = '100%';
            textWrapper.style.overflow = 'hidden';

            const scrollingText = document.createElement('div');
            scrollingText.innerText = messageText;
            scrollingText.style.position = 'absolute';
            scrollingText.style.whiteSpace = 'nowrap';
            scrollingText.style.fontSize = '1.2rem';
            scrollingText.style.fontWeight = 'bold';
            scrollingText.style.letterSpacing = '1px';
            scrollingText.style.display = 'flex';
            scrollingText.style.alignItems = 'center';
            scrollingText.style.height = '100%';
            
            const animationDuration = 10000; 
            scrollingText.animate([
                { left: '100%', transform: 'translateX(0)' },
                { left: '0', transform: 'translateX(-100%)' }
            ], {
                duration: animationDuration,
                easing: 'linear',
                fill: 'forwards' 
            });

            textWrapper.appendChild(scrollingText);
            container.appendChild(avatarImg);
            container.appendChild(textWrapper);
            document.body.appendChild(container);

            setTimeout(() => {
                if (document.body.contains(container)) {
                    container.style.opacity = '0';
                    setTimeout(() => container.remove(), 500); 
                }
            }, animationDuration);
        };

        socket.on('tutor_broadcast', handleTutorBroadcast);
        socket.on('receive_tutor_patrol', handleTutorBroadcast);
        socket.on('tutor_patrol', handleTutorBroadcast);

        // 監聽來自伺服器或本地的翻轉警告
        socket.on('trigger_flip_warning', (data) => {
            // 🛑 【豁免機制】休息時間不處理任何手機翻轉警告或踢出倒數
            if (window.isAIPaused) {
                const overlay = document.getElementById('flipWarningOverlay');
                if (overlay) overlay.classList.add('hidden');
                const alertSound = document.getElementById('alertSound');
                if (alertSound) {
                    alertSound.pause();
                    alertSound.currentTime = 0;
                }
                return;
            }

            const myUsername = document.getElementById('inputName') ? document.getElementById('inputName').value : localStorage.getItem('studyVerseUser');
            if (data.name === myUsername || data.name === window.myUsername) {
                const overlay = document.getElementById('flipWarningOverlay');
                const alertSound = document.getElementById('alertSound');
                
                if (data.isFlipped) {
                    overlay.classList.remove('hidden');
                    if(alertSound) alertSound.play().catch(e => console.log('音效播放被阻擋', e));
                } else {
                    overlay.classList.add('hidden');
                    if(alertSound) {
                        alertSound.pause();
                        alertSound.currentTime = 0;
                    }
                }
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

// 🚀 VIP 專屬：監聽來自 ai-core.js 的違規廣播
window.isLeaveSeatActive = false; // 離座鎖定狀態

document.addEventListener('CameraViolation', (e) => {
    // 🛑 【豁免機制】如果是休息時間，無視所有鏡頭違規 (離座、趴睡、手機)
    if (window.isAIPaused) return;

    const { name, reason } = e.detail; 

    if (reason.includes("離座")) {
        if (window.isLeaveSeatActive) return; 
        
        window.isLeaveSeatActive = true;
        
        if (typeof window.totalViolationCount !== 'undefined') window.totalViolationCount++;
        if (typeof window.violationDetails !== 'undefined') {
            window.violationDetails["🪑 偵測離座"] = (window.violationDetails["🪑 偵測離座"] || 0) + 1;
        }

        showLeaveSeatModal(); 
        
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
            const leaveTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            socket.emit('violation', { 
                name: name, 
                type: `🪑 離座 (離位時間: ${leaveTime} / 尚未回位)`, 
                image: snapImg 
            });
        }
        return; 
    }

    if (typeof window.totalViolationCount !== 'undefined') window.totalViolationCount++;
    if (typeof window.violationDetails !== 'undefined') {
        if (reason.includes("手機")) {
            window.violationDetails["📱 使用手機"] = (window.violationDetails["📱 使用手機"] || 0) + 1;
        } else if (reason.includes("趴睡")) {
            window.violationDetails["💤 偵測趴睡"] = (window.violationDetails["💤 偵測趴睡"] || 0) + 1;
        } else {
            window.violationDetails[reason] = (window.violationDetails[reason] || 0) + 1;
        }
    }

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
        socket.emit('violation', {
    name: name,
    type: reason,
    image: snapImg,
    roomId: getTutorRoomCode()
});
    }
});

window.handleReturnSeat = function() {
    const modal = document.getElementById('leaveSeatModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    
    window.isLeaveSeatActive = false; 
    
    const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '未知學員';
    if (typeof socket !== 'undefined') {
        const returnTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        socket.emit('violation', { 
    name: myName, 
    type: `【更新狀態】學生已回位 (回位時間: ${returnTime})`, 
    image: null,
    roomId: getTutorRoomCode()
});
    }
};

function showLeaveSeatModal() {
    let modal = document.getElementById('leaveSeatModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'leaveSeatModal';
        modal.className = 'fixed inset-0 z-[99999] bg-black/95 flex flex-col items-center justify-center backdrop-blur-lg transition-opacity duration-300';
        modal.innerHTML = `
            <div class="text-center animate-pulse">
                <i class="fas fa-chair text-7xl text-red-500 mb-6 drop-shadow-[0_0_20px_rgba(239,68,68,0.8)]"></i>
                <h1 class="text-4xl sm:text-5xl font-black text-white mb-4 tracking-widest text-red-500">偵測到離座，請立即回位！</h1>
                <p class="text-gray-400 text-lg sm:text-xl mb-10">您的離座狀態已被記錄並同步給導師，<br>請盡速返回座位並點擊下方按鈕。</p>
            </div>
            <button onclick="handleReturnSeat()" class="px-10 py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full text-2xl shadow-[0_0_30px_rgba(239,68,68,0.5)] transition-transform transform hover:scale-105 active:scale-95 border-2 border-red-400">
                <i class="fas fa-check-circle mr-2"></i> 我已回位
            </button>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

document.addEventListener('TabSwitchedViolation', (e) => {
    // 🛑 【豁免機制】休息時間切換分頁，不計違規
    if (window.isAIPaused) return;

    const { name } = e.detail;
    
    if (typeof window.totalViolationCount !== 'undefined') window.totalViolationCount++;
    if (typeof window.violationDetails !== 'undefined') {
        window.violationDetails["🚫 切換分頁"] = (window.violationDetails["🚫 切換分頁"] || 0) + 1;
    }

    if (typeof socket !== 'undefined') {
        socket.emit('tab_switched', {
    name: name,
    roomId: getTutorRoomCode()
});

socket.emit('violation', {
    name: name,
    type: '🚫 切換分頁 (離開自習室畫面)',
    image: null,
    roomId: getTutorRoomCode()
});
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

function initStudentAutoTimer() {
    if (studentAutoTimerInterval) clearInterval(studentAutoTimerInterval);
    studentAutoTimerInterval = setInterval(updateStudentTimerLogic, 1000);
    updateStudentTimerLogic();
}

function updateStudentTimerLogic() {
    const SESSION_CONFIG = getStudentLiveScheduleConfig();
    
    if (!SESSION_CONFIG.isValid) {
        window.isAIPaused = true; // 排程未開始前也豁免
        updateStudentTimerUI("00:00", "等待排程", "未開始", 0);
        return;
    }

    const now = new Date().getTime();
    const elapsedSeconds = Math.floor((now - SESSION_CONFIG.startTime) / 1000);
    
    if (elapsedSeconds < 0) {
        let currentStatus = "未開始";
        window.isAIPaused = true; // 排程未開始前豁免
        
        if (!window.classStartAudio) window.classStartAudio = new Audio('/sounds/countdown.mp3');

        if (elapsedSeconds === -3 && !window.hasPlayedStartAudio) {
            window.classStartAudio.currentTime = 0;
            window.classStartAudio.play().catch(e => console.warn("音效播放被阻擋:", e));
            window.hasPlayedStartAudio = true;
        }

        if (window.previousClassStatus !== currentStatus) {
            window.previousClassStatus = currentStatus;
            if (elapsedSeconds < -3) window.hasPlayedStartAudio = false; 
        }

        updateStudentTimerUI("00:00", "準備上課", currentStatus, 0);
        return;
    }

    const cycleDuration = SESSION_CONFIG.classDuration + SESSION_CONFIG.breakDuration;
    const currentCycle = Math.floor(elapsedSeconds / cycleDuration);
    const timeInCycle = elapsedSeconds % cycleDuration;
    
    let currentPeriod = currentCycle + 1;

    const isCourseEnded = currentPeriod > SESSION_CONFIG.totalPeriods || 
                          (currentPeriod === SESSION_CONFIG.totalPeriods && timeInCycle >= SESSION_CONFIG.classDuration);

    if (isCourseEnded) {
        window.isAIPaused = true; // 課程結束後豁免
        updateStudentTimerUI("00:00", "課程結束", "已結束", 100);
        
        if (!window.hasAutoEnded && typeof window.endSession === 'function') {
            window.hasAutoEnded = true; 
            
            if (!window.classEndAudio) window.classEndAudio = new Audio('/sounds/class_end.mp3');
            window.classEndAudio.currentTime = 0;
            window.classEndAudio.play().catch(e => console.warn("音效播放被阻擋:", e));

            setTimeout(() => {
                alert("🎉 本次特約教室的所有課程已結束！即將為您產生專注結算報告...");
                window.endSession(); 
            }, 1000);
        }
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

    let currentStatus = isBreak ? "休息中" : "進行中";

    // 取得前一秒的休息狀態
    const previousPauseState = window.isAIPaused;
    // 🌟🌟🌟 核心豁免權開關：只有「進行中」才嚴格取締！
    window.isAIPaused = (currentStatus === "休息中");

    // 🚀 新增突擊檢查：如果從「休息」切換成「上課」的瞬間，手機還是朝上的！
    if (previousPauseState === true && window.isAIPaused === false) {
        if (!window.currentPhoneFlipped) {
            // 無視手機端有沒有切回網頁，電腦端直接強制開始倒數！
            if (typeof window.startDesktopCountdown === 'function') window.startDesktopCountdown();
        }
    }

    // 🚀 新增：每秒同步 AI 暫停狀態給手機端，確保手機知道現在是不是休息時間
    if (typeof socket !== 'undefined' && socket.connected) {
        const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '未知學員';
        socket.emit('mobile_sync_update', { 
            type: 'PAUSE_STATE_CHANGED', 
            studentName: myName, 
            isPaused: window.isAIPaused 
        });
    }

    // 貼心機制：如果上課時被「離座彈窗」擋住，打鐘下課時自動幫學生解除彈窗
    if (window.isAIPaused && window.isLeaveSeatActive && typeof window.handleReturnSeat === 'function') {
        window.handleReturnSeat();
    }

    if (!window.classStartAudio) window.classStartAudio = new Audio('/sounds/countdown.mp3');
    if (!window.classEndAudio) window.classEndAudio = new Audio('/sounds/class_end.mp3');

    if (currentStatus === "休息中" && remainingTime === 3 && !window.hasPlayedStartAudio) {
        window.classStartAudio.currentTime = 0;
        window.classStartAudio.play().catch(e => console.warn("音效播放被瀏覽器阻擋:", e));
        window.hasPlayedStartAudio = true; 
    }

    if (window.previousClassStatus !== currentStatus) {
        if (window.previousClassStatus === "進行中" && currentStatus === "休息中") {
            window.classEndAudio.currentTime = 0;
            window.classEndAudio.play().catch(e => console.warn("音效播放被瀏覽器阻擋:", e));
            window.hasPlayedStartAudio = false; 
        }
        
        if (currentStatus === "進行中") {
            window.hasPlayedStartAudio = false;
            
            // 剛開始上課，主動檢查手機是否還沒蓋回去，並執行本地追殺倒數 (備用保險)
            if (typeof window.triggerPendingMobileWarning === 'function') {
                window.triggerPendingMobileWarning();
            }
        }
        
        window.previousClassStatus = currentStatus;
    }

    updateStudentTimerUI(timeString, periodName, currentStatus, progress);
}

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

document.addEventListener('DOMContentLoaded', () => {
    initStudentAutoTimer();
});