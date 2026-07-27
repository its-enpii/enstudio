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
</script>

<div class="git-tools">
  {#if error}<div class="git-error">{error}</div>{/if}

  <section class="git-group">
    <div class="git-group-head">
      <span>Remote</span>
      <button type="button" class="git-mini" disabled={loading || busy} onclick={() => void refresh()}>
        {loading ? '…' : 'Refresh'}
      </button>
    </div>
    <div class="git-remote-card">
      <div class="git-remote-line"><span class="muted">Remote</span><strong>{remotes[0]?.name ?? '—'}</strong></div>
      <div class="git-remote-line"><span class="muted">Branch</span><strong>{status?.branch ?? '—'}</strong></div>
      <div class="git-remote-line"><span class="muted">Upstream</span><strong>{status?.upstream ?? 'none'}</strong></div>
      <div class="git-remote-line">
        <span class="muted">Sync</span>
        <strong>
          {#if status?.ahead || status?.behind}↑{status?.ahead ?? 0} ↓{status?.behind ?? 0}{:else}up to date{/if}
        </strong>
      </div>
    </div>
  </section>

  <section class="git-group git-stashes">
    <div class="git-group-head"><span>Stashes</span><span>{stashes.length}</span></div>
    <div class="git-stash-create">
      <input
        bind:value={stashMessage}
        placeholder="Stash message"
        aria-label="Stash message"
        onkeydown={(e) => e.key === 'Enter' && void createStash()}
      />
      <Switch compact bind:checked={stashIncludeUntracked} description="Untracked" />
      <button type="button" disabled={busy || (status?.files.length ?? 0) === 0} onclick={() => void createStash()}>Stash</button>
    </div>
    {#each stashes as stash (stash.ref)}
      <div class="git-stash-row">
        <div>
          <strong>{stash.message}</strong>
          <span>{stash.ref}{#if stash.branch} · {stash.branch}{/if}</span>
        </div>
        <button type="button" disabled={busy} onclick={() => void applyStash(stash, false)}>Apply</button>
        <button type="button" disabled={busy} onclick={() => void applyStash(stash, true)}>Pop</button>
        <button type="button" class="danger" disabled={busy} aria-label={`Drop ${stash.ref}`} onclick={() => (dropStashTarget = stash)}>×</button>
      </div>
    {/each}
  </section>

  <section class="git-group git-release">
    <div class="git-group-head"><span>Release</span></div>
    <div class="git-release-create">
      <input bind:value={releaseName} placeholder="v1.0.0" aria-label="Release version" onkeydown={(e) => e.key === 'Enter' && void createRelease()} />
      <textarea rows="3" bind:value={releaseNotes} placeholder="Release notes (optional)" aria-label="Release notes"></textarea>
      <Switch compact bind:checked={releaseGithub} description="GitHub release" />
      <button
        type="button"
        class="git-release-btn"
        disabled={busy || !releaseName.trim() || remotes.length === 0}
        onclick={() => void createRelease()}
      >Create release</button>
      {#if releaseInfo}<div class="git-release-info">{releaseInfo}</div>{/if}
    </div>
  </section>

  <section class="git-group git-tags">
    <div class="git-group-head"><span>Tags</span><span>{tags.length}</span></div>
    <div class="git-tag-create">
      <input bind:value={tagName} placeholder="v1.0.0" aria-label="Tag name" onkeydown={(e) => e.key === 'Enter' && void createTag()} />
      <input bind:value={tagMessage} placeholder="Optional message" aria-label="Tag message" />
      <input bind:value={tagTarget} placeholder="HEAD" aria-label="Tag target" />
      <button type="button" disabled={busy || !tagName.trim()} onclick={() => void createTag()}>Create</button>
    </div>
    {#each tags as tag (tag.name)}
      <div class="git-tag-row">
        <div>
          <strong>{tag.name}</strong>
          <span>{tag.shortHash} · {tag.subject || 'lightweight tag'}</span>
        </div>
        <button type="button" class="danger" disabled={busy} onclick={() => (deleteTagTarget = tag)}>×</button>
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
