import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js";

// 全域變數定義
let socket, faceLandmarker, objectDetector, videoElement, localStream = null;
let myStatus = "FOCUSED", distractionStartTime = 0, lastObjectCheckTime = 0;
let isPhoneDetected = false, lastFaceCheckTime = 0, currentRoomMode = "1";
let sessionStartTime = null; 
let lastVideoTime = -1;
let myUsername = localStorage.getItem('studyVerseUser') || "學員"; 

let distractionCounter = 0; 
const STABLE_THRESHOLD = 3; 
let aiFaceIssue = null; 
let lastHeartbeat = 0; 

let isPhoneFlipped = sessionStorage.getItem('mobileLinked') === 'true';
let isFlipWarningActive = false; 

// 接收來自 break-manager.js 的開關，合法休息時暫停抓違規
window.isAIPaused = false; 
window.lastCameraViolationTime = 0;

let lastViolationTime = 0;    
let remoteUsers = [];
let isAuditMode = false; 

// 核心計數器：將計數器強制綁定在 window 全域物件上，打破模組限制
window.totalViolationCount = 0; 
window.violationDetails = {
    "📱 使用手機": 0,
    "🪑 偵測離座": 0,
    "💤 偵測趴睡": 0,
    "🚫 切換分頁": 0,
    "📱 手機翻轉中斷": 0 
};

// ==========================================
// 手機翻轉全螢幕倒數彈窗變數與函數
// ==========================================
let flipCountdownInterval = null;

// 🚀 新增：用來追蹤手機「真實物理狀態」的變數與本地倒數計時器
window.isPhoneCurrentlyUnflipped = false;
window.localFlipKickTimer = null;

function showFlipCountdownModal() {
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

    if (flipCountdownInterval) clearInterval(flipCountdownInterval);
    flipCountdownInterval = setInterval(() => {
        secondsLeft--;
        if(textEl) textEl.innerText = secondsLeft;
        if (secondsLeft <= 0) {
            clearInterval(flipCountdownInterval); 
        }
    }, 1000);
}

