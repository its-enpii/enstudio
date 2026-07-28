import type { GitCommit } from './enpii'

/** Shared git-mode focus between GitStage (center) and History (inspector). */
export const gitPanel = $state({
  revision: 0,
  selectedCommit: null as GitCommit | null,
  selectedCommitPath: null as string | null,
  commitDiff: '',
})

export function bumpGitPanel(): void {
  gitPanel.revision++
}

export function clearGitCommitSelection(): void {
  gitPanel.selectedCommit = null
  gitPanel.selectedCommitPath = null
  gitPanel.commitDiff = ''
}

export function focusGitCommit(commit: GitCommit, path: string, diff: string): void {
  gitPanel.selectedCommit = commit
  gitPanel.selectedCommitPath = path
  gitPanel.commitDiff = diff
}
