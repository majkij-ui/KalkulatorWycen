import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { renameDetails, type ClientDetails } from './client-details'
import type { TimelineEvent } from './event-types'
import { ksefCacheFile, parseKsefCache } from './ksef-cache'
import type { KsefSale } from './ksef-invoices'
import {
  applyEventUpdate,
  companyKey,
  ksefDocuments,
  reconcileKsef,
  safeToApplyInBulk,
  similarCompany,
  type KsefChange,
  type KsefDecision,
  type ReconcileInput,
  type ReconcileProject,
} from './ksef-reconcile'

// Przypadki z prawdziwego konta M.J. (KSeF od 02.2026, zestawienie 2026-11-13), kwoty jak na fakturach.

function sale(number: string, over: Partial<KsefSale> = {}): KsefSale {
  return {
    ksefNumber: `K-${number}`,
    invoiceNumber: number,
    direction: 'sale',
    issueDate: '2026-09-16',
    ksefDate: '2026-09-16',
    counterpartyName: 'Firma',
    counterpartyNip: '1111111111',
    counterpartyId: 'Nip:1111111111',
    netAmount: 1000,
    grossAmount: 1230,
    vatAmount: 230,
    currency: 'PLN',
    invoiceType: 'Vat',
    isCorrection: false,
    details: { dueDate: '2026-09-30', lines: [], correctedKsefNumber: '', correctedNumber: '' },
    ...over,
  }
}

const project = (id: string, client: string, over: Partial<ReconcileProject> = {}): ReconcileProject => ({
  id,
  name: id,
  client,
  status: 'done',
  date: '2026-09-01',
  ...over,
})

let eventId = 0
function invoiceEvent(projectId: string, start: string, data: Record<string, unknown> = {}, kind = 'invoice_sent'): TimelineEvent {
  eventId += 1
  return {
    id: `e-${eventId}`,
    kind,
    projectId,
    start,
    title: '',
    notes: '',
    data,
    source: { type: 'manual' },
    createdAt: '',
    updatedAt: '',
  }
}

function run(over: Partial<ReconcileInput> & Pick<ReconcileInput, 'projects' | 'invoices'>) {
  return reconcileKsef({
    expected: new Map(),
    events: [],
    details: [],
    decisions: [],
    inPeriod: (day) => day.startsWith('2026'),
    now: '2026-11-13T10:00:00.000Z',
    ...over,
  })
}

const rowOf = (result: ReturnType<typeof run>, id: string) => result.rows.find((r) => r.project.id === id)
const changesOf = (result: ReturnType<typeof run>, id: string, kind: KsefChange['kind']) =>
  rowOf(result, id)?.changes.filter((c) => c.kind === kind) ?? []

test('nazwy firm: forma prawna, cudzysłowy i wielkość liter nie odróżniają', () => {
  assert.equal(companyKey('"MORRIS & LLOYD" BROKER SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'), 'morris lloyd broker')
  assert.ok(similarCompany('Morris & Lloyd Broker', '"MORRIS & LLOYD" BROKER SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'))
  assert.ok(similarCompany('Interferie S.A.', 'INTERFERIE SPÓŁKA AKCYJNA'))
  assert.ok(similarCompany('Tchibo', 'Tchibo GmbH'))
  assert.ok(similarCompany('Sovereign AI Poland', 'SOVEREIGN AI HOLDINGS POLAND SPÓŁKA Z O.O.'))
  assert.equal(similarCompany('Hotshotz', 'POLECAM Piotr Serbin'), false)
  assert.equal(similarCompany('JHJ', 'Inny'), false)
})

