/**
 * Stare wyceny liczą się i drukują IDENTYCZNIE po S3 (waluta na wycenie).
 *
 * Złote liczby poniżej zdjęto z kodu SPRZED S3 (commit 90e913a + przeniesienie
 * logiki szkicu PDF do `pdf-draft.ts` bez zmian zachowania) na czterech
 * migawkach: wycena ze starej aplikacji (v2, jej cennik i marża), wycena huba
 * ze sprzętem z katalogu (G5) i ekipą z bazy (T9b), szybka wycena oraz stara
 * wycena „euro tylko na PDF" (kształt jak prawdziwa oferta z 10.2026, nazwy
 * zmyślone). Każda zmiana tych liczb to zmiana ceny albo wydruku starej oferty.
 *
 * Jedna świadoma zmiana: angielski PDF w PLN podaje „PLN" także w zdaniu o
 * wartości sprzętu (było „zł" obok „PLN" w tym samym dokumencie) — konwencja
 * etykiet M.J. z 2026-10-13. Liczby bez zmian.
 *
 * `PRINT_GOLDEN=1 npm test` drukuje bieżące wartości.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQuoteBreakdown,
  computeQuoteTotals,
  computeSnapshotFinancials,
  computeTotalCrewDays,
  resolveSnapshot,
  type FinancialsSource,
} from './quote-financials'
import { getProductionEkipaCastSprzetNetto } from './quote-calc'
import { resolveProfitSections } from './profit-calc'
import { planFromQuote, plannedCrew } from './realization-plan'
import { pdfGearRow } from './gear-earnings'
import { buildInitialPdfState, coerceLocalPdfDraft, pdfRowsTotal, PDF_ROW_KEYS } from './pdf-draft'
import { buildTermsAndConditions, DEFAULT_PDF_TEXTS } from './pdf-texts-config'
import { formatPdfAmount } from './pdf-currency'
import type { LocalPdfState } from './quote-types'
import type { PdfLang } from './pdf-i18n'

/** Dzień w kształcie ze starej aplikacji (master: bez sprzętu z katalogu i ekipy z bazy). */
function oldDay(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    rezOp: 0,
    asystent: 0,
    gafer: 0,
    dzwiekowiec: 0,
    mua: 0,
    aktor: 0,
    model: 0,
    statysta: 0,
    kameraSony: 0,
    kameraRed: 0,
    obiektywy: 'brak',
    stabilizacja: 'brak',
    podglad: 'brak',
    swiatlo: 'brak',
    dron: 'brak',
    dayAdjustment: 0,
    crewNames: {},
    ...extra,
  }
}

/** Cennik starej aplikacji (master), z podniesioną stawką ReżOpa. */
const OLD_APP_PRICING = {
  preprodukcja: { dzienDokumentacji: 1200, scenariuszPodstawowy: 1800, scenariuszRozbudowany: 3500, wizjaLokalna: 800, kierownikProdukcji: 1500 },
  produkcja: {
    stawkaOperatoraSzybkaWycena: 1500, doplataRezOpSzybkaWycena: 1000, doplataDronSzybkaWycena: 800,
    pakietSprzetowyMinimalistyczny: 800, pakietSprzetowyStandard: 1500, pakietSprzetowyKinowy: 3500,
    rezOp: 2800, asystentOperator: 1500, gafer: 1500, dzwiekowiec: 1500, mua: 1200, aktor: 2500, model: 1500, statystaEpizodysta: 400,
    kameraSonyMirrorless: 600, kameraRedKomodoX: 1500, obiektywyStandard: 500, obiektywyRental: 1500, stabilizacjaStandard: 400,
    stabilizacjaRental: 800, podgladStandard: 300, podgladRental: 600, swiatloStandard: 1000, swiatloRental: 2000, dronDji: 600, dronFpv: 1500,
  },
  postprodukcja: { montazZaDzien: 1500, montazZaGodzine: 200, 'Format: do 30sek shorts/reel': 800, 'Format: Reportaż 1-3min': 2500 },
  dodatkowe: { kosztDojazduKm: 2.5, pelnePrzekazaniePrawProcent: 30 },
}

