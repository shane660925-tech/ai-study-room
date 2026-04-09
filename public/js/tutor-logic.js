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

// ==========================================
// 新增：1. 監聽導師公告 (更新黑板 + 播放大喇叭音效)
// ==========================================
socket.on('receive_tutor_announcement', (data) => {
    const blackboardContent = document.getElementById('blackboardContent');
    const blackboardTime = document.getElementById('blackboardTime');
    const blackboardContainer = document.getElementById('blackboardContainer');

    if (blackboardContent) {
        // 更新文字與時間
        blackboardContent.innerText = data.message;
        const now = new Date();
        blackboardTime.innerText = `最新發布：${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        // 加上視覺閃爍特效吸引注意力 ( Tailwind classes )
        blackboardContainer.classList.add('border-red-500', 'shadow-[0_0_30px_rgba(239,68,68,0.4)]');
        setTimeout(() => {
            blackboardContainer.classList.remove('border-red-500', 'shadow-[0_0_30px_rgba(239,68,68,0.4)]');
        }, 3000);
    }

    // 觸發「大喇叭」音效
    try {
        // 請確保您的專案目錄下有這個音檔，或者換成您現有的音檔路徑
        const alertSound = new Audio('/sounds/alert.mp3'); 
        alertSound.play().catch(e => console.log("瀏覽器自動播放限制，需使用者互動後才能播放音效", e));
    } catch(e) {
        console.log('無法播放大喇叭音效', e);
    }
});

// ==========================================
// 新增：2. 生理需求暫離按鈕邏輯
// ==========================================
window.requestBreak = function(type, minutes) {
    const typeName = type === 'toilet' ? '上廁所' : '喝水';
    
    // 跳出確認視窗
    if(confirm(`確定要暫離去「${typeName}」 ${minutes} 分鐘嗎？\n(系統將通知導師，超時將會扣除專注分數)`)) {
        
        // 發送暫離狀態給後端/導師端 (讓導師儀表板知道他離開了)
        socket.emit('student_status_update', { 
            status: 'break', 
            reason: typeName,
            duration: minutes 
        });

        // 視覺回饋：更改畫面上自己的狀態標籤 (選用，依據您原本的 class 調整)
        const statusText = document.querySelector('.text-green-400, .text-green-500'); 
        if(statusText) {
            statusText.innerHTML = `<span class="text-yellow-400"><i class="fas fa-clock"></i> 暫離中 (${typeName})</span>`;
        }
        
        // 本地彈窗提示
        alert(`已報備！請在 ${minutes} 分鐘內回到座位。`);
        
        // 可選功能：設定一個定時器，時間到自動提醒學生
        setTimeout(() => {
            alert(`⚠️ 您的「${typeName}」時間已結束！請盡速回到座位並恢復專注狀態。`);
            // 通知後端時間已到
            socket.emit('student_status_update', { status: 'focusing', reason: 'returned' });
        }, minutes * 60 * 1000);
    }
};

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