test('zgodna faktura: ten sam numer, kwota i data — nic do zmiany', () => {
  const invoice = sale('1/03/2026', { issueDate: '2026-03-03', ksefDate: '2026-03-03', netAmount: 918, counterpartyName: 'PHN PROPERTY MANAGEMENT SP. Z O.O.' })
  const events = [invoiceEvent('phn', '2026-03-03', { number: '1/03/2026', amountNetto: 918 })]
  const details: ClientDetails[] = [{ id: 'Nip:1111111111', client: 'PHN', legalName: 'PHN PROPERTY MANAGEMENT SP. Z O.O.', nip: '1111111111', updatedAt: '' }]
  const result = run({
    projects: [project('phn', 'PHN')],
    invoices: [invoice],
    events: [{ ...events[0], data: { ...events[0].data, dueDate: '2026-09-30', issueDate: '2026-03-03', ksefNumber: 'K-1/03/2026', buyerId: 'Nip:1111111111' } }],
    details,
    expected: new Map([['phn', 918]]),
  })
  assert.equal(rowOf(result, 'phn')?.status, 'ok')
})

test('ten sam numer, inna data (Interferie 1/02: 18.02 w hubie, 23.02 w KSeF): poprawka daty i pól faktury', () => {
  const invoice = sale('1/02/2026', { issueDate: '2026-02-23', ksefDate: '2026-02-23', netAmount: 300, counterpartyName: 'INTERFERIE SPÓŁKA AKCYJNA' })
  const event = invoiceEvent('reformat', '2026-02-18', { number: '1/02/2026', amountNetto: 300 })
  const result = run({ projects: [project('reformat', 'Interferie S.A.')], invoices: [invoice], events: [event], expected: new Map([['reformat', 300]]) })
  const row = rowOf(result, 'reformat')!
  assert.equal(row.status, 'changes')
  assert.equal(row.documents[0].reason, 'number')
  const update = row.changes.find((c) => c.kind === 'update') as Extract<KsefChange, { kind: 'update' }>
  assert.deepEqual(update.fields.find((f) => f.field === 'start'), { field: 'start', before: '2026-02-18', after: '2026-02-23' })
  assert.ok(update.fields.some((f) => f.field === 'data.ksefNumber'))
  assert.ok(safeToApplyInBulk(row))
})

test('S-AI: wpis w hubie bez numeru i kwoty, faktura równa cenie z dosprzedażą', () => {
  const invoice = sale('2/06/2026', { issueDate: '2026-06-23', ksefDate: '2026-06-23', netAmount: 80440, counterpartyName: 'SOVEREIGN AI HOLDINGS POLAND SPÓŁKA Z O.O.' })
  const event = invoiceEvent('sai', '2026-06-24', {})
  const result = run({
    projects: [project('sai', 'Sovereign AI Poland', { date: '2026-05-05' })],
    invoices: [invoice],
    events: [event],
    expected: new Map([['sai', 67800 + 7640 + 5000]]),
  })
  const row = rowOf(result, 'sai')!
  assert.equal(row.documents[0].reason, 'amount')
  assert.equal(row.diff, 0)
  const update = row.changes.find((c) => c.kind === 'update') as Extract<KsefChange, { kind: 'update' }>
  assert.equal(update.eventId, event.id)
  assert.equal(update.fields.find((f) => f.field === 'data.amountNetto')?.after, 80440)
})

test('Morris & Lloyd: jeden projekt, dwie faktury, suma = cena + dosprzedaż', () => {
  const main = sale('1/09/2026', { netAmount: 14040, counterpartyName: '"MORRIS & LLOYD" BROKER SPÓŁKA Z O.O.' })
  const extra = sale('2/10/2026', { issueDate: '2026-10-08', ksefDate: '2026-10-08', netAmount: 2160, counterpartyName: '"MORRIS & LLOYD" BROKER SPÓŁKA Z O.O.' })
  const events = [invoiceEvent('ml', '2026-09-16', { number: '1/09/2026' })]
  const result = run({
    projects: [project('ml', 'Morris & Lloyd Broker', { date: '2026-07-28' }), project('ml-rolki', 'Morris & Lloyd Broker', { status: 'won', date: '2026-10-21' })],
    invoices: [main, extra],
    events,
    expected: new Map([
      ['ml', 13180 + 3020],
      ['ml-rolki', 11980],
    ]),
  })
  const row = rowOf(result, 'ml')!
  assert.deepEqual(row.documents.map((d) => [d.sale.invoiceNumber, d.reason]), [
    ['1/09/2026', 'number'],
    ['2/10/2026', 'amount'],
  ])
  assert.equal(row.diff, 0)
  assert.equal(changesOf(result, 'ml', 'create').length, 1)
  assert.equal(rowOf(result, 'ml-rolki')?.status, 'waiting')
})

