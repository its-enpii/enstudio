/**
 * Stage the branded app icon for electron-builder packaging.
 *
 * electron-builder resolves `build/icon.png` (from `directories.buildResources`)
 * during `npm run pack` / `dist:*`.
 *
 * To avoid electron-builder's WebAssembly-based converter (icon-tool.js) crashing
 * with "Error: WebAssembly.Memory(): could not allocate memory" on Windows, we
 * pre-convert the PNG to ICO natively using `ffmpeg` (which is installed on the host).
 *
 * If `build/icon.ico` is present, electron-builder skips WASM conversion.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const sourcePng = path.join(projectRoot, 'src', 'lib', 'AppIcons', 'Square44x44Logo.targetsize-256.png')
const buildDir = path.join(projectRoot, 'build')
const targetPng = path.join(buildDir, 'icon.png')
const targetIco = path.join(buildDir, 'icon.ico')

if (!existsSync(sourcePng)) {
  console.error(`[gen-icon] missing source PNG at ${sourcePng}`)
  process.exit(1)
}

mkdirSync(buildDir, { recursive: true })
copyFileSync(sourcePng, targetPng)
console.log(`[gen-icon] wrote ${targetPng}`)

// Convert PNG to ICO via ffmpeg to bypass electron-builder's WebAssembly icon-tool crash
try {
  console.log(`[gen-icon] converting PNG to ICO via ffmpeg...`)
  execSync(`ffmpeg -i "${sourcePng}" -y "${targetIco}"`, { stdio: 'ignore' })
  console.log(`[gen-icon] wrote ${targetIco} (native conversion success)`)
} catch (err) {
  console.warn(`[gen-icon] ffmpeg native conversion failed or ffmpeg not found.`)
  console.warn(`[gen-icon] electron-builder might attempt WASM conversion (may crash if memory fails).`)
}
