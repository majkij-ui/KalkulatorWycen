/**
 * Wpłaty z wyciągu obok faktur sprzedaży z KSeF: która faktura jest zapłacona,
 * kiedy i jaką operacją; oraz co z tego zapisać w projektach (`invoice_paid`).
 *
 * Kolejność dopasowania (od najpewniejszego):
 *  1. decyzja ręczna,
 *  2. numer faktury w tytule przelewu (i ten sam płatnik albo ta sama kwota),
 *  3. ten sam płatnik i kwota równa temu, co zostało do zapłaty,
 *  4. jeden przelew za kilka faktur tego samego płatnika (suma),
 *  5. sama kwota, jedyna taka faktura i jedyny taki przelew — tylko podpowiedź do potwierdzenia.
 *
 * Kwoty porównujemy BRUTTO, w walucie faktury. Nic nie zmienia się samo:
 * `paymentChanges` tylko wylicza, co zapisać po „Zastosuj".
 *
 * Moduł czysty — testy w `bank.test.ts`.
 */

import { dayKey } from './calendar-layout'
import type { TimelineEvent } from './event-types'
import type { BankOperation } from './bank-statement'
import { companyKey, type FieldChange, type KsefDecision, type KsefDocument } from './ksef-reconcile'

export interface PayableInvoice {
  /** Numer KSeF faktury. */
  key: string
  number: string
  payer: string
  /** Brutto po korektach, w walucie faktury. */
  gross: number
  currency: string
  issueDate: string
  dueDate: string
}

export type PaymentReason = 'decision' | 'number' | 'payer_amount' | 'sum' | 'amount_only'

export const PAYMENT_REASON_TEXT: Record<PaymentReason, string> = {
  decision: 'wskazana ręcznie',
  number: 'numer faktury w tytule przelewu',
  payer_amount: 'ten sam płatnik i kwota',
  sum: 'jeden przelew za kilka faktur',
  amount_only: 'zgadza się sama kwota — potwierdź',
}

export interface InvoicePayment {
  invoice: PayableInvoice
  operations: { operation: BankOperation; reason: PaymentReason }[]
  paidGross: number
  state: 'paid' | 'partial' | 'unpaid'
  /** Dzień ostatniej wpłaty. */
  paidDate: string | null
  /** `false` = dopasowanie po samej kwocie: pokazujemy, ale nie zapisujemy bez potwierdzenia. */
  confident: boolean
}

export interface BankMatchResult {
  byInvoice: Map<string, InvoicePayment>
  /** Wpłaty bez faktury (bez pominiętych). */
  unmatched: BankOperation[]
  ignored: number
}

const CENT = 0.005
const round = (value: number) => Math.round(value * 100) / 100
const DAY_MS = 86_400_000
const EARLY_DAYS = 7
const AMOUNT_ONLY_DAYS = 120

/** Faktury do zapłaty z dokumentów KSeF (faktura + korekty). */
export function payableInvoices(documents: KsefDocument[]): PayableInvoice[] {
  return documents
    .filter((document) => !document.sale.isCorrection)
    .map(({ sale, corrections }) => ({
      key: sale.ksefNumber,
      number: sale.invoiceNumber,
      payer: sale.counterpartyName,
      gross: round(corrections.reduce((sum, correction) => sum + correction.grossAmount, sale.grossAmount)),
      currency: sale.currency,
      issueDate: sale.issueDate,
      dueDate: sale.details.dueDate,
    }))
}

/** Numery faktur w tytule przelewu: „2/09/2026", „1-10-2026" → „2/09/2026". Data sesji „23/07/2026" to nie „3/07/2026". */
export function invoiceNumbersIn(description: string): string[] {
  const found: string[] = []
  const pattern = /(?<![\d/.-])(\d{1,3})\s?[/-]\s?(\d{2})\s?[/-]\s?(\d{4})(?![\d/])/g
  for (const match of description.matchAll(pattern)) found.push(`${Number(match[1])}/${match[2]}/${match[3]}`)
  return found
}

const normalizedNumber = (value: string) => value.replace(/\s+/g, '').replace(/^0+(?=\d)/, '').toLowerCase()

/**
 * Czy przelew przyszedł od tej firmy. `strict` = cała nazwa (bez formy prawnej) stoi w opisie;
 * bez `strict` wystarczy pierwsze słowo z co najmniej 4 liter (wtedy pilnuje kwota).
 */
export function payerMatches(description: string, payer: string, strict: boolean): boolean {
  const text = ` ${companyKey(description)} `
  const key = companyKey(payer)
  if (key.length < 3) return false
  if (text.includes(` ${key} `)) return true
  if (strict) return false
  const [first] = key.split(' ')
  return first.length >= 4 && text.includes(` ${first} `)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
}

