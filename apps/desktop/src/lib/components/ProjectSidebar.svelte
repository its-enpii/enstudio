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
  class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[color:var(--color-chrome-border)] bg-studio-panel p-4 transition-[border-color] duration-150 hover:border-[color:var(--color-chrome-border-hover)]"
>
  <div class="mb-6 flex items-center gap-2.5 px-1">
    <div
      class="grid size-6 place-items-center rounded-md border border-studio-lavender/25 bg-studio-purple shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-studio-purple)_40%,transparent)]"
    >
      <span class="font-mono text-[11px] font-semibold tracking-tight text-studio-lavender-bright">E</span>
    </div>
    <div class="min-w-0">
      <h1 class="m-0 text-sm font-semibold tracking-tight text-studio-text">enpiistudio</h1>
      <p class="m-0 font-mono text-[9px] tracking-[0.12em] text-studio-text-dim uppercase">local agent</p>
    </div>
  </div>

  <div class="mb-6 flex items-center gap-2">
    <div class="relative min-w-0 flex-1">
      <svg
        class="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-studio-text-dim"
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
        class="w-full rounded-lg border border-white/5 bg-studio-dark py-2 pl-9 pr-3 text-xs text-studio-text outline-none placeholder:text-studio-text-dim/50 focus:ring-1 focus:ring-studio-purple/50"
        type="text"
        placeholder="Search projects..."
        bind:value={filter}
        aria-label="Search projects"
      />
    </div>
    <button
      type="button"
      class="grid size-8 shrink-0 place-items-center rounded-lg border border-white/5 text-studio-text-dim hover:bg-white/5 hover:text-white"
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
    <div class="mb-2 rounded-lg border border-danger/30 bg-danger-bg/40 p-4 text-[11px] text-danger" role="alert">
      {openError}
    </div>
  {/if}

  <nav class="min-h-0 flex-1 space-y-1 overflow-y-auto">
    {#if app.projects.length === 0}
      <div class="p-4 text-center text-xs text-studio-text-dim">Open a folder to start</div>
    {:else if filtered.length === 0}
      <div class="p-4 text-center text-xs text-studio-text-dim">No match</div>
    {:else}
      {#each filtered as project (project.id)}
        <div
          class="relative cursor-pointer rounded-lg border p-4 transition-colors {app.activeProjectId ===
          project.id
            ? 'border-studio-purple/20 bg-studio-purple/10'
            : 'border-transparent hover:bg-white/5'}"
          role="button"
          tabindex="0"
          onclick={() => onSelect(project.id)}
          onkeydown={(e) => e.key === 'Enter' && onSelect(project.id)}
        >
          <div class="mb-1 flex items-start justify-between gap-2">
            <span
              class="min-w-0 flex-1 truncate text-sm font-medium {app.activeProjectId === project.id
                ? 'text-studio-text'
                : 'text-studio-text-dim'}"
              >{project.name}</span
            >
            <div class="mt-1 flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                class="text-[10px] {project.pinned
                  ? 'text-studio-gold'
                  : 'text-studio-text-dim/40 hover:text-studio-gold'}"
                title={project.pinned ? 'Unpin' : 'Pin'}
                aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
                onclick={(e) => onPin(e, project.id)}
              >★</button>
              <div
                class="size-2 rounded-lg bg-studio-gold {app.activeProjectId === project.id
                  ? 'shadow-[0_0_8px_var(--color-studio-gold)]'
                  : 'opacity-60'}"
                title="project"
              ></div>
            </div>
          </div>
          <div class="truncate font-mono text-[10px] text-studio-text-dim" title={project.path}>
            {project.path}
          </div>
        </div>
      {/each}
    {/if}
  </nav>
</aside>
