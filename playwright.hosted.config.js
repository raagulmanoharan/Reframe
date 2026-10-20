import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests-hosted',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'VITE_AI_MODE=chatgpt npm run dev -- --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
  },
});
