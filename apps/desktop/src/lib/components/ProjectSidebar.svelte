<script lang="ts">
  import { state as app, type Project, type ProjectGroup } from '../store.svelte'
  import { t } from '../i18n/index.svelte'
  import { hydrateProjectSession } from '../enpii'
  import { Icon } from '../icons'
  import { Dropdown, type DropdownItem } from './ui'
  import logoUrl from '../image/logo.png'

  let opening = $state(false)
  let openError = $state('')
  let filter = $state('')
  let renamingId = $state<string | null>(null)
  let renameDraft = $state('')
  let renameInput = $state<HTMLInputElement>()
  let renamingGroupId = $state<string | null>(null)
  let groupRenameDraft = $state('')
  let groupRenameInput = $state<HTMLInputElement>()
  let dragId = $state<string | null>(null)
  let dropTargetId = $state<string | null>(null)
  let dropPlace = $state<'before' | 'after'>('before')

  type Row =
    | { kind: 'group'; group: ProjectGroup; projects: Project[] }
    | { kind: 'project'; project: Project }

  const rows = $derived.by((): Row[] => {
    const q = filter.trim().toLowerCase()
    const match = (p: Project) => {
      if (!q) return true
      const label = app.projectLabel(p).toLowerCase()
      return label.includes(q) || p.path.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    }
    const projects = app.projects.filter(match)
    const groupedIds = new Set(projects.map((p) => p.groupId).filter(Boolean) as string[])
    const groups = [...app.projectGroups]
      .filter((g) => !q || groupedIds.has(g.id) || g.name.toLowerCase().includes(q))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))

    const out: Row[] = []
    const seen = new Set<string>()
    for (const group of groups) {
      const members = projects
        .filter((p) => p.groupId === group.id)
        .sort((a, b) => {
          const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
          if (pin) return pin
          return (a.order ?? 0) - (b.order ?? 0)
        })
      if (q && members.length === 0 && !group.name.toLowerCase().includes(q)) continue
      out.push({ kind: 'group', group, projects: members })
      for (const m of members) seen.add(m.id)
    }
    const ungrouped = projects
      .filter((p) => !p.groupId || !seen.has(p.id))
      .filter((p) => !p.groupId)
      .sort((a, b) => {
        const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        if (pin) return pin
        return (a.order ?? 0) - (b.order ?? 0)
      })
    for (const p of ungrouped) out.push({ kind: 'project', project: p })
    return out
  })

  async function openProject(): Promise<void> {
    if (opening) return
    opening = true
    openError = ''
    const api = window.enpiistudio
    try {
      if (!api?.dialog) throw new Error('dialog API missing — restart the desktop app')
      const dir = await api.dialog.openDirectory()
      if (!dir) return
      app.addProject(dir)
      await hydrateProjectSession()
    } catch (err) {
      openError = err instanceof Error ? err.message : String(err)
      app.pushLog(`[project] open failed: ${openError}`)
    } finally {
      opening = false
    }
  }

  function onSelect(id: string) {
    if (renamingId === id) return
    app.selectProject(id)
    void hydrateProjectSession()
  }

  function startRename(project: Project, e?: MouseEvent): void {
    e?.stopPropagation()
    renamingId = project.id
    renameDraft = app.projectLabel(project)
    queueMicrotask(() => {
      renameInput?.focus()
      renameInput?.select()
    })
  }

  function commitRename(): void {
    if (!renamingId) return
    app.renameProject(renamingId, renameDraft)
    renamingId = null
  }

  function cancelRename(): void {
    renamingId = null
  }

  function projectMenuItems(project: Project): DropdownItem[] {
    const items: DropdownItem[] = [
      { id: 'pin', label: project.pinned ? t('sidebar.unpin') : t('sidebar.pin') },
      { id: 'rename', label: t('sidebar.rename') },
      { id: 'new-group', label: t('sidebar.newGroup') },
    ]
    if (app.projectGroups.length) {
      items.push({ id: '_sep_g', label: '', separator: true })
      for (const g of app.projectGroups) {
        items.push({
          id: `group:${g.id}`,
          label: project.groupId === g.id ? `✓ ${g.name}` : t('sidebar.addToGroup', { name: g.name }),
        })
      }
      if (project.groupId) {
        items.push({ id: 'ungroup', label: t('sidebar.ungroup') })
      }
    }
    items.push({ id: '_sep', label: '', separator: true })
    items.push({ id: 'close', label: t('sidebar.closeProject'), danger: true })
    return items
  }

  function onProjectMenu(project: Project, id: string): void {
    if (id === 'pin') app.toggleProjectPin(project.id)
    else if (id === 'rename') startRename(project)
    else if (id === 'new-group') {
      const g = app.createProjectGroup()
      app.setProjectGroup(project.id, g.id)
      startGroupRename(g)
    } else if (id === 'ungroup') app.setProjectGroup(project.id, null)
    else if (id.startsWith('group:')) app.setProjectGroup(project.id, id.slice(6))
    else if (id === 'close') {
      app.removeProject(project.id)
      if (app.activeProjectId) void hydrateProjectSession()
    }
  }

  function groupMenuItems(_group: ProjectGroup): DropdownItem[] {
    return [
      { id: 'add', label: t('sidebar.addProjectToGroup') },
      { id: 'rename', label: t('sidebar.renameGroup') },
      { id: 'ungroup', label: t('sidebar.ungroupAll') },
    ]
  }

  function onGroupMenu(group: ProjectGroup, id: string): void {
    if (id === 'add') {
      // Prefer active project if free/elsewhere; else first ungrouped
      const active = app.activeProject
      const free =
        active && active.groupId !== group.id
          ? active
          : app.projects.find((p) => p.groupId !== group.id)
      if (free) app.setProjectGroup(free.id, group.id)
      else app.notify('info', t('sidebar.noFreeProjects'), t('sidebar.noFreeProjectsDetail'))
    } else if (id === 'rename') startGroupRename(group)
    else if (id === 'ungroup') app.ungroupProjectGroup(group.id)
  }

  function startGroupRename(group: ProjectGroup): void {
    renamingGroupId = group.id
    groupRenameDraft = group.name
    queueMicrotask(() => {
      groupRenameInput?.focus()
      groupRenameInput?.select()
    })
  }

  function commitGroupRename(): void {
    if (!renamingGroupId) return
    app.renameProjectGroup(renamingGroupId, groupRenameDraft)
    renamingGroupId = null
  }

  function onDragStart(e: DragEvent, id: string): void {
    dragId = id
    e.dataTransfer?.setData('text/enpii-project', id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e: DragEvent, id: string): void {
    e.preventDefault()
    if (!dragId || dragId === id) return
    dropTargetId = id
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dropPlace = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }

  function onDrop(e: DragEvent, id: string): void {
    e.preventDefault()
    const from = dragId || e.dataTransfer?.getData('text/enpii-project')
    if (from && from !== id) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      app.moveProjectRelative(from, id, place)
    }
    dragId = null
    dropTargetId = null
  }

  function onDragEnd(): void {
    dragId = null
    dropTargetId = null
  }

  function onGroupHeaderDrop(e: DragEvent, groupId: string): void {
    e.preventDefault()
    const from = dragId || e.dataTransfer?.getData('text/enpii-project')
    if (from) app.moveProjectToGroupEdge(from, groupId, 'end')
    dragId = null
    dropTargetId = null
  }
