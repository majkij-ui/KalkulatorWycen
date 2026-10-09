import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LIST_PREFS,
  filterProjectList,
  lostInScope,
  parseListPrefs,
  projectYears,
  type ProjectListQuery,
} from './project-list'
import type { ProjectStatus } from './project-types'

const row = (name: string, client: string, status: ProjectStatus, date: string) => ({ name, client, status, date })

const PROJECTS = [
  row('Spot jesienny', 'Tchibo', 'won', '2026-09-01'),
  row('Event', 'tchibo ', 'lost', '2026-05-01'),
  row('Katalog', 'Tchibo', 'done', '2025-11-01'),
  row('Żółty film', 'Łódź Film', 'quote', '2026-02-01'),
  row('Bez klienta', '', 'quote', '2026-03-01'),
]

const ALL: ProjectListQuery = { filter: 'all', hideLost: false, client: '', year: null }
const names = (list: { name: string }[]) => list.map((p) => p.name)

test('bez filtrów widać wszystko; „Ukryj nieprzyjęte" chowa tylko nieprzyjęte', () => {
  assert.equal(filterProjectList(PROJECTS, ALL).length, 5)
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, hideLost: true })), [
    'Spot jesienny',
    'Katalog',
    'Żółty film',
    'Bez klienta',
  ])
})

test('klient po kluczu znormalizowanym: różne pisownie razem', () => {
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, client: 'tchibo' })), ['Spot jesienny', 'Event', 'Katalog'])
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, client: 'lodz film' })), ['Żółty film'])
})

test('rok po dacie księgowej; filtry łączą się ze statusem', () => {
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, year: 2025 })), ['Katalog'])
  assert.deepEqual(
    names(filterProjectList(PROJECTS, { ...ALL, client: 'tchibo', year: 2026, filter: 'projects' })),
    ['Spot jesienny']
  )
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, client: 'tchibo', filter: 'quotes' })), ['Event'])
})

test('szukanie bez polskich znaków i wielkości liter, po nazwie albo kliencie', () => {
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, search: 'zolty' })), ['Żółty film'])
  assert.deepEqual(names(filterProjectList(PROJECTS, { ...ALL, search: 'LODZ' })), ['Żółty film'])
})

test('licznik ukrytych nieprzyjętych uwzględnia klienta i rok', () => {
  assert.equal(lostInScope(PROJECTS, ALL), 1)
  assert.equal(lostInScope(PROJECTS, { ...ALL, client: 'tchibo' }), 1)
  assert.equal(lostInScope(PROJECTS, { ...ALL, year: 2025 }), 0)
  assert.equal(lostInScope(PROJECTS, { ...ALL, client: 'lodz film' }), 0)
})

test('projectYears: malejąco, bez powtórzeń i bez nieczytelnych dat', () => {
  assert.deepEqual(projectYears([...PROJECTS, { date: 'zła data' }]), [2026, 2025])
})

test('parseListPrefs: poprawny zapis wraca, wszystko inne → domyślne', () => {
  assert.deepEqual(parseListPrefs(JSON.stringify({ filter: 'projects', client: 'Tchibo ', year: 2026 })), {
    filter: 'projects',
    client: 'tchibo',
    year: 2026,
  })
  assert.deepEqual(parseListPrefs(null), DEFAULT_LIST_PREFS)
  assert.deepEqual(parseListPrefs('to nie JSON'), DEFAULT_LIST_PREFS)
  assert.deepEqual(parseListPrefs('[]'), { filter: 'all', client: '', year: null })
  assert.deepEqual(parseListPrefs(JSON.stringify({ filter: 'lead', client: 5, year: '2026' })), DEFAULT_LIST_PREFS)
  assert.deepEqual(parseListPrefs(JSON.stringify({ year: 2026.5 })).year, null)
})
