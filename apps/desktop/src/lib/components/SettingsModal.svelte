<script lang="ts">
  import { onMount } from 'svelte'
  import {
    keybindingFromEvent,
    state as app,
    GLOBAL_ACTIONS,
    MODES,
    PERMISSION_MODES,
    PROVIDER_DIALECTS,
    type KeybindingAction,
    type PermissionMode,
    type ProviderDialect,
  } from '../store.svelte'
  import {
    deleteSshHost,
    listMcpServers,
    listSsh,
    loadProviderConfig,
    saveProviderConfig,
    startSshTunnel,
    stopSshTunnel,
    upsertSshHost,
    type McpServerInfo,
    type SshHostInfo,
    type SshTunnelInfo,
  } from '../enpii'
  import {
    Button,
    TextInput,
    NumberInput,
    Textarea,
    SmartSelect,
    Switch,
    type SelectOption,
  } from './ui'

  type Section = 'provider' | 'permissions' | 'network' | 'appearance' | 'keybindings'

  let section = $state<Section>('provider')
  let baseUrl = $state('')
  let apiKey = $state('')
  let model = $state('')
  let models = $state<string[]>(['enpii'])
  let modelDraft = $state('')
  let dialect = $state('openai')
  let permissionMode = $state('ask')
  let denyGlobsText = $state('')
  let hasKey = $state(false)
  let envOverrides = $state({
    baseUrl: false,
    apiKey: false,
    model: false,
    dialect: false,
  })
  let saving = $state(false)
  let error = $state('')
  let note = $state('')
  let recording = $state<KeybindingAction | null>(null)
  let sshHosts = $state<SshHostInfo[]>([])
  let sshTunnels = $state<SshTunnelInfo[]>([])
  let sshConfigPath = $state('')
  let sshBusy = $state<string | null>(null)
  let sshFormOpen = $state(false)
  let sshEditing = $state<string | null>(null)
  let sshForm = $state({ name: '', host: '', user: '', port: 22 as number | null, identityFile: '' })
  let sshFormError = $state('')
  let mcpServers = $state<McpServerInfo[]>([])

  // local-only UI prefs (not yet wired to backend)
  let maxTurns = $state<number | null>(40)
  let streamTokens = $state(true)
  let theme = $state('dark')

  const nav: { id: Section; label: string; blurb: string }[] = [
    { id: 'provider', label: 'Provider', blurb: 'Endpoint & model' },
    { id: 'permissions', label: 'Permissions', blurb: 'Write / shell policy' },
    { id: 'network', label: 'Network', blurb: 'SSH + MCP' },
    { id: 'appearance', label: 'Appearance', blurb: 'Theme & display' },
    { id: 'keybindings', label: 'Keybindings', blurb: 'Global shortcuts' },
  ]

  async function hydrateSsh(): Promise<void> {
    try {
      const data = await listSsh()
      sshHosts = data.hosts ?? []
      sshTunnels = data.tunnels ?? []
      sshConfigPath = data.configPath ?? ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  function openSshConfig(): void {
    if (!sshConfigPath) {
      void hydrateSsh().then(() => {
        if (sshConfigPath) void window.enpiistudio.shell.openPath(sshConfigPath)
      })
      return
    }
    void window.enpiistudio.shell.openPath(sshConfigPath)
  }

  function beginSshAdd(): void {
    sshEditing = null
    sshForm = { name: '', host: '', user: '', port: 22, identityFile: '' }
    sshFormError = ''
    sshFormOpen = true
  }

  function beginSshEdit(h: SshHostInfo): void {
    sshEditing = h.name
    sshForm = {
      name: h.name,
      host: h.host,
      user: h.user ?? '',
      port: h.port || 22,
      identityFile: h.identityFile ?? '',
    }
    sshFormError = ''
    sshFormOpen = true
  }

  function cancelSshForm(): void {
    sshFormOpen = false
    sshEditing = null
    sshFormError = ''
  }

  async function saveSshHost(): Promise<void> {
    const name = sshForm.name.trim()
    const host = sshForm.host.trim()
    if (!name || !host) {
      sshFormError = 'Name and host required'
      return
    }
    sshBusy = name
    sshFormError = ''
    error = ''
    try {
      await upsertSshHost({
        name,
        host,
        user: sshForm.user.trim() || undefined,
        port: typeof sshForm.port === 'number' && sshForm.port > 0 ? sshForm.port : 22,
        identityFile: sshForm.identityFile.trim() || undefined,
        previousName: sshEditing ?? undefined,
      })
      cancelSshForm()
      await hydrateSsh()
      app.notify('success', 'SSH host saved', name)
    } catch (err) {
      sshFormError = err instanceof Error ? err.message : String(err)
    } finally {
      sshBusy = null
    }
  }

  async function removeSshHost(name: string): Promise<void> {
    if (!confirm(`Delete SSH host “${name}”?`)) return
    sshBusy = name
    error = ''
    try {
      await deleteSshHost(name)
      if (sshEditing === name) cancelSshForm()
      await hydrateSsh()
      app.notify('success', 'SSH host deleted', name)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      sshBusy = null
    }
  }

  async function hydrateMcp(): Promise<void> {
    try {
      mcpServers = await listMcpServers()
    } catch {
      mcpServers = []
    }
  }

  async function onTunnelToggle(t: SshTunnelInfo): Promise<void> {
    sshBusy = t.name
    error = ''
    try {
      if (t.running) await stopSshTunnel(t.name)
      else await startSshTunnel(t.name)
      await hydrateSsh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      sshBusy = null
    }
  }

  const keybindingRows: { id: KeybindingAction; label: string }[] = [
    ...GLOBAL_ACTIONS.map((a) => ({ id: a.id, label: a.label })),
    ...MODES.map((m) => ({ id: `mode.${m.id}` as KeybindingAction, label: m.openLabel })),
  ]

  const dialectOpts: SelectOption[] = PROVIDER_DIALECTS.map((d) => ({ ...d }))
  const permissionOpts: SelectOption[] = PERMISSION_MODES.map((p) => ({ ...p }))

  const themeOpts: SelectOption[] = [
    { value: 'dark', label: 'Dark', description: 'Near-black canvas' },
    { value: 'light', label: 'Light', description: 'Off-white canvas (soon)' },
    { value: 'system', label: 'System', description: 'Follow OS (soon)' },
  ]

  async function hydrate(): Promise<void> {
    error = ''
    note = ''
    const cfg = app.provider ?? (await loadProviderConfig())
    if (!cfg) {
      error = 'Could not load config from enpii'
      return
    }
    baseUrl = cfg.baseUrl
    model = cfg.model
    models = normalizeModelList(cfg.models, cfg.model)
    modelDraft = ''
    dialect = cfg.dialect
    permissionMode = cfg.permissionMode
    denyGlobsText = (cfg.denyGlobs ?? []).join('\n')
    hasKey = cfg.hasKey
    envOverrides = { ...cfg.envOverrides }
    apiKey = ''
  }

  function normalizeModelList(list: string[] | undefined, active: string): string[] {
    const out: string[] = []
    for (const m of list ?? []) {
      const t = m.trim()
      if (t && !out.includes(t)) out.push(t)
    }
    const cur = active.trim()
    if (cur && !out.includes(cur)) out.unshift(cur)
    if (!out.length) out.push('enpii')
    return out
  }

  function addModel(): void {
    const id = modelDraft.trim()
    if (!id) return
    if (!models.includes(id)) models = [...models, id]
    model = id
    modelDraft = ''
  }

  function removeModel(id: string): void {
    if (models.length <= 1) return
    models = models.filter((m) => m !== id)
    if (model === id) model = models[0] ?? 'enpii'
  }

  onMount(() => {
    void hydrate()
    void hydrateSsh()
    void hydrateMcp()
  })

  $effect(() => {
    if (section === 'network') {
      void hydrateSsh()
      void hydrateMcp()
    }
  })

  function close(): void {
    if (saving) return
    app.settingsOpen = false
  }

  function onKey(e: KeyboardEvent): void {
    if (!app.settingsOpen || recording) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  function recordKeybinding(event: KeyboardEvent, action: KeybindingAction): void {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      recording = null
      return
    }
    const binding = keybindingFromEvent(event)
    if (!binding) return
    if (!app.setKeybinding(action, binding)) {
      app.notify('warning', 'Shortcut already used', binding)
      return
    }
    recording = null
    app.notify('success', 'Shortcut updated', `${keybindingRows.find((item) => item.id === action)?.label}: ${binding}`)
  }

  async function save(): Promise<void> {
    saving = true
    error = ''
    note = ''
    try {
      const knownDialect = PROVIDER_DIALECTS.find((d) => d.value === dialect)?.value
      const knownPermission = PERMISSION_MODES.find((p) => p.value === permissionMode)?.value
      const denyGlobs = denyGlobsText
        .split(/[\n,]+/)
        .map((g) => g.trim())
        .filter(Boolean)
      const activeModel = model.trim()
      const modelList = normalizeModelList(models, activeModel)
      const patch: {
        baseUrl: string
        model: string
        models: string[]
        dialect: ProviderDialect
        permissionMode: PermissionMode
        apiKey?: string
        denyGlobs: string[]
      } = {
        baseUrl: baseUrl.trim(),
        model: activeModel,
        models: modelList,
        dialect: knownDialect ?? 'openai',
        permissionMode: knownPermission ?? 'ask',
        denyGlobs,
      }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()
      const cfg = await saveProviderConfig(patch)
      denyGlobsText = (cfg.denyGlobs ?? []).join('\n')
      models = normalizeModelList(cfg.models, cfg.model)
      model = cfg.model
      hasKey = cfg.hasKey
      envOverrides = { ...cfg.envOverrides }
      apiKey = ''
      note = 'Saved to ~/.enpiistudio/config.toml'
      const envBits = [
        envOverrides.baseUrl ? 'baseUrl' : '',
        envOverrides.apiKey ? 'apiKey' : '',
        envOverrides.model ? 'model' : '',
        envOverrides.dialect ? 'dialect' : '',
      ].filter(Boolean)
      if (envBits.length) {
        note += ` · env still overrides: ${envBits.join(', ')}`
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }
</script>


<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && !saving) close()
  }}
>
  <div
    class="studio-glass grid h-[min(720px,calc(100vh-48px))] w-[min(1100px,calc(100vw-48px))] grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-2xl bg-studio-panel/95"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <aside class="flex min-h-0 flex-col gap-2 border-r border-border-subtle bg-studio-sidebar p-4">
      <div class="pb-4">
        <h2 id="settings-title" class="m-0 mb-1 text-base font-semibold text-studio-text">Settings</h2>
        <p class="m-0 text-[11px] text-studio-text-dim">enpii · enpiistudio</p>
      </div>
      <nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {#each nav as item}
          <button
            type="button"
            class="flex w-full flex-col items-start gap-0.5 rounded-lg border p-4 text-left {section === item.id
              ? 'border-studio-purple/35 bg-studio-purple/18 text-white'
              : 'border-transparent text-studio-text-dim hover:bg-white/[0.04] hover:text-white'}"
            onclick={() => (section = item.id)}
          >
            <span class="text-[13px] font-medium">{item.label}</span>
            <span class="text-[11px] {section === item.id ? 'text-studio-text/65' : 'text-studio-text-dim'}">{item.blurb}</span>
          </button>
        {/each}
      </nav>
      <div class="mt-auto border-t border-border-subtle p-4">
        <code class="break-all font-mono text-[10px] text-studio-text-dim">~/.enpiistudio/config.toml</code>
      </div>
    </aside>

    <div class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-studio-panel">
      <header class="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-4">
        <div>
          <h3 class="m-0 mb-1 text-[15px] font-semibold text-studio-text">{nav.find((n) => n.id === section)?.label}</h3>
          <p class="m-0 text-xs text-studio-text-dim">{nav.find((n) => n.id === section)?.blurb}</p>
        </div>
        <Button variant="ghost" size="sm" onclick={close} disabled={saving}>Close</Button>
      </header>

      <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
        {#if section === 'provider'}
          <div class="grid grid-cols-2 items-start gap-x-6 gap-y-5">
            <TextInput
              class="col-span-2"
              label="Base URL"
              bind:value={baseUrl}
              placeholder="https://ai.enpiistudio.com/v1"
              autocomplete="off"
              disabled={saving}
              hint={envOverrides.baseUrl ? 'env ENPII_BASE_URL active' : ''}
            />
            <TextInput
              label="API key {hasKey ? '(set)' : '(missing)'}"
              type="password"
              bind:value={apiKey}
              placeholder={hasKey ? 'Leave blank to keep current' : 'sk-…'}
              autocomplete="off"
              disabled={saving}
              hint={envOverrides.apiKey ? 'env ENPII_API_KEY active' : ''}
            />
            <SmartSelect
              label="Default model"
              bind:value={model}
              options={models.map((m) => ({ value: m, label: m }))}
              disabled={saving || !models.length}
              hint={envOverrides.model ? 'env ENPII_MODEL active' : ''}
            />
            <SmartSelect
              label="Dialect"
              bind:value={dialect}
              options={dialectOpts}
              disabled={saving}
              hint={envOverrides.dialect ? 'env ENPII_DIALECT active' : ''}
            />
            <NumberInput
              label="Max turns"
              bind:value={maxTurns}
              min={1}
              max={200}
              step={1}
              disabled={saving}
            />
            <div class="col-span-2 flex flex-col gap-2">
              <div class="text-xs font-medium text-studio-text-dim">Models</div>
              <div class="flex flex-wrap gap-1.5">
                {#each models as m (m)}
                  <span
                    class="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-studio-dark px-2.5 py-1.5 text-[12px] leading-none {m === model
                      ? 'border-studio-purple/40 text-studio-text'
                      : 'text-studio-text-dim'}"
                  >
                    <button
                      type="button"
                      class="leading-none hover:text-studio-text"
                      disabled={saving}
                      onclick={() => (model = m)}
                    >{m}</button>
                    {#if models.length > 1}
                      <button
                        type="button"
                        class="grid size-4 place-items-center rounded leading-none text-studio-text-dim hover:bg-white/10 hover:text-danger"
                        aria-label={`Remove ${m}`}
                        disabled={saving}
                        onclick={() => removeModel(m)}
                      >×</button>
                    {/if}
                  </span>
                {/each}
              </div>
              <div class="flex items-end gap-2">
                <TextInput
                  class="min-w-0 flex-1"
                  label="Add model"
                  bind:value={modelDraft}
                  placeholder="claude-opus-5"
                  autocomplete="off"
                  disabled={saving}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addModel()
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  class="min-h-[38px] self-end px-3.5"
                  disabled={saving || !modelDraft.trim()}
                  onclick={addModel}
                >Add</Button>
              </div>
            </div>
          </div>
        {:else if section === 'permissions'}
          <div class="grid grid-cols-2 items-start gap-x-6 gap-y-5">
            <SmartSelect
              label="Permission mode"
              bind:value={permissionMode}
              options={permissionOpts}
              disabled={saving}
            />
            <Textarea
              class="col-span-2"
              label="Extra deny globs"
              rows={5}
              bind:value={denyGlobsText}
              disabled={saving}
              placeholder={'.env.production\n**/private/**\n**/*token*'}
              spellcheck={false}
            />
            <Switch
              bind:checked={streamTokens}
              label="Stream tokens"
              description="Show partial assistant text as it arrives"
              disabled={saving}
            />
          </div>
        {:else if section === 'network'}
          <div class="flex flex-col gap-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-xs font-medium text-studio-text">SSH hosts</div>
              <div class="flex flex-wrap gap-1.5">
                <Button variant="primary" size="sm" onclick={beginSshAdd}>+ Add host</Button>
                <Button variant="ghost" size="sm" onclick={openSshConfig}>ssh.json</Button>
                <Button variant="ghost" size="sm" onclick={() => void hydrateSsh()}>Refresh</Button>
              </div>
            </div>

            {#if sshFormOpen}
              <div class="grid gap-2 rounded-lg border border-studio-purple/35 bg-studio-purple/10 p-3">
                <div class="text-xs font-medium text-studio-text">{sshEditing ? `Edit · ${sshEditing}` : 'New host'}</div>
                <div class="grid grid-cols-2 gap-2">
                  <TextInput label="Name" bind:value={sshForm.name} placeholder="prod" disabled={sshBusy !== null} />
                  <TextInput label="Host / IP" bind:value={sshForm.host} placeholder="203.0.113.10" disabled={sshBusy !== null} />
                  <TextInput label="User" bind:value={sshForm.user} placeholder="ubuntu" disabled={sshBusy !== null} />
                  <NumberInput label="Port" bind:value={sshForm.port} min={1} max={65535} disabled={sshBusy !== null} />
                </div>
                <TextInput
                  label="Identity file (optional)"
                  bind:value={sshForm.identityFile}
                  placeholder="~/.ssh/id_ed25519"
                  disabled={sshBusy !== null}
                />
                {#if sshFormError}<p class="m-0 text-[11px] text-danger">{sshFormError}</p>{/if}
                <div class="flex flex-wrap gap-1.5">
                  <Button variant="primary" size="sm" loading={sshBusy !== null} onclick={() => void saveSshHost()}>Save</Button>
                  <Button variant="ghost" size="sm" disabled={sshBusy !== null} onclick={cancelSshForm}>Cancel</Button>
                </div>
              </div>
            {/if}

            {#if sshHosts.length === 0 && !sshFormOpen}
              <p class="text-[11px] text-studio-text-dim">No hosts yet.</p>
            {:else if sshHosts.length}
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                {#each sshHosts as h (h.name)}
                  <li class="flex flex-row items-center justify-between gap-3 rounded-lg border border-border-subtle p-3">
                    <div class="min-w-0">
                      <strong class="text-sm text-studio-text">{h.name}</strong>
                      <code class="block truncate font-mono text-[11px] text-studio-text-dim"
                        >{h.user ? `${h.user}@` : ''}{h.host}:{h.port}{h.identityFile ? ` · ${h.identityFile}` : ''}</code
                      >
                    </div>
                    <div class="flex shrink-0 flex-wrap gap-1">
                      <Button variant="ghost" size="sm" disabled={sshBusy !== null} onclick={() => beginSshEdit(h)}>Edit</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={sshBusy !== null}
                        onclick={() => {
                          app.setMode('terminal')
                          close()
                          app.notify('info', 'Open SSH', `Terminal → SSH → ${h.name}`)
                        }}
                      >Connect</Button
                      >
                      <Button variant="danger" size="sm" disabled={sshBusy !== null} onclick={() => void removeSshHost(h.name)}
                        >Delete</Button
                      >
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="text-xs font-medium text-studio-text">Tunnels</div>
            {#if sshTunnels.length === 0}
              <p class="text-[11px] text-studio-text-dim">None.</p>
            {:else}
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                {#each sshTunnels as t (t.name)}
                  <li class="flex flex-row items-center justify-between gap-3 rounded-lg border border-border-subtle p-4">
                    <div class="min-w-0">
                      <strong class="text-sm text-studio-text">{t.name}</strong>
                      <code class="block font-mono text-[11px] text-studio-text-dim">localhost:{t.localPort} → {t.host} → {t.remoteHost}:{t.remotePort}</code>
                      {#if t.running}<span class="ml-1.5 text-[10px] text-studio-success-shell">pid {t.pid ?? '?'}</span>{/if}
                    </div>
                    <Button
                      variant={t.running ? 'ghost' : 'primary'}
                      size="sm"
                      loading={sshBusy === t.name}
                      disabled={sshBusy !== null && sshBusy !== t.name}
                      onclick={() => void onTunnelToggle(t)}
                    >
                      {t.running ? 'Stop' : 'Start'}
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-xs font-medium text-studio-text">MCP</div>
              <Button variant="ghost" size="sm" onclick={() => void hydrateMcp()}>Refresh</Button>
            </div>
            {#if mcpServers.length === 0}
              <p class="text-[11px] text-studio-text-dim">None.</p>
            {:else}
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                {#each mcpServers as s (s.name)}
                  <li class="flex flex-col gap-0.5 rounded-lg border border-border-subtle p-4">
                    <strong class="text-sm text-studio-text">{s.name}</strong>
                    {#if s.transport === 'http' || s.url}
                      <code class="font-mono text-[11px] text-studio-text-dim">http {s.url}</code>
                      {#if s.headerKeys?.length}
                        <span class="text-[11px] text-studio-text-dim">headers: {s.headerKeys.join(', ')}</span>
                      {/if}
                    {:else}
                      <code class="font-mono text-[11px] text-studio-text-dim">{s.command} {(s.args ?? []).join(' ')}</code>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else if section === 'appearance'}
          <div class="grid grid-cols-2 items-start gap-x-6 gap-y-5">
            <SmartSelect
              label="Theme"
              bind:value={theme}
              options={themeOpts}
              disabled={saving}
            />
            <Switch
              bind:checked={streamTokens}
              label="Gold running pulse"
              description="Subtle gold indicator while agent is busy"
              disabled={saving}
            />
          </div>
        {:else}
          <div class="flex flex-col gap-1.5">
            {#each keybindingRows as item (item.id)}
              <div class="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-4">
                <span class="text-sm text-studio-text">{item.label}</span>
                <button
                  type="button"
                  class="rounded-lg border px-3 py-1 font-mono text-[11px] {recording === item.id
                    ? 'border-studio-gold/50 bg-studio-gold/10 text-studio-gold'
                    : 'border-border-subtle text-studio-text-dim hover:bg-white/5 hover:text-studio-text'}"
                  onclick={() => (recording = item.id)}
                  onkeydown={(event) => recordKeybinding(event, item.id)}
                >{recording === item.id ? 'Press shortcut…' : app.keybindings[item.id]}</button>
              </div>
            {/each}
          </div>
        {/if}

        {#if error}
          <div class="rounded-sm border border-danger/25 bg-danger-bg/80 p-4 text-xs text-danger" role="alert">{error}</div>
        {/if}
        {#if note}
          <div class="text-xs text-studio-text-dim">{note}</div>
        {/if}
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-border-subtle px-6 py-4">
        {#if section === 'keybindings' || section === 'network'}
          {#if section === 'keybindings'}
            <Button variant="ghost" onclick={() => app.resetKeybindings()}>Reset Defaults</Button>
          {/if}
          <Button variant="primary" onclick={close}>Done</Button>
        {:else}
          <Button variant="ghost" onclick={close} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!baseUrl.trim() || !model.trim()}
            onclick={() => void save()}
          >
            Save
          </Button>
        {/if}
      </footer>
    </div>
  </div>
</div>
