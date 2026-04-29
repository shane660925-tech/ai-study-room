/**
 * StudyVerse V2.2.5.1 - 核心共用邏輯 (lobby-core.js)
 * 負責：登入驗證、個人數據讀取、成就系統、Socket 全域廣播(跑馬燈/週榜)
 */

let myUsername = localStorage.getItem('studyVerseUser');
const socket = io();

// 確保變數掛在 window 下，讓所有 JS 檔案都能共用
window.isMobileConnected = false; 
window.isMobileFlipped = false;
window.AppSync = { connected: false, flipped: false }; // 兼容 team-lobby

// [核心監聽器]：精確掌握手機真實連線狀態
socket.on('mobile_sync_update', (data) => {
    // 增加相容 studentName，避免遺漏任何訊號
    const targetName = data.username || data.name || data.studentName;
    
    if (targetName === myUsername) {
        // 【修復】: 確保每次掃描 QR Code 連動時，若缺少 connected 屬性不被誤判為 false
        // 若為明確斷線指令，則設為 false；否則既然收到同步訊號，即代表手機已連線
        if (data.type === 'FORCE_DISCONNECT' || data.connected === false) {
            window.isMobileConnected = false;
        } else if (typeof data.connected !== 'undefined') {
            window.isMobileConnected = data.connected;
        } else {
            window.isMobileConnected = true; 
        }

        if (typeof data.isFlipped !== 'undefined') {
            window.isMobileFlipped = data.isFlipped;
        }

        window.AppSync = { connected: window.isMobileConnected, flipped: window.isMobileFlipped };
        console.log("核心同步成功:", window.AppSync);
        
        // 同步觸發大廳 UI 更新
        if (typeof updateSyncModuleUI === 'function') {
            updateSyncModuleUI(window.isMobileConnected, window.isMobileFlipped);
        }
    }
});


// ==========================================
// [核心修改] 初始化檢查登入狀態：確保 UI 與姓名同步
// ==========================================
function checkLogin() {
    // 【關鍵】：重新從 localStorage 抓取，確保能抓到 Google 登入或其它腳本寫入的最新名稱
    myUsername = localStorage.getItem('studyVerseUser');

    if (!myUsername) {
        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) {
            loginOverlay.classList.remove('hidden');
            setTimeout(() => {
                const setupName = document.getElementById('setupName');
                if (setupName) setupName.focus();
            }, 100);
        }
    } else {
        // 1. 更新右上角導覽列姓名 (navName)
        const navName = document.getElementById('navName');
        if (navName) {
            navName.innerText = myUsername;
        }

        // 2. 更新右上角頭像 (navAvatar)
        const navAvatar = document.getElementById('navAvatar');
        if (navAvatar) {
            navAvatar.src = `https://api.dicebear.com/7.x/big-smile/svg?seed=${myUsername}&backgroundColor=b6e3f4`;
        }
        
        // 3. 登入後向伺服器註冊身份
        socket.emit('join', { name: myUsername, role: 'student' });
        
        // 4. 讀取個人雲端數據
        fetchUserStats();

        // 5. 呼叫各頁面專屬的初始化邏輯 (由各別的 main.js 或 team.js 定義)
        if (typeof window.pageSpecificInit === 'function') {
            window.pageSpecificInit();
        }
    }
}

// ==========================================
// [修復] 監聽伺服器每秒廣播：移除導致幽靈連線的強制 True Bug
// ==========================================
socket.on('update_rank', (users) => {
    if (!myUsername) return;
    
    // 從伺服器名單中尋找自己的最新狀態
    const myData = users.find(u => u.name === myUsername);
    
    if (myData) {
        // ⚠️ 修正：不再強制把 isMobileConnected 設為 true
        // 只有在我們確定手機已經連線的情況下，才透過排行榜更新翻轉狀態
        if (typeof myData.isFlipped !== 'undefined' && window.isMobileConnected) {
            window.isMobileFlipped = myData.isFlipped === true;
        }
        
        // 更新右側的 QR Code 視覺
        if (typeof updateSyncModuleUI === 'function') {
            updateSyncModuleUI(window.isMobileConnected, window.isMobileFlipped);
        }
    }
});

