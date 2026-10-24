/**
 * Raport okresowy (S5, plan §3.7, decyzja F; odpowiedzi M.J. 2026-10-18).
 *
 * Czysty budowniczy: dane hubu na wejściu, jedna struktura `PeriodReport` na
 * wyjściu. Z tej struktury powstają trzy rzeczy — ekran (zakładka „Raport"
 * w Finansach), PDF i plik Markdown z blokiem JSON — więc liczby w nich
 * muszą być te same (`period-report-sections.ts` robi z niej tabele, a
 * `period-report-markdown.ts` plik).
 *
 * NIC TU NIE JEST LICZONE DRUGI RAZ. Źródła:
 *  - wszystkie pieniądze (przychód, koszty bezpośrednie, obie warstwy marży,
 *    koszty firmy, wpłynęło / czeka, poprzedni okres, grupy klientów):
 *    `marginSummary` z rejestru marży (S4) — jedyne źródło pieniędzy;
 *  - płatności i faktury po terminie: `openInvoices`, `paymentDays` (T6);
 *  - subskrypcje: `effectiveFixedCosts` / `totalsBySubscription` (S1);
 *  - marketing: `summarizeCampaign` (kampania przycięta do okresu, a osobno
 *    od startu do dziś);
 *  - sprzęt: koszt z `marginSummary().gear`, „odpracował / zarobił" z
 *    `computeGearReport`;
 *  - ekipa: `crewOnProjects` (statystyki Ekipy) dla zleceń okresu.
 *  Tu jest tylko wybór okresu, grupowanie wierszy i porównania.
 *
 * Gdzie dwa moduły liczą to samo inaczej, raport tego NIE rozstrzyga:
 * wpisuje rozbieżność do `notes` („Do wyjaśnienia"). Ekipa i sprzęt liczą się
 * dla zleceń okresu (tych, których koszty leżą w okresie — kotwica).
 *
 * Kształt jest otwarty pod R2 („Marża producencka" = warstwa 1 − własna
 * praca M.J.): nowy wiersz to nowy element `metrics` i klucz w `extra`
 * wiersza projektu / klienta — renderery nic o nim nie wiedzą.
 *
 * Moduł czysty — testy w `period-report.test.ts`.
 */

import { clientKey } from './clients'
import { crewOnProjects } from './crew-stats'
import type { CrewMember } from './crew-types'
import { clientScopeOf, groupMemberKeys, groupScopeValue, isGroupScope, liveGroups, type ClientGroup } from './client-groups'
import type { TimelineEvent } from './event-types'
import { COST_CATEGORY_KEYS, COST_CATEGORY_LABELS } from './fixed-cost-categories'
import { isInPeriod, periodLabel, periodMonths, summarizePeriod, type Period } from './finance-calc'
import { gearPurchases } from './gear-backstage'
import type { GearPeriodCost, GearSpreadSettings } from './gear-costs'
import { computeGearReport } from './equipment-roi'
import {
  campaignMonths,
  countLeads,
  summarizeCampaign,
  type CampaignSummary,
  type LeadCounts,
} from './marketing-calc'
import { leadsFromEvents, type Lead } from './marketing-leads'
import type { Campaign } from './marketing-types'
import { companyTaxRate, marginSummary, type MarginInput, type MarginSummary, type ProjectMargin } from './margin-ledger'
import { invoiceAmount, moneyLedger, openInvoices, paymentDays, type ProjectMoney } from './money-loop'
import { formatDate } from './money-loop-labels'
import { quoteMoney } from './quote-currency'
import { periodRentals } from './rentals'
import {
  countsTowardRevenue,
  PROJECT_STATUS_LABELS,
  type EquipmentItem,
  type FixedCost,
  type Project,
} from './project-types'
import { effectiveFixedCosts, totalsBySubscription } from './subscriptions'
import type { Subscription } from './subscription-types'

// ── Wejście ──────────────────────────────────────────────────────────────────

export interface ReportInput {
  projects: Project[]
  events: TimelineEvent[]
  /** Ręczne koszty stałe z pliku (`finances.json`), BEZ rat subskrypcji — raty liczy raport. */
  fixedCosts: FixedCost[]
  subscriptions: Subscription[]
  /** Cały katalog (`allItems`), na plan i zaplecze. */
  equipment: EquipmentItem[]
  campaigns: Campaign[]
  /** Wszyscy ludzie z bazy, także wycofani (jak w statystykach Ekipy). */
  crew: CrewMember[]
  groups: ClientGroup[]
  /** Przełącznik „Rozłóż duże zakupy sprzętu". */
  spread: boolean
  settings: GearSpreadSettings
  /** Ryczałt projektu bez planu (`companyTaxRate`); brak = 8,5 %. */
  taxRatePercent?: number
  /** `YYYY-MM-DD` — jawnie, żeby wynik był powtarzalny w testach. */
  today: string
}

// ── Wyjście ──────────────────────────────────────────────────────────────────

export interface ReportPeriod {
  kind: Period['kind']
  year: number
  index: number | null
  label: string
  /** Pierwszy i ostatni dzień okresu, `YYYY-MM-DD`. */
  from: string
  to: string
  /** `YYYY-MM` od najwcześniejszego. */
  months: string[]
}

export interface ReportView {
  gear: 'spread' | 'full'
  /** „rozłożony" / „w całości". */
  gearLabel: string
  /** Pełne zdanie do nagłówka raportu. */
  description: string
  thresholdPln: number
  months: number
}

export interface ReportDefinition {
  key: string
  label: string
  text: string
}

export type MetricGroup = 'projects' | 'layer1' | 'costs' | 'layer2' | 'payments'

/**
 * Wiersz nagłówkowy porównania z poprzednim okresem. Lista jest OTWARTA:
 * kolejne warstwy (R2: `producerMargin`) dopisują wiersze, renderery biorą
 * wszystko, co jest na liście.
 */
export interface ReportMetric {
  key: string
  label: string
  unit: 'pln' | 'count'
  group: MetricGroup
  value: number
  /** `null` = poprzedni okres bez danych. */
  previous: number | null
  change: number | null
  /** Zmiana w % wartości poprzedniej; `null` bez porównania albo przy zerze. */
  changePct: number | null
  /** Pogrubiony wiersz (warstwy). */
  emphasis: boolean
  /** Udział w przychodzie okresu, %; tylko tam, gdzie ma sens. */
  pctOfRevenue: number | null
}

