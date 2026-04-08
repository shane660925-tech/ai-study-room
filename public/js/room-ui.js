/**
 * StudyVerse V2.2.2 - AI教室介面與 Socket 邏輯 (room-ui.js)
 * 完全委由 ai-core.js 的單一 Socket 通道驅動，確保不漏失廣播
 * [修正] 小隊UI比例改為 4:3，並加入 object-fit: contain 防止大頭貼被截斷
 */

let warningCheckTimer = null; 

// ==========================================
// [新增] 集中管理違規畫面與警告 UI (接管自 ai-core)
// ==========================================
window.RoomUI = {
    pcWarningTimer: null,
    pcWarningCount: 5,

    /**
     * 顯示違規警告畫面
     * @param {string} type - 違規類型 (PHONE_FLIP, PHONE, SLEEP, LEAVE, DISTRACTED)
     * @param {number} duration - 針對手機翻轉的倒數秒數 (預設 5 秒)
     */
    showWarning: function(type, duration = 5) {
        const overlay = document.getElementById('distractionOverlay');
        const overlayText = document.getElementById('overlayText');
        const overlayIcon = document.getElementById('overlayIcon');
        const myDeskFrame = document.getElementById('myDeskFrame');
        const myStatusBubble = document.getElementById('myStatusBubble');

        if (!overlay || !overlayText || !overlayIcon) return;

        // 1. 顯示覆蓋層與紅框
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
        
        if (myDeskFrame) {
            myDeskFrame.classList.remove('border-blue-500/30');
            myDeskFrame.classList.add('border-red-500', 'shadow-[0_0_30px_rgba(239,68,68,0.6)]');
        }
        if (myStatusBubble) {
            myStatusBubble.classList.remove('bg-green-500', 'shadow-[0_0_8px_#22c55e]');
            myStatusBubble.classList.add('bg-red-500', 'shadow-[0_0_8px_#ef4444]');
        }

        // 2. 清除舊的國家級警報計時器
        if (this.pcWarningTimer) {
            clearInterval(this.pcWarningTimer);
            this.pcWarningTimer = null;
        }

        // 3. 根據違規類型切換畫面內容
        if (type === 'PHONE_FLIP') {
            this.pcWarningCount = duration;
            overlayIcon.className = "fas fa-mobile-alt text-white text-4xl animate-bounce";
            
            const updateFlipUI = () => {
                overlayText.innerHTML = `⚠️ 國家級警報：手機已翻開！<br><span class="text-7xl font-mono mt-6 mb-4 block text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,1)]">${this.pcWarningCount}</span><br><span class="text-xl font-black text-red-200">倒數結束將強制退出並通報全班</span>`;
            };
            
            updateFlipUI();
            this.pcWarningTimer = setInterval(() => {
                this.pcWarningCount--;
                if (this.pcWarningCount > 0) {
                    updateFlipUI();
                } else {
                    clearInterval(this.pcWarningTimer);
                    // 時間到，強制結束 (呼叫 endSession)
                    if (typeof window.endSession === 'function') window.endSession();
                }
            }, 1000);
        } 
        else if (type === 'PHONE') {
            overlayIcon.className = "fas fa-mobile text-white text-4xl";
            overlayText.innerHTML = "偵測到使用手機！<br><span class='text-sm mt-2 block text-red-200'>請放下手機，保持專注</span>";
        }
        else if (type === 'SLEEP') {
            overlayIcon.className = "fas fa-bed text-white text-4xl";
            overlayText.innerHTML = "偵測到趴睡！<br><span class='text-sm mt-2 block text-red-200'>請抬起頭，保持清醒</span>";
        }
        else if (type === 'LEAVE') {
            overlayIcon.className = "fas fa-walking text-white text-4xl";
            overlayText.innerHTML = "偵測到離座！<br><span class='text-sm mt-2 block text-red-200'>請回到座位繼續專注</span>";
        }
        else {
            overlayIcon.className = "fas fa-eye-slash text-white text-4xl";
            overlayText.innerHTML = "偵測到分心！<br><span class='text-sm mt-2 block text-red-200'>請維持專注，AI 持續觀測中</span>";
        }
    },

    /**
     * 隱藏違規警告畫面，恢復正常綠色狀態
     */
    hideWarning: function() {
        if (this.pcWarningTimer) {
            clearInterval(this.pcWarningTimer);
            this.pcWarningTimer = null;
        }

        const overlay = document.getElementById('distractionOverlay');
        const myDeskFrame = document.getElementById('myDeskFrame');
        const myStatusBubble = document.getElementById('myStatusBubble');

        if (overlay) {
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
        }
        if (myDeskFrame) {
            myDeskFrame.classList.remove('border-red-500', 'shadow-[0_0_30px_rgba(239,68,68,0.6)]');
            myDeskFrame.classList.add('border-blue-500/30');
        }
        if (myStatusBubble) {
            myStatusBubble.classList.remove('bg-red-500', 'shadow-[0_0_8px_#ef4444]');
            myStatusBubble.classList.add('bg-green-500', 'shadow-[0_0_8px_#22c55e]');
        }
    }
};

