/**
 * Feature sweep 4/5 — randomized "human-like" interaction fuzzing.
 * A seeded PRNG picks a random legal user action each step (mode switches,
 * palette open/type/escape, sidebar filter typing, resizer drags, tab
 * shortcuts). Invariant: the app must never crash or show a page error,
 * and the tablist must stay interactive.
 */
import { test, expect } from '@playwright/test'
import { launchApp, resetStorage, seedProject, humanDelay } from '../helpers/launch'

let page: any
let app: any

// Deterministic seed so failures are reproducible; vary via env for runs.
const SEED = Number(process.env.FUZZ_SEED ?? 20260824)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ACTIONS = [
  'switch_mode',
  'open_palette_type_escape',
  'palette_enter_first',
  'type_sidebar_filter',
  'clear_filter',
  'drag_resizer',
  'mode_shortcut',
  'click_bell',
  'open_settings_close',
] as const

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await app.close()
})

test('randomized interaction marathon keeps app healthy', async ({ }, testInfo) => {
  test.setTimeout(300_000)
  await resetStorage(page)
  await seedProject(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tablist')).toBeVisible()

  const errors: string[] = []
  const onError = (e: Error) => errors.push(`pageerror: ${e.message}`)
  const onConsole = (m: any) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)

  const rand = mulberry32(SEED)
  const modes = ['Agent', 'Code', 'Terminal', 'Git', 'Browser']
  const steps = Number(process.env.FUZZ_STEPS ?? 60)
  const taken: string[] = []

  for (let i = 0; i < steps; i++) {
    const roll = rand()
    const action = ACTIONS[Math.floor(roll * ACTIONS.length)]
    taken.push(`${i}:${action}`)
    try {
      switch (action) {
        case 'switch_mode': {
          const m = modes[Math.floor(rand() * modes.length)]
          await page.getByRole('tab', { name: new RegExp(m, 'i') }).click()
          break
        }
        case 'open_palette_type_escape': {
          await page.keyboard.press('Control+K')
          await humanDelay(80 + rand() * 150)
          if (await page.getByRole('dialog').isVisible().catch(() => false)) {
            await page.keyboard.type('abc'.charAt(Math.floor(rand() * 3)), { delay: 30 })
            await page.keyboard.press('Escape')
          }
          break
        }
        case 'palette_enter_first': {
          await page.keyboard.press('Control+K')
          await humanDelay(100)
          if (await page.getByRole('dialog').isVisible().catch(() => false)) {
            await page.keyboard.press('Enter') // executes first filtered action — always legal
          }
          break
        }
        case 'type_sidebar_filter': {
          // Sidebar filter input if present in DOM.
          const filterBox = page.locator('aside input[type="text"], aside input:not([type])').first()
          if ((await filterBox.count()) > 0 && (await filterBox.isVisible().catch(() => false))) {
            await filterBox.click()
            await page.keyboard.type('play', { delay: 20 })
          }
          break
        }
        case 'clear_filter': {
          const filterBox = page.locator('aside input').first()
          if ((await filterBox.count()) > 0) await filterBox.fill('')
          break
        }
        case 'drag_resizer': {
          const sep = page
            .getByRole('separator', { name: rand() < 0.5 ? 'Resize sidebar' : 'Resize inspector' })
          if ((await sep.count()) > 0) {
            const box = await sep.boundingBox()
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + 150)
              await page.mouse.down()
              await page.mouse.move(box.x + box.width / 2 + (rand() < 0.5 ? -50 : 50), box.y + 140, { steps: 6 })
              await page.mouse.up()
            }
          }
          break
        }
        case 'mode_shortcut': {
          const n = 1 + Math.floor(rand() * 5)
          await page.keyboard.press(`Control+${n}`)
          break
        }
        case 'click_bell': {
          const bell = page.locator('[data-notifications-trigger]')
          if (await bell.isVisible().catch(() => false)) await bell.click()
          break
        }
        case 'open_settings_close': {
          await page.keyboard.press('Control+,')
          await humanDelay(120)
          await page.keyboard.press('Escape')
          break
        }
      }
    } catch (err) {
      // Transient races are tolerated individually; record them but only fail
      // below if the app actually broke (pageerror/crash).
      errors.push(`action-fault ${action}: ${(err as Error).message.split('\n')[0]}`)
    }
    await humanDelay(60 + rand() * 120)
    // Health probe every 10 steps.
    if (i % 10 === 9) {
      await expect(page.getByRole('tablist', { name: 'Workspace mode' })).toBeVisible({ timeout: 10000 })
    }
  }

  page.off('pageerror', onError)
  page.off('console', onConsole)

  const fatal = errors.filter(
    (e) => e.startsWith('pageerror') || /crashed|destroyed|closed/i.test(e),
  )
  if (fatal.length > 0) {
    console.error(`[fuzz seed=${SEED}] steps:\n${taken.join('\n')}`)
  }
  expect(fatal, `app broke during fuzz (seed=${SEED})`).toEqual([])
})

test('second fuzz pass with different seed stays healthy', async () => {
  test.setTimeout(300_000)
  const secondSeed = SEED + 7777
  // Re-run a shorter marathon inline with a shifted PRNG stream.
  await resetStorage(page)
  await seedProject(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tablist')).toBeVisible()

  const errors: string[] = []
  page.on('pageerror', (e: Error) => errors.push(e.message))
  const rand = mulberry32(secondSeed)
  const modes = ['Agent', 'Code', 'Terminal', 'Git', 'Browser']
  for (let i = 0; i < 30; i++) {
    const pick = rand()
    if (pick < 0.5) {
      const m = modes[Math.floor(rand() * modes.length)]
      await page.getByRole('tab', { name: new RegExp(m, 'i') }).click()
    } else if (pick < 0.75) {
      await page.keyboard.press('Control+K')
      await humanDelay(100)
      if (await page.getByRole('dialog').isVisible().catch(() => false)) await page.keyboard.press('Escape')
    } else {
      await page.keyboard.press(`Control+,`)
      await humanDelay(80)
      await page.keyboard.press('Escape')
    }
    await humanDelay(50)
  }
  expect(errors, `pageerrors with seed=${secondSeed}`).toEqual([])
})
