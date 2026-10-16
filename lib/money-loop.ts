/**
 * Pętla pieniędzy (T6): co naprawdę wpłynęło i ile kosztowało — obok planu.
 *
 * Nic stąd nie jest zapisywane. Faktury, wpłaty i sprzedaż dodatkowa to
 * wydarzenia w wątku projektu, koszty to `Project.costs`, plan to zamrożone
 * `financials`. Reguły (uzgodnione z M.J. 2026-10-11):
 *
 *  - PRZYCHÓD RZECZYWISTY = wystawione faktury (`invoice_sent.amountNetto`;
 *    faktura bez kwoty bierze kwotę sparowanej wpłaty) + wpłaty bez faktury,
 *    jeśli mają kwotę. Pary faktura → wpłata liczy `thread-stats`. Faktury są
 *    bez VAT. Faktura ZAPLANOWANA (data w przyszłości) to jeszcze plan: mówi,
 *    kiedy przychód wpadnie, a projekt z nią nie jest zamknięty.
 *  - OCZEKIWANY = plan (`financials.sumaNetto`) + sprzedaż dodatkowa
 *    (`extra_sale`): surówka, dodatkowa postprodukcja, licencja…
 *  - NAJLEPSZA WIEDZA: faktury zastępują plan, gdy są pełne — są co najmniej
 *    tak wysokie jak oczekiwany przychód albo projekt jest Zrealizowany.
 *    Projekt W realizacji z fakturami niższymi niż oczekiwany (zaliczka) liczy
 *    się wg oczekiwanego, z dopiskiem „zafakturowano X z Y". Faktura bez kwoty
 *    też zostawia plan, dopóki znane kwoty go nie przekroczą.
 *  - KOSZTY: z Realizacji (`totalActualCosts`), gdy wpisano choć jedną
 *    pozycję; inaczej plan (`financials.koszty`). W realizacji koszty niższe
 *    niż plan to wpisywanie w toku — liczy się plan, aż do Zrealizowanego.
 *  - MIESIĄC: każda faktura liczy się w miesiącu wystawienia (jak w ewidencji
 *    ryczałtu), także ta za dodatek wystawiona miesiące później. To, co nie
 *    jest jeszcze zafakturowane, i koszty projektu leżą w dacie KOTWICY:
 *    pierwsza faktura, a bez faktur — data księgowa projektu.
 *  - Podatek: ryczałt projektu (odtworzony z `financials`, domyślnie 8,5 %)
 *    od przychodu, w tym samym miesiącu co przychód.
 *
 * Moduł czysty — testy w `money-loop.test.ts`.
 */

import { addDays, dayKey, daysBetween } from './calendar-layout'
import { median } from './client-stats'
import { eventData } from './event-kinds'
import { isEventDate } from './event-types'
import { isInPeriod, summarizeFixedCosts, type FixedCostBreakdown, type Period } from './finance-calc'
import { paymentState, type PaymentEvent } from './payments'
import { liveCosts, totalActualCosts } from './project-costs'
import { countsTowardRevenue, type FixedCost, type Project } from './project-types'
import { DEFAULT_TAX_RATE, planFromFinancials, type PlanFigures } from './realization-plan'
import { threadStats, type InvoiceStats, type UnpairedPayment } from './thread-stats'

/** Termin płatności przyjmowany dla faktury bez terminu (tak wystawiane są faktury 2026). */
export const DEFAULT_PAYMENT_TERM_DAYS = 30

/** Grosze: porównania kwot ignorują błędy zaokrągleń. */
const EPSILON = 0.005

export type MoneyEvent = PaymentEvent

export type MoneyProject = Pick<Project, 'id' | 'status' | 'date' | 'financials' | 'costs'>

export interface ExtraSale {
  day: string
  what: string
  /** `null` = dodatek bez kwoty (nie wchodzi do sum). */
  amount: number | null
  /** Numer faktury, na której jest dodatek; brak = jeszcze bez faktury albo nie wpisano. */
  number?: string
}

