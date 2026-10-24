/**
 * Koszty w Realizacji po R2 (plan §13.1 B2, B3, D1; decyzje M.J. 2026-10-18) —
 * czyste funkcje, bez Reacta.
 *
 * JEDNA lista kosztów rzeczywistych: `Project.costs`. Plan to kalkulator (stawki
 * bez marży) z dawnymi poprawkami z Profitu, które zostają w wycenie i dalej się
 * liczą. Realizacja zaczyna od planu i jest poprawiana ręcznie:
 *
 *   tryb `draft`  — w Realizacji nie ma jeszcze żywego wiersza: zakładka pokazuje
 *                   plan na żywo (z wyceny), nic nie jest zapisane, Finanse liczą
 *                   plan — ta sama suma.
 *   pierwsza zmiana (zaznaczenie, kwota, „Moja praca", osoba, nowy wiersz)
 *                 — zapisuje CAŁY szkic jako wiersze (`planKey`, `source: plan`),
 *                   potem tę zmianę (`startFromQuote`). Od tej chwili Realizacja
 *                   jest prawdą (decyzja Q2, wariant A).
 *   tryb `quote`  — późniejsze zmiany wyceny nigdy nie wchodzą same: baner
 *                   „Wycena zmieniła się" (`quoteChanges`) rusza tylko wiersze
 *                   nigdy nie zmienione ręcznie, usuwa miękko, z „Cofnij".
 *   tryb `legacy` — koszty wpisane przed R2 (bez `costsFromQuoteAt`): zostają
 *                   dokładnie jak są i liczą się jak dotąd. Pozycje planu, których
 *                   tu nie widać, są listą „W wycenie, nie ma w Realizacji"
 *                   (`missingFromQuote`, niczego nie liczy); cichy przycisk
 *                   „Zacznij od wyceny" (`restartFromQuote`) zastępuje wpisane
 *                   wierszami planu, po potwierdzeniu i z „Cofnij".
 *
 * Układ (B2 / B3): „Koszty projektu" na górze — wszystko, co nie należy do dnia
 * (preprodukcja, postprodukcja, dojazd, catering, nocleg, wynajem na całość,
 * sprzęt kupiony, inne); dni — ekipa i sprzęt z wypożyczalni, dzień N wyceny →
 * N-ty dzień zdjęciowy. Szybka wycena nie ma dni: jej ekipa to jedna pozycja
 * nad dniami. Wynajem zawsze w kategorii `wynajem` (plan §17.1 zsumuje go).
 */

import { crewLineKey, isRentalCostKey, resolveProfitSections, type ProfitLine } from './profit-calc'
import { costAmount, isCrew, isOwnWork, liveCosts, makeCost } from './project-costs'
import type { Project, ProjectCost } from './project-types'
import { computeTotalCrewDays, quoteViews, resolveSnapshot, type FinancialsSource } from './quote-financials'
import { planLineCategory } from './realization-plan'
import { safeArray } from './safe-numbers'

/** Pozycja planu w kształcie wiersza Realizacji (jeszcze bez id i daty zapisu). */
export interface PlanRow {
  planKey: string
  category: string
  label?: string
  person?: string
  personId?: string
  role?: string
  quantity: number
  unitCost: number
  skipped?: true
  ownWork?: true
  /** Dzień wyceny (0 = pierwszy) pozycji dziennej; `null` = pozycja całego projektu albo wszystkich dni. */
  quoteDay: number | null
  /** `days` — ekipa i sprzęt (pod dniami), `project` — „Koszty projektu". */
  block: 'days' | 'project'
  /** Jednostka ilości z planu („km", „osobodzień") — do opisu. */
  unitLabel?: string
}

export type RealizationMode = 'draft' | 'quote' | 'legacy'

/** Wiersz Realizacji przed nadaniem id (pola jak w `ProjectCost`). */
export type CostInit = {
  category: string
  unitCost: number
  quantity?: number
  label?: string
  person?: string
  personId?: string
  role?: string
  dayId?: string
  source?: string
  planKey?: string
  skipped?: true
  ownWork?: true
} & Record<string, unknown>

