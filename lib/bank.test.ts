import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyPaymentUpdate, invoiceNumbersIn, matchPayments, payableInvoices, payerMatches, paymentChanges, paymentView, type PayableInvoice } from './bank-match'
import { bankCopyFile, decodeBankFile, EMPTY_BANK, mergeBankFile, parseBankCopy, parseMbankList, BankFileError, type BankCopy, type BankOperation } from './bank-statement'
import type { TimelineEvent } from './event-types'
import type { KsefSale } from './ksef-invoices'
import { ksefDocuments, type KsefDecision } from './ksef-reconcile'
import { isFuelInvoice, outsideSales, purchaseVatDecisionId, taxSummary, vatInGross, zusCheck, zusOnlyInBank } from './taxes'

// ── Plik z mBanku (układ jak w prawdziwym eksporcie; nazwy i rachunki zmyślone) ──

const HEADER = [
  'mBank S.A. Bankowość Detaliczna;',
  '',
  '#Klient;',
  'JAN TESTOWY FIRMA;',
  '',
  '#Za okres:;',
  '01.06.2026;30.11.2026;',
  '',
  '#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;',
]
const row = (date: string, description: string, amount: string, category = 'Wpływy - inne', account = 'mBiznes konto Standard 0000 ... 0001') =>
  `${date};"${description}";"${account}";"${category}";${amount};;`

const FILE = [
  ...HEADER,
  row('2026-11-12', 'URZĄD SKARBOWY, VAT                 CENTRUM ROZLICZENIOWE   PRZELEW PODATKOWY      10000000000000000000000001  ', '-6 150,00 PLN', 'Podatki - inne'),
  row('2026-11-12', 'PP/PRZELEW VAT PRZYCH. WŁASNY US  FIRMA      10000000000000000000000002  ', '2 500,10 PLN', 'Przelew własny'),
  row('2026-11-12', 'URZĄD SKARBOWY, PPE         CENTRUM ROZLICZENIOWE     PRZELEW PODATKOWY     10000000000000000000000001  ', '-3 000,00 PLN', 'Podatki - inne'),
  row('2026-11-10', 'OPŁATA ZA PROWADZENIE RACHUNKU                ', '-19,00 PLN', 'Bez kategorii'),
  row('2026-11-10', 'PP/PRZELEW VAT WYCHODZĄCY TECHN.  FIRMA      10000000000000000000000002  ', '-920,00 PLN', 'Księgowanie VAT'),
  row('2026-11-10', 'PP/PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY  STUDIO OBRAZU ADAM WZOROWY UL. PRZYKŁADOWA 4/56 01-502 WARSZAWA      PP/PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY      10000000000000000000000003  ', '4 920,00 PLN'),
  row('2026-10-30', 'JAN TESTOWY INNY BANK, PRZELEW          PRZELEW ZEWNĘTRZNY WYCHODZĄCY        10000000000000000000000004  ', '-5 000,00 PLN', 'Bez kategorii'),
  row('2026-10-19', 'SZYBKIE PŁATNOŚCI SPÓŁKA AKCYJNA UL. JAKAŚ 6 81-718 SOPOT, /OPF/X///// MT_2610190UNV7I Zapłataza 1-10-2026  SZYBKIE PŁATNOŚCI SPÓŁKA AKCYJNA       PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY     10000000000000000000000005  ', '2 460,00 PLN'),
  row('2026-08-12', 'ZAKŁAD UBEZPIECZEŃ SPOŁECZNYCH           PRZELEW ZEWNĘTRZNY DO ZUS       10000000000000000000000006  ', '-1 400,10 PLN', 'Ubezpieczenia'),
  row('2026-07-24', 'ANNA PRZYKŁADOWA, SESJA DNIA 23/07/2026  UL. INNA 9 M.57     PRZELEW WEWNĘTRZNY PRZYCHODZĄCY      10000000000000000000000007  ', '180,00 PLN'),
  row('2026-07-09', 'URZĄD SKARBOWY, VAT-9M          CENTRUM ROZLICZENIOWE     PRZELEW PODATKOWY     10000000000000000000000001  ', '-300,00 PLN', 'Podatki - inne'),
  row('2026-03-27', 'URZĄD SKARBOWY W MIEŚCIE, PIT-38 PIT-38        PRZELEW PODATKOWY       10000000000000000000000001  ', '-9 000,00 PLN', 'Podatki - inne'),
  row('2026-01-29', 'MUSTER EVENT GMBH, Invoice 1/01/2026, WOO Comp.      PRZELEW SEPA PRZYCHODZĄCY     DE00000000000000000001  ', '500,00 EUR', 'Wpływy - inne', 'mBiznes konto walutowe EUR 0000 ... 0002'),
  row('2026-01-02', 'OPŁATA ZA PROWADZENIE RACHUNKU                ', '-2,44 EUR', 'Bez kategorii', 'mBiznes konto walutowe EUR 0000 ... 0002'),
  row('2026-01-02', 'OPŁATA ZA PROWADZENIE RACHUNKU                ', '-2,44 EUR', 'Bez kategorii', 'mBiznes konto walutowe EUR 0000 ... 0002'),
  '',
].join('\r\n')

