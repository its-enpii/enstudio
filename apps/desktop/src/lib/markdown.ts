/** Minimal markdown → safe HTML. No deps. Escape first, then decorate. */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  // `code` then **bold** then *italic*
  let out = esc(s)
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  return out
}

/** Render assistant/user text as HTML. */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let inCode = false
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) {
      html.push(listType === 'ul' ? '</ul>' : '</ol>')
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]!

    // fenced code
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        html.push(
          `<pre class="md-code"><code>${esc(codeBuf.join('\n'))}</code></pre>`,
        )
        codeBuf = []
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      i++
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      i++
      continue
    }

    // blank
    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    // thematic break: --- *** ___
    if (/^([-*_])\1{2,}\s*$/.test(line.trim())) {
      closeList()
      html.push('<hr class="md-hr" />')
      i++
      continue
    }

    // headings
    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      closeList()
      const level = h[1]!.length
      html.push(`<h${level} class="md-h">${inline(h[2]!)}</h${level}>`)
      i++
      continue
    }

    // unordered list
    const ul = line.match(/^[-*]\s+(.+)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        html.push('<ul class="md-list">')
        listType = 'ul'
      }
      html.push(`<li>${inline(ul[1]!)}</li>`)
      i++
      continue
    }

    // ordered list
    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        html.push('<ol class="md-list">')
        listType = 'ol'
      }
      html.push(`<li>${inline(ol[1]!)}</li>`)
      i++
      continue
    }

    closeList()
    // paragraph: gather consecutive non-special lines
    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const n = lines[i]!
      if (!n.trim()) break
      if (/^#{1,3}\s/.test(n)) break
      if (/^[-*]\s+/.test(n)) break
      if (/^\d+\.\s+/.test(n)) break
      if (n.trimStart().startsWith('```')) break
      para.push(n)
      i++
    }
    html.push(`<p class="md-p">${para.map(inline).join('<br />')}</p>`)
  }

  if (inCode) {
    html.push(`<pre class="md-code"><code>${esc(codeBuf.join('\n'))}</code></pre>`)
  }
  closeList()
  return html.join('')
}