test('Solvo: w hubie sama wpłata, bez faktury — faktura dopisuje się do projektu o tej kwocie', () => {
  const invoice = sale('1/10/2026', { issueDate: '2026-10-08', ksefDate: '2026-10-08', netAmount: 1800, counterpartyName: 'Solvo Film Łukasz Radzikowski' })
  const result = run({
    projects: [
      project('grodzisk', 'Solvo Film Łukasz Radzikowski', { date: '2026-09-30' }),
      project('cez', 'Solvo Film Łukasz Radzikowski', { date: '2026-09-21' }),
    ],
    invoices: [invoice],
    events: [invoiceEvent('grodzisk', '2026-10-24', {}, 'invoice_paid'), invoiceEvent('cez', '2026-11-10', {}, 'invoice_paid')],
    expected: new Map([
      ['grodzisk', 1800],
      ['cez', 4200],
    ]),
  })
  assert.equal(rowOf(result, 'grodzisk')?.documents[0].reason, 'amount')
  const create = changesOf(result, 'grodzisk', 'create')[0] as Extract<KsefChange, { kind: 'create' }>
  assert.equal(create.start, '2026-10-08')
  assert.equal(create.data.amountNetto, 1800)
  assert.equal(create.data.dueDate, '2026-09-30')
})

test('JHJ: kwota różni się o 30 zł — faktura pasuje, różnica jest pokazana', () => {
  const invoice = sale('4/10/2026', { issueDate: '2026-10-23', ksefDate: '2026-10-23', netAmount: 26310, counterpartyName: '"JHJ" SPÓŁKA Z O.O.' })
  const result = run({ projects: [project('jhj', 'JHJ', { date: '2026-07-28' })], invoices: [invoice], expected: new Map([['jhj', 22250 + 4090]]) })
  const row = rowOf(result, 'jhj')!
  assert.equal(row.documents[0].reason, 'amount')
  assert.equal(row.diff, -30)
  assert.equal(row.status, 'amount')
  assert.equal(safeToApplyInBulk(row), false)
})

test('YoPro: faktura niższa niż cena z dosprzedażą — różnica, nie zgadywanie', () => {
  const invoice = sale('3/03/2026', { issueDate: '2026-03-26', ksefDate: '2026-03-26', netAmount: 9180, counterpartyName: 'DANIEL KRĘŻOŁEK' })
  const result = run({
    projects: [project('yopro', 'Daniel Krężołek', { date: '2026-03-26' })],
    invoices: [invoice],
    events: [invoiceEvent('yopro', '2026-03-26', { number: '3/03/2026', amountNetto: 9180 })],
    expected: new Map([['yopro', 9180 + 2000 + 1050]]),
  })
  assert.equal(rowOf(result, 'yopro')?.diff, -3050)
  assert.equal(rowOf(result, 'yopro')?.status, 'amount')
})

test('Piotrek: inna nazwa w hubie (Hotshotz), zgodna kwota — tylko podpowiedź do sprawdzenia', () => {
  const invoice = sale('1/11/2026', { issueDate: '2026-11-02', ksefDate: '2026-11-02', netAmount: 900, counterpartyName: 'POLECAM Piotr Serbin' })
  const result = run({ projects: [project('piotrek', 'Hotshotz', { date: '2026-10-26' })], invoices: [invoice], expected: new Map([['piotrek', 900]]) })
  const row = rowOf(result, 'piotrek')!
  assert.equal(row.documents[0].reason, 'suggested')
  assert.equal(safeToApplyInBulk(row), false)
})

