/**
 * STUDY VERSE - 特約教師教室核心邏輯 (V2.2.5)
 * [保護傘機制] 確保在檔案拆分過程中，不因找不到 DOM 元件而報錯
 */

// --- 1. 保護傘工具函數 ---
/**
 * 安全的 DOM 操作檢查
 * @param {string} id - HTML 元素的 ID
 * @param {function} callback - 如果元素存在，要執行的動作
 */
function safeDOM(id, callback) {
    const element = document.getElementById(id);
    if (element) {
        callback(element);
    } else {
        // 僅在開發階段記錄，不會導致程式中斷
        console.warn(`[保護傘提示] 找不到元件: #${id}，已跳過相關邏輯。`);
    }
}

// --- 2. 初始化 Socket 連線 ---
// 這裡預留對接原本的 Socket.io 邏輯
const socket = io(); 

// --- 3. 實作「點名按鈕」範例邏輯 (對接報鎖解決方案) ---
// 未來你可以在這裡安心地寫任何按鈕邏輯
safeDOM('call-roll-btn', (btn) => {
    btn.onclick = function() {
        console.log("觸發點名：發送 Socket 訊號給全班...");
        socket.emit('teacher-call-roll', {
            roomId: 'current-room-id',
            time: new Date().getTime()
        });
    };
});

// --- 4. 範例：老師巡堂公告按鈕 ---
safeDOM('patrol-btn', (btn) => {
    btn.onclick = function() {
        console.log("發動巡堂公告！");
        socket.emit('teacher-patrol', { msg: "老師正在巡堂中，請保持專注！" });
    };
});

// --- 5. 初始畫面檢查 ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 特約教室保護傘系統已啟動。");
    
    // 檢查老師控制面板是否存在
    safeDOM('teacher-controls', (panel) => {
        panel.classList.remove('hidden'); // 如果存在就顯示面板
        panel.innerHTML = `
            <div class="flex items-center gap-2 p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <span class="text-xs font-bold text-yellow-500 uppercase">教師工具：</span>
                <button id="call-roll-btn" class="bg-blue-600 hover:bg-blue-500 text-[10px] px-3 py-1 rounded-md font-bold transition-all">點名</button>
                <button id="patrol-btn" class="bg-orange-600 hover:bg-orange-500 text-[10px] px-3 py-1 rounded-md font-bold transition-all">巡堂公告</button>
            </div>
        `;
        
        // 由於按鈕是動態生成的，我們需要重新綁定一次或使用事件委派
        // 這裡示範簡單的重新綁定
        bindTeacherEvents();
    });
});

function bindTeacherEvents() {
    safeDOM('call-roll-btn', (btn) => {
        btn.onclick = () => alert("發送點名訊號！");
    });
    safeDOM('patrol-btn', (btn) => {
        btn.onclick = () => alert("發動巡堂警告！");
    });
}