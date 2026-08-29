# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-git-terminal-code-browser.spec.ts >> Terminal stage >> second tab can be created and closed independently
- Location: tests\e2e\specs\03-git-terminal-code-browser.spec.ts:127:7

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 1
Received:   1
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
        - tab "Terminal" [selected] [ref=f2e22] [cursor=pointer]
        - tab "Git" [ref=f2e28] [cursor=pointer]
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
      - region "Terminal stage" [ref=f2e78]:
        - tablist "Terminal sessions" [ref=f2e79]:
          - button "New terminal" [active] [ref=f2e80] [cursor=pointer]
        - generic [ref=f2e86]:
          - generic [ref=f2e87]: E
          - generic [ref=f2e88]: No terminal session
          - generic [ref=f2e89]: Open a project, then click + to start a terminal session.
    - generic [ref=f2e91]:
      - separator "Resize inspector" [ref=f2e92]
      - complementary [ref=f2e93]:
        - generic [ref=f2e94]:
          - generic [ref=f2e95]:
            - heading "SSH hosts" [level=3] [ref=f2e96]
            - generic [ref=f2e97]:
              - button "+ Add host" [ref=f2e98] [cursor=pointer]
              - button "ssh.json" [ref=f2e99] [cursor=pointer]
              - button "Retry" [ref=f2e100] [cursor=pointer]
          - paragraph [ref=f2e105]: Tunnels for remote endpoints
          - list [ref=f2e106]:
            - listitem [ref=f2e107]:
              - generic [ref=f2e108]:
                - strong [ref=f2e109]: enpiistudio
                - code [ref=f2e110]: enpii@103.177.95.92:22
              - generic [ref=f2e111]:
                - button "Open" [disabled] [ref=f2e112]
                - button "Edit" [ref=f2e113] [cursor=pointer]
                - button "Delete" [ref=f2e114] [cursor=pointer]
```

# Test source

```ts
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
> 136 |     expect(afterCount).toBeGreaterThan(beforeCount)
      |                        ^ Error: expect(received).toBeGreaterThan(expected)
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
  182 |     await page.getByRole('tab', { name: /Browser/i }).click()
  183 |     await humanDelay(500)
  184 |     // BrowserInspector replaces default Inspector in this mode.
  185 |     const errors: string[] = []
  186 |     page.on('pageerror', (e: Error) => errors.push(e.message))
  187 |     await humanDelay(300)
  188 |     expect(errors).toEqual([])
  189 |   })
  190 | })
  191 | 
```