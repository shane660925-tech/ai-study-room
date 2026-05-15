let adminUsername = localStorage.getItem('studyverse_admin_username') || '';
let adminUsersCache = [];

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('adminUsernameInput');
  if (input) input.value = adminUsername;

  document.getElementById('loginBtn').addEventListener('click', verifyAdmin);

  if (adminUsername) {
    verifyAdmin();
  }
});

function getAdminQuery() {
  return `adminUsername=${encodeURIComponent(adminUsername)}`;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
  'Content-Type': 'application/json',
  ...(options.headers || {})
}
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'API 發生錯誤');
  }

  return data;
}

async function verifyAdmin() {
  adminUsername = document.getElementById('adminUsernameInput').value.trim();

  if (!adminUsername) {
    alert('請輸入 admin username');
    return;
  }

  try {
    await apiFetch(`/api/admin/me?${getAdminQuery()}`);
    localStorage.setItem('studyverse_admin_username', adminUsername);
    alert('管理員驗證成功');
    await loadOverview();
    await loadUsers();
    await loadThemeRooms();
  } catch (err) {
    alert(err.message);
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');

  if (tab === 'overview') loadOverview();
if (tab === 'users') loadUsers();
if (tab === 'teachers') loadTeacherReviews();
if (tab === 'themes') loadThemeRooms();
}

async function loadOverview() {
  try {
    const data = await apiFetch(`/api/admin/overview?${getAdminQuery()}`);

    document.getElementById('overviewCards').innerHTML = `
      <div class="card"><span>會員總數</span><strong>${data.totalUsers}</strong></div>
      <div class="card"><span>封鎖會員</span><strong>${data.blockedUsers}</strong></div>
      <div class="card"><span>教師數</span><strong>${data.teacherCount}</strong></div>
      <div class="card"><span>待審教師</span><strong>${data.pendingTeachers}</strong></div>
      <div class="card"><span>總學習分鐘</span><strong>${data.totalFocusMinutes}</strong></div>
      <div class="card"><span>平均誠信分</span><strong>${data.avgIntegrity}</strong></div>
    `;
  } catch (err) {
    console.error(err);
  }
}

async function loadUsers() {
  const keyword = document.getElementById('userSearchInput')?.value.trim() || '';

  try {
    const data = await apiFetch(
      `/api/admin/users?${getAdminQuery()}&keyword=${encodeURIComponent(keyword)}`
    );

    adminUsersCache = data.users || [];
    const roleFilter = document.getElementById('userRoleFilter')?.value || 'all';

if (roleFilter !== 'all') {
  adminUsersCache = adminUsersCache.filter(user => user.role === roleFilter);
}

adminUsersCache.sort((a, b) => {
  if (a.teacher_status === 'pending' && b.teacher_status !== 'pending') return -1;
  if (a.teacher_status !== 'pending' && b.teacher_status === 'pending') return 1;
  return String(a.username).localeCompare(String(b.username), 'zh-Hant');
});

    const rows = adminUsersCache.map(user => `
      <tr>
        <td>${user.username}</td>
        <td>${user.account || '-'}</td>
        <td>
          <select onchange="updateUser('${user.username}', { role: this.value })">
            ${roleOption('student', user.role)}
            ${roleOption('member', user.role)}
            ${roleOption('teacher', user.role)}
            ${roleOption('admin', user.role)}
          </select>
        </td>
        <td>
  ${renderTeacherStatusBadge(user.teacher_status)}
</td>
        <td>${user.line_bound ? '已綁定' : '未綁定'}</td>
        <td>${user.total_minutes}</td>
        <td>${user.integrity_score ?? '-'}</td>
        <td>${user.violation_count ?? 0}</td>
<td>${user.teacher_subject || '-'}</td>
<td>
  ${user.teacher_intro ? escapeHtml(user.teacher_intro.slice(0, 12)) + '...' : '-'}
  ${user.teacher_intro ? `<button onclick="openTeacherDetail('${escapeJs(user.username)}')">查看</button>` : ''}
</td>
<td>${user.teacher_apply_at ? new Date(user.teacher_apply_at).toLocaleString('zh-TW') : '-'}</td>
<td>
  <button onclick="updateUser('${user.username}', { is_blocked: ${!user.is_blocked} })">
    ${user.is_blocked ? '解封' : '封鎖'}
  </button>

  ${user.teacher_status === 'pending' ? `
    <button onclick="approveTeacher('${user.username}')">批准教師</button>
    <button onclick="rejectTeacher('${user.username}')">拒絕教師</button>
  ` : ''}
</td>
      </tr>
    `).join('');

    document.getElementById('usersTable').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Account</th>
            <th>Role</th>
            <th>教師狀態</th>
            <th>LINE</th>
            <th>學習分鐘</th>
            <th>誠信分</th>
            <th>違規次數</th>
<th>申請科目</th>
<th>申請自介</th>
<th>申請時間</th>
<th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    alert(err.message);
  }
}

async function loadTeacherReviews() {
  try {
    const data = await apiFetch(
      `/api/admin/teacher-applications?${getAdminQuery()}`
    );

    const applications = data.applications || [];

    if (applications.length === 0) {
      document.getElementById('teacherReviewList').innerHTML = `
        <div class="empty-card">
          目前沒有等待審核的教師申請
        </div>
      `;
      return;
    }

    document.getElementById('teacherReviewList').innerHTML = applications.map(app => `
      <div class="teacher-review-card">
        <div>
          <h3>${escapeHtml(app.username)}</h3>
          <p>${escapeHtml(app.email || '-')}</p>
        </div>

        <div>
          <strong>開課種類</strong>
          <p>${escapeHtml(app.teacher_type || '-')}</p>
        </div>

        <div>
          <strong>教室規模</strong>
          <p>${escapeHtml(app.classroom_size || '-')}</p>
        </div>

        <div>
          <strong>申請狀態</strong>
          <p>${escapeHtml(app.status || '-')}</p>
        </div>

        <div>
          <strong>課程資訊</strong>
          <p>${escapeHtml(app.course_info || '-')}</p>
        </div>

        <div>
          <strong>上課時間</strong>
          <p>${escapeHtml(app.course_schedule || '-')}</p>
        </div>

        <div>
          <strong>申請時間</strong>
          <p>${app.created_at ? new Date(app.created_at).toLocaleString('zh-TW') : '-'}</p>
        </div>

        <div class="teacher-review-actions">
          <button onclick="approveTeacherApplication('${escapeJs(app.id)}', '${escapeJs(app.username)}')">
            批准
          </button>
          <button onclick="rejectTeacherApplication('${escapeJs(app.id)}', '${escapeJs(app.username)}')">
            拒絕
          </button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    alert(err.message);
  }
}

function roleOption(value, current) {
  const labelMap = {
    student: '學生',
    member: '一般會員',
    teacher: '教師',
    admin: '平台管理員'
  };

  return `<option value="${value}" ${value === current ? 'selected' : ''}>${labelMap[value] || value}</option>`;
}

function teacherStatusOption(value, current) {
  const labelMap = {
    none: '未申請',
    pending: '審核中',
    approved: '已通過',
    disabled: '已停用',
    rejected: '已拒絕'
  };

  return `<option value="${value}" ${value === current ? 'selected' : ''}>${labelMap[value] || value}</option>`;
}

function renderTeacherStatusBadge(status) {
  const map = {
    none: {
      label: '未申請',
      className: 'badge-gray'
    },
    pending: {
      label: '審核中',
      className: 'badge-yellow'
    },
    approved: {
      label: '已通過',
      className: 'badge-green'
    },
    rejected: {
      label: '已拒絕',
      className: 'badge-red'
    },
    disabled: {
      label: '已停用',
      className: 'badge-dark'
    }
  };

  const item = map[status] || map.none;

  return `
    <span class="status-badge ${item.className}">
      ${item.label}
    </span>
  `;
}

async function updateUser(username, updates) {
  try {
    await apiFetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        adminUsername,
        ...updates
      })
    });

    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function approveTeacher(username) {
  if (!confirm(`確定批准 ${username} 成為教師嗎？`)) return;

  await updateUser(username, {
  role: 'teacher',
  teacher_status: 'approved'
});

await loadTeacherReviews();
}

async function rejectTeacher(username) {
  const note =
    prompt(`請輸入拒絕 ${username} 的原因，可留空：`) || '';

  await updateUser(username, {
  role: 'student',
  teacher_status: 'rejected',
  teacher_review_note: note
});

await loadTeacherReviews();
}

async function loadThemeRooms() {
  try {
    const data = await apiFetch(`/api/admin/theme-rooms?${getAdminQuery()}`);

    const rows = data.rooms.map(room => `
      <tr>
        <td>${room.id}</td>
        <td>
          <input value="${escapeHtml(room.name)}"
            onchange="updateThemeRoom(${room.id}, { name: this.value })" />
        </td>
        <td>${room.slug}</td>
        <td>
          <input value="${room.badge_text || ''}"
            onchange="updateThemeRoom(${room.id}, { badge_text: this.value })" />
        </td>
        <td>
          <input value="${room.theme_color || ''}"
            onchange="updateThemeRoom(${room.id}, { theme_color: this.value })" />
        </td>
        <td>
          <input type="number" value="${room.sort_order || 0}"
            onchange="updateThemeRoom(${room.id}, { sort_order: this.value })" />
        </td>
        <td>
          <button onclick="updateThemeRoom(${room.id}, { is_active: ${!room.is_active} })">
            ${room.is_active ? '停用' : '啟用'}
          </button>
        </td>
      </tr>
    `).join('');

    document.getElementById('themeRoomsTable').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名稱</th>
            <th>Slug</th>
            <th>Badge</th>
            <th>顏色</th>
            <th>排序</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    alert(err.message);
  }
}

async function createThemeRoom() {
  const name = document.getElementById('themeName').value.trim();
  const slug = document.getElementById('themeSlug').value.trim();
  const badge_text = document.getElementById('themeBadge').value.trim();
  const theme_color = document.getElementById('themeColor').value.trim() || 'blue';
  const sort_order = Number(document.getElementById('themeSort').value || 0);

  if (!name || !slug) {
    alert('請輸入名稱與 slug');
    return;
  }

  try {
    await apiFetch('/api/admin/theme-rooms', {
      method: 'POST',
      body: JSON.stringify({
        adminUsername,
        name,
        slug,
        badge_text,
        theme_color,
        sort_order,
        room_page: 'managed-room.html',
        is_active: true
      })
    });

    alert('新增成功');
    await loadThemeRooms();
  } catch (err) {
    alert(err.message);
  }
}

async function updateThemeRoom(id, updates) {
  try {
    await apiFetch(`/api/admin/theme-rooms/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        adminUsername,
        ...updates
      })
    });

    await loadThemeRooms();
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeJs(str) {
  return String(str || '')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"');
}

