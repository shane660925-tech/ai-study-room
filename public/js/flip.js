/**
 * StudyVerse V2.2.5 - 翻轉自習室邏輯 (flip.js)
 * 修正：iOS 陀螺儀權限請求、增加翻轉容錯率、新增翻轉金幣聲與小當家結算流程
 */
document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. 動態建立音效資源 (加入金幣聲)
    // ==========================================
    const coinAudio = new Audio('https://www.myinstants.com/media/sounds/mario-coin.mp3');
    coinAudio.preload = 'auto';

    const alarmAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3'); 
    alarmAudio.loop = true; 
    alarmAudio.preload = 'auto'; 
    
    // 小當家音樂 (達成時間播放)
    const successAudio = new Audio('/audio/chuuka.mp3'); 
    successAudio.loop = true; 
    successAudio.preload = 'auto'; 

    // 【防禦機制 A】：白名單音效解鎖器
    let isAudioUnlocked = false;
    function unlockAudio() {
        if (isAudioUnlocked) return;
        isAudioUnlocked = true;
        
        // 快速播放並暫停，取得瀏覽器信任
        const audios = [coinAudio, alarmAudio, successAudio];
        audios.forEach(audio => {
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            }).catch(() => {});
        });

        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    }
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('click', unlockAudio);

    // 【防禦機制 B】：螢幕喚醒鎖定
    let wakeLock = null;
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) { console.error('Wake Lock 錯誤:', err); }
    }
    function releaseWakeLock() {
        if (wakeLock !== null) wakeLock.release().then(() => wakeLock = null);
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
    // 2. 建立 5 秒警告 UI (國家級警報)
    // ==========================================
    const warningOverlay = document.createElement('div');
    warningOverlay.id = 'warningOverlay';
    warningOverlay.innerHTML = `
        <style>
            @keyframes pulse-red { 0%, 100% { background-color: rgba(220, 38, 38, 0.98); } 50% { background-color: rgba(120, 0, 0, 0.98); } }
            .bg-flashing-red { animation: pulse-red 0.5s infinite; }
        </style>
        <div class="flex flex-col items-center justify-center h-full w-full bg-flashing-red backdrop-blur-md">
            <i class="fas fa-radiation text-8xl text-yellow-400 mb-6 animate-spin"></i>
            <h1 class="text-5xl font-black text-white mb-2 tracking-widest text-shadow-lg">嚴重違規警告</h1>
            <p class="text-yellow-200 text-xl mb-8 font-bold">國家級警報：請立刻將手機蓋回桌上！</p>
            <div class="w-48 h-48 bg-black/40 rounded-full flex items-center justify-center border-8 border-yellow-400">
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
    const statusDisplay = document.getElementById('status');
    const timerDisplay = document.getElementById('timer');
    const syncBadge = document.getElementById('sync-badge');
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

    function formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    // ==========================================
    // 4. 單機教室模式：雙階段彈窗與 iOS 權限請求
    // ==========================================
    if (urlParams.get('standalone') === 'true') {
        // 設定目標可不填，預設給予代號
        const inputNameEl = document.getElementById('inputName');
        myName = inputNameEl?.value.trim() || localStorage.getItem('studyVerseUser') || "游擊隊員"; 

        isTracking = false; 
        isFocusing = false; 
        window.hasStartedFocus = false; 

        // 建立雙階段彈窗
        const startModal = document.createElement('div');
        startModal.id = 'standaloneReadyModal';
        startModal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:#051a10;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;padding:20px;text-align:center;";
        startModal.innerHTML = `
            <div id="modalStep1" class="flex flex-col items-center">
                <i class="fas fa-door-open text-6xl mb-6 text-green-400 animate-bounce"></i>
                <h1 style="font-size:26px;font-weight:900;margin-bottom:15px;">已抵達單機專注室</h1>
                <p style="font-size:16px;color:#a7f3d0;margin-bottom:40px;">目標時長：${targetMinutes} 分鐘<br><br>準備好後請點擊下方按鈕解鎖，<br>隨後將手機翻轉蓋上，即會自動開始計時。</p>
                <button id="finalStartBtn" style="background:linear-gradient(to right, #10b981, #059669);color:white;padding:15px 40px;border-radius:30px;font-size:20px;font-weight:bold;border:none;cursor:pointer;box-shadow:0 10px 20px rgba(16,185,129,0.3);">🚀 我準備好了</button>
            </div>
            
            <div id="modalStep2" class="hidden flex-col items-center">
                <i class="fas fa-mobile-alt text-6xl mb-6 text-yellow-400 animate-pulse"></i>
                <h1 style="font-size:26px;font-weight:900;margin-bottom:15px; color:#f1c40f;">🟡 系統已就緒</h1>
                <p style="font-size:18px;color:#fef08a;font-weight:bold;margin-bottom:10px;">等待手機翻轉中...</p>
                <p style="font-size:14px;color:#a7f3d0;">請將手機螢幕朝下蓋在桌上<br>聽到「金幣聲」即代表成功開始計時</p>
            </div>
        `;
        document.body.appendChild(startModal);

        // 隱藏背後不必要的設定區塊
        const setupArea = document.getElementById('setup-area');
        if(setupArea) setupArea.classList.add('hidden');

        document.getElementById('finalStartBtn').addEventListener('click', async () => {
            // 🚨 核心修復：在此處向 iOS 請求陀螺儀權限
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceOrientationEvent.requestPermission();
                    if (permissionState !== 'granted') {
                        alert("請允許「動作與方向」存取權限，系統才能偵測手機翻轉喔！");
                        return; // 拒絕則停留在原地
                    }
                } catch (error) {
                    console.error("陀螺儀權限請求失敗:", error);
                }
            }

            unlockAudio();
            if (typeof requestWakeLock === 'function') requestWakeLock();

            // 切換為黃燈等待畫面
            document.getElementById('modalStep1').classList.add('hidden');
            document.getElementById('modalStep1').classList.remove('flex');
            document.getElementById('modalStep2').classList.remove('hidden');
            document.getElementById('modalStep2').classList.add('flex');

            // 啟動監聽陀螺儀
            isTracking = true;
            window.addEventListener('deviceorientation', handleOrientation);
        });
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
        window.location.href = '/index.html'; // 返回大廳
    }

    function stopTracking() {
        isTracking = false; isFocusing = false; isWarningState = false; 
        clearInterval(timerInterval); clearInterval(warningCountdownInterval); 
        alarmAudio.pause();
        releaseWakeLock();
        document.getElementById('warningOverlay').classList.add('hidden');
        window.removeEventListener('deviceorientation', handleOrientation);
        socket.emit("update_status", { name: myName, isFlipped: false });
    }

    // ==========================================
    // 5. 改進的翻轉偵測邏輯
    // ==========================================
    function handleOrientation(event) {
        if (!isTracking) return;
        let beta = event.beta;
        let gamma = event.gamma;
        
        // 🚨 擴大容錯率：放寬 beta 的角度 (超過135度即算)，並確保 gamma 不會因為側躺誤判
        const isFaceDown = (beta > 135 || beta < -135) && Math.abs(gamma) < 45;

        if (isFaceDown) {
            if (!window.hasStartedFocus) {
                // 🚀 第一次成功翻轉：播放金幣聲、移除彈窗、開始計時
                window.hasStartedFocus = true; 
                isFocusing = true; 
                requestWakeLock(); 

                const startModal = document.getElementById('standaloneReadyModal');
                if (startModal) startModal.remove();

                // 播放金幣聲
                coinAudio.play().catch(() => {});

                if (statusDisplay) {
                    statusDisplay.innerHTML = `🟢 深度專注中...`;
                    statusDisplay.style.color = "#10b981";
                }
                if(statusBox) statusBox.classList.add('is-flipped');
                document.body.style.backgroundColor = "#051a10"; 
                socket.emit("update_status", { name: myName, status: "FOCUSED", isFlipped: true });

                if(timerDisplay) timerDisplay.textContent = formatTime(targetSeconds);
                clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    if (!isWarningState && !isCompleted) {
                        focusSeconds++;
                        const remain = targetSeconds - focusSeconds;
                        if(timerDisplay) timerDisplay.textContent = formatTime(remain > 0 ? remain : 0);
                        
                        // 達成預定時間：播放小當家音樂
                        if (focusSeconds >= targetSeconds && !isCompleted) {
                            isCompleted = true;
                            successAudio.currentTime = 0;
                            successAudio.play().catch(e => console.log('音樂播放受阻', e));
                            if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]); 
                            if(statusDisplay) {
                                statusDisplay.textContent = "🎉 恭喜達標！請將手機翻轉朝上以完成自習";
                                statusDisplay.style.color = "#f1c40f";
                            }
                        }
                    }
                }, 1000);

            } else if (isWarningState) {
                // 及時蓋回：解除警報繼續計時
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
            // 手機被拿起來了 (螢幕朝上)
            if (isCompleted) {
                // 達成目標後翻上：給予總結
                successAudio.play().catch(() => {});
                const aiSuccessComments = [
                    `【AI 總結】太棒了 ${myName}！你展現了驚人的專注力！`,
                    `【AI 總結】完美的一擊！這段時間的深度學習將成為你的基石。`
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
                // 中途拿起：觸發國家級警報 + 震動
                isWarningState = true;
                warningSeconds = 5; 
                document.getElementById('warningOverlay').classList.remove('hidden');
                document.getElementById('warningOverlay').classList.add('flex');
                document.getElementById('warningNumber').textContent = warningSeconds;
                
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
                        showCustomModal("違規退房", `🚨 專注中斷！\n\n定力不足，系統已將您強制退房。`, () => {
                            stopTracking(); 
                            executeCheckout('early_leave');
                        });
                    }
                }, 1000);
            }
        }
    }
});