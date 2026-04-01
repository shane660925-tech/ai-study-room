// 引入環境變數設定 (必須放在最頂端)
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 增加緩衝區大小以支援截圖傳輸
});

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

app.get('/api/user-stats', async (req, res) => {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: '缺少使用者名稱' });

    try {
        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .maybeSingle();

        const { data: records } = await supabase
            .from('focus_records')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({
            user: user || { total_seconds: 0, streak: 1, role: 'student', integrity_score: 100 },
            records: records || []
        });
    } catch (err) {
        console.error("API 錯誤:", err);
        res.status(500).json({ error: '資料庫讀取錯誤' });
    }
});

app.post('/api/save-focus', async (req, res) => {
    const { username, roomType, focusSeconds, comment, score, creditDelta } = req.body;
    if (!username || !roomType || focusSeconds === undefined) {
        return res.status(400).json({ error: '缺少參數' });
    }

    const today = new Date().toISOString().split('T')[0];

    try {
        // Level 1: 手機翻轉模式積分減半機制
        let finalScore = focusSeconds; 
        
        if (roomType === 'flip-mode') {
            finalScore = Math.floor(focusSeconds * 0.5); 
            console.log(`[系統] ${username} 使用手機翻轉模式，原始秒數 ${focusSeconds}，折算積分 ${finalScore}`);
        }

        await supabase.from('focus_records').insert([
            {
                username: username,
                room_type: roomType,
                focus_seconds: finalScore, 
                ai_comment: comment || ""
            }
        ]);

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
                    total_seconds: (user.total_seconds || 0) + finalScore,
                    streak: newStreak,
                    last_login: today,
                    integrity_score: newIntegrity
                })
                .eq('username', username);
                
            console.log(`[系統結算] ${username} 誠信分變動: ${sessionDelta}，目前總分: ${newIntegrity}`);
        } else {
            let initialIntegrity = Math.max(0, Math.min(100, 100 + (creditDelta !== undefined ? Number(creditDelta) : 0)));
            await supabase.from('users').insert([
                { username: username, total_seconds: finalScore, streak: 1, last_login: today, role: 'student', integrity_score: initialIntegrity }
            ]);
        }

        res.json({ message: '儲存成功！', earned: finalScore });
        
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