/** Szkic PDF starej wyceny „euro tylko na PDF": wiersze w EUR, część poprawiona ręcznie. */
const LEGACY_EUR_DRAFT = {
  clientName: 'Kawiarnie Sp. z o.o.',
  projectName: 'Warsaw October Event',
  issueDateIso: '07/10/2026',
  validUntilIso: '06/11/2026',
  terminZdjec: '27th-28th October',
  showVat: true,
  pdfLanguage: 'en',
  currency: 'EUR',
  exchangeRate: 4.3699,
  rows: {
    preprodukcja: { key: 'preprodukcja', title: 'Pre-production', opis: 'Coordinating production', cenaNetto: 150 },
    ekipa: { key: 'ekipa', title: 'Film crew', opis: 'One operator, 2 shooting days', cenaNetto: 630 },
    obsada: { key: 'obsada', title: 'Cast', opis: '-', cenaNetto: 0 },
    sprzet: { key: 'sprzet', title: 'Equipment', opis: 'Mirrorless camera, zoom lens, stabilisation, 2 shooting days', cenaNetto: 260 },
    logistyka: { key: 'logistyka', title: 'Logistics', opis: '-\n', cenaNetto: 0 },
    postprodukcja: { key: 'postprodukcja', title: 'Post-production', opis: '2 deliverables - editing, grading, music.', cenaNetto: 420 },
    inne: { key: 'inne', title: 'Other costs', opis: '-', cenaNetto: 0 },
  },
  materialyKoncowe: '2x 4K 16:9 after movie.',
  opcjeDodatkowe: '- Drone shots for additional 500PLN netto per day',
  portfolioRows: [{ url: 'https://example.com/a.mp4', description: 'Corporate event after movie' }],
  termsAndConditions: ['stale PL terms kept in the draft'],
}

const FIXTURES: Record<string, FinancialsSource & { pdfDraft?: unknown }> = {
  oldAppV2: {
    data: {
      clientName: 'Firma A',
      projectName: 'Spot jesień',
      isDetailedProdukcja: true,
      detailedShootingDays: [
        oldDay('qd-1', { rezOp: 1, asystent: 2, gafer: 1, aktor: 1, statysta: 3, kameraRed: 1, swiatlo: 'rental', crewNames: { asystent: 'Operator B' } }),
        oldDay('qd-2', { rezOp: 1, dzwiekowiec: 1, mua: 1, model: 2, kameraSony: 2, obiektywy: 'standard', dayAdjustment: -500 }),
      ],
      scenariusz: 'podstawowy',
      isDetailedPrepro: true,
      wizjaLokalna: true,
      kosztDojazduKm: 120,
      crudeEditCount: 2,
      includeCatering: true,
      includeLodging: true,
      copyrightType: 'przekazanie',
      liczbaAktorow: 1,
      actorRightsTransferAmount: 1500,
      overtimeHourlyRate: 180,
      extraRevisionPrice: 250,
      profitOverrides: { 'pro:qd-1:rezOp': { isCost: false }, 'pro:qd-2:dzwiekowiec': { unitCost: 1200 } },
    } as never,
    pricingConfig: OLD_APP_PRICING,
    marginMultiplier: 1.15,
  },
  hubGearCrew: {
    data: {
      clientName: 'Firma B',
      projectName: 'Wywiady',
      isDetailedProdukcja: true,
      isDetailedPostpro: true,
      gearDiscountPercent: 25,
      gearValueInPdf: true,
      crewPeopleInPdf: true,
      detailedShootingDays: [
        oldDay('h-1', {
          rezOp: 1,
          gear: [
            { itemId: 'fx3', name: 'FX3', rate: 400, qty: 2 },
            { itemId: 'led', name: 'Aputure 600d', rate: 250, qty: 1, gratis: true },
          ],
          externalRentals: [{ id: 'r', label: 'Cooke', amount: 900 }],
          crew: [
            { id: 'c1', roleId: 'operator', roleName: 'Operator', group: 'ekipa', personId: 'p1', personName: 'Łukasz', clientRate: 1800, costRate: 1200, qty: 1 },
            { id: 'c2', roleId: 'dzwiekowiec', roleName: 'Dźwiękowiec', group: 'ekipa', clientRate: 1500, costRate: 1500, qty: 1 },
            { id: 'c3', roleId: 'aktor', roleName: 'Aktor', group: 'obsada', clientRate: 2500, costRate: 2000, qty: 2 },
          ],
          dayAdjustment: 300,
        }),
        oldDay('h-2', {
          gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }],
          crew: [{ id: 'c4', roleId: 'operator', roleName: 'Operator', group: 'ekipa', personId: 'p2', personName: 'Piotr', clientRate: 1800, costRate: 1400, qty: 1 }],
        }),
      ],
      detailedDeliverables: [
        { id: 'd1', format: 'Format: Reportaż 1-3min', ilosc: 2, korekcjaBarwna: 'podstawowa', animacje: 'brak', muzyka: 'copyfree', soundDesign: 'brak', masterDzwieku: 'podstawowy', lektor: 'brak' },
      ],
      includeLodging: true,
      lodgingRate: 320,
      kosztDojazduKm: 60,
      profitFuelPricePerLiter: 6.8,
      profitCustomItems: [{ id: 'x', section: 'logistyka', label: 'Parking', quantity: 2, unitCost: 45, isCost: true }],
    } as never,
    marginMultiplier: 1.2,
  },
  quick: {
    data: {
      clientName: 'Firma C',
      dniZdjeciowe: 2,
      wielkoscEkipy: 3,
      crudeRezOpSurcharge: true,
      crudeDroneSurcharge: true,
      klasaSprzetu: 'kinowy',
      dniDokumentacji: 1.5,
      crudeEditUnit: 'godziny',
      crudeEditCount: 14,
      includeCatering: true,
      cateringRate: 90,
      kosztDojazduKm: 200,
      profitTransferAmount: 21000,
      includeRevisionsInfo: false,
    } as never,
    pricingConfig: OLD_APP_PRICING,
    marginMultiplier: 1.1,
  },
  legacyEurPdf: {
    data: {
      clientName: 'Kawiarnie Sp. z o.o.',
      projectName: 'Warsaw October Event',
      dniZdjeciowe: 2,
      wielkoscEkipy: 1,
      klasaSprzetu: 'standard',
      dniDokumentacji: 0.5,
      crudeEditCount: 1,
    } as never,
    pricingConfig: OLD_APP_PRICING,
    marginMultiplier: 1,
    pdfDraft: LEGACY_EUR_DRAFT,
  },
}

