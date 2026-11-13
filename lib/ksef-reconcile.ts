/**
 * „Zgodność z KSeF": projekty huba obok faktur sprzedaży z KSeF (decyzje M.J.
 * 2026-11-13, docs/PLAN-KSEF.md §7).
 *
 * KSeF jest ostatecznym źródłem prawdy o fakturach: numer, kwota, data, termin
 * i nabywca pochodzą z niego. Wartość projektu w hubie (cena + dosprzedaż z
 * Finansów projektu) stoi obok, a różnica jest pokazana, nie poprawiana sama.
 * Nic nie zmienia się bez kliknięcia „Zastosuj".
 *
 * Dopasowanie faktury do projektu, po kolei:
 *  1. ręczne przypisanie (decyzja zapisana na ekranie),
 *  2. wydarzenie, które już ma ten numer KSeF,
 *  3. numer faktury na fakturze albo wpłacie w projekcie,
 *  4. ten sam klient i kwota równa temu, co w projekcie jeszcze niezafakturowane
 *     (M&L: 16 200 = 14 040 + 2 160; S-AI: cena + dosprzedaż),
 *  5. jedyny projekt tego klienta bez faktur,
 *  6. sama kwota, w ciągu 120 dni — tylko jako PODPOWIEDŹ do potwierdzenia
 *     (Piotrek: inna nazwa w hubie, inna na fakturze).
 * Gdy pasuje więcej niż jeden projekt, faktura zostaje nieprzypisana: hub pyta.
 *
 * Moduł czysty — testy w `ksef-reconcile.test.ts`.
 */

import { z } from 'zod'
import { detailsOfClient, type ClientDetails } from './client-details'
import { clientKey } from './clients'
import type { TimelineEvent } from './event-types'
import type { KsefSale } from './ksef-invoices'
import type { ProjectStatus } from './project-types'

/** Od tego dnia (data wystawienia) faktury są w KSeF (decyzja M.J. 2026-11-13). */
export const KSEF_FROM = '2026-02-01'

/** Różnica do pół złotego to zaokrąglenie, nie różnica. */
const SHOWN_DIFF = 0.5
/** Przy dopasowaniu po kwocie: do 0,5 % albo złotówki (JHJ: 26 310 wobec 26 340). */
const matchTolerance = (amount: number) => Math.max(1, Math.abs(amount) * 0.005)
const SUGGEST_WITHIN_DAYS = 120
const DAY_MS = 86_400_000

/** Decyzje ekranu „Zgodność z KSeF" (plik danych huba). */
export const KSEF_DECISIONS_FILE = 'ksef-decisions.json'

export const ksefDecisionSchema = z
  .object({
    /** `assign:<numer KSeF>` albo `none:<id projektu>`. */
    id: z.string().min(1),
    kind: z.enum(['assign', 'no_invoice']),
    projectId: z.string().catch(''),
    ksefNumber: z.string().optional().catch(undefined),
    at: z.string().catch(''),
  })
  .passthrough()
export type KsefDecision = z.infer<typeof ksefDecisionSchema>

export interface ReconcileProject {
  id: string
  name: string
  client: string
  status: ProjectStatus
  date: string
  deletedAt?: string
}

export interface ReconcileInput {
  projects: ReconcileProject[]
  /** Cena + dosprzedaż z Finansów projektu (`projectMoney().expected`). */
  expected: Map<string, number | null>
  events: TimelineEvent[]
  invoices: KsefSale[]
  details: ClientDetails[]
  decisions: KsefDecision[]
  inPeriod: (day: string) => boolean
  now: string
}

export type MatchReason = 'decision' | 'ksef' | 'number' | 'amount' | 'client' | 'suggested'

export const MATCH_REASON_TEXT: Record<MatchReason, string> = {
  decision: 'przypisana ręcznie',
  ksef: 'już zapisana z KSeF',
  number: 'ten sam numer faktury',
  amount: 'ten sam klient i kwota',
  client: 'jedyny projekt tego klienta',
  suggested: 'zgadza się kwota, inna nazwa klienta — sprawdź',
}

