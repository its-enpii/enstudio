<script lang="ts">
  import { state as app } from '../store.svelte'
  import { hydrateProjectSession } from '../enpii'

  let opening = $state(false)
  let openError = $state('')
  let filter = $state('')

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return app.projects
    return app.projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    )
  })

  async function openProject(): Promise<void> {
    if (opening) return
    opening = true
    openError = ''
    const api = window.enpiistudio
    try {
      if (!api?.dialog) throw new Error('dialog API missing — restart the desktop app')
      const dir = await api.dialog.openDirectory()
      if (!dir) return
      app.addProject(dir)
      await hydrateProjectSession()
    } catch (err) {
      openError = err instanceof Error ? err.message : String(err)
      app.pushLog(`[project] open failed: ${openError}`)
    } finally {
      opening = false
    }
  }

  function onSelect(id: string) {
    app.selectProject(id)
    void hydrateProjectSession()
  }

  function onPin(e: MouseEvent, id: string) {
    e.stopPropagation()
    app.toggleProjectPin(id)
  }
</script>

<aside
  class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-studio-panel p-4"
>
  <div class="mb-4 flex items-center gap-3">
    <div
      class="grid size-8 place-items-center rounded-lg bg-studio-purple text-xs font-bold text-white"
    >
      E
    </div>
    <div class="text-sm font-semibold tracking-tight text-studio-text">enpiistudio</div>
  </div>

  <div class="mb-3 flex items-center gap-2">
    <div
      class="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border-subtle bg-studio-dark px-3 py-1.5"
    >
      <svg
        class="size-3.5 shrink-0 text-studio-text-dim"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        ></path>
      </svg>
      <input
        class="min-w-0 flex-1 bg-transparent text-xs text-studio-text outline-none placeholder:text-studio-text-dim"
        type="text"
        placeholder="Search projects..."
        bind:value={filter}
        aria-label="Search projects"
      />
    </div>
    <button
      type="button"
      class="grid size-8 shrink-0 place-items-center rounded-full border border-border-subtle text-studio-text-dim hover:bg-white/5 hover:text-studio-text"
      title="Open folder"
      aria-label="Open folder"
      onclick={openProject}
      disabled={opening}
    >
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        ></path>
      </svg>
    </button>
  </div>
  {#if openError}
    <div class="mb-2 rounded-md border border-danger/30 bg-danger-bg/40 px-2 py-1.5 text-[11px] text-danger">
      {openError}
    </div>
  {/if}

  <nav class="min-h-0 flex-1 space-y-1 overflow-y-auto">
    {#if app.projects.length === 0}
      <div class="px-1 py-6 text-center text-xs text-studio-text-dim">Open a folder to start</div>
    {:else if filtered.length === 0}
      <div class="px-1 py-6 text-center text-xs text-studio-text-dim">No match</div>
    {:else}
      {#each filtered as project (project.id)}
        <div
          class="cursor-pointer rounded-lg border px-2.5 py-2 transition-colors {app.activeProjectId ===
          project.id
            ? 'border-studio-purple/40 bg-studio-purple/15'
            : 'border-transparent hover:border-border-subtle hover:bg-white/[0.03]'}"
          role="button"
          tabindex="0"
          onclick={() => onSelect(project.id)}
          onkeydown={(e) => e.key === 'Enter' && onSelect(project.id)}
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-studio-text"
              >{project.name}</span
            >
            <button
              type="button"
              class="text-xs {project.pinned
                ? 'text-studio-gold'
                : 'text-studio-text-dim/40 hover:text-studio-gold'}"
              title={project.pinned ? 'Unpin' : 'Pin'}
              aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
              onclick={(e) => onPin(e, project.id)}
            >★</button>
            <div
              class="size-1.5 shrink-0 rounded-full bg-studio-gold {app.activeProjectId !== project.id
                ? 'opacity-30'
                : ''}"
              title="project"
            ></div>
          </div>
          <div class="mt-0.5 truncate font-mono text-[10px] text-studio-text-dim" title={project.path}>
            {project.path}
          </div>
        </div>
      {/each}
    {/if}
  </nav>
</aside>
