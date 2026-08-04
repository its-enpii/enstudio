<script lang="ts">
  import { state as app } from '../store.svelte'
  import { refreshDraftPlanRaw } from '../enpii'
  import { renderMarkdown } from '../markdown'
  import { t } from '../i18n/index.svelte'
  import { Button } from './ui'

  // Strip the YAML frontmatter so we render only the markdown body via the
  // shared util. Frontmatter rows are surfaced separately in a small table.
  function stripFrontmatter(src: string): string {
    if (!src.startsWith('---')) return src
    const end = src.indexOf('\n---', 3)
    if (end < 0) return src
    return src.slice(end + 4).replace(/^\n/, '')
  }

  function parseFrontmatter(src: string): Record<string, string> {
    if (!src.startsWith('---')) return {}
    const end = src.indexOf('\n---', 3)
    if (end < 0) return {}
    const block = src.slice(3, end).trim()
    const meta: Record<string, string> = {}
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
      if (!m) continue
      let v = (m[2] ?? '').trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      meta[m[1]!] = v
    }
    return meta
  }

  const plan = $derived(app.draftPlan)
  const meta = $derived(plan?.raw ? parseFrontmatter(plan.raw) : {})
  const body = $derived(plan?.raw ? stripFrontmatter(plan.raw) : '')
  const rendered = $derived(renderMarkdown(body))

  function openInEditor(): void {
    if (!plan?.path) return
    void window.enpiistudio?.shell?.openPath?.(plan.path)
  }

  async function onRefresh(): Promise<void> {
    refreshing = true
    try {
      await refreshDraftPlanRaw()
    } finally {
      refreshing = false
    }
  }

  let refreshing = $state(false)
</script>

<div class="mt-2 rounded-lg border border-studio-lavender/20 bg-studio-dark/40 px-3 py-2.5">
  <div class="mb-2 flex items-center justify-between gap-2">
    <div class="text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim">
      {t('agent.plan.preview.frontmatter')}
    </div>
    <div class="flex gap-1.5">
      <Button variant="ghost" size="sm" disabled={!plan?.raw || refreshing} loading={refreshing} onclick={onRefresh}>
        {t('agent.plan.preview.refresh')}
      </Button>
      {#if plan?.path}
        <Button variant="secondary" size="sm" onclick={openInEditor}>
          {t('agent.plan.preview.openEditor')}
        </Button>
      {/if}
    </div>
  </div>

  {#if Object.keys(meta).length > 0}
    <dl class="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
      {#each Object.entries(meta) as [key, value] (key)}
        <dt class="font-mono text-studio-text-dim">{key}</dt>
        <dd class="break-all text-studio-text">{value}</dd>
      {/each}
    </dl>
  {/if}

  {#if plan?.raw}
    <div class="prose-plan max-h-[60vh] overflow-y-auto rounded border border-border-subtle bg-studio-panel/70 p-3 text-[12px] leading-relaxed text-studio-text select-text">
      {@html rendered}
    </div>
  {:else}
    <div class="text-[11px] text-studio-text-dim">{t('agent.plan.preview.empty')}</div>
  {/if}
</div>

<style>
  /* Scope the markdown HTML to plan preview so it doesn't bleed into chat. */
  .prose-plan :global(h1) {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--color-studio-text, #fff);
    margin: 0 0 0.5rem;
  }
  .prose-plan :global(h2) {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-studio-text, #fff);
    margin: 0.75rem 0 0.25rem;
  }
  .prose-plan :global(h3) {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-studio-text-dim, #aaa);
    margin: 0.5rem 0 0.25rem;
  }
  .prose-plan :global(p) {
    margin: 0.4rem 0;
  }
  .prose-plan :global(ul),
  .prose-plan :global(ol) {
    margin: 0.4rem 0 0.4rem 1.2rem;
    padding: 0;
  }
  .prose-plan :global(ol > li) {
    margin: 0.25rem 0;
  }
  .prose-plan :global(ul > li) {
    margin: 0.15rem 0;
    list-style: disc;
  }
  .prose-plan :global(li::marker) {
    color: var(--color-studio-text-dim, #888);
  }
  .prose-plan :global(strong) {
    color: var(--color-studio-lavender-soft, #c4b5fd);
    font-weight: 600;
  }
  .prose-plan :global(em) {
    color: var(--color-studio-text-dim, #aaa);
  }
  .prose-plan :global(code) {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    padding: 0 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }
  .prose-plan :global(pre) {
    margin: 0.5rem 0;
    padding: 0.6rem;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 4px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .prose-plan :global(a) {
    color: var(--color-studio-gold, #f0c674);
    text-decoration: underline;
  }
  .prose-plan :global(table) {
    border-collapse: collapse;
    margin: 0.4rem 0;
  }
  .prose-plan :global(th),
  .prose-plan :global(td) {
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0.25rem 0.5rem;
    text-align: left;
  }
</style>