/** Faktura z dołączonymi korektami i kwotą po korektach (w walucie faktury). */
export interface KsefDocument {
  sale: KsefSale
  corrections: KsefSale[]
  amount: number
  reason: MatchReason
}

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

export type KsefChange =
  | { kind: 'update'; eventId: string; ksefNumber: string; fields: FieldChange[] }
  | {
      kind: 'create'
      ksefNumber: string
      start: string
      title: string
      notes: string
      data: Record<string, unknown>
    }
  | { kind: 'details'; record: ClientDetails; before: ClientDetails | null }
  | { kind: 'client'; from: string; to: string }

export type RowStatus = 'ok' | 'changes' | 'amount' | 'missing' | 'no_invoice' | 'waiting'

export interface ReconcileRow {
  project: ReconcileProject
  documents: KsefDocument[]
  /** Cena + dosprzedaż w hubie; `null` = projekt bez kwoty. */
  hubValue: number | null
  /** Suma faktur w zł po korektach; `null` = brak faktur albo faktura w walucie. */
  ksefTotal: number | null
  /** KSeF − hub; `null` = nie da się porównać. */
  diff: number | null
  changes: KsefChange[]
  /** Faktury huba, których nie ma w KSeF (np. wpis ręczny z innym numerem). */
  extraHubInvoices: TimelineEvent[]
  status: RowStatus
}

export interface ReconcileResult {
  rows: ReconcileRow[]
  /** Faktury bez projektu, z podpowiedziami (klient podobny, kwota zgodna). */
  unassigned: { document: KsefDocument; hints: string[] }[]
}

// ── Klient ───────────────────────────────────────────────────────────────────

const LEGAL_FORMS =
  /\b(sp\s*z\s*o\s*o|spolka z ograniczona odpowiedzialnoscia|sp\s*k|sp\s*j|s\s*a|spolka akcyjna|spolka komandytowa|spolka jawna|s\s*c|gmbh|b\s*v|ltd|inc|llc)\b/g