const ISSUE = new Date(2026, 9, 13)
const VALID = new Date(2026, 10, 12)

function rowsOf(state: LocalPdfState): string[] {
  return PDF_ROW_KEYS.map((key) => `${key}|${state.rows[key].cenaNetto}|${state.rows[key].opis}`)
}

function pdfFor(snapshot: FinancialsSource, lang: PdfLang, currency: 'PLN' | 'EUR', exchangeRate: number) {
  const { data, pricing, margin } = resolveSnapshot(snapshot)!
  const terms = buildTermsAndConditions(data, DEFAULT_PDF_TEXTS, lang)
  const state = buildInitialPdfState({
    data,
    breakdown: buildQuoteBreakdown(data, margin, pricing),
    sumaNetto: computeQuoteTotals(data, margin, pricing).sumaNetto,
    marginMultiplier: margin,
    pricing,
    lang,
    currency,
    exchangeRate,
    terms,
    issueDate: ISSUE,
    validUntilDate: VALID,
  })
  return { state, terms }
}

function metrics(snapshot: FinancialsSource & { pdfDraft?: unknown }) {
  const resolved = resolveSnapshot(snapshot)!
  const { data, pricing, margin } = resolved
  const f = computeSnapshotFinancials(snapshot, new Date(0))!
  const totals = computeQuoteTotals(data, margin, pricing)
  const split = getProductionEkipaCastSprzetNetto(data, margin, pricing)
  const crewDays = computeTotalCrewDays(data)
  const planLines = resolveProfitSections(data, pricing, crewDays)
    .sections.flatMap((s) => s.lines)
    .map((l) => `${l.key}|${l.label}|${l.quantity}|${l.unitCost}|${l.isCost}|${l.total}`)
  const plan = planFromQuote(snapshot)!
  const gear = pdfGearRow(snapshot)!
  const pl = pdfFor(snapshot, 'pl', 'PLN', 4.3)
  const en = pdfFor(snapshot, 'en', 'PLN', 4.3)
  const out: Record<string, unknown> = {
    financials: [f.sumaNetto, f.koszty, f.podatek, f.zysk, f.marzaPct],
    totals: [totals.sumaNetto, totals.cateringCost, totals.lodgingCost],
    split: [split.ekipaNetto, split.castNetto, split.sprzetNetto],
    crewDays,
    planLines,
    plan: [plan.revenue, plan.tax, plan.costs, plan.profit, [...(plan.byCategory ?? new Map()).entries()].map(([k, v]) => `${k}=${v}`)],
    crew: plannedCrew(snapshot).map((m) => `${m.quoteDay}|${m.role}|${m.unitCost}|${m.personId ?? ''}`),
    gearRow: [gear.pln, gear.source],
    pdfPl: rowsOf(pl.state),
    pdfPlTotal: formatPdfAmount(pdfRowsTotal(pl.state.rows), 'PLN'),
    termsPl: pl.terms,
    pdfEn: rowsOf(en.state),
    termsEn: en.terms,
  }
  if (snapshot.pdfDraft) {
    // Stara wycena „euro tylko na PDF": wydruk to wiersze ze szkicu, a ostrzeżenie
    // o cenach porównuje je z kalkulatorem przeliczonym po kursie szkicu.
    const draft = snapshot.pdfDraft as typeof LEGACY_EUR_DRAFT
    const reference = pdfFor(snapshot, draft.pdfLanguage as PdfLang, 'EUR', draft.exchangeRate)
    const restored = coerceLocalPdfDraft(draft, reference.state, ISSUE)
    out.legacyRows = rowsOf(restored)
    out.legacyPrinted = [restored.currency, restored.exchangeRate, formatPdfAmount(pdfRowsTotal(restored.rows), restored.currency)]
    out.legacyCalculatorRows = rowsOf(reference.state)
    out.legacyTerms = reference.terms
  }
  return out
}

