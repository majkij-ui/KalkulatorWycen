/**
 * Faktury sprzedaży z KSeF → propozycje dla Skrzynki (zasady: docs/PLAN-KSEF.md §5).
 *
 * KSeF jest tu tylko CZYTANY: faktury wystawia biuro rachunkowe w swoim panelu,
 * hub nigdy ich nie dodaje. Nic nie zmienia się samo, każda zmiana to propozycja
 * do przyjęcia w aplikacji.
 *
 * Moduł czysty — testy w `ksef-proposals.test.ts`.
 */

import { clientKey } from './clients'
import type { TimelineEvent } from './event-types'
import { INBOX_FORMAT, INBOX_VERSION, type Proposal } from './inbox-types'
import type { KsefInvoice, KsefInvoiceDetails } from './ksef-invoices'
import type { Project } from './project-types'

/** Od tego dnia (data wystawienia) KSeF jest źródłem prawdy; 2026 zostaje, jak jest. */
export const KSEF_SALES_FROM = '2027-01-01'

export type KsefSale = KsefInvoice & { details: KsefInvoiceDetails }

export type KsefProject = Pick<Project, 'id' | 'name' | 'client' | 'status'> & {
  deletedAt?: string
  financials?: { sumaNetto?: number } | null
}

export interface KsefSalesContext {
  projects: KsefProject[]
  events: TimelineEvent[]
  /** Propozycje już czekające w skrzynce: dwie korekty jednej faktury nie mogą liczyć od tej samej kwoty. */
  pending: Proposal[]
}

export interface KsefSalesDraft {
  draft: { format: typeof INBOX_FORMAT; version: typeof INBOX_VERSION; note: string; proposals: Proposal[] }
  /** Korekty, które muszą poczekać, z powodem. Kolejna synchronizacja wróci do nich sama. */
  held: string[]
}

export function ksefRef(ksefNumber: string): string {
  return `ksef:${ksefNumber}`
}

const GROSZ = 100
const roundMoney = (value: number) => Math.round(value * GROSZ) / GROSZ

function normalizedNumber(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toLowerCase() : ''
}