function hideFlipCountdownModal() {
    let modal = document.getElementById('flipCountdownModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (flipCountdownInterval) clearInterval(flipCountdownInterval);
}

// 🚀 新增：當上課開始時，主動檢查手機是否還處於斷聯/翻開狀態
window.triggerPendingMobileWarning = function() {
    setTimeout(() => {
        if (window.isPhoneCurrentlyUnflipped && !window.isAIPaused) {
            console.log("🚨 上課了但手機還沒蓋回！啟動本地 5 秒倒數補刀！");
            
            isFlipWarningActive = true;
            myStatus = "DISTRACTED";
            if(socket) socket.emit("update_status", { status: "DISTRACTED", name: myUsername, isFlipped: false });
            
            if (!window.alertAudio) {
                window.alertAudio = new Audio('https://www.myinstants.com/media/sounds/iphone-emergency-alert.mp3');
                window.alertAudio.loop = true;
            }
            window.alertAudio.play().catch(e => console.log("音效播放受阻", e));
            
            if (window.RoomUI) window.RoomUI.showWarning('PHONE_FLIP', 5);
            showFlipCountdownModal();

            // 啟動本地的 5 秒踢出程序 (代替已經放棄的伺服器)
            if (window.localFlipKickTimer) clearTimeout(window.localFlipKickTimer);
            window.localFlipKickTimer = setTimeout(async () => {
                if (window.isPhoneCurrentlyUnflipped && !window.isAIPaused) {
                    if (window.isKickingOut) return; 
                    window.isKickingOut = true; 
                    isPhoneFlipped = false; 
                    
                    if (window.alertAudio) {
                        window.alertAudio.pause();
                        window.alertAudio.currentTime = 0;
                    }
                    if (window.RoomUI) window.RoomUI.hideWarning();
                    hideFlipCountdownModal();
                    
                    // 扣分並手動發送違規紀錄給老師
                    window.totalViolationCount++;
                    window.violationDetails["📱 手機翻轉中斷"] = (window.violationDetails["📱 手機翻轉中斷"] || 0) + 1;
                    
                    if (socket) {
                        socket.emit('violation', { 
                            name: myUsername, 
                            type: '🚨 翻轉中斷 (強制踢出教室)', 
                            image: null 
                        });
                    }
                    
                    setTimeout(async () => {
                        alert("🚨 您已違反翻轉專注規則，系統即將為您結算專注數據並通報導師！");
                        await endSession();
                    }, 100);
                }
            }, 5000);
        }
    }, 500); // 延遲半秒確保 UI 切換完成
};
// ==========================================

// --- 介面更新邏輯 ---
function updateUIMode(mode) {
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
}

// 初始化 Socket
if (typeof io !== 'undefined') {
    socket = io();
    window.appSocket = socket;
    
    socket.on('connect', () => {
        console.log("✅ Socket 已連線，正在登錄身分...");
        socket.emit("update_status", { 
            status: "FOCUSED", 
            name: myUsername, 
            isFlipped: isPhoneFlipped,
            isCaptain: isAuditMode 
        });
    });

    socket.on('mobile_sync_update', (data) => {
        if (data.studentName === myUsername) {
            
            // 🚀 紀錄真實物理狀態
            if (data.type === 'FLIP_WARNING') {
                window.isPhoneCurrentlyUnflipped = true;
            } else if (data.type === 'FLIP_COMPLETED') {
                window.isPhoneCurrentlyUnflipped = false;
                if (window.localFlipKickTimer) clearTimeout(window.localFlipKickTimer); // 解除本地追殺倒數
            }

            if (window.isAIPaused) return; // 休息時間：只紀錄狀態，不跳出警告

            if (data.type === 'FLIP_WARNING') {
                isFlipWarningActive = true;
                myStatus = "DISTRACTED";
                socket.emit("update_status", { status: "DISTRACTED", name: myUsername, isFlipped: false });
                
                if (!window.alertAudio) {
                    window.alertAudio = new Audio('https://www.myinstants.com/media/sounds/iphone-emergency-alert.mp3');
                    window.alertAudio.loop = true;
                }
                window.alertAudio.play().catch(e => console.log("音效播放受阻", e));
                
                if (window.RoomUI) window.RoomUI.showWarning('PHONE_FLIP', 5);

                showFlipCountdownModal();

            } else if (data.type === 'FLIP_COMPLETED') {
                if (window.alertAudio) {
                    window.alertAudio.pause();
                    window.alertAudio.currentTime = 0;
                }

                if (isFlipWarningActive) {
                    if (socket) {
                        socket.emit('violation', {
                            name: myUsername,
                            type: '📱 翻開手機 (已於5秒內及時蓋回)',
                            image: null 
                        });
                    }
                    window.totalViolationCount++;
                    window.violationDetails["📱 使用手機"] = (window.violationDetails["📱 使用手機"] || 0) + 1;
                }

                isFlipWarningActive = false;
                myStatus = "FOCUSED";
                
                if (window.RoomUI) window.RoomUI.hideWarning();
                hideFlipCountdownModal();

                socket.emit("update_status", { status: "FOCUSED", name: myUsername, isFlipped: true });
            }
        }
    });

    socket.on('flip_failed', async (data) => {
        const targetName = data.name || data.username || "某位同學";

        if (targetName === myUsername && sessionStorage.getItem('mobileLinked') === 'true') {
            
            if (window.isKickingOut) return; 
            window.isKickingOut = true; 

            if (window.isAIPaused) {
                window.isKickingOut = false; // 休息時間被赦免
                return; 
            }

            isPhoneFlipped = false; 
            if (window.alertAudio) {
                window.alertAudio.pause();
                window.alertAudio.currentTime = 0;
            }
            if (window.RoomUI) window.RoomUI.hideWarning();
            hideFlipCountdownModal();
            
            window.totalViolationCount++;
            window.violationDetails["📱 手機翻轉中斷"] = (window.violationDetails["📱 手機翻轉中斷"] || 0) + 1;
            
            setTimeout(async () => {
                alert("🚨 您已違反翻轉專注規則，系統即將為您結算專注數據並通報導師！");
                await endSession();
            }, 100);
            
        } else if (targetName !== myUsername) {
            showPublicShamingToast(targetName);
            const bbContent = document.getElementById('blackboardContent'); 
            if (bbContent) {
                bbContent.innerText = `🚨 系統廣播：${targetName} 因翻開手機被強制踢出教室！`;
                bbContent.classList.add('text-red-400');
                setTimeout(() => bbContent.classList.remove('text-red-400'), 4000);
            }
        }
    });
    
    socket.on('tutor_command', async (data) => {
        if (data.command === 'course_ended') {
            if (!window.hasAutoEnded) {
                window.hasAutoEnded = true; 
                alert("🎉 本次特約教室的所有課程已結束！即將為您產生專注結算報告...");
                await endSession();
            }
        }
    });
    
    socket.on('force_status_sync', (data) => {
        if (data.isFlipped !== undefined) {
            isPhoneFlipped = data.isFlipped;
        }
    });

    socket.on('team_leader_update', (data) => {
        window.currentTeamLeader = data.leader;
        if (typeof window.updateLeaderUI === 'function') {
            window.updateLeaderUI();
        }
    });

    socket.on("team_join_request", (data) => {
        if (window.addJoinRequest) window.addJoinRequest(data);
    });

    socket.on("update_rank", (users) => {
        remoteUsers = users; 
        
        const me = users.find(u => u.name === myUsername);
        if (me) {
            const myFocusTimeEl = document.getElementById('myFocusTime');
            if (myFocusTimeEl) myFocusTimeEl.innerText = `${me.focusMinutes || 0}m`;
        }

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
                            ${(u.isCaptain || window.currentTeamLeader === u.name) ? '<i class="fas fa-crown text-yellow-400 ml-1" title="隊長"></i>' : ''}
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
    });

    socket.on("receive_reaction", (data) => { showFloatingEmoji(data.emoji); });

    socket.on("admin_action", (data) => {
        if (data.type === 'WAKEUP' && data.target === myUsername) {
            const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
            audio.play().catch(e => console.log("音效播放受阻"));
            
            const violationModal = document.getElementById("violation-modal");
            const violationMsg = document.getElementById("violation-msg");
            
            if (violationModal) {
                violationModal.classList.remove("hidden");
                violationModal.classList.add("flex");
                if (violationMsg) violationMsg.innerText = data.message || "老師正在關注你！請立刻回到專注狀態！";
            }
        }
        if (data.type === 'BLACKBOARD') {
            const bbContent = document.getElementById('blackboardContent'); 
            if (bbContent) {
                bbContent.innerText = data.content;
                bbContent.classList.add('text-yellow-400');
                setTimeout(() => bbContent.classList.remove('text-yellow-400'), 2000);
            }
        }
    });
}

window.addEventListener('deviceorientation', (event) => {
    if (sessionStorage.getItem('mobileLinked') === 'true') return; 
    if (event.beta === null) return;
    
    const currentlyFlipped = Math.abs(event.beta) > 150;
    if (currentlyFlipped !== isPhoneFlipped) {
        isPhoneFlipped = currentlyFlipped;
        console.log("📱 翻轉狀態改變:", isPhoneFlipped ? "已翻轉 (螢幕朝下)" : "正常 (螢幕朝上)");
        
        if (socket) {
            socket.emit("update_status", { 
                status: myStatus, 
                name: myUsername,
                isFlipped: isPhoneFlipped 
            });
        }
    }
});

async function captureViolation(reason) {
    if (currentRoomMode !== 'tutor' || reason.includes("中斷") || reason.includes("踢出")) {
        window.totalViolationCount++;
        if (reason.includes("手機") && !reason.includes("中斷") && !reason.includes("踢出")) window.violationDetails["📱 使用手機"]++;
        else if (reason.includes("離座")) window.violationDetails["🪑 偵測離座"]++;
        else if (reason.includes("趴睡")) window.violationDetails["💤 偵測趴睡"]++;
        else if (reason.includes("中斷") || reason.includes("踢出")) window.violationDetails["📱 手機翻轉中斷"]++;
        else if (reason.includes("分頁")) window.violationDetails["🚫 切換分頁"]++; 
    }

    const now = Date.now();
    if (now - lastViolationTime < 15000 && !reason.includes("中斷") && !reason.includes("踢出") && !reason.includes("分頁")) return; 
    lastViolationTime = now;
    
    let imageData = null;
    const needsScreenshot = reason.includes("趴睡") || reason.includes("離座") || reason.includes("分心") || (reason.includes("手機") && !reason.includes("中斷") && !reason.includes("踢出"));

    if (needsScreenshot && videoElement) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            canvas.getContext('2d').drawImage(videoElement, 0, 0);
            imageData = canvas.toDataURL('image/jpeg', 0.4); 
        } catch (err) {
            console.warn("截圖失敗:", err);
        }
    }
    
    if (socket) {
        socket.emit("report_violation", {
            name: myUsername, reason: reason, image: imageData, time: new Date().toLocaleTimeString()
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const currentPath = window.location.pathname;
    
    if (currentPath.includes('immersive-room.html')) {
        currentRoomMode = '2'; 
    } else if (currentPath.includes('managed-room.html')) {
        currentRoomMode = 'simulated'; 
    } else if (currentPath.includes('tutor-room.html')) {
        currentRoomMode = 'tutor'; 
    } else if (currentPath.includes('course-room.html')) {
        currentRoomMode = '1'; 
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode');
        if (mode) currentRoomMode = mode;
    }

    updateUIMode(currentRoomMode);

    const inputName = document.getElementById('inputName');
    if (inputName && myUsername) inputName.value = myUsername;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const preview = document.getElementById('previewWebcam');
        if(preview) preview.srcObject = localStream;
        const statusEl = document.getElementById('previewStatus');
        if(statusEl) statusEl.innerText = "✅ 鏡頭已就緒";
    } catch (err) { 
        const statusEl = document.getElementById('previewStatus');
        if(statusEl) statusEl.innerText = "❌ 無法存取鏡頭";
    }
});

