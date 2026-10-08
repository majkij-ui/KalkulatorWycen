/**
 * Co zapisać po kliknięciu „Zapisz" w pasku projektu — decyzja bez Reacta.
 *
 * Projekt bez wyceny (`quote: null`) otwiera się w CZYSTYM kalkulatorze. Taki
 * projekt może mieć finanse spoza kalkulatora (retro-import z przychodem i
 * kosztami, np. `p-retro2026-…`). Ślepy zapis policzyłby je od nowa z pustej
 * wyceny i po cichu wyzerował prawdziwy przychód w Finansach. Dlatego:
 *
 *   kalkulator nietknięty                   → wycena zostaje `null`, finanse bez zmian
 *   wycena zbudowana, projekt bez finansów  → zwykły zapis wyceny + policzone finanse
 *   wycena zbudowana, finanse spoza kalk.   → zapis dopiero po jawnym potwierdzeniu
 *
 * Projekt, który MA wycenę, zapisuje się jak dotąd: jego finanse zawsze
 * pochodzą z kalkulatora, więc przeliczenie niczego nie niszczy.
 */

import { computeSnapshotFinancials, mergeQuoteDataPartial } from './quote-financials'
import type { Project, ProjectFinancials } from './project-types'
import type { QuoteSnapshot } from './quote-library'
import type { QuoteData } from './quote-types'

/**
 * Migawka, którą `openProject` wgrywa dla projektu bez wyceny: czysty
 * kalkulator z klientem z wątku. Jedna definicja dla otwarcia i dla
 * `isBlankQuoteData`, żeby „nietknięty" znaczyło dokładnie „taki jak po otwarciu".
 */
export function blankQuoteSnapshot(client: string): { data: Partial<QuoteData>; marginMultiplier: number } {
  return { data: { clientName: client }, marginMultiplier: 1 }
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
  const current = { ...mergeQuoteDataPartial(data), clientName: '' }
  const blank = { ...mergeQuoteDataPartial(blankQuoteSnapshot('').data), clientName: '' }
  return sameJson(current, blank)
}

export type ProjectSavePlan =
  | {
      status: 'ready'
      project: Project
      /** `kept` — wycena i finanse projektu zostały nietknięte. */
      source: 'calculator' | 'kept'
    }
  | {
      /** Zapis nadpisałby finanse spoza kalkulatora — trzeba zapytać użytkownika. */
      status: 'needs-confirmation'
      current: ProjectFinancials
      proposed: ProjectFinancials | null
    }

export function planProjectSave(params: {
  project: Project
  /** Bieżący stan kalkulatora (`buildQuoteSnapshot()`). */
  snapshot: QuoteSnapshot
  /** Jawna zgoda na zastąpienie finansów spoza kalkulatora. */
  replaceFinancials?: boolean
  now?: Date
}): ProjectSavePlan {
  const { project, snapshot, replaceFinancials = false, now = new Date() } = params
  const updatedAt = now.toISOString()
  const client = snapshot.data.clientName || project.client

  if (!project.quote && isBlankQuoteData(snapshot.data)) {
    return { status: 'ready', source: 'kept', project: { ...project, client, updatedAt } }
  }

  const financials = computeSnapshotFinancials(snapshot, now)
  if (!project.quote && project.financials && !replaceFinancials) {
    return { status: 'needs-confirmation', current: project.financials, proposed: financials }
  }

  return {
    status: 'ready',
    source: 'calculator',
    project: { ...project, quote: snapshot, client, financials, updatedAt },
  }
}
