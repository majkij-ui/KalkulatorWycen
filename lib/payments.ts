/**
 * „Zapłacone" — odhaczenie wpłaty na liście projektów.
 *
 * Zapłata to fakt z datą, więc NIE jest polem projektu, tylko wydarzeniem
 * `invoice_paid` w jego wątku (plan §3.4: każda data w jednym miejscu). Dzięki
 * temu odhaczenie widać w kalendarzu, a „zapłacono po N dniach" liczy się samo.
 * Retro-projekty z importu mają już swoje wpłaty i od razu są „zapłacone".
 *
 * Moduł czysty — testy w `payments.test.ts`.
 */

import { dayKey } from './calendar-layout'
import { eventData } from './event-kinds'
import { isEventDate } from './event-types'
import { threadStats, type ThreadEventInput } from './thread-stats'
import { countsTowardRevenue, type Project } from './project-types'

export type PaymentEvent = ThreadEventInput & {
  id: string
  projectId: string | null
  source?: { type: string }
}

export interface PaymentState {
  paid: boolean
  /** Faktury wysłane, a jeszcze nieopłacone (także zaplanowane). */
  unpaidInvoices: number
  /** Aktywne wpłaty w wątku. */
  paymentIds: string[]
  /** Ile z nich przyszło z importu — odznaczenie ich wymaga potwierdzenia. */
  importedPayments: number
}

function activePayments(events: PaymentEvent[], projectId: string): PaymentEvent[] {
  return events.filter(
    (e) => e.projectId === projectId && e.kind === 'invoice_paid' && !e.deletedAt && isEventDate(e.start)
  )
}

/**
 * Zapłacony = są wpłaty i każda wysłana faktura ma swoją wpłatę. Projekt bez
 * faktur w aplikacji jest zapłacony, gdy ma choć jedną wpłatę.
 */
export function paymentState(events: PaymentEvent[], projectId: string, today: string): PaymentState {
  const own = events.filter((e) => e.projectId === projectId)
  const payments = activePayments(events, projectId)
  const invoices = threadStats(own, today).invoices
  const unpaidInvoices = invoices.filter((i) => i.state !== 'paid').length
  return {
    paid: payments.length > 0 && unpaidInvoices === 0,
    unpaidInvoices,
    paymentIds: payments.map((e) => e.id),
    importedPayments: payments.filter((e) => e.source?.type === 'import').length,
  }
}

export interface PaymentDraft {
  kind: 'invoice_paid'
  projectId: string
  start: string
  title: string
  data: Record<string, unknown>
}

/**
 * Wpłaty do dopisania przy odhaczeniu: po jednej na każdą nieopłaconą fakturę
 * (z jej numerem, żeby sparowały się po numerze), a gdy faktur w aplikacji
 * nie ma — jedna wpłata. Data wpłaty nie może wypaść przed wysłaniem faktury
 * (inaczej by się nie sparowała), więc to później z: dziś, data faktury.
 */
export function paymentsToAdd(events: PaymentEvent[], projectId: string, today: string): PaymentDraft[] {
  const own = events.filter((e) => e.projectId === projectId)
  const open = threadStats(own, today).invoices.filter((i) => i.state !== 'paid')
  if (open.length === 0) {
    return activePayments(events, projectId).length > 0
      ? []
      : [{ kind: 'invoice_paid', projectId, start: today, title: 'Wpłata', data: {} }]
  }
  return open.map((invoice) => ({
    kind: 'invoice_paid',
    projectId,
    start: invoice.sent > today ? invoice.sent : today,
    title: invoice.number ? `Wpłata za FV ${invoice.number}` : 'Wpłata',
    data: invoice.number ? { number: invoice.number } : {},
  }))
}

/** Kwota wpłaty z wydarzenia (do podpowiedzi w interfejsie); brak = `null`. */
export function paymentAmount(event: Pick<PaymentEvent, 'kind' | 'data'>): number | null {
  const value = eventData(event).amount
  return typeof value === 'number' ? value : null
}

/** Dzień ostatniej wpłaty — do podpisu „zapłacono 12.09". */
export function lastPaymentDay(events: PaymentEvent[], projectId: string): string | null {
  const days = activePayments(events, projectId).map((e) => dayKey(e.start)).sort()
  return days.at(-1) ?? null
}

// ── Finanse: ile wpłynęło, ile czeka ────────────────────────────────────────

export interface PaymentSplit {
  paid: { count: number; revenue: number }
  awaiting: { count: number; revenue: number }
}

/**
 * Przychód projektów, które się liczą (w realizacji + zrealizowane), podzielony
 * na zapłacone i czekające na wpłatę — tą samą regułą co odhaczenie na liście.
 * Projekt z dwiema fakturami, z których jedna czeka, liczy się w całości jako
 * czekający: to sygnał „trzeba się upomnieć", a nie księgowość co do złotówki.
 */
export function paymentSplit(
  projects: Pick<Project, 'id' | 'status' | 'financials'>[],
  events: PaymentEvent[],
  today: string
): PaymentSplit {
  const split: PaymentSplit = { paid: { count: 0, revenue: 0 }, awaiting: { count: 0, revenue: 0 } }
  projects
    .filter((p) => countsTowardRevenue(p.status))
    .forEach((p) => {
      const bucket = paymentState(events, p.id, today).paid ? split.paid : split.awaiting
      bucket.count += 1
      bucket.revenue += p.financials?.sumaNetto ?? 0
    })
  return split
}