async function initApp() {
    const nameInput = document.getElementById('inputName');
    const name = nameInput?.value || "學員";
    const goal = document.getElementById('inputGoal')?.value || "專注學習";
    const minInput = document.getElementById('inputTime');
    
    let min = minInput && minInput.value ? parseInt(minInput.value) : 25;
    if (isNaN(min) || min <= 0) min = 25; 
    
    if (min > 180) {
        alert("⚠️ 為了你的健康，專注時間最多只能設定 180 分鐘喔！");
        if (minInput) minInput.value = 180; 
        return; 
    }

    myUsername = name; 
    sessionStartTime = Date.now(); 
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentTeamId = urlParams.get('teamId') || null;
    isAuditMode = urlParams.get('audit') === 'true'; 

    document.getElementById("mySidebarName").innerText = name;
    document.getElementById("mySidebarGoal").innerText = goal;
    document.getElementById("dashboardGoal").innerText = goal;
    document.getElementById("mySidebarAvatar").src = `https://api.dicebear.com/7.x/big-smile/svg?seed=${name}`;
    updateUIMode(currentRoomMode);

    if (window.StudyTimer) {
        window.StudyTimer.start(min);
    } else {
        console.error("找不到計時器大腦！請檢查 study-timer.js 是否有正確載入");
    }

    if(socket) socket.emit("join_room", { 
        name: name, 
        goal: goal, 
        planTime: min, 
        roomMode: currentRoomMode,
        teamId: currentTeamId,
        isCaptain: isAuditMode,
        isFlipped: isPhoneFlipped 
    });
    
    await initAI();
}

