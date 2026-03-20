import { DEFAULT_FORMAT_KEY } from './pricing-config'

export type ScenarioType = 'brak' | 'podstawowy' | 'rozbudowany'
/** Pakiet sprzętowy w trybie szybkiej wyceny (Produkcja) */
export type PakietSprzetu = 'minimalistyczny' | 'standard' | 'kinowy'
export type AnimationType = 'brak' | '2d' | '3d'
export type MusicLicense = 'stock' | 'premium' | 'kompozytor'

/** Format dostawy: pełny klucz z cennika, np. "Format: Shorts/Reel (do 30s)" lub custom "Format: <nazwa>" */
export type DeliverableFormat = string
export type KorekcjaBarwnaOpcja = 'brak' | 'podstawowa' | 'zaawansowana'
export type AnimacjePostproOpcja = 'brak' | '2d' | 'ai'
export type MuzykaPostproOpcja = 'brak' | 'copyfree' | 'kompozytor'
export type SoundDesignOpcja = 'brak' | 'prosty' | 'zlozony'
export type MasterDzwiekuOpcja = 'brak' | 'podstawowy' | 'zlozony'
export type LektorPostproOpcja = 'brak' | 'ai' | 'studio'

export interface Deliverable {
  id: string
  format: DeliverableFormat
  ilosc: number
  korekcjaBarwna: KorekcjaBarwnaOpcja
  animacje: AnimacjePostproOpcja
  muzyka: MuzykaPostproOpcja
  soundDesign: SoundDesignOpcja
  masterDzwieku: MasterDzwiekuOpcja
  lektor: LektorPostproOpcja
}

