import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayLabel, itemLabel, plural } from './pl-plural'

test('trzy formy liczby mnogiej', () => {
  assert.equal(itemLabel(1), 'pozycja')
  assert.equal(itemLabel(2), 'pozycje')
  assert.equal(itemLabel(4), 'pozycje')
  assert.equal(itemLabel(5), 'pozycji')
  assert.equal(itemLabel(0), 'pozycji')
})

test('nastki idą do formy dopełniaczowej mimo końcówki 2-4', () => {
  assert.equal(itemLabel(12), 'pozycji')
  assert.equal(itemLabel(13), 'pozycji')
  assert.equal(itemLabel(14), 'pozycji')
  assert.equal(itemLabel(22), 'pozycje', '22 wraca do formy mnogiej')
  assert.equal(itemLabel(25), 'pozycji')
  assert.equal(itemLabel(112), 'pozycji')
})

test('dni: pojedyncza tylko dla 1', () => {
  assert.equal(dayLabel(1), 'dzień')
  assert.equal(dayLabel(2), 'dni')
  assert.equal(dayLabel(5), 'dni')
})

test('liczby ujemne i ułamki nie wywracają odmiany', () => {
  assert.equal(plural(-1, 'a', 'b', 'c'), 'a')
  assert.equal(plural(2.7, 'a', 'b', 'c'), 'b', 'obcinamy do 2')
})
