<script lang="ts">
  import { untrack } from 'svelte'
  import { state as app } from '../store.svelte'
  import {
    applyGitStash,
    createGitRelease,
    createGitStash,
    createGitTag,
    deleteGitTag,
    dropGitStash,
    getGitRemotes,
    getGitStashes,
    getGitStatus,
    getGitTags,
    type GitRemote,
    type GitStash,
    type GitStatus,
    type GitTag,
  } from '../enpii'
  import { ConfirmDialog, Switch } from './ui'

  let status = $state<GitStatus | null>(null)
  let remotes = $state<GitRemote[]>([])
  let stashes = $state<GitStash[]>([])
  let tags = $state<GitTag[]>([])
  let busy = $state(false)
  let loading = $state(false)
  let error = $state('')
  let stashMessage = $state('')
  let stashIncludeUntracked = $state(true)
  let dropStashTarget = $state<GitStash | null>(null)
  let deleteTagTarget = $state<GitTag | null>(null)
  let tagName = $state('')
  let tagMessage = $state('')
  let tagTarget = $state('HEAD')
  let releaseName = $state('')
  let releaseNotes = $state('')
  let releaseGithub = $state(true)
  let releaseInfo = $state('')
  let projectId: string | null = null

  async function refresh(): Promise<void> {
    const project = app.activeProject
    if (!project) return
    loading = true
    error = ''
    try {
      status = await getGitStatus(project.path)
      remotes = await getGitRemotes(project.path)
      stashes = await getGitStashes(project.path)
      tags = await getGitTags(project.path)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function createStash(): Promise<void> {
    const project = app.activeProject
    if (!project) return
    busy = true
    error = ''
    try {
      const result = await createGitStash(project.path, stashMessage, stashIncludeUntracked)
      stashes = result.stashes
      status = result.status
      stashMessage = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function applyStash(stash: GitStash, pop: boolean): Promise<void> {
    const project = app.activeProject
    if (!project) return
    busy = true
    error = ''
    try {
      const result = await applyGitStash(project.path, stash.ref, pop)
      stashes = result.stashes
      status = result.status
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function confirmStashDrop(): Promise<void> {
    const stash = dropStashTarget
    const project = app.activeProject
    dropStashTarget = null
    if (!stash || !project) return
    busy = true
    error = ''
    try {
      stashes = await dropGitStash(project.path, stash.ref)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function createTag(): Promise<void> {
    const project = app.activeProject
    if (!project || !tagName.trim()) return
    busy = true
    error = ''
    try {
      tags = await createGitTag(project.path, tagName, tagMessage, tagTarget)
      tagName = ''
      tagMessage = ''
      tagTarget = 'HEAD'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function confirmTagDelete(): Promise<void> {
    const tag = deleteTagTarget
    const project = app.activeProject
    deleteTagTarget = null
    if (!tag || !project) return
    busy = true
    error = ''
    try {
      tags = await deleteGitTag(project.path, tag.name)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function createRelease(): Promise<void> {
    const project = app.activeProject
    if (!project || !releaseName.trim()) return
    busy = true
    error = ''
    releaseInfo = ''
    try {
      const result = await createGitRelease(
        project.path,
        releaseName.trim(),
        releaseNotes.trim() || undefined,
        'HEAD',
        remotes[0]?.name,
        releaseGithub,
      )
      tags = result.tags
      status = result.status
      releaseInfo = result.githubUrl
        ? `Released ${result.tag} → ${result.githubUrl}`
        : result.githubSkipped
          ? `Pushed ${result.tag} to ${result.remote} (GitHub: ${result.githubSkipped})`
          : `Pushed ${result.tag} to ${result.remote}`
      releaseName = ''
      releaseNotes = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  $effect(() => {
    const id = app.activeProjectId
    const mode = app.mode
    if (!id || mode !== 'git') return
    if (projectId !== id) {
      projectId = id
      status = null
      remotes = []
      stashes = []
      tags = []
      releaseInfo = ''
      error = ''
    }
    untrack(() => void refresh())
  })

  const inputCls =
    'w-full rounded-sm border border-border-subtle bg-studio-dark px-2.5 py-1.5 text-xs text-studio-text outline-none placeholder:text-studio-text-dim focus:border-studio-purple/70'
  const btnCls =
    'rounded-lg border border-border-subtle px-2.5 py-1 text-[11px] text-studio-text-dim hover:bg-white/5 hover:text-studio-text disabled:opacity-45'
  const dangerBtn =
    'rounded-lg px-2 py-0.5 text-[11px] text-danger hover:bg-danger-bg disabled:opacity-45'
</script>

<div class="flex flex-col gap-4">
  {#if error}
    <div class="rounded-md border border-danger/30 bg-danger-bg/30 px-2.5 py-1.5 text-[11px] text-danger">
      {error}
    </div>
  {/if}

  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Remote</span>
      <button type="button" class={btnCls} disabled={loading || busy} onclick={() => void refresh()}>
        {loading ? '…' : 'Refresh'}
      </button>
    </div>
    <div class="rounded-lg border border-border-subtle bg-studio-card p-4">
      <div class="flex items-center justify-between gap-2 py-1 text-xs">
        <span class="text-studio-text-dim">Remote</span>
        <strong class="truncate text-studio-text">{remotes[0]?.name ?? '—'}</strong>
      </div>
      <div class="flex items-center justify-between gap-2 py-1 text-xs">
        <span class="text-studio-text-dim">Branch</span>
        <strong class="truncate text-studio-text">{status?.branch ?? '—'}</strong>
      </div>
      <div class="flex items-center justify-between gap-2 py-1 text-xs">
        <span class="text-studio-text-dim">Upstream</span>
        <strong class="truncate text-studio-text">{status?.upstream ?? 'none'}</strong>
      </div>
      <div class="flex items-center justify-between gap-2 py-1 text-xs">
        <span class="text-studio-text-dim">Sync</span>
        <strong class="text-studio-text">
          {#if status?.ahead || status?.behind}↑{status?.ahead ?? 0} ↓{status?.behind ?? 0}{:else}up to date{/if}
        </strong>
      </div>
    </div>
  </section>

  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Stashes</span>
      <span class="text-[10px] text-studio-text-dim">{stashes.length}</span>
    </div>
    <div class="flex flex-col gap-1.5">
      <input
        class={inputCls}
        bind:value={stashMessage}
        placeholder="Stash message"
        aria-label="Stash message"
        onkeydown={(e) => e.key === 'Enter' && void createStash()}
      />
      <Switch compact bind:checked={stashIncludeUntracked} description="Untracked" />
      <button
        type="button"
        class={btnCls}
        disabled={busy || (status?.files.length ?? 0) === 0}
        onclick={() => void createStash()}>Stash</button
      >
    </div>
    {#each stashes as stash (stash.ref)}
      <div class="flex items-start gap-1 rounded-md border border-border-subtle bg-studio-card p-2">
        <div class="min-w-0 flex-1">
          <strong class="block truncate text-xs text-studio-text">{stash.message}</strong>
          <span class="text-[10px] text-studio-text-dim"
            >{stash.ref}{#if stash.branch} · {stash.branch}{/if}</span
          >
        </div>
        <button type="button" class={btnCls} disabled={busy} onclick={() => void applyStash(stash, false)}
          >Apply</button
        >
        <button type="button" class={btnCls} disabled={busy} onclick={() => void applyStash(stash, true)}
          >Pop</button
        >
        <button
          type="button"
          class={dangerBtn}
          disabled={busy}
          aria-label={`Drop ${stash.ref}`}
          onclick={() => (dropStashTarget = stash)}>×</button
        >
      </div>
    {/each}
  </section>

  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Release</span>
    </div>
    <div class="flex flex-col gap-1.5">
      <input
        class={inputCls}
        bind:value={releaseName}
        placeholder="v1.0.0"
        aria-label="Release version"
        onkeydown={(e) => e.key === 'Enter' && void createRelease()}
      />
      <textarea
        class="{inputCls} min-h-[72px] resize-y"
        rows="3"
        bind:value={releaseNotes}
        placeholder="Release notes (optional)"
        aria-label="Release notes"
      ></textarea>
      <Switch compact bind:checked={releaseGithub} description="GitHub release" />
      <button
        type="button"
        class="rounded-lg bg-studio-purple px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-45"
        disabled={busy || !releaseName.trim() || remotes.length === 0}
        onclick={() => void createRelease()}>Create release</button
      >
      {#if releaseInfo}
        <div class="text-[11px] text-studio-text-dim">{releaseInfo}</div>
      {/if}
    </div>
  </section>

  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-bold uppercase tracking-widest text-studio-text-dim">Tags</span>
      <span class="text-[10px] text-studio-text-dim">{tags.length}</span>
    </div>
    <div class="flex flex-col gap-1.5">
      <input
        class={inputCls}
        bind:value={tagName}
        placeholder="v1.0.0"
        aria-label="Tag name"
        onkeydown={(e) => e.key === 'Enter' && void createTag()}
      />
      <input class={inputCls} bind:value={tagMessage} placeholder="Optional message" aria-label="Tag message" />
      <input class={inputCls} bind:value={tagTarget} placeholder="HEAD" aria-label="Tag target" />
      <button type="button" class={btnCls} disabled={busy || !tagName.trim()} onclick={() => void createTag()}
        >Create</button
      >
    </div>
    {#each tags as tag (tag.name)}
      <div class="flex items-start gap-1 rounded-md border border-border-subtle bg-studio-card p-2">
        <div class="min-w-0 flex-1">
          <strong class="block truncate text-xs text-studio-text">{tag.name}</strong>
          <span class="text-[10px] text-studio-text-dim"
            >{tag.shortHash} · {tag.subject || 'lightweight tag'}</span
          >
        </div>
        <button type="button" class={dangerBtn} disabled={busy} onclick={() => (deleteTagTarget = tag)}
          >×</button
        >
      </div>
    {/each}
  </section>
</div>

<ConfirmDialog
  open={dropStashTarget != null}
  title="Drop stash?"
  message={dropStashTarget ? `${dropStashTarget.ref} akan dihapus permanen.` : ''}
  cancelLabel="Batal"
  confirmLabel="Drop"
  danger
  onCancel={() => (dropStashTarget = null)}
  onConfirm={() => void confirmStashDrop()}
/>

<ConfirmDialog
  open={deleteTagTarget != null}
  title="Delete tag?"
  message={deleteTagTarget ? `Delete tag ${deleteTagTarget.name}?` : ''}
  cancelLabel="Batal"
  confirmLabel="Delete"
  danger
  onCancel={() => (deleteTagTarget = null)}
  onConfirm={() => void confirmTagDelete()}
/>