// ==========================================
// [修復] 安全的 QR Code 狀態更新機制 (不刪除原有的 QR 圖案)
// ==========================================
function updateSyncModuleUI(connected, flipped) {
    const syncModule = document.getElementById('syncModule');
    const qrcodeContainer = document.getElementById('qrcode');
    if (!syncModule || !qrcodeContainer) return;

    // 建立或取得懸浮覆蓋層 (Overlay)，避免動到原本的 QR Code Canvas
    let overlay = document.getElementById('sync-overlay-status');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sync-overlay-status';
        overlay.className = 'absolute inset-0 z-10 flex flex-col items-center justify-center backdrop-blur-md bg-[#050b14]/95 rounded-xl transition-all duration-300';
        qrcodeContainer.style.position = 'relative'; // 確保容器可以包住絕對定位的覆蓋層
        qrcodeContainer.appendChild(overlay);
    }

    // 找出真正的 QR Code 元素 (排除我們的 overlay)
    const qrElements = Array.from(qrcodeContainer.children).filter(el => el.id !== 'sync-overlay-status');

    if (connected && flipped) {
        syncModule.style.borderColor = '#22c55e'; 
        syncModule.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.3)';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <i class="fas fa-check-circle text-6xl mb-3 text-green-500 shadow-green-500/50 drop-shadow-lg animate-pulse"></i>
            <span class="text-sm font-black tracking-widest uppercase mt-2 text-green-500">已連動並深度專注</span>
        `;
        qrElements.forEach(el => el.style.opacity = '0'); // 隱藏底部 QR Code
    } else if (connected && !flipped) {
        syncModule.style.borderColor = '#eab308'; 
        syncModule.style.boxShadow = '0 0 20px rgba(234, 179, 8, 0.3)';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <i class="fas fa-mobile-alt text-6xl mb-3 text-yellow-500 shadow-yellow-500/50 drop-shadow-lg animate-pulse"></i>
            <span class="text-sm font-black tracking-widest uppercase mt-2 text-yellow-500">連動成功．等待翻轉</span>
        `;
        qrElements.forEach(el => el.style.opacity = '0'); // 隱藏底部 QR Code
    } else {
        // [關鍵修復]：斷線時，隱藏覆蓋層，瞬間讓 QR Code 恢復顯示！
        syncModule.style.borderColor = ''; 
        syncModule.style.boxShadow = '';
        overlay.style.display = 'none';
        qrElements.forEach(el => el.style.opacity = '1'); // 讓原本的 QR Code 浮現
    }
}

// ==========================================
// Socket 監聽：實時動態跑馬燈
// ==========================================
socket.on('community_event', (data) => {
    const ticker = document.getElementById('tickerStream');
    if (!ticker) return;

    const eventEl = document.createElement('span');
    eventEl.className = "flex items-center gap-2 flex-shrink-0";
    
    let icon = "fa-info-circle";
    if(data.type === 'START') icon = "fa-play text-green-400";
    if(data.type === 'ENTER') icon = "fa-door-open text-blue-400";
    if(data.type === 'ACHIEVE') icon = "fa-medal text-yellow-400 animate-bounce";
    if(data.type === 'TOTAL_HOURS') icon = "fa-fire text-orange-500";

    eventEl.innerHTML = `<i class="fas ${icon}"></i> ${data.message}`;
    
    ticker.appendChild(eventEl);
    if (ticker.children.length > 15) {
        ticker.removeChild(ticker.firstChild);
    }
});

// ==========================================
// Socket 監聽：週排行榜更新
// ==========================================
socket.on('update_weekly_rank', (data) => {
    const list = document.getElementById('weeklyLeaderboard');
    if (!list) return;

    if (!data || data.length === 0) {
        list.innerHTML = `<li class="text-center py-4 text-gray-500 text-[10px] italic font-black uppercase tracking-widest">Awaiting Data / 等待數據中</li>`;
        return;
    }

    list.innerHTML = data.map((user, index) => {
        let rankClass = "bg-gray-800 text-gray-400";
        if(index === 0) rankClass = "rank-1"; 
        if(index === 1) rankClass = "rank-2"; 
        if(index === 2) rankClass = "rank-3"; 

        return `
            <li class="flex items-center justify-between group py-1">
                <div class="flex items-center gap-3">
                    <span class="rank-badge ${rankClass}">${index + 1}</span>
                    <div class="flex flex-col">
                        <span class="text-xs font-bold text-white group-hover:text-blue-400 transition-colors">${user.name}</span>
                        <span class="text-[9px] text-gray-500 uppercase tracking-tighter">${user.status || '專注中'}</span>
                    </div>
                </div>
                <div class="text-right">
                    <span class="text-xs font-mono text-blue-300 font-bold">${(user.weeklyHours || 0).toFixed(1)}h</span>
                </div>
            </li>
        `;
    }).join('');
});

