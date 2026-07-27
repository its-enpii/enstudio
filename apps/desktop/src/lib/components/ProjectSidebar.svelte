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

<aside class="sidebar panel">
  <div class="brand-row">
    <div class="brand-mark">E</div>
    <div class="brand-title">enpiistudio</div>
  </div>

  <div class="search-row">
    <div class="search-box">
      <svg class="search-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        ></path>
      </svg>
      <input
        type="text"
        placeholder="Search projects..."
        bind:value={filter}
        aria-label="Search projects"
      />
    </div>
    <button
      type="button"
      class="btn-icon-open"
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
  {#if openError}<div class="sidebar-error">{openError}</div>{/if}

  <nav class="sidebar-nav custom-scrollbar">
    {#if app.projects.length === 0}
      <div class="empty">Open a folder to start</div>
    {:else if filtered.length === 0}
      <div class="empty">No match</div>
    {:else}
      {#each filtered as project (project.id)}
        <div
          class="project-item"
          class:active={app.activeProjectId === project.id}
          role="button"
          tabindex="0"
          onclick={() => onSelect(project.id)}
          onkeydown={(e) => e.key === 'Enter' && onSelect(project.id)}
        >
          <div class="row">
            <span class="name">{project.name}</span>
            <button
              type="button"
              class="pin-btn"
              class:on={project.pinned}
              title={project.pinned ? 'Unpin' : 'Pin'}
              aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
              onclick={(e) => onPin(e, project.id)}
            >★</button>
            <div
              class="dot-gold"
              class:dim={app.activeProjectId !== project.id}
              title="project"
            ></div>
          </div>
          <div class="path" title={project.path}>{project.path}</div>
        </div>
      {/each}
    {/if}
  </nav>
</aside>