function openTeacherDetail(username) {
  const user = adminUsersCache.find(u => u.username === username);
  if (!user) return;

  const oldModal = document.getElementById('teacherDetailModal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.id = 'teacherDetailModal';
  modal.className = 'admin-modal-overlay';

  modal.innerHTML = `
    <div class="admin-modal-card">
      <button class="admin-modal-close" onclick="closeTeacherDetail()">×</button>

      <h2>教師申請完整資料</h2>

      <div class="admin-detail-grid">
        <p><strong>姓名：</strong>${escapeHtml(user.username)}</p>
        <p><strong>Email / Account：</strong>${escapeHtml(user.account || '-')}</p>
        <p><strong>Role：</strong>${escapeHtml(user.role || '-')}</p>
        <p><strong>教師狀態：</strong>${escapeHtml(user.teacher_status || '-')}</p>
        <p><strong>LINE：</strong>${user.line_bound ? '已綁定' : '未綁定'}</p>
        <p><strong>累積學習分鐘：</strong>${user.total_minutes ?? 0}</p>
        <p><strong>誠信分：</strong>${user.integrity_score ?? '-'}</p>
        <p><strong>違規次數：</strong>${user.violation_count ?? 0}</p>
        <p><strong>申請科目：</strong>${escapeHtml(user.teacher_subject || '-')}</p>
        <p><strong>申請時間：</strong>${user.teacher_apply_at ? new Date(user.teacher_apply_at).toLocaleString('zh-TW') : '-'}</p>
      </div>

      <div class="admin-detail-block">
        <strong>自我介紹 / 教學經驗：</strong>
        <div>${escapeHtml(user.teacher_intro || '-')}</div>
      </div>

      <div class="admin-detail-actions">
        ${user.teacher_status === 'pending' ? `
          <button onclick="approveTeacher('${escapeJs(user.username)}'); closeTeacherDetail();">批准教師</button>
          <button onclick="rejectTeacher('${escapeJs(user.username)}'); closeTeacherDetail();">拒絕教師</button>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function closeTeacherDetail() {
  const modal = document.getElementById('teacherDetailModal');
  if (modal) modal.remove();
}

async function approveTeacherApplication(applicationId, username) {
  alert(`下一步會串接批准 API：${username}`);
}

async function rejectTeacherApplication(applicationId, username) {
  alert(`下一步會串接拒絕 API：${username}`);
}