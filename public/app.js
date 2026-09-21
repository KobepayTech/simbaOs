const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { token: localStorage.getItem('simbaos_token'), user: null, branches: [], editingStaffId: null, resetStaffId: null };

const NATIONAL_ROLES = ['super_admin', 'hq_admin'];
const STAFF_MANAGER_ROLES = ['super_admin', 'hq_admin', 'branch_admin'];
const MEMBER_WRITER_ROLES = ['super_admin', 'hq_admin', 'branch_admin', 'registrar'];
const BRANCH_ROLES = ['branch_admin', 'registrar', 'viewer'];
const ROLE_LABELS = {
  super_admin: 'Super admin', hq_admin: 'HQ admin', branch_admin: 'Branch admin',
  registrar: 'Registrar', viewer: 'Viewer'
};

const role = () => state.user?.role;
/** Wording for headings over data the caller can actually see. */
const scopeLabel = () => (isNational() ? 'NATIONAL' : (state.user?.branch_name || 'BRANCH').toUpperCase());
const isNational = () => NATIONAL_ROLES.includes(role());
const canManageStaff = () => STAFF_MANAGER_ROLES.includes(role());
const canWriteMembers = () => MEMBER_WRITER_ROLES.includes(role());

/** Roles this user is allowed to hand out, mirroring canAssignRole on the server. */
function assignableRoles() {
  if (role() === 'super_admin') return ['super_admin', 'hq_admin', 'branch_admin', 'registrar', 'viewer'];
  if (role() === 'hq_admin') return ['hq_admin', 'branch_admin', 'registrar', 'viewer'];
  if (role() === 'branch_admin') return ['registrar', 'viewer'];
  return [];
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function money(value) {
  return new Intl.NumberFormat('en-TZ', { style: 'currency', currency: 'TZS', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function date(value) {
  return value ? new Intl.DateTimeFormat('en-TZ', { dateStyle: 'medium' }).format(new Date(value)) : '—';
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
}

async function boot() {
  if (!state.token) return showLogin();
  try {
    state.user = await api('/api/me');
    showApp();
    await Promise.all([loadDashboard(), loadBranches(), checkHealth()]);
  } catch {
    logout();
  }
}

function showLogin() {
  $('#loginView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
}

function showApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  const where = state.user.branch_name || (isNational() ? 'Nationwide' : 'No branch assigned');
  $('#userMini').innerHTML = `<strong>${esc(state.user.name)}</strong><br><span>${esc(ROLE_LABELS[state.user.role] || state.user.role)} · ${esc(where)}</span>`;
  applyPermissions();
}

/** Hide what this role cannot use. The server enforces the same rules; this keeps the UI honest. */
function applyPermissions() {
  $('#navStaff').hidden = !canManageStaff();
  $('#newMemberTop').hidden = !canWriteMembers();
  $('#orgEyebrow').textContent = isNational()
    ? 'SIMBA SPORTS CLUB · HQ'
    : `SIMBA SPORTS CLUB · ${(state.user.branch_name || 'BRANCH').toUpperCase()}`;
}

function logout() {
  localStorage.removeItem('simbaos_token');
  state.token = null;
  state.user = null;
  showLogin();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('simbaos_token', state.token);
    showApp();
    await Promise.all([loadDashboard(), loadBranches(), checkHealth()]);
  } catch (error) { $('#loginError').textContent = error.message; }
});

$('#logoutBtn').addEventListener('click', logout);

async function checkHealth() {
  try {
    const h = await api('/api/health');
    $('#healthBadge').textContent = `● Online · DB ${h.database}`;
    $('#healthBadge').classList.add('ok');
  } catch { $('#healthBadge').textContent = 'System degraded'; }
}

async function loadDashboard() {
  const d = await api('/api/dashboard');
  $('#dashboardView').innerHTML = `
    <div class="welcome-panel">
      <div class="welcome-copy">
        <p class="eyebrow">${esc(scopeLabel())} COMMAND CENTER</p>
        <h2>Welcome to SimbaOS.</h2>
        <p>${isNational()
          ? 'One live view of Simba membership and branch activity across Tanzania.'
          : `Live membership and payment activity for ${esc(state.user.branch_name)}.`}</p>
      </div>
      <div class="welcome-badge"><span>Network status</span><strong>● Connected</strong></div>
    </div>

    <div class="grid stats">
      <div class="stat"><span>Total members</span><strong>${d.total_members.toLocaleString()}</strong><small>National registry</small></div>
      <div class="stat"><span>Active members</span><strong>${d.active_members.toLocaleString()}</strong><small>Currently valid</small></div>
      <div class="stat"><span>Active branches</span><strong>${d.active_branches.toLocaleString()}</strong><small>Connected nationwide</small></div>
      <div class="stat"><span>Revenue this month</span><strong>${money(d.monthly_revenue)}</strong><small>Membership ledger</small></div>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <div class="card-head"><div><p class="eyebrow">LIVE REGISTRATION</p><h3>Latest members</h3></div><button class="btn ghost" data-go="members">View all</button></div>
        ${memberTable(d.recent_members)}
      </div>
      <div class="card">
        <div class="card-head"><div><p class="eyebrow">QUICK ACTIONS</p><h3>Club operations</h3></div></div>
        <div class="quick-actions">
          ${canWriteMembers() ? '<button class="quick-action" id="quickMember"><span class="quick-icon">+</span><span><strong>Register member</strong><small>Create a new Simba identity</small></span></button>' : ''}
          <button class="quick-action" data-go="branches"><span class="quick-icon">⌘</span><span><strong>Manage branches</strong><small>National branch network</small></span></button>
          <button class="quick-action" data-go="reports"><span class="quick-icon">▥</span><span><strong>View reports</strong><small>Membership performance</small></span></button>
        </div>
        <div class="network-mini">
          <div class="network-mini-top"><span>${isNational() ? 'Nationwide rollout' : 'Your branch'}</span><strong>${d.active_branches.toLocaleString()} active</strong></div>
          <div class="network-line"><i></i></div>
        </div>
      </div>
    </div>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.go)));
  $('#quickMember')?.addEventListener('click', openMemberDialog);
}

function memberTable(rows) {
  if (!rows?.length) return '<div class="empty">No members yet. Register the first Simba member.</div>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Member no.</th><th>Name</th><th>Phone</th><th>Branch</th><th>Status</th><th>Joined</th></tr></thead><tbody>${rows.map(m => `<tr><td class="member-no">${esc(m.member_no)}</td><td>${esc(m.first_name)} ${esc(m.last_name)}</td><td>${esc(m.phone)}</td><td>${esc(m.branch_name || 'Unassigned')}</td><td><span class="pill ${m.status === 'active' ? 'active':''}">${esc(m.status)}</span></td><td>${date(m.joined_at)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function loadMembers(q = '') {
  const members = await api(`/api/members${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  $('#membersView').innerHTML = `
    <div class="toolbar"><input id="memberSearch" class="search" placeholder="Search member number, name or phone" value="${esc(q)}"/>${canWriteMembers() ? '<button id="newMemberBtn" class="btn primary">+ Register member</button>' : ''}</div>
    <div class="card"><div class="card-head"><div><p class="eyebrow">${esc(scopeLabel())} REGISTRY</p><h3>Simba members</h3></div><span class="pill active">${members.length} shown</span></div>${memberTable(members)}</div>`;
  $('#newMemberBtn')?.addEventListener('click', openMemberDialog);
  let timer;
  $('#memberSearch').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => loadMembers(e.target.value.trim()), 250); });
}

async function loadBranches() {
  state.branches = await api('/api/branches');
  $('#memberBranch').innerHTML = '<option value="">Unassigned</option>' + state.branches.map(b => `<option value="${b.id}">${esc(b.code)} — ${esc(b.name)}</option>`).join('');
  $('#branchesView').innerHTML = `
    <div class="toolbar"><div><p class="muted">${isNational() ? 'Manage the nationwide Simba branch network from one place.' : 'Your branch within the national Simba network.'}</p></div>${isNational() ? '<button id="newBranchBtn" class="btn primary">+ Add branch</button>' : ''}</div>
    <div class="grid branch-grid">${state.branches.length ? state.branches.map(b => `<div class="card branch-card"><span class="pill active">● ${esc(b.status)}</span><h3>${esc(b.name)}</h3><div class="branch-meta">${esc(b.code)} · ${esc(b.region)}${b.district ? ` · ${esc(b.district)}` : ''}</div><div class="branch-count">${Number(b.member_count).toLocaleString()}</div><div class="muted">registered members</div></div>`).join('') : '<div class="card empty">No branches yet.</div>'}</div>`;
  $('#newBranchBtn')?.addEventListener('click', () => $('#branchDialog').showModal());
}

async function loadReports() {
  const rows = await api('/api/reports/branches');
  const max = Math.max(1, ...rows.map(r => Number(r.members)));
  $('#reportsView').innerHTML = `<div class="card"><div class="card-head"><div><p class="eyebrow">${esc(scopeLabel())} ANALYTICS</p><h3>Membership by branch</h3></div><span class="pill active">Live data</span></div>${rows.length ? rows.map(r => `<div class="report-bar"><strong>${esc(r.code)}</strong><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Number(r.members)/max*100)}%"></div></div><span>${Number(r.members).toLocaleString()}</span></div>`).join('') : '<div class="empty">No branch data yet.</div>'}</div>`;
}

async function loadStaff() {
  const staff = await api('/api/users');
  $('#staffView').innerHTML = `
    <div class="toolbar"><div><p class="muted">${isNational()
      ? 'Every colleague signs in as themselves, so the audit log names who did what.'
      : 'Staff accounts for your branch.'}</p></div><button id="newStaffBtn" class="btn primary">+ Add staff</button></div>
    <div class="card">
      <div class="card-head"><div><p class="eyebrow">STAFF DIRECTORY</p><h3>Accounts</h3></div><span class="pill active">${staff.length} account${staff.length === 1 ? '' : 's'}</span></div>
      ${staff.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Status</th><th></th></tr></thead>
        <tbody>${staff.map((u) => `<tr>
          <td>${esc(u.name)}${u.id === state.user.id ? ' <span class="pill">you</span>' : ''}</td>
          <td>${esc(u.email)}</td>
          <td>${esc(ROLE_LABELS[u.role] || u.role)}</td>
          <td>${esc(u.branch_name || (NATIONAL_ROLES.includes(u.role) ? 'Nationwide' : 'Unassigned'))}</td>
          <td><span class="pill ${u.status === 'active' ? 'active' : ''}">${esc(u.status)}</span></td>
          <td class="row-actions">
            <button class="link-btn" data-edit-staff="${u.id}">Edit</button>
            ${u.id === state.user.id ? '' : `<button class="link-btn" data-reset-staff="${u.id}">Reset password</button>`}
          </td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No staff accounts yet.</div>'}
    </div>`;

  $('#newStaffBtn').addEventListener('click', () => openStaffDialog(null));
  $$('[data-edit-staff]').forEach((b) => b.addEventListener('click',
    () => openStaffDialog(staff.find((u) => u.id === b.dataset.editStaff))));
  $$('[data-reset-staff]').forEach((b) => b.addEventListener('click',
    () => openPasswordDialog(staff.find((u) => u.id === b.dataset.resetStaff))));
}

/** One dialog serves both creation and editing; `staffMember` null means a new account. */
function openStaffDialog(staffMember) {
  const form = $('#staffForm');
  form.reset();
  $('#staffError').textContent = '';
  state.editingStaffId = staffMember?.id || null;

  $('#staffRole').innerHTML = assignableRoles()
    .map((r) => `<option value="${r}">${esc(ROLE_LABELS[r])}</option>`).join('');
  $('#staffBranch').innerHTML = state.branches
    .map((b) => `<option value="${b.id}">${esc(b.code)} — ${esc(b.name)}</option>`).join('');

  // A branch admin's staff always belong to their own branch, so the picker is theirs alone.
  $('#staffBranchField').hidden = !isNational();
  $('#staffPasswordField').hidden = Boolean(staffMember);
  form.password.required = !staffMember;
  $('#staffStatusField').hidden = !staffMember || staffMember.id === state.user.id;
  $('#staffDialogKicker').textContent = staffMember ? 'EDIT STAFF' : 'NEW STAFF';
  $('#staffDialogTitle').textContent = staffMember ? 'Edit staff account' : 'Add staff account';

  if (staffMember) {
    form.name.value = staffMember.name;
    form.email.value = staffMember.email;
    form.email.readOnly = true;
    if (assignableRoles().includes(staffMember.role)) form.role.value = staffMember.role;
    if (staffMember.branch_id) form.branch_id.value = staffMember.branch_id;
    form.status.value = staffMember.status;
  } else {
    form.email.readOnly = false;
  }

  syncStaffBranchField();
  $('#staffDialog').showModal();
}

/** A national role is never tied to a branch, so hide the picker when one is chosen. */
function syncStaffBranchField() {
  const chosen = $('#staffForm').role.value;
  $('#staffBranchField').hidden = !isNational() || !BRANCH_ROLES.includes(chosen);
}

$('#staffRole').addEventListener('change', syncStaffBranchField);

$('#staffForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#staffError').textContent = '';
  const form = e.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  if ($('#staffBranchField').hidden) delete payload.branch_id;
  if ($('#staffPasswordField').hidden) delete payload.password;
  if ($('#staffStatusField').hidden) delete payload.status;

  try {
    if (state.editingStaffId) {
      delete payload.email;
      await api(`/api/users/${state.editingStaffId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    }
    $('#staffDialog').close();
    await loadStaff();
  } catch (error) { $('#staffError').textContent = error.message; }
});

/** `staffMember` null means changing your own password, which needs the current one. */
function openPasswordDialog(staffMember) {
  const form = $('#passwordForm');
  form.reset();
  $('#passwordError').textContent = '';
  state.resetStaffId = staffMember?.id || null;

  const self = !staffMember;
  $('#currentPasswordField').hidden = !self;
  form.current_password.required = self;
  $('#passwordDialogTitle').textContent = self ? 'Change your password' : `Reset password`;
  $('#passwordDialogSubtitle').textContent = self
    ? 'Choose a password of at least 12 characters.'
    : `Set a temporary password for ${staffMember.name}. They should change it after signing in.`;
  $('#passwordDialog').showModal();
}

$('#changePasswordBtn').addEventListener('click', () => openPasswordDialog(null));

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#passwordError').textContent = '';
  const payload = Object.fromEntries(new FormData(e.currentTarget));
  try {
    if (state.resetStaffId) {
      await api(`/api/users/${state.resetStaffId}/password`, { method: 'POST', body: JSON.stringify({ password: payload.new_password }) });
    } else {
      await api('/api/me/password', { method: 'POST', body: JSON.stringify({ current_password: payload.current_password, new_password: payload.new_password }) });
    }
    $('#passwordDialog').close();
  } catch (error) { $('#passwordError').textContent = error.message; }
});

function openMemberDialog() { $('#memberDialog').showModal(); }
$('#newMemberTop').addEventListener('click', openMemberDialog);
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('#memberForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#memberError').textContent = '';
  const payload = Object.fromEntries(new FormData(e.currentTarget));
  try {
    const member = await api('/api/members', { method: 'POST', body: JSON.stringify(payload) });
    e.currentTarget.reset(); $('#memberDialog').close();
    await Promise.all([loadDashboard(), loadMembers(), loadBranches()]);
    alert(`Member registered: ${member.member_no}`);
  } catch (error) { $('#memberError').textContent = error.message; }
});

$('#branchForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#branchError').textContent = '';
  const payload = Object.fromEntries(new FormData(e.currentTarget));
  try {
    await api('/api/branches', { method: 'POST', body: JSON.stringify(payload) });
    e.currentTarget.reset(); $('#branchDialog').close();
    await Promise.all([loadDashboard(), loadBranches()]);
  } catch (error) { $('#branchError').textContent = error.message; }
});

async function switchView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(`#${name}View`).classList.remove('hidden');
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  $('#pageTitle').textContent = ({ dashboard:'Overview', members:'Members', branches:'Branches', reports:'Reports', staff:'Staff' })[name];
  if (name === 'dashboard') await loadDashboard();
  if (name === 'members') await loadMembers();
  if (name === 'branches') await loadBranches();
  if (name === 'reports') await loadReports();
  if (name === 'staff') await loadStaff();
}

$$('.nav').forEach(n => n.addEventListener('click', () => switchView(n.dataset.view)));
boot();
