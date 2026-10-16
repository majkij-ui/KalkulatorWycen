/**
 * Wycena jako dokument projektu (Q1): magazyn `quote-documents.ts`.
 *
 * Przypadki z życia (PLAN-AFTER-TEST-DRIVE §8): brak przecieków między
 * projektami, zapis po chwili i przy wyjściu, ochrona finansów z importu,
 * „Cofnij zmiany z tej sesji", stara wycena liczy się identycznie, a na końcu
 * pełny restart na ścieżce webowej (localStorage) przez `project-library`.
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
  blankDoc,
  createQuoteDocumentStore,
  docFromProject,
  docFromSnapshot,
  docToSnapshot,
  type QuoteDoc,
  type QuoteDocPatch,
} from './quote-documents'
import { computeSnapshotFinancials, mergeQuoteDataPartial } from './quote-financials'
import { DEFAULT_PRICING, type PricingConfigShape } from './pricing-config'
import type { Project, ProjectFinancials } from './project-types'
import type { QuoteSnapshot } from './quote-library'
import type { QuoteData } from './quote-types'
import { createProject, listAllProjects, replaceAllProjects, upsertProject } from './project-library'

const NOW = new Date('2026-10-16T12:00:00.000Z')

/** Cennik domyślny użytkownika („Zapisz stawki jako domyślne"). */
const MY_DEFAULT: PricingConfigShape = {
  ...DEFAULT_PRICING,
  preprodukcja: { ...DEFAULT_PRICING.preprodukcja, dzienDokumentacji: 1111 },
}

const pricing = (dzienDokumentacji: number): PricingConfigShape => ({
  ...DEFAULT_PRICING,
  preprodukcja: { ...DEFAULT_PRICING.preprodukcja, dzienDokumentacji },
})

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

/** Finanse z retro-importu — prawdziwy przychód, nie z kalkulatora. */
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

/** Projekt z wyceną i finansami z tej wyceny — tak, jak zapisuje go hub. */
function quoted(id: string, quote: QuoteSnapshot, overrides: Partial<Project> = {}): Project {
  return project(id, { quote, financials: computeSnapshotFinancials(quote, NOW), ...overrides })
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Magazyn na projektach w pamięci. `write` łata projekt jak hub; `fileCopy`
 * udaje odczyt z pliku po zapisie (nowe obiekty, ten sam JSON).
 */
function harness(initial: Project[], options: { fileCopy?: boolean } = {}) {
  let projects = initial
  const writes: { id: string; patch: QuoteDocPatch }[] = []
  const timers = new Map<number, () => void>()
  let seq = 0
  let failures = 0
  let gate: Promise<void> | null = null

  const store = createQuoteDocumentStore({
    getProject: (id) => projects.find((p) => p.id === id) ?? null,
    defaultPricing: () => MY_DEFAULT,
    write: async (id, patch) => {
      if (gate) await gate
      if (failures > 0) {
        failures -= 1
        throw new Error('Brak miejsca na dysku')
      }
      writes.push({ id, patch })
      const stored = options.fileCopy ? (JSON.parse(JSON.stringify(patch)) as QuoteDocPatch) : patch
      projects = projects.map((p) => (p.id === id ? { ...p, ...stored } : p))
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
    project: (id: string) => projects.find((p) => p.id === id) as Project,
    replaceProject: (next: Project) => {
      projects = projects.map((p) => (p.id === next.id ? next : p))
    },
    removeProject: (id: string) => {
      projects = projects.filter((p) => p.id !== id)
    },
    timerCount: () => timers.size,
    /** Upływa opóźnienie zapisu. */
    async elapse() {
      const due = [...timers.values()]
      timers.clear()
      due.forEach((fn) => fn())
      await settle()
    },
    failNextWrites: (count: number) => {
      failures = count
    },
    holdWrites() {
      let release = () => {}
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null
          resolve()
        }
      })
      return release
    },
  }
}

const setField = <K extends keyof QuoteData>(key: K, value: QuoteData[K]) => (doc: QuoteDoc): QuoteDoc => ({
  ...doc,
  data: { ...doc.data, [key]: value },
})

// ── Dokument ↔ migawka ───────────────────────────────────────────────────────

