/**
 * Lista projektów: które wiersze widać przy danych filtrach.
 *
 * Filtry z notatek (wszystko / tylko projekty / tylko wyceny, „Ukryj
 * nieprzyjęte") plus klient i rok z T3. Klienta filtrujemy po kluczu
 * znormalizowanym (`clientKey`), więc „Tchibo" i „tchibo " to ten sam wybór.
 *
 * Moduł czysty — testy w `project-list.test.ts`.
 */

import { clientKey } from './clients'
import { PROJECT_FILTERS, matchesFilter, toYear, type Project, type ProjectFilter } from './project-types'

export interface ProjectListQuery {
  filter: ProjectFilter
  hideLost: boolean
  /** Klucz klienta (`clientKey`); pusty = wszyscy. */
  client: string
  /** Rok daty księgowej; `null` = wszystkie lata. */
  year: number | null
  /** Tekst z wyszukiwarki (nazwa albo klient). */
  search?: string
}

type ListedProject = Pick<Project, 'name' | 'client' | 'status' | 'date'>

/** Filtry poza statusem — wspólne dla listy i licznika ukrytych nieprzyjętych. */
function matchesScope(project: ListedProject, query: ProjectListQuery): boolean {
  if (query.client && clientKey(project.client ?? '') !== query.client) return false
  if (query.year !== null && toYear(project.date) !== query.year) return false
  const q = clientKey(query.search ?? '')
  if (q && !clientKey(project.name ?? '').includes(q) && !clientKey(project.client ?? '').includes(q)) return false
  return true
}

export function filterProjectList<P extends ListedProject>(projects: P[], query: ProjectListQuery): P[] {
  return projects.filter(
    (p) => matchesScope(p, query) && matchesFilter(p.status, query.filter, { hideLost: query.hideLost })
  )
}

/**
 * Ile nieprzyjętych chowa „Ukryj nieprzyjęte" przy pozostałych filtrach
 * (klient, rok, szukanie) — liczba obok przełącznika.
 */
export function lostInScope(projects: ListedProject[], query: ProjectListQuery): number {
  return projects.filter((p) => p.status === 'lost' && matchesScope(p, query)).length
}

/** Lata, w których są projekty — malejąco (do listy wyboru roku). */
export function projectYears(projects: Pick<Project, 'date'>[]): number[] {
  const years = new Set<number>()
  projects.forEach((p) => {
    const year = toYear(p.date ?? '')
    if (year !== null) years.add(year)
  })
  return [...years].sort((a, b) => b - a)
}

// ── Zapamiętany wybór ────────────────────────────────────────────────────────

export interface ProjectListPrefs {
  filter: ProjectFilter
  client: string
  year: number | null
}

export const DEFAULT_LIST_PREFS: ProjectListPrefs = { filter: 'all', client: '', year: null }

/**
 * Odczyt zapamiętanego wyboru (localStorage). Wszystko, czego nie da się
 * odczytać, wraca do domyślnego — zepsuty zapis nie może ukryć projektów.
 */
export function parseListPrefs(raw: string | null): ProjectListPrefs {
  let value: unknown
  try {
    value = raw ? JSON.parse(raw) : null
  } catch {
    return DEFAULT_LIST_PREFS
  }
  if (!value || typeof value !== 'object') return DEFAULT_LIST_PREFS
  const r = value as Record<string, unknown>
  return {
    filter: (PROJECT_FILTERS as readonly unknown[]).includes(r.filter) ? (r.filter as ProjectFilter) : 'all',
    client: typeof r.client === 'string' ? clientKey(r.client) : '',
    year: typeof r.year === 'number' && Number.isInteger(r.year) && r.year > 1900 && r.year < 3000 ? r.year : null,
  }
}
