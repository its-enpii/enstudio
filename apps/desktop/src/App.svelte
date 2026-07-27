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
  import { state, clampProjectLayout } from './lib/store.svelte'
  import { bindEnpiiEvents, pingEnpii, hydrateProjectSession } from './lib/enpii'

  const layoutStyle = $derived.by(() => {
    const layout = clampProjectLayout({}, state.activeProject?.layout)
    // Fixed rails + pure 1fr center (no minmax floor that invents empty band).
    return `grid-template-columns:${layout.sidebarWidth}px minmax(0, 1fr) ${layout.inspectorWidth}px`
  })

  let drag: null | { edge: 'sidebar' | 'inspector'; startX: number; startW: number } = null

  function onResizeStart(edge: 'sidebar' | 'inspector', e: PointerEvent): void {
    const layout = clampProjectLayout({}, state.activeProject?.layout)
    drag = {
      edge,
      startX: e.clientX,
      startW: edge === 'sidebar' ? layout.sidebarWidth : layout.inspectorWidth,
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
    // Reclamp rails after load (layoutVersion hard-reset may already have fired).
    if (state.activeProjectId) {
      state.setProjectLayout({})
      void hydrateProjectSession()
    } else if (state.projects[0]) {
      state.selectProject(state.projects[0].id)
      state.setProjectLayout({})
      void hydrateProjectSession()
    } else {
      state.setProjectLayout({})
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

<div
  class="app-shell grid h-full w-full box-border gap-2 p-2 bg-studio-dark"
  style={layoutStyle}
>
  <div class="shell-col shell-col-side relative flex h-full w-full min-h-0 min-w-0 overflow-hidden">
    <ProjectSidebar />
    <div
      class="shell-resizer shell-resizer-side absolute top-0 bottom-0 right-[-4px] w-1.5 cursor-col-resize z-[5] touch-none hover:bg-studio-gold/25 active:bg-studio-gold/25"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onpointerdown={(e) => onResizeStart('sidebar', e)}
      onpointermove={onResizeMove}
      onpointerup={onResizeEnd}
      onpointercancel={onResizeEnd}
    ></div>
  </div>

  <main class="center grid min-h-0 min-w-0 gap-2" style="grid-template-rows: auto minmax(0, 1fr)">
    <TopNav />

    <div
      class="center-stage grid min-h-0 overflow-hidden rounded-3xl border border-border-subtle bg-studio-panel"
      style="grid-template-rows: minmax(0, 1fr) auto"
    >
      {#if state.mode === 'agent'}
        <AgentStage />
      {/if}
      <div class="mode-stage h-full min-h-0" class:hidden={state.mode !== 'code'}>
        <CodeStage />
      </div>
      <div class="mode-stage h-full min-h-0" class:hidden={state.mode !== 'terminal'}>
        <TerminalStage />
      </div>
      <div class="mode-stage h-full min-h-0" class:hidden={state.mode !== 'git'}>
        <GitStage />
      </div>
      <div class="mode-stage h-full min-h-0" class:hidden={state.mode !== 'browser'}>
        <BrowserStage />
      </div>
    </div>
  </main>

  <div class="shell-col shell-col-insp relative flex h-full w-full min-h-0 min-w-0 overflow-hidden">
    <div
      class="shell-resizer shell-resizer-insp absolute top-0 bottom-0 left-[-4px] w-1.5 cursor-col-resize z-[5] touch-none hover:bg-studio-gold/25 active:bg-studio-gold/25"
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
