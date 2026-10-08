/**
 * Liczby marketingu — czyste funkcje, zero zależności od UI i zapisu.
 *
 * Łańcuch, który liczymy dla kampanii:
 *
 *   wyświetlenia → kliknięcia → zapytania → realne leady → wyceny → zlecenia
 *        CTR          konwersja     jakość       lejek       wygrane
 *
 * i pieniądze przy każdym ogniwie: CPC, koszt zapytania, koszt realnego i
 * bardzo dobrego leada, koszt zlecenia, ROAS, zysk po reklamach.
 *
 * Wydatek miesiąca bierzemy z panelu (pozycja kosztów `marketing` z
 * `campaignId`), a gdy jej jeszcze nie ma — szacujemy z budżetu dziennego.
 * Szacunek jest zawsze oznaczony (`estimated`), żeby nie udawał faktu.
 *
 * Testy w `marketing-calc.test.ts`.
 */

import { addDays, daysBetween } from './calendar-layout'
import type { Lead } from './marketing-leads'
import { originForPlatform, type Campaign } from './marketing-types'
import {
  LEAD_SOURCES,
  countsTowardRevenue,
  leadSourceLabel,
  toYear,
  type FixedCost,
  type Project,
} from './project-types'

/** Google Ads: miesięczny limit wydatków = budżet dzienny × 30,4. */
export const AVG_DAYS_PER_MONTH = 30.4

// ── Okno i budżet ────────────────────────────────────────────────────────────

export interface CampaignWindow {
  start: string
  /** Ostatni dzień liczony: koniec kampanii albo dziś, co wcześniejsze. */
  end: string
  /** Dni emisji do dziś (0 = jeszcze nie wystartowała). */
  days: number
  running: boolean
  upcoming: boolean
  ended: boolean
}

export function campaignWindow(campaign: Campaign, today: string): CampaignWindow | null {
  const start = campaign.startDate
  if (!start) return null
  const end = campaign.endDate && campaign.endDate < today ? campaign.endDate : today
  const upcoming = start > today
  const ended = !!campaign.endDate && campaign.endDate < today
  return {
    start,
    end,
    days: upcoming || end < start ? 0 : daysBetween(start, end) + 1,
    running: !upcoming && !ended,
    upcoming,
    ended,
  }
}

/** Budżet dzienny w danym dniu (pierwsza pozycja obowiązuje od startu). */
export function dailyBudgetOn(campaign: Campaign, day: string): number {
  const steps = campaign.budgets
  if (steps.length === 0) return 0
  let daily = steps[0].daily
  for (const step of steps) if (step.from <= day) daily = step.daily
  return daily
}

/** Suma budżetów dziennych w dniach [from, to] włącznie. */
export function budgetBetween(campaign: Campaign, from: string, to: string): number {
  let total = 0
  for (let day = from; day <= to; day = addDays(day, 1)) total += dailyBudgetOn(campaign, day)
  return total
}

// ── Leady ────────────────────────────────────────────────────────────────────

export interface LeadCounts {
  total: number
  fake: number
  good: number
  veryGood: number
  /** Jeszcze nieocenione (np. dodane w kalendarzu). */
  unrated: number
  /** Realne = dobre + bardzo dobre. */
  real: number
}

export function countLeads(leads: Lead[]): LeadCounts {
  const counts = { total: leads.length, fake: 0, good: 0, veryGood: 0, unrated: 0, real: 0 }
  leads.forEach((lead) => {
    if (lead.quality === 'fake') counts.fake += 1
    else if (lead.quality === 'good') counts.good += 1
    else if (lead.quality === 'very_good') counts.veryGood += 1
    else counts.unrated += 1
  })
  counts.real = counts.good + counts.veryGood
  return counts
}

export function campaignLeads(leads: Lead[], campaignId: string): Lead[] {
  return leads.filter((lead) => lead.campaignId === campaignId)
}

// ── Miesiące ─────────────────────────────────────────────────────────────────

function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7)
}

