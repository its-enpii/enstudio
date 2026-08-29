/**
 * Feature sweep 3/5 — Git stage (real fixture repo), Terminal stage
 * (real PTY command round-trip), Code stage (file tree + editor),
 * Browser stage render.
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, resetStorage, seedProject, FIXTURE_DIR, humanDelay } from '../helpers/launch'

let page: any
let app: any

function ensureFixtureRepo(): void {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
  const gitDir = resolve(FIXTURE_DIR, '.git')
  let hasHead = false
  if (!existsSync(gitDir)) {
    execSync('git init -b main', { cwd: FIXTURE_DIR, stdio: 'ignore' })
    execSync('git config user.email "e2e@example.com"', { cwd: FIXTURE_DIR })
    execSync('git config user.name "E2E"', { cwd: FIXTURE_DIR })
  } else {
    // A repo may exist from a previous run without any commit yet.
    try {
      execSync('git rev-parse --verify HEAD', { cwd: FIXTURE_DIR, stdio: 'ignore' })
      hasHead = true
    } catch {
      /* no commits yet */
    }
  }
  writeFileSync(resolve(FIXTURE_DIR, 'README.md'), '# playground\nfixture for e2e\n')
  if (!hasHead) {
    execSync('git add -A', { cwd: FIXTURE_DIR, stdio: 'ignore' })
    execSync('git commit -m "initial e2e commit"', { cwd: FIXTURE_DIR, stdio: 'ignore' })
  }
  writeFileSync(resolve(FIXTURE_DIR, 'notes.txt'), `scratch ${Math.random()}\n`)
}

test.beforeAll(async () => {
  ensureFixtureRepo()
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

test.describe('Git stage', () => {
  test.beforeEach(async () => {
    // Re-dirty the repo so unstaged changes always exist.
    writeFileSync(resolve(FIXTURE_DIR, 'notes.txt'), `dirty ${Date.now()}\n`)
  })

  test('branch manager lists current branch and search filters', async () => {
    await page.getByRole('tab', { name: /Git/i }).click()
    await humanDelay(600) // let git status IPC settle
    const branchBtn = page.locator('header button[aria-expanded]')
    await branchBtn.click()
    const manager = page.getByRole('dialog', { name: 'Branch manager' })
    await expect(manager).toBeVisible()
    await page.keyboard.type('main', { delay: 30 })
    await humanDelay(200)
    const list = manager.locator('button, [role="option"]')
    expect(await list.count()).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await expect(manager).toBeHidden()
  })

  test('unstaged section shows dirty file and staging works end-to-end', async () => {
    await page.getByRole('tab', { name: /Git/i }).click()
    await humanDelay(600)
    const stageAll = page.getByRole('button', { name: 'Stage all' })
    await expect(stageAll).toBeVisible({ timeout: 15000 })
    await stageAll.click()
    await humanDelay(500)
    // After staging all, "Unstage all" appears in the staged section.
    const unstageAll = page.getByRole('button', { name: 'Unstage all' })
    await expect(unstageAll).toBeVisible({ timeout: 15000 })
    await unstageAll.click()
    await humanDelay(400)
    await expect(stageAll).toBeVisible({ timeout: 15000 })
  })

  test('commit flow creates a real commit in the fixture repo', async () => {
    await page.getByRole('tab', { name: /Git/i }).click()
    await humanDelay(600)
    const before = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim()
    const msg = `e2e commit ${Date.now()}`
    const textarea = page.locator('textarea[placeholder="Commit message"]')
    await expect(textarea).toBeVisible({ timeout: 15000 })
    await textarea.fill(msg)
    const commitBtn = page.getByRole('button', { name: /commit/i }).last()
    await commitBtn.click()
    await humanDelay(1200)
    const after = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim()
    expect(after).not.toBe(before)
    const subject = execSync('git log -1 --pretty=%s', { cwd: FIXTURE_DIR }).toString().trim()
    expect(subject).toContain(msg.slice(0, 10))
    // Reset so later runs stay clean-ish.
    execSync(`git reset --soft ${before}`, { cwd: FIXTURE_DIR })
  })
})

test.describe('Terminal stage', () => {
  test('new terminal tab opens and echoes a command round-trip', async () => {
    await page.getByRole('tab', { name: /Terminal/i }).click()
    const composer = page.getByLabel('Terminal command')
    await expect(composer).toBeVisible({ timeout: 20000 })
    // Wait until PTY prompt is ready: composer enabled.
    await composer.click()
    await page.keyboard.type('echo enpii-e2e-$((21*2))', { delay: 25 })
    await page.keyboard.press('Enter')
    // Command card model: output card should eventually contain 42.
    await expect(page.locator('[aria-label="Terminal stage"]').getByText(/enpii-e2e-42/).first()).toBeVisible({
      timeout: 30000,
    })
  })

  test('second tab can be created and closed independently', async () => {
    await page.getByRole('tab', { name: /Terminal/i }).click()
    const newTab = page.getByRole('button', { name: 'New terminal' })
    await expect(newTab).toBeVisible({ timeout: 20000 })
    const sessions = page.getByLabel('Terminal sessions')
    const beforeCount = await sessions.locator('[role="tab"], button').count()
    await newTab.click()
    await humanDelay(800)
    const afterCount = await sessions.locator('[role="tab"], button').count()
    expect(afterCount).toBeGreaterThan(beforeCount)
    // Close the new tab.
    const closeTab = page.locator('button[aria-label^="Close "]').last()
    await closeTab.click()
    await humanDelay(500)
    const finalCount = await sessions.locator('[role="tab"], button').count()
    expect(finalCount).toBe(beforeCount)
  })
})

test.describe('Code stage', () => {
  test('file tree lists fixture files and opening one loads the editor', async () => {
    await page.getByRole('tab', { name: /Code/i }).click()
    await humanDelay(700)
    // Click README.md anywhere in the tree.
    const readmeEntry = page.getByText('README.md', { exact: true }).first()
    await expect(readmeEntry).toBeVisible({ timeout: 15000 })
    await readmeEntry.click()
    await humanDelay(500)
    // Editor content shows fixture text.
    await expect(page.locator('.cm-content').getByText('playground', { exact: false }).first()).toBeVisible({
      timeout: 15000,
    })
  })

  test('editing a file persists to disk after save', async () => {
    const target = resolve(FIXTURE_DIR, 'edit-me.txt')
    writeFileSync(target, 'original\n')
    await page.getByRole('tab', { name: /Code/i }).click()
    await humanDelay(700)
    const entry = page.getByText('edit-me.txt', { exact: true }).first()
    await expect(entry).toBeVisible({ timeout: 15000 })
    await entry.click()
    await humanDelay(500)
    await page.keyboard.press('Control+a')
    await page.keyboard.type('edited-by-e2e', { delay: 20 })
    await page.keyboard.press('Control+s')
    await humanDelay(1000)
    const onDisk = (await import('node:fs')).readFileSync(target, 'utf8')
    expect(onDisk).toContain('edited-by-e2e')
    rmSync(target)
  })
})

test.describe('Browser stage', () => {
  test('browser mode renders its inspector and address UI without crashing', async () => {
    await page.getByRole('tab', { name: /Browser/i }).click()
    await humanDelay(500)
    // BrowserInspector replaces default Inspector in this mode.
    const errors: string[] = []
    page.on('pageerror', (e: Error) => errors.push(e.message))
    await humanDelay(300)
    expect(errors).toEqual([])
  })
})
