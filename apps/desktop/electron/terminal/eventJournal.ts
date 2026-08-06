export class EventJournal<T extends { sequence: number }> {
  private readonly events: T[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('event journal limit must be a positive integer')
  }

  append(event: T): void {
    const previous = this.events.at(-1)
    if (previous && event.sequence <= previous.sequence) {
      throw new Error('event journal sequence must increase')
    }
    this.events.push(event)
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit)
  }

  replay(afterSequence = 0): { events: T[]; truncatedBeforeSequence?: number } {
    const first = this.events[0]?.sequence
    const truncatedBeforeSequence = first !== undefined && afterSequence < first - 1 ? first : undefined
    return {
      events: this.events.filter((event) => event.sequence > afterSequence),
      truncatedBeforeSequence,
    }
  }

  latestSequence(): number {
    return this.events.at(-1)?.sequence ?? 0
  }
}
