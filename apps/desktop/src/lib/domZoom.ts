/**
 * Page zoom helpers for fixed menus.
 * Prefer Electron webFrame zoom (no CSS zoom). If CSS zoom is still set (fallback),
 * convert visual getBoundingClientRect → layout coords for position:fixed.
 */
export function pageZoom(): number {
  if (typeof document === 'undefined') return 1
  try {
    const wf = window.enpiistudio?.app?.getZoomFactor?.()
    if (typeof wf === 'number' && Number.isFinite(wf) && wf > 0) return wf
  } catch {
    /* ignore */
  }
  const raw = getComputedStyle(document.documentElement).zoom
  const z = parseFloat(String(raw || '1'))
  // CSS zoom may be "120%" or "1.2"
  if (Number.isFinite(z) && z > 0) return z > 3 ? z / 100 : z
  return 1
}

/** getBoundingClientRect → layout px for position:fixed when CSS zoom is active. */
export function layoutRect(el: Element): {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
} {
  const r = el.getBoundingClientRect()
  // webFrame zoom: rect already matches fixed coords (z≈1 for CSS). CSS zoom needs divide.
  const cssRaw = getComputedStyle(document.documentElement).zoom
  const cssZ = parseFloat(String(cssRaw || '1'))
  const z = Number.isFinite(cssZ) && cssZ > 0 && String(cssRaw) !== '1' && cssRaw !== '' && cssRaw !== 'normal'
    ? cssZ > 3
      ? cssZ / 100
      : cssZ
    : 1
  return {
    top: r.top / z,
    bottom: r.bottom / z,
    left: r.left / z,
    right: r.right / z,
    width: r.width / z,
    height: r.height / z,
  }
}

/** Viewport size in layout px for fixed menus. */
export function layoutViewport(): { width: number; height: number } {
  const cssRaw = getComputedStyle(document.documentElement).zoom
  const cssZ = parseFloat(String(cssRaw || '1'))
  const z = Number.isFinite(cssZ) && cssZ > 0 && String(cssRaw) !== '1' && cssRaw !== '' && cssRaw !== 'normal'
    ? cssZ > 3
      ? cssZ / 100
      : cssZ
    : 1
  return {
    width: window.innerWidth / z,
    height: window.innerHeight / z,
  }
}
