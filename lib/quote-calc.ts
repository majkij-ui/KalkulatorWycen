'use client'

import type { QuoteData, ShootingDay, Deliverable } from './quote-types'
import type { PricingConfigShape } from './pricing-config'
import { safeNum, safeArray } from './safe-numbers'

const VAT_RATE = 0.23

/** Format kwoty w PLN, np. "1 500,00 zł" */
export function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
}

export interface LineItemRow {
  label: string
  value: string
  quantity: number
  unitPriceNet: number
  lineNetto: number
}

export interface PhaseBreakdown {
  category: string
  items: LineItemRow[]
  phaseNetto: number
}

export interface Totals {
  sumaNetto: number
  vat: number
  sumaBrutto: number
}

function applyMargin(value: number, marginMultiplier: number): number {
  return value * marginMultiplier
}

function getFormatPrice(post: PricingConfigShape['postprodukcja'], formatKey: string): number {
  const key = formatKey?.startsWith('Format: ') ? formatKey : null
  const price = key != null ? post[key] : undefined
  if (typeof price === 'number') return price
  // Fall back to first available format
  const firstKey = Object.keys(post).find(k => k.startsWith('Format: '))
  const fallback = firstKey != null ? post[firstKey] : undefined
  return typeof fallback === 'number' ? fallback : 0
}

function computeDeliverableNet(d: Deliverable, post: PricingConfigShape['postprodukcja']): number {
  const formatPrice = getFormatPrice(post, d.format)
  let total = formatPrice * d.ilosc
  if (d.korekcjaBarwna === 'podstawowa') total += post.korekcjaBarwnaPodstawowa
  if (d.korekcjaBarwna === 'zaawansowana') total += post.korekcjaBarwnaZaawansowana
  if (d.animacje === '2d') total += post.animacje2d
  if (d.animacje === 'ai') total += post.animacjeAi
  if (d.muzyka === 'copyfree') total += post.muzykaCopyfree
  if (d.muzyka === 'kompozytor') total += post.muzykaKompozytor
  if (d.soundDesign === 'prosty') total += post.soundDesignProsty
  if (d.soundDesign === 'zlozony') total += post.soundDesignZlozony
  if (d.masterDzwieku === 'podstawowy') total += post.masterDzwiekuPodstawowy
  if (d.masterDzwieku === 'zlozony') total += post.masterDzwiekuZlozony
  if (d.lektor === 'ai') total += post.lektorAi
  if (d.lektor === 'studio') total += post.lektorStudio
  return total
}

function computeShootingDayNet(day: ShootingDay, pro: PricingConfigShape['produkcja']): number {
  let total = 0
  total += day.rezOp * pro.rezOp
  total += day.asystent * pro.asystentOperator
  total += day.gafer * pro.gafer
  total += day.dzwiekowiec * pro.dzwiekowiec
  total += day.mua * pro.mua
  total += day.aktor * pro.aktor
  total += day.model * pro.model
  total += day.statysta * pro.statystaEpizodysta
  total += day.kameraSony * pro.kameraSonyMirrorless
  total += day.kameraRed * pro.kameraRedKomodoX
  if (day.obiektywy === 'standard') total += pro.obiektywyStandard
  if (day.obiektywy === 'rental') total += pro.obiektywyRental
  if (day.stabilizacja === 'standard') total += pro.stabilizacjaStandard
  if (day.stabilizacja === 'rental') total += pro.stabilizacjaRental
  if (day.podglad === 'standard') total += pro.podgladStandard
  if (day.podglad === 'rental') total += pro.podgladRental
  if (day.swiatlo === 'standard') total += pro.swiatloStandard
  if (day.swiatlo === 'rental') total += pro.swiatloRental
  if (day.dron === 'dji') total += pro.dronDji
  if (day.dron === 'fpv') total += pro.dronFpv
  return total
}

