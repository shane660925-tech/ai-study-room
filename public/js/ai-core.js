import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js";

// ==========================================
// 1. 全域與核心狀態變數定義
// ==========================================
let socket, faceLandmarker, objectDetector, videoElement, localStream = null;
let myStatus = "FOCUSED", distractionStartTime = 0, lastObjectCheckTime = 0;
let isPhoneDetected = false, lastFaceCheckTime = 0, currentRoomMode = "1";
let lastVideoTime = -1;
let myUsername = localStorage.getItem('studyVerseUser') || "學員"; 

let distractionCounter = 0; 
const STABLE_THRESHOLD = 3; 
let aiFaceIssue = null; 
let lastHeartbeat = 0; 
let lastViolationTimes = {};    
let remoteUsers = [];
let isAuditMode = false; 

let isPhoneFlipped = sessionStorage.getItem('mobileLinked') === 'true';
let isFlipWarningActive = false; 

// 允許外部模組修改的標記
window.isAIPaused = false; 
window.lastCameraViolationTime = 0;
window.sessionStartTime = null; 

// --- [狀態同步橋樑] 讓外部檔案能存取與修改核心狀態 ---
Object.defineProperties(window, {
    "myStatus": { get: () => myStatus, set: (v) => myStatus = v },
    "isPhoneFlipped": { get: () => isPhoneFlipped, set: (v) => isPhoneFlipped = v },
    "isFlipWarningActive": { get: () => isFlipWarningActive, set: (v) => isFlipWarningActive = v },
    "remoteUsers": { get: () => remoteUsers, set: (v) => remoteUsers = v },
    "currentRoomMode": { get: () => currentRoomMode, set: (v) => currentRoomMode = v },
    "isAuditMode": { get: () => isAuditMode, set: (v) => isAuditMode = v },
    "myUsername": { get: () => myUsername, set: (v) => myUsername = v }
});

// 違規計數器
window.totalViolationCount = 0; 
window.violationDetails = {
    "📱 使用手機": 0,
    "🪑 偵測離座": 0,
    "💤 偵測趴睡": 0,
    "🚫 切換分頁": 0,
    "📱 手機翻轉中斷": 0, 
    "⚠️ 偵測分心": 0  // <--- 補上這個
};

// ==========================================
// 2. 初始化 Socket (單一連線防護機制)
// ==========================================
if (typeof io !== 'undefined') {
    if (!window.appSocket && !window.socket) {
        window.appSocket = io();
        window.socket = window.appSocket; 
    } else {
        window.appSocket = window.appSocket || window.socket;
    }
    
    socket = window.appSocket; 
    
    if (window.setupSocketEvents) {
        window.setupSocketEvents(socket, myUsername);
    } else {
        console.error("❌ 找不到 setupSocketEvents，請檢查 socket-events.js 是否已正確引入");
    }
}

// ==========================================
// 3. 系統初始化與 AI 模型載入
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const currentPath = window.location.pathname;
    
    if (currentPath.includes('immersive-room.html')) currentRoomMode = '2'; 
    else if (currentPath.includes('managed-room.html')) currentRoomMode = 'simulated'; 
    else if (currentPath.includes('tutor-room.html')) currentRoomMode = 'tutor'; 
    else if (currentPath.includes('course-room.html')) currentRoomMode = '1'; 
    else {
        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode');
        if (mode) currentRoomMode = mode;
    }

    if (window.updateUIMode) window.updateUIMode(currentRoomMode, isAuditMode);

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
    window.sessionStartTime = Date.now(); 
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentTeamId = urlParams.get('teamId') || null;
    isAuditMode = urlParams.get('audit') === 'true'; 

    const sidebarName = document.getElementById("mySidebarName");
    if (sidebarName) sidebarName.innerText = name;
    const sidebarGoal = document.getElementById("mySidebarGoal");
    if (sidebarGoal) sidebarGoal.innerText = goal;
    const dashGoal = document.getElementById("dashboardGoal");
    if (dashGoal) dashGoal.innerText = goal;
    const avatar = document.getElementById("mySidebarAvatar");
    if (avatar) avatar.src = `https://api.dicebear.com/7.x/big-smile/svg?seed=${name}`;
    
    if (window.updateUIMode) window.updateUIMode(currentRoomMode, isAuditMode);

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
            const overlay = document.getElementById('startOverlay');
            if(overlay) overlay.style.display = 'none';
            predictLoop();
        };
    }
}

