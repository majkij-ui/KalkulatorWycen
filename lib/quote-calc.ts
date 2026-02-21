'use client'

import type { QuoteData } from './quote-types'
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

/** Oblicza ilość/jednostkę dla pozycji z cennika na podstawie QuoteData (produkcja, postprodukcja) */
function getQuantity(key: string, data: QuoteData): number {
  switch (key) {
    case 'dzienZdjeciowyEkipa':
      return data.dniZdjeciowe
    case 'sprzetRental':
      return data.dniZdjeciowe
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
    case 'dzienZdjeciowyEkipa':
      return `${q} dni`
    case 'sprzetRental':
      return `${q} dni`
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
  dzienZdjeciowyEkipa: 'Dzień zdjęciowy (Ekipa)',
  sprzetRental: 'Sprzęt (Rental)',
  montazZaDzien: 'Montaż (za dzień)',
  korekcjaBarwna: 'Korekcja barwna',
  lektor: 'Lektor',
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

  const add = (
    list: LineItemRow[],
    key: keyof PricingConfigShape['produkcja'] | keyof PricingConfigShape['postprodukcja'],
    unitPrice: number,
    category: 'pro' | 'post'
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
  add(proItems, 'dzienZdjeciowyEkipa', pro.dzienZdjeciowyEkipa[tier], 'pro')
  add(proItems, 'sprzetRental', pro.sprzetRental[tier], 'pro')

  const post = pricing.postprodukcja
  add(postItems, 'montazZaDzien', post.montazZaDzien[tier], 'post')
  add(postItems, 'korekcjaBarwna', post.korekcjaBarwna[tier], 'post')
  add(postItems, 'lektor', post.lektor[tier], 'post')

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