test('mBank: okres, kwoty ze spacją i przecinkiem, rodzaj każdej operacji', () => {
  const file = parseMbankList(decodeBankFile(new TextEncoder().encode(`﻿${FILE}`)))
  assert.deepEqual([file.from, file.to], ['2026-06-01', '2026-11-30'])
  assert.equal(file.operations.length, 15)
  const kindOf = (fragment: string) => file.operations.find((operation) => operation.description.includes(fragment))?.kind
  assert.equal(kindOf('URZĄD SKARBOWY, VAT CENTRUM'), 'tax_vat')
  assert.equal(kindOf('URZĄD SKARBOWY, PPE'), 'tax_flat')
  assert.equal(kindOf('VAT PRZYCH. WŁASNY'), 'internal')
  assert.equal(kindOf('VAT WYCHODZĄCY TECHN'), 'internal')
  assert.equal(kindOf('STUDIO OBRAZU'), 'income')
  assert.equal(kindOf('ZAKŁAD UBEZPIECZEŃ'), 'zus')
  // Poza hubem: przelew na własne konto, VAT-9M i prywatny PIT-38.
  assert.equal(kindOf('INNY BANK'), 'outside')
  assert.equal(kindOf('VAT-9M'), 'outside')
  assert.equal(kindOf('PIT-38'), 'outside')
  const studio = file.operations.find((operation) => operation.description.includes('STUDIO OBRAZU'))!
  assert.deepEqual([studio.amount, studio.currency, studio.counterAccount], [4920, 'PLN', '10000000000000000000000003'])
  assert.equal(file.operations.find((operation) => operation.currency === 'EUR' && operation.amount > 0)?.counterAccount, 'DE00000000000000000001')
})

test('mBank: dwie identyczne opłaty jednego dnia to dwie operacje, a ponowne wczytanie niczego nie dubluje', () => {
  const file = parseMbankList(FILE)
  const fees = file.operations.filter((operation) => operation.date === '2026-01-02')
  assert.equal(new Set(fees.map((operation) => operation.id)).size, 2)
  const first = mergeBankFile(EMPTY_BANK, file, 'a.csv', '2026-11-14T10:00:00Z')
  const second = mergeBankFile(first.copy, parseMbankList(FILE), 'b.csv', '2026-11-15T10:00:00Z')
  assert.deepEqual([first.added, second.added, second.copy.operations.length, second.copy.imports.length], [15, 0, 15, 2])
  assert.equal(parseBankCopy(JSON.parse(JSON.stringify(bankCopyFile(second.copy))))?.operations.length, 15)
})

test('inny plik niż lista operacji mBanku: jasny błąd', () => {
  assert.throws(() => parseMbankList('Data;Kwota\n2026-01-01;10'), BankFileError)
})

// ── Dopasowanie wpłat ────────────────────────────────────────────────────────