export interface ReportProject {
  id: string
  name: string
  client: string
  /** `grupa:<id>` albo klucz klienta. */
  clientScope: string
  /** Nazwa grupy klientów, jeśli projekt do niej należy. */
  group: string | null
  status: string
  statusLabel: string
  /** Kotwica w okresie: pierwsza faktura, a bez faktur data projektu. */
  anchor: string
  /** Koszty projektu leżą w tym okresie (inaczej tylko część przychodu). */
  anchored: boolean
  revenue: number
  costs: number
  /** Warstwa 1 projektu. */
  margin: number
  marginPct: number | null
  tax: number
  /** `false` = „brak kwoty". */
  known: boolean
  revenueBasis: 'invoices' | 'plan' | 'none'
  costsBasis: 'actual' | 'plan' | 'none'
  /** Krótkie ostrzeżenia po polsku (faktura bez kwoty, zaliczka…). */
  flags: string[]
  currency: 'PLN' | 'EUR'
  /** Ile zł za 1 EUR (zamrożony w wycenie); `null` dla PLN. */
  exchangeRate: number | null
  /** Widok roku: udział w przychodzie roku (0–1), koszty firmy bez podatku, warstwa 2; inaczej `null`. */
  share: number | null
  overhead: number | null
  result: number | null
  /** Miejsce na kolejne warstwy (R2). */
  extra: Record<string, number | null>
}

export interface ReportClient {
  scope: string
  name: string
  isGroup: boolean
  /** Pisownie klientów w okresie (dla grupy: członkowie, którzy mają tu projekty). */
  members: string[]
  projects: number
  revenue: number
  sharePct: number | null
  costs: number
  margin: number
  marginPct: number | null
  /** Tylko widok roku (decyzja A). */
  overhead: number | null
  result: number | null
  extra: Record<string, number | null>
}

export interface ReportInvoice {
  projectId: string
  project: string
  client: string
  number: string | null
  sent: string
  amount: number | null
  state: 'paid' | 'open' | 'planned'
  paid: string | null
  daysToPaid: number | null
}

export interface ReportOpenInvoice {
  projectId: string
  project: string
  client: string
  number: string | null
  sent: string
  dueDate: string
  /** Termin przyjęty (30 dni), bo faktura go nie ma. */
  dueAssumed: boolean
  amount: number | null
  /** Dni po terminie; ≤ 0 = jeszcze w terminie. */
  daysOverdue: number
  issuedInPeriod: boolean
}

export interface ReportPayments {
  paid: { revenue: number; count: number }
  awaiting: { revenue: number; count: number }
  /** Przychód okresu z faktur i wpłat (reszta jest z planu). */
  invoicedRevenue: number
  fromPlan: number
  /** Faktury wystawione w okresie (projekty, które się liczą). */
  issued: ReportInvoice[]
  issuedTotal: number
  issuedWithoutAmount: number
  paymentDays: { paidCount: number; medianDays: number | null; maxDays: number | null; lateCount: number }
  /** Stan na dzień raportu, wszystkie okresy; `issuedInPeriod` zaznacza faktury z tego okresu. */
  open: ReportOpenInvoice[]
  openTotal: number
  openWithoutAmount: number
  overdueCount: number
  overdueTotal: number
}

export interface ReportCategoryCost {
  key: string
  label: string
  amount: number
}

export interface ReportSubscription {
  id: string
  name: string
  category: string
  categoryLabel: string
  /** Raty i poprawki w okresie. */
  amount: number
  charges: number
}

export interface ReportCompanyCosts {
  tax: number
  zus: number
  /** Subskrypcje i koszty stałe poza ZUS, marketingiem i sprzętem. */
  fixed: number
  marketing: number
  gear: number
  total: number
  /** Kategorie kosztów stałych w okresie (surowo, bez sprzętu spoza katalogu — ten jest w sprzęcie). */
  byCategory: ReportCategoryCost[]
  subscriptions: ReportSubscription[]
  subscriptionsTotal: number
  /** Z rat wyliczonych automatycznie (nie ma ich w pliku). */
  derived: number
  /** Raty z miesięcy po bieżącym, wliczone w okres („wstępnie"). */
  planned: number
}

export interface ReportCampaignPeriod {
  spend: number
  /** Część wydatku liczona z budżetu (brak odczytu z panelu). */
  estimatedMonths: string[]
  clicks: number | null
  impressions: number | null
  ctr: number | null
  cpc: number | null
  leads: LeadCounts
  costPerLead: number | null
  costPerRealLead: number | null
  /** Zlecenia z leadów okresu (bez względu na kwartał zlecenia). */
  jobs: string[]
  costPerJob: number | null
  /** Przychód tych zleceń wg marketingu (plan z wyceny). */
  revenue: number
  roas: number | null
}

export interface ReportCampaignToDate {
  spend: number
  leads: LeadCounts
  jobs: string[]
  lost: number
  costPerJob: number | null
  revenue: number
  roas: number | null
  profitAfterAds: number
}

export interface ReportCampaign {
  id: string
  name: string
  platform: string
  start: string
  end: string | null
  /** Nagłówek raportu: od startu kampanii do dziś. */
  toDate: ReportCampaignToDate
  /** W okresie: wydatek i leady z okresu. */
  inPeriod: ReportCampaignPeriod
}

export interface ReportMarketing {
  /** Marketing w kosztach firmy (rejestr marży). */
  ledgerSpend: number
  /** Suma wydatków kampanii w okresie wg marketingu (panel + szacunek). */
  campaignSpend: number
  campaigns: ReportCampaign[]
  /** Leady okresu bez kampanii (albo z usuniętej). */
  outsideLeads: LeadCounts
  leads: LeadCounts
}

export interface ReportGearLine {
  itemId: string
  name: string
  onSet: boolean
  date: string
  price: number
  mode: 'spread' | 'full'
  monthly: number
  /** Koszt w okresie. */
  amount: number
  /** Zakup sprzed początku okresu (reszta rozkładania). */
  carried: boolean
  firstMonth: string
  lastMonth: string
  retiredMonth: string | null
}

export interface ReportGearPurchase {
  itemId: string
  name: string
  onSet: boolean
  date: string
  price: number
}

export interface ReportGearUse {
  itemId: string
  name: string
  daysUsed: number
  /** Odpracował w zleceniach okresu (stawka rentalowa × dni). */
  rentValue: number
  clientPaid: number
  /** Cena zakupu × sztuki; 0 = nieznana. */
  invested: number
  /** Od zakupu do dziś, % ceny; `null` bez ceny. */
  rentValuePct: number | null
  clientPaidPct: number | null
  /** Prognoza spłaty tylko do 10 lat naprzód; dalej `null`. */
  rentPayoffMonth: string | null
  clientPayoffMonth: string | null
}

