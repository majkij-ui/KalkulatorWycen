/**
 * W2 — Realizacja: pełna kontrola nad wierszami kosztów (czyste funkcje, bez
 * Reacta): ilość, „Rozdziel" i start wiersza ekipy od roli albo osoby.
 *
 *  | Akcja                    | Co się dzieje                                                           |
 *  |--------------------------|-------------------------------------------------------------------------|
 *  | ilość 0,5 / 3 / 10       | zmiana wiersza (z planu dostaje `edited`), kwota = ilość × stawka       |
 *  | Rozdziel 10 × 1 000      | 10 wierszy po 1 000 zł (pierwszy to ten sam rekord)                     |
 *  | Rozdziel 2,5 × 400       | 1 + 1 + 0,5 — reszta w ostatnim wierszu; suma bez zmian                 |
 *  | Rozdziel wiersz z planu  | kopie dostają klucz `<klucz>#n` i `edited` — „Uwzględnij" ich nie rusza |
 *  | Rozdziel, ilość ≤ 1      | niedostępne                                                             |
 */
import { crewCostRate } from './quote-crew'
import type { CrewMember, CrewRole } from './crew-types'
import { costRowPersonPatch } from './crew-rates'
import { makeCost, type NewCost } from './project-costs'
import { basePlanKey, isPlainAmount } from './realization-costs'
import type { ProjectCost } from './project-types'

const round = (value: number) => Math.round(value * 1e6) / 1e6

/** Ilość z pola: liczba ≥ 0 (puste i śmieci to 0). */
export function quantityValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, round(value)) : 0
}

/** „Rozdziel" ma sens dla ilości > 1; dojazd to jedna kwota. */
export function canSplit(cost: Pick<ProjectCost, 'quantity' | 'category'>): boolean {
  return !isPlainAmount(cost) && (cost.quantity ?? 1) > 1
}

/** Ilości po rozdzieleniu: same jedynki, ułamek zostaje w ostatnim wierszu (2,5 → 1, 1, 0,5). */
export function splitQuantities(quantity: number): number[] {
  if (!(quantity > 1)) return [quantity]
  const whole = Math.floor(quantity)
  const rest = round(quantity - whole)
  return [...Array<number>(whole).fill(1), ...(rest > 0 ? [rest] : [])]
}

/** Numery kopii klucza planu (`klucz#n`) — nie powtarzają żadnego istniejącego, także usuniętego. */
function nextCopyNumbers(costs: ProjectCost[], planKey: string, count: number): number[] {
  const base = basePlanKey(planKey)
  let max = 1
  costs.forEach((c) => {
    if (!c.planKey || basePlanKey(c.planKey) !== base) return
    const n = Number(c.planKey.slice(base.length + 1)) || 1
    if (n > max) max = n
  })
  return Array.from({ length: count }, (_, i) => max + 1 + i)
}

/**
 * Rozbija wiersz o ilości > 1 na pojedyncze: ten sam rekord zostaje pierwszym
 * (ilość 1), reszta to kopie tuż za nim z tą samą kategorią, rolą, osobą,
 * dniem i stawką. Suma się nie zmienia. Zwraca `null`, gdy nie ma czego rozdzielać.
 */
export function splitCost(costs: ProjectCost[], id: string, now: Date = new Date()): ProjectCost[] | null {
  const index = costs.findIndex((c) => c.id === id)
  const cost = costs[index]
  if (!cost || cost.deletedAt || !canSplit(cost)) return null
  const quantities = splitQuantities(cost.quantity ?? 1)
  const keys = cost.planKey ? nextCopyNumbers(costs, cost.planKey, quantities.length - 1) : []
  const base = cost.planKey ? basePlanKey(cost.planKey) : ''
  const first: ProjectCost = { ...cost, quantity: quantities[0], ...(cost.planKey ? { edited: true as const } : {}) }
  const copies = quantities.slice(1).map((quantity, i) => {
    const { id: _id, createdAt: _created, deletedAt: _deleted, planKey: _key, ...rest } = cost
    return makeCost(
      {
        ...rest,
        quantity,
        ...(cost.planKey ? { planKey: `${base}#${keys[i]}`, edited: true as const } : {}),
      } as NewCost,
      now
    )
  })
  return [...costs.slice(0, index), first, ...copies, ...costs.slice(index + 1)]
}

type RolePick = Pick<CrewRole, 'id' | 'name' | 'clientRate' | 'costRate'>

/** Nowy wiersz ekipy od roli: nazwa roli i jej koszt (osoby jeszcze nie ma). */
export function crewRowFromRole(role: RolePick): NewCost {
  return { category: 'ekipa', person: '', role: role.name, quantity: 1, unitCost: crewCostRate(role, null) }
}

/**
 * Nowy wiersz ekipy od osoby: jej pierwsza rola i stawka w tej roli, a bez
 * stawki w roli — jej stawka ogólna (jak `costRowPersonPatch`). „Ja" = moja praca.
 */
export function crewRowFromPerson(member: CrewMember, roles: CrewRole[]): NewCost {
  const patch = costRowPersonPatch({ role: '', unitCost: 0 }, member, roles)
  return {
    category: 'ekipa',
    person: member.name,
    personId: member.id,
    role: patch.role ?? '',
    quantity: 1,
    unitCost: patch.unitCost ?? 0,
    ...(member.self ? { ownWork: true as const } : {}),
  }
}