const invoice = (number: string, payer: string, gross: number, issueDate: string, patch: Partial<PayableInvoice> = {}): PayableInvoice => ({
  key: `K-${number}`,
  number,
  payer,
  gross,
  currency: 'PLN',
  issueDate,
  dueDate: '',
  ...patch,
})
let counter = 0
const income = (date: string, description: string, amount: number, patch: Partial<BankOperation> = {}): BankOperation => ({
  id: `op-${(counter += 1)}`,
  date,
  description,
  account: 'konto',
  category: '',
  amount,
  currency: 'PLN',
  kind: 'income',
  counterAccount: '',
  ...patch,
})
const match = (invoices: PayableInvoice[], operations: BankOperation[], decisions: KsefDecision[] = []) => matchPayments({ invoices, operations, decisions })
const decision = (patch: Partial<KsefDecision> & Pick<KsefDecision, 'id' | 'kind'>): KsefDecision => ({ projectId: '', at: '', ...patch })

test('numer faktury w tytule: także z myślnikami; data sesji „23/07/2026" to nie faktura 3/07/2026', () => {
  assert.deepEqual(invoiceNumbersIn('Zapłataza 1-10-2026'), ['1/10/2026'])
  assert.deepEqual(invoiceNumbersIn('F-ra 1/03/2026 1/03/2026'), ['1/03/2026', '1/03/2026'])
  assert.deepEqual(invoiceNumbersIn('SESJA DNIA 23/07/2026'), ['23/07/2026'])
  assert.deepEqual(invoiceNumbersIn('sesja z dnia 26.05.2026'), [])

  const result = match(
    [invoice('3/07/2026', 'AB GROUP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', 9840, '2026-07-28')],
    [income('2026-07-24', 'ANNA PRZYKŁADOWA, SESJA DNIA 23/07/2026', 180), income('2026-09-01', 'PP/PRZELEW WEWNĘTRZNY PRZYCHODZĄCY AB GROUP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ UL. X', 9840)],
  )
  const payment = result.byInvoice.get('K-3/07/2026')!
  assert.deepEqual([payment.state, payment.paidDate, payment.operations[0].reason], ['paid', '2026-09-01', 'payer_amount'])
  assert.equal(result.unmatched.length, 1)
})

test('numer w tytule od pośrednika płatności (inna nazwa, ta sama kwota)', () => {
  const result = match(
    [invoice('1/10/2026', 'Studio Obrazu Adam Wzorowy', 2460, '2026-10-08')],
    [income('2026-10-19', 'SZYBKIE PŁATNOŚCI SPÓŁKA AKCYJNA, /OPF/X Zapłataza 1-10-2026', 2460)],
  )
  assert.equal(result.byInvoice.get('K-1/10/2026')!.operations[0].reason, 'number')
})

test('ten sam numer w tytule, obcy płatnik i inna kwota: nie ruszamy', () => {
  const result = match([invoice('9/04/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-04-01')], [income('2026-04-09', 'ANNA PRZYKŁADOWA, SESJA DNIA 9/04/2026', 180)])
  assert.equal(result.byInvoice.get('K-9/04/2026')!.state, 'unpaid')
})

test('płatnik: forma prawna, cudzysłowy i „&" nie przeszkadzają; samo pierwsze słowo tylko bez trybu ścisłego', () => {
  assert.equal(payerMatches('PP/PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY Adams & Brown Broker Spółka z ograniczoną odpowiedzialnością Spółka KWidok 8', '"ADAMS & BROWN" BROKER SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWA', true), true)
  assert.equal(payerMatches("'ABC' SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ NOWA WIEŚ 11", '"ABC" SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', true), true)
  assert.equal(payerMatches('Daniel und Edyta Inni, sesja', 'DANIEL KOWALSKI', true), false)
  assert.equal(payerMatches('Daniel und Edyta Inni, sesja', 'DANIEL KOWALSKI', false), true)
})

test('dwie faktury tej samej firmy na tę samą kwotę: wpłaty po kolei, starsza faktura pierwsza', () => {
  const result = match(
    [invoice('1/09/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-09-01'), invoice('1/10/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-10-01')],
    [income('2026-09-20', 'FIRMA ALFA SP. Z O.O. przelew', 1230)],
  )
  assert.deepEqual([result.byInvoice.get('K-1/09/2026')!.state, result.byInvoice.get('K-1/10/2026')!.state], ['paid', 'unpaid'])
})