test('stara wycena otwarta i zapisana z powrotem liczy się identycznie', () => {
  const fixtures: Record<string, Partial<QuoteSnapshot> & Record<string, unknown>> = {
    // Kształt ze starej aplikacji: niepełne dane, stary cennik, marża, szkic PDF.
    'stara aplikacja v2': {
      version: 2,
      savedAt: '2026-07-27T10:00:00.000Z',
      data: { clientName: 'Dräger', projectName: 'Pakiet', dniDokumentacji: 1, dniMontazu: 2, isDetailedProdukcja: false, dniZdjeciowe: 2, wielkoscEkipy: 3 } as Partial<QuoteData> as QuoteData,
      pricingConfig: { produkcja: { stawkaOperatoraSzybkaWycena: 1700 }, postprodukcja: { montazZaDzien: 1400 } } as unknown as PricingConfigShape,
      marginMultiplier: 1.15,
      pdfDraft: { clientName: 'Dräger', rows: { preprodukcja: { cenaNetto: 900, opis: 'ręcznie' } } },
    },
    'bez cennika i marży': { data: { dniDokumentacji: 2, includeCatering: true } as Partial<QuoteData> as QuoteData },
    'wycena w EUR po kursie': {
      ...snap({ dniDokumentacji: 3, currency: 'EUR', exchangeRate: 4.3699, exchangeRateSource: 'nbp' } as Partial<QuoteData>),
      pricingConfig: pricing(1500),
      marginMultiplier: 1.1,
    },
    'pole z nowszej wersji': { ...snap({ dniDokumentacji: 1 }), variantLabel: 'A' },
  }

  for (const [name, original] of Object.entries(fixtures)) {
    const doc = docFromSnapshot(original)
    assert.ok(doc, name)
    const resaved = docToSnapshot(doc, NOW)
    assert.deepEqual(computeSnapshotFinancials(resaved, NOW), computeSnapshotFinancials(original, NOW), name)
    assert.deepEqual(resaved.pdfDraft, original.pdfDraft ?? null, `${name}: szkic PDF bez zmian`)
    assert.deepEqual(docFromSnapshot(resaved), doc, `${name}: drugi obrót niczego nie zmienia`)
  }
  const roundTrip = docToSnapshot(docFromSnapshot(fixtures['pole z nowszej wersji'])!) as unknown as Record<string, unknown>
  assert.equal(roundTrip.variantLabel, 'A', 'nieznane pole zostaje')
  assert.equal(docFromSnapshot({ version: 2 }), null, 'migawka bez danych to nie wycena')
})

test('pusta wycena: klient projektu, mój domyślny cennik (bez niego fabryczny), marża 0 %', () => {
  const doc = docFromProject(project('lead', { client: 'Zabudowy' }), MY_DEFAULT)
  assert.equal(doc.data.clientName, 'Zabudowy')
  assert.equal(doc.pricingConfig, MY_DEFAULT)
  assert.equal(doc.marginMultiplier, 1)
  assert.equal(doc.pdfDraft, null)
  assert.deepEqual(blankDoc('', null).pricingConfig, DEFAULT_PRICING)
})

// ── Magazyn ──────────────────────────────────────────────────────────────────

