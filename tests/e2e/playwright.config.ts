import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..', '..')
const desktop = resolve(root, 'apps', 'desktop')

export default defineConfig({
  testDir: __dirname + '/specs',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: resolve(__dirname, 'results', 'report.json') }]],
  outputDir: resolve(__dirname, 'results', 'artifacts'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --strictPort',
    cwd: desktop,
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