// ==========================================
// [核心修復] 暴露給 ai-core.js 呼叫的介面更新方法
// ==========================================

// 1. 更新隊長介面：將圖章與特效直接掛載在自己的視訊鏡頭區域
window.updateLeaderUI = function() {
    if (!document.body) return;

    const urlParams = new URLSearchParams(window.location.search);
    const inputNameEl = document.getElementById('inputName');
    const myName = String(localStorage.getItem('studyVerseUser') || inputNameEl?.value || urlParams.get('name') || "學員").trim();
    const leaderName = String(window.currentTeamLeader || "").trim();
    const isAuditMode = urlParams.get('audit') === 'true'; 

    // 清除舊版或錯位的圖章
    const oldCaptainBadge = document.getElementById('myCaptainBadge');
    if (oldCaptainBadge) oldCaptainBadge.style.display = 'none';
    const oldDashboardBadge = document.getElementById('dashboardCaptainBadge');
    if (oldDashboardBadge) oldDashboardBadge.remove();

    // 取得本機視訊鏡頭的容器
    const webcamEl = document.getElementById('webcam');
    if (!webcamEl || !webcamEl.parentElement) return;
    const webcamContainer = webcamEl.parentElement;

    // 清除原本可能已經加上的視訊鏡頭圖章
    const existingLocalBadge = document.getElementById('local-video-captain-badge');
    if (existingLocalBadge) existingLocalBadge.remove();

    // 🎯 準確尋找 "YOU (Self)" 這個黑底標籤 (解決重疊問題)
    const yourselfLabel = Array.from(webcamContainer.querySelectorAll('.status-badge')).find(el => el.textContent.includes('YOU') || el.textContent.includes('Self'));

    if ((leaderName !== "" && leaderName === myName) || isAuditMode) {
        // 🎯 1. 徹底隱藏 "YOU (Self)" 標籤與黑框
        if (yourselfLabel) yourselfLabel.style.display = 'none';

        // 🎯 2. 替自己的視訊容器加上發光特效
        if (!webcamContainer.classList.contains('leader-glow-effect')) {
            webcamContainer.classList.add('leader-glow-effect');
        }
        webcamContainer.classList.add('relative');

        // 🎯 3. 插入最美漸層隊長徽章
        const badgeHtml = `
            <div id="local-video-captain-badge" onclick="if(window.showMyTeamInfo) window.showMyTeamInfo(event)" class="absolute top-2 left-2 z-[100] flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-600 rounded-full border border-yellow-200/50 shadow-[0_0_20px_rgba(251,191,36,0.6)] animate-in fade-in zoom-in duration-300 cursor-pointer hover:scale-105 pointer-events-auto">
                <div class="flex items-center justify-center w-5 h-5 bg-white/20 rounded-full">
                    <i class="fas fa-crown text-white text-[10px] drop-shadow-md"></i>
                </div>
                <span class="text-white font-black text-[11px] tracking-tighter italic uppercase drop-shadow-sm">CAPTAIN</span>
            </div>
        `;
        webcamContainer.insertAdjacentHTML('beforeend', badgeHtml);
    } else {
        if (yourselfLabel) yourselfLabel.style.display = '';
        webcamContainer.classList.remove('leader-glow-effect');
    }
};

// 2. 接收並處理入隊申請彈窗
let pendingJoinRequests = []; 

