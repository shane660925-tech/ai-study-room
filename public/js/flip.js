/**
 * StudyVerse V2.3.0 - 翻轉自習室邏輯 (flip.js)
 * 終極進化版：導入 Web Audio API 徹底擊潰 iOS 阻擋機制、加入核彈級跳轉護盾消除所有殘影
 */
document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. 遊戲級 Web Audio API 引擎 (破解 iOS 休眠)
    // ==========================================
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    const audioBuffers = {};
    const activeSources = {};

    // 背景非同步預載音效檔轉為 Buffer
    async function loadAudio(name, url) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            audioBuffers[name] = audioBuffer;
        } catch (e) { console.error(`音效 ${name} 載入失敗:`, e); }
    }

    // 載入我們的三大音效
    loadAudio('coin', 'https://www.myinstants.com/media/sounds/mario-coin.mp3');
    loadAudio('alarm', 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3');
    loadAudio('success', '/audio/chuuka.mp3');

    // 播放音效函數 (具備最高系統特權)
    function playSound(name, loop = false) {
        if (!audioBuffers[name]) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        stopSound(name); // 確保不會重複疊加播放
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffers[name];
        source.loop = loop;
        source.connect(audioCtx.destination);
        source.start(0);
        activeSources[name] = source;
    }

    // 停止音效函數
    function stopSound(name) {
        if (activeSources[name]) {
            try { activeSources[name].stop(); } catch(e){}
            delete activeSources[name];
        }
    }

    // 🚀 極短的無聲空白音訊 (輔助保持 iOS 音訊通道永遠活著)
    const silentAudio = new Audio('data:audio/mp3;base64,//MkxAAQAAAAAAAAAAAAAAAAAAAAAAAWQQhwAANAA0QQAACsMAAAAB4AA/8oAAgAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA//IAAgAAAAD/8gACAAAAAP/yAAIAAAAA');
    silentAudio.loop = true;
    silentAudio.setAttribute('playsinline', '');
    document.body.appendChild(silentAudio);

    // 【防禦機制 A】：音效引擎解鎖器
    let isAudioUnlocked = false;
    function unlockAudio() {
        if (isAudioUnlocked) return;
        isAudioUnlocked = true;
        
        // 喚醒 Web Audio 引擎
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        // 播放無聲音軌
        silentAudio.play().catch(() => {});

        // 瞬間播放並暫停實體音效，取得傳統授權
        const tempCoin = new Audio('https://www.myinstants.com/media/sounds/mario-coin.mp3');
        tempCoin.play().then(() => tempCoin.pause()).catch(() => {});

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
    
    window.isCheckingOut = false; // 防護鎖：標記是否正在準備跳轉退房

    // 先抓網址上的參數，沒有再抓本機快取，最後才給預設值
    const urlParams = new URLSearchParams(window.location.search);
    let myName = urlParams.get('name') || localStorage.getItem('studyVerseUser') || "學員";

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
        const inputNameEl = document.getElementById('inputName');
        // 【修正核心】：只有當 inputName 元素存在且有填寫時才覆蓋名字，否則維持 URL 或 localStorage 抓到的名字
        if (inputNameEl && inputNameEl.value.trim() !== "") {
            myName = inputNameEl.value.trim();
        } 

        isTracking = false; 
        isFocusing = false; 
        window.hasStartedFocus = false; 
        window.isCheckingOut = false;

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

        const setupArea = document.getElementById('setup-area');
        if(setupArea) setupArea.classList.add('hidden');

        document.getElementById('finalStartBtn').addEventListener('click', async () => {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceOrientationEvent.requestPermission();
                    if (permissionState !== 'granted') {
                        alert("請允許「動作與方向」存取權限，系統才能偵測手機翻轉喔！");
                        return; 
                    }
                } catch (error) { console.error("陀螺儀權限請求失敗:", error); }
            }

            unlockAudio();
            if (typeof requestWakeLock === 'function') requestWakeLock();

            document.getElementById('modalStep1').classList.add('hidden');
            document.getElementById('modalStep1').classList.remove('flex');
            document.getElementById('modalStep2').classList.remove('hidden');
            document.getElementById('modalStep2').classList.add('flex');

            isTracking = true;
            window.addEventListener('deviceorientation', handleOrientation);
        });
    }

    async function executeCheckout(statusType) {
        window.isCheckingOut = true; 
        
        // 🛡️ 核彈級跳轉護盾：徹底癱瘓頁面，注入全螢幕覆蓋層，杜絕任何殘影閃爍與雜音
        const nukeStyle = document.createElement('style');
        nukeStyle.innerHTML = `
            body * { visibility: hidden !important; pointer-events: none !important; }
            #checkoutNuke, #checkoutNuke * { visibility: visible !important; pointer-events: auto !important; }
            #warningOverlay, .warning-overlay, .ai-warning-box, .ai-bubble { display: none !important; }
        `;
        document.head.appendChild(nukeStyle);

        const nukeDiv = document.createElement('div');
        nukeDiv.id = 'checkoutNuke';
        nukeDiv.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:#051a10;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#10b981;font-size:20px;font-weight:bold;";
        nukeDiv.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:40px;margin-bottom:20px;"></i><p>結算中，請稍候...</p>';
        document.body.appendChild(nukeDiv);

        // 停止所有傳統音訊
        document.querySelectorAll('audio, video').forEach(media => {
            media.muted = true;
            media.pause();
        });

        stopTracking(); // 強制停止 Web Audio 與計時器

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
        
        stopSound('alarm');
        stopSound('success');
        silentAudio.pause();
        releaseWakeLock();
        
        window.removeEventListener('deviceorientation', handleOrientation);
    }

    // ==========================================
    // 5. 改進的翻轉偵測邏輯
    // ==========================================
    function handleOrientation(event) {
        // 如果不在追蹤中，或「已經進入結算跳轉流程」，絕對停止所有動作！
        if (!isTracking || window.isCheckingOut) return;
        
        let beta = event.beta;
        let gamma = event.gamma;
        
        const isFaceDown = (beta > 135 || beta < -135) && Math.abs(gamma) < 45;

        if (isFaceDown) {
            if (!window.hasStartedFocus) {
                window.hasStartedFocus = true; 
                isFocusing = true; 
                requestWakeLock(); 

                const startModal = document.getElementById('standaloneReadyModal');
                if (startModal) startModal.remove();

                // Web Audio API 播放金幣聲
                playSound('coin', false);

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
                        
                        // 🚀 達成預定時間
                        if (focusSeconds >= targetSeconds && !isCompleted) {
                            isCompleted = true;
                            
                            // 🛑 核心防禦：時間一到，立刻「拔除違規偵測神經」，徹底杜絕所有跳轉殘影！
                            window.removeEventListener('deviceorientation', handleOrientation);
                            isTracking = false; 

                            // Web Audio API 播放小當家音樂 (無視系統休眠，強制響起！)
                            playSound('success', true);
                            
                            if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]); 
                            if(statusDisplay) {
                                statusDisplay.textContent = "🎉 恭喜達標！請將手機翻轉朝上以完成自習";
                                statusDisplay.style.color = "#f1c40f";
                            }

                            // 領獎專用監聽器 (只等翻上來，絕不會觸發任何違規)
                            window.addEventListener('deviceorientation', function checkFlipUp(e) {
                                if (window.isCheckingOut) return;
                                let b = e.beta; let g = e.gamma;
                                const faceDown = (b > 135 || b < -135) && Math.abs(g) < 45;
                                
                                if (!faceDown) {
                                    window.removeEventListener('deviceorientation', checkFlipUp);
                                    
                                    const aiSuccessComments = [
                                        `【AI 總結】太棒了 ${myName}！你展現了驚人的專注力！`,
                                        `【AI 總結】完美的一擊！這段時間的深度學習將成為你的基石。`
                                    ];
                                    const comment = aiSuccessComments[Math.floor(Math.random() * aiSuccessComments.length)];
                                    const text = `🏆 挑戰成功！\n\n${comment}\n\n本次時長：${formatTime(focusSeconds)}\n請點擊確定進行結算並返回大廳。`;
                                    
                                    showCustomModal("發光吧！目標達成！", text, () => {
                                        stopSound('success'); // 按下確定後，立刻將音樂關閉並跳轉
                                        executeCheckout('completed');
                                    });
                                }
                            });
                        }
                    }
                }, 1000);

            } else if (isWarningState) {
                // 及時蓋回：解除警報繼續計時
                clearInterval(warningCountdownInterval);
                isWarningState = false;
                
                // 停止警報聲
                stopSound('alarm');
                
                const wOverlay = document.getElementById('warningOverlay');
                if(wOverlay) {
                    wOverlay.classList.add('hidden');
                    wOverlay.classList.remove('flex'); 
                }
                document.body.style.backgroundColor = "#051a10"; 
                
                if(statusDisplay) {
                    statusDisplay.textContent = "✅ 已恢復專注，繼續計時";
                    statusDisplay.style.color = "#2ecc71";
                }
                socket.emit("update_status", { name: myName, status: "FOCUSED", isFlipped: true });
            }
        } else {
            // 手機被拿起來了 (未達標中途放棄)
            if (isFocusing && !isWarningState && !isCompleted) {
                isWarningState = true;
                warningSeconds = 5; 
                
                const wOverlay = document.getElementById('warningOverlay');
                wOverlay.classList.remove('hidden');
                wOverlay.classList.add('flex'); 
                document.getElementById('warningNumber').textContent = warningSeconds;
                
                socket.emit("update_status", { name: myName, status: "DISTRACTED", isFlipped: false });
                
                // 🚀 播放強烈警告聲
                playSound('alarm', true);
                
                if (navigator.vibrate) navigator.vibrate([800, 400]); 

                clearInterval(warningCountdownInterval);
                warningCountdownInterval = setInterval(() => {
                    warningSeconds--;
                    document.getElementById('warningNumber').textContent = warningSeconds;
                    if (navigator.vibrate) navigator.vibrate([500, 200]);
                    
                    if (warningSeconds <= 0) {
                        clearInterval(warningCountdownInterval);
                        
                        // 🚀 核心修復：強制鎖死狀態，防止彈窗期間再蓋回手機復活！
                        window.isCheckingOut = true; 
                        isTracking = false;
                        window.removeEventListener('deviceorientation', handleOrientation);

                        // 🚀 觸發大廳的社會性死亡事件！
                        socket.emit("flip_failed", { name: myName });

                        showCustomModal("違規退房", `🚨 專注中斷！\n\n定力不足，系統已將您強制退房。`, () => {
                            stopSound('alarm'); 
                            executeCheckout('early_leave');
                        });
                    }
                }, 1000);
            }
        }
    }
});