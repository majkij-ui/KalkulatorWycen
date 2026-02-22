'use client'

import type { QuoteData, ShootingDay, Deliverable } from './quote-types'
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

function computeDeliverableNet(d: Deliverable, post: PricingConfigShape['postprodukcja'], tier: PricingTier): number {
  const formatPrice = d.format === 'shorts' ? post.formatShortsReel[tier] : post.formatReportaz[tier]
  let total = formatPrice * d.ilosc
  if (d.korekcjaBarwna === 'podstawowa') total += post.korekcjaBarwnaPodstawowa[tier]
  if (d.korekcjaBarwna === 'zaawansowana') total += post.korekcjaBarwnaZaawansowana[tier]
  if (d.animacje === '2d') total += post.animacje2d[tier]
  if (d.animacje === 'ai') total += post.animacjeAi[tier]
  if (d.muzyka === 'copyfree') total += post.muzykaCopyfree[tier]
  if (d.muzyka === 'kompozytor') total += post.muzykaKompozytor[tier]
  if (d.soundDesign === 'prosty') total += post.soundDesignProsty[tier]
  if (d.soundDesign === 'zlozony') total += post.soundDesignZlozony[tier]
  if (d.masterDzwieku === 'podstawowy') total += post.masterDzwiekuPodstawowy[tier]
  if (d.masterDzwieku === 'zlozony') total += post.masterDzwiekuZlozony[tier]
  if (d.lektor === 'ai') total += post.lektorAi[tier]
  if (d.lektor === 'studio') total += post.lektorStudio[tier]
  return total
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
  if (day.obiektywy === 'standard') total += pro.obiektywyStandard[tier]
  if (day.obiektywy === 'rental') total += pro.obiektywyRental[tier]
  if (day.stabilizacja === 'standard') total += pro.stabilizacjaStandard[tier]
  if (day.stabilizacja === 'rental') total += pro.stabilizacjaRental[tier]
  if (day.podglad === 'standard') total += pro.podgladStandard[tier]
  if (day.podglad === 'rental') total += pro.podgladRental[tier]
  if (day.swiatlo === 'standard') total += pro.swiatloStandard[tier]
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
  const dodatkoweItems: LineItemRow[] = []

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
    const crew = data.wielkoscEkipy
    const stawkaOp = pro.stawkaOperatoraSzybkaWycena[tier]
    const pakietKey = data.klasaSprzetu
    const pakiet = pakietKey === 'minimalistyczny' ? pro.pakietSprzetowyMinimalistyczny[tier] : pakietKey === 'kinowy' ? pro.pakietSprzetowyKinowy[tier] : pro.pakietSprzetowyStandard[tier]
    const doplataRezOp = data.crudeRezOpSurcharge ? pro.doplataRezOpSzybkaWycena[tier] : 0
    const dayRate = crew * stawkaOp + pakiet + doplataRezOp
    const lineNetto = applyMargin(dayRate * days, marginPercent)
    proItems.push({
      label: 'Szybka wycena produkcji',
      value: `${days} dni × (${crew} os. × stawka + pakiet${data.crudeRezOpSurcharge ? ' + Reż-Op' : ''})`,
      quantity: days,
      unitPriceNet: dayRate,
      lineNetto,
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
  if (!data.isDetailedPostpro) {
    const unit = data.crudeEditUnit
    const q = data.crudeEditCount
    const unitPrice = unit === 'dni' ? post.montazZaDzien[tier] : post.montazZaGodzine[tier]
    const value = unit === 'dni'
      ? (q % 1 === 0 ? `${q} dni` : `${q} dni`.replace('.', ','))
      : `${q} godz.`
    postItems.push({
      label: unit === 'dni' ? 'Montaż (dni)' : 'Montaż (godziny)',
      value,
      quantity: q,
      unitPriceNet: unitPrice,
      lineNetto: applyMargin(unitPrice * q, marginPercent),
    })
  } else {
    data.detailedDeliverables.forEach((del, i) => {
      const net = computeDeliverableNet(del, post, tier)
      const formatLabel = del.format === 'shorts' ? 'do 30s shorts/reel' : '1–3 min reportaż'
      postItems.push({
        label: `Format / Dostawa ${i + 1}`,
        value: `${del.ilosc}× ${formatLabel}`,
        quantity: 1,
        unitPriceNet: net,
        lineNetto: applyMargin(net, marginPercent),
      })
    })
  }

  const dod = pricing.dodatkowe
  const km = data.kosztDojazduKm
  const kmRate = dod.kosztDojazduKm[tier]
  dodatkoweItems.push({
    label: 'Koszty dojazdu',
    value: `${km} km`,
    quantity: km,
    unitPriceNet: kmRate,
    lineNetto: applyMargin(kmRate * km, marginPercent),
  })

  const toPhase = (category: string, items: LineItemRow[]): PhaseBreakdown => ({
    category,
    items,
    phaseNetto: items.reduce((s, i) => s + i.lineNetto, 0),
  })

  return [
    toPhase('Preprodukcja', preItems),
    toPhase('Produkcja', proItems),
    toPhase('Postprodukcja', postItems),
    toPhase('Dodatkowe', dodatkoweItems),
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
