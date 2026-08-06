import type { TerminalHostEvent } from '../../../../electron/terminal/types'
import type { TerminalApi } from './types'

export class PtyBridge {
  private readonly lastSequences = new Map<string, number>()
  private readonly acknowledgeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pendingEvents = new Map<string, TerminalHostEvent[]>()
  readonly restoringIds = new Set<string>()
  readonly creatingFor = new Set<string>()
  readonly tabByPtyId = new Map<string, string>()
  readonly blockByPtyId = new Map<string, string>()
  readonly liveOutputByPtyId = new Map<string, string>()
  readonly lastPtyDataAt = new Map<string, number>()

  constructor(private readonly api: TerminalApi | undefined) {}

  noteSequence(id: string, sequence: number): boolean {
    const previous = this.lastSequences.get(id) ?? 0
    if (sequence <= previous) return false
    this.lastSequences.set(id, sequence)
    const timer = this.acknowledgeTimers.get(id)
    if (timer) clearTimeout(timer)
    this.acknowledgeTimers.set(id, setTimeout(() => {
      this.acknowledgeTimers.delete(id)
      void this.api?.acknowledge(id, this.lastSequences.get(id) ?? sequence).catch(() => {})
    }, 200))
    return true
  }

  queueHostEvent(event: TerminalHostEvent): void {
    const pending = this.pendingEvents.get(event.id) ?? []
    pending.push(event)
    this.pendingEvents.set(event.id, pending)
  }

  drainPending(id: string): TerminalHostEvent[] {
    const pending = this.pendingEvents.get(id)?.sort((left, right) => left.sequence - right.sequence) ?? []
    this.pendingEvents.delete(id)
    return pending
  }

  resetSequence(id: string): void {
    this.lastSequences.set(id, 0)
  }

  cleanupSession(id: string): void {
    this.lastSequences.delete(id)
    this.pendingEvents.delete(id)
    this.liveOutputByPtyId.delete(id)
    this.blockByPtyId.delete(id)
    this.tabByPtyId.delete(id)
    this.lastPtyDataAt.delete(id)
    const ackTimer = this.acknowledgeTimers.get(id)
    if (ackTimer) {
      clearTimeout(ackTimer)
      this.acknowledgeTimers.delete(id)
    }
  }

  destroy(): void {
    for (const timer of this.acknowledgeTimers.values()) clearTimeout(timer)
    this.acknowledgeTimers.clear()
    this.lastSequences.clear()
    this.pendingEvents.clear()
    this.restoringIds.clear()
    this.creatingFor.clear()
    this.liveOutputByPtyId.clear()
    this.blockByPtyId.clear()
    this.tabByPtyId.clear()
    this.lastPtyDataAt.clear()
  }
}