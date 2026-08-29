# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-git-terminal-code-browser.spec.ts >> Git stage >> unstaged section shows dirty file and staging works end-to-end
- Location: tests\e2e\specs\03-git-terminal-code-browser.spec.ts:77:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Stage all' })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('button', { name: 'Stage all' })

```

```yaml
- toolbar "Window title bar":
  - group "Window controls":
    - button "Close"
    - button "Minimize"
    - button "Maximize"
  - banner:
    - tablist "Workspace mode":
      - tab "Agent"
      - tab "Code"
      - tab "Terminal"
      - tab "Git" [selected]
      - tab "Browser"
    - button "Notifications"
    - button "Settings"
- complementary:
  - heading "EnStudio" [level=1]
  - textbox "Search projects":
    - /placeholder: Search
  - button "Open folder"
  - navigation:
    - button "playground F:\\Workspace\\Enpii Studio\\projects\\enpiistudio\\tests\\e2e\\fixtures\\playground Project actions":
      - text: playground F:\Workspace\Enpii Studio\projects\enpiistudio\tests\e2e\fixtures\playground
      - button "Project actions"
- separator "Resize sidebar"
- main: Open a project Git mode needs a workspace.
- separator "Resize inspector"
- complementary:
  - text: Remote
  - button "Refresh"
  - text: Remote
  - strong: —
  - text: Branch
  - strong: —
  - text: Upstream
  - strong: none
  - text: Sync
  - strong: up to date
  - text: History 0 No commits yet.
