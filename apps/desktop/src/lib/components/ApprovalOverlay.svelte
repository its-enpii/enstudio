<script lang="ts">
  /**
   * Global approval when AgentStage is not the surface (Browser / other modes).
   * Filters by visibleApprovals() so Browser UI jobs don't pollute Agent, and vice versa.
   */
  import { state as app } from '../store.svelte'
  import { respondApproval, visibleApprovals } from '../enpii'
  import { t } from '../i18n/index.svelte'
  import { Icon } from '../icons'
  import { Button } from './ui'

  const queue = $derived(visibleApprovals())

  function kind(name: string): string {
    if (name === 'run_shell') return 'Shell'
    if (name === 'mcp_call_tool') return 'MCP'
    if (name.startsWith('git_')) return 'Git'
    return 'Write'
  }

  function verb(name: string): string {
    if (name === 'run_shell') return 'run'
    if (name === 'write_file') return 'write'
    if (name.startsWith('git_')) return name.slice(4)
    return 'edit'
  }

  function button(name: string): string {
    if (name === 'run_shell') return t('agent.approval.allowShell')
    if (name === 'mcp_call_tool') return t('agent.approval.allowMcp')
    if (name.startsWith('git_')) return t('agent.approval.allowGit')
    return t('agent.approval.allowEdit')
  }

  function onKey(e: KeyboardEvent): void {
    // AgentStage owns hotkeys when mode=agent.
    if (app.mode === 'agent') return
    if (!queue[0]) return
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const k = e.key.toLowerCase()
    const id = queue[0].requestId
    if (k === 'y') {
      e.preventDefault()
      void respondApproval('allow', id)
    } else if (k === 'n') {
      e.preventDefault()
      void respondApproval('deny', id)
    } else if (k === 's') {
      e.preventDefault()
      void respondApproval('allow', id, 'session')
    }
  }
</script>

{#if app.mode !== 'agent' && queue[0]}
  {@const sticky = queue[0]}
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-[260] flex justify-center px-4 pb-6"
    role="presentation"
  >
    <div
      class="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-xl border-2 border-studio-gold bg-studio-card shadow-[0_-16px_48px_rgba(0,0,0,0.65)]"
      role="alertdialog"
      aria-modal="true"
      aria-label="Action required"
    >
      <div class="flex items-center justify-between gap-3 border-b border-studio-gold/30 bg-studio-gold/15 px-4 py-3">
        <div class="flex items-center gap-2 text-[13px] font-bold text-studio-gold">
          <Icon name="alert" size={18} class="shrink-0 text-studio-gold" />
          <span>{t('agent.approval.title')}</span>
          {#if queue.length > 1}
            <span class="rounded bg-studio-gold/25 px-1.5 py-0.5 font-mono text-[11px]">{queue.length}</span>
          {/if}
        </div>
        <span class="text-[11px] font-medium text-studio-text-dim">{kind(sticky.name)} · Y / N / S</span>
      </div>
      <div class="p-4">
        <p class="mb-3 text-[14px] leading-relaxed text-studio-text">
          <span class="font-semibold text-studio-lavender">{t('agent.name')}</span> {t('agent.approval.wants')} {verb(sticky.name)}
          <code class="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[12px] text-studio-text">{sticky.summary || sticky.name}</code>
        </p>
        {#if sticky.preview}
          <pre class="mb-3 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-studio-dark p-3 font-mono text-[12px] text-studio-text-dim">{sticky.preview}</pre>
        {/if}
        <div class="grid grid-cols-2 gap-2">
          <Button variant="secondary" class="py-3 text-[14px]" onclick={() => void respondApproval('deny', sticky.requestId)}>{t('agent.approval.deny')}</Button>
          <Button variant="primary" class="bg-studio-gold py-3 text-[14px] font-bold text-studio-dark hover:bg-studio-gold hover:brightness-105" onclick={() => void respondApproval('allow', sticky.requestId)}>{button(sticky.name)}</Button>
          <Button variant="secondary" class="col-span-2 border-studio-gold/50 bg-studio-gold/15 text-[13px] font-semibold text-studio-gold hover:bg-studio-gold/25 hover:text-studio-gold" onclick={() => void respondApproval('allow', sticky.requestId, 'session')}>{t('agent.approval.session')}</Button>
        </div>
      </div>
    </div>
  </div>
{/if}

<svelte:window onkeydown={onKey} />