window.addJoinRequest = function(data) {
    pendingJoinRequests.push({
        applicantName: data.requestUser,
        applicantId: data.requestSocketId
    });
    processNextJoinRequest();
};

function processNextJoinRequest() {
    let modal = document.getElementById('audit-modal');
    
    if (!modal) {
        if (document.body) {
            createAuditModal();
            modal = document.getElementById('audit-modal');
        } else {
            return; 
        }
    }

    if (!modal || modal.style.display === 'flex' || pendingJoinRequests.length === 0) return;

    const currentRequest = pendingJoinRequests[0];
    const applicantNameEl = document.getElementById('audit-applicant-name');
    if (applicantNameEl) {
        applicantNameEl.innerText = currentRequest.applicantName;
    }
    
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(e => {});

    const btnApprove = document.getElementById('btn-approve-join');
    const btnReject = document.getElementById('btn-reject-join');
    
    if (btnApprove) btnApprove.onclick = () => handleJoinResponse(true, currentRequest);
    if (btnReject) btnReject.onclick = () => handleJoinResponse(false, currentRequest);
}

function handleJoinResponse(isApproved, requestData) {
    const urlParams = new URLSearchParams(window.location.search);
    const currentTeamId = urlParams.get('teamId');

    if (window.appSocket) {
        window.appSocket.emit('reply_join_team', {
            requestSocketId: requestData.applicantId,
            requestUser: requestData.applicantName, 
            teamName: currentTeamId,
            approved: isApproved
        });
    }

    const modal = document.getElementById('audit-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }

    pendingJoinRequests.shift();
    setTimeout(processNextJoinRequest, 500);
}

function createAuditModal() {
    if (document.getElementById('audit-modal')) return;
    const modalHtml = `
        <div id="audit-modal" class="fixed inset-0 z-[9999] hidden flex-col items-center justify-center bg-black/80 backdrop-blur-sm" style="display: none;">
            <div class="bg-gray-900 border border-blue-500/50 rounded-2xl p-6 w-[90%] max-w-md shadow-2xl flex flex-col items-center text-center transform transition-all">
                <div class="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-4 border border-blue-500/50">
                    <i class="fas fa-user-shield text-3xl text-blue-400"></i>
                </div>
                <h3 class="text-xl font-bold text-white mb-2">🛡️ 入隊審核請求</h3>
                <p class="text-gray-300 text-sm mb-6">玩家 <span id="audit-applicant-name" class="font-bold text-orange-400 text-base mx-1"></span> 申請加入您的專屬小隊。</p>
                <div class="flex gap-4 w-full">
                    <button id="btn-reject-join" class="flex-1 py-3 rounded-lg font-bold text-white bg-red-600/80 hover:bg-red-500 transition-all border border-red-500/50">
                        <i class="fas fa-times mr-1"></i> 婉拒
                    </button>
                    <button id="btn-approve-join" class="flex-1 py-3 rounded-lg font-bold text-gray-900 bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-300 hover:to-emerald-400 transition-all shadow-[0_0_15px_rgba(52,211,153,0.4)]">
                        <i class="fas fa-check mr-1"></i> 允許加入
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.dismissAlert = function() {
    const modal = document.getElementById('violation-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }

    if (window.dismissAlertFromAI) window.dismissAlertFromAI();
    if (window.warningCheckTimer) clearTimeout(window.warningCheckTimer);

    window.warningCheckTimer = setTimeout(() => {
        const myStatus = document.getElementById('myStatusBubble');
        const isStillViolating = myStatus && (
            myStatus.classList.contains('bg-red-500') || 
            window.getComputedStyle(myStatus).backgroundColor === 'rgb(239, 68, 68)'
        );

        if (isStillViolating) {
            if (modal) {
                const msgElement = document.getElementById('violation-msg');
                if (msgElement) msgElement.innerText = "⚠️ 警告：您仍未改正違規行為！請立即放下手機或回到座位！";
                modal.classList.remove('hidden');
                modal.style.display = 'flex';
                if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
            }
        }
    }, 5000);
};

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const userName = localStorage.getItem('studyVerseUser') || urlParams.get('name') || "指揮官";
    const userMode = urlParams.get('mode') || "standard";
    
    document.getElementById('inputName').value = userName;
    document.getElementById('inputMode').value = userMode;
    document.getElementById('welcomeMsg').innerText = `歡迎回來，${userName}`;
    
    document.getElementById('mySidebarName').innerText = userName;
    document.getElementById('mySidebarAvatar').src = `https://api.dicebear.com/7.x/big-smile/svg?seed=${userName}`;

    silentlyStartCamera();

    setInterval(() => {
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
        const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false });
        if(document.getElementById('clockDate')) document.getElementById('clockDate').innerText = dateStr;
        if(document.getElementById('clockTime')) document.getElementById('clockTime').innerText = timeStr;
    }, 1000);

    createAuditModal();
    window.updateLeaderUI();
    if (pendingJoinRequests.length > 0) processNextJoinRequest();
});