const COPY = /#\d+$/

/** Klucz pozycji planu bez numeru kopii („× 2" → `#2`). */
export function basePlanKey(key: string): string {
  return key.replace(COPY, '')
}

/**
 * Dzień wyceny pozycji dziennej z jej klucza (`pro:<dzień>:<rola>`,
 * `pro:<dzień>:crew:<id>`, `pro:<dzień>:rental:<id>`); `quick` = ekipa szybkiej
 * wyceny (wszystkie dni); `null` = pozycja całego projektu.
 */
export function planKeyDay(key: string | undefined): string | 'quick' | null {
  if (!key) return null
  // `pro:quick:…` daje tu „quick" — ekipa szybkiej wyceny, wszystkie dni.
  const match = basePlanKey(key).match(/^pro:([^:]+):/)
  return match ? match[1] : null
}

function isDayCrewKey(line: Pick<ProfitLine, 'key' | 'quoteDayId' | 'role'>): boolean {
  return !!line.quoteDayId && !!line.role && !isRentalCostKey(line.key)
}

/**
 * Wiersze szkicu z pozycji planu (`resolveProfitSections` na widoku kosztów).
 * Suma zaznaczonych pozycji zewnętrznych = koszty planu, moja praca = `ownWork`
 * planu. Pozycja ekipy „× N" (całe osoby) to N wierszy po jednej osobie —
 * osoba z wyceny siedzi w pierwszym. Pusty „Rental sprzętu" (0 zł, odznaczony
 * — domyślna podpowiedź Profitu) się nie pojawia.
 */
export function planRows(lines: ProfitLine[], quoteDayIds: string[]): PlanRow[] {
  const dayIndex = new Map(quoteDayIds.map((id, i) => [id, i]))
  const rows: PlanRow[] = []
  lines.forEach((line) => {
    if (line.key === 'pro:rentalSprzetu' && !line.isCost && line.quantity * line.unitCost === 0) return
    const common = {
      quantity: line.quantity,
      unitCost: line.unitCost,
      ...(line.isCost ? {} : { skipped: true as const }),
      ...(line.ownWork ? { ownWork: true as const } : {}),
      unitLabel: line.unitLabel,
    }
    if (isDayCrewKey(line)) {
      const quoteDay = dayIndex.get(line.quoteDayId!) ?? null
      const crew = {
        category: 'ekipa',
        role: line.role,
        quoteDay,
        block: 'days' as const,
      }
      const whole = Number.isInteger(line.quantity) && line.quantity > 1
      const copies = whole ? line.quantity : 1
      for (let copy = 1; copy <= copies; copy += 1) {
        rows.push({
          ...common,
          ...crew,
          planKey: copy === 1 ? line.key : `${line.key}#${copy}`,
          quantity: whole ? 1 : line.quantity,
          ...(copy === 1 && line.personId ? { personId: line.personId, person: line.personName ?? '' } : { person: '' }),
        })
      }
      return
    }
    if (line.quoteDayId && isRentalCostKey(line.key)) {
      rows.push({
        ...common,
        planKey: line.key,
        category: 'wynajem',
        label: line.label,
        quoteDay: dayIndex.get(line.quoteDayId) ?? null,
        block: 'days',
      })
      return
    }
    if (line.key.startsWith('pro:quick:')) {
      rows.push({
        ...common,
        planKey: line.key,
        category: 'ekipa',
        role: line.key === 'pro:quick:ekipa' ? 'Ekipa (szybka wycena)' : line.label,
        person: '',
        label: line.detail,
        quoteDay: null,
        block: 'days',
      })
      return
    }
    rows.push({
      ...common,
      planKey: line.key,
      category: line.key === 'pro:rentalSprzetu' ? 'wynajem' : planLineCategory(line),
      label: line.key === 'pro:rentalSprzetu' ? 'Wynajem sprzętu' : line.label,
      quoteDay: null,
      block: 'project',
    })
  })
  return rows
}

/**
 * Pozycje planu wyceny projektu (dokument na żywo albo zapisana migawka): te
 * same, z których liczą się koszty planu w `financials`. Brak wyceny = pusto.
 */
