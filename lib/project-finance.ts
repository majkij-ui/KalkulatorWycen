/**
 * Zakładka „Finanse" projektu (R2, plan §13.1 C1–C4; U1, plan §18 U-CENA i
 * U-DOSPRZEDAŻ) — liczby bez Reacta.
 *
 * Cztery warstwy pieniędzy (ARCHITECTURE.md): PDF to cena, Finanse projektu to
 * ostatnie słowo, a faktury wygrywają.
 *
 *  - ZATWIERDZONA CENA (U1): w wycenie / nieprzyjętej idzie za PDF wybranego
 *    wariantu (bez szkicu PDF — za kalkulatorem). Przyjęcie zlecenia ją
 *    zamraża (`approved-price.ts`); potem zmiana PDF pokazuje „PDF: X zł ·
 *    Odśwież". Da się ją wpisać ręcznie. Projekt bez wyceny: przychód z importu.
 *  - DO ZAPŁATY = zatwierdzona cena + dosprzedaż (`extra_sale`, z kategorią i
 *    fazą). Pola „Kwota finalnego przelewu" już nie ma (U1/2); kwota wpisana
 *    ręcznie przed U1 (`profitTransferAmount`, S-AI 80 440) dalej się liczy jako
 *    cały przelew i ma swoje „Zapisz różnicę jako dosprzedaż" / „Usuń".
 *  - WPŁYNĘŁO NA KONTO (decyzja 18.3/6): kwota netto i data → wydarzenie
 *    `invoice_paid` na osi projektu. Faktura z kwotą decyduje o przychodzie;
 *    bez niej liczy się wpłata (T6: w dniu wpłaty). Wpłata wyższa niż cena +
 *    dosprzedaż proponuje „Zapisz różnicę jako dosprzedaż" — nigdy sama.
 *  - Wynik jak w pętli pieniędzy (`projectMoney`, ta sama reguła co Finanse
 *    firmy): zysk netto = „Marża" (po kosztach zewnętrznych i podatku), marża
 *    producencka = zysk − wartość mojej pracy.
 *
 * Liczy się z dokumentu wyceny NA ŻYWO (niezapisane zmiany widać od razu); po
 * zapisie te same liczby ma `Project.financials`.
 */

import { dayKey } from './calendar-layout'
import { eventData } from './event-kinds'
import { isEventDate } from './event-types'
import { invoiceAmount, projectMoney, type ExtraSale, type MoneyEvent, type ProjectMoney } from './money-loop'
import { isBlankQuoteData } from './project-save'
import { countsTowardRevenue, type Project, type ProjectFinancials } from './project-types'
import {
  computeSnapshotFinancials,
  freezeApprovedPrice,
  snapshotPlanRevenue,
  typedApprovedPrice,
  type ApprovedPrice,
  type FinancialsSource,
} from './quote-financials'
import type { ApprovedPriceRecord } from './quote-types'
import { actualFigures, compareByCategory, projectPlan, type ActualFigures, type CategoryRow, type PlanFigures } from './realization-plan'
import { liveCosts } from './project-costs'

/** Grosze: różnica mniejsza niż pół grosza to brak różnicy. */
const EPSILON = 0.005
/** „PDF: X zł · Odśwież" — dopiero od pół złotego (zaokrąglenia EUR × kurs). */
const SHOWN_DIFF = 0.5

export interface PriceView {
  /** Zatwierdzona cena w zł: zapisana, a bez niej PDF / kalkulator na żywo. */
  pln: number
  /** `live` — idzie za PDF; `frozen` — zamrożona (przyjęcie, „Odśwież"); `typed` — wpisana ręcznie. */
  state: 'live' | 'frozen' | 'typed'
  record: ApprovedPriceRecord | null
  /** PDF wybranego wariantu (albo kalkulator bez szkicu PDF) teraz. */
  live: ApprovedPrice
  /** PDF − zapisana cena; `null` = zgodne (< 0,5 zł) albo cena idzie za PDF. */
  pdfDiff: number | null
}

/** Kwota przelewu wpisana ręcznie przed U1 (R2) — dalej cały przelew. */
export interface LegacyTransferView {
  typed: number
  /** Zatwierdzona cena + dosprzedaż. */
  expected: number
  /** Wpisana − (cena + dosprzedaż); `null` = zgadza się co do grosza. */
  gap: number | null
}