</script>

<aside class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent">
  <div class="flex items-center gap-2.5 px-3 pt-3 pb-2">
    <img
      src={logoUrl}
      alt=""
      width="28"
      height="28"
      class="size-7 shrink-0 rounded-[9px] object-cover shadow-sm ring-1 ring-white/10"
      draggable="false"
    />
    <div class="min-w-0">
      <h1 class="m-0 truncate text-[13px] font-semibold tracking-tight text-studio-text">enpii</h1>
      <p class="m-0 text-[11px] text-studio-text-dim">studio</p>
    </div>
  </div>

  <div class="flex items-center gap-1.5 px-2 pb-2">
    <div class="relative min-w-0 flex-1">
      <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-studio-text-dim">
        <Icon name="search" size={12} />
      </span>
      <input
        class="w-full rounded-lg border-0 bg-black/25 py-1.5 pl-8 pr-2 text-[12px] text-studio-text outline-none ring-1 ring-white/8 placeholder:text-studio-text-dim/60 focus:ring-studio-purple/45"
        type="text"
        placeholder={t('sidebar.search')}
        bind:value={filter}
        aria-label={t('sidebar.searchProjects')}
      />
    </div>
    <button
      type="button"
      class="grid size-[30px] shrink-0 place-items-center rounded-lg bg-black/25 text-studio-text-dim ring-1 ring-white/8 hover:bg-white/8 hover:text-studio-text disabled:opacity-45"
      title={t('sidebar.openFolder')}
      aria-label={t('sidebar.openFolder')}
      onclick={openProject}
      disabled={opening}
    >
      <Icon name="folder-plus" size={14} />
    </button>
  </div>

  {#if openError}
    <div class="mx-2 mb-2 rounded-lg bg-danger-bg px-2.5 py-2 text-[11px] text-danger" role="alert">
      {openError}
    </div>
  {/if}

  <nav class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
    {#if app.projects.length === 0}
      <div class="px-2 py-8 text-center text-[12px] text-studio-text-dim">{t('sidebar.openFolderHint')}</div>
    {:else if rows.length === 0}
      <div class="px-2 py-8 text-center text-[12px] text-studio-text-dim">{t('sidebar.noMatch')}</div>
    {:else}
      {#each rows as row (row.kind === 'group' ? `g:${row.group.id}` : row.project.id)}
        {#if row.kind === 'group'}
          <div class="mb-0.5">
            <div
              class="group flex items-center gap-1 rounded-lg px-1.5 py-1 text-studio-text-dim hover:bg-white/[0.04]"
              ondragover={(e) => {
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
              }}
              ondrop={(e) => onGroupHeaderDrop(e, row.group.id)}
            >
              <button
                type="button"
                class="grid size-5 shrink-0 place-items-center rounded hover:bg-white/8 hover:text-studio-text"
                aria-label={row.group.collapsed ? t('sidebar.expandGroup') : t('sidebar.collapseGroup')}
                onclick={() => app.toggleProjectGroup(row.group.id)}
              >
                <Icon name={row.group.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
              </button>
              {#if renamingGroupId === row.group.id}
                <input
                  class="min-w-0 flex-1 rounded border border-studio-purple/50 bg-black/30 px-1.5 py-0.5 text-[12px] text-studio-text outline-none"
                  bind:this={groupRenameInput}
                  bind:value={groupRenameDraft}
                  aria-label={t('sidebar.groupName')}
                  onclick={(e) => e.stopPropagation()}
                  onblur={commitGroupRename}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitGroupRename()
                    if (e.key === 'Escape') renamingGroupId = null
                  }}
                />
              {:else}
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate text-left text-[11px] font-semibold uppercase tracking-wide text-studio-text-dim hover:text-studio-text"
                  onclick={() => app.toggleProjectGroup(row.group.id)}
                  ondblclick={() => startGroupRename(row.group)}
                >
                  {row.group.name}
                  <span class="ml-1 font-mono font-normal normal-case opacity-60">{row.projects.length}</span>
                </button>
              {/if}
              <Dropdown
                items={groupMenuItems(row.group)}
                label="Group"
                align="end"
                onSelect={(id) => onGroupMenu(row.group, id)}
              >
                {#snippet trigger({ open, toggle })}
                  <button
                    type="button"
                    class="grid size-5 shrink-0 place-items-center rounded text-studio-text-dim opacity-0 group-hover:opacity-100 hover:bg-white/8 hover:text-studio-text {open
                      ? 'opacity-100 bg-white/8'
                      : ''}"
                    title={t('sidebar.groupActions')}
                    aria-label={t('sidebar.groupActions')}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onclick={(e) => {
                      e.stopPropagation()
                      toggle()
                    }}
                  >
                    <Icon name="more-vertical" size={12} />
                  </button>
                {/snippet}
              </Dropdown>
            </div>
            {#if !row.group.collapsed}
              <div class="ml-1 space-y-0.5 border-l border-white/8 pl-1.5">
                {#each row.projects as project (project.id)}
                  {@render projectRow(project)}
                {:else}
                  <div class="px-2 py-1.5 text-[10px] text-studio-text-dim">Empty · drop a project here</div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          {@render projectRow(row.project)}
        {/if}
      {/each}
    {/if}
  </nav>
</aside>

{#snippet projectRow(project: Project)}
  {@const active = app.activeProjectId === project.id}
  {@const projectBusy = app.isProjectBusy(project.id)}
  {@const dropping = dropTargetId === project.id && dragId && dragId !== project.id}
  <div
    class="group relative cursor-pointer rounded-lg py-2 pl-2.5 pr-7 transition-colors {active
      ? 'bg-studio-purple/25 ring-1 ring-studio-purple/30'
      : 'hover:bg-white/[0.05]'} {dragId === project.id ? 'opacity-50' : ''} {dropping && dropPlace === 'before'
      ? 'ring-1 ring-inset ring-t-studio-gold/60 shadow-[inset_0_2px_0_0_rgba(234,179,8,0.7)]'
      : ''} {dropping && dropPlace === 'after'
      ? 'shadow-[inset_0_-2px_0_0_rgba(234,179,8,0.7)]'
      : ''}"
    role="button"
    tabindex="0"
    draggable="true"
    ondragstart={(e) => onDragStart(e, project.id)}
    ondragover={(e) => onDragOver(e, project.id)}
    ondrop={(e) => onDrop(e, project.id)}
    ondragend={onDragEnd}
    onclick={() => onSelect(project.id)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(project.id)
      }
    }}
  >
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        {#if renamingId === project.id}
          <input
            class="w-full rounded border border-studio-purple/50 bg-black/30 px-1.5 py-0.5 text-[12px] font-medium text-studio-text outline-none"
            bind:this={renameInput}
            bind:value={renameDraft}
            aria-label={t('sidebar.projectName')}
            onclick={(e) => e.stopPropagation()}
            onblur={commitRename}
            onkeydown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') cancelRename()
            }}
          />
        {:else}
          <div class="flex items-center gap-1.5 truncate text-[12px] font-medium text-studio-text">
            {#if project.pinned}
              <Icon name="star-fill" size={10} class="shrink-0 text-studio-gold" />
            {/if}
            <span class="truncate">{app.projectLabel(project)}</span>
          </div>
        {/if}
        <div class="truncate font-mono text-[10px] text-studio-text-dim">{project.path}</div>
      </div>
      <Dropdown
        items={projectMenuItems(project)}
        label="Project"
        align="end"
        onSelect={(id) => onProjectMenu(project, id)}
      >
        {#snippet trigger({ open, toggle })}
          <button
            type="button"
            class="grid size-5 shrink-0 place-items-center rounded text-studio-text-dim opacity-0 group-hover:opacity-100 hover:bg-white/8 hover:text-studio-text {open
              ? 'opacity-100 bg-white/8 text-studio-text'
              : ''}"
            title={t('sidebar.projectActions')}
            aria-label={t('sidebar.projectActions')}
            aria-haspopup="menu"
            aria-expanded={open}
            onclick={(e) => {
              e.stopPropagation()
              toggle()
            }}
          >
            <Icon name="more-vertical" size={12} />
          </button>
        {/snippet}
      </Dropdown>
    </div>
    {#if projectBusy}
      <span
        class="studio-signal pointer-events-none absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full"
        title="Agent running"
      ></span>
    {/if}
  </div>
{/snippet}
