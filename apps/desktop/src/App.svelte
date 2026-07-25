<script lang="ts">
  import { onMount } from 'svelte'
  import ProjectSidebar from './lib/components/ProjectSidebar.svelte'
  import TopNav from './lib/components/TopNav.svelte'
  import Inspector from './lib/components/Inspector.svelte'
  import AgentStage from './lib/components/AgentStage.svelte'
  import PlaceholderStage from './lib/components/PlaceholderStage.svelte'
  import { state } from './lib/store.svelte'
  import { bindEnpiiEvents, pingEnpii, hydrateProjectSession } from './lib/enpii'

  onMount(() => {
    const unbind = bindEnpiiEvents()
    void pingEnpii()
    if (state.activeProjectId) void hydrateProjectSession()
    else if (state.projects[0]) {
      state.selectProject(state.projects[0].id)
      void hydrateProjectSession()
    }
    return unbind
  })
</script>

<div class="app-shell">
  <ProjectSidebar />

  <main class="center">
    <TopNav />

    <div class="center-stage">
      {#if state.mode === 'agent'}
        <AgentStage />
      {:else if state.mode === 'code'}
        <PlaceholderStage title="Code" blurb="Monaco + file tree — milestone M1+" />
      {:else}
        <PlaceholderStage title="Terminal" blurb="xterm.js + node-pty — milestone M1+" />
      {/if}
    </div>
  </main>

  <Inspector />
</div>
