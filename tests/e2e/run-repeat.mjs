#!/usr/bin/env node
/**
 * Repeat-runner: executes the Playwright E2E suite N times with a different
 * fuzz seed each round (randomized order via seeds), aggregates pass/fail,
 * and writes a summary JSON + human-readable report.
 *
 * Usage: node tests/e2e/run-repeat.mjs [rounds=3]
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')
const rounds = Number(process.argv[2] ?? 3)
const resultsDir = resolve(__dirname, 'results')
mkdirSync(resultsDir, { recursive: true })

const summary = []

for (let i = 1; i <= rounds; i++) {
  const seed = 100000 + Math.floor(Math.random() * 899999)
  console.log(`\n=== Round ${i}/${rounds} (FUZZ_SEED=${seed}) ===`)
  const res = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'playwright', 'test', '--config', resolve(__dirname, 'playwright.config.ts')],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, FUZZ_SEED: String(seed) },
      shell: false,
    },
  )
  summary.push({ round: i, seed, code: res.status })
}

// Read the JSON report if produced for totals.
let totals = null
const reportPath = resolve(resultsDir, 'report.json')
if (existsSync(reportPath)) {
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    totals = report.stats ?? null
  } catch {
    /* ignore malformed report */
  }
}

writeFileSync(resolve(resultsDir, 'repeat-summary.json'), JSON.stringify({ rounds, summary, totals }, null, 2))

console.log('\n=== REPEAT SUMMARY ===')
for (const s of summary) {
  console.log(`Round ${s.round}: seed=${s.seed} exit=${s.code}`)
}
if (totals) console.log('Totals:', JSON.stringify(totals))
const failed = summary.filter((s) => s.code !== 0).length
console.log(failed === 0 ? 'ALL ROUNDS PASSED' : `${failed} round(s) had failures — see output above`)
process.exit(failed === 0 ? 0 : 1)
