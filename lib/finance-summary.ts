/**
 * Finanse (V2): drobne, czysto wyświetlane liczby nad kaflami i w kaflu
 * „Czeka na wpłatę". Niczego nie zmieniają w rejestrze marży ani w danych.
 */
import { clientScopeOf, type ClientGroup } from './client-groups'
import { isInPeriod, type Period } from './finance-calc'
import { projectShootDates } from './gear-usage'
import type { OpenInvoice, ProjectMoney } from './money-loop'
import { plural } from './pl-plural'
import type { Project } from './project-types'
import type { TimelineEvent } from './event-types'

export interface PeriodActivity {
  projects: number
  clients: number
  shootDays: number
}

type ShootEvent = Pick<TimelineEvent, 'kind' | 'projectId' | 'start' | 'end' | 'deletedAt'>

/**
 * „N projektów · M klientów · D dni zdjęciowych" dla projektów, które liczą się
 * w okresie i filtrze (`projectIds` — te same, z których są kafle).
 *
 *  - klienci: różni klienci tych projektów; grupa klientów to jeden klient
 *    (jak na ekranie Klienci — `clientScopeOf`); projekt bez klienta nie liczy się;
 *  - dni zdjęciowe: dni `shoot_day` (nieusunięte; `prep_day` nie) tych projektów
 *    z datą w okresie. Wydarzenie wielodniowe liczy każdy swój dzień w okresie;
 *    para (projekt, dzień) liczy się raz, jak w podsumowaniu kalendarza.
 */
export function periodActivity(input: {
  projectIds: readonly string[]
  projects: ReadonlyArray<Pick<Project, 'id' | 'client'>>
  events: readonly ShootEvent[]
  groups: ClientGroup[]
  period: Period
}): PeriodActivity {
  const ids = [...new Set(input.projectIds)]
  const idSet = new Set(ids)
  const byId = new Map(input.projects.map((p) => [p.id, p]))

  const clients = new Set<string>()
  ids.forEach((id) => {
    const scope = clientScopeOf(input.groups, byId.get(id)?.client ?? '')
    if (scope) clients.add(scope)
  })

  const eventsByProject = new Map<string, ShootEvent[]>()
  input.events.forEach((event) => {
    if (event.kind !== 'shoot_day' || !event.projectId || !idSet.has(event.projectId)) return
    eventsByProject.set(event.projectId, [...(eventsByProject.get(event.projectId) ?? []), event])
  })
  let shootDays = 0
  eventsByProject.forEach((list, projectId) => {
    shootDays += projectShootDates(projectId, list).filter((day) => isInPeriod(day, input.period)).length
  })

  return { projects: ids.length, clients: clients.size, shootDays }
}

export function activityLabel(activity: PeriodActivity): string {
  const { projects, clients, shootDays } = activity
  return [
    `${projects} ${plural(projects, 'projekt', 'projekty', 'projektów')}`,
    `${clients} ${plural(clients, 'klient', 'klientów', 'klientów')}`,
    `${shootDays} ${plural(shootDays, 'dzień zdjęciowy', 'dni zdjęciowe', 'dni zdjęciowych')}`,
  ].join(' · ')
}

/**
 * Przychód okresu, który wpłynął i który czeka — z kawałków przychodu projektów
 * (ta sama reguła co `summarizeMoney`, tylko dla podanych wierszy, więc działa
 * też dla zawężenia do klienta).
 */
export function periodPayments(
  rows: ReadonlyArray<{ money: Pick<ProjectMoney, 'pieces'> }>,
  period: Period
): { paid: number; awaiting: number } {
  let paid = 0
  let awaiting = 0
  rows.forEach(({ money }) =>
    money.pieces.forEach((piece) => {
      if (!isInPeriod(piece.day, period)) return
      if (piece.paid) paid += piece.amount
      else awaiting += piece.amount
    })
  )
  return { paid, awaiting }
}

/**
 * „Z czego po terminie": otwarte faktury po terminie projektów okresu, wystawione
 * w okresie (żeby kwota była częścią „czeka na wpłatę", nie czymś obok).
 */
export function overdueAwaiting(open: readonly OpenInvoice[], projectIds: ReadonlySet<string>, period: Period): number {
  return open
    .filter((invoice) => invoice.daysOverdue > 0 && projectIds.has(invoice.projectId) && isInPeriod(invoice.sent, period))
    .reduce((total, invoice) => total + (invoice.amount ?? 0), 0)
}