function monthStart(month: string): string {
  return `${month}-01`
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return addDays(next, -1)
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export interface CampaignMonth {
  /** `YYYY-MM` */
  month: string
  /** Dni emisji w tym miesiącu (do dziś). */
  activeDays: number
  /** Budżet dzienny × dni emisji. */
  budget: number
  /** Wydatek z panelu; `null` = brak odczytu za ten miesiąc. */
  spend: number | null
  clicks: number | null
  impressions: number | null
  /** Do rachunku: wydatek z panelu albo szacunek z budżetu. */
  effectiveSpend: number
  /** `true` = brak odczytu z panelu, liczymy z budżetu. */
  estimated: boolean
  /** Pozycje kosztów za ten miesiąc (zwykle jedna). */
  costs: FixedCost[]
  leads: LeadCounts
}

function sumDefined(values: (number | undefined)[]): number | null {
  const defined = values.filter((v): v is number => typeof v === 'number')
  return defined.length ? defined.reduce((a, b) => a + b, 0) : null
}

/**
 * Miesiące kampanii: okno emisji plus każdy miesiąc, w którym jest odczyt z
 * panelu albo lead tej kampanii (zapytania przychodzą też po zakończeniu).
 */
export function campaignMonths(
  campaign: Campaign,
  costs: FixedCost[],
  leads: Lead[],
  today: string
): CampaignMonth[] {
  const window = campaignWindow(campaign, today)
  const ownCosts = costs.filter((c) => c.campaignId === campaign.id)
  const ownLeads = campaignLeads(leads, campaign.id)

  const keys = new Set<string>()
  if (window && window.days > 0) {
    for (let m = monthOf(window.start); m <= monthOf(window.end); m = nextMonth(m)) keys.add(m)
  }
  ownCosts.forEach((c) => keys.add(c.month))
  ownLeads.forEach((l) => keys.add(monthOf(l.date)))

  return [...keys].sort().map((month) => {
    let activeDays = 0
    let budget = 0
    if (window && window.days > 0) {
      const from = monthStart(month) > window.start ? monthStart(month) : window.start
      const to = monthEnd(month) < window.end ? monthEnd(month) : window.end
      if (from <= to) {
        activeDays = daysBetween(from, to) + 1
        budget = budgetBetween(campaign, from, to)
      }
    }
    const monthCosts = ownCosts.filter((c) => c.month === month)
    const spend = monthCosts.length ? monthCosts.reduce((sum, c) => sum + c.amount, 0) : null
    return {
      month,
      activeDays,
      budget,
      spend,
      clicks: sumDefined(monthCosts.map((c) => c.clicks)),
      impressions: sumDefined(monthCosts.map((c) => c.impressions)),
      effectiveSpend: spend ?? budget,
      estimated: spend === null && budget > 0,
      costs: monthCosts,
      leads: countLeads(ownLeads.filter((l) => monthOf(l.date) === month)),
    }
  })
}

// ── Podsumowanie kampanii ────────────────────────────────────────────────────

export interface CampaignSummary {
  window: CampaignWindow | null
  months: CampaignMonth[]
  /** Wydatek do rachunku (panel + szacunek tam, gdzie panelu brak). */
  spend: number
  spendFromPanel: number
  /** Miesiące liczone z budżetu, bo nie ma odczytu z panelu. */
  estimatedMonths: string[]
  budget: number
  /** Średni wydatek na dzień emisji. */
  dailyAverage: number | null
  clicks: number | null
  impressions: number | null
  /** Kliknięcia / wyświetlenia — z miesięcy, w których są obie liczby. */
  ctr: number | null
  /** Wydatek / kliknięcia — z miesięcy, w których są obie liczby. */
  cpc: number | null
  leads: LeadCounts
  /** Zapytania bez fałszywych / kliknięcia — z miesięcy z kliknięciami. */
  clickToLead: number | null
  costPerLead: number | null
  costPerRealLead: number | null
  costPerVeryGoodLead: number | null
  fakeShare: number | null
  projects: {
    /** Projekty, do których prowadzą leady kampanii. */
    linked: Project[]
    /** Z wyceną (snapshot, wysłana wycena albo status po wycenie). */
    quoted: number
    won: Project[]
    lost: number
  }
  /** Przychód netto zleceń (W realizacji + Zrealizowane). */
  revenue: number
  /** Zysk z tych zleceń (po kosztach produkcji i podatku). */
  profit: number
  /** Wartość otwartych wycen z kampanii. */
  pipeline: number
  costPerWon: number | null
  /** Przychód / wydatek. */
  roas: number | null
  profitAfterAds: number
  /** (zysk − wydatek) / wydatek. */
  roi: number | null
  /** Ile miesięcy reklam opłaca średni zysk z jednego zlecenia. */
  monthsFundedPerWon: number | null
}

function ratio(a: number, b: number | null): number | null {
  return b && b > 0 ? a / b : null
}

export function summarizeCampaign(
  campaign: Campaign,
  params: {
    costs: FixedCost[]
    leads: Lead[]
    projects: Project[]
    /** Wydarzenia (do wykrycia wysłanych wycen). */
    quoteSentProjectIds?: ReadonlySet<string>
    today: string
  }
): CampaignSummary {
  const { costs, projects, today } = params
  const window = campaignWindow(campaign, today)
  const months = campaignMonths(campaign, costs, params.leads, today)
  const own = campaignLeads(params.leads, campaign.id)
  const leads = countLeads(own)

  const spend = months.reduce((sum, m) => sum + m.effectiveSpend, 0)
  const spendFromPanel = months.reduce((sum, m) => sum + (m.spend ?? 0), 0)
  const budget = months.reduce((sum, m) => sum + m.budget, 0)

  const withClicks = months.filter((m) => m.clicks !== null)
  const clicks = withClicks.length ? withClicks.reduce((s, m) => s + (m.clicks ?? 0), 0) : null
  const withImpr = months.filter((m) => m.impressions !== null)
  const impressions = withImpr.length ? withImpr.reduce((s, m) => s + (m.impressions ?? 0), 0) : null

  const both = months.filter((m) => m.clicks !== null && m.impressions !== null)
  const ctr = ratio(
    both.reduce((s, m) => s + (m.clicks ?? 0), 0),
    both.reduce((s, m) => s + (m.impressions ?? 0), 0)
  )
  const paidClicks = months.filter((m) => m.clicks !== null && m.spend !== null)
  const cpc = ratio(
    paidClicks.reduce((s, m) => s + (m.spend ?? 0), 0),
    paidClicks.reduce((s, m) => s + (m.clicks ?? 0), 0)
  )
  const clickToLead = ratio(
    withClicks.reduce((s, m) => s + m.leads.total - m.leads.fake, 0),
    clicks
  )

  const projectById = new Map(projects.map((p) => [p.id, p]))
  const linkedIds = [...new Set(own.map((l) => l.projectId).filter((id): id is string => !!id))]
  const linked = linkedIds.map((id) => projectById.get(id)).filter((p): p is Project => !!p)
  const won = linked.filter((p) => countsTowardRevenue(p.status))
  const quoted = linked.filter(
    (p) => !!p.quote || p.status !== 'quote' || !!params.quoteSentProjectIds?.has(p.id)
  ).length
  const revenue = won.reduce((s, p) => s + (p.financials?.sumaNetto ?? 0), 0)
  const profit = won.reduce((s, p) => s + (p.financials?.zysk ?? 0), 0)
  const pipeline = linked
    .filter((p) => p.status === 'quote')
    .reduce((s, p) => s + (p.financials?.sumaNetto ?? 0), 0)

  const dailyAverage = window && window.days > 0 ? spend / window.days : null
  const monthlySpend = dailyAverage !== null ? dailyAverage * AVG_DAYS_PER_MONTH : null
  const avgProfitPerWon = won.length ? profit / won.length : null

  return {
    window,
    months,
    spend,
    spendFromPanel,
    estimatedMonths: months.filter((m) => m.estimated).map((m) => m.month),
    budget,
    dailyAverage,
    clicks,
    impressions,
    ctr,
    cpc,
    leads,
    clickToLead,
    costPerLead: ratio(spend, leads.total),
    costPerRealLead: ratio(spend, leads.real),
    costPerVeryGoodLead: ratio(spend, leads.veryGood),
    fakeShare: ratio(leads.fake, leads.total),
    projects: { linked, quoted, won, lost: linked.filter((p) => p.status === 'lost').length },
    revenue,
    profit,
    pipeline,
    costPerWon: ratio(spend, won.length),
    roas: ratio(revenue, spend),
    profitAfterAds: profit - spend,
    roi: ratio(profit - spend, spend),
    monthsFundedPerWon:
      avgProfitPerWon !== null && monthlySpend ? avgProfitPerWon / monthlySpend : null,
  }
}

/** Wydatek kampanii w danym roku (panel + szacunek z budżetu). */
export function campaignSpendInYear(
  campaign: Campaign,
  costs: FixedCost[],
  leads: Lead[],
  today: string,
  year: number
): number {
  return campaignMonths(campaign, costs, leads, today)
    .filter((m) => m.month.startsWith(`${year}-`))
    .reduce((sum, m) => sum + m.effectiveSpend, 0)
}

/** Kampania aktywna w danym dniu — domyślna dla nowego leada. */
export function campaignActiveOn(campaigns: Campaign[], day: string): Campaign | null {
  return (
    [...campaigns]
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .find((c) => c.startDate && c.startDate <= day && (!c.endDate || c.endDate >= day)) ?? null
  )
}

// ── Pochodzenie klientów ─────────────────────────────────────────────────────

export interface OriginRow {
  /** Klucz `LEAD_SOURCES`, nieznany klucz dosłownie albo '' = nie ustalono. */
  key: string
  label: string
  projects: number
  /** W realizacji + Zrealizowane. */
  won: number
  revenue: number
  profit: number
  /** Wartość otwartych wycen. */
  pipeline: number
  projectIds: string[]
}

/**
 * Projekty pogrupowane po pochodzeniu klienta. `year` = rok daty księgowej
 * projektu; `null` = cały czas. Wiersze z listy pochodzeń są zawsze (także
 * puste — widać, czego brakuje), nieznane klucze po nich, „nie ustalono" na końcu.
 */
export function originBreakdown(projects: Project[], year: number | null): OriginRow[] {
  const rows = new Map<string, OriginRow>()
  const row = (key: string): OriginRow => {
    let existing = rows.get(key)
    if (!existing) {
      existing = {
        key,
        label: key ? leadSourceLabel(key) : 'Nie ustalono',
        projects: 0,
        won: 0,
        revenue: 0,
        profit: 0,
        pipeline: 0,
        projectIds: [],
      }
      rows.set(key, existing)
    }
    return existing
  }
  LEAD_SOURCES.forEach(row)

  projects
    .filter((p) => year === null || toYear(p.date) === year)
    .forEach((p) => {
      const r = row(p.leadSource?.trim() ?? '')
      r.projects += 1
      r.projectIds.push(p.id)
      if (countsTowardRevenue(p.status)) {
        r.won += 1
        r.revenue += p.financials?.sumaNetto ?? 0
        r.profit += p.financials?.zysk ?? 0
      } else if (p.status === 'quote') {
        r.pipeline += p.financials?.sumaNetto ?? 0
      }
    })

  const known = new Set<string>(LEAD_SOURCES)
  const all = [...rows.values()]
  return [
    ...LEAD_SOURCES.map((key) => rows.get(key)!),
    ...all.filter((r) => r.key && !known.has(r.key)).sort((a, b) => a.label.localeCompare(b.label, 'pl')),
    ...all.filter((r) => r.key === '' && r.projects > 0),
  ]
}

/**
 * Pochodzenie leada: z kampanii wynika z jej platformy, spoza kampanii z pola
 * leada, a gdy go brak — z powiązanego projektu. '' = nie wiadomo.
 */
export function leadOrigin(
  lead: Pick<Lead, 'campaignId' | 'origin' | 'projectId'>,
  campaignsById: ReadonlyMap<string, Pick<Campaign, 'platform'>>,
  projectsById: ReadonlyMap<string, Pick<Project, 'leadSource'>>
): string {
  const campaign = lead.campaignId ? campaignsById.get(lead.campaignId) : undefined
  if (campaign) return originForPlatform(campaign.platform)
  if (lead.origin) return lead.origin
  return (lead.projectId && projectsById.get(lead.projectId)?.leadSource) || ''
}