// Zdjęte z kodu sprzed S3.
const GOLDEN: Record<string, ReturnType<typeof metrics>> = {
  "oldAppV2": {
    "financials": [
      51879.619999999995,
      28762.4,
      4409.7677,
      18707.452299999997,
      36.05934719645209
    ],
    "totals": [
      51879.619999999995,
      1300,
      3900
    ],
    "split": [
      14220,
      9205,
      5979.999999999999
    ],
    "crewDays": 13,
    "planLines": [
      "pre:scenariusz|Scenariusz (podstawowy)|1|1800|true|1800",
      "pre:wizja|Wizja lokalna|1|800|true|800",
      "pro:qd-1:rezOp|ReżOp|1|2800|false|0",
      "pro:qd-1:asystent|Operator B|2|1500|true|3000",
      "pro:qd-1:gafer|Gafer|1|1500|true|1500",
      "pro:qd-1:aktor|Aktor|1|2500|true|2500",
      "pro:qd-1:statysta|Statysta/Epizodysta|3|400|true|1200",
      "pro:qd-2:rezOp|ReżOp|1|2800|true|2800",
      "pro:qd-2:dzwiekowiec|Dźwiękowiec|1|1200|true|1200",
      "pro:qd-2:mua|MUA (Wizaż)|1|1200|true|1200",
      "pro:qd-2:model|Model|2|1500|true|3000",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false|0",
      "pro:aktorzyPrawa|Przekazanie praw aktorów|1|1500|true|1500",
      "post:montaz|Montaż (dni)|2|1500|true|3000",
      "log:dojazd|Dojazd (paliwo)|120|0.52|true|62.400000000000006",
      "log:catering|Catering|13|100|true|1300",
      "log:noclegi|Noclegi|13|300|true|3900"
    ],
    "plan": [
      51879.619999999995,
      4409.7677,
      28762.4,
      18707.452299999997,
      [
        "ekipa=17900",
        "dojazd=62.400000000000006",
        "catering=1300",
        "nocleg=3900",
        "preprodukcja=2600",
        "postprodukcja=3000"
      ]
    ],
    "crew": [
      "0|Operator B|1500|",
      "0|Operator B|1500|",
      "0|Gafer|1500|",
      "0|Aktor|2500|",
      "0|Statysta/Epizodysta|400|",
      "0|Statysta/Epizodysta|400|",
      "0|Statysta/Epizodysta|400|",
      "1|ReżOp|2800|",
      "1|Dźwiękowiec|1200|",
      "1|MUA (Wizaż)|1200|",
      "1|Model|1500|",
      "1|Model|1500|"
    ],
    "gearRevenue": [
      5979.999999999999,
      0,
      0,
      5979.999999999999,
      []
    ],
    "pdfPl": [
      "preprodukcja|2990|Scenariusz: Podstawowy.\nWizja lokalna: Tak.\nKierownik produkcji: Nie.",
      "ekipa|14220|Szczegółowa wycena ekipy filmowej dla 2 dni zdjęciowych.",
      "obsada|9205|Szczegółowa wycena obsady dla 2 dni zdjęciowych.\nAktor: 1 os.-dni.\nModel: 2 os.-dni.\nStatysta: 3 os.-dni.\nHonorarium za przekazanie praw: 1 aktor(s) × 1500 zł.",
      "sprzet|5980|Szczegółowa wycena sprzętu (kamery, obiektywy, stabilizacja, podgląd, światło, dron) dla 2 dni zdjęciowych.",
      "logistyka|5262|Dojazd: 120 km.\nCatering: Tak.\nNoclegi: Tak.",
      "postprodukcja|3450|Montaż w trybie szybkiej wyceny: 2 dni.",
      "inne|10772|Prawa autorskie: pełne przekazanie praw."
    ],
    "pdfPlTotal": "51 879 zł",
    "termsPl": [
      "Cena obejmuje realizację filmu oraz pełne przeniesienie autorskich praw majątkowych do dzieła na Zamawiającego na wszystkich znanych polach eksploatacji, bez ograniczeń czasowych i terytorialnych.",
      "1 dzień zdjęciowy obejmuje maksymalnie 10 godzin pracy na planie. Praca powyżej tego czasu rozliczana jest jako nadgodziny w kwocie 180 zł netto za członka ekipy, liczone za każdą rozpoczętą godzinę.",
      "Cena obejmuje do 2 rund poprawek montażowych. Kolejne zmiany podlegają dodatkowej wycenie w kwocie 250 zł netto za rundę.",
      "Podane kwoty są kwotami netto. Do kwot należy doliczyć VAT zgodnie z obowiązującymi przepisami."
    ],
    "pdfEn": [
      "preprodukcja|2990|Script: Basic.\nLocation scout: Yes.\nProduction manager: No.",
      "ekipa|14220|Detailed film crew pricing for 2 shooting days.",
      "obsada|9205|Detailed cast pricing for 2 shooting days.\nActor: 1 person-days.\nModel: 2 person-days.\nExtra: 3 person-days.\nCopyright transfer fee: 1 actor(s) × 1500 PLN.",
      "sprzet|5980|Detailed equipment pricing (cameras, lenses, stabilisation, monitoring, lighting, drone) for 2 shooting days.",
      "logistyka|5262|Travel: 120 km.\nCatering: Yes.\nLodging: Yes.",
      "postprodukcja|3450|Editing in quick quote mode: 2 days.",
      "inne|10772|Copyright: full copyright transfer."
    ],
    "termsEn": [
      "Price covers production of the film and a full transfer of economic copyright to the Client across all known fields of exploitation, with no time or territorial limits.",
      "A standard shooting day covers up to 10 hours of work on set. Work beyond that time is billed as overtime at 180 PLN net per crew member, charged per started hour.",
      "Price covers up to 2 rounds of editing revisions. Further revision rounds are billed at 250 PLN net per additional round.",
      "Amounts are stated net of VAT. VAT will be added in line with applicable regulations."
    ]
  },
  "hubGearCrew": {
    "financials": [
      26612.64,
      19742.64,
      2262.0744,
      4607.925599999999,
      17.314800786393228
    ],
    "totals": [
      26612.64,
      0,
      1920
    ],
    "split": [
      9420,
      6000,
      1800
    ],
    "crewDays": 6,
    "planLines": [
      "pro:h-1:rezOp|ReżOp|1|2500|true|2500",
      "pro:h-1:crew:c1|Operator · Łukasz|1|1200|true|1200",
      "pro:h-1:crew:c2|Dźwiękowiec|1|1500|true|1500",
      "pro:h-1:crew:c3|Aktor|2|2000|true|4000",
      "pro:h-1:rental:r|Cooke|1|900|true|900",
      "pro:h-2:crew:c4|Operator · Piotr|1|1400|true|1400",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false|0",
      "post:d1:format|Montaż formatu: Reportaż 1-3min|2|2500|true|5000",
      "post:d1:korekcja|Korekcja barwna (podstawowa)|1|500|true|500",
      "post:d1:muzyka|Muzyka (Copy-free)|1|300|true|300",
      "post:d1:master|Master dźwięku (podstawowy)|1|400|true|400",
      "log:dojazd|Dojazd (paliwo)|60|0.544|true|32.64",
      "log:noclegi|Noclegi|6|320|true|1920",
      "custom:x|Parking|2|45|true|90"
    ],
    "plan": [
      26612.64,
      2262.0744,
      19742.64,
      4607.925599999999,
      [
        "ekipa=10600",
        "wynajem=900",
        "dojazd=32.64",
        "nocleg=1920",
        "postprodukcja=6200",
        "inne=90"
      ]
    ],
    "crew": [
      "0|ReżOp|2500|",
      "0|Operator|1200|p1",
      "0|Dźwiękowiec|1500|",
      "0|Aktor|2000|",
      "0|Aktor|2000|",
      "1|Operator|1400|p2"
    ],
    "gearRevenue": [
      1800,
      900,
      900,
      0,
      [
        "fx3=900"
      ]
    ],
    "pdfPl": [
      "preprodukcja|0|Dokumentacja: 0 dni.\nScenariusz: Brak.",
      "ekipa|9420|Szczegółowa wycena ekipy filmowej dla 2 dni zdjęciowych.\nOperator: 2 os.-dni (Łukasz, Piotr).\nDźwiękowiec: 1 os.-dni.",
      "obsada|6000|Szczegółowa wycena obsady dla 2 dni zdjęciowych.\nAktor: 2 os.-dni.",
      "sprzet|1800|Szczegółowa wycena sprzętu (kamery, obiektywy, stabilizacja, podgląd, światło, dron) dla 2 dni zdjęciowych.\nSprzęt: 2× FX3, Aputure 600d.\nZ wypożyczalni: Cooke.\nWartość rynkowa sprzętu: 1 450 zł, rabat: −550 zł.",
      "logistyka|1953|Dojazd: 60 km.\nCatering: Nie.\nNoclegi: Tak.",
      "postprodukcja|7440|Szczegółowa wycena postprodukcji: 1 pozycji (formaty i dostawy).",
      "inne|0|Prawa autorskie: niewyłączna licencja."
    ],
    "pdfPlTotal": "26 613 zł",
    "termsPl": [
      "Cena obejmuje realizację filmu oraz udzielenie niewyłącznej licencji na jego wykorzystanie w Internecie na kanałach własnych Zamawiającego oraz do użytku wewnętrznego, bez ograniczeń terytorialnych, na czas nieoznaczony, z zastrzeżeniem że w przypadku wykorzystania wizerunku aktorów lub materiałów licencjonowanych, okres licencji może zostać ograniczony zgodnie z warunkami udzielonych zgód i licencji.",
      "1 dzień zdjęciowy obejmuje maksymalnie 10 godzin pracy na planie. Praca powyżej tego czasu rozliczana jest jako nadgodziny w kwocie 150 zł netto za członka ekipy, liczone za każdą rozpoczętą godzinę.",
      "Cena obejmuje do 2 rund poprawek montażowych. Kolejne zmiany podlegają dodatkowej wycenie w kwocie 200 zł netto za rundę.",
      "Podane kwoty są kwotami netto. Do kwot należy doliczyć VAT zgodnie z obowiązującymi przepisami."
    ],
    "pdfEn": [
      "preprodukcja|0|Documentation: 0 days.\nScript: None.",
      "ekipa|9420|Detailed film crew pricing for 2 shooting days.\nOperator: 2 person-days (Łukasz, Piotr).\nDźwiękowiec: 1 person-days.",
      "obsada|6000|Detailed cast pricing for 2 shooting days.\nAktor: 2 person-days.",
      "sprzet|1800|Detailed equipment pricing (cameras, lenses, stabilisation, monitoring, lighting, drone) for 2 shooting days.\nEquipment: 2× FX3, Aputure 600d.\nRented: Cooke.\nMarket value of equipment: 1 450 PLN, discount: −550 PLN.",
      "logistyka|1953|Travel: 60 km.\nCatering: No.\nLodging: Yes.",
      "postprodukcja|7440|Detailed post-production pricing: 1 items (formats and deliverables).",
      "inne|0|Copyright: non-exclusive licence."
    ],
    "termsEn": [
      "Price covers production of the film and grant of a non-exclusive licence to use the work on the Client's own internet channels and for internal purposes, with no territorial limits, for an unlimited period, subject to the limitation that where actor likenesses or licensed third-party materials are used, the licence term may be restricted in line with the underlying consents and licences.",
      "A standard shooting day covers up to 10 hours of work on set. Work beyond that time is billed as overtime at 150 PLN net per crew member, charged per started hour.",
      "Price covers up to 2 rounds of editing revisions. Further revision rounds are billed at 200 PLN net per additional round.",
      "Amounts are stated net of VAT. VAT will be added in line with applicable regulations."
    ]
  },
  "quick": {
    "financials": [
      21000,
      16244,
      1785.0000000000002,
      2971,
      14.147619047619047
    ],
    "totals": [
      27264,
      540,
      0
    ],
    "split": [
      12100.000000000002,
      0,
      9460
    ],
    "crewDays": 6,
    "planLines": [
      "pre:dokumentacja|Dzień dokumentacji|1.5|1200|true|1800",
      "pro:quick:ekipa|Ekipa (szybka wycena)|6|1500|true|9000",
      "pro:quick:rezop|Dopłata Reż-Op|2|1000|true|2000",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false|0",
      "post:montaz|Montaż (godziny)|14|200|true|2800",
      "log:dojazd|Dojazd (paliwo)|200|0.52|true|104",
      "log:catering|Catering|6|90|true|540"
    ],
    "plan": [
      21000,
      1785.0000000000002,
      16244,
      2971,
      [
        "ekipa=11000",
        "dojazd=104",
        "catering=540",
        "preprodukcja=1800",
        "postprodukcja=2800"
      ]
    ],
    "crew": [
      "null|Operator|1500|",
      "null|Operator|1500|",
      "null|Operator|1500|"
    ],
    "gearRevenue": [
      7286.531690140844,
      0,
      0,
      7286.531690140844,
      []
    ],
    "pdfPl": [
      "preprodukcja|1980|Dokumentacja: 1.5 dni.\nScenariusz: Brak.",
      "ekipa|12100|Tryb szybkiej wyceny: 2 dni × 3 os.\nDopłata Reż-Op: Tak.",
      "obsada|0|Brak wyceny obsady — tryb szybkiej wyceny.",
      "sprzet|9460|Klasa sprzętu: kinowy.\nDopłata Dron: Tak.",
      "logistyka|644|Dojazd: 200 km.\nCatering: Tak.\nNoclegi: Nie.",
      "postprodukcja|3080|Montaż w trybie szybkiej wyceny: 14 godz..",
      "inne|0|Prawa autorskie: niewyłączna licencja."
    ],
    "pdfPlTotal": "27 264 zł",
    "termsPl": [
      "Cena obejmuje realizację filmu oraz udzielenie niewyłącznej licencji na jego wykorzystanie w Internecie na kanałach własnych Zamawiającego oraz do użytku wewnętrznego, bez ograniczeń terytorialnych, na czas nieoznaczony, z zastrzeżeniem że w przypadku wykorzystania wizerunku aktorów lub materiałów licencjonowanych, okres licencji może zostać ograniczony zgodnie z warunkami udzielonych zgód i licencji.",
      "1 dzień zdjęciowy obejmuje maksymalnie 10 godzin pracy na planie. Praca powyżej tego czasu rozliczana jest jako nadgodziny w kwocie 150 zł netto za członka ekipy, liczone za każdą rozpoczętą godzinę.",
      "Podane kwoty są kwotami netto. Do kwot należy doliczyć VAT zgodnie z obowiązującymi przepisami."
    ],
    "pdfEn": [
      "preprodukcja|1980|Documentation: 1.5 days.\nScript: None.",
      "ekipa|12100|Quick quote mode: 2 days × 3 pers.\nDirector-Operator surcharge: Yes.",
      "obsada|0|Cast not itemised — quick quote mode.",
      "sprzet|9460|Equipment class: cinematic.\nDrone surcharge: Yes.",
      "logistyka|644|Travel: 200 km.\nCatering: Yes.\nLodging: No.",
      "postprodukcja|3080|Editing in quick quote mode: 14 hrs.",
      "inne|0|Copyright: non-exclusive licence."
    ],
    "termsEn": [
      "Price covers production of the film and grant of a non-exclusive licence to use the work on the Client's own internet channels and for internal purposes, with no territorial limits, for an unlimited period, subject to the limitation that where actor likenesses or licensed third-party materials are used, the licence term may be restricted in line with the underlying consents and licences.",
      "A standard shooting day covers up to 10 hours of work on set. Work beyond that time is billed as overtime at 150 PLN net per crew member, charged per started hour.",
      "Amounts are stated net of VAT. VAT will be added in line with applicable regulations."
    ]
  },
  "legacyEurPdf": {
    "financials": [
      8100,
      5100,
      688.5,
      2311.5,
      28.537037037037038
    ],
    "totals": [
      8100,
      0,
      0
    ],
    "split": [
      3000,
      0,
      3000
    ],
    "crewDays": 2,
    "planLines": [
      "pre:dokumentacja|Dzień dokumentacji|0.5|1200|true|600",
      "pro:quick:ekipa|Ekipa (szybka wycena)|2|1500|true|3000",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false|0",
      "post:montaz|Montaż (dni)|1|1500|true|1500"
    ],
    "plan": [
      8100,
      688.5,
      5100,
      2311.5,
      [
        "ekipa=3000",
        "preprodukcja=600",
        "postprodukcja=1500"
      ]
    ],
    "crew": [
      "null|Operator|1500|"
    ],
    "gearRevenue": [
      3000,
      0,
      0,
      3000,
      []
    ],
    "pdfPl": [
      "preprodukcja|600|Dokumentacja: 0.5 dni.\nScenariusz: Brak.",
      "ekipa|3000|Tryb szybkiej wyceny: 2 dni × 1 os.\nDopłata Reż-Op: Nie.",
      "obsada|0|Brak wyceny obsady — tryb szybkiej wyceny.",
      "sprzet|3000|Klasa sprzętu: standard.\nDopłata Dron: Nie.",
      "logistyka|0|Dojazd: 0 km.\nCatering: Nie.\nNoclegi: Nie.",
      "postprodukcja|1500|Montaż w trybie szybkiej wyceny: 1 dni.",
      "inne|0|Prawa autorskie: niewyłączna licencja."
    ],
    "pdfPlTotal": "8 100 zł",
    "termsPl": [
      "Cena obejmuje realizację filmu oraz udzielenie niewyłącznej licencji na jego wykorzystanie w Internecie na kanałach własnych Zamawiającego oraz do użytku wewnętrznego, bez ograniczeń terytorialnych, na czas nieoznaczony, z zastrzeżeniem że w przypadku wykorzystania wizerunku aktorów lub materiałów licencjonowanych, okres licencji może zostać ograniczony zgodnie z warunkami udzielonych zgód i licencji.",
      "1 dzień zdjęciowy obejmuje maksymalnie 10 godzin pracy na planie. Praca powyżej tego czasu rozliczana jest jako nadgodziny w kwocie 150 zł netto za członka ekipy, liczone za każdą rozpoczętą godzinę.",
      "Cena obejmuje do 2 rund poprawek montażowych. Kolejne zmiany podlegają dodatkowej wycenie w kwocie 200 zł netto za rundę.",
      "Podane kwoty są kwotami netto. Do kwot należy doliczyć VAT zgodnie z obowiązującymi przepisami."
    ],
    "pdfEn": [
      "preprodukcja|600|Documentation: 0.5 days.\nScript: None.",
      "ekipa|3000|Quick quote mode: 2 days × 1 pers.\nDirector-Operator surcharge: No.",
      "obsada|0|Cast not itemised — quick quote mode.",
      "sprzet|3000|Equipment class: standard.\nDrone surcharge: No.",
      "logistyka|0|Travel: 0 km.\nCatering: No.\nLodging: No.",
      "postprodukcja|1500|Editing in quick quote mode: 1 days.",
      "inne|0|Copyright: non-exclusive licence."
    ],
    "termsEn": [
      "Price covers production of the film and grant of a non-exclusive licence to use the work on the Client's own internet channels and for internal purposes, with no territorial limits, for an unlimited period, subject to the limitation that where actor likenesses or licensed third-party materials are used, the licence term may be restricted in line with the underlying consents and licences.",
      "A standard shooting day covers up to 10 hours of work on set. Work beyond that time is billed as overtime at 150 PLN net per crew member, charged per started hour.",
      "Price covers up to 2 rounds of editing revisions. Further revision rounds are billed at 200 PLN net per additional round.",
      "Amounts are stated net of VAT. VAT will be added in line with applicable regulations."
    ],
    "legacyRows": [
      "preprodukcja|150|Coordinating production",
      "ekipa|630|One operator, 2 shooting days",
      "obsada|0|-",
      "sprzet|260|Mirrorless camera, zoom lens, stabilisation, 2 shooting days",
      "logistyka|0|-\n",
      "postprodukcja|420|2 deliverables - editing, grading, music.",
      "inne|0|-"
    ],
    "legacyPrinted": [
      "EUR",
      4.3699,
      "1 460 €"
    ],
    "legacyCalculatorRows": [
      "preprodukcja|137|Documentation: 0.5 days.\nScript: None.",
      "ekipa|687|Quick quote mode: 2 days × 1 pers.\nDirector-Operator surcharge: No.",
      "obsada|0|Cast not itemised — quick quote mode.",
      "sprzet|687|Equipment class: standard.\nDrone surcharge: No.",
      "logistyka|0|Travel: 0 km.\nCatering: No.\nLodging: No.",
      "postprodukcja|343|Editing in quick quote mode: 1 days.",
      "inne|0|Copyright: non-exclusive licence."
    ],
    "legacyTerms": [
      "Price covers production of the film and grant of a non-exclusive licence to use the work on the Client's own internet channels and for internal purposes, with no territorial limits, for an unlimited period, subject to the limitation that where actor likenesses or licensed third-party materials are used, the licence term may be restricted in line with the underlying consents and licences.",
      "A standard shooting day covers up to 10 hours of work on set. Work beyond that time is billed as overtime at 150 PLN net per crew member, charged per started hour.",
      "Price covers up to 2 rounds of editing revisions. Further revision rounds are billed at 200 PLN net per additional round.",
      "Amounts are stated net of VAT. VAT will be added in line with applicable regulations."
    ]
  }
}

