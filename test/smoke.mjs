// SimbaOS API smoke tests.
//
// Boots server.js against a throwaway PostgreSQL database and covers the P0 failure modes
// (process-killing query errors, insecure secrets, member-number reuse), branch scoping and
// staff management, plus the core branch/member/payment flow.
//
//   createdb simbaos_test
//   SIMBAOS_TEST_DATABASE_URL=postgres://simbaos:simbaos@localhost:5432/simbaos_test npm test

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EMAIL, ADMIN_PASSWORD, STAFF_PASSWORD, call, createStaff, expectExit, login, loginAs,
  resetDatabase, startServer, stopAllServers, stopServer, waitForHealth, withDatabase
} from './support/helpers.mjs';

after(stopAllServers);

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

// ---------------------------------------------------------------------------------------------

describe('branch scoping', () => {
  let server, hq, mbeya, dodoma, mbeyaRegistrar, mbeyaAdmin, mbeyaMember, dodomaMember;

  before(async () => {
    await resetDatabase();
    server = startServer();
    await waitForHealth(server);
    hq = (await login(server)).json.token;

    mbeya = (await call(server, 'POST', '/api/branches', { token: hq, body: { code: 'MBY-01', name: 'Mbeya', region: 'Mbeya' } })).json;
    dodoma = (await call(server, 'POST', '/api/branches', { token: hq, body: { code: 'DOD-02', name: 'Dodoma East', region: 'Dodoma' } })).json;

    mbeyaMember = (await call(server, 'POST', '/api/members', {
      token: hq, body: { first_name: 'Mbeya', last_name: 'Member', phone: '+255730000001', branch_id: mbeya.id }
    })).json;
    dodomaMember = (await call(server, 'POST', '/api/members', {
      token: hq, body: { first_name: 'Dodoma', last_name: 'Member', phone: '+255730000002', branch_id: dodoma.id }
    })).json;
    await call(server, 'POST', `/api/members/${dodomaMember.id}/payments`, { token: hq, body: { amount: 90000 } });
    await call(server, 'POST', `/api/members/${mbeyaMember.id}/payments`, { token: hq, body: { amount: 10000 } });

    mbeyaRegistrar = await createStaff(server, hq, { name: 'Mbeya Registrar', email: 'registrar@mbeya.test', role: 'registrar', branch_id: mbeya.id });
    mbeyaAdmin = await createStaff(server, hq, { name: 'Mbeya Admin', email: 'admin@mbeya.test', role: 'branch_admin', branch_id: mbeya.id });
  });

  after(() => stopServer(server));

  it('limits the member registry to the caller\'s branch', async () => {
    const national = await call(server, 'GET', '/api/members', { token: hq });
    assert.equal(national.json.length, 2);

    const scoped = await call(server, 'GET', '/api/members', { token: mbeyaRegistrar.token });
    assert.deepEqual(scoped.json.map((m) => m.member_no), [mbeyaMember.member_no]);
  });

  it('ignores an attempt to widen the search to another branch', async () => {
    const response = await call(server, 'GET', `/api/members?branch_id=${dodoma.id}`, { token: mbeyaRegistrar.token });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.map((m) => m.member_no), [mbeyaMember.member_no]);
  });

  it('hides a member from another branch behind a 404', async () => {
    assert.equal((await call(server, 'GET', `/api/members/${mbeyaMember.id}`, { token: mbeyaRegistrar.token })).status, 200);
    assert.equal((await call(server, 'GET', `/api/members/${dodomaMember.id}`, { token: mbeyaRegistrar.token })).status, 404);
  });

  it('refuses a payment against a member in another branch', async () => {
    const response = await call(server, 'POST', `/api/members/${dodomaMember.id}/payments`, {
      token: mbeyaRegistrar.token, body: { amount: 1000 }
    });
    assert.equal(response.status, 404);
  });

  it('refuses registration into another branch and defaults to the caller\'s own', async () => {
    const rejected = await call(server, 'POST', '/api/members', {
      token: mbeyaRegistrar.token,
      body: { first_name: 'Wrong', last_name: 'Branch', phone: '+255730000003', branch_id: dodoma.id }
    });
    assert.equal(rejected.status, 403);

    const created = await call(server, 'POST', '/api/members', {
      token: mbeyaRegistrar.token, body: { first_name: 'Right', last_name: 'Branch', phone: '+255730000004' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.branch_id, mbeya.id);
  });

  it('scopes the dashboard totals and revenue', async () => {
    const national = await call(server, 'GET', '/api/dashboard', { token: hq });
    assert.equal(national.json.scope, 'national');
    assert.equal(national.json.monthly_revenue, 100000);

    const scoped = await call(server, 'GET', '/api/dashboard', { token: mbeyaRegistrar.token });
    assert.equal(scoped.json.scope, 'branch');
    assert.equal(scoped.json.monthly_revenue, 10000, 'revenue from another branch leaked');
    assert.equal(scoped.json.active_branches, 1);
    assert.ok(scoped.json.recent_members.every((m) => m.branch_name === 'Mbeya'));
  });

  it('scopes the branch list and the branch report', async () => {
    assert.ok((await call(server, 'GET', '/api/branches', { token: hq })).json.length >= 2);
    const branches = await call(server, 'GET', '/api/branches', { token: mbeyaRegistrar.token });
    assert.deepEqual(branches.json.map((b) => b.code), ['MBY-01']);

    const report = await call(server, 'GET', '/api/reports/branches', { token: mbeyaRegistrar.token });
    assert.deepEqual(report.json.map((r) => r.code), ['MBY-01']);
  });

  it('keeps branch staff out of branch creation', async () => {
    const response = await call(server, 'POST', '/api/branches', {
      token: mbeyaAdmin.token, body: { code: 'NEW-01', name: 'Nope', region: 'Mbeya' }
    });
    assert.equal(response.status, 403);
  });

  it('refuses a branch-scoped account with no branch assigned', async () => {
    // Strip the branch directly, the way a bad migration or manual edit would.
    await withDatabase((c) => c.query('UPDATE users SET branch_id=NULL WHERE email=$1', ['registrar@mbeya.test']));
    const response = await call(server, 'GET', '/api/members', { token: mbeyaRegistrar.token });
    assert.equal(response.status, 403, 'an unassigned branch account must not fall back to national access');
    await withDatabase((c) => c.query('UPDATE users SET branch_id=$1 WHERE email=$2', [mbeya.id, 'registrar@mbeya.test']));
  });
});

// ---------------------------------------------------------------------------------------------

describe('staff management', () => {
  let server, hq, branch, otherBranch, branchAdmin, registrar;

  before(async () => {
    await resetDatabase();
    server = startServer();
    await waitForHealth(server);
    hq = (await login(server)).json.token;
    branch = (await call(server, 'POST', '/api/branches', { token: hq, body: { code: 'ARU-01', name: 'Arusha', region: 'Arusha' } })).json;
    otherBranch = (await call(server, 'POST', '/api/branches', { token: hq, body: { code: 'TAN-01', name: 'Tanga', region: 'Tanga' } })).json;
    branchAdmin = await createStaff(server, hq, { name: 'Arusha Admin', email: 'admin@arusha.test', role: 'branch_admin', branch_id: branch.id });
    registrar = await createStaff(server, hq, { name: 'Arusha Registrar', email: 'registrar@arusha.test', role: 'registrar', branch_id: branch.id });
  });

  after(() => stopServer(server));

  it('lets a new staff account sign in and work', async () => {
    const created = await call(server, 'POST', '/api/members', {
      token: registrar.token, body: { first_name: 'Signed', last_name: 'In', phone: '+255740000001' }
    });
    assert.equal(created.status, 201);
  });

  it('requires a branch for a branch role and forbids one for a national role', async () => {
    const missing = await call(server, 'POST', '/api/users', {
      token: hq, body: { name: 'No Branch', email: 'nobranch@test.test', role: 'registrar', password: STAFF_PASSWORD }
    });
    assert.equal(missing.status, 400);

    const national = await call(server, 'POST', '/api/users', {
      token: hq, body: { name: 'HQ Two', email: 'hq2@test.test', role: 'hq_admin', branch_id: branch.id, password: STAFF_PASSWORD }
    });
    assert.equal(national.status, 201);
    assert.equal(national.json.branch_id, null, 'a national role must not be pinned to a branch');
  });

  it('rejects weak passwords and duplicate emails', async () => {
    assert.equal((await call(server, 'POST', '/api/users', {
      token: hq, body: { name: 'Weak', email: 'weak@test.test', role: 'viewer', branch_id: branch.id, password: 'short' }
    })).status, 400);

    assert.equal((await call(server, 'POST', '/api/users', {
      token: hq, body: { name: 'Clash', email: 'admin@arusha.test', role: 'viewer', branch_id: branch.id, password: STAFF_PASSWORD }
    })).status, 409);
  });

  it('stops anyone handing out a role above their own', async () => {
    assert.equal((await call(server, 'POST', '/api/users', {
      token: branchAdmin.token, body: { name: 'Climb', email: 'climb@test.test', role: 'hq_admin', password: STAFF_PASSWORD }
    })).status, 403);

    assert.equal((await call(server, 'POST', '/api/users', {
      token: branchAdmin.token, body: { name: 'Peer', email: 'peer@test.test', role: 'branch_admin', password: STAFF_PASSWORD }
    })).status, 403);

    const allowed = await call(server, 'POST', '/api/users', {
      token: branchAdmin.token, body: { name: 'New Registrar', email: 'new@arusha.test', role: 'registrar', password: STAFF_PASSWORD }
    });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.json.branch_id, branch.id, 'a branch admin must create into their own branch');
  });

  it('keeps a branch admin away from staff in another branch', async () => {
    const outsider = await createStaff(server, hq, { name: 'Tanga Registrar', email: 'registrar@tanga.test', role: 'registrar', branch_id: otherBranch.id });

    const listed = await call(server, 'GET', '/api/users', { token: branchAdmin.token });
    assert.ok(listed.json.every((u) => u.branch_id === branch.id), 'staff from another branch were listed');

    assert.equal((await call(server, 'PATCH', `/api/users/${outsider.user.id}`, {
      token: branchAdmin.token, body: { name: 'Hijacked' }
    })).status, 404);

    assert.equal((await call(server, 'POST', `/api/users/${outsider.user.id}/password`, {
      token: branchAdmin.token, body: { password: 'another-long-password' }
    })).status, 404);
  });

  it('lets you rename yourself but never suspend yourself', async () => {
    const me = (await call(server, 'GET', '/api/me', { token: branchAdmin.token })).json;
    assert.equal((await call(server, 'PATCH', `/api/users/${me.id}`, { token: branchAdmin.token, body: { name: 'Renamed' } })).status, 200);
    assert.equal((await call(server, 'PATCH', `/api/users/${me.id}`, { token: branchAdmin.token, body: { status: 'suspended' } })).status, 403);
  });

  it('sends a self password change through the endpoint that asks for the current one', async () => {
    const me = (await call(server, 'GET', '/api/me', { token: branchAdmin.token })).json;
    assert.equal((await call(server, 'POST', `/api/users/${me.id}/password`, {
      token: branchAdmin.token, body: { password: 'sneaky-long-password' }
    })).status, 403);
  });

  it('stops anyone escalating their own role', async () => {
    const me = (await call(server, 'GET', '/api/me', { token: branchAdmin.token })).json;
    assert.equal((await call(server, 'PATCH', `/api/users/${me.id}`, { token: branchAdmin.token, body: { role: 'hq_admin' } })).status, 403);
    assert.equal((await call(server, 'PATCH', `/api/users/${me.id}`, { token: branchAdmin.token, body: { role: 'super_admin' } })).status, 403);
  });

  it('keeps an HQ admin away from a super admin account entirely', async () => {
    const superAdmin = (await call(server, 'GET', '/api/me', { token: hq })).json;
    const hqAdmin = await createStaff(server, hq, { name: 'HQ Admin', email: 'hq@test.test', role: 'hq_admin' });

    assert.equal((await call(server, 'PATCH', `/api/users/${superAdmin.id}`, { token: hqAdmin.token, body: { role: 'hq_admin' } })).status, 403);
    assert.equal((await call(server, 'PATCH', `/api/users/${superAdmin.id}`, { token: hqAdmin.token, body: { status: 'suspended' } })).status, 403);
    assert.equal((await call(server, 'POST', '/api/users', {
      token: hqAdmin.token, body: { name: 'Rival', email: 'rival@test.test', role: 'super_admin', password: STAFF_PASSWORD }
    })).status, 403);
  });

  it('refuses a handover that would leave no active super admin', async () => {
    const superAdmin = (await call(server, 'GET', '/api/me', { token: hq })).json;
    const lonely = await call(server, 'PATCH', `/api/users/${superAdmin.id}`, { token: hq, body: { role: 'hq_admin' } });
    assert.equal(lonely.status, 409, 'the club would have been left with no super admin');

    // With a successor in place the same handover is allowed, and the old account loses its reach.
    const successor = await createStaff(server, hq, { name: 'Successor', email: 'successor@test.test', role: 'super_admin' });
    assert.equal((await call(server, 'PATCH', `/api/users/${superAdmin.id}`, { token: hq, body: { role: 'hq_admin' } })).status, 200);
    assert.equal((await call(server, 'POST', '/api/users', {
      token: hq, body: { name: 'Too Late', email: 'toolate@test.test', role: 'super_admin', password: STAFF_PASSWORD }
    })).status, 403, 'the stepped-down account kept super admin powers');

    // Put the fixture back so later tests still have their original super admin session.
    assert.equal((await call(server, 'PATCH', `/api/users/${superAdmin.id}`, { token: successor.token, body: { role: 'super_admin' } })).status, 200);
  });

  it('applies a suspension and a role change to the next request, not the next login', async () => {
    const victim = await createStaff(server, hq, { name: 'Soon Gone', email: 'gone@arusha.test', role: 'registrar', branch_id: branch.id });
    assert.equal((await call(server, 'GET', '/api/members', { token: victim.token })).status, 200);

    await call(server, 'PATCH', `/api/users/${victim.user.id}`, { token: hq, body: { status: 'suspended' } });
    assert.equal((await call(server, 'GET', '/api/members', { token: victim.token })).status, 401,
      'a suspended account kept working on its existing token');
    assert.equal((await call(server, 'POST', '/api/auth/login', { body: { email: 'gone@arusha.test', password: STAFF_PASSWORD } })).status, 401);

    const demoted = await createStaff(server, hq, { name: 'Demote Me', email: 'demote@arusha.test', role: 'branch_admin', branch_id: branch.id });
    assert.equal((await call(server, 'GET', '/api/users', { token: demoted.token })).status, 200);
    await call(server, 'PATCH', `/api/users/${demoted.user.id}`, { token: hq, body: { role: 'registrar' } });
    assert.equal((await call(server, 'GET', '/api/users', { token: demoted.token })).status, 403,
      'a demoted account kept its old privileges on its existing token');
  });

  it('moves a member of staff to another branch', async () => {
    const mover = await createStaff(server, hq, { name: 'Mover', email: 'mover@arusha.test', role: 'registrar', branch_id: branch.id });
    await call(server, 'PATCH', `/api/users/${mover.user.id}`, { token: hq, body: { branch_id: otherBranch.id } });
    const scoped = await call(server, 'GET', '/api/branches', { token: mover.token });
    assert.deepEqual(scoped.json.map((b) => b.code), ['TAN-01']);
  });

  it('resets a password as an administrator', async () => {
    const target = await createStaff(server, hq, { name: 'Forgot', email: 'forgot@arusha.test', role: 'viewer', branch_id: branch.id });
    assert.equal((await call(server, 'POST', `/api/users/${target.user.id}/password`, { token: branchAdmin.token, body: { password: 'short' } })).status, 400);

    assert.equal((await call(server, 'POST', `/api/users/${target.user.id}/password`, {
      token: branchAdmin.token, body: { password: 'brand-new-long-password' }
    })).status, 200);
    await loginAs(server, 'forgot@arusha.test', 'brand-new-long-password');
  });

  it('changes your own password only with the current one', async () => {
    const self = await createStaff(server, hq, { name: 'Self Serve', email: 'self@arusha.test', role: 'viewer', branch_id: branch.id });

    assert.equal((await call(server, 'POST', '/api/me/password', {
      token: self.token, body: { current_password: 'wrong-password', new_password: 'my-new-long-password' }
    })).status, 401);

    assert.equal((await call(server, 'POST', '/api/me/password', {
      token: self.token, body: { current_password: STAFF_PASSWORD, new_password: 'my-new-long-password' }
    })).status, 200);
    await loginAs(server, 'self@arusha.test', 'my-new-long-password');
  });

  it('keeps a registrar and a viewer out of staff management', async () => {
    assert.equal((await call(server, 'GET', '/api/users', { token: registrar.token })).status, 403);
    assert.equal((await call(server, 'POST', '/api/users', {
      token: registrar.token, body: { name: 'Nope', email: 'nope@test.test', role: 'viewer', password: STAFF_PASSWORD }
    })).status, 403);

    const viewer = await createStaff(server, hq, { name: 'Read Only', email: 'viewer@arusha.test', role: 'viewer', branch_id: branch.id });
    assert.equal((await call(server, 'GET', '/api/members', { token: viewer.token })).status, 200);
    assert.equal((await call(server, 'POST', '/api/members', {
      token: viewer.token, body: { first_name: 'No', last_name: 'Write', phone: '+255740000900' }
    })).status, 403);
  });
});
