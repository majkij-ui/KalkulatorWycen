/**
 * User-editable text strings that appear in the PDF output.
 * Company info is shown in the printable quote header.
 * Terms templates are used by getTermsAndConditions() in quote-context.
 *
 * Each field has a `_en` twin for the English-language PDF mode. Both are edited
 * side-by-side in the PDF Texts modal; the language toggle on the PDF preview
 * tab decides which one is rendered.
 *
 * Token replacements in term templates (same tokens for PL and EN):
 *   termOvertime / termOvertime_en   → {hours}, {rate}
 *   termRevisions / termRevisions_en → {count}, {price}
 */

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

const STORAGE_KEY = 'quote-gen-pdf-texts'

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function getPdfTextsConfig(): PdfTextsConfig {
  if (typeof window === 'undefined') return deepClone(DEFAULT_PDF_TEXTS)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return deepClone(DEFAULT_PDF_TEXTS)
    const parsedRaw = JSON.parse(raw) as Partial<PdfTextsConfig> | null
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
  } catch {
    return deepClone(DEFAULT_PDF_TEXTS)
  }
}

export function savePdfTextsConfig(config: PdfTextsConfig): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

/** Replace {hours} and {rate} tokens in termOvertime */
export function renderTermOvertime(template: string, hours: number, rate: number): string {
  const tpl = typeof template === 'string' ? template : DEFAULT_PDF_TEXTS.termOvertime
  return tpl.replace('{hours}', String(hours)).replace('{rate}', String(rate))
}

/** Replace {count} and {price} tokens in termRevisions */
export function renderTermRevisions(template: string, count: number, price: number): string {
  const tpl = typeof template === 'string' ? template : DEFAULT_PDF_TEXTS.termRevisions
  return tpl.replace('{count}', String(count)).replace('{price}', String(price))
}