/**
 * R2 (C1, decyzja M.J. 13.2a/5): przychód planu to suma PDF. Jedyny szkic
 * wśród wzorców pokazał klientowi 1 460 € po kursie szkicu 4,3699 (wycena w
 * złotych, euro tylko na PDF), więc finanse i plan liczą 6 380,05 zł zamiast
 * 8 100 zł z kalkulatora. Wszystko inne (wydruk, kalkulator, sprzęt) bez zmian.
 */
function withPdfPrice(golden: ReturnType<typeof metrics>, revenue: number): ReturnType<typeof metrics> {
  const [, koszty] = golden.financials as number[]
  const tax = revenue * (8.5 / 100)
  const zysk = revenue - tax - koszty
  const plan = golden.plan as unknown[]
  return {
    ...golden,
    financials: [revenue, koszty, tax, zysk, (zysk / revenue) * 100],
    plan: [revenue, tax, plan[2], zysk, plan[4]],
  }
}

/**
 * U2 (decyzja M.J. 2026-10-24, §18.3/1): „ile zarobił sprzęt" zaczyna się od
 * wiersza „Sprzęt" z PDF (bez szkicu — od wiersza, który wydrukowałby
 * kalkulator), a nie od kalkulatora × (przelew / suma) z wynajmem z planu.
 * Dawne `gearRevenue` znika z wzorca; w jego miejscu wiersz Sprzęt: bez szkicu
 * = `split.sprzetNetto` z tego samego wzorca, szkic EUR = 260 € × 4,3699.
 * Wszystko inne bez zmian.
 */
function withGearRow(golden: ReturnType<typeof metrics>, pln: number, source: 'pdf' | 'calculator'): ReturnType<typeof metrics> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { gearRevenue: _old, ...rest } = golden
  return { ...rest, gearRow: [pln, source] }
}

const fromCalculator = (golden: ReturnType<typeof metrics>) => withGearRow(golden, (golden.split as number[])[2], 'calculator')

const EXPECTED: Record<string, ReturnType<typeof metrics>> = {
  ...Object.fromEntries(Object.entries(GOLDEN).map(([name, golden]) => [name, fromCalculator(golden)])),
  legacyEurPdf: withGearRow(withPdfPrice(GOLDEN.legacyEurPdf, 1460 * 4.3699), 260 * 4.3699, 'pdf'),
}

for (const [name, snapshot] of Object.entries(FIXTURES)) {
  test(`stara wycena „${name}" liczy się i drukuje jak przed S3`, () => {
    const actual = metrics(snapshot)
    if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${name} ${JSON.stringify(actual)}`)
    assert.deepEqual(actual, EXPECTED[name])
  })
}
