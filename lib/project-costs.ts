/**
 * Koszty rzeczywiste projektu (`Project.costs`) — czyste funkcje.
 *
 * Koszt to ilość × stawka (PLN netto) w jednej z kategorii; ekipa to koszt z
 * osobą i rolą, przypięty do dnia realizacji (`dayId`). Koszt bez dnia należy
 * do całego projektu (sprzęt kupiony pod projekt, dojazd za całość).
 *
 * Te liczby NIE zmieniają `financials` ani Finansów (to zadanie T6). T6 ma tu
 * wszystko, czego potrzebuje: `totalActualCosts` i `actualCostsByCategory` na
 * jednym projekcie, bez usuniętych pozycji.
 *
 * Usuwanie jest miękkie (`deletedAt`); „Cofnij" przywraca pozycje z tym samym
 * znacznikiem. Funkcje edycji są niemutujące.
 */

import { safeNum } from './safe-numbers'
import {
  COST_CATEGORIES,
  countsTowardRevenue,
  createProjectCostId,
  type Project,
  type ProjectCost,
} from './project-types'

// ── Odczyt ───────────────────────────────────────────────────────────────────

/** Kwota pozycji: ilość (brak = 1) × stawka; śmieci liczą się jako 0. */
export function costAmount(cost: Pick<ProjectCost, 'quantity' | 'unitCost'>): number {
  return safeNum(cost.quantity ?? 1, 1, 0) * safeNum(cost.unitCost, 0, 0)
}

/** Pozycje nieusunięte. */
export function liveCosts(costs: ProjectCost[] | null | undefined): ProjectCost[] {
  return (costs ?? []).filter((cost) => !cost.deletedAt)
}

/** Suma kosztów rzeczywistych projektu (bez usuniętych). */
export function totalActualCosts(costs: ProjectCost[] | null | undefined): number {
  return liveCosts(costs).reduce((sum, cost) => sum + costAmount(cost), 0)
}

/** Kategorie w kolejności `COST_CATEGORIES`, nieznane na końcu alfabetycznie. */
function categoryRank(category: string): number {
  const index = (COST_CATEGORIES as readonly string[]).indexOf(category)
  return index === -1 ? COST_CATEGORIES.length : index
}

export function compareCategories(a: string, b: string): number {
  return categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'pl')
}

/** Suma kosztów w każdej kategorii (bez usuniętych i bez zerowych kategorii). */
export function actualCostsByCategory(costs: ProjectCost[] | null | undefined): Map<string, number> {
  const totals = new Map<string, number>()
  liveCosts(costs).forEach((cost) => {
    totals.set(cost.category, (totals.get(cost.category) ?? 0) + costAmount(cost))
  })
  return new Map([...totals.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => compareCategories(a, b)))
}

export function isCrew(cost: Pick<ProjectCost, 'category'>): boolean {
  return cost.category === 'ekipa'
}

/** Pozycje jednego dnia (bez usuniętych). */
export function costsOfDay(costs: ProjectCost[] | null | undefined, dayId: string): ProjectCost[] {
  return liveCosts(costs).filter((cost) => cost.dayId === dayId)
}

/**
 * Koszty całego projektu: bez dnia albo z dniem, którego już nie ma w
 * zakładce (np. dzień skasowany przez starszą wersję) — nie mogą zniknąć z
 * widoku, skoro wciąż liczą się do sumy.
 */
export function projectLevelCosts(costs: ProjectCost[] | null | undefined, dayIds: Iterable<string>): ProjectCost[] {
  const known = new Set(dayIds)
  return liveCosts(costs).filter((cost) => !cost.dayId || !known.has(cost.dayId))
}

// ── Edycja ───────────────────────────────────────────────────────────────────

export type NewCost = Omit<Partial<ProjectCost>, 'id' | 'createdAt' | 'deletedAt'> & { category: string }

export function makeCost(init: NewCost, now: Date = new Date()): ProjectCost {
  return {
    quantity: 1,
    unitCost: 0,
    ...init,
    id: createProjectCostId(),
    createdAt: now.toISOString(),
  }
}

export function addCost(costs: ProjectCost[], init: NewCost, now: Date = new Date()): ProjectCost[] {
  return [...costs, makeCost(init, now)]
}

export function updateCost(
  costs: ProjectCost[],
  id: string,
  patch: Partial<Omit<ProjectCost, 'id' | 'createdAt'>>
): ProjectCost[] {
  return costs.map((cost) => (cost.id === id ? { ...cost, ...patch } : cost))
}

