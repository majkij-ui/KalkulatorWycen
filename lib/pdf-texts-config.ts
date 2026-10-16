/**
 * User-editable text strings that appear in the PDF output.
 * Company info is shown in the printable quote header.
 * Terms templates are used by buildTermsAndConditions() (via getTermsAndConditions() in quote-context).
 *
 * Each field has a `_en` twin for the English-language PDF mode. Both are edited
 * side-by-side in the PDF Texts modal; the language toggle on the PDF preview
 * tab decides which one is rendered.
 *
 * Token replacements in term templates (same tokens for PL and EN):
 *   termOvertime / termOvertime_en   → {hours}, {rate}
 *   termRevisions / termRevisions_en → {count}, {price}
 */

import { getLoadedCompany, LEGACY_COMPANY_KEYS, patchLoadedCompany } from './company-settings-core'

export interface PdfTextsConfig {
  // Company / header info — Polish
  companyName: string
  producerName: string
  contactEmail: string
  documentTitle: string

  // Company / header info — English
  companyName_en: string
  producerName_en: string
  contactEmail_en: string
  documentTitle_en: string

  // Terms & conditions templates — Polish
  termLicencja: string
  termPrzekazanie: string
  /** Supports {hours} and {rate} tokens */
  termOvertime: string
  /** Supports {count} and {price} tokens */
  termRevisions: string
  termNetto: string

  // Terms & conditions templates — English
  termLicencja_en: string
  termPrzekazanie_en: string
  termOvertime_en: string
  termRevisions_en: string
  termNetto_en: string
}

export const DEFAULT_PDF_TEXTS: PdfTextsConfig = {
  companyName: 'Nonoise Media',
  producerName: 'Michał Jagniątkowski',
  contactEmail: 'contact@nonoise.media',
  documentTitle: 'WYCENA PRODUKCJI WIDEO',

  companyName_en: 'Nonoise Media',
  producerName_en: 'Michał Jagniątkowski',
  contactEmail_en: 'contact@nonoise.media',
  documentTitle_en: 'VIDEO PRODUCTION QUOTE',

  termLicencja:
    'Cena obejmuje realizację filmu oraz udzielenie niewyłącznej licencji na jego wykorzystanie w Internecie na kanałach własnych Zamawiającego oraz do użytku wewnętrznego, bez ograniczeń terytorialnych, na czas nieoznaczony, z zastrzeżeniem że w przypadku wykorzystania wizerunku aktorów lub materiałów licencjonowanych, okres licencji może zostać ograniczony zgodnie z warunkami udzielonych zgód i licencji.',

  termPrzekazanie:
    'Cena obejmuje realizację filmu oraz pełne przeniesienie autorskich praw majątkowych do dzieła na Zamawiającego na wszystkich znanych polach eksploatacji, bez ograniczeń czasowych i terytorialnych.',

  termOvertime:
    '1 dzień zdjęciowy obejmuje maksymalnie {hours} godzin pracy na planie. Praca powyżej tego czasu rozliczana jest jako nadgodziny w kwocie {rate} zł netto za członka ekipy, liczone za każdą rozpoczętą godzinę.',

  termRevisions:
    'Cena obejmuje do {count} rund poprawek montażowych. Kolejne zmiany podlegają dodatkowej wycenie w kwocie {price} zł netto za rundę.',

  termNetto:
    'Podane kwoty są kwotami netto. Do kwot należy doliczyć VAT zgodnie z obowiązującymi przepisami.',

  termLicencja_en:
    "Price covers production of the film and grant of a non-exclusive licence to use the work on the Client's own internet channels and for internal purposes, with no territorial limits, for an unlimited period, subject to the limitation that where actor likenesses or licensed third-party materials are used, the licence term may be restricted in line with the underlying consents and licences.",

  termPrzekazanie_en:
    "Price covers production of the film and a full transfer of economic copyright to the Client across all known fields of exploitation, with no time or territorial limits.",

  termOvertime_en:
    'A standard shooting day covers up to {hours} hours of work on set. Work beyond that time is billed as overtime at {rate} PLN net per crew member, charged per started hour.',

  termRevisions_en:
    'Price covers up to {count} rounds of editing revisions. Further revision rounds are billed at {price} PLN net per additional round.',

  termNetto_en:
    'Amounts are stated net of VAT. VAT will be added in line with applicable regulations.',
}

const STORAGE_KEY = LEGACY_COMPANY_KEYS.pdfTexts

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** Zapisane teksty nałożone na domyślne (tylko pola tekstowe). */
function mergeWithDefaults(parsedRaw: unknown): PdfTextsConfig {
  // Strip undefined / non-string values from the parsed payload so older saves
  // (which may explicitly carry `termFoo_en: undefined`) don't override the
  // defaults during the spread merge below.
  const sanitized: Partial<PdfTextsConfig> = {}
  if (parsedRaw && typeof parsedRaw === 'object') {
    for (const [k, v] of Object.entries(parsedRaw)) {
      if (typeof v === 'string') (sanitized as Record<string, string>)[k] = v
    }
  }
  return { ...deepClone(DEFAULT_PDF_TEXTS), ...sanitized }
}

/** Teksty PDF z `company.json` (F1); bez wczytanego pliku — z localStorage, jak dawniej. */
export function getPdfTextsConfig(): PdfTextsConfig {
  if (typeof window === 'undefined') return deepClone(DEFAULT_PDF_TEXTS)
  const company = getLoadedCompany()
  if (company) return mergeWithDefaults(company.pdfTexts)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return deepClone(DEFAULT_PDF_TEXTS)
    return mergeWithDefaults(JSON.parse(raw))
  } catch {
    return deepClone(DEFAULT_PDF_TEXTS)
  }
}

