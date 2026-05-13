/**
 * tutor-dashboard.js
 * StudyVerse VIP - 導師控制台專用邏輯
 */

const socket = io();

// 全域變數供 Socket 與 UI 同步使用
window.currentTutorRoomCode = new URLSearchParams(window.location.search).get('room');
window.currentScheduleData = null; 
window.currentScheduleText = "";
window.tutorSessionSummaries = {};

// ================= 修正：讀取與複製教室代碼 =================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    
    // 1. 頁面載入後，先從 LocalStorage 拿資料
    const savedSchedule = localStorage.getItem(`tutor_schedule_${roomCode}`);

    if (savedSchedule) {
        try {
            const scheduleData = JSON.parse(savedSchedule);
            window.currentScheduleData = scheduleData; // 存入全域供 Socket 連線時同步
            
            // 2. 立即更新老師自己的 UI (這樣就不會卡在「讀取排程中」)
            updateDashboardUI(scheduleData); 
        } catch (e) {
            console.error("解析快取排程失敗", e);
        }
    }

    const displayEl = document.getElementById('displayDashboardRoomCode');
    if (roomCode && displayEl) {
        displayEl.innerText = roomCode;
        window.currentTutorRoomCode = roomCode; // 存為全域變數備用
    } else if (displayEl) {
        displayEl.innerText = "無法取得代碼";
        displayEl.classList.add('text-red-500');
    }
});

// 一鍵複製代碼功能
window.copyDashboardRoomCode = function() {
    const code = document.getElementById('displayDashboardRoomCode').innerText;
    if (code && !code.includes('讀取') && !code.includes('無法')) {
        navigator.clipboard.writeText(code).then(() => {
            const el = document.getElementById('displayDashboardRoomCode');
            const originalText = el.innerText;
            
            // 視覺回饋：變色並顯示已複製
            el.innerText = '已複製!';
            el.classList.replace('text-amber-400', 'text-green-400');
            
            setTimeout(() => {
                el.innerText = originalText;
                el.classList.replace('text-green-400', 'text-amber-400');
            }, 1500);
        }).catch(err => {
            console.error('複製失敗:', err);
            alert('瀏覽器不支援自動複製，請手動選取複製！');
        });
    }
};

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
    logContainer.prepend(logEl); 
}

// ==========================================
// 2. Socket 連線與監聽 (統一合併邏輯)
// ==========================================
socket.on('connect', () => {
    addLog("🟢 系統連線成功，導師端已就緒。", "text-green-400");
    
    const roomCode = window.currentTutorRoomCode;
    
    // 加入房間，角色設為 teacher
    socket.emit('join_tutor_room', {
    room: roomCode,
    roomId: roomCode,
    role: 'teacher'
});

    // 如果有讀取到排程，立即補發同步
    if (window.currentScheduleData) {
        socket.emit('sync_schedule_to_students', window.currentScheduleData); 
        console.log("排程已同步給學生");
    }
});

socket.on('disconnect', () => {
    addLog("🔴 系統斷線，正在嘗試重新連線...", "text-red-500");
});

// 記錄目前在線的學生資料
let activeStudents = [];
let knownTutorNames = new Set(); 

socket.on('update_rank', (users) => {
    const currentRoomCode = window.currentTutorRoomCode;

    activeStudents = users.filter(s =>
        s.roomMode === 'tutor' &&
        s.roomId === currentRoomCode
    );

    activeStudents.forEach(s => knownTutorNames.add(s.name));

    if (typeof renderStudents === 'function') {
        renderStudents();
    }
});

socket.on('receive_tutor_announcement', (data) => {
    const blackboardContent = document.getElementById('blackboardContent');
    if (blackboardContent) {
        blackboardContent.innerText = data.message;
    }
});

// 建立全域變數儲存最新的出席資料
window.latestAttendanceData = [];

