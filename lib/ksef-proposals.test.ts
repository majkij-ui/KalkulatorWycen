import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { TimelineEvent } from './event-types'
import { applyEventUpdate, eventFromProposal, planEventUpdate } from './inbox'
import type { EventProposal, EventUpdateProposal, Proposal } from './inbox-types'
import { validateInboxDraft } from './inbox-validate'
import { buildKsefSalesDraft, companyKey, type KsefProject, type KsefSale } from './ksef-proposals'
import { projectMoney } from './money-loop'

function sale(over: Partial<KsefSale> = {}): KsefSale {
  return {
    ksefNumber: '5265877635-20270115-AAA-01',
    invoiceNumber: 'FV/1/2027',
    direction: 'sale',
    issueDate: '2027-01-15',
    ksefDate: '2027-01-15',
    counterpartyName: 'CIONET Polska sp. z o.o.',
    counterpartyNip: '7980332920',
    netAmount: 23020,
    grossAmount: 28314.6,
    vatAmount: 5294.6,
    currency: 'PLN',
    invoiceType: 'Vat',
    isCorrection: false,
    details: { dueDate: '2027-02-14', lines: [], correctedKsefNumber: '', correctedNumber: '' },
    ...over,
  }
}

const project = (over: Partial<KsefProject> = {}): KsefProject => ({
  id: 'p-1',
  name: 'Film CIONET',
  client: 'CIONET',
  status: 'won',
  ...over,
})

