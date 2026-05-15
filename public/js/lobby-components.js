/**
 * StudyVerse V2.2.5.1 - HTML 共用元件 (lobby-components.js)
 * 負責將兩個大廳重複的 HTML 結構封裝成自訂標籤，達到 HTML 瘦身效果。
 * 必須在 HTML 的 <head> 中優先載入此檔案。
 */

// 1. 共用彈窗 (登入與違規警告)
class SharedModals extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <div id="loginOverlay" class="fixed inset-0 bg-[#05070a] z-[9999] flex items-center justify-center hidden p-4">
    <div id="authBox" class="bg-[#111827] p-8 rounded-3xl border border-gray-800 shadow-2xl max-w-3xl w-full text-center max-h-[90vh] overflow-y-auto">

        <div class="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <i class="fas fa-user-shield text-blue-500 text-3xl"></i>
        </div>

        <h1 class="text-3xl font-black text-blue-500 mb-2">STUDY VERSE</h1>
        <p class="text-gray-500 text-xs mb-8">請先選擇您的身份</p>

        <!-- 第一層：身份選擇 -->
        <div id="authRoleStep" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

            <button onclick="chooseAuthRole('student')"
                    class="p-6 rounded-3xl border border-blue-500/30 bg-blue-600/10 hover:bg-blue-600/20 transition-all text-left">
                <div class="text-blue-400 text-3xl mb-3">
                    <i class="fas fa-user-astronaut"></i>
                </div>
                <h2 class="text-xl font-black text-white mb-2">我是學生</h2>
                <p class="text-xs text-gray-400 leading-relaxed">
                    自習、加入課程、使用主題教室與學習紀錄。
                </p>
            </button>

            <button onclick="chooseAuthRole('teacher')"
                    class="p-6 rounded-3xl border border-yellow-500/30 bg-yellow-600/10 hover:bg-yellow-600/20 transition-all text-left">
                <div class="text-yellow-400 text-3xl mb-3">
                    <i class="fas fa-chalkboard-teacher"></i>
                </div>
                <h2 class="text-xl font-black text-white mb-2">我是教師</h2>
                <p class="text-xs text-gray-400 leading-relaxed">
                    教師登入、開課申請、特約教室與課程管理。
                </p>
            </button>

        </div>

        <!-- 學生登入區 -->
        <div id="studentAuthPanel" class="hidden">
            <h2 class="text-xl font-black text-blue-400 mb-4">學生登入</h2>

            <input id="loginAccount"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center text-lg font-bold focus:border-blue-500 outline-none transition-all"
                   placeholder="學生帳號 Email">

            <input id="loginPassword"
                   type="password"
                   onkeypress="if(event.key === 'Enter') handleRealLogin()"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center text-lg font-bold focus:border-blue-500 outline-none transition-all"
                   placeholder="密碼">

            <button onclick="handleRealLogin()"
                    class="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-bold text-white shadow-lg shadow-blue-900/20 transition-all active:scale-95 mb-4">
                學生登入
            </button>

            <button onclick="showStudentRegisterForm()"
                    class="w-full bg-green-600/20 hover:bg-green-600 border border-green-500/30 text-green-400 hover:text-white py-3 rounded-2xl font-bold mb-4 transition-all">
                建立學生帳號
            </button>

            <div class="flex items-center my-4">
                <hr class="flex-grow border-gray-700">
                <span class="px-3 text-xs text-gray-500">或使用快速登入</span>
                <hr class="flex-grow border-gray-700">
            </div>

            <div class="flex gap-4 justify-center mb-4">
                <button onclick="window.location.href='/api/auth/google?role=student'"
                        class="flex-1 bg-white text-gray-800 py-3 rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 shadow-lg">
                    <i class="fab fa-google text-red-500"></i> Gmail
                </button>

                <button onclick="window.location.href='/api/auth/line?role=student'"
                        class="flex-1 bg-[#06C755] text-white py-3 rounded-xl font-bold hover:bg-[#05b34c] transition-all flex items-center justify-center gap-2 shadow-lg">
                    <i class="fab fa-line text-xl"></i> LINE
                </button>
            </div>

            <button onclick="backToAuthRole()"
                    class="text-gray-500 text-sm hover:text-white transition-all">
                返回身份選擇
            </button>
        </div>

        <!-- 教師登入區 -->
        <div id="teacherAuthPanel" class="hidden">
            <h2 class="text-xl font-black text-yellow-400 mb-4">教師登入</h2>

            <input id="teacherLoginAccount"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center text-lg font-bold focus:border-yellow-500 outline-none transition-all"
                   placeholder="教師帳號 Email">

            <input id="teacherLoginPassword"
                   type="password"
                   onkeypress="if(event.key === 'Enter') handleTeacherLogin()"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center text-lg font-bold focus:border-yellow-500 outline-none transition-all"
                   placeholder="密碼">

            <button onclick="handleTeacherLogin()"
                    class="w-full bg-yellow-600 hover:bg-yellow-500 py-4 rounded-2xl font-bold text-black shadow-lg shadow-yellow-900/20 transition-all active:scale-95 mb-4">
                教師登入
            </button>

            <button onclick="showTeacherRegisterFromLogin()"
                    class="w-full bg-yellow-600/20 hover:bg-yellow-600 border border-yellow-500/30 text-yellow-400 hover:text-black py-3 rounded-2xl font-bold mb-4 transition-all">
                申請成為教師 / 建立教師帳號
            </button>

            <button onclick="backToAuthRole()"
                    class="text-gray-500 text-sm hover:text-white transition-all">
                返回身份選擇
            </button>
        </div>

    </div>