async function silentlyStartCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.getElementById('webcam');
        if (video) video.srcObject = stream;
    } catch (err) {}
}

window.switchTab = function(tab) {
    document.getElementById('tab-rank').classList.toggle('hidden', tab !== 'rank');
    document.getElementById('tab-achieve').classList.toggle('hidden', tab !== 'achieve');
    document.getElementById('btn-rank').classList.toggle('tab-active', tab === 'rank');
    document.getElementById('btn-achieve').classList.toggle('tab-active', tab === 'achieve');
};

window.triggerAISocialBubble = function(type) {
    const container = document.getElementById('bubbleContainer');
    if (!container) return;
    const bubble = document.createElement('div');
    bubble.className = "ai-bubble bg-gray-900/90 backdrop-blur-md border border-blue-500/50 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 mb-3";
    let content = "", icon = "";
    switch(type) {
        case 'FOCUS_STREAK': content = "🔥 AI：專注超過 20 分鐘了！保持氣勢！"; icon = "fa-fire-alt text-orange-500"; break;
        case 'HYDRATION': content = "💧 AI：記得喝口水，補水有助效率。"; icon = "fa-tint text-cyan-400"; break;
        case 'POSTURE': content = "🧘 AI：偵測到姿勢不正，挺胸會更清醒喔。"; icon = "fa-user-check text-green-400"; break;
        case 'CHEER': content = "👏 AI：目前的專注狀態堪稱完美，加油！"; icon = "fa-thumbs-up text-yellow-500"; break;
    }
    bubble.innerHTML = `<i class="fas ${icon} text-lg"></i><span class="text-xs font-bold leading-tight">${content}</span>`;
    container.appendChild(bubble);
    setTimeout(() => {
        bubble.style.opacity = '0';
        bubble.style.transform = 'translateY(-20px)';
        bubble.style.transition = 'all 0.8s ease';
        setTimeout(() => bubble.remove(), 800);
    }, 7000);
};

// ==========================================
// [修改] 小隊專屬 UI 特效與排列邏輯
// ==========================================

const teamUIStyle = document.createElement('style');
teamUIStyle.innerHTML = `
    /* 1. 修正小隊隊員圖卡：維持一半大小，改為 4:3 比例，加入底色 */
    .team-member-card {
        width: calc(50% - 0.5rem) !important;
        aspect-ratio: 4 / 3 !important; 
        height: auto !important;
        position: relative;
        overflow: hidden;
        border-radius: 12px;
        background-color: #1a1a1a; 
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    /* 2. 視訊維持 cover 填滿 */
    .team-member-card video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
    }
    /* 3. 頭像圖片改為 contain，避免人臉被裁切，並加上 padding 給文字讓出空間 */
    .team-member-card img {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        padding: 24px 10px; /* 上下留白避免被 header/footer 遮擋 */
    }
    /* 深度專注特效 */
    .deep-focus-ring {
        box-shadow: 0 0 20px #3b82f6 !important;
        border: 3px solid #3b82f6 !important;
    }
    .team-card-header {
        position: absolute;
        top: 0; left: 0; right: 0;
        background: linear-gradient(to bottom, rgba(0,0,0,0.85), transparent);
        padding: 8px;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        z-index: 20;
        pointer-events: none;
    }
    .team-card-footer {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
        padding: 8px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        z-index: 20;
        pointer-events: none;
    }
    .team-flag {
        font-size: 11px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: white;
        font-weight: 900;
        padding: 3px 8px;
        border-radius: 6px;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
`;
document.head.appendChild(teamUIStyle);

