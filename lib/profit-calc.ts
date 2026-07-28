'use client'

/**
 * Zakładka "Profit": wyprowadza pozycje kosztowe z aktualnej wyceny
 * (stawki bazowe z cennika, BEZ mnożnika marży — to, co realnie płacisz
 * podwykonawcom), nakłada ręczne nadpisania użytkownika i liczy zysk netto:
 *
 *   Zysk = Suma netto wyceny − ryczałt% × Suma netto − suma kosztów
 *
 * Klucze pozycji są stabilne (oparte o id dnia zdjęciowego / dostawy),
 * więc nadpisania przeżywają edycje w pozostałych zakładkach.
 */

import type {
  QuoteData,
  ShootingDay,
  Deliverable,
  CrewRoleKey,
  ProfitSectionKey,
  ProfitLineOverride,
  ProfitCustomItem,
} from './quote-types'
import type { PricingConfigShape } from './pricing-config'
import { safeNum, safeArray } from './safe-numbers'

export interface ProfitDerivedLine {
  key: string
  section: ProfitSectionKey
  label: string
  /** Kontekst pozycji, np. "Dzień 2" albo "Dostawa 1: Reportaż 1-3min". */
  detail?: string
  /** Jednostka ilości: "dzień", "os.", "szt.", "km", "osobodzień", "godz." */
  unitLabel: string
  defaultQuantity: number
  defaultUnitCost: number
  /** Domyślny stan checkboxa "to jest mój koszt" (domyślnie true). */
  defaultIsCost?: boolean
}

export interface ProfitLine extends ProfitDerivedLine {
  isCost: boolean
  quantity: number
  unitCost: number
  /** Koszt pozycji: isCost ? quantity × unitCost : 0 */
  total: number
  /** Czy użytkownik nadpisał ilość/stawkę/checkbox względem wyceny. */
  isOverridden: boolean
  isCustom: boolean
  customId?: string
}

export interface ProfitSectionResult {
  section: ProfitSectionKey
  lines: ProfitLine[]
  totalCost: number
}

export const PROFIT_SECTION_LABELS: Record<ProfitSectionKey, string> = {
  preprodukcja: 'Preprodukcja',
  produkcja: 'Produkcja',
  postprodukcja: 'Postprodukcja',
  logistyka: 'Logistyka i dodatkowe',
}

const CREW_ROLE_DEFS: { role: CrewRoleKey; label: string; priceKey: keyof PricingConfigShape['produkcja'] }[] = [
  { role: 'rezOp', label: 'ReżOp', priceKey: 'rezOp' },
  { role: 'asystent', label: 'Asystent/Operator', priceKey: 'asystentOperator' },
  { role: 'gafer', label: 'Gafer', priceKey: 'gafer' },
  { role: 'dzwiekowiec', label: 'Dźwiękowiec', priceKey: 'dzwiekowiec' },
  { role: 'mua', label: 'MUA (Wizaż)', priceKey: 'mua' },
  { role: 'aktor', label: 'Aktor', priceKey: 'aktor' },
  { role: 'model', label: 'Model', priceKey: 'model' },
  { role: 'statysta', label: 'Statysta/Epizodysta', priceKey: 'statystaEpizodysta' },
]

/** Stawka zł/km z równania paliwowego: cena paliwa (zł/l) × spalanie (l/100 km) / 100. */
export function computeFuelRatePerKm(data: QuoteData): number {
  const fuelPrice = safeNum(data.profitFuelPricePerLiter, 6.5, 0)
  const consumption = safeNum(data.profitFuelConsumption, 8, 0)
  return (fuelPrice * consumption) / 100
}

function getFormatBasePrice(post: PricingConfigShape['postprodukcja'], formatKey: string): number {
  const price = post[formatKey]
  if (typeof price === 'number') return price
  const firstKey = Object.keys(post).find(k => k.startsWith('Format: '))
  const fallback = firstKey != null ? post[firstKey] : undefined
  return typeof fallback === 'number' ? fallback : 0
}

/**
 * Buduje listę pozycji kosztowych wynikających z bieżącej wyceny.
 * `autoCrewDays` = osobodni wyliczone z produkcji (dla cateringu/noclegów).
 */
