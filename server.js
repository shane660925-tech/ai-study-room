// 引入環境變數設定 (必須放在最頂端)
require('dotenv').config();
console.log('[SV VERSION] server oauth-clean-20260610-2 loaded');
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
const PUBLIC_BASE_URL = (
    process.env.PUBLIC_BASE_URL ||
    (process.env.NODE_ENV === 'production'
        ? 'https://studyverse.tw'
        : 'http://localhost:3000')
).trim().replace(/\/+$/, '');

const GOOGLE_CALLBACK_URL =
    `${PUBLIC_BASE_URL}/api/auth/google/callback`;

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

// 儲存每個教室最後一次黑板公告
const blackboardByRoom = {};

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

function normalizeUsername(value) {
    return String(value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function buildNewStudentTrialFields() {
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(
        trialStartedAt.getTime() + 14 * 24 * 60 * 60 * 1000
    );

    return {
        // 注意：資料庫欄位先維持舊系統相容值
        // 真正的 trial 權限由 trial_ends_at 判斷
        membership_level: 'free',
        is_subscribed: false,
        subscription_status: 'none',
        subscription_started_at: null,
        subscription_end_date: null,
        trial_started_at: trialStartedAt.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
        has_seen_subscription_intro: false
    };
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

// ==========================================
// Tutor Schedules API - 特約教室多房間
// ==========================================


function generateTutorRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';

    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
}

async function generateUniqueTutorRoomCode() {
    let code;
    let isUnique = false;

    while (!isUnique) {
        code = generateTutorRoomCode();

        const { data, error } = await supabase
            .from('tutor_schedules')
            .select('room_code')
            .eq('room_code', code)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            isUnique = true;
        }
    }

    return code;
}

// ==========================================
// Tutor Programs API - 週期特約教室
// ==========================================

async function generateUniqueTutorGlobalRoomCode() {
    let code;
    let isUnique = false;

    while (!isUnique) {
        code = generateTutorRoomCode();

        const { data: existingSchedule, error: scheduleError } = await supabase
            .from('tutor_schedules')
            .select('room_code')
            .eq('room_code', code)
            .maybeSingle();

        if (scheduleError) throw scheduleError;

        const { data: existingProgram, error: programError } = await supabase
            .from('tutor_programs')
            .select('room_code')
            .eq('room_code', code)
            .maybeSingle();

        if (programError) throw programError;

        if (!existingSchedule && !existingProgram) {
            isUnique = true;
        }
    }

    return code;
}

function normalizeTutorWeekdays(rawWeekdays) {
    if (!Array.isArray(rawWeekdays)) {
        return [];
    }

    return [...new Set(
        rawWeekdays
            .map(day => Number(day))
            .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    )];
}

function buildTutorProgramDates(startDate, endDate, weekdays) {
    const dates = [];

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return dates;
    }

    for (
        let cursor = new Date(start);
        cursor <= end;
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
        const weekday = cursor.getUTCDay();

        if (weekdays.includes(weekday)) {
            dates.push(cursor.toISOString().slice(0, 10));
        }
    }

    return dates;
}

// 建立一個週期特約教室，並自動產生多筆 tutor_schedules
app.post('/api/tutor-programs', async (req, res) => {
    try {
        const {
            teacherUsername,
            roomTitle,
            title,
            startDate,
            endDate,
            weekdays,
            startTime,
            periods,
            classMinutes,
            restMinutes,
            roomSize,
            maxStudents,
            roomNote
        } = req.body;

        if (!teacherUsername) {
            return res.status(400).json({ error: '缺少 teacherUsername' });
        }

        const finalTitle = String(roomTitle || title || '特約教室').trim();
        const finalRoomNote = String(roomNote || '').trim();

        if (!startDate || !endDate) {
            return res.status(400).json({ error: '請選擇開始日期與結束日期' });
        }

        const finalWeekdays = normalizeTutorWeekdays(weekdays);

        if (finalWeekdays.length === 0) {
            return res.status(400).json({ error: '請至少選擇一個上課星期' });
        }

        if (!startTime) {
            return res.status(400).json({ error: '請選擇固定開始時間' });
        }

        const finalPeriods = Number(periods || 1);
        const finalClassMinutes = Number(classMinutes || 50);
        const finalRestMinutes = Number(restMinutes || 10);
        const finalMaxStudents = Number(maxStudents || roomSize || 0);

        if (!Number.isInteger(finalPeriods) || finalPeriods <= 0) {
            return res.status(400).json({ error: '堂數格式錯誤' });
        }

        if (!Number.isInteger(finalClassMinutes) || finalClassMinutes <= 0) {
            return res.status(400).json({ error: '每堂課分鐘數格式錯誤' });
        }

        if (!Number.isInteger(finalRestMinutes) || finalRestMinutes < 0) {
            return res.status(400).json({ error: '休息分鐘數格式錯誤' });
        }

        if (!Number.isInteger(finalMaxStudents) || finalMaxStudents < 0) {
            return res.status(400).json({ error: '人數上限格式錯誤' });
        }

        const scheduleDates = buildTutorProgramDates(startDate, endDate, finalWeekdays);

        if (scheduleDates.length === 0) {
            return res.status(400).json({
                error: '此日期區間內沒有符合星期條件的上課日期'
            });
        }

        const { data: teacher, error: teacherError } = await supabase
            .from('users')
            .select('username, role, teacher_status, is_blocked')
            .eq('username', teacherUsername)
            .maybeSingle();

        if (teacherError) throw teacherError;

        if (!teacher) {
            return res.status(404).json({ error: '找不到教師帳號' });
        }

        if (teacher.is_blocked) {
            return res.status(403).json({ error: '此教師帳號已被停用' });
        }

        if (teacher.role !== 'teacher' && teacher.role !== 'admin') {
            return res.status(403).json({ error: '此帳號不是教師或管理員' });
        }

        if (teacher.role === 'teacher' && teacher.teacher_status !== 'approved') {
            return res.status(403).json({ error: '教師資格尚未通過審核' });
        }

        const programRoomCode = await generateUniqueTutorGlobalRoomCode();

        const { data: program, error: programInsertError } = await supabase
            .from('tutor_programs')
            .insert([{
                teacher_username: teacherUsername,
                room_code: programRoomCode,
                title: finalTitle || '特約教室',
                room_note: finalRoomNote || null,
                start_date: startDate,
                end_date: endDate,
                weekdays: finalWeekdays,
                start_time: startTime,
                periods: finalPeriods,
                class_minutes: finalClassMinutes,
                rest_minutes: finalRestMinutes,
                max_students: finalMaxStudents,
                enrolled_count: 0,
                is_public: true,
                requires_subscription: true,
                status: 'open'
            }])
            .select()
            .single();

        if (programInsertError) throw programInsertError;

        const scheduleRows = [];

        for (const scheduledDate of scheduleDates) {
            const scheduleRoomCode = await generateUniqueTutorGlobalRoomCode();

            scheduleRows.push({
                teacher_username: teacherUsername,
                room_code: scheduleRoomCode,
                room_title: finalTitle || '特約教室',
                room_note: finalRoomNote || null,
                room_size: roomSize || String(finalMaxStudents || ''),
                periods: finalPeriods,
                class_minutes: finalClassMinutes,
                rest_minutes: finalRestMinutes,
                start_time: startTime,
                scheduled_date: scheduledDate,
                status: 'scheduled',
                program_id: program.id,
                requires_whitelist: true,
                max_students: finalMaxStudents,
                enrolled_count: 0
            });
        }

        const { data: schedules, error: schedulesInsertError } = await supabase
            .from('tutor_schedules')
            .insert(scheduleRows)
            .select();

        if (schedulesInsertError) {
            await supabase
                .from('tutor_programs')
                .delete()
                .eq('id', program.id);

            throw schedulesInsertError;
        }

        res.json({
            success: true,
            program,
            schedules,
            scheduleCount: schedules.length,
            message: `已建立週期特約教室，共產生 ${schedules.length} 次上課房間`
        });

    } catch (err) {
        console.error('建立週期特約教室失敗:', err);
        res.status(500).json({
            error: '建立週期特約教室失敗',
            detail: err.message || String(err)
        });
    }
});


function getTaipeiTodayDateString() {
    return new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Taipei'
    });
}

function buildTutorScheduleStartAt(schedule) {
    if (!schedule || !schedule.start_time) {
        return null;
    }

    const dateText =
        schedule.scheduled_date ||
        getTaipeiTodayDateString();

    const timeText = String(schedule.start_time).slice(0, 5);

    if (!dateText || !timeText || !timeText.includes(':')) {
        return null;
    }

    const startAt = new Date(`${dateText}T${timeText}:00+08:00`);

    if (Number.isNaN(startAt.getTime())) {
        return null;
    }

    return startAt;
}

function getTutorScheduleTotalMinutes(schedule) {
    const periods = Number(schedule.periods || 1);
    const classMinutes = Number(schedule.class_minutes || 50);
    const restMinutes = Number(schedule.rest_minutes || 10);

    return (
        periods * classMinutes +
        ((periods > 1) ? (periods - 1) * restMinutes : 0)
    );
}

function getTutorProgramAccessFromUser(user) {
    if (!user) {
        return {
            accessLevel: 'guest',
            canEnrollTutorProgram: false,
            roleBypass: false
        };
    }

    const role = user.role || 'student';

    if (role === 'teacher' || role === 'admin' || role === 'teacher_pending') {
        return {
            accessLevel: 'pro',
            canEnrollTutorProgram: true,
            roleBypass: true
        };
    }

    const now = Date.now();

    const subscriptionEndTime = user.subscription_end_date
        ? new Date(user.subscription_end_date).getTime()
        : 0;

    const trialEndTime = user.trial_ends_at
        ? new Date(user.trial_ends_at).getTime()
        : 0;

    const hasActiveSubscription =
        user.is_subscribed === true &&
        user.subscription_status === 'active' &&
        subscriptionEndTime > now;

    const hasActiveTrial =
        trialEndTime > now;

    if (hasActiveSubscription) {
        return {
            accessLevel: 'pro',
            canEnrollTutorProgram: true,
            roleBypass: false
        };
    }

    if (hasActiveTrial) {
        return {
            accessLevel: 'trial',
            canEnrollTutorProgram: true,
            roleBypass: false
        };
    }

    const hasExpiredRecord =
        !!user.trial_ends_at ||
        !!user.subscription_end_date ||
        user.subscription_status === 'expired';

    return {
        accessLevel: hasExpiredRecord ? 'expired' : 'free',
        canEnrollTutorProgram: false,
        roleBypass: false
    };
}

function formatTutorProgramWeekdays(weekdays) {
    const names = {
        0: '日',
        1: '一',
        2: '二',
        3: '三',
        4: '四',
        5: '五',
        6: '六'
    };

    if (!Array.isArray(weekdays)) return '';

    return weekdays
        .map(day => names[Number(day)])
        .filter(Boolean)
        .join('、');
}

function parseTutorProgramTimeToMinutes(timeText) {
    const raw = String(timeText || '').slice(0, 5);

    if (!raw.includes(':')) return null;

    const [hours, minutes] = raw.split(':').map(Number);

    if (
        Number.isNaN(hours) ||
        Number.isNaN(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        return null;
    }

    return hours * 60 + minutes;
}

function formatTutorProgramMinutes(totalMinutes) {
    const minutesInDay = 24 * 60;
    const safeTotal = ((Number(totalMinutes || 0) % minutesInDay) + minutesInDay) % minutesInDay;

    const hours = Math.floor(safeTotal / 60);
    const minutes = safeTotal % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getTutorProgramTimeRangeTextForNotification(program) {
    const startMinutes = parseTutorProgramTimeToMinutes(program?.start_time);

    if (startMinutes === null) {
        return '未設定';
    }

    const periods = Number(program?.periods || 1);
    const classMinutes = Number(program?.class_minutes || 50);
    const restMinutes = Number(program?.rest_minutes || 10);

    const totalMinutes =
        periods * classMinutes +
        ((periods > 1) ? (periods - 1) * restMinutes : 0);

    const endMinutes = startMinutes + totalMinutes;

    return `${formatTutorProgramMinutes(startMinutes)} - ${formatTutorProgramMinutes(endMinutes)}`;
}
// 課程商店：取得可報名的週期特約教室
app.get('/api/tutor-programs/store', async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();

        let user = null;
        let access = {
            accessLevel: 'guest',
            canEnrollTutorProgram: false,
            roleBypass: false
        };

        if (username) {
            const { data: dbUser, error: userError } = await supabase
                .from('users')
                .select(`
                    username,
                    role,
                    is_blocked,
                    membership_level,
                    is_subscribed,
                    subscription_status,
                    subscription_end_date,
                    trial_ends_at
                `)
                .eq('username', username)
                .maybeSingle();

            if (userError) throw userError;

            if (dbUser && dbUser.is_blocked) {
                return res.status(403).json({
                    success: false,
                    error: '此帳號已被停用，無法查看特約教室報名。',
                    accessLevel: 'blocked',
                    canEnrollTutorProgram: false,
                    programs: []
                });
            }

            user = dbUser;
            access = getTutorProgramAccessFromUser(user);
        }

        const { data: programs, error: programError } = await supabase
            .from('tutor_programs')
            .select('*')
            .eq('is_public', true)
            .eq('status', 'open')
            .order('start_date', { ascending: true })
            .order('start_time', { ascending: true });

        if (programError) throw programError;

        const programIds = (programs || []).map(program => program.id);

        let enrolledProgramIdSet = new Set();

        if (username && programIds.length > 0) {
            const { data: enrollments, error: enrollmentError } = await supabase
                .from('tutor_program_enrollments')
                .select('program_id')
                .eq('username', username)
                .eq('status', 'active')
                .in('program_id', programIds);

            if (enrollmentError) throw enrollmentError;

            enrolledProgramIdSet = new Set(
                (enrollments || []).map(row => row.program_id)
            );
        }

        const mappedPrograms = (programs || []).map(program => {
            const maxStudents = Number(program.max_students || 0);
            const enrolledCount = Number(program.enrolled_count || 0);
            const isFull = maxStudents > 0 && enrolledCount >= maxStudents;
            const isEnrolled = enrolledProgramIdSet.has(program.id);

            return {
                id: program.id,
                teacher_username: program.teacher_username,
                teacher_name: program.teacher_username,

                room_code: program.room_code,
                title: program.title || '特約教室',
                room_note: program.room_note || '',

                start_date: program.start_date,
                end_date: program.end_date,
                weekdays: program.weekdays || [],
                weekdays_text: formatTutorProgramWeekdays(program.weekdays),

                start_time: program.start_time,
                periods: Number(program.periods || 1),
                class_minutes: Number(program.class_minutes || 50),
                rest_minutes: Number(program.rest_minutes || 10),

                max_students: maxStudents,
                enrolled_count: enrolledCount,
                capacity_text: maxStudents > 0
                    ? `${enrolledCount} / ${maxStudents}`
                    : `${enrolledCount} / 不限`,

                is_full: isFull,
                is_enrolled: isEnrolled,

                requires_subscription: program.requires_subscription === true,
                can_enroll: access.canEnrollTutorProgram === true && !isFull && !isEnrolled,

                status: program.status,
                created_at: program.created_at
            };
        });

        res.json({
            success: true,
            username: username || null,
            accessLevel: access.accessLevel,
            canEnrollTutorProgram: access.canEnrollTutorProgram,
            roleBypass: access.roleBypass,
            programs: mappedPrograms
        });

    } catch (err) {
        console.error('取得課程商店特約教室列表失敗:', err);

        res.status(500).json({
            success: false,
            error: '取得課程商店特約教室列表失敗',
            detail: err.message || String(err)
        });
    }
});

