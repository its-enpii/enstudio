import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  loadProviderConfig,
  publicConfig,
  saveProviderConfig,
  type ProviderConfig,
} from './config.js'

test('saveProviderConfig writes TOML and publicConfig redacts key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-cfg-'))
  const prevHome = process.env.ENPII_HOME
  const envKey = process.env.ENPII_API_KEY
  const envBase = process.env.ENPII_BASE_URL
  const envModel = process.env.ENPII_MODEL
  const envDialect = process.env.ENPII_DIALECT
  try {
    process.env.ENPII_HOME = dir
    delete process.env.ENPII_API_KEY
    delete process.env.ENPII_BASE_URL
    delete process.env.ENPII_MODEL
    delete process.env.ENPII_DIALECT

    const current: ProviderConfig = {
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      model: 'enpii',
      models: ['enpii'],
      dialect: 'openai',
      permissionMode: 'ask',
    }
    const next = saveProviderConfig(current, {
      baseUrl: 'https://ai.test/v1/',
      apiKey: 'sk-test',
      model: 'enpii-pro',
      dialect: 'openai',
      permissionMode: 'read_only',
    })
    assert.equal(next.baseUrl, 'https://ai.test/v1')
    assert.equal(next.apiKey, 'sk-test')
    assert.equal(next.model, 'enpii-pro')
    assert.equal(next.permissionMode, 'read_only')

    const file = path.join(dir, 'config.toml')
    assert.ok(fs.existsSync(file))
    const raw = fs.readFileSync(file, 'utf8')
    assert.match(raw, /apiKey = "sk-test"/)
    assert.match(raw, /permissionMode = "read_only"/)

    const pub = publicConfig(next)
    assert.equal(pub.hasKey, true)
    assert.equal('apiKey' in pub, false)

    // blank apiKey patch keeps existing
    const kept = saveProviderConfig(next, { apiKey: '', model: 'enpii-pro' })
    assert.equal(kept.apiKey, 'sk-test')

    const loaded = loadProviderConfig()
    assert.equal(loaded.model, 'enpii-pro')
    assert.equal(loaded.apiKey, 'sk-test')
    assert.equal(loaded.permissionMode, 'read_only')
  } finally {
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    if (envKey === undefined) delete process.env.ENPII_API_KEY
    else process.env.ENPII_API_KEY = envKey
    if (envBase === undefined) delete process.env.ENPII_BASE_URL
    else process.env.ENPII_BASE_URL = envBase
    if (envModel === undefined) delete process.env.ENPII_MODEL
    else process.env.ENPII_MODEL = envModel
    if (envDialect === undefined) delete process.env.ENPII_DIALECT
    else process.env.ENPII_DIALECT = envDialect
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('project TOML overlays user config without secret', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-proj-'))
  const prevHome = process.env.ENPII_HOME
  const envKey = process.env.ENPII_API_KEY
  try {
    process.env.ENPII_HOME = home
    delete process.env.ENPII_API_KEY
    delete process.env.ENPII_BASE_URL
    delete process.env.ENPII_MODEL
    delete process.env.ENPII_DIALECT

    saveProviderConfig(
      {
        baseUrl: 'https://user/v1',
        apiKey: 'sk-user',
        model: 'user-model',
        models: ['user-model'],
        dialect: 'openai',
        permissionMode: 'ask',
      },
      { apiKey: 'sk-user', model: 'user-model', baseUrl: 'https://user/v1' },
    )

    saveProviderConfig(
      loadProviderConfig(),
      { model: 'proj-model', dialect: 'anthropic', permissionMode: 'read_only' },
      { projectRoot: project, scope: 'project' },
    )

    const projFile = path.join(project, '.enpii', 'config.toml')
    assert.ok(fs.existsSync(projFile))
    const projRaw = fs.readFileSync(projFile, 'utf8')
    assert.doesNotMatch(projRaw, /apiKey/)
    assert.match(projRaw, /model = "proj-model"/)

    const loaded = loadProviderConfig(project)
    assert.equal(loaded.model, 'proj-model')
    assert.equal(loaded.dialect, 'anthropic')
    assert.equal(loaded.apiKey, 'sk-user') // still from user
    assert.equal(loaded.permissionMode, 'read_only')
  } finally {
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    if (envKey === undefined) delete process.env.ENPII_API_KEY
    else process.env.ENPII_API_KEY = envKey
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(project, { recursive: true, force: true })
  }
})

test('legacy JSON still loads when TOML absent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'enpii-json-'))
  const prevHome = process.env.ENPII_HOME
  try {
    process.env.ENPII_HOME = home
    delete process.env.ENPII_API_KEY
    delete process.env.ENPII_BASE_URL
    delete process.env.ENPII_MODEL
    delete process.env.ENPII_DIALECT
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ baseUrl: 'https://legacy/v1', apiKey: 'sk-legacy', model: 'leg', dialect: 'openai' }),
      'utf8',
    )
    const cfg = loadProviderConfig()
    assert.equal(cfg.apiKey, 'sk-legacy')
    assert.equal(cfg.model, 'leg')
  } finally {
    if (prevHome === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
  }
})
