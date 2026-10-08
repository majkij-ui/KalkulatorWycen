import { test } from 'node:test'
import assert from 'node:assert/strict'

import { blankQuoteSnapshot, isBlankQuoteData, planProjectSave } from './project-save'
import { mergeQuoteDataPartial } from './quote-financials'
import { DEFAULT_PRICING } from './pricing-config'
import { defaultQuoteData, type QuoteData } from './quote-types'
import type { Project, ProjectFinancials } from './project-types'
import type { QuoteSnapshot } from './quote-library'

const NOW = new Date('2026-10-08T12:00:00.000Z')

/** Finanse z retro-importu — prawdziwy przychód, nie z kalkulatora. */
const IMPORTED: ProjectFinancials = {
  sumaNetto: 12000,
  koszty: 3000,
  podatek: 1020,
  zysk: 7980,
  marzaPct: 66.5,
  computedAt: '2026-09-30T10:00:00.000Z',
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-retro2026-001',
    name: 'Spot dla klienta',
    client: 'ACME',
    status: 'done',
    date: '2026-03-14',
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:00.000Z',
    quote: null,
    financials: IMPORTED,
    equipment: [],
    notes: '',
    ...overrides,
  }
}

/** Stan kalkulatora tak, jak zbudowałby go `buildQuoteSnapshot()`. */
function snapshot(data: Partial<QuoteData>, extra: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    version: 2,
    savedAt: NOW.toISOString(),
    data: mergeQuoteDataPartial(data),
    pricingConfig: DEFAULT_PRICING,
    marginMultiplier: 1,
    pdfDraft: null,
    ...extra,
  }
}

/** Kalkulator zaraz po `openProject` dla projektu bez wyceny. */
function freshlyOpened(p: Project): QuoteSnapshot {
  return snapshot(blankQuoteSnapshot(p.client).data)
}

test('isBlankQuoteData: domyślna wycena i czysty kalkulator z klientem są puste', () => {
  assert.equal(isBlankQuoteData(defaultQuoteData), true)
  assert.equal(isBlankQuoteData({}), true)
  assert.equal(isBlankQuoteData(mergeQuoteDataPartial({ clientName: 'ACME' })), true)
})

test('isBlankQuoteData: każda pozycja wyceny to już nie pusta wycena', () => {
  assert.equal(isBlankQuoteData({ dniDokumentacji: 1 }), false)
  assert.equal(isBlankQuoteData({ projectName: 'Spot' }), false)
  assert.equal(isBlankQuoteData({ profitOverrides: { montaz: 500 } } as Partial<QuoteData>), false)
  assert.equal(isBlankQuoteData({ profitTransferAmount: 9000 }), false)
})

test('retro-projekt otwarty i zapisany bez zmian: finanse i brak wyceny zostają', () => {
  const p = project()
  const plan = planProjectSave({ project: p, snapshot: freshlyOpened(p), now: NOW })
  assert.equal(plan.status, 'ready')
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'kept')
  assert.equal(plan.project.quote, null)
  assert.deepEqual(plan.project.financials, IMPORTED)
  assert.equal(plan.project.client, 'ACME')
  assert.equal(plan.project.updatedAt, NOW.toISOString())
})

test('marża ani cennik bez pozycji wyceny nie nadpisują zaimportowanych finansów', () => {
  const p = project()
  const plan = planProjectSave({
    project: p,
    snapshot: snapshot(blankQuoteSnapshot(p.client).data, { marginMultiplier: 1.5 }),
    now: NOW,
  })
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'kept')
  assert.deepEqual(plan.project.financials, IMPORTED)
})

test('wpisanie samego klienta aktualizuje klienta, nie zakłada wyceny', () => {
  const p = project({ client: '' })
  const plan = planProjectSave({ project: p, snapshot: snapshot({ clientName: 'Nowy Klient' }), now: NOW })
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'kept')
  assert.equal(plan.project.client, 'Nowy Klient')
  assert.equal(plan.project.quote, null)
  assert.deepEqual(plan.project.financials, IMPORTED)
})

test('lead bez finansów i nietknięty kalkulator: zostaje leadem (bez pustej wyceny i zer)', () => {
  const p = project({ status: 'quote', financials: null })
  const plan = planProjectSave({ project: p, snapshot: freshlyOpened(p), now: NOW })
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'kept')
  assert.equal(plan.project.quote, null)
  assert.equal(plan.project.financials, null)
})

test('lead bez finansów i zbudowana wycena: zapis wyceny z policzonymi finansami', () => {
  const p = project({ status: 'quote', financials: null })
  const snap = snapshot({ clientName: 'ACME', dniDokumentacji: 2 })
  const plan = planProjectSave({ project: p, snapshot: snap, now: NOW })
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'calculator')
  assert.equal(plan.project.quote, snap)
  assert.ok(plan.project.financials)
  assert.ok(plan.project.financials.sumaNetto > 0)
  assert.equal(plan.project.financials.computedAt, NOW.toISOString())
})

test('retro-projekt i zbudowana wycena: bez zgody nic nie nadpisuje, pyta z obiema kwotami', () => {
  const p = project()
  const plan = planProjectSave({ project: p, snapshot: snapshot({ dniDokumentacji: 2 }), now: NOW })
  assert.equal(plan.status, 'needs-confirmation')
  assert.ok(plan.status === 'needs-confirmation')
  assert.deepEqual(plan.current, IMPORTED)
  assert.ok(plan.proposed)
  assert.ok(plan.proposed.sumaNetto > 0)
  assert.notEqual(plan.proposed.sumaNetto, IMPORTED.sumaNetto)
  // Wejściowy projekt nietknięty.
  assert.deepEqual(p.financials, IMPORTED)
  assert.equal(p.quote, null)
})

test('retro-projekt i zbudowana wycena po potwierdzeniu: finanse z kalkulatora', () => {
  const p = project()
  const snap = snapshot({ dniDokumentacji: 2 })
  const plan = planProjectSave({ project: p, snapshot: snap, replaceFinancials: true, now: NOW })
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'calculator')
  assert.equal(plan.project.quote, snap)
  assert.ok(plan.project.financials)
  assert.notDeepEqual(plan.project.financials, IMPORTED)
})

test('projekt z wyceną zapisuje się jak dotąd: finanse zawsze z kalkulatora, bez pytania', () => {
  const previous = snapshot({ dniDokumentacji: 1 })
  const p = project({ quote: previous })
  const snap = snapshot({ dniDokumentacji: 3 })
  const plan = planProjectSave({ project: p, snapshot: snap, now: NOW })
  assert.ok(plan.status === 'ready')
  assert.equal(plan.source, 'calculator')
  assert.equal(plan.project.quote, snap)
  assert.ok(plan.project.financials)
  assert.ok(plan.project.financials.sumaNetto > 0)
})
