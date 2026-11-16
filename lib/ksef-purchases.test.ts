import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { KsefInvoiceLine, KsefSale } from './ksef-invoices'
import {
  categoryDecision,
  invoiceRef,
  invoicesCoverItem,
  lineAmounts,
  lineBucket,
  linkLine,
  newItemFromLine,
  priceFromInvoices,
  purchaseBook,
  purchaseTotals,
  suggestedItems,
  unlinkLine,
} from './ksef-purchases'
import type { KsefDecision } from './ksef-reconcile'
import type { EquipmentItem } from './project-types'
import { purchaseVatDecisionId } from './taxes'

// Sprzedawcy, numery i kwoty zmyślone; układ wierszy jak w prawdziwych fakturach z KSeF.

const line = (name: string, quantity: number, amounts: Partial<KsefInvoiceLine> = {}): KsefInvoiceLine => ({
  name,
  unit: 'szt',
  quantity,
  unitPriceNet: null,
  unitPriceGross: null,
  amountNet: null,
  amountGross: null,
  vatRate: '23',
  ...amounts,
})

let seq = 0
const purchase = (over: Partial<KsefSale> & { lines?: KsefInvoiceLine[]; corrects?: string }): KsefSale => {
  seq += 1
  const { lines = [], corrects = '', ...rest } = over
  return {
    ksefNumber: `1111111111-20260801-AAAA${String(seq).padStart(4, '0')}-00`,
    invoiceNumber: `FS ${seq}/2026`,
    direction: 'purchase',
    issueDate: '2026-08-10',
    ksefDate: '2026-08-10',
    counterpartyName: 'SKLEP FILMOWY TESTOWY SP. Z O.O.',
    counterpartyNip: '1111111111',
    counterpartyId: 'Nip:1111111111',
    netAmount: 0,
    grossAmount: 0,
    vatAmount: 0,
    currency: 'PLN',
    invoiceType: 'Vat',
    isCorrection: false,
    details: { dueDate: '', lines, correctedKsefNumber: corrects, correctedNumber: '' },
    ...rest,
  }
}

const item = (over: Partial<EquipmentItem>): EquipmentItem => ({
  id: 'eq-1',
  name: 'Lampa testowa',
  category: 'swiatlo',
  purchasePrice: 0,
  rentalDayRate: 0,
  purchaseDate: '',
  notes: '',
  ...over,
})

const book = (invoices: KsefSale[], decisions: KsefDecision[] = [], items: EquipmentItem[] = []) => purchaseBook({ invoices, decisions, items })

test('wiersz podany tylko brutto jest przeliczany na netto stawką z faktury', () => {
  assert.deepEqual(lineAmounts(line('Statyw', 1, { unitPriceGross: 2460, amountGross: 2460 })), { net: 2000, gross: 2460, quantity: 1 })
  assert.deepEqual(lineAmounts(line('Usługa', 2, { unitPriceNet: 100, amountNet: 200 })), { net: 200, gross: 246, quantity: 2 })
  assert.deepEqual(lineAmounts(line('Bez stawki', 1, { amountNet: 50, vatRate: 'zw' })), { net: 50, gross: 50, quantity: 1 })
})

test('faktura na kilka rzeczy daje osobne wiersze do decyzji; sprzedaż nie wchodzi do spisu', () => {
  const invoice = purchase({ netAmount: 600, grossAmount: 738, lines: [line('Klatka do kamery', 1, { amountGross: 615 }), line('Zestaw akumulatorów', 1, { amountGross: 123 })] })
  const sale = purchase({ direction: 'sale', lines: [line('Film', 1, { amountNet: 5000 })] })
  const entries = book([invoice, sale])
  assert.equal(entries.length, 1)
  assert.deepEqual(
    entries[0].lines.map((l) => [l.name, l.cost, l.status.kind]),
    [
      ['Klatka do kamery', 500, 'todo'],
      ['Zestaw akumulatorów', 100, 'todo'],
    ]
  )
  assert.equal(entries[0].todo, 2)
  assert.equal(entries[0].cost, 600)
})