test('jeden przelew za dwie faktury tej samej firmy', () => {
  const result = match(
    [invoice('1/09/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-09-01'), invoice('2/09/2026', 'Firma Alfa sp. z o.o.', 615, '2026-09-10'), invoice('3/09/2026', 'Firma Alfa sp. z o.o.', 999, '2026-09-12')],
    [income('2026-09-30', 'FIRMA ALFA SP. Z O.O. za wrzesień', 1845)],
  )
  assert.deepEqual(['1/09/2026', '2/09/2026', '3/09/2026'].map((n) => result.byInvoice.get(`K-${n}`)!.state), ['paid', 'paid', 'unpaid'])
  assert.equal(result.byInvoice.get('K-2/09/2026')!.operations[0].reason, 'sum')
  assert.equal(result.unmatched.length, 0)
})

test('wpłata częściowa z numerem faktury, potem dopłata', () => {
  const invoices = [invoice('1/09/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-09-01')]
  const part = income('2026-09-10', 'FIRMA ALFA SP. Z O.O. zaliczka FV 1/09/2026', 500)
  const half = match(invoices, [part]).byInvoice.get('K-1/09/2026')!
  assert.deepEqual([half.state, half.paidGross], ['partial', 500])
  assert.deepEqual(paymentView(half, '2026-09-15', '2026-09-30'), { state: 'partial', paid: 500, left: 730, day: '2026-09-10' })
  const full = match(invoices, [part, income('2026-09-20', 'FIRMA ALFA SP. Z O.O. reszta', 730)]).byInvoice.get('K-1/09/2026')!
  assert.deepEqual([full.state, full.paidDate], ['paid', '2026-09-20'])
})

test('sama kwota: podpowiedź tylko przy jednej fakturze i jednym przelewie, niepewna', () => {
  const invoices = [invoice('1/09/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-09-01')]
  const alone = match(invoices, [income('2026-09-20', 'JAN NOWAK przelew', 1230)]).byInvoice.get('K-1/09/2026')!
  assert.deepEqual([alone.state, alone.confident, alone.operations[0].reason], ['paid', false, 'amount_only'])
  const twoTransfers = match(invoices, [income('2026-09-20', 'JAN NOWAK przelew', 1230), income('2026-09-21', 'EWA NOWAK przelew', 1230)])
  assert.equal(twoTransfers.byInvoice.get('K-1/09/2026')!.state, 'unpaid')
  assert.equal(twoTransfers.unmatched.length, 2)
})

test('waluta: wpłata w EUR pasuje tylko do faktury w EUR (kwota po korekcie)', () => {
  const sale = (patch: Partial<KsefSale>): KsefSale => ({
    ksefNumber: 'K-2/11/2026',
    invoiceNumber: '2/11/2026',
    direction: 'sale',
    issueDate: '2026-11-12',
    ksefDate: '2026-11-12',
    counterpartyName: 'Kaffee GmbH',
    counterpartyNip: '',
    counterpartyId: '',
    netAmount: 1000,
    grossAmount: 1230,
    vatAmount: 990.12,
    currency: 'EUR',
    invoiceType: 'Vat',
    isCorrection: false,
    details: { dueDate: '2026-11-26', lines: [], correctedKsefNumber: '', correctedNumber: '' },
    ...patch,
  })
  const correction = sale({ ksefNumber: 'K-KOR', invoiceNumber: '1/KOR/11/2026', isCorrection: true, netAmount: 0, grossAmount: -230, vatAmount: -990.12, details: { dueDate: '', lines: [], correctedKsefNumber: 'K-2/11/2026', correctedNumber: '2/11/2026' } })
  const invoices = payableInvoices(ksefDocuments([sale({}), correction]))
  assert.deepEqual([invoices.length, invoices[0].gross], [1, 1000])
  assert.equal(match(invoices, [income('2026-11-20', 'KAFFEE GMBH invoice', 1000)]).byInvoice.get('K-2/11/2026')!.state, 'unpaid')
  assert.equal(match(invoices, [income('2026-11-20', 'KAFFEE GMBH invoice', 1000, { currency: 'EUR' })]).byInvoice.get('K-2/11/2026')!.state, 'paid')
})

