/**
 * tutor-dashboard.js
 * StudyVerse VIP - 導師控制台專用邏輯
 */

const socket = io();

// 記錄目前在線的學生資料與目前選擇的教室視角
let activeStudents = [];
let currentRoomFilter = 'ALL';

// ==========================================
// 1. 系統時鐘與日誌功能
// ==========================================
function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleString('zh-TW', { hour12: false });
    const clockEl = document.getElementById('systemClock');
    if(clockEl) clockEl.innerText = timeString;
}
setInterval(updateClock, 1000);
updateClock();

function addLog(message, colorClass = "text-amber-100") {
    const logContainer = document.getElementById('logContainer');
    if(!logContainer) return;
    const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    const logEl = document.createElement('div');
    logEl.className = `flex gap-2 ${colorClass}`;
    logEl.innerHTML = `<span class="opacity-50 min-w-[65px]">[${time}]</span> <span>${message}</span>`;
    logContainer.prepend(logEl); // 新日誌插在最上方
}

// ==========================================
// 2. Socket 連線與監聽
// ==========================================
socket.on('connect', () => {
    addLog("🟢 系統連線成功，導師端已就緒。", "text-green-400");
    socket.emit('join_tutor_room', { role: 'tutor' });
});

socket.on('disconnect', () => {
    addLog("🔴 系統斷線，正在嘗試重新連線...", "text-red-500");
});

// 監聽全服列表更新
socket.on('update_rank', (users) => {
    activeStudents = users;
    renderStudents();
});

// ==========================================
// 3. 導師操作功能 (對應左側邊欄的按鈕)
// ==========================================

// 黑板公告更新 (對應 HTML 的 updateBlackboard)
window.updateBlackboard = function() {
    const text = document.getElementById('announcementInput').value.trim();
    if (!text) {
        alert("請輸入公告內容！");
        return;
    }
    
    // 發送給伺服器廣播
    socket.emit('tutor_announcement', { message: text });
    addLog(`發布黑板公告：${text}`, "text-amber-400");
    
    // 清空輸入框
    document.getElementById('announcementInput').value = '';
};

// 班級點名
window.rollCall = function() {
    addLog("發起全班點名...", "text-blue-400");
    // 可視後端需求發送對應事件
    socket.emit('tutor_command', { command: 'rollCall' }); 
    alert("已向全班發送點名要求！");
};

// 線上巡堂
window.patrolRoom = function() {
    addLog("啟動線上隨機巡堂模式...", "text-purple-400");
    alert("正在連線學員鏡頭/畫面 (模擬功能)...");
};

// 個別指派任務
window.assignTask = function() {
    const target = document.getElementById('targetStudentInput').value.trim();
    if (!target) return alert("請先在上方輸入目標學生姓名或ID！");
    addLog(`向 [${target}] 指派專屬任務`, "text-blue-400");
    socket.emit('tutor_assign_task', { targetName: target, task: '請回報目前進度' });
};

// 針對個別學生發送「重大違規警告」 (支援從左側輸入框 或 卡片按鈕觸發)
window.sendWarning = function(studentName = null) {
    const target = studentName || document.getElementById('targetStudentInput').value.trim();
    if (!target) return alert("請先輸入或選擇目標學生！");

    if(confirm(`確定要對 ${target} 發送重大違規警告嗎？他的畫面將會閃爍紅光。`)) {
        socket.emit('tutor_warn_student', { 
            targetName: target,
            reason: "導師手動觸發：偵測到您有嚴重分心行為！" 
        });
        addLog(`已對 [${target}] 發出嚴重紅光警告！`, "text-red-500 font-bold");
    }
};

// 其它預留功能
window.exportCSV = function() { alert("匯出功能準備中..."); };
window.playChime = function() {
    socket.emit('tutor_command', { command: 'playChime' });
    addLog("已向全校廣播下課鐘聲", "text-yellow-400");
};

// ==========================================
// 4. UI 介面互動邏輯
// ==========================================

