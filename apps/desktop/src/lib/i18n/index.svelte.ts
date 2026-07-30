import { en, type Catalog, type MessageKey } from './en'
import { id } from './id'

export type Locale = 'en' | 'id'

const catalogs: Record<Locale, Catalog> = {
  en: en as Catalog,
  id,
}

let locale = $state<Locale>('en')

function applyDocumentLang(next: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = next
}

/** Read current locale (reactive when called from component markup). */
export function getLocale(): Locale {
  return locale
}

/** Switch UI language. Also sets <html lang>. */
export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'id') next = 'en'
  if (locale === next) {
    applyDocumentLang(next)
    return
  }
  locale = next
  applyDocumentLang(next)
}

function lookup(key: string): string | undefined {
  const primary = catalogs[locale]?.[key]
  if (primary != null && primary !== '') return primary
  if (locale !== 'en') {
    const fallback = catalogs.en[key]
    if (fallback != null && fallback !== '') return fallback
  }
  return undefined
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`,
  )
}

/**
 * Translate key. Missing → EN → raw key.
 * Reading `locale` makes callers re-render on switch.
 */
export function t(key: MessageKey | string, vars?: Record<string, string | number>): string {
  void locale // subscribe
  const raw = lookup(key) ?? key
  return interpolate(raw, vars)
}

export type { MessageKey, Catalog }