export interface PaymentRow {
  id: string
  day: string
  /** Netto; `null` = wpłata odhaczona bez kwoty. */
  amount: number | null
  number?: string
}

export interface ReceivedView {
  payments: PaymentRow[]
  /** Suma wpłat z kwotą. */
  total: number
  /** Wpłaty bez kwoty (np. „Zapłacone" odhaczone na liście). */
  withoutAmount: number
  /** Czy któraś wystawiona faktura ma własną kwotę — wtedy ona decyduje, nie wpłata. */
  invoiceDecides: boolean
  /** Z czym porównujemy wpłaty: kwota wpisana ręcznie (przed U1) albo cena + dosprzedaż. */
  base: number
  /** Wpłynęło − podstawa, gdy wpłaty decydują i wpłynęło więcej (≥ grosz); inaczej `null`. */
  gap: number | null
  /** Ile mniej niż podstawa (wpłaty decydują, wpłynęło mniej); `null` = nie mniej. */
  short: number | null
}

export interface ProjectFinanceView {
  /** Projekt z wyceną (albo wyceną właśnie budowaną) — pola da się edytować. */
  hasQuote: boolean
  /** W realizacji / zrealizowany — cena jest zatwierdzona (zamraża się). */
  accepted: boolean
  /** `null` = projekt bez wyceny (retro-import). */
  price: PriceView | null
  /** Przychód z importu (projekt bez wyceny); `null` przy wycenie. */
  imported: number | null
  extras: ExtraSale[]
  extrasTotal: number
  /** Cena + dosprzedaż (read-out „Do zapłaty"); bez wyceny — import + dosprzedaż. */
  due: number | null
  /** Kwota przelewu wpisana ręcznie przed U1; `null` = brak. */
  transfer: LegacyTransferView | null
  received: ReceivedView
  /** Najlepsza wiedza (jak Finanse firmy). */
  money: ProjectMoney
  plan: PlanFigures
  /** `null` = w Realizacji jeszcze nic nie zapisano (koszty z planu). */
  actual: ActualFigures | null
  /** Plan a Realizacja wg kategorii (C3); bez Realizacji — pusto. */
  categories: CategoryRow[]
}

export type LiveQuote = FinancialsSource & { data: NonNullable<FinancialsSource['data']> }

const textField = (data: Record<string, unknown>, key: string): string | undefined => {
  const value = data[key]
  return typeof value === 'string' && value ? value : undefined
}

