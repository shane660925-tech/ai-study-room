(() => {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    const toast = $('#toast');
    const authMessage = $('#authMessage');

    function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
    }

    function setAuthMessage(message, type = '') {
        if (!authMessage) return;
        authMessage.textContent = message || '';
        authMessage.className = `auth-message ${type}`.trim();
    }

    function switchDemoStep(step) {
        $$('.step-pill').forEach(btn => btn.classList.toggle('active', btn.dataset.demoStep === step));
        $$('.demo-screen').forEach(screen => screen.classList.toggle('active', screen.id === `demo-${step}`));
    }

    function switchAuthTab(tab) {
        $$('.auth-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.authTab === tab));
        $$('.auth-form').forEach(panel => panel.classList.toggle('active', panel.dataset.authPanel === tab));
        setAuthMessage('');
        document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    $$('.step-pill').forEach(btn => btn.addEventListener('click', () => switchDemoStep(btn.dataset.demoStep)));
    $$('.auth-tab').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab)));
    $$('[data-open-auth]').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.openAuth)));

    const personaCopy = {
        student: {
            title: '學生體驗重點',
            text: '進入教室後，設定目標、蓋下手機、累積今日專注時間，讓自習更有開始感與完成感。'
        },
        parent: {
            title: '家長體驗重點',
            text: '透過學習總結與 LINE 通知，可以更快知道孩子今天讀了多久、是否有維持專注。'
        },
        teacher: {
            title: '教師 / 導師體驗重點',
            text: '建立特約教室、安排多節課、發送提醒，並在課後查看學生的專注成果與總結。'
        }
    };

    $$('.persona-card').forEach(card => {
        card.addEventListener('click', () => {
            $$('.persona-card').forEach(item => item.classList.remove('active'));
            card.classList.add('active');
            const copy = personaCopy[card.dataset.persona] || personaCopy.student;
            $('#personaOutput').innerHTML = `<strong>${copy.title}</strong><p>${copy.text}</p>`;
        });
    });

    const phoneCard = $('#phoneDemoCard');
    const phoneTitle = $('#phoneDemoTitle');
    const phoneText = $('#phoneDemoText');
    const phoneChip = $('#phoneDemoChip');
    if (phoneCard) {
        phoneCard.addEventListener('click', () => {
            const flipped = phoneCard.classList.toggle('flipped');
            phoneTitle.textContent = flipped ? '防護罩已啟動' : '請將手機蓋下';
            phoneText.textContent = flipped ? 'AI 豁免生效中' : '等待翻轉連動';
            phoneChip.textContent = flipped ? '已完成翻轉' : '尚未啟動';
            phoneChip.classList.toggle('active', flipped);
            phoneChip.classList.toggle('waiting', !flipped);
        });
    }

    const todayBtn = $('#todayDemoBtn');
    const todayNumber = $('#todayDemoNumber');
    const todayBar = $('#todayDemoBar');
    let todayInterval = null;
    let todayValue = 0;
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            clearInterval(todayInterval);
            todayValue = 0;
            todayNumber.textContent = '0';
            todayBar.style.width = '0%';
            todayBtn.disabled = true;
            todayBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 模擬專注中';

            todayInterval = setInterval(() => {
                todayValue += 5;
                todayNumber.textContent = String(todayValue);
                todayBar.style.width = `${Math.min(100, todayValue * 4)}%`;

                if (todayValue >= 25) {
                    clearInterval(todayInterval);
                    todayBtn.disabled = false;
                    todayBtn.innerHTML = '<i class="fas fa-rotate-right"></i> 再模擬一次';
                    showToast('你完成了一次 25 min 的模擬專注任務！');
                }
            }, 420);
        });
    }

    function formToJson(form) {
        return Object.fromEntries(new FormData(form).entries());
    }

    async function postJson(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || data.message || '請求失敗，請稍後再試');
        }
        return data;
    }

    $('#loginForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setAuthMessage('登入中...');
        try {
            const data = await postJson('/api/login', formToJson(event.currentTarget));
            localStorage.setItem('studyVerseUser', data.username || '');
            localStorage.setItem('studyVerseRole', data.role || 'student');
            if (data.sessionId) localStorage.setItem('studyVerseSessionId', data.sessionId);
            setAuthMessage('登入成功，正在進入平台...', 'success');
            setTimeout(() => { window.location.href = '/index.html'; }, 650);
        } catch (err) {
            setAuthMessage(err.message, 'error');
        }
    });

    $('#studentRegisterForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setAuthMessage('建立帳號中...');
        try {
            const data = await postJson('/api/register', formToJson(event.currentTarget));
            setAuthMessage(data.message || '註冊成功，請登入平台。', 'success');
            event.currentTarget.reset();
            setTimeout(() => switchAuthTab('login'), 900);
        } catch (err) {
            setAuthMessage(err.message, 'error');
        }
    });

    $('#teacherRegisterForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        setAuthMessage('送出教師申請中...');
        const payload = formToJson(event.currentTarget);
        payload.classroomSize = payload.classroomSize ? Number(payload.classroomSize) : null;
        try {
            const data = await postJson('/api/teacher/register', payload);
            setAuthMessage(data.message || '教師申請已送出，請等待管理員審核。', 'success');
            event.currentTarget.reset();
        } catch (err) {
            setAuthMessage(err.message, 'error');
        }
    });

    let heroSeconds = 25 * 60;
    setInterval(() => {
        heroSeconds = heroSeconds <= 0 ? 25 * 60 : heroSeconds - 1;
        const m = Math.floor(heroSeconds / 60).toString().padStart(2, '0');
        const s = (heroSeconds % 60).toString().padStart(2, '0');
        const heroTimer = $('#heroTimer');
        if (heroTimer) heroTimer.textContent = `${m}:${s}`;
    }, 1000);
})();
