(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = String(urlParams.get('roomId') || '').trim();
    const wasKicked = urlParams.get('kicked') === '1';

    const connectPanel = document.getElementById('connectPanel');
    const trackingPanel = document.getElementById('trackingPanel');
    const errorPanel = document.getElementById('errorPanel');

    const roomIdText = document.getElementById('roomIdText');
    const startPhoneBtn = document.getElementById('startPhoneBtn');
    const connectMessage = document.getElementById('connectMessage');
    const errorText = document.getElementById('errorText');

    const phoneStatusBox = document.getElementById('phoneStatusBox');
    const phoneStatusIcon = document.getElementById('phoneStatusIcon');
    const phoneStatusTitle = document.getElementById('phoneStatusTitle');
    const phoneStatusText = document.getElementById('phoneStatusText');

    const betaValue = document.getElementById('betaValue');
    const gammaValue = document.getElementById('gammaValue');

    let socket = null;
    let hasJoinedRoom = false;
    let isTracking = false;
    let hasEverFaceDown = false;
    let lastSentState = '';
    let wakeLock = null;

    roomIdText.textContent = roomId || '缺少房間';
    if (wasKicked) {
    setMessage('剛剛因為手機翻開超過 5 秒，已離開本次體驗。若要重新測試，請回電腦端重新產生 QR Code。');
    startPhoneBtn.disabled = true;
}

    function showPanel(name) {
        connectPanel.classList.toggle('active', name === 'connect');
        trackingPanel.classList.toggle('active', name === 'tracking');
        errorPanel.classList.toggle('active', name === 'error');
    }

    function setMessage(text) {
        connectMessage.textContent = text || '';
    }

    function showError(text) {
    const finalText = text || '請重新掃描電腦畫面上的 QR Code。';
    errorText.textContent = finalText;
    console.error('[DemoMobile Error]', finalText);
    showPanel('error');
}

    function setPhoneUI(type, title, text) {
        phoneStatusBox.classList.remove('waiting', 'covered', 'open');
        phoneStatusBox.classList.add(type);

        if (type === 'covered') {
            phoneStatusIcon.className = 'fas fa-mobile-screen-button';
        } else if (type === 'open') {
            phoneStatusIcon.className = 'fas fa-triangle-exclamation';
        } else {
            phoneStatusIcon.className = 'fas fa-mobile-screen-button';
        }

        phoneStatusTitle.textContent = title;
        phoneStatusText.textContent = text;
    }

    let mobileWarningTimer = null;
let mobileWarningCount = 5;
let mobileKickoutTimer = null;

function clearMobileWarning() {
    if (mobileWarningTimer) {
        clearInterval(mobileWarningTimer);
        mobileWarningTimer = null;
    }

    mobileWarningCount = 5;

    const oldOverlay = document.getElementById('mobileWarningOverlay');
    if (oldOverlay) oldOverlay.remove();
}

function showMobileWarning() {
    if (document.getElementById('mobileWarningOverlay')) return;

    mobileWarningCount = 5;

    const overlay = document.createElement('div');
    overlay.id = 'mobileWarningOverlay';
    overlay.innerHTML = `
        <div class="mobile-warning-inner">
            <i class="fas fa-triangle-exclamation"></i>
            <h1>手機已翻開！</h1>
            <p>請在倒數結束前把手機螢幕朝下蓋回桌面</p>
            <strong id="mobileWarningNumber">5</strong>
        </div>
    `;

    document.body.appendChild(overlay);

    mobileWarningTimer = setInterval(() => {
        mobileWarningCount -= 1;

        const numberEl = document.getElementById('mobileWarningNumber');
        if (numberEl) numberEl.textContent = String(mobileWarningCount);

        if (mobileWarningCount <= 0) {
            clearMobileWarning();
        }
    }, 1000);
}

function showMobileKickoutAndReturnHome() {
    clearMobileWarning();

    isTracking = false;
    window.removeEventListener('deviceorientation', handleOrientation, true);

    if (mobileKickoutTimer) {
        clearTimeout(mobileKickoutTimer);
        mobileKickoutTimer = null;
    }

    const oldOverlay = document.getElementById('mobileKickoutOverlay');
    if (oldOverlay) oldOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mobileKickoutOverlay';
    overlay.innerHTML = `
        <div class="mobile-kickout-inner">
            <i class="fas fa-door-open"></i>
            <h1>已被踢出教室</h1>
            <p>手機翻開超過限制時間，本次自習已中斷。</p>
            <span>即將返回手機體驗首頁...</span>
        </div>
    `;

    document.body.appendChild(overlay);

    mobileKickoutTimer = setTimeout(() => {
        window.location.href = `/demo-mobile.html?roomId=${encodeURIComponent(roomId)}&kicked=1`;
    }, 2200);
}

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {
            console.warn('WakeLock 無法啟用：', err);
        }
    }

    async function requestOrientationPermission() {
        if (
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
            const permission = await DeviceOrientationEvent.requestPermission();

            if (permission !== 'granted') {
                throw new Error('未允許動作與方向權限');
            }
        }
    }

    function connectSocket() {
    return new Promise((resolve, reject) => {
        if (!roomId) {
            reject(new Error('缺少 roomId，請重新掃描電腦端 QR Code'));
            return;
        }

        if (typeof io === 'undefined') {
            reject(new Error('找不到 Socket.IO，請確認 /socket.io/socket.io.js 是否正常載入'));
            return;
        }

        let settled = false;

        function fail(message) {
            if (settled) return;
            settled = true;

            if (socket) {
                socket.disconnect();
                socket = null;
            }

            reject(new Error(message));
        }

        socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            timeout: 8000
        });

        socket.on('connect', () => {
            setMessage('已連上伺服器，正在加入體驗房間...');

            socket.emit('demo_flip_join_room', { roomId }, (res) => {
                if (!res || !res.success) {
                    fail(res?.error || '加入體驗房間失敗，請回電腦端重新產生 QR Code');
                    return;
                }

                settled = true;
                hasJoinedRoom = true;
                resolve(res);
            });
        });

        socket.on('connect_error', (err) => {
            fail(`Socket 連線失敗：${err?.message || '未知錯誤'}`);
        });

        socket.on('demo_flip_room_reset', () => {
            hasEverFaceDown = false;
            lastSentState = '';
            sendState('ready', true);
            setPhoneUI('waiting', '等待翻轉', '請把手機螢幕朝下蓋在桌上');
        });

                    socket.on('demo_flip_kickout', () => {
                showMobileKickoutAndReturnHome();
            });

        setTimeout(() => {
            if (!settled) {
                fail('等待伺服器回應逾時，請回電腦端重新產生 QR Code');
            }
        }, 10000);
    });
}

    function sendState(state, force = false) {
        if (!socket || !hasJoinedRoom) return;

        if (!force && lastSentState === state) {
            return;
        }

        lastSentState = state;

        socket.emit('demo_flip_phone_state', {
            roomId,
            state
        }, (res) => {
            if (!res || !res.success) {
                console.warn('手機狀態回報失敗：', res);
            }
        });
    }

    function isDeviceFaceDown(beta, gamma) {
        if (typeof beta !== 'number' || typeof gamma !== 'number') {
            return false;
        }

        return (beta > 135 || beta < -135) && Math.abs(gamma) < 45;
    }

    function handleOrientation(event) {
        if (!isTracking) return;

        const beta = Number(event.beta || 0);
        const gamma = Number(event.gamma || 0);

        betaValue.textContent = beta.toFixed(0);
        gammaValue.textContent = gamma.toFixed(0);

        const faceDown = isDeviceFaceDown(beta, gamma);

        if (faceDown) {
            hasEverFaceDown = true;

                        if (lastSentState === 'face_up') {
                clearMobileWarning();
                sendState('cover_back', true);
                setPhoneUI('covered', '已蓋回手機', '電腦端警示會解除');
            } else {
                clearMobileWarning();
                sendState('face_down');
                setPhoneUI('covered', '手機已蓋好', '目前是專注狀態');
            }

            return;
        }

                if (hasEverFaceDown) {
            sendState('face_up');
            setPhoneUI('open', '手機已翻開', '請在 5 秒內蓋回手機');
            showMobileWarning();
        } else {
            setPhoneUI('waiting', '等待翻轉', '請先把手機螢幕朝下蓋在桌上');
        }
    }

    async function startTracking() {
    try {
        startPhoneBtn.disabled = true;
        setMessage('正在請求手機動作感測權限...');

        // 重要：這一段必須直接接在使用者點擊按鈕後執行
        // 不能放在 await connectSocket() 後面，否則 iPhone 會判定不是 user gesture
        await requestOrientationPermission();

        await requestWakeLock();

        setMessage('正在連線到電腦端...');

        if (!socket || !hasJoinedRoom) {
            await connectSocket();
        }

        sendState('ready', true);

        isTracking = true;
        hasEverFaceDown = false;
        lastSentState = 'ready';

        window.addEventListener('deviceorientation', handleOrientation, true);

        setPhoneUI('waiting', '等待翻轉', '請把手機螢幕朝下蓋在桌上');
        showPanel('tracking');

    } catch (err) {
        console.warn(err);
        startPhoneBtn.disabled = false;
        showError(err.message || '手機翻轉體驗啟動失敗');
    }
}

    if (!roomId) {
    roomIdText.textContent = '尚未連線';
    startPhoneBtn.disabled = true;
    setMessage('請回到電腦端重新產生 QR Code，或重新掃描 QR Code 開始新的體驗。');
    showPanel('connect');
    return;
}

    startPhoneBtn.addEventListener('click', startTracking);

    window.addEventListener('beforeunload', () => {
        isTracking = false;
        window.removeEventListener('deviceorientation', handleOrientation, true);

        if (wakeLock) {
            wakeLock.release().catch(() => {});
            wakeLock = null;
        }

        if (socket) {
            socket.disconnect();
        }
    });
})();