export interface ReportGear {
  view: ReportView['gear']
  total: number
  catalogue: number
  carried: number
  manual: number
  lines: ReportGearLine[]
  purchases: ReportGearPurchase[]
  /** Ręczne „Sprzęt spoza katalogu" w okresie (po odjęciu pozycji z katalogu). */
  manualEntries: { label: string; month: string; amount: number; counted: number }[]
  undated: { name: string; price: number }[]
  unpriced: { name: string }[]
  retired: { name: string; month: string; unspread: number }[]
  /** Sprzęt na planie w zleceniach okresu. */
  onSet: ReportGearUse[]
  onSetRentValue: number
  onSetClientPaid: number
}

export interface ReportCrewRole {
  name: string
  days: number
  paid: number
}

export interface ReportCrewJob {
  projectId: string
  project: string
  days: number
  paid: number
  /** Ostatni dzień pracy (kalendarz) albo data projektu. */
  lastDate: string
  roles: string[]
}

export interface ReportCrewMember {
  id: string
  name: string
  days: number
  projects: number
  paid: number
  avgDayRate: number | null
  roles: ReportCrewRole[]
  jobs: ReportCrewJob[]
}

export interface ReportCrew {
  members: ReportCrewMember[]
  days: number
  paid: number
  /** Imiona z kosztów ekipy spoza bazy (nie ma ich w tabeli). */
  outside: string[]
}

export interface ReportNote {
  /** `disagreement` — dwa moduły liczą inaczej; `gap` — brak w danych; `info` — uwaga. */
  kind: 'disagreement' | 'gap' | 'info'
  code: string
  text: string
  projectIds?: string[]
}

export interface ReportPrevious {
  period: ReportPeriod
  /** Okres ma projekt albo zapisany koszt stały. Sam przeniesiony sprzęt się nie liczy. */
  hasData: boolean
  provisional: boolean
  /** Dlaczego brak porównania; `null`, gdy dane są. */
  reason: string | null
}

export interface PeriodReport {
  version: 1
  generatedAt: string
  period: ReportPeriod
  /** Okres trwa albo jest przyszły — koszty firmy do jego końca z planu. */
  provisional: boolean
  /** Warstwa 2 per projekt (widok roku, decyzja A). */
  perProject: boolean
  view: ReportView
  definitions: ReportDefinition[]
  metrics: ReportMetric[]
  /** Wynik po kosztach firmy w drugim widoku sprzętu. */
  alternativeView: { gear: ReportView['gear']; gearLabel: string; gearCost: number; companyCosts: number; result: number }
  /** Wyceny w toku (po dacie księgowej), nie wchodzą do wyniku. */
  pipeline: { count: number; value: number }
  /** Z faktur / z planu / z Realizacji — jak mocne są liczby. */
  coverage: {
    projects: number
    invoiced: number
    partial: number
    withCosts: number
    noFinancials: number
    plan: { revenue: number; costs: number; margin: number }
  }
  projects: ReportProject[]
  clients: ReportClient[]
  payments: ReportPayments
  companyCosts: ReportCompanyCosts
  marketing: ReportMarketing
  gear: ReportGear
  crew: ReportCrew
  previous: ReportPrevious
  notes: ReportNote[]
}

// ── Okresy ───────────────────────────────────────────────────────────────────

export function previousPeriod(period: Period): Period {
  if (period.kind === 'year') return { kind: 'year', year: period.year - 1 }
  const count = period.kind === 'quarter' ? 4 : period.kind === 'half' ? 2 : 12
  const index = period.index ?? 1
  return index > 1 ? { ...period, index: index - 1 } : { ...period, year: period.year - 1, index: count }
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export function reportPeriod(period: Period): ReportPeriod {
  const months = periodMonths(period)
  return {
    kind: period.kind,
    year: period.year,
    index: period.kind === 'year' ? null : (period.index ?? 1),
    label: periodLabel(period),
    from: `${months[0]}-01`,
    to: lastDayOfMonth(months[months.length - 1]),
    months,
  }
}

// ── Drobne ───────────────────────────────────────────────────────────────────

/** Grosze: JSON i tabele pokazują te same liczby. */
const r2 = (value: number) => Math.round(value * 100) / 100
const r2n = (value: number | null) => (value === null ? null : r2(value))
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const EPS = 1

/** „12 345 zł" ze zwykłymi spacjami (tekst trafia do JSON i Markdown). */
const zl = (amount: number) =>
  `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' }).replace(/[\u00a0\u202f]/g, ' ')} zł`

function viewOf(spread: boolean, settings: GearSpreadSettings): ReportView {
  return spread
    ? {
        gear: 'spread',
        gearLabel: 'rozłożony',
        description: `zakupy od ${zl(settings.thresholdPln)} netto po równo przez ${settings.months} mies., tańsze w całości w miesiącu zakupu`,
        thresholdPln: settings.thresholdPln,
        months: settings.months,
      }
    : {
        gear: 'full',
        gearLabel: 'w całości',
        description: 'każdy zakup w miesiącu zakupu (jak zakupy uderzyły w konto)',
        thresholdPln: settings.thresholdPln,
        months: settings.months,
      }
}

export function reportDefinitions(view: ReportView, perProject: boolean): ReportDefinition[] {
  return [
    {
      key: 'layer1',
      label: 'Marża na realizacji (W1)',
      text: 'Przychód − koszty bezpośrednie projektu, przed podatkiem. To liczba do oceny pojedynczego zlecenia.',
    },
    {
      key: 'layer2',
      label: 'Wynik po kosztach firmy (W2)',
      text: 'W1 − ryczałt − ZUS − subskrypcje i koszty stałe − sprzęt − marketing. Dla okresu zawsze; per projekt i per klient tylko w raporcie rocznym (koszty firmy dzielone wg udziału w przychodzie roku).',
    },
    {
      key: 'producerMargin',
      label: 'Marża producencka',
      text: 'W1 − ryczałt − wartość mojej pracy (pozycje „Moja praca" w Realizacji, a bez Realizacji pozycje „Ja" z wyceny, po ich koszcie). Czy zlecenie zarabia, gdybym tylko produkował, a na plan wysłał kogoś innego. Suma po projektach; wynikiem firmy zostaje W2.',
    },
    {
      key: 'rentals',
      label: 'Wynajem sprzętu',
      text: 'Suma wierszy „Wynajem sprzętu" w Realizacji projektów okresu (na cały projekt i w dniach), a gdzie Finanse liczą plan — z planu. Część kosztów bezpośrednich, nie dodatkowy koszt.',
    },
    {
      key: 'gearView',
      label: 'Widok sprzętu',
      text: `${view.gearLabel} — ${view.description}. Przełącznik „Rozłóż duże zakupy sprzętu" zmienia koszty firmy i W2; W1 się nie zmienia.`,
    },
    {
      key: 'sources',
      label: 'Skąd liczby',
      text: 'Przychód netto: faktury (w miesiącu wystawienia), a gdzie ich brak — plan z wyceny (PDF) z dodatkami. Koszty: z Realizacji, a gdzie ich brak — z planu. Kwoty w zł; projekty w EUR po kursie zamrożonym w wycenie, faktura w zł zastępuje plan.',
    },
    {
      key: 'anchor',
      label: 'Data projektu w raporcie',
      text: 'Kotwica: data pierwszej faktury, a bez faktur data projektu. W okresie leżą koszty projektu i jego niezafakturowany przychód; faktury liczą się w miesiącu wystawienia.',
    },
    {
      key: 'provisional',
      label: 'Wstępnie',
      text: 'Okres, który się nie skończył: koszty firmy do jego końca z planu (raty subskrypcji, rozłożony sprzęt), projekty w realizacji z planu.',
    },
    ...(perProject
      ? []
      : [
          {
            key: 'decisionA',
            label: 'Warstwa 2 per projekt',
            text: 'W kwartale i półroczu raport pokazuje W1 per projekt i klient oraz W2 całej firmy; W2 per projekt jest w raporcie rocznym.',
          },
        ]),
  ]
}

// ── Budowniczy ───────────────────────────────────────────────────────────────

function metricRow(
  key: string,
  label: string,
  group: MetricGroup,
  value: number,
  previous: number | null,
  options: { unit?: 'pln' | 'count'; emphasis?: boolean; pctOfRevenue?: number | null } = {}
): ReportMetric {
  const change = previous === null ? null : r2(value - previous)
  return {
    key,
    label,
    unit: options.unit ?? 'pln',
    group,
    value: r2(value),
    previous: r2n(previous),
    change,
    changePct: change === null || previous === null || Math.abs(previous) < 0.005 ? null : r2((change / Math.abs(previous)) * 100),
    emphasis: options.emphasis ?? false,
    pctOfRevenue: r2n(options.pctOfRevenue ?? null),
  }
}

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null)

