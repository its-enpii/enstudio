# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-git-terminal-code-browser.spec.ts >> Code stage >> editing a file persists to disk after save
- Location: tests\e2e\specs\03-git-terminal-code-browser.spec.ts:161:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('edit-me.txt', { exact: true }).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText('edit-me.txt', { exact: true }).first()

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
      - tab "Code" [selected]
      - tab "Terminal"
      - tab "Git"
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
- main: Open a project Code mode needs a workspace.
- separator "Resize inspector"
- complementary "Diff": Diff No file open No file open
```

# Test source

```ts
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
> 167 |     await expect(entry).toBeVisible({ timeout: 15000 })
      |                         ^ Error: expect(locator).toBeVisible() failed
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