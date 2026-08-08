<script lang="ts">
  import { onMount } from 'svelte'
  import {
    keybindingFromEvent,
    state as app,
    FONT_FAMILIES,
    UI_ZOOM_MAX,
    UI_ZOOM_MIN,
    UI_ZOOM_STEP,
    GLOBAL_ACTIONS,
    MODES,
    PERMISSION_MODES,
    PROVIDER_DIALECTS,
    type FontFamilyId,
    type KeybindingAction,
    type PermissionMode,
    type ProviderDialect,
  } from '../store.svelte'
  import { t } from '../i18n/index.svelte'
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
    ConfirmDialog,
    TextInput,
    NumberInput,
    Textarea,
    SmartSelect,
    Switch,
    type SelectOption,
  } from './ui'

  type Section = 'provider' | 'permissions' | 'network' | 'appearance' | 'keybindings' | 'updates'

    type VendorKey = 'enpii' | 'claude' | 'codex' | 'opencode' | 'gemini'
  type TargetKey = 'main' | 'subagent'

  let activeVendor = $state<VendorKey>('enpii')
  let activeTarget = $state<TargetKey>('main')

  type VendorState = {
    baseUrl: string
    apiKey: string
    model: string
    models: string[]
    dialect: string
    hasKey: boolean
    sonnetModel?: string
    haikuModel?: string
    opusModel?: string
    maxThinkingTokens?: string
    customModelEnv?: string
    customCliFlags?: string
  }

  let vendorsState = $state<Record<VendorKey, { main: VendorState; subagent: VendorState }>>({
    enpii: {
      main: { baseUrl: '', apiKey: '', model: '', models: [], dialect: 'openai', hasKey: false },
      subagent: { baseUrl: '', apiKey: '', model: 'gpt-5.4-mini', models: ['gpt-5.4-mini', 'gpt-5.4'], dialect: 'openai', hasKey: false },
    },
    claude: {
      main: { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-3-7-sonnet', models: ['claude-3-7-sonnet', 'claude-3-5-haiku'], dialect: 'anthropic', hasKey: false },
      subagent: { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-3-5-haiku', models: ['claude-3-5-haiku'], dialect: 'anthropic', hasKey: false },
    },
    codex: {
      main: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4', models: ['gpt-5.4', 'gpt-5.4-mini'], dialect: 'openai', hasKey: false },
      subagent: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4-mini', models: ['gpt-5.4-mini'], dialect: 'openai', hasKey: false },
    },
    opencode: {
      main: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4', models: ['gpt-5.4', 'gpt-5.4-mini'], dialect: 'openai', hasKey: false },
      subagent: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4-mini', models: ['gpt-5.4-mini'], dialect: 'openai', hasKey: false },
    },
    gemini: {
      main: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], dialect: 'openai', hasKey: false },
      subagent: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash'], dialect: 'openai', hasKey: false },
    },
  })
  let section = $state<Section>('provider')
  let baseUrl = $state('')
  let apiKey = $state('')
  let model = $state('')
  let models = $state<string[]>([])
  let modelDraft = $state('')
  let dialect = $state('openai')
  let permissionMode = $state('ask')
  let sonnetModel = $state('')
  let haikuModel = $state('')
  let opusModel = $state('')
  let maxThinkingTokens = $state('')
  let customModelEnv = $state('')
  let customCliFlags = $state('')
  let denyGlobsText = $state('')
  let allowRulesText = $state('')
  /** PII/secret redact on tool results + model output (default on in core). */
  let guardrailsEnabled = $state(true)
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
  let sshDeleteTarget = $state<string | null>(null)
  let mcpServers = $state<McpServerInfo[]>([])

  // Agent runtime prefs (local for now — not yet in config.toml)
  let maxTurns = $state<number | null>(app.ui.maxTurns)
  // Appearance / stream: bind through app.ui (persisted)
  let streamTokens = $state(app.ui.streamTokens)
  let goldPulse = $state(app.ui.goldPulse)
  let theme = $state(app.ui.theme)
  let locale = $state(app.ui.locale)
  let fontFamily = $state(app.ui.fontFamily)
  let uiZoom = $state<number | null>(app.ui.uiZoom)

  const nav = $derived.by((): { id: Section; label: string; blurb: string }[] => [
    { id: 'provider', label: t('settings.nav.provider'), blurb: t('settings.nav.provider.blurb') },
    { id: 'permissions', label: t('settings.nav.permissions'), blurb: t('settings.nav.permissions.blurb') },
    { id: 'network', label: t('settings.nav.network'), blurb: t('settings.nav.network.blurb') },
    { id: 'appearance', label: t('settings.nav.appearance'), blurb: t('settings.nav.appearance.blurb') },
    { id: 'updates', label: t('settings.updates.nav'), blurb: t('settings.updates.nav.blurb') },
    { id: 'keybindings', label: t('settings.nav.keybindings'), blurb: t('settings.nav.keybindings.blurb') },
  ])

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

  function requestRemoveSshHost(name: string): void {
    sshDeleteTarget = name
  }

  async function confirmRemoveSshHost(): Promise<void> {
    const name = sshDeleteTarget
    if (!name) return
    sshDeleteTarget = null
    sshBusy = name
    error = ''
    try {
      await deleteSshHost(name)
      if (sshEditing === name) cancelSshForm()
      await hydrateSsh()
      app.notify('success', t('settings.network.sshDelete'), name)
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

  type KeyRow =
    | { kind: 'bind'; id: KeybindingAction; label: string }
    | { kind: 'fixed'; id: string; label: string; keys: string }
  type KeyGroup = { id: string; label: string; rows: KeyRow[] }

  const keybindingGroups = $derived.by((): KeyGroup[] => [
    {
      id: 'general',
      label: t('settings.keybindings.group.general'),
      rows: GLOBAL_ACTIONS.map((a) => ({ kind: 'bind' as const, id: a.id, label: t(a.labelKey) })),
    },
    {
      id: 'modes',
      label: t('settings.keybindings.group.modes'),
      rows: MODES.map((m) => ({
        kind: 'bind' as const,
        id: `mode.${m.id}` as KeybindingAction,
        label: t(m.openKey),
      })),
    },
    {
      id: 'browser',
      label: t('settings.keybindings.group.browser'),
      rows: [
        { kind: 'fixed', id: 'browser.find', label: t('settings.keybindings.browser.find'), keys: 'Mod+F' },
        { kind: 'fixed', id: 'browser.address', label: t('settings.keybindings.browser.address'), keys: 'Mod+L' },
        { kind: 'fixed', id: 'browser.newTab', label: t('settings.keybindings.browser.newTab'), keys: 'Mod+T' },
        { kind: 'fixed', id: 'browser.closeTab', label: t('settings.keybindings.browser.closeTab'), keys: 'Mod+W' },
        { kind: 'fixed', id: 'browser.reload', label: t('settings.keybindings.browser.reload'), keys: 'Mod+R' },
        { kind: 'fixed', id: 'browser.nextTab', label: t('settings.keybindings.browser.nextTab'), keys: 'Mod+Tab' },
        { kind: 'fixed', id: 'browser.prevTab', label: t('settings.keybindings.browser.prevTab'), keys: 'Mod+Shift+Tab' },
        { kind: 'fixed', id: 'browser.back', label: t('settings.keybindings.browser.back'), keys: 'Alt+←' },
        { kind: 'fixed', id: 'browser.forward', label: t('settings.keybindings.browser.forward'), keys: 'Alt+→' },
      ],
    },
    {
      id: 'code',
      label: t('settings.keybindings.group.code'),
      rows: [
        { kind: 'fixed', id: 'code.save', label: t('settings.keybindings.code.save'), keys: 'Mod+S' },
        { kind: 'fixed', id: 'code.find', label: t('settings.keybindings.code.find'), keys: 'Mod+F' },
      ],
    },
    {
      id: 'agent',
      label: t('settings.keybindings.group.agent'),
      rows: [
        { kind: 'fixed', id: 'agent.allow', label: t('settings.keybindings.agent.allow'), keys: 'Y' },
        { kind: 'fixed', id: 'agent.deny', label: t('settings.keybindings.agent.deny'), keys: 'N' },
        { kind: 'fixed', id: 'agent.session', label: t('settings.keybindings.agent.session'), keys: 'S' },
      ],
    },
  ])

  const dialectOpts = $derived.by((): SelectOption[] =>
    PROVIDER_DIALECTS.map((d) => ({
      value: d.value,
      label: t(d.labelKey),
      description: t(d.descriptionKey),
    })),
  )
  const permissionOpts = $derived.by((): SelectOption[] =>
    PERMISSION_MODES.map((p) => ({
      value: p.value,
      label: t(p.labelKey),
      description: t(p.descriptionKey),
    })),
  )

  const themeOpts = $derived.by((): SelectOption[] => [
    { value: 'dark', label: t('settings.appearance.theme.dark'), description: t('settings.appearance.theme.dark.desc') },
    { value: 'light', label: t('settings.appearance.theme.light'), description: t('settings.appearance.theme.light.desc') },
    { value: 'system', label: t('settings.appearance.theme.system'), description: t('settings.appearance.theme.system.desc') },
  ])

  const localeOpts = $derived.by((): SelectOption[] => [
    { value: 'en', label: t('settings.appearance.language.en'), description: t('settings.appearance.language.en.desc') },
    { value: 'id', label: t('settings.appearance.language.id'), description: t('settings.appearance.language.id.desc') },
  ])

  const fontFamilyOpts = $derived.by((): SelectOption[] =>
    FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label })),
  )

  async function hydrate(): Promise<void> {
    error = ''
    note = ''
    streamTokens = app.ui.streamTokens
    goldPulse = app.ui.goldPulse
    theme = app.ui.theme
    locale = app.ui.locale
    fontFamily = app.ui.fontFamily
    uiZoom = app.ui.uiZoom
    maxTurns = app.ui.maxTurns
    const cfg = app.provider ?? (await loadProviderConfig())
    if (!cfg) {
      error = t('settings.provider.loadFailed')
      return
    }
    baseUrl = cfg.baseUrl
    model = cfg.model
    models = normalizeModelList(cfg.models, cfg.model)
    modelDraft = ''
    dialect = cfg.dialect
    permissionMode = cfg.permissionMode
    denyGlobsText = (cfg.denyGlobs ?? []).join('\n')
    allowRulesText = (cfg.allowRules ?? []).join('\n')
    guardrailsEnabled = cfg.guardrails?.enabled !== false
    hasKey = cfg.hasKey
    envOverrides = { ...cfg.envOverrides }
    apiKey = ''

    if (cfg.vendors) {
      for (const [vK, vVal] of Object.entries(cfg.vendors)) {
        if (!vVal || !(vK in vendorsState)) continue
        const key = vK as VendorKey
        if (vVal.main) {
          vendorsState[key].main = {
            baseUrl: vVal.main.baseUrl ?? '',
            apiKey: '',
            model: vVal.main.model ?? '',
            models: normalizeModelList(vVal.main.models, vVal.main.model ?? ''),
            dialect: vVal.main.dialect ?? 'openai',
            hasKey: Boolean(vVal.main.hasKey),
            sonnetModel: vVal.main.sonnetModel ?? '',
            haikuModel: vVal.main.haikuModel ?? '',
            opusModel: vVal.main.opusModel ?? '',
            maxThinkingTokens: vVal.main.maxThinkingTokens ?? '',
            customModelEnv: vVal.main.customModelEnv ?? '',
            customCliFlags: vVal.main.customCliFlags ?? '',
          }
        }
        if (vVal.subagent) {
          vendorsState[key].subagent = {
            baseUrl: vVal.subagent.baseUrl ?? '',
            apiKey: '',
            model: vVal.subagent.model ?? '',
            models: normalizeModelList(vVal.subagent.models, vVal.subagent.model ?? ''),
            dialect: vVal.subagent.dialect ?? 'openai',
            hasKey: Boolean(vVal.subagent.hasKey),
            sonnetModel: vVal.subagent.sonnetModel ?? '',
            haikuModel: vVal.subagent.haikuModel ?? '',
            opusModel: vVal.subagent.opusModel ?? '',
            maxThinkingTokens: vVal.subagent.maxThinkingTokens ?? '',
            customModelEnv: vVal.subagent.customModelEnv ?? '',
            customCliFlags: vVal.subagent.customCliFlags ?? '',
          }
        }
      }
    }
    vendorsState.enpii.main.baseUrl = baseUrl
    vendorsState.enpii.main.model = model
    vendorsState.enpii.main.models = models
    vendorsState.enpii.main.dialect = dialect
    vendorsState.enpii.main.hasKey = hasKey
  }

  // Keep local drafts in sync with store when toggled in Settings
  $effect(() => {
    if (streamTokens !== app.ui.streamTokens) app.setStreamTokens(streamTokens)
  })
  $effect(() => {
    if (goldPulse !== app.ui.goldPulse) app.setGoldPulse(goldPulse)
  })
  $effect(() => {
    if (theme !== app.ui.theme) {
      const next = theme === 'light' || theme === 'system' || theme === 'dark' ? theme : 'dark'
      app.setTheme(next)
    }
  })
  $effect(() => {
    if (locale !== app.ui.locale) {
      app.setLocale(locale === 'id' ? 'id' : 'en')
    }
  })
  $effect(() => {
    if (fontFamily !== app.ui.fontFamily) {
      app.setFontFamily(fontFamily as FontFamilyId)
    }
  })
  $effect(() => {
    if (typeof uiZoom === 'number' && uiZoom !== app.ui.uiZoom) {
      app.setUiZoom(uiZoom)
    }
  })
  $effect(() => {
    if (typeof maxTurns === 'number' && maxTurns !== app.ui.maxTurns) {
      app.setMaxTurns(maxTurns)
    }
  })

  function normalizeModelList(list: string[] | undefined, active: string): string[] {
    const out: string[] = []
    for (const m of list ?? []) {
      const t = m.trim()
      if (t && !out.includes(t)) out.push(t)
    }
    const cur = active.trim()
    if (cur && !out.includes(cur)) out.unshift(cur)
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
    models = models.filter((m) => m !== id)
    if (model === id) model = models[0] ?? ''
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
    const label =
      keybindingGroups.flatMap((g) => g.rows).find((r) => r.kind === 'bind' && r.id === action)?.label ?? action
    app.notify('success', 'Shortcut updated', `${label}: ${binding}`)
  }

  async function save(): Promise<void> {
    saving = true
    error = ''
    note = ''
    try {
      const knownPermission = PERMISSION_MODES.find((p) => p.value === permissionMode)?.value
      const denyGlobs = denyGlobsText
        .split(/[\n,]+/)
        .map((g) => g.trim())
        .filter(Boolean)
      const allowRules = allowRulesText
        .split(/[\n,]+/)
        .map((g) => g.trim())
        .filter(Boolean)

      const guardrails = {
        enabled: guardrailsEnabled,
        applyToInput: false,
        applyToOutput: true,
        applyToToolResults: true,
      }
      let patch: {
        baseUrl: string
        model: string
        models: string[]
        dialect: ProviderDialect
        permissionMode: PermissionMode
        apiKey?: string
        denyGlobs: string[]
        allowRules: string[]
        guardrails: typeof guardrails
      }

      const knownDialect = PROVIDER_DIALECTS.find((d) => d.value === dialect)?.value
      const activeModel = model.trim()
      if (!baseUrl.trim()) throw new Error('Base URL is required')
      if (!activeModel) throw new Error('Add at least one model and set default')
      const modelList = normalizeModelList(models, activeModel)
      vendorsState.enpii.main.baseUrl = baseUrl.trim()
      vendorsState.enpii.main.model = activeModel
      vendorsState.enpii.main.models = modelList
      vendorsState.enpii.main.dialect = knownDialect ?? 'openai'
      if (apiKey.trim()) vendorsState.enpii.main.apiKey = apiKey.trim()

      vendorsState[activeVendor][activeTarget].sonnetModel = sonnetModel.trim()
      vendorsState[activeVendor][activeTarget].haikuModel = haikuModel.trim()
      vendorsState[activeVendor][activeTarget].opusModel = opusModel.trim()
      vendorsState[activeVendor][activeTarget].maxThinkingTokens = maxThinkingTokens.trim()
      vendorsState[activeVendor][activeTarget].customModelEnv = customModelEnv.trim()
      vendorsState[activeVendor][activeTarget].customCliFlags = customCliFlags.trim()

      const vendorsPayload: Record<string, any> = {}
      for (const [vK, vVal] of Object.entries(vendorsState)) {
        vendorsPayload[vK] = {
          main: {
            baseUrl: vVal.main.baseUrl.trim(),
            apiKey: vVal.main.apiKey.trim(),
            model: vVal.main.model.trim(),
            models: normalizeModelList(vVal.main.models, vVal.main.model),
            dialect: vVal.main.dialect as ProviderDialect,
            sonnetModel: vVal.main.sonnetModel?.trim(),
            haikuModel: vVal.main.haikuModel?.trim(),
            opusModel: vVal.main.opusModel?.trim(),
            maxThinkingTokens: vVal.main.maxThinkingTokens?.trim(),
            customModelEnv: vVal.main.customModelEnv?.trim(),
            customCliFlags: vVal.main.customCliFlags?.trim(),
          },
          subagent: {
            baseUrl: vVal.subagent.baseUrl.trim(),
            apiKey: vVal.subagent.apiKey.trim(),
            model: vVal.subagent.model.trim(),
            models: normalizeModelList(vVal.subagent.models, vVal.subagent.model),
            dialect: vVal.subagent.dialect as ProviderDialect,
            sonnetModel: vVal.subagent.sonnetModel?.trim(),
            haikuModel: vVal.subagent.haikuModel?.trim(),
            opusModel: vVal.subagent.opusModel?.trim(),
            maxThinkingTokens: vVal.subagent.maxThinkingTokens?.trim(),
            customModelEnv: vVal.subagent.customModelEnv?.trim(),
            customCliFlags: vVal.subagent.customCliFlags?.trim(),
          },
        }
      }

      patch = {
        baseUrl: baseUrl.trim(),
        model: activeModel,
        models: modelList,
        dialect: knownDialect ?? 'openai',
        permissionMode: knownPermission ?? 'ask',
        denyGlobs,
        allowRules,
        guardrails,
        vendors: vendorsPayload as any,
      }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()

      const cfg = await saveProviderConfig(patch)
      denyGlobsText = (cfg.denyGlobs ?? []).join('\n')
      allowRulesText = (cfg.allowRules ?? []).join('\n')
      guardrailsEnabled = cfg.guardrails?.enabled !== false
      baseUrl = cfg.baseUrl
      models = normalizeModelList(cfg.models, cfg.model)
      model = cfg.model
      dialect = cfg.dialect
      hasKey = cfg.hasKey
      envOverrides = { ...cfg.envOverrides }
      apiKey = ''
      note = t('settings.provider.saved')
      const envBits = [
        envOverrides.baseUrl ? 'baseUrl' : '',
        envOverrides.apiKey ? 'apiKey' : '',
        envOverrides.model ? 'model' : '',
        envOverrides.dialect ? 'dialect' : '',
      ].filter(Boolean)
      if (envBits.length) {
        note += ` · ${t('settings.provider.envStill', { bits: envBits.join(', ') })}`
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  const canSave = $derived(
    section !== 'provider'
      ? true
      : Boolean(baseUrl.trim() && model.trim() && models.length > 0),
  )
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
        <h2 id="settings-title" class="m-0 mb-1 text-base font-semibold text-studio-text">{t('settings.title')}</h2>
        <p class="m-0 text-[11px] text-studio-text-dim">EnStudio</p>
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
        <Button variant="ghost" size="sm" onclick={close} disabled={saving}>{t('settings.close')}</Button>
      </header>

      <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
        {#if section === 'provider'}
          <div class="flex flex-col gap-5">
            <!-- Main EnStudio Provider Settings -->
            <TextInput
              label={t('settings.provider.baseUrl')}
              bind:value={baseUrl}
              placeholder="https://api.openai.com/v1"
              autocomplete="off"
              disabled={saving}
              hint={envOverrides.baseUrl ? 'env ENPII_BASE_URL active' : 'OpenAI- atau Anthropic-compatible endpoint'}
            />
            <TextInput
              label={hasKey ? `${t('settings.provider.apiKey')} (${t('common.ok')})` : t('settings.provider.apiKey')}
              type="password"
              bind:value={apiKey}
              placeholder={hasKey ? t('settings.provider.apiKeySet') : 'sk-…'}
              autocomplete="off"
              disabled={saving}
              hint={envOverrides.apiKey ? 'env ENPII_API_KEY active' : ''}
            />
            <SmartSelect
              label={t('settings.provider.dialect')}
              bind:value={dialect}
              options={dialectOpts}
              disabled={saving}
              hint={envOverrides.dialect ? 'env ENPII_DIALECT active' : 'Wire format for the endpoint'}
            />
            <SmartSelect
              label="Main Agent Model"
              bind:value={model}
              options={models.map((m) => ({ value: m, label: m }))}
              disabled={saving || !models.length}
              placeholder={models.length ? 'Select…' : t('settings.provider.addModel')}
              hint={envOverrides.model ? 'env ENPII_MODEL active' : 'Model utama untuk eksekusi prompt EnStudio'}
            />
            <SmartSelect
              label="Sub-Agent Model"
              bind:value={vendorsState.enpii.subagent.model}
              options={[
                { value: '', label: 'Sama dengan Main Agent Model (Default)' },
                ...models.map((m) => ({ value: m, label: m }))
              ]}
              disabled={saving}
              hint="Model ringan/cepat untuk sub-task terisolasi di EnStudio"
            />
            <div class="flex flex-col gap-2">
              <div class="text-xs font-medium text-studio-text-dim">{t('settings.provider.models')}</div>
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
                        aria-label={t('common.remove')}
                        disabled={saving}
                        onclick={() => removeModel(m)}
                      >×</button>
                    {/if}
                  </span>
                {:else}
                  <span class="text-[11px] text-studio-text-dim">{t('settings.provider.addModel')}</span>
                {/each}
              </div>

              <div class="flex items-end gap-2">
                <TextInput
                  class="min-w-0 flex-1"
                  label={t('settings.provider.addModel')}
                  bind:value={modelDraft}
                  placeholder="gpt-4.1 / claude-opus-4"
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
                >{t('common.add')}</Button>
              </div>
            </div>

            <!-- Advanced Collapsible Section for External Vendor CLI Overrides -->
            <details open class="group rounded-xl border border-border-subtle bg-studio-dark/40 p-4 transition-all">
              <summary class="flex cursor-pointer items-center justify-between font-medium text-xs text-studio-text-dim hover:text-studio-text">
                <span class="flex items-center gap-2 font-semibold">
                  <span>?? Vendor CLI Harness Overrides (Claude, Codex, OpenCode, Gemini)</span>
                </span>
                <span class="text-[10px] uppercase text-studio-text-dim group-open:rotate-180 transition-transform">?</span>
              </summary>
              <div class="mt-4 flex flex-col gap-4 border-t border-border-subtle pt-4">
                <p class="m-0 text-xs text-studio-text-dim">
                  Secara default, PTY Terminal CLI vendor (Claude, Codex, Gemini) meng-inherit provider utama EnStudio. Gunakan opsi di bawah jika Anda ingin meng-override Base URL, API Key, Model, atau Flag khusus untuk CLI vendor tertentu.
                </p>
                <SmartSelect
                  label="Select Vendor CLI Engine"
                  bind:value={activeVendor}
                  options={[
                    { value: 'claude', label: 'Claude Code CLI (claude)', description: 'Terminal harness Anthropic' },
                    { value: 'codex', label: 'Codex CLI (codex)', description: 'Terminal harness OpenAI Codex' },
                    { value: 'opencode', label: 'OpenCode CLI (opencode)', description: 'Terminal harness OpenCode' },
                    { value: 'gemini', label: 'Gemini CLI (gemini)', description: 'Terminal harness Google Gemini' },
                  ]}
                  disabled={saving}
                  onchange={(val) => {
                    activeVendor = val as VendorKey
                    activeTarget = 'main'
                  }}
                />
                {#if activeVendor !== 'enpii'}
                  <TextInput
                    label={`${activeVendor.toUpperCase()} Base URL Override`}
                    bind:value={vendorsState[activeVendor].main.baseUrl}
                    placeholder="Biarkan kosong untuk memakai main Base URL"
                    disabled={saving}
                    hint="Base URL khusus untuk vendor CLI ini"
                  />
                  <TextInput
                    label={`${activeVendor.toUpperCase()} API Key Override`}
                    type="password"
                    bind:value={vendorsState[activeVendor].main.apiKey}
                    placeholder="Biarkan kosong untuk memakai main API Key"
                    disabled={saving}
                    hint="API Key khusus untuk vendor CLI ini"
                  />
                  <TextInput
                    label={`${activeVendor.toUpperCase()} Main Model Override`}
                    bind:value={vendorsState[activeVendor].main.model}
                    placeholder="Biarkan kosong untuk memakai main Model"
                    disabled={saving}
                    hint="Model utama untuk CLI ini (misal: claude-3-7-sonnet / gpt-5.4)"
                  />
                  <TextInput
                    label={`${activeVendor.toUpperCase()} Sub-Agent Model Override`}
                    bind:value={vendorsState[activeVendor].subagent.model}
                    placeholder="Biarkan kosong untuk memakai default"
                    disabled={saving}
                    hint="Model sub-agent ringan/cepat khusus untuk CLI ini (misal: claude-3-5-haiku / gpt-5.4-mini)"
                  />

                  {#if activeVendor === 'claude'}
                    <div class="flex flex-col gap-3 rounded-lg border border-border-subtle/60 bg-black/20 p-3">
                      <div class="text-xs font-semibold text-studio-purple">Claude Specific Model Overrides</div>
                      <TextInput
                        label="Default Sonnet Model (ANTHROPIC_DEFAULT_SONNET_MODEL)"
                        bind:value={vendorsState.claude.main.sonnetModel}
                        placeholder="claude-3-7-sonnet"
                        disabled={saving}
                      />
                      <TextInput
                        label="Default Haiku Model (ANTHROPIC_DEFAULT_HAIKU_MODEL)"
                        bind:value={vendorsState.claude.main.haikuModel}
                        placeholder="claude-3-5-haiku"
                        disabled={saving}
                      />
                      <TextInput
                        label="Default Opus Model (ANTHROPIC_DEFAULT_OPUS_MODEL)"
                        bind:value={vendorsState.claude.main.opusModel}
                        placeholder="claude-3-opus"
                        disabled={saving}
                      />
                      <TextInput
                        label="Extended Thinking Budget (MAX_THINKING_TOKENS)"
                        bind:value={vendorsState.claude.main.maxThinkingTokens}
                        placeholder="e.g. 4000"
                        disabled={saving}
                        hint="Batas token reasoning / thinking untuk model Claude"
                      />
                    </div>
                  {/if}

                  <div class="flex flex-col gap-3 rounded-lg border border-border-subtle/60 bg-black/20 p-3">
                    <div class="text-xs font-semibold text-studio-purple">Custom Model Environment Variables & Flags</div>
                    <Textarea
                      label="Custom Model Environment Variables (KEY=VALUE)"
                      bind:value={vendorsState[activeVendor].main.customModelEnv}
                      rows={3}
                      placeholder="TEMPERATURE=0.2&#10;OPENAI_ORGANIZATION=org-xxx"
                      disabled={saving}
                      hint="Environment variables model/API tambahan (satu pasangan KEY=VALUE per baris)"
                    />
                    <TextInput
                      label="Custom CLI Execution Flags"
                      bind:value={vendorsState[activeVendor].main.customCliFlags}
                      placeholder="e.g. --verbose --thinking-budget=4000"
                      disabled={saving}
                      hint="Flag argumen CLI tambahan yang diteruskan langsung ke executable CLI"
                    />
                  </div>
                {/if}
              </div>
            </details>
          </div>
        {:else if section === 'permissions'}
          <div class="flex flex-col gap-5">
            <SmartSelect
              label={t('settings.permissions.mode')}
              bind:value={permissionMode}
              options={permissionOpts}
              disabled={saving}
            />
            <Textarea
              label={t('settings.permissions.denyGlobs')}
              rows={4}
              bind:value={denyGlobsText}
              disabled={saving}
              placeholder={'.env.production\n**/private/**\n**/*token*'}
              spellcheck={false}
              hint={t('settings.permissions.denyGlobsHint')}
            />
            <Textarea
              label={t('settings.permissions.allowRules')}
              rows={7}
              bind:value={allowRulesText}
              disabled={saving}
              placeholder={'run_shell(npm *)\nrun_shell(git *)\nweb_fetch(domain:github.com)\nweb_search'}
              spellcheck={false}
              hint={t('settings.permissions.allowRulesHint')}
            />
            <Switch
              bind:checked={guardrailsEnabled}
              label={t('settings.permissions.guardrails')}
              description={t('settings.permissions.guardrailsDesc')}
            />
          </div>
        {:else if section === 'network'}
          <div class="flex flex-col gap-2.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-xs font-medium text-studio-text">{t('settings.network.ssh')}</div>
              <div class="flex flex-wrap gap-1.5">
                <Button variant="primary" size="sm" onclick={beginSshAdd}>+ {t('settings.network.sshAdd')}</Button>
                <Button variant="ghost" size="sm" onclick={openSshConfig}>ssh.json</Button>
                <Button variant="ghost" size="sm" onclick={() => void hydrateSsh()}>{t('common.retry')}</Button>
              </div>
            </div>

            {#if sshFormOpen}
              <div class="grid gap-2 rounded-lg border border-studio-purple/35 bg-studio-purple/10 p-3">
                <div class="text-xs font-medium text-studio-text">{sshEditing ? `${t('settings.network.sshEdit')} · ${sshEditing}` : t('settings.network.sshAdd')}</div>
                <div class="grid grid-cols-2 gap-2">
                  <TextInput label={t('settings.network.sshName')} bind:value={sshForm.name} placeholder="prod" disabled={sshBusy !== null} />
                  <TextInput label={t('settings.network.sshHost')} bind:value={sshForm.host} placeholder="203.0.113.10" disabled={sshBusy !== null} />
                  <TextInput label={t('settings.network.sshUser')} bind:value={sshForm.user} placeholder="ubuntu" disabled={sshBusy !== null} />
                  <NumberInput label={t('settings.network.sshPort')} bind:value={sshForm.port} min={1} max={65535} disabled={sshBusy !== null} />
                </div>
                <TextInput
                  label={t('settings.network.sshIdentity')}
                  bind:value={sshForm.identityFile}
                  placeholder="~/.ssh/id_ed25519"
                  disabled={sshBusy !== null}
                />
                {#if sshFormError}<p class="m-0 text-[11px] text-danger">{sshFormError}</p>{/if}
                <div class="flex flex-wrap gap-1.5">
                  <Button variant="primary" size="sm" loading={sshBusy !== null} onclick={() => void saveSshHost()}>{t('common.save')}</Button>
                  <Button variant="ghost" size="sm" disabled={sshBusy !== null} onclick={cancelSshForm}>{t('common.cancel')}</Button>
                </div>
              </div>
            {/if}

            {#if sshHosts.length === 0 && !sshFormOpen}
              <p class="text-[11px] text-studio-text-dim">{t('settings.network.mcpEmpty')}</p>
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
                      <Button variant="ghost" size="sm" disabled={sshBusy !== null} onclick={() => beginSshEdit(h)}>{t('settings.network.sshEdit')}</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={sshBusy !== null}
                        onclick={() => {
                          app.setMode('terminal')
                          close()
                          queueMicrotask(() => {
                            window.dispatchEvent(
                              new CustomEvent('enpiistudio:terminal-ssh', { detail: { name: h.name } }),
                            )
                          })
                        }}
                      >{t('common.open')}</Button
                      >
                      <Button variant="danger" size="sm" disabled={sshBusy !== null} onclick={() => requestRemoveSshHost(h.name)}
                        >{t('settings.network.sshDelete')}</Button
                      >
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="text-xs font-medium text-studio-text">{t('settings.network.sshHint')}</div>
            {#if sshTunnels.length === 0}
              <p class="text-[11px] text-studio-text-dim">{t('settings.network.mcpEmpty')}</p>
            {:else}
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                {#each sshTunnels as tunnel (tunnel.name)}
                  <li class="flex flex-row items-center justify-between gap-3 rounded-lg border border-border-subtle p-4">
                    <div class="min-w-0">
                      <strong class="text-sm text-studio-text">{tunnel.name}</strong>
                      <code class="block font-mono text-[11px] text-studio-text-dim">localhost:{tunnel.localPort} → {tunnel.host} → {tunnel.remoteHost}:{tunnel.remotePort}</code>
                      {#if tunnel.running}<span class="ml-1.5 text-[10px] text-studio-success-shell">pid {tunnel.pid ?? '?'}</span>{/if}
                    </div>
                    <Button
                      variant={tunnel.running ? 'ghost' : 'primary'}
                      size="sm"
                      loading={sshBusy === tunnel.name}
                      disabled={sshBusy !== null && sshBusy !== tunnel.name}
                      onclick={() => void onTunnelToggle(tunnel)}
                    >
                      {tunnel.running ? t('settings.network.sshStop') : t('settings.network.sshStart')}
                    </Button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-xs font-medium text-studio-text">{t('settings.network.mcp')}</div>
              <Button variant="ghost" size="sm" onclick={() => void hydrateMcp()}>{t('common.retry')}</Button>
            </div>
            {#if mcpServers.length === 0}
              <p class="text-[11px] text-studio-text-dim">{t('settings.network.mcpEmpty')}</p>
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
          <div class="flex flex-col gap-5">
            <SmartSelect
              label={t('settings.appearance.language')}
              bind:value={locale}
              options={localeOpts}
            />
            <SmartSelect
              label={t('settings.appearance.theme')}
              bind:value={theme}
              options={themeOpts}
            />
            <SmartSelect
              label={t('settings.appearance.fontFamily')}
              bind:value={fontFamily}
              options={fontFamilyOpts}
              hint={t('settings.appearance.fontFamily.desc')}
            />
            <NumberInput
              label={t('settings.appearance.uiZoom')}
              bind:value={uiZoom}
              min={UI_ZOOM_MIN}
              max={UI_ZOOM_MAX}
              step={UI_ZOOM_STEP}
              hint={t('settings.appearance.uiZoom.desc')}
            />
            <Switch
              bind:checked={goldPulse}
              label={t('settings.appearance.goldPulse')}
              description={t('settings.appearance.goldPulse.desc')}
            />
          </div>
        {:else if section === 'updates'}
          <div class="flex flex-col gap-5">
            <div class="flex flex-col gap-1">
              <div class="text-xs font-medium text-studio-text-dim">{t('settings.updates.currentVersion')}</div>
              <div class="font-mono text-[14px] text-studio-text">
                v{app.appVersion || '—'}
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={app.updateStatus === 'checking' || app.updateStatus === 'downloading'}
                loading={app.updateStatus === 'checking'}
                onclick={() => void app.checkForUpdate()}
              >{t('settings.updates.check')}</Button>
              {#if app.updateStatus === 'available'}
                <Button variant="primary" size="sm" onclick={() => void app.downloadUpdate()}>
                  {t('settings.updates.download')} v{app.updateInfo?.version ?? ''}
                </Button>
              {/if}
              {#if app.updateStatus === 'downloaded'}
                <Button variant="primary" size="sm" onclick={() => app.installUpdate()}>
                  {t('settings.updates.install')}
                </Button>
              {/if}
            </div>

            <div class="flex flex-col gap-1 text-[12px] text-studio-text-dim">
              {#if app.updateStatus === 'available'}
                <span class="text-studio-gold">{t('settings.updates.available', { version: app.updateInfo?.version ?? '' })}</span>
              {:else if app.updateStatus === 'downloading'}
                <span>{t('updateBanner.progress', { percent: Math.round(app.updateProgress?.percent ?? 0) })}</span>
              {:else if app.updateStatus === 'downloaded'}
                <span class="text-studio-success-shell">{t('updateBanner.downloaded')}</span>
              {:else if app.updateStatus === 'error'}
                <span class="text-danger">{t('settings.updates.error', { message: app.updateError ?? '' })}</span>
              {:else if app.updateLastChecked}
                <span>{t('settings.updates.upToDate')}</span>
              {/if}
              {#if app.updateLastChecked}
                <span class="text-[10px] text-studio-text-dim/70">
                  {t('settings.updates.lastChecked', { time: new Date(app.updateLastChecked).toLocaleString() })}
                </span>
              {/if}
            </div>

            {#if app.updateInfo?.releaseNotes}
              <details class="rounded-lg border border-border-subtle p-3">
                <summary class="cursor-pointer text-[12px] font-medium text-studio-text-dim">Release notes</summary>
                <p class="mt-2 m-0 whitespace-pre-wrap text-[12px] leading-relaxed text-studio-text">
                  {app.updateInfo.releaseNotes}
                </p>
              </details>
            {/if}
          </div>
        {:else}
          <div class="flex flex-col gap-5">
            {#each keybindingGroups as group (group.id)}
              <section class="flex flex-col gap-1.5" aria-label={group.label}>
                <h3 class="m-0 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-studio-text-dim">{group.label}</h3>
                {#each group.rows as item (item.id)}
                  <div class="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3.5">
                    <div class="min-w-0">
                      <span class="text-sm text-studio-text">{item.label}</span>
                      {#if item.kind === 'fixed'}
                        <span class="ml-2 text-[10px] text-studio-text-dim">{t('settings.keybindings.fixed')}</span>
                      {/if}
                    </div>
                    {#if item.kind === 'bind'}
                      <button
                        type="button"
                        class="shrink-0 rounded-lg border px-3 py-1 font-mono text-[11px] {recording === item.id
                          ? 'border-studio-gold/50 bg-studio-gold/10 text-studio-gold'
                          : 'border-border-subtle text-studio-text-dim hover:bg-white/5 hover:text-studio-text'}"
                        onclick={() => (recording = item.id)}
                        onkeydown={(event) => recordKeybinding(event, item.id)}
                      >{recording === item.id ? t('settings.keybindings.press') : app.keybindings[item.id]}</button>
                    {:else}
                      <span class="shrink-0 rounded-lg border border-border-subtle/70 px-3 py-1 font-mono text-[11px] text-studio-text-dim">{item.keys}</span>
                    {/if}
                  </div>
                {/each}
              </section>
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
        {#if section === 'keybindings' || section === 'network' || section === 'appearance' || section === 'updates'}
          {#if section === 'keybindings'}
            <Button variant="ghost" onclick={() => app.resetKeybindings()}>{t('settings.resetDefaults')}</Button>
          {/if}
          <Button variant="primary" onclick={close}>{t('settings.done')}</Button>
        {:else}
          <Button variant="ghost" onclick={close} disabled={saving}>{t('settings.cancel')}</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!canSave}
            onclick={() => void save()}
          >
            {t('settings.save')}
          </Button>
        {/if}
      </footer>
    </div>
  </div>
</div>

<ConfirmDialog
  open={sshDeleteTarget != null}
  title={t('settings.network.sshDelete')}
  message={t('settings.network.sshDeleteConfirm', { name: sshDeleteTarget ?? '' })}
  cancelLabel={t('common.cancel')}
  confirmLabel={t('common.delete')}
  danger
  onCancel={() => (sshDeleteTarget = null)}
  onConfirm={() => void confirmRemoveSshHost()}
/>