function flagsOf(money: ProjectMoney): string[] {
  const flags: string[] = []
  if (money.revenueNote === 'missing_amount') flags.push('faktura bez kwoty')
  if (money.revenueNote === 'partial') {
    flags.push(`zafakturowano ${zl(money.invoiced ?? 0)} z ${zl(money.revenue ?? 0)}`)
  }
  if (money.revenueNote === 'planned') flags.push('faktura zaplanowana')
  if (money.revenue === null) flags.push('brak kwoty')
  if (money.costsNote === 'partial') flags.push('koszty wpisane częściowo — liczy się plan')
  return flags
}

function reportProject(
  row: ProjectMargin,
  project: Project,
  groups: ClientGroup[],
  groupName: (scope: string) => string | null
): ReportProject {
  const money = quoteMoney(project.quote?.data)
  const scope = clientScopeOf(groups, project.client ?? '')
  return {
    id: row.money.id,
    name: project.name,
    client: (project.client ?? '').trim(),
    clientScope: scope,
    group: groupName(scope),
    status: project.status,
    statusLabel: PROJECT_STATUS_LABELS[project.status] ?? project.status,
    anchor: row.money.anchor,
    anchored: row.anchored,
    revenue: r2(row.revenue),
    costs: r2(row.costs),
    margin: r2(row.margin),
    marginPct: r2n(pctOf(row.margin, row.revenue)),
    tax: r2(row.tax),
    known: row.known,
    revenueBasis: row.money.revenueBasis,
    costsBasis: row.money.costsBasis,
    flags: flagsOf(row.money),
    currency: money.currency === 'EUR' ? 'EUR' : 'PLN',
    exchangeRate: money.currency === 'EUR' ? money.rate : null,
    share: row.share === null ? null : r2(row.share * 10000) / 10000,
    overhead: r2n(row.overhead),
    result: r2n(row.result),
    // R2: marża producencka (po podatku, minus moja praca); `null` = „brak kwoty".
    extra: { producerMargin: row.known ? r2(row.producerMargin) : null },
  }
}

function monthDistance(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split('-').map(Number)
  const [ty, tm] = toMonth.split('-').map(Number)
  return ty * 12 + tm - (fy * 12 + fm)
}

/** Prognoza spłaty tylko do 10 lat naprzód (odpowiedź M.J.); dalej to szum. */
function nearPayoff(month: string | null, today: string): string | null {
  return month && monthDistance(today.slice(0, 7), month) <= 120 ? month : null
}

/** Kampania przycięta do okresu: okno emisji tylko w jego granicach. */
function clipCampaign(campaign: Campaign, from: string, to: string): Campaign {
  const start = campaign.startDate && campaign.startDate > from ? campaign.startDate : from
  const end = campaign.endDate && campaign.endDate < to ? campaign.endDate : to
  // Bez okna w okresie (kampania poza nim) zostają same odczyty i leady okresu.
  const overlaps = !!campaign.startDate && start <= end
  return { ...campaign, startDate: overlaps ? start : '', endDate: overlaps ? end : undefined }
}

function campaignPeriodPart(summary: CampaignSummary): ReportCampaignPeriod {
  return {
    spend: r2(summary.spend),
    estimatedMonths: summary.estimatedMonths,
    clicks: summary.clicks,
    impressions: summary.impressions,
    ctr: r2n(summary.ctr),
    cpc: r2n(summary.cpc),
    leads: summary.leads,
    costPerLead: r2n(summary.costPerLead),
    costPerRealLead: r2n(summary.costPerRealLead),
    jobs: summary.projects.won.map((p) => p.name),
    costPerJob: r2n(summary.costPerWon),
    revenue: r2(summary.revenue),
    roas: r2n(summary.roas),
  }
}

function campaignToDatePart(summary: CampaignSummary): ReportCampaignToDate {
  return {
    spend: r2(summary.spend),
    leads: summary.leads,
    jobs: summary.projects.won.map((p) => p.name),
    lost: summary.projects.lost,
    costPerJob: r2n(summary.costPerWon),
    revenue: r2(summary.revenue),
    roas: r2n(summary.roas),
    profitAfterAds: r2(summary.profitAfterAds),
  }
}