test('brak przecieków: każdy projekt ma swoje dane, cennik, marżę i PDF', async () => {
  const a = quoted('A', snap({ clientName: 'Morris & Lloyd', dniDokumentacji: 1 }, { pricingConfig: pricing(1000), pdfDraft: { terminZdjec: 'A' } }))
  const b = quoted('B', snap({ clientName: 'Tchibo', dniDokumentacji: 2 }, { pricingConfig: pricing(2000), marginMultiplier: 1.2 }))
  const lead = project('L', { client: 'S&A jewellery' })
  const h = harness([a, b, lead])

  h.store.edit('A', setField('dniDokumentacji', 5))
  h.store.edit('A', (doc) => ({ ...doc, pricingConfig: pricing(1234), marginMultiplier: 0.9 }))

  const docB = h.store.get('B')
  assert.equal(docB.data.clientName, 'Tchibo')
  assert.equal(docB.data.dniDokumentacji, 2)
  assert.equal(docB.pricingConfig.preprodukcja.dzienDokumentacji, 2000)
  assert.equal(docB.marginMultiplier, 1.2)
  assert.equal(docB.pdfDraft, null, 'B nie dostaje szkicu PDF z A')

  const docL = h.store.get('L')
  assert.equal(docL.data.clientName, 'S&A jewellery', 'lead nie dostaje klienta z A')
  assert.equal(docL.data.dniDokumentacji, 0)
  assert.equal(docL.pricingConfig, MY_DEFAULT, 'nowa wycena od mojego domyślnego cennika, nie od cennika A')

  h.store.edit('B', (doc) => ({ ...doc, pricingConfig: pricing(2500) }))
  assert.equal(h.store.get('A').pricingConfig.preprodukcja.dzienDokumentacji, 1234, 'cennik B nie zmienia A')
  assert.deepEqual(h.store.get('A').pdfDraft, { terminZdjec: 'A' })

  await h.elapse()
  assert.deepEqual(h.writes.map((w) => w.id).sort(), ['A', 'B'])
  const writtenA = h.project('A').quote as QuoteSnapshot
  assert.equal(writtenA.pricingConfig.preprodukcja.dzienDokumentacji, 1234)
  assert.equal((h.project('B').quote as QuoteSnapshot).pricingConfig.preprodukcja.dzienDokumentacji, 2500)
  assert.equal(h.project('L').quote, null, 'lead nietknięty')
})

test('zapis po chwili: seria zmian = jeden zapis z finansami policzonymi z wyceny', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 }))])
  h.store.edit('A', setField('dniDokumentacji', 2))
  h.store.edit('A', setField('dniDokumentacji', 3))
  h.store.edit('A', setField('dniDokumentacji', 3))
  assert.equal(h.writes.length, 0, 'nic przed upływem opóźnienia')
  assert.equal(h.store.state('A').status, 'pending')

  await h.elapse()
  assert.equal(h.writes.length, 1)
  const written = h.writes[0].patch
  assert.equal((written.quote as QuoteSnapshot).data.dniDokumentacji, 3)
  assert.deepEqual(written.financials, computeSnapshotFinancials(written.quote as QuoteSnapshot, NOW))
  assert.equal(h.store.state('A').status, 'saved')
  assert.equal(h.store.state('A').changedThisSession, true)
})

test('zmiana na tę samą wartość to nie zmiana — nic się nie zapisuje', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 }))])
  h.store.edit('A', (doc) => doc)
  await h.elapse()
  assert.equal(h.writes.length, 0)
  assert.equal(h.store.state('A').changedThisSession, false)
})

test('wyjście z projektu zapisuje od razu: flush jednego, flushAll wszystkich', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 })), quoted('B', snap({ dniDokumentacji: 1 }))])
  h.store.edit('A', setField('dniDokumentacji', 4))
  h.store.edit('B', setField('dniDokumentacji', 6))

  await h.store.flush('A')
  assert.deepEqual(h.writes.map((w) => w.id), ['A'], 'A zapisane bez czekania, B jeszcze czeka')
  assert.equal(h.timerCount(), 1)

  await h.store.flushAll()
  assert.deepEqual(h.writes.map((w) => w.id), ['A', 'B'])
  assert.equal(h.timerCount(), 0)
  await h.elapse()
  assert.equal(h.writes.length, 2, 'po zapisie timer nie zapisuje drugi raz')
})

test('A → B → A: wracasz do swojej wyceny, także zanim się zapisała', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 })), quoted('B', snap({ dniDokumentacji: 1 }))])
  h.store.edit('A', setField('dniDokumentacji', 7))
  h.store.get('B')
  h.store.edit('B', setField('dniDokumentacji', 8))
  assert.equal(h.store.get('A').data.dniDokumentacji, 7, 'bufor A przeżywa pracę w B')
  await h.store.flushAll()
  assert.equal(h.store.get('A').data.dniDokumentacji, 7)
  assert.equal(h.store.get('B').data.dniDokumentacji, 8)
})