/** Podzbiór faktur (2–4), których reszta do zapłaty daje dokładnie `amount`. */
function subsetWithSum<T>(items: T[], amount: number, rest: (item: T) => number): T[] | null {
  const pool = items.slice(0, 8)
  const search = (start: number, left: number, picked: T[]): T[] | null => {
    if (Math.abs(left) < CENT && picked.length >= 2) return picked
    if (picked.length === 4 || left < -CENT) return null
    for (let index = start; index < pool.length; index += 1) {
      const hit = search(index + 1, round(left - rest(pool[index])), [...picked, pool[index]])
      if (hit) return hit
    }
    return null
  }
  return search(0, amount, [])
}

/** Decyzje o wyciągu trzymane w `ksef-decisions.json` obok decyzji KSeF. */
export const bankDecisionId = (operationId: string) => `bank:${operationId}`
export const senderDecisionId = (account: string) => `sender:${account}`

export function matchPayments(input: { invoices: PayableInvoice[]; operations: BankOperation[]; decisions: KsefDecision[] }): BankMatchResult {
  const byInvoice = new Map<string, InvoicePayment>(
    input.invoices.map((invoice) => [invoice.key, { invoice, operations: [], paidGross: 0, state: 'unpaid', paidDate: null, confident: true }]),
  )
  const decisionOf = new Map(input.decisions.map((decision) => [decision.id, decision]))
  const ignoredSenders = new Set(input.decisions.filter((d) => d.kind === 'bank_sender').map((d) => d.id.slice('sender:'.length)))
  const incomes = input.operations.filter((operation) => operation.kind === 'income').sort((a, b) => a.date.localeCompare(b.date))
  const free: BankOperation[] = []
  let ignored = 0

  const rest = (payment: InvoicePayment) => round(payment.invoice.gross - payment.paidGross)
  const link = (payment: InvoicePayment, operation: BankOperation, reason: PaymentReason, amount = operation.amount) => {
    payment.operations.push({ operation, reason })
    payment.paidGross = round(payment.paidGross + amount)
    payment.paidDate = operation.date
    payment.state = rest(payment) < CENT ? 'paid' : 'partial'
    if (reason === 'amount_only') payment.confident = false
  }
  const openFor = (operation: BankOperation) =>
    [...byInvoice.values()]
      .filter((payment) => payment.state !== 'paid' && payment.invoice.currency === operation.currency && payment.invoice.gross > 0)
      .sort((a, b) => a.invoice.issueDate.localeCompare(b.invoice.issueDate))

  // 1. Decyzje: wskazana faktura, „to nie zapłata faktury" (pusty numer) albo pominięcie.
  for (const operation of incomes) {
    const decision = decisionOf.get(bankDecisionId(operation.id))
    if (decision?.kind === 'bank_ignore' || (!decision && operation.counterAccount && ignoredSenders.has(operation.counterAccount))) {
      ignored += 1
    } else if (decision?.kind === 'bank_assign') {
      const payment = decision.ksefNumber ? byInvoice.get(decision.ksefNumber) : undefined
      if (payment) link(payment, operation, 'decision')
      else free.push(operation)
    } else free.push(operation)
  }
  const detached = new Set(
    input.decisions.filter((d) => d.kind === 'bank_assign' && !d.ksefNumber).map((d) => d.id.slice('bank:'.length)),
  )
  const take = (pass: (operation: BankOperation) => boolean) => {
    for (const operation of [...free]) {
      if (detached.has(operation.id)) continue
      if (pass(operation)) free.splice(free.indexOf(operation), 1)
    }
  }

  // 2. Numer faktury w tytule.
  take((operation) => {
    const numbers = invoiceNumbersIn(operation.description).map(normalizedNumber)
    if (numbers.length === 0) return false
    const payment = openFor(operation).find(
      (candidate) =>
        numbers.includes(normalizedNumber(candidate.invoice.number)) &&
        (payerMatches(operation.description, candidate.invoice.payer, true) || Math.abs(operation.amount - rest(candidate)) < CENT),
    )
    if (!payment || operation.amount - rest(payment) > CENT) return false
    link(payment, operation, 'number')
    return true
  })

  // 3. Płatnik i kwota.
  take((operation) => {
    const payment = openFor(operation).find(
      (candidate) =>
        Math.abs(operation.amount - rest(candidate)) < CENT &&
        payerMatches(operation.description, candidate.invoice.payer, false) &&
        daysBetween(candidate.invoice.issueDate, operation.date) >= -EARLY_DAYS,
    )
    if (!payment) return false
    link(payment, operation, 'payer_amount')
    return true
  })

  // 4. Jeden przelew za kilka faktur tego samego płatnika.
  take((operation) => {
    const sameFirm = openFor(operation).filter((candidate) => payerMatches(operation.description, candidate.invoice.payer, true))
    const subset = sameFirm.length >= 2 ? subsetWithSum(sameFirm, operation.amount, rest) : null
    if (!subset) return false
    subset.forEach((payment) => link(payment, operation, 'sum', rest(payment)))
    return true
  })

  // 5. Sama kwota: tylko gdy nie ma wątpliwości, i tylko jako podpowiedź.
  take((operation) => {
    const fits = (candidate: InvoicePayment, other: BankOperation) =>
      candidate.operations.length === 0 &&
      Math.abs(other.amount - candidate.invoice.gross) < CENT &&
      other.currency === candidate.invoice.currency &&
      daysBetween(candidate.invoice.issueDate, other.date) >= -EARLY_DAYS &&
      daysBetween(candidate.invoice.issueDate, other.date) <= AMOUNT_ONLY_DAYS
    const candidates = openFor(operation).filter((candidate) => fits(candidate, operation))
    if (candidates.length !== 1) return false
    if (free.filter((other) => !detached.has(other.id) && fits(candidates[0], other)).length !== 1) return false
    link(candidates[0], operation, 'amount_only')
    return true
  })

  return { byInvoice, unmatched: free.sort((a, b) => b.date.localeCompare(a.date)), ignored }
}