// ==========================================
// 4. AI 影像辨識與判定迴圈
// ==========================================
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

    if (isCurrentlyBreaking || isFlipWarningActive || isAuditMode) { 
        requestAnimationFrame(predictLoop); 
        return; 
    }

    if (window.sessionStartTime && (realNow - window.sessionStartTime < 8000)) {
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
            let shouldWarnPhone = (currentRoomMode === 'tutor') ? isPhoneDetected : (isPhoneDetected && !isPhoneFlipped);

            if (shouldWarnPhone) currentIssue = "📱 使用手機";
            else currentIssue = aiFaceIssue;
            
            handleDistractionBuffer(currentIssue, now);
        }
    }
    requestAnimationFrame(predictLoop);
}

function handleDistractionBuffer(issue, now) {
    let prevStatus = myStatus;
    
    if (window.isAIPaused || issue === "✍️ 抄筆記中...") {
        distractionCounter = 0; 
        distractionStartTime = 0; 
        myStatus = "FOCUSED";
        if (window.RoomUI && window.RoomUI.hideWarning) window.RoomUI.hideWarning();
    } 
    else if (issue) {
        distractionCounter++; 
        
        // 🚀 核心修正：一旦達到了警告閾值，立刻觸發拍照並將影像傳給教師端！
        if (distractionCounter === STABLE_THRESHOLD) {
            if (distractionStartTime === 0) distractionStartTime = now;
            captureViolation(issue);
        }

        if (distractionCounter >= STABLE_THRESHOLD) { 
            const elapsed = (now - distractionStartTime) / 1000;
            let limit = (currentRoomMode === "2" || currentRoomMode === "simulated") ? 5 : 10;
            
            let type = "DISTRACTED";
            if (issue.includes("手機")) type = "PHONE";
            else if (issue.includes("趴睡")) type = "SLEEP";
            else if (issue.includes("離座")) type = "LEAVE";

            if (elapsed < limit) {
                myStatus = "FOCUSED"; 
                if (window.RoomUI && window.RoomUI.showWarning) window.RoomUI.showWarning(type);
            } else {
                myStatus = (issue.includes("趴睡")) ? "SLEEPING" : "DISTRACTED";
                if (window.RoomUI && window.RoomUI.showWarning) window.RoomUI.showWarning(type);
            }

            const currentNow = Date.now();
            if (currentNow - window.lastCameraViolationTime > 5000) { 
                window.lastCameraViolationTime = currentNow;
                const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '未知學員';
                const violationReason = issue || "🚫 鏡頭違規：離座/趴睡/手機"; 
                
                document.dispatchEvent(new CustomEvent('CameraViolation', { detail: { name: myName, reason: violationReason } }));
            }
        }
    } else {
        distractionCounter = 0; 
        distractionStartTime = 0; 
        myStatus = "FOCUSED"; 
        if (window.RoomUI && window.RoomUI.hideWarning) window.RoomUI.hideWarning();
    }
    
    if(socket && (prevStatus !== myStatus || now - lastHeartbeat > 3000)) {
        lastHeartbeat = now;
        socket.emit("update_status", { status: myStatus, name: myUsername, isFlipped: isPhoneFlipped });
    }
}