/**
 * Dlaczego przychód jest wg planu albo czego brakuje:
 * `no_invoices` — brak faktur, `planned` — są tylko faktury zaplanowane,
 * `partial` — wystawione faktury niższe niż oczekiwany (zaliczka, w
 * realizacji albo z zaplanowaną fakturą końcową), `missing_amount` — faktura
 * bez kwoty.
 */
export type RevenueNote = 'no_invoices' | 'planned' | 'partial' | 'missing_amount' | null
/** `no_costs` — brak kosztów w Realizacji, `partial` — wpisano mniej niż plan (w realizacji). */
export type CostsNote = 'no_costs' | 'partial' | null

/** Kawałek przychodu z datą — po nich przychód trafia do miesięcy. */
export interface RevenuePiece {
  day: string
  amount: number
  /** `invoice` / `payment` — fakt; `plan` — oczekiwany, jeszcze niezafakturowany. */
  source: 'invoice' | 'payment' | 'plan'
  /** Czy ten kawałek wpłynął. */
  paid: boolean
}

export interface ProjectMoney {
  id: string
  /** W realizacji albo zrealizowany — tylko takie wchodzą do sum. */
  counts: boolean
  /** Pierwsza faktura (albo wpłata z kwotą bez faktury); bez nich — data księgowa. */
  anchor: string
  /** Plan z `financials`; `null` = projekt bez policzonych finansów. */
  plan: PlanFigures | null
  extras: ExtraSale[]
  extrasTotal: number
  /**
   * Plan + dodatki; `null` = ani planu, ani dodatku z kwotą. Projekt bez planu
   * z zaplanowaną fakturą bierze za plan jej kwotę.
   */
  expected: number | null
  invoices: InvoiceStats[]
  unpairedPayments: UnpairedPayment[]
  /** Wystawione faktury, których kwoty nie znamy (ani z faktury, ani z wpłaty). */
  invoicesWithoutAmount: number
  /** Suma wystawionych faktur i wpłat bez faktury; `null` = brak faktur z kwotą. */
  invoiced: number | null
  /** Najbliższa zaplanowana faktura (data w przyszłości); `null` = brak. */
  nextPlannedInvoice: string | null
  /** Najlepsza wiedza o przychodzie; `null` = nic nie wiadomo. */
  revenue: number | null
  revenueBasis: 'invoices' | 'plan' | 'none'
  revenueNote: RevenueNote
  /** Koszty z Realizacji; `null` = brak kosztów. */
  actualCosts: number | null
  costCount: number
  /** Najlepsza wiedza o kosztach; `null` = ani planu, ani wpisów. */
  costs: number | null
  costsBasis: 'actual' | 'plan' | 'none'
  costsNote: CostsNote
  taxRatePercent: number
  tax: number
  /** `null`, gdy przychód nieznany. Po podatku (ryczałt projektu). */
  profit: number | null
  /**
   * Marża na realizacji (S4, warstwa 1): przychód − koszty bezpośrednie, PRZED
   * podatkiem. `null`, gdy przychód nieznany. Brak kosztów liczy się jako 0,
   * a `costsBasis` mówi, że ich nie znamy.
   */
  margin: number | null
  marginPct: number | null
  /** Przychód rozpisany na daty; suma = `revenue`. */
  pieces: RevenuePiece[]
  /** Ta sama reguła co odhaczenie „Zapłacone" (`paymentState`). */
  paid: boolean
  /** Mediana dni od faktury do wpłaty; `null` = żadna faktura nie jest opłacona. */
  daysToPaid: number | null
}

const textField = (data: Record<string, unknown>, key: string): string | undefined => {
  const value = data[key]
  return typeof value === 'string' && value ? value : undefined
}