export function softDeleteCost(costs: ProjectCost[], id: string, deletedAt: string): ProjectCost[] {
  return costs.map((cost) => (cost.id === id && !cost.deletedAt ? { ...cost, deletedAt } : cost))
}

/** Koszty usuwanego dnia dostają znacznik dnia — „Cofnij" przywraca jedno i drugie. */
export function softDeleteDayCosts(costs: ProjectCost[], dayId: string, deletedAt: string): ProjectCost[] {
  return costs.map((cost) => (cost.dayId === dayId && !cost.deletedAt ? { ...cost, deletedAt } : cost))
}

/** Przywraca pozycje usunięte z tym znacznikiem (wcześniej usunięte zostają usunięte). */
export function restoreCosts(costs: ProjectCost[], deletedAt: string): ProjectCost[] {
  return costs.map((cost) => {
    if (cost.deletedAt !== deletedAt) return cost
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt: _removed, ...rest } = cost
    return rest
  })
}

// ── Ekipa ────────────────────────────────────────────────────────────────────

/** Klucz porównania osób/ról: wielkość liter, spacje i polskie znaki bez znaczenia. */
export function personKey(text: string | undefined): string {
  return (text ?? '')
    .trim()
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
}

function crewKey(cost: Pick<ProjectCost, 'person' | 'role'>): string {
  return `${personKey(cost.person)}|${personKey(cost.role)}`
}

/**
 * „Ta sama ekipa we wszystkich dniach": osoby z dnia `fromDayId` trafiają do
 * pozostałych dni, w których tej osoby (w tej roli) jeszcze nie ma. Nic nie
 * nadpisuje — stawka dopisanej osoby to stawka z dnia źródłowego.
 */
export function copyCrewToDays(
  costs: ProjectCost[],
  fromDayId: string,
  toDayIds: string[],
  now: Date = new Date()
): { costs: ProjectCost[]; added: number } {
  const source = costsOfDay(costs, fromDayId).filter(isCrew)
  const added: ProjectCost[] = []
  toDayIds
    .filter((dayId) => dayId !== fromDayId)
    .forEach((dayId) => {
      const present = new Set(costsOfDay(costs, dayId).filter(isCrew).map(crewKey))
      source.forEach((member) => {
        if (present.has(crewKey(member))) return
        added.push(
          makeCost(
            {
              category: 'ekipa',
              person: member.person,
              role: member.role,
              quantity: member.quantity,
              unitCost: member.unitCost,
              dayId,
            },
            now
          )
        )
      })
    })
  return { costs: [...costs, ...added], added: added.length }
}

export interface CrewSuggestion {
  /** Pisownia z najnowszego projektu. */
  person: string
  role: string
  /** Ostatnia stawka tej osoby (PLN netto za jednostkę). */
  unitCost: number
}

/**
 * Osoby z ekip innych projektów — do podpowiedzi przy wpisywaniu ekipy, z
 * ostatnią rolą i stawką. Najnowszy projekt (data księgowa) wygrywa; liczą się
 * tylko projekty w realizacji i zrealizowane (stawki z wycen to hipotezy).
 */
export function crewSuggestions(
  projects: Pick<Project, 'id' | 'date' | 'status' | 'costs'>[],
  excludeProjectId?: string
): CrewSuggestion[] {
  const latest = new Map<string, { suggestion: CrewSuggestion; date: string; createdAt: string }>()
  projects
    .filter((p) => p.id !== excludeProjectId && countsTowardRevenue(p.status))
    .forEach((project) => {
      liveCosts(project.costs)
        .filter((cost) => isCrew(cost) && personKey(cost.person))
        .forEach((cost) => {
          const key = personKey(cost.person)
          const prev = latest.get(key)
          const createdAt = cost.createdAt ?? ''
          const newer =
            !prev || project.date > prev.date || (project.date === prev.date && createdAt > prev.createdAt)
          if (!newer) return
          latest.set(key, {
            suggestion: { person: (cost.person ?? '').trim(), role: (cost.role ?? '').trim(), unitCost: cost.unitCost },
            date: project.date,
            createdAt,
          })
        })
    })
  return [...latest.values()]
    .map((entry) => entry.suggestion)
    .sort((a, b) => a.person.localeCompare(b.person, 'pl'))
}
