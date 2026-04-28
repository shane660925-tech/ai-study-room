/**
 * StudyVerse Pro - 教師端核心邏輯 (admin.js)
 * 負責監聽 Socket 事件、管理學生狀態、違規紀錄及結算報告。
 * [V2.2.5 新增] 教室分類過濾功能
 */

const socket = io();
let students = [];
let notifiedMilestones = new Set();
let violationStorage = {}; 
let sessionSummaries = []; // 儲存學生結算報告
let currentRoomFilter = 'ALL'; // 記錄目前觀看的教室模式

// --- 1. 初始化系統時鐘 ---
function initClock() {
    const clockEl = document.getElementById('systemClock');
    if (clockEl) {
        setInterval(() => {
            clockEl.innerText = new Date().toLocaleString('zh-TW', { hour12: false });
        }, 1000);
    }
}

// --- 2. Socket 事件監聽 ---

socket.on('update_rank', (data) => {
    // 🚀 核心隔離：正確使用 roomMode 判斷，過濾掉特約教室 ('tutor') 的學生
    const normalStudents = data.filter(s => s.roomMode !== 'tutor');
    
    normalStudents.forEach(s => {
        const oldStudent = students.find(os => os.name === s.name);
        
        if (!oldStudent) {
            triggerAISocial(s.name, 'ENTER');
        } else {
            if (oldStudent.isFlipped === true && s.isFlipped === false) {
                handleFlipViolation(s.name);
            }
            checkMilestones(s);
        }
    });
    // 僅儲存非特約教室的學生
    students = normalStudents;

    // 🚀 修復問題1：呼叫正確的渲染函數，讓教師一進畫面就立刻看到學生！
    renderStudentGrid(); 
    if (typeof renderSummary === 'function') renderSummary();
});

socket.on('teacher_update', (data) => {
    if (data.logs) renderLogs(data.logs);
    if (data.snaps) {
        data.snaps.forEach(snap => {
            // 🚀 核心隔離：如果違規學生的名字「不在」普通學生名單內 (代表他是特約學生)，直接無視！
            if (!students.some(s => s.name === snap.name)) return;

            if (!violationStorage[snap.name]) violationStorage[snap.name] = [];
            const exists = violationStorage[snap.name].some(v => v.time === snap.time && v.reason === snap.reason);
            if (!exists) violationStorage[snap.name].unshift(snap);
        });
        renderViolations();
    }
});

socket.on('teacher_receive_report', (report) => {
    // 🚀 核心隔離：如果提交報告的不是普通學生，直接無視！
    if (!students.some(s => s.name === report.name)) return;

    console.log("收到結算報告:", report);
    const exists = sessionSummaries.some(s => s.name === report.name && s.timestamp === report.timestamp);
    if (!exists) {
        sessionSummaries.unshift(report);
    }
    addSystemLog(`學生 [${report.name}] 已提交結算報告，得分：${report.score}`, 'yellow');
    renderSummaryReports();
});

// --- 3. 邏輯處理函數 ---

function checkMilestones(s) {
    if (s.focusMinutes >= 50 && !notifiedMilestones.has(s.name + '_50')) {
        triggerAISocial(s.name, 'FOCUS_50');
        notifiedMilestones.add(s.name + '_50');
    } else if (s.focusMinutes >= 30 && !notifiedMilestones.has(s.name + '_30')) {
        triggerAISocial(s.name, 'FOCUS_30');
        notifiedMilestones.add(s.name + '_30');
    }
}

function handleFlipViolation(name) {
    const time = new Date().toLocaleTimeString('zh-TW', {hour12:false});
    socket.emit('admin_action', { 
        type: 'WAKEUP', 
        target: name, 
        message: '🚨 系統警告：偵測到手機已翻開！請維持專注。' 
    });

    addSystemLog(`學生 [${name}] 擅自翻開手機，已自動發送警告。`, 'red');

    if (!violationStorage[name]) violationStorage[name] = [];
    violationStorage[name].unshift({
        name: name,
        time: time,
        reason: '擅自翻開手機',
        image: null
    });
    renderViolations();
}

