/**
 * Liczby wątku projektu, wyliczane z jego wydarzeń.
 *
 * Nic stąd nie jest zapisywane: „ile czekałem na przelew" to zawsze różnica
 * dat dwóch wydarzeń. Nowa statystyka = nowa funkcja tutaj, bez migracji
 * danych. Wynik to liczby (do agregacji w Finansach i statystykach), a zdania
 * po polsku buduje osobno `describeThreadStats`.
 *
 * Moduł czysty — testy w `thread-stats.test.ts`.
 */

import { addDays, daysBetween, dayKey } from './calendar-layout'
import { eventData } from './event-kinds'
import { isEventDate } from './event-types'
import { plural } from './pl-plural'

/** Minimum, którego potrzebują wyliczenia — pasuje i do zapisu, i do makiety. */
export interface ThreadEventInput {
  kind: string
  start: string
  end?: string
  deletedAt?: string
  data?: Record<string, unknown>
}

export interface InvoiceStats {
  /** `planned` = data wysyłki jeszcze nie nadeszła (faktura zaplanowana). */
  state: 'paid' | 'open' | 'planned'
  sent: string
  paid: string | null
  number?: string
  /** Dni od wysłania do wpłaty; `null` = jeszcze nieopłacona. */
  daysToPaid: number | null
  /** Ile dni faktura czeka na wpłatę (stan na `today`); `null` = opłacona albo zaplanowana. */
  daysOpen: number | null
}

export interface ThreadStats {
  firstDate: string | null
  lastDate: string | null
  /** Czas odpowiedzi na lead w minutach — tylko gdy oba wydarzenia mają godzinę. */
  responseMinutes: number | null
  /** Czas odpowiedzi w dniach kalendarzowych — gdy brak godzin (0 = tego samego dnia). */
  responseDays: number | null
  leadToQuoteDays: number | null
  decision: 'won' | 'lost' | null
  quoteToDecisionDays: number | null
  /** Liczba RÓŻNYCH dni (dwa wydarzenia tego samego dnia liczą się raz). */
  prepDays: number
  shootDays: number
  postDays: number
  invoices: InvoiceStats[]
}

function endOf(event: ThreadEventInput): string {
  const start = dayKey(event.start)
  const end = event.end && isEventDate(event.end) ? dayKey(event.end) : start
  return end >= start ? end : start
}

function minutesBetween(a: string, b: string): number | null {
  if (a.length <= 10 || b.length <= 10) return null
  const toMinutes = (v: string) => {
    const [date, time] = v.split('T')
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = time.split(':').map(Number)
    return Date.UTC(y, m - 1, d, hh, mm) / 60_000
  }
  return toMinutes(b) - toMinutes(a)
}

function distinctDays(events: ThreadEventInput[]): number {
  const days = new Set<string>()
  events.forEach((event) => {
    for (let d = dayKey(event.start); d <= endOf(event); d = addDays(d, 1)) days.add(d)
  })
  return days.size
}

