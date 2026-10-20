import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// A local run must never be routed through an HTTP proxy. On a machine with
// HTTP_PROXY set (corporate networks, a debugging proxy, a VPN client), the
// readiness probe for 127.0.0.1:8001 gets sent to the proxy instead of the
// server that is already listening - the suite then sits there waiting for a
// stack that came up seconds ago. Loopback is never proxied; say so explicitly.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost', '::1']
  .filter(Boolean)
  .join(',');
process.env.no_proxy = process.env.NO_PROXY;

// Playwright loads this file through a CommonJS transpile, so __dirname is the
// reliable anchor here - import.meta.url is a syntax error in that context.
const root = path.resolve(__dirname, '..');

// The suite drives the real browser against the real bundle, talking to a real
// API over HTTP. Only the database is substituted (SQLite instead of MySQL),
// because that is the one piece the app is designed to swap.
//
// Serial, single worker: the tests share one database and one of them asserts
// that a registration count went up. Running them in parallel would make that
// assertion depend on timing instead of on the code.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:8001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Chromium picks up the machine's proxy settings, and on a machine
      // behind one that turns "http://127.0.0.1:8001/api/..." into a request
      // that leaves the box and never comes back. Every URL in this suite is
      // local, so the browser has no business proxying anything.
      args: ['--no-proxy-server'],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // seeds a fresh SQLite file, then starts the API on 8000
      command: 'node serve-api.mjs',
      cwd: root + '/e2e',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // builds the production bundle and serves it through `vite preview`,
      // which forwards /api to 8000 - the same single-origin shape nginx
      // provides in production.
      //
      // No VITE_API_BASE_URL is passed: the client defaults to a relative
      // /api, so the bundle is already same-origin. Passing the flag here
      // would only add a way to get it wrong.
      command: 'npm --prefix client run build && npm --prefix client run preview',
      cwd: root,
      url: 'http://127.0.0.1:8001',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