</div>

        <div id="registerOverlay" class="fixed inset-0 bg-[#05070a]/95 z-[10000] flex items-center justify-center hidden p-4">
    <div id="registerBox" class="bg-[#111827] p-8 rounded-3xl border border-blue-500/50 shadow-2xl shadow-blue-900/20 max-w-3xl w-full text-center max-h-[90vh] overflow-y-auto">

        <div class="w-16 h-16 bg-green-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-user-plus text-green-500 text-2xl"></i>
        </div>

        <h1 class="text-3xl font-black text-white mb-2">建立新帳號</h1>
        <p class="text-gray-500 text-xs mb-6">請先選擇您的註冊身份</p>

        <!-- 身份選擇 -->
        <div id="registerTypeStep" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <button onclick="chooseRegisterType('student')"
                    class="p-6 rounded-3xl border border-blue-500/30 bg-blue-600/10 hover:bg-blue-600/20 transition-all text-left">
                <div class="text-blue-400 text-3xl mb-3">
                    <i class="fas fa-user-astronaut"></i>
                </div>
                <h2 class="text-xl font-black text-white mb-2">我是學生</h2>
                <p class="text-xs text-gray-400 leading-relaxed">
                    我要自習、加入課程、使用主題教室與學習紀錄。
                </p>
            </button>

            <button onclick="chooseRegisterType('teacher')"
                    class="p-6 rounded-3xl border border-yellow-500/30 bg-yellow-600/10 hover:bg-yellow-600/20 transition-all text-left">
                <div class="text-yellow-400 text-3xl mb-3">
                    <i class="fas fa-chalkboard-teacher"></i>
                </div>
                <h2 class="text-xl font-black text-white mb-2">我是教師</h2>
                <p class="text-xs text-gray-400 leading-relaxed">
                    我要開課、申請特約教室、建立專屬課程空間。
                </p>
            </button>
        </div>

        <!-- 學生註冊表單 -->
        <div id="studentRegisterForm" class="hidden">
            <h2 class="text-xl font-black text-blue-400 mb-4">學生註冊</h2>

            <input id="regUsername"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center focus:border-blue-500 outline-none transition-all"
                   placeholder="顯示暱稱">

            <input id="regAccount"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center focus:border-blue-500 outline-none transition-all"
                   placeholder="登入帳號 Email">

            <input id="regPassword"
                   type="password"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center focus:border-blue-500 outline-none transition-all"
                   placeholder="設定密碼">

            <input id="studentDiscountCode"
                   class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-6 text-center focus:border-blue-500 outline-none transition-all"
                   placeholder="教室優惠碼，可留空">

            <button onclick="handleRealRegister()"
                    class="w-full bg-green-600 hover:bg-green-500 py-4 rounded-2xl font-bold text-white shadow-lg shadow-green-900/20 transition-all active:scale-95 mb-4">
                確認學生註冊
            </button>

            <button onclick="backToRegisterType()"
                    class="w-full bg-transparent border border-gray-700 text-gray-400 py-3 rounded-2xl hover:text-white transition-all">
                返回身份選擇
            </button>
        </div>

        <!-- 教師註冊表單 -->
        <div id="teacherRegisterForm" class="hidden">
            <h2 class="text-xl font-black text-yellow-400 mb-4">教師註冊 / 開課申請</h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                <div>
                    <label class="text-xs text-gray-400 font-bold mb-1 block">顯示名稱</label>
                    <input id="teacherRegUsername"
                           class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all"
                           placeholder="教師名稱">
                </div>

                <div>
                    <label class="text-xs text-gray-400 font-bold mb-1 block">Email（必填）</label>
                    <input id="teacherEmail"
                           type="email"
                           class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all"
                           placeholder="審核通知用 Email">
                </div>

                <div>
                    <label class="text-xs text-gray-400 font-bold mb-1 block">登入帳號</label>
                    <input id="teacherRegAccount"
                           class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all"
                           placeholder="登入帳號 Email">
                </div>

                <div>
                    <label class="text-xs text-gray-400 font-bold mb-1 block">設定密碼</label>
                    <input id="teacherRegPassword"
                           type="password"
                           class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all"
                           placeholder="設定密碼">
                </div>

                <div>
                    <label class="text-xs text-gray-400 font-bold mb-1 block">開課種類</label>
                    <select id="teacherType"
                            class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all">
                        <option value="online">線上課程</option>
                        <option value="special_room">特約教室</option>
                    </select>
                </div>

                <div>
                    <label class="text-xs text-gray-400 font-bold mb-1 block">教室規模</label>
                    <select id="classroomSize"
                            class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all">
                        <option value="10">10 人</option>
                        <option value="20">20 人</option>
                        <option value="30">30 人</option>
                        <option value="large">更大請私訊</option>
                    </select>
                </div>

                <div class="md:col-span-2">
                    <label class="text-xs text-gray-400 font-bold mb-1 block">課程資訊</label>
                    <textarea id="courseInfo"
                              rows="3"
                              class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 focus:border-yellow-500 outline-none transition-all resize-none"
                              placeholder="例如：高中數學段考衝刺、英文作文批改、多益聽力訓練"></textarea>
                </div>

                <div class="md:col-span-2">
                    <label class="text-xs text-gray-400 font-bold mb-1 block">上課時間</label>
                    <input id="courseSchedule"
                           class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-6 focus:border-yellow-500 outline-none transition-all"
                           placeholder="例如：每週六 19:00-21:00">
                </div>
            </div>

            <button onclick="handleTeacherRegister('password')"
        class="w-full bg-yellow-600 hover:bg-yellow-500 py-4 rounded-2xl font-bold text-black shadow-lg shadow-yellow-900/20 transition-all active:scale-95 mb-4">
    使用帳密送出教師申請
