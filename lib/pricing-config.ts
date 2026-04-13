/**
 * Konfiguracja stawek netto (PLN) dla kalkulatora wyceny wideo.
 * Jedna stawka bazowa na pozycję (poprzedni format tani/standard/agresywny jest migrowany
 * automatycznie – wartość "standard" staje się stawką bazową).
 */

/** @deprecated Stary format wielo-tierowy; używany wyłącznie do migracji danych z localStorage/settings.json */
export interface LegacyTierPrices {
  tani: number
  standard: number
  agresywny: number
}

/** Default first format key (used for new deliverables and fallback when a format is removed) */
export const DEFAULT_FORMAT_KEY = 'Format: do 30sek shorts/reel'
/** Second default format (for legacy shorts/reportaz mapping) */
export const REPORTAZ_FORMAT_KEY = 'Format: Reportaż 1-3min'

export interface PricingConfigShape {
  preprodukcja: {
    dzienDokumentacji: number
    scenariuszPodstawowy: number
    scenariuszRozbudowany: number
    wizjaLokalna: number
    kierownikProdukcji: number
  }
  produkcja: {
    stawkaOperatoraSzybkaWycena: number
    doplataRezOpSzybkaWycena: number
    doplataDronSzybkaWycena: number
    pakietSprzetowyMinimalistyczny: number
    pakietSprzetowyStandard: number
    pakietSprzetowyKinowy: number
    rezOp: number
    asystentOperator: number
    gafer: number
    dzwiekowiec: number
    mua: number
    aktor: number
    model: number
    statystaEpizodysta: number
    kameraSonyMirrorless: number
    kameraRedKomodoX: number
    obiektywyStandard: number
    obiektywyRental: number
    stabilizacjaStandard: number
    stabilizacjaRental: number
    podgladStandard: number
    podgladRental: number
    swiatloStandard: number
    swiatloRental: number
    dronDji: number
    dronFpv: number
  }
  postprodukcja: {
    montazZaDzien: number
    montazZaGodzine: number
    korekcjaBarwnaPodstawowa: number
    korekcjaBarwnaZaawansowana: number
    animacje2d: number
    animacjeAi: number
    muzykaCopyfree: number
    muzykaKompozytor: number
    soundDesignProsty: number
    soundDesignZlozony: number
    masterDzwiekuPodstawowy: number
    masterDzwiekuZlozony: number
    lektorAi: number
    lektorStudio: number
    /** Custom formats: key = "Format: <name>" */
    [key: string]: number
  }
  dodatkowe: {
    kosztDojazduKm: number
    /** Pełne przekazanie praw – % dopłaty od sumy */
    pelnePrzekazaniePrawProcent: number
  }
}

export const DEFAULT_PRICING: PricingConfigShape = {
  preprodukcja: {
    dzienDokumentacji: 1200,
    scenariuszPodstawowy: 1800,
    scenariuszRozbudowany: 3500,
    wizjaLokalna: 800,
    kierownikProdukcji: 1500,
  },
  produkcja: {
    stawkaOperatoraSzybkaWycena: 1500,
    doplataRezOpSzybkaWycena: 1000,
    doplataDronSzybkaWycena: 800,
    pakietSprzetowyMinimalistyczny: 800,
    pakietSprzetowyStandard: 1500,
    pakietSprzetowyKinowy: 3500,
    rezOp: 2500,
    asystentOperator: 1500,
    gafer: 1500,
    dzwiekowiec: 1500,
    mua: 1200,
    aktor: 2500,
    model: 1500,
    statystaEpizodysta: 400,
    kameraSonyMirrorless: 600,
    kameraRedKomodoX: 1500,
    obiektywyStandard: 500,
    obiektywyRental: 1500,
    stabilizacjaStandard: 400,
    stabilizacjaRental: 800,
    podgladStandard: 300,
    podgladRental: 600,
    swiatloStandard: 1000,
    swiatloRental: 2000,
    dronDji: 600,
    dronFpv: 1500,
  },
  postprodukcja: {
    montazZaDzien: 1500,
    montazZaGodzine: 200,
    'Format: do 30sek shorts/reel': 800,
    'Format: Reportaż 1-3min': 2500,
    korekcjaBarwnaPodstawowa: 500,
    korekcjaBarwnaZaawansowana: 1200,
    animacje2d: 1000,
    animacjeAi: 1500,
    muzykaCopyfree: 300,
    muzykaKompozytor: 3000,
    soundDesignProsty: 500,
    soundDesignZlozony: 1500,
    masterDzwiekuPodstawowy: 400,
    masterDzwiekuZlozony: 1000,
    lektorAi: 250,
    lektorStudio: 1000,
  },
  dodatkowe: {
    kosztDojazduKm: 2.5,
    pelnePrzekazaniePrawProcent: 30,
  },
}

