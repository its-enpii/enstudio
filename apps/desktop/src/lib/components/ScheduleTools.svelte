<script lang="ts">
  import { state as app } from '../store.svelte'
  import {
    createCronJob,
    deleteCronJob,
    listCronJobs,
    toggleCronJob,
    type CronJobRow,
  } from '../enpii'
  import { t } from '../i18n/index.svelte'
  import { Button, Modal, SmartSelect, TextInput, Textarea, type SelectOption } from './ui'

  type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6
  type Freq = 'daily' | 'weekdays' | 'hourly' | 'custom'

  const DAY_KEYS: { d: Day; key: string }[] = [
    { d: 1, key: 'settings.schedule.day.mon' },
    { d: 2, key: 'settings.schedule.day.tue' },
    { d: 3, key: 'settings.schedule.day.wed' },
    { d: 4, key: 'settings.schedule.day.thu' },
    { d: 5, key: 'settings.schedule.day.fri' },
    { d: 6, key: 'settings.schedule.day.sat' },
    { d: 0, key: 'settings.schedule.day.sun' },
  ]

  const HOUR_OPTS: SelectOption[] = Array.from({ length: 24 }, (_, i) => ({
    value: String(i),
    label: String(i).padStart(2, '0'),
  }))
  const MINUTE_OPTS: SelectOption[] = Array.from({ length: 12 }, (_, i) => ({
    value: String(i * 5),
    label: String(i * 5).padStart(2, '0'),
  }))

  let jobs = $state<CronJobRow[]>([])
  let busy = $state(false)
  let formOpen = $state(false)
  let error = $state('')
  let name = $state('')
  let prompt = $state('')
  let hourStr = $state('9')
  let minuteStr = $state('0')
  let freq = $state<Freq>('weekdays')
  let days = $state<Day[]>([1, 2, 3, 4, 5])

  const freqOpts = $derived.by((): SelectOption[] => [
    { value: 'weekdays', label: t('settings.schedule.freq.weekdays') },
    { value: 'daily', label: t('settings.schedule.freq.daily') },
    { value: 'hourly', label: t('settings.schedule.freq.hourly') },
    { value: 'custom', label: t('settings.schedule.freq.custom') },
  ])

  function buildCron(): string {
    const h = Math.min(23, Math.max(0, Number(hourStr) || 0))
    const m = Math.min(59, Math.max(0, Number(minuteStr) || 0))
    if (freq === 'hourly') return `${m} * * * *`
    if (freq === 'daily') return `${m} ${h} * * *`
    if (freq === 'weekdays') return `${m} ${h} * * 1-5`
    const set = [...new Set(days)].sort((a, b) => a - b)
    if (!set.length) return `${m} ${h} * * 1-5`
    if (set.length === 7) return `${m} ${h} * * *`
    return `${m} ${h} * * ${set.join(',')}`
  }

  function describeCron(expr: string): string {
    const parts = expr.trim().split(/\s+/)
    if (parts.length < 5) return expr
    const [mi, ho, , , dow] = parts
    if (ho === '*' && mi !== '*') return t('settings.schedule.desc.hourly', { m: mi.padStart(2, '0') })
    const time = ho !== '*' && mi !== '*' ? `${ho.padStart(2, '0')}:${mi.padStart(2, '0')}` : expr
    if (dow === '*') return t('settings.schedule.desc.daily', { time })
    if (dow === '1-5') return t('settings.schedule.desc.weekdays', { time })
    return expr
  }

  function openForm(): void {
    error = ''
    name = ''
    prompt = ''
    hourStr = '9'
    minuteStr = '0'
    freq = 'weekdays'
    days = [1, 2, 3, 4, 5]
    formOpen = true
  }

  function closeForm(): void {
    if (busy) return
    formOpen = false
    error = ''
  }

  function onFreqChange(value: string): void {
    freq = value as Freq
    if (freq === 'weekdays') days = [1, 2, 3, 4, 5]
    if (freq === 'daily') days = [0, 1, 2, 3, 4, 5, 6]
  }

  function toggleDay(d: Day): void {
    if (days.includes(d)) days = days.filter((x) => x !== d)
    else days = [...days, d]
    freq = 'custom'
  }

  async function refresh(): Promise<void> {
    if (!app.activeProject) {
      jobs = []
      return
    }
    try {
      jobs = await listCronJobs()
      error = ''
    } catch (err) {
      jobs = []
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function save(): Promise<void> {
    error = ''
    if (!app.activeProject) {
      error = t('settings.schedule.needProject')
      return
    }
    const n = name.trim()
    const p = prompt.trim()
    if (!n || !p) {
      error = t('settings.schedule.needFields')
      return
    }
    if (freq === 'custom' && days.length === 0) {
      error = t('settings.schedule.needDay')
      return
    }
    busy = true
    try {
      await createCronJob({ name: n, schedule: buildCron(), prompt: p, enabled: true })
      formOpen = false
      await refresh()
      app.notify('success', t('settings.schedule.saved'), n)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function onToggle(job: CronJobRow): Promise<void> {
    busy = true
    try {
      await toggleCronJob(job.id, !job.enabled)
      await refresh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function onDelete(job: CronJobRow): Promise<void> {
    busy = true
    try {
      await deleteCronJob(job.id)
      await refresh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  $effect(() => {
    void app.activeProjectId
    void app.mode
    if (app.mode === 'agent' && app.activeProject) void refresh()
    else jobs = []
  })
</script>

<section class="flex shrink-0 flex-col gap-2.5" aria-label={t('settings.nav.schedule')}>
  <div class="flex items-center justify-between gap-2">
    <h3 class="studio-label m-0">{t('settings.nav.schedule')}</h3>
    {#if app.activeProject}
      <Button variant="secondary" size="sm" disabled={busy} onclick={openForm}>
        {t('settings.schedule.add')}
      </Button>
    {/if}
  </div>

  {#if !app.activeProject}
    <p class="m-0 text-[11px] text-studio-text-dim">{t('settings.schedule.needProject')}</p>
  {:else if jobs.length === 0}
    <p class="m-0 text-[11px] text-studio-text-dim">{t('settings.schedule.empty')}</p>
  {:else}
    <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
      {#each jobs as job (job.id)}
        <li class="flex flex-col gap-1 rounded-lg border border-border-subtle p-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <strong class="block truncate text-[12px] text-studio-text">{job.name}</strong>
              <span class="text-[10px] text-studio-lavender">{describeCron(job.schedule)}</span>
            </div>
            <div class="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" disabled={busy} onclick={() => void onToggle(job)}>
                {job.enabled ? t('settings.schedule.disable') : t('settings.schedule.enable')}
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onclick={() => void onDelete(job)}>
                {t('settings.schedule.delete')}
              </Button>
            </div>
          </div>
          <p class="m-0 line-clamp-2 text-[10px] text-studio-text-dim">{job.prompt}</p>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error && !formOpen}<p class="m-0 text-[11px] text-studio-error">{error}</p>{/if}
</section>

<Modal open={formOpen} title={t('settings.schedule.add')} size="md" onClose={closeForm}>
  <div class="grid gap-4">
    <p class="m-0 rounded-lg border border-border-subtle bg-black/25 px-3 py-2.5 text-[12px] leading-relaxed text-studio-text-dim">
      {t('settings.schedule.hint')}
    </p>
    <TextInput label={t('settings.schedule.name')} bind:value={name} disabled={busy} />

    <SmartSelect
      label={t('settings.schedule.when')}
      bind:value={freq}
      options={freqOpts}
      disabled={busy}
      onChange={onFreqChange}
    />

    {#if freq === 'hourly'}
      <SmartSelect
        label={t('settings.schedule.atMinute')}
        bind:value={minuteStr}
        options={MINUTE_OPTS}
        disabled={busy}
      />
    {:else}
      <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <SmartSelect
          label={t('settings.schedule.hour')}
          bind:value={hourStr}
          options={HOUR_OPTS}
          disabled={busy}
        />
        <span class="pb-2.5 text-studio-text-dim">:</span>
        <SmartSelect
          label={t('settings.schedule.minute')}
          bind:value={minuteStr}
          options={MINUTE_OPTS}
          disabled={busy}
        />
      </div>
    {/if}

    {#if freq === 'custom'}
      <div class="grid grid-cols-7 gap-1.5">
        {#each DAY_KEYS as day (day.d)}
          <button
            type="button"
            class="rounded-md py-2 text-center text-[11px] font-medium {days.includes(day.d)
              ? 'bg-studio-purple text-white'
              : 'bg-black/25 text-studio-text-dim hover:text-studio-text'}"
            disabled={busy}
            onclick={() => toggleDay(day.d)}
          >{t(day.key)}</button>
        {/each}
      </div>
    {/if}

    <Textarea
      label={t('settings.schedule.prompt')}
      rows={4}
      bind:value={prompt}
      disabled={busy}
      placeholder={t('settings.schedule.promptPh')}
    />
    {#if error}<p class="m-0 text-[12px] text-studio-error">{error}</p>{/if}
  </div>

  {#snippet footer()}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={busy} onclick={closeForm}>{t('common.cancel')}</Button>
      <Button variant="primary" size="sm" loading={busy} onclick={() => void save()}>{t('common.save')}</Button>
    </div>
  {/snippet}
</Modal>
