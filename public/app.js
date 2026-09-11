const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { token: localStorage.getItem('simbaos_token'), user: null, branches: [] };

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
  $('#userMini').innerHTML = `<strong>${esc(state.user.name)}</strong><br><span>${esc(state.user.role.replaceAll('_',' '))}</span>`;
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
        <p class="eyebrow">NATIONAL COMMAND CENTER</p>
        <h2>Welcome to SimbaOS.</h2>
        <p>One live view of Simba membership and branch activity across Tanzania.</p>
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
          <button class="quick-action" id="quickMember"><span class="quick-icon">+</span><span><strong>Register member</strong><small>Create a new Simba identity</small></span></button>
          <button class="quick-action" data-go="branches"><span class="quick-icon">⌘</span><span><strong>Manage branches</strong><small>National branch network</small></span></button>
          <button class="quick-action" data-go="reports"><span class="quick-icon">▥</span><span><strong>View reports</strong><small>Membership performance</small></span></button>
        </div>
        <div class="network-mini">
          <div class="network-mini-top"><span>Nationwide rollout</span><strong>${d.active_branches.toLocaleString()} active</strong></div>
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
    <div class="toolbar"><input id="memberSearch" class="search" placeholder="Search member number, name or phone" value="${esc(q)}"/><button id="newMemberBtn" class="btn primary">+ Register member</button></div>
    <div class="card"><div class="card-head"><div><p class="eyebrow">NATIONAL REGISTRY</p><h3>Simba members</h3></div><span class="pill active">${members.length} shown</span></div>${memberTable(members)}</div>`;
  $('#newMemberBtn').addEventListener('click', openMemberDialog);
  let timer;
  $('#memberSearch').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => loadMembers(e.target.value.trim()), 250); });
}

async function loadBranches() {
  state.branches = await api('/api/branches');
  $('#memberBranch').innerHTML = '<option value="">Unassigned</option>' + state.branches.map(b => `<option value="${b.id}">${esc(b.code)} — ${esc(b.name)}</option>`).join('');
  $('#branchesView').innerHTML = `
    <div class="toolbar"><div><p class="muted">Manage the nationwide Simba branch network from one place.</p></div><button id="newBranchBtn" class="btn primary">+ Add branch</button></div>
    <div class="grid branch-grid">${state.branches.length ? state.branches.map(b => `<div class="card branch-card"><span class="pill active">● ${esc(b.status)}</span><h3>${esc(b.name)}</h3><div class="branch-meta">${esc(b.code)} · ${esc(b.region)}${b.district ? ` · ${esc(b.district)}` : ''}</div><div class="branch-count">${Number(b.member_count).toLocaleString()}</div><div class="muted">registered members</div></div>`).join('') : '<div class="card empty">No branches yet.</div>'}</div>`;
  $('#newBranchBtn')?.addEventListener('click', () => $('#branchDialog').showModal());
}

async function loadReports() {
  const rows = await api('/api/reports/branches');
  const max = Math.max(1, ...rows.map(r => Number(r.members)));
  $('#reportsView').innerHTML = `<div class="card"><div class="card-head"><div><p class="eyebrow">NATIONWIDE ANALYTICS</p><h3>Membership by branch</h3></div><span class="pill active">Live data</span></div>${rows.length ? rows.map(r => `<div class="report-bar"><strong>${esc(r.code)}</strong><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Number(r.members)/max*100)}%"></div></div><span>${Number(r.members).toLocaleString()}</span></div>`).join('') : '<div class="empty">No branch data yet.</div>'}</div>`;
}

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
  $('#pageTitle').textContent = ({ dashboard:'Overview', members:'Members', branches:'Branches', reports:'Reports' })[name];
  if (name === 'dashboard') await loadDashboard();
  if (name === 'members') await loadMembers();
  if (name === 'branches') await loadBranches();
  if (name === 'reports') await loadReports();
}

$$('.nav').forEach(n => n.addEventListener('click', () => switchView(n.dataset.view)));
boot();
