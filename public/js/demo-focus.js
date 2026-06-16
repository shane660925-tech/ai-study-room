(() => {
    const introPanel = document.getElementById('introPanel');
const cameraPanel = document.getElementById('cameraPanel');
const flipPanel = document.getElementById('flipPanel');
const summaryPanel = document.getElementById('summaryPanel');

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

    const summaryFromFlipBtn = document.getElementById('summaryFromFlipBtn');
const restartFullDemoBtn = document.getElementById('restartFullDemoBtn');

const summaryScore = document.getElementById('summaryScore');
const summaryScoreText = document.getElementById('summaryScoreText');
const summaryAway = document.getElementById('summaryAway');
const summarySleep = document.getElementById('summarySleep');
const summaryPhone = document.getElementById('summaryPhone');
const summaryFlipWarning = document.getElementById('summaryFlipWarning');
const summaryComment = document.getElementById('summaryComment');

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

    let demoSummary = {
    awayCount: 0,
    sleepCount: 0,
    phoneCount: 0,
    flipWarningCount: 0,
    flipCoveredCount: 0,
    flipCoverBackCount: 0,
    wasKicked: false,
    phoneConnected: false
};

    const CALIBRATION_MS = 3000;
    const AWAY_REQUIRED_MS = 1800;
    const DIFF_THRESHOLD = 34;

const SLEEP_REQUIRED_MS = 1600;

const PERSON_SCORE_THRESHOLD = 0.45;
const PERSON_DETECT_INTERVAL_MS = 330;

const SLEEP_TOP_DROP_RATIO = 0.14;
const SLEEP_HEIGHT_SHRINK_RATIO = 0.82;
const SLEEP_CENTER_DROP_RATIO = 0.12;

const PHONE_REQUIRED_MS = 900;
const PHONE_SCORE_THRESHOLD = 0.45;

let sleepStartAt = 0;
let personBaselineBox = null;
let lastPersonDetectAt = 0;

let phoneDetectStartAt = 0;
let phoneDetectTimer = null;
let phoneDetector = null;
let isLoadingPhoneDetector = false;

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

    if (summaryPanel) {
        summaryPanel.classList.toggle('active', next === 'summary');
    }
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

function resetDemoSummary() {
    demoSummary = {
        awayCount: 0,
        sleepCount: 0,
        phoneCount: 0,
        flipWarningCount: 0,
        flipCoveredCount: 0,
        flipCoverBackCount: 0,
        wasKicked: false,
        phoneConnected: false
    };
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
personBaselineBox = null;
lastPersonDetectAt = 0;
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

            if (currentDetectionMode === 'phone') {
    setTask(
        'Step 3',
        '正在準備手機入鏡偵測。',
        '請稍等模型載入完成。接著請把手機拿到鏡頭畫面中，系統會偵測畫面是否出現手機。'
    );
} else if (currentDetectionMode === 'sleep') {
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

            if (currentDetectionMode !== 'phone') {
    loop();
}
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

function getBestPrediction(predictions, className, minScore) {
    return (predictions || [])
        .filter(item => item.class === className && item.score >= minScore)
        .sort((a, b) => b.score - a.score)[0] || null;
}

function getBoxMetrics(prediction) {
    const [x, y, w, h] = prediction?.bbox || [0, 0, 0, 0];

    return {
        x,
        y,
        w,
        h,
        top: y,
        bottom: y + h,
        centerY: y + h / 2,
        area: w * h
    };
}

function isSleepPosture(baselineBox, currentBox) {
    if (!baselineBox || !currentBox) return false;

    const topDrop = currentBox.top - baselineBox.top;
    const centerDrop = currentBox.centerY - baselineBox.centerY;
    const heightRatio = currentBox.h / Math.max(1, baselineBox.h);

    const isTopClearlyLower = topDrop > baselineBox.h * SLEEP_TOP_DROP_RATIO;
    const isBodyClearlyShorter = heightRatio < SLEEP_HEIGHT_SHRINK_RATIO;
    const isCenterClearlyLower = centerDrop > baselineBox.h * SLEEP_CENTER_DROP_RATIO;

    return isTopClearlyLower && (isBodyClearlyShorter || isCenterClearlyLower);
}

    function completeAwayDetection() {
        if (hasCompleted) return;

        hasCompleted = true;
        phase = 'completed';

        successOverlay.classList.add('active');
        setProgress(100);
        demoSummary.awayCount += 1;

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
    demoSummary.sleepCount += 1;

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

    async function loop() {
    if (hasCompleted || currentDetectionMode === 'phone') return;

    const now = performance.now();

    if (now - lastPersonDetectAt < PERSON_DETECT_INTERVAL_MS) {
        rafId = requestAnimationFrame(loop);
        return;
    }

    lastPersonDetectAt = now;

    if (!video.videoWidth || !video.videoHeight) {
        rafId = requestAnimationFrame(loop);
        return;
    }

    try {
        await loadPhoneDetector();

        const predictions = await phoneDetector.detect(video);
        const personPrediction = getBestPrediction(
            predictions,
            'person',
            PERSON_SCORE_THRESHOLD
        );

        const personBox = personPrediction ? getBoxMetrics(personPrediction) : null;

        if (phase === 'calibrating') {
            if (!personBox) {
                phaseStartAt = now;
                personBaselineBox = null;
                setProgress(0);

                if (currentDetectionMode === 'sleep') {
                    setTask(
                        'Step 2',
                        '請先坐直並回到鏡頭畫面中。',
                        '系統需要先看見你的正常讀書姿勢，才可以校準趴睡偵測。'
                    );
                } else {
                    setTask(
                        'Step 1',
                        '請先坐在鏡頭前，讓系統校準。',
                        '系統需要先偵測到你在畫面中，之後才會判斷是否真的離座。'
                    );
                }

                rafId = requestAnimationFrame(loop);
                return;
            }

            personBaselineBox = personBox;

            const elapsed = now - phaseStartAt;
            setProgress((elapsed / CALIBRATION_MS) * 100);

            if (elapsed >= CALIBRATION_MS) {
                phase = 'detectingAway';
                phaseStartAt = now;
                awayStartAt = 0;
                sleepStartAt = 0;

                if (currentDetectionMode === 'sleep') {
                    setTask(
                        'Step 2',
                        '請做出趴睡或明顯低頭的姿勢。',
                        '請讓身體仍留在鏡頭畫面中，並讓上半身明顯往下，維持約 2 秒。'
                    );
                } else {
                    setTask(
                        'Step 2',
                        '請離開鏡頭畫面。',
                        '這次會改成「連續偵測不到整個人」才算離座。身體只是偏左或偏右，不會直接判定離座。'
                    );
                }

                setProgress(0);
            }
        } else if (phase === 'detectingAway') {
            if (currentDetectionMode === 'sleep') {
                if (!personBox) {
                    sleepStartAt = 0;
                    setProgress(0);

                    setTask(
                        'Step 2',
                        '請留在鏡頭畫面中再做趴睡姿勢。',
                        '趴睡偵測需要先看見人還在畫面裡，再判斷上半身是否明顯往下。'
                    );

                    rafId = requestAnimationFrame(loop);
                    return;
                }

                const isSleepLike = isSleepPosture(personBaselineBox, personBox);

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

            if (!personBox) {
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
    } catch (err) {
        console.warn('person 偵測失敗：', err);

        setTask(
            'AI Loading',
            'AI 偵測模型載入中或暫時失敗。',
            '請稍等幾秒，若一直沒有反應，可以重新整理頁面再試一次。'
        );
    }

    rafId = requestAnimationFrame(loop);
}

    function startSleepDetection() {
    currentDetectionMode = 'sleep';

    baselineFrame = null;
personBaselineBox = null;
lastPersonDetectAt = 0;
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

function clearPhoneDetectTimer() {
    if (phoneDetectTimer) {
        clearTimeout(phoneDetectTimer);
        phoneDetectTimer = null;
    }

    phoneDetectStartAt = 0;
}

async function loadPhoneDetector() {
    if (phoneDetector) return phoneDetector;

    if (isLoadingPhoneDetector) {
        while (isLoadingPhoneDetector) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return phoneDetector;
    }

    if (typeof cocoSsd === 'undefined') {
        throw new Error('手機偵測模型尚未載入，請確認 HTML 已加入 coco-ssd script。');
    }

    isLoadingPhoneDetector = true;

    try {
        phoneDetector = await cocoSsd.load();
        return phoneDetector;
    } finally {
        isLoadingPhoneDetector = false;
    }
}

async function startPhoneDetection() {
    currentDetectionMode = 'phone';

    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    clearPhoneDetectTimer();

    baselineFrame = null;
personBaselineBox = null;
phase = 'detectingPhone';
    phaseStartAt = performance.now();
    awayStartAt = 0;
    sleepStartAt = 0;
    phoneDetectStartAt = 0;
    hasCompleted = false;

    successOverlay.classList.remove('active');
    resultPanel.hidden = true;
    setProgress(0);

    nextSleepBtn.hidden = true;
    nextPhoneDetectBtn.hidden = true;
    nextFlipBtn.hidden = true;

    openCameraBtn.hidden = true;
    retryBtn.hidden = false;

    setTask(
        'Step 3',
        '正在載入手機入鏡偵測模型。',
        '請稍等幾秒。載入完成後，請把手機拿到鏡頭畫面中。'
    );

    if (!stream) {
        await openCamera();

        if (!stream) {
            setTask(
                'Camera blocked',
                '無法開啟鏡頭。',
                '請確認瀏覽器已允許鏡頭權限後，再重新整理頁面測試。'
            );
            return;
        }
    }

    try {
        await loadPhoneDetector();

        setTask(
            'Step 3',
            '請把手機拿到鏡頭畫面中。',
            '系統會偵測畫面中是否出現手機。請讓手機停留在畫面中約 1 秒。'
        );

        phoneDetectionLoop();
    } catch (err) {
        console.warn('手機入鏡偵測模型載入失敗：', err);

        setTask(
            'Model Error',
            '手機入鏡偵測模型載入失敗。',
            '請確認網路連線正常，或重新整理頁面再試一次。'
        );
    }
}

async function phoneDetectionLoop() {
    if (currentDetectionMode !== 'phone' || hasCompleted) return;

    if (!phoneDetector || !video || !video.videoWidth) {
        phoneDetectTimer = setTimeout(phoneDetectionLoop, 350);
        return;
    }

    try {
        const predictions = await phoneDetector.detect(video);

        const phonePrediction = predictions.find(item => {
            return item.class === 'cell phone' && item.score >= PHONE_SCORE_THRESHOLD;
        });

        if (phonePrediction) {
            if (!phoneDetectStartAt) {
                phoneDetectStartAt = performance.now();
            }

            const elapsed = performance.now() - phoneDetectStartAt;
            setProgress((elapsed / PHONE_REQUIRED_MS) * 100);

            if (elapsed >= PHONE_REQUIRED_MS) {
                completePhoneDetection(phonePrediction);
                return;
            }
        } else {
            phoneDetectStartAt = 0;
            setProgress(0);
        }
    } catch (err) {
        console.warn('手機入鏡偵測失敗：', err);
    }

    phoneDetectTimer = setTimeout(phoneDetectionLoop, 350);
}

function completePhoneDetection(phonePrediction) {
    if (hasCompleted) return;

    hasCompleted = true;
    phase = 'completed';
    clearPhoneDetectTimer();

    successOverlay.classList.add('active');
    setProgress(100);
    demoSummary.phoneCount += 1;

    const successStrong = successOverlay.querySelector('strong');
    const successSpan = successOverlay.querySelector('span');
    const successIcon = successOverlay.querySelector('i');

    if (successIcon) successIcon.className = 'fas fa-mobile-screen-button';
    if (successStrong) successStrong.textContent = '偵測到手機！';
    if (successSpan) successSpan.textContent = '成功完成手機入鏡偵測';

    const confidence = Math.round((phonePrediction?.score || 0) * 100);

    addLog(
        '手機入鏡提醒',
        `偵測到畫面中出現手機，模型信心約 ${confidence}%。正式自習中，這類事件會整理進學習總結。`
    );

    setTask(
        'Detection Success',
        '偵測到畫面中有手機！',
        '你已完成手機入鏡偵測體驗。正式使用時，這可以協助學生知道自己是否在自習中被手機分心。'
    );

    const resultTitle = resultPanel.querySelector('h3');
    const resultParagraphs = resultPanel.querySelectorAll('p');

    if (resultTitle) {
        resultTitle.textContent = '手機入鏡提醒代表什麼？';
    }

    if (resultParagraphs[0]) {
        resultParagraphs[0].textContent = '如果手機出現在畫面中，不一定代表學生故意違規，但很可能表示手機已經進入讀書視線範圍，容易造成分心。';
    }

    if (resultParagraphs[1]) {
        resultParagraphs[1].textContent = 'STUDY VERSE 的目的不是責備學生，而是把容易打斷專注的狀態整理出來，讓學生在自習結束後可以回顧。';
    }

    nextSleepBtn.hidden = true;
    nextPhoneDetectBtn.hidden = true;
    nextFlipBtn.hidden = false;

    resultPanel.hidden = false;
}

    function resetDemo() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        clearPhoneDetectTimer();
        
        baselineFrame = null;
personBaselineBox = null;
lastPersonDetectAt = 0;
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
        nextSleepBtn.hidden = true;
nextPhoneDetectBtn.hidden = true;
nextFlipBtn.hidden = true;
    }

    function stopCamera() {
        clearPhoneDetectTimer();
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
            demoSummary.phoneConnected = true;
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
                demoSummary.flipCoveredCount += 1;
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
                demoSummary.flipCoverBackCount += 1;
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
        demoSummary.flipWarningCount += 1;
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

    function calculateDemoScore() {
    let score = 100;

    score -= demoSummary.awayCount * 12;
    score -= demoSummary.sleepCount * 14;
    score -= demoSummary.phoneCount * 12;
    score -= demoSummary.flipWarningCount * 8;

    if (demoSummary.wasKicked) {
        score -= 18;
    }

    if (demoSummary.phoneConnected && demoSummary.flipCoveredCount > 0) {
        score += 4;
    }

    if (demoSummary.flipCoverBackCount > 0 && !demoSummary.wasKicked) {
        score += 4;
    }

    return Math.max(0, Math.min(100, score));
}

function getSummaryComment(score) {
    const issues = [];

    if (demoSummary.awayCount > 0) {
        issues.push('中途離座');
    }

    if (demoSummary.sleepCount > 0) {
        issues.push('趴睡或明顯低頭');
    }

    if (demoSummary.phoneCount > 0) {
        issues.push('手機進入讀書視線範圍');
    }

    if (demoSummary.flipWarningCount > 0) {
        issues.push('手機曾被翻開');
    }

    if (demoSummary.wasKicked) {
        return '這次體驗中，手機翻開超過限制時間，因此系統判定本次自習中斷。正式使用時，這類提醒不是為了責備學生，而是讓學生知道自己在什麼時候離開了專注狀態。';
    }

    if (issues.length === 0) {
        return '這次體驗中沒有明顯中斷專注的狀態。正式使用時，系統會把這類穩定自習紀錄整理成正向回饋，幫助學生累積成就感。';
    }

    if (score >= 75) {
        return `這次體驗中出現了 ${issues.join('、')} 的提醒，但整體仍能回到自習狀態。正式使用時，這些提醒會被整理成回顧紀錄，幫助學生知道下次可以從哪裡調整。`;
    }

    return `這次體驗中出現了 ${issues.join('、')} 等多個容易中斷專注的狀態。正式使用時，STUDY VERSE 會協助學生把這些狀態看見，而不是只用「有沒有坐在書桌前」判斷讀書成效。`;
}

function renderLearningSummary() {
    const score = calculateDemoScore();

    if (summaryScore) {
        summaryScore.textContent = `${score}`;
    }

    if (summaryScoreText) {
        if (score >= 85) {
            summaryScoreText.textContent = '本次體驗狀態穩定，干擾較少。';
        } else if (score >= 70) {
            summaryScoreText.textContent = '本次體驗有少量中斷，但仍能回到專注狀態。';
        } else {
            summaryScoreText.textContent = '本次體驗出現較多中斷，適合用來理解學習總結的價值。';
        }
    }

    if (summaryAway) {
        summaryAway.textContent = `${demoSummary.awayCount} 次`;
    }

    if (summarySleep) {
        summarySleep.textContent = `${demoSummary.sleepCount} 次`;
    }

    if (summaryPhone) {
        summaryPhone.textContent = `${demoSummary.phoneCount} 次`;
    }

    if (summaryFlipWarning) {
        summaryFlipWarning.textContent = `${demoSummary.flipWarningCount} 次`;
    }

    if (summaryComment) {
        summaryComment.textContent = getSummaryComment(score);
    }
}

function showLearningSummary() {
    stopCamera();
    clearFlipWarningTimer();
    renderLearningSummary();
    switchPanel('summary');
}

function showKickoutScreen() {
    clearFlipWarningTimer();

    isKickoutShown = true;
    demoSummary.wasKicked = true;

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
    resetDemoSummary();
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
    startPhoneDetection();
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

if (summaryFromFlipBtn) {
    summaryFromFlipBtn.addEventListener('click', () => {
        showLearningSummary();
    });
}

if (restartFullDemoBtn) {
    restartFullDemoBtn.addEventListener('click', () => {
        resetDemoSummary();
        resetDemo();
        switchPanel('camera');
    });
}

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