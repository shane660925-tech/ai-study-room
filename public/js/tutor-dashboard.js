/**
 * tutor-dashboard.js
 * StudyVerse VIP - 導師控制台專用邏輯
 */

const socket = io();

// 全域變數供 Socket 與 UI 同步使用
window.currentTutorRoomCode = new URLSearchParams(window.location.search).get('room');
window.currentScheduleData = null; 
window.currentScheduleText = "";

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
    
    // 3. 等 Socket 連線後，補發送給伺服器，讓學生端同步
    // 加入房間，角色設為 teacher
    socket.emit('join_tutor_room', { room: roomCode, role: 'teacher' });

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
    activeStudents = users.filter(s => s.roomMode === 'tutor');
    activeStudents.forEach(s => knownTutorNames.add(s.name));
    if (typeof renderStudents === 'function') renderStudents();
});

socket.on('receive_tutor_announcement', (data) => {
    const blackboardContent = document.getElementById('blackboardContent');
    if (blackboardContent) {
        blackboardContent.innerText = data.message;
    }
});

// ==========================================
// 3. 導師操作功能
// ==========================================

// 🚀 新增與修正：教師端發送大喇叭廣播
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
        socket.emit('send_tutor_announcement', { message: msg });
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
    socket.emit('update_blackboard', { message: text });
    addLog(`發布黑板公告：${text}`, "text-amber-400");
    document.getElementById('announcementInput').value = '';
};

window.rollCall = function() {
    addLog("發起全班點名...", "text-blue-400");
    socket.emit('tutor_command', { command: 'rollCall' }); 
    alert("已向全班發送點名要求！");
};

window.patrolRoom = function() {
    addLog("啟動線上隨機巡堂模式...", "text-purple-400");
    alert("正在連線學員鏡頭/畫面 (模擬功能)...");
};

window.assignTask = function() {
    const target = document.getElementById('targetStudentInput').value.trim();
    if (!target) return alert("請先在上方輸入目標學生姓名或ID！");
    addLog(`向 [${target}] 指派專屬任務`, "text-blue-400");
    const taskData = { targetName: target, task: '請回報目前進度' };
    socket.emit('tutor_assign_task', taskData);
    socket.emit('assign_task', taskData);
    socket.emit('receive_task', taskData); 
};

