// SimbaOS smoke tests.
//
// Boots server.js against a throwaway PostgreSQL database and covers the P0 failure modes
// (process-killing query errors, insecure secrets, member-number reuse) plus the core
// branch/member/payment flow.
//
//   createdb simbaos_test
//   SIMBAOS_TEST_DATABASE_URL=postgres://simbaos:simbaos@localhost:5432/simbaos_test npm test
//
// The suite wipes the schema it points at, so it refuses to run against a database whose name
// does not look like a test database unless SIMBAOS_TEST_ALLOW_ANY_DB=1.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATABASE_URL = process.env.SIMBAOS_TEST_DATABASE_URL
  || 'postgres://simbaos:simbaos@localhost:5432/simbaos_test';
const FIRST_PORT = Number(process.env.SIMBAOS_TEST_PORT || 8099);
const JWT_SECRET = 'smoke-test-jwt-secret-long-enough-to-pass-validation';
const ADMIN_EMAIL = 'admin@simbaos.test';
const ADMIN_PASSWORD = 'smoke-test-admin-password';

const databaseName = (DATABASE_URL.split('?')[0].split('/').pop() || '').trim();
if (!/(^|_)test$/.test(databaseName) && process.env.SIMBAOS_TEST_ALLOW_ANY_DB !== '1') {
  console.error(`Refusing to run: "${databaseName}" does not look like a test database.`);
  console.error('These tests drop and recreate the public schema. Point SIMBAOS_TEST_DATABASE_URL');
  console.error('at a disposable database, or set SIMBAOS_TEST_ALLOW_ANY_DB=1 to override.');
  process.exit(1);
}

let nextPort = FIRST_PORT;
const running = new Set();

/** Start server.js with a hermetic environment. Pass null in `env` to unset a variable. */
function startServer(env = {}) {
  const port = nextPort++;
  const base = { PORT: String(port), DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD,
    NODE_ENV: 'test', DOTENV_CONFIG_PATH: path.join(ROOT, 'test', 'no-such.env'), ...env };
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(base)) {
    if (value === null) delete childEnv[key];
    else childEnv[key] = value;
  }

  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const server = { child, port, base: `http://127.0.0.1:${port}`, stdout: '', stderr: '', exitCode: null };
  child.stdout.on('data', (d) => { server.stdout += d; });
  child.stderr.on('data', (d) => { server.stderr += d; });
  server.exited = new Promise((resolve) => child.on('exit', (code) => { server.exitCode = code; running.delete(server); resolve(code); }));
  running.add(server);
  return server;
}

function stopServer(server) {
  if (server && server.exitCode === null) server.child.kill('SIGKILL');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the process to exit. Fails the test rather than hanging if it stays up. */
async function expectExit(server, timeoutMs = 20000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`server did not exit within ${timeoutMs}ms; it is still running`)), timeoutMs);
  });
  try {
    return await Promise.race([server.exited, timeout]);
  } finally {
    clearTimeout(timer);
    stopServer(server);
  }
}

/** Resolve once the server answers /api/health, or reject if it exits or never comes up. */
async function waitForHealth(server, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    if (server.exitCode !== null) throw new Error(`server exited early (code ${server.exitCode})\n${server.stderr}`);
    try {
      const response = await fetch(`${server.base}/api/health`);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error(`server did not become healthy\n${server.stderr}`);
}

async function call(server, method, endpoint, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${server.base}${endpoint}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text, contentType: response.headers.get('content-type') || '' };
}

