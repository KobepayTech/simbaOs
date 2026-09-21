// Shared plumbing for the SimbaOS test suites: a throwaway database, a spawned server, and a
// small HTTP client. Imported by smoke.mjs (API) and ui.mjs (browser).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATABASE_URL = process.env.SIMBAOS_TEST_DATABASE_URL
  || 'postgres://simbaos:simbaos@localhost:5432/simbaos_test';

export const JWT_SECRET = 'smoke-test-jwt-secret-long-enough-to-pass-validation';
export const ADMIN_EMAIL = 'admin@simbaos.test';
export const ADMIN_PASSWORD = 'smoke-test-admin-password';

const databaseName = (DATABASE_URL.split('?')[0].split('/').pop() || '').trim();
if (!/(^|_)test$/.test(databaseName) && process.env.SIMBAOS_TEST_ALLOW_ANY_DB !== '1') {
  console.error(`Refusing to run: "${databaseName}" does not look like a test database.`);
  console.error('These tests drop and recreate the public schema. Point SIMBAOS_TEST_DATABASE_URL');
  console.error('at a disposable database, or set SIMBAOS_TEST_ALLOW_ANY_DB=1 to override.');
  process.exit(1);
}

const running = new Set();

/** Start server.js with a hermetic environment. Pass null in `env` to unset a variable. */
export function startServer(env = {}) {
  // Port 0 lets the OS choose, so test files running in parallel cannot collide. The real port
  // is read back from the server's first log line.
  const base = { PORT: '0', DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD,
    NODE_ENV: 'test', DOTENV_CONFIG_PATH: path.join(ROOT, 'test', 'no-such.env'), ...env };
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(base)) {
    if (value === null) delete childEnv[key];
    else childEnv[key] = value;
  }

  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const server = { child, port: null, base: null, stdout: '', stderr: '', exitCode: null };
  child.stdout.on('data', (d) => { server.stdout += d; });
  child.stderr.on('data', (d) => { server.stderr += d; });
  server.exited = new Promise((resolve) => child.on('exit', (code) => { server.exitCode = code; running.delete(server); resolve(code); }));
  running.add(server);
  return server;
}

export function stopServer(server) {
  if (server && server.exitCode === null) server.child.kill('SIGKILL');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the process to exit. Fails the test rather than hanging if it stays up. */
export async function expectExit(server, timeoutMs = 20000) {
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
export async function waitForHealth(server, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    if (server.exitCode !== null) throw new Error(`server exited early (code ${server.exitCode})\n${server.stderr}`);
    if (!server.port) {
      const announced = server.stdout.match(/listening on :(\d+)/);
      if (announced) {
        server.port = Number(announced[1]);
        server.base = `http://127.0.0.1:${server.port}`;
      }
    }
    if (server.base) {
      try {
        const response = await fetch(`${server.base}/api/health`);
        if (response.ok) return;
      } catch { /* not listening yet */ }
    }
    await sleep(250);
  }
  throw new Error(`server did not become healthy\n${server.stderr}`);
}

export async function call(server, method, endpoint, { body, token } = {}) {
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

export async function withDatabase(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

export const resetDatabase = () => withDatabase((c) => c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'));

export const login = async (server) => (await call(server, 'POST', '/api/auth/login',
  { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }));

export const loginAs = async (server, email, password) => {
  const response = await call(server, 'POST', '/api/auth/login', { body: { email, password } });
  assert.equal(response.status, 200, `login failed for ${email}: ${response.text}`);
  return response.json.token;
};

export const STAFF_PASSWORD = 'staff-account-password';

/** Create a staff account as `token` and return the new account plus a session for it. */
export async function createStaff(server, token, { name, email, role, branch_id }) {
  const created = await call(server, 'POST', '/api/users', {
    token, body: { name, email, role, branch_id, password: STAFF_PASSWORD }
  });
  assert.equal(created.status, 201, `could not create ${role}: ${created.text}`);
  return { user: created.json, token: await loginAs(server, email, STAFF_PASSWORD) };
}

/** Kill every server a suite started. Call from a top-level after() hook. */
export function stopAllServers() {
  for (const server of running) stopServer(server);
}