/** „Tchibo Polska sp. z o.o." → „tchibo polska": forma prawna nie odróżnia klientów. */
export function companyKey(name: string): string {
  return clientKey(name)
    .replace(/[.,"„”]/g, ' ')
    .replace(/\b(sp\s*z\s*o\s*o|spolka z ograniczona odpowiedzialnoscia|sp\s*k|sp\s*j|s\s*a|spolka akcyjna|spolka komandytowa|spolka jawna)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ta sama firma, także gdy jedna nazwa to początek drugiej: „CIONET" i „CIONET Polska". */
function sameCompany(a: string, b: string): boolean {
  const [left, right] = [companyKey(a), companyKey(b)]
  if (left.length < 3 || right.length < 3) return false
  return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `)
}

function liveInvoices(events: TimelineEvent[], projectId: string): TimelineEvent[] {
  return events.filter((e) => e.kind === 'invoice_sent' && !e.deletedAt && e.projectId === projectId)
}

/** Faktury już pokrywają cały plan: kolejna raczej nie należy do tego projektu. */
function fullyInvoiced(project: KsefProject, events: TimelineEvent[]): boolean {
  const plan = project.financials?.sumaNetto ?? 0
  if (plan <= 0) return false
  const invoiced = liveInvoices(events, project.id).reduce(
    (sum, e) => sum + (typeof e.data?.amountNetto === 'number' ? e.data.amountNetto : 0),
    0,
  )
  return invoiced >= plan - 1 / GROSZ
}

/** Zakończony projekt z fakturą sprzed granicy to rozliczony rok 2026: nowa faktura dotyczy już czegoś innego. */
function settledBeforeKsef(project: KsefProject, events: TimelineEvent[]): boolean {
  return project.status === 'done' && liveInvoices(events, project.id).some((e) => e.start.slice(0, 10) < KSEF_SALES_FROM)
}

/** Otwarte projekty klienta. NIP z przyjętej wcześniej faktury jest pewniejszy niż nazwa. */
function candidateProjects(sale: KsefSale, ctx: KsefSalesContext): KsefProject[] {
  const live = ctx.projects.filter((p) => !p.deletedAt && p.status !== 'lost')
  const byId = new Map(live.map((p) => [p.id, p]))
  const namesFromNip = new Set<string>()
  if (sale.counterpartyNip) {
    ctx.events.forEach((e) => {
      if (e.deletedAt || e.data?.buyerNip !== sale.counterpartyNip || !e.projectId) return
      const client = byId.get(e.projectId)?.client
      if (client) namesFromNip.add(client)
    })
  }
  const names = namesFromNip.size ? [...namesFromNip] : [sale.counterpartyName]
  const matching = live.filter((p) => p.client && names.some((name) => sameCompany(name, p.client)))
  const open = matching.filter((p) => !fullyInvoiced(p, ctx.events) && !settledBeforeKsef(p, ctx.events))
  const realized = open.filter((p) => p.status === 'won' || p.status === 'done')
  return realized.length ? realized : open
}

function invoiceFacts(sale: KsefSale): Record<string, unknown> {
  const isPln = sale.currency === 'PLN'
  return {
    number: sale.invoiceNumber,
    // `amountNetto` jest w złotych. Faktura w walucie zostaje bez niego, jak każda
    // faktura bez kwoty: plan trwa, aż kwotę w zł przyniesie wpłata.
    ...(isPln ? { amountNetto: sale.netAmount } : { amountOriginal: sale.netAmount, currency: sale.currency }),
    ...(sale.details.dueDate ? { dueDate: sale.details.dueDate } : {}),
    issueDate: sale.issueDate,
    ksefNumber: sale.ksefNumber,
    ...(sale.counterpartyNip ? { buyerNip: sale.counterpartyNip } : {}),
  }
}

function common(sale: KsefSale, reason: string) {
  return {
    id: sale.ksefNumber,
    ref: ksefRef(sale.ksefNumber),
    // Osobny wątek: każda faktura ma własny wybór projektu, nawet u tego samego klienta.
    threadId: `ksef-${sale.ksefNumber}`,
    client: sale.counterpartyName,
    reason,
    evidence: {
      from: 'KSeF',
      subject: sale.invoiceNumber,
      date: sale.ksefDate,
      snippet: `${sale.counterpartyName}, netto ${sale.netAmount} ${sale.currency}, wystawiona ${sale.issueDate}, numer KSeF ${sale.ksefNumber}`,
    },
  }
}

function correctionProposal(
  sale: KsefSale,
  ctx: KsefSalesContext,
  claimed: Set<string>,
): { proposal?: Proposal; held?: string } {
  const label = `Korekta ${sale.invoiceNumber}`
  const { correctedKsefNumber, correctedNumber } = sale.details
  const original = ctx.events.find(
    (e) =>
      !e.deletedAt &&
      e.kind === 'invoice_sent' &&
      ((correctedKsefNumber && e.data?.ksefNumber === correctedKsefNumber) ||
        (correctedNumber && normalizedNumber(e.data?.number) === normalizedNumber(correctedNumber))),
  )
  if (!original) {
    return { held: `${label}: nie ma jeszcze faktury ${correctedNumber || correctedKsefNumber} w projekcie (najpierw ją przyjmij)` }
  }
  const waiting = ctx.pending.some((p) => p.type === 'event_update' && p.eventId === original.id)
  if (waiting || claimed.has(original.id)) {
    return { held: `${label}: na fakturze ${correctedNumber || correctedKsefNumber} czeka już inna zmiana (najpierw ją rozpatrz)` }
  }
  claimed.add(original.id)
  const previous = Array.isArray(original.data?.corrections) ? original.data.corrections : []
  const current = typeof original.data?.amountNetto === 'number' ? original.data.amountNetto : null
  const amountNetto = sale.currency === 'PLN' && current !== null ? roundMoney(current + sale.netAmount) : undefined
  return {
    proposal: {
      ...common(sale, `Korekta zmienia fakturę o ${sale.netAmount} ${sale.currency} netto; oba dokumenty zostają zapisane.`),
      type: 'event_update',
      eventId: original.id,
      ifMissing: false,
      set: {
        data: {
          ...(amountNetto === undefined ? {} : { amountNetto }),
          corrections: [
            ...previous,
            {
              number: sale.invoiceNumber,
              ksefNumber: sale.ksefNumber,
              issueDate: sale.issueDate,
              netChange: sale.netAmount,
              currency: sale.currency,
            },
          ],
        },
      },
    },
  }
}

function saleProposal(sale: KsefSale, ctx: KsefSalesContext, claimed: Set<string>): Proposal {
  const candidates = candidateProjects(sale, ctx)
  const onlyProject = candidates.length === 1 ? candidates[0] : null
  const number = normalizedNumber(sale.invoiceNumber)
  const sameNumber = ctx.events.find(
    (e) =>
      !e.deletedAt &&
      e.kind === 'invoice_sent' &&
      !claimed.has(e.id) &&
      e.start.slice(0, 10) >= KSEF_SALES_FROM &&
      normalizedNumber(e.data?.number) === number,
  )
  // Jedyny ręczny wpis w jedynym pasującym projekcie to ta sama faktura, tylko zapisana niechlujnie.
  // Wpisy sprzed granicy zostają nietknięte: rok 2026 nie jest nadpisywany.
  const manual = onlyProject
    ? liveInvoices(ctx.events, onlyProject.id).filter(
        (e) => !e.data?.ksefNumber && !claimed.has(e.id) && e.start.slice(0, 10) >= KSEF_SALES_FROM,
      )
    : []
  const existing = sameNumber ?? (manual.length === 1 ? manual[0] : undefined)

  if (existing) {
    claimed.add(existing.id)
    const link = !existing.projectId
    return {
      ...common(sale, `KSeF nadpisuje dane faktury zapisanej wcześniej w hubie${sale.currency === 'PLN' ? '' : ` (kwota w ${sale.currency} nie zastępuje złotych)`}.`),
      type: 'event_update',
      eventId: existing.id,
      ...(link && onlyProject ? { projectId: onlyProject.id } : {}),
      ifMissing: false,
      set: { ...(link ? { linkProject: true } : {}), date: sale.ksefDate, data: invoiceFacts(sale) },
    }
  }

  const reason = onlyProject
    ? `Jedyny otwarty projekt tego klienta: ${onlyProject.name}.`
    : candidates.length > 1
      ? `Klient ma ${candidates.length} otwarte projekty, wybierz właściwy.`
      : 'Nieprzypisana: brak otwartego projektu tego klienta. Wybierz projekt albo odrzuć.'
  return {
    ...common(sale, reason),
    type: 'event',
    ...(onlyProject ? { projectId: onlyProject.id } : {}),
    event: {
      kind: 'invoice_sent',
      start: sale.ksefDate,
      title: `Faktura ${sale.invoiceNumber}`,
      notes: sale.currency === 'PLN' ? '' : `Kwota na fakturze: ${sale.netAmount} ${sale.currency} netto. Kwota w zł: z wpłaty.`,
      data: invoiceFacts(sale),
    },
  }
}

export function buildKsefSalesDraft(sales: KsefSale[], ctx: KsefSalesContext): KsefSalesDraft {
  const proposals: Proposal[] = []
  const held: string[] = []
  const claimed = new Set<string>()
  const ordered = [...sales].sort((a, b) => a.ksefDate.localeCompare(b.ksefDate))
  ordered
    .filter((sale) => !sale.isCorrection)
    .forEach((sale) => proposals.push(saleProposal(sale, ctx, claimed)))
  ordered
    .filter((sale) => sale.isCorrection)
    .forEach((sale) => {
      const result = correctionProposal(sale, ctx, claimed)
      if (result.proposal) proposals.push(result.proposal)
      if (result.held) held.push(result.held)
    })
  return {
    draft: { format: INBOX_FORMAT, version: INBOX_VERSION, note: 'Faktury sprzedaży z KSeF', proposals },
    held,
  }
}
