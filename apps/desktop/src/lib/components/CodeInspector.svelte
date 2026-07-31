<script lang="ts">
  import { codePanel, lineDiff } from '../code-panel.svelte'
  import { t } from '../i18n/index.svelte'

  const lines = $derived(
    codePanel.path && codePanel.dirty
      ? lineDiff(codePanel.originalContent, codePanel.content)
      : [],
  )
  const stats = $derived.by(() => {
    let add = 0
    let del = 0
    for (const l of lines) {
      if (l.op === '+') add++
      else if (l.op === '-') del++
    }
    return { add, del }
  })
  const name = $derived(codePanel.path ? codePanel.path.split('/').pop() ?? codePanel.path : '')
</script>

<aside class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent" aria-label={t('code.diff')}>
  <header class="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
    <div class="min-w-0">
      <div class="text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim">{t('code.diff')}</div>
      <div class="truncate text-[12px] font-medium text-studio-text" title={codePanel.path || undefined}>
        {name || t('code.noFile')}
      </div>
    </div>
    {#if codePanel.dirty}
      <span class="shrink-0 font-mono text-[10px]">
        <span class="text-studio-success">+{stats.add}</span>
        <span class="text-studio-text-dim"> · </span>
        <span class="text-studio-error">−{stats.del}</span>
      </span>
    {/if}
  </header>

  {#if !codePanel.path}
    <div class="grid flex-1 place-items-center px-4 text-center text-[12px] text-studio-text-dim">
      {t('code.noFile')}
    </div>
  {:else if !codePanel.dirty}
    <div class="grid flex-1 place-items-center px-4 text-center text-[12px] text-studio-text-dim">
      {t('code.noChanges')}
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-snug">
      {#each lines as line, i (i)}
        <div
          class="flex whitespace-pre-wrap break-all border-b border-transparent px-2 py-0.5
            {line.op === '+'
            ? 'bg-studio-success/15 text-studio-success'
            : line.op === '-'
              ? 'bg-studio-error/15 text-studio-error'
              : 'text-studio-text-dim'}"
        >
          <span class="w-3 shrink-0 select-none text-center opacity-70">{line.op}</span>
          <span class="min-w-0 flex-1">{line.text.length ? line.text : ' '}</span>
        </div>
      {/each}
    </div>
  {/if}
</aside>
