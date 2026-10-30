/**
 * Raport okresowy → tabele (S5). Jedno miejsce, z którego czytają TRZY
 * renderery: ekran (zakładka „Raport"), arkusz PDF i plik Markdown. Dzięki
 * temu „te same tabele" znaczy dosłownie te same komórki — tekst jest już
 * sformatowany po polsku, rendery tylko go układają.
 *
 * Kolejność sekcji = kolejność ekranu i PDF; plik Markdown dokłada na początek
 * definicje i „Do wyjaśnienia" (`period-report-markdown.ts`).
 *
 * Moduł czysty — testy w `period-report.test.ts`.
 */

import { formatDate, pln, shortDate } from './money-loop-labels'
import { plural } from './pl-plural'
import type {
  PeriodReport,
  ReportCampaign,
  ReportMetric,
  ReportNote,
  ReportProject,
} from './period-report'

export interface ReportTable {
  caption?: string
  head: string[]
  /** `l` / `r` per kolumna. */
  align: ('l' | 'r')[]
  rows: string[][]
  /** Indeksy wierszy do pogrubienia (warstwy, suma). */
  strong: number[]
}

export interface ReportSection {
  id: string
  title: string
  /** Zdania przed tabelami. */
  lead: string[]
  tables: ReportTable[]
  /** Zdania po tabelach. */
  after: string[]
}

export const NOTE_KIND_LABELS: Record<ReportNote['kind'], string> = {
  disagreement: 'Rozjazd modułów',
  gap: 'Brak w danych',
  info: 'Uwaga',
}

/** Ile wierszy sprzętu i ekipy pokazujemy w tabelach; pełna lista jest w JSON. */
export const GEAR_ROWS_SHOWN = 12

// ── Formatowanie ─────────────────────────────────────────────────────────────

const DASH = '—'

/** „+10 300 zł" / „−25 865 zł" / „±0 zł". */
export function signed(amount: number): string {
  const rounded = Math.sign(amount) * Math.round(Math.abs(amount))
  if (rounded === 0) return '±0 zł'
  return `${rounded > 0 ? '+' : '−'}${pln(Math.abs(rounded))}`
}

export function percent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return DASH
  return `${value.toLocaleString('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`
}

const times = (value: number | null) =>
  value === null ? DASH : `${value.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`

const money = (value: number | null) => (value === null ? DASH : pln(value))

