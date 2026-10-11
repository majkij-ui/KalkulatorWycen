import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCalendarView, parseHiddenGroups } from './calendar-prefs'

test('widok kalendarza: poprawny zapis wraca, uszkodzony albo spoza zakresu = brak', () => {
  assert.deepEqual(parseCalendarView('{"year":2026,"month":7,"day":"2026-07-14"}'), { year: 2026, month: 7, day: '2026-07-14' })
  assert.equal(parseCalendarView(null), null)
  assert.equal(parseCalendarView('nie json'), null)
  assert.equal(parseCalendarView('{"year":2026,"month":13,"day":"2026-07-14"}'), null)
  assert.equal(parseCalendarView('{"year":2026,"month":0,"day":"2026-07-14"}'), null)
  assert.equal(parseCalendarView('{"year":"2026","month":7,"day":"2026-07-14"}'), null)
  assert.equal(parseCalendarView('{"year":2026,"month":7,"day":"14.07"}'), null)
})

test('warstwy: tylko znane grupy, śmieci = nic ukrytego', () => {
  assert.deepEqual([...parseHiddenGroups('["post","firma","zgadywanka"]')].sort(), ['firma', 'post'])
  assert.equal(parseHiddenGroups('{"post":true}').size, 0)
  assert.equal(parseHiddenGroups('[').size, 0)
  assert.equal(parseHiddenGroups(null).size, 0)
})