function addSystemLog(msg, colorType = 'blue') {
    const logContainer = document.getElementById('logContainer');
    if (!logContainer) return;

    const time = new Date().toLocaleTimeString('zh-TW', {hour12:false});
    let colorClass = "text-blue-300 border-l-blue-500 bg-blue-500/5";
    if (colorType === 'red') colorClass = "text-red-400 border-l-red-500 bg-red-500/10";
    if (colorType === 'yellow') colorClass = "text-yellow-400 border-l-yellow-500 bg-yellow-500/5";

    const logHtml = `
        <div class="ai-log font-bold ${colorClass}">
            <div class="flex items-center gap-2 mb-1">
                <i class="fas fa-robot"></i>
                <span class="text-slate-500">[${time}] 系統通知</span>
            </div>
            ${msg}
        </div>`;
    logContainer.insertAdjacentHTML('afterbegin', logHtml);
}

function triggerAISocial(name, type) {
    const time = new Date().toLocaleTimeString('zh-TW', {hour12:false});
    let msg = "";
    let icon = "fa-robot";
    if (type === 'ENTER') msg = `歡迎 [${name}] 進入教室同步學習。`;
    if (type === 'FOCUS_30') { msg = `[${name}] 已進入深度專注 (30min+)，表現優秀！`; icon = "fa-fire"; }
    if (type === 'FOCUS_50') { msg = `驚人毅力！[${name}] 連續專注已達 50 分鐘。`; icon = "fa-trophy"; }
    addSystemLog(msg, 'blue');
}

// --- [V2.2.5 新增] 教室篩選邏輯 ---
window.setRoomFilter = function(mode) {
    currentRoomFilter = mode;
    
    // 更新按鈕的視覺樣式
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.id === `filter-${mode}`) {
            btn.className = "filter-btn px-4 py-1.5 rounded-full text-xs font-bold bg-blue-600 text-white shadow shadow-blue-500/20 transition-all";
        } else {
            btn.className = "filter-btn px-4 py-1.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-all border border-slate-700";
        }
    });
    
    // 重新渲染畫面
    renderStudentGrid();
};

// --- 4. 畫面渲染函數 ---