test('decyzje: wskazana faktura, „to nie zapłata faktury", pominięta wpłata i pomijany nadawca', () => {
  const invoices = [invoice('1/09/2026', 'Firma Alfa sp. z o.o.', 1230, '2026-09-01')]
  const odd = income('2026-09-20', 'ZUPEŁNIE INNA FIRMA', 1000)
  const assigned = match(invoices, [odd], [decision({ id: `bank:${odd.id}`, kind: 'bank_assign', ksefNumber: 'K-1/09/2026' })])
  assert.deepEqual([assigned.byInvoice.get('K-1/09/2026')!.state, assigned.byInvoice.get('K-1/09/2026')!.operations[0].reason], ['partial', 'decision'])

  const exact = income('2026-09-21', 'FIRMA ALFA SP. Z O.O.', 1230)
  const detached = match(invoices, [exact], [decision({ id: `bank:${exact.id}`, kind: 'bank_assign', ksefNumber: '' })])
  assert.deepEqual([detached.byInvoice.get('K-1/09/2026')!.state, detached.unmatched.length], ['unpaid', 1])

  const session = income('2026-09-22', 'ANNA PRZYKŁADOWA, SESJA', 180, { counterAccount: '10000000000000000000000007' })
  const other = income('2026-09-23', 'KTOŚ INNY', 50)
  const ignored = match(invoices, [session, other], [
    decision({ id: 'sender:10000000000000000000000007', kind: 'bank_sender' }),
    decision({ id: `bank:${other.id}`, kind: 'bank_ignore' }),
  ])
  assert.deepEqual([ignored.unmatched.length, ignored.ignored], [0, 2])
})

test('stan wpłaty: po terminie liczymy do końca wyciągu; faktura wystawiona po wyciągu jest nieznana', () => {
  const unpaid = (issueDate: string, dueDate: string) => match([invoice('1/09/2026', 'Firma Alfa', 1230, issueDate, { dueDate })], []).byInvoice.get('K-1/09/2026')!
  assert.deepEqual(paymentView(unpaid('2026-09-01', '2026-09-15'), '2026-11-14', '2026-09-30'), { state: 'overdue', daysLate: 15 })
  assert.deepEqual(paymentView(unpaid('2026-11-12', '2026-11-26'), '2026-11-14', '2026-11-13'), { state: 'waiting', daysLeft: 12 })
  assert.deepEqual(paymentView(unpaid('2026-11-20', '2026-12-04'), '2026-11-21', '2026-11-13'), { state: 'unknown' })
  const late = match([invoice('1/03/2026', 'XYZ', 861, '2026-03-05', { dueDate: '2026-04-04' })], [income('2026-08-20', 'XYZ F-ra 1/03/2026', 861)]).byInvoice.get('K-1/03/2026')!
  assert.deepEqual(paymentView(late, '2026-11-14', '2026-11-13'), { state: 'paid', day: '2026-08-20', daysFromIssue: 168, daysLate: 138, confident: true })
})

// ── Zapis wpłat w projektach ─────────────────────────────────────────────────

const ksefSale = (number: string, patch: Partial<KsefSale> = {}): KsefSale => ({
  ksefNumber: `K-${number}`,
  invoiceNumber: number,
  direction: 'sale',
  issueDate: '2026-10-01',
  ksefDate: '2026-10-01',
  counterpartyName: 'Firma Alfa sp. z o.o.',
  counterpartyNip: '1111111111',
  counterpartyId: 'Nip:1111111111',
  netAmount: 1000,
  grossAmount: 1230,
  vatAmount: 230,
  currency: 'PLN',
  invoiceType: 'Vat',
  isCorrection: false,
  details: { dueDate: '2026-10-15', lines: [], correctedKsefNumber: '', correctedNumber: '' },
  ...patch,
})
const paidEvent = (id: string, start: string, data: Record<string, unknown> = {}, projectId = 'p1'): TimelineEvent => ({
  id,
  kind: 'invoice_paid',
  projectId,
  start,
  title: 'Wpłata',
  notes: '',
  data,
  source: { type: 'manual' },
  createdAt: '',
  updatedAt: '',
})

