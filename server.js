// 引入環境變數設定 (必須放在最頂端)
require('dotenv').config();

const express = require('express');
const axios = require('axios'); // [新增] 用來發送 LINE API 請求
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const ScoringService = require('./ScoringService');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

// 動態判斷網址 (本地端 vs 正式上線端)
const GOOGLE_CALLBACK_URL = process.env.NODE_ENV === 'production'
    ? 'https://study-universe.onrender.com/api/auth/google/callback'
    : 'http://localhost:3000/api/auth/google/callback';

const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL
);

const app = express();
const server = http.createServer(app);
// 👇 [新增] 允許 Google Meet 跨網域發送背景報到 API (CORS 設定)
// [修改] server.js 
// 尋找原本的 app.use((req, res, next) => { ... }) 區塊，替換成以下內容：

app.use((req, res, next) => {
    // 允許跨網域請求
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // 👇 [關鍵修改] 允許被 Chrome Extension 嵌入
    // 移除預設的拒絕嵌入標頭
    res.removeHeader('X-Frame-Options'); 
    
    // 設定 CSP 允許來自任何地方的嵌入 (或是指定 chrome-extension:// 協議)
    // 這裡為了相容性先設為允許所有，若要更嚴謹可限制來源
    res.header('Content-Security-Policy', "frame-ancestors *;"); 
    
    next();
});

// ==========================================
// 單裝置登入：目前有效 socket 管理
// ==========================================
const activeUserSockets = new Map();

// 👆 ----------------------------------------------------
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 增加緩衝區大小以支援截圖傳輸
});

// --- 這裡就是載入你放在資料夾裡的邏輯 ---
const registerRoomHandler = require('./sockets/roomHandler');
registerRoomHandler(io); 
// ------------------------------------

// 儲存各個特約教室的專屬課表
const tutorSchedules = {};

// 提高 JSON 限制以接收 Base64 截圖
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. 連線 Supabase 雲端資料庫
// ==========================================
// 加上 .trim() 預防不小心從 .env 讀取到頭尾的空白或換行符號
const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const supabaseKey = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ 錯誤：找不到 Supabase 設定，請檢查 .env 檔案！');
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ 已成功載入 Supabase 雲端資料庫設定。');

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

// ==========================================
// [新增功能] 產生 6 位數唯一且不可重複的代碼
// ==========================================
async function generateUniqueLinkCode() {
    let code;
    let isUnique = false;
    while (!isUnique) {
        // 產生 100000 ~ 999999 的隨機數
        code = Math.floor(100000 + Math.random() * 900000).toString();
        // 檢查資料庫是否已存在
        const { data } = await supabase.from('users').select('link_code').eq('link_code', code).maybeSingle();
        if (!data) isUnique = true;
    }
    return code;
}

async function generateUniqueLineBindToken() {
    let token;
    let isUnique = false;

    while (!isUnique) {
        token = crypto.randomBytes(24).toString('hex');

        const { data } = await supabase
            .from('users')
            .select('line_bind_token')
            .eq('line_bind_token', token)
            .maybeSingle();

        if (!data) isUnique = true;
    }

    return token;
}

async function generateUniqueLineBindShortCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    let isUnique = false;

    while (!isUnique) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }

        const { data } = await supabase
            .from('users')
            .select('line_bind_short_code')
            .eq('line_bind_short_code', code)
            .maybeSingle();

        if (!data) isUnique = true;
    }

    return code;
}
// ==========================================
// 2. API 路由設定
// ==========================================

// ==========================================
// Admin Panel API - Platform Admin
// ==========================================

async function verifyAdmin(req, res, next) {
    const adminUsername =
        req.query.adminUsername ||
        req.body.adminUsername ||
        req.headers['x-admin-username'];

    if (!adminUsername) {
        return res.status(401).json({ error: '缺少 adminUsername' });
    }

    try {
        const { data: adminUser, error } = await supabase
            .from('users')
            .select('username, role, is_blocked')
            .eq('username', adminUsername)
            .maybeSingle();

        if (error) throw error;

        if (!adminUser) {
            return res.status(404).json({ error: '找不到管理員帳號' });
        }

        if (adminUser.is_blocked) {
            return res.status(403).json({ error: '此管理員帳號已被停用' });
        }

        if (adminUser.role !== 'admin') {
            return res.status(403).json({ error: '權限不足，僅限平台管理員' });
        }

        req.adminUser = adminUser;
        next();

    } catch (err) {
        console.error('Admin 權限驗證失敗:', err);
        res.status(500).json({ error: 'Admin 權限驗證失敗' });
    }
}

async function createNotification({
    username,
    type,
    title,
    message
}) {
    if (!username || !type || !title || !message) {
        console.warn('⚠️ createNotification 缺少必要欄位', {
            username,
            type,
            title,
            message
        });
        return null;
    }

    const { data, error } = await supabase
        .from('notifications')
        .insert([{
            username,
            type,
            title,
            message,
            is_read: false,
            created_at: new Date().toISOString()
        }])
        .select()
        .single();

    if (error) {
        console.error('❌ 通知寫入失敗:', error);
        throw error;
    }

    console.log('✅ 通知已寫入:', data);
    return data;
}

// 檢查目前登入者是否為 admin
app.get('/api/admin/me', verifyAdmin, async (req, res) => {
    res.json({
        message: 'Admin 驗證成功',
        admin: req.adminUser
    });
});

// 取得會員列表
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
    const keyword = req.query.keyword || '';

    try {
        let query = supabase
            .from('users')
            .select(`
    username,
    account,
    role,
    total_seconds,
    streak,
    last_login,
    integrity_score,
    bound_line_ids,
    has_seen_intro,
    privacy_consent_at,
    privacy_consent_version,
    is_blocked,
    teacher_status,
    violation_count,
    updated_at,

    teacher_subject,
    teacher_intro,
    teacher_apply_at,
    teacher_reviewed_at,
    teacher_review_note
`)
            .order('username', { ascending: true });

        if (keyword) {
            query = query.or(
                `username.ilike.%${keyword}%,account.ilike.%${keyword}%`
            );
        }

        const { data, error } = await query;
        if (error) throw error;

        const users = (data || []).map(user => ({
            ...user,
            line_bound: !!user.bound_line_ids,
            total_minutes: Math.floor((user.total_seconds || 0) / 60)
        }));

        res.json({ users });

    } catch (err) {
        console.error('取得會員列表失敗:', err);
        res.status(500).json({ error: '取得會員列表失敗' });
    }
});

// 更新會員狀態 / role / 教師資格
app.patch('/api/admin/users/:username', verifyAdmin, async (req, res) => {
    const targetUsername = req.params.username;

    const {
    role,
    is_blocked,
    teacher_status,
    violation_count,
    teacher_review_note
} = req.body;

    const updates = {
        updated_at: new Date().toISOString()
    };

    if (role !== undefined) updates.role = role;
    if (is_blocked !== undefined) updates.is_blocked = !!is_blocked;
    if (teacher_status !== undefined) updates.teacher_status = teacher_status;
    if (violation_count !== undefined) updates.violation_count = Number(violation_count) || 0;

    if (teacher_review_note !== undefined) updates.teacher_review_note = teacher_review_note;

if (teacher_status === 'approved' || teacher_status === 'rejected') {
    updates.teacher_reviewed_at = new Date().toISOString();
}

    try {
        if (targetUsername === req.adminUser.username && updates.is_blocked === true) {
            return res.status(400).json({ error: '不能封鎖自己的管理員帳號' });
        }

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('username', targetUsername)
            .select(`
                username,
                account,
                role,
                is_blocked,
                teacher_status,
                violation_count,
                updated_at
            `)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: '找不到目標會員' });

        if (teacher_status === 'approved') {
    await createNotification({
        username: targetUsername,
        type: 'teacher_approved',
        title: '教師申請已通過',
        message: '恭喜！你的教師資格已通過審核，現在可以建立特約教師教室。'
    });
}

if (teacher_status === 'rejected') {
    const reason = teacher_review_note
        ? `原因：${teacher_review_note}`
        : '你可以修改申請資料後再次送出。';

    await createNotification({
        username: targetUsername,
        type: 'teacher_rejected',
        title: '教師申請未通過',
        message: `你的教師資格申請未通過。${reason}`
    });
}

        res.json({
            message: '會員資料已更新',
            user: data
        });

    } catch (err) {
        console.error('更新會員失敗:', err);
        res.status(500).json({ error: '更新會員失敗' });
    }
});