async function initAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1
    });
    objectDetector = await cocoSsd.load();
    videoElement = document.getElementById("webcam");
    if (videoElement) {
        videoElement.srcObject = localStream;
        videoElement.onloadedmetadata = () => {
            document.getElementById('startOverlay').style.display = 'none';
            predictLoop();
        };
    }
}

async function predictLoop() {
    const now = performance.now();
    const realNow = Date.now(); 
    const isCurrentlyBreaking = window.isAIPaused || (typeof isPauseMode !== 'undefined' && isPauseMode);

    if (socket && (now - lastHeartbeat > 10000)) {
        lastHeartbeat = now;
        socket.emit("update_status", { 
            status: isCurrentlyBreaking ? "PAUSED" : myStatus, 
            name: myUsername, 
            isFlipped: isPhoneFlipped 
        });
    }

    if (isCurrentlyBreaking || isFlipWarningActive) { 
        requestAnimationFrame(predictLoop); 
        return; 
    }

    if (isAuditMode) {
        requestAnimationFrame(predictLoop);
        return; 
    }

    if (sessionStartTime && (realNow - sessionStartTime < 8000)) {
        requestAnimationFrame(predictLoop);
        return;
    }
    
    if (videoElement && videoElement.readyState >= 2 && videoElement.currentTime !== lastVideoTime) {
        lastVideoTime = videoElement.currentTime;
        let didCheckRun = false; 

        if (now - lastObjectCheckTime > 1500) { 
            lastObjectCheckTime = now;
            const predictions = await objectDetector.detect(videoElement);
            isPhoneDetected = predictions.some(p => p.class === 'cell phone' && p.score > 0.5); 
            didCheckRun = true;
        }
        
        if (now - lastFaceCheckTime > 800) {
            lastFaceCheckTime = now;
            const results = faceLandmarker.detectForVideo(videoElement, now);
            if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
                aiFaceIssue = "🪑 偵測到離座";
            } else {
                const nose = results.faceLandmarks[0][1];
                if (nose.y > 0.8) {
                    aiFaceIssue = (currentRoomMode === "1") ? "✍️ 抄筆記中..." : "💤 偵測到趴睡";
                } else {
                    aiFaceIssue = null;
                }
            }
            didCheckRun = true;
        }

        if (didCheckRun) {
            let currentIssue = null;
            
            let shouldWarnPhone = false;
            if (typeof currentRoomMode !== 'undefined' && currentRoomMode === 'tutor') {
                shouldWarnPhone = isPhoneDetected; 
            } else {
                shouldWarnPhone = (isPhoneDetected && !isPhoneFlipped); 
            }

            if (shouldWarnPhone) {
                currentIssue = "📱 使用手機";
            } else {
                currentIssue = aiFaceIssue;
            }
            
            handleDistractionBuffer(currentIssue, now);
        }
    }
    requestAnimationFrame(predictLoop);
}

