<script lang="ts">
  import { state } from '../store.svelte'
  import { hydrateProjectSession } from '../enpii'

  async function openProject() {
    const api = window.enpiistudio
    if (!api?.dialog) {
      state.pushLog('[ui] dialog API missing — preload failed?')
      return
    }
    const dir = await api.dialog.openDirectory()
    if (dir) {
      state.addProject(dir)
      void hydrateProjectSession()
    }
  }

  function onSelect(id: string) {
    state.selectProject(id)
    void hydrateProjectSession()
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
      <input type="text" placeholder="Search projects..." disabled title="Soon" />
    </div>
    <button
      type="button"
      class="btn-icon-open"
      title="Open folder"
      aria-label="Open folder"
      onclick={openProject}
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

  <nav class="sidebar-nav custom-scrollbar">
    {#if state.projects.length === 0}
      <div class="empty">Open a folder to start</div>
    {:else}
      {#each state.projects as project (project.id)}
        <div
          class="project-item"
          class:active={state.activeProjectId === project.id}
          role="button"
          tabindex="0"
          onclick={() => onSelect(project.id)}
          onkeydown={(e) => e.key === 'Enter' && onSelect(project.id)}
        >
          <div class="row">
            <span class="name">{project.name}</span>
            <div
              class="dot-gold"
              class:dim={state.activeProjectId !== project.id}
              title="project"
            ></div>
          </div>
          <div class="path" title={project.path}>{project.path}</div>
        </div>
      {/each}
    {/if}
  </nav>
</aside>