// 刪除會員
app.delete('/api/admin/users/:username', verifyAdmin, async (req, res) => {
    const targetUsername = req.params.username;

    if (targetUsername === req.adminUser.username) {
        return res.status(400).json({ error: '不能刪除自己的管理員帳號' });
    }

    try {
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('username', targetUsername);

        if (error) throw error;

        res.json({ message: '會員已刪除', username: targetUsername });

    } catch (err) {
        console.error('刪除會員失敗:', err);
        res.status(500).json({ error: '刪除會員失敗，可能仍有學習紀錄關聯' });
    }
});

// 取得主題教室列表
app.get('/api/admin/theme-rooms', verifyAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('theme_rooms')
            .select('*')
            .order('sort_order', { ascending: true });

        if (error) throw error;

        res.json({ rooms: data || [] });

    } catch (err) {
        console.error('取得後台主題教室失敗:', err);
        res.status(500).json({ error: '取得後台主題教室失敗' });
    }
});

// 新增主題教室
app.post('/api/admin/theme-rooms', verifyAdmin, async (req, res) => {
    const {
        name,
        slug,
        description,
        room_page,
        starts_at,
        ends_at,
        is_active,
        sort_order,
        badge_text,
        theme_color
    } = req.body;

    if (!name || !slug) {
        return res.status(400).json({ error: '缺少 name 或 slug' });
    }

    try {
        const { data, error } = await supabase
            .from('theme_rooms')
            .insert([{
                name,
                slug,
                description: description || null,
                room_page: room_page || 'managed-room.html',
                starts_at: starts_at || null,
                ends_at: ends_at || null,
                is_active: is_active !== undefined ? !!is_active : true,
                sort_order: Number(sort_order) || 0,
                badge_text: badge_text || null,
                theme_color: theme_color || 'blue'
            }])
            .select()
            .single();

        if (error) throw error;

        res.json({
            message: '主題教室已新增',
            room: data
        });

    } catch (err) {
        console.error('新增主題教室失敗:', err);
        res.status(500).json({ error: '新增主題教室失敗，slug 可能已存在' });
    }
});

// 修改主題教室
app.patch('/api/admin/theme-rooms/:id', verifyAdmin, async (req, res) => {
    const id = req.params.id;

    const allowedFields = [
        'name',
        'slug',
        'description',
        'room_page',
        'starts_at',
        'ends_at',
        'is_active',
        'sort_order',
        'badge_text',
        'theme_color'
    ];

    const updates = {};

    allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    });

    if (updates.sort_order !== undefined) {
        updates.sort_order = Number(updates.sort_order) || 0;
    }

    if (updates.is_active !== undefined) {
        updates.is_active = !!updates.is_active;
    }

    try {
        const { data, error } = await supabase
            .from('theme_rooms')
            .update(updates)
            .eq('id', id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: '找不到主題教室' });

        res.json({
            message: '主題教室已更新',
            room: data
        });

    } catch (err) {
        console.error('修改主題教室失敗:', err);
        res.status(500).json({ error: '修改主題教室失敗' });
    }
});

// 學習紀錄中心
app.get('/api/admin/focus-records', verifyAdmin, async (req, res) => {
    const username = req.query.username || null;

    try {
        let query = supabase
            .from('focus_records')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200);

        if (username) {
            query = query.eq('username', username);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json({ records: data || [] });

    } catch (err) {
        console.error('取得學習紀錄失敗:', err);
        res.status(500).json({ error: '取得學習紀錄失敗' });
    }
});

// 後台總覽統計
app.get('/api/admin/overview', verifyAdmin, async (req, res) => {
    try {
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('username, role, total_seconds, integrity_score, is_blocked, teacher_status, violation_count');

        if (usersError) throw usersError;

        const { data: records, error: recordsError } = await supabase
            .from('focus_records')
            .select('focus_seconds, integrity_score, earned_exp');

        if (recordsError) throw recordsError;

        const totalUsers = users.length;
        const blockedUsers = users.filter(u => u.is_blocked).length;
        const teacherCount = users.filter(u => u.role === 'teacher').length;
        const pendingTeachers = users.filter(u => u.teacher_status === 'pending').length;

        const totalFocusSeconds = records.reduce((sum, r) => sum + (r.focus_seconds || 0), 0);
        const totalExp = records.reduce((sum, r) => sum + (r.earned_exp || 0), 0);

        const validScores = records
            .map(r => r.integrity_score)
            .filter(score => score !== null && score !== undefined);

        const avgIntegrity =
            validScores.length > 0
                ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
                : 100;

        res.json({
            totalUsers,
            blockedUsers,
            teacherCount,
            pendingTeachers,
            totalFocusSeconds,
            totalFocusMinutes: Math.floor(totalFocusSeconds / 60),
            totalExp,
            avgIntegrity
        });

    } catch (err) {
        console.error('取得後台總覽失敗:', err);
        res.status(500).json({ error: '取得後台總覽失敗' });
    }
});

// --- [新增] 註冊 API ---
app.post('/api/register', async (req, res) => {
    const { username, account, password } = req.body;
    
    console.log("🚀 收到註冊請求:", { username, account, password });

    if (!username || !account || !password) {
        return res.status(400).json({ error: '缺少註冊參數' });
    }

    try {
        const { data: existingAccount } = await supabase.from('users').select('account').eq('account', account).maybeSingle();
        if (existingAccount) return res.status(400).json({ error: '此帳號已被註冊！' });

        const { data: existingUser } = await supabase.from('users').select('username').eq('username', username).maybeSingle();
        if (existingUser) return res.status(400).json({ error: '此暱稱已有人使用，請換一個！' });

        const today = new Date().toISOString().split('T')[0];
        
        // --- [新增] 註冊時產生代碼 ---
        const newLinkCode = await generateUniqueLinkCode();

        const { error } = await supabase.from('users').insert([{ 
            username: String(username), 
            account: String(account),
            password: String(password),
            total_seconds: 0, 
            streak: 1, 
            last_login: today, 
            role: 'student', 
            integrity_score: 100,
            link_code: newLinkCode // [新增欄位]
        }]);

        if (error) throw error;
        res.json({ message: '註冊成功！', username: username });
    } catch (err) {
        console.error("註冊失敗:", err);
        res.status(500).json({ error: '系統註冊失敗，請稍後再試。' });
    }
});

// ==========================================
// 教師註冊 / 教師申請
// ==========================================
app.post('/api/teacher/register', async (req, res) => {

    try {

        const {
            username,
            email,
            account,
            password,
            teacherType,
            classroomSize,
            courseInfo,
            courseSchedule
        } = req.body;

        // 基本檢查
        if (
            !username ||
            !email ||
            !account ||
            !password ||
            !teacherType ||
            !courseInfo ||
            !courseSchedule
        ) {
            return res.status(400).json({
                error: '請完整填寫教師申請資料'
            });
        }

        // 檢查帳號是否已存在
        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('account', account)
            .maybeSingle();

        if (existingUser) {
            return res.status(400).json({
                error: '此帳號已被使用'
            });
        }

        // 產生 sessionId
        const sessionId = crypto.randomUUID();

        // 建立 users
        const { error: userError } = await supabase
            .from('users')
            .insert({
                username,
                account,
                password,
                role: 'teacher_pending',

                email,

                teacher_application_status: 'pending',
                teacher_type: teacherType,
                classroom_size: classroomSize,

                current_session_id: sessionId,
                last_login_at: new Date().toISOString(),
                last_active_at: new Date().toISOString()
            });

        if (userError) {
            console.error('建立教師 users 失敗:', userError);

            return res.status(500).json({
                error: '建立教師帳號失敗'
            });
        }

        // 建立 teacher_applications
        const { error: applicationError } = await supabase
            .from('teacher_applications')
            .insert({
                username,
                email,

                teacher_type: teacherType,
                classroom_size: classroomSize,

                course_info: courseInfo,
                course_schedule: courseSchedule,

                status: 'pending'
            });

        if (applicationError) {

            console.error(
                '建立 teacher_applications 失敗:',
                applicationError
            );

            return res.status(500).json({
                error: '建立教師申請失敗'
            });
        }

        return res.json({
            success: true,
            message: '教師申請已送出，請等待管理員審核'
        });

    } catch (err) {

        console.error('教師註冊 API 錯誤:', err);

        return res.status(500).json({
            error: '伺服器錯誤'
        });
    }
});

