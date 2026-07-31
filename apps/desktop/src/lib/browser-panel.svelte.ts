/**
 * Shared browser rail state (BrowserStage writes, BrowserInspector reads).
 */
import {
  classifyBrowserUrl,
  type PageOrigin,
  pageOriginHint,
  pageOriginLabel,
} from './browserOrigin'
import type { OutlineNode } from './browserOutline'

export type { OutlineNode }
export type BrowserRailBookmark = { id: string; title: string; url: string }
export type BrowserRailHistory = { id: string; title: string; url: string; visitedAt: number }
export type BrowserRailDownload = {
  id: string
  filename: string
  url: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  status: string
  startedAt: number
}

export type BrowserEditJob = {
  status: 'idle' | 'running' | 'done' | 'error'
  detail: string
  startedAt?: number
}

export const browserPanel = $state({
  url: '',
  title: '',
  origin: 'empty' as PageOrigin,
  originLabel: '',
  originHint: '',
  bookmarks: [] as BrowserRailBookmark[],
  history: [] as BrowserRailHistory[],
  downloads: [] as BrowserRailDownload[],
  projectRoot: '' as string,
  outline: [] as OutlineNode[],
  outlineBusy: false,
  outlineError: '' as string,
  selectedPath: '' as string,
  /** Live pick-from-page mode (click element in webview). */
  pickMode: false,
  /** Last picked / selected node meta (for Edit button without tree match). */
  selectedNode: null as OutlineNode | null,
  /** Background UI-edit job (not the Agent chat session). */
  editJob: { status: 'idle', detail: '' } as BrowserEditJob,
})

export function setBrowserEditJob(job: BrowserEditJob): void {
  browserPanel.editJob = job
}

export function syncBrowserPanel( partial: {
  url?: string
  title?: string
  bookmarks?: BrowserRailBookmark[]
  history?: BrowserRailHistory[]
  downloads?: BrowserRailDownload[]
  projectRoot?: string
  previewPorts?: number[]
  outline?: OutlineNode[]
  outlineBusy?: boolean
  outlineError?: string
  selectedPath?: string
  pickMode?: boolean
  selectedNode?: OutlineNode | null
}): void {
  if (partial.projectRoot !== undefined) browserPanel.projectRoot = partial.projectRoot
  if (partial.url !== undefined) {
    if (partial.url !== browserPanel.url) {
      browserPanel.outline = []
      browserPanel.outlineError = ''
      browserPanel.selectedPath = ''
      browserPanel.selectedNode = null
      browserPanel.pickMode = false
    }
    browserPanel.url = partial.url
  }
  if (partial.title !== undefined) browserPanel.title = partial.title
  if (partial.bookmarks) browserPanel.bookmarks = partial.bookmarks
  if (partial.history) browserPanel.history = partial.history
  if (partial.downloads) browserPanel.downloads = partial.downloads
  if (partial.outline) browserPanel.outline = partial.outline
  if (partial.outlineBusy !== undefined) browserPanel.outlineBusy = partial.outlineBusy
  if (partial.outlineError !== undefined) browserPanel.outlineError = partial.outlineError
  if (partial.selectedPath !== undefined) browserPanel.selectedPath = partial.selectedPath
  if (partial.pickMode !== undefined) browserPanel.pickMode = partial.pickMode
  if (partial.selectedNode !== undefined) browserPanel.selectedNode = partial.selectedNode

  const origin = classifyBrowserUrl(browserPanel.url, {
    projectRoot: browserPanel.projectRoot || undefined,
    previewPorts: partial.previewPorts,
  })
  browserPanel.origin = origin
  browserPanel.originLabel = pageOriginLabel(origin)
  browserPanel.originHint = pageOriginHint(origin)
  if (origin !== 'project') {
    browserPanel.outline = []
    browserPanel.selectedPath = ''
    browserPanel.selectedNode = null
    browserPanel.pickMode = false
  }
}

export function requestOutlineRefresh(): void {
  window.dispatchEvent(new CustomEvent('enpiistudio:browser-outline-refresh'))
}

export function requestOutlineHighlight(path: string): void {
  window.dispatchEvent(new CustomEvent('enpiistudio:browser-outline-highlight', { detail: { path } }))
}

export function requestOutlineClear(): void {
  window.dispatchEvent(new CustomEvent('enpiistudio:browser-outline-clear'))
}

export function requestPickMode(on?: boolean): void {
  window.dispatchEvent(
    new CustomEvent('enpiistudio:browser-outline-pick', {
      detail: { on: on !== false },
    }),
  )
}

export function requestEditWithAi(node: OutlineNode, instruction: string): void {
  const text = instruction.trim()
  if (!text) return
  window.dispatchEvent(
    new CustomEvent('enpiistudio:browser-outline-ai', {
      detail: {
        path: node.path,
        tag: node.tag,
        label: node.label,
        url: browserPanel.url,
        instruction: text,
      },
    }),
  )
}
