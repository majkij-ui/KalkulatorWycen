import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  categoryFields,
  COST_CATEGORY_KEYS,
  COST_CATEGORY_LABELS,
  fixedCostCategory,
  isCostCategory,
  typeForCategory,
  withCategory,
} from './fixed-cost-categories'
import { fixedCostSchema } from './project-types'

test('stare pozycje: kategoria ze starego type', () => {
  assert.equal(fixedCostCategory({ type: 'zus' }), 'zus')
  assert.equal(fixedCostCategory({ type: 'marketing' }), 'marketing')
  assert.equal(fixedCostCategory({ type: 'other' }), 'other')
})

test('znane category wygrywa z type; nieznane (z nowszej wersji) liczy się jako Inne', () => {
  assert.equal(fixedCostCategory({ type: 'other', category: 'software' }), 'software')
  assert.equal(fixedCostCategory({ type: 'other', category: 'leasing' }), 'other')
  assert.equal(fixedCostCategory({ type: 'zus', category: 'leasing' }), 'zus', 'nieznane: wraca do type')
})

test('nowe kategorie zapisują type „other" — starszy build widzi je jako Inne', () => {
  for (const key of ['software', 'bank', 'office', 'telecom', 'insurance'] as const) {
    assert.equal(typeForCategory(key), 'other')
    assert.deepEqual(categoryFields(key), { type: 'other', category: key })
  }
  assert.deepEqual(categoryFields('zus'), { type: 'zus' }, 'ZUS bez zbędnego pola')
  assert.deepEqual(categoryFields('marketing'), { type: 'marketing' })
  assert.deepEqual(categoryFields('other'), { type: 'other' })
})

test('withCategory: zmiana kategorii zdejmuje stare category i zostawia resztę pól', () => {
  const cost = { id: 'f1', type: 'other' as const, category: 'software', label: 'Adobe', custom: 1 }
  assert.deepEqual(withCategory(cost, 'zus'), { id: 'f1', type: 'zus', label: 'Adobe', custom: 1 })
  assert.deepEqual(withCategory(cost, 'bank'), { id: 'f1', type: 'other', category: 'bank', label: 'Adobe', custom: 1 })
})

test('każda kategoria ma etykietę; strażnik typu', () => {
  COST_CATEGORY_KEYS.forEach((key) => assert.ok(COST_CATEGORY_LABELS[key]))
  assert.equal(COST_CATEGORY_LABELS.office, 'Księgowość / biuro')
  assert.equal(isCostCategory('telecom'), true)
  assert.equal(isCostCategory('Telefon'), false)
  assert.equal(isCostCategory(undefined), false)
})

test('schemat kosztu: stary rekord bez nowych pól czyta się bez zmian; nowe pola przechodzą', () => {
  const old = { id: 'fc-1', month: '2026-01', type: 'zus', label: 'ZUS', amount: 2257.29, source: 'manual' }
  assert.deepEqual(fixedCostSchema.parse(old), old)
  const added = { ...old, type: 'other', category: 'software', subscriptionId: 'sub-1', deletedAt: '2026-10-13T10:00:00Z' }
  assert.deepEqual(fixedCostSchema.parse(added), added)
  assert.equal(fixedCostSchema.parse({ ...old, type: 'subskrypcja' }).type, 'other', 'nieznany type → other, jak dotąd')
  assert.equal(fixedCostSchema.parse({ ...old, category: 42 }).category, undefined, 'zła kategoria nie psuje rekordu')
})
