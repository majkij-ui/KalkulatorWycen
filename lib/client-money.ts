/**
 * Przychód projektu dla Klientów i filtra klienta w Projektach (S2 — „glue"
 * po T6, plan §6e): ta sama NAJLEPSZA WIEDZA co w Finansach, nie plan.
 *
 * Źródłem jest pętla pieniędzy (`money-loop.ts`, `projectMoney`): faktury, gdy
 * są pełne, inaczej plan + dodatki; każdy kawałek przychodu ma swoją datę
 * (faktura w miesiącu wystawienia, reszta w kotwicy projektu). Rok liczymy
 * więc po kawałkach, nie po dacie księgowej projektu.
 *
 * Ten moduł bierze z pętli tylko TYPY — mapę liczy ekran (`useProjectMoney`)
 * albo test (`moneyLedger`) — bo `money-loop` sam importuje `client-stats`.
 * Bez mapy liczy się plan (`financials`, data księgowa), czyli dokładnie to,
 * co pętla daje projektowi bez faktur, wpłat i dodatków.
 *
 * Moduł czysty.
 */

import type { ProjectMoney } from './money-loop'
import { toYear, type Project } from './project-types'

/** Tyle z `ProjectMoney`, ile potrzebują Klienci i Projekty. */
export type ClientMoney = Pick<ProjectMoney, 'revenue' | 'profit' | 'pieces' | 'anchor' | 'revenueBasis'>

/** Pieniądze projektów po id (`moneyLedger` → `Map`). */
export type MoneyById = ReadonlyMap<string, ClientMoney>

/** Plan z `financials` w kształcie pętli: cały przychód w dacie księgowej. */
export function planMoney(project: Pick<Project, 'date' | 'financials'>): ClientMoney {
  const revenue = project.financials ? project.financials.sumaNetto : null
  return {
    revenue,
    profit: project.financials ? project.financials.zysk : null,
    pieces: revenue === null ? [] : [{ day: project.date, amount: revenue, source: 'plan', paid: false }],
    anchor: project.date,
    revenueBasis: revenue === null ? 'none' : 'plan',
  }
}

/** Pieniądze projektu: z mapy (pętla), a bez niej — plan. */
export function moneyOf(
  project: Pick<Project, 'id' | 'date' | 'financials'>,
  money: MoneyById | null | undefined
): ClientMoney {
  return money?.get(project.id) ?? planMoney(project)
}

/** Przychód projektu w roku (kawałki z datą w tym roku); `null` = cały. Nieznany = 0. */
export function revenueInYear(money: ClientMoney, year: number | null): number {
  if (year === null) return money.revenue ?? 0
  return money.pieces.reduce((sum, piece) => (toYear(piece.day) === year ? sum + piece.amount : sum), 0)
}

/** Lata, w których projekt ma przychód; bez przychodu — rok kotwicy. Malejąco. */
export function revenueYears(money: ClientMoney): number[] {
  const days = money.pieces.length > 0 ? money.pieces.map((piece) => piece.day) : [money.anchor]
  const years = new Set<number>()
  days.forEach((day) => {
    const year = toYear(day)
    if (year !== null) years.add(year)
  })
  return [...years].sort((a, b) => b - a)
}

/** Czy projekt należy do roku: ma w nim przychód albo (bez przychodu) kotwicę. */
export function touchesYear(money: ClientMoney, year: number | null): boolean {
  return year === null || revenueYears(money).includes(year)
}
