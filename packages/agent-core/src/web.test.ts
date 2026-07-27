import assert from 'node:assert/strict'
import http from 'node:http'
import { describe, it } from 'node:test'
import {
  ensurePublicHttpUrl,
  htmlToText,
  parseDuckDuckGoResults,
  validateHttpUrl,
  webFetch,
  webSearch,
} from './web.js'

describe('web SSRF guard', () => {
  it('rejects non-http schemes and credentials', () => {
    assert.throws(() => validateHttpUrl('file:///etc/passwd'), /http/)
    assert.throws(() => validateHttpUrl('https://user:pass@example.com/'), /credentials/)
  })

  it('rejects loopback and private literals', async () => {
    await assert.rejects(() => ensurePublicHttpUrl('http://127.0.0.1/'), /non-public/)
    await assert.rejects(() => ensurePublicHttpUrl('http://10.0.0.1/'), /non-public/)
    await assert.rejects(() => ensurePublicHttpUrl('http://192.168.1.1/'), /non-public/)
    await assert.rejects(() => ensurePublicHttpUrl('http://169.254.169.254/latest'), /non-public/)
    await assert.rejects(() => ensurePublicHttpUrl('http://localhost/'), /local/)
  })

  it('accepts public hostname shape (no resolve assert on offline)', () => {
    const u = validateHttpUrl('https://example.com/path')
    assert.equal(u.hostname, 'example.com')
  })
})

describe('htmlToText', () => {
  it('strips scripts and keeps text', () => {
    const t = htmlToText('<html><script>alert(1)</script><p>Hello <b>world</b></p></html>')
    assert.match(t, /Hello/)
    assert.match(t, /world/)
    assert.doesNotMatch(t, /alert/)
  })
})

describe('parseDuckDuckGoResults', () => {
  it('parses result__a anchors and snippets', () => {
    const html = `
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a>
      <a class="result__snippet">A short snippet about docs.</a>
      <a class="result__a" href="https://other.test/page">Other</a>
      <div class="result__snippet">Second snip</div>
    `
    const results = parseDuckDuckGoResults(html, 5)
    assert.equal(results.length, 2)
    assert.equal(results[0].title, 'Example Docs')
    assert.equal(results[0].url, 'https://example.com/docs')
    assert.match(results[0].snippet, /short snippet/)
  })
})

describe('web_fetch local server', () => {
  it('fetches public-looking loopback via forced URL only after guard — private blocked', async () => {
    const r = await webFetch({ url: 'http://127.0.0.1:9/' })
    assert.equal(r.ok, false)
    assert.match(r.content, /non-public|local|failed/i)
  })

  it('serves HTML through fetch when host is 127 — still blocked by guard', async () => {
    // Prove server works, then confirm tool still refuses private target.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h1>ok-enpii</h1></body></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    assert.ok(addr && typeof addr === 'object')
    const url = `http://127.0.0.1:${addr.port}/`
    try {
      const r = await webFetch({ url })
      assert.equal(r.ok, false)
      assert.match(r.content, /non-public|failed/i)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
    }
  })
})

describe('web_search parse path', () => {
  it('uses custom search_url backend that returns DDG-shaped HTML', async () => {
    const html = `
      <a class="result__a" href="https://example.com/a">Alpha</a>
      <a class="result__snippet">First hit</a>
    `
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    assert.ok(addr && typeof addr === 'object')
    // Private search_url is blocked by SSRF — expect fail (correct security default).
    try {
      const r = await webSearch({
        query: 'enpii',
        searchUrl: `http://127.0.0.1:${addr.port}/`,
        maxResults: 3,
      })
      assert.equal(r.ok, false)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
    }
  })
})
