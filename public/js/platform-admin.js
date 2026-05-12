let adminUsername = localStorage.getItem('studyverse_admin_username') || '';

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

    const rows = data.users.map(user => `
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
          <select onchange="updateUser('${user.username}', { teacher_status: this.value })">
            ${teacherStatusOption('none', user.teacher_status)}
            ${teacherStatusOption('pending', user.teacher_status)}
            ${teacherStatusOption('approved', user.teacher_status)}
            ${teacherStatusOption('disabled', user.teacher_status)}
            ${teacherStatusOption('rejected', user.teacher_status)}
          </select>
        </td>
        <td>${user.line_bound ? '已綁定' : '未綁定'}</td>
        <td>${user.total_minutes}</td>
        <td>${user.integrity_score ?? '-'}</td>
        <td>${user.violation_count ?? 0}</td>
        <td>
          <button onclick="updateUser('${user.username}', { is_blocked: ${!user.is_blocked} })">
            ${user.is_blocked ? '解封' : '封鎖'}
          </button>
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