io.on('connection', (socket) => {
    console.log('🔌 指揮官已連線：', socket.id);

    socket.emit('update_rank', onlineUsers);
    socket.emit('teacher_update', { logs: teacherLogs, snaps: violationSnaps });

    // 修改 server.js 中的 join_team 邏輯
    socket.on('join_team', async (data) => {
        const { teamId, username, roomType } = data;
        
        const { data: team } = await supabase
            .from('teams')
            .select('*')
            .eq('id', teamId)
            .single();

        if (team && team.needs_approval) {
            // 通知隊長 (透過隊伍 ID 頻道發送通知)
            io.to(`team_${teamId}`).emit('admin_notification', {
                type: 'JOIN_REQUEST',
                username: username,
                teamName: team.name,
                msg: `學員 ${username} 申請加入您的隊伍，請審核。`,
                roomType: roomType
            });
            
            // 同時也發給隊長個人
            io.to(`user_${team.captain}`).emit('join_request_received', {
                username: username,
                teamId: teamId
            });
        } else if (team) {
            // 不需審核，直接核准
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
        console.log("收到隊長審核回覆:", data);
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

            // 🚀 關鍵：從伺服器記憶體中直接抓取建立隊伍時的 roomType 和 realName
            const actualRoomType = activeTeamData ? activeTeamData.roomType : data.roomType;
            const actualRealName = activeTeamData ? activeTeamData.name : data.realTeamName;

            if (targetSocketId) {
                io.to(targetSocketId).emit('join_team_approved', { 
                    teamName: data.teamName,
                    realTeamName: actualRealName,
                    targetUser: data.requestUser,
                    roomType: actualRoomType // 確保把正確的教室類型回傳給學生
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

        console.log(`🚩 [新隊伍] ${teamData.name} (${teamData.id}) 已建立。`);
        io.emit('update_active_teams', activeTeams);
        broadcastUpdateRank();
    });

    socket.on('request_active_teams', () => {
        socket.emit('update_active_teams', activeTeams);
    });
    
    socket.on('join_room', async (data) => {
        const username = data.name || '神秘學員';
        socket.username = username; // 將名字綁定到 socket 物件上

        // 重要：當使用者重新進入新房間時，立即檢查他是否有「已翻轉」的紀錄
        if (globalUserStatus[username]) {
            socket.emit('force_status_sync', { isFlipped: globalUserStatus[username].isFlipped });
            // 同步給房間內其他人
            io.emit('update_status', { name: username, isFlipped: globalUserStatus[username].isFlipped });
        }
        
        if (disconnectTimeouts[username]) {
            clearTimeout(disconnectTimeouts[username]);
            delete disconnectTimeouts[username];
        }

        try {
            const { data: dbUser } = await supabase
                .from('users')
                .select('*')
                .eq('username', username)
                .maybeSingle();

            let user = onlineUsers.find(u => u.name === username);
            
            if (!user) {
                user = {
                    id: socket.id,
                    name: username,
                    teamId: data.teamId || null,
                    goal: data.goal || '專注學習',
                    status: 'FOCUSED',
                    focusMinutes: 0,
                    score: 0,
                    integrity_score: dbUser ? (dbUser.integrity_score ?? 100) : 100,
                    streak: dbUser ? dbUser.streak : 1,
                    role: dbUser ? dbUser.role : 'student',
                    isFlipped: globalUserStatus[username] ? !!globalUserStatus[username].isFlipped : false,
                    isStandalone: globalUserStatus[username] ? !!globalUserStatus[username].isStandalone : false, // 🚀 補上這行
                    roomMode: data.roomMode || '1'
                };
                onlineUsers.push(user);
                
                socket.join(user.roomMode);
                
                let roomName = "一般自習";
                if (user.roomMode === '2') roomName = "沉浸式";
                else if (user.roomMode === 'simulated') roomName = "模擬教室";
                else if (user.roomMode === '1') roomName = "線上課程";
                
                addTeacherLog(`👤 ${username} 進入了[${roomName}] (誠信分: ${user.integrity_score})`);
                io.emit('community_event', { type: 'ENTER', message: `${username} 進入了自習室。` });
            } else {
                user.id = socket.id;
                user.integrity_score = dbUser ? (dbUser.integrity_score ?? 100) : user.integrity_score;
                if (data.roomMode) user.roomMode = data.roomMode;
                if (data.teamId) user.teamId = data.teamId;
                
                socket.join(user.roomMode);
                addTeacherLog(`🔄 ${username} 重新連線成功`);
            }
            
            broadcastUpdateRank();
            
            if (user.teamId) {
                socket.join(user.teamId);
                const team = teamLeaderStates[user.teamId];
                if (team) {
                    if (!team.members.includes(username)) {
                        team.members.push(username);
                    }
                    io.to(user.teamId).emit('team_leader_update', { leader: team.leader });
                }
            }
            
            broadcastActiveTeams();

        } catch (err) {
            console.error("Socket 加入房間錯誤:", err);
        }
    });

    // 修改 server.js 的 update_status 邏輯
    socket.on('update_status', (data) => {
        const { name, isFlipped, isStandalone } = data; // 接收 isStandalone
        
        // 紀錄到全域變數中，這樣換頁面後狀態還會在
        if (name) {
            if (!globalUserStatus[name]) globalUserStatus[name] = {};
            if (isFlipped !== undefined) globalUserStatus[name].isFlipped = isFlipped;
            if (isStandalone !== undefined) globalUserStatus[name].isStandalone = isStandalone;
            globalUserStatus[name].lastUpdate = Date.now();
        }

        const user = onlineUsers.find(u => u.name === name || u.id === socket.id);
        if (user) {
            const oldStatus = user.status;
            
            if (isStandalone !== undefined) user.isStandalone = isStandalone; // 更新單機狀態

            if (isFlipped !== undefined) {
                const prevFlipped = user.isFlipped;
                user.isFlipped = isFlipped;
                if (!prevFlipped && user.isFlipped) {
                    addTeacherLog(`📱 ${user.name} 已翻轉手機進入深度專注`);
                }
            }

            if (data.status) {
                if (data.status === 'DISTRACTED' && user.isFlipped) {
                    user.status = 'FOCUSED';
                } else {
                    user.status = data.status;
                }
            }

            if (oldStatus !== user.status) {
                if (user.status === 'BREAK') {
                    addTeacherLog(`🚽 ${user.name} 申請生理需求 (${data.reason || '未註明'})`);
                } else if (user.status === 'DISTRACTED') {
                    addTeacherLog(`🚨 ${user.name} 偵測到違規行為`);
                }
            }
        }
        
        // 廣播給所有人 (包含剛跳轉完的新教室)
        io.emit('update_status', data);
        broadcastUpdateRank();
    });

    socket.on('mobile_sync_update', (data) => {
        io.emit('mobile_sync_update', data);
    });

    socket.on('report_violation', async (data) => {
        const user = onlineUsers.find(u => u.name === data.name);
        if (!user || user.isFlipped) return;

        let penalty = 2;
        if (data.reason.includes("手機")) penalty = 10;
        if (data.reason.includes("睡")) penalty = 5;
        if (data.reason.includes("分頁")) penalty = 3;

        user.integrity_score = Math.max(0, user.integrity_score - penalty);

        const newSnap = {
            id: Date.now(),
            name: data.name,
            reason: data.reason,
            image: data.image,
            time: new Date().toLocaleTimeString(),
            current_integrity: user.integrity_score
        };
        violationSnaps.unshift(newSnap);
        if (violationSnaps.length > 30) violationSnaps.pop();

        try {
            await supabase.from('users').update({ integrity_score: user.integrity_score }).eq('username', user.name);
            await supabase.from('violation_history').insert([{ username: user.name, reason: data.reason, penalty_points: penalty }]);
            addTeacherLog(`❌ 懲罰: ${user.name} 因 [${data.reason}] 扣除 ${penalty} 分 (剩餘: ${user.integrity_score})`);
        } catch (err) { console.error("資料庫同步失敗:", err); }

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

    socket.on('disconnect', () => {
        const user = onlineUsers.find(u => u.id === socket.id);
        if (user) {
            const username = user.name;
            const userTeamId = user.teamId;

            disconnectTimeouts[username] = setTimeout(() => {
                addTeacherLog(`👋 ${username} 離開了教室`);
                onlineUsers = onlineUsers.filter(u => u.name !== username);
                
                if (userTeamId) {
                    removeUserFromTeam(username, userTeamId);
                }

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
    } catch (err) {
        console.error("更新排行榜失敗:", err);
    }
}
setInterval(broadcastWeeklyRank, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 StudyVerse 核心伺服器啟動！`);
    console.log(`👨‍🏫 管理後端已準備就緒，偵聽端口: ${PORT}`);
    
    setTimeout(broadcastWeeklyRank, 2000);
});