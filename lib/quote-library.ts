/**
 * Kształt migawki wyceny i odczyt bibliotek wycen do importu.
 *
 * Do Q1 hub miał własną bibliotekę „Moje wyceny" (`quotes.json`). Od Q1 wycena
 * jest dokumentem projektu (`quote-documents.ts`) i hub tej biblioteki nie
 * czyta ani nie zapisuje — plik zostaje na dysku nietknięty. Zostaje kształt
 * migawki (`Project.quote` ma ten sam) i odczyt biblioteki starej aplikacji
 * QuoteGen do jednorazowego importu (`legacy-app.ts`).
 */

import type { QuoteData } from './quote-types'
import type { PricingConfigShape } from './pricing-config'

/** Snapshot pełnego stanu wyceny — ten sam kształt co `Project.quote` i plik JSON wyceny. */
export interface QuoteSnapshot {
  version: 2
  savedAt: string
  data: QuoteData
  pricingConfig: PricingConfigShape
  marginMultiplier: number
  pdfDraft: unknown
}

export interface SavedQuoteRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: QuoteSnapshot
  /**
   * Projekt, z którego zapisano tę kopię do „Moje wyceny" (przed Q1). Taka
   * wycena już JEST w projektach, więc import jej nie proponuje.
   */
  projectId?: string
}

interface QuotesLibraryFile {
  version: 1
  quotes: SavedQuoteRecord[]
}

/** Biblioteka w localStorage — w przeglądarce (dev) stoi w miejscu starej aplikacji. */
const WEB_QUOTES_KEY = 'nonoise-quotes-library-v1'

export function sortByUpdatedDesc(quotes: SavedQuoteRecord[]): SavedQuoteRecord[] {
  return [...quotes].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/** Wczytuje plik biblioteki wycen defensywnie — także cudzy (stara aplikacja). */
export function coerceLibrary(raw: unknown): SavedQuoteRecord[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as QuotesLibraryFile).quotes
  if (!Array.isArray(list)) return []
  return list.filter(
    (q): q is SavedQuoteRecord =>
      !!q &&
      typeof q === 'object' &&
      typeof (q as SavedQuoteRecord).id === 'string' &&
      typeof (q as SavedQuoteRecord).name === 'string' &&
      !!(q as SavedQuoteRecord).snapshot
  )
}

export function readWebQuoteLibrary(): SavedQuoteRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(WEB_QUOTES_KEY)
    if (!raw) return []
    return sortByUpdatedDesc(coerceLibrary(JSON.parse(raw)))
  } catch {
    return []
  }
}