export function getBreakdownWithPricing(
  data: QuoteData,
  marginMultiplier: number,
  pricing: PricingConfigShape
): PhaseBreakdown[] {
  const preItems: LineItemRow[] = []
  const proItems: LineItemRow[] = []
  const postItems: LineItemRow[] = []
  const dodatkoweItems: LineItemRow[] = []

  const pre = pricing.preprodukcja
  if (!data.isDetailedPrepro) {
    const q = safeNum(data.dniDokumentacji, 0, 0)
    const unitPrice = pre.dzienDokumentacji
    const value = q % 1 === 0 ? `${q} dni` : `${q} dni`.replace('.', ',')
    preItems.push({
      label: 'Dzień dokumentacji',
      value,
      quantity: q,
      unitPriceNet: unitPrice,
      lineNetto: applyMargin(unitPrice * q, marginMultiplier),
    })
  } else {
    const scenariuszNet = data.scenariusz === 'brak' ? 0 : data.scenariusz === 'podstawowy' ? pre.scenariuszPodstawowy : pre.scenariuszRozbudowany
    preItems.push({
      label: 'Scenariusz',
      value: data.scenariusz === 'brak' ? 'Brak' : data.scenariusz === 'podstawowy' ? 'Podstawowy' : 'Rozbudowany',
      quantity: 1,
      unitPriceNet: scenariuszNet,
      lineNetto: applyMargin(scenariuszNet, marginMultiplier),
    })
    const wizjaNet = data.wizjaLokalna ? pre.wizjaLokalna : 0
    preItems.push({
      label: 'Wizja lokalna',
      value: data.wizjaLokalna ? 'Tak' : 'Nie',
      quantity: data.wizjaLokalna ? 1 : 0,
      unitPriceNet: pre.wizjaLokalna,
      lineNetto: applyMargin(wizjaNet, marginMultiplier),
    })
    const kierNet = data.kierownikProdukcji ? pre.kierownikProdukcji : 0
    preItems.push({
      label: 'Kierownik produkcji',
      value: data.kierownikProdukcji ? 'Tak' : 'Nie',
      quantity: data.kierownikProdukcji ? 1 : 0,
      unitPriceNet: pre.kierownikProdukcji,
      lineNetto: applyMargin(kierNet, marginMultiplier),
    })
  }

  const pro = pricing.produkcja
  if (!data.isDetailedProdukcja) {
    const days = safeNum(data.dniZdjeciowe, 0, 0)
    const crew = safeNum(data.wielkoscEkipy, 1, 1)
    const stawkaOp = pro.stawkaOperatoraSzybkaWycena
    const pakietKey = data.klasaSprzetu
    const pakiet = pakietKey === 'minimalistyczny' ? pro.pakietSprzetowyMinimalistyczny : pakietKey === 'kinowy' ? pro.pakietSprzetowyKinowy : pro.pakietSprzetowyStandard
    const doplataRezOp = data.crudeRezOpSurcharge ? pro.doplataRezOpSzybkaWycena : 0
    const doplataDron = data.crudeDroneSurcharge ? pro.doplataDronSzybkaWycena : 0
    const dayRate = crew * stawkaOp + pakiet + doplataRezOp + doplataDron
    const lineNetto = applyMargin(dayRate * days, marginMultiplier)
    const rezOpText = data.crudeRezOpSurcharge ? ' + Reż-Op' : ''
    const droneText = data.crudeDroneSurcharge ? ' + Dron' : ''
    const surchargeStr = rezOpText + droneText
    proItems.push({
      label: 'Szybka wycena produkcji',
      value: `${days} dni × (${crew} os. × stawka + pakiet${surchargeStr})`,
      quantity: days,
      unitPriceNet: dayRate,
      lineNetto,
    })
  } else {
    safeArray<ShootingDay>(data.detailedShootingDays).forEach((day, i) => {
      const dayNet = computeShootingDayNet(day, pro)
      proItems.push({
        label: `Dzień zdjęciowy ${i + 1}`,
        value: 'Szczegółowa wycena',
        quantity: 1,
        unitPriceNet: dayNet,
        lineNetto: applyMargin(dayNet, marginMultiplier),
      })
    })
  }

  const post = pricing.postprodukcja
  if (!data.isDetailedPostpro) {
    const unit = data.crudeEditUnit
    const q = safeNum(data.crudeEditCount, 0, 0)
    const unitPrice = unit === 'dni' ? post.montazZaDzien : post.montazZaGodzine
    const value = unit === 'dni'
      ? (q % 1 === 0 ? `${q} dni` : `${q} dni`.replace('.', ','))
      : `${q} godz.`
    postItems.push({
      label: unit === 'dni' ? 'Montaż (dni)' : 'Montaż (godziny)',
      value,
      quantity: q,
      unitPriceNet: unitPrice,
      lineNetto: applyMargin(unitPrice * q, marginMultiplier),
    })
  } else {
    safeArray<Deliverable>(data.detailedDeliverables).forEach((del, i) => {
      const net = computeDeliverableNet(del, post)
      const formatLabel = del.format.startsWith('Format: ') ? del.format.slice(8) : del.format
      postItems.push({
        label: `Format / Dostawa ${i + 1}`,
        value: `${del.ilosc}× ${formatLabel}`,
        quantity: 1,
        unitPriceNet: net,
        lineNetto: applyMargin(net, marginMultiplier),
      })
    })
  }

  const dod = pricing.dodatkowe
  const km = safeNum(data.kosztDojazduKm, 0, 0)
  const kmRate = dod.kosztDojazduKm
  const travelNetto = applyMargin(kmRate * km, marginMultiplier)
  dodatkoweItems.push({
    label: 'Koszty dojazdu',
    value: `${km} km`,
    quantity: km,
    unitPriceNet: kmRate,
    lineNetto: travelNetto,
  })

  const toPhase = (category: string, items: LineItemRow[]): PhaseBreakdown => ({
    category,
    items,
    phaseNetto: items.reduce((s, i) => s + i.lineNetto, 0),
  })

  const phasesWithoutCopyright: PhaseBreakdown[] = [
    toPhase('Preprodukcja', preItems),
    toPhase('Produkcja', proItems),
    toPhase('Postprodukcja', postItems),
    toPhase('Dodatkowe', [...dodatkoweItems]),
  ]
  const baseSubtotal = phasesWithoutCopyright.reduce((s, p) => s + p.phaseNetto, 0)

  if (data.copyrightType === 'przekazanie') {
    const pct = dod.pelnePrzekazaniePrawProcent
    const surcharge = baseSubtotal * (pct / 100)
    dodatkoweItems.push({
      label: 'Pełne przekazanie praw',
      value: `${pct}% od sumy`,
      quantity: 1,
      unitPriceNet: surcharge,
      lineNetto: surcharge,
    })
  }

  return [
    toPhase('Preprodukcja', preItems),
    toPhase('Produkcja', proItems),
    toPhase('Postprodukcja', postItems),
    toPhase('Dodatkowe', dodatkoweItems),
  ]
}

