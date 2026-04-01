/**
 * StudyVerse - 組隊大廳彈窗共用元件 (/js/team-modals.js)
 * 負責將組隊專用的 Modal 封裝，供專業大廳動態載入與組隊大廳靜態使用。
 */
class TeamModals extends HTMLElement {
    connectedCallback() {
        // 設定 contents 避免影響原本 fixed 彈窗的排版
        this.style.display = 'contents'; 
        
        this.innerHTML = `
            <div id="joinTeamModal" class="fixed inset-0 bg-[#05070a]/90 backdrop-blur-md z-[10000] items-center justify-center hidden">
                <div class="bg-[#111827] w-full max-w-2xl rounded-3xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden transform transition-all">
                    <div class="p-6 border-b border-white/5 bg-gradient-to-r from-orange-600/20 to-transparent flex justify-between items-center">
                        <h2 class="text-2xl font-black text-white"><i class="fas fa-trophy text-orange-500 mr-2"></i>競賽隊伍大廳</h2>
                        <button onclick="closeJoinTeamModal()" class="text-gray-400 hover:text-white"><i class="fas fa-times text-xl"></i></button>
                    </div>
                    <div class="p-6 overflow-y-auto max-h-[60vh] custom-scroll">
                        <div id="teamListContainer" class="space-y-4">
                            <div class="text-center py-10 text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>載入隊伍中...</div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="createTeamModal" class="fixed inset-0 bg-[#020617]/95 backdrop-blur-md z-[10000] items-center justify-center hidden">
                <div class="absolute inset-0 overflow-hidden pointer-events-none">
                    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px]"></div>
                </div>
                <div class="relative bg-[#0a1128] w-full max-w-md rounded-2xl border border-blue-500/30 shadow-[0_0_40px_rgba(37,99,235,0.2)] flex flex-col overflow-hidden transform transition-all">
                    <div class="p-5 border-b border-blue-500/20 bg-gradient-to-r from-blue-900/40 to-cyan-900/20 flex justify-between items-center relative overflow-hidden">
                        <div class="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-400 to-transparent"></div>
                        <h2 class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 tracking-wider flex items-center gap-3">
                            <i class="fas fa-network-wired text-blue-400"></i>
                            發起小組任務
                        </h2>
                        <button onclick="closeCreateTeamModal()" class="text-blue-500/60 hover:text-cyan-300 hover:rotate-90 transition-all duration-300">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                    <div id="createTeamStep1" class="flex flex-col w-full">
                        <div class="p-6 space-y-5">
                            <div class="space-y-1">
                                <label class="text-xs font-bold text-blue-400/80 uppercase tracking-widest flex items-center gap-2">
                                    <i class="fas fa-terminal text-[10px]"></i> 小隊名稱
                                </label>
                                <div class="relative">
                                    <input type="text" id="teamNameInput" placeholder="輸入您的隊伍代號..." 
                                        class="w-full bg-[#050b14] border border-blue-500/20 text-blue-100 p-3 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/50 placeholder-blue-700/50 transition-all font-mono text-sm">
                                </div>
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs font-bold text-blue-400/80 uppercase tracking-widest flex items-center gap-2">
                                    <i class="fas fa-users text-[10px]"></i> 小隊人數限制
                                </label>
                                <select id="teamSizeInput" class="w-full bg-[#050b14] border border-blue-500/20 text-blue-200 p-3 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/50 transition-all appearance-none cursor-pointer text-sm">
                                    <option value="2">2 人 (雙排特戰)</option>
                                    <option value="4" selected>4 人 (標準小隊)</option>
                                    <option value="6">6 人 (大型作戰)</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs font-bold text-blue-400/80 uppercase tracking-widest flex items-center gap-2">
                                    <i class="fas fa-map-marker-alt text-[10px]"></i> 選擇作戰教室
                                </label>
                                <div class="relative">
                                    <select id="teamRoomSelect" class="w-full bg-black/50 text-white p-4 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500 appearance-none font-bold">
                                        <option value="immersive-room.html">🟣 沉浸式自習室 (動漫旗艦版)</option>
                                        <option value="managed-room.html">🔵 模擬線上教室 (專業控管版)</option>
                                    </select>
                                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                                        <i class="fas fa-chevron-down text-xs"></i>
                                    </div>
                                </div>
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs font-bold text-blue-400/80 uppercase tracking-widest flex items-center gap-2">
                                    <i class="fas fa-shield-alt text-[10px]"></i> 入隊審核權限
                                </label>
                                <select id="teamAuditInput" class="w-full bg-[#050b14] border border-blue-500/20 text-blue-200 p-3 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/50 transition-all appearance-none cursor-pointer text-sm">
                                    <option value="none" selected>🔓 不需審核 (自由加入)</option>
                                    <option value="leader">🔒 隊長審核 (需經批准)</option>
                                </select>
                            </div>
                            <div class="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-3 mt-4">
                                <i class="fas fa-info-circle text-blue-400 mt-0.5"></i>
                                <p class="text-[10px] text-blue-300/70 leading-relaxed">
                                    系統將依據您的<span class="text-cyan-400 font-bold mx-1">誠信分</span>決定發起權限。發起後，您將作為隊長自動進入指定的實體教室等待隊員連線。
                                </p>
                            </div>
                        </div>
                        <div class="p-5 border-t border-blue-500/20 bg-[#050b14] flex gap-3">
                            <button onclick="closeCreateTeamModal()" class="flex-1 py-3 rounded-lg text-sm font-bold text-blue-400/70 hover:text-blue-300 hover:bg-blue-900/20 transition-all border border-transparent hover:border-blue-500/30">
                                取消部署
                            </button>
                            <button onclick="goToCreateTeamStep2()" class="flex-1 py-3 rounded-lg text-sm font-black text-[#050b14] bg-gradient-to-r from-blue-500 to-cyan-400 hover:from-blue-400 hover:to-cyan-300 shadow-[0_0_15px_rgba(56,189,248,0.4)] hover:shadow-[0_0_25px_rgba(56,189,248,0.6)] transition-all transform hover:-translate-y-0.5 flex justify-center items-center">
                                下一步 <i class="fas fa-arrow-right ml-2"></i>
                            </button>
                        </div>
                    </div>
                    <div id="createTeamStep2" class="hidden flex-col w-full">
                        <div class="p-6 flex flex-col items-center text-center space-y-4 relative">
                            <div class="w-14 h-14 bg-blue-900/30 rounded-full flex items-center justify-center mb-2 border border-blue-500/30">
                                <i class="fas fa-mobile-alt text-blue-400 text-2xl"></i>
                            </div>
                            <h3 class="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 font-black text-lg tracking-wider">設備安全連動</h3>
                            <p class="text-[11px] text-blue-200/60 leading-relaxed max-w-[250px]">
                                請掃描下方專屬 QR Code，並將手機<span class="text-cyan-400 font-bold">「翻轉蓋上」</span>即可解鎖進入教室的權限。
                            </p>
                            <div class="bg-white p-2.5 rounded-xl border-4 border-blue-500/30 shadow-[0_0_20px_rgba(56,189,248,0.2)] mt-2">
                                <div id="teamSyncQr" class="w-36 h-36 flex items-center justify-center bg-gray-100 text-gray-400 text-xs">生成中...</div>
                            </div>
                            <div id="syncStatusBox" class="flex items-center gap-3 px-5 py-3 mt-4 bg-[#050b14] rounded-xl border border-blue-500/30 w-full justify-center shadow-inner">
                                <div id="syncStatusDot" class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
                                <span id="syncStatusText" class="text-xs text-blue-200 font-mono tracking-wide">等待手機連動與翻轉...</span>
                            </div>
                        </div>
                        <div class="p-5 border-t border-blue-500/20 bg-[#050b14] flex flex-col gap-3">
                            <div class="flex gap-3 w-full">
                                <button onclick="backToCreateTeamStep1()" class="flex-1 py-3 rounded-lg text-sm font-bold text-blue-400/70 hover:text-blue-300 hover:bg-blue-900/20 transition-all border border-transparent hover:border-blue-500/30">
                                    返回修改
                                </button>
                                <button id="finalCreateTeamBtn" disabled onclick="executeTeamCreation()" class="flex-[1.5] py-3 rounded-lg text-sm font-black text-gray-500 bg-gray-800 border border-gray-700 cursor-not-allowed transition-all flex justify-center items-center gap-2">
                                    <i class="fas fa-lock"></i> 鎖定中
                                </button>
                            </div>
                            <button onclick="skipAndExecuteTeamCreation()" class="w-full py-2 mt-1 text-xs text-blue-400/60 hover:text-blue-300 underline decoration-blue-500/30 hover:decoration-blue-400 transition-all">
                                略過手機連動，直接進入教室 <i class="fas fa-chevron-right text-[10px]"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="joinTeamSyncModal" class="fixed inset-0 bg-[#020617]/95 backdrop-blur-md z-[10001] items-center justify-center hidden">
                <div class="relative bg-[#0a1128] w-full max-w-md rounded-2xl border border-orange-500/30 shadow-[0_0_40px_rgba(249,115,22,0.2)] flex flex-col overflow-hidden">
                    <div class="p-5 border-b border-orange-500/20 bg-gradient-to-r from-orange-900/40 to-red-900/20 flex justify-between items-center relative">
                        <h2 class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-300 tracking-wider flex items-center gap-3">
                            <i class="fas fa-sign-in-alt text-orange-400"></i> 加入隊伍認證
                        </h2>
                        <button onclick="closeJoinTeamSyncModal()" class="text-orange-500/60 hover:text-yellow-300 transition-all"><i class="fas fa-times text-xl"></i></button>
                    </div>
                    <div class="p-6 flex flex-col items-center text-center space-y-4">
                        <div class="w-14 h-14 bg-orange-900/30 rounded-full flex items-center justify-center border border-orange-500/30">
                            <i class="fas fa-mobile-alt text-orange-400 text-2xl"></i>
                        </div>
                        <p class="text-[11px] text-orange-200/60 leading-relaxed max-w-[250px]">
                            請掃描 QR Code 連動設備，並將手機<span class="text-yellow-400 font-bold">「翻轉蓋上」</span>以解鎖加入權限。
                        </p>
                        <div class="bg-white p-2.5 rounded-xl border-4 border-orange-500/30 mt-2">
                            <div id="joinTeamSyncQr" class="w-36 h-36 flex items-center justify-center bg-gray-100 text-gray-400 text-xs">生成中...</div>
                        </div>
                        <div id="joinSyncStatusBox" class="flex items-center gap-3 px-5 py-3 mt-4 bg-black/40 rounded-xl border border-orange-500/30 w-full justify-center">
                            <div id="joinSyncStatusDot" class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                            <span id="joinSyncStatusText" class="text-xs text-orange-200 font-mono">等待手機連動與翻轉...</span>
                        </div>
                    </div>
                    <div class="p-5 border-t border-orange-500/20 bg-[#050b14] flex flex-col gap-3">
                        <button id="finalJoinTeamBtn" disabled onclick="executeJoinTeam()" class="w-full py-3 rounded-lg text-sm font-black text-gray-500 bg-gray-800 border border-gray-700 cursor-not-allowed flex justify-center items-center gap-2 transition-all">
                            <i class="fas fa-lock"></i> 驗證未通過
                        </button>
                        <button onclick="skipAndExecuteJoinTeam()" class="w-full py-2 text-xs text-orange-400/60 hover:text-orange-300 underline transition-all">
                            略過連動，直接加入 <i class="fas fa-chevron-right text-[10px]"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}
// 註冊自訂元件標籤
customElements.define('team-modals', TeamModals);