// 渲染出席表邏輯
socket.on('update_attendance', (users) => {
    const currentRoomCode = window.currentTutorRoomCode;

    window.latestAttendanceData = (users || []).filter(u =>
        !u.roomId || u.roomId === currentRoomCode
    );

    activeStudents = window.latestAttendanceData;
    activeStudents.forEach(s => knownTutorNames.add(s.name));

    if (typeof renderStudents === 'function') {
        renderStudents();
    } 
    
    // 如果彈窗目前是開啟狀態，就即時更新裡面的表格
    if (document.getElementById('attendanceModal') && !document.getElementById('attendanceModal').classList.contains('hidden')) {
        renderAttendanceData();
    }

    // 保留原本可能有的隱藏表格渲染
    const tableBody = document.getElementById('attendanceTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = users.map(u => `
        <tr class="border-b border-amber-500/20">
            <td class="p-2 text-white">${u.name}</td>
            <td class="p-2 text-green-400">${u.joinTime || '-'}</td>
            <td class="p-2 text-red-400">${u.leaveTime || '上課中'}</td>
        </tr>
    `).join('');
});

// ==========================================
// 3. 導師操作功能
// ==========================================

window.triggerPatrol = function() {
    const messages = ["老師巡堂中，請保持專注！", "怪獸來了...熊出沒！", "系統正在監控你的視窗..."];
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    
    socket.emit('tutor_patrol', { message: randomMsg });
    addLog(`已發送巡堂廣播：${randomMsg}`, "text-purple-400 font-bold");
};

window.sendAnnouncement = function() {
    const inputEl = document.getElementById('announceInput'); 
    
    if (!inputEl) {
        alert("❌ 程式錯誤：找不到廣播的輸入框！");
        return;
    }

    const msg = inputEl.value.trim();
    if (!msg) {
        alert("⚠️ 請先輸入廣播內容！");
        return;
    }

    if (typeof socket !== 'undefined') {
        socket.emit('send_tutor_announcement', {
    room: window.currentTutorRoomCode,
    roomId: window.currentTutorRoomCode,
    message: msg
});
        alert(`🔊 大喇叭廣播已成功發送給全體學生！\n\n廣播內容：${msg}`);
        addLog(`已發送大喇叭廣播：${msg}`, "text-amber-400 font-bold");
        inputEl.value = '';
    } else {
        alert("❌ Socket 未連線，無法發送廣播！");
    }
};

window.updateBlackboard = function() {
    const text = document.getElementById('announcementInput').value.trim();
    if (!text) {
        alert("請輸入公告內容！");
        return;
    }
    socket.emit('tutor_announcement', { message: text });
    socket.emit('update_blackboard', {
    room: window.currentTutorRoomCode,
    roomId: window.currentTutorRoomCode,
    message: text
});
    addLog(`發布黑板公告：${text}`, "text-amber-400");
    document.getElementById('announcementInput').value = '';
};

// ==========================================
// 班級點名系統與彈窗邏輯
// ==========================================

window.rollCall = function() {
    addLog("開啟班級點名表...", "text-blue-400");
    
    // 向伺服器請求最新出席名單 (確保資料是最新的)
    if (typeof socket !== 'undefined') {
        socket.emit('get_attendance', { room: window.currentTutorRoomCode });
    }
    
    // 顯示點名彈窗
    showAttendanceModal();
};

// 動態生成與顯示點名彈窗
function showAttendanceModal() {
    let modal = document.getElementById('attendanceModal');
    
    // 如果彈窗還不存在，就動態建立一個
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'attendanceModal';
        modal.className = 'fixed inset-0 z-[9999] hidden bg-black/80 flex-col items-center justify-center p-4 backdrop-blur-sm transition-opacity';
        
        modal.innerHTML = `
            <div class="relative max-w-2xl w-full bg-[#0a0e17] border border-amber-500/30 rounded-xl shadow-[0_0_30px_rgba(245,158,11,0.15)] p-6 flex flex-col max-h-[80vh] animate-fadeIn">
                <button onclick="closeAttendanceModal()" class="absolute top-4 right-4 text-slate-400 hover:text-white text-2xl transition-colors">
                    <i class="fas fa-times-circle"></i>
                </button>
                
                <h2 class="text-2xl font-black text-amber-400 mb-6 flex items-center gap-3 border-b border-amber-500/20 pb-4 tracking-wide">
                    <i class="fas fa-clipboard-check text-3xl"></i> 班級點名與出席紀錄
                </h2>
                
                <div class="overflow-y-auto flex-1 pr-2" style="scrollbar-width: thin; scrollbar-color: #f59e0b transparent;">
                    <table class="w-full text-left text-sm text-gray-300">
                        <thead class="text-xs text-amber-500 bg-amber-900/20 uppercase sticky top-0 backdrop-blur-md shadow-sm">
                            <tr>
                                <th class="px-4 py-3 rounded-tl-lg">學員名稱</th>
                                <th class="px-4 py-3">進入教室時間</th>
                                <th class="px-4 py-3 rounded-tr-lg">離開時間 / 目前狀態</th>
                            </tr>
                        </thead>
                        <tbody id="modalAttendanceTableBody" class="divide-y divide-amber-500/10">
                            </tbody>
                    </table>
                </div>
                
                <div class="mt-6 pt-4 border-t border-amber-500/20 flex justify-between items-center">
                    <div class="text-slate-400 text-sm">
                        目前共記錄 <span id="attendanceTotalCount" class="text-amber-400 font-mono font-bold text-lg mx-1">0</span> 名學員
                    </div>
                    <button onclick="closeAttendanceModal()" class="px-8 py-2 bg-amber-600/20 hover:bg-amber-500/40 border border-amber-500/50 text-amber-400 hover:text-amber-300 rounded-lg font-bold transition-all">
                        關閉視窗
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // 渲染資料到表格中
    renderAttendanceData();
    
    // 顯示彈窗
    modal.classList.replace('hidden', 'flex');
}

// 關閉點名彈窗
window.closeAttendanceModal = function() {
    const modal = document.getElementById('attendanceModal');
    if (modal) modal.classList.replace('flex', 'hidden');
}

// 負責將名單渲染進表格的邏輯
function renderAttendanceData() {
    const tbody = document.getElementById('modalAttendanceTableBody');
    const countSpan = document.getElementById('attendanceTotalCount');
    if (!tbody || !countSpan) return;

    const data = window.latestAttendanceData || [];
    countSpan.innerText = data.length;

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="px-4 py-12 text-center text-slate-500">
                    <i class="fas fa-ghost text-4xl mb-3 opacity-30 block"></i>
                    <p class="font-bold tracking-widest">目前尚無任何出席紀錄</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = data.map(u => {
        // 判斷學生是否還在線上 (沒有離開時間就視為上課中)
        const isOnline = !u.leaveTime || u.leaveTime === '上課中' || u.leaveTime === '';
        
        const statusClass = isOnline ? 'text-green-400 font-bold bg-green-500/10 px-2 py-1 rounded' : 'text-red-400 font-bold bg-red-500/10 px-2 py-1 rounded';
        const statusText = isOnline ? '🟢 持續專注中' : `🔴 離線 (${u.leaveTime})`;
        
        return `
            <tr class="hover:bg-amber-500/5 transition-colors group">
                <td class="px-4 py-4 font-bold text-white text-base flex items-center gap-2">
                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${u.name}" class="w-8 h-8 rounded-full bg-black/50 border border-amber-500/30">
                    ${u.name}
                </td>
                <td class="px-4 py-4 text-slate-300 font-mono">${u.joinTime || '未知'}</td>
                <td class="px-4 py-4"><span class="${statusClass}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}

// ==========================================
// 線上巡堂功能
// ==========================================
window.patrolRoom = function() {
    // 準備多種生動的巡堂台詞
    const messages = [
        "👀 導師線上巡堂中，請保持專注！",
        "🦖 怪獸來了...請注意你的畫面！",
        "🐻 熊出沒注意！老師正在看著你...",
        "🚨 系統隨機抽查中，請不要切換視窗！",
        "👻 突擊檢查！看看誰在分心？"
    ];
    
    // 隨機抽選一句
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    
    if (typeof socket !== 'undefined') {
        // 發送給伺服器 (附帶目前教室代碼確保只發給同班學生)
        socket.emit('tutor_patrol', { 
            room: window.currentTutorRoomCode, 
            message: randomMsg 
        });
        
        // 更新導師端日誌
        addLog(`啟動線上巡堂：發送廣播 [${randomMsg}]`, "text-purple-400 font-bold");
        
        // 視覺回饋
        const btn = document.querySelector('button[onclick="patrolRoom()"]');
        if(btn) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-check text-green-400"></i> 已巡堂`;
            setTimeout(() => btn.innerHTML = originalHtml, 2000);
        }
    } else {
        alert("❌ Socket 未連線，無法發送巡堂通知！");
    }
};

// 【修改點】針對學生圖卡的警告功能，拔除讀取左側輸入框邏輯
window.sendWarning = function(studentName) {
    if (!studentName) return alert("請先選擇目標學生！");
    if(confirm(`確定要對 ${studentName} 發送重大違規警告嗎？他的畫面將會閃爍紅光。`)) {
        const warningData = { targetName: studentName, reason: "導師手動觸發：偵測到您有嚴重分心行為！" };
        socket.emit('tutor_warn_student', warningData);
        socket.emit('send_warning', warningData);
        socket.emit('receive_warning', warningData);
        addLog(`已對 [${studentName}] 發出嚴重紅光警告！`, "text-red-500 font-bold");
    }
};

window.exportCSV = function() { alert("匯出功能準備中..."); };
window.playChime = function() {
    socket.emit('tutor_command', { command: 'playChime' });
    addLog("已向全校廣播下課鐘聲", "text-yellow-400");
};

// ==========================================
// 4. UI 介面互動邏輯
// ==========================================
window.switchTab = function(tabName) {
    ['violations', 'summary'].forEach(name => {
        const el = document.getElementById(`tab-${name}`);
        if(el) el.classList.add('hidden');
        const btn = document.getElementById(`btn-${name}`);
        if(btn) {
            btn.classList.replace('border-amber-500', 'border-transparent');
            btn.classList.remove('text-amber-500');
            btn.classList.add('text-gray-500');
        }
    });
    const targetTab = document.getElementById(`tab-${tabName}`);
    if(targetTab) targetTab.classList.remove('hidden');
    const activeBtn = document.getElementById(`btn-${tabName}`);
    if(activeBtn) {
        activeBtn.classList.replace('border-transparent', 'border-amber-500');
        activeBtn.classList.replace('text-gray-500', 'text-amber-500');
    }
    
    // 🚀 新增：當切換到數據總結 (summary) 頁籤時，重新渲染報告畫面
    if (tabName === 'summary' && typeof renderTutorSummaryReports === 'function') {
        renderTutorSummaryReports();
    }
};

// ==========================================
// 5. 渲染學生卡片
// ==========================================
function renderStudents() {
    const grid = document.getElementById('studentGrid');
    if(!grid) return;
    const filteredStudents = activeStudents;
    const countEl = document.getElementById('onlineCount');
    if(countEl) countEl.innerText = filteredStudents.length;

    if (filteredStudents.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500 font-bold"><i class="fas fa-ghost text-3xl mb-4 text-amber-500/30"></i><p>目前此區間沒有學員在線</p></div>`;
        return;
    }

    grid.innerHTML = '';
    filteredStudents.forEach(student => {
        const isStandalone = student.isStandalone || false;
        
        // 雙機圖示處理
        const mobileClass = isStandalone ? "text-amber-500 drop-shadow-[0_0_5px_rgba(245,158,11,0.8)]" : "text-gray-400";
        const desktopClass = !isStandalone ? "text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.8)]" : "text-gray-400";
        const dualDeviceIcons = `
            <div class="flex gap-2 text-sm bg-black/80 px-3 py-1 rounded-full border border-gray-800 -mt-3 relative z-10 shadow-lg">
                <i class="fas fa-mobile-alt ${mobileClass}"></i>
                <i class="fas fa-desktop ${desktopClass}"></i>
            </div>
        `;

        // 🚀 修正：改為判斷「過去 10 秒內是否有發生違規」
        const records = violationStorage[student.name];
        let isWarning = false;
        
        if (records && records.length > 0) {
            const lastViolationTime = records[0].rawTime; 
            const nowTime = new Date().getTime();
            // 只要在 10000 毫秒 (10秒) 內發生，就顯示違規
            if (nowTime - lastViolationTime < 10000) {
                isWarning = true;
            }
        }
        
        // 若後端有特別傳遞嚴重分心標記也視為違規
        if (student.status === 'distracted' || student.status === 'warning') {
            isWarning = true;
        }
        
        const statusBorder = isWarning ? 'border-red-500/50 shadow-[0_0_15px_rgba(220,38,38,0.2)]' : 'border-amber-500/20';
        
        const statusText = isWarning 
            ? '<span class="inline-block bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1 rounded-full font-bold text-[10px] tracking-wider animate-pulse">分心或違規</span>' 
            : '<span class="inline-block bg-green-500/20 text-green-400 border border-green-500/30 px-3 py-1 rounded-full font-bold text-[10px] tracking-wider">專注中</span>';

        const card = document.createElement('div');
        
        card.className = `bg-[#0a0e17] rounded-xl p-5 flex flex-col items-center justify-between ${statusBorder} border transition-all hover:scale-[1.02] aspect-[3/4] max-w-[220px] mx-auto w-full relative`;
        
        card.innerHTML = `
            <div class="flex flex-col items-center w-full">
                <div class="flex flex-col items-center mb-3">
                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${student.name}" class="w-16 h-16 rounded-full bg-black border-2 border-amber-500/30 relative z-0">
                    ${dualDeviceIcons}
                </div>
                
                <h3 class="font-bold text-white text-lg tracking-wide mb-2">${student.name}</h3>
                
                <div class="mb-3">
                    ${statusText}
                </div>
                
                <div class="text-xs text-gray-400">
                    目前分數 <span class="text-amber-400 font-mono font-black text-base ml-1">${student.score || 0}</span>
                </div>
            </div>
            
            <div class="w-full mt-auto pt-4 border-t border-amber-500/10">
                <button onclick="sendWarning('${student.name}')" class="w-full bg-red-900/20 hover:bg-red-600/80 text-red-400 hover:text-white py-2 rounded-lg text-xs font-bold border border-red-900/50 transition-colors flex justify-center items-center gap-1">
                    <i class="fas fa-exclamation-triangle"></i> 警告
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ==========================================
// 6. 違規證據分類流與截圖管理
// ==========================================
let violationStorage = {}; 

function saveAndRenderViolation(studentName, type, img) {
    if (!studentName) return;
    if (!violationStorage[studentName]) violationStorage[studentName] = [];
    
    // 🚀 新增：攔截「學生已回位」的通知，去更新上一筆離座紀錄
    if (type.includes("【更新狀態】學生已回位")) {
        const timeMatch = type.match(/回位時間: (.*?)\)/);
        const returnTime = timeMatch ? timeMatch[1] : new Date().toLocaleTimeString('zh-TW', { hour12: false });
        
        const records = violationStorage[studentName];
        const lastLeaveRecord = records.find(r => r.type && r.type.includes("尚未回位"));
        
        if (lastLeaveRecord) {
            // 把尚未回位替換成精準的回位時間
            lastLeaveRecord.type = lastLeaveRecord.type.replace("尚未回位", `回位時間: ${returnTime}`);
            addLog(`✅ 狀態更新：${studentName} 已回到座位`, "text-green-400 font-bold");
            renderViolationsList();
        }
        return; // 這是用來更新的指令，不要當作新的違規存進去！
    }

    // --- 原本的違規儲存邏輯 ---
    const now = new Date();
    const nowTime = now.toLocaleTimeString('zh-TW', { hour12: false });
    const noImageKeywords = ['翻開', '翻轉', '分頁', 'tab', '離開', '手動', '警告', '導師'];
    const isNoImage = noImageKeywords.some(keyword => type.includes(keyword));
    const finalImg = isNoImage ? null : img;
    
    // 防重複機制
    const isDuplicate = violationStorage[studentName].some(v => v.type === type && (now.getTime() - v.rawTime < 3000));
    if (isDuplicate) return;

    violationStorage[studentName].unshift({ time: nowTime, rawTime: now.getTime(), type: type, img: finalImg });
    addLog(`🚨 系統攔截：${studentName} - ${type}`, "text-red-400 font-bold");
    renderViolationsList();
    
    if (typeof renderStudents === 'function') renderStudents();
}

socket.on('teacher_update', (data) => {
    if (data.snaps && data.snaps.length > 0) {
        data.snaps.forEach(snap => {
            if (!activeStudents.some(s => s.name === snap.name)) return;
            saveAndRenderViolation(snap.name, snap.reason, snap.image || snap.img);
        });
    }
    if (data.logs && data.logs.length > 0) {
        data.logs.forEach(log => {
            const logStr = String(log);
            let isTutorLog = false;
            knownTutorNames.forEach(name => { if (logStr.includes(name)) isTutorLog = true; });
            if (!isTutorLog) return;
            if (!logStr.includes('系統通知')) addLog(logStr, "text-slate-400");
        });
    }
});

function handleDirectViolation(data) {
    const name = data.name || data.studentName || data.username;
    if (!activeStudents.some(s => s.name === name)) return;
    const type = data.type || data.reason || data.violationType || '異常行為';
    const img = data.image || data.img || data.screenshot || null;
    saveAndRenderViolation(name, type, img);
}
socket.on('student_violation', handleDirectViolation);
socket.on('violation', handleDirectViolation);
socket.on('ai_violation', handleDirectViolation);

socket.on('flip_failed', (data) => {
    const name = data.name || data.username || '未知學員';
    if (activeStudents.some(s => s.name === name)) saveAndRenderViolation(name, "📱 翻轉中斷 (超過5秒強制踢出教室)", null);
});
socket.on('tab_switched', (data) => {
    const name = data.name || data.username || '未知學員';
    if (activeStudents.some(s => s.name === name)) saveAndRenderViolation(name, "🚫 切換分頁 (離開自習室畫面)", null);
});

function renderViolationsList() {
    const container = document.getElementById('tab-violations');
    if (!container) return;
    container.innerHTML = `<h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-800 pb-2">學員違規證據分類流</h3>`;
    const studentNames = Object.keys(violationStorage);
    if (studentNames.length === 0) {
        container.innerHTML += `<p class="text-slate-600 italic text-center py-8 text-xs">目前無任何違規紀錄</p>`;
        return;
    }
    studentNames.forEach(name => {
        const records = violationStorage[name];
        const groupDiv = document.createElement('div');
        groupDiv.className = 'mb-3 border border-red-900/30 rounded-xl overflow-hidden bg-black/20';
        const headerBtn = document.createElement('button');
        headerBtn.className = 'w-full bg-slate-800/40 p-3 flex justify-between items-center';
        headerBtn.innerHTML = `<span class="font-bold text-white text-sm">${name}</span><span class="bg-red-500/20 text-red-400 text-[10px] px-2 py-1 rounded-full">${records.length} 次</span>`;
        const listDiv = document.createElement('div');
        listDiv.className = 'hidden flex-col gap-2 p-3 bg-black/40';
        headerBtn.onclick = () => { listDiv.classList.toggle('hidden'); listDiv.classList.toggle('flex'); };
        records.forEach(rec => {
            const item = document.createElement('div');
            item.className = 'flex justify-between items-center p-2 bg-slate-800/50 rounded-lg';
            const actionBtn = rec.img ? `<button onclick="showTutorImageModal('${rec.img}', '${name}', '${rec.type}')" class="text-blue-400 text-xs font-bold px-2 py-1 bg-blue-500/10 rounded">截圖</button>` : `<span class="text-slate-500 text-[10px]">文字</span>`;
            item.innerHTML = `<div class="flex flex-col text-left"><span class="text-[10px] text-slate-400">${rec.time}</span><span class="text-xs text-red-300 font-bold">${rec.type}</span></div>${actionBtn}`;
            listDiv.appendChild(item);
        });
        groupDiv.appendChild(headerBtn); groupDiv.appendChild(listDiv); container.appendChild(groupDiv);
    });
}

// ==========================================
// 7. 動態生成證據截圖彈窗
// ==========================================
function showTutorImageModal(imgSrc, name, reason) {
    let modal = document.getElementById('tutorImageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'tutorImageModal';
        modal.className = 'fixed inset-0 z-[9999] hidden bg-black/95 flex-col items-center justify-center p-8 backdrop-blur-md';
        modal.innerHTML = `<div class="relative max-w-4xl w-full flex flex-col items-center"><button onclick="closeTutorImageModal()" class="absolute -top-12 right-0 text-slate-400 text-3xl"><i class="fas fa-times-circle"></i></button><div class="p-2 bg-slate-800 rounded-xl"><img id="tutorModalImg" src="" class="max-w-full max-h-[70vh] rounded-lg"></div><div class="mt-6 text-center"><h2 id="tutorModalName" class="text-2xl font-black text-white"></h2><p id="tutorModalReason" class="text-red-400 text-sm font-bold"></p></div></div>`;
        document.body.appendChild(modal);
    }
    const modalImg = document.getElementById('tutorModalImg');
    const modalName = document.getElementById('tutorModalName');
    const modalReason = document.getElementById('tutorModalReason');
    if(modalImg) modalImg.src = imgSrc;
    if(modalName) modalName.innerText = `違規學員：${name}`;
    if(modalReason) modalReason.innerText = `判定原因：${reason}`;
    modal.classList.replace('hidden', 'flex');
}
window.closeTutorImageModal = function() {
    const modal = document.getElementById('tutorImageModal');
    if (modal) modal.classList.replace('flex', 'hidden');
}

// ==========================================
// 8. 排程顯示與廣播邏輯
// ==========================================
function updateDashboardUI(data) {
    if (!data) return;
    try {
        const periods = parseInt(data.periods) || 0;
        const periodTime = parseInt(data.periodTime) || 0;
        const restTime = parseInt(data.restTime) || 0;
        
        const totalMinutes = (periods * periodTime) + ((periods > 1) ? (periods - 1) * restTime : 0);
        const [hours, minutes] = (data.startTime || "08:00").split(':').map(Number);
        let date = new Date();
        date.setHours(hours, minutes, 0, 0);
        date.setMinutes(date.getMinutes() + totalMinutes);
        
        const endHours = String(date.getHours()).padStart(2, '0');
        const endMins = String(date.getMinutes()).padStart(2, '0');
        const endTime = `${endHours}:${endMins}`;

        window.currentScheduleText = `本次課表為 ${data.startTime}~${endTime}，分 ${periods} 節課，每節課 ${periodTime} 分鐘，每次休息 ${restTime} 分鐘`;
        
        const displayEl = document.getElementById('teacherScheduleDisplay');
        if (displayEl) displayEl.innerText = window.currentScheduleText;

        broadcastSchedule();
    } catch(e) {
        console.error("更新排程 UI 失敗", e);
    }
}

window.broadcastSchedule = function() {
    if (window.currentScheduleText && typeof socket !== 'undefined') {
        socket.emit('sync_tutor_schedule', { message: window.currentScheduleText });
        if (window.currentScheduleData) {
            socket.emit('sync_schedule_to_students', window.currentScheduleData);
        }
    }
};

// ==========================================
// 🚀 自動排程計時系統 (動態讀取版)
// ==========================================

function getLiveScheduleConfig() {
    const displayExt = document.getElementById('teacherScheduleDisplay')?.innerText || "";
    
    let config = {
        totalPeriods: 3,
        classDuration: 20 * 60,
        breakDuration: 10 * 60,
        startTime: new Date().getTime() 
    };

    const timeMatch = displayExt.match(/(\d{2}):(\d{2})~/);
    if (timeMatch) {
        const startDay = new Date();
        startDay.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        config.startTime = startDay.getTime();
    }

    const periodMatch = displayExt.match(/分 (\d+) 節課/);
    const durationMatch = displayExt.match(/每節課 (\d+) 分鐘/);
    const breakMatch = displayExt.match(/休息 (\d+) 分鐘/);

    if (periodMatch) config.totalPeriods = parseInt(periodMatch[1]);
    if (durationMatch) config.classDuration = parseInt(durationMatch[1]) * 60;
    if (breakMatch) config.breakDuration = parseInt(breakMatch[1]) * 60;

    return config;
}

let timerInterval = null;

function initAutoTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerLogic, 1000);
    updateTimerLogic();
}

function updateTimerLogic() {
    const SESSION_CONFIG = getLiveScheduleConfig();
    const now = new Date().getTime();
    const elapsedSeconds = Math.floor((now - SESSION_CONFIG.startTime) / 1000);
    
    if (elapsedSeconds < 0) {
        updateTimerUI("00:00", "準備上課", "未開始", 0);
        return;
    }

    const cycleDuration = SESSION_CONFIG.classDuration + SESSION_CONFIG.breakDuration;
    const currentCycle = Math.floor(elapsedSeconds / cycleDuration);
    const timeInCycle = elapsedSeconds % cycleDuration;
    
    let periodName = "";
    let remainingTime = 0;
    let isBreak = false;
    let progress = 0;
    let currentPeriod = currentCycle + 1;

    // 🚀 新增：精準判定是否「所有課程都已結束」(最後一堂課的上課時間結束，直接跳過休息)
    const isCourseEnded = currentPeriod > SESSION_CONFIG.totalPeriods || 
                          (currentPeriod === SESSION_CONFIG.totalPeriods && timeInCycle >= SESSION_CONFIG.classDuration);

    if (isCourseEnded) {
        updateTimerUI("00:00", "課程結束", "已完成", 100);
        
        // 當所有課程結束時，自動發送下課指令給全班學生觸發 AI 結算
        if (typeof socket !== 'undefined' && socket.connected && !window.courseEndedBroadcasted) {
            window.courseEndedBroadcasted = true; // 加上防抖，確保只發送一次
            socket.emit('tutor_command', { command: 'course_ended' });
            addLog("🎉 所有課程已結束，已通知全體學員自動產生結算報告！", "text-green-400 font-bold");
        }
        return;
    }

    if (timeInCycle < SESSION_CONFIG.classDuration) {
        isBreak = false;
        periodName = `第 ${currentPeriod} 節課`;
        remainingTime = SESSION_CONFIG.classDuration - timeInCycle;
        progress = (timeInCycle / SESSION_CONFIG.classDuration) * 100;
    } else {
        isBreak = true;
        periodName = `第 ${currentPeriod} 節休息`;
        remainingTime = cycleDuration - timeInCycle;
        progress = ((timeInCycle - SESSION_CONFIG.classDuration) / SESSION_CONFIG.breakDuration) * 100;
    }

    const mins = Math.floor(remainingTime / 60).toString().padStart(2, '0');
    const secs = (remainingTime % 60).toString().padStart(2, '0');
    const timeString = `${mins}:${secs}`;

    updateTimerUI(timeString, periodName, isBreak ? "休息中" : "進行中", progress);

    if (typeof socket !== 'undefined' && socket.connected) {
        socket.emit('timer_sync', {
            time: timeString,
            label: periodName,
            status: isBreak ? "break" : "class",
            progress: progress
        });
    }
}

function updateTimerUI(time, label, status, progress) {
    const timerDisplay = document.getElementById('timerDisplay');
    const periodLabel = document.getElementById('currentPeriodLabel');
    const statusBadge = document.getElementById('timerStatusBadge');
    const progressBar = document.getElementById('timerProgressBar');

    if (timerDisplay) timerDisplay.innerText = time;
    if (periodLabel) periodLabel.innerText = label;
    if (statusBadge) {
        statusBadge.innerText = status;
        statusBadge.className = status === "休息中" 
            ? "text-[10px] bg-green-900/30 text-green-400 px-2 py-1 rounded-md border border-green-500/30"
            : "text-[10px] bg-amber-900/30 text-amber-400 px-2 py-1 rounded-md border border-amber-500/30";
    }
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        progressBar.className = status === "休息中" ? "bg-green-500 h-full transition-all duration-1000" : "bg-amber-500 h-full transition-all duration-1000";
    }
}

// ==========================================
// 🚀 學生 AI 結算報告專屬處理邏輯
// ==========================================

function handleTutorReport(report) {
    // 核心隔離：如果報告的名字不在我們記錄的特約學生名單內，直接無視
    if (!knownTutorNames.has(report.name)) return;

    if (!window.tutorSessionSummaries[report.name]) {
        window.tutorSessionSummaries[report.name] = [];
    }
    
    // 避免重複接收同一份報告
    const exists = window.tutorSessionSummaries[report.name].some(r => r.timestamp === report.timestamp);
    if (!exists) {
        window.tutorSessionSummaries[report.name].unshift(report);
        addLog(`📄 學生 [${report.name}] 已結束自習並產生 AI 結算報告，得分：${report.score}`, "text-blue-400 font-bold");
        
        // 嘗試更新畫面
        renderTutorSummaryReports();
    }
}

// 監聽來自普通廣播或特約專屬廣播的報告
socket.on('teacher_receive_report', handleTutorReport);
socket.on('tutor_receive_report', handleTutorReport);

function renderTutorSummaryReports() {
    const container = document.getElementById('tab-summary');
    if (!container) return;

    let html = `<h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-800 pb-2">學員 AI 數據總結報告</h3>`;

    const names = Object.keys(window.tutorSessionSummaries);
    
    if (names.length === 0) {
        html += `<p class="text-slate-600 italic text-center py-8 text-xs">目前尚未有學員結束自習</p>`;
        container.innerHTML = html;
        return;
    }

    names.forEach(name => {
        const reports = window.tutorSessionSummaries[name];
        
        // 建立學生專屬的折疊外框 (Accordion)
        html += `
        <div class="mb-3 border border-blue-900/30 rounded-xl overflow-hidden bg-black/20">
            <button onclick="toggleTutorReport('${name}')" class="w-full bg-slate-800/40 p-3 flex justify-between items-center hover:bg-slate-700/50 transition-colors">
                <div class="flex items-center gap-3">
                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${name}" class="w-8 h-8 rounded-full border border-blue-500/30 bg-black/50">
                    <span class="font-bold text-white text-base">${name}</span>
                </div>
                <span class="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-1 rounded-full font-bold">查看 ${reports.length} 份報告</span>
            </button>
            <div id="report-content-${name}" class="hidden flex-col gap-3 p-3 bg-black/40">
        `;

        // 渲染該學生的每一份報告卡片
        reports.forEach(r => {
            // 處理違規明細
            let detailsHtml = "";
            if (r.details) {
                for (const [key, val] of Object.entries(r.details)) {
                    if (val > 0) {
                        detailsHtml += `
                        <div class="flex justify-between text-xs text-slate-400 mt-1.5 border-b border-slate-700/50 pb-1">
                            <span>${key}</span>
                            <span class="text-red-400 font-mono">${val} 次</span>
                        </div>`;
                    }
                }
            }

            html += `
                <div class="bg-slate-800/80 rounded-lg p-4 border border-slate-700 shadow-lg">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-xs text-slate-400 font-mono"><i class="fas fa-clock mr-1"></i>${r.timestamp || '未知時間'}</span>
                        <span class="text-amber-400 font-mono font-black text-lg">專注評分: ${r.score}</span>
                    </div>
                    
                    <div class="bg-black/30 rounded-lg p-3 mb-3 border border-white/5">
                        <div class="flex justify-between text-red-400 font-bold mb-2 border-b border-red-900/30 pb-2 text-sm">
                            <span>總違規次數</span>
                            <span>${r.violationCount ?? r.totalViolations ?? 0}</span>
                        </div>
                        ${detailsHtml || '<p class="text-green-500/70 text-xs text-center py-2 font-bold tracking-widest"><i class="fas fa-star mr-1"></i>無違規記錄，表現極佳！</p>'}
                    </div>
                    
                    <div class="text-blue-300 text-xs bg-blue-900/20 p-3 rounded-lg border-l-4 border-blue-500 italic leading-relaxed">
                        <p class="font-bold text-blue-400 mb-1 not-italic"><i class="fas fa-robot mr-1"></i> AI 老師真心話評語：</p>
                        ${r.aiComment || r.comment || '無'}
                    </div>
                </div>
            `;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
}


// 綁定全域函數供 HTML 的 onClick 點擊展開/收合使用
window.toggleTutorReport = function(name) {
    const content = document.getElementById(`report-content-${name}`);
    if (content) {
        content.classList.toggle('hidden');
        content.classList.toggle('flex');
    }
};

// 檔案末尾的初始化啟動
document.addEventListener('DOMContentLoaded', () => {
    setInterval(broadcastSchedule, 10000);
    initAutoTimer(); 
    
    // 🚀 修正防呆定時器：改為每隔 2 秒重新檢查並渲染學員畫面，確保超時 (10秒) 後狀態能即時刷回「專注中」
    setInterval(() => {
        if (activeStudents && activeStudents.length > 0) {
            renderStudents();
        }
    }, 2000);
});