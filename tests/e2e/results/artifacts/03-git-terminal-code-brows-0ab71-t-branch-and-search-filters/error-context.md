# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-git-terminal-code-browser.spec.ts >> Git stage >> branch manager lists current branch and search filters
- Location: tests\e2e\specs\03-git-terminal-code-browser.spec.ts:62:7

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('header button[aria-expanded]')

```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - toolbar "Window title bar" [ref=f2e4]:
    - group "Window controls" [ref=f2e5]:
      - button "Close" [ref=f2e6] [cursor=pointer]
      - button "Minimize" [ref=f2e7] [cursor=pointer]
      - button "Maximize" [ref=f2e8] [cursor=pointer]
    - banner [ref=f2e10]:
      - tablist "Workspace mode" [ref=f2e11]:
        - tab "Agent" [ref=f2e12] [cursor=pointer]
        - tab "Code" [ref=f2e17] [cursor=pointer]
        - tab "Terminal" [ref=f2e22] [cursor=pointer]
        - tab "Git" [active] [selected] [ref=f2e28] [cursor=pointer]
        - tab "Browser" [ref=f2e33] [cursor=pointer]
      - generic [ref=f2e38]:
        - button "Notifications" [ref=f2e39] [cursor=pointer]
        - button "Settings" [ref=f2e43] [cursor=pointer]
  - generic [ref=f2e48]:
    - generic [ref=f2e49]:
      - complementary [ref=f2e50]:
        - heading "EnStudio" [level=1] [ref=f2e53]
        - generic [ref=f2e54]:
          - textbox "Search projects" [ref=f2e56]:
            - /placeholder: Search
          - button "Open folder" [ref=f2e57] [cursor=pointer]
        - navigation [ref=f2e61]:
          - button "playground F:\\Workspace\\Enpii Studio\\projects\\enpiistudio\\tests\\e2e\\fixtures\\playground Project actions" [ref=f2e62] [cursor=pointer]:
            - generic [ref=f2e63]:
              - generic [ref=f2e64]: playground
              - generic [ref=f2e66]: F:\Workspace\Enpii Studio\projects\enpiistudio\tests\e2e\fixtures\playground
            - button "Project actions" [ref=f2e70]
      - separator "Resize sidebar" [ref=f2e74]
    - main [ref=f2e75]:
      - generic [ref=f2e80]:
        - generic [ref=f2e81]: Open a project
        - generic [ref=f2e82]: Git mode needs a workspace.
    - generic [ref=f2e83]:
      - separator "Resize inspector" [ref=f2e84]
      - complementary [ref=f2e85]:
        - generic [ref=f2e86]:
          - generic [ref=f2e87]:
            - generic [ref=f2e88]:
              - generic [ref=f2e89]: Remote
              - button "Refresh" [ref=f2e90] [cursor=pointer]
            - generic [ref=f2e94]:
              - generic [ref=f2e95]:
                - generic [ref=f2e96]: Remote
                - strong [ref=f2e97]: —
              - generic [ref=f2e98]:
                - generic [ref=f2e99]: Branch
                - strong [ref=f2e100]: —
              - generic [ref=f2e101]:
                - generic [ref=f2e102]: Upstream
                - strong [ref=f2e103]: none
              - generic [ref=f2e104]:
                - generic [ref=f2e105]: Sync
                - strong [ref=f2e106]: up to date
          - generic [ref=f2e107]:
            - generic [ref=f2e108]:
              - generic [ref=f2e109]: History
              - generic [ref=f2e110]: "0"
            - generic [ref=f2e111]: No commits yet.
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
> 66  |     await branchBtn.click()
      |                     ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
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
  81  |     await expect(stageAll).toBeVisible({ timeout: 15000 })
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
```