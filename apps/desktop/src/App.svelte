<script lang="ts">
  import { onMount } from 'svelte'
  import ProjectSidebar from './lib/components/ProjectSidebar.svelte'
  import TopNav from './lib/components/TopNav.svelte'
  import Inspector from './lib/components/Inspector.svelte'
  import BrowserInspector from './lib/components/BrowserInspector.svelte'
  import CodeInspector from './lib/components/CodeInspector.svelte'
  import AgentStage from './lib/components/AgentStage.svelte'
  import CodeStage from './lib/components/CodeStage.svelte'
  import TerminalStage from './lib/components/TerminalStage.svelte'
  import GitStage from './lib/components/GitStage.svelte'
  import BrowserStage from './lib/components/BrowserStage.svelte'
  import SettingsModal from './lib/components/SettingsModal.svelte'
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import NotificationCenter from './lib/components/NotificationCenter.svelte'
  import ApprovalOverlay from './lib/components/ApprovalOverlay.svelte'
  import { state, clampProjectLayout } from './lib/store.svelte'
  import { bindEnpiiEvents, pingEnpii, hydrateProjectSession } from './lib/enpii'

  const layoutStyle = $derived.by(() => {
    const layout = clampProjectLayout({}, state.ui.layout)
    return `grid-template-columns:${layout.sidebarWidth}px minmax(0, 1fr) ${layout.inspectorWidth}px`
  })

  let drag: null | { edge: 'sidebar' | 'inspector'; startX: number; startW: number } = null

  $effect(() => {
    void window.enpiistudio?.app?.setMode?.(state.mode)
  })

  function onResizeStart(edge: 'sidebar' | 'inspector', e: PointerEvent): void {
    const layout = clampProjectLayout({}, state.ui.layout)
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
    if (drag.edge === 'sidebar') state.setLayout({ sidebarWidth: drag.startW + delta })
    else state.setLayout({ inspectorWidth: drag.startW - delta })
  }

  function onResizeEnd(): void {
    drag = null
  }

  onMount(() => {
    const unbind = bindEnpiiEvents()
    void pingEnpii()
    // Re-apply zoom via webFrame after preload is live (clears any leftover CSS zoom).
    try {
      document.documentElement.style.zoom = ''
      window.enpiistudio?.app?.setZoomFactor?.(state.ui.uiZoom / 100)
    } catch {
      /* ignore */
    }
    if (state.activeProjectId) {
      state.setLayout({})
      void hydrateProjectSession()
    } else {
      state.setLayout({})
    }
    const onWinResize = () => {
      state.setLayout({})
    }
    window.addEventListener('resize', onWinResize)
    return () => {
      unbind()
      window.removeEventListener('resize', onWinResize)
    }
  })
</script>

<div
  class="box-border flex h-full w-full flex-col bg-studio-dark {state.ui.goldPulse ? '' : 'gold-pulse-off'}"
  data-theme={state.ui.theme}
>
  <!-- Unified titlebar — frameless; empty chrome drags, controls are no-drag -->
  <div
    class="flex h-11 shrink-0 items-center gap-3 border-b border-border-subtle bg-studio-sidebar px-3"
    style="-webkit-app-region: drag"
    role="toolbar"
    aria-label="Window title bar"
    tabindex="0"
    ondblclick={() => void window.enpiistudio?.app?.windowMaximizeToggle?.()}
  >
    <div class="studio-traffic shrink-0" style="-webkit-app-region: no-drag" role="group" aria-label="Window controls">
      <button type="button" class="studio-traffic-btn" title="Close" aria-label="Close" onclick={() => void window.enpiistudio?.app?.windowClose?.()}></button>
      <button type="button" class="studio-traffic-btn" title="Minimize" aria-label="Minimize" onclick={() => void window.enpiistudio?.app?.windowMinimize?.()}></button>
      <button type="button" class="studio-traffic-btn" title="Maximize" aria-label="Maximize" onclick={() => void window.enpiistudio?.app?.windowMaximizeToggle?.()}></button>
    </div>
    <div class="min-w-0 flex-1">
      <TopNav />
    </div>
  </div>

  <div class="grid min-h-0 flex-1" style={layoutStyle}>
    <div class="relative flex h-full w-full min-h-0 min-w-0 overflow-hidden border-r border-border-subtle bg-studio-sidebar">
      <ProjectSidebar />
      <div
        class="absolute top-0 bottom-0 right-[-6px] z-[5] w-3 cursor-col-resize touch-none hover:bg-studio-gold/35 active:bg-studio-gold/45"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onpointerdown={(e) => onResizeStart('sidebar', e)}
        onpointermove={onResizeMove}
        onpointerup={onResizeEnd}
        onpointercancel={onResizeEnd}
      ></div>
    </div>

    <main class="min-h-0 min-w-0 bg-studio-dark select-text" data-selectable>
      <div class="grid h-full min-h-0 overflow-hidden select-text" style="grid-template-rows: minmax(0, 1fr) auto">
        {#if state.mode === 'agent'}
          <AgentStage />
        {/if}
        <div class="h-full min-h-0 {state.mode !== 'code' ? 'hidden' : ''}">
          <CodeStage />
        </div>
        <div class="h-full min-h-0 {state.mode !== 'terminal' ? 'hidden' : ''}">
          <TerminalStage />
        </div>
        <div class="h-full min-h-0 {state.mode !== 'git' ? 'hidden' : ''}">
          <GitStage />
        </div>
        <div class="h-full min-h-0 {state.mode !== 'browser' ? 'hidden' : ''}">
          <BrowserStage />
        </div>
      </div>
    </main>

    <div class="relative flex h-full w-full min-h-0 min-w-0 overflow-hidden border-l border-border-subtle bg-studio-sidebar">
      <div
        class="absolute top-0 bottom-0 left-[-6px] z-[5] w-3 cursor-col-resize touch-none hover:bg-studio-gold/35 active:bg-studio-gold/45"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        onpointerdown={(e) => onResizeStart('inspector', e)}
        onpointermove={onResizeMove}
        onpointerup={onResizeEnd}
        onpointercancel={onResizeEnd}
      ></div>
      {#if state.mode === 'browser'}
        <BrowserInspector />
      {:else if state.mode === 'code'}
        <CodeInspector />
      {:else}
        <Inspector />
      {/if}
    </div>
  </div>
</div>

{#if state.settingsOpen}
  <SettingsModal />
{/if}
<CommandPalette />
<NotificationCenter />
<!-- Non-agent modes only (AgentStage owns sticky-above-composer card). -->
<ApprovalOverlay />
