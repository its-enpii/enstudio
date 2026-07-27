<script lang="ts">
  import { onMount } from 'svelte'
  import ProjectSidebar from './lib/components/ProjectSidebar.svelte'
  import TopNav from './lib/components/TopNav.svelte'
  import Inspector from './lib/components/Inspector.svelte'
  import AgentStage from './lib/components/AgentStage.svelte'
  import CodeStage from './lib/components/CodeStage.svelte'
  import TerminalStage from './lib/components/TerminalStage.svelte'
  import GitStage from './lib/components/GitStage.svelte'
  import BrowserStage from './lib/components/BrowserStage.svelte'
  import SettingsModal from './lib/components/SettingsModal.svelte'
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import NotificationCenter from './lib/components/NotificationCenter.svelte'
  import { state, clampProjectLayout, LAYOUT_MIN } from './lib/store.svelte'
  import { bindEnpiiEvents, pingEnpii, hydrateProjectSession } from './lib/enpii'

  const layoutStyle = $derived.by(() => {
    // Always clamp against live viewport — never trust raw localStorage widths.
    const layout = clampProjectLayout({}, state.activeProject?.layout)
    const side = layout.sidebarWidth
    const insp = layout.inspectorWidth
    // Fixed side rails + flexible center. Avoid minmax(min, pref) which left
    // empty dead space / crushed rails after git-mode width corruption.
    return `grid-template-columns:${side}px minmax(${LAYOUT_MIN.center}px, 1fr) ${insp}px`
  })

  let drag: null | { edge: 'sidebar' | 'inspector'; startX: number; startW: number } = null

  function onResizeStart(edge: 'sidebar' | 'inspector', e: PointerEvent): void {
    const layout = state.activeProject?.layout
    drag = {
      edge,
      startX: e.clientX,
      startW: edge === 'sidebar' ? (layout?.sidebarWidth ?? 256) : (layout?.inspectorWidth ?? 288),
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onResizeMove(e: PointerEvent): void {
    if (!drag) return
    const delta = e.clientX - drag.startX
    if (drag.edge === 'sidebar') state.setProjectLayout({ sidebarWidth: drag.startW + delta })
    else state.setProjectLayout({ inspectorWidth: drag.startW - delta })
  }

  function onResizeEnd(): void {
    drag = null
  }

  onMount(() => {
    const unbind = bindEnpiiEvents()
    void pingEnpii()
    // Reclamp saved widths (git-mode used to inflate sidebar / crush inspector).
    state.setProjectLayout({})
    if (state.activeProjectId) void hydrateProjectSession()
    else if (state.projects[0]) {
      state.selectProject(state.projects[0].id)
      void hydrateProjectSession()
    }
    const onWinResize = () => {
      state.setProjectLayout({})
    }
    window.addEventListener('resize', onWinResize)
    return () => {
      unbind()
      window.removeEventListener('resize', onWinResize)
    }
  })
</script>

<div class="app-shell" style={layoutStyle}>
  <div class="shell-col shell-col-side">
    <ProjectSidebar />
    <div
      class="shell-resizer shell-resizer-side"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onpointerdown={(e) => onResizeStart('sidebar', e)}
      onpointermove={onResizeMove}
      onpointerup={onResizeEnd}
      onpointercancel={onResizeEnd}
    ></div>
  </div>

  <main class="center">
    <TopNav />

    <div class="center-stage">
      {#if state.mode === 'agent'}
        <AgentStage />
      {/if}
      <div class="mode-stage" class:hidden={state.mode !== 'code'}>
        <CodeStage />
      </div>
      <div class="mode-stage" class:hidden={state.mode !== 'terminal'}>
        <TerminalStage />
      </div>
      <div class="mode-stage" class:hidden={state.mode !== 'git'}>
        <GitStage />
      </div>
      <div class="mode-stage" class:hidden={state.mode !== 'browser'}>
        <BrowserStage />
      </div>
    </div>
  </main>

  <div class="shell-col shell-col-insp">
    <div
      class="shell-resizer shell-resizer-insp"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector"
      onpointerdown={(e) => onResizeStart('inspector', e)}
      onpointermove={onResizeMove}
      onpointerup={onResizeEnd}
      onpointercancel={onResizeEnd}
    ></div>
    <Inspector />
  </div>
</div>

<CommandPalette />
<NotificationCenter />

{#if state.settingsOpen}
  <SettingsModal />
{/if}
