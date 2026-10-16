/**
 * Ustawienia firmy (F1): migracja z localStorage, pamięć przed providerami,
 * gettery o niezmienionych sygnaturach, zapis bez gubienia obcych pól.
 * Ścieżka webowa (localStorage) — ścieżka Tauri różni się tylko miejscem pliku.
 */

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
}

const storage = new MemoryStorage()
const globals = globalThis as Record<string, unknown>
globals.localStorage = storage
globals.window = globals
const dispatched: string[] = []
globals.dispatchEvent = (event: { type: string }) => {
  dispatched.push(event.type)
  return true
}

import {
  applyCompanyPatch,
  companyFromLegacy,
  companySchema,
  getLoadedCompany,
  LEGACY_COMPANY_KEYS,
  pickCompany,
  setLoadedCompany,
  WEB_COMPANY_KEY,
  type CompanySettings,
} from './company-settings-core'
import { companyLoadStatus, loadCompanySettings } from './company-settings'
import { DEFAULT_PDF_TEXTS, getPdfTextsConfig, savePdfTextsConfig } from './pdf-texts-config'
import { getPortfolioCatalogue, savePortfolioCatalogue } from './portfolio-catalogue'
import {
  DEFAULT_PRICING,
  getSavedUserDefault,
  getUserDefault,
  saveAsUserDefault,
  USER_DEFAULT_PRICING_EVENT,
} from './pricing-config'
import { getNotices, dismissNotice } from './app-notices'

const PDF = JSON.stringify({ companyName: 'Studio X', termNetto: 'Netto!', termFoo_en: null, liczba: 5 })
const PORTFOLIO = JSON.stringify([
  { id: 'a', name: 'Showreel', url: 'https://vimeo.com/1' },
  { id: 'b', name: 'bez adresu', url: '' },
])
const PRICING = JSON.stringify({ produkcja: { rezOp: 3000 }, postprodukcja: { 'Format: Teledysk': 9000 } })

function seedLegacy() {
  storage.setItem(LEGACY_COMPANY_KEYS.pdfTexts, PDF)
  storage.setItem(LEGACY_COMPANY_KEYS.portfolio, PORTFOLIO)
  storage.setItem(LEGACY_COMPANY_KEYS.defaultPricing, PRICING)
}

function fileRecord(): Record<string, unknown> {
  const raw = JSON.parse(storage.getItem(WEB_COMPANY_KEY) ?? 'null') as { items: Record<string, unknown>[] }
  return raw.items[0]
}

