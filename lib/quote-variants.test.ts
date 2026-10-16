/**
 * Warianty wyceny A/B/C (Q2): zasady w `quote-variants.ts` i dokumenty
 * wariantów w magazynie `quote-documents.ts`.
 *
 * Przypadki z życia (PLAN-AFTER-TEST-DRIVE §9): B z kopii A nie rusza A ani
 * finansów, wybór do rozliczeń zamienia migawki i liczy finanse z nowego
 * wyboru, wybranego nie da się usunąć, EUR w jednym wariancie, stare projekty
 * bez zmian, finanse z importu, restart, „Wycena wysłana" z wersją.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── Polyfill przeglądarki dla testu restartu (moduły czytają `window` dopiero w ciele funkcji)
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  get length(): number {
    return this.map.size
  }
}
const globals = globalThis as Record<string, unknown>
globals.localStorage = new MemoryStorage()
globals.window = globals

import {
  addVariantPatch,
  asksWhichVariant,
  chooseVariantPlan,
  chosenLabel,
  chosenVariantId,
  deleteVariantPatch,
  hasAlternatives,
  listVariants,
  MAIN_VARIANT_ID,
  nextVariantLabel,
  parseDocId,
  pdfVariantSuffix,
  quoteSentEvent,
  renameVariantPatch,
  restoreVariantCrew,
  restoreVariantPatch,
  retargetVariantCrew,
  variantDocId,
  variantFigures,
  variantSnapshotPatch,
} from './quote-variants'
import { createQuoteDocumentStore, docToSnapshot, type QuoteDoc, type QuoteDocPatch } from './quote-documents'
import { computeSnapshotFinancials, mergeQuoteDataPartial } from './quote-financials'
import { DEFAULT_PRICING } from './pricing-config'
import { projectSchema, type Project, type ProjectFinancials, type QuoteVariant } from './project-types'
import { eventSchema } from './event-types'
import type { QuoteSnapshot } from './quote-library'
import type { QuoteData } from './quote-types'
import { createProject, listAllProjects, replaceAllProjects, upsertProject } from './project-library'

const NOW = new Date('2026-10-16T12:00:00.000Z')
const LATER = new Date('2026-10-17T08:00:00.000Z')

function snap(data: Partial<QuoteData>, extra: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    version: 2,
    savedAt: '2026-10-01T09:00:00.000Z',
    data: mergeQuoteDataPartial(data),
    pricingConfig: DEFAULT_PRICING,
    marginMultiplier: 1,
    pdfDraft: null,
    ...extra,
  }
}

const IMPORTED: ProjectFinancials = {
  sumaNetto: 2000,
  koszty: 300,
  podatek: 170,
  zysk: 1530,
  marzaPct: 76.5,
  computedAt: '2026-09-30T10:00:00.000Z',
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    client: `Klient ${id}`,
    status: 'quote',
    date: '2026-10-01',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...overrides,
  }
}

function quoted(id: string, quote: QuoteSnapshot, overrides: Partial<Project> = {}): Project {
  return project(id, { quote, financials: computeSnapshotFinancials(quote, NOW), ...overrides })
}

function variant(id: string, label: string, snapshot: QuoteSnapshot | null, extra: Partial<QuoteVariant> = {}): QuoteVariant {
  return { id, label, snapshot, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...extra }
}

const A = snap({ dniDokumentacji: 1 })
const B = snap({ dniDokumentacji: 4 })
const C = snap({ dniDokumentacji: 2 })

const sumaNetto = (s: QuoteSnapshot | null) => computeSnapshotFinancials(s, NOW)?.sumaNetto ?? 0
const withoutStamp = (f: ProjectFinancials | null) => {
  if (!f) return f
  const { computedAt: _ignored, ...rest } = f
  return rest
}

// ── Zasady (czyste) ──────────────────────────────────────────────────────────

test('stary projekt bez wariantów: jeden wariant „A", wybrany, klucz = id projektu', () => {
  const p = quoted('p1', A)
  assert.equal(hasAlternatives(p), false)
  assert.equal(chosenVariantId(p), MAIN_VARIANT_ID)
  assert.equal(chosenLabel(p), 'A')
  assert.deepEqual(
    listVariants(p).map((v) => [v.id, v.label, v.chosen, v.docId]),
    [[MAIN_VARIANT_ID, 'A', true, 'p1']]
  )
  assert.equal(variantDocId(p, MAIN_VARIANT_ID), 'p1')
  assert.equal(pdfVariantSuffix(null), '', 'nazwa pliku PDF bez dopisku')
  // Schemat nie dopisuje nowych pól staremu projektowi.
  const parsed = projectSchema.parse(JSON.parse(JSON.stringify(p)))
  assert.equal('quoteVariants' in parsed, false)
  assert.equal('quoteLabel' in parsed, false)
  assert.equal('quoteVariantId' in parsed, false)
})

test('„+ Wariant": następna wolna litera, A nazwana raz, wycena i finanse nietknięte', () => {
  const p = quoted('p1', A)
  const first = addVariantPatch(p, { id: 'qv-b', snapshot: B, now: NOW })
  assert.equal(first.variant.label, 'B')
  assert.equal(first.patch.quoteLabel, 'A')
  assert.equal('quote' in first.patch, false)
  assert.equal('financials' in first.patch, false)
  const withB = { ...p, ...first.patch }
  const second = addVariantPatch(withB, { id: 'qv-c', snapshot: C, now: NOW })
  assert.equal(second.variant.label, 'C')
  assert.equal('quoteLabel' in second.patch, false, 'nazwa A już jest')
  assert.deepEqual(
    listVariants({ ...withB, ...second.patch }).map((v) => [v.label, v.chosen, v.docId]),
    [
      ['A', true, 'p1'],
      ['B', false, 'p1#qv-b'],
      ['C', false, 'p1#qv-c'],
    ]
  )
  assert.equal(hasAlternatives(withB), true)
})

test('nazwy: bez wielkości liter, usunięte zajmują literę, potem liczby', () => {
  assert.equal(nextVariantLabel(['A', 'b']), 'C')
  assert.equal(nextVariantLabel(['A', '2 dni']), 'B')
  const all = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
  assert.equal(nextVariantLabel(all), '27')
  const p = quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', B, { deletedAt: NOW.toISOString() })] })
  assert.equal(addVariantPatch(p, { id: 'qv-x', snapshot: C, now: NOW }).variant.label, 'C')
})

test('zmiana nazwy: wybrany → quoteLabel, wariant → jego wpis; pusta nazwa nic nie zmienia', () => {
  const p = quoted('p1', A, { quoteLabel: 'A', quoteVariants: [variant('qv-b', 'B', B)] })
  assert.deepEqual(renameVariantPatch(p, MAIN_VARIANT_ID, '  tania  ', LATER), { quoteLabel: 'tania' })
  const renamed = renameVariantPatch(p, 'qv-b', '2 dni', LATER)
  assert.equal(renamed?.quoteVariants?.[0].label, '2 dni')
  assert.equal(renamed?.quoteVariants?.[0].snapshot, B)
  assert.equal(renameVariantPatch(p, 'qv-b', '   ', LATER), null)
  assert.equal(renameVariantPatch(p, 'qv-b', 'B', LATER), null)
})

test('usunięcie: wybranego nie wolno; wariant miękko, „Cofnij" przywraca; bez wariantów wygląda jak dotąd', () => {
  const p = quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', B)] })
  assert.equal(deleteVariantPatch(p, MAIN_VARIANT_ID, NOW), null)
  // Także gdy lista (np. po ręcznej edycji pliku) ma wpis o id wybranego.
  const odd = quoted('p9', A, { quoteVariantId: 'qv-b', quoteVariants: [variant('qv-b', 'B', B)] })
  assert.equal(deleteVariantPatch(odd, 'qv-b', NOW), null)
  const deleted = { ...p, ...deleteVariantPatch(p, 'qv-b', NOW) }
  assert.equal(deleted.quoteVariants?.[0].deletedAt, NOW.toISOString())
  assert.equal(deleted.quoteVariants?.[0].snapshot, B, 'migawka zostaje w pliku')
  assert.equal(hasAlternatives(deleted), false)
  assert.equal(listVariants(deleted).length, 1)
  assert.equal(deleteVariantPatch(deleted, 'qv-b', NOW), null, 'drugi raz nic')
  const restored = { ...deleted, ...restoreVariantPatch(deleted, 'qv-b') }
  assert.equal('deletedAt' in (restored.quoteVariants?.[0] ?? {}), false)
  assert.equal(hasAlternatives(restored), true)
})

test('„Wybrany do rozliczeń": migawki zamieniają się, finanse z B, „Cofnij" wraca do A co do grosza', () => {
  const p = quoted('p1', A, {
    status: 'won',
    quoteVariants: [variant('qv-b', 'B', B), variant('qv-c', 'C', C)],
  })
  const plan = chooseVariantPlan(p, 'qv-b', NOW)
  assert.equal(plan.status, 'ready')
  if (plan.status !== 'ready') return
  assert.equal(plan.patch.quote, B)
  assert.equal(plan.patch.quoteVariantId, 'qv-b')
  assert.equal(plan.patch.quoteLabel, 'B')
  assert.deepEqual(withoutStamp(plan.after), withoutStamp(computeSnapshotFinancials(B, NOW)))
  assert.equal(plan.before, p.financials)
  assert.equal(plan.previousId, MAIN_VARIANT_ID)
  assert.equal(plan.replacesImported, false)
  // A jest teraz wariantem na miejscu B; kolejność listy się nie przestawia.
  assert.deepEqual(
    plan.patch.quoteVariants?.map((v) => [v.id, v.label]),
    [
      [MAIN_VARIANT_ID, 'A'],
      ['qv-c', 'C'],
    ]
  )
  assert.equal(plan.patch.quoteVariants?.[0].snapshot, A)

  const chosenB = { ...p, ...plan.patch }
  assert.deepEqual(
    listVariants(chosenB).map((v) => [v.label, v.chosen, v.docId]),
    [
      ['A', false, `p1#${MAIN_VARIANT_ID}`],
      ['B', true, 'p1'],
      ['C', false, 'p1#qv-c'],
    ]
  )
  const back = chooseVariantPlan(chosenB, MAIN_VARIANT_ID, LATER)
  assert.equal(back.status, 'ready')
  if (back.status !== 'ready') return
  const restored = { ...chosenB, ...back.patch }
  assert.equal(restored.quote, A)
  assert.deepEqual(withoutStamp(restored.financials), withoutStamp(p.financials))
  assert.equal(chosenVariantId(restored), MAIN_VARIANT_ID)
  assert.deepEqual(restored.quoteVariants?.map((v) => v.id), ['qv-b', 'qv-c'])
  assert.equal(chooseVariantPlan(restored, MAIN_VARIANT_ID, LATER).status, 'unchanged')
  assert.equal(chooseVariantPlan(restored, 'nie-ma', LATER).status, 'missing')
})

test('usuniętego wariantu nie da się wybrać', () => {
  const p = quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', B, { deletedAt: NOW.toISOString() })] })
  assert.equal(chooseVariantPlan(p, 'qv-b', NOW).status, 'missing')
})

test('finanse z importu: wybór wariantu pyta (replacesImported), pusta A zostaje pustym wariantem', () => {
  const p = project('retro', { financials: IMPORTED, quoteVariants: [variant('qv-b', 'B', B)] })
  const plan = chooseVariantPlan(p, 'qv-b', NOW)
  assert.equal(plan.status, 'ready')
  if (plan.status !== 'ready') return
  assert.equal(plan.replacesImported, true)
  assert.equal(plan.before, IMPORTED)
  assert.equal(plan.after?.sumaNetto, sumaNetto(B))
  assert.equal(plan.patch.quoteVariants?.[0].snapshot, null)
  assert.equal(plan.patch.client, 'Klient retro')
})

test('pytanie o wariant przy statusie: tylko wejście do „W realizacji"/„Zrealizowany" i tylko z wariantami', () => {
  const single = quoted('p1', A)
  const multi = quoted('p2', A, { quoteVariants: [variant('qv-b', 'B', B)] })
  assert.equal(asksWhichVariant(single, 'won'), false)
  assert.equal(asksWhichVariant(multi, 'won'), true)
  assert.equal(asksWhichVariant(multi, 'done'), true)
  assert.equal(asksWhichVariant({ ...multi, status: 'lost' }, 'won'), true)
  assert.equal(asksWhichVariant({ ...multi, status: 'won' }, 'done'), false, 'już wybrany przy „W realizacji"')
  assert.equal(asksWhichVariant(multi, 'lost'), false)
  const onlyDeleted = quoted('p3', A, { quoteVariants: [variant('qv-b', 'B', B, { deletedAt: NOW.toISOString() })] })
  assert.equal(asksWhichVariant(onlyDeleted, 'won'), false)
})

test('porównanie: EUR w jednym wariancie, PDF poprawiony ręcznie, dni, ekipa', () => {
  const eur = snap({ dniDokumentacji: 2, currency: 'EUR', exchangeRate: 4.25 })
  const pln = snap(
    { dniZdjeciowe: 2, wielkoscEkipy: 3 },
    {
      pdfDraft: {
        currency: 'PLN',
        rows: { preprodukcja: { cenaNetto: 1000 }, ekipa: { cenaNetto: 4800 }, sprzet: { cenaNetto: 1200 } },
      },
    }
  )
  const fe = variantFigures(eur)
  assert.equal(fe.currency, 'EUR')
  assert.ok(fe.netto > 0)
  assert.ok(Math.abs(fe.nettoPln - fe.netto * 4.25) < 0.01)
  assert.equal(fe.pdfNetto, null)
  const fp = variantFigures(pln)
  assert.equal(fp.currency, 'PLN')
  assert.equal(fp.pdfNetto, 7000)
  assert.equal(fp.pdfCurrency, 'PLN')
  assert.equal(fp.shootingDays, 2)
  assert.equal(fp.crewDays, 6)
  assert.equal(fp.gear, null, 'tryb prosty nie zna sprzętu z katalogu')
  assert.equal(fp.zysk, computeSnapshotFinancials(pln, NOW)?.zysk)
  // Pusta wycena (wariant „Pusta wycena" / uszkodzona migawka) liczy się jak zero.
  assert.equal(variantFigures(null, 'Klient').netto, 0)
})

test('„Wycena wysłana": kwota z PDF w zł, wersja = nazwa wariantu; rekord przechodzi schemat bez poprawek', () => {
  const pl = quoteSentEvent({
    id: 'ev-1',
    projectId: 'p1',
    date: '2026-10-16',
    pdfNetto: 13500,
    pdfCurrency: 'PLN',
    pdfRate: 4.3,
    variantLabel: 'B',
    now: NOW,
  })
  assert.deepEqual(pl.data, { amountNetto: 13500, quoteVersion: 'B' })
  assert.equal(pl.kind, 'quote_sent')
  assert.equal(pl.title, 'Wycena wysłana — wariant B')
  assert.deepEqual(eventSchema.parse(pl), pl)
  const eur = quoteSentEvent({
    id: 'ev-2',
    projectId: 'p1',
    date: '2026-10-16',
    pdfNetto: 1460.5,
    pdfCurrency: 'EUR',
    pdfRate: 4.2513,
    variantLabel: null,
    now: NOW,
  })
  assert.deepEqual(eur.data, { amountNetto: 6209.02 })
  assert.equal(eur.title, 'Wycena wysłana')
  assert.equal(pdfVariantSuffix('B'), ' (wariant B)')
})

test('schemat: warianty przechodzą bez zmian (jak `npm run data`), uszkodzony wpis znika, zła migawka = pusta', () => {
  const p = quoted('p1', A, {
    quoteLabel: 'A',
    quoteVariants: [variant('qv-b', 'B', B, { future: 1 } as Partial<QuoteVariant>)],
  })
  const raw = JSON.parse(JSON.stringify(p))
  assert.deepEqual(projectSchema.parse(raw), raw)
  const broken = projectSchema.parse({ ...raw, quoteVariants: [raw.quoteVariants[0], { label: 'bez id' }, { id: 'x', snapshot: 5 }] })
  assert.deepEqual(broken.quoteVariants?.map((v) => [v.id, v.snapshot === null]), [
    ['qv-b', false],
    ['x', true],
  ])
})

test('„Scal osoby" przepina ekipę w wariantach; „Cofnij" przywraca tylko nietknięte pozycje', () => {
  const day = (crew: { id: string; personId?: string }[]) => ({ id: 'd1', crew })
  const withCrew = snap({ isDetailedProdukcja: true, detailedShootingDays: [day([{ id: 'l1', personId: 'dup' }, { id: 'l2', personId: 'x' }])] as never })
  const p = quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', withCrew), variant('qv-c', 'C', C)] })
  const merged = retargetVariantCrew(p, ['dup'], 'keep')
  assert.ok(merged)
  if (!merged) return
  assert.deepEqual(merged.refs, [{ variantId: 'qv-b', dayId: 'd1', lineId: 'l1', from: 'dup' }])
  const after = { ...p, ...merged.patch }
  const crewOf = (proj: Project) =>
    ((proj.quoteVariants?.[0].snapshot?.data as QuoteData).detailedShootingDays[0].crew ?? []).map((l) => l.personId)
  assert.deepEqual(crewOf(after), ['keep', 'x'])
  assert.equal(after.quoteVariants?.[1].snapshot, C, 'wariant bez tej osoby nietknięty')
  assert.equal(after.quote, A, 'wybrany przepina `crewMergePatches`, nie ta funkcja')
  assert.equal(retargetVariantCrew(after, ['dup'], 'keep'), null)
  const undone = { ...after, ...restoreVariantCrew(after, merged.refs, 'keep') }
  assert.deepEqual(crewOf(undone), ['dup', 'x'])
  // Pozycja zmieniona po scaleniu (ktoś inny) zostaje przy „Cofnij".
  const edited = {
    ...after,
    quoteVariants: [
      variant('qv-b', 'B', snap({ isDetailedProdukcja: true, detailedShootingDays: [day([{ id: 'l1', personId: 'y' }, { id: 'l2', personId: 'x' }])] as never })),
    ],
  }
  assert.equal(restoreVariantCrew(edited, merged.refs, 'keep'), null)
})

// ── Magazyn: dokumenty wariantów ─────────────────────────────────────────────

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Magazyn jak w hubie: wybrany zapisuje `write` (z finansami), wariant — tylko swój wpis. */
function harness(initial: Project[]) {
  let projects = initial
  const writes: { id: string; patch: QuoteDocPatch }[] = []
  const variantWrites: { projectId: string; variantId: string }[] = []
  const timers = new Map<number, () => void>()
  let seq = 0
  const patch = (id: string, next: Partial<Project>) => {
    projects = projects.map((p) => (p.id === id ? { ...p, ...next } : p))
  }
  const store = createQuoteDocumentStore({
    getProject: (id) => projects.find((p) => p.id === id) ?? null,
    defaultPricing: () => null,
    write: async (id, next) => {
      writes.push({ id, patch: next })
      patch(id, next)
    },
    writeVariant: async (projectId, variantId, snapshot) => {
      const current = projects.find((p) => p.id === projectId)
      const next = current ? variantSnapshotPatch(current, variantId, snapshot, NOW) : null
      if (!next) return
      variantWrites.push({ projectId, variantId })
      patch(projectId, next)
    },
    setTimer: (fn) => {
      seq += 1
      timers.set(seq, fn)
      return seq
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
    now: () => NOW,
  })
  return {
    store,
    writes,
    variantWrites,
    project: (id: string) => projects.find((p) => p.id === id) as Project,
    patch,
    async elapse() {
      const due = [...timers.values()]
      timers.clear()
      due.forEach((fn) => fn())
      await settle()
    },
    /** „Wybrany do rozliczeń" jak w hubie: zapis wszystkiego, zamiana, dokumenty od nowa. */
    async choose(projectId: string, variantId: string) {
      await store.flushProject(projectId)
      if (store.pendingIds().some((id) => parseDocId(id).projectId === projectId)) return 'blocked'
      const plan = chooseVariantPlan(projects.find((p) => p.id === projectId) as Project, variantId, NOW)
      if (plan.status !== 'ready') return plan.status
      patch(projectId, plan.patch)
      store.forget(projectId)
      return 'ready'
    },
  }
}

const setDays = (n: number) => (doc: QuoteDoc): QuoteDoc => ({ ...doc, data: { ...doc.data, dniDokumentacji: n } })

test('B z kopii A, edycja B: A, jego PDF i finanse nietknięte; zapis B to tylko jego wpis', async () => {
  const a = snap({ dniDokumentacji: 1 }, { pdfDraft: { terminZdjec: '20.11' } })
  const h = harness([quoted('p1', a, { quoteVariants: [variant('qv-c', 'C', C)] })])
  const { patch } = addVariantPatch(h.project('p1'), { id: 'qv-b', snapshot: docToSnapshot(h.store.get('p1'), NOW), now: NOW })
  h.patch('p1', patch)
  const financialsBefore = h.project('p1').financials

  h.store.edit('p1#qv-b', setDays(5))
  h.store.edit('p1#qv-b', (doc) => ({ ...doc, pdfDraft: { terminZdjec: 'grudzień' } }))
  assert.equal(h.store.get('p1').data.dniDokumentacji, 1, 'brak przecieku do A w pamięci')
  assert.deepEqual(h.store.get('p1').pdfDraft, { terminZdjec: '20.11' })
  await h.elapse()

  assert.equal(h.writes.length, 0, 'zapis wariantu nie dotyka wyceny ani finansów projektu')
  assert.deepEqual(h.variantWrites, [{ projectId: 'p1', variantId: 'qv-b' }])
  const saved = h.project('p1')
  assert.equal(saved.quote, a)
  assert.equal(saved.financials, financialsBefore)
  const savedB = saved.quoteVariants?.find((v) => v.id === 'qv-b')
  assert.equal((savedB?.snapshot?.data as QuoteData).dniDokumentacji, 5)
  assert.deepEqual(savedB?.snapshot?.pdfDraft, { terminZdjec: 'grudzień' })
  assert.equal(saved.quoteVariants?.find((v) => v.id === 'qv-c')?.snapshot, C, 'C nietknięty')

  // Edycja A nie rusza B.
  h.store.edit('p1', setDays(2))
  await h.elapse()
  assert.equal(h.store.get('p1#qv-b').data.dniDokumentacji, 5)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].patch.financials?.sumaNetto, sumaNetto(docToSnapshot(h.store.get('p1'), NOW)))
})

