import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  listLiveTunnels,
  listSshHosts,
  listSshTunnels,
  loadSshConfig,
  sshArgv,
  stopAllTunnels,
  tunnelArgv,
} from './ssh.js'

describe('ssh config', () => {
  const home = path.join(os.tmpdir(), `enpii-ssh-${Date.now()}`)
  const prev = process.env.ENPII_HOME

  before(() => {
    fs.mkdirSync(home, { recursive: true })
    process.env.ENPII_HOME = home
    fs.writeFileSync(
      path.join(home, 'ssh.json'),
      JSON.stringify({
        hosts: {
          box: { host: '10.0.0.1', user: 'dev', port: 2222, identityFile: '~/.ssh/id_test' },
        },
        tunnels: {
          pg: { host: 'box', localPort: 15432, remotePort: 5432 },
        },
      }),
      'utf8',
    )
  })

  after(() => {
    if (prev === undefined) delete process.env.ENPII_HOME
    else process.env.ENPII_HOME = prev
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('loads hosts and tunnels', () => {
    const cfg = loadSshConfig()
    assert.equal(cfg.hosts.box?.host, '10.0.0.1')
    assert.equal(cfg.tunnels.pg?.localPort, 15432)
    assert.equal(listSshHosts().length, 1)
    assert.equal(listSshTunnels()[0]?.remotePort, 5432)
  })

  it('builds ssh argv', () => {
    const { command, args, summary } = sshArgv('box')
    assert.equal(command, 'ssh')
    assert.ok(args.includes('-p'))
    assert.ok(args.includes('2222'))
    assert.ok(args.includes('dev@10.0.0.1'))
    assert.match(summary, /ssh /)
  })

  it('builds tunnel argv', () => {
    const { args } = tunnelArgv('pg')
    assert.ok(args.includes('-N'))
    assert.ok(args.some((a) => a.startsWith('15432:')))
  })

  it('list tunnels includes running=false by default', () => {
    stopAllTunnels()
    const t = listSshTunnels().find((x) => x.name === 'pg')
    assert.ok(t)
    assert.equal(t!.running, false)
    assert.deepEqual(listLiveTunnels(), [])
  })
})
