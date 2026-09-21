import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8080);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://simbaos:simbaos@localhost:5432/simbaos';

// Placeholder values shipped in .env.example, docker-compose.yml and the README. A deployment
// still using any of them is effectively unauthenticated, so production refuses to boot on them.
const PLACEHOLDER_SECRETS = new Set([
  'change-me-in-production',
  'replace-this-secret',
  'replace-with-long-random-secret'
]);
const PLACEHOLDER_PASSWORDS = new Set([
  'SimbaOS123!',
  'replace-with-strong-admin-password',
  'simbaos-change-me'
]);

function resolveSecrets() {
  const problems = [];
  const jwtSecret = process.env.JWT_SECRET || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (!jwtSecret) problems.push('JWT_SECRET is not set.');
  else if (PLACEHOLDER_SECRETS.has(jwtSecret)) problems.push('JWT_SECRET is still a placeholder value.');
  else if (jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters.');

  if (!adminPassword) problems.push('ADMIN_PASSWORD is not set.');
  else if (PLACEHOLDER_PASSWORDS.has(adminPassword)) problems.push('ADMIN_PASSWORD is still a placeholder value.');
  else if (adminPassword.length < 12) problems.push('ADMIN_PASSWORD must be at least 12 characters.');

  if (!problems.length) return { jwtSecret, adminPassword };

  if (IS_PRODUCTION) {
    console.error('SimbaOS refused to start - insecure configuration:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Set real values in .env (see .env.example) and restart.');
    process.exit(1);
  }

  console.warn('SimbaOS is starting in development mode with an insecure configuration:');
  for (const problem of problems) console.warn(`  - ${problem}`);
  console.warn('  Sessions use a throwaway secret and will not survive a restart.');
  console.warn('  This configuration is refused outright when NODE_ENV=production.');

  const usableSecret = jwtSecret && !PLACEHOLDER_SECRETS.has(jwtSecret) && jwtSecret.length >= 32;
  return {
    jwtSecret: usableSecret ? jwtSecret : crypto.randomBytes(48).toString('hex'),
    adminPassword: adminPassword || 'SimbaOS123!'
  };
}

const { jwtSecret: JWT_SECRET, adminPassword: ADMIN_PASSWORD } = resolveSecrets();

const pool = new Pool({ connectionString: DATABASE_URL });

// An error on an idle pooled client is emitted here; without a listener it would reach the
// process as an uncaught exception and stop SimbaOS.
pool.on('error', (error) => console.error('SimbaOS database pool error:', error));

// Express 4 does not catch rejections from async handlers, so a single failed query (a duplicate
// code, a malformed UUID in a path param) becomes an unhandled rejection and Node exits. Every
// async route is registered through this wrapper, which forwards failures to the error handler.
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Postgres error codes that describe a bad request rather than a server fault.
const PG_ERROR_RESPONSES = {
  '23505': [409, 'That record already exists'],
  '23503': [400, 'Referenced record does not exist'],
  '23502': [400, 'A required field is missing'],
  '23514': [400, 'A submitted value is not allowed'],
  '22001': [400, 'A submitted value is too long'],
  '22007': [400, 'Invalid date format'],
  '22008': [400, 'Invalid date value'],
  '22P02': [400, 'Malformed identifier or value']
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function initDb() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS branches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      district TEXT,
      address TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_admin','hq_admin','branch_admin','registrar','viewer')),
      branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      member_no TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      date_of_birth DATE,
      national_id TEXT,
      region TEXT,
      district TEXT,
      branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
      membership_type TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'TZS',
      kind TEXT NOT NULL DEFAULT 'membership',
      reference TEXT,
      method TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const branchCount = Number((await pool.query('SELECT COUNT(*)::int AS n FROM branches')).rows[0].n);
  if (!branchCount) {
    await pool.query(`INSERT INTO branches (code,name,region,district,address,phone) VALUES
      ('HQ','Simba SC Headquarters','Dar es Salaam','Ilala','Dar es Salaam','+255 000 000 000'),
      ('DSM-01','Dar es Salaam Central','Dar es Salaam','Ilala','Kariakoo',NULL),
      ('DOD-01','Dodoma Branch','Dodoma','Dodoma Urban','Dodoma',NULL)
    `);
  }

  // Member numbers come from a sequence applied as a column default, so the number is allocated
  // atomically with the INSERT. Deriving it from COUNT(*) collided under concurrent registration
  // and reissued numbers after a deletion, which a permanent member ID must never do.
  const sequenceExists = (await pool.query("SELECT to_regclass('public.member_no_seq') AS seq")).rows[0].seq;
  if (!sequenceExists) {
    await pool.query('CREATE SEQUENCE member_no_seq');
    // Existing deployments already issued SIM-<year>-<n>; carry on past the highest one.
    await pool.query(`
      SELECT setval(
        'member_no_seq',
        GREATEST((SELECT COALESCE(MAX(split_part(member_no,'-',3)::bigint),0)
                  FROM members WHERE member_no ~ '^SIM-[0-9]{4}-[0-9]+$'), 1),
        (SELECT EXISTS (SELECT 1 FROM members WHERE member_no ~ '^SIM-[0-9]{4}-[0-9]+$'))
      )
    `);
  }
  await pool.query(`
    ALTER TABLE members ALTER COLUMN member_no
      SET DEFAULT 'SIM-' || to_char(NOW(),'YYYY') || '-' || lpad(nextval('member_no_seq')::text, 6, '0')
  `);

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@simbaos.local').toLowerCase();
  const adminExists = await pool.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
  if (!adminExists.rowCount) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'super_admin')`,
      ['SimbaOS Administrator', adminEmail, hash]
    );
  }
}

function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role, branch_id: user.branch_id }, JWT_SECRET, { expiresIn: '12h' });
}

function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function allow(...roles) {
  return (req, res, next) => roles.includes(req.auth?.role) ? next() : res.status(403).json({ error: 'Insufficient permission' });
}

async function audit(req, action, entityType, entityId, details = {}) {
  await pool.query(
    'INSERT INTO audit_log(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [req.auth?.sub || null, action, entityType, entityId ? String(entityId) : null, JSON.stringify(details)]
  );
}

app.get('/api/health', route(async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'SimbaOS', database: 'connected', time: new Date().toISOString() });
  } catch (error) {
    // /api/health is unauthenticated, so the driver's message (host, port, user) stays in the log.
    console.error('SimbaOS health check failed:', error);
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
}));

app.post('/api/auth/login', route(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const result = await pool.query('SELECT id,name,email,password_hash,role,branch_id,status FROM users WHERE email=$1', [email]);
  const user = result.rows[0];
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, branch_id: user.branch_id } });
}));

app.get('/api/me', auth, route(async (req, res) => {
  const result = await pool.query('SELECT id,name,email,role,branch_id,status FROM users WHERE id=$1', [req.auth.sub]);
  res.json(result.rows[0]);
}));

app.get('/api/dashboard', auth, route(async (_req, res) => {
  const [members, active, branches, payments, recent] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM members'),
    pool.query("SELECT COUNT(*)::int AS n FROM members WHERE status='active'"),
    pool.query("SELECT COUNT(*)::int AS n FROM branches WHERE status='active'"),
    pool.query("SELECT COALESCE(SUM(amount),0)::numeric AS amount FROM payments WHERE status='confirmed' AND paid_at >= date_trunc('month', NOW())"),
    pool.query(`SELECT m.id,m.member_no,m.first_name,m.last_name,m.phone,m.status,m.joined_at,b.name AS branch_name
                FROM members m LEFT JOIN branches b ON b.id=m.branch_id ORDER BY m.joined_at DESC LIMIT 8`)
  ]);
  res.json({
    total_members: members.rows[0].n,
    active_members: active.rows[0].n,
    active_branches: branches.rows[0].n,
    monthly_revenue: Number(payments.rows[0].amount),
    recent_members: recent.rows
  });
}));

app.get('/api/branches', auth, route(async (_req, res) => {
  const result = await pool.query(`SELECT b.*, COUNT(m.id)::int AS member_count
    FROM branches b LEFT JOIN members m ON m.branch_id=b.id GROUP BY b.id ORDER BY b.name`);
  res.json(result.rows);
}));

app.post('/api/branches', auth, allow('super_admin','hq_admin'), route(async (req, res) => {
  const { code, name, region, district, address, phone } = req.body;
  if (!code || !name || !region) return res.status(400).json({ error: 'code, name and region are required' });
  const result = await pool.query(
    `INSERT INTO branches(code,name,region,district,address,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [String(code).toUpperCase(), name, region, district || null, address || null, phone || null]
  );
  await audit(req, 'create', 'branch', result.rows[0].id, { code, name });
  res.status(201).json(result.rows[0]);
}));