function extrasOf(events: MoneyEvent[]): ExtraSale[] {
  return events
    .filter((e) => e.kind === 'extra_sale' && !e.deletedAt && isEventDate(e.start))
    .map((e) => {
      const data = eventData(e)
      const number = textField(data, 'number')
      return {
        day: dayKey(e.start),
        what: textField(data, 'what') ?? '',
        amount: typeof data.amountNetto === 'number' ? data.amountNetto : null,
        ...(number ? { number } : {}),
      }
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** Kwota faktury: z faktury, a gdy jej brak — ze sparowanej wpłaty. */
export function invoiceAmount(invoice: Pick<InvoiceStats, 'amountNetto' | 'paidAmount'>): number | null {
  return invoice.amountNetto ?? invoice.paidAmount
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/**
 * Pieniądze jednego projektu. `events` mogą zawierać wydarzenia innych
 * projektów — bierzemy tylko te z `projectId` projektu.
 */
export function projectMoney(
  project: MoneyProject,
  events: MoneyEvent[],
  today: string,
  /** Ryczałt projektu bez planu (company.json, S4); brak = `DEFAULT_TAX_RATE`. */
  defaultTaxRatePercent: number = DEFAULT_TAX_RATE
): ProjectMoney {
  const own = events.filter((e) => e.projectId === project.id)
  const stats = threadStats(own, today)
  const { invoices, unpairedPayments } = stats
  const done = project.status === 'done'

  // ── Przychód ───────────────────────────────────────────────────────────────
  const issued = invoices.filter((i) => i.state !== 'planned')
  const planned = invoices.filter((i) => i.state === 'planned' && invoiceAmount(i) !== null)
  const plannedTotal = sum(planned.map((i) => invoiceAmount(i)!))

  const plan = project.financials ? planFromFinancials(project.financials) : null
  const extras = extrasOf(own)
  const pricedExtras = extras.flatMap((x) => (x.amount === null ? [] : [x.amount]))
  const extrasTotal = sum(pricedExtras)
  const basePlan = plan?.revenue ?? (planned.length > 0 ? plannedTotal : null)
  const expected = basePlan === null && pricedExtras.length === 0 ? null : (basePlan ?? 0) + extrasTotal

  const knownInvoices = issued.filter((i) => invoiceAmount(i) !== null)
  const pricedPayments = unpairedPayments.filter((p) => p.amount !== null)
  const invoicesWithoutAmount = issued.length - knownInvoices.length
  const hasActual = knownInvoices.length + pricedPayments.length > 0
  const invoiced = hasActual
    ? sum(knownInvoices.map((i) => invoiceAmount(i)!)) + sum(pricedPayments.map((p) => p.amount!))
    : null
  const pendingInvoice = invoices.some((i) => i.state === 'planned')

  let revenue: number | null
  let revenueBasis: ProjectMoney['revenueBasis']
  let revenueNote: RevenueNote = null
  if (invoiced === null) {
    revenue = expected
    revenueBasis = expected === null ? 'none' : 'plan'
    revenueNote = invoicesWithoutAmount > 0 ? 'missing_amount' : pendingInvoice ? 'planned' : 'no_invoices'
  } else if (expected === null || invoiced >= expected - EPSILON) {
    revenue = invoiced
    revenueBasis = 'invoices'
    if (invoicesWithoutAmount > 0 && expected === null) revenueNote = 'missing_amount'
  } else if (invoicesWithoutAmount > 0) {
    revenue = expected
    revenueBasis = 'plan'
    revenueNote = 'missing_amount'
  } else if (done && !pendingInvoice) {
    revenue = invoiced
    revenueBasis = 'invoices'
  } else {
    revenue = expected
    revenueBasis = 'plan'
    revenueNote = 'partial'
  }

  // ── Koszty ─────────────────────────────────────────────────────────────────
  const costCount = liveCosts(project.costs).length
  const actualCosts = costCount > 0 ? totalActualCosts(project.costs) : null
  const planCosts = plan?.costs ?? null
  let costs: number | null
  let costsBasis: ProjectMoney['costsBasis']
  let costsNote: CostsNote = null
  if (actualCosts === null) {
    costs = planCosts
    costsBasis = planCosts === null ? 'none' : 'plan'
    costsNote = 'no_costs'
  } else if (planCosts === null || actualCosts >= planCosts - EPSILON || done) {
    costs = actualCosts
    costsBasis = 'actual'
  } else {
    costs = planCosts
    costsBasis = 'plan'
    costsNote = 'partial'
  }

  // ── Wynik ──────────────────────────────────────────────────────────────────
  const taxRatePercent = plan?.taxRatePercent ?? defaultTaxRatePercent
  const tax = revenue === null ? 0 : revenue * (taxRatePercent / 100)
  const profit = revenue === null ? null : revenue - tax - (costs ?? 0)
  const margin = revenue === null ? null : revenue - (costs ?? 0)
  const marginPct = profit !== null && revenue !== null && revenue > 0 ? (profit / revenue) * 100 : null

  // ── Daty ───────────────────────────────────────────────────────────────────
  const factDays = [...invoices.map((i) => i.sent), ...pricedPayments.map((p) => p.day)].sort()
  const anchor = factDays[0] ?? project.date
  const paid = paymentState(own, project.id, today).paid
  const pieces: RevenuePiece[] = []
  if (revenue !== null) {
    knownInvoices.forEach((i) =>
      pieces.push({ day: i.sent, amount: invoiceAmount(i)!, source: 'invoice', paid: i.state === 'paid' })
    )
    pricedPayments.forEach((p) => pieces.push({ day: p.day, amount: p.amount!, source: 'payment', paid: true }))
    // Reszta (jeszcze niezafakturowana) najpierw w datach zaplanowanych
    // faktur, potem w dacie kotwicy. Bez faktur to cały oczekiwany przychód;
    // przy zaliczce — reszta, więc i niezapłacona.
    let rest = revenue - (invoiced ?? 0)
    planned.forEach((i) => {
      const amount = Math.min(invoiceAmount(i)!, rest)
      if (amount <= EPSILON) return
      pieces.push({ day: i.sent, amount, source: 'plan', paid: false })
      rest -= amount
    })
    if (rest > EPSILON) pieces.push({ day: anchor, amount: rest, source: 'plan', paid: invoiced === null && paid })
    pieces.sort((a, b) => a.day.localeCompare(b.day))
  }

  const paidDays = invoices.flatMap((i) => (i.daysToPaid === null ? [] : [i.daysToPaid]))

  return {
    id: project.id,
    counts: countsTowardRevenue(project.status),
    anchor,
    plan,
    extras,
    extrasTotal,
    expected,
    invoices,
    unpairedPayments,
    invoicesWithoutAmount,
    invoiced,
    nextPlannedInvoice: invoices.find((i) => i.state === 'planned')?.sent ?? null,
    revenue,
    revenueBasis,
    revenueNote,
    actualCosts,
    costCount,
    costs,
    costsBasis,
    costsNote,
    taxRatePercent,
    tax,
    profit,
    margin,
    marginPct,
    pieces,
    paid,
    daysToPaid: median(paidDays),
  }
}

/** Pieniądze wszystkich projektów — liczone raz, potem dzielone na okresy. */
export function moneyLedger(
  projects: MoneyProject[],
  events: MoneyEvent[],
  today: string,
  defaultTaxRatePercent?: number
): ProjectMoney[] {
  const byProject = new Map<string, MoneyEvent[]>()
  events.forEach((e) => {
    if (e.projectId) byProject.set(e.projectId, [...(byProject.get(e.projectId) ?? []), e])
  })
  return projects.map((p) => projectMoney(p, byProject.get(p.id) ?? [], today, defaultTaxRatePercent))
}

// ── Okres ────────────────────────────────────────────────────────────────────

export interface PeriodProjectMoney {
  money: ProjectMoney
  /** Kotwica w okresie: tu leżą plan, koszty i reszta przychodu projektu. */
  anchored: boolean
  /** Przychód projektu w tym okresie (część całości, gdy faktury są w kilku miesiącach). */
  revenue: number
}

export interface MoneySummary {
  /** Projekty, które się liczą i dotykają okresu (kotwicą albo fakturą). */
  projects: PeriodProjectMoney[]
  /** Najlepsza wiedza: kawałki przychodu z datą w okresie. */
  revenue: number
  tax: number
  /** Koszty projektów zakotwiczonych w okresie. */
  costs: number
  /** Zysk z projektów: przychód − podatek − koszty. */
  profit: number
  marginPct: number | null
  /** Plan (`financials`) projektów zakotwiczonych w okresie — bez dodatków. */
  plan: { revenue: number; tax: number; costs: number; profit: number; marginPct: number | null }
  /** Z faktur i wpłat w okresie (fakty, bez planu). */
  invoicedRevenue: number
  coverage: {
    /** Projekty zakotwiczone w okresie. */
    projects: number
    /** …z przychodem wg faktur. */
    invoiced: number
    /** …z fakturami niższymi niż oczekiwany (zaliczka) albo bez kwoty. */
    partial: number
    /** …z kosztami wpisanymi w Realizacji. */
    withCosts: number
    /** …bez policzonych finansów (plan nieznany). */
    noFinancials: number
  }
  paid: { revenue: number; count: number }
  awaiting: { revenue: number; count: number }
  fixedCosts: FixedCostBreakdown
  /** Wynik firmy: zysk z projektów − koszty stałe. */
  netResult: number
  netMarginPct: number | null
}

const marginOf = (profit: number, revenue: number) => (revenue > 0 ? (profit / revenue) * 100 : null)

export function summarizeMoney(ledger: ProjectMoney[], fixedCosts: FixedCost[], period: Period): MoneySummary {
  const projects: PeriodProjectMoney[] = []
  let revenue = 0
  let tax = 0
  let costs = 0
  let invoicedRevenue = 0
  const plan = { revenue: 0, tax: 0, costs: 0, profit: 0 }
  const coverage = { projects: 0, invoiced: 0, partial: 0, withCosts: 0, noFinancials: 0 }
  const paid = { revenue: 0, count: 0 }
  const awaiting = { revenue: 0, count: 0 }

  ledger.forEach((money) => {
    if (!money.counts) return
    const anchored = isInPeriod(money.anchor, period)
    const inPeriod = money.pieces.filter((piece) => isInPeriod(piece.day, period))
    if (!anchored && inPeriod.length === 0) return

    const periodRevenue = sum(inPeriod.map((piece) => piece.amount))
    projects.push({ money, anchored, revenue: periodRevenue })
    revenue += periodRevenue
    tax += periodRevenue * (money.taxRatePercent / 100)
    invoicedRevenue += sum(inPeriod.filter((piece) => piece.source !== 'plan').map((piece) => piece.amount))
    const paidHere = sum(inPeriod.filter((piece) => piece.paid).map((piece) => piece.amount))
    paid.revenue += paidHere
    awaiting.revenue += periodRevenue - paidHere
    if (inPeriod.some((piece) => !piece.paid)) awaiting.count += 1
    else if (inPeriod.length > 0) paid.count += 1

    if (!anchored) return
    costs += money.costs ?? 0
    coverage.projects += 1
    if (money.revenueBasis === 'invoices') coverage.invoiced += 1
    if (money.revenueNote === 'partial' || money.revenueNote === 'missing_amount') coverage.partial += 1
    if (money.actualCosts !== null) coverage.withCosts += 1
    if (money.plan === null) coverage.noFinancials += 1
    if (money.plan) {
      plan.revenue += money.plan.revenue
      plan.tax += money.plan.tax
      plan.costs += money.plan.costs
      plan.profit += money.plan.profit
    }
  })

  const profit = revenue - tax - costs
  const fixed = summarizeFixedCosts(fixedCosts, period)
  const netResult = profit - fixed.total
  return {
    projects,
    revenue,
    tax,
    costs,
    profit,
    marginPct: marginOf(profit, revenue),
    plan: { ...plan, marginPct: marginOf(plan.profit, plan.revenue) },
    invoicedRevenue,
    coverage,
    paid,
    awaiting,
    fixedCosts: fixed,
    netResult,
    netMarginPct: marginOf(netResult, revenue),
  }
}

/** Dwanaście miesięcy roku — pod wykres trendu. */
export function moneyTrend(ledger: ProjectMoney[], fixedCosts: FixedCost[], year: number): MoneySummary[] {
  return Array.from({ length: 12 }, (_, i) => summarizeMoney(ledger, fixedCosts, { kind: 'month', year, index: i + 1 }))
}

/** Lata, w których leży jakikolwiek przychód albo kotwica projektu. */
export function moneyYears(ledger: ProjectMoney[]): number[] {
  const years = new Set<number>()
  ledger.forEach((money) => {
    ;[money.anchor, ...money.pieces.map((piece) => piece.day)].forEach((day) => {
      const year = Number(day.slice(0, 4))
      if (Number.isInteger(year) && year > 0) years.add(year)
    })
  })
  return [...years].sort((a, b) => b - a)
}

// ── Faktury czekające na wpłatę ──────────────────────────────────────────────

export interface OpenInvoice {
  projectId: string
  number?: string
  sent: string
  dueDate: string
  /** Faktura nie miała terminu — przyjęto `DEFAULT_PAYMENT_TERM_DAYS`. */
  dueAssumed: boolean
  amount: number | null
  /** Dni od wysłania. */
  daysOpen: number
  /** Dni po terminie: > 0 po terminie, 0 = termin dziś, < 0 = zostało tyle dni. */
  daysOverdue: number
}

/**
 * Wysłane i nieopłacone faktury wszystkich projektów (także wycen — zaległa
 * faktura to zaległa faktura), od najbardziej spóźnionej. Zaplanowane (data
 * wysyłki w przyszłości) nie czekają jeszcze na nic.
 */
export function openInvoices(ledger: ProjectMoney[], today: string): OpenInvoice[] {
  return ledger
    .flatMap((money) =>
      money.invoices
        .filter((invoice) => invoice.state === 'open')
        .map((invoice): OpenInvoice => {
          const dueDate = invoice.dueDate ?? addDays(invoice.sent, DEFAULT_PAYMENT_TERM_DAYS)
          return {
            projectId: money.id,
            ...(invoice.number ? { number: invoice.number } : {}),
            sent: invoice.sent,
            dueDate,
            dueAssumed: invoice.dueDate === null,
            amount: invoiceAmount(invoice),
            daysOpen: daysBetween(invoice.sent, today),
            daysOverdue: daysBetween(dueDate, today),
          }
        })
    )
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.sent.localeCompare(b.sent))
}

// ── Dni do zapłaty ───────────────────────────────────────────────────────────

export interface PaymentDays {
  /** Opłacone faktury wystawione w okresie. */
  paidCount: number
  medianDays: number | null
  maxDays: number | null
  /** Ile z nich wpłynęło po terminie. */
  lateCount: number
}

/** Dni od faktury do wpłaty dla faktur wystawionych w okresie (projekty, które się liczą). */
export function paymentDays(ledger: ProjectMoney[], period: Period): PaymentDays {
  const paid = ledger
    .filter((money) => money.counts)
    .flatMap((money) => money.invoices)
    .filter((invoice) => invoice.daysToPaid !== null && isInPeriod(invoice.sent, period))
  const days = paid.map((invoice) => invoice.daysToPaid!)
  const late = paid.filter((invoice) => {
    const due = invoice.dueDate ?? addDays(invoice.sent, DEFAULT_PAYMENT_TERM_DAYS)
    return invoice.paid! > due
  })
  return {
    paidCount: days.length,
    medianDays: median(days),
    maxDays: days.length ? Math.max(...days) : null,
    lateCount: late.length,
  }
}
