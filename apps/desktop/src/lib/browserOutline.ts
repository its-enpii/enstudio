/**
 * DOM outline scrape for project-origin webviews only.
 * Runs inside page via executeJavaScript — keep pure / no host refs.
 */

export type OutlineNode = {
  id: string
  tag: string
  label: string
  depth: number
  /** nth-of path for re-query, e.g. "DIV:0/MAIN:0/FORM:1" */
  path: string
}

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'PATH',
  'BR',
  'HR',
])

/** Source string injected into the page (IIFE returns OutlineNode[]). */
export const OUTLINE_SCRAPE_JS = `(() => {
  const SKIP = new Set(${JSON.stringify([...SKIP])});
  const MAX = 200;
  const out = [];
  function labelFor(el) {
    const tag = el.tagName.toLowerCase();
    let text = '';
    try {
      text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 48);
    } catch (_) {}
    // Prefer human text; avoid dumping utility class lists into the rail.
    if (text) return tag + ' · ' + text;
    const id = el.id ? '#' + el.id : '';
    return tag + id;
  }
  function pathSeg(el, parent) {
    if (!parent) return el.tagName + ':0';
    let n = 0;
    for (const c of parent.children) {
      if (c === el) return el.tagName + ':' + n;
      if (c.tagName === el.tagName) n++;
    }
    return el.tagName + ':0';
  }
  function walk(el, depth, pathPrefix, parent) {
    if (!el || out.length >= MAX || depth > 12) return;
    const tag = el.tagName;
    if (!tag || SKIP.has(tag)) return;
    const seg = pathSeg(el, parent);
    const path = pathPrefix ? pathPrefix + '/' + seg : seg;
    const id = 'n' + out.length;
    out.push({ id: id, tag: tag.toLowerCase(), label: labelFor(el), depth: depth, path: path });
    const kids = el.children;
    if (!kids) return;
    for (let i = 0; i < kids.length && out.length < MAX; i++) {
      walk(kids[i], depth + 1, path, el);
    }
  }
  const root = document.body || document.documentElement;
  if (root) walk(root, 0, '', null);
  return out;
})()`

export const OUTLINE_HIGHLIGHT_JS = (path: string) => `(() => {
  const path = ${JSON.stringify(path)};
  const STYLE_ID = 'enpii-outline-hl';
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = [
    '.__enpii_hl{outline:2px solid #a78bfa!important;outline-offset:2px!important;background:rgba(167,139,250,.12)!important;}',
    '.__enpii_hov{outline:2px dashed #f0c14b!important;outline-offset:2px!important;background:rgba(240,193,75,.08)!important;cursor:crosshair!important;}',
    'html.enpii-pick,html.enpii-pick *{cursor:crosshair!important;}',
  ].join('');
  document.querySelectorAll('.__enpii_hl').forEach((el) => el.classList.remove('__enpii_hl'));
  if (!path) return false;
  const parts = path.split('/');
  let el = document.body || document.documentElement;
  if (!el) return false;
  // First seg is BODY/HTML — start from documentElement/body match
  let start = 0;
  if (parts[0] && /^(BODY|HTML):/i.test(parts[0])) {
    const t = parts[0].split(':')[0].toUpperCase();
    el = t === 'HTML' ? document.documentElement : (document.body || document.documentElement);
    start = 1;
  }
  for (let i = start; i < parts.length; i++) {
    const [tag, idxStr] = parts[i].split(':');
    const idx = parseInt(idxStr || '0', 10) || 0;
    if (!el || !el.children) return false;
    let n = 0;
    let next = null;
    for (const c of el.children) {
      if (c.tagName === tag) {
        if (n === idx) { next = c; break; }
        n++;
      }
    }
    if (!next) return false;
    el = next;
  }
  if (!el || el === document.documentElement) return false;
  el.classList.add('__enpii_hl');
  try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
  return true;
})()`

export const OUTLINE_CLEAR_JS = `(() => {
  document.querySelectorAll('.__enpii_hl').forEach((el) => el.classList.remove('__enpii_hl'));
  document.querySelectorAll('.__enpii_hov').forEach((el) => el.classList.remove('__enpii_hov'));
  const s = document.getElementById('enpii-outline-hl');
  if (s) s.remove();
  return true;
})()`

