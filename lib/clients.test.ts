import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClientChoice,
  clientDirectory,
  clientKey,
  clientRevenue,
  hasContact,
  suggestClients,
} from './clients'
import type { Project } from './project-types'

let seq = 0
function project(overrides: Partial<Project> = {}): Project {
  seq += 1
  return {
    id: `p-${seq}`,
    name: `Projekt ${seq}`,
    client: '',
    status: 'quote',
    date: '2026-01-01',
    createdAt: '',
    updatedAt: '',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...overrides,
  }
}

const financials = (sumaNetto: number) => ({
  sumaNetto,
  koszty: 0,
  podatek: 0,
  zysk: sumaNetto,
  marzaPct: 100,
  computedAt: '',
})

test('clientKey: bez spacji na brzegach, wielkości liter i polskich znaków (także ł)', () => {
  assert.equal(clientKey('  Tchibo  '), 'tchibo')
  assert.equal(clientKey('TCHIBO'), 'tchibo')
  assert.equal(clientKey('Żółć Łódź'), 'zolc lodz')
  assert.equal(clientKey('Tchibo   Polska'), 'tchibo polska')
  assert.equal(clientKey('   '), '')
})

test('clientDirectory: różne pisownie to jeden klient, nazwa = najczęstsza pisownia', () => {
  const dir = clientDirectory([
    project({ client: 'Tchibo', date: '2026-03-01' }),
    project({ client: 'tchibo ', date: '2026-05-01' }),
    project({ client: 'Tchibo', date: '2026-02-01' }),
    project({ client: 'Ąbc', date: '2026-01-01' }),
    project({ client: '' }),
  ])
  assert.deepEqual(
    dir.map((c) => [c.name, c.projectCount, c.lastDate]),
    [
      ['Ąbc', 1, '2026-01-01'],
      ['Tchibo', 3, '2026-05-01'],
    ]
  )
})

test('clientDirectory: przy remisie wygrywa pisownia z najnowszego projektu', () => {
  const dir = clientDirectory([
    project({ client: 'ACME sp. z o.o.', date: '2026-01-01' }),
    project({ client: 'Acme Sp. z o.o.', date: '2026-06-01' }),
  ])
  assert.equal(dir.length, 1)
  assert.equal(dir[0].name, 'Acme Sp. z o.o.')
})

test('suggestClients: najpierw początek nazwy lub słowa, potem środek; pusty tekst = ostatnio używani', () => {
  const dir = clientDirectory([
    project({ client: 'Kino Muza', date: '2026-01-01' }),
    project({ client: 'Muzeum Narodowe', date: '2026-02-01' }),
    project({ client: 'Amuzer', date: '2026-03-01' }),
    project({ client: 'Tchibo', date: '2026-04-01' }),
  ])
  assert.deepEqual(
    suggestClients(dir, 'muz').map((c) => c.name),
    ['Kino Muza', 'Muzeum Narodowe', 'Amuzer']
  )
  assert.deepEqual(suggestClients(dir, 'MÚZEUM').map((c) => c.name), ['Muzeum Narodowe'])
  assert.deepEqual(
    suggestClients(dir, '', 2).map((c) => c.name),
    ['Tchibo', 'Amuzer']
  )
})

test('applyClientChoice: projekt bez kontaktu dostaje kontakt z NAJNOWSZEGO projektu klienta', () => {
  const old = project({ client: 'Tchibo', date: '2025-01-01', contact: { name: 'Stara', email: 'a@x.pl', phone: '' } })
  const recent = project({ client: 'TCHIBO', date: '2026-04-01', contact: { name: 'Nowa', email: 'b@x.pl', phone: '1' } })
  const noContact = project({ client: 'Tchibo', date: '2026-09-01' })
  const current = project({ client: '' })
  const choice = applyClientChoice(current, ' tchibo ', [old, recent, noContact, current])
  assert.ok(choice)
  assert.equal(choice.patch.client, 'tchibo')
  assert.deepEqual(choice.patch.contact, { name: 'Nowa', email: 'b@x.pl', phone: '1' })
  assert.deepEqual(choice.contactFrom, { id: recent.id, name: recent.name })
  // Kopia, nie ten sam obiekt — edycja kontaktu nie zmieni innego projektu.
  assert.notEqual(choice.patch.contact, recent.contact)
})

test('applyClientChoice: istniejący kontakt zostaje; nowy klient nie ma skąd kopiować', () => {
  const other = project({ client: 'Tchibo', contact: { name: 'X', email: '', phone: '' } })
  const withContact = project({ contact: { name: 'Mój', email: '', phone: '' } })
  const keep = applyClientChoice(withContact, 'Tchibo', [other, withContact])
  assert.deepEqual(keep, { patch: { client: 'Tchibo' }, contactFrom: null })

  const fresh = project()
  assert.deepEqual(applyClientChoice(fresh, 'Nowy Klient', [other, fresh]), {
    patch: { client: 'Nowy Klient' },
    contactFrom: null,
  })
})

test('applyClientChoice: pusty kontakt (same spacje) liczy się jak brak; ta sama nazwa = nic do zmiany', () => {
  const other = project({ client: 'Tchibo', contact: { name: 'X', email: '', phone: '' } })
  const blank = project({ client: 'Tchibo', contact: { name: ' ', email: '', phone: '' } })
  assert.equal(hasContact(blank.contact), false)
  assert.equal(applyClientChoice(blank, 'Tchibo', [other, blank]), null)
  const choice = applyClientChoice(blank, 'tchibo', [other, blank])
  assert.deepEqual(choice?.patch.contact, { name: 'X', email: '', phone: '' })
})

test('applyClientChoice: kontakt nie pochodzi z samego siebie ani z innego klienta', () => {
  const self = project({ client: 'Tchibo', contact: { name: '', email: '', phone: '' } })
  const otherClient = project({ client: 'Lidl', contact: { name: 'L', email: '', phone: '' } })
  assert.deepEqual(applyClientChoice(self, 'Tchibo Polska', [self, otherClient])?.patch, { client: 'Tchibo Polska' })
})

test('clientRevenue: liczy jak Finanse — tylko W realizacji i Zrealizowane, opcjonalnie w roku', () => {
  const list = [
    project({ client: 'Tchibo', status: 'done', date: '2025-11-01', financials: financials(10000) }),
    project({ client: 'tchibo', status: 'won', date: '2026-02-01', financials: financials(5000) }),
    project({ client: 'Tchibo', status: 'won', date: '2026-03-01', financials: null }),
    project({ client: 'Tchibo', status: 'quote', date: '2026-04-01', financials: financials(99999) }),
    project({ client: 'Tchibo', status: 'lost', date: '2026-04-01', financials: financials(88888) }),
    project({ client: 'Lidl', status: 'done', date: '2026-04-01', financials: financials(7777) }),
  ]
  assert.deepEqual(clientRevenue(list, 'tchibo'), { revenue: 15000, countedProjects: 3 })
  assert.deepEqual(clientRevenue(list, 'tchibo', 2026), { revenue: 5000, countedProjects: 2 })
  assert.deepEqual(clientRevenue(list, 'nikt'), { revenue: 0, countedProjects: 0 })
})
