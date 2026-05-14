/**
 * StudyVerse V2.2.5.1 - HTML 共用元件 (lobby-components.js)
 * 負責將兩個大廳重複的 HTML 結構封裝成自訂標籤，達到 HTML 瘦身效果。
 * 必須在 HTML 的 <head> 中優先載入此檔案。
 */

// 1. 共用彈窗 (登入與違規警告)
class SharedModals extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <div id="loginOverlay" class="fixed inset-0 bg-[#05070a] z-[9999] flex items-center justify-center hidden">
            <div class="bg-[#111827] p-8 rounded-3xl border border-gray-800 shadow-2xl max-w-sm w-full text-center">
                <div class="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <i class="fas fa-user-shield text-blue-500 text-3xl"></i>
                </div>
                <h1 class="text-3xl font-black text-blue-500 mb-2">身分登錄</h1>
                <p class="text-gray-500 text-xs mb-6">請輸入您的帳號密碼</p>
                
                <input id="loginAccount" class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center text-lg font-bold focus:border-blue-500 outline-none transition-all" placeholder="帳號 (Email)">
                <input id="loginPassword" type="password" onkeypress="if(event.key === 'Enter') handleRealLogin()" class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center text-lg font-bold focus:border-blue-500 outline-none transition-all" placeholder="密碼">
                
                <button onclick="handleRealLogin()" class="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-bold text-white shadow-lg shadow-blue-900/20 transition-all active:scale-95 mb-4">登入系統</button>
                
                <p class="text-sm text-gray-400 mb-4 hover:text-white cursor-pointer transition-colors" onclick="showRegisterModal()">尚未有帳號? 立即註冊!</p>
                
                <div class="flex items-center my-4">
                    <hr class="flex-grow border-gray-700">
                    <span class="px-3 text-xs text-gray-500">或使用以下方式登入</span>
                    <hr class="flex-grow border-gray-700">
                </div>
                <div class="flex gap-4 justify-center">
                    <button onclick="window.location.href='/api/auth/google'" class="flex-1 bg-white text-gray-800 py-3 rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 shadow-lg">
                        <i class="fab fa-google text-red-500"></i> Gmail
                    </button>
                    <button onclick="window.location.href='/api/auth/line'" class="flex-1 bg-[#06C755] text-white py-3 rounded-xl font-bold hover:bg-[#05b34c] transition-all flex items-center justify-center gap-2 shadow-lg">
                        <i class="fab fa-line text-xl"></i> LINE
                    </button>
                </div>
            </div>
        </div>

        <div id="registerOverlay" class="fixed inset-0 bg-[#05070a]/95 z-[10000] flex items-center justify-center hidden">
            <div class="bg-[#111827] p-8 rounded-3xl border border-blue-500/50 shadow-2xl shadow-blue-900/20 max-w-sm w-full text-center">
                <div class="w-16 h-16 bg-green-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-user-plus text-green-500 text-2xl"></i>
                </div>
                <h1 class="text-3xl font-black text-white mb-2">建立新帳號</h1>
                <p class="text-gray-500 text-xs mb-6">註冊您的專屬學習指揮官代號</p>

                <input id="regUsername" class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center focus:border-blue-500 outline-none transition-all" placeholder="顯示暱稱 (平台內的名字)">
                <input id="regAccount" class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-4 text-center focus:border-blue-500 outline-none transition-all" placeholder="登入帳號 (Email)">
                <input id="regPassword" type="password" class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-6 text-center focus:border-blue-500 outline-none transition-all" placeholder="設定密碼">

                <button onclick="handleRealRegister()" class="w-full bg-green-600 hover:bg-green-500 py-4 rounded-2xl font-bold text-white shadow-lg shadow-green-900/20 transition-all active:scale-95 mb-4">確認註冊</button>
                <button onclick="hideRegisterModal()" class="w-full bg-transparent border border-gray-700 text-gray-400 py-3 rounded-2xl hover:text-white transition-all">返回登入</button>
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

// --- 以下為新增的註冊/登入前端邏輯 (附加到全域 window 上供點擊使用) ---
window.showRegisterModal = function() {
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('registerOverlay').classList.remove('hidden');
};

window.hideRegisterModal = function() {
    document.getElementById('registerOverlay').classList.add('hidden');
    document.getElementById('loginOverlay').classList.remove('hidden');
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

// --- [核心修正] 自動處理 Google 登入回傳的參數 ---
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('username');
    const isLoginSuccess = urlParams.get('login_success');

    if (isLoginSuccess === 'true' && username) {
        // 1. 立即寫入 localStorage
        localStorage.setItem('studyVerseUser', username);
        
        // 2. 立即隱藏登入彈窗（避免閃爍）
        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) {
            loginOverlay.classList.add('hidden');
        }

        // 3. 清理網址上的參數（加上 origin 確保跨平台相容性）
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        
        console.log("Google 登入攔截成功，已儲存用戶名：", username);
    }
})();