function createDeliverableId(): string {
  return `del-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createDefaultDeliverable(): Deliverable {
  return {
    id: createDeliverableId(),
    format: DEFAULT_FORMAT_KEY,
    ilosc: 1,
    korekcjaBarwna: 'brak',
    animacje: 'brak',
    muzyka: 'brak',
    soundDesign: 'brak',
    masterDzwieku: 'brak',
    lektor: 'brak',
  }
}

export type SprzetOpcja = 'brak' | 'standard' | 'rental'
export type DronOpcja = 'brak' | 'dji' | 'fpv'

export interface ShootingDay {
  id: string
  rezOp: number
  asystent: number
  gafer: number
  dzwiekowiec: number
  mua: number
  aktor: number
  model: number
  statysta: number
  kameraSony: number
  kameraRed: number
  obiektywy: SprzetOpcja
  stabilizacja: SprzetOpcja
  podglad: SprzetOpcja
  swiatlo: SprzetOpcja
  dron: DronOpcja
}

function createShootingDayId(): string {
  return `day-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createDefaultShootingDay(): ShootingDay {
  return {
    id: createShootingDayId(),
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
  }
}

export interface QuoteData {
  // Preprodukcja
  isDetailedPrepro: boolean
  scenariusz: ScenarioType
  dniDokumentacji: number
  wizjaLokalna: boolean
  kierownikProdukcji: boolean

  // Produkcja
  isDetailedProdukcja: boolean
  dniZdjeciowe: number
  wielkoscEkipy: number
  /** Dopłata za Reż-Opa w trybie szybkiej wyceny */
  crudeRezOpSurcharge: boolean
  /** Dopłata za drona w trybie szybkiej wyceny */
  crudeDroneSurcharge: boolean
  /** Pakiet sprzętowy (szybka wycena): minimalistyczny | standard | kinowy */
  klasaSprzetu: PakietSprzetu
  detailedShootingDays: ShootingDay[]

  // Postprodukcja
  isDetailedPostpro: boolean
  crudeEditUnit: 'dni' | 'godziny'
  crudeEditCount: number
  detailedDeliverables: Deliverable[]
  // Legacy (fallback)
  dniMontazu: number
  korekcjaBarwna: boolean
  animacje: AnimationType

  // Dodatkowe
  kosztDojazduKm: number
  lektor: boolean
  licencjaMuzyczna: MusicLicense
  /** Licencja podstawowa (w cenie) vs pełne przekazanie praw (dopłata %) */
  copyrightType: 'licencja' | 'przekazanie'
  /** Czy uwzględnić w PDF informację o limitach poprawek */
  includeRevisionsInfo: boolean
  includedRevisions: number
  extraRevisionPrice: number
  /** Czy uwzględnić w PDF zasady nadgodzin */
  includeOvertimeInfo: boolean
  standardDayHours: number
  overtimeHourlyRate: number
  /** Opcje dodatkowe (upsell) – wolny tekst do PDF */
  opcjeDodatkowe: string

  // Logistyka (catering & noclegi) – osobodni
  includeCatering: boolean
  cateringRate: number
  cateringOverride: boolean
  cateringCustomDays: number
  includeLodging: boolean
  lodgingRate: number
  lodgingOverride: boolean
  lodgingCustomDays: number
}

export const defaultQuoteData: QuoteData = {
  isDetailedPrepro: false,
  scenariusz: 'brak',
  dniDokumentacji: 0,
  wizjaLokalna: false,
  kierownikProdukcji: false,
  isDetailedProdukcja: false,
  dniZdjeciowe: 0,
  wielkoscEkipy: 1,
  crudeRezOpSurcharge: false,
  crudeDroneSurcharge: false,
  klasaSprzetu: 'standard',
  detailedShootingDays: [],
  isDetailedPostpro: false,
  crudeEditUnit: 'dni',
  crudeEditCount: 0,
  detailedDeliverables: [],
  dniMontazu: 0,
  korekcjaBarwna: false,
  animacje: 'brak',
  kosztDojazduKm: 0,
  lektor: false,
  licencjaMuzyczna: 'stock',
  copyrightType: 'licencja',
  includeRevisionsInfo: true,
  includedRevisions: 2,
  extraRevisionPrice: 500,
  includeOvertimeInfo: true,
  standardDayHours: 10,
  overtimeHourlyRate: 200,
  opcjeDodatkowe: '',
  includeCatering: false,
  cateringRate: 100,
  cateringOverride: false,
  cateringCustomDays: 1,
  includeLodging: false,
  lodgingRate: 300,
  lodgingOverride: false,
  lodgingCustomDays: 1,
}

/** User-saved quote template (persisted in localStorage) */
export interface SavedTemplate {
  id: string
  name: string
  state: Partial<QuoteData>
  createdAt: string
}

export const PRICES = {
  scenariusz: {
    brak: 0,
    podstawowy: 1500,
    rozbudowany: 4500,
  },
  dniDokumentacji: 800,
  kierownikProdukcji: 2000,
  dniZdjeciowe: 3500,
  wielkoscEkipy: 1200,
  klasaSprzetu: {
    minimalistyczny: 0,
    standard: 0,
    kinowy: 0,
  },
  dniMontazu: 1800,
  korekcjaBarwna: 1500,
  animacje: {
    brak: 0,
    '2d': 3000,
    '3d': 8000,
  },
  kosztDojazduKm: 3,
  lektor: 2000,
  licencjaMuzyczna: {
    stock: 500,
    premium: 2000,
    kompozytor: 6000,
  },
}

export function calculateTotal(data: QuoteData): number {
  let total = 0
  total += PRICES.scenariusz[data.scenariusz]
  total += data.dniDokumentacji * PRICES.dniDokumentacji
  total += data.kierownikProdukcji ? PRICES.kierownikProdukcji : 0
  total += data.dniZdjeciowe * PRICES.dniZdjeciowe
  total += data.wielkoscEkipy * PRICES.wielkoscEkipy
  total += PRICES.klasaSprzetu[data.klasaSprzetu]
  total += data.dniMontazu * PRICES.dniMontazu
  total += data.korekcjaBarwna ? PRICES.korekcjaBarwna : 0
  total += PRICES.animacje[data.animacje]
  total += data.kosztDojazduKm * PRICES.kosztDojazduKm
  total += data.lektor ? PRICES.lektor : 0
  total += PRICES.licencjaMuzyczna[data.licencjaMuzyczna]
  return total
}

export interface LegacyBreakdownItem {
  label: string
  value: string
  cost: number
}

export interface LegacyBreakdownPhase {
  category: string
  items: LegacyBreakdownItem[]
}

export function getBreakdown(data: QuoteData): LegacyBreakdownPhase[] {
  return [
    {
      category: 'Preprodukcja',
      items: [
        {
          label: 'Scenariusz',
          value: data.scenariusz === 'brak' ? 'Brak' : data.scenariusz === 'podstawowy' ? 'Podstawowy' : 'Rozbudowany',
          cost: PRICES.scenariusz[data.scenariusz],
        },
        {
          label: 'Dni dokumentacji',
          value: `${data.dniDokumentacji} dni`,
          cost: data.dniDokumentacji * PRICES.dniDokumentacji,
        },
        {
          label: 'Kierownik produkcji',
          value: data.kierownikProdukcji ? 'Tak' : 'Nie',
          cost: data.kierownikProdukcji ? PRICES.kierownikProdukcji : 0,
        },
      ],
    },
    {
      category: 'Produkcja',
      items: [
        {
          label: 'Dni zdjeciowe',
          value: `${data.dniZdjeciowe} dni`,
          cost: data.dniZdjeciowe * PRICES.dniZdjeciowe,
        },
        {
          label: 'Wielkosc ekipy',
          value: `${data.wielkoscEkipy} osob`,
          cost: data.wielkoscEkipy * PRICES.wielkoscEkipy,
        },
        {
          label: 'Klasa sprzetu',
          value: data.klasaSprzetu === 'minimalistyczny' ? 'Minimalistyczny' : data.klasaSprzetu === 'standard' ? 'Standard' : 'Kinowy',
          cost: PRICES.klasaSprzetu[data.klasaSprzetu],
        },
      ],
    },
    {
      category: 'Postprodukcja',
      items: [
        {
          label: 'Dni montazu',
          value: `${data.dniMontazu} dni`,
          cost: data.dniMontazu * PRICES.dniMontazu,
        },
        {
          label: 'Korekcja barwna',
          value: data.korekcjaBarwna ? 'Tak' : 'Nie',
          cost: data.korekcjaBarwna ? PRICES.korekcjaBarwna : 0,
        },
        {
          label: 'Animacje i grafika',
          value: data.animacje === 'brak' ? 'Brak' : data.animacje === '2d' ? '2D' : 'Zaawansowane 3D',
          cost: PRICES.animacje[data.animacje],
        },
      ],
    },
    {
      category: 'Dodatkowe',
      items: [
        {
          label: 'Koszty dojazdu',
          value: `${data.kosztDojazduKm} km`,
          cost: data.kosztDojazduKm * PRICES.kosztDojazduKm,
        },
        {
          label: 'Lektor',
          value: data.lektor ? 'Tak' : 'Nie',
          cost: data.lektor ? PRICES.lektor : 0,
        },
        {
          label: 'Licencja muzyczna',
          value: data.licencjaMuzyczna === 'stock' ? 'Stock' : data.licencjaMuzyczna === 'premium' ? 'Premium' : 'Kompozytor',
          cost: PRICES.licencjaMuzyczna[data.licencjaMuzyczna],
        },
      ],
    },
  ]
}

// =========================
// PDF (react-to-print) state
// =========================

export type PdfRowKey = 'preprodukcja' | 'ekipa' | 'sprzet' | 'logistyka' | 'postprodukcja' | 'inne'

export interface PdfRowState {
  key: PdfRowKey
  title: string
  opis: string
  cenaNetto: number
}

export interface LocalPdfState {
  projectName: string
  issueDateIso: string
  validUntilIso: string

  showVat: boolean // if true, UI/print shows gross values (VAT 23%)

  rows: Record<PdfRowKey, PdfRowState>

  materialyKoncowe: string
  opcjeDodatkowe: string
  portfolioLinksText: string

  termsAndConditions: string[]
}
