/**
 * Podatki i ZUS z wyciągu bankowego oraz VAT z faktur KSeF (zakładka Finanse → Podatki).
 *
 * Wyciąg mówi, ile NAPRAWDĘ wyszło do urzędu i ZUS; KSeF mówi, ile VAT było na
 * fakturach. Ich różnica to odpowiedź na „ile zyskałem na byciu VAT-owcem".
 *
 * Zasady (M.J., 2026-11-14):
 *  - VAT-owiec od czerwca 2026; wcześniejsze miesiące nie wchodzą do VAT,
 *  - przelew do urzędu w miesiącu M rozlicza miesiąc M−1 (VAT do 25., ryczałt do 20.),
 *  - paliwo: do odliczenia połowa VAT (auto w użytku mieszanym); rozpoznawane po pozycjach faktury,
 *  - faktura zakupu „nie dotyczy firmy" = 0 % (decyzja `purchase_vat`),
 *  - VAT-9M i PIT-38 są poza hubem (`bank-statement.ts`).
 *
 * Moduł czysty — testy w `bank.test.ts`.
 */

import { bankCovers, type BankCopy, type BankOperation } from './bank-statement'
import type { KsefSale } from './ksef-invoices'
import type { KsefDecision } from './ksef-reconcile'

export const VAT_PAYER_SINCE = '2026-06'

const round = (value: number) => Math.round(value * 100) / 100
const CENT = 0.005