/** Zapis do pliku idzie w tle przez kolejkę store'u. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

beforeEach(() => {
  storage.clear()
  setLoadedCompany(null, null)
  dispatched.length = 0
  getNotices().forEach((n) => dismissNotice(n.id))
})

test('migracja: z trzech kluczy, tylko teksty w tekstach PDF, klucze zostają', () => {
  seedLegacy()
  const { company, keys, unreadable } = companyFromLegacy((k) => storage.getItem(k), '2026-10-16T10:00:00.000Z')
  assert.deepEqual(keys, [LEGACY_COMPANY_KEYS.pdfTexts, LEGACY_COMPANY_KEYS.portfolio, LEGACY_COMPANY_KEYS.defaultPricing])
  assert.deepEqual(unreadable, [])
  assert.deepEqual(company.pdfTexts, { companyName: 'Studio X', termNetto: 'Netto!' })
  assert.equal((company.portfolio as unknown[]).length, 2) // sprzątanie dopiero w getterze
  assert.deepEqual(company.defaultPricing, JSON.parse(PRICING))
  assert.deepEqual(company.migratedFromLocalStorage, { at: '2026-10-16T10:00:00.000Z', keys })
  assert.equal(storage.getItem(LEGACY_COMPANY_KEYS.pdfTexts), PDF)
})

test('migracja: nieczytelny klucz jest pomijany i zgłaszany, reszta przechodzi', () => {
  storage.setItem(LEGACY_COMPANY_KEYS.pdfTexts, '{zepsute')
  storage.setItem(LEGACY_COMPANY_KEYS.portfolio, '{"nie":"lista"}')
  storage.setItem(LEGACY_COMPANY_KEYS.defaultPricing, PRICING)
  const { company, keys, unreadable } = companyFromLegacy((k) => storage.getItem(k), 'now')
  assert.deepEqual(keys, [LEGACY_COMPANY_KEYS.defaultPricing])
  assert.deepEqual(unreadable, [LEGACY_COMPANY_KEYS.pdfTexts, LEGACY_COMPANY_KEYS.portfolio])
  assert.equal(company.pdfTexts, undefined)
  assert.equal(company.portfolio, undefined)
})

test('migracja: pusty tekst w kluczu = brak ustawienia, nie błąd', () => {
  storage.setItem(LEGACY_COMPANY_KEYS.portfolio, '')
  const { keys, unreadable } = companyFromLegacy((k) => storage.getItem(k), 'now')
  assert.deepEqual(keys, [])
  assert.deepEqual(unreadable, [])
})

test('migracja: pusta pamięć okna → pusty profil bez znacznika migracji', () => {
  const { company, keys } = companyFromLegacy(() => null, 'now')
  assert.deepEqual(keys, [])
  assert.deepEqual(company, { id: 'company', createdAt: 'now', updatedAt: 'now' })
})

test('schemat: obce pola zostają, zła wartość pola nie wywraca rekordu', () => {
  const parsed = companySchema.parse({
    id: 'company',
    name: 42,
    logo: { path: 'logo.svg' },
    pdfTexts: { companyName: 'X', dziwne: 3 },
    portfolio: ['cokolwiek'],
    defaultPricing: null,
    createdAt: 'c',
    updatedAt: 'u',
  })
  assert.equal(parsed.name, undefined)
  assert.deepEqual(parsed.logo, { path: 'logo.svg' })
  assert.deepEqual(parsed.pdfTexts, { companyName: 'X', dziwne: 3 })
  assert.deepEqual(parsed.portfolio, ['cokolwiek'])
  assert.equal(parsed.defaultPricing, null)
  assert.equal(companySchema.safeParse({ name: 'bez id' }).success, false)
})

test('schemat: rekord z migracji przechodzi przez schemat bez zmian (npm run data go przyjmie)', () => {
  seedLegacy()
  const { company } = companyFromLegacy((k) => storage.getItem(k), 'now')
  assert.deepEqual(companySchema.parse(company), company)
})

test('pickCompany: rekord "company", a bez niego pierwszy', () => {
  const a = { id: 'inna', createdAt: '', updatedAt: '' } as CompanySettings
  const b = { id: 'company', createdAt: '', updatedAt: '' } as CompanySettings
  assert.equal(pickCompany([a, b]), b)
  assert.equal(pickCompany([a]), a)
  assert.equal(pickCompany([]), null)
})

test('applyCompanyPatch: nie zmienia id ani createdAt, obce pola zostają', () => {
  const base = { id: 'company', createdAt: 'c', updatedAt: 'u', logo: 'x' } as CompanySettings
  const next = applyCompanyPatch(base, { id: 'hack', createdAt: 'z', name: 'Nonoise' } as never, 'now')
  assert.deepEqual(next, { id: 'company', createdAt: 'c', updatedAt: 'now', logo: 'x', name: 'Nonoise' })
})

test('start bez pliku: tworzy plik z localStorage, gettery czytają z pliku', async () => {
  seedLegacy()
  assert.equal(await loadCompanySettings(), 'migrated')
  assert.equal(companyLoadStatus(), 'migrated')
  assert.deepEqual(fileRecord().defaultPricing, JSON.parse(PRICING))
  // localStorage zmienione po migracji nie wpływa na gettery — źródłem jest plik
  storage.setItem(LEGACY_COMPANY_KEYS.pdfTexts, JSON.stringify({ companyName: 'Stare' }))
  storage.setItem(LEGACY_COMPANY_KEYS.portfolio, '[]')
  storage.setItem(LEGACY_COMPANY_KEYS.defaultPricing, '{}')
  assert.equal(getPdfTextsConfig().companyName, 'Studio X')
  assert.equal(getPdfTextsConfig().termNetto, 'Netto!')
  assert.equal(getPdfTextsConfig().documentTitle, DEFAULT_PDF_TEXTS.documentTitle)
  assert.deepEqual(getPortfolioCatalogue(), [{ id: 'a', name: 'Showreel', url: 'https://vimeo.com/1' }])
  assert.equal(getSavedUserDefault()?.produkcja.rezOp, 3000)
  assert.equal(getSavedUserDefault()?.postprodukcja['Format: Teledysk'], 9000)
  assert.equal(getUserDefault().produkcja.gafer, DEFAULT_PRICING.produkcja.gafer)
})

test('drugi start: plik jest — migracja nie powtarza się, localStorage go nie nadpisuje', async () => {
  seedLegacy()
  await loadCompanySettings()
  const first = storage.getItem(WEB_COMPANY_KEY)
  setLoadedCompany(null, null)
  storage.setItem(LEGACY_COMPANY_KEYS.pdfTexts, JSON.stringify({ companyName: 'Inne' }))
  assert.equal(await loadCompanySettings(), 'loaded')
  assert.equal(storage.getItem(WEB_COMPANY_KEY), first)
  assert.equal(getPdfTextsConfig().companyName, 'Studio X')
})

test('bez zapisanych ustawień: domyślne teksty, pusty katalog, brak domyślnego cennika', async () => {
  assert.equal(await loadCompanySettings(), 'migrated')
  assert.deepEqual(getPdfTextsConfig(), DEFAULT_PDF_TEXTS)
  assert.deepEqual(getPortfolioCatalogue(), [])
  assert.equal(getSavedUserDefault(), null)
  assert.deepEqual(getUserDefault(), DEFAULT_PRICING)
})

test('zapis: pamięć od razu, plik w tle, stary klucz dalej odświeżany', async () => {
  await loadCompanySettings()
  savePdfTextsConfig({ ...DEFAULT_PDF_TEXTS, companyName: 'Nowa nazwa' })
  savePortfolioCatalogue([
    { id: 'x', name: 'Reel', url: 'https://youtu.be/1' },
    { id: 'y', name: 'pusty', url: '  ' },
  ])
  const pricing = getUserDefault()
  pricing.produkcja.mua = 1234
  saveAsUserDefault(pricing)

  assert.equal(getPdfTextsConfig().companyName, 'Nowa nazwa')
  assert.deepEqual(getPortfolioCatalogue(), [{ id: 'x', name: 'Reel', url: 'https://youtu.be/1' }])
  assert.equal(getSavedUserDefault()?.produkcja.mua, 1234)
  assert.deepEqual(dispatched, [USER_DEFAULT_PRICING_EVENT])

  await settle()
  const record = fileRecord()
  assert.equal((record.pdfTexts as Record<string, string>).companyName, 'Nowa nazwa')
  assert.deepEqual(record.portfolio, [{ id: 'x', name: 'Reel', url: 'https://youtu.be/1' }])
  assert.equal((record.defaultPricing as { produkcja: { mua: number } }).produkcja.mua, 1234)
  // lustrzany zapis do starych kluczy (powrót do starszej wersji aplikacji)
  assert.equal(JSON.parse(storage.getItem(LEGACY_COMPANY_KEYS.pdfTexts)!).companyName, 'Nowa nazwa')
  assert.equal(JSON.parse(storage.getItem(LEGACY_COMPANY_KEYS.defaultPricing)!).produkcja.mua, 1234)

  // zmieniony cennik w pamięci nie przecieka do zapisanego (kopia przy zapisie)
  pricing.produkcja.mua = 1
  assert.equal(getSavedUserDefault()?.produkcja.mua, 1234)
})

test('zapis nie gubi pól dopisanych w pliku przez kogoś innego (npm run data)', async () => {
  await loadCompanySettings()
  const raw = JSON.parse(storage.getItem(WEB_COMPANY_KEY)!) as { items: Record<string, unknown>[] }
  raw.items[0].logo = { path: 'logo.svg' }
  raw.items[0].name = 'Nonoise Media'
  storage.setItem(WEB_COMPANY_KEY, JSON.stringify(raw))
  savePortfolioCatalogue([{ id: 'x', name: 'Reel', url: 'https://youtu.be/1' }])
  await settle()
  const record = fileRecord()
  assert.deepEqual(record.logo, { path: 'logo.svg' })
  assert.equal(record.name, 'Nonoise Media')
  assert.equal((record.portfolio as unknown[]).length, 1)
})

test('nieczytelny plik: zostaje nietknięty, gettery po staremu z localStorage, komunikat', async () => {
  storage.setItem(WEB_COMPANY_KEY, '{"version":1,"items":[{"bez":"id"}]}')
  seedLegacy()
  assert.equal(await loadCompanySettings(), 'unreadable')
  assert.equal(getLoadedCompany(), null)
  assert.equal(getPdfTextsConfig().companyName, 'Studio X')
  savePdfTextsConfig({ ...DEFAULT_PDF_TEXTS, companyName: 'Z localStorage' })
  await settle()
  assert.equal(getPdfTextsConfig().companyName, 'Z localStorage')
  assert.equal(storage.getItem(WEB_COMPANY_KEY), '{"version":1,"items":[{"bez":"id"}]}')
  assert.deepEqual(getNotices().map((n) => n.id), ['company-read'])
})

test('bez wczytania (np. przed startem): gettery jak dawniej z localStorage', () => {
  seedLegacy()
  assert.equal(getPdfTextsConfig().companyName, 'Studio X')
  assert.equal(getPortfolioCatalogue().length, 1)
  assert.equal(getSavedUserDefault()?.produkcja.rezOp, 3000)
})