test('finanse z importu: pierwsza zmiana pyta raz, do odpowiedzi nic nie trafia do pliku', async () => {
  const h = harness([project('R', { status: 'done', financials: IMPORTED })])
  h.store.edit('R', setField('dniDokumentacji', 1))
  await h.elapse()
  assert.equal(h.writes.length, 0)
  const asked = h.store.state('R')
  assert.equal(asked.status, 'needs-confirmation')
  assert.deepEqual(asked.prompt?.current, IMPORTED)
  assert.deepEqual(asked.prompt?.proposed, computeSnapshotFinancials(docToSnapshot(h.store.get('R'), NOW), NOW))

  // Kolejne zmiany czekają razem z pierwszą — bez timera i bez zapisu.
  h.store.edit('R', setField('dniDokumentacji', 2))
  assert.equal(h.timerCount(), 0)
  await h.store.flushAll()
  assert.equal(h.writes.length, 0)
  assert.equal(h.project('R').financials, IMPORTED)

  await h.store.confirmReplace('R')
  assert.equal(h.writes.length, 1)
  const quote = h.project('R').quote as QuoteSnapshot
  assert.equal(quote.data.dniDokumentacji, 2, 'zapisuje się wycena ze wszystkimi zmianami')
  assert.deepEqual(h.project('R').financials, computeSnapshotFinancials(quote, NOW))
  assert.equal(h.store.state('R').status, 'saved')

  // Projekt ma już wycenę — następne zmiany zapisują się bez pytania.
  h.store.edit('R', setField('dniDokumentacji', 3))
  await h.elapse()
  assert.equal(h.writes.length, 2)
})

test('finanse z importu: „Cofnij zmiany" porzuca wycenę, następna zmiana pyta znowu', async () => {
  const h = harness([project('R', { status: 'done', financials: IMPORTED })])
  h.store.edit('R', setField('dniDokumentacji', 1))
  await h.elapse()
  assert.equal(h.store.state('R').status, 'needs-confirmation')

  const epoch = h.store.state('R').epoch
  h.store.discard('R')
  assert.equal(h.store.get('R').data.dniDokumentacji, 0, 'z powrotem pusta wycena')
  assert.equal(h.store.state('R').status, 'saved')
  assert.ok(h.store.state('R').epoch > epoch, 'zakładki dostają nowy dokument')
  assert.equal(h.store.state('R').changedThisSession, false, 'nic nie zapisano — nie ma czego cofać')

  h.store.edit('R', setField('kierownikProdukcji', true))
  await h.elapse()
  assert.equal(h.store.state('R').status, 'needs-confirmation')
  assert.equal(h.writes.length, 0)
  assert.equal(h.project('R').financials, IMPORTED)
})

test('zmiany ciche (poprawki szkicu PDF) nie zapisują — jadą z następną zmianą', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 }, { pdfDraft: { currency: 'PLN' } }))])
  h.store.edit('A', (doc) => ({ ...doc, pdfDraft: { currency: 'PLN', followsQuote: true } }), { silent: true })
  await h.elapse()
  assert.equal(h.writes.length, 0, 'samo obejrzenie PDF niczego nie zapisuje')
  assert.equal(h.store.state('A').changedThisSession, false)
  assert.deepEqual(h.store.get('A').pdfDraft, { currency: 'PLN', followsQuote: true })

  h.store.edit('A', setField('dniDokumentacji', 2))
  await h.elapse()
  assert.deepEqual((h.writes[0].patch.quote as QuoteSnapshot).pdfDraft, { currency: 'PLN', followsQuote: true })
})

test('zmiana z zewnątrz podmienia dokument, gdy nic nie czeka; czekające zmiany wygrywają', () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 })), quoted('B', snap({ dniDokumentacji: 1 }))])
  const before = h.store.get('A')
  const epoch = h.store.state('A').epoch
  // „Scal osoby" przepisuje wycenę w projekcie.
  h.replaceProject(quoted('A', snap({ dniDokumentacji: 9 })))
  assert.equal(h.store.get('A').data.dniDokumentacji, 9)
  assert.notEqual(h.store.get('A'), before)
  assert.equal(h.store.state('A').epoch, epoch + 1)

  h.store.edit('B', setField('dniDokumentacji', 4))
  h.replaceProject(quoted('B', snap({ dniDokumentacji: 9 })))
  assert.equal(h.store.get('B').data.dniDokumentacji, 4)
})