function buildMarketing(
  input: ReportInput,
  period: ReportPeriod,
  periodDef: Period,
  ledgerMarketing: number,
  leadsAll: Lead[],
  ledgerById: Map<string, ProjectMoney>,
  notes: ReportNote[]
): ReportMarketing {
  const quoteSentProjectIds = new Set(
    input.events.filter((e) => e.kind === 'quote_sent' && e.projectId && !e.deletedAt).map((e) => e.projectId as string)
  )
  const leadsInPeriod = leadsAll.filter((lead) => lead.date >= period.from && lead.date <= period.to)
  const costsInPeriod = input.fixedCosts.filter((cost) => isInPeriod(cost.month, periodDef))
  const knownCampaigns = new Set(input.campaigns.map((c) => c.id))
  const campaigns: ReportCampaign[] = []
  let campaignSpend = 0
  const revenueDiffs: string[] = []
  const estimated: string[] = []

  const ordered = [...input.campaigns].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'pl'))
  ordered.forEach((campaign) => {
    const clipped = summarizeCampaign(clipCampaign(campaign, period.from, period.to), {
      costs: costsInPeriod,
      leads: leadsInPeriod,
      projects: input.projects,
      quoteSentProjectIds,
      today: input.today,
    })
    campaignSpend += clipped.spend
    if (clipped.spend === 0 && clipped.leads.total === 0) return
    const toDate = summarizeCampaign(campaign, {
      costs: input.fixedCosts,
      leads: leadsAll,
      projects: input.projects,
      quoteSentProjectIds,
      today: input.today,
    })
    campaigns.push({
      id: campaign.id,
      name: campaign.name,
      platform: campaign.platform,
      start: campaign.startDate,
      end: campaign.endDate ?? null,
      toDate: campaignToDatePart(toDate),
      inPeriod: campaignPeriodPart(clipped),
    })
    clipped.estimatedMonths.forEach((month) => estimated.push(`${campaign.name}: ${month}`))
    // Marketing liczy przychód zleceń z planu z wyceny; pętla pieniędzy z faktur.
    new Map([...clipped.projects.won, ...toDate.projects.won].map((p) => [p.id, p])).forEach((project) => {
      const loop = ledgerById.get(project.id)?.revenue
      const plan = project.financials?.sumaNetto ?? 0
      if (typeof loop === 'number' && Math.abs(loop - plan) > EPS) {
        revenueDiffs.push(`${project.name} (plan ${zl(plan)}, pętla pieniędzy ${zl(loop)})`)
      }
    })
  })

  if (revenueDiffs.length > 0) {
    notes.push({
      kind: 'disagreement',
      code: 'marketing_revenue',
      text: `ROAS w Marketingu liczy przychód z planu z wyceny, a Finanse z faktur i dodatków; różnią się dla: ${revenueDiffs.join('; ')}.`,
    })
  }
  if (estimated.length > 0 || Math.abs(campaignSpend - ledgerMarketing) > EPS) {
    const why = estimated.length > 0 ? ` Szacunek z budżetu (brak odczytu z panelu): ${estimated.join(', ')}.` : ''
    notes.push({
      kind: 'disagreement',
      code: 'marketing_spend',
      text: `Wydatek kampanii w Marketingu ${zl(campaignSpend)}, marketing w kosztach firmy ${zl(ledgerMarketing)} (rejestr liczy tylko wpisane koszty).${why}`,
    })
  }

  const outside = leadsInPeriod.filter((lead) => !lead.campaignId || !knownCampaigns.has(lead.campaignId))
  return {
    ledgerSpend: r2(ledgerMarketing),
    campaignSpend: r2(campaignSpend),
    campaigns,
    outsideLeads: countLeads(outside),
    leads: countLeads(leadsInPeriod),
  }
}

function buildGear(
  input: ReportInput,
  summary: MarginSummary,
  jobs: Project[],
  periodDef: Period,
  notes: ReportNote[]
): ReportGear {
  const gear: GearPeriodCost = summary.gear
  const now = new Date(`${input.today}T12:00:00`)
  const forPeriod = computeGearReport(input.equipment, jobs, { now, events: input.events })
  const lifetime = computeGearReport(input.equipment, input.projects, { now, events: input.events })
  const lifetimeById = new Map(lifetime.items.map((row) => [row.item.id, row]))

  const onSet: ReportGearUse[] = forPeriod.items
    .filter((row) => row.daysUsed > 0)
    .map((row) => {
      const life = lifetimeById.get(row.item.id) ?? row
      return {
        itemId: row.item.id,
        name: row.item.name,
        daysUsed: row.daysUsed,
        rentValue: r2(row.rentValue),
        clientPaid: r2(row.clientPaid),
        invested: r2(life.invested),
        rentValuePct: r2n(life.rentValuePct),
        clientPaidPct: r2n(life.clientPaidPct),
        rentPayoffMonth: nearPayoff(life.rentPayoffMonth, input.today),
        clientPayoffMonth: nearPayoff(life.clientPayoffMonth, input.today),
      }
    })
    .sort((a, b) => b.rentValue - a.rentValue || a.name.localeCompare(b.name, 'pl'))

  const undatedNames = gear.undated.map((p) => p.name)
  if (undatedNames.length > 0) {
    const total = sum(gear.undated.map((p) => p.price))
    notes.push({
      kind: 'disagreement',
      code: 'gear_undated',
      text: `Sprzęt bez daty zakupu (${undatedNames.join(', ')}, razem ${zl(total)}) nie liczy się w kosztach firmy, ale statystyki sprzętu wliczają go do „zainwestowano" przy spłacie.`,
    })
  }
  if (gear.unpriced.length > 0) {
    notes.push({
      kind: 'gap',
      code: 'gear_unpriced',
      text: `Sprzęt bez ceny zakupu: ${gear.unpriced.map((p) => p.name).join(', ')}.`,
    })
  }
  gear.retired.forEach((line) => {
    notes.push({
      kind: 'gap',
      code: 'gear_retired',
      text: `${line.name}: wycofany ${line.retiredMonth}, nierozłożone ${zl(line.unspread)} się nie liczy (brak ceny sprzedaży).`,
    })
  })

  return {
    view: gear.spread ? 'spread' : 'full',
    total: r2(gear.total),
    catalogue: r2(gear.catalogue),
    carried: r2(gear.carried),
    manual: r2(gear.manual),
    lines: gear.lines.map(({ line, amount, carried }) => ({
      itemId: line.itemId,
      name: line.name,
      onSet: line.onSet,
      date: line.date,
      price: r2(line.price),
      mode: line.mode,
      monthly: r2(line.monthly),
      amount: r2(amount),
      carried,
      firstMonth: line.firstMonth,
      lastMonth: line.lastMonth,
      retiredMonth: line.retiredMonth,
    })),
    purchases: gearPurchases(input.equipment)
      .filter((p) => p.date !== null && isInPeriod(p.date, periodDef) && p.price > 0)
      .map((p) => ({ itemId: p.itemId, name: p.name, onSet: p.onSet, date: p.date as string, price: r2(p.price) })),
    manualEntries: gear.manualCosts.map(({ cost, counted }) => ({
      label: cost.label || 'Sprzęt',
      month: cost.month,
      amount: r2(cost.amount),
      counted: r2(counted),
    })),
    undated: gear.undated.map((p) => ({ name: p.name, price: r2(p.price) })),
    unpriced: gear.unpriced.map((p) => ({ name: p.name })),
    retired: gear.retired.map((l) => ({ name: l.name, month: l.retiredMonth as string, unspread: r2(l.unspread) })),
    onSet,
    onSetRentValue: r2(sum(onSet.map((u) => u.rentValue))),
    onSetClientPaid: r2(sum(onSet.map((u) => u.clientPaid))),
  }
}

