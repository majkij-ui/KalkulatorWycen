/**
 * Statystyki Ekipy (T9a) — czyste funkcje, nic nie jest zapisywane.
 *
 * Źródłem są RZECZYWISTE koszty ekipy (`Project.costs`, kategoria `ekipa`)
 * w projektach w realizacji i zrealizowanych. Wyceny, przegrane i ekipa z
 * planu wyceny się nie liczą — to hipotezy, a nie to, kto naprawdę pojechał.
 *
 * Wiersz kosztu należy do osoby z bazy przez `personId`; starsze wiersze bez
 * niego dopasowujemy po imieniu (`personKey`: wielkość liter, spacje i polskie
 * znaki bez znaczenia).
 *
 * Dzień pracy = wiersz przypięty do dnia realizacji (zwykle 1 × stawka
 * dzienna; z importu może być N dni). Koszt całego projektu (np. montaż za
 * całość) liczy się do projektów i wypłat, ale nie do dni ani średniej stawki.
 */

import { costAmount, isCrew, liveCosts, personKey } from './project-costs'
import { crewMemberByName, liveCrewMembers, type CrewMember } from './crew-types'
import { countsTowardRevenue, toDateKey, type Project, type ProjectCost } from './project-types'
import { gearDaysWithCalendarDates } from './realization-days'
import type { TimelineEvent } from './event-types'

type StatsProject = Pick<Project, 'id' | 'name' | 'client' | 'date' | 'status' | 'costs' | 'gearDays' | 'equipment' | 'deletedAt'>
type DayEvent = Pick<TimelineEvent, 'id' | 'kind' | 'projectId' | 'start' | 'end' | 'deletedAt'>

/** Do kogo z bazy należy wiersz kosztu: po `personId`, a bez niego po imieniu. */
export function matchCrewMember(
  cost: Pick<ProjectCost, 'personId' | 'person'>,
  members: CrewMember[]
): CrewMember | null {
  const live = liveCrewMembers(members)
  if (cost.personId) return live.find((m) => m.id === cost.personId) ?? null
  return crewMemberByName(live, cost.person)
}

export interface CrewProjectHistory<P extends StatsProject = StatsProject> {
  project: P
  /** Dni pracy w tym projekcie. */
  days: number
  paid: number
  /** Ostatni dzień pracy (albo data księgowa projektu). */
  lastDate: string
  roles: string[]
}

export interface CrewMemberStats<P extends StatsProject = StatsProject> {
  memberId: string
  /** Dni pracy razem (wiersze przypięte do dnia). */
  days: number
  projects: number
  lastDate: string | null
  paidThisYear: number
  paidTotal: number
  /** Średnia stawka dzienna z dni pracy; `null` bez dni. */
  avgDayRate: number | null
  /** Role z wierszy kosztów, od najczęstszej. */
  roles: { name: string; count: number }[]
  /** Projekty, od najnowszego. */
  history: CrewProjectHistory<P>[]
}

function emptyStats<P extends StatsProject>(memberId: string): CrewMemberStats<P> {
  return { memberId, days: 0, projects: 0, lastDate: null, paidThisYear: 0, paidTotal: 0, avgDayRate: null, roles: [], history: [] }
}

/**
 * Statystyki każdej osoby z bazy (także tych bez pracy — puste). `events` =
 * wydarzenia kalendarza: data dnia pracy pochodzi z kalendarza, jak w
 * Realizacji; bez nich — z ostatniej znanej daty dnia albo daty projektu.
 */
export function computeCrewStats<P extends StatsProject>(
  members: CrewMember[],
  projects: P[],
  options: { events?: DayEvent[]; now?: Date } = {}
): Map<string, CrewMemberStats<P>> {
  const year = (options.now ?? new Date()).getFullYear()
  const live = liveCrewMembers(members)
  const acc = new Map<
    string,
    {
      days: number
      dayPaid: number
      paidTotal: number
      paidThisYear: number
      lastDate: string | null
      roles: Map<string, { name: string; count: number }>
      byProject: Map<string, CrewProjectHistory<P> & { roleSet: Set<string> }>
    }
  >()

  projects.forEach((project) => {
    if (project.deletedAt || !countsTowardRevenue(project.status)) return
    const crew = liveCosts(project.costs).filter(isCrew)
    if (crew.length === 0) return
    const dayDates = new Map(gearDaysWithCalendarDates(project, options.events ?? []).map((d) => [d.id, d.date]))

    crew.forEach((cost) => {
      const member = matchCrewMember(cost, live)
      if (!member) return
      const entry = acc.get(member.id) ?? {
        days: 0,
        dayPaid: 0,
        paidTotal: 0,
        paidThisYear: 0,
        lastDate: null,
        roles: new Map(),
        byProject: new Map(),
      }
      const date = (cost.dayId && dayDates.get(cost.dayId)) || project.date
      const amount = costAmount(cost)
      const days = cost.dayId ? Math.max(0, cost.quantity ?? 1) : 0

      entry.days += days
      if (days > 0) entry.dayPaid += amount
      entry.paidTotal += amount
      if (date.startsWith(String(year))) entry.paidThisYear += amount
      if (!entry.lastDate || date > entry.lastDate) entry.lastDate = date

      const role = (cost.role ?? '').trim()
      if (role) {
        const key = personKey(role)
        const roleEntry = entry.roles.get(key) ?? { name: role, count: 0 }
        roleEntry.count += 1
        entry.roles.set(key, roleEntry)
      }

      const history = entry.byProject.get(project.id) ?? {
        project,
        days: 0,
        paid: 0,
        lastDate: date,
        roles: [],
        roleSet: new Set<string>(),
      }
      history.days += days
      history.paid += amount
      if (date > history.lastDate) history.lastDate = date
      if (role && !history.roleSet.has(personKey(role))) {
        history.roleSet.add(personKey(role))
        history.roles.push(role)
      }
      entry.byProject.set(project.id, history)
      acc.set(member.id, entry)
    })
  })

  return new Map(
    live.map((member) => {
      const entry = acc.get(member.id)
      if (!entry) return [member.id, emptyStats<P>(member.id)]
      const history = [...entry.byProject.values()]
        .map(({ roleSet: _roleSet, ...rest }) => rest)
        .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.project.name.localeCompare(b.project.name, 'pl'))
      return [
        member.id,
        {
          memberId: member.id,
          days: entry.days,
          projects: history.length,
          lastDate: entry.lastDate,
          paidThisYear: entry.paidThisYear,
          paidTotal: entry.paidTotal,
          avgDayRate: entry.days > 0 ? entry.dayPaid / entry.days : null,
          roles: [...entry.roles.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl')),
          history,
        },
      ]
    })
  )
}

