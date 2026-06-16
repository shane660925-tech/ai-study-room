(() => {
    const introPanel = document.getElementById('introPanel');
    const cameraPanel = document.getElementById('cameraPanel');
    const flipPanel = document.getElementById('flipPanel');

    const startDemoBtn = document.getElementById('startDemoBtn');
    const openCameraBtn = document.getElementById('openCameraBtn');
    const retryBtn = document.getElementById('retryBtn');
    const againBtn = document.getElementById('againBtn');
    const nextSleepBtn = document.getElementById('nextSleepBtn');
const nextPhoneDetectBtn = document.getElementById('nextPhoneDetectBtn');
const nextFlipBtn = document.getElementById('nextFlipBtn');

    const video = document.getElementById('demoVideo');
    const canvas = document.getElementById('demoCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const placeholder = document.getElementById('cameraPlaceholder');
    const successOverlay = document.getElementById('successOverlay');
    const resultPanel = document.getElementById('resultPanel');

    const taskStep = document.getElementById('taskStep');
    const taskTitle = document.getElementById('taskTitle');
    const taskText = document.getElementById('taskText');
    const progressBar = document.getElementById('progressBar');

    const emptyLog = document.getElementById('emptyLog');
    const eventLog = document.getElementById('eventLog');

    const demoQrBox = document.getElementById('demoQrBox');
    const demoRoomCode = document.getElementById('demoRoomCode');
    const demoMobileLink = document.getElementById('demoMobileLink');
    const recreateFlipRoomBtn = document.getElementById('recreateFlipRoomBtn');
    const resetFlipBtn = document.getElementById('resetFlipBtn');

    const linkLight = document.getElementById('linkLight');
const coverLight = document.getElementById('coverLight');
const warningLight = document.getElementById('warningLight');
    const flipWarningBox = document.getElementById('flipWarningBox');
    const kickoutBox = document.getElementById('kickoutBox');
    const flipCountdown = document.getElementById('flipCountdown');

    let stream = null;
    let baselineFrame = null;
    let rafId = null;
    let phase = 'intro';
    let phaseStartAt = 0;
    let awayStartAt = 0;
    let hasCompleted = false;
    let currentDetectionMode = 'away';

    const CALIBRATION_MS = 3000;
    const AWAY_REQUIRED_MS = 1800;
    const DIFF_THRESHOLD = 34;
    const SLEEP_DIFF_THRESHOLD = 22;
const SLEEP_REQUIRED_MS = 1600;
let sleepStartAt = 0;

    let demoFlipSocket = null;
    let demoRoomId = '';
    let hasDemoSocketListeners = false;
    let flipWarningTimer = null;
    let flipWarningCount = 5;
    let isFlipWarningActive = false;
    let isKickoutShown = false;

    function switchPanel(next) {
        introPanel.classList.toggle('active', next === 'intro');
        cameraPanel.classList.toggle('active', next === 'camera');
        flipPanel.classList.toggle('active', next === 'flip');
    }

    function setTask(step, title, text) {
        taskStep.textContent = step;
        taskTitle.textContent = title;
        taskText.textContent = text;
    }

    function setProgress(value) {
        const safeValue = Math.max(0, Math.min(100, value));
        progressBar.style.width = `${safeValue}%`;
    }

    function nowText() {
        return new Date().toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    function addLog(title, text) {
        emptyLog.classList.add('hidden');

        const item = document.createElement('article');
        item.className = 'log-item';
        item.innerHTML = `
            <strong>時間：${nowText()}｜${title}</strong>
            <span>${text}</span>
        `;

        eventLog.prepend(item);
    }

    async function openCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                },
                audio: false
            });

            video.srcObject = stream;
            placeholder.classList.add('is-hidden');

            await video.play();

            phase = 'calibrating';
phaseStartAt = performance.now();
baselineFrame = null;
hasCompleted = false;
awayStartAt = 0;
sleepStartAt = 0;

if (!currentDetectionMode) {
    currentDetectionMode = 'away';
}

            openCameraBtn.hidden = true;
            retryBtn.hidden = false;
            resultPanel.hidden = true;
            successOverlay.classList.remove('active');

            if (currentDetectionMode === 'sleep') {
    setTask(
        'Step 2',
        '請先坐直，讓系統校準你的正常讀書姿勢。',
        '請保持在鏡頭前約 3 秒。校準完成後，系統會請你做出趴睡或明顯低頭的姿勢。'
    );
} else {
    setTask(
        'Step 1',
        '請先坐在鏡頭前，讓系統校準。',
        '請停留在畫面中央約 3 秒。校準完成後，系統會請你離開鏡頭幾秒鐘。'
    );
}
            setProgress(0);

            const successStrong = successOverlay.querySelector('strong');
const successSpan = successOverlay.querySelector('span');
const successIcon = successOverlay.querySelector('i');

if (successIcon) successIcon.className = 'fas fa-person-walking-arrow-right';
if (successStrong) successStrong.textContent = '偵測到離座！';
if (successSpan) successSpan.textContent = '成功完成本次體驗任務';

const resultTitle = resultPanel.querySelector('h3');
const resultParagraphs = resultPanel.querySelectorAll('p');

if (resultTitle) {
    resultTitle.textContent = '離座提醒代表什麼？';
}

if (resultParagraphs[0]) {
    resultParagraphs[0].textContent = '坐在書桌前很久，不代表整段時間都真的在讀。如果自習中途離開座位，系統會記錄這個提醒事件，讓學生在自習結束後回顧自己的狀態。';
}

if (resultParagraphs[1]) {
    resultParagraphs[1].textContent = '這不是為了責備孩子，而是讓孩子知道：這段自習有沒有真的連續進入狀態，以及下次可以怎麼調整。';
}

nextSleepBtn.hidden = true;
nextPhoneDetectBtn.hidden = true;
nextFlipBtn.hidden = true;

            loop();
        } catch (err) {
            console.warn('無法開啟鏡頭：', err);
            setTask(
                'Camera blocked',
                '無法開啟鏡頭。',
                '你可以檢查瀏覽器權限，或稍後重新整理頁面再試一次。'
            );
        }
    }

    function captureFrame() {
        if (!video.videoWidth || !video.videoHeight) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const cropX = Math.floor(canvas.width * 0.2);
        const cropY = Math.floor(canvas.height * 0.1);
        const cropW = Math.floor(canvas.width * 0.6);
        const cropH = Math.floor(canvas.height * 0.8);

        return ctx.getImageData(cropX, cropY, cropW, cropH);
    }

    function diffFrames(a, b) {
        if (!a || !b || a.data.length !== b.data.length) return 0;

        let total = 0;
        const dataA = a.data;
        const dataB = b.data;

        for (let i = 0; i < dataA.length; i += 16) {
            const dr = Math.abs(dataA[i] - dataB[i]);
            const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
            const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
            total += (dr + dg + db) / 3;
        }

        return total / (dataA.length / 16);
    }

    function completeAwayDetection() {
        if (hasCompleted) return;

        hasCompleted = true;
        phase = 'completed';

        successOverlay.classList.add('active');
        setProgress(100);

        addLog(
            '離座提醒',
            '偵測到你離開鏡頭。正式自習中，這類事件會成為學習總結裡的提醒紀錄。'
        );

        setTask(
            'Detection Success',
            '偵測到離座！',
            '你已完成離座偵測體驗。正式使用時，這會被整理成自習過程中的狀態提醒。'
        );

        nextSleepBtn.hidden = false;
nextPhoneDetectBtn.hidden = true;
nextFlipBtn.hidden = true;

        resultPanel.hidden = false;

        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    function completeSleepDetection() {
    if (hasCompleted) return;

    hasCompleted = true;
    phase = 'completed';

    successOverlay.classList.add('active');
    setProgress(100);

    const successStrong = successOverlay.querySelector('strong');
    const successSpan = successOverlay.querySelector('span');
    const successIcon = successOverlay.querySelector('i');

    if (successIcon) successIcon.className = 'fas fa-bed';
    if (successStrong) successStrong.textContent = '偵測到趴睡！';
    if (successSpan) successSpan.textContent = '成功完成趴睡偵測任務';

    addLog(
        '趴睡提醒',
        '偵測到你做出趴睡或明顯低頭姿勢。正式自習中，這類事件會成為學習總結裡的提醒紀錄。'
    );

    setTask(
        'Detection Success',
        '偵測到趴睡！',
        '你已完成趴睡偵測體驗。正式使用時，系統會把這類狀態整理成自習結束後的回顧提醒。'
    );

    const resultTitle = resultPanel.querySelector('h3');
    const resultParagraphs = resultPanel.querySelectorAll('p');

    if (resultTitle) {
        resultTitle.textContent = '趴睡提醒代表什麼？';
    }

    if (resultParagraphs[0]) {
        resultParagraphs[0].textContent = '自習中短暫低頭不一定是問題，但如果長時間趴著或離開讀書狀態，學生其實很難自己察覺。';
    }

    if (resultParagraphs[1]) {
        resultParagraphs[1].textContent = 'STUDY VERSE 不是要責備孩子，而是把容易中斷專注的狀態整理出來，讓學生在結束後可以回顧。';
    }

    nextSleepBtn.hidden = true;
    nextPhoneDetectBtn.hidden = false;
    nextFlipBtn.hidden = true;

    resultPanel.hidden = false;

    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

    function loop() {
        const now = performance.now();
        const frame = captureFrame();

        if (phase === 'calibrating') {
            const elapsed = now - phaseStartAt;
            setProgress((elapsed / CALIBRATION_MS) * 100);

            if (elapsed >= CALIBRATION_MS && frame) {
                baselineFrame = frame;
                phase = 'detectingAway';
                phaseStartAt = now;
                awayStartAt = 0;

                if (currentDetectionMode === 'sleep') {
    setTask(
        'Step 2',
        '請做出趴睡或明顯低頭的姿勢。',
        '請讓姿勢維持約 2 秒。這是模擬學生讀書中途趴下休息或睡著的情境。'
    );
} else {
    setTask(
        'Step 2',
        '請離開鏡頭幾秒鐘。',
        '就像孩子讀書讀到一半暫時離開書桌。系統會等待畫面狀態改變並維持一小段時間。'
    );
}
setProgress(0);
            }
        } else if (phase === 'detectingAway' && frame && baselineFrame) {
    const diff = diffFrames(baselineFrame, frame);

    if (currentDetectionMode === 'sleep') {
        const isSleepLike = diff > SLEEP_DIFF_THRESHOLD;

        if (isSleepLike) {
            if (!sleepStartAt) sleepStartAt = now;
            const sleepElapsed = now - sleepStartAt;
            setProgress((sleepElapsed / SLEEP_REQUIRED_MS) * 100);

            if (sleepElapsed >= SLEEP_REQUIRED_MS) {
                completeSleepDetection();
                return;
            }
        } else {
            sleepStartAt = 0;
            setProgress(0);
        }

        rafId = requestAnimationFrame(loop);
        return;
    }

    const isAwayLike = diff > DIFF_THRESHOLD;

    if (isAwayLike) {
        if (!awayStartAt) awayStartAt = now;
        const awayElapsed = now - awayStartAt;
        setProgress((awayElapsed / AWAY_REQUIRED_MS) * 100);

        if (awayElapsed >= AWAY_REQUIRED_MS) {
            completeAwayDetection();
            return;
        }
    } else {
        awayStartAt = 0;
        setProgress(0);
    }
}
        rafId = requestAnimationFrame(loop);
    }

    function startSleepDetection() {
    currentDetectionMode = 'sleep';

    baselineFrame = null;
    phase = 'calibrating';
    phaseStartAt = performance.now();
    awayStartAt = 0;
    sleepStartAt = 0;
    hasCompleted = false;

    successOverlay.classList.remove('active');
    resultPanel.hidden = true;
    setProgress(0);

    openCameraBtn.hidden = true;
    retryBtn.hidden = false;

    nextSleepBtn.hidden = true;
    nextPhoneDetectBtn.hidden = true;
    nextFlipBtn.hidden = true;

    setTask(
        'Step 2',
        '請先坐直，讓系統校準你的正常讀書姿勢。',
        '請保持在鏡頭前約 3 秒。校準完成後，系統會請你做出趴睡或明顯低頭的姿勢。'
    );

    if (!stream) {
        openCamera();
        return;
    }

    loop();
}

    function resetDemo() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        baselineFrame = null;
        phase = 'intro';
        phaseStartAt = 0;
        awayStartAt = 0;
        hasCompleted = false;
        currentDetectionMode = 'away';
sleepStartAt = 0;

        successOverlay.classList.remove('active');
        resultPanel.hidden = true;
        setProgress(0);

        successOverlay.classList.remove('active');

        setTask(
            'Step 1',
            '請先坐在鏡頭前，讓系統校準。',
            '開啟鏡頭後，請先停留在畫面中央 3 秒。校準完成後，系統會請你離開鏡頭幾秒鐘。'
        );

        openCameraBtn.hidden = false;
        retryBtn.hidden = true;
    }

    function stopCamera() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }

        if (video) {
            video.srcObject = null;
        }
    }

    function setLight(el, state, text) {
    if (!el) return;

    el.classList.remove('waiting', 'good', 'danger');

    if (state) {
        el.classList.add(state);
    }

    const small = el.querySelector('small');
    if (small && text) {
        small.textContent = text;
    }
}