// 課程商店：報名週期特約教室，寫入白名單
app.post('/api/tutor-programs/enroll', async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const programId = String(req.body.programId || '').trim();

        if (!username) {
            return res.status(400).json({
                success: false,
                error: '缺少 username'
            });
        }

        if (!programId) {
            return res.status(400).json({
                success: false,
                error: '缺少 programId'
            });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select(`
                username,
                role,
                is_blocked,
                membership_level,
                is_subscribed,
                subscription_status,
                subscription_end_date,
                trial_ends_at
            `)
            .eq('username', username)
            .maybeSingle();

        if (userError) throw userError;

        if (!user) {
            return res.status(404).json({
                success: false,
                error: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: '此帳號已被停用，無法報名特約教室'
            });
        }

        const access = getTutorProgramAccessFromUser(user);

        if (!access.canEnrollTutorProgram) {
            return res.status(403).json({
                success: false,
                error: '特約教室報名限 trial / pro 使用者。請先升級方案。',
                accessLevel: access.accessLevel
            });
        }

        const { data: program, error: programError } = await supabase
            .from('tutor_programs')
            .select('*')
            .eq('id', programId)
            .eq('is_public', true)
            .eq('status', 'open')
            .maybeSingle();

        if (programError) throw programError;

        if (!program) {
            return res.status(404).json({
                success: false,
                error: '找不到可報名的特約教室'
            });
        }

        const maxStudents = Number(program.max_students || 0);
        const currentEnrolledCount = Number(program.enrolled_count || 0);

        if (maxStudents > 0 && currentEnrolledCount >= maxStudents) {
            return res.status(409).json({
                success: false,
                error: '此特約教室已額滿'
            });
        }

        const { data: existingEnrollment, error: existingError } = await supabase
            .from('tutor_program_enrollments')
            .select('*')
            .eq('program_id', program.id)
            .eq('username', username)
            .eq('status', 'active')
            .maybeSingle();

        if (existingError) throw existingError;

        if (existingEnrollment) {
            return res.json({
                success: true,
                alreadyEnrolled: true,
                enrollment: existingEnrollment,
                program,
                message: '你已經報名過此特約教室'
            });
        }

        const { data: enrollment, error: insertError } = await supabase
            .from('tutor_program_enrollments')
            .insert([{
                program_id: program.id,
                username,
                status: 'active',
                source: 'course_store'
            }])
            .select()
            .single();

        if (insertError) {
            if (
                insertError.code === '23505' ||
                String(insertError.message || '').includes('duplicate')
            ) {
                return res.json({
                    success: true,
                    alreadyEnrolled: true,
                    program,
                    message: '你已經報名過此特約教室'
                });
            }

            throw insertError;
        }

        const { count: activeEnrollmentCount, error: countError } = await supabase
            .from('tutor_program_enrollments')
            .select('id', {
                count: 'exact',
                head: true
            })
            .eq('program_id', program.id)
            .eq('status', 'active');

        if (countError) throw countError;

        const finalEnrolledCount = Number(activeEnrollmentCount || 0);

        await supabase
            .from('tutor_programs')
            .update({
                enrolled_count: finalEnrolledCount,
                updated_at: new Date().toISOString()
            })
            .eq('id', program.id);

        await supabase
            .from('tutor_schedules')
            .update({
                enrolled_count: finalEnrolledCount,
                updated_at: new Date().toISOString()
            })
            .eq('program_id', program.id);

        const weekdaysText = formatTutorProgramWeekdays(program.weekdays);
const timeRangeText = getTutorProgramTimeRangeTextForNotification(program);

await createNotification({
    username,
    type: 'tutor_program_enrolled',
    title: '特約教室報名成功',
    message:
        `你已成功報名 ${program.teacher_username} 教師的「${program.title || '特約教室'}」。\n` +
        `日期：${program.start_date} ~ ${program.end_date}\n` +
        `星期：${weekdaysText || '未設定'}\n` +
        `時間：${timeRangeText}\n` +
        `課程代碼：${program.room_code}`
});

        res.json({
            success: true,
            alreadyEnrolled: false,
            enrollment,
            program: {
                ...program,
                enrolled_count: finalEnrolledCount
            },
            message: '報名成功，已加入特約教室白名單'
        });

    } catch (err) {
        console.error('報名週期特約教室失敗:', err);

        res.status(500).json({
            success: false,
            error: '報名週期特約教室失敗',
            detail: err.message || String(err)
        });
    }
});

// 建立一間新的特約教室
app.post('/api/tutor-schedules', async (req, res) => {
try {
const {
            teacherUsername,
            roomTitle,
            roomSize,
            periods,
            classMinutes,
            restMinutes,
startTime,
scheduledDate,
roomNote
        } = req.body;
        if (!teacherUsername) {
            return res.status(400).json({ error: '缺少 teacherUsername' });
        }
        if (!periods || !classMinutes || !restMinutes || !startTime) {
            return res.status(400).json({ error: '排課資料不完整' });
        }
const finalScheduledDate =
scheduledDate ||
new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const finalRoomNote = String(roomNote || '').trim();
        const { data: teacher, error: teacherError } = await supabase
            .from('users')
            .select('username, role, teacher_status, is_blocked')
            .eq('username', teacherUsername)
            .maybeSingle();
        if (teacherError) throw teacherError;
        if (!teacher) {
            return res.status(404).json({ error: '找不到教師帳號' });
        }
        if (teacher.is_blocked) {
            return res.status(403).json({ error: '此教師帳號已被停用' });
        }
        if (teacher.role !== 'teacher' && teacher.role !== 'admin') {
            return res.status(403).json({ error: '此帳號不是教師或管理員' });
        }
        if (teacher.role === 'teacher' && teacher.teacher_status !== 'approved') {
            return res.status(403).json({ error: '教師資格尚未通過審核' });
        }
        const roomCode = await generateUniqueTutorRoomCode();
        const { data: schedule, error: insertError } = await supabase
            .from('tutor_schedules')
            .insert([{
                teacher_username: teacherUsername,
                room_code: roomCode,
                room_title: roomTitle || '特約教室',
room_note: finalRoomNote || null,
                room_size: roomSize || null,
                periods: Number(periods),
                class_minutes: Number(classMinutes),
                rest_minutes: Number(restMinutes),
                start_time: startTime,
scheduled_date: finalScheduledDate,
                status: 'live'
            }])
            .select()
            .single();
        if (insertError) throw insertError;
        res.json({
            success: true,
            schedule
        });
    } catch (err) {
        console.error('建立特約教室失敗:', err);
        res.status(500).json({ error: '建立特約教室失敗' });
    }
});

// 取得某位教師目前的特約教室
app.get('/api/tutor-schedules', async (req, res) => {
    try {
        const teacherUsername =
            req.query.teacherUsername ||
            req.query.teacher ||
            req.query.username;

        if (!teacherUsername) {
            return res.status(400).json({ error: '缺少 teacherUsername' });
        }

        const { data: schedules, error } = await supabase
            .from('tutor_schedules')
            .select('*')
            .eq('teacher_username', teacherUsername)
            .in('status', ['scheduled', 'live'])
            .order('scheduled_date', { ascending: true })
            .order('start_time', { ascending: true })
            .order('created_at', { ascending: false });

        if (error) throw error;

        const now = new Date();
        const activeSchedules = [];
        const expiredIds = [];

        (schedules || []).forEach(schedule => {
            const startAt = buildTutorScheduleStartAt(schedule);

            if (!startAt) {
                activeSchedules.push(schedule);
                return;
            }

            const totalMinutes = getTutorScheduleTotalMinutes(schedule);
            const endAt = new Date(startAt.getTime() + totalMinutes * 60 * 1000);

            if (now > endAt) {
                expiredIds.push(schedule.id);
            } else {
                activeSchedules.push({
                    ...schedule,
                    computed_start_at: startAt.toISOString(),
                    computed_end_at: endAt.toISOString()
                });
            }
        });

        if (expiredIds.length > 0) {
            await supabase
                .from('tutor_schedules')
                .update({
                    status: 'ended',
                    updated_at: new Date().toISOString()
                })
                .in('id', expiredIds);
        }

        res.json({
            success: true,
            schedules: activeSchedules
        });

    } catch (err) {
        console.error('取得特約教室列表失敗:', err);
        res.status(500).json({ error: '取得特約教室列表失敗' });
    }
});

async function getTutorEntryUserAccess(username) {
    if (!username) {
        return {
            user: null,
            access: {
                accessLevel: 'guest',
                canEnrollTutorProgram: false,
                roleBypass: false
            }
        };
    }

    const { data: user, error } = await supabase
        .from('users')
        .select(`
            username,
            role,
            is_blocked,
            membership_level,
            is_subscribed,
            subscription_status,
            subscription_end_date,
            trial_ends_at
        `)
        .eq('username', username)
        .maybeSingle();

    if (error) throw error;

    return {
        user,
        access: getTutorProgramAccessFromUser(user)
    };
}

async function hasActiveTutorProgramEnrollment(programId, username) {
    if (!programId || !username) return false;

    const { data, error } = await supabase
        .from('tutor_program_enrollments')
        .select('id')
        .eq('program_id', programId)
        .eq('username', username)
        .eq('status', 'active')
        .maybeSingle();

    if (error) throw error;

    return !!data;
}

async function findNextAvailableTutorScheduleForProgram(programId) {
    const { data: schedules, error } = await supabase
        .from('tutor_schedules')
        .select('*')
        .eq('program_id', programId)
        .in('status', ['scheduled', 'live'])
        .order('scheduled_date', { ascending: true })
        .order('start_time', { ascending: true });

    if (error) throw error;

    const now = new Date();
    const expiredIds = [];
    let nextSchedule = null;

    for (const schedule of (schedules || [])) {
        const startAt = buildTutorScheduleStartAt(schedule);

        if (!startAt) {
            if (!nextSchedule) nextSchedule = schedule;
            continue;
        }

        const totalMinutes = getTutorScheduleTotalMinutes(schedule);
        const endAt = new Date(startAt.getTime() + totalMinutes * 60 * 1000);

        if (now > endAt) {
            expiredIds.push(schedule.id);
            continue;
        }

        if (!nextSchedule) {
            nextSchedule = {
                ...schedule,
                computed_start_at: startAt.toISOString(),
                computed_end_at: endAt.toISOString()
            };
        }
    }

    if (expiredIds.length > 0) {
        await supabase
            .from('tutor_schedules')
            .update({
                status: 'ended',
                updated_at: new Date().toISOString()
            })
            .in('id', expiredIds);
    }

    return nextSchedule;
}

async function verifyTutorScheduleWhitelistAccess(schedule, username) {
    if (!schedule || schedule.requires_whitelist !== true) {
        return {
            ok: true
        };
    }

    if (!username) {
        return {
            ok: false,
            status: 401,
            error: '此特約教室需要登入後才能進入'
        };
    }

    const { user, access } = await getTutorEntryUserAccess(username);

    if (!user) {
        return {
            ok: false,
            status: 404,
            error: '找不到使用者'
        };
    }

    if (user.is_blocked) {
        return {
            ok: false,
            status: 403,
            error: '此帳號已被停用，無法進入特約教室'
        };
    }

    if (!access.canEnrollTutorProgram) {
        return {
            ok: false,
            status: 403,
            error: '特約教室限 trial / pro 使用者進入。請先升級方案。',
            accessLevel: access.accessLevel
        };
    }

    // 教師 / admin / teacher_pending 可略過學生白名單限制
    if (access.roleBypass) {
        return {
            ok: true,
            access
        };
    }

    if (!schedule.program_id) {
        return {
            ok: false,
            status: 403,
            error: '此教室需要白名單，但缺少課程資料'
        };
    }

    const isEnrolled = await hasActiveTutorProgramEnrollment(
        schedule.program_id,
        username
    );

    if (!isEnrolled) {
        return {
            ok: false,
            status: 403,
            error: '你尚未報名此特約教室，請先到課程商店報名'
        };
    }

    return {
        ok: true,
        access
    };
}

