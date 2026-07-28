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
    listMcpServers,
    listSsh,
    loadProviderConfig,
    saveProviderConfig,
    startSshTunnel,
    stopSshTunnel,
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
    DatePicker,
    type SelectOption,
  } from './ui'

  type Section = 'provider' | 'permissions' | 'network' | 'appearance' | 'keybindings'

  let section = $state<Section>('provider')
  let baseUrl = $state('')
  let apiKey = $state('')
  let model = $state('')
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
  let sshBusy = $state<string | null>(null)
  let mcpServers = $state<McpServerInfo[]>([])

  // local-only UI prefs (not yet wired to backend) — demo reusable controls
  let maxTurns = $state<number | null>(40)
  let streamTokens = $state(true)
  let theme = $state('dark')
  let reminderDate = $state('')

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
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
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
    dialect = cfg.dialect
    permissionMode = cfg.permissionMode
    denyGlobsText = (cfg.denyGlobs ?? []).join('\n')
    hasKey = cfg.hasKey
    envOverrides = { ...cfg.envOverrides }
    apiKey = ''
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
    app.settingsOpen = false
  }

  function onKey(e: KeyboardEvent): void {
    if (recording) return
    if (e.key === 'Escape' && !saving) close()
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
      const patch: {
        baseUrl: string
        model: string
        dialect: ProviderDialect
        permissionMode: PermissionMode
        apiKey?: string
        denyGlobs: string[]
      } = {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        dialect: knownDialect ?? 'openai',
        permissionMode: knownPermission ?? 'ask',
        denyGlobs,
      }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()
      const cfg = await saveProviderConfig(patch)
      denyGlobsText = (cfg.denyGlobs ?? []).join('\n')
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
  class="fixed inset-0 z-[100] grid place-items-center bg-studio-dark/70 p-6 backdrop-blur-[6px]"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && !saving) close()
  }}
>
  <div
    class="grid h-[min(720px,calc(100vh-48px))] w-[min(1100px,calc(100vw-48px))] grid-cols-[240px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border-subtle bg-studio-panel shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
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
            <TextInput
              label="Model"
              bind:value={model}
              placeholder="enpii"
              autocomplete="off"
              disabled={saving}
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
              hint="Local UI pref — not persisted yet"
              disabled={saving}
            />
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
              hint="One pattern per line. Merged with built-in .env / keys / credentials blocks."
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
            <DatePicker
              label="Reminder (demo)"
              bind:value={reminderDate}
              hint="Reusable DatePicker — not wired to backend"
              disabled={saving}
            />
          </div>
        {:else if section === 'network'}
          <div class="flex flex-col gap-2.5">
            <p class="text-[11px] text-studio-text-dim">
              Managed local forwards from <code class="font-mono">~/.enpiistudio/ssh.json</code> (BatchMode, no password prompts).
            </p>
            {#if sshHosts.length}
              <div class="text-xs text-studio-text-dim">Hosts</div>
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                {#each sshHosts as h (h.name)}
                  <li class="flex flex-row items-center justify-between gap-3 rounded-lg border border-border-subtle p-4">
                    <div class="min-w-0">
                      <strong class="text-sm text-studio-text">{h.name}</strong>
                      <code class="block font-mono text-[11px] text-studio-text-dim">{h.user ? `${h.user}@` : ''}{h.host}:{h.port}</code>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => {
                        app.setMode('terminal')
                        close()
                        app.notify('info', 'Open SSH', `Use Terminal → SSH → ${h.name}`)
                      }}
                    >
                      Open in Terminal
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="text-xs text-studio-text-dim">Tunnels</div>
            {#if sshTunnels.length === 0}
              <p class="text-[11px] text-studio-text-dim">No tunnels configured. Edit <code class="font-mono">ssh.json</code> (see <code class="font-mono">_example</code>).</p>
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
            <div class="text-xs text-studio-text-dim">MCP servers</div>
            <p class="text-[11px] text-studio-text-dim">
              From <code class="font-mono">~/.enpiistudio/mcp.json</code> + project <code class="font-mono">.enpii/mcp.json</code>
              (stdio <code class="font-mono">command</code> or HTTP <code class="font-mono">url</code>). Agent tools:
              <code class="font-mono">mcp_list_tools</code> / <code class="font-mono">mcp_call_tool</code>.
            </p>
            {#if mcpServers.length === 0}
              <p class="text-[11px] text-studio-text-dim">No MCP servers configured.</p>
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
            <div class="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onclick={() => void hydrateSsh()}>Refresh SSH</Button>
              <Button variant="ghost" size="sm" onclick={() => void hydrateMcp()}>Refresh MCP</Button>
            </div>
          </div>
        {:else if section === 'appearance'}
          <div class="grid grid-cols-2 items-start gap-x-6 gap-y-5">
            <SmartSelect
              label="Theme"
              bind:value={theme}
              options={themeOpts}
              disabled={saving}
              hint="Dark is the only live theme for now"
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
            <div class="mb-1 text-[11px] text-studio-text-dim">Click a shortcut, then press a modifier combination. Editor and browser shortcuts remain contextual.</div>
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

      <footer class="flex items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
        <span class="text-[11px] text-studio-text-dim">
          {#if section === 'keybindings'}
            Stored locally on this device
          {:else if section === 'network'}
            Tunnels live in the enpii sidecar process
          {:else}
            Env ENPII_* wins when set at process start
          {/if}
        </span>
        <div class="flex items-center gap-2">
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
        </div>
      </footer>
    </div>
  </div>
</div>