app.post('/api/teacher/oauth-apply', async (req, res) => {
    try {
        const {
            username,
            email,
            teacherType,
            classroomSize,
            courseInfo,
            courseSchedule
        } = req.body;

        if (!username || !email || !teacherType || !courseInfo || !courseSchedule) {
            return res.status(400).json({
                error: '缺少教師申請資料'
            });
        }

        const { data: user, error: findError } = await supabase
            .from('users')
            .select('username, role')
            .eq('username', username)
            .maybeSingle();

        if (findError) throw findError;

        if (!user) {
            return res.status(404).json({
                error: '找不到 OAuth 登入使用者'
            });
        }

        await supabase
    .from('users')
    .update({

        // 使用教師填寫名稱覆蓋 Google 名稱
        username,

        email,
        role: 'teacher_pending',
        teacher_application_status: 'pending',
        teacher_type: teacherType,
        classroom_size: classroomSize
    })
            .eq('username', username);

        const { error: applicationError } = await supabase
            .from('teacher_applications')
            .insert({
                username,
                email,
                teacher_type: teacherType,
                classroom_size: classroomSize,
                course_info: courseInfo,
                course_schedule: courseSchedule,
                status: 'pending'
            });

        if (applicationError) throw applicationError;

        res.json({
            success: true,
            message: '教師 OAuth 申請已送出'
        });

    } catch (err) {
        console.error('教師 OAuth 申請失敗:', err);
        res.status(500).json({
            error: '教師 OAuth 申請失敗'
        });
    }
});

// --- [新增] 登入 API ---
app.post('/api/login', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '請輸入帳號密碼' });

    try {
        const { data: user, error } = await supabase.from('users').select('*').eq('account', account).eq('password', password).maybeSingle();
        if (error || !user) return res.status(401).json({ error: '帳號或密碼錯誤！' });

        if (user.is_blocked) {
    return res.status(403).json({
        error: '此帳號已被平台停用，請聯繫管理員。'
    });
}

        // --- [新增] 舊用戶若無代碼則自動補發 ---
        if (!user.link_code) {
            const newLinkCode = await generateUniqueLinkCode();
            await supabase.from('users').update({ link_code: newLinkCode }).eq('username', user.username);
        }

        const sessionId = generateSessionId();

const { error: sessionUpdateError } = await supabase
    .from('users')
    .update({
        current_session_id: sessionId,
        last_login_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
    })
    .eq('username', user.username);

if (sessionUpdateError) {
    console.error('更新 session 失敗:', sessionUpdateError);
    return res.status(500).json({ error: '登入 session 建立失敗' });
}

res.json({
    message: '登入成功！',
    username: user.username,
    role: user.role || 'student',
    sessionId
});
    } catch (err) {
        console.error("登入失敗:", err); // 保留你的 log
        res.status(500).json({ error: '系統登入失敗，請稍後再試。' });
    }
});

// --- 檢查使用者狀態 API ---
app.get('/api/auth/check-user', async (req, res) => {
    const username = req.query.username;

    if (!username) {
        return res.status(400).json({
            ok: false,
            error: '缺少 username'
        });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('username, role, is_blocked, has_seen_intro, privacy_consent_at, teacher_status')
            .eq('username', username)
            .maybeSingle();

        if (error) throw error;

        if (!user) {
            return res.status(404).json({
                ok: false,
                error: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                ok: false,
                blocked: true,
                error: '此帳號已被平台停用，請聯繫管理員。'
            });
        }

        res.json({
            ok: true,
            blocked: false,
            user
        });

    } catch (err) {
        console.error('檢查使用者狀態失敗:', err);
        res.status(500).json({
            ok: false,
            error: '檢查使用者狀態失敗'
        });
    }
});

// --- 單裝置登入：session 驗證 API ---
app.get('/api/auth/session-check', async (req, res) => {
    const { username, sessionId } = req.query;

    if (!username || !sessionId) {
        return res.status(400).json({
            ok: false,
            message: '缺少 username 或 sessionId'
        });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('username, current_session_id, is_blocked')
            .eq('username', username)
            .maybeSingle();

        if (error) throw error;

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                ok: false,
                message: '此帳號已被平台停用'
            });
        }

        if (user.current_session_id !== sessionId) {
            return res.json({
                ok: false,
                forceLogout: true,
                message: '此帳號已在其他裝置登入，請重新登入'
            });
        }

        await supabase
            .from('users')
            .update({
                last_active_at: new Date().toISOString()
            })
            .eq('username', username);

        res.json({
            ok: true
        });

    } catch (err) {
        console.error('session 驗證失敗:', err);
        res.status(500).json({
            ok: false,
            message: 'session 驗證失敗'
        });
    }
});

// --- 取得站內通知 API ---
app.get('/api/notifications', async (req, res) => {
    const username = req.query.username;

    if (!username) {
        return res.status(400).json({ error: '缺少 username' });
    }

    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('id, username, type, title, message, is_read, created_at')
            .eq('username', username)
            .order('created_at', { ascending: false })
            .limit(30);

        if (error) throw error;

        res.json({
            notifications: data || []
        });

    } catch (err) {
        console.error('取得通知失敗:', err);
        res.status(500).json({ error: '取得通知失敗' });
    }
});

// --- 標記站內通知已讀 API ---
app.post('/api/notifications/read', async (req, res) => {
    const { notificationId } = req.body;

    if (!notificationId) {
        return res.status(400).json({ error: '缺少 notificationId' });
    }

    try {
        const { data, error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notificationId)
            .select()
            .maybeSingle();

        if (error) throw error;

        res.json({
            message: '通知已標記為已讀',
            notification: data
        });

    } catch (err) {
        console.error('標記通知已讀失敗:', err);
        res.status(500).json({ error: '標記通知已讀失敗' });
    }
});

// --- 教師申請 API ---
app.post('/api/teacher/apply', async (req, res) => {
    const {
        username,
        teacher_subject,
        teacher_intro
    } = req.body;

    if (!username || !teacher_subject || !teacher_intro) {
        return res.status(400).json({
            error: '請填寫完整教師申請資料'
        });
    }

    try {
        const { data: user, error: findError } = await supabase
            .from('users')
            .select('username, role, is_blocked, teacher_status')
            .eq('username', username)
            .maybeSingle();

        if (findError) throw findError;

        if (!user) {
            return res.status(404).json({ error: '找不到使用者' });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: '此帳號已被停用，無法申請教師資格' });
        }

        if (user.role === 'teacher' && user.teacher_status === 'approved') {
            return res.status(400).json({ error: '你已經是通過審核的教師' });
        }

        const { data, error } = await supabase
            .from('users')
            .update({
                teacher_status: 'pending',
                teacher_subject,
                teacher_intro,
                teacher_apply_at: new Date().toISOString(),
                teacher_reviewed_at: null,
                teacher_review_note: null
            })
            .eq('username', username)
            .select('username, teacher_status, teacher_subject, teacher_intro, teacher_apply_at')
            .maybeSingle();

        if (error) throw error;

        res.json({
            message: '教師申請已送出，請等待平台管理員審核',
            application: data
        });

    } catch (err) {
        console.error('教師申請失敗:', err);
        res.status(500).json({ error: '教師申請失敗' });
    }
});

// --- 隱私與學習監測同意 API ---
app.post('/api/privacy-consent', async (req, res) => {
    const { username, version } = req.body;

    if (!username || !version) {
        return res.status(400).json({ error: '缺少 username 或 version' });
    }

    try {
        const { data: user, error: findError } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .maybeSingle();

        if (findError) throw findError;

        if (!user) {
            return res.status(404).json({ error: '找不到使用者' });
        }

        const { error: updateError } = await supabase
            .from('users')
            .update({
                privacy_consent_at: new Date().toISOString(),
                privacy_consent_version: version
            })
            .eq('username', username);

        if (updateError) throw updateError;

        res.json({
            message: '隱私與學習監測同意已記錄',
            username,
            version
        });

    } catch (err) {
        console.error('隱私同意紀錄失敗:', err);
        res.status(500).json({ error: '隱私同意紀錄失敗' });
    }
});

// --- 新手導覽完成 API ---
app.post('/api/intro-complete', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ error: '缺少 username' });
    }

    try {
        const { error } = await supabase
            .from('users')
            .update({
                has_seen_intro: true
            })
            .eq('username', username);

        if (error) throw error;

        res.json({
            message: '新手導覽已完成',
            username
        });

    } catch (err) {
        console.error('新手導覽完成紀錄失敗:', err);
        res.status(500).json({ error: '新手導覽完成紀錄失敗' });
    }
});