// 學生輸入代碼時，用 room_code 查教室
// 支援兩種代碼：
// 1. tutor_schedules.room_code：舊流程 / 實際房間代碼
// 2. tutor_programs.room_code：新流程 / 課程報名代碼
app.get('/api/tutor-schedules/by-code/:roomCode', async (req, res) => {
    try {
        const roomCode = String(req.params.roomCode || '').trim().toUpperCase();
        const username = String(req.query.username || '').trim();

        if (!roomCode) {
            return res.status(400).json({ error: '缺少 roomCode' });
        }

        // A. 先找舊流程 / 實際房間代碼
        const { data: directSchedule, error: directScheduleError } = await supabase
            .from('tutor_schedules')
            .select('*')
            .eq('room_code', roomCode)
            .in('status', ['scheduled', 'live'])
            .maybeSingle();

        if (directScheduleError) throw directScheduleError;

        if (directSchedule) {
            const startAt = buildTutorScheduleStartAt(directSchedule);
            const totalMinutes = getTutorScheduleTotalMinutes(directSchedule);

            let computedSchedule = directSchedule;

            if (startAt) {
                const endAt = new Date(startAt.getTime() + totalMinutes * 60 * 1000);

                if (new Date() > endAt) {
                    await supabase
                        .from('tutor_schedules')
                        .update({
                            status: 'ended',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', directSchedule.id);

                    return res.status(410).json({
                        success: false,
                        error: '此特約教室已結束'
                    });
                }

                computedSchedule = {
                    ...directSchedule,
                    computed_start_at: startAt.toISOString(),
                    computed_end_at: endAt.toISOString()
                };
            }

            const accessCheck = await verifyTutorScheduleWhitelistAccess(
                computedSchedule,
                username
            );

            if (!accessCheck.ok) {
                return res.status(accessCheck.status || 403).json({
                    success: false,
                    error: accessCheck.error,
                    accessLevel: accessCheck.accessLevel
                });
            }

            return res.json({
                success: true,
                resolved_from: 'schedule_code',
                schedule: computedSchedule
            });
        }

        // B. 找新流程：週期特約教室課程代碼
        const { data: program, error: programError } = await supabase
            .from('tutor_programs')
            .select('*')
            .eq('room_code', roomCode)
            .eq('is_public', true)
            .eq('status', 'open')
            .maybeSingle();

        if (programError) throw programError;

        if (!program) {
            return res.status(404).json({
                success: false,
                error: '找不到此特約教室，請確認代碼是否正確'
            });
        }

        if (!username) {
            return res.status(401).json({
                success: false,
                error: '此特約教室需要登入後才能進入'
            });
        }

        const { user, access } = await getTutorEntryUserAccess(username);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: '此帳號已被停用，無法進入特約教室'
            });
        }

        if (!access.canEnrollTutorProgram) {
            return res.status(403).json({
                success: false,
                error: '特約教室限 trial / pro 使用者進入。請先升級方案。',
                accessLevel: access.accessLevel
            });
        }

        if (!access.roleBypass) {
            const isEnrolled = await hasActiveTutorProgramEnrollment(
                program.id,
                username
            );

            if (!isEnrolled) {
                return res.status(403).json({
                    success: false,
                    error: '你尚未報名此特約教室，請先到課程商店報名'
                });
            }
        }

        const nextSchedule = await findNextAvailableTutorScheduleForProgram(program.id);

        if (!nextSchedule) {
            return res.status(404).json({
                success: false,
                error: '此特約教室目前沒有可進入的上課房間'
            });
        }

        return res.json({
            success: true,
            resolved_from: 'program_code',
            program,
            schedule: nextSchedule
        });

    } catch (err) {
        console.error('查詢特約教室代碼失敗:', err);

        res.status(500).json({
            success: false,
            error: '查詢特約教室代碼失敗',
            detail: err.message || String(err)
        });
    }
});

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

const targetSocketId = activeUserSockets.get(username);

if (targetSocketId) {
    io.to(targetSocketId).emit('new_notification', data);
    console.log(`🔔 已即時推送通知給 ${username}`);
}

return data;
}

function buildCourseNameFromApplication(applicationData) {
    const rawCourseInfo = String(applicationData?.course_info || '').trim();

    if (!rawCourseInfo) {
        return `${applicationData?.username || '教師'} 的線上課程`;
    }

    const firstLine = rawCourseInfo
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)[0];

    return (firstLine || rawCourseInfo).slice(0, 60);
}

function getMaxStudentsFromTeacherApplication(applicationData) {
    const rawSize = String(applicationData?.classroom_size || '').trim();
    const sizeNumber = Number(rawSize);

    if (Number.isFinite(sizeNumber) && sizeNumber > 0) {
        return sizeNumber;
    }

    return null;
}

async function createOnlineCourseFromApprovedTeacherApplication(applicationData) {
    if (!applicationData) return null;

    const teacherType = String(applicationData.teacher_type || '').trim();

    // 只讓「線上課程」申請通過後自動建立 courses。
    // 你的 courses.course_type 目前允許 google_meet / tutor_self_study。
    if (teacherType !== 'online') {
        return null;
    }

    const teacherUsername = String(applicationData.username || '').trim();

    const courseName = String(
        applicationData.course_name ||
        applicationData.course_info ||
        `${teacherUsername || '教師'} 的線上課程`
    ).trim().slice(0, 80);

    const courseSubject = String(
        applicationData.course_subject ||
        applicationData.course_name ||
        applicationData.course_info ||
        ''
    ).trim();

    const courseIntro = String(
        applicationData.course_intro ||
        applicationData.course_info ||
        applicationData.course_schedule ||
        '教師申請開設的線上課程'
    ).trim();

    const coursePrice = Number(applicationData.course_price || 0);
    const maxStudents = getMaxStudentsFromTeacherApplication(applicationData);

    if (!teacherUsername || !courseName) {
        return null;
    }

    if (!Number.isFinite(coursePrice) || coursePrice < 0) {
        throw new Error('課程價格格式錯誤');
    }

    const { data: existingCourse, error: existingCourseError } = await supabase
        .from('courses')
        .select('id, course_name, status, is_public')
        .eq('teacher_username', teacherUsername)
        .eq('course_name', courseName)
        .maybeSingle();

    if (existingCourseError) {
        throw existingCourseError;
    }

    const coursePayload = {
        teacher_username: teacherUsername,
        course_name: courseName,
        subject: courseSubject || null,
        intro: courseIntro || null,

        // 符合 courses_course_type_check
        course_type: 'google_meet',

        google_meet_url: applicationData.google_meet_url || null,
        weekly_day: applicationData.weekly_day || null,
        start_time: applicationData.start_time || null,
        class_minutes: applicationData.class_minutes ? Number(applicationData.class_minutes) : null,
        break_minutes: applicationData.break_minutes !== null && applicationData.break_minutes !== undefined && applicationData.break_minutes !== ''
            ? Number(applicationData.break_minutes)
            : null,
        total_sessions: applicationData.total_sessions ? Number(applicationData.total_sessions) : null,
        start_date: applicationData.start_date || null,
        end_date: applicationData.end_date || null,

        is_public: true,
        max_students: maxStudents || 0,
        price: Math.floor(coursePrice),
        commission_rate: 0,
        enrolled_count: 0,

        // 符合 courses_status_check
        status: 'approved'
    };

    if (existingCourse) {
        const { data: updatedCourse, error: updateCourseError } = await supabase
            .from('courses')
            .update({
                ...coursePayload,
                updated_at: new Date().toISOString()
            })
            .eq('id', existingCourse.id)
            .select()
            .single();

        if (updateCourseError) {
            throw updateCourseError;
        }

        return updatedCourse;
    }

    const courseRoomCode = await generateUniqueCourseRoomCode();

    const { data: createdCourse, error: courseCreateError } = await supabase
        .from('courses')
        .insert([{
            ...coursePayload,
            course_room_code: courseRoomCode
        }])
        .select()
        .single();

    if (courseCreateError) {
        throw courseCreateError;
    }

    return createdCourse;
}

function generateTeacherDiscountCode(username) {
    const safeName = String(username || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);

    const randomPart = Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase();

    return `TEACHER-${safeName}-${randomPart}`;
}

async function createTeacherDiscountCodeIfNotExists(username) {
    if (!username) {
        throw new Error('缺少 username，無法建立教師優惠碼');
    }

    const { data: existingCode, error: checkError } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('teacher_username', username)
        .eq('is_active', true)
        .maybeSingle();

    if (checkError) throw checkError;

    if (existingCode) {
        return existingCode;
    }

    const newCode = generateTeacherDiscountCode(username);

    const { data: createdCode, error: insertError } = await supabase
        .from('discount_codes')
        .insert([{
            code: newCode,
            teacher_username: username,
            discount_type: 'fixed',
discount_value: 150,
            is_active: true
        }])
        .select()
        .single();

    if (insertError) throw insertError;

    return createdCode;
}

// 檢查目前登入者是否為 admin
app.get('/api/admin/me', verifyAdmin, async (req, res) => {
    res.json({
        message: 'Admin 驗證成功',
        admin: req.adminUser
    });
});

// ==========================================
// Manual Transfer Admin API - 取得待審核匯款訂單
// ==========================================
app.get('/api/admin/manual-transfer-orders', verifyAdmin, async (req, res) => {
    try {
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select(`
                id,
                order_no,
                username,
                order_type,
                subscription_plan,
                subscription_months,
                original_amount,
                discount_amount,
                amount,
                status,
                provider,
                provider_status,
                provider_payload,
                created_at,
                updated_at
            `)
            .in('order_type', ['subscription', 'course'])
.eq('provider', 'manual_transfer')
.eq('status', 'pending')
.eq('provider_status', 'awaiting_manual_review')
            .order('updated_at', { ascending: false })
            .limit(100);

        if (ordersError) throw ordersError;

        const usernames = [
            ...new Set((orders || []).map(order => order.username).filter(Boolean))
        ];

        let usersByUsername = {};

        if (usernames.length > 0) {
            const { data: users, error: usersError } = await supabase
                .from('users')
                .select(`
                    username,
                    account,
                    email,
                    role,
                    membership_level,
                    is_subscribed,
                    subscription_status,
                    subscription_end_date
                `)
                .in('username', usernames);

            if (usersError) throw usersError;

            usersByUsername = (users || []).reduce((map, user) => {
                map[user.username] = user;
                return map;
            }, {});
        }

        const mappedOrders = (orders || []).map(order => {
            const transferInfo =
                order.provider_payload &&
                order.provider_payload.manual_transfer
                    ? order.provider_payload.manual_transfer
                    : {};

            return {
                ...order,
                user: usersByUsername[order.username] || null,
                transferInfo: {
    payerName: transferInfo.payer_name || '',
    accountLast5: transferInfo.account_last5 || '',
    transferAmount: transferInfo.transfer_amount || '',
    expectedAmount: transferInfo.expected_amount || order.amount || '',
    transferDate: transferInfo.transfer_date || '',
    transferTime: transferInfo.transfer_time || '',
    transferNote: transferInfo.transfer_note || '',
    submittedAt: transferInfo.submitted_at || null
}
            };
        });

        res.json({
            success: true,
            count: mappedOrders.length,
            orders: mappedOrders
        });

    } catch (err) {
        console.error('取得待審核匯款訂單失敗:', err);

        res.status(500).json({
            success: false,
            error: '取得待審核匯款訂單失敗',
            detail: err.message || String(err)
        });
    }
});

// ==========================================
// Manual Transfer Admin API - 審核通過匯款訂單
// ==========================================
app.post('/api/admin/manual-transfer-orders/:orderId/approve', verifyAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reviewNote } = req.body || {};

        if (!orderId) {
            return res.status(400).json({ error: '缺少 orderId' });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({ error: '找不到訂單' });
        }

        if (order.order_type !== 'subscription' && order.order_type !== 'course') {
    return res.status(400).json({ error: '這不是可審核的匯款訂單' });
}

        if (order.provider !== 'manual_transfer') {
            return res.status(400).json({ error: '這不是銀行匯款訂單' });
        }

        if (order.status === 'paid') {
            return res.status(400).json({ error: '此訂單已付款完成，無法重複審核通過' });
        }

        if (order.status === 'failed') {
            return res.status(400).json({ error: '此訂單已被駁回，請重新建立訂單' });
        }

        if (order.provider_status !== 'awaiting_manual_review') {
            return res.status(400).json({
                error: '此訂單尚未提交匯款資料，無法審核通過'
            });
        }

        const nowIso = new Date().toISOString();

        const nextPayload = {
            ...(order.provider_payload || {}),
            manual_review: {
                status: 'approved',
                reviewed_by: req.adminUser.username,
                reviewed_at: nowIso,
                review_note: String(reviewNote || '').trim() || null
            }
        };

        const completed = await completePaidOrderByType({
    orderId: order.id,
    expectedProvider: 'manual_transfer',
    paidAmount: Number(order.amount || 0)
});

const result = completed.result;

        const { data: finalOrder, error: finalUpdateError } = await supabase
            .from('orders')
            .update({
                provider_status: 'confirmed',
                provider_payload: nextPayload,
                payment_confirmed_at: nowIso,
                updated_at: nowIso
            })
            .eq('id', order.id)
            .select()
            .single();

        if (finalUpdateError) throw finalUpdateError;

        const approvedOrderTypeText = order.order_type === 'course'
    ? '線上課程'
    : '訂閱方案';