function changesFor(sales: KsefSale[], operations: BankOperation[], events: TimelineEvent[], projectId: string | null = 'p1') {
  const documents = ksefDocuments(sales)
  const payments = match(payableInvoices(documents), operations).byInvoice
  return paymentChanges({ documents: documents.map((document) => ({ document, projectId })), payments, events })
}

test('wpłata z banku poprawia ręczny wpis: dzień z wyciągu, kwota netto, stare wartości w historii', () => {
  const op = income('2026-10-12', 'FIRMA ALFA SP. Z O.O. FV 1/10/2026', 1230)
  const manual = paidEvent('e1', '2026-10-20')
  const changes = changesFor([ksefSale('1/10/2026')], [op], [manual]).get('p1')!
  assert.equal(changes.length, 1)
  assert.equal(changes[0].kind, 'update')
  const updated = applyPaymentUpdate(manual, changes[0] as Extract<(typeof changes)[number], { kind: 'update' }>, '2026-11-14T10:00:00Z')
  assert.equal(updated.start, '2026-10-12')
  assert.deepEqual(
    [updated.data.number, updated.data.amount, updated.data.amountGross, updated.data.ksefNumber, updated.data.bankOperationIds],
    ['1/10/2026', 1000, 1230, 'K-1/10/2026', [op.id]],
  )
  const trace = (updated.updatedFrom as Array<{ type: string; before: Record<string, unknown> }>)[0]
  assert.deepEqual([trace.type, trace.before.start], ['bank', '2026-10-20'])
  // Po zapisie nie ma już nic do zrobienia.
  assert.equal(changesFor([ksefSale('1/10/2026')], [op], [updated]).size, 0)
})

test('brak wpisu w projekcie: wpłata się dopisuje; dwie faktury i dwa wpisy bez numerów dzielą się po kolei', () => {
  const created = changesFor([ksefSale('1/10/2026')], [income('2026-10-12', 'FIRMA ALFA SP. Z O.O.', 1230)], []).get('p1')!
  assert.deepEqual([created[0].kind, created[0].kind === 'create' && created[0].start, created[0].kind === 'create' && created[0].title], ['create', '2026-10-12', 'Wpłata za FV 1/10/2026'])

  const two = changesFor(
    [ksefSale('1/10/2026'), ksefSale('2/10/2026', { netAmount: 500, grossAmount: 615, vatAmount: 115 })],
    [income('2026-10-12', 'FIRMA ALFA SP. Z O.O.', 1230), income('2026-11-02', 'FIRMA ALFA SP. Z O.O.', 615)],
    [paidEvent('late', '2026-11-05'), paidEvent('numbered', '2026-10-30', { number: '2/10/2026' })],
  ).get('p1')!
  assert.deepEqual(two.map((change) => [change.ksefNumber, change.kind === 'update' && change.eventId]), [
    ['K-1/10/2026', 'late'],
    ['K-2/10/2026', 'numbered'],
  ])
})

test('nie zapisujemy: faktury bez projektu, wpłaty częściowej ani dopasowania po samej kwocie', () => {
  assert.equal(changesFor([ksefSale('1/10/2026')], [income('2026-10-12', 'FIRMA ALFA SP. Z O.O.', 1230)], [], null).size, 0)
  assert.equal(changesFor([ksefSale('1/10/2026')], [income('2026-10-12', 'FIRMA ALFA SP. Z O.O. FV 1/10/2026', 500)], []).size, 0)
  assert.equal(changesFor([ksefSale('1/10/2026')], [income('2026-10-12', 'KTOŚ INNY', 1230)], []).size, 0)
})

// ── Podatki ──────────────────────────────────────────────────────────────────

const out = (date: string, kind: BankOperation['kind'], amount: number) => income(date, 'x', -amount, { kind })
const bank = (operations: BankOperation[], from = '2026-01-01', to = '2026-11-13'): BankCopy => ({
  operations,
  imports: [{ name: 'a.csv', importedAt: '', from, to, operations: operations.length }],
})

