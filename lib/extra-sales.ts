/**
 * Dosprzedaż (U1, plan §18 U-DOSPRZEDAŻ, decyzja 18.3/5) — kategorie, fazy i
 * statystyki. Moduł czysty — testy w `extra-sales.test.ts`.
 *
 *  - Dosprzedaż to wydarzenie `extra_sale` w wątku projektu: kwota netto,
 *    notatka (`what`), data, numer faktury, a od U1 kategoria i faza.
 *  - KATEGORIA to tekst na wydarzeniu: wybrana z listy albo nowa, wpisana na
 *    miejscu (jak nowa osoba albo rola). Lista = trzy startowe + każda już
 *    użyta; nie ma osobnego pliku kategorii (fakty w wydarzeniach, lista liczona).
 *    Te same nazwy różniące się wielkością liter albo spacjami to jedna kategoria.
 *  - FAZA: przed realizacją / na planie / po projekcie (klucze na stałe).
 *  - Stare wydarzenia bez kategorii / fazy: „bez kategorii" / „bez fazy".
 *  - Statystyki okresu liczą się z projektów ZAKOTWICZONYCH w okresie (jak ich
 *    koszty): jak często dosprzedaję (projekty z dosprzedażą / wszystkie), średnia
 *    kwota, gdy się zdarza, i podział na kategorie i fazy.
 */

import type { ExtraSale, ExtraSalePhase, ProjectMoney } from './money-loop'

export const EXTRA_SALE_PHASES: readonly ExtraSalePhase[] = ['before', 'on_set', 'after']

export const EXTRA_SALE_PHASE_LABELS: Record<ExtraSalePhase, string> = {
  before: 'przed realizacją',
  on_set: 'na planie',
  after: 'po projekcie',
}

/** Kategorie na start (decyzja 18.3/5); kolejne dochodzą z użycia. */
export const EXTRA_SALE_SEED_CATEGORIES = ['dodatkowa produkcja', 'dodatkowa postprodukcja', 'surowe materiały'] as const

export const NO_CATEGORY = 'bez kategorii'
export const NO_PHASE = 'bez fazy'

/** Klucz porównania kategorii: bez wielkości liter i nadmiarowych spacji. */
export function categoryKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL')
}

/** Nazwa kategorii do zapisu: przycięta, pojedyncze spacje; pusta = brak. */
export function cleanCategory(name: string | null | undefined): string | undefined {
  const cleaned = (name ?? '').trim().replace(/\s+/g, ' ')
  return cleaned || undefined
}

export function isExtraSalePhase(value: unknown): value is ExtraSalePhase {
  return typeof value === 'string' && (EXTRA_SALE_PHASES as readonly string[]).includes(value)
}

export function phaseLabel(phase: ExtraSalePhase | undefined): string {
  return phase ? EXTRA_SALE_PHASE_LABELS[phase] : NO_PHASE
}

export function categoryLabel(category: string | undefined): string {
  return cleanCategory(category) ?? NO_CATEGORY
}

/**
 * Lista kategorii do wyboru: startowe, potem użyte (najczęstsze najpierw), bez
 * powtórzeń. Pisownia: startowa, a dla nowej — pierwsza napotkana.
 */
export function extraSaleCategories(extras: Pick<ExtraSale, 'category'>[]): string[] {
  const names = new Map<string, string>()
  const uses = new Map<string, number>()
  EXTRA_SALE_SEED_CATEGORIES.forEach((name) => names.set(categoryKey(name), name))
  extras.forEach((x) => {
    const name = cleanCategory(x.category)
    if (!name) return
    const key = categoryKey(name)
    if (!names.has(key)) names.set(key, name)
    uses.set(key, (uses.get(key) ?? 0) + 1)
  })
  const seeds = new Set(EXTRA_SALE_SEED_CATEGORIES.map(categoryKey))
  const used = [...names.keys()]
    .filter((key) => !seeds.has(key))
    .sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || names.get(a)!.localeCompare(names.get(b)!, 'pl'))
  return [...EXTRA_SALE_SEED_CATEGORIES, ...used.map((key) => names.get(key)!)]
}

export interface ExtraSaleGroup {
  /** Kategoria (pisownia z listy) albo „bez kategorii"; dla faz — etykieta fazy. */
  label: string
  /** Klucz: `categoryKey` / faza / `''` = brak. */
  key: string
  /** Ile dosprzedaży. */
  count: number
  /** Suma kwot (bez dosprzedaży bez kwoty). */
  total: number
  /** Średnia kwota jednej dosprzedaży z kwotą; `null` = żadna nie ma kwoty. */
  average: number | null
}