export function quotePlanRows(snapshot: FinancialsSource | null | undefined): { rows: PlanRow[]; quoteDayIds: string[] } {
  const resolved = resolveSnapshot(snapshot)
  if (!resolved) return { rows: [], quoteDayIds: [] }
  const { data, pricing } = resolved
  const { sections } = resolveProfitSections(quoteViews(data, pricing).cost, pricing, computeTotalCrewDays(data))
  const quoteDayIds = data.isDetailedProdukcja ? safeArray<{ id: string }>(data.detailedShootingDays).map((d) => d.id) : []
  return { rows: planRows(sections.flatMap((s) => s.lines), quoteDayIds), quoteDayIds }
}

/** Dzień Realizacji dla pozycji dziennej: N-ty dzień zdjęciowy; brak = dzień wyceny bez odpowiednika. */
function dayFor(row: PlanRow, shootDayIds: string[]): string | undefined {
  return row.block === 'days' && row.quoteDay !== null ? shootDayIds[row.quoteDay] : undefined
}

/** Wiersz Realizacji z pozycji planu (bez id — `makeCost` je nadaje). */
export function rowToCost(row: PlanRow, shootDayIds: string[]): CostInit {
  const dayId = dayFor(row, shootDayIds)
  return {
    category: row.category,
    unitCost: row.unitCost,
    quantity: row.quantity,
    ...(row.label ? { label: row.label } : {}),
    ...(row.category === 'ekipa' ? { person: row.person ?? '', role: row.role ?? '' } : {}),
    ...(row.personId ? { personId: row.personId } : {}),
    ...(dayId ? { dayId } : {}),
    source: 'plan',
    planKey: row.planKey,
    ...(row.skipped ? { skipped: true as const } : {}),
    ...(row.ownWork ? { ownWork: true as const } : {}),
  }
}

/** Szkic do pokazania (tryb `draft`): wiersze bez zapisu, id `draft:<planKey>`. */
export function draftCosts(rows: PlanRow[], shootDayIds: string[]): ProjectCost[] {
  return rows.map((row) => ({ ...rowToCost(row, shootDayIds), id: draftId(row.planKey) }))
}

const DRAFT = 'draft:'
export const draftId = (planKey: string) => `${DRAFT}${planKey}`
export const isDraftId = (id: string) => id.startsWith(DRAFT)

/** W jakim trybie jest Realizacja projektu (patrz nagłówek modułu). */
export function realizationMode(project: Pick<Project, 'costs' | 'costsFromQuoteAt'>): RealizationMode {
  if (liveCosts(project.costs).length === 0) return 'draft'
  return project.costsFromQuoteAt ? 'quote' : 'legacy'
}

export interface StartResult {
  costs: ProjectCost[]
  /** planKey → id zapisanego wiersza (żeby pierwsza zmiana trafiła w swój wiersz). */
  ids: Map<string, string>
  startedAt: string
}

/**
 * Pierwsza zmiana w Realizacji (tryb `draft`): cały szkic jako wiersze, po
 * dotychczasowych (usuniętych) rekordach. Suma = plan w tej chwili.
 */
export function startFromQuote(
  costs: ProjectCost[],
  rows: PlanRow[],
  shootDayIds: string[],
  now: Date = new Date()
): StartResult {
  const ids = new Map<string, string>()
  const added = rows.map((row) => {
    const cost = makeCost(rowToCost(row, shootDayIds), now)
    ids.set(row.planKey, cost.id)
    return cost
  })
  return { costs: [...costs, ...added], ids, startedAt: now.toISOString() }
}

/** Zmiana wiersza ręcznie: wiersz z planu dostaje `edited` — zmiany wyceny go nie ruszają. */
export function editPatch(cost: Pick<ProjectCost, 'planKey'>, patch: Partial<ProjectCost>): Partial<ProjectCost> {
  return cost.planKey ? { ...patch, edited: true } : patch
}

/** Zaznaczenie („było" / „tego nie było"). */
export function tickPatch(cost: Pick<ProjectCost, 'planKey'>, counted: boolean): Partial<ProjectCost> {
  return editPatch(cost, { skipped: counted ? undefined : true })
}

