// Boots the API for the E2E suite against a throwaway SQLite file.
//
// Why SQLite and not the compose stack: the suite has to be runnable on a
// laptop and in CI without Docker. SQLite is already a dev dependency (the
// unit tests use it) and the app treats the dialect as a config detail, so the
// HTTP surface under test is identical. What this suite checks is the browser
// flow - it is not trying to catch MySQL-specific behaviour, which is what
// registrationUniqueConflict.test.ts exists for.
//
// The database file is deleted first, so every run starts from the same seed
// instead of inheriting last run's registrations and failing on "duplicate
// email" in a test that never registered anything.
//
// OneMap gets a stub server on a random local port. Creating an event
// requires an address OneMap returned, so without a stand-in the seed and the
// "duplicate name" test could not run at all - and the suite must not depend
// on a real token, a real account, or the public internet.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../server');
const dataDir = path.join(serverDir, 'data');
const storage = path.join(dataDir, 'e2e.sqlite');

if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  rmSync(`${storage}${suffix}`, { force: true });
}

// Answers any postal code with an address, which is all the flow needs: the
// suite is asserting that the form accepts a validated address, not that
// OneMap knows Singapore. Port 0 lets the OS pick a free one, so two runs
// side by side cannot collide.
const oneMapStub = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/common/elastic/search') {
    response.writeHead(404).end();
    return;
  }
  const postalCode = url.searchParams.get('searchVal') ?? '';
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      found: 1,
      results: [{ ADDRESS: `E2E STUB ADDRESS SINGAPORE ${postalCode}`, POSTAL: postalCode }],
    }),
  );
});

await new Promise((resolve) => oneMapStub.listen(0, '127.0.0.1', resolve));
const stubPort = oneMapStub.address().port;

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DB_DIALECT: 'sqlite',
  DB_STORAGE: storage,
  PORT: '8000',
  // the suite asserts on cache behaviour in one place, and a 0ms TTL would
  // make that assertion meaningless
  CACHE_TTL_MS: '10000',
  // the stub stands in for OneMap, so no account is needed and no request
  // leaves the machine
  ONEMAP_TOKEN: 'e2e.stub.token',
  ONEMAP_EMAIL: '',
  ONEMAP_PASSWORD: '',
  ONEMAP_BASE_URL: `http://127.0.0.1:${stubPort}`,
  // the suite is same-origin (vite preview forwards /api), so this is only
  // insurance for anyone pointing a browser straight at 8000 while debugging
  CORS_ORIGIN: 'http://127.0.0.1:8001,http://localhost:8001',
  LOG_LEVEL: 'info',
};

// Run the TypeScript entry points through `node --import tsx` rather than
// `npx tsx`. Two reasons: npx goes through a shell, which on Windows produces
// a process tree that Playwright's teardown can only partially kill (leaving
// port 8000 occupied for the next run), and the deprecation warning about
// unescaped shell arguments is avoidable noise. This spawns exactly one
// process that can be signalled directly.
const node = process.execPath;

// async spawn rather than spawnSync: the stub server lives in this process,
// and a blocking spawn would freeze the event loop it needs in order to
// answer the seed's lookups.
const seedExitCode = await new Promise((resolve) => {
  const child = spawn(node, ['--import', 'tsx', 'src/seed.ts', '--demo'], {
    cwd: serverDir,
    env,
    stdio: 'inherit',
  });
  child.on('exit', (code) => resolve(code ?? 1));
});
if (seedExitCode !== 0) process.exit(seedExitCode);

const api = spawn(node, ['--import', 'tsx', 'src/index.ts'], {
  cwd: serverDir,
  env,
  stdio: 'inherit',
});

// forward the signals Playwright sends when it tears the suite down, so the
// port is free for the next run
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    api.kill(signal);
    oneMapStub.close();
    process.exit(0);
  });
}
api.on('exit', (code) => {
  oneMapStub.close();
  process.exit(code ?? 0);
});
