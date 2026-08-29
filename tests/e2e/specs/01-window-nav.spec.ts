/**
 * Feature sweep 1/5 — window chrome, mode navigation, layout resizers.
 * Human-like: real clicks with small delays, double-click on titlebar.
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

const MODE_TABS = [
  ['Agent', 'mode.agent'],
  ['Code', 'mode.code'],
  ['Terminal', 'mode.terminal'],
  ['Git', 'mode.git'],
  ['Browser', 'mode.browser'],
] as const

test('window controls exist and maximize toggles state', async () => {
  await resetStorage(page)
  await seedProject(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('toolbar', { name: 'Window title bar' })).toBeVisible()
  const close = page.getByRole('button', { name: 'Close', exact: true })
  const minimize = page.getByRole('button', { name: 'Minimize', exact: true })
  const maximize = page.getByRole('button', { name: 'Maximize', exact: true })
  await expect(close).toBeVisible()
  await expect(minimize).toBeVisible()
  await expect(maximize).toBeVisible()

  // Maximize → window becomes maximized (main process reports isMaximized).
  const beforeMax = await app.evaluate(({ BrowserWindow }: any) =>
    BrowserWindow.getAllWindows()[0]?.isMaximized(),
  )
  await maximize.click()
  await humanDelay(300)
  const afterMax = await app.evaluate(({ BrowserWindow }: any) =>
    BrowserWindow.getAllWindows()[0]?.isMaximized(),
  )
  expect(afterMax).toBe(!beforeMax)
  // Restore.
  await maximize.click()
  await humanDelay(300)
  const restored = await app.evaluate(({ BrowserWindow }: any) =>
    BrowserWindow.getAllWindows()[0]?.isMaximized(),
  )
  expect(restored).toBe(beforeMax)
})

test('double-click titlebar toggles maximize too', async () => {
  const titlebar = page.getByRole('toolbar', { name: 'Window title bar' })
  await titlebar.dblclick()
  await humanDelay(300)
  const maxed = await app.evaluate(({ BrowserWindow }: any) =>
    BrowserWindow.getAllWindows()[0]?.isMaximized(),
  )
  await titlebar.dblclick()
  await humanDelay(300)
  const unmaxed = await app.evaluate(({ BrowserWindow }): any =>
    BrowserWindow.getAllWindows()[0]?.isMaximized(),
  )
  expect(unmaxed).toBe(!maxed)
})

for (const [label] of MODE_TABS) {
  test(`nav tab "${label}" switches stage`, async () => {
    const tab = page.getByRole('tab', { name: new RegExp(label, 'i') })
    await tab.click()
    await humanDelay()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    // The corresponding stage must be the visible one; others hidden.
    const stages = ['agent', 'code', 'terminal', 'git', 'browser'] as const
    for (const s of stages) {
      const el = page.locator(`main > div > div`).nth(stages.indexOf(s))
      if (s === label.toLowerCase()) {
        await expect(el).not.toHaveClass(/hidden/)
      } else {
        await expect(el).toHaveClass(/hidden/)
      }
    }
  })
}

test('keyboard shortcuts Mod+1..Mod+5 switch modes', async () => {
  const shortcuts = ['1', '2', '3', '4', '5']
  const labels = ['Agent', 'Code', 'Terminal', 'Git', 'Browser']
  for (let i = 0; i < shortcuts.length; i++) {
    await page.keyboard.press(`Control+${shortcuts[i]}`)
    await humanDelay()
    const tab = page.getByRole('tab', { name: new RegExp(labels[i], 'i') })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }
})

test('sidebar resizer changes grid column width within bounds', async () => {
  await page.getByRole('tab', { name: /Agent/i }).click()
  const separator = page.getByRole('separator', { name: 'Resize sidebar' })
  await expect(separator).toBeAttached()
  const box = await page.locator('.grid.min-h-0.flex-1').first().boundingBox()
  const startX = box!.x + 240
  await page.mouse.move(startX, box!.y + 200)
  await page.mouse.down()
  await page.mouse.move(startX - 60, box!.y + 200, { steps: 8 }) // drag left
  await page.mouse.up()
  await humanDelay(200)
  const style = await page.locator('.grid.min-h-0.flex-1').first().getAttribute('style')
  expect(style).toMatch(/grid-template-columns:\s*(\d+)px/)
  const width = Number(style!.match(/grid-template-columns:\s*(\d+)px/)![1])
  expect(width).toBeGreaterThanOrEqual(200)
  expect(width).toBeLessThanOrEqual(400)
})

test('inspector resizer stays within bounds', async () => {
  const separator = page.getByRole('separator', { name: 'Resize inspector' })
  await expect(separator).toBeAttached()
  const grid = page.locator('.grid.min-h-0.flex-1').first()
  const box = await grid.boundingBox()
  // Inspector handle sits at right edge minus inspector width (~280 default).
  const style0 = await grid.getAttribute('style')
  const cols = style0!.match(/grid-template-columns:[^;]+/)![0]
  const widths = [...cols.matchAll(/(\d+)px/g)].map((m) => Number(m[1]))
  const inspectorW = widths[widths.length - 1]
  const x = box!.x + box!.width - inspectorW
  await page.mouse.move(x, box!.y + 200)
  await page.mouse.down()
  await page.mouse.move(x - 40, box!.y + 200, { steps: 8 })
  await page.mouse.up()
  await humanDelay(200)
  const style = await grid.getAttribute('style')
  const colsAfter = style!.match(/grid-template-columns:[^;]+/)![0]
  const widthsAfter = [...colsAfter.matchAll(/(\d+)px/g)].map((m) => Number(m[1]))
  const w = widthsAfter[widthsAfter.length - 1]
  expect(w).toBeGreaterThanOrEqual(260)
  expect(w).toBeLessThanOrEqual(420)
})