/** „Zewnętrzny | Moja praca". */
export function workPatch(cost: Pick<ProjectCost, 'planKey'>, own: boolean): Partial<ProjectCost> {
  return editPatch(cost, { ownWork: own ? true : undefined })
}

/** Patch bez kluczy `undefined` — `updateCost` rozkłada go na wierszu, więc usuwamy je jawnie. */
export function applyPatch(cost: ProjectCost, patch: Partial<ProjectCost>): ProjectCost {
  const next: Record<string, unknown> = { ...cost, ...patch }
  Object.keys(patch).forEach((key) => {
    if ((patch as Record<string, unknown>)[key] === undefined) delete next[key]
  })
  return next as ProjectCost
}

// ── Zmiany wyceny po starcie (tryb `quote`) ──────────────────────────────────

export interface QuoteChange {
  type: 'added' | 'changed' | 'removed'
  planKey: string
  /** Wiersz zapisany (zmieniony / usuwany). */
  cost?: ProjectCost
  /** Pozycja planu teraz (dodana / zmieniona). */
  row?: PlanRow
  /** Koszty zewnętrzne: po − przed. */
  delta: number
}

export interface QuoteChanges {
  changes: QuoteChange[]
  added: number
  changed: number
  removed: number
  /** Koszty (zewnętrzne, zaznaczone) po uwzględnieniu − teraz. */
  delta: number
  /** Moja praca po uwzględnieniu − teraz. */
  ownDelta: number
  /** Podpis listy — „Ukryj" trzyma go, dopóki wycena znowu się nie zmieni. */
  signature: string
}

const external = (cost: Pick<ProjectCost, 'skipped' | 'ownWork' | 'quantity' | 'unitCost'>) =>
  cost.skipped || isOwnWork(cost) ? 0 : costAmount(cost)

const own = (cost: Pick<ProjectCost, 'skipped' | 'ownWork' | 'quantity' | 'unitCost'>) =>
  !cost.skipped && isOwnWork(cost) ? costAmount(cost) : 0

const FIELDS = ['category', 'label', 'person', 'personId', 'role', 'quantity', 'unitCost', 'skipped', 'ownWork'] as const

function differs(cost: ProjectCost, next: CostInit): boolean {
  return FIELDS.some((field) => (cost[field] ?? null) !== (next[field] ?? null))
}

/**
 * Co zmieniło się w wycenie od startu Realizacji: nowe pozycje planu (klucza nie
 * ma w żadnym rekordzie — także usuniętym, bo usunięty wiersz to decyzja),
 * zmienione pozycje przy wierszach nigdy nie poprawianych ręcznie i usunięte z
 * wyceny (żywe, niepoprawiane). Wiersze z `edited` nie wchodzą nigdy.
 */
export function quoteChanges(costs: ProjectCost[], rows: PlanRow[], shootDayIds: string[]): QuoteChanges {
  const keys = new Set(costs.flatMap((c) => (c.planKey ? [c.planKey] : [])))
  const rowByKey = new Map(rows.map((r) => [r.planKey, r]))
  const changes: QuoteChange[] = []
  rows.forEach((row) => {
    if (keys.has(row.planKey)) return
    changes.push({ type: 'added', planKey: row.planKey, row, delta: external(rowToCost(row, shootDayIds)) })
  })
  liveCosts(costs).forEach((cost) => {
    if (!cost.planKey || cost.edited) return
    const row = rowByKey.get(cost.planKey)
    if (!row) {
      changes.push({ type: 'removed', planKey: cost.planKey, cost, delta: -external(cost) })
      return
    }
    const next = rowToCost(row, shootDayIds)
    if (differs(cost, next)) changes.push({ type: 'changed', planKey: cost.planKey, cost, row, delta: external(next) - external(cost) })
  })
  const count = (type: QuoteChange['type']) => changes.filter((c) => c.type === type).length
  return {
    changes,
    added: count('added'),
    changed: count('changed'),
    removed: count('removed'),
    delta: changes.reduce((sum, c) => sum + c.delta, 0),
    ownDelta: changes.reduce((sum, c) => {
      const after = c.type === 'removed' || !c.row ? 0 : own(rowToCost(c.row, shootDayIds))
      const before = c.cost ? own(c.cost) : 0
      return sum + after - before
    }, 0),
    signature: changes
      .map((c) => `${c.type}:${c.planKey}:${c.row ? `${c.row.quantity}x${c.row.unitCost}${c.row.skipped ? 's' : ''}${c.row.ownWork ? 'o' : ''}` : ''}`)
      .sort()
      .join('|'),
  }
}