const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`

function monthText(month: string | null): string {
  return month ? `${month.slice(5, 7)}.${month.slice(0, 4)}` : DASH
}

function table(
  head: string[],
  rows: string[][],
  align: ('l' | 'r')[] = head.map((_, i) => (i === 0 ? 'l' : 'r')),
  options: { caption?: string; strong?: number[] } = {}
): ReportTable {
  return { head, rows, align, strong: options.strong ?? [], ...(options.caption ? { caption: options.caption } : {}) }
}

// ── Nagłówek ─────────────────────────────────────────────────────────────────

export function reportTitle(report: PeriodReport): string {
  return `Raport okresowy — ${report.period.label}${report.provisional ? ' (wstępnie)' : ''}`
}

/** Linie pod tytułem: okres, porównanie, widok sprzętu. */
export function reportSubtitle(report: PeriodReport): string[] {
  const { period, previous } = report
  return [
    `Okres ${formatDate(period.from)} – ${formatDate(period.to)}${report.provisional ? ', wstępnie (okres jeszcze trwa)' : ', okres zamknięty'} · wygenerowano ${formatDate(report.generatedAt)}`,
    previous.hasData
      ? `Porównanie z poprzednim okresem: ${previous.period.label}${previous.provisional ? ' (wstępnie)' : ''}`
      : `Porównanie z poprzednim okresem (${previous.period.label}): brak danych`,
    `Widok sprzętu: ${report.view.gearLabel} — ${report.view.description}`,
  ]
}

// ── Sekcje ───────────────────────────────────────────────────────────────────

function metricCells(metric: ReportMetric): string[] {
  const unit = metric.unit === 'count'
  const fmt = (value: number | null) => (value === null ? DASH : unit ? String(value) : pln(value))
  const change = metric.change === null ? DASH : unit ? `${metric.change > 0 ? '+' : metric.change < 0 ? '−' : '±'}${Math.abs(metric.change)}` : signed(metric.change)
  const pct = metric.pctOfRevenue === null ? '' : ` · ${percent(metric.pctOfRevenue)} przychodu`
  return [
    metric.label,
    `${fmt(metric.value)}${pct}`,
    fmt(metric.previous),
    change,
    metric.changePct === null ? DASH : `${metric.changePct > 0 ? '+' : metric.changePct < 0 ? '−' : ''}${percent(Math.abs(metric.changePct))}`,
  ]
}

function summarySection(report: PeriodReport): ReportSection {
  const { previous, coverage, payments } = report
  const rows = report.metrics.map(metricCells)
  const lead: string[] = []
  if (!previous.hasData) lead.push(`Brak danych za ${previous.period.label} — porównanie pominięte (kolumny puste).`)
  const after: string[] = []
  const alt = report.alternativeView
  after.push(
    `W drugim widoku (${alt.gearLabel}) zysk po wszystkich kosztach = ${pln(alt.result)} (sprzęt ${pln(alt.gearCost)}, koszty firmy ${pln(alt.companyCosts)}).`
  )
  after.push(
    report.pipeline.count === 0
      ? 'Wyceny w toku: brak.'
      : report.pipeline.value > 0
        ? `Wyceny w toku: ${report.pipeline.count} na ${pln(report.pipeline.value)} (po dacie księgowej, nie wchodzą do wyniku).`
        : `Wyceny w toku: ${report.pipeline.count} (bez kwoty w wycenie; po dacie księgowej, nie wchodzą do wyniku).`
  )
  if (coverage.projects > 0) {
    after.push(
      `Przychód: z faktur ${pln(payments.invoicedRevenue)}, z planu ${pln(payments.fromPlan)} (plan okresu: przychód ${pln(coverage.plan.revenue)}, marża ${pln(coverage.plan.margin)}). Koszty z Realizacji w ${coverage.withCosts} z ${coverage.projects} projektów.`
    )
  }
  return {
    id: 'summary',
    title: 'Podsumowanie i porównanie z poprzednim okresem',
    lead,
    tables: [
      table(
        ['', report.period.label, previous.period.label, 'Zmiana', 'Zmiana %'],
        rows,
        ['l', 'r', 'r', 'r', 'r'],
        { strong: report.metrics.flatMap((m, i) => (m.emphasis ? [i] : [])) }
      ),
    ],
    after,
  }
}

const REVENUE_BASIS: Record<ReportProject['revenueBasis'], string> = { invoices: 'faktury', plan: 'plan', none: 'brak kwoty' }
const COSTS_BASIS: Record<ReportProject['costsBasis'], string> = { actual: 'Realizacja', plan: 'plan', none: 'brak kosztów' }

function projectName(project: ReportProject): string {
  return project.currency === 'EUR' && project.exchangeRate
    ? `${project.name} (EUR, kurs ${project.exchangeRate.toLocaleString('pl-PL', { maximumFractionDigits: 4 })})`
    : project.name
}

function projectsSection(report: PeriodReport): ReportSection {
  const year = report.perProject
  const head = ['Data*', 'Projekt', 'Klient', 'Przychód', 'Koszty', 'Marża (W1)', 'Źródło przychód / koszty']
  const align: ('l' | 'r')[] = ['l', 'l', 'l', 'r', 'r', 'r', 'l']
  if (year) head.push('Udział', 'Koszty firmy', 'Wynik (W2)'), align.push('r', 'r', 'r')
  const rows = report.projects.map((p) => {
    const source = [`${REVENUE_BASIS[p.revenueBasis]} / ${COSTS_BASIS[p.costsBasis]}`, ...p.flags, ...(p.anchored ? [] : ['tylko część przychodu w okresie'])].join('; ')
    const cells = [shortDate(p.anchor), projectName(p), p.group ? `${p.client} (${p.group})` : p.client || DASH, pln(p.revenue), pln(p.costs), pln(p.margin), source]
    if (year) cells.push(p.share === null ? DASH : percent(p.share * 100, 1), money(p.overhead), money(p.result))
    return cells
  })
  const byKey = new Map(report.metrics.map((m) => [m.key, m.value]))
  if (rows.length > 0) {
    const total = ['', 'Razem', '', pln(byKey.get('revenue') ?? 0), pln(byKey.get('directCosts') ?? 0), pln(byKey.get('margin') ?? 0), '']
    if (year) total.push('', pln(report.companyCosts.total - report.companyCosts.tax), pln(byKey.get('result') ?? 0))
    rows.push(total)
  }
  return {
    id: 'projects',
    title: 'Projekty',
    lead:
      rows.length === 0
        ? ['Brak projektów w okresie (żaden nie ma tu kotwicy ani faktury).']
        : [
            'Data* = data kotwicy: pierwsza faktura, a bez faktur data projektu.' +
              (year ? ' Widok roku: udział w przychodzie roku, koszty firmy bez podatku i zysk po wszystkich kosztach per projekt.' : ' Zysk po wszystkich kosztach per projekt tylko w raporcie rocznym.'),
          ],
    tables: rows.length === 0 ? [] : [table(head, rows, align, { strong: [rows.length - 1] })],
    after: [],
  }
}

function clientsSection(report: PeriodReport): ReportSection {
  const year = report.perProject
  const head = ['Klient / grupa', 'Projekty', 'Przychód', '% przychodu', 'Marża (W1)']
  if (year) head.push('Wynik (W2)')
  const rows = report.clients.map((c) => {
    const name = c.isGroup ? `${c.name} (grupa: ${c.members.join(', ')})` : c.name
    const cells = [name, String(c.projects), pln(c.revenue), percent(c.sharePct, 1), pln(c.margin)]
    if (year) cells.push(money(c.result))
    return cells
  })
  return {
    id: 'clients',
    title: 'Klienci i grupy klientów',
    lead: rows.length === 0 ? ['Brak projektów w okresie.'] : [],
    tables: rows.length === 0 ? [] : [table(head, rows)],
    after: [],
  }
}

function paymentsSection(report: PeriodReport): ReportSection {
  const { payments } = report
  const lead: string[] = [
    `Wpłynęło ${pln(payments.paid.revenue)} (${count(payments.paid.count, 'projekt', 'projekty', 'projektów')}), czeka ${pln(payments.awaiting.revenue)} (${count(payments.awaiting.count, 'projekt', 'projekty', 'projektów')}).`,
  ]
  const days = payments.paymentDays
  lead.push(
    days.paidCount > 0
      ? `Faktury z okresu opłacone: ${days.paidCount}, mediana ${days.medianDays} dni do zapłaty (maks. ${days.maxDays}), po terminie ${days.lateCount}.`
      : 'Żadna faktura wystawiona w okresie nie jest jeszcze opłacona.'
  )
  const tables: ReportTable[] = []
  if (payments.issued.length > 0) {
    tables.push(
      table(
        ['Faktura', 'Projekt', 'Wysłana', 'Kwota netto', 'Stan'],
        payments.issued.map((i) => [
          i.number ?? DASH,
          i.project,
          formatDate(i.sent),
          i.amount === null ? 'brak kwoty' : pln(i.amount),
          i.state === 'paid' ? `opłacona ${i.paid ? formatDate(i.paid) : ''}${i.daysToPaid !== null ? ` (po ${i.daysToPaid} dniach)` : ''}`.trim() : i.state === 'planned' ? 'zaplanowana' : 'czeka',
        ]),
        ['l', 'l', 'l', 'r', 'l'],
        { caption: 'Faktury wystawione w okresie' }
      )
    )
  }
  const after: string[] = []
  if (payments.open.length > 0) {
    tables.push(
      table(
        ['Faktura', 'Projekt', 'Wysłana', 'Termin', 'Kwota netto', 'Po terminie', 'Z okresu'],
        payments.open.map((i) => [
          i.number ?? DASH,
          i.project,
          formatDate(i.sent),
          `${formatDate(i.dueDate)}${i.dueAssumed ? ' (przyjęty)' : ''}`,
          i.amount === null ? 'brak kwoty' : pln(i.amount),
          i.daysOverdue > 0 ? `${i.daysOverdue} dni` : i.daysOverdue === 0 ? 'termin dziś' : `za ${-i.daysOverdue} dni`,
          i.issuedInPeriod ? 'tak' : 'nie',
        ]),
        ['l', 'l', 'l', 'l', 'r', 'r', 'l'],
        { caption: `Nieopłacone faktury na dzień ${formatDate(report.generatedAt)} (wszystkie okresy)` }
      )
    )
    after.push(
      `Razem czeka ${pln(payments.openTotal)}${payments.openWithoutAmount > 0 ? ` + ${payments.openWithoutAmount} bez kwoty` : ''}; po terminie ${payments.overdueCount} na ${pln(payments.overdueTotal)}. Termin przyjęty = 30 dni od wysłania, gdy faktura go nie ma.`
    )
  } else {
    after.push(`Na dzień ${formatDate(report.generatedAt)} żadna wysłana faktura nie czeka na wpłatę.`)
  }
  return { id: 'payments', title: 'Płatności', lead, tables, after }
}

function costsSection(report: PeriodReport): ReportSection {
  const { companyCosts: costs } = report
  const tables: ReportTable[] = []
  if (costs.byCategory.length > 0) {
    tables.push(
      table(
        ['Kategoria', 'Kwota'],
        costs.byCategory.map((c) => [c.label, pln(c.amount)]),
        ['l', 'r'],
        { caption: 'Koszty stałe w okresie (bez „Sprzętu spoza katalogu" — ten jest w sekcji Sprzęt)' }
      )
    )
  }
  if (costs.subscriptions.length > 0) {
    tables.push(
      table(
        ['Subskrypcja', 'Kategoria', 'Rat i poprawek', 'W okresie'],
        costs.subscriptions.map((s) => [s.name, s.categoryLabel, String(s.charges), pln(s.amount)]),
        ['l', 'l', 'r', 'r'],
        { caption: 'Subskrypcje' }
      )
    )
  }
  const lead = [
    `Podatek ${pln(costs.tax)} · ZUS ${pln(costs.zus)} · subskrypcje i stałe ${pln(costs.fixed)} · marketing ${pln(costs.marketing)} · sprzęt ${pln(costs.gear)} (${report.view.gearLabel}) = koszty firmy ${pln(costs.total)}.`,
  ]
  const after: string[] = []
  if (costs.subscriptionsTotal > 0 || costs.derived > 0) {
    after.push(
      `Z subskrypcji ${pln(costs.subscriptionsTotal)}, w tym raty wyliczone automatycznie ${pln(costs.derived)}${costs.planned > 0.5 ? `; plan na kolejne miesiące okresu ${pln(costs.planned)}` : ''}.`
    )
  }
  if (tables.length === 0) after.push('Brak zapisanych kosztów stałych w okresie.')
  return { id: 'costs', title: 'Subskrypcje i koszty stałe', lead, tables, after }
}

const leadsText = (leads: { total: number; real: number; fake: number }) =>
  `${leads.total} (real. ${leads.real}, fałsz. ${leads.fake})`

function campaignWindow(campaign: ReportCampaign): string {
  return `${campaign.start ? formatDate(campaign.start) : DASH} – ${campaign.end ? formatDate(campaign.end) : 'trwa'}`
}

function marketingSection(report: PeriodReport): ReportSection {
  const m = report.marketing
  const lead = [
    `Marketing w kosztach firmy: ${pln(m.ledgerSpend)}; wydatek kampanii wg Marketingu: ${pln(m.campaignSpend)}. Leady okresu: ${leadsText(m.leads)}, w tym spoza kampanii ${leadsText(m.outsideLeads)}.`,
  ]
  if (m.campaigns.length === 0) {
    return { id: 'marketing', title: 'Marketing', lead: [...lead, 'Żadna kampania nie miała w okresie wydatku ani leadów.'], tables: [], after: [] }
  }
  const toDate = table(
    ['Kampania', 'Emisja', 'Wydatek', 'Leady', 'Zlecenia', 'Koszt zlecenia', 'Przychód zleceń', 'ROAS'],
    m.campaigns.map((c) => [
      c.name,
      campaignWindow(c),
      pln(c.toDate.spend),
      leadsText(c.toDate.leads),
      String(c.toDate.jobs.length),
      money(c.toDate.costPerJob),
      pln(c.toDate.revenue),
      times(c.toDate.roas),
    ]),
    ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
    { caption: 'Od startu kampanii do dziś (nagłówek)' }
  )
  const inPeriod = table(
    ['Kampania', 'Wydatek', 'Kliknięcia', 'Leady z okresu', 'Koszt realnego leada', 'Zlecenia z tych leadów', 'Koszt zlecenia', 'ROAS'],
    m.campaigns.map((c) => [
      c.name,
      `${pln(c.inPeriod.spend)}${c.inPeriod.estimatedMonths.length > 0 ? ' (szac.)' : ''}`,
      c.inPeriod.clicks === null ? DASH : String(c.inPeriod.clicks),
      leadsText(c.inPeriod.leads),
      money(c.inPeriod.costPerRealLead),
      String(c.inPeriod.jobs.length),
      money(c.inPeriod.costPerJob),
      times(c.inPeriod.roas),
    ]),
    ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    { caption: 'W okresie (leady z okresu i zlecenia, do których doprowadziły — także z późniejszych miesięcy)' }
  )
  const jobs = m.campaigns.flatMap((c) =>
    c.inPeriod.jobs.length > 0 ? [`${c.name}: ${c.inPeriod.jobs.join('; ')}`] : []
  )
  return {
    id: 'marketing',
    title: 'Marketing',
    lead,
    tables: [toDate, inPeriod],
    after: jobs.length > 0 ? [`Zlecenia z leadów okresu — ${jobs.join(' · ')}.`] : [],
  }
}

function gearSection(report: PeriodReport): ReportSection {
  const g = report.gear
  const lead = [
    `Koszt sprzętu w okresie (${report.view.gearLabel}): ${pln(g.total)} — katalog ${pln(g.catalogue)} (w tym z zakupów sprzed okresu ${pln(g.carried)}), ręczne „Sprzęt spoza katalogu" ${pln(g.manual)}.`,
  ]
  const tables: ReportTable[] = []
  const costRows = [
    ...g.lines.map((l) => [
      l.name + (l.onSet ? '' : ' (zaplecze)'),
      l.carried ? `z ${l.date.slice(0, 4)}` : formatDate(l.date),
      pln(l.price),
      l.mode === 'spread' ? `${pln(l.monthly)} / mies. ${monthText(l.firstMonth)}–${monthText(l.lastMonth)}` : 'jednorazowo',
      pln(l.amount),
    ]),
    ...g.manualEntries.map((e) => [e.label, monthText(e.month), pln(e.amount), 'ręczny wpis spoza katalogu', pln(e.counted)]),
  ]
  if (costRows.length > 0) {
    tables.push(table(['Pozycja', 'Zakup', 'Cena', 'Rozliczenie', 'W okresie'], costRows, ['l', 'l', 'r', 'l', 'r'], { caption: 'Koszt w okresie' }))
  }
  const after: string[] = []
  after.push(
    g.purchases.length > 0
      ? `Zakupy w okresie: ${g.purchases.map((p) => `${p.name} ${pln(p.price)} (${formatDate(p.date)})`).join(', ')}.`
      : 'Zakupy w okresie: brak.'
  )
  if (g.undated.length > 0) {
    after.push(`Bez daty zakupu (nie liczą się w kosztach): ${g.undated.map((p) => `${p.name} ${pln(p.price)}`).join(', ')}.`)
  }
  if (g.onSet.length > 0) {
    const shown = g.onSet.slice(0, GEAR_ROWS_SHOWN)
    tables.push(
      table(
        ['Na planie w zleceniach okresu', 'Dni', 'Odpracował', 'Zarobił', 'Cena zakupu', 'Spłacone od zakupu', 'Prognoza spłaty'],
        shown.map((u) => [
          u.name,
          String(u.daysUsed),
          pln(u.rentValue),
          pln(u.clientPaid),
          u.invested > 0 ? pln(u.invested) : 'brak ceny',
          u.invested > 0 ? `${percent(u.rentValuePct)} / ${percent(u.clientPaidPct)}` : DASH,
          u.invested <= 0 ? DASH : u.rentPayoffMonth ? monthText(u.rentPayoffMonth) : 'powyżej 10 lat',
        ]),
        ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
        { caption: 'Sprzęt na planie: odpracował = stawka rentalowa × dni; spłacone = odpracował / zarobił od zakupu do dziś' }
      )
    )
    if (g.onSet.length > shown.length) after.push(`(+${g.onSet.length - shown.length} pozycji w danych JSON)`)
  } else {
    after.push('Żaden sprzęt z katalogu nie pojechał na plan w zleceniach okresu.')
  }
  return { id: 'gear', title: 'Sprzęt', lead, tables, after }
}