test('kopia z pliku po zapisie to ten sam dokument — bez nowego epoch', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 }))], { fileCopy: true })
  h.store.edit('A', setField('dniDokumentacji', 2))
  const edited = h.store.get('A')
  const epoch = h.store.state('A').epoch
  await h.store.flush('A')
  assert.notEqual(h.project('A').quote, h.writes[0].patch.quote, 'w projekcie leży kopia z pliku')
  assert.equal(h.store.get('A'), edited)
  assert.equal(h.store.state('A').epoch, epoch)
})

test('lead: pusta wycena idzie za klientem; nietknięta nie zakłada wyceny; edytowany PDF zakłada', async () => {
  const h = harness([project('L', { client: 'S&A' })])
  assert.equal(h.store.get('L').data.clientName, 'S&A')
  h.replaceProject(project('L', { client: 'S&A jewellery design' }))
  assert.equal(h.store.get('L').data.clientName, 'S&A jewellery design', 'zmiana klienta w nagłówku')

  h.store.edit('L', (doc) => ({ ...doc, marginMultiplier: 1.2 }))
  await h.elapse()
  assert.equal(h.writes.length, 0, 'sama marża bez pozycji to nie wycena')
  assert.equal(h.project('L').quote, null)
  assert.deepEqual(h.store.pendingIds(), [], 'nic nie czeka na zapis')
  h.replaceProject(project('L', { client: 'S&A Jewellery' }))
  assert.equal(h.store.get('L').data.clientName, 'S&A Jewellery', 'pusta wycena dalej idzie za klientem')

  h.store.edit('L', (doc) => ({ ...doc, pdfDraft: { terminZdjec: 'listopad' } }))
  await h.elapse()
  assert.equal(h.writes.length, 1)
  assert.deepEqual((h.project('L').quote as QuoteSnapshot).pdfDraft, { terminZdjec: 'listopad' })
})

test('„Cofnij zmiany z tej sesji": wycena i finanse jak przy otwarciu (także „brak wyceny")', async () => {
  const original = snap({ dniDokumentacji: 1 })
  const a = quoted('A', original)
  const h = harness([a, project('R', { status: 'done', financials: IMPORTED })])

  h.store.get('A')
  h.store.edit('A', (doc) => blankDoc(doc.data.clientName, MY_DEFAULT), { replace: true })
  await h.elapse()
  assert.equal((h.project('A').quote as QuoteSnapshot).data.dniDokumentacji, 0, 'wyczyszczona wycena zapisała się')

  await h.store.restoreSession('A')
  assert.equal(h.project('A').quote, original)
  assert.deepEqual(h.project('A').financials, a.financials)
  assert.equal(h.store.get('A').data.dniDokumentacji, 1)
  assert.equal(h.store.state('A').changedThisSession, false)

  h.store.edit('R', setField('dniDokumentacji', 2))
  await h.elapse()
  await h.store.confirmReplace('R')
  assert.ok(h.project('R').quote)
  await h.store.restoreSession('R')
  assert.equal(h.project('R').quote, null, 'retro-projekt znowu bez wyceny')
  assert.equal(h.project('R').financials, IMPORTED)
  assert.equal(h.store.get('R').data.dniDokumentacji, 0)
})

test('błąd zapisu: zmiany zostają w pamięci, kolejna próba zapisuje', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 }))])
  h.failNextWrites(1)
  h.store.edit('A', setField('dniDokumentacji', 2))
  await h.elapse()
  assert.equal(h.store.state('A').status, 'error')
  assert.match(h.store.state('A').error ?? '', /dysku/)
  assert.equal(h.store.get('A').data.dniDokumentacji, 2)
  assert.deepEqual(h.store.pendingIds(), ['A'])

  await h.store.flush('A')
  assert.equal(h.store.state('A').status, 'saved')
  assert.equal((h.project('A').quote as QuoteSnapshot).data.dniDokumentacji, 2)
})

