import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { storeDelete, storeGet, storePut, storeSearch } from './memory-store.js'

function fixture(): { root: string; home: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-store-'))
  const root = path.join(dir, 'project')
  const home = path.join(dir, 'home')
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  return { root, home, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('store put get delete round-trip', () => {
  const { root, home, cleanup } = fixture()
  try {
    const put = storePut(root, {
      namespace: ['users', 'prefs'],
      key: 'theme',
      value: { mode: 'dark' },
      scope: 'project',
      homeDir: home,
    })
    assert.equal(put.ok, true)
    const got = storeGet(root, { namespace: ['users', 'prefs'], key: 'theme', homeDir: home })
    assert.equal(got.ok, true)
    assert.match(got.content, /dark/)
    const del = storeDelete(root, { namespace: ['users', 'prefs'], key: 'theme', homeDir: home })
    assert.equal(del.ok, true)
    assert.equal(storeGet(root, { namespace: ['users', 'prefs'], key: 'theme', homeDir: home }).ok, false)
  } finally {
    cleanup()
  }
})

test('rejects path traversal namespace', () => {
  const { root, home, cleanup } = fixture()
  try {
    const bad = storePut(root, {
      namespace: ['..', 'etc'],
      key: 'x',
      value: 1,
      homeDir: home,
    })
    assert.equal(bad.ok, false)
  } finally {
    cleanup()
  }
})

test('search finds by query', () => {
  const { root, home, cleanup } = fixture()
  try {
    storePut(root, { namespace: ['a'], key: 'one', value: { note: 'alpha-token' }, homeDir: home })
    storePut(root, { namespace: ['a'], key: 'two', value: { note: 'other' }, homeDir: home })
    const hit = storeSearch(root, { query: 'alpha-token', homeDir: home })
    assert.equal(hit.ok, true)
    assert.match(hit.content, /one/)
    assert.doesNotMatch(hit.content, /two/)
  } finally {
    cleanup()
  }
})

test('global vs project isolation', () => {
  const { root, home, cleanup } = fixture()
  try {
    storePut(root, { namespace: ['x'], key: 'k', value: 'g', scope: 'global', homeDir: home })
    storePut(root, { namespace: ['x'], key: 'k', value: 'p', scope: 'project', homeDir: home })
    const g = storeGet(root, { namespace: ['x'], key: 'k', scope: 'global', homeDir: home })
    const p = storeGet(root, { namespace: ['x'], key: 'k', scope: 'project', homeDir: home })
    assert.match(g.content, /"g"/)
    assert.match(p.content, /"p"/)
  } finally {
    cleanup()
  }
})