function crewSection(report: PeriodReport): ReportSection {
  const c = report.crew
  if (c.members.length === 0) {
    return {
      id: 'crew',
      title: 'Ekipa',
      lead: ['Brak kosztów ekipy z Realizacji w zleceniach okresu.'],
      tables: [],
      after: c.outside.length > 0 ? [`Spoza bazy: ${c.outside.join(', ')}.`] : [],
    }
  }
  const members = table(
    ['Osoba', 'Dni', 'Projekty', 'Wypłacono', 'Śr. stawka dzienna', 'Role'],
    [
      ...c.members.map((m) => [
        m.name,
        String(m.days),
        String(m.projects),
        pln(m.paid),
        money(m.avgDayRate),
        m.roles.map((r) => `${r.name}${r.days > 0 ? ` ${r.days} dn` : ''}`).join(', ') || DASH,
      ]),
      ['Razem', String(c.days), '', pln(c.paid), '', ''],
    ],
    ['l', 'r', 'r', 'r', 'r', 'l'],
    { strong: [c.members.length] }
  )
  const jobs = table(
    ['Osoba', 'Zlecenie', 'Dni', 'Wypłacono', 'Dzień pracy'],
    c.members.slice(0, GEAR_ROWS_SHOWN).flatMap((m) =>
      m.jobs.map((job) => [m.name, job.project, String(job.days), pln(job.paid), formatDate(job.lastDate)])
    ),
    ['l', 'l', 'r', 'r', 'l'],
    { caption: 'Zlecenia okresu (koszty ekipy leżą w okresie projektu)' }
  )
  return {
    id: 'crew',
    title: 'Ekipa',
    lead: ['Wg zleceń okresu — wiersze ekipy z Realizacji tych zleceń, których koszty leżą w okresie.'],
    tables: [members, jobs],
    after: c.outside.length > 0 ? [`Spoza bazy (nie ma ich w tabeli): ${c.outside.join(', ')}.`] : [],
  }
}

/** Sekcje danych w kolejności ekranu i PDF (bez „Do wyjaśnienia" i definicji). */
export function reportSections(report: PeriodReport): ReportSection[] {
  return [
    summarySection(report),
    projectsSection(report),
    clientsSection(report),
    paymentsSection(report),
    costsSection(report),
    marketingSection(report),
    gearSection(report),
    crewSection(report),
  ]
}

/** „Do wyjaśnienia" jako linie `Rodzaj: tekst`, rozjazdy modułów najpierw. */
export function noteLines(report: PeriodReport): { kind: ReportNote['kind']; label: string; text: string }[] {
  const order: ReportNote['kind'][] = ['disagreement', 'gap', 'info']
  return [...report.notes]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((note) => ({ kind: note.kind, label: NOTE_KIND_LABELS[note.kind], text: note.text }))
}
