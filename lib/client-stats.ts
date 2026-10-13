/**
 * Statystyki klienta (ekran „Klienci", T10) — wszystko WYLICZANE z projektów
 * i wydarzeń, nic nie jest zapisywane (plan §3.2a, §3.4 zasada 1).
 *
 * Klient to grupa projektów o tym samym `clientKey`; grupa klientów (S2) to
 * kilka kluczy naraz — te same statystyki liczą się po wszystkich członkach.
 * Przychód liczy się tak samo jak w Finansach: projekty W realizacji +
 * Zrealizowane (`countsTowardRevenue`), kwota = najlepsza wiedza z pętli
 * pieniędzy (`money`: faktury, gdy są pełne, inaczej plan), rok po dacie
 * faktury (`client-money.ts`). Bez `money` — plan z `financials` po dacie
 * księgowej, czyli to samo, co pętla daje projektom bez faktur.
 *
 * Słowniczek:
 *  - zlecenie = projekt przyjęty albo zrealizowany (won / done),
 *  - klient „wraca" = ma co najmniej 2 zlecenia,
 *  - rytm powrotów = mediana odstępów między datami kolejnych zleceń.
 *
 * Moduł czysty — testy w `client-stats.test.ts`.
 */

import { daysBetween } from './calendar-layout'
import { moneyOf, revenueInYear, revenueYears, type MoneyById } from './client-money'
import { groupMemberKeys, groupOfClient, groupScopeValue, liveGroups, type ClientGroup } from './client-groups'
import { clientDirectory, clientKey, newestWithContact, scopeRevenue } from './clients'
import { plural } from './pl-plural'
import { countsTowardRevenue, type Project, type ProjectContact } from './project-types'
import { threadStats, type ThreadEventInput } from './thread-stats'

/** Pola projektu, z których liczymy statystyki klienta. */
export type ClientProject = Pick<
  Project,
  'id' | 'name' | 'client' | 'status' | 'date' | 'createdAt' | 'updatedAt' | 'financials' | 'leadSource' | 'contact'
>

export type ClientEvent = ThreadEventInput & { projectId: string | null }

/**
 * „Dużo dłużej niż zwykle": przerwa od ostatniego zlecenia przekracza
 * 1,5 × zwykły odstęp ORAZ zwykły odstęp + 60 dni. Drugi warunek chroni
 * częstych klientów przed alarmem po kilku tygodniach ciszy.
 */
export const NUDGE_FACTOR = 1.5
export const NUDGE_MIN_EXTRA_DAYS = 60

/** Trend wielkości: średnia drugiej połowy zleceń ≥ 1,2 × pierwszej → rośnie (≤ 1/1,2 → maleje). */
export const TREND_RATIO = 1.2
/** Trend pokazujemy dopiero od tylu zleceń z kwotą. */
export const TREND_MIN_POINTS = 3

/** Klient „wraca" od tylu zleceń. */
export const REPEAT_MIN_JOBS = 2

export function isJob(project: Pick<Project, 'status'>): boolean {
  return countsTowardRevenue(project.status)
}

/** Najstarszy pierwszy: data księgowa, potem kolejność założenia. */
function byDateAsc(a: ClientProject, b: ClientProject): number {
  return (a.date ?? '').localeCompare(b.date ?? '') || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Pełne miesiące kalendarzowe od `a` do `b` (15.01 → 14.03 = 1, → 15.03 = 2). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number)
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number)
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0)
}

// ── Rytm powrotów ────────────────────────────────────────────────────────────

export interface ClientRhythm {
  /** Różne daty zleceń, rosnąco (dwa zlecenia tego samego dnia = jeden powrót). */
  jobDates: string[]
  /** Mediana odstępów między zleceniami w dniach; `null` = mniej niż dwie daty. */
  medianGapDays: number | null
  lastJobDate: string | null
  /** Dni od ostatniego zlecenia do dziś (nie mniej niż 0). */
  daysSinceLast: number | null
  monthsSinceLast: number | null
  /** Otwarta wycena z datą od ostatniego zlecenia — klient już wrócił z zapytaniem. */
  openQuoteSinceLast: boolean
  /** Przerwa dużo dłuższa niż zwykle, a nic nie czeka — warto się odezwać. */
  nudge: boolean
}

