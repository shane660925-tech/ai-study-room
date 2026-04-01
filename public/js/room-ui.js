/**
 * StudyVerse V2.2.2 - AI教室介面與 Socket 邏輯 (room-ui.js)
 * 完全委由 ai-core.js 的單一 Socket 通道驅動，確保不漏失廣播
 */

let warningCheckTimer = null; 

// ==========================================
// [核心修復] 暴露給 ai-core.js 呼叫的介面更新方法
// ==========================================

// 1. 更新隊長介面：將圖章與特效直接掛載在自己的視訊鏡頭區域
window.updateLeaderUI = function() {
    if (!document.body) return;

    const urlParams = new URLSearchParams(window.location.search);
    const inputNameEl = document.getElementById('inputName');
    const myName = String(inputNameEl?.value || urlParams.get('name') || "Commander").trim();
    const leaderName = String(window.currentTeamLeader || "").trim();
    const isAuditMode = urlParams.get('audit') === 'true'; // 判斷自己是否以隊長身分進入

    // 清除舊版或錯位的圖章
    const oldCaptainBadge = document.getElementById('myCaptainBadge');
    if (oldCaptainBadge) oldCaptainBadge.style.display = 'none';
    const oldDashboardBadge = document.getElementById('dashboardCaptainBadge');
    if (oldDashboardBadge) oldDashboardBadge.remove();

    // 取得本機視訊鏡頭的容器 (通常是包裹 webcam 的 div)
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
            <div id="local-video-captain-badge" class="absolute top-2 left-2 z-[100] flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-600 rounded-full border border-yellow-200/50 shadow-[0_0_20px_rgba(251,191,36,0.6)] animate-in fade-in zoom-in duration-300">
                <div class="flex items-center justify-center w-5 h-5 bg-white/20 rounded-full">
                    <i class="fas fa-crown text-white text-[10px] drop-shadow-md"></i>
                </div>
                <span class="text-white font-black text-[11px] tracking-tighter italic uppercase drop-shadow-sm">CAPTAIN</span>
            </div>
        `;
        webcamContainer.insertAdjacentHTML('beforeend', badgeHtml);
    } else {
        // 如果不是隊長，恢復 "YOU (Self)" 標籤並移除特效
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
            requestUser: requestData.applicantName, // 🎯 [配套修改] 必須回傳 Username，後端才找得到人
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
    const userName = urlParams.get('name') || "Commander";
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