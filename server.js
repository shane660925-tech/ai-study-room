// 引入環境變數設定 (必須放在最頂端)
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const ScoringService = require('./ScoringService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 增加緩衝區大小以支援截圖傳輸
});
// 儲存各個特約教室的專屬課表
const tutorSchedules = {};

// 提高 JSON 限制以接收 Base64 截圖
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. 連線 Supabase 雲端資料庫
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ 錯誤：找不到 Supabase 設定，請檢查 .env 檔案！');
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ 已成功載入 Supabase 雲端資料庫設定。');

// ==========================================
// 2. API 路由設定
// ==========================================

// --- [新增] 註冊 API ---
app.post('/api/register', async (req, res) => {
    const { username, account, password } = req.body;
    
    if (!username || !account || !password) {
        return res.status(400).json({ error: '缺少註冊參數' });
    }

    try {
        // 1. 檢查帳號是否已被註冊
        const { data: existingAccount } = await supabase
            .from('users')
            .select('account')
            .eq('account', account)
            .maybeSingle();

        if (existingAccount) return res.status(400).json({ error: '此帳號已被註冊！' });

        // 2. 檢查暱稱是否重複 (保留原本以暱稱為主鍵的防呆)
        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .maybeSingle();

        if (existingUser) return res.status(400).json({ error: '此暱稱已有人使用，請換一個！' });

        const today = new Date().toISOString().split('T')[0];

        // 3. 寫入新使用者資料 (注意: 實際上線建議將密碼透過 bcrypt 加密)
        const { error } = await supabase.from('users').insert([{ 
            username: username, 
            account: account,
            password: password,
            total_seconds: 0, 
            streak: 1, 
            last_login: today, 
            role: 'student', 
            integrity_score: 100 
        }]);

        if (error) throw error;
        
        res.json({ message: '註冊成功！', username: username });
    } catch (err) {
        console.error("註冊失敗:", err);
        res.status(500).json({ error: '系統註冊失敗，請稍後再試。' });
    }
});

// --- [新增] 登入 API ---
app.post('/api/login', async (req, res) => {
    const { account, password } = req.body;
    
    if (!account || !password) {
        return res.status(400).json({ error: '請輸入帳號密碼' });
    }

    try {
        // 透過帳號與密碼比對登入
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('account', account)
            .eq('password', password)
            .maybeSingle();

        if (error || !user) {
            return res.status(401).json({ error: '帳號或密碼錯誤！' });
        }

        res.json({ message: '登入成功！', username: user.username });
    } catch (err) {
        console.error("登入失敗:", err);
        res.status(500).json({ error: '系統登入失敗，請稍後再試。' });
    }
});