test('jeden NIP = jedna nazwa wyświetlana: drugi projekt Piotrka dostaje nazwę z kartoteki', () => {
  const invoice = sale('1/11/2026', { issueDate: '2026-11-02', ksefDate: '2026-11-02', netAmount: 900, counterpartyName: 'POLECAM Piotr Serbin' })
  const details: ClientDetails[] = [{ id: 'Nip:1111111111', client: 'Piotrek', legalName: 'POLECAM Piotr Serbin', nip: '1111111111', updatedAt: '' }]
  const result = run({
    projects: [project('piotrek', 'Hotshotz', { date: '2026-10-26' })],
    invoices: [invoice],
    details,
    decisions: [{ id: 'assign:K-1/11/2026', kind: 'assign', projectId: 'piotrek', ksefNumber: 'K-1/11/2026', at: '' }],
    expected: new Map([['piotrek', 900]]),
  })
  assert.deepEqual(changesOf(result, 'piotrek', 'client'), [{ kind: 'client', from: 'Hotshotz', to: 'Piotrek' }])
  assert.equal(changesOf(result, 'piotrek', 'details').length, 0)
})

test('nazwa wyświetlana firmy: większość jej projektów (DE Group ×2 wobec CIONET ×1), zmiana klienta osobno', () => {
  const de = (number: string, issueDate: string) =>
    sale(number, { issueDate, ksefDate: issueDate, netAmount: 1000, counterpartyName: 'DE GROUP SPÓŁKA Z O.O.', counterpartyId: 'Nip:7010645765' })
  const result = run({
    projects: [project('vitkac', 'DE Group Sp. z o.o.'), project('ambasada', 'DE Group Sp. z o.o.'), project('wywiady', 'CIONET')],
    invoices: [de('1/05/2026', '2026-05-05'), de('2/03/2026', '2026-03-03'), de('4/09/2026', '2026-09-22')],
    events: [
      invoiceEvent('vitkac', '2026-05-05', { number: '1/05/2026' }),
      invoiceEvent('ambasada', '2026-03-03', { number: '2/03/2026' }),
      invoiceEvent('wywiady', '2026-09-21', { number: '4/09/2026' }),
    ],
  })
  assert.deepEqual(changesOf(result, 'wywiady', 'client'), [{ kind: 'client', from: 'CIONET', to: 'DE Group Sp. z o.o.' }])
  assert.equal(changesOf(result, 'vitkac', 'client').length, 0)
  const record = (changesOf(result, 'vitkac', 'details')[0] as Extract<KsefChange, { kind: 'details' }>).record
  assert.equal(record.client, 'DE Group Sp. z o.o.')
})

test('nowa firma: kartoteka dostaje nazwę z faktury i NIP, nazwa wyświetlana zostaje z projektu', () => {
  const invoice = sale('3/09/2026', { netAmount: 2000, counterpartyName: 'INTERFERIE SPÓŁKA AKCYJNA' })
  const result = run({ projects: [project('natura', 'Interferie S.A.')], invoices: [invoice], expected: new Map([['natura', 2000]]) })
  const change = changesOf(result, 'natura', 'details')[0] as Extract<KsefChange, { kind: 'details' }>
  assert.deepEqual(
    { client: change.record.client, legalName: change.record.legalName, nip: change.record.nip },
    { client: 'Interferie S.A.', legalName: 'INTERFERIE SPÓŁKA AKCYJNA', nip: '1111111111' },
  )
})

