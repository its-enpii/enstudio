<script lang="ts">
  import { tick } from 'svelte'
  import {
    matchesKeybinding,
    state as app,
    MODES,
    type KeybindingAction,
  } from '../store.svelte'

  type Action = { id: string; label: string; binding?: KeybindingAction; run: () => void }
  let open = $state(false)
  let query = $state('')
  let active = $state(0)
  let input = $state<HTMLInputElement>()

  const actions: Action[] = [
    ...MODES.map((m) => ({
      id: `mode.${m.id}`,
      label: m.openLabel,
      binding: `mode.${m.id}` as KeybindingAction,
      run: () => app.setMode(m.id),
    })),
    {
      id: 'settings',
      label: 'Open Settings',
      binding: 'settings' as KeybindingAction,
      run: () => {
        app.settingsOpen = true
      },
    },
    {
      id: 'notifications',
      label: 'Open Notifications',
      binding: 'notifications' as KeybindingAction,
      run: () => app.toggleNotifications(),
    },
    {
      id: 'export',
      label: 'Export Transcript (Markdown)',
      run: () => {
        void import('../enpii').then((m) => m.exportSessionMarkdown()).catch((err) => {
          app.notify('error', 'Export failed', err instanceof Error ? err.message : String(err))
        })
      },
    },
    {
      id: 'compact',
      label: 'Compact Session Context',
      run: () => {
        void import('../enpii').then((m) => m.compactSession()).catch((err) => {
          app.notify('error', 'Compact failed', err instanceof Error ? err.message : String(err))
        })
      },
    },
    {
      id: 'undo-compact',
      label: 'Undo Last Compact',
      run: () => {
        void import('../enpii').then((m) => m.undoCompactSession()).catch((err) => {
          app.notify('error', 'Undo compact failed', err instanceof Error ? err.message : String(err))
        })
      },
    },
  ]

  const filtered = $derived(
    actions.filter((action) => action.label.toLowerCase().includes(query.trim().toLowerCase())),
  )

  $effect(() => {
    if (open) void tick().then(() => input?.focus())
  })

  function close(): void {
    open = false
    query = ''
    active = 0
  }

  function execute(action?: Action): void {
    const target = action ?? filtered[active]
    if (!target) return
    target.run()
    close()
  }

  function isTypingTarget(event: KeyboardEvent): boolean {
    const t = event.target
    if (!(t instanceof HTMLElement)) return false
    if (t.isContentEditable) return true
    const tag = t.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  function onKeydown(event: KeyboardEvent): void {
    if (matchesKeybinding(event, app.keybindings.palette)) {
      event.preventDefault()
      open = true
      query = ''
      active = 0
      return
    }
    if (!open) {
      if (isTypingTarget(event)) return
      const action = actions.find((item) => item.binding && matchesKeybinding(event, app.keybindings[item.binding]))
      if (action) {
        event.preventDefault()
        action.run()
      }
      if (app.pendingApprovals.length) {
        const key = event.key.toLowerCase()
        if (key === 'y' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          void import('../enpii').then((m) => m.respondApproval('allow'))
          return
        }
        if (key === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          void import('../enpii').then((m) => m.respondApproval('deny'))
          return
        }
        if (key === 's' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          void import('../enpii').then((m) => m.respondApproval('allow', undefined, 'session'))
          return
        }
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      active = Math.min(active + 1, Math.max(filtered.length - 1, 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      active = Math.max(active - 1, 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-[250] flex items-start justify-center bg-black/55 pt-[15vh]"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) close()
    }}
  >
    <div
      class="studio-glass w-full max-w-lg overflow-hidden rounded-2xl bg-studio-panel/95"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <input
        class="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-sm text-studio-text outline-none placeholder:text-studio-text-dim"
        bind:this={input}
        bind:value={query}
        placeholder="Search commands…"
        aria-label="Search commands"
      />
      <div class="max-h-72 overflow-y-auto p-4">
        {#if filtered.length === 0}
          <div class="p-4 text-center text-xs text-studio-text-dim">No matching command.</div>
        {/if}
        {#each filtered as action, index (action.id)}
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-md p-4 text-left text-sm {index === active
              ? 'bg-studio-purple/30 text-white'
              : 'text-studio-text hover:bg-white/5'}"
            onclick={() => execute(action)}
            onmouseenter={() => (active = index)}
          >
            <span>{action.label}</span>
            <small class="font-mono text-[10px] text-studio-text-dim">{app.keybindings[action.id]}</small>
          </button>
        {/each}
      </div>
      <footer
        class="flex gap-4 border-t border-border-subtle p-4 text-[10px] text-studio-text-dim"
      >
        <span>↑↓ Navigate</span><span>Enter Run</span><span>Esc Close</span>
      </footer>
    </div>
  </div>
{/if}
