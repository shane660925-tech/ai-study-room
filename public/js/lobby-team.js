/**
 * StudyVerse V2.2.5.6 - 組隊大廳邏輯 (lobby-team.js)
 * 依賴：需先載入 lobby-core.js
 */

window.pageSpecificInit = function() {
    // 預留初始化
};

window.isJoinCancelled = false; // 🎯 [防呆新增] 紀錄使用者是否已經中途取消申請

// ==========================================
// [新增] 動態建立「等待隊長審核」彈窗
// ==========================================
function showWaitingModal(teamName) {
    let modal = document.getElementById('waitingApprovalModal');
    if (!modal) {
        const modalHtml = `
        <div id="waitingApprovalModal" class="fixed inset-0 bg-[#05070a]/90 backdrop-blur-md z-[10005] hidden items-center justify-center">
            <div class="bg-[#111827] w-full max-w-sm rounded-3xl border border-blue-500/30 shadow-[0_0_40px_rgba(56,189,248,0.2)] flex flex-col items-center text-center p-8 transform transition-all">
                <div class="w-20 h-20 bg-blue-900/30 rounded-full flex items-center justify-center mb-6 border-2 border-blue-500/50 relative">
                    <i class="fas fa-hourglass-half text-blue-400 text-3xl animate-pulse"></i>
                    <div class="absolute inset-0 border-4 border-transparent border-t-blue-400 rounded-full animate-spin"></div>
                </div>
                <h2 class="text-2xl font-black text-white mb-2">等待隊長審核</h2>
                <p class="text-sm text-gray-400 leading-relaxed mb-6">您已申請加入 <span class="text-orange-400 font-bold" id="waitingTeamName"></span><br>請稍候，隊長正在確認您的請求...</p>
                <button onclick="cancelJoinRequest()" class="w-full py-3 rounded-xl border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white transition-all font-bold">
                    取消申請
                </button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('waitingApprovalModal');
    }
    document.getElementById('waitingTeamName').innerText = teamName;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function hideWaitingModal() {
    const modal = document.getElementById('waitingApprovalModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

window.cancelJoinRequest = function() {
    hideWaitingModal();
    window.isJoinCancelled = true; // 🎯 標記為已取消，拒絕後續一切跳轉
    const btn = document.getElementById('finalJoinTeamBtn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 重新申請加入';
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
};

// ==========================================
// [絕對修復] 集中合併所有 Socket 監聽，確保不漏接且不重複
// ==========================================
if (typeof socket !== 'undefined' && !window.isTeamSocketBound) {
    
    socket.on('mobile_sync_update', (data) => {
        if (typeof myUsername !== 'undefined' && data.username === myUsername) {
            if (!window.AppSync) window.AppSync = { connected: false, flipped: false };
            window.AppSync.connected = data.connected;
            window.AppSync.flipped = data.isFlipped;
        }
    });

    socket.on('update_rank', (data) => {
        if (typeof myUsername !== 'undefined') {
            const myData = data.find(s => s.name === myUsername);
            if (myData) {
                if (!window.AppSync) window.AppSync = { connected: false, flipped: false };
                window.AppSync.connected = true;
                window.AppSync.flipped = !!myData.isFlipped;
            }
        }
    });

    socket.on('update_weekly_rank', (data) => {
        if (typeof myUsername !== 'undefined') {
            const myData = data.find(s => s.name === myUsername);
            if (myData) {
                if (!window.AppSync) window.AppSync = { connected: false, flipped: false };
                window.AppSync.connected = myData.status !== '離線休息中';
                window.AppSync.flipped = myData.status === '深度專注中';
            }
        }
    });

    // 需審核，等待隊長動作中
    socket.on('waiting_for_approval', (data) => {
        console.log('申請已送出，等待隊長審核中...');
        showWaitingModal(pendingJoinData ? pendingJoinData.teamName : '該隊伍');
    });

    // 加入過程發生錯誤
    socket.on('join_team_error', (data) => {
        hideWaitingModal(); 
        if (!window.isJoinCancelled) {
            alert(`❌ 加入失敗：${data.message || '無法加入該隊伍'}`);
        }
        cancelJoinRequest(); 
    });

    // 處理隊長審核結果 (同意或拒絕)
    socket.on('join_team_approved', (data) => {
        console.log('🎉 收到入隊同意通知！準備跳轉...', data);
        
        hideWaitingModal(); // 使用現成的方法關閉等待視窗

        if (window.isJoinCancelled) {
            console.log("您已取消申請，忽略跳轉，默默釋出名額...");
            const teamId = pendingJoinData ? pendingJoinData.teamId : (data.teamName || '');
            if (typeof socket !== 'undefined' && typeof myUsername !== 'undefined') {
                socket.emit('leave_team', { teamName: teamId, username: myUsername });
            }
            return; 
        }

        // 🎯 [修正點 2] 正確接收目標教室類型，若伺服器沒傳，使用當初點擊時記錄的
        const teamId = data.teamName || (pendingJoinData ? pendingJoinData.teamId : '');
        const teamName = data.realTeamName || (pendingJoinData ? pendingJoinData.teamName : '');
        const roomType = data.roomType || (pendingJoinData ? pendingJoinData.roomType : 'managed-room.html');
        
        const targetRoom = (roomType && roomType.includes('.html')) ? roomType : 'managed-room.html';
        const teamParams = `&mode=team&teamId=${teamId}&teamName=${encodeURIComponent(teamName)}`;

        // 🎯 判斷是否為單機模式
        const isStandalone = window.location.pathname.includes('flip-room.html');

        if (isStandalone) {
            // 單機模式：把跳轉邏輯交還給 flip-room.html 的 goToFlip 彈窗
            if (typeof window.goToFlip === 'function') {
                window.goToFlip(targetRoom, teamParams);
            }
            return;
        }

        // PC 模式正常跳轉
        window.location.href = `${targetRoom}?${teamParams.replace('&', '')}&name=${encodeURIComponent(typeof myUsername !== 'undefined' ? myUsername : '')}`;
    });

    socket.on('join_team_rejected', (data) => {
        console.log('❌ 入隊申請被拒絕');
        
        hideWaitingModal();

        // 🎯 支援單機模式的婉拒彈窗
        const isStandalone = window.location.pathname.includes('flip-room.html');
        if (isStandalone) {
            const container = document.getElementById('standalone-modal-container');
            const rejectedModal = document.getElementById('rejected-modal');
            if (container && rejectedModal) {
                container.classList.remove('hidden');
                rejectedModal.classList.remove('hidden');
                return;
            }
        }

        if (!window.isJoinCancelled) {
            alert(data.message || '隊長婉拒了您的加入申請。');
        }
        
        const btn = document.getElementById('finalJoinTeamBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-check-circle"></i> 確認加入';
            btn.disabled = false;
        }

        cancelJoinRequest(); 
    });

    // 接收隊伍列表更新
    socket.on('update_active_teams', (teams) => {
        const safeTeams = teams || [];
        window._cachedActiveTeams = safeTeams; 

        const container = document.getElementById('teamListContainer');
        if (!container) return;

        const countDisplay = document.getElementById('activeTeamsCount');
        if (countDisplay) countDisplay.innerText = `進行中: ${safeTeams.length} 隊`;

        if (safeTeams.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 bg-black/20 rounded-2xl border border-dashed border-white/10">
                    <i class="fas fa-ghost text-4xl text-gray-600 mb-3"></i>
                    <p class="text-gray-400 text-sm">目前尚無正在進行的隊伍</p>
                </div>`;
            return;
        }

        const myName = typeof myUsername !== 'undefined' ? myUsername : (localStorage.getItem('studyVerseUser') || '');

        container.innerHTML = safeTeams.map(team => {
            const currentMem = team.currentMembers || 0;
            const maxMem = team.maxMembers || 4;
            const isFull = currentMem >= maxMem;
            
            const isMyTeam = team.members && team.members.includes(myName);

            let btnClass = "";
            let btnText = "";
            let btnAction = "";

            if (isMyTeam) {
                btnClass = "bg-red-600/90 hover:bg-red-500 text-white active:scale-95 transition-all shadow-[0_0_15px_rgba(220,38,38,0.3)] border border-red-500/50";
                btnText = '<i class="fas fa-sign-out-alt"></i> 退出';
                btnAction = `onclick="leaveSpecificTeam('${team.id}')"`;
            } else if (isFull) {
                btnClass = "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700";
                btnText = "人數已滿";
                btnAction = "disabled";
            } else {
                btnClass = "bg-orange-600 hover:bg-orange-500 text-white active:scale-95 transition-all shadow-md";
                btnText = "加入小隊";
                // 將 roomType 正確傳遞下去
                btnAction = `onclick="joinSpecificTeam('${team.id}', '${team.name.replace(/'/g, "\\'")}', '${team.roomType || 'managed-room.html'}')"`;
            }

            let roomLabel = '';
            if (team.roomType === 'immersive-room.html' || team.roomType === 'immersive-room') {
                roomLabel = `<span class="text-[10px] font-bold px-2 py-1 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30"><i class="fas fa-vr-cardboard mr-1"></i>沈浸室自習</span>`;
            } else if (team.roomType === 'managed-room.html' || team.roomType === 'managed-room') {
                roomLabel = `<span class="text-[10px] font-bold px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30"><i class="fas fa-chalkboard-teacher mr-1"></i>模擬線上教室</span>`;
            } else {
                roomLabel = `<span class="text-[10px] font-bold px-2 py-1 rounded bg-gray-500/20 text-gray-400 border border-gray-500/30"><i class="fas fa-door-open mr-1"></i>一般教室</span>`;
            }

            return `
                <div class="team-item bg-black/40 hover:bg-black/60 border border-gray-800 ${isMyTeam ? 'border-red-500/30 bg-red-900/10' : 'hover:border-orange-500/40'} rounded-xl p-3 flex flex-col md:flex-row justify-between items-center gap-3 transition-all">
                    <div class="flex-1 w-full">
                        <div class="flex items-center justify-between mb-1.5">
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] font-mono text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded">${team.id}</span>
                                <h4 class="text-white font-bold text-sm truncate max-w-[150px]">${team.name}</h4>
                            </div>
                            <div class="text-[10px] text-gray-500 hidden md:block">
                                🎯 ${team.goal || '專注衝刺'} | 🏆 ${team.totalHours || 0}H
                            </div>
                        </div>
                        <div class="flex items-center gap-2 mb-2">
                            ${roomLabel}
                        </div>
                        <div class="flex items-center gap-3 w-full">
                            <div class="flex-1 bg-gray-900 rounded-full h-1.5 overflow-hidden">
                                <div class="bg-orange-500 h-1.5 rounded-full transition-all duration-500" style="width: ${(currentMem / maxMem) * 100}%"></div>
                            </div>
                            <span class="text-[10px] font-mono text-gray-400 whitespace-nowrap">${currentMem} / ${maxMem} 人</span>
                        </div>
                        <div class="text-[10px] text-gray-500 mt-1.5 block md:hidden">
                            🎯 ${team.goal || '專注衝刺'} | 🏆 ${team.totalHours || 0}H
                        </div>
                    </div>
                    <div class="w-full md:w-auto flex-shrink-0 mt-2 md:mt-0">
                        <button class="w-full md:w-24 px-3 py-2 rounded-lg text-xs font-bold flex justify-center items-center gap-1 ${btnClass}" ${btnAction}>
                            ${btnText}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    });

    window.isTeamSocketBound = true;
    console.log("✅ 組隊大廳 Socket 事件已成功掛載，且已上鎖防重複綁定！");
}

// ==========================================
// 1. 介面控制：加入 / 創建隊伍彈窗
// ==========================================
window.openJoinTeamModal = function() {
    document.getElementById('joinTeamModal').classList.remove('hidden');
    document.getElementById('joinTeamModal').classList.add('flex');
    window.loadActiveTeams(); 
};

window.closeJoinTeamModal = function() {
    document.getElementById('joinTeamModal').classList.add('hidden');
    document.getElementById('joinTeamModal').classList.remove('flex');
};

window.openCreateTeamModal = function() {
    const integrityText = document.getElementById('integrityDisplay') ? document.getElementById('integrityDisplay').innerText : '100';
    const currentScore = parseInt(integrityText) || 100;

    if (currentScore < 90) {
        alert("🔒 權限不足！\n\n發起專屬組隊需要「誠信分大於 90 分」或「解鎖 Pro 會員」。");
        return;
    }

    window.loadActiveTeams();

    document.getElementById('createTeamModal').classList.remove('hidden');
    document.getElementById('createTeamModal').classList.add('flex');
    document.getElementById('createTeamStep2').classList.add('hidden');
    document.getElementById('createTeamStep2').classList.remove('flex');
    document.getElementById('createTeamStep1').classList.remove('hidden');
};

window.closeCreateTeamModal = function() {
    document.getElementById('createTeamModal').classList.add('hidden');
    document.getElementById('createTeamModal').classList.remove('flex');
    if (window.syncUIInterval) {
        clearInterval(window.syncUIInterval);
        window.syncUIInterval = null;
    }
};

// ==========================================
// 2. 核心邏輯：載入並渲染競賽隊伍
// ==========================================
window._cachedActiveTeams = []; 

window.loadActiveTeams = function() {
    if (typeof socket !== 'undefined') {
        socket.emit('request_active_teams');
    }
};

window.leaveSpecificTeam = function(teamId) {
    const myName = typeof myUsername !== 'undefined' ? myUsername : (localStorage.getItem('studyVerseUser') || '');
    
    if (confirm("⚠️ 確定要退出這個隊伍嗎？\n退出後將釋出名額，且無法參與該隊伍的專注排名！")) {
        if (typeof socket !== 'undefined') {
            socket.emit('leave_team', { teamName: teamId, username: myName });
        }
        
        if (window._cachedActiveTeams) {
            window._cachedActiveTeams = window._cachedActiveTeams.map(t => {
                if(t.id === teamId) {
                    t.currentMembers = Math.max(0, t.currentMembers - 1);
                    if (t.members) t.members = t.members.filter(m => m !== myName);
                }
                return t;
            });
        }
        window.loadActiveTeams(); 
    }
};

// ==========================================
// 3. 雙步驟創建與手機連動邏輯
// ==========================================
let pendingTeamData = null;

window.goToCreateTeamStep2 = function() {
    const nameInput = document.getElementById('teamNameInput');
    const sizeInput = document.getElementById('teamSizeInput');
    const roomTypeInput = document.getElementById('teamRoomSelect'); 
    const auditInput = document.getElementById('teamAuditInput');

    const name = nameInput ? nameInput.value.trim() : '';
    const size = sizeInput ? sizeInput.value : '4';
    const roomUrl = roomTypeInput ? roomTypeInput.value : 'managed-room.html';
    const audit = auditInput ? auditInput.value : 'none';

    if (!name) {
        alert("⚠️ 系統提示：請輸入小隊名稱！");
        if(nameInput) nameInput.focus();
        return;
    }

    const isNameUsed = window._cachedActiveTeams && window._cachedActiveTeams.some(team => team.name === name);

    if (isNameUsed) {
        alert(`⚠️ 系統提示：小隊名稱【 ${name} 】目前已有隊伍使用中，請更換名稱後再重新部署！`);
        return;
    }

    pendingTeamData = { name, size, roomUrl, audit };

    document.getElementById('createTeamStep1').classList.add('hidden');
    document.getElementById('createTeamStep2').classList.remove('hidden');
    document.getElementById('createTeamStep2').classList.add('flex');

    const qrContainer = document.getElementById('teamSyncQr');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        const mobileUrl = `${window.location.origin}/mobile.html`;
        new QRCode(qrContainer, {
            text: mobileUrl,
            width: 144,
            height: 144,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    if (!window.syncUIInterval) {
        window.syncUIInterval = setInterval(checkSyncStatus, 500);
    }
};

window.backToCreateTeamStep1 = function() {
    document.getElementById('createTeamStep2').classList.add('hidden');
    document.getElementById('createTeamStep2').classList.remove('flex');
    document.getElementById('createTeamStep1').classList.remove('hidden');
    if (window.syncUIInterval) {
        clearInterval(window.syncUIInterval);
        window.syncUIInterval = null;
    }
};

function checkSyncStatus() {
    const btn = document.getElementById('finalCreateTeamBtn');
    const statusText = document.getElementById('syncStatusText');
    const statusDot = document.getElementById('syncStatusDot');
    if (!btn || !statusText) return;

    if (window.isMobileFlipped) {
        btn.disabled = false;
        btn.classList.remove('bg-yellow-600/20', 'text-yellow-500', 'cursor-not-allowed', 'bg-gray-800', 'text-gray-500');
        btn.classList.add('bg-yellow-500', 'text-black', 'shadow-[0_0_20px_rgba(234,179,8,0.5)]');
        btn.innerHTML = '🚀 立即部署作戰單位';
        btn.onclick = executeTeamCreation;
        statusText.innerHTML = '<span class="text-green-400">● 手機已翻轉 (已解鎖)</span>';
        if (statusDot) statusDot.className = "w-3 h-3 rounded-full bg-green-500 shadow-[0_0_12px_#22c55e]";
    } else if (window.isMobileConnected) {
        btn.disabled = true;
        btn.classList.add('bg-yellow-600/20', 'text-yellow-500', 'cursor-not-allowed');
        btn.classList.remove('bg-yellow-500', 'text-black', 'shadow-[0_0_20px_rgba(234,179,8,0.5)]');
        btn.innerHTML = '等待手機翻轉中...';
        statusText.innerHTML = '<span class="text-yellow-400">● 手機連線中 (請翻轉蓋上)</span>';
        if (statusDot) statusDot.className = "w-3 h-3 rounded-full bg-yellow-500 shadow-[0_0_10px_#eab308]";
    } else {
        btn.disabled = true;
        btn.classList.add('bg-gray-800', 'text-gray-500', 'cursor-not-allowed');
        btn.innerHTML = '<i class="fas fa-qrcode mr-1"></i> 請先完成掃碼';
        statusText.innerHTML = '<span class="text-gray-500">○ 尚未偵測到手機連動</span>';
        if (statusDot) statusDot.className = "w-3 h-3 rounded-full bg-red-500 animate-pulse";
    }
}

window.skipAndExecuteTeamCreation = function() {
    if (!pendingTeamData) return;
    if(confirm("💡 確定要略過手機連動嗎？\n(略過後將無法享有翻轉模式的額外加分與防誤判機制)")) {
        if (window.syncUIInterval) {
            clearInterval(window.syncUIInterval);
            window.syncUIInterval = null;
        }
        executeTeamCreation();
    }
};

window.executeTeamCreation = function() {
    if (!pendingTeamData) return;
    const { name, size, roomUrl, audit } = pendingTeamData;
    const uniqueCode = 'TEAM-' + Math.random().toString(36).substr(2, 4).toUpperCase();
    
    if (typeof socket !== 'undefined') {
        socket.emit('create_team', {
            id: uniqueCode,
            name: name,
            creator: typeof myUsername !== 'undefined' ? myUsername : '匿名使用者',
            maxMembers: parseInt(size),
            currentMembers: 1,
            roomType: roomUrl,
            goal: '專注衝刺',
            totalHours: 0,
            auditMode: audit 
        });
    }

    alert(`🚀 部署成功！\n\n您的專屬作戰代碼為：【 ${uniqueCode} 】\n即將導向實體教室...`);
    window.location.href = `${roomUrl}?mode=team&teamId=${uniqueCode}&teamName=${encodeURIComponent(name)}&size=${size}&audit=${audit}`;
};

// ==========================================
// 4. 加入隊伍手機連動邏輯
// ==========================================
let pendingJoinData = null;
window.joinSyncInterval = null;

window.joinSpecificTeam = function(teamId, teamName, roomType) {
    pendingJoinData = { teamId, teamName, roomType };
    
    // 🎯 [修正點 1] 精準定義是否為單機模式
    const isStandalone = window.location.pathname.includes('flip-room.html');

    if (isStandalone) {
        // 如果是單機模式：隱藏列表，直接執行加入，【徹底防堵 QR 彈窗出現】
        const jtm = document.getElementById('joinTeamModal');
        if (jtm) { jtm.classList.remove('flex'); jtm.classList.add('hidden'); }
        
        executeJoinTeam();
        return;
    }

    // 以下為 PC 電腦版才需要顯示的 QR Code 彈窗邏輯
    const modal = document.getElementById('joinTeamSyncModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    
    const displayEl = document.getElementById('joinTeamDisplay');
    if (displayEl) displayEl.innerText = teamName;

    const qrContainer = document.getElementById('joinTeamSyncQr');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        const mobileUrl = `${window.location.origin}/mobile.html`;
        new QRCode(qrContainer, {
            text: mobileUrl,
            width: 144,
            height: 144,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    if (window.joinSyncInterval) clearInterval(window.joinSyncInterval);
    window.joinSyncInterval = setInterval(checkMobileSyncStatusForJoin, 1000);
    checkMobileSyncStatusForJoin();
};

function checkMobileSyncStatusForJoin() {
    const statusDot = document.getElementById('joinSyncStatusDot');
    const statusText = document.getElementById('joinSyncStatusText');
    const finalBtn = document.getElementById('finalJoinTeamBtn');

    if (!statusDot || !statusText || !finalBtn) return;

    const connected = window.isMobileConnected || (window.AppSync ? window.AppSync.connected : false);
    const flipped = window.isMobileFlipped || (window.AppSync ? window.AppSync.flipped : false);

    if (connected && flipped) {
        statusDot.className = "w-3 h-3 rounded-full bg-green-500 shadow-[0_0_12px_#22c55e]";
        statusText.innerText = "手機已連動並翻轉成功！";
        statusText.className = "text-xs font-bold text-green-400";
        
        finalBtn.disabled = false;
        finalBtn.className = "w-full py-3 rounded-lg text-sm font-black text-[#050b14] bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-400 hover:to-cyan-300 shadow-[0_0_20px_rgba(56,189,248,0.5)] transition-all flex justify-center items-center gap-2 cursor-pointer transform hover:-translate-y-0.5 active:scale-95";
        finalBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 立即加入隊伍';
        
        if (window.joinSyncInterval) {
            clearInterval(window.joinSyncInterval);
            window.joinSyncInterval = null;
        }
    } else if (connected && !flipped) {
        statusDot.className = "w-3 h-3 rounded-full bg-yellow-500 shadow-[0_0_10px_#eab308]";
        statusText.innerText = "已連線，請將手機「螢幕朝下」蓋上...";
        statusText.className = "text-xs font-bold text-yellow-400 animate-pulse";
        finalBtn.disabled = true;
        finalBtn.className = "w-full py-3 rounded-lg text-sm font-bold text-gray-500 bg-gray-800 cursor-not-allowed border border-gray-700 transition-all flex justify-center items-center gap-2";
        finalBtn.innerHTML = '<i class="fas fa-lock mr-1"></i> 等待手機翻轉';
    } else {
        statusDot.className = "w-3 h-3 rounded-full bg-red-500 animate-pulse";
        statusText.innerText = "等待手機掃碼連線...";
        statusText.className = "text-xs font-bold text-blue-200/50";
        finalBtn.disabled = true;
    }
}

window.closeJoinTeamSyncModal = function() {
    document.getElementById('joinTeamSyncModal').classList.add('hidden');
    document.getElementById('joinTeamSyncModal').classList.remove('flex');
    if (window.joinSyncInterval) clearInterval(window.joinSyncInterval);
};

window.skipAndExecuteJoinTeam = function() {
    if (!pendingJoinData) return;
    if(confirm("💡 確定要略過手機連動嗎？\n(略過後將無法享有翻轉模式的額外加分與防誤判機制)")) {
        if (window.joinSyncInterval) clearInterval(window.joinSyncInterval);
        executeJoinTeam();
    }
};

window.executeJoinTeam = function() {
    if (!pendingJoinData) return;
    
    window.isJoinCancelled = false; 

    const { teamId, teamName, roomType } = pendingJoinData;
    const isStandalone = window.location.pathname.includes('flip-room.html');
    
    if (typeof socket !== 'undefined' && typeof myUsername !== 'undefined') {
        const btn = document.getElementById('finalJoinTeamBtn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 審核連線中...';
            btn.disabled = true;
        }

        // 不論是否單機都發送審核請求，伺服器會自動判斷要不要直接核准
        socket.emit('request_join_team', {
            teamName: teamId, 
            username: myUsername,
            realTeamName: teamName, 
            roomType: roomType
        });
        
        if (window.closeJoinTeamSyncModal) window.closeJoinTeamSyncModal();
        showWaitingModal(teamName);

    } else {
        const targetRoom = (roomType && roomType.includes('.html')) ? roomType : 'managed-room.html';
        window.location.href = `${targetRoom}?mode=team&teamId=${teamId}&teamName=${encodeURIComponent(teamName)}`;
    }
};

setTimeout(() => {
    if (typeof window.loadActiveTeams === 'function') {
        window.loadActiveTeams();
    }
}, 300);