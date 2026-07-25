<script lang="ts">
  import { tick } from 'svelte'
  import { state as app, type ChatMessage } from '../store.svelte'
  import { respondApproval, sendPrompt } from '../enpii'
  import { renderMarkdown } from '../markdown'

  type TurnGroup =
    | { kind: 'user'; m: ChatMessage }
    | { kind: 'system'; m: ChatMessage }
    | { kind: 'turn'; items: ChatMessage[] }

  function groupMessages(messages: ChatMessage[]): TurnGroup[] {
    const out: TurnGroup[] = []
    let i = 0
    while (i < messages.length) {
      const m = messages[i]!
      if (m.role === 'user') {
        out.push({ kind: 'user', m })
        i++
        continue
      }
      if (m.role === 'system') {
        out.push({ kind: 'system', m })
        i++
        continue
      }
      const items: ChatMessage[] = []
      while (i < messages.length) {
        const cur = messages[i]!
        if (cur.role === 'user' || cur.role === 'system') break
        items.push(cur)
        i++
      }
      if (items.length) out.push({ kind: 'turn', items })
    }
    return out
  }

  const groups = $derived(groupMessages(app.messages))

  /** Path / short label for tool row (mock: path after tool:name). */
  function toolLabel(m: ChatMessage): string {
    const s = m.tool?.summary ?? m.tool?.args ?? ''
    // "edit_file path=README.md …" / "write_file README.md (created…)"
    const pathEq = s.match(/\bpath=([^\s]+)/)
    if (pathEq) return pathEq[1]!.replace(/^["']|["']$/g, '')
    const named = s.match(
      /^(?:list_dir|read_file|glob|grep|write_file|edit_file)\s+(\S+)/,
    )
    if (named) return named[1]!.replace(/^["']|["']$/g, '')
    return s.slice(0, 48)
  }

  function statusLabel(m: ChatMessage, awaiting: boolean): string {
    if (awaiting) return 'Pending'
    if (m.tool?.status === 'running') return 'Running'
    if (m.tool?.status === 'error') return 'Failed'
    if (m.tool?.status === 'ok') return 'Completed'
    return m.tool?.status ?? ''
  }

  function approvalPath(): string {
    const s = app.approval?.summary ?? ''
    const m = s.match(/(?:write_file|edit_file)\s+(\S+)/)
    return m?.[1] ?? 'file'
  }

  function approvalVerb(): string {
    return app.approval?.name === 'write_file' ? 'write' : 'edit'
  }

  function diffLineClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'diff-meta'
    if (line.startsWith('@@')) return 'diff-hunk'
    if (line.startsWith('+')) return 'diff-add'
    if (line.startsWith('-')) return 'diff-del'
    return 'diff-ctx'
  }

  function isUnifiedDiff(text: string): boolean {
    return text.startsWith('--- ') || text.includes('\n+++ ') || text.startsWith('+++ ')
  }

  let stageEl: HTMLDivElement | undefined
  let composerEl: HTMLTextAreaElement | undefined
  let stickBottom = $state(true)

  function onStageScroll() {
    if (!stageEl) return
    const dist = stageEl.scrollHeight - stageEl.scrollTop - stageEl.clientHeight
    stickBottom = dist < 80
  }

  async function scrollToBottom(force = false) {
    await tick()
    if (!stageEl) return
    if (!force && !stickBottom) return
    stageEl.scrollTop = stageEl.scrollHeight
  }

  function otherTextFieldFocused(): boolean {
    const ae = document.activeElement
    if (!ae || ae === composerEl) return false
    return (
      ae instanceof HTMLInputElement ||
      ae instanceof HTMLTextAreaElement ||
      (ae as HTMLElement).isContentEditable === true
    )
  }

  function focusComposer() {
    if (!composerEl || composerEl.disabled) return
    if (!app.activeProject) return
    if (otherTextFieldFocused()) return
    if (document.activeElement === composerEl) return
    composerEl.focus({ preventScroll: true })
  }

  /** Never leave composer unfocused on outside click (except other text fields). */
  function onComposerBlur() {
    if (!app.activeProject || app.busy) return
    // wait one frame so button clicks / details toggle still fire
    requestAnimationFrame(() => {
      if (otherTextFieldFocused()) return
      focusComposer()
    })
  }

  $effect(() => {
    void app.messages.length
    void app.approval?.requestId
    void app.streamingId
    void app.messages[app.messages.length - 1]?.text
    void scrollToBottom()
  })

  // keep composer focused for project/session when idle
  $effect(() => {
    void app.activeProject?.id
    void app.session?.id
    void app.busy
    void app.approval?.requestId
    if (app.activeProject && !app.busy) {
      void tick().then(focusComposer)
    }
  })

  async function onSend() {
    const text = app.composer.trim()
    if (!text || app.busy) return
    if (!app.activeProject) {
      app.pushMessage({ role: 'system', text: 'Open a project first.' })
      return
    }
    app.composer = ''
    stickBottom = true
    void scrollToBottom(true)
    try {
      await sendPrompt(text)
    } catch (err) {
      app.pushMessage({
        role: 'system',
        text: err instanceof Error ? err.message : String(err),
      })
    } finally {
      void tick().then(focusComposer)
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onSend()
    }
  }
</script>

<div
  class="stage stage-fill custom-scrollbar"
  bind:this={stageEl}
  onscroll={onStageScroll}
>
  {#if !app.activeProject}
    <div class="agent-empty">
      <div class="mark">e</div>
      <div class="enpii">enpii</div>
      <div class="hint">Open a project from the left to start.</div>
    </div>
  {:else if app.messages.length === 0}
    <div class="agent-empty">
      <div class="mark">e</div>
      <div class="enpii">enpii</div>
      <div class="hint">
        Ask anything about <strong style="color:#fff">{app.activeProject.name}</strong>.
        <br />
        Tools: list_dir · read_file · glob · grep · write_file · edit_file
      </div>
    </div>
  {:else}
    <div class="timeline">
      {#each groups as g, gi (g.kind === 'turn' ? `t-${gi}-${g.items[0]?.id}` : g.m.id)}
        {#if g.kind === 'user'}
          <div class="msg-user">
            <div class="bubble">{g.m.text}</div>
          </div>
        {:else if g.kind === 'system'}
          <div class="msg-system">{g.m.text}</div>
        {:else}
          <div class="msg-assistant">
            <div class="avatar">e</div>
            <div class="turn-body">
              {#each g.items as m (m.id)}
                {#if m.role === 'assistant'}
                  {#if m.text}
                    <div class="body md">{@html renderMarkdown(m.text)}</div>
                  {/if}
                {:else if m.role === 'tool' && m.tool}
                  {@const awaiting =
                    app.approval?.toolCallId === m.tool.callId ||
                    app.approval?.requestId === m.tool.callId}
                  {#if awaiting && app.approval}
                    <div class="action-card">
                      <div class="action-head">
                        <div class="action-head-left">
                          <svg
                            class="action-ico"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clip-rule="evenodd"
                            ></path>
                          </svg>
                          <span>Action Required</span>
                        </div>
                        <span class="action-badge">Write Permission</span>
                      </div>
                      <div class="action-body">
                        <p class="action-copy">
                          <span class="enpii-name">enpii</span> wants to {approvalVerb()}
                          <code class="path-chip">{approvalPath()}</code>
                        </p>
                        {#if app.approval.preview}
                          {#if isUnifiedDiff(app.approval.preview)}
                            <div class="diff-view" role="pre">
                              {#each app.approval.preview.split('\n') as line, li (`d-${li}`)}
                                <div class="diff-line {diffLineClass(line)}">{line || ' '}</div>
                              {/each}
                            </div>
                          {:else}
                            <pre class="action-preview">{app.approval.preview}</pre>
                          {/if}
                        {/if}
                        <div class="action-actions">
                          <button
                            type="button"
                            class="btn-deny-full"
                            onclick={() => void respondApproval('deny')}
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            class="btn-allow-full"
                            onclick={() => void respondApproval('allow')}
                          >
                            Allow Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  {:else}
                    <details
                      class="tool-card"
                      class:running={m.tool.status === 'running'}
                      class:ok={m.tool.status === 'ok'}
                      class:err={m.tool.status === 'error'}
                    >
                      <summary class="tool-row">
                        <div class="tool-left">
                          <span class="tool-dot"></span>
                          <span class="tool-name">tool:{m.tool.name}</span>
                          <span class="tool-path">{toolLabel(m)}</span>
                        </div>
                        <span class="tool-status">{statusLabel(m, false)}</span>
                      </summary>
                      {#if m.tool.preview && m.tool.status !== 'running'}
                        <pre class="tool-preview">{m.tool.preview}</pre>
                      {:else if m.tool.status === 'running'}
                        <div class="tool-preview muted">Running…</div>
                      {:else}
                        <div class="tool-preview muted">No output</div>
                      {/if}
                    </details>
                  {/if}
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<footer class="composer">
  <div class="composer-inner">
    <textarea
      rows="3"
      bind:this={composerEl}
      placeholder={app.activeProject
        ? 'Message the agent… (Use @ to reference files)'
        : 'Open a project first'}
      bind:value={app.composer}
      onkeydown={onKeydown}
      onblur={onComposerBlur}
      disabled={!app.activeProject || app.busy}
    ></textarea>
    <div class="composer-bar">
      <div class="composer-tools">
        <button type="button" title="Attach" disabled aria-label="Attach">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            ></path>
          </svg>
        </button>
      </div>
      <button
        type="button"
        class="btn-send"
        onclick={onSend}
        disabled={!app.activeProject || app.busy}
      >
        {app.busy ? 'Running…' : 'Send'}
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"
          ></path>
        </svg>
      </button>
    </div>
  </div>
</footer>
