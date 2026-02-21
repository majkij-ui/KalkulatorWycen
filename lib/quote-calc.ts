'use client'

import type { QuoteData, ShootingDay } from './quote-types'
import type { PricingConfigShape, PricingTier } from './pricing-config'

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

function applyMargin(value: number, marginPercent: number): number {
  return value * (1 + marginPercent / 100)
}

/** Oblicza ilość/jednostkę dla pozycji z cennika na podstawie QuoteData (postprodukcja) */
function getQuantity(key: string, data: QuoteData): number {
  switch (key) {
    case 'montazZaDzien':
      return data.dniMontazu
    case 'korekcjaBarwna':
      return data.korekcjaBarwna ? 1 : 0
    case 'lektor':
      return data.lektor ? 1 : 0
    default:
      return 0
  }
}

function getQuantityLabel(key: string, data: QuoteData): string {
  const q = getQuantity(key, data)
  switch (key) {
    case 'montazZaDzien':
      return `${q} dni`
    case 'korekcjaBarwna':
      return data.korekcjaBarwna ? 'Tak' : 'Nie'
    case 'lektor':
      return data.lektor ? 'Tak' : 'Nie'
    default:
      return String(q)
  }
}

const LABELS: Record<string, string> = {
  montazZaDzien: 'Montaż (za dzień)',
  korekcjaBarwna: 'Korekcja barwna',
  lektor: 'Lektor',
}

function computeShootingDayNet(day: ShootingDay, pro: PricingConfigShape['produkcja'], tier: PricingTier): number {
  let total = 0
  total += day.rezOp * pro.rezOp[tier]
  total += day.asystent * pro.asystentOperator[tier]
  total += day.gafer * pro.gafer[tier]
  total += day.dzwiekowiec * pro.dzwiekowiec[tier]
  total += day.mua * pro.mua[tier]
  total += day.aktor * pro.aktor[tier]
  total += day.model * pro.model[tier]
  total += day.statysta * pro.statystaEpizodysta[tier]
  total += day.kameraSony * pro.kameraSonyMirrorless[tier]
  total += day.kameraRed * pro.kameraRedKomodoX[tier]
  if (day.obiektywy === 'rental') total += pro.obiektywyRental[tier]
  if (day.stabilizacja === 'rental') total += pro.stabilizacjaRental[tier]
  if (day.podglad === 'rental') total += pro.podgladRental[tier]
  if (day.swiatlo === 'rental') total += pro.swiatloRental[tier]
  if (day.dron === 'dji') total += pro.dronDji[tier]
  if (day.dron === 'fpv') total += pro.dronFpv[tier]
  return total
}