function buildCrew(
  input: ReportInput,
  jobs: Project[],
  period: Period,
  directCosts: number,
  notes: ReportNote[]
): ReportCrew {
  const now = new Date(`${input.today}T12:00:00`)
  const { ranking, outside } = crewOnProjects(input.crew, jobs, { events: input.events, now })
  const members: ReportCrewMember[] = ranking.map(({ member, stats }) => ({
    id: member.id,
    name: member.name,
    days: stats.days,
    projects: stats.projects,
    paid: r2(stats.paidTotal),
    avgDayRate: r2n(stats.avgDayRate),
    roles: stats.roles.map((role) => ({ name: role.name, days: role.days, paid: r2(role.paid) })),
    jobs: stats.history.map((entry) => ({
      projectId: entry.project.id,
      project: entry.project.name,
      days: entry.days,
      paid: r2(entry.paid),
      lastDate: entry.lastDate,
      roles: entry.roles,
    })),
  }))
  const paid = r2(sum(members.map((m) => m.paid)))

  if (directCosts > EPS) {
    notes.push({
      kind: 'disagreement',
      code: 'crew_coverage',
      text: `Statystyki Ekipy liczą tylko wiersze z Realizacji: ${zl(paid)} z ${zl(directCosts)} kosztów bezpośrednich okresu. Reszta to plan bez podziału na osoby albo inne kategorie kosztów.`,
    })
  }
  const shifted = members.flatMap((m) =>
    m.jobs.filter((job) => !isInPeriod(job.lastDate, period)).map((job) => `${m.name} — ${job.project} (${formatDate(job.lastDate)})`)
  )
  if (shifted.length > 0) {
    notes.push({
      kind: 'disagreement',
      code: 'crew_dates',
      text: `Ekipa liczona wg zleceń okresu (koszty projektu leżą w okresie), ale dzień pracy wypada w kalendarzu poza nim: ${shifted.join('; ')}.`,
    })
  }
  if (outside.length > 0) {
    notes.push({
      kind: 'gap',
      code: 'crew_outside',
      text: `Osoby z kosztów ekipy spoza bazy Ekipy (nie ma ich w tabeli): ${outside.join(', ')}.`,
    })
  }
  return { members, days: sum(members.map((m) => m.days)), paid, outside }
}

/** Zbiera wiersze projektów w grupy klientów i liczy ich sumy przez rejestr marży (zakres filtra). */
function buildClients(
  rows: ReportProject[],
  groups: ClientGroup[],
  baseInput: MarginInput,
  periodDef: Period,
  totalRevenue: number
): ReportClient[] {
  const byScope = new Map<string, ReportProject[]>()
  rows.forEach((row) => byScope.set(row.clientScope, [...(byScope.get(row.clientScope) ?? []), row]))
  const clients = [...byScope.entries()].map(([scope, list]): ReportClient => {
    const scoped = marginSummary({ ...baseInput, scope: new Set(list.map((r) => r.id)) }, periodDef).scoped!
    const isGroup = isGroupScope(scope)
    const group = isGroup ? liveGroups(groups).find((g) => groupScopeValue(g.id) === scope) : undefined
    // Pisownie klienta w okresie, od najczęstszej.
    const spellings = new Map<string, number>()
    list.forEach((r) => spellings.set(r.client, (spellings.get(r.client) ?? 0) + 1))
    const members = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl')).map(([name]) => name)
    const fallbackName = members[0] || 'Bez klienta'
    return {
      scope,
      name: (group?.name.trim() || (isGroup ? members.join(' + ') : fallbackName)) || 'Bez klienta',
      isGroup,
      members: members.map((m) => m || 'Bez klienta'),
      projects: scoped.projects,
      revenue: r2(scoped.revenue),
      sharePct: r2n(pctOf(scoped.revenue, totalRevenue)),
      costs: r2(scoped.costs),
      margin: r2(scoped.margin),
      marginPct: r2n(pctOf(scoped.margin, scoped.revenue)),
      overhead: r2n(scoped.overhead),
      result: r2n(scoped.result),
      extra: { producerMargin: r2(scoped.producerMargin) },
    }
  })
  return clients.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'pl'))
}