test('wysyłka nie jest osobnym wierszem: rozkłada się na resztę faktury proporcjonalnie do wartości', () => {
  const invoice = purchase({
    netAmount: 930,
    lines: [line('Statyw oświetleniowy', 2, { unitPriceNet: 300, amountNet: 600 }), line('Blenda', 1, { amountNet: 300 }), line('Koszt wysyłki', 1, { amountNet: 30 })],
  })
  const [entry] = book([invoice])
  assert.deepEqual(
    entry.lines.map((l) => [l.name, l.cost, l.shipping]),
    [
      ['Statyw oświetleniowy', 620, 20],
      ['Blenda', 310, 10],
    ]
  )
  assert.equal(entry.cost, 930)
  // Darmowa wysyłka znika bez śladu.
  const free = purchase({ lines: [line('Mikrofon', 1, { amountNet: 400 }), line('Koszty wysylki', 1, { amountNet: 0 })] })
  assert.deepEqual(book([free])[0].lines.map((l) => [l.name, l.cost]), [['Mikrofon', 400]])
  // Faktura za samą przesyłkę zostaje zwykłym wierszem.
  const courier = purchase({ lines: [line('Przesyłka kurierska', 1, { amountNet: 25 })] })
  assert.deepEqual(book([courier])[0].lines.map((l) => [l.name, l.cost]), [['Przesyłka kurierska', 25]])
})

test('korekta ze zwrotem zeruje wiersz faktury pierwotnej i nie stoi jako osobna faktura', () => {
  const original = purchase({
    netAmount: 600,
    grossAmount: 738,
    lines: [line('Płyta montażowa', 1, { unitPriceGross: 615, amountGross: 615 }), line('Zestaw akumulatorów', 1, { unitPriceGross: 123, amountGross: 123 })],
  })
  const correction = purchase({
    isCorrection: true,
    issueDate: '2026-09-08',
    netAmount: -500,
    grossAmount: -615,
    corrects: original.ksefNumber,
    lines: [line('Płyta montażowa', 1, { unitPriceGross: 615, amountGross: 615 }), line('Płyta montażowa', 0, { unitPriceGross: 615, amountGross: 0 })],
  })
  const entries = book([original, correction])
  assert.equal(entries.length, 1)
  const [returned, kept] = entries[0].lines
  assert.deepEqual([returned.cost, returned.quantity, returned.returned], [0, 0, true])
  assert.deepEqual([kept.cost, kept.returned], [100, false])
  assert.equal(entries[0].todo, 1)
  assert.equal(entries[0].corrections.length, 1)
  assert.equal(entries[0].cost, 100)
})

test('korekta samą różnicą obniża wiersz; korekta, której nie da się rozłożyć, zostaje osobną fakturą', () => {
  const original = purchase({ netAmount: 1000, lines: [line('Wynajem studia', 4, { unitPriceNet: 250, amountNet: 1000 })] })
  const rebate = purchase({ isCorrection: true, netAmount: -250, corrects: original.ksefNumber, lines: [line('Wynajem studia', 1, { unitPriceNet: -250, amountNet: -250 })] })
  const [entry] = book([original, rebate])
  assert.deepEqual([entry.lines[0].cost, entry.lines[0].quantity, entry.lines[0].returned], [750, 3, false])

  const odd = purchase({ isCorrection: true, netAmount: -90, corrects: original.ksefNumber, lines: [line('Rabat posprzedażowy', 1, { amountNet: -90 })] })
  const entries = book([original, odd])
  assert.equal(entries.length, 2)
  assert.equal(entries.find((e) => e.invoice.ksefNumber === odd.ksefNumber)?.looseCorrection, true)
  assert.equal(entries.find((e) => e.invoice.ksefNumber === original.ksefNumber)?.lines[0].cost, 1000)
})