test('Tchibo GmbH: faktura w EUR — bez kwoty w złotych, jedyny projekt klienta', () => {
  const invoice = sale('2/11/2026', {
    issueDate: '2026-11-12',
    ksefDate: '2026-11-12',
    netAmount: 1460,
    currency: 'EUR',
    counterpartyName: 'Tchibo GmbH',
    counterpartyNip: '',
    counterpartyId: 'VatUe:DE118569490',
  })
  const correction = sale('1/KOR/11/2026', {
    issueDate: '2026-11-12',
    ksefDate: '2026-11-12',
    netAmount: 0,
    currency: 'EUR',
    invoiceType: 'Kor',
    isCorrection: true,
    counterpartyName: 'Tchibo GmbH',
    counterpartyId: 'VatUe:DE118569490',
    details: { dueDate: '', lines: [], correctedKsefNumber: 'K-2/11/2026', correctedNumber: '2/11/2026' },
  })
  const result = run({ projects: [project('tchibo', 'Tchibo', { date: '2026-10-02' })], invoices: [invoice, correction], expected: new Map([['tchibo', 6374.51]]) })
  const row = rowOf(result, 'tchibo')!
  assert.equal(row.documents.length, 1)
  assert.equal(row.documents[0].corrections.length, 1)
  assert.equal(row.ksefTotal, null)
  const create = row.changes.find((c) => c.kind === 'create') as Extract<KsefChange, { kind: 'create' }>
  assert.equal(create.data.amountNetto, undefined)
  assert.equal(create.data.amountOriginal, 1460)
  assert.equal((create.data.corrections as unknown[]).length, 1)
})

test('CIONET wywiady: korekta po błędnej fakturze dołącza do niej i zmienia kwotę', () => {
  const invoice = sale('4/09/2026', { issueDate: '2026-09-22', ksefDate: '2026-09-22', netAmount: 2598, counterpartyName: 'DE GROUP SP. Z O.O.' })
  const correction = sale('1/KOR/12/2026', {
    issueDate: '2026-12-02',
    ksefDate: '2026-12-02',
    netAmount: 662,
    invoiceType: 'Kor',
    isCorrection: true,
    details: { dueDate: '', lines: [], correctedKsefNumber: 'K-4/09/2026', correctedNumber: '4/09/2026' },
  })
  const result = run({
    projects: [project('wywiady', 'CIONET', { date: '2026-08-12' })],
    invoices: [invoice, correction],
    events: [invoiceEvent('wywiady', '2026-09-21', { number: '4/09/2026' })],
    expected: new Map([['wywiady', 3260]]),
  })
  const row = rowOf(result, 'wywiady')!
  assert.equal(row.documents[0].amount, 3260)
  assert.equal(row.diff, 0)
  const update = row.changes.find((c) => c.kind === 'update') as Extract<KsefChange, { kind: 'update' }>
  assert.equal(update.fields.find((f) => f.field === 'data.amountNetto')?.after, 3260)
})

test('Stylbud: projekt bez faktury, oznaczony jako barter — nie jest brakiem', () => {
  const projects = [project('stylbud', 'STYLBUD', { date: '2026-07-01' }), project('brak', 'Ktoś', { date: '2026-07-01' })]
  const decisions: KsefDecision[] = [{ id: 'none:stylbud', kind: 'no_invoice', projectId: 'stylbud', at: '' }]
  const result = run({ projects, invoices: [], decisions })
  assert.equal(rowOf(result, 'stylbud')?.status, 'no_invoice')
  assert.equal(rowOf(result, 'brak')?.status, 'missing')
})

test('projekt rozliczony przed KSeF (faktura ze stycznia) nie jest brakiem ani kandydatem', () => {
  const result = run({
    projects: [project('styczen', 'Interferie S.A.', { date: '2026-01-30' })],
    invoices: [sale('3/09/2026', { counterpartyName: 'INTERFERIE SPÓŁKA AKCYJNA', netAmount: 2300 })],
    events: [invoiceEvent('styczen', '2026-01-30', { number: '2/01/2026', amountNetto: 2300 })],
    expected: new Map([['styczen', 2300]]),
  })
  assert.equal(rowOf(result, 'styczen'), undefined)
  assert.equal(result.unassigned.length, 1)
})

