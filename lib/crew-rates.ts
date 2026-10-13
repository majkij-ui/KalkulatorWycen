/**
 * Stawka w wierszu ekipy Realizacji (S2, plan po jeździe próbnej §3.3) —
 * czyste funkcje, bez Reacta.
 *
 * Wiersz ma osobę (z bazy albo tekstem) i rolę TEKSTEM. Wybór osoby albo
 * zmiana roli przy osobie z bazy ustawia stawkę według tej samej kolejności co
 * w wycenie (`crewCostRate`): stawka osoby w tej roli → jej stawka ogólna →
 * koszt roli → stawka roli.
 *
 *  | Wiersz                                   | Wybór osoby                          |
 *  |------------------------------------------|--------------------------------------|
 *  | rola X, osoba ma stawkę w X              | stawka w X                           |
 *  | rola X, osoba bez stawki w X, ma ogólną  | stawka ogólna                        |
 *  | rola X, osoba bez stawek, wiersz pusty   | koszt roli X (albo jej stawka)       |
 *  | rola X, osoba bez stawek, kwota wpisana  | kwota zostaje                        |
 *  | bez roli, osoba ma role                  | jej pierwsza rola, stawka jak wyżej  |
 *  | rola spoza bazy                          | stawka ogólna osoby albo bez zmiany  |
 *
 * Zmiana roli w wierszu z osobą z bazy na INNĄ rolę z bazy bierze stawkę
 * osoby w nowej roli (pełna kolejność). Poprawka pisowni tej samej roli i
 * wiersze z osobą wpisaną tekstem nie zmieniają kwoty.
 */

import { crewCostRate } from './quote-crew'
import { crewRoleByName, personRateFor, rolesForPerson, type CrewMember, type CrewRole } from './crew-types'
import type { ProjectCost } from './project-types'

type Person = Pick<CrewMember, 'id' | 'name' | 'rate' | 'roleIds' | 'roleRates'>
type Row = Pick<ProjectCost, 'role' | 'unitCost'>

/** Zmiany wiersza po wyborze osoby z bazy. */
export function costRowPersonPatch(cost: Row, member: Person, roles: CrewRole[]): Partial<ProjectCost> {
  const patch: Partial<ProjectCost> = { personId: member.id, person: member.name }
  let role = crewRoleByName(roles, cost.role)
  if (!cost.role?.trim()) {
    const first = rolesForPerson(member, roles).own[0]
    if (first) {
      patch.role = first.name
      role = first
    }
  }
  const own = personRateFor(member, role?.id)
  if (own !== null) patch.unitCost = own
  else if (role && !(cost.unitCost > 0)) patch.unitCost = crewCostRate(role, null)
  return patch
}

/** Zmiany wiersza po wpisaniu roli; `member` = osoba z bazy powiązana z wierszem. */
export function costRowRolePatch(
  cost: Row,
  role: string,
  member: Person | null,
  roles: CrewRole[]
): Partial<ProjectCost> {
  const patch: Partial<ProjectCost> = { role }
  if (!member) return patch
  const before = crewRoleByName(roles, cost.role)
  const after = crewRoleByName(roles, role)
  if (after && after.id !== before?.id) patch.unitCost = crewCostRate(after, member)
  return patch
}