export function buildDerivedCostLines(
  data: QuoteData,
  pricing: PricingConfigShape,
  autoCrewDays: number
): ProfitDerivedLine[] {
  const lines: ProfitDerivedLine[] = []
  const push = (line: ProfitDerivedLine) => lines.push(line)

  // ── Preprodukcja ──────────────────────────────────────────────────────────
  const pre = pricing.preprodukcja
  if (!data.isDetailedPrepro) {
    const dni = safeNum(data.dniDokumentacji, 0, 0)
    if (dni > 0) {
      push({
        key: 'pre:dokumentacja',
        section: 'preprodukcja',
        label: 'Dzień dokumentacji',
        unitLabel: 'dzień',
        defaultQuantity: dni,
        defaultUnitCost: pre.dzienDokumentacji,
      })
    }
  } else {
    if (data.scenariusz !== 'brak') {
      push({
        key: 'pre:scenariusz',
        section: 'preprodukcja',
        label: `Scenariusz (${data.scenariusz === 'podstawowy' ? 'podstawowy' : 'rozbudowany'})`,
        unitLabel: 'szt.',
        defaultQuantity: 1,
        defaultUnitCost: data.scenariusz === 'podstawowy' ? pre.scenariuszPodstawowy : pre.scenariuszRozbudowany,
      })
    }
    if (data.wizjaLokalna) {
      push({
        key: 'pre:wizja',
        section: 'preprodukcja',
        label: 'Wizja lokalna',
        unitLabel: 'szt.',
        defaultQuantity: 1,
        defaultUnitCost: pre.wizjaLokalna,
      })
    }
    if (data.kierownikProdukcji) {
      push({
        key: 'pre:kierownik',
        section: 'preprodukcja',
        label: 'Kierownik produkcji',
        unitLabel: 'szt.',
        defaultQuantity: 1,
        defaultUnitCost: pre.kierownikProdukcji,
      })
    }
  }

  // ── Produkcja ─────────────────────────────────────────────────────────────
  const pro = pricing.produkcja
  if (!data.isDetailedProdukcja) {
    const days = safeNum(data.dniZdjeciowe, 0, 0)
    const crew = safeNum(data.wielkoscEkipy, 1, 1)
    if (days > 0) {
      push({
        key: 'pro:quick:ekipa',
        section: 'produkcja',
        label: 'Ekipa (szybka wycena)',
        detail: `${crew} os. × ${days} dni`,
        unitLabel: 'osobodzień',
        defaultQuantity: days * crew,
        defaultUnitCost: pro.stawkaOperatoraSzybkaWycena,
      })
      // Sprzęt (pakiet sprzętowy, dopłata dron) NIE tworzy osobnych kosztów —
      // zastępuje go jedna ręczna pozycja "Rental sprzętu" (poniżej).
      if (data.crudeRezOpSurcharge) {
        push({
          key: 'pro:quick:rezop',
          section: 'produkcja',
          label: 'Dopłata Reż-Op',
          unitLabel: 'dzień',
          defaultQuantity: days,
          defaultUnitCost: pro.doplataRezOpSzybkaWycena,
        })
      }
    }
  } else {
    safeArray<ShootingDay>(data.detailedShootingDays).forEach((day, i) => {
      const detail = `Dzień ${i + 1}`
      for (const def of CREW_ROLE_DEFS) {
        const count = safeNum(day[def.role], 0, 0)
        if (count <= 0) continue
        const customName = day.crewNames?.[def.role]
        push({
          key: `pro:${day.id}:${def.role}`,
          section: 'produkcja',
          label: customName && customName.trim() ? customName.trim() : def.label,
          detail,
          unitLabel: 'os.',
          defaultQuantity: count,
          defaultUnitCost: pro[def.priceKey],
        })
      }
      // Sprzęt (kamery, obiektywy, stabilizacja, podgląd, światło, dron) NIE jest
      // rozbijany na osobne koszty — zastępuje go jedna ręczna pozycja
      // "Rental sprzętu" (poniżej), żeby nie tworzyć ściany tekstu.
    })
  }

  // Rental sprzętu — jedna ręczna pozycja zamiast rozbitego sprzętu.
  // Domyślnie 0 zł i odznaczona; tu wpisujesz wartość sprzętu do wyrentalowania.
  push({
    key: 'pro:rentalSprzetu',
    section: 'produkcja',
    label: 'Rental sprzętu',
    detail: 'wartość sprzętu do wyrentalowania',
    unitLabel: 'kpl.',
    defaultQuantity: 1,
    defaultUnitCost: 0,
    defaultIsCost: false,
  })

  // Honorarium aktorów za przekazanie praw — realny koszt (wypłacany aktorom)
  if (data.copyrightType === 'przekazanie') {
    const liczba = safeNum(data.liczbaAktorow, 0, 0)
    const perActor = safeNum(data.actorRightsTransferAmount, 0, 0)
    if (liczba > 0 && perActor > 0) {
      push({
        key: 'pro:aktorzyPrawa',
        section: 'produkcja',
        label: 'Przekazanie praw aktorów',
        unitLabel: 'os.',
        defaultQuantity: liczba,
        defaultUnitCost: perActor,
      })
    }
  }

  // ── Postprodukcja ─────────────────────────────────────────────────────────
  const post = pricing.postprodukcja
  if (!data.isDetailedPostpro) {
    const q = safeNum(data.crudeEditCount, 0, 0)
    if (q > 0) {
      const perDay = data.crudeEditUnit === 'dni'
      push({
        key: 'post:montaz',
        section: 'postprodukcja',
        label: perDay ? 'Montaż (dni)' : 'Montaż (godziny)',
        unitLabel: perDay ? 'dzień' : 'godz.',
        defaultQuantity: q,
        defaultUnitCost: perDay ? post.montazZaDzien : post.montazZaGodzine,
      })
    }
  } else {
    safeArray<Deliverable>(data.detailedDeliverables).forEach((del, i) => {
      const formatLabel = del.format.startsWith('Format: ') ? del.format.slice(8) : del.format
      const detail = `Dostawa ${i + 1}: ${formatLabel}`
      push({
        key: `post:${del.id}:format`,
        section: 'postprodukcja',
        label: `Montaż formatu: ${formatLabel}`,
        detail,
        unitLabel: 'szt.',
        defaultQuantity: safeNum(del.ilosc, 1, 0),
        defaultUnitCost: getFormatBasePrice(post, del.format),
      })
      const components: { field: string; label: string; cost: number }[] = []
      if (del.korekcjaBarwna !== 'brak') {
        components.push({
          field: 'korekcja',
          label: `Korekcja barwna (${del.korekcjaBarwna === 'podstawowa' ? 'podstawowa' : 'zaawansowana'})`,
          cost: del.korekcjaBarwna === 'podstawowa' ? post.korekcjaBarwnaPodstawowa : post.korekcjaBarwnaZaawansowana,
        })
      }
      if (del.animacje !== 'brak') {
        components.push({
          field: 'animacje',
          label: `Animacje (${del.animacje === '2d' ? '2D' : 'AI'})`,
          cost: del.animacje === '2d' ? post.animacje2d : post.animacjeAi,
        })
      }
      if (del.muzyka !== 'brak') {
        components.push({
          field: 'muzyka',
          label: `Muzyka (${del.muzyka === 'copyfree' ? 'Copy-free' : 'Kompozytor'})`,
          cost: del.muzyka === 'copyfree' ? post.muzykaCopyfree : post.muzykaKompozytor,
        })
      }
      if (del.soundDesign !== 'brak') {
        components.push({
          field: 'soundDesign',
          label: `Sound design (${del.soundDesign === 'prosty' ? 'prosty' : 'złożony'})`,
          cost: del.soundDesign === 'prosty' ? post.soundDesignProsty : post.soundDesignZlozony,
        })
      }
      if (del.masterDzwieku !== 'brak') {
        components.push({
          field: 'master',
          label: `Master dźwięku (${del.masterDzwieku === 'podstawowy' ? 'podstawowy' : 'złożony'})`,
          cost: del.masterDzwieku === 'podstawowy' ? post.masterDzwiekuPodstawowy : post.masterDzwiekuZlozony,
        })
      }
      if (del.lektor !== 'brak') {
        components.push({
          field: 'lektor',
          label: `Lektor (${del.lektor === 'ai' ? 'AI' : 'Studio'})`,
          cost: del.lektor === 'ai' ? post.lektorAi : post.lektorStudio,
        })
      }
      for (const c of components) {
        push({
          key: `post:${del.id}:${c.field}`,
          section: 'postprodukcja',
          label: c.label,
          detail,
          unitLabel: 'szt.',
          defaultQuantity: 1,
          defaultUnitCost: c.cost,
        })
      }
    })
  }

  // ── Logistyka i dodatkowe ─────────────────────────────────────────────────
  // Realny koszt dojazdu z równania paliwowego: km × spalanie/100 × cena paliwa
  // (nie ze stawki cennikowej zł/km, która jest ceną dla klienta).
  const km = safeNum(data.kosztDojazduKm, 0, 0)
  if (km > 0) {
    push({
      key: 'log:dojazd',
      section: 'logistyka',
      label: 'Dojazd (paliwo)',
      unitLabel: 'km',
      defaultQuantity: km,
      defaultUnitCost: computeFuelRatePerKm(data),
    })
  }
  if (data.includeCatering) {
    const qty = data.cateringOverride ? safeNum(data.cateringCustomDays, 1, 1) : autoCrewDays
    if (qty > 0) {
      push({
        key: 'log:catering',
        section: 'logistyka',
        label: 'Catering',
        unitLabel: 'osobodzień',
        defaultQuantity: qty,
        defaultUnitCost: safeNum(data.cateringRate, 100, 0),
      })
    }
  }
  if (data.includeLodging) {
    const qty = data.lodgingOverride ? safeNum(data.lodgingCustomDays, 1, 1) : autoCrewDays
    if (qty > 0) {
      push({
        key: 'log:noclegi',
        section: 'logistyka',
        label: 'Noclegi',
        unitLabel: 'osobodzień',
        defaultQuantity: qty,
        defaultUnitCost: safeNum(data.lodgingRate, 300, 0),
      })
    }
  }

  return lines
}