function handleDistractionBuffer(issue, now) {
    let prevStatus = myStatus;
    
    if (window.isAIPaused) {
        distractionCounter = 0; 
        distractionStartTime = 0; 
        myStatus = "FOCUSED";
        if (window.RoomUI) window.RoomUI.hideWarning();
    }
    else if (issue === "✍️ 抄筆記中...") {
        distractionStartTime = 0; 
        distractionCounter = 0; 
        myStatus = "FOCUSED";
        if (window.RoomUI) window.RoomUI.hideWarning();
    } 
    else if (issue) {
        distractionCounter++; 
        if (distractionCounter >= STABLE_THRESHOLD) { 
            if (distractionStartTime === 0) distractionStartTime = now;
            const elapsed = (now - distractionStartTime) / 1000;
            let limit = (currentRoomMode === "2" || currentRoomMode === "simulated") ? 5 : 10;
            
            let type = "DISTRACTED";
            if (issue.includes("手機")) type = "PHONE";
            else if (issue.includes("趴睡")) type = "SLEEP";
            else if (issue.includes("離座")) type = "LEAVE";

            if (elapsed < limit) {
                myStatus = "FOCUSED"; 
                if (window.RoomUI) window.RoomUI.showWarning(type);
            } else {
                myStatus = (issue.includes("趴睡")) ? "SLEEPING" : "DISTRACTED";
                if (window.RoomUI) window.RoomUI.showWarning(type);
                
                if (myStatus !== prevStatus) {
                    captureViolation(issue);
                }
            }

            const currentNow = Date.now();
            if (currentNow - window.lastCameraViolationTime > 5000) { 
                window.lastCameraViolationTime = currentNow;
                
                const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '未知學員';
                const violationReason = issue || "🚫 鏡頭違規：離座/趴睡/手機"; 
                
                document.dispatchEvent(new CustomEvent('CameraViolation', {
                    detail: { name: myName, reason: violationReason }
                }));
            }
        }
    } else {
        distractionCounter = 0; 
        distractionStartTime = 0; 
        myStatus = "FOCUSED"; 
        if (window.RoomUI) window.RoomUI.hideWarning();
    }
    
    if(socket && (prevStatus !== myStatus || now - lastHeartbeat > 3000)) {
        lastHeartbeat = now;
        socket.emit("update_status", { status: myStatus, name: myUsername, isFlipped: isPhoneFlipped });
    }
}

