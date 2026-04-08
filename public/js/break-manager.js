/**
 * StudyVerse - 休息狀態管理器 (break-manager.js)
 * 負責掌管：休息選單、休息倒數、UI 渲染、提示音效、暫停/恢復主計時器
 */

class BreakManagerClass {
    constructor() {
        this.breakSecondsRemaining = 0;
        this.breakInterval = null;
        this.isBreaking = false;
        this.soundPlayed = false;

        // 建立專屬的音效物件 (提醒學生快休息完了)
        this.alertAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        this.alertAudio.volume = 0.8;

        // 初始化時，自動在畫面上注入專用的休息 UI 容器
        this.initUIContainer();
    }

    /**
     * 在 body 底部注入專屬的休息畫面容器 (避免修改 HTML 檔案)
     */
    initUIContainer() {
        if (document.getElementById('breakManagerOverlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'breakManagerOverlay';
        overlay.className = 'fixed inset-0 bg-[#05070a]/95 backdrop-blur-xl z-[10005] hidden flex-col items-center justify-center text-white';
        document.body.appendChild(overlay);
    }

    /**
     * 1. 顯示休息時間選擇選單 (由 StudyTimer 解鎖後的按鈕觸發)
     */
    showBreakMenu() {
        const overlay = document.getElementById('breakManagerOverlay');
        overlay.innerHTML = `
            <div class="bg-[#111827] p-10 rounded-3xl border border-gray-800 shadow-[0_0_50px_rgba(217,119,6,0.15)] text-center max-w-md w-full transform transition-all scale-100">
                <i class="fas fa-mug-hot text-6xl text-amber-500 mb-6 drop-shadow-[0_0_15px_rgba(245,158,11,0.6)] animate-pulse"></i>
                <h2 class="text-3xl font-black mb-3 tracking-tight">選擇休息時間</h2>
                <p class="text-gray-400 mb-8 text-sm bg-gray-800/50 py-2 rounded-lg border border-gray-700/50">休息期間 AI 將暫停偵測違規行為<br>可自由離座、趴睡或使用手機</p>
                
                <div class="grid grid-cols-3 gap-4 mb-8">
                    <button onclick="window.BreakManager.startBreak(5, '短暫休息', '☕')" class="group bg-gray-900 hover:bg-amber-600 border border-gray-700 hover:border-amber-500 rounded-2xl py-5 transition-all duration-300 shadow-lg">
                        <div class="text-3xl font-black text-white group-hover:text-white transition-colors">5</div>
                        <div class="text-xs text-gray-500 group-hover:text-amber-100 mt-1 font-bold">分鐘</div>
                    </button>
                    <button onclick="window.BreakManager.startBreak(10, '一般休息', '☕')" class="group bg-gray-900 hover:bg-amber-600 border border-gray-700 hover:border-amber-500 rounded-2xl py-5 transition-all duration-300 shadow-lg">
                        <div class="text-3xl font-black text-white group-hover:text-white transition-colors">10</div>
                        <div class="text-xs text-gray-500 group-hover:text-amber-100 mt-1 font-bold">分鐘</div>
                    </button>
                    <button onclick="window.BreakManager.startBreak(15, '深度休息', '☕')" class="group bg-gray-900 hover:bg-amber-600 border border-gray-700 hover:border-amber-500 rounded-2xl py-5 transition-all duration-300 shadow-lg">
                        <div class="text-3xl font-black text-white group-hover:text-white transition-colors">15</div>
                        <div class="text-xs text-gray-500 group-hover:text-amber-100 mt-1 font-bold">分鐘</div>
                    </button>
                </div>
                
                <button onclick="window.BreakManager.cancelMenu()" class="text-gray-500 hover:text-white text-sm font-bold transition-colors">
                    <i class="fas fa-times mr-2"></i>取消，繼續讀書
                </button>
            </div>
        `;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }

    cancelMenu() {
        const overlay = document.getElementById('breakManagerOverlay');
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }

    /**
     * 2. 開始休息 (包含原有的洗手間/喝水，以及新的 5/10/15 分鐘)
     */
    startBreak(minutes, label, icon) {
        this.breakSecondsRemaining = minutes * 60;
        this.isBreaking = true;
        this.soundPlayed = false;

        // [核心連動]：呼叫 StudyTimer 暫停主計時器！
        if (window.StudyTimer) {
            window.StudyTimer.pause();
        }

        // [核心連動]：告訴未來的 ai-core 暫停抓違規！
        window.isAIPaused = true;

        // 渲染倒數畫面
        this.renderCountdownUI(label, icon);

        // 清除舊計時器並啟動新的
        if (this.breakInterval) clearInterval(this.breakInterval);
        this.breakInterval = setInterval(() => this.tick(label, icon), 1000);
    }

    /**
     * 3. 每秒倒數邏輯
     */
    tick(label, icon) {
        this.breakSecondsRemaining--;

        // [新功能]：時間剩下 1 分鐘 (60秒) 時發出聲響提醒
        if (this.breakSecondsRemaining === 60 && !this.soundPlayed) {
            this.playAlertSound();
            this.soundPlayed = true;
        }

        if (this.breakSecondsRemaining <= 0) {
            // 時間到，自動結束休息
            this.endBreak();
        } else {
            // 更新畫面時間
            this.updateCountdownUI();
        }
    }

    /**
     * 4. 結束休息，歸隊！
     */
    endBreak() {
        this.isBreaking = false;
        if (this.breakInterval) clearInterval(this.breakInterval);

        // 隱藏休息畫面
        this.cancelMenu();

        // [核心連動]：呼叫 StudyTimer 恢復主計時器，並重置 40 分鐘的冷卻計算！
        if (window.StudyTimer) {
            window.StudyTimer.resume();
            window.StudyTimer.resetContinuousFocus(); // 重新上鎖休息按鈕
        }

        // [核心連動]：告訴未來的 ai-core 恢復抓違規！
        window.isAIPaused = false;
        
        // （防呆）同步更新全域舊變數，確保跟舊版 ai-core 相容
        window.isPauseMode = false;
    }

    /**
     * 播放提醒音效
     */
    playAlertSound() {
        this.alertAudio.play().catch(err => console.log("音效播放被瀏覽器阻擋:", err));
        // 同時將畫面稍微閃爍提醒
        const timerDisplay = document.getElementById('breakTimerDisplay');
        if (timerDisplay) {
            timerDisplay.classList.add('text-red-500', 'animate-pulse');
            timerDisplay.classList.remove('text-blue-400');
        }
    }

    /**
     * 渲染倒數 UI
     */
    renderCountdownUI(label, icon) {
        const overlay = document.getElementById('breakManagerOverlay');
        overlay.innerHTML = `
            <div class="text-center flex flex-col items-center">
                <div class="animate-bounce mb-6 text-7xl drop-shadow-2xl">${icon}</div>
                <h2 class="text-4xl font-black mb-3 tracking-widest text-white">${label}中</h2>
                <p class="text-gray-400 mb-10 bg-gray-900/80 px-6 py-2 rounded-full border border-gray-700 font-bold tracking-wider">
                    <i class="fas fa-shield-alt text-green-500 mr-2"></i>AI 監測已暫停，請安心休息
                </p>
                
                <div id="breakTimerDisplay" class="text-[120px] leading-none font-mono text-blue-400 font-bold mb-16 drop-shadow-[0_0_30px_rgba(59,130,246,0.6)] transition-colors duration-500">
                    00:00
                </div>
                
                <button onclick="window.BreakManager.endBreak()" class="group px-12 py-5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-full text-xl font-black shadow-[0_0_30px_rgba(37,99,235,0.5)] transition-all active:scale-95 border border-blue-400/50">
                    <i class="fas fa-undo-alt mr-3 group-hover:-rotate-180 transition-transform duration-500"></i>我回來了，繼續專注
                </button>
            </div>
        `;
    }

    /**
     * 更新倒數數字
     */
    updateCountdownUI() {
        const display = document.getElementById('breakTimerDisplay');
        if (!display) return;
        
        const m = Math.floor(this.breakSecondsRemaining / 60).toString().padStart(2, '0');
        const s = (this.breakSecondsRemaining % 60).toString().padStart(2, '0');
        display.innerText = `${m}:${s}`;
    }
}

// 實例化並掛載到全域
window.BreakManager = new BreakManagerClass();

// ==========================================
// 為了相容現有的 HTML 按鈕 (洗手間/喝水)
// 攔截原本的 requestBreak 與 endBreak
// ==========================================
window.requestBreak = function(type) {
    if (type === 'toilet') window.BreakManager.startBreak(5, '洗手間', '🚽');
    if (type === 'water') window.BreakManager.startBreak(5, '喝水休息', '💧');
};

window.endBreak = function() {
    window.BreakManager.endBreak();
};