// ==========================================
// 5. 違規截圖與資料上傳
// ==========================================
async function captureViolation(reason) {
    if (currentRoomMode !== 'tutor' || reason.includes("中斷") || reason.includes("踢出")) {
        window.totalViolationCount++;
        if (reason.includes("手機") && !reason.includes("中斷") && !reason.includes("踢出")) window.violationDetails["📱 使用手機"]++;
        else if (reason.includes("離座")) window.violationDetails["🪑 偵測離座"]++;
        else if (reason.includes("趴睡")) window.violationDetails["💤 偵測趴睡"]++;
        else if (reason.includes("中斷") || reason.includes("踢出")) window.violationDetails["📱 手機翻轉中斷"]++;
        else if (reason.includes("分頁")) window.violationDetails["🚫 切換分頁"]++; 
        else if (reason.includes("分心")) window.violationDetails["⚠️ 偵測分心"]++; // <--- 補上這行
    }

    const now = Date.now();
    // 獨立判斷各項違規，避免連續測試時被其他違規的冷卻時間卡住
    const reasonKey = reason.includes("手機") ? "phone" : (reason.includes("趴睡") ? "sleep" : (reason.includes("離座") ? "leave" : (reason.includes("分心") ? "distract" : "other")));
    
    if (!lastViolationTimes[reasonKey]) lastViolationTimes[reasonKey] = 0;
    if (now - lastViolationTimes[reasonKey] < 15000 && !reason.includes("中斷") && !reason.includes("踢出") && !reason.includes("分頁")) {
        return; 
    }
    lastViolationTimes[reasonKey] = now;
    
    let imageData = null;
    
    // 🚀 核心修正：明確定義「僅需文字紀錄」的項目，其餘(手機、趴睡、離座、分心)皆需截圖
    const isTextOnly = reason.includes("中斷") || reason.includes("踢出") || reason.includes("分頁") || reason.includes("擅自翻開");
    const needsScreenshot = !isTextOnly;

    if (needsScreenshot && videoElement && videoElement.videoWidth > 0) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = (videoElement.videoHeight / videoElement.videoWidth) * 320 || 240;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                imageData = canvas.toDataURL('image/jpeg', 0.4); 
            }
        } catch (err) {
            console.warn("截圖失敗:", err);
        }
    }
    
    if (socket) {
        // 確保精確發送 type，避免後端判定混淆
        let violationType = 'DISTRACTED';
        if (reason.includes("手機")) violationType = 'PHONE_IN_VIDEO';
        else if (reason.includes("趴睡")) violationType = 'SLEEPING';
        else if (reason.includes("離座")) violationType = 'LEFT_SEAT';
        else if (reason.includes("分頁")) violationType = 'TAB_SWITCH';

        socket.emit("report_violation", {
            name: myUsername, 
            type: violationType,
            reason: reason, 
            image: imageData, 
            time: new Date().toLocaleTimeString()
        });
    }
}
// ==========================================
// 6. 防作弊機制 (手機翻轉補刀、感測器、分頁切換)
// ==========================================
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
            if (window.showFlipCountdownModal) window.showFlipCountdownModal();

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
                    if (window.hideFlipCountdownModal) window.hideFlipCountdownModal();
                    
                    window.totalViolationCount++;
                    window.violationDetails["📱 手機翻轉中斷"] = (window.violationDetails["📱 手機翻轉中斷"] || 0) + 1;
                    
                    if (socket) {
                        socket.emit('violation', { name: myUsername, type: '🚨 翻轉中斷 (強制踢出教室)', image: null });
                    }
                    
                    setTimeout(async () => {
                        alert("🚨 您已違反翻轉專注規則，系統即將為您結算專注數據並通報導師！");
                        if (window.endSession) await window.endSession();
                    }, 100);
                }
            }, 5000);
        }
    }, 500); 
};

window.addEventListener('deviceorientation', (event) => {
    if (sessionStorage.getItem('mobileLinked') === 'true') return; 
    if (event.beta === null) return;
    
    const currentlyFlipped = Math.abs(event.beta) > 150;
    if (currentlyFlipped !== isPhoneFlipped) {
        isPhoneFlipped = currentlyFlipped;
        console.log("📱 翻轉狀態改變:", isPhoneFlipped ? "已翻轉 (螢幕朝下)" : "正常 (螢幕朝上)");
        if (socket) {
            socket.emit("update_status", { status: myStatus, name: myUsername, isFlipped: isPhoneFlipped });
        }
    }
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden && !window.isAIPaused && !window.isAuditMode && !window.isKickingOut) {
        const myName = localStorage.getItem('studyVerseUser') || document.getElementById('inputName')?.value || '學員';
        console.log("偵測到切換分頁，準備處理違規...");
        
        if (typeof window.RoomUI !== 'undefined' && window.RoomUI.showWarning) window.RoomUI.showWarning("DISTRACTED");
        if (window.currentRoomMode !== 'tutor') captureViolation("🚫 切換分頁 (離開視窗)");

        document.dispatchEvent(new CustomEvent('TabSwitchedViolation', { detail: { name: myName } }));
    } else {
        if (typeof window.RoomUI !== 'undefined' && window.RoomUI.hideWarning) window.RoomUI.hideWarning();
    }
});

// ==========================================
// 7. 綁定給 HTML 呼叫的全域函數
// ==========================================
window.dismissAlertFromAI = function() {
    myStatus = "FOCUSED";
    if (socket) socket.emit("update_status", { status: "FOCUSED", name: myUsername, isFlipped: isPhoneFlipped });
};

window.initApp = initApp;