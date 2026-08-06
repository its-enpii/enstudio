import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { xtermTheme } from '../theme'
import type { TerminalApi } from './types'

export class SurfaceManager {
  readonly terminals = new Map<string, Terminal>()
  readonly fitAddons = new Map<string, FitAddon>()
  readonly terminalSizes = new Map<string, { cols: number; rows: number }>()
  readonly nudgedForFontKey = new Map<string, string>()
  readonly resizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly refitGenerations = new Map<string, number>()

  constructor(private readonly api: TerminalApi | undefined) {}

  createSurface(
    id: string,
    cols: number,
    rows: number,
    fontFamily: string,
    fontSize: number,
  ): Terminal {
    const terminal = new Terminal({
      cols,
      rows,
      cursorBlink: false,
      disableStdin: true,
      cursorStyle: 'bar',
      fontFamily,
      fontSize,
      lineHeight: 1.25,
      scrollback: 5_000,
      drawBoldTextInBrightColors: false,
      theme: { ...xtermTheme },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    this.terminals.set(id, terminal)
    this.fitAddons.set(id, fit)
    this.terminalSizes.set(id, { cols, rows })
    terminal.onData((data) => {
      void this.api?.write(id, data).catch(() => {})
    })
    return terminal
  }

  disposeSurface(id: string): void {
    this.terminals.get(id)?.dispose()
    this.terminals.delete(id)
    this.fitAddons.delete(id)
    this.terminalSizes.delete(id)
    this.nudgedForFontKey.delete(id)
    const timer = this.resizeTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.resizeTimers.delete(id)
    }
  }

  hostReady(host: HTMLDivElement | undefined): host is HTMLDivElement {
    return Boolean(host && host.clientWidth > 80 && host.clientHeight > 40)
  }

  measureHost(): { cols: number; rows: number } {
    return { cols: 80, rows: 24 }
  }

  fitSurface(
    ptyId: string,
    host: HTMLDivElement | undefined,
    fontFamily: string,
    fontSize: number,
    uiZoom: number,
    immediate = false,
  ): void {
    if (!ptyId) return
    if (!this.hostReady(host)) return
    const fit = this.fitAddons.get(ptyId)
    const terminal = this.terminals.get(ptyId)
    if (!fit || !terminal) return
    const apply = (): void => {
      if (!this.hostReady(host)) return
      const w0 = host.clientWidth
      const h0 = host.clientHeight
      const fontKey = `${fontFamily}|${fontSize}|${uiZoom}`
      if (this.nudgedForFontKey.get(ptyId) !== fontKey && terminal.cols > 0 && terminal.rows > 0) {
        this.nudgedForFontKey.set(ptyId, fontKey)
        try {
          terminal.resize(Math.max(2, terminal.cols + 1), terminal.rows)
          terminal.resize(Math.max(2, terminal.cols - 1), terminal.rows)
        } catch { /* not yet mounted */ }
      }
      try {
        const proposed = fit.proposeDimensions()
        if (!proposed || proposed.cols < 40 || proposed.rows < 10) return
        fit.fit()
        this.terminalSizes.set(ptyId, { cols: terminal.cols, rows: terminal.rows })
        void this.api?.resize(ptyId, terminal.cols, terminal.rows)
        host.style.opacity = '1'
      } catch { /* hidden or not mounted yet */ }
      if (host.clientWidth !== w0 || host.clientHeight !== h0) {
        requestAnimationFrame(() => this.fitSurface(ptyId, host, fontFamily, fontSize, uiZoom, true))
      }
    }
    if (immediate) {
      const t = this.resizeTimers.get(ptyId)
      if (t) clearTimeout(t)
      this.resizeTimers.delete(ptyId)
      apply()
      return
    }
    const existing = this.resizeTimers.get(ptyId)
    if (existing) clearTimeout(existing)
    this.resizeTimers.set(ptyId, setTimeout(() => {
      this.resizeTimers.delete(ptyId)
      apply()
    }, 100))
  }

  refitUntilStable(
    mountedSessionId: string | null,
    host: HTMLDivElement | undefined,
    fontFamily: string,
    fontSize: number,
    uiZoom: number,
    maxFrames = 16,
  ): void {
    if (!mountedSessionId) return
    const ptyId = mountedSessionId
    const gen = (this.refitGenerations.get(ptyId) ?? 0) + 1
    this.refitGenerations.set(ptyId, gen)
    let frames = 0
    let lastW = -1
    let lastH = -1
    const tick = (): void => {
      if (gen !== this.refitGenerations.get(ptyId)) return
      if (!this.hostReady(host)) return
      const w = host.clientWidth
      const h = host.clientHeight
      if (w !== lastW || h !== lastH) {
        lastW = w
        lastH = h
        this.fitSurface(ptyId, host, fontFamily, fontSize, uiZoom, true)
      }
      frames += 1
      if (frames < maxFrames) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  destroy(): void {
    for (const timer of this.resizeTimers.values()) clearTimeout(timer)
    this.resizeTimers.clear()
    for (const terminal of this.terminals.values()) terminal.dispose()
    this.terminals.clear()
    this.fitAddons.clear()
    this.terminalSizes.clear()
    this.nudgedForFontKey.clear()
    this.refitGenerations.clear()
  }
}