/**
 * „Najczęściej pracuję z…": osoby z jakąkolwiek pracą, od największej liczby
 * dni (potem projektów, wypłat, imienia).
 */
export function crewRanking<P extends StatsProject>(
  members: CrewMember[],
  stats: Map<string, CrewMemberStats<P>>
): { member: CrewMember; stats: CrewMemberStats<P> }[] {
  return liveCrewMembers(members)
    .flatMap((member) => {
      const s = stats.get(member.id)
      return s && s.projects > 0 ? [{ member, stats: s }] : []
    })
    .sort(
      (a, b) =>
        b.stats.days - a.stats.days ||
        b.stats.projects - a.stats.projects ||
        b.stats.paidTotal - a.stats.paidTotal ||
        a.member.name.localeCompare(b.member.name, 'pl')
    )
}

export interface UnknownCrewName {
  /** Pisownia z najnowszego projektu. */
  name: string
  /** Role z wierszy, bez powtórzeń. */
  roles: string[]
  /** Stawka z najnowszego wiersza. */
  lastRate: number
  /** W ilu wierszach kosztów występuje. */
  uses: number
}

/**
 * Imiona z kosztów ekipy (wszystkie nieusunięte projekty), których nie ma w
 * bazie — do „Dodaj do bazy". Nic nie tworzy: rekordy powstają dopiero po
 * kliknięciu. Wiersz z `personId` osoby z bazy jest już powiązany.
 */
export function unknownCrewNames(
  projects: Pick<Project, 'date' | 'costs' | 'deletedAt'>[],
  members: CrewMember[]
): UnknownCrewName[] {
  const live = liveCrewMembers(members)
  const liveIds = new Set(live.map((m) => m.id))
  const found = new Map<string, UnknownCrewName & { date: string; roleKeys: Set<string> }>()

  projects.forEach((project) => {
    if (project.deletedAt) return
    liveCosts(project.costs)
      .filter(isCrew)
      .forEach((cost) => {
        if (cost.personId && liveIds.has(cost.personId)) return
        const key = personKey(cost.person)
        if (!key || crewMemberByName(live, cost.person)) return
        const entry = found.get(key) ?? {
          name: (cost.person ?? '').trim(),
          roles: [],
          roleKeys: new Set<string>(),
          lastRate: cost.unitCost,
          uses: 0,
          date: '',
        }
        entry.uses += 1
        if (project.date >= entry.date) {
          entry.date = project.date
          entry.name = (cost.person ?? '').trim()
          entry.lastRate = cost.unitCost
        }
        const role = (cost.role ?? '').trim()
        if (role && !entry.roleKeys.has(personKey(role))) {
          entry.roleKeys.add(personKey(role))
          entry.roles.push(role)
        }
        found.set(key, entry)
      })
  })

  return [...found.values()]
    .map(({ name, roles, lastRate, uses }) => ({ name, roles, lastRate, uses }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'pl'))
}

/**
 * Ekipa przy wybranych projektach (np. zleceniach jednego klienta): ranking
 * jak „najczęściej pracuję z…", liczony tylko z tych projektów, plus imiona z
 * ich kosztów ekipy, których nie ma w bazie. Te same reguły co na ekranie
 * Ekipy — liczą się tylko projekty w realizacji i zrealizowane.
 */
export function crewOnProjects<P extends StatsProject>(
  members: CrewMember[],
  projects: P[],
  options: { events?: DayEvent[]; now?: Date } = {}
): { ranking: { member: CrewMember; stats: CrewMemberStats<P> }[]; outside: string[] } {
  const jobs = projects.filter((p) => !p.deletedAt && countsTowardRevenue(p.status))
  return {
    ranking: crewRanking(members, computeCrewStats(members, jobs, options)),
    outside: unknownCrewNames(jobs, members).map((u) => u.name),
  }
}

/** Dzisiejsza data jako klucz — wygodne w ekranie przy wycofywaniu. */
export function todayDateKey(now: Date = new Date()): string {
  return toDateKey(now)
}
