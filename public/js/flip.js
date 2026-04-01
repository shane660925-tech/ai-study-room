/**
 * StudyVerse V2.2.4 - 翻轉自習室邏輯 (flip.js)
 * 修正：新增等待翻轉的雙階段彈窗，並修復陀螺儀朝上誤判的問題
 */
document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. 動態建立音效資源
    // ==========================================
    const alarmAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3'); 
    alarmAudio.loop = true; 
    alarmAudio.preload = 'auto'; // 強制預先載入
    
    // 小當家音樂
    const successAudio = new Audio('/audio/chuuka.mp3'); 
    successAudio.loop = true; 
    successAudio.preload = 'auto'; // 強制預先載入

    // 【防禦機制 A】：白名單音效解鎖器
    let isAudioUnlocked = false;
    function unlockAudio() {
        if (isAudioUnlocked) return;
        isAudioUnlocked = true;
        
        alarmAudio.play().then(() => {
            alarmAudio.pause();
            alarmAudio.currentTime = 0;
        }).catch(() => {});
        
        successAudio.play().then(() => {
            successAudio.pause();
            successAudio.currentTime = 0;
        }).catch(() => {});

        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    }
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('click', unlockAudio);

    // 【防禦機制 B】：螢幕喚醒鎖定 (Wake Lock API)
    let wakeLock = null;
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('✅ 螢幕喚醒鎖定已啟動');
            }
        } catch (err) {
            console.error('Wake Lock 錯誤:', err);
        }
    }
    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().then(() => wakeLock = null);
        }
    }

    // ==========================================
    // 新增：自訂彈窗 UI
    // ==========================================
    function showCustomModal(title, text, callback) {
        window.removeEventListener('deviceorientation', handleOrientation); 

        const overlay = document.createElement('div');
        overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;backdrop-filter:blur(5px);";
        overlay.innerHTML = `
            <div style="background:#1e293b;padding:30px;border-radius:20px;color:white;width:100%;max-width:350px;border:2px solid #475569;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
                <h2 style="font-size:26px;color:#facc15;margin-bottom:15px;font-weight:900;">${title}</h2>
                <p style="font-size:16px;line-height:1.6;margin-bottom:25px;white-space:pre-wrap;text-align:left;">${text}</p>
                <button id="confirmBtn" style="width:100%;background:linear-gradient(to right, #eab308, #f97316);color:white;padding:15px;border-radius:12px;font-size:18px;font-weight:900;border:none;cursor:pointer;">確定完成</button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('confirmBtn').addEventListener('click', () => {
            overlay.remove();
            if(callback) callback();
        });
    }

    // ==========================================
    // 2. 動態建立 5 秒警告 UI
    // ==========================================
    const warningOverlay = document.createElement('div');
    warningOverlay.id = 'warningOverlay';
    warningOverlay.innerHTML = `
        <style>
            @keyframes pulse-red {
                0%, 100% { background-color: rgba(220, 38, 38, 0.98); }
                50% { background-color: rgba(120, 0, 0, 0.98); }
            }
            .bg-flashing-red { animation: pulse-red 0.5s infinite; }
        </style>
        <div class="flex flex-col items-center justify-center h-full w-full bg-flashing-red backdrop-blur-md">
            <i class="fas fa-radiation text-8xl text-yellow-400 mb-6 animate-spin"></i>
            <h1 class="text-5xl font-black text-white mb-2 tracking-widest text-shadow-lg">嚴重違規警告</h1>
            <p class="text-yellow-200 text-xl mb-8 font-bold">國家級警報：請立刻將手機蓋回桌上！</p>
            <div class="w-48 h-48 bg-black/40 rounded-full flex items-center justify-center border-8 border-yellow-400 shadow-[0_0_50px_rgba(250,204,21,0.8)]">
                <span id="warningNumber" class="text-8xl font-black text-yellow-400 drop-shadow-lg">5</span>
            </div>
        </div>
    `;
    warningOverlay.className = "fixed inset-0 z-[9999] hidden flex-col items-center justify-center transition-all duration-300";
    document.body.appendChild(warningOverlay);

    // ==========================================
    // 3. 核心變數宣告
    // ==========================================
    const socket = io(); 
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDisplay = document.getElementById('status');
    const timerDisplay = document.getElementById('timer');
    const syncBadge = document.getElementById('sync-badge');
    const setupArea = document.getElementById('setup-area');
    const syncNameInput = document.getElementById('syncName');
    const statusBox = document.getElementById('status-box');

    let isTracking = false;   
    let isFocusing = false;   
    let focusSeconds = 0;   
    let timerInterval;        
    let warningCountdownInterval;
    let warningSeconds = 5;
    let isWarningState = false;
    let myName = "";

    const urlParams = new URLSearchParams(window.location.search);
    let targetMinutes = parseInt(urlParams.get('duration') || localStorage.getItem('studyVerseDuration') || 25);
    const targetSeconds = targetMinutes * 60; 
    let isCompleted = false; 

    const savedName = localStorage.getItem('studyVerseUser');
    if (savedName && syncNameInput) syncNameInput.value = savedName;

    // ==========================================
    // 單機教室模式：載入即彈窗 -> 點擊變為黃燈 -> 翻轉後才移除彈窗
    // ==========================================
    if (urlParams.get('standalone') === 'true') {
        const inputNameEl = document.getElementById('inputName');
        myName = inputNameEl ? inputNameEl.value : (localStorage.getItem('studyVerseUser') || "專注者"); 
        targetMinutes = parseInt(urlParams.get('duration')) || 25;

        isTracking = false; 
        isFocusing = false; 
        isWarningState = false;
        window.hasStartedFocus = false; 

        // 建立「準備與等待」雙階段彈窗
        const startModal = document.createElement('div');
        startModal.id = 'standaloneReadyModal';
        startModal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:#051a10;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;padding:20px;text-align:center;";
        startModal.innerHTML = `
            <div id="modalStep1" class="flex flex-col items-center">
                <i class="fas fa-door-open text-6xl mb-6 text-green-400 animate-bounce"></i>
                <h1 style="font-size:26px;font-weight:900;margin-bottom:15px;">已抵達專屬座位</h1>
                <p style="font-size:16px;color:#a7f3d0;margin-bottom:40px;">目標：${targetMinutes} 分鐘<br><br>請點擊下方按鈕解鎖防護系統，<br>隨後將手機螢幕朝下放置，即會自動進入教室。</p>
                <button id="finalStartBtn" style="background:linear-gradient(to right, #10b981, #059669);color:white;padding:15px 40px;border-radius:30px;font-size:20px;font-weight:bold;border:none;cursor:pointer;box-shadow:0 10px 20px rgba(16,185,129,0.3);">🚀 開始專注</button>
            </div>
            
            <div id="modalStep2" class="hidden flex-col items-center">
                <i class="fas fa-wifi text-6xl mb-6 text-yellow-400 animate-pulse"></i>
                <h1 style="font-size:26px;font-weight:900;margin-bottom:15px; color:#f1c40f;">🟡 防護系統已啟動</h1>
                <p style="font-size:18px;color:#fef08a;font-weight:bold;margin-bottom:10px;">等待手機翻轉中...</p>
                <p style="font-size:14px;color:#a7f3d0;">請將手機螢幕朝下蓋在桌上<br>聽到「叮」聲即代表成功進入教室並開始倒數</p>
            </div>
        `;
        document.body.appendChild(startModal);

        if(setupArea) setupArea.classList.add('hidden');

        document.getElementById('finalStartBtn').addEventListener('click', () => {
            // 解鎖音效
            unlockAudio();
            if (typeof requestWakeLock === 'function') requestWakeLock();

            // 🚨 關鍵改變：不移除全螢幕彈窗，而是切換到黃燈等待畫面！
            document.getElementById('modalStep1').classList.add('hidden');
            document.getElementById('modalStep1').classList.remove('flex');
            document.getElementById('modalStep2').classList.remove('hidden');
            document.getElementById('modalStep2').classList.add('flex');

            if (statusDisplay) {
                statusDisplay.innerHTML = `🟡 已連線：等待翻轉螢幕以開始計時`;
                statusDisplay.style.color = "#f1c40f"; 
            }

            // 啟動監聽陀螺儀
            isTracking = true;
            window.addEventListener('deviceorientation', handleOrientation);
        });
    }

    socket.on('force_status_sync', (data) => {
        if (data.isFlipped && !isTracking) {
            myName = syncNameInput?.value.trim() || localStorage.getItem('studyVerseUser');
            if (myName) startTracking();
        }
    });

    function formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function checkCompletion() {
        if (focusSeconds >= targetSeconds && !isCompleted) {
            isCompleted = true;
            successAudio.currentTime = 0;
            successAudio.play().catch(e => console.log('音樂播放受阻', e));
            if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]); 
            if(statusDisplay) {
                statusDisplay.textContent = "🎉 恭喜達標！請翻開手機查看您的專屬評語";
                statusDisplay.style.color = "#f1c40f";
            }
        }
    }

    async function executeCheckout(statusType) {
        if (focusSeconds > 0) {
            try {
                await fetch('/api/save-focus', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: myName, roomType: 'flip-mode', 
                        focusSeconds: focusSeconds, status: statusType 
                    })
                });
            } catch (error) { console.error("儲存失敗:", error); }
        }
        window.location.href = '/flip-room.html'; 
    }

    if(startBtn) {
        startBtn.addEventListener('click', async () => {
            myName = syncNameInput.value.trim();
            if (!myName) { alert("請輸入暱稱！"); return; }
            localStorage.setItem('studyVerseUser', myName);
            unlockAudio();
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceOrientationEvent.requestPermission();
                    if (permissionState === 'granted') startTracking();
                } catch (error) { console.error(error); }
            } else { startTracking(); }
        });
    }

    function startTracking() {
        isTracking = true; focusSeconds = 0; isCompleted = false;
        window.hasStartedFocus = false; // 重設起始標記
        if(timerDisplay) timerDisplay.textContent = formatTime(targetSeconds);
        if(setupArea) setupArea.classList.add('hidden'); 
        if(stopBtn) stopBtn.classList.remove('hidden');
        if(statusDisplay) {
            statusDisplay.textContent = `✅ 已就緒，請將螢幕朝下開始計時`; 
            statusDisplay.style.color = "#3498db";
        }
        if(syncBadge) {
            syncBadge.textContent = `● 已與 ${myName} 的 AI 教室連動`;
            syncBadge.classList.add('sync-active');
        }
        socket.emit("join_room", { name: myName, goal: "手機同步模式" });
        window.addEventListener('deviceorientation', handleOrientation);
    }

    function stopTracking() {
        isTracking = false; isFocusing = false; isWarningState = false; 
        clearInterval(timerInterval); clearInterval(warningCountdownInterval); 
        alarmAudio.pause();
        releaseWakeLock();
        const overlay = document.getElementById('warningOverlay');
        if (overlay) overlay.classList.add('hidden');
        window.removeEventListener('deviceorientation', handleOrientation);
        if(setupArea) setupArea.classList.remove('hidden'); 
        if(stopBtn) stopBtn.classList.add('hidden');
        if(syncBadge) {
            syncBadge.classList.remove('sync-active');
            syncBadge.textContent = "未連動 AI 教室";
        }
        socket.emit("update_status", { name: myName, isFlipped: false });
    }

    // ==========================================
    // 4. 改進的 handleOrientation (核心邏輯)
    // ==========================================
    function handleOrientation(event) {
        if (!isTracking) return;
        let beta = event.beta;
        
        // 🚨 修正翻轉偵測邏輯：只有 beta 接近 180 或 -180 才算真正蓋在桌上！
        // (移除了原本會導致「朝上」被誤判的 Math.abs(beta) < 15 邏輯)
        const isFaceDown = (beta > 150 || beta < -150);

        if (isFaceDown) {
            // 🚀 按下按鈕後的第一次翻轉
            if (!window.hasStartedFocus) {
                window.hasStartedFocus = true; 
                isFocusing = true; 
                
                requestWakeLock(); 

                // 🚨 關鍵：真正翻轉後，才移除覆蓋全螢幕的黃燈等待彈窗，顯示出後方的教室！
                const startModal = document.getElementById('standaloneReadyModal');
                if (startModal) startModal.remove();

                // 播放叮一聲提示 (1秒後自動暫停)
                successAudio.play().then(() => {
                    setTimeout(() => {
                        successAudio.pause();
                        successAudio.currentTime = 0;
                    }, 1000); 
                }).catch(() => {});

                // 更新介面狀態：切換為綠燈
                if (statusDisplay) {
                    statusDisplay.innerHTML = `🟢 深度專注中...`;
                    statusDisplay.style.color = "#10b981";
                }
                if(statusBox) statusBox.classList.add('is-flipped');
                document.body.style.backgroundColor = "#051a10"; 
                socket.emit("update_status", { name: myName, status: "FOCUSED", isFlipped: true });

                // 啟動正式倒數計時器
                if(timerDisplay) timerDisplay.textContent = formatTime(targetSeconds);
                clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    if (!isWarningState && !isCompleted) {
                        focusSeconds++;
                        const remain = targetSeconds - focusSeconds;
                        if(timerDisplay) timerDisplay.textContent = formatTime(remain > 0 ? remain : 0);
                        checkCompletion(); 
                    }
                }, 1000);

            } else if (isWarningState) {
                // 及時蓋回：解除警報
                clearInterval(warningCountdownInterval);
                isWarningState = false;
                alarmAudio.pause();
                alarmAudio.currentTime = 0;
                
                document.getElementById('warningOverlay').classList.add('hidden');
                document.body.style.backgroundColor = "#051a10"; 
                
                if(statusDisplay) {
                    statusDisplay.textContent = "✅ 已恢復專注，繼續計時";
                    statusDisplay.style.color = "#2ecc71";
                }
                socket.emit("update_status", { name: myName, status: "FOCUSED", isFlipped: true });
            }
        } else {
            // 手機被拿起來了
            if (isCompleted) {
                successAudio.play().catch(() => {});
                const aiSuccessComments = [
                    `【AI 總結】太棒了 ${myName}！你展現了驚人的專注力！`,
                    `【AI 總結】任務達成！這段時間的深度學習將成為你的基石。`,
                    `【AI 總結】完美的一擊！你的意志力堅不可摧。`
                ];
                const comment = aiSuccessComments[Math.floor(Math.random() * aiSuccessComments.length)];
                const text = `🏆 挑戰成功！\n\n${comment}\n\n本次時長：${formatTime(focusSeconds)}\n即將返回大廳。`;
                
                showCustomModal("發光吧！目標達成！", text, () => {
                    successAudio.pause();
                    stopTracking();
                    executeCheckout('completed');
                });
            }
            else if (isFocusing && !isWarningState) {
                // 啟動警告
                isWarningState = true;
                warningSeconds = 5; 
                document.getElementById('warningOverlay').classList.remove('hidden');
                document.getElementById('warningOverlay').classList.add('flex');
                document.getElementById('warningNumber').textContent = warningSeconds;
                
                if(statusDisplay) {
                    statusDisplay.textContent = "⚠️ 警告：嚴重違規，請立刻蓋回手機！";
                    statusDisplay.style.color = "#e74c3c";
                }

                socket.emit("update_status", { name: myName, status: "DISTRACTED", isFlipped: false });
                alarmAudio.currentTime = 0;
                alarmAudio.play().catch(() => {});
                if (navigator.vibrate) navigator.vibrate([800, 400]); 

                clearInterval(warningCountdownInterval);
                warningCountdownInterval = setInterval(() => {
                    warningSeconds--;
                    document.getElementById('warningNumber').textContent = warningSeconds;
                    if (navigator.vibrate) navigator.vibrate([500, 200]);
                    if (warningSeconds <= 0) {
                        clearInterval(warningCountdownInterval);
                        const text = `🚨 專注中斷！\n\n定力不足，系統已將您強制退房。`;
                        showCustomModal("違規退房", text, () => {
                            stopTracking(); 
                            executeCheckout('early_leave');
                        });
                    }
                }, 1000);
            }
        }
    }
});