export function buildPeriodReport(input: ReportInput, periodDef: Period): PeriodReport {
  const projects = input.projects.filter((p) => !p.deletedAt)
  const events = input.events.filter((e) => !e.deletedAt)
  const data: ReportInput = { ...input, projects, events }
  const period = reportPeriod(periodDef)
  const prevDef = previousPeriod(periodDef)
  const prevPeriod = reportPeriod(prevDef)
  const projectsById = new Map(projects.map((p) => [p.id, p]))
  const notes: ReportNote[] = []

  // ── Rejestr marży: ten okres, poprzedni, drugi widok sprzętu ───────────────
  const taxRate = input.taxRatePercent ?? companyTaxRate(null)
  const ledger = moneyLedger(projects, events, input.today, taxRate)
  const ledgerById = new Map(ledger.map((m) => [m.id, m]))
  const years = [periodDef.year, prevDef.year]
  const fixedCosts = effectiveFixedCosts(
    input.fixedCosts,
    input.subscriptions,
    `${Math.min(...years)}-01`,
    `${Math.max(...years)}-12`
  )
  const baseInput: MarginInput = {
    ledger,
    fixedCosts,
    equipment: input.equipment,
    spread: input.spread,
    settings: input.settings,
    today: input.today,
    scope: null,
  }
  const current = marginSummary(baseInput, periodDef)
  const previous = marginSummary(baseInput, prevDef)
  const other = marginSummary({ ...baseInput, spread: !input.spread }, periodDef)
  const view = viewOf(input.spread, input.settings)
  const otherView = viewOf(!input.spread, input.settings)
  const perProject = current.perProject

  // Poprzedni okres bez projektu i bez zapisanego kosztu stałego = „brak danych";
  // sam przeniesiony sprzęt (zakupy sprzed książek) się nie liczy.
  const prevHasData = previous.projects.length > 0 || fixedCosts.some((cost) => isInPeriod(cost.month, prevDef))
  const prev: ReportPrevious = {
    period: prevPeriod,
    hasData: prevHasData,
    provisional: previous.provisional,
    reason: prevHasData ? null : `Brak danych za ${prevPeriod.label}: żadnego projektu ani zapisanego kosztu stałego.`,
  }
  const before = (pick: (s: MarginSummary) => number): number | null => (prevHasData ? pick(previous) : null)

  // ── Projekty ───────────────────────────────────────────────────────────────
  const groupNameOf = (scope: string): string | null =>
    isGroupScope(scope) ? (liveGroups(input.groups).find((g) => groupScopeValue(g.id) === scope)?.name.trim() ?? null) : null
  const rows: ReportProject[] = current.projects.flatMap((row) => {
    const project = projectsById.get(row.money.id)
    return project ? [reportProject(row, project, input.groups, groupNameOf)] : []
  })
  const jobProjects = current.projects
    .filter((row) => row.anchored)
    .flatMap((row) => {
      const project = projectsById.get(row.money.id)
      return project && countsTowardRevenue(project.status) ? [project] : []
    })

  // ── Nagłówek: wiersze porównania ───────────────────────────────────────────
  const revenue = current.totals.revenue
  const metrics: ReportMetric[] = [
    metricRow('projects', 'Projekty (liczba)', 'projects', current.projects.length, prevHasData ? previous.projects.length : null, { unit: 'count' }),
    metricRow('revenue', 'Przychód netto', 'layer1', revenue, before((s) => s.totals.revenue)),
    metricRow('directCosts', 'Koszty bezpośrednie', 'layer1', current.totals.costs, before((s) => s.totals.costs)),
    // U2 (§17.1): wynajem sprzętu — jedna liczba projektu, część kosztów bezpośrednich.
    metricRow('rentals', 'w tym wynajem sprzętu', 'layer1', periodRentals(current.projects, projectsById).total, before((s) => periodRentals(s.projects, projectsById).total)),
    metricRow('margin', 'Marża na realizacji (W1)', 'layer1', current.totals.margin, before((s) => s.totals.margin), {
      emphasis: true,
      pctOfRevenue: pctOf(current.totals.margin, revenue),
    }),
    // R2: suma marż producenckich projektów — po podatku i po wartości mojej pracy.
    metricRow('producerMargin', 'Marża producencka', 'layer1', current.totals.producerMargin, before((s) => s.totals.producerMargin), {
      pctOfRevenue: pctOf(current.totals.producerMargin, revenue),
    }),
    metricRow('tax', 'Podatek (ryczałt)', 'costs', current.company.tax, before((s) => s.company.tax)),
    metricRow('zus', 'ZUS', 'costs', current.company.zus, before((s) => s.company.zus)),
    metricRow('fixed', 'Subskrypcje i koszty stałe', 'costs', current.company.fixed, before((s) => s.company.fixed)),
    metricRow('marketing', 'Marketing', 'costs', current.company.marketing, before((s) => s.company.marketing)),
    metricRow('gear', 'Sprzęt', 'costs', current.company.gear, before((s) => s.company.gear)),
    metricRow('companyCosts', 'Koszty firmy razem', 'costs', current.company.total, before((s) => s.company.total)),
    metricRow('result', 'Wynik po kosztach firmy (W2)', 'layer2', current.totals.result ?? 0, before((s) => s.totals.result ?? 0), {
      emphasis: true,
      pctOfRevenue: pctOf(current.totals.result ?? 0, revenue),
    }),
    metricRow('paid', 'Wpłynęło', 'payments', current.money.paid.revenue, before((s) => s.money.paid.revenue)),
    metricRow('awaiting', 'Czeka na wpłatę', 'payments', current.money.awaiting.revenue, before((s) => s.money.awaiting.revenue)),
  ]

  // ── Klienci i grupy ────────────────────────────────────────────────────────
  const clients = buildClients(rows, input.groups, baseInput, periodDef, revenue)

  // ── Płatności ──────────────────────────────────────────────────────────────
  const named = (id: string) => ({
    project: projectsById.get(id)?.name ?? id,
    client: (projectsById.get(id)?.client ?? '').trim(),
  })
  const issued: ReportInvoice[] = ledger
    .filter((money) => money.counts)
    .flatMap((money) =>
      money.invoices
        .filter((invoice) => isInPeriod(invoice.sent, periodDef))
        .map((invoice) => ({
          projectId: money.id,
          ...named(money.id),
          number: invoice.number ?? null,
          sent: invoice.sent,
          amount: r2n(invoiceAmount(invoice)),
          state: invoice.state,
          paid: invoice.paid,
          daysToPaid: invoice.daysToPaid,
        }))
    )
    .sort((a, b) => a.sent.localeCompare(b.sent))
  const open: ReportOpenInvoice[] = openInvoices(ledger, input.today).map((invoice) => ({
    projectId: invoice.projectId,
    ...named(invoice.projectId),
    number: invoice.number ?? null,
    sent: invoice.sent,
    dueDate: invoice.dueDate,
    dueAssumed: invoice.dueAssumed,
    amount: r2n(invoice.amount),
    daysOverdue: invoice.daysOverdue,
    issuedInPeriod: isInPeriod(invoice.sent, periodDef),
  }))
  const overdue = open.filter((invoice) => invoice.daysOverdue > 0)
  const payments: ReportPayments = {
    paid: { revenue: r2(current.money.paid.revenue), count: current.money.paid.count },
    awaiting: { revenue: r2(current.money.awaiting.revenue), count: current.money.awaiting.count },
    invoicedRevenue: r2(current.money.invoicedRevenue),
    fromPlan: r2(current.money.revenue - current.money.invoicedRevenue),
    issued,
    issuedTotal: r2(sum(issued.map((i) => i.amount ?? 0))),
    issuedWithoutAmount: issued.filter((i) => i.amount === null).length,
    paymentDays: paymentDays(ledger, periodDef),
    open,
    openTotal: r2(sum(open.map((i) => i.amount ?? 0))),
    openWithoutAmount: open.filter((i) => i.amount === null).length,
    overdueCount: overdue.length,
    overdueTotal: r2(sum(overdue.map((i) => i.amount ?? 0))),
  }

  // ── Koszty firmy, subskrypcje ──────────────────────────────────────────────
  const periodCosts = fixedCosts.filter((cost) => isInPeriod(cost.month, periodDef))
  const subsById = new Map(input.subscriptions.map((s) => [s.id, s]))
  const bySub = totalsBySubscription(periodCosts)
  const subscriptions: ReportSubscription[] = [...bySub.entries()]
    .map(([id, amount]) => {
      const sub = subsById.get(id)
      const category = sub ? (sub.category ?? 'other') : 'other'
      return {
        id,
        name: sub?.name ?? id,
        category: String(category),
        categoryLabel: COST_CATEGORY_LABELS[category as keyof typeof COST_CATEGORY_LABELS] ?? 'Inne',
        amount: r2(amount),
        charges: periodCosts.filter((c) => c.subscriptionId === id && !c.deletedAt).length,
      }
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pl'))
  const fixedBreakdown = current.money.fixedCosts
  const currentMonth = input.today.slice(0, 7)
  const companyCosts: ReportCompanyCosts = {
    tax: r2(current.company.tax),
    zus: r2(current.company.zus),
    fixed: r2(current.company.fixed),
    marketing: r2(current.company.marketing),
    gear: r2(current.company.gear),
    total: r2(current.company.total),
    byCategory: COST_CATEGORY_KEYS.filter((key) => key !== 'gear' && Math.abs(fixedBreakdown.byCategory[key] ?? 0) > 0.005).map((key) => ({
      key,
      label: COST_CATEGORY_LABELS[key],
      amount: r2(fixedBreakdown.byCategory[key] ?? 0),
    })),
    subscriptions,
    subscriptionsTotal: r2(fixedBreakdown.subscriptions),
    derived: r2(fixedBreakdown.derived),
    planned: r2(sum(periodCosts.filter((c) => c.derived && c.month > currentMonth).map((c) => c.amount))),
  }
  const categoryTotal = sum(companyCosts.byCategory.map((c) => c.amount))
  const ledgerTotal = current.company.zus + current.company.fixed + current.company.marketing
  if (Math.abs(categoryTotal - ledgerTotal) > EPS) {
    notes.push({
      kind: 'info',
      code: 'costs_linked',
      text: `Kategorie kosztów stałych sumują się do ${zl(categoryTotal)}, a rejestr liczy ${zl(ledgerTotal)}: różnicę robią pozycje powiązane z zakupami z katalogu (liczy je sprzęt).`,
    })
  }

  // ── Marketing, sprzęt, ekipa ───────────────────────────────────────────────
  const leadsAll = leadsFromEvents(events)
  const marketing = buildMarketing(data, period, periodDef, current.company.marketing, leadsAll, ledgerById, notes)
  const gear = buildGear(data, current, jobProjects, periodDef, notes)
  const crew = buildCrew(data, jobProjects, periodDef, current.totals.costs, notes)

  // ── Luki w danych i uwagi ──────────────────────────────────────────────────
  const anchoredRows = rows.filter((r) => r.anchored)
  const noCosts = anchoredRows.filter((r) => ledgerById.get(r.id)?.actualCosts === null)
  if (noCosts.length > 0) {
    notes.push({
      kind: 'gap',
      code: 'plan_costs',
      text: `${noCosts.length} z ${anchoredRows.length} projektów bez kosztów w Realizacji — koszty z planu: ${noCosts.map((r) => r.name).join('; ')}.`,
      projectIds: noCosts.map((r) => r.id),
    })
  }
  rows
    .filter((r) => r.flags.some((f) => f === 'faktura bez kwoty'))
    .forEach((r) =>
      notes.push({
        kind: 'gap',
        code: 'invoice_without_amount',
        text: `${r.name}: faktura bez kwoty — przychód z planu (${zl(r.revenue)}). Wpisz kwotę faktury.`,
        projectIds: [r.id],
      })
    )
  rows
    .filter((r) => r.flags.some((f) => f.startsWith('zafakturowano')))
    .forEach((r) =>
      notes.push({
        kind: 'gap',
        code: 'partial_invoicing',
        text: `${r.name}: ${r.flags.find((f) => f.startsWith('zafakturowano'))} (zaliczka) — reszta z planu.`,
        projectIds: [r.id],
      })
    )
  rows
    .filter((r) => !r.known)
    .forEach((r) =>
      notes.push({ kind: 'gap', code: 'no_amount', text: `${r.name}: brak kwoty (ani planu, ani faktur).`, projectIds: [r.id] })
    )
  if (payments.openWithoutAmount > 0) {
    notes.push({
      kind: 'gap',
      code: 'open_without_amount',
      text: `${payments.openWithoutAmount} nieopłacona faktura bez kwoty — nie wchodzi do sumy „czeka".`,
    })
  }
  const foreign = rows.filter((r) => r.currency === 'EUR')
  if (foreign.length > 0) {
    notes.push({
      kind: 'info',
      code: 'eur_jobs',
      text: `${foreign.length} ${foreign.length === 1 ? 'projekt w EUR' : 'projekty w EUR'} (${foreign.map((r) => `${r.name}, kurs ${r.exchangeRate}`).join('; ')}): kwoty w zł po kursie z wyceny, dopóki faktura w zł ich nie zastąpi.`,
      projectIds: foreign.map((r) => r.id),
    })
  }
  if (current.provisional) {
    notes.push({
      kind: 'info',
      code: 'provisional',
      text: 'Okres jeszcze trwa (wstępnie): koszty firmy do jego końca z planu — raty subskrypcji i rozłożony sprzęt — a projekty w realizacji z planu.',
    })
  }
  if (current.unallocated > 0.5 && perProject) {
    notes.push({
      kind: 'info',
      code: 'unallocated',
      text: `Koszty firmy ${zl(current.unallocated)} bez projektów, na które dałoby się je rozłożyć (rok bez przychodu).`,
    })
  }
  if (!prevHasData) {
    notes.push({ kind: 'info', code: 'no_previous', text: `${prev.reason} Porównanie pominięte.` })
  }

  const pipeline = summarizePeriod(projects, [], periodDef)
  const alternativeCompany = other.company
  return {
    version: 1,
    generatedAt: input.today,
    period,
    provisional: current.provisional,
    perProject,
    view,
    definitions: reportDefinitions(view, perProject),
    metrics,
    alternativeView: {
      gear: otherView.gear,
      gearLabel: otherView.gearLabel,
      gearCost: r2(alternativeCompany.gear),
      companyCosts: r2(alternativeCompany.total),
      result: r2(other.totals.result ?? 0),
    },
    pipeline: { count: pipeline.quoteCount, value: r2(pipeline.pipelineValue) },
    coverage: {
      projects: current.money.coverage.projects,
      invoiced: current.money.coverage.invoiced,
      partial: current.money.coverage.partial,
      withCosts: current.money.coverage.withCosts,
      noFinancials: current.money.coverage.noFinancials,
      plan: {
        revenue: r2(current.money.plan.revenue),
        costs: r2(current.money.plan.costs),
        margin: r2(current.money.plan.revenue - current.money.plan.costs),
      },
    },
    projects: rows,
    clients,
    payments,
    companyCosts,
    marketing,
    gear,
    crew,
    previous: prev,
    notes,
  }
}