function invoiceEvent(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e-1',
    kind: 'invoice_sent',
    projectId: 'p-1',
    start: '2027-01-20',
    title: 'Faktura',
    notes: '',
    data: {},
    source: { type: 'manual' },
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function only(sales: KsefSale[], projects: KsefProject[], events: TimelineEvent[] = [], pending: Proposal[] = []): Proposal {
  const { draft } = buildKsefSalesDraft(sales, { projects, events, pending })
  assert.equal(draft.proposals.length, 1)
  return draft.proposals[0]
}

function valid(proposals: Proposal[], projects: KsefProject[], events: TimelineEvent[] = []) {
  return validateInboxDraft(
    { format: 'nonoise-hub-inbox', version: 1, note: 'test', proposals },
    { projects, events, campaigns: [], decisions: [], pendingRefs: new Map(), projectNewRefs: new Map(), today: '2027-12-31' },
  )
}

test('nazwa bez formy prawnej i polskich znaków', () => {
  assert.equal(companyKey('Tchibo Polska Sp. z o.o.'), 'tchibo polska')
  assert.equal(companyKey('Łódź Film S.A.'), 'lodz film')
})

test('jedyny otwarty projekt klienta: nowa faktura trafia do niego, z datą KSeF i datą wystawienia', () => {
  const proposal = only([sale({ issueDate: '2026-12-31', ksefDate: '2027-01-02' })], [project()]) as EventProposal
  assert.equal(proposal.type, 'event')
  assert.equal(proposal.projectId, 'p-1')
  assert.equal(proposal.event.start, '2027-01-02')
  assert.equal(proposal.event.data.issueDate, '2026-12-31')
  assert.equal(proposal.event.data.amountNetto, 23020)
  assert.equal(proposal.event.data.dueDate, '2027-02-14')
  assert.deepEqual(valid([proposal], [project()]).errors, [])
})

test('kilka otwartych projektów klienta: bez automatu', () => {
  const proposal = only([sale()], [project(), project({ id: 'p-2' })]) as EventProposal
  assert.equal(proposal.type, 'event')
  assert.equal(proposal.projectId, undefined)
  assert.match(proposal.reason, /2 otwarte projekty/)
})

test('brak pasującego projektu: nieprzypisana, bez projektu', () => {
  const proposal = only([sale({ counterpartyName: 'Inna Firma' })], [project()]) as EventProposal
  assert.equal(proposal.projectId, undefined)
  assert.match(proposal.reason, /Nieprzypisana/)
})

test('projekt przegrany, usunięty albo w pełni zafakturowany nie jest kandydatem', () => {
  const candidates = [
    project({ id: 'p-lost', status: 'lost' }),
    project({ id: 'p-gone', deletedAt: '2027-01-01' }),
    project({ id: 'p-full', financials: { sumaNetto: 1000 } }),
    project({ id: 'p-open' }),
  ]
  const paid = invoiceEvent({ id: 'e-full', projectId: 'p-full', data: { amountNetto: 1000, ksefNumber: 'x' } })
  const proposal = only([sale()], candidates, [paid]) as EventProposal
  assert.equal(proposal.projectId, 'p-open')
})

test('projekt w realizacji ma pierwszeństwo przed samą wyceną', () => {
  const proposal = only([sale()], [project({ id: 'p-quote', status: 'quote' }), project({ id: 'p-won' })]) as EventProposal
  assert.equal(proposal.projectId, 'p-won')
})

test('NIP z przyjętej faktury wskazuje klienta mimo innej nazwy', () => {
  const projects = [project({ id: 'p-old', client: 'Marka X', status: 'done', financials: { sumaNetto: 100 } }), project({ id: 'p-new', client: 'Marka X' })]
  const earlier = invoiceEvent({ projectId: 'p-old', data: { amountNetto: 100, buyerNip: '7980332920', ksefNumber: 'y' } })
  const proposal = only([sale({ counterpartyName: 'Spółka Celowa' })], projects, [earlier]) as EventProposal
  assert.equal(proposal.projectId, 'p-new')
})

test('jedyny ręczny wpis w projekcie: KSeF nadpisuje numer, kwotę, termin i dzień; akceptacja to zapisuje', () => {
  const existing = invoiceEvent({ data: { number: 'stary', amountNetto: 20000 } })
  const proposal = only([sale()], [project()], [existing]) as EventUpdateProposal
  assert.equal(proposal.type, 'event_update')
  assert.equal(proposal.ifMissing, false)
  assert.deepEqual(valid([proposal], [project()], [existing]).errors, [])
  const fields = planEventUpdate(existing, proposal, null).map((change) => change.field)
  assert.ok(fields.includes('start') && fields.includes('data.amountNetto') && fields.includes('data.number'))
  const next = applyEventUpdate(existing, proposal, null, 'plik.json')!
  assert.equal(next.start, '2027-01-15')
  assert.equal(next.data.amountNetto, 23020)
  assert.equal(next.data.number, 'FV/1/2027')
  const trace = (next.updatedFrom as { before?: Record<string, unknown> }[]).at(-1)!
  assert.equal(trace.before?.['data.amountNetto'], 20000)
  assert.equal(trace.before?.['data.number'], 'stary')
  assert.equal(trace.before?.start, '2027-01-20')
})

test('ten sam numer w innym zapisie: nadpisuje ten wpis, także gdy projektów jest kilka', () => {
  const existing = invoiceEvent({ id: 'e-9', projectId: 'p-2', data: { number: ' fv/1/2027 ' } })
  const proposal = only([sale()], [project(), project({ id: 'p-2' })], [existing]) as EventUpdateProposal
  assert.equal(proposal.eventId, 'e-9')
})

test('rok 2026 zostaje nietknięty: wpis sprzed 2027 nie jest nadpisywany, nawet przy tym samym numerze', () => {
  const old = invoiceEvent({ start: '2026-11-20', data: { number: 'FV/1/2027', amountNetto: 1000 } })
  const proposal = only([sale()], [project()], [old]) as EventProposal
  assert.equal(proposal.type, 'event')
  assert.equal(proposal.projectId, 'p-1')
})

test('zakończony projekt z fakturą z 2026 nie przyciąga faktury z 2027', () => {
  const old = invoiceEvent({ start: '2026-11-20', data: { amountNetto: 1000 } })
  const proposal = only([sale()], [project({ status: 'done' })], [old]) as EventProposal
  assert.equal(proposal.projectId, undefined)
  assert.match(proposal.reason, /Nieprzypisana/)
})

test('projekt w realizacji z zaliczką z 2026 nadal może dostać fakturę końcową', () => {
  const advance = invoiceEvent({ start: '2026-11-20', data: { amountNetto: 1000 } })
  const proposal = only([sale()], [project()], [advance]) as EventProposal
  assert.equal(proposal.projectId, 'p-1')
})

test('dwa ręczne wpisy w projekcie: nie zgadujemy, nowa faktura', () => {
  const events = [invoiceEvent({ id: 'e-1' }), invoiceEvent({ id: 'e-2' })]
  assert.equal(only([sale()], [project()], events).type, 'event')
})

test('wpis z numerem KSeF to inna faktura (np. zaliczka), nie jest nadpisywany', () => {
  const advance = invoiceEvent({ data: { amountNetto: 5000, ksefNumber: 'zaliczka' } })
  assert.equal(only([sale()], [project()], [advance]).type, 'event')
})

test('faktura w EUR: bez kwoty w polu złotówek, kwota na fakturze zapisana osobno', () => {
  const proposal = only([sale({ currency: 'EUR', netAmount: 5000 })], [project()]) as EventProposal
  assert.equal(proposal.event.data.amountNetto, undefined)
  assert.equal(proposal.event.data.amountOriginal, 5000)
  assert.equal(proposal.event.data.currency, 'EUR')
  assert.match(proposal.event.notes, /5000 EUR/)
})

test('faktura w EUR nie kasuje kwoty w złotych z wcześniejszego wpisu', () => {
  const existing = invoiceEvent({ data: { number: 'FV/1/2027', amountNetto: 21000 } })
  const proposal = only([sale({ currency: 'EUR', netAmount: 5000 })], [project()], [existing]) as EventUpdateProposal
  const next = applyEventUpdate(existing, proposal, null, 'plik.json')!
  assert.equal(next.data.amountNetto, 21000)
  assert.equal(next.data.amountOriginal, 5000)
})

const correction = (over: Partial<KsefSale> = {}) =>
  sale({
    ksefNumber: 'KOR-1',
    invoiceNumber: 'KOR/1/2027',
    invoiceType: 'Kor',
    isCorrection: true,
    netAmount: -3020,
    details: { dueDate: '', lines: [], correctedKsefNumber: 'ORYG', correctedNumber: 'FV/1/2027' },
    ...over,
  })

test('korekta: zmienia kwotę oryginału, oba dokumenty zostają, bez nowego przychodu', () => {
  const original = invoiceEvent({ data: { number: 'FV/1/2027', amountNetto: 23020, ksefNumber: 'ORYG' } })
  const proposal = only([correction()], [project()], [original]) as EventUpdateProposal
  assert.equal(proposal.type, 'event_update')
  assert.equal(proposal.set.date, undefined)
  const next = applyEventUpdate(original, proposal, null, 'plik.json')!
  assert.equal(next.data.amountNetto, 20000)
  assert.equal(next.data.number, 'FV/1/2027')
  assert.equal((next.data.corrections as { number: string }[])[0].number, 'KOR/1/2027')
  assert.equal(next.start, original.start)
})

test('druga korekta dopisuje się do pierwszej i liczy od aktualnej kwoty', () => {
  const original = invoiceEvent({
    data: { number: 'FV/1/2027', amountNetto: 20000, ksefNumber: 'ORYG', corrections: [{ number: 'KOR/1/2027' }] },
  })
  const proposal = only([correction({ ksefNumber: 'KOR-2', invoiceNumber: 'KOR/2/2027', netAmount: 500 })], [project()], [original]) as EventUpdateProposal
  assert.equal(proposal.set.data?.amountNetto, 20500)
  assert.equal((proposal.set.data?.corrections as unknown[]).length, 2)
})

test('korekta bez oryginału w hubie czeka, nie tworzy przychodu', () => {
  const { draft, held } = buildKsefSalesDraft([correction()], { projects: [project()], events: [], pending: [] })
  assert.equal(draft.proposals.length, 0)
  assert.match(held[0], /najpierw ją przyjmij/)
})

test('dwie korekty jednej faktury naraz: druga czeka, żeby nie liczyć od tej samej kwoty', () => {
  const original = invoiceEvent({ data: { number: 'FV/1/2027', amountNetto: 23020, ksefNumber: 'ORYG' } })
  const { draft, held } = buildKsefSalesDraft(
    [correction(), correction({ ksefNumber: 'KOR-2', invoiceNumber: 'KOR/2/2027' })],
    { projects: [project()], events: [original], pending: [] },
  )
  assert.equal(draft.proposals.length, 1)
  assert.equal(held.length, 1)
})

test('korekta czeka, gdy na fakturę czeka już inna zmiana w skrzynce', () => {
  const original = invoiceEvent({ data: { number: 'FV/1/2027', amountNetto: 23020, ksefNumber: 'ORYG' } })
  const waiting = only([correction()], [project()], [original])
  const { draft, held } = buildKsefSalesDraft(
    [correction({ ksefNumber: 'KOR-2' })],
    { projects: [project()], events: [original], pending: [waiting] },
  )
  assert.equal(draft.proposals.length, 0)
  assert.equal(held.length, 1)
})

test('zmiana dnia działa tylko w propozycji z KSeF', () => {
  const event = invoiceEvent()
  const fromMail = { ...(only([sale()], [project()], [event]) as EventUpdateProposal), ref: 'gmail:abc' }
  assert.equal(planEventUpdate(event, fromMail, null).some((change) => change.field === 'start'), false)
  assert.ok(valid([fromMail], [project()], [event]).errors.some((message) => message.includes('„date"')))
})

test('faktura z 31.12, numer w styczniu: przychód w roku wystawienia, kalendarz w dacie numeru', () => {
  const proposal = only([sale({ issueDate: '2026-12-31', ksefDate: '2027-01-02' })], [project()]) as EventProposal
  const event = eventFromProposal(proposal, 'p-1', 'plik.json')
  const money = projectMoney(
    { id: 'p-1', status: 'done', date: '2026-12-01', financials: { sumaNetto: 23020 } as never, costs: [] },
    [event],
    '2027-03-01',
  )
  assert.equal(event.start, '2027-01-02')
  assert.equal(money.invoices[0].sent, '2027-01-02')
  assert.equal(money.pieces[0].day, '2026-12-31')
  assert.equal(money.anchor, '2026-12-31')
})

// ── Hub nie wystawia faktur (decyzja M.J., 2026-10-30: robi to biuro rachunkowe) ──

function sourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    if (name === 'node_modules' || name === 'target') return []
    const path = join(folder, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx|mts|mjs|rs)$/.test(name) ? [path] : []
  })
}

