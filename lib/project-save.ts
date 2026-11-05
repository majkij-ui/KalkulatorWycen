/**
 * Co zapisać, gdy wycena projektu zapisuje się sama (`quote-documents.ts`) —
 * decyzja bez Reacta.
 *
 * Projekt bez wyceny (`quote: null`) otwiera się z PUSTĄ wyceną. Taki
 * projekt może mieć finanse spoza kalkulatora (retro-import z przychodem i
 * kosztami, np. `p-retro2026-…`):
 *
 *   wycena nietknięta (ani PDF)             → wycena zostaje `null`, finanse bez zmian
 *   wycena zbudowana, projekt bez finansów  → zwykły zapis wyceny + policzone finanse
 *   wycena zbudowana, finanse z importu     → zapis OD RAZU, bez pytania; przychód
 *                                             z importu zostaje CENĄ KOŃCOWĄ
 *                                             (`approvedPrice` ze źródłem `import`,
 *                                             `final-price.ts`) — edycja wyceny jej nie rusza
 *
 * Projekt, który MA wycenę, zapisuje się jak dotąd.
 */

import { computeSnapshotFinancials, mergeQuoteDataPartial } from './quote-financials'
import { stampImportedPrice } from './final-price'
import type { Project, ProjectFinancials } from './project-types'
import type { QuoteSnapshot } from './quote-library'
import type { PricingConfigShape } from './pricing-config'
import type { QuoteData } from './quote-types'
import { newQuoteExtras, noExtras } from './quote-extras'

/**
 * Pusta wycena projektu bez wyceny: klient z wątku. Jedna definicja dla
 * dokumentu (`blankDoc`) i dla `isBlankQuoteData`, żeby „nietknięta" znaczyło
 * dokładnie „taka jak po otwarciu".
 *
 * `pricing` = cennik domyślny użytkownika: nowa wycena startuje od niego. Bez
 * zapisanego domyślnego klucza nie ma, a dokument bierze cennik fabryczny.
 *
 * R1 (A5): każda nowa wycena (nowy projekt, lead, „Pusta wycena") pokazuje
 * marżę z nagłówka jako osobną pozycję (`marginAsLine`).
 */
export function blankQuoteSnapshot(
  client: string,
  pricing?: PricingConfigShape | null
): { data: Partial<QuoteData>; marginMultiplier: number; pricingConfig?: PricingConfigShape } {
  return {
    // W1: nowa wycena zaczyna z ustawieniami praw i surowego materiału z Cennika.
    data: { clientName: client, marginAsLine: true, ...newQuoteExtras() },
    marginMultiplier: 1,
    ...(pricing ? { pricingConfig: pricing } : {}),
  }
}

/** Głębokie porównanie danych JSON; klucz z `undefined` traktujemy jak brak klucza. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameJson(item, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const key of keys) {
    if (!sameJson(ra[key], rb[key])) return false
  }
  return true
}

/**
 * Czy dane kalkulatora to wciąż pusta wycena. Klient się nie liczy — wpisanie
 * samego klienta nie jest budowaniem wyceny (trafia do `project.client`).
 * Marża i cennik też nie: bez pozycji w wycenie nie zmieniają żadnej kwoty.
 */
export function isBlankQuoteData(data: Partial<QuoteData>): boolean {
  // Sposób pokazania marży (R1) to nie budowanie wyceny — stara pusta wycena bez flagi też jest pusta.
  // To samo dla ustawień W1 (tryby praw i surowego materiału): sama zmiana trybu nie jest wyceną.
  const ignored = { clientName: '', marginAsLine: undefined, ...noExtras }
  const current = { ...mergeQuoteDataPartial(data), ...ignored }
  const blank = { ...mergeQuoteDataPartial(blankQuoteSnapshot('').data), ...ignored }
  return sameJson(current, blank)
}

/**
 * Klient projektu po zapisie. Od T3 klienta ustawia się w nagłówku projektu —
 * to on grupuje projekty i liczy przychód klienta. Pole „Nazwa klienta" w
 * zakładce PDF to etykieta na wydruku (np. pełna nazwa spółki) i nie nadpisuje
 * klienta projektu; uzupełnia go tylko, gdy projekt klienta jeszcze nie ma.
 */
export function clientAfterSave(project: Pick<Project, 'client'>, snapshot: Pick<QuoteSnapshot, 'data'>): string {
  return project.client.trim() ? project.client : (snapshot.data.clientName ?? '').trim()
}

export interface ProjectSavePlan {
  project: Project
  /** `kept` — wycena i finanse projektu zostały nietknięte. */
  source: 'calculator' | 'kept'
}

export function planProjectSave(params: {
  project: Project
  /** Bieżący dokument wyceny (`docToSnapshot`). */
  snapshot: QuoteSnapshot
  now?: Date
}): ProjectSavePlan {
  const { project, now = new Date() } = params
  const updatedAt = now.toISOString()
  const client = clientAfterSave(project, params.snapshot)

  // Szkic PDF to też praca: edytowany PDF zakłada wycenę jak każda zmiana.
  if (!project.quote && isBlankQuoteData(params.snapshot.data) && params.snapshot.pdfDraft == null) {
    return { source: 'kept', project: { ...project, client, updatedAt } }
  }

  // Pierwsza wycena projektu z importu: przychód z importu to cena końcowa.
  const imported = !project.quote && project.financials ? project.financials : null
  const snapshot = imported ? stampImportedPrice(params.snapshot, imported, updatedAt) : params.snapshot
  const financials = computeSnapshotFinancials(snapshot, now)
  return { source: 'calculator', project: { ...project, quote: snapshot, client, financials, updatedAt } }
}