window.sendWarning = function(studentName = null) {
    const target = studentName || document.getElementById('targetStudentInput').value.trim();
    if (!target) return alert("請先輸入或選擇目標學生！");
    if(confirm(`確定要對 ${target} 發送重大違規警告嗎？他的畫面將會閃爍紅光。`)) {
        const warningData = { targetName: target, reason: "導師手動觸發：偵測到您有嚴重分心行為！" };
        socket.emit('tutor_warn_student', warningData);
        socket.emit('send_warning', warningData);
        socket.emit('receive_warning', warningData);
        addLog(`已對 [${target}] 發出嚴重紅光警告！`, "text-red-500 font-bold");
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
    const filteredStudents = activeStudents;
    document.getElementById('onlineCount').innerText = filteredStudents.length;

    if (filteredStudents.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-gray-500 font-bold"><i class="fas fa-ghost text-3xl mb-4 text-amber-500/30"></i><p>目前此區間沒有學員在線</p></div>`;
        return;
    }

    grid.innerHTML = '';
    filteredStudents.forEach(student => {
        const isStandalone = student.isStandalone || false;
        const deviceIcon = isStandalone ? '<i class="fas fa-mobile-alt text-amber-500"></i>' : '<i class="fas fa-desktop text-blue-400"></i>';
        const isWarning = student.distractions && student.distractions > 3; 
        const statusBorder = isWarning ? 'border-red-500/50 shadow-[0_0_15px_rgba(220,38,38,0.2)]' : 'border-amber-500/20';
        const statusText = isWarning ? '<span class="text-red-400 font-bold text-xs">需注意</span>' : '<span class="text-green-400 font-bold text-xs">專注中</span>';

        const card = document.createElement('div');
        card.className = `bg-[#0a0e17] rounded-xl p-5 flex flex-col justify-between ${statusBorder} border transition-all hover:scale-[1.02]`;
        card.innerHTML = `
            <div>
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-3">
                        <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${student.name}" class="w-12 h-12 rounded-full bg-black border-2 border-amber-500/30">
                        <div><h3 class="font-bold text-white text-lg flex items-center gap-2">${student.name} ${deviceIcon}</h3><p class="text-[10px] text-gray-400">目前分數：<span class="text-amber-400 font-mono">${student.score || 0}</span></p></div>
                    </div>
                    ${statusText}
                </div>
                <div class="bg-black/40 p-3 rounded-lg border border-amber-500/10 mb-4">
                    <p class="text-[10px] text-amber-500/50 uppercase font-bold mb-1">今日目標</p>
                    <p class="text-sm text-gray-200 truncate">${student.goal || '未設定目標'}</p>
                </div>
            </div>
            <div class="flex gap-2 mt-auto pt-4 border-t border-amber-500/10">
                <button onclick="sendWarning('${student.name}')" class="flex-1 bg-red-900/20 hover:bg-red-600/80 text-red-400 hover:text-white py-2 rounded-lg text-xs font-bold border border-red-900/50 transition-colors">警告</button>
            </div>`;
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
    const now = new Date();
    const nowTime = now.toLocaleTimeString('zh-TW', { hour12: false });
    const noImageKeywords = ['翻開', '翻轉', '分頁', 'tab', '離開', '手動', '警告', '導師'];
    const isNoImage = noImageKeywords.some(keyword => type.includes(keyword));
    const finalImg = isNoImage ? null : img;
    const isDuplicate = violationStorage[studentName].some(v => v.type === type && (now.getTime() - v.rawTime < 3000));
    if (isDuplicate) return;

    violationStorage[studentName].unshift({ time: nowTime, rawTime: now.getTime(), type: type, img: finalImg });
    addLog(`🚨 系統攔截：${studentName} - ${type}`, "text-red-400 font-bold");
    renderViolationsList();
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
    if (activeStudents.some(s => s.name === name)) saveAndRenderViolation(name, "📱 翻轉中斷 (手機面朝上)", null);
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
    document.getElementById('tutorModalImg').src = imgSrc;
    document.getElementById('tutorModalName').innerText = `違規學員：${name}`;
    document.getElementById('tutorModalReason').innerText = `判定原因：${reason}`;
    modal.classList.replace('hidden', 'flex');
}
window.closeTutorImageModal = function() {
    const modal = document.getElementById('tutorImageModal');
    if (modal) modal.classList.replace('flex', 'hidden');
}

// ==========================================
// 8. 修正：排程顯示與廣播邏輯 (封裝 UI 更新)
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

        // 立即執行一次廣播
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
// 🚀 步驟 2 修正：自動排程計時系統 (動態讀取版)
// ==========================================

function getLiveScheduleConfig() {
    const displayExt = document.getElementById('teacherScheduleDisplay')?.innerText || "";
    
    let config = {
        totalPeriods: 3,
        classDuration: 20 * 60, // 預設值改為 20 分鐘
        breakDuration: 10 * 60,
        startTime: new Date().getTime() 
    };

    // 嘗試從文字解析開始時間 (例如: "14:02~15:22")
    const timeMatch = displayExt.match(/(\d{2}):(\d{2})~/);
    if (timeMatch) {
        const startDay = new Date();
        startDay.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        config.startTime = startDay.getTime();
    }

    // 嘗試解析幾節課與分鐘數
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
    // 每次計算時都動態抓取最新的設定
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

    if (currentPeriod > SESSION_CONFIG.totalPeriods) {
        updateTimerUI("00:00", "課程結束", "已完成", 100);
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

// 檔案末尾的初始化啟動
document.addEventListener('DOMContentLoaded', () => {
    setInterval(broadcastSchedule, 10000);
    initAutoTimer(); // 啟動計時器
});