test('zmiana w trakcie zapisu zapisuje się kolejnym zapisem', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 }))])
  const release = h.holdWrites()
  h.store.edit('A', setField('dniDokumentacji', 2))
  const saving = h.store.flush('A')
  await settle()
  assert.equal(h.store.state('A').status, 'saving')
  h.store.edit('A', setField('dniDokumentacji', 3))
  assert.equal(h.store.get('A').data.dniDokumentacji, 3)
  release()
  await saving
  assert.equal(h.writes.length, 1)
  assert.equal(h.store.state('A').status, 'pending')
  await h.elapse()
  assert.equal(h.writes.length, 2)
  assert.equal((h.project('A').quote as QuoteSnapshot).data.dniDokumentacji, 3)
})

test('usunięty projekt: zmiany nie trafiają do pliku, dokument można porzucić', async () => {
  const h = harness([quoted('A', snap({ dniDokumentacji: 1 })), quoted('B', snap({ dniDokumentacji: 1 }))])
  h.store.edit('A', setField('dniDokumentacji', 2))
  h.removeProject('A')
  await h.store.flush('A')
  assert.equal(h.writes.length, 0)

  // Porzucony dokument: bez zapisu po opóźnieniu, a przywrócony projekt wraca ze swojej wyceny.
  h.store.edit('B', setField('dniDokumentacji', 5))
  h.store.forget('B')
  assert.deepEqual(h.store.pendingIds(), [])
  assert.equal(h.timerCount(), 0)
  assert.equal(h.store.get('B').data.dniDokumentacji, 1)
})

// ── Restart (ścieżka webowa: localStorage przez project-library) ─────────────

test('restart: wycena, cennik, marża i szkic PDF wracają z projects; nic globalnego', async () => {
  const a = createProject({ name: 'Morris & Lloyd', client: 'Morris & Lloyd', quote: snap({ dniDokumentacji: 1 }), existing: [] })
  const lead = createProject({ name: 'S&A', client: 'S&A', existing: [a] })
  await replaceAllProjects([a, lead])

  let list = await listAllProjects()
  const open = () =>
    createQuoteDocumentStore({
      getProject: (id) => list.find((p) => p.id === id) ?? null,
      defaultPricing: () => MY_DEFAULT,
      write: async (id, patch) => {
        const current = list.find((p) => p.id === id) as Project
        list = await upsertProject({ ...current, ...patch, updatedAt: NOW.toISOString() })
      },
    })

  const store = open()
  store.edit(a.id, (doc) => ({
    ...doc,
    data: { ...doc.data, dniDokumentacji: 3, currency: 'EUR', exchangeRate: 4.3 },
    pricingConfig: pricing(1300),
    marginMultiplier: 1.25,
    pdfDraft: { terminZdjec: '20.11', uwagiManualText: 'Dojazd w cenie' },
  }))
  store.edit(lead.id, (doc) => ({ ...doc, pdfDraft: { terminZdjec: 'grudzień' } }))
  const edited = store.get(a.id)
  await store.flushAll()

  // Zamknięcie i ponowne uruchomienie: nowy magazyn, projekty prosto z pamięci przeglądarki.
  list = await listAllProjects()
  const reopened = open()
  const back = reopened.get(a.id)
  assert.deepEqual(back.data, edited.data)
  assert.deepEqual(back.pricingConfig, edited.pricingConfig)
  assert.equal(back.marginMultiplier, 1.25)
  assert.deepEqual(back.pdfDraft, { terminZdjec: '20.11', uwagiManualText: 'Dojazd w cenie' })
  const saved = list.find((p) => p.id === a.id) as Project
  const { computedAt: _a, ...savedFinancials } = saved.financials as ProjectFinancials
  const { computedAt: _b, ...expected } = computeSnapshotFinancials(docToSnapshot(edited), NOW) as ProjectFinancials
  assert.deepEqual(savedFinancials, expected)
  assert.deepEqual(reopened.get(lead.id).pdfDraft, { terminZdjec: 'grudzień' })

  const keys = Array.from({ length: (globals.localStorage as MemoryStorage).length }, (_, i) =>
    (globals.localStorage as MemoryStorage).key(i)
  )
  assert.deepEqual(keys, ['nonoise-projects-v1'], 'bez globalnego stanu kalkulatora i szkicu PDF')
})