export function getBreakdownWithPricing(
  data: QuoteData,
  tier: PricingTier,
  marginPercent: number,
  pricing: PricingConfigShape
): PhaseBreakdown[] {
  const preItems: LineItemRow[] = []
  const proItems: LineItemRow[] = []
  const postItems: LineItemRow[] = []

  const addPost = (
    list: LineItemRow[],
    key: keyof PricingConfigShape['postprodukcja'],
    unitPrice: number
  ) => {
    const q = getQuantity(key as string, data)
    const label = LABELS[key as string] ?? key
    const value = getQuantityLabel(key as string, data)
    const lineNetto = applyMargin(unitPrice * q, marginPercent)
    list.push({ label, value, quantity: q, unitPriceNet: unitPrice, lineNetto })
  }

  const pre = pricing.preprodukcja
  if (!data.isDetailedPrepro) {
    const q = data.dniDokumentacji
    const unitPrice = pre.dzienDokumentacji[tier]
    const value = q % 1 === 0 ? `${q} dni` : `${q} dni`.replace('.', ',')
    preItems.push({
      label: 'Dzień dokumentacji',
      value,
      quantity: q,
      unitPriceNet: unitPrice,
      lineNetto: applyMargin(unitPrice * q, marginPercent),
    })
  } else {
    const scenariuszNet = data.scenariusz === 'brak' ? 0 : data.scenariusz === 'podstawowy' ? pre.scenariuszPodstawowy[tier] : pre.scenariuszRozbudowany[tier]
    preItems.push({
      label: 'Scenariusz',
      value: data.scenariusz === 'brak' ? 'Brak' : data.scenariusz === 'podstawowy' ? 'Podstawowy' : 'Rozbudowany',
      quantity: 1,
      unitPriceNet: scenariuszNet,
      lineNetto: applyMargin(scenariuszNet, marginPercent),
    })
    const wizjaNet = data.wizjaLokalna ? pre.wizjaLokalna[tier] : 0
    preItems.push({
      label: 'Wizja lokalna',
      value: data.wizjaLokalna ? 'Tak' : 'Nie',
      quantity: data.wizjaLokalna ? 1 : 0,
      unitPriceNet: pre.wizjaLokalna[tier],
      lineNetto: applyMargin(wizjaNet, marginPercent),
    })
    const kierNet = data.kierownikProdukcji ? pre.kierownikProdukcji[tier] : 0
    preItems.push({
      label: 'Kierownik produkcji',
      value: data.kierownikProdukcji ? 'Tak' : 'Nie',
      quantity: data.kierownikProdukcji ? 1 : 0,
      unitPriceNet: pre.kierownikProdukcji[tier],
      lineNetto: applyMargin(kierNet, marginPercent),
    })
  }

  const pro = pricing.produkcja
  if (!data.isDetailedProdukcja) {
    const days = data.dniZdjeciowe
    const dayRate = pro.dzienZdjeciowyEkipa[tier]
    const pakietKey = data.klasaSprzetu
    const pakiet = pakietKey === 'minimalistyczny' ? pro.pakietSprzetowyMinimalistyczny[tier] : pakietKey === 'kinowy' ? pro.pakietSprzetowyKinowy[tier] : pro.pakietSprzetowyStandard[tier]
    const pakietLabel = pakietKey === 'minimalistyczny' ? 'Minimalistyczny' : pakietKey === 'kinowy' ? 'Kinowy' : 'Standard'
    proItems.push({
      label: 'Dzień zdjęciowy (Crude)',
      value: `${days} dni`,
      quantity: days,
      unitPriceNet: dayRate,
      lineNetto: applyMargin(dayRate * days, marginPercent),
    })
    proItems.push({
      label: 'Pakiet sprzętowy',
      value: pakietLabel,
      quantity: days,
      unitPriceNet: pakiet,
      lineNetto: applyMargin(pakiet * days, marginPercent),
    })
  } else {
    data.detailedShootingDays.forEach((day, i) => {
      const dayNet = computeShootingDayNet(day, pro, tier)
      proItems.push({
        label: `Dzień zdjęciowy ${i + 1}`,
        value: 'Szczegółowa wycena',
        quantity: 1,
        unitPriceNet: dayNet,
        lineNetto: applyMargin(dayNet, marginPercent),
      })
    })
  }

  const post = pricing.postprodukcja
  addPost(postItems, 'montazZaDzien', post.montazZaDzien[tier])
  addPost(postItems, 'korekcjaBarwna', post.korekcjaBarwna[tier])
  addPost(postItems, 'lektor', post.lektor[tier])

  const toPhase = (category: string, items: LineItemRow[]): PhaseBreakdown => ({
    category,
    items,
    phaseNetto: items.reduce((s, i) => s + i.lineNetto, 0),
  })

  return [
    toPhase('Preprodukcja', preItems),
    toPhase('Produkcja', proItems),
    toPhase('Postprodukcja', postItems),
  ]
}

export function getTotals(
  data: QuoteData,
  tier: PricingTier,
  marginPercent: number,
  pricing: PricingConfigShape
): Totals {
  const phases = getBreakdownWithPricing(data, tier, marginPercent, pricing)
  const sumaNetto = phases.reduce((s, p) => s + p.phaseNetto, 0)
  const vat = sumaNetto * VAT_RATE
  const sumaBrutto = sumaNetto + vat
  return { sumaNetto, vat, sumaBrutto }
}