app.get('/api/members', auth, route(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const branchId = String(req.query.branch_id || '').trim();
  const values = [];
  const where = [];
  if (q) {
    values.push(`%${q}%`);
    where.push(`(m.member_no ILIKE $${values.length} OR m.first_name ILIKE $${values.length} OR m.last_name ILIKE $${values.length} OR m.phone ILIKE $${values.length})`);
  }
  if (branchId) {
    values.push(branchId);
    where.push(`m.branch_id=$${values.length}`);
  }
  const sql = `SELECT m.*,b.name AS branch_name FROM members m LEFT JOIN branches b ON b.id=m.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.joined_at DESC LIMIT 200`;
  res.json((await pool.query(sql, values)).rows);
}));

app.post('/api/members', auth, allow('super_admin','hq_admin','branch_admin','registrar'), route(async (req, res) => {
  const { first_name, middle_name, last_name, phone, email, gender, date_of_birth, national_id, region, district, branch_id, membership_type } = req.body;
  if (!first_name || !last_name || !phone) return res.status(400).json({ error: 'first_name, last_name and phone are required' });
  const result = await pool.query(
    `INSERT INTO members(first_name,middle_name,last_name,phone,email,gender,date_of_birth,national_id,region,district,branch_id,membership_type)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [first_name, middle_name || null, last_name, phone, email || null, gender || null, date_of_birth || null, national_id || null, region || null, district || null, branch_id || null, membership_type || 'standard']
  );
  await audit(req, 'create', 'member', result.rows[0].id, { member_no: result.rows[0].member_no });
  res.status(201).json(result.rows[0]);
}));

app.get('/api/members/:id', auth, route(async (req, res) => {
  const result = await pool.query(`SELECT m.*,b.name AS branch_name FROM members m LEFT JOIN branches b ON b.id=m.branch_id WHERE m.id=$1`, [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Member not found' });
  const payments = await pool.query('SELECT * FROM payments WHERE member_id=$1 ORDER BY paid_at DESC', [req.params.id]);
  res.json({ ...result.rows[0], payments: payments.rows });
}));

app.post('/api/members/:id/payments', auth, allow('super_admin','hq_admin','branch_admin','registrar'), route(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const result = await pool.query(
    `INSERT INTO payments(member_id,amount,kind,reference,method,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING *`,
    [req.params.id, amount, req.body.kind || 'membership', req.body.reference || null, req.body.method || null]
  );
  await audit(req, 'create', 'payment', result.rows[0].id, { member_id: req.params.id, amount });
  res.status(201).json(result.rows[0]);
}));

app.get('/api/reports/branches', auth, route(async (_req, res) => {
  const result = await pool.query(`SELECT b.id,b.code,b.name,b.region,COUNT(m.id)::int AS members,
    COUNT(m.id) FILTER (WHERE m.status='active')::int AS active_members
    FROM branches b LEFT JOIN members m ON m.branch_id=b.id GROUP BY b.id ORDER BY members DESC,b.name`);
  res.json(result.rows);
}));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Anything a route forwards with next(error) lands here. Client mistakes are mapped to a 4xx with
// a fixed message; everything else is logged server-side and reported as a bare 500 so internal
// detail never reaches the browser.
app.use((error, _req, res, _next) => {
  const [status, message] = PG_ERROR_RESPONSES[error?.code] || [500, 'Internal server error'];
  if (status === 500) console.error('SimbaOS request failed:', error);
  res.status(status).json({ error: message });
});

initDb()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`SimbaOS listening on :${PORT}`)))
  .catch((error) => {
    console.error('Failed to initialise SimbaOS:', error);
    process.exit(1);
  });
