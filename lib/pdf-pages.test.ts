/**
 * Cięcie obrazu call sheetu na strony A4 i klikalne linki w PDF.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { contentHeightOf, mailHref, placeLinks, planPdfPages, safeFileName, telHref } from './pdf-pages'

test('strony kończą się na ostatniej granicy sekcji, która się mieści', () => {
  // strona = 1000 px, sekcje kończą się co 300 px
  const breaks = [300, 600, 900, 1200, 1500, 1800]
  assert.deepEqual(planPdfPages(breaks, contentHeightOf(breaks, 1900), 1000), [
    { start: 0, end: 900 },
    { start: 900, end: 1800 },
  ])
})

test('sekcja wyższa niż strona → twarde cięcie; dolny margines nie robi pustej strony', () => {
  assert.deepEqual(planPdfPages([2500], 2500, 1000), [
    { start: 0, end: 1000 },
    { start: 1000, end: 2000 },
    { start: 2000, end: 2500 },
  ])
  assert.equal(contentHeightOf([], 777), 777)
  assert.deepEqual(planPdfPages([400], contentHeightOf([400], 480), 1000), [{ start: 0, end: 400 }])
  assert.deepEqual(planPdfPages([400], 400, 0), [])
})

test('link trafia na swoją stronę, w milimetrach od jej góry; część za cięciem jest obcięta', () => {
  const pages = [
    { start: 0, end: 900 },
    { start: 900, end: 1800 },
  ]
  const placed = placeLinks(
    [
      { left: 100, top: 950, width: 200, height: 40, url: 'tel:600' },
      { left: 50, top: 880, width: 100, height: 40, url: 'mailto:a@b.pl' },
      { left: 0, top: 5000, width: 10, height: 10, url: 'tel:poza' },
    ],
    pages,
    10
  )
  assert.deepEqual(placed, [
    { page: 1, x: 10, y: 5, w: 20, h: 4, url: 'tel:600' },
    { page: 0, x: 5, y: 88, w: 10, h: 2, url: 'mailto:a@b.pl' },
  ])
  assert.deepEqual(placeLinks([{ left: 0, top: 0, width: 1, height: 1, url: 'x' }], pages, 0), [])
})

test('telefon i e-mail jako linki; nazwa pliku bez zakazanych znaków', () => {
  assert.equal(telHref('+48 600 100 200'), 'tel:+48600100200')
  assert.equal(telHref('600-100-200 (prywatny)'), 'tel:600100200')
  assert.equal(telHref('brak'), null)
  assert.equal(mailHref(' ola@example.com '), 'mailto:ola@example.com')
  assert.equal(mailHref('ola@'), null)
  assert.equal(safeFileName('Call sheet: Tchibo / dzień 1?'), 'Call sheet- Tchibo - dzień 1-')
})
