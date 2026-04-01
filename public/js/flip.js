/**
 * StudyVerse V2.2.4 - 翻轉自習室邏輯 (flip.js)
 * 修正：回歸正規「白名單解鎖」機制，避免長時間靜音播放被系統判定為耗電而強制休眠
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
        
        // 正規解鎖法：播放後「立刻暫停」，這樣瀏覽器就會將這個音效加入信任白名單
        // 時間到的時候，就算沒有點擊也能直接呼叫 play()
        alarmAudio.play().then(() => {
            alarmAudio.pause();
            alarmAudio.currentTime = 0;
        }).catch(() => {});
        
        successAudio.play().then(() => {
            successAudio.pause();
            successAudio.currentTime = 0;
        }).catch(() => {});

        // 解鎖後即可移除監聽
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    }
    // 只要學生手指摸到螢幕任何一處，立刻解鎖音效權限
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
            wakeLock.release().then(() => wakeLock = null);
        }
    }

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
    // 4. 單機模式：強制點擊啟動 (解決 iOS 無聲與 UX 問題)
    // ==========================================
    if (urlParams.get('standalone') === 'true') {
        myName = localStorage.getItem('studyVerseUser') || "專注者"; 
        
        // 建立一個全螢幕的「準備畫面」
        const readyOverlay = document.createElement('div');
        readyOverlay.id = 'readyOverlay';
        readyOverlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:#051a10;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;padding:20px;text-align:center;";
        readyOverlay.innerHTML = `
            <i class="fas fa-mobile-alt text-6xl mb-6 text-green-400 animate-bounce"></i>
            <h1 style="font-size:28px;font-weight:900;margin-bottom:15px;">準備進入單機專注</h1>
            <p style="font-size:16px;color:#a7f3d0;margin-bottom:40px;">點擊下方按鈕解鎖防護系統<br>隨後將手機螢幕朝下放置桌上，即會開始計時。</p>
            <button id="tapToStartBtn" style="background:linear-gradient(to right, #10b981, #059669);color:white;padding:15px 40px;border-radius:30px;font-size:20px;font-weight:bold;border:none;cursor:pointer;box-shadow:0 10px 20px rgba(16,185,129,0.3);">我準備好了</button>
        `;
        document.body.appendChild(readyOverlay);

        document.getElementById('tapToStartBtn').addEventListener('click', () => {
            // 1. 真人點擊的瞬間：立刻解鎖音效！這對 iOS Safari 來說是最合法的操作
            alarmAudio.play().then(() => {
                alarmAudio.pause();
                alarmAudio.currentTime = 0;
            }).catch(e => console.log('解鎖警報音效失敗:', e));
            
            successAudio.play().then(() => {
                successAudio.pause();
                successAudio.currentTime = 0;
            }).catch(e => console.log('解鎖成功音效失敗:', e));

            // 2. 請求螢幕防休眠
            requestWakeLock();

            // 3. 移除準備畫面
            readyOverlay.remove();

            // 4. 開始追蹤陀螺儀 (此時 isFocusing 仍是 false，不會響警報)
            if (!isTracking) {
                startTracking(); 
                
                if (statusDisplay) {
                    statusDisplay.textContent = `✅ 系統已啟動：請將手機螢幕朝下放置以開始計時`;
                    statusDisplay.style.color = "#3498db";
                }
            }
        });
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
    function checkCompletion() {
        if (focusSeconds >= targetSeconds && !isCompleted) {
            isCompleted = true;
            
            // 確保音樂從頭開始播放
            successAudio.currentTime = 0;
            const playPromise = successAudio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.log('音樂被瀏覽器阻擋:', e);
                });
            }
            
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
            
            unlockAudio(); // 點擊按鈕時解鎖音效！

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
                
                // 停止警報
                alarmAudio.pause();
                alarmAudio.currentTime = 0;
                
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
                // 如果音樂在背景被阻擋，當學生翻開手機時補刀再次強制播放！
                successAudio.play().catch(e => console.log('補發播放失敗:', e));

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
                
                // 播放警報
                alarmAudio.currentTime = 0;
                alarmAudio.play().catch(e => console.log('Alarm play failed:', e));
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