export function previousMonth(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, '0')}`
}

export function nextMonth(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
}

const lastDay = (month: string) => {
  const [year, index] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(year, index, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Suma przelewów danego rodzaju w miesiącu operacji (kwota dodatnia). */
function paidIn(operations: BankOperation[], kind: BankOperation['kind'], month: string): { total: number; days: string[] } {
  const hits = operations.filter((operation) => operation.kind === kind && operation.date.startsWith(month))
  return { total: round(hits.reduce((sum, operation) => sum - operation.amount, 0)), days: hits.map((operation) => operation.date).sort() }
}

/** Czy wyciągi obejmują miesiąc co najmniej do dnia `untilDay` (np. 25. dla VAT). */
function monthSeen(copy: BankCopy, month: string, untilDay: number): boolean {
  return bankCovers(copy, `${month}-01`) && bankCovers(copy, `${month}-${String(untilDay).padStart(2, '0')}`)
}

// ── ZUS ──────────────────────────────────────────────────────────────────────

export type ZusCheck =
  /** Przelew do ZUS w tym miesiącu na tę kwotę. */
  | { state: 'confirmed'; day: string }
  /** Przelew jest, ale na inną kwotę. */
  | { state: 'differs'; bankAmount: number; day: string }
  /** Wyciąg obejmuje cały miesiąc, przelewu nie ma. */
  | { state: 'missing' }
  /** Zapłacone z rachunku spoza wyciągów (pole `paidFrom`). */
  | { state: 'elsewhere'; account: string }
  /** Brak wyciągu za ten miesiąc. */
  | { state: 'unknown' }

/** ZUS w hubie jest wpisywany w miesiącu przelewu, więc porównujemy ten sam miesiąc. */
export function zusCheck(cost: { month: string; amount: number; paidFrom?: string }, copy: BankCopy): ZusCheck {
  const bank = paidIn(copy.operations, 'zus', cost.month)
  if (bank.days.length) {
    return Math.abs(bank.total - cost.amount) < CENT
      ? { state: 'confirmed', day: bank.days.at(-1)! }
      : { state: 'differs', bankAmount: bank.total, day: bank.days.at(-1)! }
  }
  if (cost.paidFrom) return { state: 'elsewhere', account: cost.paidFrom }
  return bankCovers(copy, `${cost.month}-01`) && bankCovers(copy, lastDay(cost.month)) ? { state: 'missing' } : { state: 'unknown' }
}

/** Przelew do ZUS w miesiącu, w którym hub nie ma pozycji ZUS: kwota do dopisania albo `null`. */
export function zusOnlyInBank(month: string, hasZusCost: boolean, copy: BankCopy): number | null {
  if (hasZusCost) return null
  const bank = paidIn(copy.operations, 'zus', month)
  return bank.days.length ? bank.total : null
}

// ── VAT zakupów ──────────────────────────────────────────────────────────────

const FUEL = /benzyn|\bpb\s?9[58]\b|\befecta\b|\bverva\b|\bdiesel\b|olej nap|\bon\b|\blpg\b|paliw|fuelsave|v-power/i

export function isFuelInvoice(invoice: KsefSale): boolean {
  return invoice.details.lines.some((line) => FUEL.test(line.name))
}

export const purchaseVatDecisionId = (ksefNumber: string) => `vat:${ksefNumber}`

/** Jaki procent VAT z faktury zakupu idzie do odliczenia i skąd to wiadomo. */
export function purchaseVatShare(invoice: KsefSale, decisions: KsefDecision[]): { percent: number; source: 'decision' | 'fuel' | 'default' } {
  const decision = decisions.find((d) => d.kind === 'purchase_vat' && d.id === purchaseVatDecisionId(invoice.ksefNumber))
  if (decision && typeof decision.amount === 'number') return { percent: decision.amount, source: 'decision' }
  return isFuelInvoice(invoice) ? { percent: 50, source: 'fuel' } : { percent: 100, source: 'default' }
}

// ── Zestawienie miesięczne ───────────────────────────────────────────────────

export interface TaxMonth {
  month: string
  /** ZUS przelany w tym miesiącu. */
  zus: number
  /** Ryczałt i VAT przelane w NASTĘPNYM miesiącu, czyli za ten miesiąc; `null` = wyciąg tam nie sięga. */
  flatTaxPaid: number | null
  vatPaid: number | null
  /** VAT na fakturach sprzedaży wystawionych w tym miesiącu (z korektami). */
  vatSales: number
  /** VAT na fakturach zakupu: wszystkich i po zasadach odliczenia (paliwo 50 %, prywatne 0 %). */
  vatPurchases: number
  vatDeductible: number
  /** Czy miesiąc wchodzi do rachunku VAT (od rejestracji). */
  vatApplies: boolean
}

export interface TaxSummary {
  months: TaxMonth[]
  zus: number
  flatTaxPaid: number
  /** Rachunek VAT tylko z miesięcy, za które widać już przelew (albo jego brak) w wyciągu. */
  vat: {
    months: string[]
    sales: number
    paid: number
    /** VAT odliczony naprawdę: sprzedaż − wpłacone do urzędu. */
    deductedReal: number
    /** VAT do odliczenia według faktur zakupu w KSeF (po zasadach). */
    deductibleByInvoices: number
    purchasesAll: number
    fuelHalf: number
    excluded: number
  }
}

export function taxSummary(input: {
  months: string[]
  bank: BankCopy
  sales: KsefSale[]
  purchases: KsefSale[]
  decisions: KsefDecision[]
}): TaxSummary {
  const { bank } = input
  const monthOf = (invoice: KsefSale) => invoice.issueDate.slice(0, 7)
  const share = new Map(input.purchases.map((invoice) => [invoice.ksefNumber, purchaseVatShare(invoice, input.decisions)]))
  const months = input.months.map((month): TaxMonth => {
    const after = nextMonth(month)
    const flat = paidIn(bank.operations, 'tax_flat', after)
    const vat = paidIn(bank.operations, 'tax_vat', after)
    const purchases = input.purchases.filter((invoice) => monthOf(invoice) === month)
    return {
      month,
      zus: paidIn(bank.operations, 'zus', month).total,
      flatTaxPaid: flat.days.length || monthSeen(bank, after, 20) ? flat.total : null,
      vatPaid: vat.days.length || monthSeen(bank, after, 25) ? vat.total : null,
      vatSales: round(input.sales.filter((invoice) => monthOf(invoice) === month).reduce((sum, invoice) => sum + invoice.vatAmount, 0)),
      vatPurchases: round(purchases.reduce((sum, invoice) => sum + invoice.vatAmount, 0)),
      vatDeductible: round(purchases.reduce((sum, invoice) => sum + (invoice.vatAmount * share.get(invoice.ksefNumber)!.percent) / 100, 0)),
      vatApplies: month >= VAT_PAYER_SINCE,
    }
  })

  const settled = months.filter((month) => month.vatApplies && month.vatPaid !== null)
  const settledMonths = new Set(settled.map((month) => month.month))
  const settledPurchases = input.purchases.filter((invoice) => settledMonths.has(monthOf(invoice)))
  const sum = (list: TaxMonth[], pick: (month: TaxMonth) => number) => round(list.reduce((total, month) => total + pick(month), 0))
  const sales = sum(settled, (month) => month.vatSales)
  const paid = sum(settled, (month) => month.vatPaid ?? 0)
  return {
    months,
    zus: sum(months, (month) => month.zus),
    flatTaxPaid: sum(months, (month) => month.flatTaxPaid ?? 0),
    vat: {
      months: settled.map((month) => month.month),
      sales,
      paid,
      deductedReal: round(sales - paid),
      deductibleByInvoices: sum(settled, (month) => month.vatDeductible),
      purchasesAll: sum(settled, (month) => month.vatPurchases),
      fuelHalf: round(
        settledPurchases.filter((invoice) => share.get(invoice.ksefNumber)!.source === 'fuel').reduce((total, invoice) => total + invoice.vatAmount / 2, 0),
      ),
      excluded: round(
        settledPurchases
          .filter((invoice) => share.get(invoice.ksefNumber)!.source === 'decision')
          .reduce((total, invoice) => total + (invoice.vatAmount * (100 - share.get(invoice.ksefNumber)!.percent)) / 100, 0),
      ),
    },
  }
}