/** Zapis do `company.json`; stary klucz localStorage dalej odświeżany (powrót do starszej wersji). */
export function savePdfTextsConfig(config: PdfTextsConfig): void {
  if (typeof window === 'undefined') return
  patchLoadedCompany({ pdfTexts: { ...config } })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

/**
 * Waluta kwot w punktach „Uwagi" (S3). Szablony mają walutę wpisaną po
 * tokenie („{rate} zł", „{rate} PLN"); token razem z tą jednostką zamienia się
 * na kwotę z jednostką waluty PDF. W PLN bez jednostki w szablonie — sama
 * liczba, jak dotąd.
 */
export interface TermsMoney {
  currency: 'PLN' | 'EUR'
  /** Przeliczenie kwoty z wyceny na walutę PDF (tylko szkic sprzed S3: PLN → EUR). */
  convert?: (amount: number) => number
}

const TERMS_PLN: TermsMoney = { currency: 'PLN' }

function termUnit(currency: TermsMoney['currency'], lang: 'pl' | 'en'): string {
  if (currency === 'EUR') return '€'
  return lang === 'en' ? 'PLN' : 'zł'
}

function renderMoneyToken(
  tpl: string,
  token: string,
  amount: number,
  money: TermsMoney,
  lang: 'pl' | 'en'
): string {
  const value = money.convert ? money.convert(amount) : amount
  const unit = termUnit(money.currency, lang)
  const pattern = new RegExp(`\\{${token}\\}(\\s*(?:zł|PLN|EUR|€)(?![\\p{L}]))?`, 'u')
  return tpl.replace(pattern, (_match, unitPart?: string) =>
    unitPart || money.currency !== 'PLN' ? `${String(value)} ${unit}` : String(value)
  )
}

/** Replace {hours} and {rate} tokens in termOvertime */
export function renderTermOvertime(
  template: string,
  hours: number,
  rate: number,
  money: TermsMoney = TERMS_PLN,
  lang: 'pl' | 'en' = 'pl'
): string {
  const tpl = typeof template === 'string' ? template : DEFAULT_PDF_TEXTS.termOvertime
  return renderMoneyToken(tpl.replace('{hours}', String(hours)), 'rate', rate, money, lang)
}

/** Replace {count} and {price} tokens in termRevisions */
export function renderTermRevisions(
  template: string,
  count: number,
  price: number,
  money: TermsMoney = TERMS_PLN,
  lang: 'pl' | 'en' = 'pl'
): string {
  const tpl = typeof template === 'string' ? template : DEFAULT_PDF_TEXTS.termRevisions
  return renderMoneyToken(tpl.replace('{count}', String(count)), 'price', price, money, lang)
}

/** Pola wyceny, od których zależą punkty „Uwagi" w PDF. */
export interface TermsQuoteFields {
  copyrightType: 'licencja' | 'przekazanie'
  includeOvertimeInfo: boolean
  standardDayHours: number
  overtimeHourlyRate: number
  includeRevisionsInfo: boolean
  includedRevisions: number
  extraRevisionPrice: number
}

/** Punkty „Uwagi" w PDF z aktywnych przełączników wyceny, w języku PDF. */
export function buildTermsAndConditions(
  data: TermsQuoteFields,
  pdfTexts: PdfTextsConfig,
  lang: 'pl' | 'en' = 'pl',
  /** Waluta PDF: wycena w EUR podaje kwoty w euro, stary szkic EUR przelicza z PLN. */
  money: TermsMoney = TERMS_PLN
): string[] {
  const isEn = lang === 'en'
  // Pick EN twin when active, but fall back gracefully to PL (and finally
  // an empty string handled below) if a saved config is missing the EN field.
  const pickEn = (en: string | undefined, pl: string | undefined): string =>
    (typeof en === 'string' && en.trim() ? en : (typeof pl === 'string' ? pl : ''))
  const tplLicencja = isEn ? pickEn(pdfTexts.termLicencja_en, pdfTexts.termLicencja) : (pdfTexts.termLicencja ?? '')
  const tplPrzekazanie = isEn ? pickEn(pdfTexts.termPrzekazanie_en, pdfTexts.termPrzekazanie) : (pdfTexts.termPrzekazanie ?? '')
  const tplOvertime = isEn ? pickEn(pdfTexts.termOvertime_en, pdfTexts.termOvertime) : (pdfTexts.termOvertime ?? '')
  const tplRevisions = isEn ? pickEn(pdfTexts.termRevisions_en, pdfTexts.termRevisions) : (pdfTexts.termRevisions ?? '')
  const tplNetto = isEn ? pickEn(pdfTexts.termNetto_en, pdfTexts.termNetto) : (pdfTexts.termNetto ?? '')

  const out: string[] = []
  if (data.copyrightType === 'licencja' && tplLicencja) {
    out.push(tplLicencja)
  }
  if (data.copyrightType === 'przekazanie' && tplPrzekazanie) {
    out.push(tplPrzekazanie)
  }
  if (data.includeOvertimeInfo && tplOvertime) {
    out.push(renderTermOvertime(tplOvertime, data.standardDayHours, data.overtimeHourlyRate, money, lang))
  }
  if (data.includeRevisionsInfo && tplRevisions) {
    out.push(renderTermRevisions(tplRevisions, data.includedRevisions, data.extraRevisionPrice, money, lang))
  }
  if (tplNetto) out.push(tplNetto)
  return out
}