// ==========================================
// Course MVP API - 一個課程一個 roomCode
// ==========================================

async function generateUniqueCourseRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    let isUnique = false;

    while (!isUnique) {
        code = 'SV-';

        for (let i = 0; i < 5; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }

        const { data, error } = await supabase
            .from('courses')
            .select('id')
            .eq('course_room_code', code)
            .maybeSingle();

        if (error) throw error;
        if (!data) isUnique = true;
    }

    return code;
}

// 建立課程
app.post('/api/courses/create', async (req, res) => {
    const {
        teacherUsername,
        courseName,
        subject,
        intro,
        weeklyDay,
        startTime,
        startDate,
        endDate
    } = req.body;

    if (!teacherUsername || !courseName) {
        return res.status(400).json({
            error: '缺少 teacherUsername 或 courseName'
        });
    }

    try {
        const { data: teacher, error: teacherError } = await supabase
            .from('users')
            .select('username, role, is_blocked')
            .eq('username', teacherUsername)
            .maybeSingle();

        if (teacherError) throw teacherError;

        if (!teacher) {
            return res.status(404).json({ error: '找不到教師帳號' });
        }

        if (teacher.is_blocked) {
            return res.status(403).json({ error: '此帳號已被停用，無法建立課程' });
        }

        if (teacher.role !== 'teacher' && teacher.role !== 'admin') {
            return res.status(403).json({ error: '只有教師可以建立課程' });
        }

        const courseRoomCode = await generateUniqueCourseRoomCode();

        const { data: course, error } = await supabase
            .from('courses')
            .insert([{
                teacher_username: teacherUsername,
                course_name: courseName,
                subject: subject || null,
                intro: intro || null,
                course_type: 'studyverse_room',
                weekly_day: weeklyDay || null,
                start_time: startTime || null,
                start_date: startDate || null,
                end_date: endDate || null,
                course_room_code: courseRoomCode,
                status: 'active',
                is_public: false,
                price: 0,
                commission_rate: 0,
                enrolled_count: 0
            }])
            .select()
            .single();

        if (error) throw error;

        res.json({
            message: '課程建立成功',
            course
        });

    } catch (err) {
        console.error('建立課程失敗:', err);
        res.status(500).json({
            error: '建立課程失敗',
            detail: err.message
        });
    }
});

// 取得某位教師自己的課程
app.get('/api/courses/my', async (req, res) => {
    const teacherUsername = req.query.teacherUsername || req.query.username;

    if (!teacherUsername) {
        return res.status(400).json({ error: '缺少 teacherUsername' });
    }

    try {
        const { data: courses, error } = await supabase
            .from('courses')
            .select('*')
            .eq('teacher_username', teacherUsername)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            courses: courses || []
        });

    } catch (err) {
        console.error('取得教師課程失敗:', err);
        res.status(500).json({
            error: '取得教師課程失敗',
            detail: err.message
        });
    }
});

// 用課程代碼查課程
app.get('/api/courses/by-code/:courseRoomCode', async (req, res) => {
    const courseRoomCode = String(req.params.courseRoomCode || '').trim().toUpperCase();

    if (!courseRoomCode) {
        return res.status(400).json({ error: '缺少 courseRoomCode' });
    }

    try {
        const { data: course, error } = await supabase
            .from('courses')
            .select('*')
            .eq('course_room_code', courseRoomCode)
            .eq('status', 'active')
            .maybeSingle();

        if (error) throw error;

        if (!course) {
            return res.status(404).json({ error: '找不到此課程代碼' });
        }

        res.json({
            course
        });

    } catch (err) {
        console.error('查詢課程代碼失敗:', err);
        res.status(500).json({
            error: '查詢課程代碼失敗',
            detail: err.message
        });
    }
});

// --- 主題教室列表 API ---
app.get('/api/theme-rooms', async (req, res) => {
    try {
        const now = new Date().toISOString();

        const { data, error } = await supabase
            .from('theme_rooms')
            .select('*')
            .eq('is_active', true)
            .or(`starts_at.is.null,starts_at.lte.${now}`)
            .or(`ends_at.is.null,ends_at.gte.${now}`)
            .order('sort_order', { ascending: true });

        if (error) throw error;

        const roomsWithCount = (data || []).map(room => {
            const themeRoomMode = `theme:${room.slug}`;

            const onlineCount = onlineUsers.filter(user =>
                user.roomMode === themeRoomMode &&
                user.status !== 'OFFLINE'
            ).length;

            return {
                ...room,
                online_count: onlineCount
            };
        });

        res.json({
            rooms: roomsWithCount
        });

    } catch (err) {
        console.error('取得主題教室失敗:', err);
        res.status(500).json({ error: '取得主題教室失敗' });
    }
});

app.get('/api/line-bind-info', async (req, res) => {
    const username = req.query.username;

    if (!username) {
        return res.status(400).json({ error: '缺少 username' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('username, line_bind_token, line_bind_short_code')
            .eq('username', username)
            .maybeSingle();

        if (error) throw error;
        if (!user) return res.status(404).json({ error: '找不到使用者' });

        let token = user.line_bind_token;
        let shortCode = user.line_bind_short_code;

        const updates = {};

if (!token) {
    token = await generateUniqueLineBindToken();
    updates.line_bind_token = token;
    updates.line_bind_token_created_at = new Date().toISOString();
}

if (!shortCode) {
    shortCode = await generateUniqueLineBindShortCode();
    updates.line_bind_short_code = shortCode;
}

if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
        .from('users')
        .update(updates)
        .eq('username', username);

    if (updateError) throw updateError;
}

        const publicBaseUrl =
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;

const bindUrl =
    `${publicBaseUrl}/line-bind.html?token=${encodeURIComponent(token)}`;

        res.json({
    username,
    token,
    shortCode,
    bindUrl,
    lineOfficialUrl: 'https://lin.ee/VvxVzKT'
});

    } catch (err) {
        console.error('取得 LINE 綁定資訊失敗:', err);
        res.status(500).json({ error: '取得 LINE 綁定資訊失敗' });
    }
});

app.get('/api/line/auto-bind', async (req, res) => {
    const token = req.query.token;

    if (!token) {
        return res.status(400).send('缺少 token');
    }

    const state = encodeURIComponent(token);

    const lineLoginUrl =
`https://access.line.me/oauth2/v2.1/authorize
?response_type=code
&client_id=${process.env.LINE_CHANNEL_ID}
&redirect_uri=${encodeURIComponent(process.env.LINE_CALLBACK_URL)}
&state=${state}
&scope=profile%20openid`
.replace(/\n/g, '');

    res.redirect(lineLoginUrl);
});
// ==========================================
// [新增] Google OAuth 登入路由 (保持原有功能)
// ==========================================
app.get('/api/auth/google', (req, res) => {

    const role = req.query.role || 'student';

    const url = googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['email', 'profile'],
        redirect_uri: GOOGLE_CALLBACK_URL,

        // 👇 關鍵
        state: role
    });

    console.log('🔗 Google OAuth role:', role);

    res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('❌ 缺少授權碼');

    try {
        const { tokens } = await googleClient.getToken({
            code: code,
            redirect_uri: GOOGLE_CALLBACK_URL
        });

        googleClient.setCredentials(tokens);

        const ticket = await googleClient.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        let { data: user, error: findError } = await supabase
            .from('users')
            .select('*')
            .eq('account', email)
            .maybeSingle();

        if (findError) throw findError;

        if (!user) {
            let finalName = name || 'Google學員';

            const { data: nameCheck } = await supabase
                .from('users')
                .select('username')
                .eq('username', finalName)
                .maybeSingle();

            if (nameCheck) finalName += Math.floor(Math.random() * 1000);

            const newLinkCode = await generateUniqueLinkCode();

            const { data: newUser, error: insErr } = await supabase
                .from('users')
                .insert([{
                    username: String(finalName),
                    account: String(email),
                    password: String(googleId),
                    total_seconds: 0,
                    streak: 1,
                    last_login: new Date().toISOString().split('T')[0],
                    role: state === 'teacher_apply'
    ? 'teacher_pending'
    : 'student',
                    integrity_score: 100,
                    link_code: newLinkCode
                }])
                .select()
                .single();

            if (insErr) throw insErr;
            user = newUser;
        }

        console.log('🔐 Google 登入使用者檢查:', {
            username: user.username,
            account: user.account,
            is_blocked: user.is_blocked
        });

        if (user.is_blocked === true) {
            return res.status(403).send(`
                <html>
                    <body style="background:#05070a;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
                        <div>
                            <h1>帳號已停用</h1>
                            <p>此帳號已被平台停用，請聯繫管理員。</p>
                            <a href="/" style="color:#60a5fa;">返回首頁</a>
                        </div>
                    </body>
                </html>
            `);
        }

        if (!user.link_code) {
            const newLinkCode = await generateUniqueLinkCode();

            await supabase
                .from('users')
                .update({ link_code: newLinkCode })
                .eq('username', user.username);

            user.link_code = newLinkCode;
        }

        const sessionId = generateSessionId();

const { error: sessionUpdateError } = await supabase
    .from('users')
    .update({
        current_session_id: sessionId,
        last_login_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
    })
    .eq('username', user.username);

if (sessionUpdateError) {
    console.error('Google 更新 session 失敗:', sessionUpdateError);
}

const redirectRole =
    state === 'teacher_apply'
        ? 'teacher_pending'
        : (user.role || 'student');

res.redirect(
`/?username=${encodeURIComponent(user.username)}
&role=${encodeURIComponent(redirectRole)}
&sessionId=${encodeURIComponent(sessionId)}
&login_success=true
&oauth_role=${encodeURIComponent(state || 'student')}`
);

    } catch (err) {
        console.error('Google Auth Error:', err);
        res.status(500).send('Google 登入失敗，請稍後再試。');
    }
});

