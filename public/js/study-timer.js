/**
 * StudyVerse - 計時器大腦 (study-timer.js)
 * 負責掌管：主專注時間倒數、連續專注時間(40分鐘解鎖休息)、右上角系統時鐘
 */

class StudyTimerManager {
    constructor() {
        // 時間狀態變數
        this.totalSeconds = 0;         // 總預定專注時間 (秒)
        this.remainingSeconds = 0;     // 剩餘專注時間 (秒)
        this.continuousSeconds = 0;    // 已連續專注時間 (秒) - 用來計算是否可休息
        this.isPaused = false;         // 是否處於暫停狀態
        
        // 計時器實體
        this.timerInterval = null;
        this.clockInterval = null;

        // 設定：多久可以解鎖一次休息？(測試時可以改成 1 * 60 也就是 1分鐘 方便測試，實際上線為 40 * 60)
        this.UNLOCK_BREAK_SECONDS = 40 * 60; 
    }

    /**
     * 啟動計時器 (由進入教室的 initApp 呼叫)
     * @param {number} minutes - 預計專注的分鐘數
     */
    start(minutes) {
        this.totalSeconds = minutes * 60;
        this.remainingSeconds = this.totalSeconds;
        this.continuousSeconds = 0;
        this.isPaused = false;

        // 啟動右上角時鐘
        this.startClock();

        // 清除舊的計時器避免重複疊加
        if (this.timerInterval) clearInterval(this.timerInterval);

        // 每 1 秒執行一次 tick 邏輯
        this.timerInterval = setInterval(() => {
            this.tick();
        }, 1000);
        
        // 初始化先更新一次畫面
        this.updateUI();
        this.checkBreakUnlock();
    }

    /**
     * 每一秒都會執行的核心時間推移邏輯
     */
    tick() {
        // 如果目前是暫停(休息)狀態，就不扣時間
        if (this.isPaused) return;

        this.remainingSeconds--;
        this.continuousSeconds++;

        this.updateUI();
        this.checkBreakUnlock();

        // 時間到！達成目標
        if (this.remainingSeconds <= 0) {
            this.completeSession();
        }
    }

    /**
     * 暫停計時 (當學生按下休息按鈕時呼叫)
     */
    pause() {
        this.isPaused = true;
    }

    /**
     * 恢復計時 (當學生休息完回來時呼叫)
     */
    resume() {
        this.isPaused = false;
    }

    /**
     * 休息完畢歸隊，重置連續專注時間，重新計算 40 分鐘的冷卻
     */
    resetContinuousFocus() {
        this.continuousSeconds = 0;
        this.checkBreakUnlock(); // 馬上把休息按鈕上鎖
    }

    /**
     * 檢查是否達到解鎖休息按鈕的條件，並更新 UI
     */
    checkBreakUnlock() {
        const breakBtn = document.getElementById('breakBtn');
        if (!breakBtn) return;

        if (this.continuousSeconds >= this.UNLOCK_BREAK_SECONDS) {
            // [狀態：解鎖] - 達標 40 分鐘
            breakBtn.disabled = false;
            breakBtn.className = "ml-3 px-4 py-2 bg-amber-600 text-white rounded-xl font-bold text-sm shadow-[0_0_15px_rgba(217,119,6,0.5)] transition-all cursor-pointer border border-amber-500 animate-pulse hover:bg-amber-500 hover:scale-105 active:scale-95";
            breakBtn.innerHTML = '<i class="fas fa-coffee mr-2"></i>休息 (已解鎖)';
            
            // 綁定點擊事件 (未來我們會把觸發休息畫面的功能寫進去)
            breakBtn.onclick = () => {
                if(window.BreakManager) window.BreakManager.showBreakMenu();
            };
        } else {
            // [狀態：未解鎖/冷卻中]
            breakBtn.disabled = true;
            breakBtn.className = "ml-3 px-4 py-2 bg-gray-700 text-gray-400 rounded-xl font-bold text-sm shadow-lg transition-all cursor-not-allowed border border-gray-600";
            
            // 計算還要多久才能休息
            const remain = this.UNLOCK_BREAK_SECONDS - this.continuousSeconds;
            const m = Math.floor(remain / 60);
            
            if (m > 0) {
                breakBtn.innerHTML = `<i class="fas fa-lock mr-2"></i>休息 (${m}m 後)`;
            } else {
                breakBtn.innerHTML = `<i class="fas fa-lock mr-2"></i>即將解鎖`;
            }
            breakBtn.onclick = null; // 移除事件
        }
    }

    /**
     * 更新主計時器的文字與進度條畫面
     */
    updateUI() {
        const timerDisplay = document.getElementById("myTimerDisplay");
        const progress = document.getElementById("timerProgress");

        // 格式化為 MM:SS
        const m = Math.floor(this.remainingSeconds / 60).toString().padStart(2, '0');
        const s = (this.remainingSeconds % 60).toString().padStart(2, '0');

        if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;
        
        // 計算進度條百分比
        if (progress) {
            const percentage = ((this.totalSeconds - this.remainingSeconds) / this.totalSeconds) * 100;
            progress.style.width = `${percentage}%`;
        }
    }

    /**
     * 專注時間結束的處理
     */
    completeSession() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        alert("🎉 達成專注目標！");
        
        // 呼叫原本寫在其他地方的 endSession 函數
        if (typeof window.endSession === 'function') {
            window.endSession();
        }
    }

    /**
     * 右上角的現在時間時鐘 (原先在 ai-core.js 的 setInterval)
     */
    startClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        this.clockInterval = setInterval(() => {
            const clockTime = document.getElementById('clockTime');
            if (clockTime) {
                clockTime.innerText = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            }
        }, 1000);
    }
}

// 將其掛載到全域 window 上，讓其他檔案 (像是 ai-core 或是之後的 BreakManager) 都可以直接呼叫操作它
window.StudyTimer = new StudyTimerManager();