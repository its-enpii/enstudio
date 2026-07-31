<script lang="ts">
  import { tick } from 'svelte'
  import {
    browserPanel,
    requestEditWithAi,
    requestPickMode,
  } from '../browser-panel.svelte'
  import { state as app } from '../store.svelte'
  import { saveProviderConfig } from '../enpii'
  import { Button, SmartSelect, Textarea } from './ui'

  const INTENT_ID = 'browser-edit-intent'

  let instruction = $state('')
  let modelBusy = $state(false)
  let lastFocusPath = $state('')

  const canEdit = $derived(browserPanel.origin === 'project')
  const selected = $derived(browserPanel.selectedNode)
  const job = $derived(browserPanel.editJob)
  const running = $derived(job.status === 'running')

  const modelOptions = $derived.by(() => {
    const list =
      app.provider?.models?.length
        ? app.provider.models
        : app.provider?.model
          ? [app.provider.model]
          : ['enpii']
    return list.map((m) => ({ value: m, label: m }))
  })

  const activeModel = $derived(app.provider?.model ?? modelOptions[0]?.value ?? 'enpii')

  function togglePick(): void {
    if (!canEdit || running) return
    requestPickMode(!browserPanel.pickMode)
  }

  async function changeModel(value: string): Promise<void> {
    if (!value || value === app.provider?.model || modelBusy) return
    modelBusy = true
    try {
      await saveProviderConfig({ model: value })
    } catch (err) {
      app.notify('error', 'Model', err instanceof Error ? err.message : String(err))
    } finally {
      modelBusy = false
    }
  }

  function submit(): void {
    if (!canEdit || !instruction.trim() || !selected || running) return
    requestEditWithAi(selected, instruction.trim())
    instruction = ''
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  $effect(() => {
    const path = selected?.path ?? ''
    if (!path || path === lastFocusPath || running) return
    lastFocusPath = path
    void tick().then(() => {
      const el = document.getElementById(INTENT_ID) as HTMLTextAreaElement | null
      el?.focus()
      el?.select()
    })
  })
</script>

<aside class="flex h-full min-h-0 w-full flex-col bg-studio-sidebar text-studio-text">
  <div class="flex flex-col gap-2 p-3">
    {#if !canEdit}
      <p class="text-[12px] text-studio-text-dim">
        {browserPanel.origin === 'public' ? 'Public site — pick off.' : 'Open a local project page first.'}
      </p>
    {:else}
      <SmartSelect
        value={activeModel}
        options={modelOptions}
        ariaLabel="Model"
        placeholder="Model"
        disabled={modelBusy || running || !modelOptions.length}
        class="w-full [&>button]:w-full [&>button]:justify-between"
        onChange={(v) => void changeModel(v)}
      />

      <Textarea
        id={INTENT_ID}
        bind:value={instruction}
        placeholder="What should change?"
        rows={5}
        disabled={running}
        class="w-full [&_textarea]:min-h-[7rem]"
        onkeydown={onKey}
      />

      <Button
        variant={browserPanel.pickMode ? 'primary' : 'secondary'}
        size="sm"
        class="w-full"
        disabled={running}
        onclick={togglePick}
      >{browserPanel.pickMode ? 'Picking…' : 'Pick'}</Button>

      {#if running}
        <div
          class="flex items-center justify-center gap-2 rounded-md border border-studio-gold/35 bg-studio-gold/15 px-3 py-2 text-[12px] font-semibold text-studio-gold"
          aria-live="polite"
        >
          <span
            class="size-3 shrink-0 rounded-full border-2 border-studio-gold border-r-transparent animate-spin"
            aria-hidden="true"
          ></span>
          {job.detail || 'Working…'}
        </div>
      {:else}
        <Button
          variant="primary"
          size="sm"
          class="w-full !bg-studio-gold !text-studio-dark hover:!brightness-105"
          disabled={!selected || !instruction.trim()}
          onclick={submit}
        >Apply</Button>
      {/if}

      {#if job.status === 'done'}
        <div class="rounded-md border border-studio-success/35 bg-studio-success/10 px-2.5 py-2 text-[11px] text-studio-success">
          {job.detail || 'Done'}
        </div>
      {:else if job.status === 'error'}
        <div class="rounded-md border border-danger/35 bg-danger-bg px-2.5 py-2 text-[11px] text-danger">
          {job.detail || 'Failed'}
        </div>
      {/if}
    {/if}
  </div>
</aside>