// ==========================================
// 監聽來自手機端的狀態更新
// ==========================================
socket.on('update_status', (data) => {
    if (data.name === myUsername) {
        // 【修復】：只要手機主動發送 status 更新，就代表確實連線中，確保黃色等待圖示能正常顯示
        window.isMobileConnected = true; 
        window.isMobileFlipped = data.isFlipped;
        window.AppSync = { connected: true, flipped: data.isFlipped };

        if (typeof updateSyncModuleUI === 'function') updateSyncModuleUI(window.isMobileConnected, window.isMobileFlipped);
    }
});

// 監聽教師端的警告指令
socket.on('admin_action', (data) => {
    console.log("收到管理員指令:", data);
    if (data.type === 'WAKEUP') {
        showViolationAlert(data.message || "偵測到手機翻開！請專注學習！");
    }
});

// 顯示違規警告
window.showViolationAlert = function(msg) {
    const modal = document.getElementById('violation-modal');
    const msgElement = document.getElementById('violation-msg');
    
    if (modal && msgElement) {
        msgElement.innerText = msg;
        modal.classList.remove('hidden');
        modal.classList.add('show-violation');

        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
    }
};

// 關閉警告
window.dismissAlert = function() {
    const modal = document.getElementById('violation-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('show-violation');
    }
};

// 儲存名稱並登入
window.saveName = function() {
    const name = document.getElementById('setupName').value.trim();
    if (name) {
        localStorage.setItem('studyVerseUser', name);
        myUsername = name;
        document.getElementById('loginOverlay').classList.add('hidden');
        checkLogin();
    }
};

// 登出
window.logout = function() {
    if(confirm('確定要登出並切換指揮官身分嗎？')) {
        localStorage.removeItem('studyVerseUser');
        location.reload();
    }
};

