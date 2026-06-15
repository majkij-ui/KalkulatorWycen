/**
 * App-level catalogue of the studio's own video references ("Przykładowe realizacje").
 *
 * This is a global library — NOT part of a single quote. It is managed under the cog
 * (Settings → "Katalog realizacji") and persisted in its own localStorage key. On the
 * PDF assembly tab, each portfolio row can be filled by picking an entry from this
 * catalogue (a dropdown) or by typing a one-off URL.
 *
 * Each entry has a friendly `name` (shown in the dropdown) and the `url` that is
 * printed in the PDF.
 */

export interface PortfolioCatalogueEntry {
  id: string
  name: string
  url: string
}

const STORAGE_KEY = 'quote-gen-portfolio-catalogue'

export function makeCatalogueId(): string {
  // Stable-enough unique id without pulling in a uuid dependency.
  return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeEntry(raw: unknown): PortfolioCatalogueEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = typeof r.url === 'string' ? r.url.trim() : ''
  if (!url) return null
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : url
  const id = typeof r.id === 'string' && r.id ? r.id : makeCatalogueId()
  return { id, name, url }
}

export function getPortfolioCatalogue(): PortfolioCatalogueEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeEntry).filter((e): e is PortfolioCatalogueEntry => e !== null)
  } catch {
    return []
  }
}

export function savePortfolioCatalogue(entries: PortfolioCatalogueEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    const clean = (Array.isArray(entries) ? entries : [])
      .map(sanitizeEntry)
      .filter((e): e is PortfolioCatalogueEntry => e !== null)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // ignore quota / serialization failures
  }
}
