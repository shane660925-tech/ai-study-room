/**
 * StudyVerse V2.2.4 - 翻轉自習室邏輯 (flip.js)
 * 新增：靜音臥底戰術 - 解決手機蓋住時，計時結束無法自動播放音樂的問題
 */
document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. 動態建立音效資源
    // ==========================================
    const alarmAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3'); 
    alarmAudio.loop = true; 
    
    // 小當家音樂
    const successAudio = new Audio('/audio/chuuka.mp3'); 
    successAudio.loop = true; 

    // 【防禦機制 A】：全域音效解鎖器 (0 音量永動機戰術)
    let isAudioUnlocked = false;
    function unlockAudio() {
        if (isAudioUnlocked) return;
        isAudioUnlocked = true;
        
        // 【關鍵修改】：把音量設為 0 並直接播放，絕對不呼叫 pause()！
        // 讓瀏覽器認定這個網頁「一直都在播放音樂」，權限就不會過期
        alarmAudio.volume = 0;
        alarmAudio.play().catch(() => {});
        
        successAudio.volume = 0;
        successAudio.play().catch(() => {});

        // 解鎖後即可移除監聽
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    }
    // 只要學生手指摸到螢幕任何一處，立刻啟動背景 0 音量永動機
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('click', unlockAudio);

    // 【防禦機制 B】：螢幕喚醒鎖定 (Wake Lock API)
    let wakeLock = null;
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('✅ 螢幕喚醒鎖定已啟動，防止計時器休眠');
            }
        } catch (err) {
            console.error('Wake Lock 錯誤:', err);
        }
    }
    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().then(() => wakeLock = null).catch(console.error);
        }
    }
    // 【黑科技補充】：當頁面可見度改變（例如跳出通知或切換APP）時，Wake Lock 會被系統自動釋放
    // 必須在此時重新請求，確保防休眠持續有效
    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });

    // ==========================================
    // 新增：自訂彈窗 UI (取代會凍結系統音效的 alert)
    // ==========================================
    function showCustomModal(title, text, callback) {
        // 暫停陀螺儀監聽，避免重複觸發
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
    // 2. 動態建立 5 秒警告 UI 覆蓋層
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
    const targetMinutes = parseInt(urlParams.get('duration') || localStorage.getItem('studyVerseDuration') || 25);
    const targetSeconds = targetMinutes * 60; 
    let isCompleted = false; 

    const savedName = localStorage.getItem('studyVerseUser');
    if (savedName && syncNameInput) syncNameInput.value = savedName;

    // ==========================================
    // 4. 單機模式自動啟動追蹤
    // ==========================================
    // ==========================================
    // 4. 單機模式啟動邏輯 (點擊解鎖 + 蓋下才計時)
    // ==========================================
    if (urlParams.get('standalone') === 'true') {
        myName = localStorage.getItem('studyVerseUser') || "專注者"; 
        
        // 1. 確保設定區塊（或開始按鈕）有顯示，讓學生可以點擊
        if(setupArea) setupArea.classList.remove('hidden'); 
        
        // 如果你有一個單機模式專用的開始按鈕，或者是共用 startBtn
        if(startBtn) {
            // 覆蓋原本的監聽器或新增單機邏輯
            startBtn.addEventListener('click', () => {
                // 2. 學生點擊了！立刻解鎖音效 (0 音量永動機啟動)
                unlockAudio(); 

                // 3. 進入「武裝狀態」但還不開始倒數
                isTracking = true; 
                isFocusing = false; // 關鍵！確保不會立刻觸發警告
                focusSeconds = 0;
                isCompleted = false;

                if(timerDisplay) timerDisplay.textContent = formatTime(targetSeconds);
                if(setupArea) setupArea.classList.add('hidden'); 
                if(stopBtn) stopBtn.classList.remove('hidden');
                
                // 4. 提示學生現在可以把手機蓋下了
                if(statusDisplay) {
                    statusDisplay.textContent = `✅ 音效已解鎖！請將手機螢幕朝下以開始計時...`; 
                    statusDisplay.style.color = "#3498db";
                }

                // 啟動陀螺儀監聽
                window.addEventListener('deviceorientation', handleOrientation);
            }, { once: true }); // 確保只綁定一次
        }
    }

    socket.on('force_status_sync', (data) => {
        if (data.isFlipped) {
            if (!isTracking) {
                myName = syncNameInput?.value.trim() || localStorage.getItem('studyVerseUser');
                if (myName) startTracking();
            }
        }
    });

    function formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    // 檢查是否達成目標的函數
    // 檢查是否達成目標的函數
    function checkCompletion() {
        if (focusSeconds >= targetSeconds && !isCompleted) {
            isCompleted = true;
            
            // 【黑科技發動】：因為音樂這 25 分鐘都在背景以 0 音量無限循環
            // 現在我們只需要把進度條拉回開頭，並把音量開到最大！完全不需要呼叫 .play()
            successAudio.currentTime = 0;
            successAudio.volume = 1.0; 
            
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
                        username: myName,
                        roomType: 'flip-mode', 
                        focusSeconds: focusSeconds,
                        status: statusType 
                    })
                });
            } catch (error) { console.error("儲存失敗:", error); }
        }
        window.location.href = '/flip-room.html'; 
    }

    if(startBtn) {
        startBtn.addEventListener('click', async () => {
            myName = syncNameInput.value.trim();
            if (!myName) { alert("請輸入暱稱以進行 AI 教室連動！"); return; }
            localStorage.setItem('studyVerseUser', myName);
            
            unlockAudio(); // 若有點擊按鈕，直接解鎖音效

            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceOrientationEvent.requestPermission();
                    if (permissionState === 'granted') { startTracking(); } 
                    else { alert('需要陀螺儀權限才能連動喔！'); }
                } catch (error) { console.error(error); }
            } else { startTracking(); }
        });
    }

    function startTracking() {
        isTracking = true; 
        focusSeconds = 0;
        isCompleted = false;
        
        if(timerDisplay) timerDisplay.textContent = formatTime(targetSeconds);
        
        if(setupArea) setupArea.classList.add('hidden'); 
        if(stopBtn) stopBtn.classList.remove('hidden');
        if(statusDisplay) {
            statusDisplay.textContent = `✅ 已就緒，目標：${targetMinutes} 分鐘，請將螢幕朝下`; 
            statusDisplay.style.color = "#3498db";
        }
        if(syncBadge) {
            syncBadge.textContent = `● 已與 ${myName} 的 AI 教室連動`;
            syncBadge.classList.add('sync-active');
        }

        const currentTeamId = urlParams.get('teamId') || null;
        socket.emit("join_room", { name: myName, goal: "手機同步模式", teamId: currentTeamId });
        socket.emit("update_status", { name: myName, isFlipped: false });

        window.addEventListener('deviceorientation', handleOrientation);
    }

    function stopTracking() {
        isTracking = false; isFocusing = false; isWarningState = false; 
        clearInterval(timerInterval); clearInterval(warningCountdownInterval); 
        alarmAudio.pause();
        releaseWakeLock(); // 解除防休眠
        
        const overlay = document.getElementById('warningOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }
        
        window.removeEventListener('deviceorientation', handleOrientation);
        if(setupArea) setupArea.classList.remove('hidden'); 
        if(stopBtn) stopBtn.classList.add('hidden');
        if(syncBadge) {
            syncBadge.classList.remove('sync-active');
            syncBadge.textContent = "未連動 AI 教室";
        }
        if(statusBox) statusBox.classList.remove('is-flipped');
        socket.emit("update_status", { name: myName, isFlipped: false });
    }

    function handleOrientation(event) {
        if (!isTracking) return;
        const beta = event.beta;
        const gamma = event.gamma;
        const isFaceDown = (Math.abs(beta) > 165 || Math.abs(beta) < 15) && Math.abs(gamma) < 25 && beta < 0;

        if (isFaceDown) {
            if (isWarningState) {
                // 及時蓋回：解除警報
                clearInterval(warningCountdownInterval);
                isWarningState = false;
                
                // 警報聲停止
                alarmAudio.volume = 0;
                
                document.getElementById('warningOverlay').classList.add('hidden');
                document.getElementById('warningOverlay').classList.remove('flex');
                document.body.style.backgroundColor = "#051a10"; 
                
                if(statusDisplay) {
                    statusDisplay.textContent = "✅ 已恢復專注，繼續計時";
                    statusDisplay.style.color = "#2ecc71";
                }
                socket.emit("update_status", { name: myName, status: "FOCUSED", isFlipped: true });
            } 
            else if (!isFocusing) {
                isFocusing = true;
                requestWakeLock(); // 開始專注時啟動防休眠
                
                if(statusBox) statusBox.classList.add('is-flipped');
                document.body.style.backgroundColor = "#051a10"; 
                socket.emit("update_status", { name: myName, status: "FOCUSED", isFlipped: true });
                
                const targetRoom = urlParams.get('targetRoom');
                if (targetRoom) {
                    if (navigator.vibrate) navigator.vibrate(200);
                    setTimeout(() => {
                        const currentParams = new URLSearchParams(window.location.search);
                        currentParams.delete('targetRoom');
                        window.location.href = `/${targetRoom}?${currentParams.toString()}`;
                    }, 1200);
                }

                clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    if (!isWarningState && !isCompleted) {
                        focusSeconds++;
                        const remain = targetSeconds - focusSeconds;
                        if(timerDisplay) timerDisplay.textContent = formatTime(remain > 0 ? remain : 0);
                        checkCompletion(); 
                    }
                }, 1000);
            }
        } else {
            // 手機被拿起來了
            
            // 情況 1：已經達標完成了！
            if (isCompleted) {
                const aiSuccessComments = [
                    `【AI 總結】太棒了 ${myName}！你展現了驚人的專注力，完美抵擋了手機的誘惑！`,
                    `【AI 總結】任務達成！這段時間的深度學習將成為你邁向卓越的基石。`,
                    `【AI 總結】完美的一擊！你的意志力堅不可摧，系統已為您記錄本次光榮的專注。`
                ];
                const comment = aiSuccessComments[Math.floor(Math.random() * aiSuccessComments.length)];
                
                const text = `🏆 挑戰成功！\n\n${comment}\n\n本次實際專注時長：${formatTime(focusSeconds)}\n系統即將為您結算並返回大廳。`;
                
                showCustomModal("發光吧！目標達成！", text, () => {
                    // 點擊確定後才關閉音樂、結算並跳轉
                    successAudio.pause();
                    successAudio.currentTime = 0;
                    stopTracking();
                    executeCheckout('completed');
                });
            }
            // 情況 2：還沒達標 (啟動國家級警報)
            else if (isFocusing && !isWarningState) {
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
                
                // 警報正式播放
                // 警報正式大作 (因為本來就在播，所以只要把音量調回最大)
                alarmAudio.currentTime = 0;
                alarmAudio.volume = 1.0;
                if (navigator.vibrate) navigator.vibrate([800, 400, 800, 400, 800, 400]); 

                clearInterval(warningCountdownInterval);
                warningCountdownInterval = setInterval(async () => {
                    warningSeconds--;
                    document.getElementById('warningNumber').textContent = warningSeconds;
                    
                    if (navigator.vibrate) navigator.vibrate([500, 200]);

                    if (warningSeconds <= 0) {
                        clearInterval(warningCountdownInterval);
                        
                        const aiFailComments = [
                            `【AI 總結】定力嚴重不足！禁不起手機的誘惑，本次專注宣告失敗。`,
                            `【AI 總結】太可惜了！只差一點點就能完成任務，您的意志力需要再多加鍛鍊。`,
                            `【AI 總結】手機的吸引力顯然大於你的目標，系統已將您強制退房。`
                        ];
                        const comment = aiFailComments[Math.floor(Math.random() * aiFailComments.length)];
                        
                        const text = `🚨 專注中斷！\n\n${comment}\n\n懲罰：記早退一次，即將返回大廳。`;
                        
                        showCustomModal("違規退房", text, () => {
                            // 退房前也要把音樂強制關閉
                            successAudio.pause();
                            successAudio.currentTime = 0;
                            stopTracking(); 
                            executeCheckout('early_leave');
                        });
                    }
                }, 1000);
            }
        }
    }
});