// 儲存當前小隊資料，供彈窗使用
window.myCurrentTeamData = null;

window.showMyTeamInfo = function(e) {
    if (e) e.stopPropagation();
    if (!window.myCurrentTeamData) return;
    
    const { teamId, totalFocus, count } = window.myCurrentTeamData;
    const modalId = 'team-info-modal';
    let modal = document.getElementById(modalId);
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = "fixed inset-0 z-[99999] hidden flex-col items-center justify-center bg-black/80 backdrop-blur-sm";
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="bg-gray-900 border border-yellow-500/50 rounded-2xl p-6 w-[90%] max-w-sm shadow-2xl flex flex-col items-center text-center transform transition-all">
            <div class="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mb-4 border border-yellow-500/50">
                <i class="fas fa-flag text-3xl text-yellow-400"></i>
            </div>
            <h3 class="text-xl font-bold text-white mb-2">🏆 小隊資訊</h3>
            <div class="text-gray-300 text-base mb-6 space-y-3 w-full bg-black/40 p-4 rounded-xl border border-gray-700">
                <div class="flex justify-between border-b border-gray-700 pb-2">
                    <span>小隊名稱：</span>
                    <span class="font-black text-white">${teamId}</span>
                </div>
                <div class="flex justify-between border-b border-gray-700 pb-2">
                    <span>當前隊員：</span>
                    <span class="font-black text-blue-400">${count} 人</span>
                </div>
                <div class="flex justify-between">
                    <span>累計總專注：</span>
                    <span class="font-black text-green-400">${totalFocus} 分鐘</span>
                </div>
            </div>
            <button onclick="document.getElementById('${modalId}').style.display='none'" class="w-full py-3 rounded-lg font-bold text-gray-900 bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 transition-all shadow-[0_0_15px_rgba(251,191,36,0.4)]">
                確認
            </button>
        </div>
    `;
    modal.style.display = 'flex';
};

function initializeTeamUIHook() {
    if (window.appSocket && !window._teamUIHooked) {
        window._teamUIHooked = true;
        
        window.appSocket.on('update_rank', (users) => {
            const urlParams = new URLSearchParams(window.location.search);
            const inputNameEl = document.getElementById('inputName');
            const myName = String(inputNameEl?.value || urlParams.get('name') || "Commander").trim();
            
            const me = users.find(u => u.name === myName);
            if (!me || !me.teamId) return; 
            
            const teamMembers = users.filter(u => u.teamId === me.teamId);
            const totalFocus = teamMembers.reduce((sum, u) => sum + (u.focusMinutes || 0), 0);
            window.myCurrentTeamData = { teamId: me.teamId, totalFocus, count: teamMembers.length };

            const webcamEl = document.getElementById('webcam');
            const localCard = document.getElementById(`user-card-${myName}`) || webcamEl?.closest('.user-card') || webcamEl?.parentElement;
            const grid = localCard?.parentElement;
            
            if (grid) {
                const hue = [...me.teamId].reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
                const flagColor = `hsl(${hue}, 80%, 55%)`;

                teamMembers.forEach(member => {
                    if (member.name === myName) return; 

                    const card = document.getElementById(`user-card-${member.name}`) || 
                                 Array.from(grid.children).find(el => el.innerHTML.includes(member.name) && el !== localCard);
                    
                    if (card) {
                        if (card.parentElement === grid) {
                            grid.insertBefore(card, localCard.nextSibling);
                        }
                        
                        // 根據是否為手機翻轉模式套用不同的樣式
                        if (member.isFlipped) {
                            // 📱 手機翻轉單機模式
                            card.className = 'remote-user-card relative flex flex-col items-center justify-center p-2 w-full transition-all duration-300';
                            card.style = 'aspect-ratio: 3/4; background: transparent; border: none; box-shadow: none;';
                            
                            card.innerHTML = `
                                <div class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-blue-500 shadow-lg flex-shrink-0 bg-gray-800 flex items-center justify-center overflow-visible">
                                    <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${member.name}" alt="Avatar" class="w-full h-full object-cover rounded-full m-0 p-0">
                                    <div class="absolute -bottom-1 -right-1 bg-blue-600 rounded-full w-8 h-8 border-2 border-[#05070a] flex items-center justify-center z-10">
                                        <i class="fas fa-mobile-alt text-white text-[14px]"></i>
                                    </div>
                                </div>
                                <div class="mt-4 text-center z-10 w-full">
                                    <div class="text-base sm:text-lg font-bold text-white drop-shadow-md truncate w-full px-2">${member.name}</div>
                                    <div class="text-sm text-gray-400 font-semibold drop-shadow-md mt-1 flex items-center justify-center gap-1">
                                        <i class="fas fa-clock"></i> ${member.focusMinutes || 0} min
                                    </div>
                                </div>
                            `;
                        } else {
                            // 💻 正常模式：單機直立圖卡 (恢復正常網格大小)
                            card.className = 'remote-user-card relative w-full h-full flex items-center justify-center bg-transparent';
                            card.style = ''; 
                            
                            card.innerHTML = `
                                <div class="inner-card relative h-fit w-fit min-w-[160px] max-w-[180px] bg-[#111827] rounded-2xl shadow-2xl border border-gray-700/50 flex flex-col items-center gap-2.5 py-4 px-3 transition-all duration-300 hover:border-blue-400/50">
                                    
                                    <div class="relative w-16 h-16 rounded-full border-2 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)] flex-shrink-0 bg-gray-800 flex items-center justify-center z-10">
                                        <img src="https://api.dicebear.com/7.x/big-smile/svg?seed=${member.name}" alt="Avatar" class="w-full h-full object-cover rounded-full m-0 p-0">
                                    </div>
                                    
                                    <div class="flex flex-col items-center w-full space-y-1.5 z-10">
                                        <div class="text-base font-bold text-white truncate w-full text-center px-1">${member.name}</div>
                                        
                                        <div class="w-full bg-blue-900/30 text-blue-200 text-xs px-2 py-1.5 rounded border border-blue-500/30 text-center whitespace-nowrap overflow-hidden text-ellipsis shadow-inner">
                                            🎯 ${member.goal || '專注進行中...'}
                                        </div>

                                        <div class="w-full bg-green-500/10 text-green-400 text-xs px-2 py-1 rounded-full border border-green-500/30 flex items-center justify-center gap-1.5 shadow-inner whitespace-nowrap">
                                            <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0"></div>
                                            <span class="font-bold tracking-wider truncate">${member.status === 'FOCUSED' ? '深度專注中' : (member.status || '連線中')}</span>
                                        </div>
                                        
                                        <div class="text-sm text-gray-400 font-bold flex items-center justify-center gap-1 whitespace-nowrap w-full">
                                            <i class="fas fa-clock text-gray-500"></i> ${member.focusMinutes || 0} 分鐘
                                        </div>
                                    </div>
                                </div>
                            `;
                        }

                        // 🎯 隊長標籤邏輯：位置往外推一點 (-top-2 -left-2) 讓它自然浮貼在卡片左上角
                        let captainBadge = card.querySelector('.remote-captain-badge');
                        if (member.isCaptain) {
                            if (!captainBadge) {
                                captainBadge = document.createElement('div');
                                captainBadge.className = 'remote-captain-badge absolute -top-2 -left-2 z-[30] cursor-pointer hover:scale-110 transition-transform pointer-events-auto';
                                captainBadge.innerHTML = `
                                    <div class="flex items-center gap-1 px-2 py-1 bg-yellow-500 rounded-full border border-yellow-200 shadow-[0_0_10px_rgba(251,191,36,0.5)]" onclick="window.showMyTeamInfo(event)">
                                        <i class="fas fa-crown text-white text-[10px]"></i>
                                        <span class="text-white font-bold text-[10px]">隊長</span>
                                    </div>
                                `;
                                const targetContainer = card.querySelector('.inner-card') || card;
                                targetContainer.appendChild(captainBadge);
                            }
                        } else if (captainBadge) {
                            captainBadge.remove();
                        }
                    }
                });
            }
        });
    } else if (!window._teamUIHooked) {
        setTimeout(initializeTeamUIHook, 1000); 
    }
}
initializeTeamUIHook();