/** Migrate a value that may be the old `{ tani, standard, agresywny }` object or already a number. */
function migrateLegacyPrice(val: unknown): number {
  if (typeof val === 'number') return val
  if (
    typeof val === 'object' &&
    val !== null &&
    'standard' in val &&
    typeof (val as LegacyTierPrices).standard === 'number'
  ) {
    return (val as LegacyTierPrices).standard
  }
  return 0
}

function migrateSection(
  base: Record<string, number>,
  saved: Record<string, unknown>
): Record<string, number> {
  const result: Record<string, number> = { ...base }
  for (const [k, v] of Object.entries(saved)) {
    result[k] = migrateLegacyPrice(v)
  }
  return result
}

const STORAGE_KEY = 'quote-gen-pricing-config'
const USER_DEFAULT_KEY = 'quote-gen-user-default-pricing'

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** Apply migration to a raw parsed pricing object, filling in defaults for missing keys. */
export function migratePricingConfig(
  parsed: Record<string, Record<string, unknown>>
): PricingConfigShape {
  const base = deepClone(DEFAULT_PRICING)
  if (parsed.preprodukcja) {
    base.preprodukcja = migrateSection(
      base.preprodukcja as unknown as Record<string, number>,
      parsed.preprodukcja
    ) as PricingConfigShape['preprodukcja']
  }
  if (parsed.produkcja) {
    base.produkcja = migrateSection(
      base.produkcja as unknown as Record<string, number>,
      parsed.produkcja
    ) as PricingConfigShape['produkcja']
  }
  if (parsed.postprodukcja) {
    base.postprodukcja = migrateSection(
      base.postprodukcja as unknown as Record<string, number>,
      parsed.postprodukcja
    ) as PricingConfigShape['postprodukcja']
  }
  if (parsed.dodatkowe) {
    base.dodatkowe = migrateSection(
      base.dodatkowe as unknown as Record<string, number>,
      parsed.dodatkowe
    ) as PricingConfigShape['dodatkowe']
  }
  return base
}

export function getPricingConfig(): PricingConfigShape {
  if (typeof window === 'undefined') return deepClone(DEFAULT_PRICING)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return deepClone(DEFAULT_PRICING)
    return migratePricingConfig(JSON.parse(raw) as Record<string, Record<string, unknown>>)
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

/** Save the current config as the user's personal default (used by hard-reset). */
export function saveAsUserDefault(config: PricingConfigShape): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(USER_DEFAULT_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

/** Return the user's saved default pricing, or fall back to factory DEFAULT_PRICING. */
export function getUserDefault(): PricingConfigShape {
  if (typeof window === 'undefined') return deepClone(DEFAULT_PRICING)
  try {
    const raw = localStorage.getItem(USER_DEFAULT_KEY)
    if (!raw) return deepClone(DEFAULT_PRICING)
    return migratePricingConfig(JSON.parse(raw) as Record<string, Record<string, unknown>>)
  } catch {
    return deepClone(DEFAULT_PRICING)
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