</button>
            <button onclick="backToRegisterType()"
                    class="w-full bg-transparent border border-gray-700 text-gray-400 py-3 rounded-2xl hover:text-white transition-all">
                返回身份選擇
            </button>
        </div>

        <button onclick="hideRegisterModal()"
                class="mt-4 text-gray-500 text-sm hover:text-white transition-all">
            返回登入
        </button>
    </div>
</div>

        <div id="violation-modal" class="fixed inset-0 z-[10000] animate-flash-red flex-col items-center justify-center p-6 text-white text-center hidden">
            <div class="max-w-md">
                <i class="fas fa-exclamation-triangle text-8xl mb-6 animate-bounce"></i>
                <h2 class="text-4xl font-black mb-4 tracking-tighter">違規警告</h2>
                <p id="violation-msg" class="text-2xl font-bold mb-8 leading-relaxed">偵測到手機翻開！請專注學習！</p>
                <button onclick="dismissAlert()" class="bg-white text-red-600 px-10 py-4 rounded-full font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all">
                    我明白了，立即改正
                </button>
            </div>
        </div>
        `;
    }
}
customElements.define('shared-modals', SharedModals);

window.chooseAuthRole = function(role) {
    const roleStep = document.getElementById('authRoleStep');
    const studentPanel = document.getElementById('studentAuthPanel');
    const teacherPanel = document.getElementById('teacherAuthPanel');

    if (!roleStep || !studentPanel || !teacherPanel) return;

    roleStep.classList.add('hidden');
    studentPanel.classList.add('hidden');
    teacherPanel.classList.add('hidden');

    if (role === 'student') {
        studentPanel.classList.remove('hidden');
    }

    if (role === 'teacher') {
        teacherPanel.classList.remove('hidden');
    }
};

window.backToAuthRole = function() {
    const roleStep = document.getElementById('authRoleStep');
    const studentPanel = document.getElementById('studentAuthPanel');
    const teacherPanel = document.getElementById('teacherAuthPanel');

    if (!roleStep || !studentPanel || !teacherPanel) return;

    roleStep.classList.remove('hidden');
    studentPanel.classList.add('hidden');
    teacherPanel.classList.add('hidden');
};

window.handleTeacherLogin = async function() {
    const acc = document.getElementById('teacherLoginAccount').value.trim();
    const pass = document.getElementById('teacherLoginPassword').value;

    document.getElementById('loginAccount').value = acc;
    document.getElementById('loginPassword').value = pass;

    await handleRealLogin();
};

// --- 以下為新增的註冊/登入前端邏輯 (附加到全域 window 上供點擊使用) ---
window.showRegisterModal = function() {
    document.getElementById('loginOverlay').classList.add('hidden');

    const registerOverlay = document.getElementById('registerOverlay');
    registerOverlay.classList.remove('hidden');
    registerOverlay.classList.add('flex');

    backToRegisterType();
};

window.showStudentRegisterForm = function() {
    document.getElementById('loginOverlay').classList.add('hidden');

    const registerOverlay = document.getElementById('registerOverlay');
    registerOverlay.classList.remove('hidden');
    registerOverlay.classList.add('flex');

    chooseRegisterType('student');
};

window.showTeacherRegisterFromLogin = function() {
    document.getElementById('loginOverlay').classList.add('hidden');

    const registerOverlay = document.getElementById('registerOverlay');
    registerOverlay.classList.remove('hidden');
    registerOverlay.classList.add('flex');

    chooseRegisterType('teacher');
};

window.hideRegisterModal = function() {

    const registerOverlay =
        document.getElementById('registerOverlay');

    registerOverlay.classList.add('hidden');
    registerOverlay.classList.remove('flex');

    document.getElementById('loginOverlay')
        .classList.remove('hidden');
};

window.chooseRegisterType = function(type) {
    const typeStep = document.getElementById('registerTypeStep');
    const studentForm = document.getElementById('studentRegisterForm');
    const teacherForm = document.getElementById('teacherRegisterForm');

    if (!typeStep || !studentForm || !teacherForm) return;

    typeStep.classList.add('hidden');
    studentForm.classList.add('hidden');
    teacherForm.classList.add('hidden');

    if (type === 'student') {
        studentForm.classList.remove('hidden');
    }

    if (type === 'teacher') {
        teacherForm.classList.remove('hidden');
    }
};

window.backToRegisterType = function() {
    const typeStep = document.getElementById('registerTypeStep');
    const studentForm = document.getElementById('studentRegisterForm');
    const teacherForm = document.getElementById('teacherRegisterForm');

    if (!typeStep || !studentForm || !teacherForm) return;

    typeStep.classList.remove('hidden');
    studentForm.classList.add('hidden');
    teacherForm.classList.add('hidden');
};

window.handleTeacherRegister = async function(method = 'password') {
    const username = document.getElementById('teacherRegUsername').value.trim();
    const email = document.getElementById('teacherEmail').value.trim();
    const account = document.getElementById('teacherRegAccount').value.trim();
    const password = document.getElementById('teacherRegPassword').value;
    const teacherType = document.getElementById('teacherType').value;
    const classroomSize = document.getElementById('classroomSize').value;
    const courseInfo = document.getElementById('courseInfo').value.trim();
    const courseSchedule = document.getElementById('courseSchedule').value.trim();

    if (!username || !email || !courseInfo || !courseSchedule || !teacherType) {
        alert('請完整填寫教師名稱、Email、課程資訊與上課時間');
        return;
    }

    if (method === 'password' && (!account || !password)) {
        alert('使用帳密申請時，請填寫登入帳號與密碼');
        return;
    }

    const teacherDraft = {
        username,
        email,
        account,
        teacherType,
        classroomSize,
        courseInfo,
        courseSchedule,
        method
    };

    sessionStorage.setItem('pendingTeacherApplication', JSON.stringify(teacherDraft));

    if (method === 'google') {
        window.location.href = '/api/auth/google?role=teacher_apply';
        return;
    }

    if (method === 'line') {
        window.location.href = '/api/auth/line?role=teacher_apply';
        return;
    }

    try {

    const response = await fetch('/api/teacher/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username,
            email,
            account,
            password,
            teacherType,
            classroomSize,
            courseInfo,
            courseSchedule
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || '教師申請失敗');
        return;
    }

    alert('教師申請已送出，請等待管理員審核');

    hideRegisterModal();

} catch (err) {

    console.error('教師申請錯誤:', err);

    alert('網路錯誤，請稍後再試');
}
};

window.handleRealLogin = async function() {
    const acc = document.getElementById('loginAccount').value.trim();
    const pass = document.getElementById('loginPassword').value;

    if (!acc || !pass) return alert("請輸入帳號與密碼！");

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account: acc, password: pass })
        });

        const data = await res.json();

        if (res.ok) {
            localStorage.setItem('studyVerseUser', data.username);
            localStorage.setItem('studyVerseSessionId', data.sessionId);
            localStorage.setItem('studyVerseRole', data.role || 'student');

            location.reload();
        } else {
            alert("登入失敗：" + data.error);
        }

    } catch(e) {
        console.error("登入錯誤:", e);
        alert("網路連線錯誤，請稍後再試！");
    }
};

window.handleRealRegister = async function() {
    const username = document.getElementById('regUsername').value.trim();
    const account = document.getElementById('regAccount').value.trim();
    const password = document.getElementById('regPassword').value;
    
    if (!username || !account || !password) {
        alert("請完整填寫暱稱、帳號與密碼！");
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, account, password }) 
        });

        const data = await response.json();
        
        if (response.ok) {
    alert("註冊成功！請使用帳號密碼登入。");
    hideRegisterModal(); 
        } else {
            alert("註冊失敗：" + data.error);
        }
    } catch (err) {
        console.error("錯誤:", err);
        alert("網路連線異常，請稍後再試！");
    }
};

// 2. 共用數據面板 (4張卡片)
class SharedStatsCards extends HTMLElement {
    connectedCallback() {
        this.style.display = 'contents'; 
        this.innerHTML = `
        <div class="glass-panel p-6 rounded-2xl border-t-2 border-blue-500 relative overflow-hidden group">
            <div class="text-gray-400 text-xs font-bold mb-2 uppercase tracking-widest flex justify-between">
                <span><i class="fas fa-clock text-blue-500 mr-2"></i>累積專注時間</span>
            </div>
            <div class="text-4xl font-mono font-bold text-white" id="totalTimeDisplay">--<span class="text-lg text-gray-500 ml-1">min</span></div>
            <div class="absolute -right-2 -bottom-2 opacity-5 text-blue-500 text-6xl group-hover:scale-110 transition-transform"><i class="fas fa-stopwatch"></i></div>
        </div>

        <div class="glass-panel p-6 rounded-2xl border-t-2 border-orange-500 relative overflow-hidden group">
            <div class="text-gray-400 text-xs font-bold mb-2 uppercase tracking-widest">
                <span><i class="fas fa-fire text-orange-500 mr-2"></i>連續登入天數</span>
            </div>
            <div class="text-4xl font-mono font-bold text-white" id="streakDisplay">--<span class="text-lg text-gray-500 ml-1">days</span></div>
            <div class="absolute -right-2 -bottom-2 opacity-5 text-orange-500 text-6xl group-hover:rotate-12 transition-transform"><i class="fas fa-flame"></i></div>
        </div>

        <div class="glass-panel p-6 rounded-2xl border-t-2 border-red-500 relative overflow-hidden group">
            <div class="text-gray-400 text-xs font-bold mb-2 uppercase tracking-widest flex justify-between">
                <span><i class="fas fa-shield-heart text-red-500 mr-2"></i>誠信信用分</span>
            </div>
            <div class="text-4xl font-mono font-bold text-white" id="integrityDisplay">--<span class="text-lg text-gray-500 ml-1">pt</span></div>
            <div class="absolute -right-2 -bottom-2 opacity-5 text-red-500 text-6xl group-hover:scale-110 transition-transform"><i class="fas fa-shield-virus"></i></div>
        </div>

        <div class="glass-panel p-6 rounded-2xl border-t-2 border-yellow-500 relative overflow-hidden group">
            <div class="text-gray-400 text-xs font-bold mb-2 uppercase tracking-widest flex justify-between">
                <span><i class="fas fa-trophy text-yellow-500 mr-2"></i>解鎖書桌等級</span>
            </div>
            <div class="text-xl font-bold text-yellow-500 italic mt-2" id="rankDisplay">分析中...</div>
            <div class="absolute -right-2 -bottom-2 opacity-10 text-yellow-500 text-6xl group-hover:scale-110 transition-transform"><i class="fas fa-medal"></i></div>
        </div>
        `;
    }
}
customElements.define('shared-stats-cards', SharedStatsCards);

// 3. 共用側邊欄上半部 (週榜與勳章庫)
class SharedSidebarTop extends HTMLElement {
    connectedCallback() {
        this.style.display = 'contents'; 
        this.innerHTML = `
        <div class="glass-panel rounded-3xl border border-white/5 overflow-hidden flex flex-col">
            <div class="p-4 border-b border-white/5 bg-blue-600/10 flex justify-between items-center">
                <h3 class="text-sm font-bold text-white uppercase tracking-tighter">
                     <i class="fas fa-trophy mr-2 text-yellow-400"></i>Weekly Top 5 / 週榜
                </h3>
            </div>
            <div class="p-4">
                <ul id="weeklyLeaderboard" class="space-y-4">
                    <li class="text-center py-4 text-gray-500 text-xs italic">計算中...</li>
                </ul>
            </div>
        </div>

        <div id="achievementPreview" class="glass-panel rounded-3xl border border-white/5 p-4 bg-white/5">
            <p class="text-[10px] text-gray-500 uppercase mb-3">我的勳章庫</p>
            <div id="myBadges" class="flex flex-wrap gap-2">
            </div>
        </div>
        `;
    }
}
customElements.define('shared-sidebar-top', SharedSidebarTop);

// 4. 共用頁尾
class SharedFooter extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <footer class="p-6 text-center text-gray-600 text-[10px] tracking-widest uppercase">
            Study Verse &copy; 2026 AI Focus System. All rights reserved.
        </footer>
        `;
    }
}
customElements.define('shared-footer', SharedFooter);