app.get('/api/user-stats', async (req, res) => {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Missing username' });

    try {
        // 1. 獲取基本用戶資料
        const { data: user } = await supabase.from('users').select('*').eq('username', username).single();

        // 2. 獲取該用戶的所有紀錄 (用於計算總和與平均)
        const { data: allRecords } = await supabase
            .from('focus_records')
            .select('focus_seconds, integrity_score')
            .eq('username', username);

        let totalSecondsSum = 0;
        let averageIntegrity = 100;

        if (allRecords && allRecords.length > 0) {
            // 加總所有專注秒數
            totalSecondsSum = allRecords.reduce((sum, r) => sum + (r.focus_seconds || 0), 0);
            
            // 計算誠信分平均 (過濾掉可能的 null 值)
            const validScores = allRecords.map(r => r.integrity_score).filter(s => s !== null);
            if (validScores.length > 0) {
                averageIntegrity = Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length);
            }
        }

        // 3. 獲取最近 10 筆紀錄 (僅用於表格顯示)
        const { data: displayRecords } = await supabase
            .from('focus_records')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({ 
            user, 
            records: displayRecords, 
            calculatedTotalSeconds: totalSecondsSum, 
            calculatedAvgIntegrity: averageIntegrity 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 核心修正：修改 save-focus API (結算點)
// ==========================================
app.post('/api/save-focus', async (req, res) => {
    const { username, roomType, focusSeconds, deviceMode, teamSize, flippedCount, comment, creditDelta, violationDetails, integrityScore } = req.body;
    
    if (!username || !roomType || focusSeconds === undefined) {
        return res.status(400).json({ error: '缺少參數' });
    }

    // 從 onlineUsers 獲取該使用者的臨時懲罰紀錄
    const userSession = onlineUsers.find(u => u.name === username) || {};
    const today = new Date().toISOString().split('T')[0];

    try {
        // 使用核心大公式計算最終經驗值 (finalExp)
        const { totalExp, breakdown } = ScoringService.calculateFinalExp({
            durationMin: Math.floor(focusSeconds / 60),
            deviceMode: deviceMode, // 'ULTIMATE', 'VISUAL', etc.
            roomMode: roomType,
            teamSize: teamSize || 1,
            flippedCount: flippedCount || 0,
            penaltyExp: userSession.accumulatedPenaltyExp || 0,
            violationDetails: violationDetails || {}
        });

        // 1. 寫入專注紀錄 (focus_records) - 已加入 integrity_score
        await supabase.from('focus_records').insert([
            {
                username: username,
                room_type: roomType,
                focus_seconds: focusSeconds, // 存原始秒數作為紀錄
                earned_exp: totalExp,         // 存公式計算後的積分/經驗值
                ai_comment: comment || "",
                integrity_score: integrityScore // 【修正：新增此行】
            }
        ]);

        // 2. 更新使用者總數據 (users)
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .maybeSingle();

        if (user) {
            let newStreak = user.streak || 1;
            let isFirstLoginToday = user.last_login !== today;
            if (isFirstLoginToday) newStreak += 1;

            let currentIntegrity = user.integrity_score ?? 100;
            let dailyBonus = isFirstLoginToday ? 1 : 0;
            let sessionDelta = creditDelta !== undefined ? Number(creditDelta) : 0;
            
            let newIntegrity = Math.max(0, Math.min(100, currentIntegrity + dailyBonus + sessionDelta));

            await supabase.from('users')
                .update({
                    total_seconds: (user.total_seconds || 0) + totalExp, // 將計算後的積分累加至總分
                    streak: newStreak,
                    last_login: today,
                    integrity_score: newIntegrity
                })
                .eq('username', username);
                
            console.log(`[系統結算] ${username} 最終獲得 EXP: ${totalExp}，誠信分變動: ${sessionDelta}`);

            // 結算成功後，重置該 Session 的懲罰分數
            if (userSession.name) {
                userSession.accumulatedPenaltyExp = 0;
            }
        } else {
            // 新使用者邏輯
            let initialIntegrity = Math.max(0, Math.min(100, 100 + (creditDelta !== undefined ? Number(creditDelta) : 0)));
            await supabase.from('users').insert([
                { 
                    username: username, 
                    total_seconds: totalExp, 
                    streak: 1, 
                    last_login: today, 
                    role: 'student', 
                    integrity_score: initialIntegrity 
                }
            ]);
        }

        res.json({ message: '儲存成功！', earned: totalExp, breakdown: breakdown });
        
    } catch (err) {
        console.error("儲存失敗:", err);
        res.status(500).json({ error: '儲存過程發生錯誤' });
    }
});

// ==========================================
// 3. Socket.io 即時連線邏輯
// ==========================================
let onlineUsers = [];
let teacherLogs = [];
let violationSnaps = [];
const disconnectTimeouts = {};

// 在 server.js 建立一個記憶體變數來存儲所有人的翻轉狀態
const globalUserStatus = {}; 

// --- 特約教室 (Tutor Room) 專屬記憶體狀態 ---
const tutorRoomSchedules = new Map();
// 儲存特約教室的課表設定
const tutorRoomSettings = new Map(); 

// 計算特約教室全域時間的核心函數 (修正：補齊所有狀態的 period)
function getTutorRoomTimeState(roomId) {
    const schedule = tutorRoomSettings.get(roomId);
    if (!schedule) return null;

    const now = new Date();
    const start = new Date();
    const [h, m] = schedule.startTime.split(':');
    start.setHours(parseInt(h), parseInt(m), 0, 0);

    const elapsedSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);
    const classSecs = schedule.classMinutes * 60;
    const restSecs = schedule.restMinutes * 60;
    const periodSecs = classSecs + restSecs;
    const totalSecs = schedule.periods * periodSecs;

    // 還沒開始上課
    if (elapsedSeconds < 0) {
        return { phase: 'WAITING', remainingSeconds: Math.abs(elapsedSeconds), totalSeconds: classSecs, period: 1 };
    }
    // 課程已全部結束
    if (elapsedSeconds >= totalSecs) {
        return { phase: 'ENDED', remainingSeconds: 0, totalSeconds: classSecs, period: schedule.periods };
    }

    const currentPeriodElapsed = elapsedSeconds % periodSecs;
    const currentPeriodIndex = Math.floor(elapsedSeconds / periodSecs) + 1;

    if (currentPeriodElapsed < classSecs) {
        return { phase: 'CLASS', remainingSeconds: classSecs - currentPeriodElapsed, totalSeconds: classSecs, period: currentPeriodIndex };
    } else {
        return { phase: 'REST', remainingSeconds: periodSecs - currentPeriodElapsed, totalSeconds: restSecs, period: currentPeriodIndex };
    }
}
// ==========================================
// 隊伍狀態與隊長機制管理
// ==========================================
const teamLeaderStates = {};

async function broadcastUpdateRank() {
    const rooms = [...new Set(onlineUsers.map(u => u.roomMode))];
    rooms.forEach(room => {
        const usersInRoom = onlineUsers.filter(u => u.roomMode === room).map(u => {
            let isCap = false;
            if (u.teamId && teamLeaderStates[u.teamId] && teamLeaderStates[u.teamId].leader === u.name) {
                isCap = true;
            }
            return { ...u, isCaptain: isCap };
        });
        io.to(room).emit('update_rank', usersInRoom);
    });

    const studentIds = new Set(onlineUsers.map(u => u.id));
    const sockets = await io.fetchSockets();
    
    const fullUsersList = onlineUsers.map(u => {
        let isCap = false;
        if (u.teamId && teamLeaderStates[u.teamId] && teamLeaderStates[u.teamId].leader === u.name) {
            isCap = true;
        }
        return { ...u, isCaptain: isCap };
    });

    sockets.forEach(s => {
        if (!studentIds.has(s.id)) {
            s.emit('update_rank', fullUsersList);
        }
    });
}

let activeTeams = [];

function broadcastActiveTeams() {
    const now = Date.now();
    activeTeams.forEach(team => {
        const teamState = teamLeaderStates[team.id];
        team.currentMembers = teamState ? teamState.members.length : 0;
    });

    activeTeams = activeTeams.filter(team => {
        if (team.currentMembers > 0) return true;
        if (!team.createdAt) team.createdAt = now;
        if (now - team.createdAt > 60000) {
            console.log(`🗑️ [系統清理] 隊伍 ${team.id} 因超過 60 秒無人加入已移除。`);
            return false;
        }
        return true;
    });

    io.emit('update_active_teams', activeTeams);
}

function removeUserFromTeam(username, roomId) {
    const team = teamLeaderStates[roomId];
    if (!team) return;

    team.members = team.members.filter(name => name !== username);
    
    if (team.members.length === 0) {
        delete teamLeaderStates[roomId];
        activeTeams = activeTeams.filter(t => t.id !== roomId);
        console.log(`🗑️ [系統] 隊伍 ${roomId} 已無成員，自動解散。`);
    } else if (team.leader === username) {
        team.leader = team.members[0];
        io.to(roomId).emit('team_leader_update', { leader: team.leader });
        io.to(roomId).emit('admin_action', { type: 'BLACKBOARD', content: `隊長已移交給 ${team.leader}` });
    }
    
    const user = onlineUsers.find(u => u.name === username);
    if (user) user.teamId = null;

    broadcastActiveTeams();
    broadcastUpdateRank(); 
}

const pendingJoinRequestsMap = {};
const userToSocketMap = {}; 

// 核心判定函數：計算綠燈/黃燈/紅燈 (特約教室專用)
function updateTutorStatus(username, roomId) {
    const info = tutorRoomSchedules.get(username);
    if (!info) return;

    let newStatus = 'RED'; // 預設紅燈 (缺件或斷線)

    if (info.pc && info.mobile) {
        // 雙機都在線，檢查手機是否翻轉
        newStatus = info.lastMobileFlip ? 'GREEN' : 'YELLOW';
    } else if (info.pc || info.mobile) {
        newStatus = 'YELLOW'; // 只有一機在線
    }

    info.status = newStatus;

    // 廣播給該教室的所有人（包括老師端）更新名單
    io.to(roomId).emit('tutor_list_update', {
        username,
        status: newStatus,
        devices: { pc: !!info.pc, mobile: !!info.mobile }
    });
}

io.on('connection', (socket) => {
    console.log('🔌 指揮官已連線：', socket.id);
    socket.emit('update_rank', onlineUsers);
    socket.emit('teacher_update', { logs: teacherLogs, snaps: violationSnaps });

    // 新增：接收客戶端加入房間的請求
    socket.on('join_room', (room) => {
        socket.join(room);
        console.log(`🏠 [房間管理] Socket ${socket.id} 已成功加入房間: ${room}`);
    });

   socket.on('tutor_patrol', (data) => {
    console.log(`[巡堂廣播] 收到導師請求，房間代碼: ${data.room}，訊息: ${data.message}`);
    
    // 轉發給學生端
    if (data.room) {
        // 改回這行：只發送給 data.room 這個房間裡面的學生
        socket.to(data.room).emit('receive_tutor_patrol', { message: data.message });
    } else {
        socket.broadcast.emit('receive_tutor_patrol', { message: data.message });
    }
});

    socket.on('student_feedback', (data) => {
        io.emit('student_feedback', data); // 前端會根據 data.target 自己過濾
    });
    // ------------------------------------
    // ==========================================
    // 特約教室 (Tutor Room) 核心邏輯
    // ==========================================
    
    // 新增轉發轉發邏輯
    socket.on('sync_tutor_schedule', (data) => {
        io.emit('receive_tutor_schedule', data); // 廣播給所有學生
    });

    // 接收大廳老師建立的課表並存起來
    socket.on('create_tutor_room_schedule', (data) => {
        tutorSchedules[data.roomId] = data;
        
        // 同時寫入 tutorRoomSettings 供計時器每秒計算使用
        const { roomId, startTime, classMinutes, restMinutes, periods } = data;
        tutorRoomSettings.set(roomId, { startTime, classMinutes, restMinutes, periods });
        
        console.log(`[系統] 已儲存特約教室 ${roomId} 的課表設定，首節 ${startTime}, ${classMinutes}分/節`);
    });

    // 當特約學生進入教室時，發送該教室的課表給他
    socket.on('request_tutor_schedule', (roomId) => {
        if (tutorSchedules[roomId]) {
            socket.emit('sync_tutor_schedule', tutorSchedules[roomId]);
        }
    });

    // 學生請求當下課表時間
    socket.on('request_tutor_timer_sync', (roomId) => {
        const timeState = getTutorRoomTimeState(roomId);
        if (timeState) {
            socket.emit('tutor_timer_sync', timeState);
        }
    });

    // 1. 學生進入特約教室 (雙機分開加入)
    socket.on('join_tutor_room', (data) => {
        const { username, roomId, deviceType } = data; // deviceType: 'pc' 或 'mobile'
        
        socket.join(roomId);
        socket.username = username;
        socket.roomId = roomId;
        socket.deviceType = deviceType;

        // 🛡️ 攔截幽靈連線：如果沒有名字、名字是空字串，或是字串的 'undefined'
    if (!data || !data.userName || data.userName === 'undefined' || data.userName === '神秘學員') {
        console.log("❌ 擋下了一個無效的幽靈連線，不寫入點名表");
        // 可以選擇 emit 一個錯誤給前端，或是直接 return 中斷執行
        return; 
    }
    
        if (!tutorRoomSchedules.has(username)) {
            tutorRoomSchedules.set(username, { pc: null, mobile: null, status: 'RED' });
        }
        
        const userDevices = tutorRoomSchedules.get(username);
        userDevices[deviceType] = socket.id;

        console.log(`[特約教室] ${username} 使用 ${deviceType} 進入了 ${roomId}`);
        
        updateTutorStatus(username, roomId);

        // 只要有人加入，順便推送一次最新的全域時間給他
        const timeState = getTutorRoomTimeState(roomId);
        if (timeState) socket.emit('tutor_timer_sync', timeState);
    });

    // 2. 監聽手機翻轉狀態 (特約教室專用，取消豁免權)
    socket.on('tutor_mobile_sync', (data) => {
        const { username, isFlipped, roomId } = data;
        if (tutorRoomSchedules.has(username)) {
            tutorRoomSchedules.get(username).lastMobileFlip = isFlipped ? new Date() : null;
            updateTutorStatus(username, roomId);
        }
    });

    /// 1. 全班大喇叭廣播
    socket.on('send_tutor_announcement', (data) => {
    console.log('📢 收到老師廣播:', data.message); // 可以讓你在終端機看到有沒有成功接收
    // 轉發給所有學生 (廣播頻道名稱為 receive_tutor_announcement)
    io.emit('receive_tutor_announcement', data); 
    })

    // 2. 黑板公告
    socket.on('update_blackboard', (data) => {
        io.emit('update_blackboard', data);
    });

    // 3. 導師個別警告
    socket.on('send_warning', (data) => {
        io.emit('receive_warning', data);
    });

    // 5. 讓老師把指令傳給學生的轉發通道 (計時器控制、強制同步等)
    socket.on('send_tutor_command', (data) => {
        console.log(`[指令轉發] 老師發送一般指令至教室: ${data.roomId || '全域'}`);
        if (data.roomId) {
            io.to(data.roomId).emit('receive_tutor_command', data);
        } else {
            io.emit('receive_tutor_command', data);
        }
    });

    socket.on('tutor_timer_command', (data) => {
        console.log(`[計時器控制] 老師發送計時器指令: ${data.command} 至教室: ${data.roomId || '全域'}`);
        if (data.roomId) {
            io.to(data.roomId).emit('tutor_timer_command', data);
        } else {
            io.emit('tutor_timer_command', data);
        }
    });

    // ==========================================
    // 新增：特約教室/一般教室的違規轉發橋樑
    // ==========================================
    socket.on('violation', (data) => {
        console.log(`[伺服器轉發] 收到學生違規: ${data.name} - ${data.type}`);
        
        // 將違規資料廣播給所有連線的客戶端（或是特定的教師房間）
        // 這樣 tutor-dashboard.js 和 admin.js 就能順利收到了！
        io.emit('violation', data); 
    });

    // 新增：切換分頁的專屬轉發
    socket.on('tab_switched', (data) => {
        io.emit('tab_switched', data);
    });
    // ==========================================
    // 原有功能與連動邏輯
    // ==========================================

    socket.on('request_link_device', (data) => {
        console.log(`收到連動請求！手機(${data.studentName}) 要求連動大廳(${data.syncToken})`);
        io.to(data.syncToken).emit('deviceLinked', { 
            success: true, 
            mobileName: data.studentName 
        });
    });

    socket.on('join_team', async (data) => {
        const { teamId, username, roomType } = data;
        const { data: team } = await supabase
            .from('teams')
            .select('*')
            .eq('id', teamId)
            .single();

        if (team && team.needs_approval) {
            io.to(`team_${teamId}`).emit('admin_notification', {
                type: 'JOIN_REQUEST',
                username: username,
                teamName: team.name,
                msg: `學員 ${username} 申請加入您的隊伍，請審核。`,
                roomType: roomType
            });
            io.to(`user_${team.captain}`).emit('join_request_received', {
                username: username,
                teamId: teamId
            });
        } else if (team) {
            socket.emit('join_team_approved', { teamId, teamName: team.name });
        }
    });

    socket.on('create_team_room', (data) => {
        const roomId = data.teamName;
        if (!teamLeaderStates[roomId]) {
            teamLeaderStates[roomId] = {
                leader: data.username,
                auditMode: data.auditMode || 'none',
                members: [data.username]
            }
        }
        socket.join(roomId);
        socket.username = data.username;
        socket.currentRoom = roomId;
        broadcastUpdateRank();
    });

    socket.on('request_join_team', (data) => {
        const roomId = data.teamName;
        const team = teamLeaderStates[roomId];
        const activeTeamData = activeTeams.find(t => t.id === roomId);

        if (!team || !activeTeamData) {
            return socket.emit('join_team_error', { message: '該隊伍不存在或已解散！' });
        }

        const maxMembers = activeTeamData.maxMembers || 4;
        if (team.members.length >= maxMembers) {
            return socket.emit('join_team_error', { message: '隊伍人數已滿，無法加入！' });
        }

        pendingJoinRequestsMap[socket.id] = data.username;
        userToSocketMap[data.username] = socket.id;

        if (team.auditMode === 'leader') {
            const leaderUser = onlineUsers.find(u => u.name === team.leader && u.teamId === roomId);
            if (leaderUser) {
                io.to(leaderUser.id).emit('team_join_request', { 
                    requestUser: data.username,
                    requestSocketId: socket.id 
                });
                socket.emit('waiting_for_approval', { message: '已發送入隊申請，請等待隊長審核...' });
            } else {
                socket.emit('join_team_error', { message: '隊長目前不在教室內，無法審核。' });
            }
        } else {
            if (!team.members.includes(data.username)) {
                team.members.push(data.username);
                broadcastActiveTeams();
            }
            socket.emit('join_team_approved', { teamName: roomId });
        }
    });

    socket.on('cancel_join_request', (data) => {
        if (data.requestSocketId) delete pendingJoinRequestsMap[data.requestSocketId];
        if (data.username) delete userToSocketMap[data.username];
    });

    socket.on('leave_team', (data) => {
        removeUserFromTeam(data.username, data.teamName);
        socket.leave(data.teamName);
    });

    socket.on('reply_join_team', (data) => {
        const targetSocketId = userToSocketMap[data.requestUser] || data.requestSocketId;
        if (data.approved) {
            const team = teamLeaderStates[data.teamName];
            const activeTeamData = activeTeams.find(t => t.id === data.teamName);
            const maxMembers = activeTeamData ? (activeTeamData.maxMembers || 4) : 4;
            if (team && team.members.length >= maxMembers) {
                 socket.emit('admin_action', { type: 'ERROR', content: '隊伍已滿，無法再批准加入！' });
                 return;
            }
            if (team && !team.members.includes(data.requestUser)) {
                team.members.push(data.requestUser);
                broadcastActiveTeams(); 
            }
            const actualRoomType = activeTeamData ? activeTeamData.roomType : data.roomType;
            const actualRealName = activeTeamData ? activeTeamData.name : data.realTeamName;
            if (targetSocketId) {
                io.to(targetSocketId).emit('join_team_approved', { 
                    teamName: data.teamName,
                    realTeamName: actualRealName,
                    targetUser: data.requestUser,
                    roomType: actualRoomType
                });
            } 
            io.emit('join_team_approved_broadcast', {
                 teamName: data.teamName,
                 realTeamName: actualRealName,
                 targetUser: data.requestUser,
                 roomType: actualRoomType
            });
        } else {
            if (targetSocketId) {
                io.to(targetSocketId).emit('join_team_rejected', { message: '隊長拒絕了您的加入申請。', targetUser: data.requestUser });
            }
            io.emit('join_team_rejected_broadcast', {
                 message: '隊長拒絕了您的加入申請。',
                 targetUser: data.requestUser
            });
        }
        if (data.requestSocketId) delete pendingJoinRequestsMap[data.requestSocketId];
        if (data.requestUser) delete userToSocketMap[data.requestUser];
    });

    socket.on('join_team_room', (data) => {
        const roomId = data.teamName;
        const team = teamLeaderStates[roomId];
        if (team && !team.members.includes(data.username)) {
            team.members.push(data.username);
        }
        socket.join(roomId);
        socket.username = data.username;
        socket.currentRoom = roomId;
        io.to(roomId).emit('team_leader_update', { leader: team ? team.leader : null });
        broadcastUpdateRank();
        broadcastActiveTeams();
    });

    socket.on('create_team', (teamData) => {
        teamData.createdAt = Date.now();
        teamData.currentMembers = 1;
        activeTeams.push(teamData);
        teamLeaderStates[teamData.id] = {
            leader: teamData.creator || '匿名使用者',
            auditMode: teamData.auditMode || 'none',
            members: [teamData.creator || '匿名使用者']
        };
        io.emit('update_active_teams', activeTeams);
        broadcastUpdateRank();
    });

    socket.on('request_active_teams', () => {
        socket.emit('update_active_teams', activeTeams);
    });
    
    socket.on('join_room', async (data) => {
        // 🛑 1. 擋下無效的空連線 (防呆機制)
        if (!data || !data.name || data.name === 'undefined') {
            console.log("❌ 攔截到無效連線，略過處理");
            return;
        }

        const username = data.name;
        socket.username = username;

        // ==========================================
        // 🛡️ 2. 核心修正：解決非同步 Race Condition 造成的雙胞胎問題
        // 在等待資料庫(await)前，先【同步】檢查並佔位！
        // ==========================================
        let user = onlineUsers.find(u => u.name === username);
        
        if (!user) {
            // 如果沒找到，先建立一個「佔位符」並同步塞入陣列
            // 這樣即便 0.1 秒後有另一個同名連線進來，也會知道他已經在陣列裡了！
            user = {
                id: socket.id,
                name: username,
                status: 'FOCUSED',
                isPlaceholder: true // 標記為尚未從資料庫讀取完整資料
            };
            onlineUsers.push(user);
        } else {
            // 如果已經在陣列裡，就純粹更新最新的 socket.id 即可，絕不重複 push
            user.id = socket.id;
        }

        // ==========================================
        // 3. 現在可以安心去等資料庫了 (不再怕重複 push)
        // ==========================================
        try {
            const { data: dbUser } = await supabase
                .from('users')
                .select('*')
                .eq('username', username)
                .maybeSingle();

            // 再次從陣列拿出這個 user (確保改到的是陣列裡的同一個物件)
            user = onlineUsers.find(u => u.name === username);
            if (!user) return; 
            
            if (user.isPlaceholder) {
                // 補齊資料
                user.isPlaceholder = false;
                user.teamId = data.teamId || null;
                user.goal = data.goal || '專注學習';
                user.focusMinutes = 0;
                user.score = 0;
                user.integrity_score = dbUser ? (dbUser.integrity_score ?? 100) : 100;
                user.streak = dbUser ? dbUser.streak : 1;
                user.role = dbUser ? dbUser.role : 'student';
                user.isFlipped = globalUserStatus[username] ? !!globalUserStatus[username].isFlipped : false;
                user.isStandalone = globalUserStatus[username] ? !!globalUserStatus[username].isStandalone : false;
                user.roomMode = data.roomMode || '1';
                user.joinTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });
                user.leaveTime = null;
                
                let roomName = "一般自習";
                if (user.roomMode === '2') roomName = "沉浸式";
                else if (user.roomMode === 'simulated') roomName = "模擬教室";
                else if (user.roomMode === '1') roomName = "線上課程";
                
                addTeacherLog(`👤 ${username} 進入了[${roomName}] (誠信分: ${user.integrity_score})`);
                io.emit('community_event', { type: 'ENTER', message: `${username} 進入了自習室。` });
            } else {
                // 如果不是佔位符，代表是重新連線或重複發送
                user.status = 'FOCUSED'; 
                user.leaveTime = null; 
                user.integrity_score = dbUser ? (dbUser.integrity_score ?? 100) : user.integrity_score;
                if (data.roomMode) user.roomMode = data.roomMode;
                if (data.teamId) user.teamId = data.teamId;
                addTeacherLog(`🔄 ${username} 重新連線成功`);
            }

            // 清除之前的斷線計時器
            if (disconnectTimeouts[username]) {
                clearTimeout(disconnectTimeouts[username]);
                delete disconnectTimeouts[username];
            }

            if (globalUserStatus[username]) {
                socket.emit('force_status_sync', { isFlipped: globalUserStatus[username].isFlipped });
                io.emit('update_status', { name: username, isFlipped: globalUserStatus[username].isFlipped });
            }

            socket.join(user.roomMode);
            
            // 廣播最新出席表
            io.emit('update_attendance', onlineUsers);

            // 如果加入的是 VIP 教室，發送課表
            const roomNameParam = data.room || data.roomId || user.roomMode;
            if (roomNameParam && String(roomNameParam).startsWith('VIP-') && tutorSchedules[roomNameParam]) {
                socket.emit('sync_tutor_schedule', tutorSchedules[roomNameParam]);
            }

            broadcastUpdateRank();
            
            // 隊伍邏輯
            if (user.teamId) {
                socket.join(user.teamId);
                const team = teamLeaderStates[user.teamId];
                if (team && !team.members.includes(username)) {
                    team.members.push(username);
                    io.to(user.teamId).emit('team_leader_update', { leader: team.leader });
                }
            }
            broadcastActiveTeams();

        } catch (err) { 
            console.error("Socket 加入房間錯誤:", err); 
        }
    });

    socket.on('update_status', (data) => {
        const { name, isFlipped, isStandalone } = data;
        if (name) {
            if (!globalUserStatus[name]) globalUserStatus[name] = {};
            if (isFlipped !== undefined) globalUserStatus[name].isFlipped = isFlipped;
            if (isStandalone !== undefined) globalUserStatus[name].isStandalone = isStandalone;
            globalUserStatus[name].lastUpdate = Date.now();
        }

        const user = onlineUsers.find(u => u.name === name || u.id === socket.id);
        if (user) {
            const oldStatus = user.status;
            if (isStandalone !== undefined) user.isStandalone = isStandalone;
            if (isFlipped !== undefined) {
                const prevFlipped = user.isFlipped;
                user.isFlipped = isFlipped;
                if (!prevFlipped && user.isFlipped) addTeacherLog(`📱 ${user.name} 已翻轉手機進入深度專注`);
            }
            if (data.status) {
                if (data.status === 'DISTRACTED' && user.isFlipped) user.status = 'FOCUSED';
                else user.status = data.status;
            }
            if (oldStatus !== user.status) {
                if (user.status === 'BREAK') addTeacherLog(`🚽 ${user.name} 申請生理需求 (${data.reason || '未註明'})`);
                else if (user.status === 'DISTRACTED') addTeacherLog(`🚨 ${user.name} 偵測到違規行為`);
            }
        }
        io.emit('update_status', data);
        broadcastUpdateRank();
    });

    socket.on('mobile_sync_update', (data) => {
        io.emit('mobile_sync_update', data);
    });

    // ==========================================
    // 修改後的 report_violation (動態扣分機制)
    // ==========================================
    socket.on('report_violation', async (data) => {
        const user = onlineUsers.find(u => u.name === data.name);
        
        if (!user) return;

        const reasonStr = data.reason || data.type || "";
        const isPhoneInVideo = (reasonStr.includes("手機") || data.type === 'PHONE_IN_VIDEO') && !reasonStr.includes("中斷") && !reasonStr.includes("踢出") && !reasonStr.includes("擅自翻開");
        
        if (user.isFlipped && isPhoneInVideo) {
            return; // 僅針對手機入鏡給予豁免
        }

        let integrityPenalty = 0;
        let expPenalty = 0;

        // 動態判定違規扣除額度
        if (data.type === 'PHONE_IN_VIDEO' || reasonStr.includes("手機")) {
            integrityPenalty = 10; expPenalty = 500;
        } else if (data.type === 'SLEEPING' || reasonStr.includes("睡")) {
            integrityPenalty = 5; expPenalty = 300;
        } else if (data.type === 'LEFT_SEAT' || reasonStr.includes("離座") || reasonStr.includes("離位")) {
            integrityPenalty = 3; expPenalty = 200;
        } else if (data.type === 'TAB_SWITCH' || reasonStr.includes("分頁")) {
            integrityPenalty = 3; expPenalty = 100;
        } else if (data.type === 'FLIP_FAILED') {
            integrityPenalty = 2; expPenalty = 100;
            user.needsKick = true; 
        } else {
            integrityPenalty = 2; expPenalty = 0; 
        }

        // 更新誠信分與經驗值扣除
        user.integrity_score = Math.max(0, user.integrity_score - integrityPenalty);
        user.accumulatedPenaltyExp = (user.accumulatedPenaltyExp || 0) + expPenalty;

        // 寫入資料庫與系統日誌 (這部分不論哪種教室都要執行)
        try {
            await supabase.from('users').update({ integrity_score: user.integrity_score }).eq('username', user.name);
            await supabase.from('violation_history').insert([{ 
                username: user.name, 
                reason: reasonStr, 
                penalty_points: integrityPenalty 
            }]);
            addTeacherLog(`❌ 懲罰: ${user.name} 因 [${reasonStr}] 扣除誠信分 ${integrityPenalty} 點, EXP 扣除 ${expPenalty} 點`);
        } catch (err) { 
            console.error("資料庫同步失敗:", err); 
        }

        // 🚀 核心隔離修正：避免特約教室重複顯示
        // 如果是特約學生，且違規屬於「AI 鏡頭偵測 (離座、趴睡、分心、手機)」
        const isTutor = user.roomMode === 'tutor';
        const isAIViolation = ['PHONE_IN_VIDEO', 'SLEEPING', 'LEFT_SEAT', 'DISTRACTED'].includes(data.type) || 
                              ['手機', '睡', '離座', '離位', '分心'].some(k => reasonStr.includes(k));

        if (isTutor && isAIViolation) {
            broadcastUpdateRank();
            return; // 直接返回，結束處理
        }

        // 以下為一般教室、或特約教室的「純文字違規 (切換分頁)」才會執行的證據流推播
        const newSnap = {
            id: Date.now(),
            name: data.name,
            reason: reasonStr, 
            image: data.image,
            time: new Date().toLocaleTimeString(),
            current_integrity: user.integrity_score
        };
        
        violationSnaps.unshift(newSnap);
        if (violationSnaps.length > 30) violationSnaps.pop();

        io.emit('teacher_update', { logs: teacherLogs, snaps: violationSnaps });
        broadcastUpdateRank();
    });

    socket.on('submit_final_report', (reportData) => {
        io.emit('teacher_receive_report', reportData);
        addTeacherLog(`🏁 結算: ${reportData.name} 已結束自習。專注評分: ${reportData.score} 分。違規: ${reportData.violationCount} 次`);
    });

    socket.on('early_leave', async (data) => {
        const user = onlineUsers.find(u => u.name === data.name);
        if (user) {
            const penalty = 15;
            user.integrity_score = Math.max(0, user.integrity_score - penalty);
            addTeacherLog(`⚠️ 嚴重警告: ${data.name} 惡意早退，誠信分扣除 ${penalty} 分！`);
            try {
                await supabase.from('users').update({ integrity_score: user.integrity_score }).eq('username', data.name);
                await supabase.from('violation_history').insert([{ username: data.name, reason: "🚫 惡意早退", penalty_points: penalty }]);
            } catch(e) { console.error("早退懲罰記錄失敗:", e); }
        }
    });

    socket.on('admin_action', (data) => {
        if (data.target) {
            const targetUser = onlineUsers.find(u => u.name === data.target);
            if (targetUser) {
                io.to(targetUser.roomMode).emit('admin_action', data);
            }
        } else {
            io.emit('admin_action', data);
        }
        if(data.type === 'BLACKBOARD') addTeacherLog(`📢 教師公告：${data.content}`);
    });

    socket.on('send_reaction', (data) => {
        const user = onlineUsers.find(u => u.name === data.username);
        if (user && user.roomMode) {
            io.to(user.roomMode).emit('receive_reaction', data);
        } else {
            io.emit('receive_reaction', data);
        }
    });

    socket.on('community_event', (data) => {
        io.emit('community_event', data);
    });

    socket.on('flip_failed', (data) => {
        io.emit('flip_failed', data);
    });

    // 斷線處理：升級加入特約教室裝置清除邏輯
    socket.on('disconnect', () => {
        const user = onlineUsers.find(u => u.id === socket.id);
        
        // 特約教室裝置清理邏輯
        if (socket.username && tutorRoomSchedules.has(socket.username)) {
            const userDevices = tutorRoomSchedules.get(socket.username);
            if (socket.id === userDevices.pc) userDevices.pc = null;
            if (socket.id === userDevices.mobile) userDevices.mobile = null;
            updateTutorStatus(socket.username, socket.roomId);
        }

        if (user) {
            const username = user.name;
            const userTeamId = user.teamId;

            // [新增] 斷線時立即記錄離開時間並更新狀態為 OFFLINE
            user.leaveTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            user.status = 'OFFLINE';
            io.emit('update_attendance', onlineUsers); // 廣播最新出席列表給教師端

            disconnectTimeouts[username] = setTimeout(() => {
                addTeacherLog(`👋 ${username} 離開了教室`);
                onlineUsers = onlineUsers.filter(u => u.name !== username);
                if (userTeamId) removeUserFromTeam(username, userTeamId);
                
                // [新增] 真正從列表刪除後，再次廣播最新的出席列表
                io.emit('update_attendance', onlineUsers);
                
                broadcastUpdateRank();
                broadcastActiveTeams();
                delete disconnectTimeouts[username];
            }, 30000);
        }
    });
});

function addTeacherLog(msg) {
    const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    teacherLogs.unshift(`[${time}] ${msg}`);
    if (teacherLogs.length > 50) teacherLogs.pop();
    io.emit('teacher_update', { logs: teacherLogs, snaps: violationSnaps });
}

setInterval(() => {
    if (onlineUsers.length > 0) {
        onlineUsers.forEach(user => {
            if (user.status === 'FOCUSED') {
                user.score += 1;
                user.focusMinutes = Math.floor(user.score / 60);
            }
        });
        broadcastUpdateRank();
    }

    // ==========================================
    // [新增] 每秒向所有特約教室推播最新的計時器狀態
    // ==========================================
    if (tutorRoomSettings.size > 0) {
        tutorRoomSettings.forEach((schedule, roomId) => {
            const timeState = getTutorRoomTimeState(roomId);
            if (timeState) {
                // 每秒廣播給該教室內的所有學生
                io.to(roomId).emit('tutor_timer_sync', timeState);
            }
        });
    }

}, 1000);

async function broadcastWeeklyRank() {
    try {
        const { data: topUsers } = await supabase
            .from('users')
            .select('username, total_seconds')
            .order('total_seconds', { ascending: false })
            .limit(5);

        if (topUsers) {
            const rankData = topUsers.map(u => {
                const onlineUser = onlineUsers.find(ou => ou.name === u.username);
                return {
                    name: u.username,
                    weeklyHours: (u.total_seconds || 0) / 3600,
                    status: onlineUser ? (onlineUser.isFlipped ? '深度專注中' : '連線中') : '離線休息中'
                };
            });
            io.emit('update_weekly_rank', rankData);
        }
    } catch (err) { console.error("更新排行榜失敗:", err); }
}
setInterval(broadcastWeeklyRank, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 StudyVerse 核心伺服器啟動！`);
    console.log(`👨‍🏫 管理後端已準備就緒，偵聽端口: ${PORT}`);
    setTimeout(broadcastWeeklyRank, 2000);
});