```

# Test source

```ts
  1   | /**
  2   |  * Feature sweep 3/5 — Git stage (real fixture repo), Terminal stage
  3   |  * (real PTY command round-trip), Code stage (file tree + editor),
  4   |  * Browser stage render.
  5   |  */
  6   | import { test, expect } from '@playwright/test'
  7   | import { execSync } from 'node:child_process'
  8   | import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
  9   | import { resolve } from 'node:path'
  10  | import { launchApp, resetStorage, seedProject, FIXTURE_DIR, humanDelay } from '../helpers/launch'
  11  | 
  12  | let page: any
  13  | let app: any
  14  | 
  15  | function ensureFixtureRepo(): void {
  16  |   if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
  17  |   const gitDir = resolve(FIXTURE_DIR, '.git')
  18  |   let hasHead = false
  19  |   if (!existsSync(gitDir)) {
  20  |     execSync('git init -b main', { cwd: FIXTURE_DIR, stdio: 'ignore' })
  21  |     execSync('git config user.email "e2e@example.com"', { cwd: FIXTURE_DIR })
  22  |     execSync('git config user.name "E2E"', { cwd: FIXTURE_DIR })
  23  |   } else {
  24  |     // A repo may exist from a previous run without any commit yet.
  25  |     try {
  26  |       execSync('git rev-parse --verify HEAD', { cwd: FIXTURE_DIR, stdio: 'ignore' })
  27  |       hasHead = true
  28  |     } catch {
  29  |       /* no commits yet */
  30  |     }
  31  |   }
  32  |   writeFileSync(resolve(FIXTURE_DIR, 'README.md'), '# playground\nfixture for e2e\n')
  33  |   if (!hasHead) {
  34  |     execSync('git add -A', { cwd: FIXTURE_DIR, stdio: 'ignore' })
  35  |     execSync('git commit -m "initial e2e commit"', { cwd: FIXTURE_DIR, stdio: 'ignore' })
  36  |   }
  37  |   writeFileSync(resolve(FIXTURE_DIR, 'notes.txt'), `scratch ${Math.random()}\n`)
  38  | }
  39  | 
  40  | test.beforeAll(async () => {
  41  |   ensureFixtureRepo()
  42  |   ;({ app, page } = await launchApp())
  43  | })
  44  | 
  45  | test.afterAll(async () => {
  46  |   await app.close()
  47  | })
  48  | 
  49  | test.beforeEach(async () => {
  50  |   await resetStorage(page)
  51  |   await seedProject(page)
  52  |   await page.reload({ waitUntil: 'domcontentloaded' })
  53  |   await expect(page.getByRole('tablist', { name: 'Workspace mode' })).toBeVisible()
  54  | })
  55  | 
  56  | test.describe('Git stage', () => {
  57  |   test.beforeEach(async () => {
  58  |     // Re-dirty the repo so unstaged changes always exist.
  59  |     writeFileSync(resolve(FIXTURE_DIR, 'notes.txt'), `dirty ${Date.now()}\n`)
  60  |   })
  61  | 
  62  |   test('branch manager lists current branch and search filters', async () => {
  63  |     await page.getByRole('tab', { name: /Git/i }).click()
  64  |     await humanDelay(600) // let git status IPC settle
  65  |     const branchBtn = page.locator('header button[aria-expanded]')
  66  |     await branchBtn.click()
  67  |     const manager = page.getByRole('dialog', { name: 'Branch manager' })
  68  |     await expect(manager).toBeVisible()
  69  |     await page.keyboard.type('main', { delay: 30 })
  70  |     await humanDelay(200)
  71  |     const list = manager.locator('button, [role="option"]')
  72  |     expect(await list.count()).toBeGreaterThan(0)
  73  |     await page.keyboard.press('Escape')
  74  |     await expect(manager).toBeHidden()
  75  |   })
  76  | 
  77  |   test('unstaged section shows dirty file and staging works end-to-end', async () => {
  78  |     await page.getByRole('tab', { name: /Git/i }).click()
  79  |     await humanDelay(600)
  80  |     const stageAll = page.getByRole('button', { name: 'Stage all' })
> 81  |     await expect(stageAll).toBeVisible({ timeout: 15000 })
      |                            ^ Error: expect(locator).toBeVisible() failed
  82  |     await stageAll.click()
  83  |     await humanDelay(500)
  84  |     // After staging all, "Unstage all" appears in the staged section.
  85  |     const unstageAll = page.getByRole('button', { name: 'Unstage all' })
  86  |     await expect(unstageAll).toBeVisible({ timeout: 15000 })
  87  |     await unstageAll.click()
  88  |     await humanDelay(400)
  89  |     await expect(stageAll).toBeVisible({ timeout: 15000 })
  90  |   })
  91  | 
  92  |   test('commit flow creates a real commit in the fixture repo', async () => {
  93  |     await page.getByRole('tab', { name: /Git/i }).click()
  94  |     await humanDelay(600)
  95  |     const before = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim()
  96  |     const msg = `e2e commit ${Date.now()}`
  97  |     const textarea = page.locator('textarea[placeholder="Commit message"]')
  98  |     await expect(textarea).toBeVisible({ timeout: 15000 })
  99  |     await textarea.fill(msg)
  100 |     const commitBtn = page.getByRole('button', { name: /commit/i }).last()
  101 |     await commitBtn.click()
  102 |     await humanDelay(1200)
  103 |     const after = execSync('git rev-parse HEAD', { cwd: FIXTURE_DIR }).toString().trim()
  104 |     expect(after).not.toBe(before)
  105 |     const subject = execSync('git log -1 --pretty=%s', { cwd: FIXTURE_DIR }).toString().trim()
  106 |     expect(subject).toContain(msg.slice(0, 10))
  107 |     // Reset so later runs stay clean-ish.
  108 |     execSync(`git reset --soft ${before}`, { cwd: FIXTURE_DIR })
  109 |   })
  110 | })
  111 | 
  112 | test.describe('Terminal stage', () => {
  113 |   test('new terminal tab opens and echoes a command round-trip', async () => {
  114 |     await page.getByRole('tab', { name: /Terminal/i }).click()
  115 |     const composer = page.getByLabel('Terminal command')
  116 |     await expect(composer).toBeVisible({ timeout: 20000 })
  117 |     // Wait until PTY prompt is ready: composer enabled.
  118 |     await composer.click()
  119 |     await page.keyboard.type('echo enpii-e2e-$((21*2))', { delay: 25 })
  120 |     await page.keyboard.press('Enter')
  121 |     // Command card model: output card should eventually contain 42.
  122 |     await expect(page.locator('[aria-label="Terminal stage"]').getByText(/enpii-e2e-42/).first()).toBeVisible({
  123 |       timeout: 30000,
  124 |     })
  125 |   })
  126 | 
  127 |   test('second tab can be created and closed independently', async () => {
  128 |     await page.getByRole('tab', { name: /Terminal/i }).click()
  129 |     const newTab = page.getByRole('button', { name: 'New terminal' })
  130 |     await expect(newTab).toBeVisible({ timeout: 20000 })
  131 |     const sessions = page.getByLabel('Terminal sessions')
  132 |     const beforeCount = await sessions.locator('[role="tab"], button').count()
  133 |     await newTab.click()
  134 |     await humanDelay(800)
  135 |     const afterCount = await sessions.locator('[role="tab"], button').count()
  136 |     expect(afterCount).toBeGreaterThan(beforeCount)
  137 |     // Close the new tab.
  138 |     const closeTab = page.locator('button[aria-label^="Close "]').last()
  139 |     await closeTab.click()
  140 |     await humanDelay(500)
  141 |     const finalCount = await sessions.locator('[role="tab"], button').count()
  142 |     expect(finalCount).toBe(beforeCount)
  143 |   })
  144 | })
  145 | 
  146 | test.describe('Code stage', () => {
  147 |   test('file tree lists fixture files and opening one loads the editor', async () => {
  148 |     await page.getByRole('tab', { name: /Code/i }).click()
  149 |     await humanDelay(700)
  150 |     // Click README.md anywhere in the tree.
  151 |     const readmeEntry = page.getByText('README.md', { exact: true }).first()
  152 |     await expect(readmeEntry).toBeVisible({ timeout: 15000 })
  153 |     await readmeEntry.click()
  154 |     await humanDelay(500)
  155 |     // Editor content shows fixture text.
  156 |     await expect(page.locator('.cm-content').getByText('playground', { exact: false }).first()).toBeVisible({
  157 |       timeout: 15000,
  158 |     })
  159 |   })
  160 | 
  161 |   test('editing a file persists to disk after save', async () => {
  162 |     const target = resolve(FIXTURE_DIR, 'edit-me.txt')
  163 |     writeFileSync(target, 'original\n')
  164 |     await page.getByRole('tab', { name: /Code/i }).click()
  165 |     await humanDelay(700)
  166 |     const entry = page.getByText('edit-me.txt', { exact: true }).first()
  167 |     await expect(entry).toBeVisible({ timeout: 15000 })
  168 |     await entry.click()
  169 |     await humanDelay(500)
  170 |     await page.keyboard.press('Control+a')
  171 |     await page.keyboard.type('edited-by-e2e', { delay: 20 })
  172 |     await page.keyboard.press('Control+s')
  173 |     await humanDelay(1000)
  174 |     const onDisk = (await import('node:fs')).readFileSync(target, 'utf8')
  175 |     expect(onDisk).toContain('edited-by-e2e')
  176 |     rmSync(target)
  177 |   })
  178 | })
  179 | 
  180 | test.describe('Browser stage', () => {
  181 |   test('browser mode renders its inspector and address UI without crashing', async () => {
```