// ==========================================
// [新增] LINE OAuth 登入路由
// ==========================================
// --- 1. 產生 LINE 登入連結並導向 ---
app.get('/api/auth/line', (req, res) => {
    const state = 'random_state_string'; 
    // 👇 注意看這行最後面，加上了 &bot_prompt=aggressive
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${process.env.LINE_CHANNEL_ID}&redirect_uri=${encodeURIComponent(process.env.LINE_CALLBACK_URL)}&state=${state}&scope=profile%20openid&bot_prompt=aggressive`;
    
    res.redirect(lineAuthUrl);
});

// --- 2. 接收 LINE 登入成功後的回傳資料 (Callback) ---
app.get('/api/auth/line/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    if (!code) {
        return res.status(400).send('沒有收到授權碼');
    }

    try {
        // 步驟 A: 拿 Code 向 LINE 換取 Access Token
        const tokenResponse = await axios.post('https://api.line.me/oauth2/v2.1/token', new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.LINE_CALLBACK_URL,
            client_id: process.env.LINE_CHANNEL_ID,
            client_secret: process.env.LINE_CHANNEL_SECRET
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // 步驟 B: 拿 Access Token 向 LINE 換取使用者的個人資料
        const profileResponse = await axios.get('https://api.line.me/v2/profile', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const { userId: lineId, displayName, pictureUrl } = profileResponse.data;
        // ======================================
// 自動家長綁定流程
// ======================================

if (state) {

    const decodedToken = decodeURIComponent(state);

    const { data: targetUser } = await supabase
        .from('users')
        .select('*')
        .eq('line_bind_token', decodedToken)
        .maybeSingle();

    if (targetUser) {

        let currentIds = [];

        if (targetUser.bound_line_ids) {
            currentIds = targetUser.bound_line_ids
                .split(',')
                .map(id => id.trim())
                .filter(Boolean);
        }

        if (!currentIds.includes(lineId)) {
            currentIds.push(lineId);
        }

        const newBoundIds = currentIds.join(',');

        await supabase
            .from('users')
            .update({
                bound_line_ids: newBoundIds
            })
            .eq('username', targetUser.username);

            try {
    await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
            to: lineId,
            messages: [
                {
                    type: 'text',
                    text:
`✅ LINE 家長綁定成功！

已成功連結學生：「${targetUser.username}」

之後此 LINE 帳號將收到：
📘 學習總結
⏱️ 專注時間紀錄
⚠️ 重要學習提醒

感謝您一起陪伴孩子建立穩定的學習習慣。`
                }
            ]
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            }
        }
    );

    console.log(`✅ 已推送 LINE 綁定成功通知給 ${lineId}`);

} catch (pushErr) {
    console.error('❌ LINE 綁定成功通知推播失敗');
    console.error(pushErr.response?.data || pushErr.message);
}
        return res.send(`
            <html>
                <body style="
                    background:#05070a;
                    color:white;
                    font-family:sans-serif;
                    display:flex;
                    justify-content:center;
                    align-items:center;
                    height:100vh;
                    text-align:center;
                    padding:20px;
                ">
                    <div>
                        <h1>✅ LINE 綁定成功</h1>
                        <p>已成功連結學生：</p>
                        <h2>${targetUser.username}</h2>
                        <p>現在可以直接關閉此頁面。</p>
                    </div>
                </body>
            </html>
        `);
    }
}

        // 步驟 C: 檢查 Supabase 是否已有此帳號
        let { data: existingUser } = await supabase
            .from('users')
            .select('*')
            .eq('account', lineId) // 將 LINE ID 當作使用者的唯一帳號
            .maybeSingle();

        // 步驟 D: 如果是全新使用者，自動幫他建立帳號
        if (!existingUser) {
            let finalUsername = displayName || 'LINE學員';
            
            // 防呆：避免暱稱重複
            const { data: nameCheck } = await supabase.from('users').select('username').eq('username', finalUsername).maybeSingle();
            if (nameCheck) finalUsername = finalUsername + Math.floor(Math.random() * 1000);

            const today = new Date().toISOString().split('T')[0];

            // --- [新增] 註冊時產生 6 位數代碼 ---
            const newLinkCode = await generateUniqueLinkCode();

            const { data: newUser, error } = await supabase.from('users').insert([{
                username: String(finalUsername),
                account: String(lineId),
                password: String(lineId), // 用 LINE ID 當作密碼欄位佔位
                total_seconds: 0,
                streak: 1,
                last_login: today,
                role: 'student',
                integrity_score: 100,
                link_code: newLinkCode // [新增]
            }]).select().single();

            if (error) throw error;
            existingUser = newUser;
            if (existingUser && existingUser.is_blocked) {
    return res.status(403).send('此帳號已被平台停用，請聯繫管理員。');
}
        } else if (!existingUser.link_code) {
            // --- [新增] 舊用戶補發邏輯 ---
            const newLinkCode = await generateUniqueLinkCode();
            await supabase.from('users').update({ link_code: newLinkCode }).eq('id', existingUser.id);
            existingUser.link_code = newLinkCode;
        }

        // 步驟 E: 登入成功！把網頁導向回前端首頁，並帶上參數
        const sessionId = generateSessionId();

const { error: sessionUpdateError } = await supabase
    .from('users')
    .update({
        current_session_id: sessionId,
        last_login_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
    })
    .eq('username', existingUser.username);

if (sessionUpdateError) {
    console.error('LINE 更新 session 失敗:', sessionUpdateError);
}

res.redirect(`/?username=${encodeURIComponent(existingUser.username)}&role=${encodeURIComponent(existingUser.role || 'student')}&sessionId=${encodeURIComponent(sessionId)}&login_success=true`);

    } catch (error) {
        console.error('LINE 登入過程發生錯誤:', error.response?.data || error.message);
        res.status(500).send('系統發生錯誤，LINE 登入失敗。');
    }
});

// [修改] 接收 LINE Webhook 訊號的路徑 (加入 6 位數代碼綁定邏輯)
app.post('/api/line/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        console.log('📩 收到 LINE Webhook:');
        console.log(JSON.stringify(req.body, null, 2));

        const events = req.body?.events;

        if (!events || events.length === 0) {
            console.log('⚠️ 沒有 events');
            return;
        }

        for (const event of events) {

            if (
                event.type === 'message' &&
                event.message &&
                event.message.type === 'text'
            ) {

                const text = event.message.text.trim();
                const lineId = event.source.userId;

                console.log('🧪 使用者輸入:', text);
                console.log('🧪 LINE ID:', lineId);

                // 判斷是否為六位數舊綁定碼，或新的 QR token 綁定指令
if (/^\d{6}$/.test(text) || /^[A-Z0-9]{6}$/.test(text) || text.startsWith('綁定 ')) {
    let targetUser = null;

if (text.startsWith('綁定 ')) {
    const token = text.replace('綁定 ', '').trim();

    const { data: userByToken, error: tokenFindError } = await supabase
        .from('users')
        .select('*')
        .eq('line_bind_token', token)
        .maybeSingle();

    if (tokenFindError) {
        console.error('❌ token 查詢失敗:', tokenFindError);
        return;
    }

    targetUser = userByToken;
} else if (/^[A-Z0-9]{6}$/.test(text)) {
    const { data: userByShortCode, error: shortCodeFindError } = await supabase
        .from('users')
        .select('*')
        .eq('line_bind_short_code', text)
        .maybeSingle();

    if (shortCodeFindError) {
        console.error('❌ 短碼查詢失敗:', shortCodeFindError);
        return;
    }

    targetUser = userByShortCode;
} else {
    const { data: userByCode, error: codeFindError } = await supabase
        .from('users')
        .select('*')
        .eq('link_code', text)
        .maybeSingle();

    if (codeFindError) {
        console.error('❌ 綁定碼查詢失敗:', codeFindError);
        return;
    }

    targetUser = userByCode;
}

                    console.log('🔍 查詢結果:', targetUser);

if (targetUser) {

                        // ===== 修正綁定邏輯 =====

                        let currentIds = [];

                        if (targetUser.bound_line_ids) {
                            currentIds = targetUser.bound_line_ids
                                .split(',')
                                .map(id => id.trim())
                                .filter(Boolean);
                        }

                        // 避免重複加入
                        if (!currentIds.includes(lineId)) {
                            currentIds.push(lineId);
                        }

                        const newBoundIds = currentIds.join(',');

                        console.log('📝 準備寫入:', newBoundIds);

                        const { error: updateError } = await supabase
                            .from('users')
                            .update({
                                bound_line_ids: newBoundIds
                            })
                             .eq('username', targetUser.username);

                        if (updateError) {
                            console.error('❌ 寫入 bound_line_ids 失敗');
                            console.error(updateError);

                            await axios.post(
                                'https://api.line.me/v2/bot/message/reply',
                                {
                                    replyToken: event.replyToken,
                                    messages: [{
                                        type: 'text',
                                        text: '❌ 綁定失敗，資料庫寫入錯誤'
                                    }]
                                },
                                {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                                    }
                                }
                            );

                            continue;
                        }

                        console.log('✅ LINE 綁定成功');

                        // ===== 成功回覆 =====

                        await axios.post(
                            'https://api.line.me/v2/bot/message/reply',
                            {
                                replyToken: event.replyToken,
                                messages: [{
                                    type: 'text',
                                    text:
`✅ 綁定成功！

已成功連結指揮官「${targetUser.username}」

之後學習總結將自動傳送到此 LINE 帳號 📘`
                                }]
                            },
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                                }
                            }
                        );

                    } else {

                        await axios.post(
                            'https://api.line.me/v2/bot/message/reply',
                            {
                                replyToken: event.replyToken,
                                messages: [{
                                    type: 'text',
                                    text: '❌ 找不到此綁定碼'
                                }]
                            },
                            {
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                                }
                            }
                        );
                    }
                }
            }
        }

    } catch (err) {

        console.error('❌ LINE Webhook 錯誤');

        if (err.response) {
            console.error(err.response.status);
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err);
        }
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
// [合併版] 虛擬白名單與課程資料庫
// ==========================================

// 1. 定義白名單：誰買了哪些課 (支援多個測試帳號)
const VIRTUAL_WHITELIST = {
    "測試學員": ["course_pro_01", "course_pro_02"], 
    "陳樂": ["course_pro_01"],
    "Guest": [] 
};

// 2. 定義課程資料庫：課程代碼對應的詳細資訊
// ==========================================
// [修正] 請在此處填入真正的 Google Meet 代碼
// ==========================================
const VIRTUAL_COURSE_DB = {
    // 將 'course_pro_01' 改成您開好的 Meet 代碼 (例如: mno-pqrs-tuv)
    'course_pro_01': { 
        meetId: 'hed-vrcs-mvf', // <--- 這裡要改！不要寫 course_pro_01
        name: '多益考前衝刺班', 
        icon: 'fa-language' 
    },
    
    // 同理，第二門課也要改
    'course_pro_02': { 
        meetId: 'abc-defg-hij', // <--- 這裡要改！
        name: 'Python 基礎實戰', 
        icon: 'fa-code' 
    },
    
    'course_pro_03': { 
        meetId: 'xyz-wxyz-abc', // <--- 這裡要改！
        name: '日檢 N3 文法特訓', 
        icon: 'fa-book-open' 
    }
};

// 3. 查詢學員課程權限的 API (只需保留這一個 app.get)
app.get('/api/my-courses', (req, res) => {
    const username = req.query.username;
    
    // 如果沒帶帳號，或帳號不在白名單內，回傳空陣列
    if (!username || !VIRTUAL_WHITELIST[username]) {
        return res.json([]);
    }

    const userCourseIds = VIRTUAL_WHITELIST[username];
    
    // 將該學員擁有的課程 ID 轉換成完整的資訊 (名稱、ID、圖示)
    const courseData = userCourseIds.map(id => {
        return VIRTUAL_COURSE_DB[id] || { meetId: id, name: '未命名課程', icon: 'fa-play-circle' };
    });

    res.json(courseData);
});

// --- 新增：接收學生背景自動報到的 API ---
app.post('/api/student-enter', (req, res) => {
    const { meetId, userName } = req.body;
    if (meetId && userName) {
        // 發送給該會議室的老師，使用一個加上 auto- 前綴的虛擬 ID
        io.to(meetId).emit('student_joined', {
            socketId: 'auto-' + Date.now(), 
            name: userName
        });
    }
    res.sendStatus(200);
});
// ------------------------------------
// ==========================================
// 核心修正：修改 save-focus API (結算點)
// ==========================================
app.post('/api/save-focus', async (req, res) => {
    const {
    username,
    score,
    focusSeconds,
    violationDetails,
    comment,
    creditDelta,
    integrityScore,
    deviceMode,
    roomType,
    teamSize,
    flippedCount
} = req.body;
    
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
            if (user.is_blocked) {
    return res.status(403).json({
        error: '此帳號已被平台停用，無法儲存學習紀錄。'
    });
}
            let newStreak = user.streak || 1;
            let isFirstLoginToday = user.last_login !== today;
            if (isFirstLoginToday) newStreak += 1;

            let currentIntegrity = user.integrity_score ?? 100;
            let dailyBonus = isFirstLoginToday ? 1 : 0;
            let sessionDelta = creditDelta !== undefined ? Number(creditDelta) : 0;
            console.log("🧪 creditDelta:", creditDelta);
console.log("🧪 sessionDelta:", sessionDelta);
            // ======================================
            // 使用前端實際誠信分
const sessionScore = integrityScore ?? 100;

const sessionPenalty = Math.max(
    0,
    100 - sessionScore
);
            
            let newIntegrity = Math.max(0, Math.min(100, currentIntegrity + dailyBonus + sessionDelta));

            await supabase.from('users')
                .update({
                    total_seconds: (user.total_seconds || 0) + totalExp, // 將計算後的積分累加至總分
                    streak: newStreak,
                    last_login: today,
                    integrity_score: newIntegrity
                })
                .eq('username', username);
                
           console.log(`[系統結算] ${username} 最終獲得 EXP: ${totalExp}`);
            // ======================================
// ======================================
// LINE 學習總結推播
// ======================================

if (user.bound_line_ids) {

    const lineIds = user.bound_line_ids
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    // 違規資訊整理
    let violationText = "無";

    if (violationDetails && Object.keys(violationDetails).length > 0) {

        violationText = Object.entries(violationDetails)
            .map(([reason, count]) => `• ${reason} × ${count}`)
            .join('\n');
    }

    // 使用前端真正的誠信分
    const sessionScore = integrityScore ?? 100;

    // 根據實際分數計算本次扣分
    const sessionPenalty = Math.max(
        0,
        100 - sessionScore
    );

    const reportText =
`📊 【Study Verse 學習總結報告】

👨‍🚀 指揮官：${username}

📅 ${new Date().toLocaleString('zh-TW')}

⏱️ 本次專注時間：${Math.floor(focusSeconds / 60)} 分鐘

⭐ 專注分數：${sessionScore}

⚠️ 違規扣除：-${sessionPenalty}

扣分原因：
${violationText}

教師評語：
${comment || '繼續保持專注！🔥'}
`;

    for (const lineId of lineIds) {

        try {

            await axios.post(
                'https://api.line.me/v2/bot/message/push',
                {
                    to: lineId,
                    messages: [
                        {
                            type: 'text',
                            text: reportText
                        }
                    ]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                    }
                }
            );

            console.log(`✅ 已推播學習總結給 ${lineId}`);

        } catch (pushErr) {

            console.error('❌ LINE 推播失敗');
            console.error(pushErr.response?.data || pushErr.message);
        }
    }
}
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
const teacherLogsByRoom = {};
let violationSnaps = [];
const disconnectTimeouts = {};

// 在 server.js 建立一個記憶體變數來存儲所有人的翻轉狀態
const globalUserStatus = {}; 

// --- 特約教室 (Tutor Room) 專屬記憶體狀態 ---
const tutorRoomSchedules = new Map();
const tutorAttendanceByRoom = new Map();

function getTaiwanTimeString() {
    return new Date().toLocaleTimeString('zh-TW', {
        hour12: false,
        timeZone: 'Asia/Taipei'
    });
}

function getTutorAttendance(roomId) {
    if (!roomId || !tutorAttendanceByRoom.has(roomId)) return [];

    return Array.from(tutorAttendanceByRoom.get(roomId).values());
}

function broadcastTutorAttendance(roomId) {
    const list = getTutorAttendance(roomId);

    const activeList = list.filter(u =>
        !u.leaveTime &&
        u.status !== 'OFFLINE'
    );

    // 點名：保留全部，包含已離開
    io.to(roomId).emit('update_attendance', list);

    // 中間學生圖卡：只顯示在線學生
    io.to(roomId).emit('update_rank', activeList);
}
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
    const usersWithCaptain = onlineUsers.map(u => {
        const isCap =
            u.teamId &&
            teamLeaderStates[u.teamId] &&
            teamLeaderStates[u.teamId].leader === u.name;

        return {
            ...u,
            isCaptain: !!isCap
        };
    });

    const roomKeys = [...new Set(
        usersWithCaptain
            .map(u => {
                if (u.roomMode === 'tutor' && u.roomId) {
                    return u.roomId;
                }

                return u.roomMode;
            })
            .filter(Boolean)
    )];

    roomKeys.forEach(roomKey => {
        const usersInRoom = usersWithCaptain.filter(u => {
            if (u.roomMode === 'tutor') {
                return u.roomId === roomKey;
            }

            return u.roomMode === roomKey;
        });

        io.to(roomKey).emit('update_rank', usersInRoom);
    });

    const studentSocketIds = new Set(onlineUsers.map(u => u.id));
    const sockets = await io.fetchSockets();

    sockets.forEach(s => {
        if (!studentSocketIds.has(s.id)) {
            s.emit('update_rank', usersWithCaptain);
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
    socket.on('auth_session', async ({ username, sessionId }) => {
    if (!username || !sessionId) {
        socket.emit('force_logout', {
            reason: '登入狀態已失效，請重新登入'
        });
        socket.disconnect(true);
        return;
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('username, current_session_id, is_blocked')
            .eq('username', username)
            .maybeSingle();

        if (error) throw error;

        if (!user || user.is_blocked || user.current_session_id !== sessionId) {
            socket.emit('force_logout', {
                reason: '此帳號已在其他裝置登入，請重新登入'
            });
            socket.disconnect(true);
            return;
        }

        socket.username = username;
        socket.sessionId = sessionId;

        // ==========================================
// 若已有舊 socket，強制踢出
// ==========================================
const oldSocketId = activeUserSockets.get(username);

if (oldSocketId && oldSocketId !== socket.id) {

    const oldSocket = io.sockets.sockets.get(oldSocketId);

    if (oldSocket) {

        oldSocket.emit('force_logout', {
            reason: '此帳號已在其他裝置登入'
        });

        oldSocket.disconnect(true);
    }
}

// 更新為最新 socket
activeUserSockets.set(username, socket.id);

        await supabase
            .from('users')
            .update({
                last_active_at: new Date().toISOString()
            })
            .eq('username', username);

    } catch (err) {
        console.error('Socket session 驗證失敗:', err);
        socket.emit('force_logout', {
            reason: '登入驗證失敗，請重新登入'
        });
        socket.disconnect(true);
    }
});
    console.log('🔌 指揮官已連線：', socket.id);
    socket.emit('update_rank', []);
    socket.emit('teacher_update', {
    logs: [],
    snaps: []
});

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
    const user = onlineUsers.find(u =>
        u.id === socket.id ||
        u.name === data?.name ||
        u.name === data?.username ||
        u.name === data?.studentName
    );

    const targetRoomMode = data?.roomMode || user?.roomMode;

    if (targetRoomMode) {
        io.to(targetRoomMode).emit('student_feedback', data);
    } else {
        socket.emit('student_feedback', data);
    }
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
    socket.on('join_tutor_room', async (data) => {
    if (!data) return;

    const roomId = data.roomId || data.room || data.meetId;
    const role = data.role || 'student';
    const username = data.username || data.userName || data.name;

    if (!roomId || roomId === 'undefined') {
        console.log("❌ 特約教室連線缺少 roomId");
        return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = role;

    if (role === 'teacher') {
        console.log(`[特約教室] 教師端加入 ${roomId}`);
        socket.emit('update_attendance', getTutorAttendance(roomId));
        return;
    }

    if (!username || username === 'undefined' || username === '神秘學員') {
        console.log("❌ 特約教室學生缺少 username");
        return;
    }

    const { data: dbUser } = await supabase
    .from('users')
    .select('username, is_blocked')
    .eq('username', username)
    .maybeSingle();

if (dbUser && dbUser.is_blocked) {
    socket.emit('blocked_account', {
        message: '此帳號已被平台停用，無法進入特約教室。'
    });
    socket.disconnect(true);
    return;
}
    socket.username = username;
    socket.deviceType = data.deviceType || 'pc';

    if (!tutorAttendanceByRoom.has(roomId)) {
        tutorAttendanceByRoom.set(roomId, new Map());
    }

    tutorAttendanceByRoom.get(roomId).set(username, {
        id: socket.id,
        name: username,
        roomId,
        roomMode: 'tutor',
        role: 'student',
        status: 'FOCUSED',
        joinTime: getTaiwanTimeString(),
        leaveTime: null
    });

    console.log(`[特約教室] 學生 ${username} 加入 ${roomId}`);

    broadcastTutorAttendance(roomId);
});

socket.on('get_attendance', (data) => {
    const roomId = data?.roomId || data?.room || socket.roomId;

    if (!roomId) {
        socket.emit('update_attendance', []);
        return;
    }

    socket.emit('update_attendance', getTutorAttendance(roomId));
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
    console.log('📢 收到老師廣播:', data.message);

    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId;

    if (targetRoom) {
        io.to(targetRoom).emit('receive_tutor_announcement', data);
    } else {
        socket.broadcast.emit('receive_tutor_announcement', data);
    }
});

    // 2. 黑板公告
    socket.on('update_blackboard', (data) => {
    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId ||
        data?.roomMode ||
        socket.roomMode;

    if (targetRoom) {
        io.to(targetRoom).emit('update_blackboard', data);
    } else {
        socket.broadcast.emit('update_blackboard', data);
    }
});

    // 3. 導師個別警告
    socket.on('send_warning', (data) => {
    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId ||
        data?.roomMode ||
        socket.roomMode;

    if (targetRoom) {
        io.to(targetRoom).emit('receive_warning', data);
    } else {
        socket.broadcast.emit('receive_warning', data);
    }
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
    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId ||
        data?.roomMode;

    if (targetRoom) {
        io.to(targetRoom).emit('violation', data);
        io.to(targetRoom).emit('student_violation', data);
    } else {
        socket.broadcast.emit('violation', data);
        socket.broadcast.emit('student_violation', data);
    }
});

    // 新增：切換分頁的專屬轉發
    socket.on('tab_switched', (data) => {
    const user = onlineUsers.find(u =>
        u.id === socket.id ||
        u.name === data?.name ||
        u.name === data?.username
    );

    const targetRoomMode = data?.roomMode || user?.roomMode;

    if (targetRoomMode) {
        io.to(targetRoomMode).emit('tab_switched', data);
    } else {
        socket.emit('tab_switched', data);
    }
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

            if (dbUser && dbUser.is_blocked) {
    socket.emit('blocked_account', {
        message: '此帳號已被平台停用，無法進入教室。'
    });

    onlineUsers = onlineUsers.filter(u => u.name !== username);
    socket.disconnect(true);
    return;
}
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
                
                addTeacherLog(`👤 ${username} 進入了[${roomName}] (誠信分: ${user.integrity_score})`,
    user.roomMode
);
                io.to(user.roomMode).emit('community_event', {
    type: 'ENTER',
    message: `${username} 進入了自習室。`
});
            } else {
                // 如果不是佔位符，代表是重新連線或重複發送
                user.status = 'FOCUSED'; 
                user.leaveTime = null; 
                user.integrity_score = dbUser ? (dbUser.integrity_score ?? 100) : user.integrity_score;
                if (data.roomMode) user.roomMode = data.roomMode;
                if (data.roomMode) user.roomMode = data.roomMode;

if (data.roomId || data.room) {
    user.roomId = data.roomId || data.room;
}

if (data.teamId) user.teamId = data.teamId;
                if (data.teamId) user.teamId = data.teamId;
                addTeacherLog(`🔄 ${username} 重新連線成功`,
    user.roomMode
);
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
            io.to(user.roomMode).emit(
    'update_attendance',
    onlineUsers.filter(u => u.roomMode === user.roomMode)
);

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
        const { name, isFlipped, isStandalone, roomMode } = data;
        if (name) {
            if (!globalUserStatus[name]) globalUserStatus[name] = {};
            if (isFlipped !== undefined) globalUserStatus[name].isFlipped = isFlipped;
            if (isStandalone !== undefined) globalUserStatus[name].isStandalone = isStandalone;
            globalUserStatus[name].lastUpdate = Date.now();
        }

        const user = onlineUsers.find(u => u.name === name || u.id === socket.id);
        if (user) {
            const oldStatus = user.status;
            if (roomMode) {
    user.roomMode = roomMode;
}
            if (isStandalone !== undefined) user.isStandalone = isStandalone;
            if (isFlipped !== undefined) {
                const prevFlipped = user.isFlipped;
                user.isFlipped = isFlipped;
                if (!prevFlipped && user.isFlipped) addTeacherLog(`📱 ${user.name} 已翻轉手機進入深度專注`,
    user.roomMode
);
            }
            if (data.status) {
                if (data.status === 'DISTRACTED' && user.isFlipped) user.status = 'FOCUSED';
                else user.status = data.status;
            }
            if (oldStatus !== user.status) {
                if (user.status === 'BREAK') addTeacherLog(`🚽 ${user.name} 申請生理需求 (${data.reason || '未註明'})`,
    user.roomMode
);
                else if (user.status === 'DISTRACTED') addTeacherLog(`🚨 ${user.name} 偵測到違規行為`,
    user.roomMode
);
            }
        }
        const targetRoomMode =
    roomMode ||
    user?.roomMode;

if (targetRoomMode) {
    io.to(targetRoomMode).emit('update_status', data);
} else {
    io.emit('update_status', data);
}

broadcastUpdateRank();
    });

    socket.on('mobile_sync_update', (data) => {
    // 手機 QR 連動：優先送回掃 QR 的那台電腦
    if (data?.syncToken) {
        io.to(data.syncToken).emit('mobile_sync_update', data);
    }

    // 一般教室同步：如果有 roomMode，再送給同教室
    const user = onlineUsers.find(u =>
        u.id === socket.id ||
        u.name === data?.name ||
        u.name === data?.username ||
        u.name === data?.studentName
    );

    const targetRoomMode = data?.roomMode || user?.roomMode;

    if (targetRoomMode) {
        io.to(targetRoomMode).emit('mobile_sync_update', data);
    }
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
            addTeacherLog(`❌ 懲罰: ${user.name} 因 [${reasonStr}] 扣除誠信分 ${integrityPenalty} 點, EXP 扣除 ${expPenalty} 點`,
    user.roomMode
);
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
    current_integrity: user.integrity_score,
    roomMode: user.roomMode
};
        
        violationSnaps.unshift(newSnap);
        if (violationSnaps.length > 30) violationSnaps.pop();

        io.to(user.roomMode).emit('teacher_update', {
    logs: teacherLogsByRoom[user.roomMode] || [],
    snaps: violationSnaps.filter(snap => snap.roomMode === user.roomMode)
});
        broadcastUpdateRank();
    });

    socket.on('submit_final_report', (reportData) => {
    const targetRoom =
        reportData?.roomId ||
        reportData?.room ||
        socket.roomId ||
        reportData?.roomMode;

    if (targetRoom) {
        io.to(targetRoom).emit('teacher_receive_report', reportData);
    } else {
        socket.broadcast.emit('teacher_receive_report', reportData);
    }
});

    socket.on('early_leave', async (data) => {
        const user = onlineUsers.find(u => u.name === data.name);
        if (user) {
            const penalty = 15;
            user.integrity_score = Math.max(0, user.integrity_score - penalty);
            addTeacherLog(`⚠️ 嚴重警告: ${data.name} 惡意早退，誠信分扣除 ${penalty} 分！`,
    user.roomMode
);
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
        const targetRoomMode = data?.roomMode || data?.roomId;

        if (targetRoomMode) {
            io.to(targetRoomMode).emit('admin_action', data);
        } else {
            socket.emit('admin_action', data);
        }
    }

    if (data.type === 'BLACKBOARD') {
        const targetRoomMode = data?.roomMode || data?.roomId;

        if (targetRoomMode) {
            addTeacherLog(`📢 教師公告：${data.content}`, targetRoomMode);
        }
    }
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
    const user = onlineUsers.find(u =>
        u.id === socket.id ||
        u.name === data?.name ||
        u.name === data?.username
    );

    const targetRoomMode = data?.roomMode || user?.roomMode;

    if (targetRoomMode) {
        io.to(targetRoomMode).emit('community_event', data);
    } else {
        socket.emit('community_event', data);
    }
});

    socket.on('flip_failed', (data) => {
    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId ||
        data?.roomMode;

    const studentName = data.name || data.username;

if (targetRoom && tutorAttendanceByRoom.has(targetRoom) && studentName) {
    const roomMap = tutorAttendanceByRoom.get(targetRoom);
    const student = roomMap.get(studentName);

    if (student) {
        student.status = 'OFFLINE';
        student.leaveTime = getTaiwanTimeString();
        roomMap.set(studentName, student);
    }

    broadcastTutorAttendance(targetRoom);
}

    if (targetRoom) {
        io.to(targetRoom).emit('flip_failed', data);
        io.to(targetRoom).emit('student_violation', {
            name: data.name || data.username,
            type: '📱 手機翻轉中斷（超過5秒，已強制踢出教室）',
            image: null,
            roomId: targetRoom
        });
    } else {
        socket.broadcast.emit('flip_failed', data);
    }
});

    // 斷線處理：升級加入特約教室裝置清除邏輯
    socket.on('disconnect', () => {
        if (socket.username) {

    const currentSocketId = activeUserSockets.get(socket.username);

    if (currentSocketId === socket.id) {
        activeUserSockets.delete(socket.username);
    }
}
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
        const oldRoomMode = user.roomMode;

        user.leaveTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        user.status = 'OFFLINE';

        io.to(oldRoomMode).emit(
            'update_attendance',
            onlineUsers.filter(u => u.roomMode === oldRoomMode)
        );

        disconnectTimeouts[username] = setTimeout(() => {
            addTeacherLog(`👋 ${username} 離開了教室`, oldRoomMode);

            onlineUsers = onlineUsers.filter(u => u.name !== username);

            if (userTeamId) {
                removeUserFromTeam(username, userTeamId);
            }

            io.to(oldRoomMode).emit(
                'update_attendance',
                onlineUsers.filter(u => u.roomMode === oldRoomMode)
            );

            io.to(oldRoomMode).emit('community_event', {
                type: 'LEAVE',
                message: `${username} 離開了教室。`
            });

            broadcastUpdateRank();
            broadcastActiveTeams();

            delete disconnectTimeouts[username];
        }, 30000);
    }
});
});

function addTeacherLog(msg, roomMode = 'global') {

    if (!teacherLogsByRoom[roomMode]) {
        teacherLogsByRoom[roomMode] = [];
    }

    const time = new Date().toLocaleTimeString('zh-TW', {
        hour12: false
    });

    teacherLogsByRoom[roomMode].unshift(`[${time}] ${msg}`);

    if (teacherLogsByRoom[roomMode].length > 50) {
        teacherLogsByRoom[roomMode].pop();
    }

    io.to(roomMode).emit('teacher_update', {
        logs: teacherLogsByRoom[roomMode],
        snaps: violationSnaps.filter(
            s => s.roomMode === roomMode
        )
    });
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