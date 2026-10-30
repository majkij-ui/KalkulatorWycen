/**
 * Finanse (V2): drobne, czysto wyświetlane liczby nad kaflami i w kaflu
 * „Czeka na wpłatę". Niczego nie zmieniają w rejestrze marży ani w danych.
 */
import { clientScopeOf, type ClientGroup } from './client-groups'
import { isInPeriod, periodMonths, type Period } from './finance-calc'
import { projectShootDates, quoteShootDayCount } from './gear-usage'
import { summarizeMoney, type OpenInvoice, type ProjectMoney } from './money-loop'
import type { Project } from './project-types'
import type { TimelineEvent } from './event-types'

export interface PeriodActivity {
  projects: number
  clients: number
  shootDays: number
}

type ShootEvent = Pick<TimelineEvent, 'kind' | 'projectId' | 'start' | 'end' | 'deletedAt'>

/**
 * Liczba projektów, klientów i dni zdjęciowych dla projektów, które liczą się
 * w okresie i filtrze (`projectIds` — te same, z których są kafle).
 *
 *  - klienci: różni klienci tych projektów; grupa klientów to jeden klient
 *    (jak na ekranie Klienci — `clientScopeOf`); projekt bez klienta nie liczy się;
 *  - dni zdjęciowe, per projekt: gdy projekt ma w kalendarzu JAKIKOLWIEK dzień
 *    `shoot_day` (nieusunięty, z dowolnego roku; `prep_day` nie), liczymy jego dni
 *    z datą w okresie — kalendarz wygrywa z wyceną, a dni tylko w innym okresie
 *    nie robią zapasu z wyceny. Wydarzenie wielodniowe liczy każdy swój dzień w
 *    okresie; para (projekt, dzień) liczy się raz, jak w podsumowaniu kalendarza.
 *    Gdy projekt nie ma w kalendarzu żadnego dnia zdjęciowego — liczba dni z
 *    wyceny (`quoteShootDayCount`; brak wyceny = 0).
 *    Dotyczy tylko tego licznika; statystyki sprzętu liczą po swojemu.
 */
export function periodActivity(input: {
  projectIds: readonly string[]
  projects: ReadonlyArray<Pick<Project, 'id' | 'client'> & { quote?: unknown }>
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
  ids.forEach((id) => {
    const dates = projectShootDates(id, eventsByProject.get(id) ?? [])
    shootDays +=
      dates.length > 0
        ? dates.filter((day) => isInPeriod(day, input.period)).length
        : quoteShootDayCount(byId.get(id)?.quote)
  })

  return { projects: ids.length, clients: clients.size, shootDays }
}

/**
 * Ile miesięcy okresu już minęło — dzielnik dla „~X zł / mies." pod zyskiem.
 *
 *  - okres zamknięty (przed dzisiaj): wszystkie jego miesiące (rok 12, półrocze 6, kwartał 3);
 *  - okres trwający: pełne miesiące przed bieżącym + część bieżącego (dzień / dni
 *    miesiąca), np. 30 X 2026 w roku 2026 = 9 + 30/31;
 *  - widok miesiąca, okres przyszły i okres trwający krócej niż miesiąc: `null`
 *    (średnia miesięczna nie ma sensu — kafel jej nie pokazuje).
 */
export function periodElapsedMonths(period: Period, today: string): number | null {
  if (period.kind === 'month') return null
  const months = periodMonths(period)
  const current = today.slice(0, 7)
  if (current < months[0]) return null
  let elapsed = months.length
  if (current <= months[months.length - 1]) {
    const [year, month] = current.split('-').map(Number)
    const day = Number(today.slice(8, 10))
    if (!Number.isFinite(day) || !Number.isFinite(year) || !Number.isFinite(month)) return null
    const daysInMonth = new Date(year, month, 0).getDate()
    elapsed = months.indexOf(current) + Math.min(day, daysInMonth) / daysInMonth
  }
  return elapsed >= 1 ? elapsed : null
}

/**
 * „W realizacji": projekty ze statusem `won`, które dotykają okresu (kotwicą albo
 * fakturą), w zakresie filtra klienta, i ich przychód w okresie. Zawsze z pełnego
 * rejestru — przełącznik „Zakończone projekty" nie może go opróżnić.
 */
export function inProgressInPeriod(
  ledger: readonly ProjectMoney[],
  statusById: ReadonlyMap<string, string>,
  scope: ReadonlySet<string> | null,
  period: Period
): { count: number; revenue: number } {
  const rows = summarizeMoney([...ledger], [], period).projects.filter(
    (row) => statusById.get(row.money.id) === 'won' && (!scope || scope.has(row.money.id))
  )
  return { count: rows.length, revenue: rows.reduce((total, row) => total + row.revenue, 0) }
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