await createNotification({
    username: order.username,
    type: 'payment_approved',
    title: `付款已確認，${approvedOrderTypeText}已開通`,
    message: `你的${approvedOrderTypeText}訂單 ${order.order_no || order.id} 已完成匯款確認，對應服務已開通。`
});

        res.json({
    success: true,
    message: `匯款訂單已審核通過，${approvedOrderTypeText}已開通`,
    order: finalOrder,
    result
});

    } catch (err) {
        console.error('審核通過匯款訂單失敗:', err);

        res.status(500).json({
            success: false,
            error: '審核通過匯款訂單失敗',
            detail: err.message || String(err)
        });
    }
});

// ==========================================
// Manual Transfer Admin API - 駁回匯款訂單
// ==========================================
app.post('/api/admin/manual-transfer-orders/:orderId/reject', verifyAdmin, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reviewNote } = req.body || {};

        if (!orderId) {
            return res.status(400).json({ error: '缺少 orderId' });
        }

        const finalReviewNote = String(reviewNote || '').trim();

        if (!finalReviewNote) {
            return res.status(400).json({ error: '請填寫駁回原因' });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({ error: '找不到訂單' });
        }

        if (order.order_type !== 'subscription' && order.order_type !== 'course') {
    return res.status(400).json({ error: '這不是可駁回的匯款訂單' });
}

        if (order.provider !== 'manual_transfer') {
            return res.status(400).json({ error: '這不是銀行匯款訂單' });
        }

        if (order.status === 'paid') {
            return res.status(400).json({ error: '此訂單已付款完成，無法駁回' });
        }

        if (order.status === 'failed') {
            return res.status(400).json({ error: '此訂單已經被駁回' });
        }

        const nowIso = new Date().toISOString();

        const nextPayload = {
            ...(order.provider_payload || {}),
            manual_review: {
                status: 'rejected',
                reviewed_by: req.adminUser.username,
                reviewed_at: nowIso,
                review_note: finalReviewNote
            }
        };

        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update({
                status: 'failed',
                provider_status: 'rejected',
                provider_payload: nextPayload,
                payment_error: finalReviewNote,
                updated_at: nowIso
            })
            .eq('id', order.id)
            .select()
            .single();

        if (updateError) throw updateError;

        await createNotification({
            username: order.username,
            type: 'payment_rejected',
            title: '付款資料需要重新確認',
            message: `你的訂單 ${order.order_no || order.id} 匯款資料未通過審核。原因：${finalReviewNote}。請確認後重新建立訂單或聯繫客服。`
        });

        res.json({
            success: true,
            message: '匯款訂單已駁回',
            order: updatedOrder
        });

    } catch (err) {
        console.error('駁回匯款訂單失敗:', err);

        res.status(500).json({
            success: false,
            error: '駁回匯款訂單失敗',
            detail: err.message || String(err)
        });
    }
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

// ==========================================
// 取得待審核教師申請
// ==========================================
app.get('/api/admin/teacher-applications', verifyAdmin, async (req, res) => {

    try {

        const { data, error } = await supabase
            .from('teacher_applications')
.select('*')
.eq('status', 'pending')
.order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            applications: data || []
        });

    } catch (err) {

        console.error('取得教師申請失敗:', err);

        res.status(500).json({
            error: '取得教師申請失敗'
        });
    }
});

