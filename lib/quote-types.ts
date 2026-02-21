export type ScenarioType = 'brak' | 'podstawowy' | 'rozbudowany'
/** Pakiet sprzętowy w trybie szybkiej wyceny (Produkcja) */
export type PakietSprzetu = 'minimalistyczny' | 'standard' | 'kinowy'
export type AnimationType = 'brak' | '2d' | '3d'
export type MusicLicense = 'stock' | 'premium' | 'kompozytor'

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
  /** Pakiet sprzętowy (szybka wycena): minimalistyczny | standard | kinowy */
  klasaSprzetu: PakietSprzetu
  detailedShootingDays: ShootingDay[]

  // Postprodukcja
  dniMontazu: number
  korekcjaBarwna: boolean
  animacje: AnimationType

  // Dodatkowe
  kosztDojazduKm: number
  lektor: boolean
  licencjaMuzyczna: MusicLicense
}

export const defaultQuoteData: QuoteData = {
  isDetailedPrepro: false,
  scenariusz: 'brak',
  dniDokumentacji: 1,
  wizjaLokalna: false,
  kierownikProdukcji: false,
  isDetailedProdukcja: false,
  dniZdjeciowe: 1,
  wielkoscEkipy: 2,
  klasaSprzetu: 'standard',
  detailedShootingDays: [createDefaultShootingDay()],
  dniMontazu: 2,
  korekcjaBarwna: false,
  animacje: 'brak',
  kosztDojazduKm: 0,
  lektor: false,
  licencjaMuzyczna: 'stock',
}

export interface Preset {
  name: string
  data: Partial<QuoteData>
}

export const presets: Preset[] = [
  {
    name: 'Jednodniowy wideo reportaż',
    data: {
      isDetailedPrepro: false,
      scenariusz: 'podstawowy',
      dniDokumentacji: 1,
      wizjaLokalna: false,
      kierownikProdukcji: false,
      isDetailedProdukcja: false,
      dniZdjeciowe: 1,
      wielkoscEkipy: 2,
      klasaSprzetu: 'standard',
      dniMontazu: 2,
      korekcjaBarwna: true,
      animacje: 'brak',
      kosztDojazduKm: 50,
      lektor: false,
      licencjaMuzyczna: 'stock',
    },
  },
  {
    name: 'Wywiady',
    data: {
      isDetailedPrepro: false,
      scenariusz: 'podstawowy',
      dniDokumentacji: 2,
      wizjaLokalna: false,
      kierownikProdukcji: false,
      isDetailedProdukcja: false,
      dniZdjeciowe: 2,
      wielkoscEkipy: 3,
      klasaSprzetu: 'kinowy',
      dniMontazu: 3,
      korekcjaBarwna: true,
      animacje: '2d',
      kosztDojazduKm: 100,
      lektor: true,
      licencjaMuzyczna: 'premium',
    },
  },
  {
    name: 'Kampania reklamowa',
    data: {
      isDetailedPrepro: true,
      scenariusz: 'rozbudowany',
      dniDokumentacji: 5,
      wizjaLokalna: true,
      kierownikProdukcji: true,
      isDetailedProdukcja: false,
      dniZdjeciowe: 5,
      wielkoscEkipy: 8,
      klasaSprzetu: 'kinowy',
      dniMontazu: 7,
      korekcjaBarwna: true,
      animacje: '3d',
      kosztDojazduKm: 200,
      lektor: true,
      licencjaMuzyczna: 'kompozytor',
    },
  },
]

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

export function getBreakdown(data: QuoteData) {
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