test('ZUS: potwierdzony przelewem, inna kwota, brak przelewu, inne konto, brak wyciągu', () => {
  const copy = bank([out('2026-08-12', 'zus', 1400.1), out('2026-07-17', 'zus', 1350.2)])
  assert.deepEqual(zusCheck({ month: '2026-08', amount: 1400.1 }, copy), { state: 'confirmed', day: '2026-08-12' })
  assert.deepEqual(zusCheck({ month: '2026-07', amount: 1400.1 }, copy), { state: 'differs', bankAmount: 1350.2, day: '2026-07-17' })
  assert.deepEqual(zusCheck({ month: '2026-09', amount: 1400.1 }, copy), { state: 'missing' })
  assert.deepEqual(zusCheck({ month: '2026-09', amount: 1400.1, paidFrom: 'ERSTE' }, copy), { state: 'elsewhere', account: 'ERSTE' })
  // Listopad: wyciąg kończy się 13.11, więc brak przelewu niczego jeszcze nie znaczy.
  assert.deepEqual(zusCheck({ month: '2026-11', amount: 1400.1 }, copy), { state: 'unknown' })
  assert.deepEqual(zusCheck({ month: '2025-12', amount: 1400.1 }, copy), { state: 'unknown' })
  assert.equal(zusOnlyInBank('2026-08', false, copy), 1400.1)
  assert.equal(zusOnlyInBank('2026-08', true, copy), null)
  assert.equal(zusOnlyInBank('2026-09', false, copy), null)
})

const purchase = (number: string, issueDate: string, vatAmount: number, line = 'Statyw'): KsefSale =>
  ksefSale(number, {
    direction: 'purchase',
    issueDate,
    vatAmount,
    details: { dueDate: '', lines: [{ name: line, unit: 'szt', quantity: 1, unitPriceNet: null, unitPriceGross: null, amountNet: null, amountGross: null, vatRate: '23' }], correctedKsefNumber: '', correctedNumber: '' },
  })

test('paliwo rozpoznawane po pozycji faktury, niezależnie od stacji', () => {
  assert.equal(isFuelInvoice(purchase('a', '2026-07-01', 10, 'EFECTA 95 CN27101245')), true)
  assert.equal(isFuelInvoice(purchase('b', '2026-07-01', 10, 'Shell FuelSave PB 95')), true)
  assert.equal(isFuelInvoice(purchase('c', '2026-07-01', 10, 'Olej napędowy')), true)
  assert.equal(isFuelInvoice(purchase('d', '2026-07-01', 10, 'Monitor podglądowy')), false)
})

test('VAT: przelew z następnego miesiąca rozlicza poprzedni; paliwo w połowie, „nie dotyczy firmy" wcale', () => {
  const copy = bank([
    out('2026-07-17', 'tax_vat', 10100),
    out('2026-07-17', 'tax_flat', 700),
    out('2026-08-12', 'tax_vat', 2000),
    out('2026-06-13', 'tax_flat', 200),
    out('2026-06-13', 'zus', 1400.1),
  ])
  const sales = [ksefSale('2/06/2026', { issueDate: '2026-06-17', vatAmount: 10000 }), ksefSale('1/07/2026', { issueDate: '2026-07-03', vatAmount: 2500 }), ksefSale('1/05/2026', { issueDate: '2026-05-05', vatAmount: 0 })]
  const purchases = [purchase('gear', '2026-07-05', 1000), purchase('fuel', '2026-07-10', 100, 'EFECTA 95'), purchase('private', '2026-07-20', 200)]
  const decisions = [decision({ id: purchaseVatDecisionId('K-private'), kind: 'purchase_vat', amount: 0 })]
  const summary = taxSummary({ months: ['2026-05', '2026-06', '2026-07', '2026-08'], bank: copy, sales, purchases, decisions })

  const [may, june, july, august] = summary.months
  assert.deepEqual([may.vatApplies, may.flatTaxPaid, may.zus], [false, 200, 0])
  assert.deepEqual([june.vatPaid, june.flatTaxPaid, june.zus], [10100, 700, 1400.1])
  assert.deepEqual([july.vatPaid, july.vatPurchases, july.vatDeductible], [2000, 1300, 1050])
  // Wrzesień jest w wyciągu do 25., przelewu VAT nie ma: zero zapłacone, nie „nie wiadomo".
  assert.deepEqual([august.vatPaid, august.flatTaxPaid], [0, 0])
  assert.deepEqual(summary.vat, {
    months: ['2026-06', '2026-07', '2026-08'],
    sales: 12500,
    salesOutside: 0,
    paid: 12100,
    deductedReal: 400,
    deductibleByInvoices: 1050,
    purchasesAll: 1300,
    fuelHalf: 50,
    excluded: 200,
  })
})

