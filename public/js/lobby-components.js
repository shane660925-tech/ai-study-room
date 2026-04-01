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
                <p class="text-gray-500 text-xs mb-6">建立你的專屬指揮官代號</p>
                <input id="setupName" onkeypress="if(event.key === 'Enter') saveName()" class="w-full bg-black p-4 rounded-xl border border-gray-700 text-white mb-6 text-center text-lg font-bold focus:border-blue-500 outline-none transition-all" placeholder="輸入您的專屬暱稱...">
                <button onclick="saveName()" class="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-bold text-white shadow-lg shadow-blue-900/20 transition-all active:scale-95">確認綁定，載入存檔</button>
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

// 2. 共用數據面板 (4張卡片)
class SharedStatsCards extends HTMLElement {
    connectedCallback() {
        this.style.display = 'contents'; // 確保不會破壞 CSS Grid 佈局
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