export function getProductionEkipaSprzetNetto(
  data: QuoteData,
  marginMultiplier: number,
  pricing: PricingConfigShape
): { ekipaNetto: number; sprzetNetto: number } {
  const pro = pricing.produkcja

  if (!data.isDetailedProdukcja) {
    const days = safeNum(data.dniZdjeciowe, 0, 0)
    const crew = safeNum(data.wielkoscEkipy, 1, 1)
    const stawkaOp = pro.stawkaOperatoraSzybkaWycena

    const pakietKey = data.klasaSprzetu
    const pakiet =
      pakietKey === 'minimalistyczny'
        ? pro.pakietSprzetowyMinimalistyczny
        : pakietKey === 'kinowy'
          ? pro.pakietSprzetowyKinowy
          : pro.pakietSprzetowyStandard

    const doplataRezOp = data.crudeRezOpSurcharge ? pro.doplataRezOpSzybkaWycena : 0
    const doplataDron = data.crudeDroneSurcharge ? pro.doplataDronSzybkaWycena : 0

    const ekipaBaseDayNetto = crew * stawkaOp + doplataRezOp
    const sprzetBaseDayNetto = pakiet + doplataDron

    return {
      ekipaNetto: applyMargin(ekipaBaseDayNetto * days, marginMultiplier),
      sprzetNetto: applyMargin(sprzetBaseDayNetto * days, marginMultiplier),
    }
  }

  let ekipaNetto = 0
  let sprzetNetto = 0

  safeArray<ShootingDay>(data.detailedShootingDays).forEach((day) => {
    const rolesNetto =
      day.rezOp * pro.rezOp +
      day.asystent * pro.asystentOperator +
      day.gafer * pro.gafer +
      day.dzwiekowiec * pro.dzwiekowiec +
      day.mua * pro.mua +
      day.aktor * pro.aktor +
      day.model * pro.model +
      day.statysta * pro.statystaEpizodysta

    let equipmentNetto = 0
    equipmentNetto += day.kameraSony * pro.kameraSonyMirrorless
    equipmentNetto += day.kameraRed * pro.kameraRedKomodoX

    if (day.obiektywy === 'standard') equipmentNetto += pro.obiektywyStandard
    if (day.obiektywy === 'rental') equipmentNetto += pro.obiektywyRental

    if (day.stabilizacja === 'standard') equipmentNetto += pro.stabilizacjaStandard
    if (day.stabilizacja === 'rental') equipmentNetto += pro.stabilizacjaRental

    if (day.podglad === 'standard') equipmentNetto += pro.podgladStandard
    if (day.podglad === 'rental') equipmentNetto += pro.podgladRental

    if (day.swiatlo === 'standard') equipmentNetto += pro.swiatloStandard
    if (day.swiatlo === 'rental') equipmentNetto += pro.swiatloRental

    if (day.dron === 'dji') equipmentNetto += pro.dronDji
    if (day.dron === 'fpv') equipmentNetto += pro.dronFpv

    ekipaNetto += applyMargin(rolesNetto, marginMultiplier)
    sprzetNetto += applyMargin(equipmentNetto, marginMultiplier)
  })

  return { ekipaNetto, sprzetNetto }
}

export function getTotals(
  data: QuoteData,
  marginMultiplier: number,
  pricing: PricingConfigShape
): Totals {
  const phases = getBreakdownWithPricing(data, marginMultiplier, pricing)
  const sumaNetto = phases.reduce((s, p) => s + p.phaseNetto, 0)
  const vat = sumaNetto * VAT_RATE
  const sumaBrutto = sumaNetto + vat
  return { sumaNetto, vat, sumaBrutto }
}
