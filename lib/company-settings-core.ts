/**
 * Ustawienia firmy w folderze danych (F1) — część czysta.
 *
 * Do F1 teksty PDF, katalog realizacji i „mój domyślny cennik" żyły wyłącznie
 * w pamięci przeglądarki okna (localStorage WebKit): bez kopii zapasowej,
 * niewidoczne dla `npm run data`, do stracenia przy czyszczeniu danych WebKit.
 * Teraz leżą w `company.json` — zalążku przyszłego profilu firmy.
 *
 * Plik ma kształt kolekcji (`{ version, items: [ { id: "company", … } ] }`),
 * jak każdy inny plik huba: ten sam zapis (`createCollectionStore`), te same
 * kopie zapasowe, ten sam `npm run data -- apply` (`update` po `id`).
 *
 * Zasady (plan §3.4):
 *  - `.passthrough()` i pola opcjonalne; pola z treścią użytkownika są
 *    przyjmowane LUŹNO (`unknown`), a sprzątane dopiero przy odczycie przez
 *    gettery — schemat nigdy niczego nie wyrzuca, więc zapis niczego nie gubi,
 *  - migracja z localStorage raz, gdy pliku nie ma; starych kluczy NIE usuwamy
 *    (zapis dalej je odświeża — powrót do starszej wersji aplikacji działa),
 *  - plik wczytujemy do pamięci PRZED startem providerów, więc synchroniczne
 *    gettery (`getPdfTextsConfig`, `getPortfolioCatalogue`,
 *    `getSavedUserDefault`, …) mają te same sygnatury co wcześniej.
 *
 * `name`, `contact`, `defaultTaxRatePercent`, `defaultCurrency` są
 * zarezerwowane pod profil firmy (branding) — dziś nic ich nie czyta.
 */

import { z } from 'zod'

export const COMPANY_FILE = 'company.json'
export const WEB_COMPANY_KEY = 'nonoise-company-v1'
export const COMPANY_ID = 'company'

/** Klucze localStorage, z których pochodzą ustawienia (zostają na miejscu). */
export const LEGACY_COMPANY_KEYS = {
  pdfTexts: 'quote-gen-pdf-texts',
  portfolio: 'quote-gen-portfolio-catalogue',
  defaultPricing: 'quote-gen-user-default-pricing',
} as const

const optional = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined)

export const companySchema = z
  .object({
    id: z.string().min(1),
    /** Profil firmy — zarezerwowane, nic jeszcze nie czyta. */
    name: optional(z.string()),
    contact: optional(
      z
        .object({
          person: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          website: z.string().optional(),
          address: z.string().optional(),
          taxId: z.string().optional(),
        })
        .passthrough()
    ),
    /** Teksty PDF (`PdfTextsConfig`); brak = domyślne. Sprzątane w `getPdfTextsConfig`. */
    pdfTexts: optional(z.record(z.unknown())),
    /** Katalog realizacji; sprzątany w `getPortfolioCatalogue`. */
    portfolio: optional(z.array(z.unknown())),
    /** „Zapisz stawki jako domyślne"; `null`/brak = cennik fabryczny. Migrowany w `getSavedUserDefault`. */
    defaultPricing: optional(z.record(z.unknown()).nullable()),
    /** Zarezerwowane (dziś: ryczałt 8,5 % w `realization-plan.ts`, waluta per wycena). */
    defaultTaxRatePercent: optional(z.number()),
    defaultCurrency: optional(z.string()),
    /** Skąd przyszły dane przy pierwszym utworzeniu pliku. */
    migratedFromLocalStorage: optional(
      z.object({ at: z.string(), keys: z.array(z.string()) }).passthrough()
    ),
    createdAt: z.string().catch(''),
    updatedAt: z.string().catch(''),
  })
  .passthrough()

export type CompanySettings = z.infer<typeof companySchema>
export type CompanyPatch = Partial<Omit<CompanySettings, 'id' | 'createdAt'>>

/** Rekord firmy z listy rekordów pliku (`id: "company"`, a w razie czego pierwszy). */
export function pickCompany(items: CompanySettings[]): CompanySettings | null {
  return items.find((c) => c.id === COMPANY_ID) ?? items[0] ?? null
}

export interface LegacyMigration {
  company: CompanySettings
  /** Klucze, które przeniesiono. */
  keys: string[]
  /** Klucze, które były, ale nie dało się ich odczytać (zostają w localStorage). */
  unreadable: string[]
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Nowy `company.json` z wartości w localStorage. Wartości przenosimy w takiej
 * postaci, w jakiej leżą (gettery i tak je sprzątają przy odczycie) — z jednym
 * wyjątkiem: z tekstów PDF tylko pola tekstowe, jak robił getter.
 */
export function companyFromLegacy(read: (key: string) => string | null, now: string): LegacyMigration {
  const company: CompanySettings = { id: COMPANY_ID, createdAt: now, updatedAt: now }
  const keys: string[] = []
  const unreadable: string[] = []

  const take = (key: string, accept: (value: unknown) => boolean, apply: (value: unknown) => void) => {
    const raw = read(key)
    if (raw === null || raw === '') return
    const value = parseJson(raw)
    if (value === undefined || !accept(value)) {
      unreadable.push(key)
      return
    }
    apply(value)
    keys.push(key)
  }

  take(LEGACY_COMPANY_KEYS.pdfTexts, isRecord, (value) => {
    company.pdfTexts = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
    )
  })
  take(LEGACY_COMPANY_KEYS.portfolio, Array.isArray, (value) => {
    company.portfolio = value as unknown[]
  })
  take(LEGACY_COMPANY_KEYS.defaultPricing, isRecord, (value) => {
    company.defaultPricing = value as Record<string, unknown>
  })

  if (keys.length) company.migratedFromLocalStorage = { at: now, keys }
  return { company, keys, unreadable }
}

/** Zmiana nałożona na świeżo odczytany rekord — obce pola (passthrough) zostają. */
export function applyCompanyPatch(base: CompanySettings, patch: CompanyPatch, now: string): CompanySettings {
  return { ...base, ...patch, id: base.id, createdAt: base.createdAt, updatedAt: now }
}

/* ── Pamięć: ustawienia wczytane przed startem providerów ─────────────────── */

let loaded: CompanySettings | null = null
let persist: ((patch: CompanyPatch) => void) | null = null

/** Wczytany rekord firmy albo `null` (nie wczytano — gettery czytają localStorage jak dawniej). */
export function getLoadedCompany(): CompanySettings | null {
  return loaded
}

/** Ustawia rekord w pamięci; `onPatch` zapisuje zmiany do pliku. `null` = tryb dawny (localStorage). */
export function setLoadedCompany(company: CompanySettings | null, onPatch: ((patch: CompanyPatch) => void) | null) {
  loaded = company
  persist = company ? onPatch : null
}

/**
 * Zmiana ustawień: od razu w pamięci, zapis do pliku w tle. Zwraca `false`,
 * gdy pliku nie wczytano (wywołujący i tak zapisuje localStorage).
 */
export function patchLoadedCompany(patch: CompanyPatch, now: string = new Date().toISOString()): boolean {
  if (!loaded) return false
  loaded = applyCompanyPatch(loaded, patch, now)
  persist?.(patch)
  return true
}