export function clientRhythm(projects: ClientProject[], today: string): ClientRhythm {
  const jobDates = [...new Set(projects.filter(isJob).map((p) => p.date))].filter(Boolean).sort()
  const gaps = jobDates.slice(1).map((date, i) => daysBetween(jobDates[i], date))
  const medianGapDays = median(gaps)
  const lastJobDate = jobDates.at(-1) ?? null
  const daysSinceLast = lastJobDate ? Math.max(0, daysBetween(lastJobDate, today)) : null
  const monthsSinceLast = lastJobDate ? Math.max(0, monthsBetween(lastJobDate, today)) : null
  const openQuoteSinceLast =
    !!lastJobDate && projects.some((p) => p.status === 'quote' && (p.date ?? '') >= lastJobDate)
  const nudge =
    medianGapDays !== null &&
    daysSinceLast !== null &&
    !openQuoteSinceLast &&
    daysSinceLast > Math.max(NUDGE_FACTOR * medianGapDays, medianGapDays + NUDGE_MIN_EXTRA_DAYS)
  return { jobDates, medianGapDays, lastJobDate, daysSinceLast, monthsSinceLast, openQuoteSinceLast, nudge }
}

// ── Wielkość zleceń ──────────────────────────────────────────────────────────

export type SizeTrend = 'rosnie' | 'maleje' | 'stabilnie'

export const SIZE_TREND_LABELS: Record<SizeTrend, string> = {
  rosnie: 'rośnie',
  maleje: 'maleje',
  stabilnie: 'stabilnie',
}

export interface SizePoint {
  projectId: string
  name: string
  date: string
  value: number
}

