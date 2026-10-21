import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests-openrouter', outputDir: './test-results-openrouter',
  use: { baseURL: 'http://127.0.0.1:5175', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'VITE_AI_MODE=openrouter npm run dev -- --port 5175 --strictPort', url: 'http://127.0.0.1:5175' },
});