test('finanse z importu: wariant zapisuje się bez pytania, edycja A dalej pyta', async () => {
  const h = harness([project('retro', { financials: IMPORTED, quoteVariants: [variant('qv-b', 'B', null)] })])
  h.store.edit('retro#qv-b', setDays(3))
  await h.elapse()
  assert.equal(h.store.state('retro#qv-b').status, 'saved')
  assert.equal(h.project('retro').financials, IMPORTED)
  assert.equal((h.project('retro').quoteVariants?.[0].snapshot?.data as QuoteData).dniDokumentacji, 3)

  h.store.edit('retro', setDays(2))
  await h.elapse()
  assert.equal(h.store.state('retro').status, 'needs-confirmation')
  // Zamiana zgubiłaby zmiany czekające na „Zastąp" — najpierw decyzja.
  assert.equal(await h.choose('retro', 'qv-b'), 'blocked')
  assert.equal(h.project('retro').financials, IMPORTED)
})

test('wybór B z niezapisanymi zmianami w A i B: obie zapisane, potem zamiana i nowe dokumenty', async () => {
  const h = harness([quoted('p1', A, { status: 'won', quoteVariants: [variant('qv-b', 'B', B)] })])
  h.store.edit('p1', setDays(7))
  h.store.edit('p1#qv-b', setDays(9))
  const epochBefore = h.store.state('p1').epoch
  assert.equal(await h.choose('p1', 'qv-b'), 'ready')

  const p = h.project('p1')
  assert.equal((p.quote?.data as QuoteData).dniDokumentacji, 9, 'wybrany = B z ostatnią zmianą')
  assert.equal(p.financials?.sumaNetto, sumaNetto(p.quote))
  const a = p.quoteVariants?.find((v) => v.id === MAIN_VARIANT_ID)
  assert.equal((a?.snapshot?.data as QuoteData).dniDokumentacji, 7, 'A z ostatnią zmianą jako wariant')
  // Dokumenty budują się z projektu: klucz projektu = B, A pod swoim kluczem.
  assert.equal(h.store.get('p1').data.dniDokumentacji, 9)
  assert.equal(h.store.get(variantDocId(p, MAIN_VARIANT_ID)).data.dniDokumentacji, 7)
  assert.equal(h.store.state('p1').changedThisSession, false, 'nowy punkt „Cofnij zmiany z tej sesji"')
  assert.equal(h.store.state('p1').epoch, 0)
  assert.ok(epochBefore >= 0)
  assert.deepEqual(h.store.pendingIds(), [])
})