// 教室視角切換
window.setRoomFilter = function(room) {
    currentRoomFilter = room;
    
    // 重置所有按鈕樣式
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.replace('bg-amber-600', 'bg-[#0a0e17]');
        btn.classList.replace('text-white', 'text-gray-400');
        btn.classList.add('hover:bg-amber-900/40', 'hover:text-amber-100');
    });
    
    // 亮起當前按鈕
    const activeBtn = document.getElementById(`filter-${room}`);
    if(activeBtn) {
        activeBtn.classList.replace('bg-[#0a0e17]', 'bg-amber-600');
        activeBtn.classList.replace('text-gray-400', 'text-white');
        activeBtn.classList.remove('hover:bg-amber-900/40', 'hover:text-amber-100');
    }
    
    addLog(`切換視角至：${room === 'ALL' ? '全部教室' : room}`, "text-gray-400");
    renderStudents();
};

// 右側面板 Tab 切換
window.switchTab = function(tabName) {
    ['violations', 'summary'].forEach(name => {
        document.getElementById(`tab-${name}`).classList.add('hidden');
        const btn = document.getElementById(`btn-${name}`);
        btn.classList.replace('border-amber-500', 'border-transparent');
        btn.classList.remove('text-amber-500');
        btn.classList.add('text-gray-500');
    });

    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`btn-${tabName}`);
    activeBtn.classList.replace('border-transparent', 'border-amber-500');
    activeBtn.classList.replace('text-gray-500', 'text-amber-500');
};

// ==========================================
// 5. 渲染學生卡片
// ==========================================
function renderStudents() {
    const grid = document.getElementById('studentGrid');
    
    // 依據當前教室視角過濾學生
    const filteredStudents = currentRoomFilter === 'ALL' 
        ? activeStudents 
        : activeStudents.filter(s => String(s.room) === String(currentRoomFilter));

    // 更新在線人數
    document.getElementById('onlineCount').innerText = filteredStudents.length;

    if (filteredStudents.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-20 text-gray-500 font-bold">
                <i class="fas fa-ghost text-3xl mb-4 text-amber-500/30"></i>
                <p>目前此區間沒有學員在線</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = ''; // 清空準備重繪

    filteredStudents.forEach(student => {
        const isStandalone = student.isStandalone || false;
        const deviceIcon = isStandalone 
            ? '<i class="fas fa-mobile-alt text-amber-500" title="手機單機端"></i>' 
            : '<i class="fas fa-desktop text-blue-400" title="電腦網頁端"></i>';
            
        // 模擬警告狀態
        const isWarning = student.distractions && student.distractions > 3; 
        const statusBorder = isWarning ? 'border-red-500/50 shadow-[0_0_15px_rgba(220,38,38,0.2)]' : 'border-amber-500/20';
        const statusText = isWarning ? '<span class="text-red-400 font-bold text-xs"><i class="fas fa-exclamation-circle"></i> 需注意</span>' : '<span class="text-green-400 font-bold text-xs">專注中</span>';

        const card = document.createElement('div');
        // 套用黑金專屬卡片樣式
        card.className = `bg-[#0a0e17] rounded-xl p-5 flex flex-col justify-between ${statusBorder} border transition-all hover:scale-[1.02]`;
        
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-3">
                        <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${student.name}" class="w-12 h-12 rounded-full bg-black border-2 border-amber-500/30">
                        <div>
                            <h3 class="font-bold text-white text-lg flex items-center gap-2">
                                ${student.name} ${deviceIcon}
                            </h3>
                            <p class="text-[10px] text-gray-400">目前分數：<span class="text-amber-400 font-mono">${student.score || 0}</span></p>
                        </div>
                    </div>
                    ${statusText}
                </div>
                
                <div class="bg-black/40 p-3 rounded-lg border border-amber-500/10 mb-4">
                    <p class="text-[10px] text-amber-500/50 uppercase font-bold mb-1">今日目標</p>
                    <p class="text-sm text-gray-200 truncate">${student.goal || '未設定目標'}</p>
                </div>
            </div>
            
            <div class="flex gap-2 mt-auto pt-4 border-t border-amber-500/10">
                <button onclick="sendWarning('${student.name}')" class="flex-1 bg-red-900/20 hover:bg-red-600/80 text-red-400 hover:text-white py-2 rounded-lg text-xs font-bold border border-red-900/50 transition-colors">
                    <i class="fas fa-siren-on mr-1"></i> 警告
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}