export interface ExtraSaleStats {
  /** Projekty okresu (zakotwiczone, liczone). */
  projects: number
  /** …z co najmniej jedną dosprzedażą. */
  withExtras: number
  /** Jak często: projekty z dosprzedażą / wszystkie, %; `null` = brak projektów. */
  sharePct: number | null
  /** Ile dosprzedaży. */
  count: number
  /** Suma kwot. */
  total: number
  /** Średnio na projekt, w którym była dosprzedaż z kwotą; `null` = żadnej. */
  averagePerProject: number | null
  byCategory: ExtraSaleGroup[]
  byPhase: ExtraSaleGroup[]
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function groups(
  extras: ExtraSale[],
  keyOf: (x: ExtraSale) => string,
  labelOf: (key: string, x: ExtraSale) => string,
  order: (a: ExtraSaleGroup, b: ExtraSaleGroup) => number
): ExtraSaleGroup[] {
  const map = new Map<string, ExtraSaleGroup & { priced: number }>()
  extras.forEach((x) => {
    const key = keyOf(x)
    const group = map.get(key) ?? { key, label: labelOf(key, x), count: 0, total: 0, average: null, priced: 0 }
    group.count += 1
    if (x.amount !== null) {
      group.total += x.amount
      group.priced += 1
    }
    map.set(key, group)
  })
  return [...map.values()]
    .map(({ priced, ...group }) => ({ ...group, average: priced > 0 ? group.total / priced : null }))
    .sort(order)
}

/**
 * Statystyki dosprzedaży dla projektów okresu. `rows` = projekty, które się
 * liczą (np. `marginSummary(...).projects`), z flagą zakotwiczenia w okresie.
 */
export function extraSaleStats(rows: { money: Pick<ProjectMoney, 'extras'>; anchored: boolean }[]): ExtraSaleStats {
  const anchored = rows.filter((row) => row.anchored)
  const withExtras = anchored.filter((row) => row.money.extras.length > 0)
  const extras = anchored.flatMap((row) => row.money.extras)
  const pricedProjects = anchored.filter((row) => row.money.extras.some((x) => x.amount !== null))
  const total = sum(extras.flatMap((x) => (x.amount === null ? [] : [x.amount])))
  const spelling = new Map(extraSaleCategories(extras).map((name) => [categoryKey(name), name]))
  const byTotal = (a: ExtraSaleGroup, b: ExtraSaleGroup) => b.total - a.total || b.count - a.count || a.label.localeCompare(b.label, 'pl')
  return {
    projects: anchored.length,
    withExtras: withExtras.length,
    sharePct: anchored.length > 0 ? (withExtras.length / anchored.length) * 100 : null,
    count: extras.length,
    total,
    averagePerProject: pricedProjects.length > 0 ? total / pricedProjects.length : null,
    byCategory: groups(
      extras,
      (x) => (cleanCategory(x.category) ? categoryKey(x.category!) : ''),
      (key) => (key ? (spelling.get(key) ?? key) : NO_CATEGORY),
      // „bez kategorii" zawsze na końcu.
      (a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : byTotal(a, b))
    ),
    byPhase: groups(
      extras,
      (x) => x.phase ?? '',
      (key) => (key ? EXTRA_SALE_PHASE_LABELS[key as ExtraSalePhase] : NO_PHASE),
      (a, b) => phaseRank(a.key) - phaseRank(b.key)
    ),
  }
}

function phaseRank(key: string): number {
  const index = (EXTRA_SALE_PHASES as readonly string[]).indexOf(key)
  return index === -1 ? EXTRA_SALE_PHASES.length : index
}

const MANAGED_KEYS = ['amountNetto', 'category', 'phase', 'what', 'number']

/**
 * Edycja dosprzedaży: pola z formularza zastępują swoje odpowiedniki (puste
 * znika), nieznane pola wydarzenia zostają nietknięte (passthrough).
 */
export function editedExtraSaleData(previous: Record<string, unknown> | undefined, input: Parameters<typeof extraSaleData>[0]): Record<string, unknown> {
  const kept = Object.fromEntries(Object.entries(previous ?? {}).filter(([key]) => !MANAGED_KEYS.includes(key)))
  return { ...kept, ...extraSaleData(input) }
}

/** Dane wydarzenia `extra_sale` z formularza w Finansach (bez pustych pól). */
export function extraSaleData(input: {
  amountNetto: number
  category?: string | null
  phase?: ExtraSalePhase | null
  what?: string | null
  number?: string | null
}): Record<string, unknown> {
  const category = cleanCategory(input.category)
  const what = (input.what ?? '').trim()
  const number = (input.number ?? '').trim()
  return {
    amountNetto: Math.round(input.amountNetto * 100) / 100,
    ...(category ? { category } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
    ...(what ? { what } : {}),
    ...(number ? { number } : {}),
  }
}