function setFlipIdleUI() {
    setLight(linkLight, 'waiting', '請先掃描 QR Code');
    setLight(coverLight, '', '等待手機螢幕朝下');
    setLight(warningLight, '', '翻開手機時才會啟動');
}

function setFlipConnectedUI() {
    setLight(linkLight, 'waiting', '手機已連線，請在手機上按開始');
    setLight(coverLight, '', '等待手機螢幕朝下');
    setLight(warningLight, '', '尚未觸發警示');
}

function setFlipCoveredUI(text = '手機已蓋好，專注中') {
    setLight(linkLight, 'good', '手機已連線');
    setLight(coverLight, 'good', text);
    setLight(warningLight, '', '尚未觸發警示');
}

function setFlipWarningUI() {
    setLight(linkLight, 'good', '手機已連線');
    setLight(coverLight, 'danger', '手機已翻開');
    setLight(warningLight, 'danger', '警示倒數中');
}

function setFlipKickoutUI() {
    setLight(linkLight, 'good', '手機已連線');
    setLight(coverLight, 'danger', '手機翻開超時');
    setLight(warningLight, 'danger', '已離開教室');
}

    function clearFlipWarningTimer() {
        if (flipWarningTimer) {
            clearInterval(flipWarningTimer);
            flipWarningTimer = null;
        }

        isFlipWarningActive = false;
        flipWarningCount = 5;
        flipCountdown.textContent = '5';
        flipWarningBox.hidden = true;
    }

    function resetFlipUI() {
    clearFlipWarningTimer();

    isKickoutShown = false;
    kickoutBox.hidden = true;
    resetFlipBtn.hidden = true;

    setFlipIdleUI();
}

    function buildMobileUrl(roomId) {
        return `${window.location.origin}/demo-mobile.html?roomId=${encodeURIComponent(roomId)}`;
    }

    function renderQrCode(url) {
        demoQrBox.innerHTML = '';

        if (typeof QRCode !== 'undefined') {
            new QRCode(demoQrBox, {
                text: url,
                width: 188,
                height: 188,
                colorDark: '#0f172a',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
            return;
        }

        const fallback = document.createElement('span');
        fallback.textContent = 'QR Code 套件載入失敗，請改用下方連結。';
        demoQrBox.appendChild(fallback);
    }

    function createDemoFlipRoom() {
        resetFlipUI();

        demoRoomCode.textContent = '建立中...';
        demoQrBox.innerHTML = '<span>QR Code 建立中...</span>';
        demoMobileLink.href = '#';

        if (typeof io === 'undefined') {
            demoQrBox.innerHTML = '<span>找不到 Socket.IO，請確認 server 已啟動。</span>';
            setFlipIdleUI();
            return;
        }

        if (!demoFlipSocket) {
            demoFlipSocket = io();
        }

        setupDemoFlipSocketListeners();

        const createRoom = () => {
            demoFlipSocket.emit('demo_flip_create_room', {}, (res) => {
                if (!res || !res.success || !res.room) {
                    demoQrBox.innerHTML = '<span>建立體驗房間失敗，請重新整理。</span>';
                    setFlipIdleUI();
                    return;
                }

                demoRoomId = res.room.roomId;
                const mobileUrl = buildMobileUrl(demoRoomId);

                demoRoomCode.textContent = demoRoomId;
                demoMobileLink.href = mobileUrl;

                renderQrCode(mobileUrl);

                setFlipIdleUI();
            });
        };

        if (demoFlipSocket.connected) {
            createRoom();
        } else {
            demoFlipSocket.once('connect', createRoom);
        }
    }

    function setupDemoFlipSocketListeners() {
        if (hasDemoSocketListeners || !demoFlipSocket) return;
        hasDemoSocketListeners = true;

        demoFlipSocket.on('demo_flip_phone_connected', () => {
            clearFlipWarningTimer();
            kickoutBox.hidden = true;
            resetFlipBtn.hidden = true;

            setFlipConnectedUI();

            addLog(
                '手機已連線',
                '手機已成功加入免註冊體驗房間。'
            );
        });

        demoFlipSocket.on('demo_flip_phone_disconnected', () => {
            clearFlipWarningTimer();

            setFlipIdleUI();

            addLog(
                '手機斷線',
                '手機連線中斷，請重新掃描 QR Code。'
            );
        });

        demoFlipSocket.on('demo_flip_room_reset', () => {
            clearFlipWarningTimer();
            kickoutBox.hidden = true;
            resetFlipBtn.hidden = true;

            setFlipConnectedUI();
        });

        demoFlipSocket.on('demo_flip_phone_state', (data) => {
            const state = data?.state;

            if (state === 'ready') {
                setFlipConnectedUI();
                return;
            }

            if (state === 'face_down') {
                clearFlipWarningTimer();
                kickoutBox.hidden = true;
                resetFlipBtn.hidden = true;

                setFlipCoveredUI('手機已蓋好，專注中');

                addLog(
                    '手機已蓋好',
                    '手機螢幕已朝下，進入專注狀態。'
                );
                return;
            }

            if (state === 'face_up') {
                startFlipWarning();
                return;
            }

            if (state === 'cover_back') {
                clearFlipWarningTimer();
                kickoutBox.hidden = true;
                resetFlipBtn.hidden = true;

                setFlipCoveredUI('已在倒數內蓋回，回到專注狀態');

                addLog(
                    '手機已蓋回',
                    '手機在警示倒數內蓋回，示範回到專注狀態。'
                );
            }
        });
    }

    function startFlipWarning() {
        if (isFlipWarningActive || isKickoutShown) return;

        isFlipWarningActive = true;
        flipWarningCount = 5;
        flipCountdown.textContent = '5';
        flipWarningBox.hidden = false;
        kickoutBox.hidden = true;
        resetFlipBtn.hidden = true;

        setFlipWarningUI();

        addLog(
            '手機翻開提醒',
            '系統偵測到手機翻開，電腦端開始 5 秒警示倒數。'
        );

        flipWarningTimer = setInterval(() => {
            flipWarningCount -= 1;
            flipCountdown.textContent = String(flipWarningCount);

            if (flipWarningCount <= 0) {
                showKickoutScreen();
            }
        }, 1000);
    }

    function showKickoutScreen() {
    clearFlipWarningTimer();

    isKickoutShown = true;
    kickoutBox.hidden = false;
    resetFlipBtn.hidden = false;

    setFlipKickoutUI();

    addLog(
        '手機翻轉中斷',
        '手機翻開超過限制時間，示範畫面顯示已離開教室。'
    );

    if (demoFlipSocket && demoRoomId) {
        demoFlipSocket.emit('demo_flip_kickout', { roomId: demoRoomId }, (res) => {
            if (!res || !res.success) {
                console.warn('通知手機踢出失敗：', res);
            }
        });
    }
}

    function resetFlipRoom() {
        clearFlipWarningTimer();
        isKickoutShown = false;
        kickoutBox.hidden = true;
        resetFlipBtn.hidden = true;

        if (demoFlipSocket && demoRoomId) {
            demoFlipSocket.emit('demo_flip_reset_room', { roomId: demoRoomId });
        }

        setFlipConnectedUI();
    }

    startDemoBtn.addEventListener('click', () => {
        switchPanel('camera');
    });

    openCameraBtn.addEventListener('click', openCamera);

    retryBtn.addEventListener('click', () => {
        resetDemo();
        openCamera();
    });

    againBtn.addEventListener('click', () => {
        resetDemo();
        openCamera();
    });

    nextSleepBtn.addEventListener('click', () => {
    startSleepDetection();
});

nextPhoneDetectBtn.addEventListener('click', () => {
    alert('下一步會加入「畫面中偵測到手機」體驗。');
});

nextFlipBtn.addEventListener('click', () => {
    stopCamera();
    switchPanel('flip');
    createDemoFlipRoom();
});

recreateFlipRoomBtn.addEventListener('click', () => {
    createDemoFlipRoom();
});

resetFlipBtn.addEventListener('click', () => {
    resetFlipRoom();
});

window.addEventListener('beforeunload', () => {
    if (rafId) cancelAnimationFrame(rafId);

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    if (flipWarningTimer) {
        clearInterval(flipWarningTimer);
    }

    if (demoFlipSocket) {
        demoFlipSocket.disconnect();
    }
});
})();