function renderStudentGrid() {
    const grid = document.getElementById('studentGrid');
    if (!grid) return;

    // [核心] 根據選中的頁籤過濾學生名單
    const filteredStudents = students.filter(s => currentRoomFilter === 'ALL' || s.roomMode === currentRoomFilter);

    if (filteredStudents.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-20 text-slate-500 italic font-bold">目前此分類下無學生在線</div>`;
        return;
    }

    grid.innerHTML = filteredStudents.map(s => {
        const isDistracted = s.status === 'DISTRACTED' || s.status === 'SLEEPING';
        const isFlipped = s.isFlipped === true;
        const goalText = s.goal || "尚未設定目標";
        
        // 判斷該學生所屬教室的標籤顏色
        let roomBadge = "";
        if (s.roomMode === '2') roomBadge = `<span class="bg-purple-500/20 text-purple-400 border border-purple-500/30 text-[9px] px-2 py-0.5 rounded font-bold">沉浸式</span>`;
        else if (s.roomMode === 'simulated') roomBadge = `<span class="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[9px] px-2 py-0.5 rounded font-bold">模擬教室</span>`;
        else if (s.roomMode === '1') roomBadge = `<span class="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-[9px] px-2 py-0.5 rounded font-bold">線上課程</span>`;
        else roomBadge = `<span class="bg-gray-500/20 text-gray-400 border border-gray-500/30 text-[9px] px-2 py-0.5 rounded font-bold">一般</span>`;

        return `
        <div class="student-card bg-slate-800/40 rounded-3xl p-6 border-2 transition-all duration-500 relative ${isDistracted ? 'violation-card border-red-500/50' : (isFlipped ? 'flip-active border-blue-500' : 'border-slate-700')}">
            <div class="flex items-center gap-4 mb-5">
                <div class="relative">
                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${s.name}" class="w-14 h-14 rounded-full border-2 border-slate-600 bg-slate-900 shadow-xl">
                    <div class="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-slate-800 ${isDistracted ? 'bg-red-500' : 'bg-green-500'}"></div>
                </div>
                <div class="overflow-hidden flex-1">
                    <div class="flex justify-between items-center mb-1">
                        <p class="text-base font-black text-white truncate">${s.name}</p>
                        ${roomBadge}
                    </div>
                    <p class="text-[10px] text-blue-400 font-bold tracking-tighter">${isFlipped ? '手機已翻轉進入深度專注' : '一般模式'}</p>
                </div>
            </div>

            <div class="flex-1 bg-black/20 rounded-xl p-3 mb-5 border border-white/5">
                <p class="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                    <i class="fas fa-bullseye text-blue-500"></i> 當前學習目標
                </p>
                <p class="text-xs text-slate-300 leading-relaxed font-medium line-clamp-3">
                    ${goalText}
                </p>
            </div>

            <div class="space-y-3">
                <div class="flex justify-between items-end">
                    <div class="flex flex-col">
                        <span class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Focus Time</span>
                        <span class="font-mono text-2xl font-black text-white">${s.focusMinutes}<span class="text-[10px] ml-1 text-slate-400">min</span></span>
                    </div>
                    <div class="text-right">
                        <span class="text-[9px] font-black px-3 py-1 rounded-full border ${isDistracted ? 'bg-red-500/10 text-red-500 border-red-500/20 status-pulse' : 'bg-green-500/10 text-green-500 border-green-500/20'} uppercase tracking-tighter">
                            ${s.status}
                        </span>
                    </div>
                </div>
                
                ${isDistracted ? `
                <button onclick="remoteWakeup('${s.name}')" class="w-full bg-yellow-500 hover:bg-yellow-400 text-slate-900 text-[10px] font-black py-2.5 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2">
                    <i class="fas fa-hand-pointer"></i> 發送震動提醒
                </button>
                ` : ''}
            </div>
        </div>`;
    }).join('');
}

