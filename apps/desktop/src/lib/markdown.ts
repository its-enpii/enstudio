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
    '<code class="rounded bg-white/[0.08] px-1 font-mono text-[0.85em] text-studio-lavender-soft">$1</code>',
  )
  // Bold = weight only (inherit body color). Avoid pure-white flash on grey body.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-studio-text">$1</strong>')
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em class="italic text-studio-text-dim">$1</em>')
  // Underscore italic only at word edges (avoid node_modules / snake_case).
  out = out.replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
  return out
}

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function isTableSep(line: string): boolean {
  const cells = splitTableRow(line)
  if (!cells.length) return false
  return cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')))
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.includes('|') && !t.startsWith('```')
}

function renderTable(header: string[], rows: string[][]): string {
  const th = header
    .map(
      (c) =>
        `<th class="border-b border-border-subtle px-2.5 py-1.5 text-left text-[11px] font-semibold text-studio-text-dim">${inline(c)}</th>`,
    )
    .join('')
  const body = rows
    .map((row) => {
      const tds = header
        .map((_, i) => {
          const c = row[i] ?? ''
          return `<td class="border-b border-white/[0.04] px-2.5 py-1.5 text-[12px] text-studio-text align-top">${inline(c)}</td>`
        })
        .join('')
      return `<tr class="hover:bg-white/[0.02]">${tds}</tr>`
    })
    .join('')
  return `<div class="my-2 overflow-x-auto rounded-md border border-border-subtle bg-studio-dark/50"><table class="w-full min-w-[240px] border-collapse text-left"><thead><tr class="bg-white/[0.03]">${th}</tr></thead><tbody>${body}</tbody></table></div>`
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

    // GFM table: header | sep | rows…
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSep(lines[i + 1]!)
    ) {
      closeList()
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i]!) && !isTableSep(lines[i]!)) {
        rows.push(splitTableRow(lines[i]!))
        i++
      }
      html.push(renderTable(header, rows))
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
        html.push('<ul class="my-1.5 list-disc space-y-0.5 pl-5 text-sm text-studio-text-body">')
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
        html.push('<ol class="my-1.5 list-decimal space-y-0.5 pl-5 text-sm text-studio-text-body">')
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
      if (isTableRow(n) && i + 1 < lines.length && isTableSep(lines[i + 1]!)) break
      para.push(n)
      i++
    }
    html.push(
      `<p class="my-1.5 text-sm leading-relaxed text-studio-text-body">${para.map(inline).join('<br />')}</p>`,
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