function applyOverride(line: ProfitDerivedLine, override: ProfitLineOverride | undefined): ProfitLine {
  const defaultIsCost = line.defaultIsCost ?? true
  const isCost = override?.isCost ?? defaultIsCost
  const quantity = safeNum(override?.quantity ?? line.defaultQuantity, line.defaultQuantity, 0)
  const unitCost = safeNum(override?.unitCost ?? line.defaultUnitCost, line.defaultUnitCost, 0)
  const isOverridden =
    override != null &&
    ((override.isCost != null && override.isCost !== defaultIsCost) ||
      (override.quantity != null && override.quantity !== line.defaultQuantity) ||
      (override.unitCost != null && override.unitCost !== line.defaultUnitCost))
  return {
    ...line,
    isCost,
    quantity,
    unitCost,
    total: isCost ? quantity * unitCost : 0,
    isOverridden,
    isCustom: false,
  }
}

function customItemToLine(item: ProfitCustomItem): ProfitLine {
  const quantity = safeNum(item.quantity, 1, 0)
  const unitCost = safeNum(item.unitCost, 0, 0)
  return {
    key: `custom:${item.id}`,
    section: item.section,
    label: item.label,
    unitLabel: 'szt.',
    defaultQuantity: quantity,
    defaultUnitCost: unitCost,
    isCost: item.isCost,
    quantity,
    unitCost,
    total: item.isCost ? quantity * unitCost : 0,
    isOverridden: false,
    isCustom: true,
    customId: item.id,
  }
}