test('przed czerwcem 2026 kosztem jest brutto, od czerwca netto', () => {
  const lines = [line('Usługa księgowa', 1, { amountNet: 300 })]
  assert.equal(book([purchase({ issueDate: '2026-05-31', lines })])[0].lines[0].cost, 369)
  assert.equal(book([purchase({ issueDate: '2026-06-01', lines })])[0].lines[0].cost, 300)
})

test('status wiersza: sprzęt > nie dotyczy firmy > wiersz > faktura > sprzedawca > paliwo', () => {
  const invoice = purchase({ lines: [line('Kabel HDMI', 1, { amountNet: 40 }), line('Papier do drukarki', 1, { amountNet: 20 })] })
  const fuel = purchase({ counterpartyNip: '2222222222', lines: [line('EFECTA 95', 40, { amountNet: 200 })] })
  const at = '2026-11-16T10:00:00.000Z'
  const base = book([invoice, fuel])
  const entry = base.find((e) => e.invoice.ksefNumber === invoice.ksefNumber)!
  const statusOf = (decisions: KsefDecision[], items: EquipmentItem[] = []) =>
    book([invoice, fuel], decisions, items)
      .find((e) => e.invoice.ksefNumber === invoice.ksefNumber)!
      .lines.map((l) => (l.status.kind === 'category' ? `${l.status.category}/${l.status.source}` : l.status.kind))

  assert.deepEqual(statusOf([]), ['todo', 'todo'])
  const fuelLine = base.find((e) => e.invoice.ksefNumber === fuel.ksefNumber)!.lines[0]
  assert.deepEqual(fuelLine.status, { kind: 'category', category: 'fuel', source: 'rule' })

  const seller = categoryDecision('seller', entry, null, 'office', at)
  assert.equal(seller.id, 'cat-seller:1111111111')
  assert.deepEqual(statusOf([seller]), ['office/seller', 'office/seller'])
  const whole = categoryDecision('invoice', entry, null, 'project', at)
  assert.deepEqual(statusOf([seller, whole]), ['project/invoice', 'project/invoice'])
  const one = categoryDecision('line', entry, entry.lines[1], 'other', at)
  assert.deepEqual(statusOf([seller, whole, one]), ['project/invoice', 'other/line'])
  const notFirm: KsefDecision = { id: purchaseVatDecisionId(invoice.ksefNumber), kind: 'purchase_vat', projectId: '', ksefNumber: invoice.ksefNumber, amount: 0, at }
  assert.deepEqual(statusOf([seller, whole, one, notFirm]), ['private', 'private'])
  const cable = item({ id: 'eq-kabel', name: 'Kabel HDMI', onSet: false, purchaseInvoices: [invoiceRef(entry, entry.lines[0])] })
  assert.deepEqual(statusOf([notFirm], [cable]), ['gear', 'private'])
  // Połowa VAT (paliwo) to nie „nie dotyczy firmy".
  assert.deepEqual(statusOf([{ ...notFirm, amount: 50 }]), ['todo', 'todo'])
})

test('nowa pozycja z wiersza: nazwa, data, cena za sztukę netto, sztuki i ślad faktury', () => {
  const invoice = purchase({
    issueDate: '2026-10-19',
    lines: [line('Statyw  oświetleniowy 3 m', 2, { unitPriceNet: 400, amountNet: 800 }), line('Koszt wysyłki', 1, { amountNet: 20 })],
  })
  const [entry] = book([invoice])
  const created = newItemFromLine(entry, entry.lines[0], false)
  assert.deepEqual(
    { ...created, purchaseInvoices: undefined },
    { name: 'Statyw oświetleniowy 3 m', category: 'inne', purchasePrice: 410, quantity: 2, purchaseDate: '2026-10-19', onSet: false, purchaseInvoices: undefined }
  )
  assert.deepEqual(created.purchaseInvoices, [
    { ksefNumber: invoice.ksefNumber, line: 0, number: invoice.invoiceNumber, seller: invoice.counterpartyName, date: '2026-10-19', quantity: 2, net: 820 },
  ])
  // Ułamkowa ilość (godziny, litry) = jedna sztuka z całą kwotą.
  const hours = purchase({ lines: [line('Montaż', 9.2, { unitPriceNet: 80, amountNet: 736 })] })
  const [hoursEntry] = book([hours])
  assert.deepEqual([newItemFromLine(hoursEntry, hoursEntry.lines[0], true).quantity, newItemFromLine(hoursEntry, hoursEntry.lines[0], true).purchasePrice], [1, 736])
})