export interface ClientSize {
  /** Zlecenia z kwotą, w kolejności dat. */
  points: SizePoint[]
  /** `null` = mniej niż `TREND_MIN_POINTS` zleceń z kwotą. */
  trend: SizeTrend | null
  /** Średnia drugiej połowy względem pierwszej (1,35 = o 35% większe); `null` jak `trend`. */
  ratio: number | null
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * Czy zlecenia rosną: średnia kwot z drugiej połowy wobec pierwszej (przy
 * nieparzystej liczbie środkowe zlecenie się nie liczy). Prostsze niż linia
 * trendu i da się powiedzieć zdaniem: „ostatnie średnio o 35% większe".
 * Kwota zlecenia = najlepsza wiedza (`money`), bez niej plan.
 */
export function clientSize(projects: ClientProject[], money?: MoneyById | null): ClientSize {
  const points = projects
    .filter(isJob)
    .map((p) => ({ projectId: p.id, name: p.name, date: p.date, value: moneyOf(p, money).revenue ?? 0, p }))
    .filter((point) => point.value > 0)
    .sort((a, b) => byDateAsc(a.p, b.p))
    .map(({ p: _p, ...point }) => point)
  if (points.length < TREND_MIN_POINTS) return { points, trend: null, ratio: null }
  const half = Math.floor(points.length / 2)
  const first = mean(points.slice(0, half).map((p) => p.value))
  const last = mean(points.slice(-half).map((p) => p.value))
  const ratio = last / first
  const trend: SizeTrend = ratio >= TREND_RATIO ? 'rosnie' : ratio <= 1 / TREND_RATIO ? 'maleje' : 'stabilnie'
  return { points, trend, ratio }
}

// ── Wyceny i decyzje ─────────────────────────────────────────────────────────

export interface ClientOutcomes {
  /** Wszystkie projekty klienta. */
  total: number
  /** Wyceny bez decyzji (status `quote`). */
  open: number
  /** Przyjęte: W realizacji + Zrealizowane. */
  won: number
  lost: number
  /** Przyjęte / (przyjęte + nieprzyjęte), w %; `null` = jeszcze żadnej decyzji. */
  winRatePct: number | null
}

export function clientOutcomes(projects: Pick<Project, 'status'>[]): ClientOutcomes {
  const won = projects.filter(isJob).length
  const lost = projects.filter((p) => p.status === 'lost').length
  return {
    total: projects.length,
    open: projects.filter((p) => p.status === 'quote').length,
    won,
    lost,
    winRatePct: won + lost > 0 ? (won / (won + lost)) * 100 : null,
  }
}

// ── Płatności ────────────────────────────────────────────────────────────────

export interface ClientPayments {
  /** Faktury opłacone (sparowane z wpłatą w wątku). */
  paidCount: number
  medianDays: number | null
  averageDays: number | null
  maxDays: number | null
  /** Wysłane, jeszcze nieopłacone (zaplanowane się nie liczą). */
  openCount: number
  /** Najdłużej czekająca faktura, w dniach. */
  oldestOpenDays: number | null
}

/** Dni do zapłaty z wątków projektów klienta (pary faktura → wpłata z `thread-stats`). */
export function clientPayments(
  projectIds: string[],
  events: ClientEvent[],
  today: string
): ClientPayments {
  const ids = new Set(projectIds)
  const byProject = new Map<string, ClientEvent[]>()
  events.forEach((e) => {
    if (e.projectId && ids.has(e.projectId)) byProject.set(e.projectId, [...(byProject.get(e.projectId) ?? []), e])
  })
  const invoices = [...byProject.values()].flatMap((own) => threadStats(own, today).invoices)
  const paidDays = invoices.flatMap((i) => (i.daysToPaid === null ? [] : [i.daysToPaid]))
  const openDays = invoices.flatMap((i) => (i.daysOpen === null ? [] : [i.daysOpen]))
  return {
    paidCount: paidDays.length,
    medianDays: median(paidDays),
    averageDays: paidDays.length ? mean(paidDays) : null,
    maxDays: paidDays.length ? Math.max(...paidDays) : null,
    openCount: openDays.length,
    oldestOpenDays: openDays.length ? Math.max(...openDays) : null,
  }
}

// ── Klient w całości ─────────────────────────────────────────────────────────

/** Przychód wszystkich projektów firmy, które się liczą (opcjonalnie w roku). */
export function totalRevenue(
  projects: Pick<Project, 'id' | 'status' | 'date' | 'financials'>[],
  year: number | null = null,
  money?: MoneyById | null
): number {
  return projects.reduce(
    (sum, p) => (countsTowardRevenue(p.status) ? sum + revenueInYear(moneyOf(p, money), year) : sum),
    0
  )
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null)

export interface ClientYear {
  year: number
  revenue: number
  /** Zlecenia w tym roku. */
  jobs: number
  /** Udział w przychodzie firmy w tym roku, %. */
  sharePct: number | null
}

export interface ClientStats {
  /** Klucz klienta albo `grupa:<id>` (strona grupy). */
  key: string
  name: string
  /** Pisownie nazwy w projektach (bez spacji na brzegach), od najczęstszej. */
  spellings: { name: string; count: number }[]
  /** Projekty klienta, najnowsze pierwsze. */
  projects: ClientProject[]
  revenue: number
  /** Udział w przychodzie firmy, %; `null` = firma nie ma jeszcze przychodu. */
  sharePct: number | null
  /** Lata ze zleceniami albo przychodem, malejąco. */
  years: ClientYear[]
  /** Zysk zleceń: najlepsza wiedza (przychód − podatek − koszty z Realizacji albo z planu). */
  profit: number
  marginPct: number | null
  /** Zlecenia bez żadnej kwoty (ani planu, ani faktur) — liczą się jako 0 zł. */
  missingFinancials: number
  /** Zlecenia z przychodem z faktur (reszta z planu). */
  invoicedJobs: number
  repeat: boolean
  rhythm: ClientRhythm
  size: ClientSize
  outcomes: ClientOutcomes
  /** Skąd przyszedł: `leadSource` pierwszego projektu (pusty = nieustalone). */
  firstSource: { source: string; projectId: string; projectName: string; date: string }
  payments: ClientPayments
  /** Najnowszy kontakt z projektów klienta. */
  contact: { contact: ProjectContact; projectId: string; projectName: string } | null
}

function spellingsOf(projects: ClientProject[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  projects.forEach((p) => {
    const spelling = p.client.trim().replace(/\s+/g, ' ')
    counts.set(spelling, (counts.get(spelling) ?? 0) + 1)
  })
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'))
}

const inKeys = (keys: Set<string>) => (p: Pick<Project, 'client'>) => keys.has(clientKey(p.client ?? ''))

/**
 * Statystyki projektów jednego „klienta" w szerokim sensie: zbioru kluczy
 * (klient = jeden klucz, grupa = klucze członków). `null` = brak projektów.
 */
function scopeStats(
  projects: ClientProject[],
  events: ClientEvent[],
  keys: string[],
  today: string,
  money?: MoneyById | null
): Omit<ClientStats, 'key' | 'name'> | null {
  const scope = new Set(keys.filter(Boolean))
  const own = projects.filter(inKeys(scope))
  if (!own.length) return null
  const jobs = own.filter(isJob)
  const jobMoney = jobs.map((p) => moneyOf(p, money))
  const { revenue } = scopeRevenue(own, scope, null, money)
  const profit = jobMoney.reduce((sum, m) => sum + (m.profit ?? 0), 0)

  const yearSet = new Set<number>()
  jobMoney.forEach((m) => revenueYears(m).forEach((year) => yearSet.add(year)))
  const years = [...yearSet]
    .sort((a, b) => b - a)
    .map((year) => {
      const inYear = scopeRevenue(own, scope, year, money)
      return {
        year,
        revenue: inYear.revenue,
        jobs: inYear.countedProjects,
        sharePct: share(inYear.revenue, totalRevenue(projects, year, money)),
      }
    })

  const first = [...own].sort(byDateAsc)[0]
  // Najnowszy projekt z kontaktem — w grupie u któregokolwiek członka.
  const contactProject = newestWithContact(own)

  return {
    spellings: spellingsOf(own),
    projects: [...own].sort((a, b) => byDateAsc(b, a)),
    revenue,
    sharePct: share(revenue, totalRevenue(projects, null, money)),
    years,
    profit,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
    missingFinancials: jobMoney.filter((m) => m.revenue === null).length,
    invoicedJobs: jobMoney.filter((m) => m.revenueBasis === 'invoices').length,
    repeat: jobs.length >= REPEAT_MIN_JOBS,
    rhythm: clientRhythm(own, today),
    size: clientSize(own, money),
    outcomes: clientOutcomes(own),
    firstSource: { source: first.leadSource ?? '', projectId: first.id, projectName: first.name, date: first.date },
    payments: clientPayments(
      own.map((p) => p.id),
      events,
      today
    ),
    contact: contactProject?.contact
      ? { contact: contactProject.contact, projectId: contactProject.id, projectName: contactProject.name }
      : null,
  }
}

/**
 * Pełne statystyki jednego klienta. `projects` = wszystkie widoczne projekty
 * firmy (potrzebne do udziału w przychodzie), `events` = wydarzenia (usunięte
 * pomija `thread-stats`), `money` = pieniądze projektów z pętli (T6). `null` =
 * nie ma projektów z tym kluczem.
 */
export function clientStats(
  projects: ClientProject[],
  events: ClientEvent[],
  key: string,
  today: string,
  money?: MoneyById | null
): ClientStats | null {
  if (!key) return null
  const stats = scopeStats(projects, events, [key], today, money)
  if (!stats) return null
  const info = clientDirectory(stats.projects)[0]
  return { key, name: info.name, ...stats }
}

// ── Grupa klientów (S2) ──────────────────────────────────────────────────────

export interface GroupMemberSummary {
  key: string
  /** Najczęstsza pisownia; członek bez projektów — klucz z pliku. */
  name: string
  projectCount: number
  jobCount: number
  revenue: number
  lastDate: string
  /** Członek bez żadnego projektu (pisownia zmieniona, projekty usunięte). */
  empty: boolean
}

export interface GroupStats extends ClientStats {
  group: ClientGroup
  members: GroupMemberSummary[]
}

/** Członkowie grupy z liczbami — także ci, których nie ma już w żadnym projekcie. */
export function groupMembers(
  projects: ClientProject[],
  group: ClientGroup,
  today: string,
  money?: MoneyById | null
): GroupMemberSummary[] {
  const summaries = new Map(clientSummaries(projects, today, money).map((c) => [c.key, c]))
  return groupMemberKeys(group).map((key) => {
    const c = summaries.get(key)
    return c
      ? { key, name: c.name, projectCount: c.projectCount, jobCount: c.jobCount, revenue: c.revenue, lastDate: c.lastDate, empty: false }
      : { key, name: key, projectCount: 0, jobCount: 0, revenue: 0, lastDate: '', empty: true }
  })
}

/**
 * Statystyki grupy: te same liczby co dla klienta, liczone po projektach
 * wszystkich członków (przychód, powroty, trend, skuteczność, płatności). Grupa
 * bez projektów też ma stronę (żeby dało się ją naprawić albo rozwiązać).
 */
export function groupStats(
  projects: ClientProject[],
  events: ClientEvent[],
  group: ClientGroup,
  today: string,
  money?: MoneyById | null
): GroupStats {
  const keys = groupMemberKeys(group)
  const members = groupMembers(projects, group, today, money)
  const name = group.name.trim() || members.map((m) => m.name).join(' + ') || 'Grupa bez nazwy'
  const stats = scopeStats(projects, events, keys, today, money)
  const base: ClientStats = stats
    ? { key: groupScopeValue(group.id), name, ...stats }
    : {
        key: groupScopeValue(group.id),
        name,
        spellings: [],
        projects: [],
        revenue: 0,
        sharePct: null,
        years: [],
        profit: 0,
        marginPct: null,
        missingFinancials: 0,
        invoicedJobs: 0,
        repeat: false,
        rhythm: clientRhythm([], today),
        size: clientSize([]),
        outcomes: clientOutcomes([]),
        firstSource: { source: '', projectId: '', projectName: '', date: '' },
        payments: clientPayments([], [], today),
        contact: null,
      }
  return { ...base, group, members }
}

// ── Lista klientów ───────────────────────────────────────────────────────────

export interface ClientSummary {
  /** Klucz klienta albo `grupa:<id>`. */
  key: string
  name: string
  /** Wszystkie projekty (z wycenami i nieprzyjętymi). */
  projectCount: number
  /** Zlecenia (won / done). */
  jobCount: number
  revenue: number
  /** Data najnowszego projektu (dowolny status). */
  lastDate: string
  repeat: boolean
  nudge: boolean
}

export const CLIENT_SORTS = ['przychod', 'ostatnio', 'liczba'] as const
export type ClientSort = (typeof CLIENT_SORTS)[number]

export const CLIENT_SORT_LABELS: Record<ClientSort, string> = {
  przychod: 'Największy przychód',
  ostatnio: 'Ostatnio',
  liczba: 'Najwięcej projektów',
}

function summaryOf(key: string, name: string, own: ClientProject[], today: string, money?: MoneyById | null): ClientSummary {
  const jobCount = own.filter(isJob).length
  const lastDate = own.reduce((last, p) => ((p.date ?? '') > last ? p.date : last), '')
  return {
    key,
    name,
    projectCount: own.length,
    jobCount,
    revenue: own.reduce((sum, p) => (isJob(p) ? sum + (moneyOf(p, money).revenue ?? 0) : sum), 0),
    lastDate,
    repeat: jobCount >= REPEAT_MIN_JOBS,
    nudge: clientRhythm(own, today).nudge,
  }
}

export function clientSummaries(projects: ClientProject[], today: string, money?: MoneyById | null): ClientSummary[] {
  const groups = new Map<string, ClientProject[]>()
  projects.forEach((p) => {
    const key = clientKey(p.client ?? '')
    if (key) groups.set(key, [...(groups.get(key) ?? []), p])
  })
  return clientDirectory(projects).map((info) => summaryOf(info.key, info.name, groups.get(info.key) ?? [], today, money))
}

/** Wiersz listy „Klienci": klient albo grupa z członkami w środku. */
export type ClientListRow =
  | { kind: 'client'; summary: ClientSummary }
  | { kind: 'group'; group: ClientGroup; summary: ClientSummary; members: GroupMemberSummary[] }

/**
 * Wiersze listy: każda grupa jako jeden wiersz (liczby po wszystkich
 * członkach), klienci spoza grup osobno. Członek grupy nie ma osobnego wiersza.
 */
export function clientListRows(
  projects: ClientProject[],
  groups: ClientGroup[],
  today: string,
  money?: MoneyById | null
): ClientListRow[] {
  const summaries = clientSummaries(projects, today, money)
  const live = liveGroups(groups)
  const rows: ClientListRow[] = live.map((group) => {
    const keys = new Set(groupMemberKeys(group))
    const own = projects.filter(inKeys(keys))
    const members = groupMembers(projects, group, today, money)
    const name = group.name.trim() || members.map((m) => m.name).join(' + ') || 'Grupa bez nazwy'
    return { kind: 'group', group, summary: summaryOf(groupScopeValue(group.id), name, own, today, money), members }
  })
  summaries.forEach((summary) => {
    if (!groupOfClient(live, summary.key)) rows.push({ kind: 'client', summary })
  })
  return rows
}

const byName = (a: ClientSummary, b: ClientSummary) => a.name.localeCompare(b.name, 'pl')

const COMPARE: Record<ClientSort, (a: ClientSummary, b: ClientSummary) => number> = {
  przychod: (a, b) => b.revenue - a.revenue || b.lastDate.localeCompare(a.lastDate) || byName(a, b),
  ostatnio: (a, b) => b.lastDate.localeCompare(a.lastDate) || b.revenue - a.revenue || byName(a, b),
  liczba: (a, b) => b.projectCount - a.projectCount || b.jobCount - a.jobCount || b.revenue - a.revenue || byName(a, b),
}

/** Szukanie bez wielkości liter i polskich znaków („lodz" znajduje „Łódź Film"). */
export function listClients(summaries: ClientSummary[], sort: ClientSort, search = ''): ClientSummary[] {
  const q = clientKey(search)
  return summaries.filter((c) => !q || c.key.includes(q)).sort(COMPARE[sort] ?? COMPARE.przychod)
}

/** Lista z grupami: grupę znajduje jej nazwa albo nazwa któregokolwiek członka. */
export function listClientRows(rows: ClientListRow[], sort: ClientSort, search = ''): ClientListRow[] {
  const q = clientKey(search)
  const matches = (row: ClientListRow) =>
    !q ||
    (row.kind === 'client'
      ? row.summary.key.includes(q)
      : clientKey(row.summary.name).includes(q) || row.members.some((m) => m.key.includes(q) || clientKey(m.name).includes(q)))
  const compare = COMPARE[sort] ?? COMPARE.przychod
  return rows.filter(matches).sort((a, b) => compare(a.summary, b.summary))
}

// ── Zdania do interfejsu ─────────────────────────────────────────────────────

/** Odstęp w dniach → „co 10 dni" / „co ~3 tyg." / „co ~4 mies." / „co ~1,5 roku". */
export function describeGap(days: number): string {
  if (days < 14) return `co ${days} ${plural(days, 'dzień', 'dni', 'dni')}`
  if (days < 45) return `co ~${Math.round(days / 7)} tyg.`
  const months = days / 30.44
  if (months < 18) return `co ~${Math.round(months)} mies.`
  // Od 18 miesięcy w latach, co pół roku: „1,5 roku", „2 lata", „5 lat".
  const years = Math.round((months / 12) * 2) / 2
  const unit = Number.isInteger(years) ? plural(years, 'rok', 'lata', 'lat') : 'roku'
  return `co ~${years.toLocaleString('pl-PL')} ${unit}`
}

/** „w tym miesiącu" / „1 mies. temu" / „14 mies. temu". */
export function describeSince(months: number): string {
  return months <= 0 ? 'w tym miesiącu' : `${months} mies. temu`
}
