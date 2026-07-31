/**
 * Code rail state (CodeStage writes, CodeInspector reads).
 */
export type CodeDiffLine = { op: ' ' | '+' | '-'; text: string; no?: number }

export const codePanel = $state({
  path: '' as string,
  content: '' as string,
  originalContent: '' as string,
  dirty: false,
})

export function syncCodePanel(partial: {
  path?: string | null
  content?: string
  originalContent?: string
}): void {
  if (partial.path !== undefined) codePanel.path = partial.path ?? ''
  if (partial.content !== undefined) codePanel.content = partial.content
  if (partial.originalContent !== undefined) codePanel.originalContent = partial.originalContent
  codePanel.dirty = codePanel.path !== '' && codePanel.content !== codePanel.originalContent
}

/** Line LCS unified diff. Caps input to keep UI snappy. */
export function lineDiff(original: string, current: string, maxLines = 4000): CodeDiffLine[] {
  const a = original.split('\n').slice(0, maxLines)
  const b = current.split('\n').slice(0, maxLines)
  const n = a.length
  const m = b.length
  // DP lengths
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? (dp[i + 1][j + 1] + 1) : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: CodeDiffLine[] = []
  let i = 0
  let j = 0
  let lineNo = 1
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i], no: lineNo++ })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: '-', text: a[i] })
      i++
    } else {
      out.push({ op: '+', text: b[j], no: lineNo++ })
      j++
    }
  }
  while (i < n) {
    out.push({ op: '-', text: a[i++] })
  }
  while (j < m) {
    out.push({ op: '+', text: b[j++], no: lineNo++ })
  }
  if (original.split('\n').length > maxLines || current.split('\n').length > maxLines) {
    out.push({ op: ' ', text: '… truncated' })
  }
  return out
}