/** „Tchibo Polska sp. z o.o." → „tchibo polska": forma prawna i cudzysłowy nie odróżniają firm. */
export function companyKey(name: string): string {
  return clientKey(name)
    .replace(/["„”'.,&()]/g, ' ')
    .replace(LEGAL_FORMS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ta sama firma: równe nazwy, jedna jest początkiem drugiej albo zgadza się pierwsze słowo (≥ 4 litery). */
export function similarCompany(a: string, b: string): boolean {
  const [left, right] = [companyKey(a), companyKey(b)]
  if (left.length < 3 || right.length < 3) return false
  if (left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `)) return true
  const [first] = left.split(' ')
  return first.length >= 4 && first === right.split(' ')[0]
}

function sameClient(project: ReconcileProject, sale: KsefSale, details: ClientDetails[]): boolean {
  const known = detailsOfClient(details, project.client)
  if (sale.counterpartyId && known.some((d) => d.id === sale.counterpartyId)) return true
  if (sale.counterpartyId && known.length && !known.some((d) => d.id === sale.counterpartyId)) {
    // Klient ma już swój NIP z faktur, a ta faktura jest na inną firmę: nazwa nie przesądza.
    return false
  }
  return similarCompany(project.client, sale.counterpartyName)
}

// ── Faktura ──────────────────────────────────────────────────────────────────

const normalizedNumber = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, '').toLowerCase() : ''

const isPln = (document: KsefDocument) => document.sale.currency === 'PLN'
const roundMoney = (value: number) => Math.round(value * 100) / 100

/** Faktury z dołączonymi korektami. Korekta bez znanej faktury zostaje osobnym dokumentem. */
export function ksefDocuments(invoices: KsefSale[]): KsefDocument[] {
  const base = invoices.filter((sale) => !sale.isCorrection)
  const byKsef = new Map(base.map((sale) => [sale.ksefNumber, sale]))
  const byNumber = new Map(base.map((sale) => [normalizedNumber(sale.invoiceNumber), sale]))
  const attached = new Map<string, KsefSale[]>()
  const orphans: KsefSale[] = []
  invoices
    .filter((sale) => sale.isCorrection)
    .forEach((correction) => {
      const original =
        byKsef.get(correction.details.correctedKsefNumber) ?? byNumber.get(normalizedNumber(correction.details.correctedNumber))
      if (original) attached.set(original.ksefNumber, [...(attached.get(original.ksefNumber) ?? []), correction])
      else orphans.push(correction)
    })
  return [...base, ...orphans]
    .map((sale) => {
      const corrections = (attached.get(sale.ksefNumber) ?? []).sort((a, b) => a.ksefDate.localeCompare(b.ksefDate))
      const amount = roundMoney(corrections.reduce((sum, c) => sum + c.netAmount, sale.netAmount))
      return { sale, corrections, amount, reason: 'decision' as MatchReason }
    })
    .sort((a, b) => a.sale.ksefDate.localeCompare(b.sale.ksefDate) || a.sale.invoiceNumber.localeCompare(b.sale.invoiceNumber))
}

/** Dane wydarzenia faktury tak, jak stoją w KSeF. */
export function invoiceFacts(document: KsefDocument): Record<string, unknown> {
  const { sale, corrections } = document
  return {
    number: sale.invoiceNumber,
    // `amountNetto` jest w złotych. Faktura w walucie zostaje bez niego (plan trwa,
    // aż kwotę w zł przyniesie wpłata); kwota z faktury stoi obok.
    ...(isPln(document) ? { amountNetto: document.amount } : { amountOriginal: document.amount, currency: sale.currency }),
    ...(sale.details.dueDate ? { dueDate: sale.details.dueDate } : {}),
    issueDate: sale.issueDate,
    ksefNumber: sale.ksefNumber,
    ...(sale.counterpartyId ? { buyerId: sale.counterpartyId } : {}),
    ...(corrections.length
      ? {
          corrections: corrections.map((c) => ({
            number: c.invoiceNumber,
            ksefNumber: c.ksefNumber,
            issueDate: c.issueDate,
            netChange: c.netAmount,
            currency: c.currency,
          })),
        }
      : {}),
  }
}

// ── Dopasowanie ──────────────────────────────────────────────────────────────

function liveInvoiceEvents(events: TimelineEvent[], projectId: string): TimelineEvent[] {
  return events
    .filter((e) => e.kind === 'invoice_sent' && !e.deletedAt && e.projectId === projectId)
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** Projekt rozliczony przed KSeF (faktura w hubie sprzed lutego 2026): nowe faktury go nie dotyczą. */
function settledBeforeKsef(events: TimelineEvent[], projectId: string): boolean {
  return liveInvoiceEvents(events, projectId).some((e) => e.start.slice(0, 10) < KSEF_FROM && !e.data?.ksefNumber)
}

function assign(input: ReconcileInput): { byProject: Map<string, KsefDocument[]>; unassigned: KsefDocument[] } {
  const live = input.projects.filter((p) => !p.deletedAt)
  const liveIds = new Set(live.map((p) => p.id))
  const documents = ksefDocuments(input.invoices)
  const byProject = new Map<string, KsefDocument[]>()
  const taken = new Set<string>()
  const put = (document: KsefDocument, projectId: string, reason: MatchReason) => {
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), { ...document, reason }])
    taken.add(document.sale.ksefNumber)
  }

  const decided = new Map(
    input.decisions.filter((d) => d.kind === 'assign' && d.ksefNumber).map((d) => [d.ksefNumber!, d.projectId]),
  )
  const projectOfEvent = (match: (e: TimelineEvent) => boolean) =>
    input.events.find((e) => !e.deletedAt && e.projectId && liveIds.has(e.projectId) && match(e))?.projectId ?? null

  documents.forEach((document) => {
    const { sale } = document
    const manual = decided.get(sale.ksefNumber)
    if (manual && liveIds.has(manual)) return put(document, manual, 'decision')
    const saved = projectOfEvent((e) => e.data?.ksefNumber === sale.ksefNumber)
    if (saved) return put(document, saved, 'ksef')
    const number = normalizedNumber(sale.invoiceNumber)
    const numbered = projectOfEvent(
      (e) => (e.kind === 'invoice_sent' || e.kind === 'invoice_paid') && normalizedNumber(e.data?.number) === number,
    )
    if (numbered) put(document, numbered, 'number')
  })

  // Reszta: po kliencie i kwocie. Co już przypisane, zmniejsza to, co w projekcie niezafakturowane.
  const remainder = (projectId: string) => {
    const expected = input.expected.get(projectId)
    if (expected === null || expected === undefined) return null
    const invoiced = (byProject.get(projectId) ?? []).filter(isPln).reduce((sum, d) => sum + d.amount, 0)
    return expected - invoiced
  }
  const open = live.filter((p) => (p.status === 'won' || p.status === 'done') && !settledBeforeKsef(input.events, p.id))
  const unassigned: KsefDocument[] = []
  documents
    .filter((document) => !taken.has(document.sale.ksefNumber))
    .forEach((document) => {
      const { sale } = document
      const fits = (p: ReconcileProject) => {
        const rest = remainder(p.id)
        return isPln(document) && rest !== null && Math.abs(rest - document.amount) <= matchTolerance(document.amount)
      }
      const clients = open.filter((p) => sameClient(p, sale, input.details))
      const byAmount = clients.filter(fits)
      if (byAmount.length === 1) return put(document, byAmount[0].id, 'amount')
      const fresh = clients.filter((p) => !byProject.has(p.id))
      if (byAmount.length === 0 && fresh.length === 1 && (clients.length === 1 || !isPln(document))) {
        return put(document, fresh[0].id, 'client')
      }
      const near = open.filter(
        (p) =>
          !byProject.has(p.id) &&
          fits(p) &&
          Math.abs(Date.parse(p.date) - Date.parse(sale.issueDate)) <= SUGGEST_WITHIN_DAYS * DAY_MS,
      )
      if (byAmount.length === 0 && near.length === 1) return put(document, near[0].id, 'suggested')
      unassigned.push(document)
    })
  return { byProject, unassigned }
}

// ── Zmiany ───────────────────────────────────────────────────────────────────

const INVOICE_FIELDS = ['number', 'amountNetto', 'amountOriginal', 'currency', 'dueDate', 'issueDate', 'ksefNumber', 'buyerId', 'corrections']

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Wydarzenia faktur projektu ↔ faktury KSeF: numer KSeF, numer faktury, potem ręczne wpisy bez numeru po kolei. */
function pairEvents(documents: KsefDocument[], events: TimelineEvent[]) {
  const free = [...events]
  const take = (match: (e: TimelineEvent) => boolean) => {
    const index = free.findIndex(match)
    return index === -1 ? null : free.splice(index, 1)[0]
  }
  const pairs = documents.map((document) => ({ document, event: take((e) => e.data?.ksefNumber === document.sale.ksefNumber) }))
  pairs.forEach((pair) => {
    if (!pair.event) pair.event = take((e) => !e.data?.ksefNumber && normalizedNumber(e.data?.number) === normalizedNumber(pair.document.sale.invoiceNumber))
  })
  const ksefNumbers = new Set(documents.map((d) => normalizedNumber(d.sale.invoiceNumber)))
  pairs.forEach((pair) => {
    // Ręczny wpis bez numeru KSeF i z numerem spoza KSeF (albo bez numeru) to ta sama faktura zapisana niechlujnie.
    if (!pair.event) pair.event = take((e) => !e.data?.ksefNumber && !ksefNumbers.has(normalizedNumber(e.data?.number)) && !normalizedNumber(e.data?.number))
  })
  return { pairs, leftovers: free }
}

/**
 * Nazwa wyświetlana firmy z faktur: ta z kartoteki, a bez niej — najczęstsza
 * wśród projektów, do których trafiły jej faktury (DE Group: trzy projekty pod
 * „DE Group", jeden pod „CIONET" → „DE Group"). Przy remisie wcześniejszy projekt.
 */
function preferredClients(byProject: Map<string, KsefDocument[]>, projects: ReconcileProject[], details: ClientDetails[]) {
  const names = new Map<string, string[]>()
  const ordered = [...byProject].sort(([, a], [, b]) => a[0].sale.ksefDate.localeCompare(b[0].sale.ksefDate))
  ordered.forEach(([projectId, documents]) => {
    const client = projects.find((p) => p.id === projectId)?.client
    if (!client) return
    new Set(documents.map((d) => d.sale.counterpartyId).filter(Boolean)).forEach((id) => names.set(id, [...(names.get(id) ?? []), client]))
  })
  const preferred = new Map<string, string>()
  names.forEach((list, id) => {
    const counts = new Map<string, number>()
    list.forEach((name) => counts.set(clientKey(name), (counts.get(clientKey(name)) ?? 0) + 1))
    const best = list.reduce((top, name) => ((counts.get(clientKey(name)) ?? 0) > (counts.get(clientKey(top)) ?? 0) ? name : top), list[0])
    preferred.set(id, best)
  })
  details.forEach((d) => d.client && preferred.set(d.id, d.client))
  return preferred
}

function clientChanges(
  project: ReconcileProject,
  documents: KsefDocument[],
  details: ClientDetails[],
  preferred: Map<string, string>,
  now: string,
): KsefChange[] {
  const changes: KsefChange[] = []
  const seen = new Set<string>()
  documents.forEach(({ sale }) => {
    if (!sale.counterpartyId || seen.has(sale.counterpartyId)) return
    seen.add(sale.counterpartyId)
    const record = details.find((d) => d.id === sale.counterpartyId) ?? null
    const display = preferred.get(sale.counterpartyId) ?? project.client
    if (display && clientKey(display) !== clientKey(project.client)) {
      // Jeden NIP = jedna nazwa wyświetlana. Osobna zmiana: zapis faktury jej nie wymusza.
      changes.push({ kind: 'client', from: project.client, to: display })
    }
    if (record && record.legalName === sale.counterpartyName) return
    const next: ClientDetails = {
      id: sale.counterpartyId,
      client: record?.client ?? display,
      legalName: sale.counterpartyName,
      nip: sale.counterpartyNip,
      updatedAt: now,
    }
    changes.push({ kind: 'details', record: next, before: record })
  })
  return changes
}

function rowChanges(project: ReconcileProject, documents: KsefDocument[], input: ReconcileInput, preferred: Map<string, string>) {
  const { pairs, leftovers } = pairEvents(documents, liveInvoiceEvents(input.events, project.id))
  const changes: KsefChange[] = []
  pairs.forEach(({ document, event }) => {
    const facts = invoiceFacts(document)
    const start = document.sale.ksefDate
    if (!event) {
      changes.push({
        kind: 'create',
        ksefNumber: document.sale.ksefNumber,
        start,
        title: `Faktura ${document.sale.invoiceNumber}`,
        notes: isPln(document) ? '' : `Kwota na fakturze: ${document.amount} ${document.sale.currency} netto.`,
        data: facts,
      })
      return
    }
    const fields: FieldChange[] = []
    if (event.start.slice(0, 10) !== start) fields.push({ field: 'start', before: event.start, after: start })
    INVOICE_FIELDS.forEach((key) => {
      const after = facts[key]
      // Kwota w złotych zostaje, gdy faktura jest w walucie (KSeF jej nie podaje).
      if (after === undefined && key === 'amountNetto') return
      if (after === undefined && event.data?.[key] === undefined) return
      if (!same(event.data?.[key], after)) fields.push({ field: `data.${key}`, before: event.data?.[key], after })
    })
    if (fields.length) changes.push({ kind: 'update', eventId: event.id, ksefNumber: document.sale.ksefNumber, fields })
  })
  changes.push(...clientChanges(project, documents, input.details, preferred, input.now))
  return { changes, leftovers }
}

// ── Zestawienie ──────────────────────────────────────────────────────────────

export function reconcileKsef(input: ReconcileInput): ReconcileResult {
  const { byProject, unassigned } = assign(input)
  const preferred = preferredClients(byProject, input.projects, input.details)
  const noInvoice = new Set(input.decisions.filter((d) => d.kind === 'no_invoice').map((d) => d.projectId))
  const rows: ReconcileRow[] = []

  input.projects
    .filter((p) => !p.deletedAt)
    .forEach((project) => {
      const documents = byProject.get(project.id) ?? []
      const hubValue = input.expected.get(project.id) ?? null
      if (documents.length) {
        if (!documents.some((d) => input.inPeriod(d.sale.issueDate))) return
        const { changes, leftovers } = rowChanges(project, documents, input, preferred)
        const ksefTotal = documents.every(isPln) ? roundMoney(documents.reduce((sum, d) => sum + d.amount, 0)) : null
        const diff = ksefTotal !== null && hubValue !== null ? roundMoney(ksefTotal - hubValue) : null
        // Sama propozycja zmiany klienta nie czyni faktury „do poprawy".
        const invoiceChanges = changes.filter((c) => c.kind !== 'client')
        const status: RowStatus = diff !== null && Math.abs(diff) >= SHOWN_DIFF ? 'amount' : invoiceChanges.length ? 'changes' : 'ok'
        rows.push({ project, documents, hubValue, ksefTotal, diff, changes, extraHubInvoices: leftovers, status })
        return
      }
      // Projekt bez faktury w KSeF: liczy się tylko zlecenie z tego okresu, wystawione po starcie KSeF.
      if (project.status !== 'won' && project.status !== 'done') return
      if (!input.inPeriod(project.date) || project.date < KSEF_FROM || settledBeforeKsef(input.events, project.id)) return
      const status: RowStatus = noInvoice.has(project.id) ? 'no_invoice' : project.status === 'done' ? 'missing' : 'waiting'
      rows.push({ project, documents, hubValue, ksefTotal: null, diff: null, changes: [], extraHubInvoices: [], status })
    })

  const live = input.projects.filter((p) => !p.deletedAt)
  return {
    rows: rows.sort((a, b) => (b.documents[0]?.sale.ksefDate ?? b.project.date).localeCompare(a.documents[0]?.sale.ksefDate ?? a.project.date)),
    unassigned: unassigned
      .filter((document) => input.inPeriod(document.sale.issueDate))
      .map((document) => ({
        document,
        hints: live
          .filter((p) => p.status !== 'lost' && similarCompany(p.client, document.sale.counterpartyName))
          .map((p) => p.id),
      })),
  }
}

// ── Zastosowanie ─────────────────────────────────────────────────────────────

/** Wydarzenie po zmianie z KSeF; poprzednie wartości zostają w `updatedFrom`. */
export function applyEventUpdate(event: TimelineEvent, change: Extract<KsefChange, { kind: 'update' }>, now: string): TimelineEvent {
  const data: Record<string, unknown> = { ...event.data }
  let start = event.start
  change.fields.forEach(({ field, after }) => {
    if (field === 'start') start = after as string
    else if (after === undefined) delete data[field.slice('data.'.length)]
    else data[field.slice('data.'.length)] = after
  })
  const trace = {
    type: 'ksef',
    ref: `ksef:${change.ksefNumber}`,
    at: now,
    fields: change.fields.map((f) => f.field),
    before: Object.fromEntries(change.fields.map((f) => [f.field, f.before ?? null])),
  }
  const previous = Array.isArray(event.updatedFrom) ? event.updatedFrom : []
  return { ...event, start, data, updatedFrom: [...previous, trace], updatedAt: now }
}

/** „Zastosuj wszystkie": tylko pewne dopasowania bez różnicy kwot. */
export function safeToApplyInBulk(row: ReconcileRow): boolean {
  return row.status === 'changes' && row.documents.every((d) => d.reason !== 'suggested')
}
