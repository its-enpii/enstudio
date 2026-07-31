<script lang="ts">
  import { onMount } from 'svelte'
  import { state as app } from '../store.svelte'
  import { t } from '../i18n/index.svelte'
  import {
    deleteSshHost,
    listSsh,
    upsertSshHost,
    type SshHostInfo,
  } from '../enpii'
  import { Button, ConfirmDialog, TextInput, NumberInput } from './ui'
  import { Icon } from '../icons'

  let hosts = $state<SshHostInfo[]>([])
  let configPath = $state('')
  let busy = $state<string | null>(null)
  let error = $state('')
  let formOpen = $state(false)
  let editing = $state<string | null>(null)
  let form = $state({ name: '', host: '', user: '', port: 22 as number | null, identityFile: '' })
  let formError = $state('')
  let deleteTarget = $state<string | null>(null)

  async function hydrate(): Promise<void> {
    error = ''
    try {
      const data = await listSsh()
      hosts = data.hosts ?? []
      configPath = data.configPath ?? ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      hosts = []
    }
  }

  function openConfig(): void {
    if (!configPath) {
      void hydrate().then(() => {
        if (configPath) void window.enpiistudio.shell.openPath(configPath)
      })
      return
    }
    void window.enpiistudio.shell.openPath(configPath)
  }

  function beginAdd(): void {
    editing = null
    form = { name: '', host: '', user: '', port: 22, identityFile: '' }
    formError = ''
    formOpen = true
  }

  function beginEdit(h: SshHostInfo): void {
    editing = h.name
    form = {
      name: h.name,
      host: h.host,
      user: h.user ?? '',
      port: h.port || 22,
      identityFile: h.identityFile ?? '',
    }
    formError = ''
    formOpen = true
  }

  function cancelForm(): void {
    formOpen = false
    editing = null
    formError = ''
  }

  async function saveHost(): Promise<void> {
    const name = form.name.trim()
    const host = form.host.trim()
    if (!name || !host) {
      formError = t('settings.network.sshName') + ' + ' + t('settings.network.sshHost')
      return
    }
    busy = name
    formError = ''
    error = ''
    try {
      await upsertSshHost({
        name,
        host,
        user: form.user.trim() || undefined,
        port: typeof form.port === 'number' && form.port > 0 ? form.port : 22,
        identityFile: form.identityFile.trim() || undefined,
        previousName: editing ?? undefined,
      })
      cancelForm()
      await hydrate()
      app.notify('success', t('common.save'), name)
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err)
    } finally {
      busy = null
    }
  }

  function requestRemoveHost(name: string): void {
    deleteTarget = name
  }

  async function confirmRemoveHost(): Promise<void> {
    const name = deleteTarget
    if (!name) return
    deleteTarget = null
    busy = name
    error = ''
    try {
      await deleteSshHost(name)
      if (editing === name) cancelForm()
      await hydrate()
      app.notify('success', t('settings.network.sshDelete'), name)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = null
    }
  }

  function connect(h: SshHostInfo): void {
    window.dispatchEvent(new CustomEvent('enpiistudio:terminal-ssh', { detail: { name: h.name } }))
  }

  function hostLine(h: SshHostInfo): string {
    return `${h.user ? `${h.user}@` : ''}${h.host}:${h.port}`
  }

  onMount(() => {
    void hydrate()
  })
</script>

<section class="flex min-h-0 flex-1 flex-col gap-3">
  <div class="flex items-center justify-between gap-2">
    <h3 class="studio-label m-0">{t('settings.network.ssh')}</h3>
    <div class="flex flex-wrap gap-1">
      <Button variant="secondary" size="sm" onclick={beginAdd}>+ {t('settings.network.sshAdd')}</Button>
      <Button variant="ghost" size="sm" title={configPath || 'ssh.json'} onclick={openConfig}>ssh.json</Button>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-lg border border-border-subtle text-studio-text-dim hover:bg-white/5 hover:text-studio-text"
        title={t('common.retry')}
        aria-label={t('common.retry')}
        onclick={() => void hydrate()}
      ><Icon name="reload" size={12} /></button>
    </div>
  </div>

  <p class="m-0 text-[11px] leading-snug text-studio-text-dim">{t('settings.network.sshHint')}</p>

  {#if formOpen}
    <div class="grid gap-2 rounded-lg border border-studio-purple/35 bg-studio-purple/10 p-2.5">
      <div class="text-[11px] font-medium text-studio-text">
        {editing ? `${t('settings.network.sshEdit')} · ${editing}` : t('settings.network.sshAdd')}
      </div>
      <TextInput label={t('settings.network.sshName')} bind:value={form.name} placeholder="prod" disabled={busy !== null} />
      <TextInput label={t('settings.network.sshHost')} bind:value={form.host} placeholder="203.0.113.10" disabled={busy !== null} />
      <div class="grid grid-cols-2 gap-2">
        <TextInput label={t('settings.network.sshUser')} bind:value={form.user} placeholder="ubuntu" disabled={busy !== null} />
        <NumberInput label={t('settings.network.sshPort')} bind:value={form.port} min={1} max={65535} disabled={busy !== null} />
      </div>
      <TextInput
        label={t('settings.network.sshIdentity')}
        bind:value={form.identityFile}
        placeholder="~/.ssh/id_ed25519"
        disabled={busy !== null}
      />
      {#if formError}<p class="m-0 text-[11px] text-danger">{formError}</p>{/if}
      <div class="flex flex-wrap gap-1.5">
        <Button variant="primary" size="sm" loading={busy !== null} onclick={() => void saveHost()}>{t('common.save')}</Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onclick={cancelForm}>{t('common.cancel')}</Button>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="rounded-lg bg-danger-bg px-2.5 py-2 text-[11px] text-danger" role="alert">{error}</div>
  {/if}

  {#if hosts.length === 0 && !formOpen}
    <p class="m-0 text-[11px] text-studio-text-dim">{t('settings.network.mcpEmpty')}</p>
  {:else}
    <ul class="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto p-0">
      {#each hosts as h (h.name)}
        <li class="rounded-lg border border-border-subtle bg-studio-card/40 p-2.5">
          <div class="min-w-0">
            <strong class="block truncate text-[12px] text-studio-text">{h.name}</strong>
            <code class="mt-0.5 block truncate font-mono text-[10px] text-studio-text-dim">{hostLine(h)}</code>
            {#if h.identityFile}
              <code class="mt-0.5 block truncate font-mono text-[10px] text-studio-text-dim">{h.identityFile}</code>
            {/if}
          </div>
          <div class="mt-2 flex flex-wrap gap-1">
            <Button
              variant="primary"
              size="sm"
              disabled={busy !== null || !app.activeProject}
              onclick={() => connect(h)}
            >{t('common.open')}</Button>
            <Button variant="ghost" size="sm" disabled={busy !== null} onclick={() => beginEdit(h)}
              >{t('settings.network.sshEdit')}</Button
            >
            <Button variant="danger" size="sm" disabled={busy !== null} onclick={() => requestRemoveHost(h.name)}
              >{t('settings.network.sshDelete')}</Button
            >
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<ConfirmDialog
  open={deleteTarget != null}
  title={t('settings.network.sshDelete')}
  message={t('settings.network.sshDeleteConfirm', { name: deleteTarget ?? '' })}
  cancelLabel={t('common.cancel')}
  confirmLabel={t('common.delete')}
  danger
  onCancel={() => (deleteTarget = null)}
  onConfirm={() => void confirmRemoveHost()}
/>