const numberOf = (event: ThreadEventInput): string | undefined => {
  const value = eventData(event).number
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Paruje faktury z wpłatami w dwóch przejściach: najpierw po numerze faktury
 * (dla WSZYSTKICH faktur — inaczej wcześniejsza faktura bez numeru mogłaby
 * „ukraść" wpłatę należącą do późniejszej), potem resztę chronologicznie: z
 * najwcześniejszą wolną wpłatą nie wcześniejszą niż wysyłka.
 */
function pairInvoices(sent: ThreadEventInput[], paid: ThreadEventInput[], today: string): InvoiceStats[] {
  const free = [...paid]
  const matches: (ThreadEventInput | null)[] = sent.map(() => null)
  const take = (index: number) => (index === -1 ? null : free.splice(index, 1)[0])

  sent.forEach((invoice, i) => {
    const number = numberOf(invoice)
    if (number) matches[i] = take(free.findIndex((p) => numberOf(p) === number))
  })
  sent.forEach((invoice, i) => {
    if (!matches[i]) matches[i] = take(free.findIndex((p) => dayKey(p.start) >= dayKey(invoice.start)))
  })

  return sent.map((invoice, i) => {
    const sentDay = dayKey(invoice.start)
    const paidDay = matches[i] ? dayKey(matches[i]!.start) : null
    const state = paidDay ? 'paid' : sentDay > today ? 'planned' : 'open'
    return {
      state,
      sent: sentDay,
      paid: paidDay,
      number: numberOf(invoice),
      daysToPaid: paidDay ? daysBetween(sentDay, paidDay) : null,
      daysOpen: state === 'open' ? daysBetween(sentDay, today) : null,
    }
  })
}

/**
 * @param today klucz `YYYY-MM-DD` — od niego liczymy, ile czeka nieopłacona faktura.
 *              Przekazywany jawnie, żeby wynik był powtarzalny w testach.
 */
export function threadStats(input: ThreadEventInput[], today: string): ThreadStats {
  const events = input
    .filter((e) => !e.deletedAt && isEventDate(e.start))
    .sort((a, b) => a.start.localeCompare(b.start))
  const ofKind = (kind: string) => events.filter((e) => e.kind === kind)
  const firstOf = (kind: string, notBefore = '') => events.find((e) => e.kind === kind && e.start >= notBefore)

  const lead = firstOf('lead_in')
  const reply = lead ? firstOf('reply_sent', lead.start) : undefined
  const quote = firstOf('quote_sent')
  const decisionEvent = quote
    ? events.find((e) => (e.kind === 'won' || e.kind === 'lost') && e.start >= quote.start)
    : events.find((e) => e.kind === 'won' || e.kind === 'lost')

  const responseMinutes = lead && reply ? minutesBetween(lead.start, reply.start) : null

  return {
    firstDate: events.length ? dayKey(events[0].start) : null,
    lastDate: events.length ? events.map(endOf).sort().at(-1)! : null,
    responseMinutes,
    responseDays: lead && reply ? daysBetween(lead.start, reply.start) : null,
    leadToQuoteDays: lead && quote && quote.start >= lead.start ? daysBetween(lead.start, quote.start) : null,
    decision: decisionEvent ? (decisionEvent.kind as 'won' | 'lost') : null,
    quoteToDecisionDays: quote && decisionEvent ? daysBetween(quote.start, decisionEvent.start) : null,
    prepDays: distinctDays(ofKind('prep_day')),
    shootDays: distinctDays(ofKind('shoot_day')),
    postDays: distinctDays(ofKind('post_day')),
    invoices: pairInvoices(ofKind('invoice_sent'), ofKind('invoice_paid'), today),
  }
}

// ── Zdania do interfejsu ─────────────────────────────────────────────────────

const afterDays = (n: number) => `${n} ${plural(n, 'dniu', 'dniach', 'dniach')}`

function describeResponse(stats: ThreadStats): string | null {
  if (stats.responseMinutes !== null && stats.responseMinutes < 24 * 60) {
    const h = Math.floor(stats.responseMinutes / 60)
    const min = stats.responseMinutes % 60
    return h ? `Odpowiedź po ${h} h ${min} min` : `Odpowiedź po ${min} min`
  }
  if (stats.responseDays === null) return null
  return stats.responseDays === 0 ? 'Odpowiedź tego samego dnia' : `Odpowiedź po ${afterDays(stats.responseDays)}`
}

export function describeThreadStats(stats: ThreadStats): string[] {
  const out: string[] = []
  const response = describeResponse(stats)
  if (response) out.push(response)
  if (stats.leadToQuoteDays !== null) out.push(`Wycena po ${afterDays(stats.leadToQuoteDays)} od leada`)
  if (stats.quoteToDecisionDays !== null) out.push(`Decyzja klienta po ${afterDays(stats.quoteToDecisionDays)}`)
  if (stats.prepDays) out.push(`${stats.prepDays} ${plural(stats.prepDays, 'dzień', 'dni', 'dni')} przygotowań`)
  if (stats.shootDays) {
    out.push(`${stats.shootDays} ${plural(stats.shootDays, 'dzień zdjęciowy', 'dni zdjęciowe', 'dni zdjęciowych')}`)
  }
  if (stats.postDays) out.push(`${stats.postDays} ${plural(stats.postDays, 'dzień', 'dni', 'dni')} postprodukcji`)
  stats.invoices.forEach((invoice) => {
    const label = invoice.number ? `FV ${invoice.number}` : 'Faktura'
    if (invoice.daysToPaid !== null) out.push(`${label} zapłacona po ${afterDays(invoice.daysToPaid)}`)
    else if (invoice.daysOpen !== null) {
      out.push(`${label} czeka na wpłatę od ${invoice.daysOpen} ${plural(invoice.daysOpen, 'dnia', 'dni', 'dni')}`)
    }
  })
  return out
}
