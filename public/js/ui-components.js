/**
 * UI Components - 專門處理與畫面渲染、彈窗相關的邏輯
 */

// 宣告在全域，讓其他檔案可以存取
window.flipCountdownInterval = null;

window.showFlipCountdownModal = function() {
    let modal = document.getElementById('flipCountdownModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'flipCountdownModal';
        modal.className = 'fixed inset-0 z-[99999] bg-red-900/95 flex flex-col items-center justify-center backdrop-blur-lg transition-opacity duration-300';
        modal.innerHTML = `
            <div class="text-center animate-pulse">
                <i class="fas fa-mobile-alt text-8xl text-red-400 mb-6 drop-shadow-[0_0_30px_rgba(248,113,113,0.8)]"></i>
                <h1 class="text-4xl sm:text-6xl font-black text-white mb-6 tracking-widest text-red-500">警告：偵測到手機翻開！</h1>
                <p class="text-gray-200 text-xl sm:text-3xl mb-10 leading-relaxed">請在 <span id="flipCountdownText" class="text-yellow-400 font-mono font-black text-6xl sm:text-8xl mx-3 drop-shadow-md">5</span> 秒內將手機螢幕蓋回桌面<br>否則將強制退出教室並通報導師！</p>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    let secondsLeft = 5;
    const textEl = document.getElementById('flipCountdownText');
    if(textEl) textEl.innerText = secondsLeft;

    if (window.flipCountdownInterval) clearInterval(window.flipCountdownInterval);
    window.flipCountdownInterval = setInterval(() => {
        secondsLeft--;
        if(textEl) textEl.innerText = secondsLeft;
        if (secondsLeft <= 0) {
            clearInterval(window.flipCountdownInterval); 
        }
    }, 1000);
};

window.hideFlipCountdownModal = function() {
    let modal = document.getElementById('flipCountdownModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (window.flipCountdownInterval) clearInterval(window.flipCountdownInterval);
};

// ==========================================
// 公開處刑 Toast 通知 (Public Shaming Toast)
// ==========================================
window.showPublicShamingToast = function(userName) {
    const toast = document.createElement('div');
    toast.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-red-900/95 to-red-600/95 text-white px-6 py-3 rounded-full font-bold text-sm z-[9999] shadow-[0_0_20px_rgba(220,38,38,0.8)] flex items-center gap-3 animate-bounce';
    toast.innerHTML = `<i class="fas fa-skull-crossbones text-xl text-black"></i> <span>快看！<b>${userName}</b>剛剛放棄了專注！</span> <i class="fas fa-hand-point-down text-xl text-black"></i>`;
    document.body.appendChild(toast);
    
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2855/2855-preview.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {});
    
    setTimeout(() => toast.remove(), 5000);
};

// ==========================================
// 排行榜與其他學員畫面渲染
// ==========================================
window.renderRankAndUsers = function(users, myUsername, currentTeamLeader) {
    // 1. 更新自己的專注時間
    const me = users.find(u => u.name === myUsername);
    if (me) {
        const myFocusTimeEl = document.getElementById('myFocusTime');
        if (myFocusTimeEl) myFocusTimeEl.innerText = `${me.focusMinutes || 0}m`;
    }

    // 2. 渲染右側排行榜
    const rankContainer = document.getElementById("tab-rank");
    if (rankContainer) {
        const sortedUsers = [...users].sort((a, b) => (b.score || 0) - (a.score || 0));
        rankContainer.innerHTML = sortedUsers.map((u, index) => `
            <div class="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 mb-2 transition-all">
                <span class="font-mono font-bold ${index < 3 ? 'text-yellow-500' : 'text-gray-500'}">#${index + 1}</span>
                <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${u.name}" class="w-8 h-8 rounded-full border border-gray-700">
                <div class="flex-1 min-w-0">
                    <p class="text-xs font-bold text-white truncate">
                        ${u.name} 
                        ${(u.isCaptain || currentTeamLeader === u.name) ? '<i class="fas fa-crown text-yellow-400 ml-1" title="隊長"></i>' : ''}
                    </p>
                    <p class="text-[10px] text-blue-400 truncate">${u.status === 'BREAK' ? '🚽 暫時離開' : (u.goal || '專注中')}</p>
                </div>
                <div class="text-right">
                    <p class="text-xs font-mono text-gray-300">${u.focusMinutes || 0} min</p>
                    <div class="w-1.5 h-1.5 rounded-full ${u.status === 'FOCUSED' ? 'bg-green-500 shadow-[0_0_5px_#22c55e]' : (u.status === 'BREAK' ? 'bg-blue-500' : 'bg-red-500 shadow-[0_0_5px_#ef4444]')} ml-auto mt-1"></div>
                </div>
            </div>
        `).join('');
    }

    // 3. 渲染中央其他學員卡片
    const othersContainer = document.getElementById("othersContainer");
    if (othersContainer) {
        const others = users.filter(u => u.name !== myUsername);
        othersContainer.innerHTML = others.map(u => {
            if (u.isFlipped) {
                return `
                <div id="user-card-${u.name}" class="relative flex flex-col items-center justify-center p-2 w-full animate-fade-in transition-all duration-300" style="aspect-ratio: 3/4; background: transparent; border: none; box-shadow: none;">
                    <div class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-blue-500 shadow-lg flex-shrink-0 bg-gray-800 flex items-center justify-center overflow-visible">
                        <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${u.name}" alt="Avatar" class="w-full h-full object-cover rounded-full m-0 p-0">
                        <div class="absolute -bottom-1 -right-1 bg-blue-600 rounded-full w-8 h-8 border-2 border-[#05070a] flex items-center justify-center z-10">
                            <i class="fas fa-mobile-alt text-white text-[14px]"></i>
                        </div>
                    </div>
                    <div class="mt-4 text-center z-10 w-full">
                        <div class="text-base sm:text-lg font-bold text-white drop-shadow-md truncate w-full px-2">${u.name}</div>
                        <div class="text-sm text-gray-400 font-semibold drop-shadow-md mt-1 flex items-center justify-center gap-1">
                            <i class="fas fa-clock"></i> ${u.focusMinutes || 0} min
                        </div>
                    </div>
                </div>`;
            } else {
                return `
                <div id="user-card-${u.name}" class="relative w-full h-full flex items-center justify-center animate-fade-in bg-transparent">
                    <div class="inner-card relative h-fit w-fit min-w-[160px] max-w-[180px] bg-[#111827] rounded-2xl shadow-2xl border border-gray-700/50 flex flex-col items-center gap-2.5 py-4 px-3 transition-all duration-300 hover:border-blue-400/50">
                        <div class="relative w-16 h-16 rounded-full border-2 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)] flex-shrink-0 bg-gray-800 flex items-center justify-center z-10">
                            <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${u.name}" alt="Avatar" class="w-full h-full object-cover rounded-full m-0 p-0">
                        </div>
                        <div class="flex flex-col items-center w-full space-y-1.5 z-10">
                            <div class="text-base font-bold text-white truncate w-full text-center px-1">${u.name}</div>
                            <div class="w-full bg-blue-900/30 text-blue-200 text-xs px-2 py-1.5 rounded border border-blue-500/30 text-center whitespace-nowrap overflow-hidden text-ellipsis shadow-inner">
                                🎯 ${u.goal || '專注進行中...'}
                            </div>
                            <div class="w-full bg-green-500/10 text-green-400 text-xs px-2 py-1 rounded-full border border-green-500/30 flex items-center justify-center gap-1.5 shadow-inner whitespace-nowrap">
                                <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0"></div>
                                <span class="font-bold tracking-wider truncate">${u.status === 'FOCUSED' ? '深度專注中' : (u.status || '連線中')}</span>
                            </div>
                            <div class="text-sm text-gray-400 font-bold flex items-center justify-center gap-1 whitespace-nowrap w-full">
                                <i class="fas fa-clock text-gray-500"></i> ${u.focusMinutes || 0} 分鐘
                            </div>
                        </div>
                    </div>
                </div>`;
            }
        }).join('');
    }
};

// ==========================================
// 頂部模式標籤與黑板顯示切換
// ==========================================
window.updateUIMode = function(mode, isAuditMode) {
    const modeLabel = document.getElementById("modeLabel");
    const blackboard = document.getElementById("blackboard");
    const breakButtons = document.getElementById("breakButtons");

    if (!modeLabel) return;
    
    if (isAuditMode) {
        modeLabel.innerText = "🛡️ 隊長審核模式 (AI 豁免)";
        modeLabel.className = "text-[9px] bg-yellow-600/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-bold uppercase";
        if(blackboard) blackboard.classList.remove('hidden');
        if(breakButtons) breakButtons.classList.add('hidden'); 
        return;
    }

    switch(mode) {
        case '2': 
            modeLabel.innerText = "MODE: 沉浸式自習 (嚴格)";
            modeLabel.className = "text-[9px] bg-purple-600/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-bold uppercase";
            if(blackboard) blackboard.classList.add('hidden');
            if(breakButtons) breakButtons.classList.add('hidden');
            break;
        case 'simulated': 
            modeLabel.innerText = "MODE: 模擬線上教室 (連動中)";
            modeLabel.className = "text-[9px] bg-blue-600/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold uppercase";
            if(blackboard) blackboard.classList.remove('hidden');
            if(breakButtons) breakButtons.classList.remove('hidden'); 
            break;
        case 'tutor': 
            modeLabel.innerText = "MODE: VIP 特約指導教室";
            modeLabel.className = "text-[9px] bg-amber-600/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold uppercase";
            if(blackboard) blackboard.classList.remove('hidden');
            if(breakButtons) breakButtons.classList.add('hidden'); 
            break;
        case '1': 
            modeLabel.innerText = "MODE: 線上課程 (寬鬆)";
            modeLabel.className = "text-[9px] bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold uppercase";
            if(blackboard) blackboard.classList.add('hidden');
            if(breakButtons) breakButtons.classList.add('hidden');
            break;
        default:
            modeLabel.innerText = "MODE: 一般自習";
    }
};

// ==========================================
// 結算報告彈窗渲染 (Summary Modal)
// ==========================================
window.renderSummaryModal = function(result, report, elapsedMinutes) {
    const breakdown = result.breakdown;

    const timeEl = document.getElementById('summary-time');
    if(timeEl) timeEl.innerText = `${elapsedMinutes} min`;

    const integrityEl = document.getElementById('summary-integrity');
    if (integrityEl) integrityEl.innerText = report.score;

    const commentEl = document.getElementById('summary-ai-comment');
    if (commentEl) commentEl.innerText = report.comment;

    const baseExpEl = document.getElementById('summary-base-exp');
    if (baseExpEl) baseExpEl.innerText = `+${breakdown?.baseExp ?? 0}`;
    
    const finalExpEl = document.getElementById('summary-final-exp');
    if(finalExpEl) finalExpEl.innerText = result.earned || 0;

    const rowFlow = document.getElementById('row-flow-multiplier');
    if (rowFlow) {
        const flowMul = Number(breakdown?.multipliers?.flow ?? 1.0);
        if (flowMul > 1.0) {
            document.getElementById('summary-flow').innerText = `x${flowMul}`;
            rowFlow.classList.remove('hidden');
            rowFlow.classList.add('flex');
        } else {
            rowFlow.classList.add('hidden');
            rowFlow.classList.remove('flex');
        }
    }

    const rowTeam = document.getElementById('row-team-multiplier');
    if (rowTeam) {
        const teamMul = Number(breakdown?.multipliers?.team ?? 1.0);
        if (teamMul > 1.0) {
            document.getElementById('summary-team').innerText = `x${teamMul}`;
            rowTeam.classList.remove('hidden');
            rowTeam.classList.add('flex');
        } else {
            rowTeam.classList.add('hidden');
            rowTeam.classList.remove('flex');
        }
    }

    const rowPenalty = document.getElementById('row-penalty');
    if (rowPenalty) {
        const penaltyValue = Number(breakdown?.penalty ?? 0);
        const detailsContainer = document.getElementById('penalty-details');
        if (detailsContainer) detailsContainer.innerHTML = ''; 

        if (penaltyValue > 0) {
            const penaltyTextEl = document.getElementById('summary-penalty');
            if (penaltyTextEl) penaltyTextEl.innerText = `-${penaltyValue}`;

            rowPenalty.classList.remove('hidden');
            rowPenalty.classList.add('flex');

            if (detailsContainer) {
                const items = Array.isArray(breakdown?.penaltyDetails) ? breakdown.penaltyDetails : [];
                for (const item of items) {
                    const reason = item?.reason ?? '';
                    const count = Number(item?.count ?? 0);
                    const points = Number(item?.points ?? 0);

                    detailsContainer.insertAdjacentHTML(
                        'beforeend',
                        `<div class="flex justify-between text-red-400">
                            <span>${reason} x${count}</span>
                            <span>-${points}</span>
                        </div>`
                    );
                }
            }
        } else {
            rowPenalty.classList.add('hidden');
            rowPenalty.classList.remove('flex');
        }
    }

    const modal = document.getElementById('summary-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex'); 
    }
};