test('żaden kod huba nie wystawia faktur: wyjątkiem jest tylko próba na środowisku testowym', () => {
  const ALLOWED = new Set(['scripts/ksef-test-env.mts', 'lib/ksef.test.ts', 'lib/ksef-proposals.test.ts'])
  const offenders = ['app', 'components', 'hooks', 'lib', 'scripts', 'src-tauri/src']
    .flatMap(sourceFiles)
    .filter((path) => !ALLOWED.has(path))
    .filter((path) => /\/sessions\/(online|batch)|InvoiceWrite/.test(readFileSync(path, 'utf8')))
  assert.deepEqual(offenders, [])
})

test('próba wystawiająca testowe faktury zna tylko adres testowy i nie trafia do aplikacji', () => {
  const harness = readFileSync('scripts/ksef-test-env.mts', 'utf8')
  assert.match(harness, /const BASE_URL = KSEF_BASE_URLS\.test\n/)
  assert.doesNotMatch(harness, /KSEF_BASE_URLS\.(prod|demo)|api\.ksef\.mf\.gov\.pl/)
  const importers = ['app', 'components', 'hooks', 'lib', 'scripts', 'src-tauri/src']
    .flatMap(sourceFiles)
    .filter((path) => !path.endsWith('.test.ts') && path !== 'scripts/ksef-test-env.mts')
    .filter((path) => readFileSync(path, 'utf8').includes('ksef-test-env'))
  assert.deepEqual(importers, [])
})
