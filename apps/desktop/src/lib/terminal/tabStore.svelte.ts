import { loadHistory } from './commandHistory'
import type { CommandBlock, TerminalTab } from './types'
import { pathTitle } from './helpers'

export class TabStore {
  tabs = $state<TerminalTab[]>([])
  activeId = $state<string | null>(null)
  error = $state('')

  activeTab(): TerminalTab | null {
    if (!this.activeId) return null
    return this.tabs.find((tab) => tab.id === this.activeId) ?? null
  }

  findTab(tabId: string): TerminalTab | null {
    return this.tabs.find((tab) => tab.id === tabId) ?? null
  }

  applyBlockUpdate(tabId: string, blockId: string, patch: Partial<CommandBlock>): void {
    this.tabs = this.tabs.map((tab) => {
      if (tab.id !== tabId) return tab
      return {
        ...tab,
        blocks: tab.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
      }
    })
  }

  applyTabPatch(tabId: string, patch: Partial<TerminalTab>): void {
    this.tabs = this.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))
  }

  addTab(tab: TerminalTab): void {
    this.tabs = [...this.tabs, tab]
  }

  removeTab(tabId: string): void {
    this.tabs = this.tabs.filter((tab) => tab.id !== tabId)
  }

  seedTabForNewPty(ptyId: string, cwd: string, shell: string): TerminalTab {
    const tab: TerminalTab = {
      id: ptyId,
      title: pathTitle(cwd, this.tabs.length + 1),
      cwd,
      shell,
      exited: false,
      blocks: [],
      runningCommandId: null,
      history: loadHistory(),
      historyIndex: -1,
      historyDraft: '',
      composer: '',
    }
    this.addTab(tab)
    return tab
  }

  clear(): void {
    this.tabs = []
    this.activeId = null
    this.error = ''
  }
}