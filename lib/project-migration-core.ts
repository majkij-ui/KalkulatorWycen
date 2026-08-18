/**
 * Czysta logika migracji wycen → projekty.
 *
 * Wydzielona z `project-migration.ts`, bo tamten moduł dotyka Tauri/localStorage
 * i nie da się go uruchomić w testach. Tu jest samo mapowanie — deterministyczne
 * i pokryte testami (`project-migration-core.test.ts`).
 */

import type { SavedQuoteRecord } from './quote-library'
import type { Project } from './project-types'
import { createProjectId, toDateKey } from './project-types'

/** Identyfikatory wycen już przeniesionych do projektów. */
export function readMigratedIds(projects: Project[]): Set<string> {
  const ids = new Set<string>()
  projects.forEach((p) => {
    const origin = p.migratedFromQuoteId
    if (typeof origin === 'string' && origin) ids.add(origin)
  })
  return ids
}

/**
 * Data księgowa projektu: dzień ZAPISANIA wyceny, nie dzień migracji —
 * inaczej cała historia wylądowałaby w miesiącu, w którym uruchomiono v3.
 */
export function ledgerDateFor(quote: SavedQuoteRecord, now: Date = new Date()): string {
  const source = quote.createdAt || quote.snapshot?.savedAt || quote.updatedAt
  if (typeof source === 'string' && source) {
    const parsed = new Date(source)
    if (!Number.isNaN(parsed.getTime())) return toDateKey(parsed)
  }
  return toDateKey(now)
}

/** Mapuje zapisaną wycenę na projekt. Migawka wędruje w całości. */
export function quoteToProject(quote: SavedQuoteRecord, now: Date = new Date()): Project {
  const nowIso = now.toISOString()
  const clientName =
    typeof quote.snapshot?.data?.clientName === 'string' ? quote.snapshot.data.clientName : ''

  return {
    id: createProjectId(),
    name: quote.name || 'Bez nazwy',
    client: clientName,
    // Każda przeniesiona wycena startuje jako wycena — o tym, co faktycznie
    // weszło, decyduje użytkownik w liście projektów.
    status: 'quote',
    date: ledgerDateFor(quote, now),
    createdAt: quote.createdAt || nowIso,
    updatedAt: quote.updatedAt || nowIso,
    quote: quote.snapshot,
    financials: null,
    equipment: [],
    notes: '',
    migratedFromQuoteId: quote.id,
  }
}

/** Wyceny jeszcze nieprzeniesione. */
export function pendingQuotes(
  quotes: SavedQuoteRecord[],
  existingProjects: Project[]
): SavedQuoteRecord[] {
  const migrated = readMigratedIds(existingProjects)
  return quotes.filter((q) => !migrated.has(q.id))
}
