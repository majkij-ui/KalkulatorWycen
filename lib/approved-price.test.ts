/**
 * U1 — zatwierdzona cena (plan §18 U-CENA, decyzje 18.3/4 i U1/1): kolejność
 * przychodu planu w jednej funkcji, zamrożenie przy przyjęciu zlecenia i przy
 * wyborze wariantu w przyjętym zleceniu, kopia wariantu bez ceny, odczyt
 * zepsutego zapisu, starsze wersje.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAcceptance, statusChangePatch, withFrozenPrice, withoutApprovedPrice } from './approved-price'
import { isTypedTransfer, projectMoney } from './money-loop'
import { DEFAULT_PRICING } from './pricing-config'
import { projectFinancialsSchema, type Project, type ProjectFinancials } from './project-types'
import {
  approvedPriceRecord,
  computeSnapshotFinancials,
  freezeApprovedPrice,
  mergeQuoteDataPartial,
  planRevenue,
  snapshotPlanRevenue,
  typedApprovedPrice,
} from './quote-financials'
import type { QuoteSnapshot } from './quote-library'
import type { QuoteData } from './quote-types'
import { addVariantPatch, chooseVariantPlan } from './quote-variants'

const NOW = new Date('2026-10-24T10:00:00.000Z')
const AT = NOW.toISOString()

const pdf = (rows: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  currency: 'PLN',
  exchangeRate: 4.3,
  rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { cenaNetto: v, opis: '' }])),
  ...extra,
})

function snap(data: Partial<QuoteData>, pdfDraft: unknown = null): QuoteSnapshot {
  return { version: 2, savedAt: '2026-10-01T09:00:00.000Z', data: mergeQuoteDataPartial(data), pricingConfig: DEFAULT_PRICING, marginMultiplier: 1, pdfDraft } as QuoteSnapshot
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p',
    name: 'p',
    client: 'K',
    status: 'quote',
    date: '2026-10-01',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    quote: null,
    financials: null,
    equipment: [],
    notes: '',
    ...overrides,
  } as Project
}

const quoted = (quote: QuoteSnapshot, overrides: Partial<Project> = {}) =>
  project({ quote, financials: computeSnapshotFinancials(quote, NOW), ...overrides })

const dataOf = (s: unknown) => (s as { data: QuoteData }).data
const revenueOf = (s: QuoteSnapshot | null | undefined) => snapshotPlanRevenue(s)!

// ── Kolejność przychodu planu ────────────────────────────────────────────────

test('planRevenue: kwota przelewu → zatwierdzona cena → PDF → kalkulator (jedna funkcja)', () => {
  const calc = revenueOf(snap({ dniDokumentacji: 1 }))
  assert.equal(calc.source, 'calculator')
  assert.equal(calc.pln, calc.live.calculatorPln)
  const withPdf = revenueOf(snap({ dniDokumentacji: 1 }, pdf({ ekipa: 5000 })))
  assert.deepEqual([withPdf.source, withPdf.pln, withPdf.approvedPln, withPdf.frozen], ['pdf', 5000, 5000, null])
  const approved = revenueOf(snap({ dniDokumentacji: 1, approvedPrice: { pln: 4800, source: 'pdf', at: AT } }, pdf({ ekipa: 5000 })))
  assert.deepEqual([approved.source, approved.pln, approved.live.pln], ['approved', 4800, 5000])
  const typed = revenueOf(snap({ dniDokumentacji: 1, profitTransferAmount: 7000, approvedPrice: { pln: 4800, source: 'pdf', at: AT } }, pdf({ ekipa: 5000 })))
  assert.deepEqual([typed.source, typed.pln, typed.typedTransfer, typed.approvedPln], ['transfer', 7000, 7000, 4800])
})

test('financials: przychód i `revenueSource` z planRevenue; starsza wersja czyta „approved" jako brak (cena + dosprzedaż)', () => {
  const quote = snap({ approvedPrice: { pln: 4800, source: 'typed', at: AT } }, pdf({ ekipa: 5000 }))
  const fin = computeSnapshotFinancials(quote, NOW)!
  assert.deepEqual([fin.sumaNetto, fin.revenueSource], [4800, 'approved'])
  // Zatwierdzona cena to NIE kwota przelewu: dosprzedaż się dolicza.
  const money = projectMoney({ id: 'p', status: 'won', date: '2026-10-01', financials: fin, costs: [], quote }, [
    { id: 'x', kind: 'extra_sale', start: '2026-10-02', projectId: 'p', data: { amountNetto: 500 } },
  ], '2026-10-24')
  assert.equal(isTypedTransfer({ financials: fin, quote }), false)
  assert.equal(money.revenue, 5300)
  const older = projectFinancialsSchema.parse({ ...fin, revenueSource: 'cokolwiek' }) as ProjectFinancials
  assert.equal(older.revenueSource, undefined)
})

test('zepsuty zapis ceny = brak (cena idzie za PDF); EUR pamięta kwotę i kurs', () => {
  for (const bad of [null, 'x', { pln: -1, source: 'pdf' }, { pln: Number.NaN, source: 'pdf' }, { pln: 100, source: 'inne' }, { source: 'pdf' }]) {
    assert.equal(approvedPriceRecord(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(approvedPriceRecord({ pln: 100, source: 'typed', at: 7, extra: 1 }), { pln: 100, source: 'typed', at: '' })
  assert.deepEqual(approvedPriceRecord({ pln: 6374.5, source: 'pdf', at: AT, currency: 'EUR', amount: 1460, rate: 4.3661 }), {
    pln: 6374.5,
    source: 'pdf',
    at: AT,
    currency: 'EUR',
    amount: 1460,
    rate: 4.3661,
  })
  assert.deepEqual(approvedPriceRecord({ pln: 10, source: 'pdf', at: AT, currency: 'EUR' }), { pln: 10, source: 'pdf', at: AT }, 'EUR bez kwoty — tylko zł')
  const broken = revenueOf(snap({ approvedPrice: { pln: 'dużo' } as never }, pdf({ ekipa: 5000 })))
  assert.deepEqual([broken.source, broken.pln], ['pdf', 5000])
  assert.deepEqual(typedApprovedPrice(12500, AT), { pln: 12500, source: 'typed', at: AT })
  const eur = planRevenue(mergeQuoteDataPartial({ currency: 'EUR', exchangeRate: 4.3661 } as Partial<QuoteData>), DEFAULT_PRICING, 1, pdf({ ekipa: 1460 }, { currency: 'EUR' }))
  assert.deepEqual(freezeApprovedPrice(eur.live, AT), { pln: 1460 * 4.3661, source: 'pdf', at: AT, amount: 1460, currency: 'EUR', rate: 4.3661 })
})

// ── Przyjęcie zlecenia ───────────────────────────────────────────────────────

test('przyjęcie (Wycena → W realizacji / Zrealizowany) zamraża PDF wybranego wariantu; przychód się nie zmienia', () => {
  const quote = snap({ dniDokumentacji: 1 }, pdf({ ekipa: 22250 }))
  const p = quoted(quote)
  for (const next of ['won', 'done'] as const) {
    const patch = statusChangePatch(p, next, NOW)
    assert.equal(patch.status, next)
    assert.deepEqual(dataOf(patch.quote).approvedPrice, { pln: 22250, source: 'pdf', at: AT })
    assert.equal(patch.financials!.sumaNetto, p.financials!.sumaNetto)
    assert.equal(patch.financials!.revenueSource, 'approved')
    // Reszta wyceny nietknięta (ten sam szkic PDF, cennik, nieznane pola).
    assert.equal((patch.quote as QuoteSnapshot).pdfDraft, quote.pdfDraft)
    assert.equal(dataOf(patch.quote).dniDokumentacji, 1)
  }
  // Po zamrożeniu zmiana PDF nie rusza przychodu.
  const accepted = { ...p, ...statusChangePatch(p, 'won', NOW) }
  const edited = { ...(accepted.quote as QuoteSnapshot), pdfDraft: pdf({ ekipa: 22750 }) }
  assert.equal(computeSnapshotFinancials(edited, NOW)!.sumaNetto, 22250)
})

test('przyjęcie bez szkicu PDF zamraża kalkulator; nieprzyjęta też jest „przed przyjęciem"', () => {
  const p = quoted(snap({ dniDokumentacji: 2 }), { status: 'lost' })
  const patch = statusChangePatch(p, 'won', NOW)
  assert.equal(dataOf(patch.quote).approvedPrice!.source, 'calculator')
  assert.equal(dataOf(patch.quote).approvedPrice!.pln, p.financials!.sumaNetto)
})

test('bez zamrożenia: inne zmiany statusu, cena już zapisana, retro-import bez wyceny', () => {
  const quote = snap({ dniDokumentacji: 1 }, pdf({ ekipa: 5000 }))
  assert.deepEqual(statusChangePatch(quoted(quote, { status: 'won' }), 'done', NOW), { status: 'done' })
  assert.deepEqual(statusChangePatch(quoted(quote, { status: 'done' }), 'won', NOW), { status: 'won' })
  assert.deepEqual(statusChangePatch(quoted(quote), 'lost', NOW), { status: 'lost' })
  assert.deepEqual(statusChangePatch(quoted(quote, { status: 'won' }), 'quote', NOW), { status: 'quote' })
  const typed = snap({ approvedPrice: { pln: 4000, source: 'typed', at: AT } }, pdf({ ekipa: 5000 }))
  assert.deepEqual(statusChangePatch(quoted(typed), 'won', NOW), { status: 'won' }, 'wpisanej ceny nie nadpisujemy')
  const financials = { sumaNetto: 9180, koszty: 0, podatek: 780.3, zysk: 8399.7, marzaPct: 91.5, computedAt: '' }
  assert.deepEqual(statusChangePatch(project({ financials }), 'done', NOW), { status: 'done' })
  assert.deepEqual(statusChangePatch(project({ quote: { version: 2 } as QuoteSnapshot }), 'done', NOW), { status: 'done' }, 'migawka bez danych')
  assert.equal(isAcceptance('quote', 'won'), true)
  assert.equal(isAcceptance('won', 'done'), false)
})

test('kwota przelewu wpisana ręcznie + przyjęcie: cena zamrożona osobno, przychód dalej z kwoty przelewu', () => {
  const p = quoted(snap({ profitTransferAmount: 80440 }, pdf({ ekipa: 67800 })))
  const patch = statusChangePatch(p, 'done', NOW)
  assert.equal(dataOf(patch.quote).approvedPrice!.pln, 67800)
  assert.deepEqual([patch.financials!.sumaNetto, patch.financials!.revenueSource], [80440, 'transfer'])
})

// ── Warianty ─────────────────────────────────────────────────────────────────

test('wybór wariantu w przyjętym zleceniu (Morris ✓A 11 980 → B 10 300): cena B zamrożona, „Cofnij" wraca do A co do grosza', () => {
  const A = snap({ approvedPrice: { pln: 11980, source: 'pdf', at: AT } }, pdf({ ekipa: 11980 }))
  const B = snap({ dniDokumentacji: 1 }, pdf({ ekipa: 10300 }))
  const p = quoted(A, { status: 'won', quoteVariants: [{ id: 'qv-b', label: 'B', snapshot: B, createdAt: AT, updatedAt: AT }] })
  const plan = chooseVariantPlan(p, 'qv-b', NOW)
  assert.equal(plan.status, 'ready')
  if (plan.status !== 'ready') return
  assert.deepEqual(dataOf(plan.patch.quote).approvedPrice, { pln: 10300, source: 'pdf', at: AT })
  assert.equal(plan.after!.sumaNetto, 10300)
  const chosenB = { ...p, ...plan.patch }
  const back = chooseVariantPlan(chosenB, 'main', new Date('2026-10-25T10:00:00.000Z'))
  assert.equal(back.status, 'ready')
  if (back.status !== 'ready') return
  assert.equal(back.patch.quote, A, 'A miała swoją cenę — wraca ta sama migawka')
  assert.equal(back.patch.financials!.sumaNetto, 11980)
})

test('wybór wariantu w wycenie (nieprzyjętej) niczego nie zamraża', () => {
  const A = snap({}, pdf({ ekipa: 11980 }))
  const B = snap({ dniDokumentacji: 1 }, pdf({ ekipa: 10300 }))
  const plan = chooseVariantPlan(quoted(A, { quoteVariants: [{ id: 'qv-b', label: 'B', snapshot: B, createdAt: AT, updatedAt: AT }] }), 'qv-b', NOW)
  assert.equal(plan.status === 'ready' && plan.patch.quote, B)
})

test('„+ Wariant" (kopia) nie bierze zatwierdzonej ceny; reszta kopii bez zmian', () => {
  const A = snap({ dniDokumentacji: 3, approvedPrice: { pln: 11980, source: 'pdf', at: AT } }, pdf({ ekipa: 11980 }))
  const { variant } = addVariantPatch(quoted(A, { status: 'won' }), { id: 'qv-b', snapshot: A, now: NOW })
  assert.equal('approvedPrice' in dataOf(variant.snapshot), false)
  assert.equal(dataOf(variant.snapshot).dniDokumentacji, 3)
  assert.equal(withoutApprovedPrice(null), null)
  const plain = snap({})
  assert.equal(withoutApprovedPrice(plain), plain, 'bez ceny — ta sama migawka')
  assert.equal(withFrozenPrice(null, AT), null)
})