test('połączenie z istniejącą pozycją: sama faktura jako ślad albo cena i data z faktury', () => {
  const invoice = purchase({ issueDate: '2026-10-27', lines: [line('Statyw wideo Carbon', 1, { unitPriceGross: 2460, amountGross: 2460 })] })
  const [entry] = book([invoice])
  const tripod = item({ id: 'eq-statyw', name: 'Statyw Carbon', purchasePrice: 2460, purchaseDate: '2026-10-25' })

  const traced = linkLine(tripod, entry, entry.lines[0], false)
  assert.deepEqual([traced.purchasePrice, traced.purchaseDate, traced.purchaseInvoices?.length], [2460, '2026-10-25', 1])
  const adopted = linkLine(tripod, entry, entry.lines[0], true)
  assert.deepEqual([adopted.purchasePrice, adopted.purchaseDate], [2000, '2026-10-27'])
  // Drugie kliknięcie nie dubluje śladu.
  assert.equal(linkLine(adopted, entry, entry.lines[0], true).purchaseInvoices?.length, 1)
  assert.equal(book([invoice], [], [adopted])[0].lines[0].status.kind, 'gear')
  assert.equal(book([invoice], [], [adopted])[0].todo, 0)

  const back = unlinkLine(adopted, entry.lines[0].key)
  assert.equal(back.purchaseInvoices, undefined)
  assert.equal(back.purchasePrice, 2000)
  assert.equal(book([invoice], [], [back])[0].todo, 1)
})

test('ten sam sprzęt z dwóch faktur: jedna pozycja, cena średnia, najwcześniejsza data', () => {
  const first = purchase({ issueDate: '2026-10-19', lines: [line('Statyw Master', 1, { amountNet: 400 })] })
  const second = purchase({ issueDate: '2026-10-21', lines: [line('Statyw Master', 2, { unitPriceNet: 440, amountNet: 880 }), line('Kurier', 1, { amountNet: 20 })] })
  const entries = book([first, second])
  const a = entries.find((e) => e.invoice.ksefNumber === first.ksefNumber)!
  const b = entries.find((e) => e.invoice.ksefNumber === second.ksefNumber)!
  let stand = item({ id: 'eq-master', name: 'Statyw Master', quantity: 3, onSet: false })
  assert.equal(invoicesCoverItem(stand, 1), false)
  stand = linkLine(stand, a, a.lines[0], true)
  stand = linkLine(stand, b, b.lines[0], true)
  assert.deepEqual(priceFromInvoices(stand), { price: 433.33, date: '2026-10-19', units: 3 })
  assert.deepEqual([stand.purchasePrice, stand.purchaseDate, invoicesCoverItem(stand)], [433.33, '2026-10-19', true])
  const after = book([first, second], [], [stand])
  assert.deepEqual(after.map((e) => e.todo), [0, 0])
  assert.equal(lineBucket(after[0].lines[0]), 'backstage')
})