// ── Stan wpłaty do pokazania ─────────────────────────────────────────────────

export type PaymentView =
  | { state: 'paid'; day: string; daysFromIssue: number; daysLate: number | null; confident: boolean }
  | { state: 'partial'; paid: number; left: number; day: string }
  | { state: 'overdue'; daysLate: number }
  | { state: 'waiting'; daysLeft: number | null }
  /** Wyciąg nie sięga dnia wystawienia faktury: nie wiadomo. */
  | { state: 'unknown' }

/** `coveredTo` = ostatni dzień objęty wyciągami; faktura wystawiona później nie jest „po terminie", tylko nieznana. */
export function paymentView(payment: InvoicePayment, today: string, coveredTo: string): PaymentView {
  const { invoice } = payment
  if (payment.state === 'paid' && payment.paidDate) {
    return {
      state: 'paid',
      day: payment.paidDate,
      daysFromIssue: daysBetween(invoice.issueDate, payment.paidDate),
      daysLate: invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, payment.paidDate)) : null,
      confident: payment.confident,
    }
  }
  if (payment.state === 'partial' && payment.paidDate) {
    return { state: 'partial', paid: payment.paidGross, left: round(invoice.gross - payment.paidGross), day: payment.paidDate }
  }
  if (!coveredTo || coveredTo < invoice.issueDate) return { state: 'unknown' }
  // Po dniu wyciągu nic nie wiemy: termin liczymy do końca wyciągu, nie do dziś.
  const seenUntil = coveredTo < today ? coveredTo : today
  if (invoice.dueDate && invoice.dueDate < seenUntil) return { state: 'overdue', daysLate: daysBetween(invoice.dueDate, seenUntil) }
  return { state: 'waiting', daysLeft: invoice.dueDate ? daysBetween(today, invoice.dueDate) : null }
}

// ── Zapis w projektach ───────────────────────────────────────────────────────

export type PaymentChange =
  | { kind: 'create'; projectId: string; ksefNumber: string; start: string; title: string; data: Record<string, unknown> }
  | { kind: 'update'; projectId: string; ksefNumber: string; eventId: string; fields: FieldChange[] }

const eventNumber = (event: TimelineEvent) => (typeof event.data?.number === 'string' ? normalizedNumber(event.data.number) : '')

/**
 * Co zapisać w projektach, żeby wpłaty zgadzały się z wyciągiem: po jednej wpłacie
 * (`invoice_paid`) na zapłaconą fakturę, z dniem z banku. Istniejący wpis ręczny
 * jest poprawiany (stare wartości zostają w historii), a brakujący dopisywany.
 * Tylko faktury przypisane do projektu, zapłacone w całości i dopasowane pewnie.
 */
