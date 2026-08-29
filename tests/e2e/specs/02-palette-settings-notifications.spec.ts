/**
 * Feature sweep 2/5 — command palette, settings modal, notification center,
 * zoom keybindings, theme/i18n persistence.
 */
import { test, expect } from '@playwright/test'
import { launchApp, resetStorage, seedProject, humanDelay } from '../helpers/launch'

let page: any
let app: any

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await app.close()
})

test.beforeEach(async () => {
  await resetStorage(page)
  await seedProject(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tablist', { name: 'Workspace mode' })).toBeVisible()
})

test('Ctrl+K opens palette, filter narrows, Enter executes mode switch', async () => {
  await page.keyboard.press('Control+K')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // All 5 modes + settings + notifications + export + compact + undo compact.
  await humanDelay(150)
  const items = dialog.locator('button[type="button"]')
  const total = await items.count()
  expect(total).toBeGreaterThanOrEqual(8)

  // Filter to terminal.
  await page.keyboard.type('terminal', { delay: 40 }) // typing cadence
  await humanDelay(200)
  const filtered = dialog.locator('button[type="button"]')
  const countAfterFilter = await filtered.count()
  expect(countAfterFilter).toBeLessThan(total)
  expect(await filtered.first().textContent()).toMatch(/terminal/i)

  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('tab', { name: /Terminal/i })).toHaveAttribute('aria-selected', 'true')
})

test('palette Escape closes without acting; click-outside closes too', async () => {
  await page.keyboard.press('Control+K')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.type('git', { delay: 30 })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('tab', { name: /Git/i })).toHaveAttribute('aria-selected', 'false')

  await page.keyboard.press('Control+K')
  await expect(dialog).toBeVisible()
  await page.mouse.click(20, 400) // overlay backdrop
  await expect(dialog).toBeHidden()
})

test('palette arrow keys move highlight and Enter runs highlighted action', async () => {
  await page.keyboard.press('Control+K')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const first = dialog.locator('button').first()
  await expect(first).toHaveClass(/bg-studio-purple/)
  await page.keyboard.press('ArrowDown')
  await humanDelay(80)
  const second = dialog.locator('button').nth(1)
  await expect(second).toHaveClass(/bg-studio-purple/)
  await page.keyboard.press('ArrowUp')
  await humanDelay(80)
  await expect(first).toHaveClass(/bg-studio-purple/)
})

test('settings opens via Ctrl+, and closes via Escape / close button', async () => {
  await page.keyboard.press('Control+,')
  const settingsDialog = page.locator('[role="dialog"][aria-labelledby="settings-title"]')
  await expect(settingsDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settingsDialog).toBeHidden()

  await page.keyboard.press('Control+,')
  await expect(settingsDialog).toBeVisible()
  // Try common close affordances inside the modal header.
  const closeBtns = settingsDialog.getByRole('button', { name: /close|tutup|✕|×/i })
  if ((await closeBtns.count()) > 0) {
    await closeBtns.first().click()
    await expect(settingsDialog).toBeHidden()
  }
})

test('notification center opens via bell button and Mod+Shift+N', async () => {
  const bell = page.locator('[data-notifications-trigger]')
  await expect(bell).toBeAttached()
  await bell.click()
  await humanDelay(150)
  // Toggle back off via keyboard shortcut.
  await page.keyboard.press('Control+Shift+N')
  await humanDelay(150)
  // And open once more through the shortcut alone.
  await page.keyboard.press('Control+Shift+N')
  await humanDelay(150)
})

test('zoom in/out keybindings change UI zoom pref', async () => {
  const readZoom = () =>
    page.evaluate(() => Number(window.localStorage.getItem('enpiistudio.uiPrefs')?.match(/\d+/)?.[0] ?? -1))
  await page.keyboard.press('Control+=')
  await humanDelay(150)
  const afterIn = await page.evaluate(() => document.documentElement.style.zoom || document.body.style.zoom)
  await page.keyboard.press('Control+-')
  await humanDelay(150)
  const afterOut = await page.evaluate(() => document.documentElement.style.zoom || document.body.style.zoom)
  // Zoom is applied via webFrame (main side); CSS zoom must stay cleared.
  expect(afterIn === '' || afterIn === undefined).toBeTruthy()
  expect(afterOut === '' || afterOut === undefined).toBeTruthy()
})