test('podpowiedź pozycji: dwa wspólne słowa albo cena (także brutto) przy zbliżonej dacie; jedno słowo i inny czas nie wystarczą', () => {
  const invoice = purchase({ issueDate: '2026-10-27', lines: [line('SmallBrand 5755 Tribex Carbon statyw', 1, { unitPriceGross: 2460, amountGross: 2460 })] })
  const [entry] = book([invoice])
  const gross = item({ id: 'eq-a', name: 'Statyw Tribex', purchasePrice: 2460, purchaseDate: '2026-10-27' })
  const samePriceNoName = item({ id: 'eq-b', name: 'Monitor', purchasePrice: 2000, purchaseDate: '2026-10-20' })
  const undatedByName = item({ id: 'eq-c', name: 'Statyw Carbon zapasowy', purchasePrice: 700 })
  const oneWord = item({ id: 'eq-g', name: 'Głowica Carbon', purchasePrice: 700, purchaseDate: '2026-10-25' })
  const undatedByPrice = item({ id: 'eq-d', name: 'Obiektyw 85', purchasePrice: 2000 })
  const old = item({ id: 'eq-e', name: 'Statyw Carbon stary', purchasePrice: 2000, purchaseDate: '2020-01-01' })
  const unrelated = item({ id: 'eq-f', name: 'Dron', purchasePrice: 6000, purchaseDate: '2026-10-20' })
  assert.deepEqual(
    suggestedItems(entry, entry.lines[0], [unrelated, old, oneWord, undatedByPrice, undatedByName, samePriceNoName, gross]).map((i) => i.id),
    ['eq-a', 'eq-b', 'eq-c']
  )
  // Pozycja już przypięta do tego wiersza nie jest podpowiadana drugi raz.
  const linked = linkLine(gross, entry, entry.lines[0], false)
  assert.deepEqual(suggestedItems(entry, entry.lines[0], [linked, unrelated]).map((i) => i.id), [])
})

test('podsumowanie wg worków: sprzęt, kategorie, do decyzji; „nie dotyczy firmy" poza sumą firmy, paliwo w połowie', () => {
  const gear = purchase({ lines: [line('Lampa LED', 1, { amountNet: 1800 }), line('Karta pamięci', 1, { amountNet: 800 })] })
  const fuel = purchase({ counterpartyNip: '2222222222', lines: [line('Shell FuelSave PB 95', 60, { amountNet: 390 })] })
  const home = purchase({ counterpartyNip: '3333333333', lines: [line('Żarówki', 1, { amountNet: 50 })] })
  const rent = purchase({ counterpartyNip: '4444444444', lines: [line('Wynajem sprzętu filmowego', 1, { amountNet: 700 })] })
  const at = '2026-11-16T10:00:00.000Z'
  const base = book([gear, fuel, home, rent])
  const gearEntry = base.find((e) => e.invoice.ksefNumber === gear.ksefNumber)!
  const rentEntry = base.find((e) => e.invoice.ksefNumber === rent.ksefNumber)!
  const lamp = item({ id: 'eq-lampa', purchaseInvoices: [invoiceRef(gearEntry, gearEntry.lines[0])] })
  const decisions: KsefDecision[] = [
    categoryDecision('invoice', rentEntry, null, 'project', at),
    { id: purchaseVatDecisionId(home.ksefNumber), kind: 'purchase_vat', projectId: '', ksefNumber: home.ksefNumber, amount: 0, at },
  ]
  const totals = purchaseTotals(book([gear, fuel, home, rent], decisions, [lamp]))
  assert.deepEqual(totals.byBucket, { gear: 1800, todo: 800, fuel: 390, private: 50, project: 700 })
  // Paliwo wchodzi do wydatków firmy w połowie.
  assert.equal(totals.company, 3495)
  assert.equal(totals.todo, 1)
  assert.equal(totals.invoices, 4)
})

test('faktura bez pobranych pozycji stoi jednym wierszem z kwotą faktury', () => {
  const pending = purchase({ netAmount: 120, grossAmount: 147.6, hasDetails: false })
  const [entry] = book([pending])
  assert.deepEqual([entry.lines.length, entry.lines[0].cost, entry.lines[0].name], [1, 120, 'Pozycje jeszcze niepobrane'])
})