// --- 自動處理 Google / LINE 登入回傳的參數 ---
(async function() {
    const urlParams = new URLSearchParams(window.location.search);

    const username = urlParams.get('username');
    const sessionId = urlParams.get('sessionId');
    const role = urlParams.get('role') || 'student';
    const isLoginSuccess = urlParams.get('login_success');

    if (isLoginSuccess === 'true' && username && sessionId) {
        localStorage.setItem('studyVerseUser', username);
        localStorage.setItem('studyVerseSessionId', sessionId);
        localStorage.setItem('studyVerseRole', role);

        const oauthRole = urlParams.get('oauth_role');
        const pendingRaw = sessionStorage.getItem('pendingTeacherApplication');

        if (pendingRaw && oauthRole === 'teacher_apply') {
            try {
                const draft = JSON.parse(pendingRaw);

                const res = await fetch('/api/teacher/oauth-apply', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: draft.username || username,
                        email: draft.email,
                        teacherType: draft.teacherType,
                        classroomSize: draft.classroomSize,
                        courseInfo: draft.courseInfo,
                        courseSchedule: draft.courseSchedule
                    })
                });

                const data = await res.json();

                if (!res.ok) {
                    alert(data.error || '教師申請送出失敗');
                } else {
                    alert('教師申請已送出，請等待管理員審核');
                    sessionStorage.removeItem('pendingTeacherApplication');
                }

            } catch (err) {
                console.error('教師 OAuth 申請處理失敗:', err);
                alert('教師申請處理失敗，請稍後再試');
            }
        }

        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) {
            loginOverlay.classList.add('hidden');
        }

        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

        console.log("OAuth 登入成功，已儲存 session：", username);
    }
})();