/** npx tsx apps/desktop/src/lib/browserOrigin.selfcheck.ts */
import assert from 'node:assert/strict'
import { classifyBrowserUrl, suggestNavigateUrl } from './browserOrigin.js'

const root = 'F:/Workspace/demo'
assert.equal(classifyBrowserUrl(''), 'empty')
assert.equal(classifyBrowserUrl('https://google.com/'), 'public')
// With project: any loopback port is project
assert.equal(classifyBrowserUrl('http://localhost:5173/', { projectRoot: root }), 'project')
assert.equal(classifyBrowserUrl('http://127.0.0.1:3000/app', { projectRoot: root }), 'project')
assert.equal(classifyBrowserUrl('http://localhost:8100/login', { projectRoot: root }), 'project')
assert.equal(classifyBrowserUrl('http://localhost:9999/', { projectRoot: root }), 'project')
// No project open: loopback stays local
assert.equal(classifyBrowserUrl('http://localhost:8100/'), 'local')
assert.equal(
  classifyBrowserUrl('https://staging.example.com', {
    projectRoot: root,
    pinnedOrigins: ['https://staging.example.com'],
  }),
  'project',
)
assert.equal(suggestNavigateUrl('localhost:5173'), 'http://localhost:5173')
assert.equal(suggestNavigateUrl('example.com'), 'https://example.com')
assert.equal(suggestNavigateUrl('https://x.test'), 'https://x.test')
console.log('browserOrigin.selfcheck ok')