test('dwa projekty klienta o tej samej kwocie: faktura czeka na wybór, z podpowiedzią', () => {
  const result = run({
    projects: [project('a', 'DE Group Sp. z o.o.'), project('b', 'DE Group Sp. z o.o.')],
    invoices: [sale('1/05/2026', { counterpartyName: 'DE GROUP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', netAmount: 1500 })],
    expected: new Map([
      ['a', 1500],
      ['b', 1500],
    ]),
  })
  assert.ok(result.rows.every((row) => row.documents.length === 0 && row.status === 'missing'))
  assert.deepEqual(result.unassigned[0].hints.sort(), ['a', 'b'])
})

test('ręczny wpis z numerem, którego nie ma w KSeF, zostaje — i jest pokazany', () => {
  const invoice = sale('1/07/2026', { netAmount: 1500, counterpartyName: 'Polski Holding Hotelowy' })
  const result = run({
    projects: [project('phh', 'Polski Holding Hotelowy')],
    invoices: [invoice],
    events: [invoiceEvent('phh', '2026-07-03', { number: '1/07/2026' }), invoiceEvent('phh', '2026-07-10', { number: 'X/1' })],
    expected: new Map([['phh', 1500]]),
  })
  assert.equal(rowOf(result, 'phh')?.extraHubInvoices.length, 1)
})

test('zastosowanie: nowe wartości, stare zostają w śladzie', () => {
  const event = invoiceEvent('reformat', '2026-02-18', { number: '1/02/2026', amountNetto: 300 })
  const next = applyEventUpdate(
    event,
    { kind: 'update', eventId: event.id, ksefNumber: 'K-1', fields: [{ field: 'start', before: '2026-02-18', after: '2026-02-23' }, { field: 'data.dueDate', before: undefined, after: '2026-03-23' }] },
    '2026-11-13T10:00:00.000Z',
  )
  assert.equal(next.start, '2026-02-23')
  assert.equal(next.data.dueDate, '2026-03-23')
  const trace = (next.updatedFrom as { ref: string; before: Record<string, unknown> }[])[0]
  assert.equal(trace.ref, 'ksef:K-1')
  assert.equal(trace.before.start, '2026-02-18')
})

test('korekta bez znanej faktury jest osobnym dokumentem', () => {
  const orphan = sale('1/KOR/08/2026', { isCorrection: true, netAmount: 0, details: { dueDate: '', lines: [], correctedKsefNumber: 'nieznany', correctedNumber: '' } })
  assert.equal(ksefDocuments([orphan]).length, 1)
})

test('kopia KSeF: zapis i odczyt, uszkodzona faktura odpada', () => {
  const file = ksefCacheFile({ fetchedAt: 'x', environment: 'prod', nip: '9591756851', from: '2026-02-01', invoices: [sale('1/02/2026')] })
  const parsed = parseKsefCache(JSON.parse(JSON.stringify({ ...file, invoices: [...file.invoices, { bad: true }] })))
  assert.equal(parsed?.invoices.length, 1)
  assert.equal(parseKsefCache({ format: 'inny' }), null)
})

test('„Scal nazwy" przenosi dane z faktur na nową nazwę wyświetlaną', () => {
  const details: ClientDetails[] = [{ id: 'Nip:1', client: 'Hotshotz', legalName: 'POLECAM Piotr Serbin', nip: '1', updatedAt: '' }]
  assert.equal(renameDetails(details, ['hotshotz'], 'Piotrek', 'now')[0].client, 'Piotrek')
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
  const ALLOWED = new Set(['scripts/ksef-test-env.mts', 'lib/ksef.test.ts', 'lib/ksef-reconcile.test.ts'])
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
