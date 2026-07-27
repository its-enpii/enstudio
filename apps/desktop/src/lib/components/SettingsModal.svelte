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
  class="modal-backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget && !saving) close()
  }}
>
  <div
    class="settings-shell"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <aside class="settings-nav">
      <div class="settings-nav-head">
        <h2 id="settings-title">Settings</h2>
        <p>enpii · enpiistudio</p>
      </div>
      <nav class="settings-nav-list">
        {#each nav as item}
          <button
            type="button"
            class="settings-nav-item"
            class:active={section === item.id}
            onclick={() => (section = item.id)}
          >
            <span class="nav-label">{item.label}</span>
            <span class="nav-blurb">{item.blurb}</span>
          </button>
        {/each}
      </nav>
      <div class="settings-nav-foot">
        <code>~/.enpiistudio/config.toml</code>
      </div>
    </aside>

    <div class="settings-main">
      <header class="settings-main-head">
        <div>
          <h3>{nav.find((n) => n.id === section)?.label}</h3>
          <p>{nav.find((n) => n.id === section)?.blurb}</p>
        </div>
        <Button variant="ghost" size="sm" onclick={close} disabled={saving}>Close</Button>
      </header>

      <div class="settings-body custom-scrollbar">
        {#if section === 'provider'}
          <div class="settings-grid">
            <TextInput
              class="span-2"
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
          <div class="settings-grid">
            <SmartSelect
              label="Permission mode"
              bind:value={permissionMode}
              options={permissionOpts}
              disabled={saving}
            />
            <label class="settings-deny span-2">
              <span class="settings-deny-label">Extra deny globs</span>
              <textarea
                class="settings-deny-input"
                rows="5"
                bind:value={denyGlobsText}
                disabled={saving}
                placeholder={'.env.production\n**/private/**\n**/*token*'}
                spellcheck="false"
              ></textarea>
              <span class="settings-deny-hint">One pattern per line. Merged with built-in .env / keys / credentials blocks.</span>
            </label>
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
          <div class="settings-network">
            <p class="settings-deny-hint">
              Managed local forwards from <code>~/.enpiistudio/ssh.json</code> (BatchMode, no password prompts).
            </p>
            {#if sshHosts.length}
              <div class="settings-deny-label">Hosts</div>
              <ul class="ssh-list">
                {#each sshHosts as h (h.name)}
                  <li class="ssh-tunnel-row">
                    <div>
                      <strong>{h.name}</strong>
                      <code>{h.user ? `${h.user}@` : ''}{h.host}:{h.port}</code>
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
            <div class="settings-deny-label">Tunnels</div>
            {#if sshTunnels.length === 0}
              <p class="muted-foot">No tunnels configured. Edit <code>ssh.json</code> (see <code>_example</code>).</p>
            {:else}
              <ul class="ssh-list">
                {#each sshTunnels as t (t.name)}
                  <li class="ssh-tunnel-row">
                    <div>
                      <strong>{t.name}</strong>
                      <code>localhost:{t.localPort} → {t.host} → {t.remoteHost}:{t.remotePort}</code>
                      {#if t.running}<span class="ssh-running">pid {t.pid ?? '?'}</span>{/if}
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
            <div class="settings-deny-label">MCP servers</div>
            <p class="settings-deny-hint">
              From <code>~/.enpiistudio/mcp.json</code> + project <code>.enpii/mcp.json</code>
              (stdio <code>command</code> or HTTP <code>url</code>). Agent tools:
              <code>mcp_list_tools</code> / <code>mcp_call_tool</code>.
            </p>
            {#if mcpServers.length === 0}
              <p class="muted-foot">No MCP servers configured.</p>
            {:else}
              <ul class="ssh-list">
                {#each mcpServers as s (s.name)}
                  <li>
                    <strong>{s.name}</strong>
                    {#if s.transport === 'http' || s.url}
                      <code>http {s.url}</code>
                      {#if s.headerKeys?.length}
                        <span class="muted-foot">headers: {s.headerKeys.join(', ')}</span>
                      {/if}
                    {:else}
                      <code>{s.command} {(s.args ?? []).join(' ')}</code>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <Button variant="ghost" size="sm" onclick={() => void hydrateSsh()}>Refresh SSH</Button>
              <Button variant="ghost" size="sm" onclick={() => void hydrateMcp()}>Refresh MCP</Button>
            </div>
          </div>
        {:else if section === 'appearance'}
          <div class="settings-grid">
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
          <div class="keybinding-list">
            <div class="keybinding-help">Click a shortcut, then press a modifier combination. Editor and browser shortcuts remain contextual.</div>
            {#each keybindingRows as item (item.id)}
              <div class="keybinding-row">
                <span>{item.label}</span>
                <button
                  type="button"
                  class:recording={recording === item.id}
                  onclick={() => (recording = item.id)}
                  onkeydown={(event) => recordKeybinding(event, item.id)}
                >{recording === item.id ? 'Press shortcut…' : app.keybindings[item.id]}</button>
              </div>
            {/each}
          </div>
        {/if}

        {#if error}
          <div class="form-error">{error}</div>
        {/if}
        {#if note}
          <div class="form-note">{note}</div>
        {/if}
      </div>

      <footer class="settings-foot">
        <span class="muted-foot">
          {#if section === 'keybindings'}
            Stored locally on this device
          {:else if section === 'network'}
            Tunnels live in the enpii sidecar process
          {:else}
            Env ENPII_* wins when set at process start
          {/if}
        </span>
        <div class="settings-foot-actions">
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