export function paymentChanges(input: {
  documents: { document: KsefDocument; projectId: string | null }[]
  payments: Map<string, InvoicePayment>
  events: TimelineEvent[]
}): Map<string, PaymentChange[]> {
  const byProject = new Map<string, PaymentChange[]>()
  const taken = new Set<string>()
  const paid = input.documents
    .filter(({ projectId }) => projectId)
    .map(({ document, projectId }) => ({ document, projectId: projectId!, payment: input.payments.get(document.sale.ksefNumber) }))
    .filter(({ payment }) => payment?.state === 'paid' && payment.confident && payment.paidDate)
    .sort((a, b) => a.payment!.paidDate!.localeCompare(b.payment!.paidDate!))

  const livePayments = (projectId: string) =>
    input.events
      .filter((event) => event.kind === 'invoice_paid' && !event.deletedAt && event.projectId === projectId && !taken.has(event.id))
      .sort((a, b) => a.start.localeCompare(b.start))
  const claim = (event: TimelineEvent | undefined) => {
    if (event) taken.add(event.id)
    return event
  }

  // Najpierw wpisy, które wprost wskazują fakturę; wpisy bez numeru dzielimy dopiero potem.
  const found = new Map<string, TimelineEvent | undefined>()
  paid.forEach(({ document, projectId }) => {
    const { ksefNumber, invoiceNumber } = document.sale
    found.set(
      ksefNumber,
      claim(
        livePayments(projectId).find((event) => event.data?.ksefNumber === ksefNumber) ??
          livePayments(projectId).find((event) => !event.data?.ksefNumber && eventNumber(event) === normalizedNumber(invoiceNumber)),
      ),
    )
  })
  paid.forEach(({ document, projectId }) => {
    const { ksefNumber } = document.sale
    if (!found.get(ksefNumber)) found.set(ksefNumber, claim(livePayments(projectId).find((event) => !event.data?.ksefNumber && !eventNumber(event))))
  })

  paid.forEach(({ document, projectId, payment }) => {
    const { sale } = document
    const facts: Record<string, unknown> = {
      number: sale.invoiceNumber,
      // `amount` wpłaty jest w hubie netto i w złotych; przy fakturze w walucie zostaje pusty.
      ...(sale.currency === 'PLN' ? { amount: document.amount } : { amountOriginal: payment!.paidGross, currency: sale.currency }),
      amountGross: payment!.paidGross,
      ksefNumber: sale.ksefNumber,
      bankOperationIds: payment!.operations.map(({ operation }) => operation.id),
    }
    const event = found.get(sale.ksefNumber)
    const list = byProject.get(projectId) ?? []
    if (!event) {
      list.push({ kind: 'create', projectId, ksefNumber: sale.ksefNumber, start: payment!.paidDate!, title: `Wpłata za FV ${sale.invoiceNumber}`, data: facts })
    } else {
      const fields: FieldChange[] = []
      if (dayKey(event.start) !== payment!.paidDate) fields.push({ field: 'start', before: event.start, after: payment!.paidDate })
      Object.entries(facts).forEach(([key, after]) => {
        const before = event.data?.[key]
        const same = typeof after === 'number' && typeof before === 'number' ? Math.abs(after - before) < CENT : JSON.stringify(before) === JSON.stringify(after)
        if (!same) fields.push({ field: `data.${key}`, before, after })
      })
      if (fields.length) list.push({ kind: 'update', projectId, ksefNumber: sale.ksefNumber, eventId: event.id, fields })
    }
    if (list.length) byProject.set(projectId, list)
  })
  return byProject
}

/** Wpłata po zmianie z wyciągu; poprzednie wartości zostają w `updatedFrom`. */
export function applyPaymentUpdate(event: TimelineEvent, change: Extract<PaymentChange, { kind: 'update' }>, now: string): TimelineEvent {
  const data: Record<string, unknown> = { ...event.data }
  let start = event.start
  change.fields.forEach(({ field, after }) => {
    if (field === 'start') start = after as string
    else data[field.slice('data.'.length)] = after
  })
  const trace = {
    type: 'bank',
    ref: `ksef:${change.ksefNumber}`,
    at: now,
    fields: change.fields.map((f) => f.field),
    before: Object.fromEntries(change.fields.map((f) => [f.field, f.before ?? null])),
  }
  const previous = Array.isArray(event.updatedFrom) ? event.updatedFrom : []
  return { ...event, start, data, updatedFrom: [...previous, trace], updatedAt: now }
}

/** Zmiana dnia wpłaty to jedyne, co widać w projekcie; reszta pól to potwierdzenie wyciągiem. */
export function paymentChangeSummary(change: PaymentChange): { day: string; before: string | null; fresh: boolean } {
  if (change.kind === 'create') return { day: change.start, before: null, fresh: true }
  const start = change.fields.find((field) => field.field === 'start')
  return { day: start ? String(start.after) : '', before: start ? dayKey(String(start.before)) : null, fresh: false }
}