const SECTION_ORDER: ProfitSectionKey[] = ['preprodukcja', 'produkcja', 'postprodukcja', 'logistyka']

export function resolveProfitSections(
  data: QuoteData,
  pricing: PricingConfigShape,
  autoCrewDays: number
): { sections: ProfitSectionResult[]; totalCost: number } {
  const overrides = data.profitOverrides ?? {}
  const derived = buildDerivedCostLines(data, pricing, autoCrewDays)
  const customItems = safeArray<ProfitCustomItem>(data.profitCustomItems)

  const sections: ProfitSectionResult[] = SECTION_ORDER.map((section) => {
    const lines: ProfitLine[] = [
      ...derived.filter(l => l.section === section).map(l => applyOverride(l, overrides[l.key])),
      ...customItems.filter(c => c.section === section).map(customItemToLine),
    ]
    return {
      section,
      lines,
      totalCost: lines.reduce((s, l) => s + l.total, 0),
    }
  })

  return {
    sections,
    totalCost: sections.reduce((s, sec) => s + sec.totalCost, 0),
  }
}

export interface ProfitSummary {
  sumaNetto: number
  taxRatePercent: number
  podatek: number
  koszty: number
  zysk: number
  /** Zysk jako % sumy netto (0 gdy suma = 0). */
  marzaPct: number
}

export function computeProfitSummary(sumaNetto: number, taxRatePercent: number, koszty: number): ProfitSummary {
  const suma = safeNum(sumaNetto, 0, 0)
  const rate = Math.max(0, Math.min(100, safeNum(taxRatePercent, 8.5, 0)))
  const podatek = suma * (rate / 100)
  const zysk = suma - podatek - koszty
  return {
    sumaNetto: suma,
    taxRatePercent: rate,
    podatek,
    koszty,
    zysk,
    marzaPct: suma > 0 ? (zysk / suma) * 100 : 0,
  }
}