/** Wpłaty projektu (`invoice_paid`), od najstarszej. */
export function projectPayments(events: MoneyEvent[], projectId: string): PaymentRow[] {
  return events
    .filter((e) => e.projectId === projectId && e.kind === 'invoice_paid' && !e.deletedAt && isEventDate(e.start))
    .map((e) => {
      const data = eventData(e)
      const number = textField(data, 'number')
      return {
        id: e.id,
        day: dayKey(e.start),
        amount: typeof data.amount === 'number' ? data.amount : null,
        ...(number ? { number } : {}),
      }
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * Widok zakładki. `live` = dokument wyceny projektu (z niezapisanymi zmianami)
 * albo `null`, gdy go jeszcze nie ma.
 */
export function projectFinanceView(
  project: Pick<Project, 'id' | 'status' | 'date' | 'quote' | 'financials' | 'costs'>,
  live: LiveQuote | null,
  events: MoneyEvent[],
  today: string
): ProjectFinanceView {
  const hasQuote = !!live && (!!project.quote || !isBlankQuoteData(live.data))
  const source: FinancialsSource | null = hasQuote ? live : (project.quote as FinancialsSource | null)
  const revenue = hasQuote ? snapshotPlanRevenue(source) : null
  const financials: ProjectFinancials | null = hasQuote ? computeSnapshotFinancials(source) : project.financials
  const money = projectMoney({ ...project, financials }, events, today)
  const plan = projectPlan(project, live)
  const started = liveCosts(project.costs).length > 0
  const actual = started ? actualFigures(plan, project.costs) : null

  let price: PriceView | null = null
  let transfer: LegacyTransferView | null = null
  if (revenue) {
    const record = revenue.frozen
    const diff = record ? revenue.live.pln - record.pln : 0
    price = {
      pln: revenue.approvedPln,
      state: !record ? 'live' : record.source === 'typed' ? 'typed' : 'frozen',
      record,
      live: revenue.live,
      pdfDiff: record && Math.abs(diff) >= SHOWN_DIFF ? diff : null,
    }
    if (revenue.typedTransfer !== null) {
      const expected = revenue.approvedPln + money.extrasTotal
      const gap = revenue.typedTransfer - expected
      transfer = { typed: revenue.typedTransfer, expected, gap: Math.abs(gap) >= EPSILON ? gap : null }
    }
  }
  const imported = hasQuote ? null : (project.financials?.sumaNetto ?? null)
  const basePrice = price?.pln ?? imported
  const due = basePrice === null ? null : basePrice + money.extrasTotal

  const payments = projectPayments(events, project.id)
  const total = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0)
  const priced = payments.filter((p) => p.amount !== null)
  const invoiceDecides = money.invoices.some((i) => i.state !== 'planned' && i.amountNetto !== null)
  const base = transfer?.typed ?? due ?? 0
  const decides = !invoiceDecides && priced.length > 0
  const gap = decides && total - base >= EPSILON ? total - base : null
  const short = decides && base - total >= SHOWN_DIFF ? base - total : null

  return {
    hasQuote,
    accepted: countsTowardRevenue(project.status),
    price,
    imported,
    extras: money.extras,
    extrasTotal: money.extrasTotal,
    due,
    transfer,
    received: { payments, total, withoutAmount: payments.length - priced.length, invoiceDecides, base, gap, short },
    money,
    plan,
    actual,
    categories: actual ? compareByCategory(plan, actual) : [],
  }
}

/** Opis różnicy zapisywanej jako dosprzedaż (bez kategorii — M.J. ją nada). */
export const GAP_EXTRA_SALE_WHAT = 'Różnica w kwocie przelewu'

/**
 * „Zapisz różnicę jako dosprzedaż": kwota dosprzedaży z dodatniej różnicy —
 * kwoty wpisanej przed U1 albo wpłaty. Mniej niż cena to rabat, nie dosprzedaż.
 */
export function gapAsExtraSale(gap: number | null | undefined): { amountNetto: number; what: string } | null {
  if (gap === null || gap === undefined || gap < EPSILON) return null
  return { amountNetto: Math.round(gap * 100) / 100, what: GAP_EXTRA_SALE_WHAT }
}

/**
 * Cena wpisana w Finansach. Równa PDF: w przyjętym zleceniu to zamrożenie PDF,
 * w wycenie — powrót do ceny za PDF (`null`). Inna — cena wpisana ręcznie.
 */
export function typedPrice(pln: number, live: ApprovedPrice, accepted: boolean, at: string): ApprovedPriceRecord | null {
  if (Math.abs(pln - live.pln) < EPSILON) return accepted ? freezeApprovedPrice(live, at) : null
  return typedApprovedPrice(Math.round(pln * 100) / 100, at)
}

/** „Odśwież": przyjęte zlecenie zamraża PDF na nowo; wycena wraca do ceny za PDF. */
export function refreshedPrice(live: ApprovedPrice, accepted: boolean, at: string): ApprovedPriceRecord | null {
  return accepted ? freezeApprovedPrice(live, at) : null
}

/** Skąd przychód, po polsku — do podpisu wiersza „Przychód". */
export function revenueSourceText(view: Pick<ProjectFinanceView, 'money' | 'price' | 'transfer' | 'imported'>): string {
  const { money } = view
  if (money.revenue === null) return 'brak kwoty'
  if (money.revenueBasis === 'invoices') {
    const fromInvoices = money.invoices.some((i) => i.state !== 'planned' && invoiceAmount(i) !== null)
    return fromInvoices ? 'z faktur' : 'z wpłat'
  }
  if (view.transfer) return 'kwota przelewu wpisana ręcznie'
  const extras = money.extrasTotal > 0 ? ' + dosprzedaż' : ''
  const price = view.price
  if (price?.state === 'typed') return `cena wpisana ręcznie${extras}`
  if (price?.state === 'frozen') return `zatwierdzona cena${extras}`
  if (price?.live.source === 'pdf') return `z PDF${extras}`
  if (price?.live.source === 'calculator') return `z kalkulatora, bez szkicu PDF${extras}`
  if (view.imported !== null) return `z importu${extras}`
  return 'plan'
}

