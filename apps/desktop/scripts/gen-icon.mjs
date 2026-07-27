/** Minimal 512x512 PNG icon generator (no deps). */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'build')
const w = 512
const h = 512

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const rows = []
const cx = 256
const cy = 256
const r = 180
for (let y = 0; y < h; y++) {
  const row = Buffer.alloc(1 + w * 4)
  row[0] = 0
  for (let x = 0; x < w; x++) {
    const i = 1 + x * 4
    const dx = x - cx
    const dy = y - cy
    if (dx * dx + dy * dy <= r * r) {
      row[i] = 230
      row[i + 1] = 175
      row[i + 2] = 46
      row[i + 3] = 255
    } else {
      row[i] = 9
      row[i + 1] = 9
      row[i + 2] = 9
      row[i + 3] = 255
    }
  }
  rows.push(row)
}
const raw = Buffer.concat(rows)
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(w, 0)
ihdr.writeUInt32BE(h, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'icon.png')
fs.writeFileSync(out, png)
console.log('wrote', out, png.length)