function generateFinalReport(seconds) {
    const mins = Math.floor(seconds / 60);
    let score = 80 + mins - (window.totalViolationCount * 5);
    score = Math.max(0, Math.min(100, score));

    let details = Object.entries(window.violationDetails)
        .filter(([_, count]) => count > 0)
        .map(([key, val]) => `   ${key} x${val}`)
        .join("\n");
    if (!details) details = "   無違規紀錄，表現優異！✨";

    let comment = "";
    if (score >= 90) comment = "太不可思議了！你的專注力簡直就像是黑洞，把所有的知識都吸進去了！AI 老師為你感到驕傲，繼續保持這種王者風範！👑";
    else if (score >= 70) comment = "做得好！這段時間你展現了強大的意志力。雖然中間有一點點小分神，但你調整的速度非常快。你是個天生的學習者！💪";
    else if (score >= 50) comment = "今天辛苦了！學習的路途難免有分心的時候，但重要的是你完成了這段旅程。喝杯水休息一下，下次我們一起挑戰更高分！🌿";
    else comment = "感覺你今天的心情有點浮躁呢？沒關係，每個人都有狀態起伏的時候。AI 老師建議你先去散個步，找回平靜的自己。加油，明天會更好！💖";

    return { score, details, comment };
}

async function endSession() {
    let elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    if (window.StudyTimer && window.StudyTimer.totalSeconds > 0) {
        elapsedSeconds = window.StudyTimer.totalSeconds - window.StudyTimer.remainingSeconds;
    }
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const minRequired = 20;

    const report = generateFinalReport(elapsedSeconds);

    if (elapsedMinutes < minRequired && currentRoomMode === 'simulated') {
        const confirmLeave = confirm(`⚠️ 專注未滿 ${minRequired} 分鐘！\n現在離開將會「加重扣分」並留下記錄。\n\n確定要早退嗎？`);
        if (!confirmLeave) return;
        socket.emit("early_leave", { name: myUsername, elapsed: elapsedMinutes, penalty: true });
    }

    alert(`【今日專注結算報告】\n\n` +
          `💯 專注評分：${report.score} 分\n` +
          `🕒 總時長：${elapsedMinutes}分${elapsedSeconds % 60}秒\n\n` +
          `🚫 違規明細：\n${report.details}\n\n` +
          `🤖 AI 老師真心話：\n${report.comment}`);

    if (socket) {
        const reportData = {
            name: myUsername,
            score: report.score,
            duration: elapsedSeconds,
            violationCount: window.totalViolationCount,
            details: window.violationDetails,
            aiComment: report.comment,
            timestamp: new Date().toLocaleTimeString()
        };

        socket.emit("submit_final_report", reportData);

        if (currentRoomMode === 'tutor') {
            socket.emit("tutor_receive_report", reportData);
        }

        socket.emit('report_session_done', {
            name: myUsername,
            goal: document.getElementById('inputGoal')?.value || "自主學習",
            duration: elapsedMinutes,
            comment: report.comment,
            integrity: document.getElementById(`rank-item-YOU`)?.querySelector('.text-green-400')?.innerText || '100'
        });
    }

    const focusMinutes = Math.floor(elapsedSeconds / 60);
    const pomodoros = Math.floor(focusMinutes / 25); 
    const isDeepFocus = focusMinutes >= 120; 

    let gains = (pomodoros * 2) + (isDeepFocus ? 5 : 0);
    let penalties = window.totalViolationCount * 5; 
    
    let creditDelta = gains - penalties;
    if (creditDelta > 15) creditDelta = 15;
    if (creditDelta < -20) creditDelta = -20;

    if (focusMinutes >= 240 && socket) {
        socket.emit('community_event', { type: 'ACHIEVE', message: `恭喜 ${myUsername} 解鎖「鋼鐵意志」勳章！(單次專注4小時)` });
    } else if (focusMinutes >= 120 && socket) {
        socket.emit('community_event', { type: 'ACHIEVE', message: `恭喜 ${myUsername} 解鎖「深度潛航」勳章！(單次專注2小時)` });
    }

    try {
        await fetch('/api/save-focus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: myUsername,
                score: report.score,
                focusSeconds: elapsedSeconds,
                violationDetails: window.violationDetails,
                comment: report.comment,
                creditDelta: creditDelta 
            })
        });
    } catch (err) { 
        console.error("存檔失敗:", err); 
    }
    
    sessionStorage.removeItem('mobileLinked');
    localStorage.removeItem('mobileLinked');

    if(socket && socket.connected) {
        socket.emit("update_status", { status: "IDLE", name: myUsername, isFlipped: false });
        socket.emit('mobile_sync_update', { type: 'FORCE_DISCONNECT', studentName: myUsername });

        if (myUsername) {
            socket.emit('mobile_sync', { 
                username: myUsername, 
                connected: false, 
                isFlipped: false 
            });
        }

        await new Promise(resolve => setTimeout(resolve, 200));
        socket.disconnect();
    } else if (socket) {
        socket.disconnect();
    }
    
    window.location.href = 'index.html';
}

