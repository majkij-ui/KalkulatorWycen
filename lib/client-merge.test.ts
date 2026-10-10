import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanClientName,
  looksLikeSameClient,
  mergeCandidates,
  mergePatches,
  planClientMerge,
  undoMergePatches,
} from './client-merge'
import { clientDirectory } from './clients'

const p = (id: string, client: string) => ({ id, name: `Projekt ${id}`, client, date: '2026-01-01', updatedAt: '' })

test('planClientMerge: różne pisownie jednego klucza → jedna; zmieniają się tylko projekty z inną wartością pola', () => {
  const projects = [p('1', 'Tchibo'), p('2', 'tchibo '), p('3', 'TCHIBO'), p('4', 'Kino Muza')]
  const plan = planClientMerge(projects, ['tchibo'], '  Tchibo  ')!
  assert.equal(plan.target, 'Tchibo')
  assert.equal(plan.targetKey, 'tchibo')
  assert.deepEqual(
    plan.changes.map((c) => [c.id, c.from]),
    [
      ['2', 'tchibo '],
      ['3', 'TCHIBO'],
    ]
  )
  assert.deepEqual(mergePatches(plan), [
    { id: '2', client: 'Tchibo' },
    { id: '3', client: 'Tchibo' },
  ])
})

test('planClientMerge: dołączenie innego klienta, także pod nową nazwą; inni klienci nietknięci', () => {
  const projects = [p('1', 'Tchibo'), p('2', 'Tchibo Polska'), p('3', 'Kino Muza'), p('4', '')]
  const plan = planClientMerge(projects, ['tchibo', 'tchibo polska'], 'Tchibo Polska Sp. z o.o.')!
  assert.equal(plan.targetKey, 'tchibo polska sp. z o.o.')
  assert.deepEqual(plan.changes.map((c) => c.id), ['1', '2'])
  assert.deepEqual(plan.keys, ['tchibo', 'tchibo polska'])
})

test('planClientMerge: pusta nazwa albo brak kluczy → null; nic do zmiany → pusta lista', () => {
  const projects = [p('1', 'Tchibo')]
  assert.equal(planClientMerge(projects, ['tchibo'], '   '), null)
  assert.equal(planClientMerge(projects, [], 'Tchibo'), null)
  assert.equal(planClientMerge(projects, [''], 'Tchibo'), null)
  assert.deepEqual(planClientMerge(projects, ['tchibo'], 'Tchibo')!.changes, [])
})

test('undoMergePatches: przywraca dosłownie poprzednią wartość, ale nie tam, gdzie od scalenia zmieniono nazwę albo projekt zniknął', () => {
  const before = [p('1', 'tchibo '), p('2', 'Tchibo Polska'), p('3', 'TCHIBO')]
  const plan = planClientMerge(before, ['tchibo', 'tchibo polska'], 'Tchibo')!
  const after = [
    p('1', 'Tchibo'),
    p('2', 'Inny klient'), // zmieniony ręcznie po scaleniu
    // 3 usunięty
  ]
  assert.deepEqual(undoMergePatches(after, plan), [{ id: '1', client: 'tchibo ' }])
})

test('cleanClientName: spacje na brzegach i podwójne', () => {
  assert.equal(cleanClientName('  Tchibo   Polska '), 'Tchibo Polska')
})

test('looksLikeSameClient: wspólne znaczące słowo albo początek nazwy bez znaków; formy prawne i „Polska" się nie liczą', () => {
  assert.equal(looksLikeSameClient('tchibo', 'tchibo polska'), true)
  assert.equal(looksLikeSameClient('tchibo polska', 'orlen polska'), false)
  assert.equal(looksLikeSameClient('acme sp. z o.o.', 'beta sp. z o.o.'), false)
  assert.equal(looksLikeSameClient('s-ai', 'sai media'), true)
  assert.equal(looksLikeSameClient('kino muza', 'muzeum narodowe'), false)
  assert.equal(looksLikeSameClient('ab', 'abc'), false)
  assert.equal(looksLikeSameClient('tchibo', 'tchibo'), false)
})

test('mergeCandidates: bez bieżącego klienta, podobni pierwsi, potem alfabetycznie', () => {
  const directory = clientDirectory([
    p('1', 'Tchibo'),
    p('2', 'Zeta'),
    p('3', 'Tchibo Event'),
    p('4', 'Alfa'),
  ])
  assert.deepEqual(
    mergeCandidates(directory, 'tchibo').map((c) => [c.name, c.likely]),
    [
      ['Tchibo Event', true],
      ['Alfa', false],
      ['Zeta', false],
    ]
  )
})
