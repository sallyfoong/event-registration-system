// Take screenshots of the running public + admin pages (desktop + one mobile view).
//
// Prerequisites (run once, outside the project's dependencies):
//   npm i playwright && npx playwright install chromium
//   # then run with NODE_PATH pointing at that install
//
// Requires the stack to be running: API on 8000, web on 8001,
// opened via http://localhost:8001 (the backend CORS allowlist only
// knows localhost, 127.0.0.1 gets blocked and every list renders empty).
//
// Note: this deliberately does NOT drive the system-installed Chrome.
// Launching a second instance of an already-running browser causes
// profile lock contention, which is exactly the kind of side effect
// a screenshot script has no business creating.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const outDir = path.join(__dirname);

  // Public page. Select an event first so the details section is visible.
  await page.goto('http://localhost:8001/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.locator('#event-select').click();
  await page.locator('[role="option"]').first().click();
  await page.waitForSelector('text=Event Details', { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, '01-public-page.png'), fullPage: true });
  console.log('Captured public page');

  // Fill in email and submit -> thank-you screen
  await page.fill('input[type="email"]', 'screenshot@test.com');
  await page.click('button:has-text("Register")');
  await page.waitForSelector('text=Thank You!', { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, '02-public-thankyou.png'), fullPage: true });
  console.log('Captured thank-you page');

  // Admin page
  await page.goto('http://localhost:8001/admin', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('h1:has-text("Events")', { timeout: 10000 });
  await page.waitForSelector('tbody tr td', { timeout: 10000 });
  await page.waitForTimeout(500); // let the row data replace any skeleton
  await page.screenshot({ path: path.join(outDir, '03-admin-list.png'), fullPage: true });
  console.log('Captured admin list page');

  // Create event form
  await page.goto('http://localhost:8001/admin/events/new', {
    waitUntil: 'networkidle',
    timeout: 15000,
  });
  await page.waitForSelector('h1:has-text("Add New Event")', { timeout: 10000 });
  await page.waitForTimeout(500); // let the handler select load
  await page.screenshot({ path: path.join(outDir, '04-admin-create.png'), fullPage: true });
  console.log('Captured create event page');

  // Trend page. "View Trend" renders as a styled <Link>, so match the href.
  await page.goto('http://localhost:8001/admin', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('a[href*="/trend"]', { timeout: 10000 });
  await page.click('a[href*="/trend"]');
  await page.waitForSelector('h1:has-text("Registration Trend")', { timeout: 10000 });
  await page.waitForSelector('tbody tr td', { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, '05-admin-trend.png'), fullPage: true });
  console.log('Captured trend page');

  // Mobile view of the admin list at iPhone-ish width — shows the
  // toolbar stacking and the horizontally scrollable table.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto('http://localhost:8001/admin', { waitUntil: 'networkidle', timeout: 15000 });
  await mobile.waitForSelector('tbody tr td', { timeout: 10000 });
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: path.join(outDir, '06-mobile-admin.png'), fullPage: false });
  console.log('Captured mobile admin page');

  await browser.close();
  console.log('Done');
})().catch((err) => {
  console.error('Screenshot error:', err);
  process.exit(1);
});
