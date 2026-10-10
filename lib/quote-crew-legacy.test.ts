/**
 * Stare wyceny liczą się IDENTYCZNIE po T9b (ekipa w wycenie).
 *
 * Złote liczby poniżej zdjęto z kodu SPRZED T9b (commit 11af962) na tych
 * samych migawkach: wycena ze starej aplikacji QuoteGen (migawka v2, jej
 * cennik i marża), bardzo stara migawka bez części pól, szybka wycena i
 * wycena huba z G5. Każda zmiana tych liczb to zmiana ceny starej oferty.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeSnapshotFinancials, computeTotalCrewDays, resolveSnapshot, type FinancialsSource } from './quote-financials'
import { getProductionEkipaCastSprzetNetto } from './quote-calc'
import { resolveProfitSections } from './profit-calc'
import { plannedCrew } from './realization-plan'

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

const FIXTURES: Record<string, FinancialsSource> = {
  oldAppDetailed: {
    data: {
      clientName: 'Morris & Lloyd',
      projectName: 'Spot jesień',
      isDetailedProdukcja: true,
      detailedShootingDays: [
        oldDay('qd-1', { rezOp: 1, asystent: 2, gafer: 1, aktor: 1, statysta: 3, kameraRed: 1, swiatlo: 'rental', crewNames: { asystent: 'Operator B' } }),
        oldDay('qd-2', { rezOp: 1, dzwiekowiec: 1, mua: 1, model: 2, kameraSony: 2, obiektywy: 'standard', dayAdjustment: -500 }),
      ],
      scenariusz: 'podstawowy',
      kosztDojazduKm: 120,
      crudeEditCount: 2,
      includeCatering: true,
      includeLodging: true,
      copyrightType: 'przekazanie',
      liczbaAktorow: 1,
      actorRightsTransferAmount: 1500,
      profitOverrides: { 'pro:qd-1:rezOp': { isCost: false }, 'pro:qd-2:dzwiekowiec': { unitCost: 1200 } },
    } as never,
    pricingConfig: OLD_APP_PRICING,
    marginMultiplier: 1.15,
  },
  veryOld: {
    data: {
      isDetailedProdukcja: true,
      detailedShootingDays: [
        { id: 'v-1', rezOp: 1, asystent: 1, gafer: 0, dzwiekowiec: 1, mua: 0, aktor: 0, model: 0, statysta: 0, kameraSony: 1, kameraRed: 0, obiektywy: 'brak', stabilizacja: 'standard', podglad: 'brak', swiatlo: 'standard', dron: 'dji' },
      ],
      dniMontazu: 3,
    } as never,
    pricingConfig: { produkcja: { rezOp: 2000 } },
  },
  quick: {
    data: { dniZdjeciowe: 2, wielkoscEkipy: 3, crudeRezOpSurcharge: true, klasaSprzetu: 'kinowy', includeCatering: true } as never,
    pricingConfig: OLD_APP_PRICING,
    marginMultiplier: 1.1,
  },
  hubWithGear: {
    data: {
      isDetailedProdukcja: true,
      gearDiscountPercent: 25,
      detailedShootingDays: [
        oldDay('h-1', { rezOp: 1, gafer: 1, gear: [{ itemId: 'fx3', name: 'FX3', rate: 400, qty: 1 }], externalRentals: [{ id: 'r', label: 'Cooke', amount: 900 }] }),
      ],
    } as never,
    marginMultiplier: 1.2,
  },
}

function metrics(snapshot: FinancialsSource) {
  const resolved = resolveSnapshot(snapshot)!
  const f = computeSnapshotFinancials(snapshot, new Date(0))!
  const split = getProductionEkipaCastSprzetNetto(resolved.data, resolved.margin, resolved.pricing)
  const crewDays = computeTotalCrewDays(resolved.data)
  const production = resolveProfitSections(resolved.data, resolved.pricing, crewDays).sections
    .find((s) => s.section === 'produkcja')!
    .lines.map((l) => `${l.key}|${l.label}|${l.quantity}|${l.unitCost}|${l.isCost}`)
  const crew = plannedCrew(snapshot).map((m) => `${m.quoteDay}|${m.role}|${m.unitCost}`)
  return {
    sumaNetto: f.sumaNetto,
    koszty: f.koszty,
    zysk: f.zysk,
    ekipa: split.ekipaNetto,
    cast: split.castNetto,
    sprzet: split.sprzetNetto,
    crewDays,
    production,
    crew,
  }
}

// Zdjęte z kodu sprzed T9b (PRINT_GOLDEN=1 npm test drukuje bieżące wartości).
const GOLDEN: Record<string, ReturnType<typeof metrics>> = {
  "oldAppDetailed": {
    "sumaNetto": 47992.619999999995,
    "koszty": 26162.4,
    "zysk": 17750.847299999994,
    "ekipa": 14220,
    "cast": 9205,
    "sprzet": 5979.999999999999,
    "crewDays": 13,
    "production": [
      "pro:qd-1:rezOp|ReżOp|1|2800|false",
      "pro:qd-1:asystent|Operator B|2|1500|true",
      "pro:qd-1:gafer|Gafer|1|1500|true",
      "pro:qd-1:aktor|Aktor|1|2500|true",
      "pro:qd-1:statysta|Statysta/Epizodysta|3|400|true",
      "pro:qd-2:rezOp|ReżOp|1|2800|true",
      "pro:qd-2:dzwiekowiec|Dźwiękowiec|1|1200|true",
      "pro:qd-2:mua|MUA (Wizaż)|1|1200|true",
      "pro:qd-2:model|Model|2|1500|true",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false",
      "pro:aktorzyPrawa|Przekazanie praw aktorów|1|1500|true"
    ],
    "crew": [
      "0|Operator B|1500",
      "0|Operator B|1500",
      "0|Gafer|1500",
      "0|Aktor|2500",
      "0|Statysta/Epizodysta|400",
      "0|Statysta/Epizodysta|400",
      "0|Statysta/Epizodysta|400",
      "1|ReżOp|2800",
      "1|Dźwiękowiec|1200",
      "1|MUA (Wizaż)|1200",
      "1|Model|1500",
      "1|Model|1500"
    ]
  },
  "veryOld": {
    "sumaNetto": 12100,
    "koszty": 9500,
    "zysk": 1571.5,
    "ekipa": 5000,
    "cast": 0,
    "sprzet": 2600,
    "crewDays": 3,
    "production": [
      "pro:v-1:rezOp|ReżOp|1|2000|true",
      "pro:v-1:asystent|Asystent/Operator|1|1500|true",
      "pro:v-1:dzwiekowiec|Dźwiękowiec|1|1500|true",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false"
    ],
    "crew": [
      "0|ReżOp|2000",
      "0|Asystent/Operator|1500",
      "0|Dźwiękowiec|1500"
    ]
  },
  "quick": {
    "sumaNetto": 20400,
    "koszty": 11600,
    "zysk": 7066,
    "ekipa": 12100.000000000002,
    "cast": 0,
    "sprzet": 7700.000000000001,
    "crewDays": 6,
    "production": [
      "pro:quick:ekipa|Ekipa (szybka wycena)|6|1500|true",
      "pro:quick:rezop|Dopłata Reż-Op|2|1000|true",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false"
    ],
    "crew": [
      "null|Operator|1500",
      "null|Operator|1500",
      "null|Operator|1500"
    ]
  },
  "hubWithGear": {
    "sumaNetto": 6000,
    "koszty": 4900,
    "zysk": 590,
    "ekipa": 4800,
    "cast": 0,
    "sprzet": 1200,
    "crewDays": 2,
    "production": [
      "pro:h-1:rezOp|ReżOp|1|2500|true",
      "pro:h-1:gafer|Gafer|1|1500|true",
      "pro:h-1:rental:r|Cooke|1|900|true",
      "pro:rentalSprzetu|Rental sprzętu|1|0|false"
    ],
    "crew": [
      "0|ReżOp|2500",
      "0|Gafer|1500"
    ]
  }
}

for (const [name, snapshot] of Object.entries(FIXTURES)) {
  test(`stara wycena „${name}" liczy się jak przed T9b`, () => {
    const actual = metrics(snapshot)
    if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${name} ${JSON.stringify(actual)}`)
    assert.deepEqual(actual, GOLDEN[name])
  })
}