async function withDatabase(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const resetDatabase = () => withDatabase((c) => c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'));

const login = async (server) => (await call(server, 'POST', '/api/auth/login',
  { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }));

after(() => { for (const server of running) stopServer(server); });

// ---------------------------------------------------------------------------------------------

describe('configuration gate', () => {
  it('refuses to start in production with placeholder secrets', async () => {
    const server = startServer({ NODE_ENV: 'production', JWT_SECRET: 'replace-with-long-random-secret', ADMIN_PASSWORD: 'SimbaOS123!' });
    assert.equal(await expectExit(server), 1);
    assert.match(server.stderr, /JWT_SECRET is still a placeholder/);
    assert.match(server.stderr, /ADMIN_PASSWORD is still a placeholder/);
  });

  it('refuses to start in production with a short JWT secret', async () => {
    const server = startServer({ NODE_ENV: 'production', JWT_SECRET: 'too-short' });
    assert.equal(await expectExit(server), 1);
    assert.match(server.stderr, /JWT_SECRET must be at least 32 characters/);
  });

  it('refuses to start in production with a short admin password', async () => {
    const server = startServer({ NODE_ENV: 'production', ADMIN_PASSWORD: 'short' });
    assert.equal(await expectExit(server), 1);
    assert.match(server.stderr, /ADMIN_PASSWORD must be at least 12 characters/);
  });

  it('refuses to start in production with unset secrets', async () => {
    const server = startServer({ NODE_ENV: 'production', JWT_SECRET: null, ADMIN_PASSWORD: null });
    assert.equal(await expectExit(server), 1);
    assert.match(server.stderr, /JWT_SECRET is not set/);
  });

  it('starts in development with unset secrets but warns', async () => {
    await resetDatabase();
    const server = startServer({ NODE_ENV: 'development', JWT_SECRET: null, ADMIN_PASSWORD: null });
    try {
      await waitForHealth(server);
      assert.match(server.stderr, /insecure configuration/);
      assert.match(server.stderr, /throwaway secret/);
    } finally { stopServer(server); }
  });
});

// ---------------------------------------------------------------------------------------------

describe('API', () => {
  let server;
  let token;

  before(async () => {
    await resetDatabase();
    server = startServer();
    await waitForHealth(server);
    const response = await login(server);
    assert.equal(response.status, 200, `login failed: ${response.text}`);
    token = response.json.token;
  });

  after(() => stopServer(server));

  it('reports health without leaking driver detail', async () => {
    const response = await call(server, 'GET', '/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.json.database, 'connected');
    assert.ok(!('error' in response.json));
  });

  it('rejects unauthenticated requests', async () => {
    assert.equal((await call(server, 'GET', '/api/dashboard')).status, 401);
  });

  it('answers an unknown /api path with JSON 404, not the SPA shell', async () => {
    const response = await call(server, 'GET', '/api/does-not-exist', { token });
    assert.equal(response.status, 404);
    assert.match(response.contentType, /application\/json/);
    assert.equal(response.json.error, 'Unknown endpoint');
  });

  it('still serves the SPA shell for non-API paths', async () => {
    const response = await call(server, 'GET', '/members');
    assert.equal(response.status, 200);
    assert.match(response.text, /<title>SimbaOS<\/title>/);
  });

  it('survives a malformed UUID in a path parameter', async () => {
    const response = await call(server, 'GET', '/api/members/not-a-uuid', { token });
    assert.equal(response.status, 400);
    assert.equal(server.exitCode, null, 'server process died');
  });

  it('survives a duplicate branch code and reports a conflict', async () => {
    const body = { code: 'DUP-01', name: 'Duplicate', region: 'Mwanza' };
    assert.equal((await call(server, 'POST', '/api/branches', { body, token })).status, 201);
    const response = await call(server, 'POST', '/api/branches', { body, token });
    assert.equal(response.status, 409);
    assert.equal(server.exitCode, null, 'server process died');
  });

  it('survives a member pointed at a branch that does not exist', async () => {
    const response = await call(server, 'POST', '/api/members', {
      token,
      body: { first_name: 'Orphan', last_name: 'Record', phone: '+255700000500', branch_id: '00000000-0000-0000-0000-000000000000' }
    });
    assert.equal(response.status, 400);
    assert.equal(server.exitCode, null, 'server process died');
  });

  it('does not leak internal detail on a server fault', async () => {
    const response = await call(server, 'GET', '/api/members/not-a-uuid', { token });
    assert.ok(!/postgres|syntax|stack|at Object/i.test(response.text), `leaked detail: ${response.text}`);
  });

  it('issues unique member numbers under concurrent registration', async () => {
    const created = await Promise.all(Array.from({ length: 12 }, (_, i) => call(server, 'POST', '/api/members', {
      token, body: { first_name: 'Race', last_name: `Entry${i}`, phone: `+2557000006${String(i).padStart(2, '0')}` }
    })));
    assert.ok(created.every((r) => r.status === 201), `statuses: ${created.map((r) => r.status).join(',')}`);
    const numbers = new Set(created.map((r) => r.json.member_no));
    assert.equal(numbers.size, created.length, 'member numbers collided');
  });

  it('never reissues a member number after a deletion', async () => {
    const before = (await call(server, 'POST', '/api/members', {
      token, body: { first_name: 'Before', last_name: 'Wipe', phone: '+255700000700' }
    })).json.member_no;
    await withDatabase((c) => c.query('DELETE FROM members'));
    const afterWipe = await call(server, 'POST', '/api/members', {
      token, body: { first_name: 'After', last_name: 'Wipe', phone: '+255700000701' }
    });
    assert.equal(afterWipe.status, 201);
    assert.notEqual(afterWipe.json.member_no, before);
  });

  it('runs the branch, member, payment and reporting flow', async () => {
    const branch = await call(server, 'POST', '/api/branches', {
      token, body: { code: 'MBY-01', name: 'Mbeya Branch', region: 'Mbeya' }
    });
    assert.equal(branch.status, 201);

    const member = await call(server, 'POST', '/api/members', {
      token,
      body: { first_name: 'Juma', last_name: 'Mwita', phone: '+255712000001', branch_id: branch.json.id, date_of_birth: '1995-03-04' }
    });
    assert.equal(member.status, 201);
    assert.match(member.json.member_no, /^SIM-\d{4}-\d{6}$/);

    const payment = await call(server, 'POST', `/api/members/${member.json.id}/payments`, {
      token, body: { amount: 50000, method: 'mpesa', reference: 'TX123' }
    });
    assert.equal(payment.status, 201);
    assert.equal((await call(server, 'POST', `/api/members/${member.json.id}/payments`, { token, body: { amount: -5 } })).status, 400);

    const detail = await call(server, 'GET', `/api/members/${member.json.id}`, { token });
    assert.equal(detail.json.branch_name, 'Mbeya Branch');
    assert.equal(detail.json.payments.length, 1);

    const search = await call(server, 'GET', '/api/members?q=Mwita', { token });
    assert.equal(search.json.length, 1);

    const dashboard = await call(server, 'GET', '/api/dashboard', { token });
    assert.equal(dashboard.json.monthly_revenue, 50000);
    assert.ok(dashboard.json.total_members >= 1);

    assert.ok((await call(server, 'GET', '/api/reports/branches', { token })).json.length >= 1);

    const audited = await withDatabase((c) => c.query('SELECT COUNT(*)::int AS n FROM audit_log'));
    assert.ok(audited.rows[0].n >= 3, 'creates were not audited');
  });
});

// ---------------------------------------------------------------------------------------------

describe('upgrade of an existing database', () => {
  it('adopts the sequence past the highest member number already issued', async () => {
    await resetDatabase();

    // A deployment created before sequence-backed numbering: legacy rows, no sequence.
    const bootstrap = startServer();
    await waitForHealth(bootstrap);
    stopServer(bootstrap);
    await bootstrap.exited;

    // Numbers carry the year they were issued in, so seed the year the server will use now.
    const year = new Date().getFullYear();
    await withDatabase(async (c) => {
      await c.query('DROP SEQUENCE IF EXISTS member_no_seq CASCADE');
      await c.query('ALTER TABLE members ALTER COLUMN member_no DROP DEFAULT');
      await c.query(`INSERT INTO members(member_no,first_name,last_name,phone) VALUES
        ($1,'Legacy','One','+255700000041'),
        ($2,'Legacy','Two','+255700000042')`, [`SIM-${year}-000041`, `SIM-${year}-000042`]);
    });

    const server = startServer();
    try {
      await waitForHealth(server);
      const token = (await login(server)).json.token;
      const created = await call(server, 'POST', '/api/members', {
        token, body: { first_name: 'Upgrade', last_name: 'Check', phone: '+255700000900' }
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.member_no, `SIM-${year}-000043`);
    } finally { stopServer(server); }
  });
});
