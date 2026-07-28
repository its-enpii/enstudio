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

<aside class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent">
  <div class="flex items-center gap-2.5 px-3 pt-3 pb-2">
    <div class="grid size-7 place-items-center rounded-[9px] bg-studio-purple shadow-sm">
      <span class="text-[12px] font-bold tracking-tight text-white">E</span>
    </div>
    <div class="min-w-0">
      <h1 class="m-0 truncate text-[13px] font-semibold tracking-tight text-studio-text">enpii</h1>
      <p class="m-0 text-[11px] text-studio-text-dim">studio</p>
    </div>
  </div>

  <div class="flex items-center gap-1.5 px-2 pb-2">
    <div class="relative min-w-0 flex-1">
      <svg
        class="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-studio-text-dim"
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
        class="w-full rounded-lg border-0 bg-black/25 py-1.5 pl-8 pr-2 text-[12px] text-studio-text outline-none ring-1 ring-white/8 placeholder:text-studio-text-dim/60 focus:ring-studio-purple/45"
        type="text"
        placeholder="Search"
        bind:value={filter}
        aria-label="Search projects"
      />
    </div>
    <button
      type="button"
      class="grid size-[30px] shrink-0 place-items-center rounded-lg bg-black/25 text-studio-text-dim ring-1 ring-white/8 hover:bg-white/8 hover:text-studio-text disabled:opacity-45"
      title="Open folder"
      aria-label="Open folder"
      onclick={openProject}
      disabled={opening}
    >
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
    <div class="mx-2 mb-2 rounded-lg bg-danger-bg px-2.5 py-2 text-[11px] text-danger" role="alert">
      {openError}
    </div>
  {/if}

  <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
    {#if app.projects.length === 0}
      <div class="px-2 py-8 text-center text-[12px] text-studio-text-dim">Open a folder to start</div>
    {:else if filtered.length === 0}
      <div class="px-2 py-8 text-center text-[12px] text-studio-text-dim">No match</div>
    {:else}
      {#each filtered as project (project.id)}
        <div
          class="group relative cursor-pointer rounded-lg px-2.5 py-2 transition-colors {app.activeProjectId ===
          project.id
            ? 'bg-studio-purple/25 ring-1 ring-studio-purple/30'
            : 'hover:bg-white/[0.05]'}"
          role="button"
          tabindex="0"
          onclick={() => onSelect(project.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(project.id)
            }
          }}
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-[12px] font-medium text-studio-text">{project.name}</div>
              <div class="truncate font-mono text-[10px] text-studio-text-dim">{project.path}</div>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-full px-1 text-[11px] {project.pinned
                ? 'text-studio-gold'
                : 'text-studio-text-dim opacity-0 group-hover:opacity-100'} hover:text-studio-gold"
              title={project.pinned ? 'Unpin' : 'Pin'}
              aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
              onclick={(e) => onPin(e, project.id)}
            >
              ★
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </nav>
</aside>
