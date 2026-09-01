import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts', timeout: 60_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3107', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: { executablePath: process.env.LITERA_WEBKIT_EXECUTABLE }, hasTouch: true, viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: 'npx tsx tests/e2e/server.ts', url: 'http://127.0.0.1:3107/health', reuseExistingServer: false },
})
