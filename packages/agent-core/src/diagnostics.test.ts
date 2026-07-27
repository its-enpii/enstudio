import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { projectDiagnostics } from './diagnostics.js'

test('reports Python syntax errors without creating cache files', { skip: spawnSync('python3', ['--version']).error !== undefined }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-diagnostics-'))
  try {
    fs.writeFileSync(path.join(root, 'bad.py'), 'def broken(:\n')
    const diagnostic = projectDiagnostics(root, 'bad.py')[0]
    assert.equal(diagnostic?.source, 'python')
    assert.equal(diagnostic?.line, 1)
    assert.equal(fs.existsSync(path.join(root, '__pycache__')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('reports PHP syntax errors', { skip: spawnSync('php', ['--version']).error !== undefined }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-diagnostics-'))
  try {
    fs.writeFileSync(path.join(root, 'bad.php'), '<?php function broken( {')
    const diagnostic = projectDiagnostics(root, 'bad.php')[0]
    assert.equal(diagnostic?.source, 'php')
    assert.equal(diagnostic?.severity, 'error')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('uses the nearest nested tsconfig and local TypeScript compiler', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-diagnostics-'))
  try {
    const frontend = path.join(root, 'website', 'frontend')
    fs.mkdirSync(path.join(frontend, 'app'), { recursive: true })
    fs.mkdirSync(path.join(frontend, 'node_modules', '.bin'), { recursive: true })
    fs.writeFileSync(path.join(frontend, 'tsconfig.json'), '{}')
    fs.writeFileSync(path.join(frontend, 'app', 'page.tsx'), 'export default 1')
    const compiler = path.join(frontend, 'node_modules', '.bin', 'tsc')
    fs.writeFileSync(compiler, '#!/bin/sh\necho "app/page.tsx(3,4): error TS2322: nested error"\nexit 2\n')
    fs.chmodSync(compiler, 0o755)
    const diagnostic = projectDiagnostics(root, 'website/frontend/app/page.tsx')[0]
    assert.equal(diagnostic?.path, 'website/frontend/app/page.tsx')
    assert.equal(diagnostic?.code, 'TS2322')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('reports ESLint JSON diagnostics from the nested frontend', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-diagnostics-'))
  try {
    const frontend = path.join(root, 'website', 'frontend')
    fs.mkdirSync(path.join(frontend, 'node_modules', '.bin'), { recursive: true })
    const file = path.join(frontend, 'app.tsx')
    fs.writeFileSync(file, 'export default function App() {}')
    const eslint = path.join(frontend, 'node_modules', '.bin', 'eslint')
    fs.writeFileSync(eslint, `#!/bin/sh\nprintf '%s' '[{"filePath":"${file}","messages":[{"line":2,"column":3,"severity":1,"ruleId":"react/no-unescaped-entities","message":"Use escaped entity"}]}]'\nexit 1\n`)
    fs.chmodSync(eslint, 0o755)
    const diagnostic = projectDiagnostics(root, 'website/frontend/app.tsx')[0]
    assert.equal(diagnostic?.source, 'eslint')
    assert.equal(diagnostic?.severity, 'warning')
    assert.equal(diagnostic?.code, 'react/no-unescaped-entities')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
