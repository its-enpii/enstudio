<script lang="ts">
  import { state, MODES, type Mode } from '../store.svelte'
  import { t } from '../i18n/index.svelte'
  import { Icon, type IconName } from '../icons'

  const MODE_ICONS: Record<Mode, IconName> = {
    agent: 'ai-agent',
    code: 'code',
    terminal: 'terminal',
    git: 'git',
    browser: 'browser',
  }

  let unreadNotifications = $derived(state.notifications.filter((item) => !item.read).length)
</script>

<header class="flex h-full w-full items-center justify-between gap-3">
  <!-- spacer balances right tools so mode switch stays centered; inherits drag -->
  <div class="w-[72px] shrink-0" aria-hidden="true"></div>

  <!-- macOS segmented control -->
  <div
    class="flex items-center rounded-lg bg-black/25 p-0.5 ring-1 ring-white/8"
    style="-webkit-app-region: no-drag"
    role="tablist"
    aria-label={t('topnav.modeList')}
  >
    {#each MODES as m}
      <button
        type="button"
        role="tab"
        aria-selected={state.mode === m.id}
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-100 {state.mode === m.id
          ? 'bg-studio-card text-studio-text shadow-sm ring-1 ring-white/10'
          : 'text-studio-text-dim hover:text-studio-text'}"
        title={t(m.openKey)}
        onclick={() => state.setMode(m.id)}
      >
        <Icon name={MODE_ICONS[m.id]} size={14} class="shrink-0 opacity-90" />
        <span>{t(m.labelKey)}</span>
      </button>
    {/each}
  </div>

  <div class="flex items-center gap-0.5" style="-webkit-app-region: no-drag">
    <button
      type="button"
      class="relative grid size-8 place-items-center rounded-full text-studio-text-dim transition-colors hover:bg-white/8 hover:text-studio-text {state.notificationsOpen
        ? 'bg-white/8 text-studio-text'
        : ''}"
      title={t('topnav.notifications')}
      aria-label={t('topnav.notifications')}
      data-notifications-trigger
      onclick={(e) => {
        e.stopPropagation()
        state.toggleNotifications()
      }}
    >
      <Icon name="bell" size={15} />
      {#if unreadNotifications}
        <span
          class="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-studio-gold px-1 text-center font-mono text-[9px] font-bold leading-[13px] text-studio-dark"
          >{unreadNotifications > 9 ? '9+' : unreadNotifications}</span
        >
      {/if}
    </button>
    <button
      type="button"
      class="grid size-8 place-items-center rounded-full text-studio-text-dim transition-colors hover:bg-white/8 hover:text-studio-text"
      title={t('topnav.settings')}
      aria-label={t('topnav.settings')}
      onclick={() => (state.settingsOpen = true)}
    >
      <Icon name="settings" size={15} />
    </button>
  </div>
</header>
