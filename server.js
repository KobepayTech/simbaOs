import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://simbaos:simbaos@localhost:5432/simbaos';

const pool = new Pool({ connectionString: DATABASE_URL });

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

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@simbaos.local').toLowerCase();
  const adminExists = await pool.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
  if (!adminExists.rowCount) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'SimbaOS123!', 12);
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

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'SimbaOS', database: 'connected', time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'disconnected', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const result = await pool.query('SELECT id,name,email,password_hash,role,branch_id,status FROM users WHERE email=$1', [email]);
  const user = result.rows[0];
  if (!user || user.status !== 'active' || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, branch_id: user.branch_id } });
});

app.get('/api/me', auth, async (req, res) => {
  const result = await pool.query('SELECT id,name,email,role,branch_id,status FROM users WHERE id=$1', [req.auth.sub]);
  res.json(result.rows[0]);
});

app.get('/api/dashboard', auth, async (_req, res) => {
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
});

app.get('/api/branches', auth, async (_req, res) => {
  const result = await pool.query(`SELECT b.*, COUNT(m.id)::int AS member_count
    FROM branches b LEFT JOIN members m ON m.branch_id=b.id GROUP BY b.id ORDER BY b.name`);
  res.json(result.rows);
});

app.post('/api/branches', auth, allow('super_admin','hq_admin'), async (req, res) => {
  const { code, name, region, district, address, phone } = req.body;
  if (!code || !name || !region) return res.status(400).json({ error: 'code, name and region are required' });
  const result = await pool.query(
    `INSERT INTO branches(code,name,region,district,address,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [String(code).toUpperCase(), name, region, district || null, address || null, phone || null]
  );
  await audit(req, 'create', 'branch', result.rows[0].id, { code, name });
  res.status(201).json(result.rows[0]);
});

app.get('/api/members', auth, async (req, res) => {
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
});

app.post('/api/members', auth, allow('super_admin','hq_admin','branch_admin','registrar'), async (req, res) => {
  const { first_name, middle_name, last_name, phone, email, gender, date_of_birth, national_id, region, district, branch_id, membership_type } = req.body;
  if (!first_name || !last_name || !phone) return res.status(400).json({ error: 'first_name, last_name and phone are required' });
  const seq = Number((await pool.query('SELECT COUNT(*)::int + 1 AS n FROM members')).rows[0].n);
  const memberNo = `SIM-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
  const result = await pool.query(
    `INSERT INTO members(member_no,first_name,middle_name,last_name,phone,email,gender,date_of_birth,national_id,region,district,branch_id,membership_type)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [memberNo, first_name, middle_name || null, last_name, phone, email || null, gender || null, date_of_birth || null, national_id || null, region || null, district || null, branch_id || null, membership_type || 'standard']
  );
  await audit(req, 'create', 'member', result.rows[0].id, { member_no: memberNo });
  res.status(201).json(result.rows[0]);
});

app.get('/api/members/:id', auth, async (req, res) => {
  const result = await pool.query(`SELECT m.*,b.name AS branch_name FROM members m LEFT JOIN branches b ON b.id=m.branch_id WHERE m.id=$1`, [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Member not found' });
  const payments = await pool.query('SELECT * FROM payments WHERE member_id=$1 ORDER BY paid_at DESC', [req.params.id]);
  res.json({ ...result.rows[0], payments: payments.rows });
});

app.post('/api/members/:id/payments', auth, allow('super_admin','hq_admin','branch_admin','registrar'), async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const result = await pool.query(
    `INSERT INTO payments(member_id,amount,kind,reference,method,status) VALUES($1,$2,$3,$4,$5,'confirmed') RETURNING *`,
    [req.params.id, amount, req.body.kind || 'membership', req.body.reference || null, req.body.method || null]
  );
  await audit(req, 'create', 'payment', result.rows[0].id, { member_id: req.params.id, amount });
  res.status(201).json(result.rows[0]);
});

app.get('/api/reports/branches', auth, async (_req, res) => {
  const result = await pool.query(`SELECT b.id,b.code,b.name,b.region,COUNT(m.id)::int AS members,
    COUNT(m.id) FILTER (WHERE m.status='active')::int AS active_members
    FROM branches b LEFT JOIN members m ON m.branch_id=b.id GROUP BY b.id ORDER BY members DESC,b.name`);
  res.json(result.rows);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`SimbaOS listening on :${PORT}`)))
  .catch((error) => {
    console.error('Failed to initialise SimbaOS:', error);
    process.exit(1);
  });
