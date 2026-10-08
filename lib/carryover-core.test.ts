import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryOverEntries } from './carryover-core'

const file = {
  version: 1,
  source: 'com.michal.quotegen',
  localStorage: {
    'quote-gen-portfolio-catalogue': '[{"id":"a","name":"Showreel","url":"https://vimeo.com/1"}]',
    'quote-gen-user-default-pricing': '{"produkcja":{}}',
    'nonoise-pdf-draft': '{"stary":"szkic"}',
    'quote-gen-pdf-texts': 42,
    'quote-gen-pricing-config': '',
  },
}

test('przenosi tylko znane klucze z tekstową, niepustą wartością', () => {
  const entries = carryOverEntries(file, () => false)
  assert.deepEqual(
    entries.map(([key]) => key).sort(),
    ['quote-gen-portfolio-catalogue', 'quote-gen-user-default-pricing']
  )
})

test('nigdy nie nadpisuje tego, co hub już ma', () => {
  const entries = carryOverEntries(file, (key) => key === 'quote-gen-portfolio-catalogue')
  assert.deepEqual(entries.map(([key]) => key), ['quote-gen-user-default-pricing'])
})

test('brak albo uszkodzony plik = nic do zrobienia', () => {
  assert.deepEqual(carryOverEntries(null, () => false), [])
  assert.deepEqual(carryOverEntries('tekst', () => false), [])
  assert.deepEqual(carryOverEntries({ localStorage: 'x' }, () => false), [])
})
