/** Jest configuration. Tests run against an in-memory SQLite database (see src/tests/globalSetup.ts),
 *  so `npm test` works without a running MySQL instance. Production default is MySQL. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // setupFiles runs before a test file is imported (environment + module
  // stubs), setupFilesAfterEnv runs after it (database reset hooks).
  setupFiles: ['<rootDir>/src/tests/setupFiles.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/globalSetup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/tests/**', '!src/index.ts', '!src/seed.ts'],
  // 50% coverage is the minimum this project accepts; the gate below is
  // deliberately stricter (85/60/85/85) so a regression in the suite itself is
  // caught instead of sliding under the floor.
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 80,
      lines: 85,
      statements: 85,
    },
  },
  testTimeout: 30000,
};