// 獲取使用者統計資料
async function fetchUserStats() {
    try {
        const response = await fetch(`/api/user-stats?username=${encodeURIComponent(myUsername)}`);
        if (!response.ok) throw new Error('伺服器回應錯誤');
        const data = await response.json();
        
        // 累積專注時間
        const totalMinutes = data.calculatedTotalSeconds ? Math.floor(data.calculatedTotalSeconds / 60) : 0;
        
        // 誠信信用分
        const integrity = data.calculatedAvgIntegrity || 100;
        
        const streak = data.user ? data.user.streak : 0;

        // 更新介面
        if (document.getElementById('totalFocusTime')) {
            document.getElementById('totalFocusTime').innerText = totalMinutes;
        }
        if (document.getElementById('integrityScore')) {
            document.getElementById('integrityScore').innerText = integrity;
        }

        // ==========================================
        // 【修正後的精準等級與經驗值計算邏輯】
        // ==========================================
        const totalExp = data.user ? data.user.total_seconds : (data.total_seconds || 0); 
        const expPerLevel = 1000; 

        const level = Math.floor(totalExp / expPerLevel) + 1; 
        const currentExp = totalExp % expPerLevel; 
        const nextLevelExp = expPerLevel; 
        
        const expProgress = (currentExp / nextLevelExp) * 100; 

        const levelEl = document.getElementById('userLevel');
        const expTextEl = document.getElementById('userExpText');
        const expBarEl = document.getElementById('userExpBar');

        if (levelEl) levelEl.innerText = `LV.${level}`;
        if (expTextEl) expTextEl.innerText = `${currentExp} / ${nextLevelExp}`;
        if (expBarEl) expBarEl.style.width = `${expProgress}%`;
        // ==========================================

        // 保留原有的介面更新
        if (document.getElementById('totalTimeDisplay')) {
            document.getElementById('totalTimeDisplay').innerHTML = `${totalMinutes}<span class="text-lg text-gray-500 ml-1">min</span>`;
        }
        if (document.getElementById('streakDisplay')) {
            document.getElementById('streakDisplay').innerHTML = `${streak}<span class="text-lg text-gray-500 ml-1">days</span>`;
        }
        if (document.getElementById('integrityDisplay')) {
            document.getElementById('integrityDisplay').innerHTML = `${integrity}<span class="text-lg text-gray-500 ml-1">pt</span>`;
        }
        
        let deskName = "🪵 初心木桌";
        if (streak >= 30) deskName = "🚀 虛擬座艙";
        else if (streak >= 7) deskName = "👑 黃金書桌";
        else if (streak >= 3) deskName = "⚙️ 合金工作台";
        if (document.getElementById('rankDisplay')) {
            document.getElementById('rankDisplay').innerText = deskName;
        }

        // 動態成就系統 (Achievement Badges)
        const badgesContainer = document.getElementById('myBadges');
        if (badgesContainer) {
            const badges = [];
            if (totalMinutes >= 3000) badges.push({ icon: 'fa-crown text-yellow-400', name: '專注宗師', desc: '累積專注超過 50 小時' });
            else if (totalMinutes >= 600) badges.push({ icon: 'fa-star text-blue-400', name: '漸入佳境', desc: '累積專注超過 10 小時' });
            if (streak >= 7) badges.push({ icon: 'fa-fire text-orange-500', name: '堅持不懈', desc: '連續登入 7 天' });

            let maxSingleFocus = 0;
            if (data.records) {
                data.records.forEach(r => {
                    if (r.focus_seconds > maxSingleFocus) maxSingleFocus = r.focus_seconds;
                });
            }
            if (maxSingleFocus >= 14400) badges.push({ icon: 'fa-shield-alt text-gray-300', name: '鋼鐵意志', desc: '單次專注滿 4 小時' });
            else if (maxSingleFocus >= 7200) badges.push({ icon: 'fa-battery-full text-green-400', name: '深度潛航', desc: '單次專注滿 2 小時' });
            if (badges.length === 0) badges.push({ icon: 'fa-seedling text-green-300', name: '初來乍到', desc: '踏出專注的第一步' });

            badgesContainer.innerHTML = badges.map(b => `
                <div class="flex items-center gap-2 bg-black/40 border border-white/10 px-3 py-1.5 rounded-lg group relative cursor-help hover:border-blue-500/50 transition-colors">
                    <i class="fas ${b.icon}"></i>
                    <span class="text-[11px] font-bold text-gray-300 group-hover:text-white">${b.name}</span>
                    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2 py-1 bg-gray-800 border border-gray-600 text-[10px] text-white rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl">
                        ${b.desc}
                    </div>
                </div>
            `).join('');
        }

        const tbody = document.getElementById('recordsTableBody');
        if (tbody) {
            if (!data.records || data.records.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-500 uppercase tracking-widest">No Logs Found / 尚無數據</td></tr>`;
                return;
            }

            tbody.innerHTML = data.records.map(record => {
                const date = new Date(record.created_at);
                const dateStr = date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) + ' ' + 
                              date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
                const m = Math.floor(record.focus_seconds / 60);
                
                let icon = record.room_type === 'flip-room' ? 'fa-mobile-alt text-green-500' : 'fa-desktop text-blue-500';
                let typeLabel = record.room_type === 'flip-room' ? '手機翻轉模式' : 'AI 監控教室';

                return `
                    <tr class="hover:bg-white/5 transition-colors group">
                        <td class="p-4 pl-8"><span class="text-gray-500 font-mono tracking-tighter">${dateStr}</span></td>
                        <td class="p-4"><span class="flex items-center gap-2 text-white font-bold"><i class="fas ${icon}"></i>${typeLabel}</span></td>
                        <td class="p-4 text-right pr-8">
                            <span class="font-mono text-blue-400 font-bold tracking-widest">+ ${m} MIN</span>
                        </td>
                    </tr>`;
            }).join('');
        }
    } catch (error) {
        console.error("數據同步失敗:", error);
        if (document.getElementById('recordsTableBody')) {
            document.getElementById('recordsTableBody').innerHTML = `<tr><td colspan="3" class="p-8 text-center text-red-500/60 font-black uppercase">Sync Failed / 資料庫同步失敗</td></tr>`;
        }
    }
}

// 啟動應用程式
document.addEventListener('DOMContentLoaded', checkLogin);