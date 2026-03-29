'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
  ],
  // Exclude the legacy Node test-runner tests in tests/ root
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/auth\\.test\\.js',
    '<rootDir>/tests/questions\\.test\\.js',
    '<rootDir>/tests/discussions\\.test\\.js',
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/db/migrate.js',
    '!src/cron/**',
    '!src/scripts/**',
  ],
  coverageDirectory: 'coverage',
  // Increase timeout for integration tests
  testTimeout: 10000,
  // Map missing/problematic third-party modules to lightweight mocks
  moduleNameMapper: {
    '^passport$': '<rootDir>/tests/__mocks__/passport.js',
    '^passport-google-oauth20$': '<rootDir>/tests/__mocks__/passport-google-oauth20.js',
    '^nodemailer$': '<rootDir>/tests/__mocks__/nodemailer.js',
    '^speakeasy$': '<rootDir>/tests/__mocks__/speakeasy.js',
    '^qrcode$': '<rootDir>/tests/__mocks__/qrcode.js',
    '^csv-stringify/sync$': '<rootDir>/tests/__mocks__/csv-stringify-sync.js',
  },
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
};
