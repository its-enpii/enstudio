/**
 * Shared Electron launcher for the E2E suite.
 *
 * Mirrors apps/desktop/scripts/dev-electron.mjs: spawn the real electron.exe
 * against dist-electron/main.cjs with VITE_DEV_SERVER_URL pointing at the
 * vite dev server (started by playwright.config.ts webServer).
 */
import { _electron, type Page, type ElectronApplication } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..', '..', '..')
const desktop = resolve(root, 'apps', 'desktop')

export const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'playground')

function findElectronBin(): string {
  const candidates = [
    resolve(desktop, 'node_modules', 'electron', 'dist', 'electron.exe'),
    resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error(`electron binary not found in:\n${candidates.join('\n')}`)
  return found
}

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const entry = resolve(desktop, 'dist-electron', 'main.cjs')
  if (!existsSync(entry)) {
    throw new Error('dist-electron/main.cjs missing — run `pnpm predev -w @enstudio/desktop` first')
  }
  const app = await _electron.launch({
    executablePath: findElectronBin(),
    args: [entry],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173',
      // Keep auto-update / single-instance side effects out of the test runs.
      ENPIISTUDIO_E2E: '1',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/**
 * Run an evaluate against a stable execution context. The renderer can
 * navigate (vite boot, dev reloads) between waitForLoadState resolving and
 * our evaluate landing; retry through those transient destructions.
 */
async function stableEvaluate<T, A>(page: Page, fn: (arg: A) => T, arg?: A, attempts = 6): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await page.evaluate(fn as any, arg as any)
      return
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!/execution context was destroyed|navigation/i.test(msg)) throw err
      await new Promise((r) => setTimeout(r, 250))
      await page.waitForLoadState('domcontentloaded').catch(() => {})
    }
  }
  throw lastError
}

/** Deterministic seed: clean projects + default keybindings before the UI boots. */
export async function resetStorage(page: Page): Promise<void> {
  await stableEvaluate(page, () => {
    for (const key of [
      'enpiistudio.projects',
      'enpiistudio.projectGroups',
      'enpiistudio.keybindings',
      'enpiistudio.uiPrefs',
    ]) {
      window.localStorage.removeItem(key)
    }
  })
}

/** Seed one project pointing at the fixture folder so stages have content. */
export async function seedProject(page: Page, dir = FIXTURE_DIR): Promise<void> {
  await stableEvaluate(
    page,
    (path: string) => {
      const id = btoa(path).replace(/=+$/, '')
      window.localStorage.setItem(
        'enpiistudio.projects',
        JSON.stringify([{ id, name: path.split(/[\\/]/).pop(), path, order: 0, groupId: null }]),
      )
    },
    dir,
  )
}

export async function reloadApp(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
}

/** Human-like pause between actions. */
export function humanDelay(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
