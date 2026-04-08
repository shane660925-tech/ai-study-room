/**
 * StudyVerse V2.2.2 - 手機連動偵測邏輯 (sync.js)
 */

const socket = io();
let isFlipped = false;
let username = "";
let wakeLock = null; // 用於防止休眠
let vibrationInterval = null; // 用於持續震動

// 當畫面載入完成後執行 (已修正：合併為單一區塊)
document.addEventListener('DOMContentLoaded', () => {
    // 自動嘗試載入大廳的姓名
    const savedName = localStorage.getItem('studyVerseUser');
    if (savedName) {
        const usernameInput = document.getElementById('username');
        if(usernameInput) usernameInput.value = savedName;
    }

    // 監聽 Socket 連線狀態
    socket.on('connect', () => {
        const cb = document.getElementById('connectionBadge');
        if(!cb) return;
        cb.classList.replace('bg-red-500/20', 'bg-green-500/20');
        cb.classList.replace('text-red-500', 'text-green-500');
        cb.innerHTML = '<i class="fas fa-wifi text-[8px]"></i> 連線正常';

        // ==========================================
        // 連線時主動發送狀態給大廳 (解決未翻轉無反應問題)
        // ==========================================
        const urlParams = new URLSearchParams(window.location.search);
        // 優先抓取網址上的 name，若無則用 localStorage 或全域 username
        const currentName = urlParams.get('name') || savedName || username;
        
        if (currentName) {
            // 主動告訴大廳：手機已連線，但目前尚未翻轉 (isFlipped: false)
            socket.emit('mobile_sync_update', {
                studentName: currentName,
                connected: true,
                isFlipped: false
            });
        }
    });

    socket.on('disconnect', () => {
        const cb = document.getElementById('connectionBadge');
        if(!cb) return;
        cb.classList.replace('bg-green-500/20', 'bg-red-500/20');
        cb.classList.replace('text-green-500', 'text-red-500');
        cb.innerHTML = '<i class="fas fa-times text-[8px]"></i> 連線中斷';
    });
});

// 必須綁定到 window，因為 HTML 中使用了 onclick="startSync()"
window.startSync = async function() {
    username = document.getElementById('username').value.trim();
    if (!username) return alert('請輸入姓名');

    // 儲存姓名方便下次使用
    localStorage.setItem('studyVerseUser', username);

    // iOS 設備授權 (必需)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') return alert('需要感應器權限才能運作');
        } catch (err) {
            console.error(err);
        }
    }

    document.getElementById('setupView').classList.add('hidden');
    document.getElementById('syncView').classList.remove('hidden');
    document.getElementById('displayName').innerText = username;

    // 啟動感應器
    window.addEventListener('deviceorientation', handleOrientation);
    
    // [關鍵修正 1] 先發送 join 確保伺服器登記這支手機為上線狀態
    socket.emit('join', { name: username, role: 'student' });

    // [關鍵修正 2] 建立共用的狀態發送函數，補齊大廳需要的所有判斷屬性
    const sendSyncData = () => {
        const payload = { 
            name: username, 
            username: username, // 確保前後端不同的變數命名都能抓到
            isFlipped: isFlipped, 
            status: isFlipped ? '深度專注中' : '線上', // 讓排行榜監聽器能正確判定
            connected: true 
        };
        socket.emit('update_status', payload);
        socket.emit('mobile_sync_update', payload); // 雙管齊下，觸發大廳秒解鎖
    };

    // 立即發送一次狀態
    sendSyncData();

    // 定時心跳連線 (將頻率從 3000 加快到 1500，反應更即時)
    setInterval(() => {
        if (socket.connected) {
            sendSyncData();
        }
    }, 1500);
};

function handleOrientation(event) {
    const beta = event.beta;   // 前後
    const gamma = event.gamma; // 左右

    // 偵測邏輯優化：面朝下 (絕對值接近 180)
    const currentlyFlipped = Math.abs(beta) > 160;

    if (currentlyFlipped !== isFlipped) {
        isFlipped = currentlyFlipped;
        updateUI();
        
        // [關鍵修正 3] 狀態改變時，也使用完整的 payload 雙管齊下發送
        const payload = { 
            name: username, 
            username: username, 
            isFlipped: isFlipped, 
            status: isFlipped ? '深度專注中' : '線上',
            connected: true 
        };
        socket.emit('update_status', payload);
        socket.emit('mobile_sync_update', payload);

        // V2.2.3 新增邏輯
        if (isFlipped) {
            // 成功翻轉：啟動防止休眠，停止震動
            requestWakeLock();
            stopContinuousVibrate();
        } else {
            // 手機被拿起：釋放防止休眠，啟動持續震動
            releaseWakeLock();
            startContinuousVibrate();
        }
    }
}

// 請求防止螢幕休眠
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('防止休眠已啟動');
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

// 釋放防止休眠
function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
        console.log('防止休眠已解除');
    }
}

function updateUI() {
    const ball = document.getElementById('statusBall');
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    const badge = document.getElementById('flipBadge');

    if (!ball || !icon || !text || !badge) return;

    if (isFlipped) {
        ball.classList.add('active-flip', 'pulse');
        ball.classList.remove('border-slate-700');
        icon.className = "fas fa-moon text-white text-4xl mb-2";
        text.innerText = "深度專注中";
        text.classList.replace('text-slate-500', 'text-white');
        badge.innerText = "已翻轉專注";
        badge.classList.replace('bg-slate-700', 'bg-blue-500');
        badge.classList.replace('text-slate-400', 'text-white');
        
        if (navigator.vibrate) navigator.vibrate(50);
    } else {
        ball.classList.remove('active-flip', 'pulse');
        ball.classList.add('border-slate-700');
        icon.className = "fas fa-arrow-down text-slate-600 text-4xl mb-2";
        text.innerText = "請將手機翻轉蓋上";
        text.classList.replace('text-white', 'text-slate-500');
        badge.innerText = "尚未翻轉";
        badge.classList.replace('bg-blue-500', 'bg-slate-700');
        badge.classList.replace('text-white', 'text-slate-400');
    }
}

function startContinuousVibrate() {
    if (!vibrationInterval && navigator.vibrate) {
        // 每 1.5 秒震動一次，直到翻轉回去
        vibrationInterval = setInterval(() => {
            navigator.vibrate(200); 
        }, 1500);
    }
}

function stopContinuousVibrate() {
    if (vibrationInterval) {
        clearInterval(vibrationInterval);
        vibrationInterval = null;
    }
}

// 處理教師端發送的喚醒警告震動
socket.on('admin_action', (data) => {
    if (data.type === 'WAKEUP' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]); // 簡短震動回饋
    }
});