function showFloatingEmoji(emoji) {
    const el = document.createElement('div');
    el.className = 'fixed bottom-20 z-[60] pointer-events-none text-5xl animate-bounce'; 
    el.style.left = `${Math.random() * 60 + 20}%`;
    el.innerHTML = emoji;
    document.body.appendChild(el); 
    setTimeout(() => el.remove(), 2000);
}

function showPublicShamingToast(userName) {
    const toast = document.createElement('div');
    toast.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-red-900/95 to-red-600/95 text-white px-6 py-3 rounded-full font-bold text-sm z-[9999] shadow-[0_0_20px_rgba(220,38,38,0.8)] flex items-center gap-3 animate-bounce';
    toast.innerHTML = `<i class="fas fa-skull-crossbones text-xl text-black"></i> <span>快看！<b>${userName}</b>剛剛放棄了專注！</span> <i class="fas fa-hand-point-down text-xl text-black"></i>`;
    document.body.appendChild(toast);
    
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2855/2855-preview.mp3');
    audio.volume = 0.6;
    audio.play().catch(() => {});
    
    setTimeout(() => toast.remove(), 5000);
}

window.dismissAlertFromAI = function() {
    myStatus = "FOCUSED";
    if (socket) socket.emit("update_status", { status: "FOCUSED", name: myUsername, isFlipped: isPhoneFlipped });
};

window.initApp = initApp;
window.endSession = endSession;
window.sendReaction = (emoji) => {
    showFloatingEmoji(emoji);
    if(socket) socket.emit("send_reaction", { emoji, username: myUsername });
};

document.addEventListener("visibilitychange", () => {
    if (document.hidden && !window.isAIPaused && !isAuditMode && !window.isKickingOut) {
        const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '學員';
        console.log("偵測到切換分頁，準備處理違規...");
        
        if (typeof window.RoomUI !== 'undefined' && window.RoomUI.showWarning) {
            window.RoomUI.showWarning("DISTRACTED");
        }

        if (currentRoomMode !== 'tutor') {
            captureViolation("🚫 切換分頁 (離開視窗)");
        }

        document.dispatchEvent(new CustomEvent('TabSwitchedViolation', {
            detail: { name: myName }
        }));
    } else {
        if (typeof window.RoomUI !== 'undefined' && window.RoomUI.hideWarning) {
            window.RoomUI.hideWarning();
        }
    }
});