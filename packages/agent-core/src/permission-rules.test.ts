import assert from 'node:assert/strict'
import test from 'node:test'
import {
  globMatch,
  isAllowedByRules,
  parseAllowRule,
  parseAllowRules,
  toolSubject,
} from './permission-rules.js'

test('parseAllowRule aliases and patterns', () => {
  const a = parseAllowRule('PowerShell(npm *)')
  assert.equal(a?.tool, 'run_shell')
  assert.equal(a?.pattern, 'npm *')
  const b = parseAllowRule('WebFetch(domain:github.com)')
  assert.equal(b?.tool, 'web_fetch')
  assert.equal(b?.pattern, 'domain:github.com')
  const c = parseAllowRule('git_status')
  assert.equal(c?.tool, 'git_status')
  assert.equal(c?.pattern, '')
  assert.equal(parseAllowRule(''), null)
})

test('globMatch and domain rules', () => {
  assert.equal(globMatch('npm *', 'npm run build'), true)
  assert.equal(globMatch('npm *', 'pnpm run build'), false)
  assert.equal(globMatch('domain:github.com', 'https://github.com/foo/bar'), true)
  assert.equal(globMatch('domain:github.com', 'https://evil.com'), false)
  assert.equal(globMatch('git *', 'git status'), true)
})

test('isAllowedByRules matches tool + subject', () => {
  const rules = parseAllowRules([
    'run_shell(npm *)',
    'WebSearch',
    'web_fetch(domain:github.com)',
    'git_status',
  ])
  assert.equal(isAllowedByRules(rules, 'run_shell', JSON.stringify({ command: 'npm run test' })), true)
  assert.equal(isAllowedByRules(rules, 'run_shell', JSON.stringify({ command: 'rm -rf /' })), false)
  assert.equal(isAllowedByRules(rules, 'web_search', JSON.stringify({ query: 'x' })), true)
  assert.equal(
    isAllowedByRules(rules, 'web_fetch', JSON.stringify({ url: 'https://github.com/a/b' })),
    true,
  )
  assert.equal(
    isAllowedByRules(rules, 'web_fetch', JSON.stringify({ url: 'https://example.com' })),
    false,
  )
  assert.equal(isAllowedByRules(rules, 'git_status', '{}'), true)
  assert.equal(isAllowedByRules(rules, 'git_commit', JSON.stringify({ message: 'x' })), false)
})

test('toolSubject extracts command/url/path', () => {
  assert.equal(toolSubject('run_shell', '{"command":"npm i"}'), 'npm i')
  assert.equal(toolSubject('web_fetch', '{"url":"https://x.com"}'), 'https://x.com')
  assert.equal(toolSubject('write_file', '{"path":"a.ts"}'), 'a.ts')
})