test('„Cofnij zmiany z tej sesji" działa na każdy dokument osobno', async () => {
  const h = harness([quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', B)] })])
  h.store.edit('p1', setDays(3))
  h.store.edit('p1#qv-b', setDays(8))
  await h.elapse()
  const financialsA = h.project('p1').financials

  await h.store.restoreSession('p1#qv-b')
  assert.equal(h.project('p1').quoteVariants?.[0].snapshot, B, 'B jak przy otwarciu')
  assert.equal(h.store.get('p1#qv-b').data.dniDokumentacji, 4)
  assert.equal(h.store.get('p1').data.dniDokumentacji, 3, 'A nietknięta')
  assert.equal(h.project('p1').financials, financialsA)

  await h.store.restoreSession('p1')
  assert.equal(h.project('p1').quote, A)
})

test('porzucenie: id projektu porzuca też warianty, klucz wariantu tylko jego', async () => {
  const h = harness([quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', B), variant('qv-c', 'C', C)] })])
  h.store.edit('p1#qv-b', setDays(6))
  h.store.edit('p1#qv-c', setDays(6))
  h.store.forget('p1#qv-b')
  assert.equal(h.store.get('p1#qv-b').data.dniDokumentacji, 4)
  assert.equal(h.store.get('p1#qv-c').data.dniDokumentacji, 6)
  h.store.forget('p1')
  assert.equal(h.store.get('p1#qv-c').data.dniDokumentacji, 2)
  await h.elapse()
  assert.deepEqual(h.variantWrites, [], 'porzucone timery nie zapisują')
})

test('flushProject zapisuje wszystkie dokumenty projektu, nie innych', async () => {
  const h = harness([
    quoted('p1', A, { quoteVariants: [variant('qv-b', 'B', B)] }),
    quoted('p2', A),
  ])
  h.store.edit('p1', setDays(2))
  h.store.edit('p1#qv-b', setDays(3))
  h.store.edit('p2', setDays(5))
  await h.store.flushProject('p1')
  assert.deepEqual(h.writes.map((w) => w.id), ['p1'])
  assert.deepEqual(h.variantWrites, [{ projectId: 'p1', variantId: 'qv-b' }])
  assert.deepEqual(h.store.pendingIds(), ['p2'])
})

test('restart: warianty z PDF i nazwy wracają z projects, wybrany liczy finanse, wariant nie', async () => {
  const a = createProject({ name: 'Morris & Lloyd', client: 'Morris & Lloyd', quote: snap({ dniDokumentacji: 1 }), existing: [] })
  await replaceAllProjects([a])
  let list = await listAllProjects()
  const open = () =>
    createQuoteDocumentStore({
      getProject: (id) => list.find((p) => p.id === id) ?? null,
      defaultPricing: () => null,
      write: async (id, patch) => {
        const current = list.find((p) => p.id === id) as Project
        list = await upsertProject({ ...current, ...patch, updatedAt: NOW.toISOString() })
      },
      writeVariant: async (projectId, variantId, snapshot) => {
        const current = list.find((p) => p.id === projectId) as Project
        const patch = variantSnapshotPatch(current, variantId, snapshot, NOW)
        if (patch) list = await upsertProject({ ...current, ...patch })
      },
    })
  const store = open()
  const current = list.find((p) => p.id === a.id) as Project
  const added = addVariantPatch(current, { id: 'qv-b', snapshot: docToSnapshot(store.get(a.id), NOW), now: NOW })
  list = await upsertProject({ ...current, ...added.patch })
  store.edit(`${a.id}#qv-b`, (doc) => ({
    ...doc,
    data: { ...doc.data, dniDokumentacji: 4, currency: 'EUR', exchangeRate: 4.3 },
    pdfDraft: { terminZdjec: '2 dni' },
  }))
  await store.flushAll()

  list = await listAllProjects()
  const reopened = open()
  const saved = list.find((p) => p.id === a.id) as Project
  assert.equal(saved.quoteLabel, 'A')
  assert.deepEqual(listVariants(saved).map((v) => v.label), ['A', 'B'])
  const b = reopened.get(`${a.id}#qv-b`)
  assert.equal(b.data.dniDokumentacji, 4)
  assert.equal(b.data.currency, 'EUR', 'EUR tylko w B')
  assert.deepEqual(b.pdfDraft, { terminZdjec: '2 dni' })
  assert.notEqual(reopened.get(a.id).data.currency, 'EUR')
  assert.equal(saved.financials, null, 'wariant niczego nie policzył — A nie była edytowana')
})
