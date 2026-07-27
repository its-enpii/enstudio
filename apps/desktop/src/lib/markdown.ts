/** Minimal markdown → safe HTML. No deps. Escape first, then decorate. */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  let out = esc(s)
  out = out.replace(
    /`([^`\n]+)`/g,
    '<code class="rounded bg-white/5 px-1 font-mono text-[0.85em]">$1</code>',
  )
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

    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        html.push(
          `<pre class="my-2 overflow-x-auto rounded-sm border border-border-subtle bg-studio-dark/80 p-3 font-mono text-xs"><code>${esc(codeBuf.join('\n'))}</code></pre>`,
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

    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    if (/^([-*_])\1{2,}\s*$/.test(line.trim())) {
      closeList()
      html.push('<hr class="my-3 border-0 border-t border-border-subtle" />')
      i++
      continue
    }

    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      closeList()
      const level = h[1]!.length
      const size = level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-[13px]'
      html.push(
        `<h${level} class="mb-1 mt-3 font-semibold text-studio-text ${size}">${inline(h[2]!)}</h${level}>`,
      )
      i++
      continue
    }

    const ul = line.match(/^[-*]\s+(.+)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        html.push('<ul class="my-1.5 list-disc space-y-0.5 pl-5 text-sm">')
        listType = 'ul'
      }
      html.push(`<li>${inline(ul[1]!)}</li>`)
      i++
      continue
    }

    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        html.push('<ol class="my-1.5 list-decimal space-y-0.5 pl-5 text-sm">')
        listType = 'ol'
      }
      html.push(`<li>${inline(ol[1]!)}</li>`)
      i++
      continue
    }

    closeList()
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
    html.push(
      `<p class="my-1.5 text-sm leading-relaxed text-studio-text">${para.map(inline).join('<br />')}</p>`,
    )
  }

  if (inCode) {
    html.push(
      `<pre class="my-2 overflow-x-auto rounded-sm border border-border-subtle bg-studio-dark/80 p-3 font-mono text-xs"><code>${esc(codeBuf.join('\n'))}</code></pre>`,
    )
  }
  closeList()
  return html.join('')
}