test('VAT: miesiąc, którego rozliczenia wyciąg jeszcze nie obejmuje, nie wchodzi do rachunku', () => {
  const copy = bank([out('2026-11-12', 'tax_vat', 6000)])
  const summary = taxSummary({ months: ['2026-10', '2026-11'], bank: copy, sales: [ksefSale('4/10/2026', { issueDate: '2026-10-23', vatAmount: 7000.5 }), ksefSale('3/11/2026', { issueDate: '2026-11-13', vatAmount: 100 })], purchases: [], decisions: [] })
  assert.deepEqual([summary.months[1].vatPaid, summary.months[1].flatTaxPaid], [null, null])
  assert.deepEqual([summary.vat.months, summary.vat.deductedReal], [['2026-10'], 1000.5])
})

test('sesje: wpłaty od pomijanych nadawców to sprzedaż poza KSeF; VAT to 23/123 wpłaty i tylko od czerwca', () => {
  assert.equal(vatInGross(246, '2026-06-11'), 46)
  assert.equal(vatInGross(180, '2026-05-28'), 0)

  const account = '10000000000000000000000007'
  const sessions = [
    income('2026-05-14', 'ANNA PRZYKŁADOWA, SESJA', 180, { counterAccount: account }),
    income('2026-06-12', 'ANNA PRZYKŁADOWA, SESJA', 246, { counterAccount: account }),
    income('2026-07-09', 'ANNA PRZYKŁADOWA, SESJA', 123, { counterAccount: account }),
  ]
  const invoicePayment = income('2026-07-10', 'ANNA PRZYKŁADOWA za fakturę', 615, { counterAccount: account })
  const other = income('2026-07-11', 'KTOŚ INNY', 500, { counterAccount: '10000000000000000000000008' })
  const decisions = [
    decision({ id: `sender:${account}`, kind: 'bank_sender' }),
    decision({ id: `bank:${invoicePayment.id}`, kind: 'bank_assign', ksefNumber: 'K-1/07/2026' }),
    decision({ id: `bank:${other.id}`, kind: 'bank_ignore' }),
  ]
  const operations = [...sessions, invoicePayment, other, out('2026-07-17', 'tax_vat', 9000), out('2026-08-12', 'tax_vat', 2400)]
  // Pojedynczo pominięta wpłata i wpłata wskazana jako zapłata faktury nie są sesjami.
  assert.deepEqual(outsideSales(operations, decisions).map((operation) => operation.amount), [180, 246, 123])

  const summary = taxSummary({
    months: ['2026-05', '2026-06', '2026-07'],
    bank: bank(operations),
    sales: [ksefSale('2/06/2026', { issueDate: '2026-06-17', vatAmount: 9200 }), ksefSale('1/07/2026', { issueDate: '2026-07-03', vatAmount: 2500 })],
    purchases: [],
    decisions,
  })
  assert.deepEqual(summary.months.map((month) => [month.outsideGross, month.vatOutside]), [[180, 0], [246, 46], [123, 23]])
  assert.deepEqual(summary.outside, { count: 3, gross: 549, net: 480, vat: 69 })
  // Odliczone naprawdę: VAT z faktur 11 700 + z sesji 69 − wpłacone 11 400.
  assert.deepEqual([summary.vat.salesOutside, summary.vat.deductedReal], [69, 369])
})
