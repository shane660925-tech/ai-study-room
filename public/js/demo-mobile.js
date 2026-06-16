(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = String(urlParams.get('roomId') || '').trim();

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

    function showPanel(name) {
        connectPanel.classList.toggle('active', name === 'connect');
        trackingPanel.classList.toggle('active', name === 'tracking');
        errorPanel.classList.toggle('active', name === 'error');
    }

    function setMessage(text) {
        connectMessage.textContent = text || '';
    }

    function showError(text) {
        errorText.textContent = text || '請重新掃描電腦畫面上的 QR Code。';
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
                reject(new Error('缺少 roomId'));
                return;
            }

            if (typeof io === 'undefined') {
                reject(new Error('找不到 Socket.IO'));
                return;
            }

            socket = io();

            socket.on('connect', () => {
                socket.emit('demo_flip_join_room', { roomId }, (res) => {
                    if (!res || !res.success) {
                        reject(new Error(res?.error || '加入體驗房間失敗'));
                        return;
                    }

                    hasJoinedRoom = true;
                    resolve(res);
                });
            });

            socket.on('connect_error', () => {
                reject(new Error('Socket 連線失敗'));
            });

            socket.on('demo_flip_room_reset', () => {
                hasEverFaceDown = false;
                lastSentState = '';
                sendState('ready', true);
                setPhoneUI('waiting', '等待翻轉', '請把手機螢幕朝下蓋在桌上');
            });
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
                sendState('cover_back', true);
                setPhoneUI('covered', '已蓋回手機', '電腦端警示會解除');
            } else {
                sendState('face_down');
                setPhoneUI('covered', '手機已蓋好', '目前是專注狀態');
            }

            return;
        }

        if (hasEverFaceDown) {
            sendState('face_up');
            setPhoneUI('open', '手機已翻開', '電腦端會出現 5 秒警示倒數');
        } else {
            setPhoneUI('waiting', '等待翻轉', '請先把手機螢幕朝下蓋在桌上');
        }
    }

    async function startTracking() {
        try {
            setMessage('正在連線到電腦端...');

            if (!socket || !hasJoinedRoom) {
                await connectSocket();
            }

            setMessage('正在請求手機動作感測權限...');
            await requestOrientationPermission();
            await requestWakeLock();

            sendState('ready', true);

            isTracking = true;
            hasEverFaceDown = false;
            lastSentState = 'ready';

            window.addEventListener('deviceorientation', handleOrientation, true);

            setPhoneUI('waiting', '等待翻轉', '請把手機螢幕朝下蓋在桌上');
            showPanel('tracking');

        } catch (err) {
            console.warn(err);
            showError(err.message || '手機翻轉體驗啟動失敗');
        }
    }

    if (!roomId) {
        showError('缺少體驗房間代碼，請重新掃描 QR Code。');
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