/**
 * „Uwzględnij": nowe pozycje jako wiersze, zmienione nadpisane (dzień i id
 * zostają), usunięte z wyceny — miękko usunięte znacznikiem `stamp`.
 */
export function applyQuoteChanges(
  costs: ProjectCost[],
  changes: QuoteChange[],
  shootDayIds: string[],
  now: Date = new Date()
): ProjectCost[] {
  const stamp = now.toISOString()
  const byId = new Map(changes.filter((c) => c.cost).map((c) => [c.cost!.id, c]))
  const next = costs.map((cost) => {
    const change = byId.get(cost.id)
    if (!change) return cost
    if (change.type === 'removed') return { ...cost, deletedAt: stamp }
    // Pola pozycji z planu teraz; brakujące (np. `skipped`) znikają. Dzień i id zostają.
    const fresh = rowToCost(change.row!, shootDayIds)
    const patch: Record<string, unknown> = {}
    FIELDS.forEach((field) => {
      patch[field] = fresh[field]
    })
    return applyPatch(cost, patch as Partial<ProjectCost>)
  })
  const added = changes.filter((c) => c.type === 'added').map((c) => makeCost(rowToCost(c.row!, shootDayIds), now))
  return [...next, ...added]
}

// ── Koszty sprzed R2 (tryb `legacy`) ─────────────────────────────────────────

export interface MissingRows {
  /** Zaznaczone w planie, a w Realizacji ich nie widać. */
  counted: PlanRow[]
  /** Odznaczone w planie („nie mój koszt") — np. moja praca do oznaczenia. */
  skipped: PlanRow[]
  /** Koszty zewnętrzne zaznaczonych. */
  total: number
  signature: string
}

/**
 * Pozycje planu, których nie ma w kosztach wpisanych przed R2. Wpisy nie mają
 * kluczy planu, więc „jest" znaczy: ten dzień ma już ekipę (dla ekipy) albo
 * wynajem (dla wypożyczalni), ekipa szybkiej wyceny — jakakolwiek ekipa,
 * reszta — wiersz tej samej kategorii gdziekolwiek w projekcie. Dodana z listy
 * pozycja ma już swój klucz.
 */
export function missingFromQuote(costs: ProjectCost[], rows: PlanRow[], shootDayIds: string[]): MissingRows {
  const live = liveCosts(costs)
  const keys = new Set(costs.flatMap((c) => (c.planKey ? [c.planKey] : [])))
  const manual = live.filter((c) => !c.planKey)
  const categories = new Set(manual.map((c) => c.category))
  const covered = (row: PlanRow): boolean => {
    if (keys.has(row.planKey)) return true
    if (row.block === 'days') {
      if (row.quoteDay === null) return row.category === 'ekipa' ? manual.some(isCrew) : categories.has(row.category)
      const dayId = shootDayIds[row.quoteDay]
      if (!dayId) return false
      return manual.some((c) => c.dayId === dayId && (row.category === 'ekipa' ? isCrew(c) : c.category === row.category))
    }
    return categories.has(row.category)
  }
  const open = rows.filter((row) => !covered(row))
  const counted = open.filter((row) => !row.skipped)
  const skipped = open.filter((row) => row.skipped && row.quantity * row.unitCost > 0)
  return {
    counted,
    skipped,
    total: counted.reduce((sum, row) => sum + (row.ownWork ? 0 : row.quantity * row.unitCost), 0),
    signature: open
      .map((r) => `${r.planKey}:${r.quantity}x${r.unitCost}${r.skipped ? 's' : ''}`)
      .sort()
      .join('|'),
  }
}

