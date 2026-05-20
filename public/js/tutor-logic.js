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
if (typeof window.socket === 'undefined') {
    window.socket = typeof io !== 'undefined' ? io() : null;
}
const socket = window.socket;

// ==========================================
// 新增：1. 監聽導師公告 (更新黑板 + 播放大喇叭音效)
// ==========================================
// ==========================================
// 新增：1. 監聽導師公告 (僅更新黑板，移除提示音)
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
        
        // 加上視覺閃爍特效吸引注意力
        blackboardContainer.classList.add('border-red-500', 'shadow-[0_0_30px_rgba(239,68,68,0.4)]');
        setTimeout(() => {
            blackboardContainer.classList.remove('border-red-500', 'shadow-[0_0_30px_rgba(239,68,68,0.4)]');
        }, 3000);
    }
    // 備註：導師端的提示音已移除
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