function renderViolations() {
    const container = document.getElementById('tab-violations');
    if(!container) return;
    const names = Object.keys(violationStorage);
    
    if (names.length === 0) {
        container.innerHTML = `<p class="text-[10px] text-slate-500 text-center py-20 italic">目前無異常行為紀錄</p>`;
        return;
    }

    container.innerHTML = names.map(name => {
        const records = violationStorage[name];
        return `
        <div class="user-group-container animate-fade-in">
            <div onclick="toggleUserGroup('${name}')" class="p-3 bg-slate-800/60 flex justify-between items-center cursor-pointer hover:bg-slate-700 transition-colors">
                <div class="flex items-center gap-3">
                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${name}" class="w-6 h-6 rounded-full bg-slate-900 border border-slate-700">
                    <span class="text-xs font-black text-white">${name}</span>
                    <span class="text-[9px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-bold uppercase tracking-tighter">${records.length} 項紀錄</span>
                </div>
                <i id="group-icon-${name}" class="fas fa-chevron-down text-[10px] text-slate-500 transition-transform"></i>
            </div>
            <div id="group-content-${name}" class="group-items-box">
                ${records.map((snap, idx) => {
                    const uniqueID = `${name.replace(/\s+/g, '')}-${idx}`;
                    const isFlipError = snap.reason === '擅自翻開手機';
                    // 🚀 修正標籤字眼，將「分心」與其他需要截圖的重大違規一同標記為紅色警告
                    const isCritical = isFlipError || ['離位', '離座', '趴睡', '手機', '分心'].some(k => snap.reason.includes(k));
                    const badgeColor = isCritical ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/20';
                    
                    return `
                    <div class="border-t border-white/5">
                        <div onclick="toggleDetail('${uniqueID}')" class="p-3 pl-6 flex justify-between items-center cursor-pointer hover:bg-white/5 transition-colors">
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] font-mono text-slate-500">${snap.time}</span>
                                <span class="text-[10px] border ${badgeColor} px-2 py-0.5 rounded italic font-medium tracking-tighter">${snap.reason}</span>
                            </div>
                            <i id="detail-icon-${uniqueID}" class="fas fa-plus text-[8px] text-slate-600 transition-transform"></i>
                        </div>
                        <div id="detail-content-${uniqueID}" class="expand-content bg-black/20">
                            ${snap.image ? `
                                <div class="space-y-3">
                                    <img src="${snap.image}" class="w-full rounded-lg border border-white/10 cursor-zoom-in hover:opacity-80 transition-all shadow-inner" 
                                         onclick="openImageModal('${snap.image}', '${name}', '${snap.reason}')">
                                    <p class="text-[9px] text-slate-500 italic text-center">影像證據</p>
                                </div>
                            ` : `
                                <div class="flex gap-4 items-center py-2 px-1">
                                    <i class="fas ${isFlipError ? 'fa-exclamation-circle text-red-500' : 'fa-info-circle text-blue-500'} text-xs"></i>
                                    <div class="text-[10px] text-slate-400 leading-relaxed">
                                        ${isFlipError ? '學生在深度專注期間翻轉手機，系統已自動介入處理。' : '系統自動紀錄之行為事件。'}
                                        <span class="block text-[9px] mt-1 text-slate-600 italic uppercase">Log recorded automatically</span>
                                    </div>
                                </div>
                            `}
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderSummaryReports() {
    const list = document.getElementById('summaryReportsList');
    if (!list) return;
    if (sessionSummaries.length === 0) return;

    list.innerHTML = sessionSummaries.map((r) => {
        let detailsHtml = "";
        if (r.details) {
            for (const [key, val] of Object.entries(r.details)) {
                if (val > 0) detailsHtml += `<div class="flex justify-between text-[9px] text-slate-500 mt-1"><span>${key}</span><span>${val} 次</span></div>`;
            }
        }

        return `
        <div class="summary-report-card">
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2">
                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${r.name}" class="w-6 h-6 rounded-full border border-white/20">
                    <span class="text-white font-bold">${r.name}</span>
                </div>
                <div class="text-right">
                     <span class="text-blue-400 font-mono font-bold">SCORE: ${r.score}</span>
                     <p class="text-[8px] text-slate-500">${r.timestamp || ''}</p>
                </div>
            </div>
            <p class="text-slate-300 text-[10px] bg-blue-500/10 p-2 rounded-lg mb-2 italic border-l-2 border-blue-500">
                <i class="fas fa-robot mr-1 text-blue-400"></i> AI 評語: ${r.aiComment || r.comment || '無'}
            </p>
            <div class="bg-black/20 rounded p-2 border border-white/5">
                <div class="flex justify-between text-red-500 font-bold mb-1 border-b border-white/5 pb-1">
                    <span>總違規次數</span>
                    <span>${r.violationCount ?? r.totalViolations ?? 0}</span>
                </div>
                ${detailsHtml || '<p class="text-green-500/70 text-[8px] text-center">本次自習表現極佳，無違規記錄</p>'}
            </div>
        </div>`;
    }).join('');
}

function renderLogs(logs) {
    const logContainer = document.getElementById('logContainer');
    if(!logContainer) return;
    const logItems = logs.map(l => `<div class="py-1 border-b border-white/5 opacity-70">>> ${l}</div>`).join('');
    logContainer.innerHTML = logItems;
    if (logContainer.scrollHeight - logContainer.scrollTop < 500) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

function renderSummary() {
    const summaryContainer = document.getElementById('summaryStats');
    if(!summaryContainer) return;
    if (students.length === 0) {
        summaryContainer.innerHTML = '<p class="text-xs text-slate-500 italic">等待數據中...</p>';
        return;
    }
    const focusCount = students.filter(s => s.status === 'FOCUSED').length;
    const focusRate = ((focusCount / students.length) * 100).toFixed(0);
    summaryContainer.innerHTML = `
        <div class="bg-slate-800 p-5 rounded-2xl border border-slate-700 shadow-xl">
            <p class="text-[10px] text-slate-400 mb-2 font-black uppercase tracking-widest">班級專注率</p>
            <div class="flex items-end gap-3">
                <p class="text-3xl font-black text-green-400">${focusRate}%</p>
                <span class="text-[10px] text-slate-500 pb-1 italic">Real-time monitoring</span>
            </div>
            <div class="w-full bg-slate-900 h-1.5 rounded-full mt-4 overflow-hidden">
                <div class="bg-green-500 h-full transition-all duration-1000" style="width: ${focusRate}%"></div>
            </div>
        </div>
    `;
}

// --- 5. UI 按鈕事件綁定到 Global (供 HTML 呼叫) ---
window.toggleUserGroup = function(name) {
    const content = document.getElementById(`group-content-${name}`);
    const icon = document.getElementById(`group-icon-${name}`);
    content.classList.toggle('active');
    icon.style.transform = content.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
};

window.toggleDetail = function(uniqueID) {
    const content = document.getElementById(`detail-content-${uniqueID}`);
    const icon = document.getElementById(`detail-icon-${uniqueID}`);
    content.classList.toggle('show');
    icon.className = content.classList.contains('show') ? "fas fa-minus text-[8px] text-slate-600 transition-transform" : "fas fa-plus text-[8px] text-slate-600 transition-transform";
};

window.openImageModal = function(img, name, reason) {
    document.getElementById('modalImg').src = img;
    document.getElementById('modalName').innerText = name;
    document.getElementById('modalReason').innerText = `異常行為：${reason}`;
    document.getElementById('imageModal').classList.remove('hidden');
};

window.closeImageModal = function() {
    document.getElementById('imageModal').classList.add('hidden');
};

window.updateBlackboard = function() {
    const text = document.getElementById('announcementInput').value;
    if (!text.trim()) return alert('請輸入公告內容');
    socket.emit('admin_action', { type: 'BLACKBOARD', content: text });
    document.getElementById('logContainer').insertAdjacentHTML('afterbegin', `<p class="text-green-400 text-[10px] font-bold">[系統] 已同步黑板公告</p>`);
    document.getElementById('announcementInput').value = '';
};

window.remoteWakeup = function(name) { 
    socket.emit('admin_action', { type: 'WAKEUP', target: name }); 
};

window.playChime = function() { 
    if(confirm('要對全體學生播放下課鈴聲嗎？')) socket.emit('admin_action', { type: 'PLAY_SOUND', sound: 'chime' }); 
};

window.exportCSV = function() {
    let csv = "\ufeff姓名,教室,專注分鐘,手機翻轉,當前狀態\n";
    students.forEach(s => {
        let roomName = s.roomMode === '2' ? '沉浸式' : (s.roomMode === 'simulated' ? '模擬教室' : (s.roomMode === '1' ? '線上課程' : '一般'));
        csv += `${s.name},${roomName},${s.focusMinutes},${s.isFlipped?'是':'否'},${s.status}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `學情報表_${new Date().toLocaleDateString()}.csv`; 
    a.click();
};

window.switchTab = function(tab) {
    document.getElementById('tab-violations').classList.toggle('hidden', tab !== 'violations');
    document.getElementById('tab-summary').classList.toggle('hidden', tab !== 'summary');
    
    const btnV = document.getElementById('btn-violations');
    const btnS = document.getElementById('btn-summary');
    
    if(tab === 'violations') {
        btnV.className = "flex-1 py-4 text-[10px] font-black border-b-2 border-blue-500 text-blue-500 transition-all uppercase";
        btnS.className = "flex-1 py-4 text-[10px] font-black text-slate-500 border-b-2 border-transparent transition-all uppercase";
    } else {
        btnS.className = "flex-1 py-4 text-[10px] font-black border-b-2 border-blue-500 text-blue-500 transition-all uppercase";
        btnV.className = "flex-1 py-4 text-[10px] font-black text-slate-500 border-b-2 border-transparent transition-all uppercase";
        renderSummaryReports();
    }
};

// --- 6. 初始化啟動 ---
window.onload = () => {
    initClock();
    console.log("StudyVerse Admin Logic Initialized.");
};