/** „Dodaj" z listy — jeden wiersz planu (z kluczem, w swoim dniu). */
export function addPlanRow(costs: ProjectCost[], row: PlanRow, shootDayIds: string[], now: Date = new Date()): ProjectCost[] {
  return [...costs, makeCost(rowToCost(row, shootDayIds), now)]
}

/**
 * „Zacznij od wyceny" (tryb `legacy`): wpisane wiersze miękko usunięte
 * znacznikiem `stamp`, w ich miejsce szkic z planu. „Cofnij" = poprzednia lista.
 */
export function restartFromQuote(
  costs: ProjectCost[],
  rows: PlanRow[],
  shootDayIds: string[],
  now: Date = new Date()
): StartResult & { stamp: string } {
  const stamp = now.toISOString()
  const cleared = costs.map((c) => (c.deletedAt ? c : { ...c, deletedAt: stamp }))
  return { ...startFromQuote(cleared, rows, shootDayIds, now), stamp }
}

// ── Układ zakładki ───────────────────────────────────────────────────────────

export interface RealizationLayout {
  /** „Koszty projektu" (B2). */
  project: ProjectCost[]
  /** Wiersze dni (ekipa, sprzęt, inne koszty dnia). */
  byDay: Map<string, ProjectCost[]>
  /** Ekipa szybkiej wyceny / dni bez odpowiednika — nad dniami, po dniu wyceny. */
  unassigned: { quoteDay: number | null; costs: ProjectCost[] }[]
}

/**
 * Gdzie pokazać wiersz: z żywym dniem — w tym dniu; pozycja dzienna z planu bez
 * dnia — w grupie „Dzień N z wyceny" (albo „wszystkie dni" dla szybkiej wyceny);
 * reszta — w „Kosztach projektu" (także wiersz, którego dnia już nie ma).
 */
export function layoutRealization(costs: ProjectCost[], dayIds: string[], quoteDayIds: string[]): RealizationLayout {
  const days = new Set(dayIds)
  const quoteIndex = new Map(quoteDayIds.map((id, i) => [id, i]))
  const byDay = new Map<string, ProjectCost[]>(dayIds.map((id) => [id, []]))
  const project: ProjectCost[] = []
  const groups = new Map<string, { quoteDay: number | null; costs: ProjectCost[] }>()
  liveCosts(costs).forEach((cost) => {
    if (cost.dayId && days.has(cost.dayId)) {
      byDay.get(cost.dayId)!.push(cost)
      return
    }
    const day = planKeyDay(cost.planKey)
    if (day) {
      const quoteDay = day === 'quick' ? null : (quoteIndex.get(day) ?? null)
      const key = String(quoteDay)
      const group = groups.get(key) ?? { quoteDay, costs: [] }
      group.costs.push(cost)
      groups.set(key, group)
      return
    }
    project.push(cost)
  })
  const unassigned = [...groups.values()].sort((a, b) => (a.quoteDay ?? -1) - (b.quoteDay ?? -1))
  return { project, byDay, unassigned }
}

/** Klucz pozycji ekipy z bazy w dniu wyceny (re-eksport dla testów i ekranów). */
export { crewLineKey }

// ── Dojazd jedną kwotą (U2, U-DOJAZD) ────────────────────────────────────────

/**
 * Dojazd (paliwo) to w Realizacji jedna kwota — domyślnie z wyceny, do
 * poprawienia — a nie km × zł/km. Wiersz z planu zostaje zapisany tak, jak
 * przyszedł (2 500 km × 0,52 zł), i pokazuje swoją kwotę (1 300 zł), więc nic
 * się nie zmienia, dopóki kwoty nie poprawisz; poprawka zapisuje 1 × kwota.
 */
export function isPlainAmount(cost: Pick<ProjectCost, 'category'>): boolean {
  return cost.category === 'dojazd'
}

export function plainAmountPatch(amount: number): Pick<ProjectCost, 'quantity' | 'unitCost'> {
  return { quantity: 1, unitCost: Math.max(0, Number.isFinite(amount) ? amount : 0) }
}
