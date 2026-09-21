// SimbaOS browser tests.
//
// Drives the real UI in Chromium as three different roles. These cover what the API tests
// cannot: that the interface actually hides what a role may not use. They are skipped when
// Playwright is not installed, so `npm test` still works without it.
//
//   npm install && npx playwright install chromium
//   SIMBAOS_TEST_DATABASE_URL=postgres://simbaos:simbaos@localhost:5432/simbaos_test npm test

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EMAIL, ADMIN_PASSWORD, STAFF_PASSWORD, call, createStaff, login,
  resetDatabase, startServer, stopServer, waitForHealth
} from './support/helpers.mjs';

let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Playwright is an optional development dependency.
}

describe('browser', { skip: chromium ? false : 'playwright is not installed' }, () => {
  let server, browser, mbeya, registrar, viewer;
  // Unique per run so a re-run cannot pass on a row an earlier run left behind.
  const newStaffEmail = `ui.new.${Date.now().toString(36)}@mbeya.test`;

  before(async () => {
    await resetDatabase();
    server = startServer();
    await waitForHealth(server);

    const hq = (await login(server)).json.token;
    mbeya = (await call(server, 'POST', '/api/branches', { token: hq, body: { code: 'MBY-01', name: 'Mbeya', region: 'Mbeya' } })).json;
    const dodoma = (await call(server, 'POST', '/api/branches', { token: hq, body: { code: 'DOD-02', name: 'Dodoma East', region: 'Dodoma' } })).json;

    await call(server, 'POST', '/api/members', { token: hq, body: { first_name: 'Mbeya', last_name: 'Member', phone: '+255750000001', branch_id: mbeya.id } });
    await call(server, 'POST', '/api/members', { token: hq, body: { first_name: 'Dodoma', last_name: 'Member', phone: '+255750000002', branch_id: dodoma.id } });

    registrar = await createStaff(server, hq, { name: 'UI Registrar', email: 'ui.registrar@mbeya.test', role: 'registrar', branch_id: mbeya.id });
    viewer = await createStaff(server, hq, { name: 'UI Viewer', email: 'ui.viewer@mbeya.test', role: 'viewer', branch_id: mbeya.id });

    browser = await chromium.launch(
      process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
  });

  after(async () => {
    if (browser) await browser.close();
    stopServer(server);
  });

  /** Sign in and hand back the page plus any JavaScript errors it raised. */
  async function signIn(email, password) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // Web fonts may be unreachable on a sandboxed or offline runner; that is not an app fault.
      if (/ERR_CERT_AUTHORITY_INVALID|ERR_NAME_NOT_RESOLVED|fonts\.(googleapis|gstatic)\.com/.test(m.text())) return;
      errors.push(`console: ${m.text()}`);
    });
    await page.goto(server.base, { waitUntil: 'domcontentloaded' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('.login-submit');
    await page.waitForSelector('#appView:not(.hidden)', { timeout: 15000 });
    await page.waitForTimeout(600);
    return { page, errors };
  }

  const show = async (page, view) => {
    await page.click(`.nav[data-view=${view}]`);
    await page.waitForTimeout(700);
  };

  it('gives an HQ admin the staff screen and creates an account through it', async () => {
    const { page, errors } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.ok(await page.isVisible('#navStaff'), 'staff nav should be available to HQ');
    assert.ok(await page.isVisible('#newMemberTop'));
    assert.match(await page.textContent('#orgEyebrow'), /HQ/);

    await show(page, 'staff');
    await page.click('#newStaffBtn');
    await page.waitForSelector('#staffDialog[open]');
    await page.fill('#staffForm input[name=name]', 'Created In Browser');
    await page.fill('#staffForm input[name=email]', newStaffEmail);
    await page.selectOption('#staffRole', 'registrar');
    assert.ok(await page.isVisible('#staffBranchField'), 'a branch role needs a branch picker');

    const mbeyaOption = await page.$eval('#staffBranch', (el) => [...el.options].find((o) => o.text.startsWith('MBY-01')).value);
    await page.selectOption('#staffBranch', mbeyaOption);
    await page.fill('#staffForm input[name=password]', STAFF_PASSWORD);
    await page.click('#staffForm button[type=submit]');
    await page.waitForTimeout(1200);

    assert.ok(!(await page.isVisible('#staffDialog')), `dialog stayed open: ${await page.textContent('#staffError')}`);
    assert.match(await page.textContent('#staffView'), new RegExp(newStaffEmail));

    // A national role is never tied to a branch, so the picker must disappear.
    await page.click('#newStaffBtn');
    await page.waitForSelector('#staffDialog[open]');
    await page.selectOption('#staffRole', 'hq_admin');
    assert.ok(!(await page.isVisible('#staffBranchField')), 'a national role must not offer a branch');

    assert.deepEqual(errors, []);
    await page.close();
  });

  it('confines a branch registrar to its own branch', async () => {
    const { page, errors } = await signIn('ui.registrar@mbeya.test', STAFF_PASSWORD);
    assert.ok(!(await page.isVisible('#navStaff')), 'a registrar must not see staff management');
    assert.match(await page.textContent('#orgEyebrow'), /MBEYA/);
    assert.match(await page.textContent('#userMini'), /Registrar/);

    await show(page, 'branches');
    const branches = await page.textContent('#branchesView');
    assert.ok(branches.includes('Mbeya'), 'own branch missing');
    assert.ok(!branches.includes('Dodoma East'), 'another branch leaked into the UI');
    assert.ok(!(await page.isVisible('#newBranchBtn')));

    await show(page, 'members');
    const members = await page.textContent('#membersView');
    assert.ok(members.includes('Mbeya Member'));
    assert.ok(!members.includes('Dodoma Member'), 'another branch\'s members leaked into the UI');
    assert.ok(await page.isVisible('#newMemberBtn'), 'a registrar should still be able to register');
    assert.match(members, /MBEYA REGISTRY/);

    await show(page, 'dashboard');
    assert.match(await page.textContent('#dashboardView'), /MBEYA COMMAND CENTER/);

    assert.deepEqual(errors, []);
    await page.close();
  });

  it('gives a viewer no way to write', async () => {
    const { page, errors } = await signIn('ui.viewer@mbeya.test', STAFF_PASSWORD);
    assert.ok(!(await page.isVisible('#navStaff')));
    assert.ok(!(await page.isVisible('#newMemberTop')), 'a viewer must not be offered registration');
    await show(page, 'members');
    assert.ok(!(await page.isVisible('#newMemberBtn')));
    await show(page, 'branches');
    assert.ok(!(await page.isVisible('#newBranchBtn')));
    assert.deepEqual(errors, []);
    await page.close();
  });
});