// ==========================================
// 批准教師申請
// ==========================================
app.post('/api/admin/approve-teacher', verifyAdmin, async (req, res) => {

    try {

        const {
            applicationId,
            username,
            adminUsername
        } = req.body;

        if (!applicationId || !username) {
            return res.status(400).json({
                error: '缺少申請資料'
            });
        }

        // 先找申請資料
const { data: applicationData, error: appFindError } = await supabase
    .from('teacher_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

if (appFindError || !applicationData) {
    return res.status(404).json({
        error: '找不到教師申請'
    });
}

// 更新 users
const { error: userError } = await supabase
    .from('users')
    .update({
    role: 'teacher',
    teacher_application_status: 'approved',
    teacher_status: 'approved',
    teacher_reviewed_at: new Date().toISOString()
})
    .eq('username', applicationData.username);

        if (userError) {
            throw userError;
        }

        // 更新 teacher_applications
        const { error: appError } = await supabase
            .from('teacher_applications')
            .update({
                status: 'approved',
                reviewed_at: new Date().toISOString(),
                reviewed_by: adminUsername || 'admin'
            })
            .eq('id', applicationId);

                if (appError) {
            throw appError;
        }

        let createdOnlineCourse = null;

        try {
            createdOnlineCourse =
                await createOnlineCourseFromApprovedTeacherApplication(applicationData);
        } catch (courseCreateError) {
            console.error('⚠️ 教師已通過，但自動建立線上課程失敗:', courseCreateError);

            return res.status(500).json({
                error: '教師已通過，但自動建立線上課程失敗',
                detail: courseCreateError.message || String(courseCreateError)
            });
        }

        // 建立教師封測優惠碼
const discountCode = await createTeacherDiscountCodeIfNotExists(applicationData.username);

// 發站內通知
await createNotification({
    username: applicationData.username,
    type: 'teacher_approved',
    title: '教師申請已通過',
    message: `恭喜！您的教師申請已通過，現在可以建立特約教室與課程。你的封測專屬優惠碼是：${discountCode.code}`
});

res.json({
    success: true,
    discountCode: discountCode.code,
    course: createdOnlineCourse,
    message: createdOnlineCourse
        ? '教師申請已通過，並已建立線上課程'
        : '教師申請已通過'
});

    } catch (err) {

        console.error('批准教師失敗:', err);

        res.status(500).json({
            error: '批准教師失敗'
        });
    }
});

// ==========================================
// 拒絕教師申請
// ==========================================
app.post('/api/admin/reject-teacher', verifyAdmin, async (req, res) => {

    try {

        const {
    applicationId,
    username,
    adminUsername,
    reviewNote
} = req.body;

        if (!applicationId || !username) {
            return res.status(400).json({
                error: '缺少申請資料'
            });
        }

        // 先找申請資料
const { data: applicationData, error: appFindError } = await supabase
    .from('teacher_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

if (appFindError || !applicationData) {
    return res.status(404).json({
        error: '找不到教師申請'
    });
}

const { error: userError } = await supabase
    .from('users')
    .update({
        teacher_application_status: 'rejected',

// 舊系統兼容
teacher_status: 'rejected'
    })
    .eq('username', applicationData.username);

        if (userError) {
            throw userError;
        }

        // 更新 teacher_applications
        const { error: appError } = await supabase
            .from('teacher_applications')
            .update({
                status: 'rejected',
                reviewed_at: new Date().toISOString(),
                reviewed_by: adminUsername || 'admin'
            })
            .eq('id', applicationId);

        if (appError) {
            throw appError;
        }

        // 發通知
        const finalReviewNote = String(reviewNote || '').trim();

await createNotification({
    username: applicationData.username,
    type: 'teacher_rejected',
    title: '教師申請未通過',
    message: finalReviewNote
        ? `很抱歉，您的教師申請未通過。原因：${finalReviewNote}。請重新調整課程資訊後再次申請。`
        : '很抱歉，您的教師申請未通過，請重新調整課程資訊後再次申請。'
});

        res.json({
            success: true
        });

    } catch (err) {

        console.error('拒絕教師失敗:', err);

        res.status(500).json({
            error: '拒絕教師失敗'
        });
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

        const trialFields = buildNewStudentTrialFields();

const { error } = await supabase.from('users').insert([{ 
    username: String(username), 
    account: String(account),
    password: String(password),
    total_seconds: 0, 
    streak: 1, 
    last_login: today, 
    role: 'student', 
    integrity_score: 100,
    link_code: newLinkCode,
    ...trialFields
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

    courseName,
    courseSubject,
    courseInfo,
    coursePrice,
    weeklyDay,
    startDate,
    endDate,
    startTime,
    totalSessions,
    classMinutes,
    breakMinutes,
    googleMeetUrl,

    courseSchedule
} = req.body;

        // 基本檢查
        if (
    !username ||
    !email ||
    !account ||
    !password ||
    !teacherType ||
    !courseName ||
    !courseSubject ||
    !courseInfo ||
    coursePrice === undefined ||
    coursePrice === null ||
    String(coursePrice).trim() === '' ||
    !weeklyDay ||
    !startDate ||
    !endDate ||
    !startTime ||
    !totalSessions ||
    !classMinutes ||
    breakMinutes === undefined ||
    breakMinutes === null ||
    String(breakMinutes).trim() === ''
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
                teacher_status: 'pending',

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

        course_name: courseName,
        course_subject: courseSubject,
        course_intro: courseInfo,
        course_price: Number(coursePrice || 0),
        weekly_day: weeklyDay,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime,
        total_sessions: Number(totalSessions || 0),
        class_minutes: Number(classMinutes || 0),
        break_minutes: Number(breakMinutes || 0),
        google_meet_url: googleMeetUrl || null,

        // 保留舊欄位相容後台舊顯示
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

    courseName,
    courseSubject,
    courseInfo,
    coursePrice,
    weeklyDay,
    startDate,
    endDate,
    startTime,
    totalSessions,
    classMinutes,
    breakMinutes,
    googleMeetUrl,

    courseSchedule
} = req.body;

        if (
    !username ||
    !email ||
    !teacherType ||
    !courseName ||
    !courseSubject ||
    !courseInfo ||
    coursePrice === undefined ||
    coursePrice === null ||
    String(coursePrice).trim() === '' ||
    !weeklyDay ||
    !startDate ||
    !endDate ||
    !startTime ||
    !totalSessions ||
    !classMinutes ||
    breakMinutes === undefined ||
    breakMinutes === null ||
    String(breakMinutes).trim() === ''
) {
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

        course_name: courseName,
        course_subject: courseSubject,
        course_intro: courseInfo,
        course_price: Number(coursePrice || 0),
        weekly_day: weeklyDay,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime,
        total_sessions: Number(totalSessions || 0),
        class_minutes: Number(classMinutes || 0),
        break_minutes: Number(breakMinutes || 0),
        google_meet_url: googleMeetUrl || null,

        // 保留舊欄位相容
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
    const username = normalizeUsername(req.query.username);

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
    const username = normalizeUsername(req.query.username);
const sessionId = String(req.query.sessionId || '').trim();

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

app.post('/api/subscription/intro-seen', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({
            error: '缺少 username'
        });
    }

    try {
        const { data: user, error: findError } = await supabase
            .from('users')
            .select('username, role, is_blocked')
            .eq('username', username)
            .maybeSingle();

        if (findError) throw findError;

        if (!user) {
            return res.status(404).json({
                error: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                error: '此帳號已被停用'
            });
        }

        const { error: updateError } = await supabase
            .from('users')
            .update({
                has_seen_subscription_intro: true
            })
            .eq('username', username);

        if (updateError) throw updateError;

        res.json({
            success: true,
            message: '訂閱方案介紹已標記為看過',
            username
        });

    } catch (err) {
        console.error('訂閱方案介紹紀錄失敗:', err);

        res.status(500).json({
            error: '訂閱方案介紹紀錄失敗',
            detail: err.message
        });
    }
});

function generateOrderNo() {
    const datePart = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14);

    const randomPart = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    return `SV${datePart}${randomPart}`;
}

function calculateDiscount(originalAmount, discountCode) {
    if (!discountCode) {
        return 0;
    }

    if (discountCode.discount_type === 'percent') {
        return Math.floor(originalAmount * Number(discountCode.discount_value || 0) / 100);
    }

    if (discountCode.discount_type === 'fixed') {
        return Number(discountCode.discount_value || 0);
    }

    return 0;
}

const SUBSCRIPTION_PLANS = {
    monthly: {
        id: 'monthly',
        name: '月繳方案',
        amount: 300,
        months: 1
    },
    two_months: {
        id: 'two_months',
        name: '2 個月方案',
        amount: 500,
        months: 2
    },
    half_year: {
        id: 'half_year',
        name: '半年方案',
        amount: 1400,
        months: 6
    },
    yearly: {
        id: 'yearly',
        name: '年繳方案',
        amount: 2500,
        months: 12
    }
};

const SUBSCRIPTION_TEACHER_DISCOUNT_AMOUNT = 150;

const PAYMENT_PROVIDERS = {
    mock: 'mock',
    manual_transfer: 'manual_transfer',
    linepay: 'linepay',
    jkopay: 'jkopay',
    credit_card: 'credit_card'
};

function getSubscriptionPlan(planId) {
    const cleanPlanId = String(planId || 'monthly').trim();

    return SUBSCRIPTION_PLANS[cleanPlanId] || SUBSCRIPTION_PLANS.monthly;
}

function normalizePaymentProvider(provider) {
    const cleanProvider = String(provider || 'mock').trim();

    if (PAYMENT_PROVIDERS[cleanProvider]) {
        return cleanProvider;
    }

    return 'mock';
}

app.get('/api/subscription/status', async (req, res) => {
    try {
        const username = normalizeUsername(req.query.username);

        if (!username) {
            return res.status(400).json({
                is_subscribed: false,
                accessLevel: 'free',
                canUseFullFeatures: false,
                error: '缺少 username'
            });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select(`
                username,
                role,
                membership_level,
                is_subscribed,
                subscription_status,
                subscription_started_at,
                subscription_end_date,
                trial_started_at,
                trial_ends_at,
                has_seen_subscription_intro,
                is_blocked
            `)
            .eq('username', username)
            .maybeSingle();

        if (error) throw error;

        if (!user) {
            return res.status(404).json({
                is_subscribed: false,
                accessLevel: 'free',
                canUseFullFeatures: false,
                error: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                username: user.username,
                is_subscribed: false,
                accessLevel: 'free',
                canUseFullFeatures: false,
                is_blocked: true,
                error: '此帳號已被停用'
            });
        }

        const role = user.role || 'student';

        // 教師 / 管理員 / 審核中教師先維持原本邏輯，不受學生訂閱權限影響
        if (role === 'teacher' || role === 'admin' || role === 'teacher_pending') {
            return res.json({
                username: user.username,
                role,
                membership_level: user.membership_level || 'staff',
                is_subscribed: true,
                subscription_status: user.subscription_status || 'role_bypass',
                subscription_started_at: user.subscription_started_at,
                subscription_end_date: user.subscription_end_date,
                trial_started_at: user.trial_started_at,
                trial_ends_at: user.trial_ends_at,
                has_seen_subscription_intro: user.has_seen_subscription_intro === true,
                accessLevel: 'pro',
                canUseFullFeatures: true,
                role_bypass: true
            });
        }

        const now = Date.now();

        const subscriptionEndTime = user.subscription_end_date
            ? new Date(user.subscription_end_date).getTime()
            : 0;

        const trialEndTime = user.trial_ends_at
            ? new Date(user.trial_ends_at).getTime()
            : 0;

        const hasActiveSubscription =
            user.is_subscribed === true &&
            user.subscription_status === 'active' &&
            subscriptionEndTime > now;

        const hasActiveTrial =
            trialEndTime > now;

        const hasAnyExpiredAccessRecord =
    !!user.trial_ends_at ||
    !!user.subscription_end_date ||
    user.subscription_status === 'active' ||
    user.subscription_status === 'expired';

const shouldSyncExpiredToDatabase =
    !hasActiveSubscription &&
    !hasActiveTrial &&
    hasAnyExpiredAccessRecord &&
    (
        user.membership_level !== 'free' ||
        user.is_subscribed !== false ||
        user.subscription_status !== 'expired'
    );

if (shouldSyncExpiredToDatabase) {
    const { error: syncExpiredError } = await supabase
        .from('users')
        .update({
            membership_level: 'free',
            is_subscribed: false,
            subscription_status: 'expired'
        })
        .eq('username', user.username);

    if (syncExpiredError) {
        console.error('同步過期訂閱狀態失敗:', syncExpiredError);
    } else {
        console.log(`✅ 已同步過期訂閱狀態為免費版: ${user.username}`);
    }
}

        let accessLevel = 'free';
        let canUseFullFeatures = false;

        if (hasActiveSubscription) {
            accessLevel = 'pro';
            canUseFullFeatures = true;
        } else if (hasActiveTrial) {
            accessLevel = 'trial';
            canUseFullFeatures = true;
        } else if (user.trial_ends_at || user.subscription_end_date) {
            accessLevel = 'expired';
            canUseFullFeatures = false;
        } else {
            accessLevel = 'free';
            canUseFullFeatures = false;
        }

        res.json({
            username: user.username,
            role,
            membership_level: accessLevel === 'pro'
                ? 'pro'
                : accessLevel === 'trial'
                    ? 'trial'
                    : 'free',

            is_subscribed: hasActiveSubscription,
            subscription_status: hasActiveSubscription
    ? 'active'
    : shouldSyncExpiredToDatabase || accessLevel === 'expired'
        ? 'expired'
        : (user.subscription_status || 'none'),

            subscription_started_at: user.subscription_started_at,
            subscription_end_date: user.subscription_end_date,
            trial_started_at: user.trial_started_at,
            trial_ends_at: user.trial_ends_at,
            has_seen_subscription_intro: user.has_seen_subscription_intro === true,

            accessLevel,
            canUseFullFeatures
        });

    } catch (err) {
        console.error('取得訂閱狀態失敗:', err);

        res.status(500).json({
            is_subscribed: false,
            accessLevel: 'free',
            canUseFullFeatures: false,
            error: '取得訂閱狀態失敗',
            detail: err.message
        });
    }
});

app.post('/api/subscription/create-order', async (req, res) => {
    try {
        const {
            username,
            discountCode,
            planId = 'monthly',
            provider = 'mock'
        } = req.body;

        if (!username) {
            return res.status(400).json({
                error: '缺少 username'
            });
        }

        const selectedPlan = getSubscriptionPlan(planId);
        const paymentProvider = normalizePaymentProvider(provider);

        // 封測階段：允許銀行匯款人工開通；保留 mock 供開發測試使用
const allowedSubscriptionProviders = ['manual_transfer', 'mock'];

if (!allowedSubscriptionProviders.includes(paymentProvider)) {
    return res.status(400).json({
        error: '目前付費方式僅支援銀行匯款與人工開通',
        provider: paymentProvider
    });
}

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('username, role, is_blocked')
            .eq('username', username)
            .maybeSingle();

        if (userError) throw userError;

        if (!user) {
            return res.status(404).json({
                error: '找不到使用者'
            });
        }

        if (user.is_blocked) {
            return res.status(403).json({
                error: '此帳號已被停用，無法訂閱'
            });
        }

        let validDiscountCode = null;

        if (discountCode) {
            const cleanCode = String(discountCode).trim().toUpperCase();

            const { data: codeData, error: codeError } = await supabase
                .from('discount_codes')
                .select('*')
                .eq('code', cleanCode)
                .eq('is_active', true)
                .maybeSingle();

            if (codeError) throw codeError;

            if (!codeData) {
                return res.status(400).json({
                    error: '優惠碼不存在或已停用'
                });
            }

            if (
                codeData.expires_at &&
                new Date(codeData.expires_at).getTime() < Date.now()
            ) {
                return res.status(400).json({
                    error: '優惠碼已過期'
                });
            }

            validDiscountCode = codeData;
        }

        const originalAmount = Number(selectedPlan.amount || 0);

        // 教師優惠碼規則：不管選哪個方案，一律折 150 元
        let discountAmount = validDiscountCode
            ? SUBSCRIPTION_TEACHER_DISCOUNT_AMOUNT
            : 0;

        if (discountAmount > originalAmount) {
            discountAmount = originalAmount;
        }

        const amount = Math.max(originalAmount - discountAmount, 0);
        const orderNo = generateOrderNo();

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([{
                order_no: orderNo,
                username,
                course_id: null,
                discount_code_id: validDiscountCode ? validDiscountCode.id : null,
                original_amount: originalAmount,
                discount_amount: discountAmount,
                amount,
                status: 'pending',
                order_type: 'subscription',
                subscription_plan: selectedPlan.id,
                subscription_months: selectedPlan.months,
                provider: paymentProvider,
provider_status: paymentProvider === 'manual_transfer'
    ? 'awaiting_transfer_info'
    : 'pending',
provider_order_id: null,
provider_payment_id: null,
payment_url: null,
paid_at: null
            }])
            .select()
            .single();

        if (orderError) throw orderError;

        res.json({
            success: true,
            order,
            subscription: {
                planId: selectedPlan.id,
                planName: selectedPlan.name,
                months: selectedPlan.months,
                originalAmount,
                discountAmount,
                amount,
                isFreeCheckout: amount === 0
            },
            payment: {
    provider: paymentProvider,
    paymentUrl: null,
    nextAction: paymentProvider === 'manual_transfer'
        ? 'show_transfer_info'
        : 'mock_confirm'
}
        });

    } catch (err) {
        console.error('建立訂閱訂單失敗:', err);

        res.status(500).json({
            error: '建立訂閱訂單失敗',
            detail: err.message
        });
    }
});

// ==========================================
// Manual Transfer - 提交匯款資料
// 學生送出匯款資料後，只改成等待人工審核，不自動開通
// ==========================================
app.post('/api/subscription/submit-transfer-info', async (req, res) => {
    try {
        const {
    username,
    orderId,
    payerName,
    accountLast5,
    transferAmount,
    transferDate,
    transferNote
} = req.body;

        const finalUsername = String(username || '').trim();
        const finalOrderId = String(orderId || '').trim();
        const finalPayerName = String(payerName || '').trim();
        const finalAccountLast5 = String(accountLast5 || '').trim();
const finalTransferAmount = String(transferAmount || '').trim();
const finalTransferDate = String(transferDate || '').trim();
const finalTransferNote = String(transferNote || '').trim();

        if (!finalUsername) {
            return res.status(400).json({ error: '缺少 username' });
        }

        if (!finalOrderId) {
            return res.status(400).json({ error: '缺少訂單 ID' });
        }

        if (!finalPayerName) {
            return res.status(400).json({ error: '請填寫匯款人姓名' });
        }

        if (!/^[0-9]{5}$/.test(finalAccountLast5)) {
            return res.status(400).json({ error: '請填寫匯款帳號後五碼，且必須是 5 位數字' });
        }

        if (!/^[0-9]+$/.test(finalTransferAmount)) {
    return res.status(400).json({ error: '請填寫正確的實際匯款金額' });
}

if (!finalTransferDate) {
    return res.status(400).json({ error: '請選擇匯款日期' });
}

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', finalOrderId)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({ error: '找不到訂單' });
        }

        if (order.username !== finalUsername) {
            return res.status(403).json({ error: '訂單使用者不符' });
        }

        if (order.order_type !== 'subscription' && order.order_type !== 'course') {
    return res.status(400).json({ error: '這不是可提交匯款資料的訂單' });
}

        if (order.provider !== 'manual_transfer') {
    return res.status(400).json({ error: '此訂單不是銀行匯款訂單' });
}

if (order.status === 'paid') {
    return res.status(400).json({ error: '此訂單已付款完成，無法重複提交匯款資料' });
}

if (order.status === 'failed') {
    return res.status(400).json({ error: '此訂單已失敗或被駁回，請重新建立訂單' });
}

const expectedAmount = Number(order.amount || 0);
const submittedAmount = Number(finalTransferAmount);

if (submittedAmount !== expectedAmount) {
    return res.status(400).json({
        error: `匯款金額與訂單金額不符，訂單金額為 NT$${expectedAmount}`
    });
}

const nowIso = new Date().toISOString();

        const nextProviderPayload = {
            ...(order.provider_payload || {}),
            manual_transfer: {
    payer_name: finalPayerName,
    account_last5: finalAccountLast5,
    transfer_amount: submittedAmount,
    expected_amount: expectedAmount,
    transfer_date: finalTransferDate,
    transfer_note: finalTransferNote || null,
    submitted_at: nowIso
}
        };

        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update({
                provider_status: 'awaiting_manual_review',
                provider_payload: nextProviderPayload,
                updated_at: nowIso
            })
            .eq('id', order.id)
            .select()
            .single();

        if (updateError) throw updateError;

        try {
    const orderTypeText = order.order_type === 'course'
    ? '線上課程'
    : '訂閱方案';

await createNotification({
    username: finalUsername,
    type: 'payment_transfer_submitted',
    title: '匯款資料已送出',
    message: `你的${orderTypeText}訂單 ${order.order_no || order.id} 匯款資料已送出，客服將於 1 至 2 個工作天內確認。確認完成後會開通對應服務。`
});
} catch (notificationError) {
    console.error('⚠️ 匯款資料已提交，但建立通知失敗:', notificationError);
}

res.json({
    success: true,
    order: updatedOrder,
    message: '匯款資料已送出，等待客服人工審核'
});

    } catch (err) {
        console.error('提交匯款資料失敗:', err);

        res.status(500).json({
            error: '提交匯款資料失敗',
            detail: err.message || String(err)
        });
    }
});

async function activateSubscriptionByOrder(orderId) {
    if (!orderId) {
        throw new Error('缺少 orderId');
    }

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
        throw new Error('找不到訂閱訂單');
    }

    if (order.order_type !== 'subscription') {
        throw new Error('這不是訂閱訂單');
    }

    if (order.status === 'paid') {
        const { data: existingUser } = await supabase
            .from('users')
            .select('username, is_subscribed, subscription_status, subscription_end_date')
            .eq('username', order.username)
            .maybeSingle();

        return {
            alreadyPaid: true,
            order,
            user: existingUser
        };
    }

    const now = new Date();

    const { data: currentUser, error: currentUserError } = await supabase
        .from('users')
        .select('username, subscription_started_at, subscription_end_date')
        .eq('username', order.username)
        .maybeSingle();

    if (currentUserError) throw currentUserError;

    const currentEndTime = currentUser?.subscription_end_date
        ? new Date(currentUser.subscription_end_date).getTime()
        : 0;

    const baseDate = currentEndTime > now.getTime()
        ? new Date(currentEndTime)
        : now;

    const endDate = new Date(baseDate);
    endDate.setMonth(endDate.getMonth() + Number(order.subscription_months || 1));

    const { error: orderUpdateError } = await supabase
        .from('orders')
        .update({
            status: 'paid',
            paid_at: now.toISOString(),
            updated_at: now.toISOString()
        })
        .eq('id', order.id);

    if (orderUpdateError) throw orderUpdateError;

    const { data: updatedUser, error: userUpdateError } = await supabase
        .from('users')
        .update({
            membership_level: 'pro',
            is_subscribed: true,
            subscription_status: 'active',
            subscription_started_at: currentUser?.subscription_started_at || now.toISOString(),
            subscription_end_date: endDate.toISOString()
        })
        .eq('username', order.username)
        .select('username, membership_level, is_subscribed, subscription_status, subscription_started_at, subscription_end_date')
        .maybeSingle();

    if (userUpdateError) throw userUpdateError;

    return {
        alreadyPaid: false,
        order: {
            ...order,
            status: 'paid',
            paid_at: now.toISOString()
        },
        user: updatedUser
    };
}

app.post('/api/subscription/free-complete', async (req, res) => {
    try {
        const { username, orderId } = req.body;

        if (!username || !orderId) {
            return res.status(400).json({
                error: '缺少 username 或 orderId'
            });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .eq('username', username)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({
                error: '找不到訂閱訂單'
            });
        }

        if (order.order_type !== 'subscription') {
            return res.status(400).json({
                error: '這不是訂閱訂單'
            });
        }

        if (Number(order.amount || 0) !== 0) {
            return res.status(400).json({
                error: '此訂單不是免費封測訂閱訂單'
            });
        }

        const completed = await completePaidOrderByType({
    orderId,
    expectedUsername: username
});

const result = completed.result;

        res.json({
            success: true,
            message: '免費封測訂閱成功',
            result
        });

    } catch (err) {
        console.error('免費封測訂閱失敗:', err);

        res.status(500).json({
            error: '免費封測訂閱失敗',
            detail: err.message
        });
    }
});

app.post('/api/subscription/mock-paid', async (req, res) => {
    try {
        const { username, orderId } = req.body;

        if (!username || !orderId) {
            return res.status(400).json({
                error: '缺少 username 或 orderId'
            });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .eq('username', username)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({
                error: '找不到訂閱訂單'
            });
        }

        if (order.order_type !== 'subscription') {
            return res.status(400).json({
                error: '這不是訂閱訂單'
            });
        }

        if (order.provider !== 'mock') {
            return res.status(400).json({
                error: '此訂單不是 mock 付款訂單'
            });
        }

        await markOrderProviderStatus({
    orderId,
    providerStatus: 'confirmed',
    providerPayload: {
        provider: 'mock',
        type: 'subscription',
        confirmedAt: new Date().toISOString()
    }
});

const completed = await completePaidOrderByType({
    orderId,
    expectedUsername: username,
    expectedProvider: 'mock',
    providerPaymentId: `mock-sub-${orderId}`,
    paidAmount: Number(order.amount || 0)
});

const result = completed.result;

        res.json({
            success: true,
            message: 'mock 訂閱付款成功，已開通訂閱',
            result
        });

    } catch (err) {
        console.error('mock 訂閱付款失敗:', err);

        res.status(500).json({
            error: 'mock 訂閱付款失敗',
            detail: err.message
        });
    }
});

app.post('/api/checkout/create-order', async (req, res) => {
    try {
        const { username, courseId } = req.body;

        if (!username || !courseId) {
            return res.status(400).json({
                error: '缺少 username 或 courseId'
            });
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('username, is_blocked')
            .eq('username', username)
            .maybeSingle();

        if (userError) throw userError;

        if (!user) {
            return res.status(404).json({ error: '找不到使用者' });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: '此帳號已被停用，無法結帳' });
        }

        // 課程購買目前開放給 free / trial / pro。
// 只要帳號存在、未被停用，且課程開放，就可以建立課程訂單。
// 主題教室、小隊共學、特約教室仍由前端訂閱鎖控制。

        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('id, course_name, price, status')
            .eq('id', courseId)
            .maybeSingle();

        if (courseError) throw courseError;

        if (!course) {
            return res.status(404).json({ error: '找不到課程' });
        }

        if (course.status !== 'approved' && course.status !== 'active') {
            return res.status(400).json({ error: '此課程尚未開放結帳' });
        }

        const { data: existingEnrollment, error: enrollCheckError } = await supabase
            .from('course_enrollments')
            .select('id')
            .eq('username', username)
            .eq('course_id', courseId)
            .maybeSingle();

        if (enrollCheckError) throw enrollCheckError;

        if (existingEnrollment) {
            return res.status(400).json({
                error: '你已經加入過這門課'
            });
        }

        const { data: existingPendingOrder, error: pendingOrderError } = await supabase
    .from('orders')
    .select('id, order_no, status, provider_status, amount, created_at')
    .eq('username', username)
    .eq('course_id', courseId)
    .eq('order_type', 'course')
    .eq('provider', 'manual_transfer')
    .eq('status', 'pending')
    .in('provider_status', [
        'awaiting_transfer_info',
        'awaiting_manual_review'
    ])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

if (pendingOrderError) throw pendingOrderError;

if (existingPendingOrder) {
    return res.status(409).json({
        success: false,
        pendingPayment: true,
        order: existingPendingOrder,
        error: existingPendingOrder.provider_status === 'awaiting_manual_review'
            ? '你已經提交過此課程的匯款資料，正在等待人工審核，請勿重複購買。'
            : '你已經建立過此課程的匯款訂單，請完成匯款並提交資料，請勿重複建立訂單。'
    });
}

        const originalAmount = Number(course.price || 0);
        const discountAmount = 0;
        const amount = originalAmount;
        const orderNo = generateOrderNo();

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([{
                order_no: orderNo,
                username,
                course_id: courseId,
                discount_code_id: null,
                original_amount: originalAmount,
                discount_amount: discountAmount,
                amount,
                status: 'pending',
                order_type: 'course',
subscription_plan: null,
subscription_months: null,
provider: amount === 0 ? 'free' : 'manual_transfer',
provider_status: amount === 0 ? 'free_checkout' : 'awaiting_transfer_info',
provider_order_id: null,
provider_payment_id: null,
payment_url: null,
paid_at: null
            }])
            .select()
            .single();

        if (orderError) throw orderError;

        res.json({
            success: true,
            course: {
                id: course.id,
                course_name: course.course_name,
                price: originalAmount
            },
            order,
            payment: {
    provider: amount === 0 ? 'free' : 'manual_transfer',
    originalAmount,
    discountAmount,
    amount,
    isFreeCheckout: amount === 0,
    nextAction: amount === 0
        ? 'free_complete'
        : 'show_transfer_info'
}
        });

    } catch (err) {
        console.error('建立課程訂單失敗:', err);

        res.status(500).json({
            error: '建立課程訂單失敗',
            detail: err.message
        });
    }
});

async function handlePaymentSuccess(orderId) {
    if (!orderId) {
        throw new Error('缺少 orderId');
    }

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
        throw new Error('找不到訂單');
    }

    if (order.status === 'paid') {
        const { data: enrollment } = await supabase
            .from('course_enrollments')
            .select('*')
            .eq('username', order.username)
            .eq('course_id', order.course_id)
            .maybeSingle();

        return {
            alreadyPaid: true,
            order,
            enrollment
        };
    }

    const { error: updateOrderError } = await supabase
        .from('orders')
        .update({
            status: 'paid',
            updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

    if (updateOrderError) throw updateOrderError;

    const { data: existingEnrollment, error: enrollCheckError } = await supabase
        .from('course_enrollments')
        .select('*')
        .eq('username', order.username)
        .eq('course_id', order.course_id)
        .maybeSingle();

    if (enrollCheckError) throw enrollCheckError;

    let enrollment = existingEnrollment;

    if (!existingEnrollment) {
        const { data: newEnrollment, error: enrollError } = await supabase
            .from('course_enrollments')
            .insert([{
                username: order.username,
                course_id: order.course_id,
                order_id: order.id
            }])
            .select()
            .single();

        if (enrollError) throw enrollError;

        enrollment = newEnrollment;
    }

    const { data: updatedOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    return {
        alreadyPaid: false,
        order: updatedOrder || {
            ...order,
            status: 'paid'
        },
        enrollment
    };
}

async function completePaidOrderByType({
    orderId,
    expectedUsername = null,
    expectedProvider = null,
    providerOrderId = null,
    providerPaymentId = null,
    paidAmount = null
}) {
    if (!orderId) {
        throw new Error('缺少 orderId');
    }

    const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
        throw new Error('找不到訂單');
    }

    if (expectedUsername && order.username !== expectedUsername) {
        throw new Error('訂單使用者不符');
    }

    if (expectedProvider && order.provider !== expectedProvider) {
        throw new Error(`訂單付款 provider 不符，預期 ${expectedProvider}，實際 ${order.provider || '未設定'}`);
    }

    if (paidAmount !== null && paidAmount !== undefined) {
        const expectedAmount = Number(order.amount || 0);
        const actualAmount = Number(paidAmount);

        if (!Number.isFinite(actualAmount)) {
            throw new Error('付款金額格式錯誤');
        }

        if (actualAmount !== expectedAmount) {
            throw new Error(`付款金額不符，訂單金額 ${expectedAmount}，實付金額 ${actualAmount}`);
        }
    }

    const providerUpdates = {
        updated_at: new Date().toISOString()
    };

    if (providerOrderId) {
        providerUpdates.provider_order_id = String(providerOrderId);
    }

    if (providerPaymentId) {
        providerUpdates.provider_payment_id = String(providerPaymentId);
    }

    if (providerOrderId || providerPaymentId) {
        const { error: providerUpdateError } = await supabase
            .from('orders')
            .update(providerUpdates)
            .eq('id', order.id);

        if (providerUpdateError) throw providerUpdateError;
    }

    if (order.order_type === 'subscription') {
        const result = await activateSubscriptionByOrder(order.id);

        return {
            orderType: 'subscription',
            result
        };
    }

    if (order.order_type === 'course') {
        const result = await handlePaymentSuccess(order.id);

        return {
            orderType: 'course',
            result
        };
    }

    throw new Error(`不支援的訂單類型：${order.order_type}`);
}

async function markOrderProviderStatus({
    orderId,
    providerStatus,
    providerPayload = null,
    paymentError = null
}) {
    if (!orderId) {
        throw new Error('缺少 orderId');
    }

    const updates = {
        provider_status: providerStatus,
        updated_at: new Date().toISOString()
    };

    if (providerPayload !== null && providerPayload !== undefined) {
        updates.provider_payload = providerPayload;
    }

    if (paymentError) {
        updates.payment_error = String(paymentError);
    }

    if (providerStatus === 'confirmed') {
        updates.payment_confirmed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId)
        .select('*')
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error('找不到要更新 provider 狀態的訂單');
    }

    return data;
}

app.post('/api/checkout/mock-course-paid', async (req, res) => {
    try {
        const { username, orderId } = req.body;

        if (!username || !orderId) {
            return res.status(400).json({
                error: '缺少 username 或 orderId'
            });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .eq('username', username)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({
                error: '找不到課程訂單'
            });
        }

        if (order.order_type !== 'course') {
            return res.status(400).json({
                error: '這不是單堂課程訂單'
            });
        }

        await markOrderProviderStatus({
    orderId,
    providerStatus: 'confirmed',
    providerPayload: {
        provider: 'mock',
        type: 'course',
        confirmedAt: new Date().toISOString()
    }
});

const completed = await completePaidOrderByType({
    orderId,
    expectedUsername: username,
    providerPaymentId: `mock-course-${orderId}`,
    paidAmount: Number(order.amount || 0)
});

const result = completed.result;

        res.json({
            success: true,
            message: '模擬付款成功，已加入課程',
            result
        });

    } catch (err) {
        console.error('模擬課程付款失敗:', err);

        res.status(500).json({
            error: '模擬課程付款失敗',
            detail: err.message
        });
    }
});

app.post('/api/checkout/free-complete', async (req, res) => {
    try {
        const { orderId, username } = req.body;

        if (!orderId || !username) {
            return res.status(400).json({
                error: '缺少 orderId 或 username'
            });
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .eq('username', username)
            .maybeSingle();

        if (orderError) throw orderError;

        if (!order) {
            return res.status(404).json({
                error: '找不到訂單'
            });
        }

        if (Number(order.amount || 0) !== 0) {
            return res.status(400).json({
                error: '此訂單不是免費封測訂單，不能直接完成'
            });
        }

        const completed = await completePaidOrderByType({
            orderId,
            expectedUsername: username
        });

        const result = completed.result;

        res.json({
            success: true,
            message: '免費封測加入課程成功',
            result
        });

    } catch (err) {
        console.error('免費封測通關失敗:', err);

        res.status(500).json({
            error: '免費封測通關失敗',
            detail: err.message
        });
    }
});

app.get('/api/courses/enrolled', async (req, res) => {
    try {
        const username = req.query.username;

        if (!username) {
            return res.status(400).json({
                error: '缺少 username'
            });
        }

        const { data, error } = await supabase
            .from('course_enrollments')
            .select(`
                id,
                joined_at,
                course_id,
                courses (
                    id,
                    teacher_username,
                    course_name,
                    subject,
                    intro,
                    course_type,
                    google_meet_url,
                    weekly_day,
                    start_time,
                    class_minutes,
                    break_minutes,
                    total_sessions,
                    start_date,
                    end_date,
                    course_room_code,
                    status,
                    price
                )
            `)
            .eq('username', username)
            .order('joined_at', { ascending: false });

        if (error) throw error;

        const courses = (data || [])
            .filter(row => row.courses)
            .map(row => ({
                enrollment_id: row.id,
                joined_at: row.joined_at,
                ...row.courses
            }));

        res.json({
            success: true,
            courses
        });

    } catch (err) {
        console.error('取得已加入課程失敗:', err);

        res.status(500).json({
            error: '取得已加入課程失敗',
            detail: err.message
        });
    }
});

app.get('/api/courses/can-enter', async (req, res) => {
    try {
        const { username, courseId } = req.query;

        if (!username || !courseId) {
            return res.status(400).json({
                canEnter: false,
                error: '缺少 username 或 courseId'
            });
        }

        const { data: course, error: courseError } = await supabase
            .from('courses')
            .select('id, course_name, status, course_room_code')
            .eq('id', courseId)
            .maybeSingle();

        if (courseError) throw courseError;

        if (!course) {
            return res.status(404).json({
                canEnter: false,
                error: '找不到課程'
            });
        }

        if (course.status !== 'approved' && course.status !== 'active') {
            return res.status(403).json({
                canEnter: false,
                error: '此課程尚未開放'
            });
        }

        const { data: enrollment, error: enrollmentError } = await supabase
            .from('course_enrollments')
            .select('id')
            .eq('username', username)
            .eq('course_id', courseId)
            .maybeSingle();

        if (enrollmentError) throw enrollmentError;

        if (!enrollment) {
            return res.status(403).json({
                canEnter: false,
                needCheckout: true,
                course,
                error: '尚未加入此課程，請先完成結帳'
            });
        }

        res.json({
            canEnter: true,
            needCheckout: false,
            course
        });

    } catch (err) {
        console.error('檢查課程進入權限失敗:', err);

        res.status(500).json({
            canEnter: false,
            error: '檢查課程進入權限失敗',
            detail: err.message
        });
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

// 課程商店：取得目前開放購買的線上課程
app.get('/api/courses/store', async (req, res) => {
    try {
        const username = String(req.query.username || '').trim();

        const { data, error } = await supabase
            .from('courses')
            .select(`
                id,
                teacher_username,
                course_name,
                subject,
                intro,
                course_type,
                price,
                status,
                start_date,
                end_date,
                weekly_day,
                start_time,
                max_students,
                enrolled_count,
                created_at
            `)
            .in('status', ['approved', 'active'])
            .eq('is_public', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const courses = data || [];
        const courseIds = courses.map(course => course.id);

        let enrolledCourseIdSet = new Set();
        let pendingCourseIdSet = new Set();

        if (username && courseIds.length > 0) {
            const { data: enrollments, error: enrollmentError } = await supabase
                .from('course_enrollments')
                .select('course_id')
                .eq('username', username)
                .in('course_id', courseIds);

            if (enrollmentError) throw enrollmentError;

            enrolledCourseIdSet = new Set(
                (enrollments || []).map(row => row.course_id)
            );

            const { data: pendingOrders, error: pendingOrderError } = await supabase
                .from('orders')
                .select('course_id, provider_status')
                .eq('username', username)
                .eq('order_type', 'course')
                .eq('provider', 'manual_transfer')
                .eq('status', 'pending')
                .in('provider_status', [
                    'awaiting_transfer_info',
                    'awaiting_manual_review'
                ])
                .in('course_id', courseIds);

            if (pendingOrderError) throw pendingOrderError;

            pendingCourseIdSet = new Set(
                (pendingOrders || []).map(row => row.course_id)
            );
        }

        const mappedCourses = courses.map(course => {
            const isEnrolled = enrolledCourseIdSet.has(course.id);
            const hasPendingOrder = pendingCourseIdSet.has(course.id);

            return {
                ...course,
                is_enrolled: isEnrolled,
                has_pending_order: hasPendingOrder,
                can_buy: !isEnrolled && !hasPendingOrder
            };
        });

        res.json({
            success: true,
            username: username || null,
            courses: mappedCourses
        });

    } catch (err) {
        console.error('取得課程商店失敗:', err);
        res.status(500).json({
            error: '取得課程商店失敗',
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

    // 每次都顯示 Google 帳號選擇畫面，不要直接沿用目前瀏覽器帳號
    prompt: 'select_account',

    // 👇 關鍵：保留學生 / 教師申請身份
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
            let finalName =
    normalizeUsername(name) ||
    normalizeUsername(email?.split('@')[0]) ||
    'Google學員';

const { data: nameCheck } = await supabase
    .from('users')
    .select('username')
    .eq('username', finalName)
    .maybeSingle();

if (nameCheck) {
    finalName = `${finalName}${Math.floor(Math.random() * 1000)}`;
}

            const newLinkCode = await generateUniqueLinkCode();

            const trialFields = state === 'teacher_apply'
    ? {
        membership_level: 'free',
        is_subscribed: false,
        subscription_status: 'none',
        subscription_started_at: null,
        subscription_end_date: null,
        trial_started_at: null,
        trial_ends_at: null,
        has_seen_subscription_intro: true
    }
    : buildNewStudentTrialFields();

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
link_code: newLinkCode,
...trialFields
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

                // Google OAuth 登入成功後，統一整理 username，避免網址或 session 帶入換行
        let cleanUsername = normalizeUsername(user.username);

        if (user.username !== cleanUsername && cleanUsername) {
    const { data: duplicateUser, error: duplicateCheckError } = await supabase
        .from('users')
        .select('username')
        .eq('username', cleanUsername)
        .maybeSingle();

    if (duplicateCheckError) throw duplicateCheckError;

    if (!duplicateUser) {
        const { data: renamedUser, error: renameError } = await supabase
            .from('users')
            .update({
                username: cleanUsername,
                updated_at: new Date().toISOString()
            })
            .eq('account', user.account)
            .select()
            .single();

        if (renameError) {
            console.error('Google OAuth 清理 username 失敗:', renameError);
        } else if (renamedUser) {
            user = renamedUser;
            cleanUsername = normalizeUsername(user.username);
        }
    } else {
        cleanUsername = normalizeUsername(user.username);
    }
}

        const shouldBackfillTrial =
            user.role === 'student' &&
            user.is_subscribed !== true &&
            user.subscription_status !== 'active' &&
            !user.trial_started_at &&
            !user.trial_ends_at;

        if (shouldBackfillTrial) {
            const trialFields = buildNewStudentTrialFields();

            const { data: trialUpdatedUser, error: trialUpdateError } = await supabase
                .from('users')
                .update({
                    ...trialFields,
                    updated_at: new Date().toISOString()
                })
                .eq('username', cleanUsername)
                .select()
                .single();

            if (trialUpdateError) {
                console.error('Google 舊帳號補發 14 天體驗失敗:', trialUpdateError);
            } else if (trialUpdatedUser) {
                user = trialUpdatedUser;
            }
        }

        if (!user.link_code) {
            const newLinkCode = await generateUniqueLinkCode();

            await supabase
                .from('users')
                .update({ link_code: newLinkCode })
                .eq('username', cleanUsername);

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
    .eq('username', cleanUsername);

if (sessionUpdateError) {
    console.error('Google 更新 session 失敗:', sessionUpdateError);
}

const redirectRole =
    state === 'teacher_apply'
        ? 'teacher_pending'
        : (user.role || 'student');

const redirectParams = new URLSearchParams({
    username: cleanUsername,
    role: redirectRole,
    sessionId,
    login_success: 'true',
    oauth_role: state || 'student'
});

res.redirect(`/?${redirectParams.toString()}`);

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

            const trialFields = buildNewStudentTrialFields();
            const { data: newUser, error } = await supabase.from('users').insert([{
    username: String(finalUsername),
    account: String(lineId),
    password: String(lineId), // 用 LINE ID 當作密碼欄位佔位
    total_seconds: 0,
    streak: 1,
    last_login: today,
    role: 'student',
    integrity_score: 100,
    link_code: newLinkCode,
    ...trialFields
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

const lineUsername = normalizeUsername(existingUser.username);
const lineRole = existingUser.role || 'student';

const redirectParams = new URLSearchParams({
    username: lineUsername,
    role: lineRole,
    sessionId: String(sessionId || '').trim(),
    login_success: 'true',
    oauth_role: 'student'
});

res.redirect(`/?${redirectParams.toString()}`);

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
    const username = normalizeUsername(req.query.username);
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
// 今日累積專注時間 API
// 統計台灣時間今天 00:00 ~ 明天 00:00 的所有教室專注秒數
// ==========================================
app.get('/api/focus/today', async (req, res) => {
    const username = req.query.username;

    if (!username) {
        return res.status(400).json({
            success: false,
            error: '缺少 username'
        });
    }

    try {
        // 以台灣時間計算今天日期
        const taipeiToday = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Taipei'
        });

        const startAt = new Date(`${taipeiToday}T00:00:00+08:00`);
        const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);

        const { data, error } = await supabase
            .from('focus_records')
            .select('focus_seconds, room_type, created_at')
            .eq('username', username)
            .gte('created_at', startAt.toISOString())
            .lt('created_at', endAt.toISOString());

        if (error) throw error;

        const totalSeconds = (data || []).reduce((sum, record) => {
            return sum + Number(record.focus_seconds || 0);
        }, 0);

        res.json({
            success: true,
            username,
            date: taipeiToday,
            totalSeconds,
            totalMinutes: Math.floor(totalSeconds / 60),
            records: data || []
        });

    } catch (err) {
        console.error('取得今日累積專注時間失敗:', err);

        res.status(500).json({
            success: false,
            error: '取得今日累積專注時間失敗',
            detail: err.message
        });
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

// Render 使用 UTC，這裡強制用台灣時間 UTC+8 來計算特約教室課表
const taiwanNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);

const start = new Date(taiwanNow);
const [h, m] = String(schedule.startTime || '08:00').split(':');
start.setHours(parseInt(h), parseInt(m), 0, 0);

    const elapsedSeconds = Math.floor((taiwanNow.getTime() - start.getTime()) / 1000);
    const classSecs = Number(schedule.classMinutes || 50) * 60;
    const restSecs = Number(schedule.restMinutes || 10) * 60;
    const periods = Number(schedule.periods || 1);

    // 總時間 = 所有上課時間 + 中間休息時間，不包含最後一次休息
    const totalSecs = (periods * classSecs) + ((periods - 1) * restSecs);

    if (elapsedSeconds < 0) {
        return {
            phase: 'WAITING',
            remainingSeconds: Math.abs(elapsedSeconds),
            totalSeconds: classSecs,
            period: 1
        };
    }

    if (elapsedSeconds >= totalSecs) {
        return {
            phase: 'ENDED',
            remainingSeconds: 0,
            totalSeconds: classSecs,
            period: periods
        };
    }

    let cursor = 0;

    for (let period = 1; period <= periods; period++) {
        const classStart = cursor;
        const classEnd = classStart + classSecs;

        if (elapsedSeconds >= classStart && elapsedSeconds < classEnd) {
            return {
                phase: 'CLASS',
                remainingSeconds: classEnd - elapsedSeconds,
                totalSeconds: classSecs,
                period
            };
        }

        cursor = classEnd;

        // 最後一堂課後不再進入休息
        if (period < periods) {
            const restStart = cursor;
            const restEnd = restStart + restSecs;

            if (elapsedSeconds >= restStart && elapsedSeconds < restEnd) {
                return {
                    phase: 'REST',
                    remainingSeconds: restEnd - elapsedSeconds,
                    totalSeconds: restSecs,
                    period
                };
            }

            cursor = restEnd;
        }
    }

    return {
        phase: 'ENDED',
        remainingSeconds: 0,
        totalSeconds: classSecs,
        period: periods
    };
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
    if (studentSocketIds.has(s.id)) return;

    // ✅ 特約教師端不要吃 generic update_rank
    // 避免把 tutorAttendance 的正確學生圖卡覆蓋成空
    if (s.role === 'teacher' && s.currentTutorRoom) {
        const tutorStudents = getTutorAttendance(s.currentTutorRoom).filter(u =>
            u.role === 'student' &&
            u.status !== 'OFFLINE' &&
            !u.leaveTime
        );

        s.emit('update_rank', tutorStudents);
        return;
    }

    s.emit('update_rank', usersWithCaptain);
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
    const roomKey = typeof room === 'string'
        ? room
        : room?.roomId || room?.room || room?.roomMode;

    if (!roomKey) return;

    socket.join(roomKey);
    console.log(`🏠 [房間管理] Socket ${socket.id} 已成功加入房間: ${roomKey}`);

    socket.emit('teacher_update', {
    logs: teacherLogsByRoom[roomKey] || [],
    snaps: violationSnaps.filter(snap => snap.roomMode === roomKey)
});

    socket.emit('update_rank', onlineUsers.filter(u => u.roomMode !== 'tutor'));
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
    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId;

    if (targetRoom) {
        io.to(targetRoom).emit('receive_tutor_schedule', data);
    } else {
        socket.emit('receive_tutor_schedule', data);
    }
});

socket.on('sync_schedule_to_students', (data) => {
    const targetRoom =
        data?.roomId ||
        data?.room ||
        socket.roomId;

    if (!targetRoom) {
        console.log('❌ sync_schedule_to_students 缺少 roomId');
        return;
    }

    const scheduleMessage =
    data.message ||
    data.scheduleText ||
    data.text ||
    '';

const normalizedScheduleData = {
    ...data,
    room: targetRoom,
    roomId: targetRoom,
    roomCode: targetRoom,
    message: scheduleMessage,
    scheduleText: scheduleMessage
};

tutorSchedules[targetRoom] = normalizedScheduleData;

io.to(targetRoom).emit('sync_schedule_to_students', normalizedScheduleData);
io.to(targetRoom).emit('sync_tutor_schedule', normalizedScheduleData);
io.to(targetRoom).emit('receive_tutor_schedule', normalizedScheduleData);
});

    // 接收大廳老師建立的課表並存起來
    socket.on('create_tutor_room_schedule', (data) => {
    const roomId = data.roomId || data.room || data.roomCode;

    if (!roomId) {
        console.log('❌ create_tutor_room_schedule 缺少 roomId');
        return;
    }

    const scheduleMessage =
        data.message ||
        data.scheduleText ||
        data.text ||
        '';

    const normalizedScheduleData = {
        ...data,
        roomId,
        room: roomId,
        roomCode: roomId,
        message: scheduleMessage,
        scheduleText: scheduleMessage
    };

    tutorSchedules[roomId] = normalizedScheduleData;

    const startTime = data.startTime || data.start_time;
    const classMinutes = Number(data.classMinutes || data.class_minutes || data.periodTime || 50);
    const restMinutes = Number(data.restMinutes || data.rest_minutes || data.restTime || 10);
    const periods = Number(data.periods || 1);

    tutorRoomSettings.set(roomId, {
        startTime,
        classMinutes,
        restMinutes,
        periods
    });

    io.to(roomId).emit('receive_tutor_schedule', normalizedScheduleData);
    io.to(roomId).emit('sync_schedule_to_students', normalizedScheduleData);

    console.log(`[系統] 已儲存特約教室 ${roomId} 的課表設定：${scheduleMessage}`);
});

    // 當特約學生進入教室時，發送該教室的課表給他
    socket.on('request_tutor_schedule', (roomId) => {
    if (tutorSchedules[roomId]) {
        const scheduleData = tutorSchedules[roomId];

        socket.emit('sync_tutor_schedule', scheduleData);
        socket.emit('sync_schedule_to_students', scheduleData);
        socket.emit('receive_tutor_schedule', scheduleData);
    }
});

    // 學生請求當下課表時間
    socket.on('request_tutor_timer_sync', (roomId) => {
const targetRoom = roomId || socket.currentTutorRoom || socket.roomId;
const timeState = getTutorRoomTimeState(targetRoom);
if (timeState && targetRoom) {
socket.emit('tutor_timer_sync', {
...timeState,
roomId: targetRoom,
room: targetRoom,
roomCode: targetRoom
    });
}
});

async function verifyTutorSocketJoinAccess(roomId, username) {
    if (!roomId) {
        return {
            ok: false,
            error: '缺少特約教室代碼'
        };
    }

    const { data: schedule, error } = await supabase
        .from('tutor_schedules')
        .select('*')
        .eq('room_code', roomId)
        .in('status', ['scheduled', 'live'])
        .maybeSingle();

    if (error) throw error;

    // 找不到 tutor_schedules 的房間，先保留 legacy / standalone 相容
    // 例如線上課程或舊流程可能不是 tutor_schedules 報名制房間
    if (!schedule) {
        return {
            ok: true,
            legacyOrStandalone: true
        };
    }

    // 非報名制舊特約教室：照舊可進
    if (schedule.requires_whitelist !== true) {
        return {
            ok: true,
            schedule
        };
    }

    // 報名制教室一定要有 username
    if (!username || username === 'undefined' || username === '神秘學員') {
        return {
            ok: false,
            error: '此特約教室需要登入後才能進入'
        };
    }

    const startAt = buildTutorScheduleStartAt(schedule);

    if (startAt) {
        const totalMinutes = getTutorScheduleTotalMinutes(schedule);
        const endAt = new Date(startAt.getTime() + totalMinutes * 60 * 1000);

        if (new Date() > endAt) {
            await supabase
                .from('tutor_schedules')
                .update({
                    status: 'ended',
                    updated_at: new Date().toISOString()
                })
                .eq('id', schedule.id);

            return {
                ok: false,
                error: '此特約教室已結束'
            };
        }
    }

    const accessCheck = await verifyTutorScheduleWhitelistAccess(
        schedule,
        username
    );

    if (!accessCheck.ok) {
        return {
            ok: false,
            error: accessCheck.error || '你目前無法進入此特約教室',
            accessLevel: accessCheck.accessLevel
        };
    }

    return {
        ok: true,
        schedule
    };
}

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

// 老師端先保留 legacy，相容目前 tutor-dashboard.js
// 學生端才做報名制白名單守門
if (role === 'student') {
    try {
        const accessResult = await verifyTutorSocketJoinAccess(roomId, username);

        if (!accessResult.ok) {
            console.log("⛔ 特約教室 socket join 被拒絕:", {
                roomId,
                username,
                reason: accessResult.error
            });

            socket.emit('tutor_join_denied', {
                success: false,
                roomId,
                room: roomId,
                roomCode: roomId,
                message: accessResult.error || '你目前無法進入此特約教室',
                accessLevel: accessResult.accessLevel || null
            });

            return;
        }
    } catch (guardErr) {
        console.error("❌ 特約教室 socket join 守門失敗:", guardErr);

        socket.emit('tutor_join_denied', {
            success: false,
            roomId,
            room: roomId,
            roomCode: roomId,
            message: '特約教室進入驗證失敗，請重新登入後再試'
        });

        return;
    }
}

socket.join(roomId);
socket.roomId = roomId;
socket.role = role;
    socket.roomId = roomId;
socket.currentRoom = roomId;
socket.currentTutorRoom = roomId;

    if (role === 'teacher') {
    console.log(`[特約教室] 教師端加入 ${roomId}`);

    const currentAttendance = getTutorAttendance(roomId);

    const activeTutorStudents = currentAttendance.filter(u =>
        u.role === 'student' &&
        u.status !== 'OFFLINE' &&
        !u.leaveTime
    );

    socket.emit('update_attendance', currentAttendance);
    socket.emit('update_rank', activeTutorStudents);
    socket.emit('tutor_students_update', activeTutorStudents);

    console.log(`[特約教室] 已補發 ${roomId} 教師端學生圖卡名單，目前 ${activeTutorStudents.length} 人`);

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

    const currentAttendance = getTutorAttendance(roomId);

const activeTutorStudents = currentAttendance.filter(u =>
    u.role === 'student' &&
    u.status !== 'OFFLINE' &&
    !u.leaveTime
);

io.to(roomId).emit('update_attendance', currentAttendance);
io.to(roomId).emit('update_rank', activeTutorStudents);

// ✅ 補事件別名，避免教師端只聽 tutor_students_update / student_joined 時收不到
io.to(roomId).emit('tutor_students_update', activeTutorStudents);

io.to(roomId).emit('student_joined', {
    id: socket.id,
    socketId: socket.id,
    name: username,
    username,
    roomId,
    room: roomId,
    roomCode: roomId,
    roomMode: 'tutor',
    role: 'student',
    status: 'FOCUSED',
    joinTime: getTaiwanTimeString(),
    leaveTime: null
});

console.log(`[特約教室] 已同步 ${roomId} 名單，目前 ${currentAttendance.length} 人`);

    console.log(`[特約教室] 學生 ${username} 加入 ${roomId}`);

    // ✅ 學生加入後，如果這間教室已經有課表，立即補發給該學生
if (role === 'student' && tutorSchedules[roomId]) {
    const scheduleData = tutorSchedules[roomId];

    socket.emit('sync_schedule_to_students', scheduleData);
    socket.emit('sync_tutor_schedule', scheduleData);
    socket.emit('receive_tutor_schedule', scheduleData);

    console.log(`[特約教室] 已補發 ${roomId} 課表給學生 ${username}`);
}

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
        blackboardByRoom[targetRoom] = {
            ...data,
            content: data.content || data.message || '',
            roomMode: targetRoom,
            updatedAt: new Date().toISOString()
        };

        io.to(targetRoom).emit('update_blackboard', blackboardByRoom[targetRoom]);
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

        // ==========================================
    // 手機加入電腦端 syncToken 房間
    // 用於普通教室時間結束後，讓 FORCE_DISCONNECT 能送到手機
    // ==========================================
    socket.on('join_mobile_sync_room', (data) => {
        const syncToken = data?.syncToken;
        const studentName = data?.studentName || data?.username || '';

        if (!syncToken) {
            console.warn('⚠️ join_mobile_sync_room 缺少 syncToken:', data);
            return;
        }

        socket.join(syncToken);

if (studentName) {
    socket.join(`mobile_user_${studentName}`);
}

socket.mobileSyncToken = syncToken;
socket.mobileStudentName = studentName;

console.log(`📱 手機 ${studentName || '未知學員'} 已加入 sync room: ${syncToken}`);
    });

    socket.on('request_link_device', (data) => {
    console.log(`收到連動請求！手機(${data.studentName}) 要求連動大廳(${data.syncToken})`);

    const payload = {
        success: true,
        mobileName: data.studentName,
        studentName: data.studentName,
        username: data.studentName,
        syncToken: data.syncToken,
        isFlipped: data.isFlipped === true
    };

    if (data.syncToken) {
        io.to(data.syncToken).emit('deviceLinked', payload);
        io.to(data.syncToken).emit('mobile_sync_update', {
            type: 'LINKED',
            ...payload
        });
    }

    // 保底：也回傳給發送請求的手機端，避免手機端卡住
    socket.emit('deviceLinked', payload);
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
            const leaderUser =
onlineUsers.find(u => u.name === team.leader && u.teamId === roomId) ||
onlineUsers.find(u => u.name === team.leader);
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

if (blackboardByRoom[user.roomMode]) {
    socket.emit('admin_action', {
        type: 'BLACKBOARD',
        content: blackboardByRoom[user.roomMode].content,
        roomMode: user.roomMode
    });

    socket.emit('update_blackboard', blackboardByRoom[user.roomMode]);
}
            
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

    console.log('[mobile_sync_update]', data);

    const targetTutorRoom =
    data?.roomId ||
    data?.room ||
    data?.roomCode;

if (targetTutorRoom) {
    io.to(targetTutorRoom).emit('mobile_sync_update', data);
}

    // 手機 QR 連動：優先送回掃 QR 的那台電腦 / 手機 sync room
if (data?.syncToken) {
    io.to(data.syncToken).emit('mobile_sync_update', data);
}

// ✅ 保險：也送給該學生手機房間
// 避免普通教室換頁後 socket.id 改變，手機收不到 FORCE_DISCONNECT
const targetStudentName =
    data?.studentName ||
    data?.name ||
    data?.username;

    if (targetStudentName) {
    io.to(`mobile_user_${targetStudentName}`).emit('mobile_sync_update', data);
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
    time: new Date().toLocaleTimeString('zh-TW', {
        timeZone: 'Asia/Taipei',
        hour12: false
    }),
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
    const targetRoomMode = data?.roomMode || data?.roomId;

    if (data.type === 'BLACKBOARD' && targetRoomMode) {
        blackboardByRoom[targetRoomMode] = {
            ...data,
            content: data.content || data.message || '',
            roomMode: targetRoomMode,
            updatedAt: new Date().toISOString()
        };
    }

    if (data.target) {
        const targetUser = onlineUsers.find(u => u.name === data.target);
        if (targetUser) {
            io.to(targetUser.roomMode).emit('admin_action', data);
        }
    } else {
        if (targetRoomMode) {
            io.to(targetRoomMode).emit('admin_action', data);
        } else {
            socket.emit('admin_action', data);
        }
    }

    if (data.type === 'BLACKBOARD' && targetRoomMode) {
        addTeacherLog(`📢 教師公告：${data.content}`, targetRoomMode);
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
    const studentName = data?.name || data?.username;

    const user = onlineUsers.find(u =>
        u.id === socket.id ||
        u.name === studentName ||
        u.username === studentName
    );

    const targetRoom =
        data?.roomId ||
        data?.room ||
        data?.roomCode ||
        data?.roomMode ||
        socket.roomId ||
        socket.currentTutorRoom ||
        socket.currentRoom ||
        user?.roomId ||
        user?.room ||
        user?.roomCode ||
        user?.roomMode;

    if (!targetRoom) {
        console.warn('⚠️ flip_failed 找不到 targetRoom，已拒絕全域廣播:', data);
        socket.emit('flip_failed', {
            ...data,
            roomId: null,
            room: null,
            roomCode: null
        });
        return;
    }

    const normalizedData = {
        ...data,
        name: studentName,
        roomId: targetRoom,
        room: targetRoom,
        roomCode: targetRoom
    };

    if (tutorAttendanceByRoom.has(targetRoom) && studentName) {
        const roomMap = tutorAttendanceByRoom.get(targetRoom);
        const student = roomMap.get(studentName);

        if (student) {
            student.status = 'OFFLINE';
            student.leaveTime = getTaiwanTimeString();
            roomMap.set(studentName, student);
        }

        broadcastTutorAttendance(targetRoom);
    }

    io.to(targetRoom).emit('flip_failed', normalizedData);

    io.to(targetRoom).emit('student_violation', {
        name: studentName,
        type: '📱 手機翻轉中斷（超過5秒，已強制踢出教室）',
        image: null,
        roomId: targetRoom,
        room: targetRoom,
        roomCode: targetRoom
    });
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
    timeZone: 'Asia/Taipei',
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

// ==========================================
// Payment Provider Callback Skeleton
// 真實金流 callback 骨架
// 目前不串正式 API，只保留乾淨入口
// ==========================================

app.post('/api/payment/:provider/callback', async (req, res) => {
    try {
        const provider = String(req.params.provider || '').trim();

        const supportedProviders = ['linepay', 'jkopay', 'credit_card'];

        if (!supportedProviders.includes(provider)) {
            return res.status(400).json({
                success: false,
                error: '不支援的付款 provider',
                provider
            });
        }

        // 目前還沒有串接正式金流，所以不在這裡開通訂閱或課程
        // 未來流程：
        // 1. 從 req.body 解析 provider_order_id / provider_payment_id / amount
        // 2. 向金流官方 API confirm / verify
        // 3. 確認金額與訂單一致
        // 4. 呼叫 completePaidOrderByType()
        return res.status(501).json({
            success: false,
            provider,
            error: '此付款 provider callback 尚未串接正式驗證流程',
            next: '取得正式金鑰與官方 API 文件後，再實作 verify + completePaidOrderByType'
        });

    } catch (err) {
        console.error('付款 provider callback 處理失敗:', err);

        return res.status(500).json({
            success: false,
            error: '付款 provider callback 處理失敗',
            detail: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 StudyVerse 核心伺服器啟動！`);
    console.log(`👨‍🏫 管理後端已準備就緒，偵聽端口: ${PORT}`);
    console.log(`📱 區網測試網址: http://你的IP:${PORT}`);

    setTimeout(broadcastWeeklyRank, 2000);
});