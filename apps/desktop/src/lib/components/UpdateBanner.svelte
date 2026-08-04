<script lang="ts">
  import { state as app } from '../store.svelte'
  import { t } from '../i18n/index.svelte'
  import { Button } from './ui'

  // Visible only when there's something actionable to show the user.
  const visible = $derived(
    app.updateStatus === 'available' ||
      app.updateStatus === 'downloading' ||
      app.updateStatus === 'downloaded' ||
      app.updateStatus === 'error',
  )

  function onDownload(): void {
    void app.downloadUpdate()
  }

  function onRestart(): void {
    app.installUpdate()
  }

  function onRetry(): void {
    void app.checkForUpdate()
  }

  function onDismiss(): void {
    app.dismissUpdateBanner()
  }
</script>

{#if visible}
  <div
    class="pointer-events-auto fixed bottom-4 right-4 z-[90] w-[min(360px,calc(100vw-32px))] rounded-xl border border-border-subtle bg-studio-card/95 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur"
    role="status"
    aria-live="polite"
  >
    {#if app.updateStatus === 'available'}
      <div class="flex items-start gap-2">
        <span class="mt-0.5 size-2 shrink-0 rounded-full bg-studio-gold" aria-hidden="true"></span>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold text-studio-text">
            {t('settings.updates.available', { version: app.updateInfo?.version ?? '' })}
          </div>
          {#if app.updateInfo?.releaseNotes}
            <p class="mt-1 m-0 line-clamp-3 text-[11px] leading-snug text-studio-text-dim">
              {app.updateInfo.releaseNotes}
            </p>
          {/if}
        </div>
        <button
          type="button"
          class="-mt-1 -mr-1 grid size-6 shrink-0 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label={t('settings.updates.later')}
          onclick={onDismiss}
        >×</button>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onclick={onDismiss}>{t('settings.updates.later')}</Button>
        <Button variant="primary" size="sm" onclick={onDownload}>{t('settings.updates.download')}</Button>
      </div>
    {:else if app.updateStatus === 'downloading'}
      <div class="text-[13px] font-semibold text-studio-text">
        {t('updateBanner.progress', { percent: Math.round(app.updateProgress?.percent ?? 0) })}
      </div>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-studio-dark">
        <div
          class="h-full rounded-full bg-studio-gold transition-[width] duration-150"
          style:width="{Math.min(100, Math.max(0, app.updateProgress?.percent ?? 0))}%"
        ></div>
      </div>
    {:else if app.updateStatus === 'downloaded'}
      <div class="flex items-start gap-2">
        <span class="mt-0.5 size-2 shrink-0 rounded-full bg-studio-success-shell" aria-hidden="true"></span>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold text-studio-text">
            {t('updateBanner.downloaded')}
            {#if app.updateInfo?.version}
              <span class="ml-1 font-mono text-[12px] text-studio-text-dim">v{app.updateInfo.version}</span>
            {/if}
          </div>
        </div>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onclick={onDismiss}>{t('settings.updates.later')}</Button>
        <Button variant="primary" size="sm" onclick={onRestart}>{t('settings.updates.install')}</Button>
      </div>
    {:else if app.updateStatus === 'error'}
      <div class="flex items-start gap-2">
        <span class="mt-0.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden="true"></span>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold text-studio-text">{t('settings.updates.error', { message: app.updateError ?? '' })}</div>
        </div>
        <button
          type="button"
          class="-mt-1 -mr-1 grid size-6 shrink-0 place-items-center rounded text-studio-text-dim hover:bg-white/10 hover:text-studio-text"
          aria-label={t('settings.updates.later')}
          onclick={onDismiss}
        >×</button>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onclick={onDismiss}>{t('settings.updates.later')}</Button>
        <Button variant="primary" size="sm" onclick={onRetry}>{t('common.retry')}</Button>
      </div>
    {/if}
  </div>
{/if}