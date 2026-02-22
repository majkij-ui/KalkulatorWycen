/**
 * Konfiguracja stawek netto (PLN) dla kalkulatora wyceny wideo.
 * Trzy poziomy: Tani (Freelancer), Standard (Boutique), Agresywny (Agency).
 */

export type PricingTier = 'tani' | 'standard' | 'agresywny'

export interface TierPrices {
  tani: number
  standard: number
  agresywny: number
}

export interface PricingConfigShape {
  preprodukcja: {
    dzienDokumentacji: TierPrices
    scenariuszPodstawowy: TierPrices
    scenariuszRozbudowany: TierPrices
    wizjaLokalna: TierPrices
    kierownikProdukcji: TierPrices
  }
  produkcja: {
    dzienZdjeciowyEkipa: TierPrices
    pakietSprzetowyMinimalistyczny: TierPrices
    pakietSprzetowyStandard: TierPrices
    pakietSprzetowyKinowy: TierPrices
    rezOp: TierPrices
    asystentOperator: TierPrices
    gafer: TierPrices
    dzwiekowiec: TierPrices
    mua: TierPrices
    aktor: TierPrices
    model: TierPrices
    statystaEpizodysta: TierPrices
    kameraSonyMirrorless: TierPrices
    kameraRedKomodoX: TierPrices
    obiektywyRental: TierPrices
    stabilizacjaRental: TierPrices
    podgladRental: TierPrices
    swiatloRental: TierPrices
    dronDji: TierPrices
    dronFpv: TierPrices
  }
  postprodukcja: {
    montazZaDzien: TierPrices
    montazZaGodzine: TierPrices
    formatShortsReel: TierPrices
    formatReportaz: TierPrices
    korekcjaBarwnaPodstawowa: TierPrices
    korekcjaBarwnaZaawansowana: TierPrices
    animacje2d: TierPrices
    animacjeAi: TierPrices
    muzykaCopyfree: TierPrices
    muzykaKompozytor: TierPrices
    soundDesignProsty: TierPrices
    soundDesignZlozony: TierPrices
    masterDzwiekuPodstawowy: TierPrices
    masterDzwiekuZlozony: TierPrices
    lektorAi: TierPrices
    lektorStudio: TierPrices
  }
}

export const DEFAULT_PRICING: PricingConfigShape = {
  preprodukcja: {
    dzienDokumentacji: { tani: 600, standard: 1200, agresywny: 2500 },
    scenariuszPodstawowy: { tani: 800, standard: 1800, agresywny: 4500 },
    scenariuszRozbudowany: { tani: 1500, standard: 3500, agresywny: 8000 },
    wizjaLokalna: { tani: 400, standard: 800, agresywny: 1500 },
    kierownikProdukcji: { tani: 600, standard: 1500, agresywny: 3000 },
  },
  produkcja: {
    dzienZdjeciowyEkipa: { tani: 1500, standard: 3500, agresywny: 8000 },
    pakietSprzetowyMinimalistyczny: { tani: 300, standard: 800, agresywny: 1500 },
    pakietSprzetowyStandard: { tani: 600, standard: 1500, agresywny: 3000 },
    pakietSprzetowyKinowy: { tani: 1500, standard: 3500, agresywny: 7000 },
    rezOp: { tani: 1500, standard: 2500, agresywny: 4000 },
    asystentOperator: { tani: 800, standard: 1500, agresywny: 2500 },
    gafer: { tani: 800, standard: 1500, agresywny: 2500 },
    dzwiekowiec: { tani: 800, standard: 1500, agresywny: 2500 },
    mua: { tani: 600, standard: 1200, agresywny: 2000 },
    aktor: { tani: 1000, standard: 2500, agresywny: 5000 },
    model: { tani: 800, standard: 1500, agresywny: 3000 },
    statystaEpizodysta: { tani: 200, standard: 400, agresywny: 800 },
    kameraSonyMirrorless: { tani: 300, standard: 600, agresywny: 1000 },
    kameraRedKomodoX: { tani: 800, standard: 1500, agresywny: 3000 },
    obiektywyRental: { tani: 600, standard: 1500, agresywny: 3000 },
    stabilizacjaRental: { tani: 400, standard: 800, agresywny: 1500 },
    podgladRental: { tani: 300, standard: 600, agresywny: 1200 },
    swiatloRental: { tani: 800, standard: 2000, agresywny: 5000 },
    dronDji: { tani: 300, standard: 600, agresywny: 1200 },
    dronFpv: { tani: 800, standard: 1500, agresywny: 3000 },
  },
  postprodukcja: {
    montazZaDzien: { tani: 800, standard: 1500, agresywny: 3000 },
    montazZaGodzine: { tani: 100, standard: 200, agresywny: 400 },
    formatShortsReel: { tani: 300, standard: 800, agresywny: 1500 },
    formatReportaz: { tani: 1000, standard: 2500, agresywny: 5000 },
    korekcjaBarwnaPodstawowa: { tani: 200, standard: 500, agresywny: 1000 },
    korekcjaBarwnaZaawansowana: { tani: 500, standard: 1200, agresywny: 2500 },
    animacje2d: { tani: 400, standard: 1000, agresywny: 2500 },
    animacjeAi: { tani: 600, standard: 1500, agresywny: 3500 },
    muzykaCopyfree: { tani: 100, standard: 300, agresywny: 800 },
    muzykaKompozytor: { tani: 1000, standard: 3000, agresywny: 8000 },
    soundDesignProsty: { tani: 200, standard: 500, agresywny: 1200 },
    soundDesignZlozony: { tani: 600, standard: 1500, agresywny: 3500 },
    masterDzwiekuPodstawowy: { tani: 150, standard: 400, agresywny: 800 },
    masterDzwiekuZlozony: { tani: 400, standard: 1000, agresywny: 2000 },
    lektorAi: { tani: 100, standard: 250, agresywny: 500 },
    lektorStudio: { tani: 400, standard: 1000, agresywny: 2500 },
  },
}

const STORAGE_KEY = 'quote-gen-pricing-config'

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function getPricingConfig(): PricingConfigShape {
  if (typeof window === 'undefined') return deepClone(DEFAULT_PRICING)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return deepClone(DEFAULT_PRICING)
    const parsed = JSON.parse(raw) as PricingConfigShape
    const merged = deepClone(DEFAULT_PRICING)
    if (parsed.preprodukcja) merged.preprodukcja = { ...merged.preprodukcja, ...parsed.preprodukcja }
    if (parsed.produkcja) merged.produkcja = { ...merged.produkcja, ...parsed.produkcja }
    if (parsed.postprodukcja) merged.postprodukcja = { ...merged.postprodukcja, ...parsed.postprodukcja }
    return merged
  } catch {
    return deepClone(DEFAULT_PRICING)
  }
}

export function savePricingConfig(config: PricingConfigShape): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

export function resetPricingToDefault(): PricingConfigShape {
  const def = deepClone(DEFAULT_PRICING)
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  return def
}
