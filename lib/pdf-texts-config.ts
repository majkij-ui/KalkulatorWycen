/**
 * User-editable text strings that appear in the PDF output.
 * Company info is shown in the printable quote header.
 * Terms templates are used by getTermsAndConditions() in quote-context.
 *
 * Token replacements in term templates:
 *   termOvertime  → {hours}, {rate}
 *   termRevisions → {count}, {price}
 */

export interface PdfTextsConfig {
  // Company / header info
  companyName: string
  producerName: string
  contactEmail: string
  documentTitle: string

  // Terms & conditions templates
  termLicencja: string
  termPrzekazanie: string
  /** Supports {hours} and {rate} tokens */
  termOvertime: string
  /** Supports {count} and {price} tokens */
  termRevisions: string
  termNetto: string
}

export const DEFAULT_PDF_TEXTS: PdfTextsConfig = {
  companyName: 'Nonoise Media',
  producerName: 'Michał Jagniątkowski',
  contactEmail: 'contact@nonoise.media',
  documentTitle: 'WYCENA PRODUKCJI WIDEO',

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
    const parsed = JSON.parse(raw) as Partial<PdfTextsConfig>
    // Merge with defaults so any newly-added keys always have a value
    return { ...deepClone(DEFAULT_PDF_TEXTS), ...parsed }
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
  return template.replace('{hours}', String(hours)).replace('{rate}', String(rate))
}

/** Replace {count} and {price} tokens in termRevisions */
export function renderTermRevisions(template: string, count: number, price: number): string {
  return template.replace('{count}', String(count)).replace('{price}', String(price))
}