/** Ensure highlight CSS is present (hover + select). */
const ENSURE_STYLE = `
  const STYLE_ID = 'enpii-outline-hl';
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = [
    '.__enpii_hl{outline:2px solid #a78bfa!important;outline-offset:2px!important;background:rgba(167,139,250,.12)!important;}',
    '.__enpii_hov{outline:2px dashed #f0c14b!important;outline-offset:2px!important;background:rgba(240,193,75,.08)!important;cursor:crosshair!important;}',
    'html.enpii-pick,html.enpii-pick *{cursor:crosshair!important;}',
  ].join('');
`

/** Build DIV:0/MAIN:0 path from element up to body. */
const PATH_FROM_EL = `
  function pathFromEl(el) {
    const SKIP = new Set(${JSON.stringify([...SKIP])});
    const segs = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      if (!cur.tagName || SKIP.has(cur.tagName)) {
        cur = cur.parentElement;
        continue;
      }
      const parent = cur.parentElement;
      let n = 0;
      let idx = 0;
      if (parent) {
        for (const c of parent.children) {
          if (c.tagName === cur.tagName) {
            if (c === cur) { idx = n; break; }
            n++;
          }
        }
      }
      segs.unshift(cur.tagName + ':' + idx);
      if (cur === document.body) break;
      cur = parent;
    }
    return segs.join('/');
  }
  function labelFor(el) {
    const tag = el.tagName.toLowerCase();
    let text = '';
    try {
      text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.getAttribute('name') || '').trim().replace(/\\s+/g, ' ').slice(0, 48);
    } catch (_) {}
    if (text) return tag + ' · ' + text;
    const id = el.id ? '#' + el.id : '';
    return tag + id;
  }
`

/**
 * Start pick mode: hover highlight, click selects and returns node.
 * Host should call executeJavaScript then wait for result OR poll via getSelected.
 * Click returns { path, tag, label } once; pick mode stays on until stop.
 */
export const OUTLINE_PICK_START_JS = `(() => {
  ${ENSURE_STYLE}
  ${PATH_FROM_EL}
  if (window.__enpiiPick) return { ok: true, already: true };
  const state = { hover: null, last: null };
  const onMove = (e) => {
    const t = e.target;
    if (!t || t === document.documentElement || t === document.body) return;
    if (t === state.hover) return;
    if (state.hover) state.hover.classList.remove('__enpii_hov');
    state.hover = t;
    t.classList.add('__enpii_hov');
  };
  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.target;
    if (!t || !t.tagName) return false;
    document.querySelectorAll('.__enpii_hl').forEach((el) => el.classList.remove('__enpii_hl'));
    document.querySelectorAll('.__enpii_hov').forEach((el) => el.classList.remove('__enpii_hov'));
    t.classList.add('__enpii_hl');
    try { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
    const path = pathFromEl(t);
    const node = { path: path, tag: t.tagName.toLowerCase(), label: labelFor(t), depth: path.split('/').length - 1, id: 'pick' };
    state.last = node;
    window.__enpiiPickLast = node;
    return false;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      window.__enpiiPickStop && window.__enpiiPickStop();
    }
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.documentElement.classList.add('enpii-pick');
  window.__enpiiPickStop = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('enpii-pick');
    document.querySelectorAll('.__enpii_hov').forEach((el) => el.classList.remove('__enpii_hov'));
    delete window.__enpiiPick;
    delete window.__enpiiPickStop;
  };
  window.__enpiiPick = state;
  window.__enpiiPickLast = null;
  return { ok: true };
})()`

export const OUTLINE_PICK_STOP_JS = `(() => {
  if (window.__enpiiPickStop) window.__enpiiPickStop();
  return true;
})()`

export const OUTLINE_PICK_POLL_JS = `(() => {
  if (!window.__enpiiPick) return { stopped: true };
  const n = window.__enpiiPickLast;
  if (!n) return null;
  window.__enpiiPickLast = null;
  return n;
})()`
