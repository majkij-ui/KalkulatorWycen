/**
 * Jednorazowe przeniesienie ustawień ze starej aplikacji — część czysta.
 *
 * Stara aplikacja trzymała część ustawień tylko w pamięci przeglądarki
 * WebView (katalog realizacji, „mój domyślny cennik"). Nowa aplikacja ma
 * własną, pustą pamięć — macOS rozdziela ją po identyfikatorze. Claude
 * odczytuje te wartości z dysku i zapisuje je do pliku w katalogu huba
 * (plan §5a–5b), a hub przy pierwszym starcie przenosi je do siebie.
 *
 * Zasady: tylko znane klucze, tylko teksty, i NIGDY nie nadpisujemy tego, co
 * hub już ma. Testy w `carryover-core.test.ts`.
 */

export const CARRYOVER_FILE = 'carryover-from-quotegen.json'

/** Klucze localStorage, które wolno przenieść. Reszta pliku jest ignorowana. */
export const CARRYOVER_KEYS = [
  'quote-gen-pricing-config',
  'quote-gen-user-default-pricing',
  'quote-gen-portfolio-catalogue',
  'quote-gen-pdf-texts',
] as const

export interface CarryOverFile {
  version: 1
  source: string
  localStorage: Record<string, string>
}

/** Pary klucz → wartość do zapisania; pomija obce klucze, nie-teksty i to, co już istnieje. */
export function carryOverEntries(file: unknown, alreadyHas: (key: string) => boolean): [string, string][] {
  if (!file || typeof file !== 'object') return []
  const values = (file as Partial<CarryOverFile>).localStorage
  if (!values || typeof values !== 'object') return []
  return CARRYOVER_KEYS.flatMap((key) => {
    const value = (values as Record<string, unknown>)[key]
    if (typeof value !== 'string' || !value || alreadyHas(key)) return []
    return [[key, value] as [string, string]]
  })
}
