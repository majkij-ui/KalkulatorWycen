/**
 * W1 — przekazanie praw i surowego materiału (czyste funkcje, bez Reacta).
 *
 * Dwie pozycje z tymi samymi kontrolkami: tryb (W cenie · Jako opcja · Nie
 * pokazuj) i kwota (% od ceny albo własna kwota w walucie wyceny).
 *
 * Podstawa % to cena bez obu tych pozycji, z marżą (`baseSubtotal` w
 * `quote-calc`). Obie liczą się od tej samej podstawy, nigdy jedna od drugiej,
 * także w trybie „Jako opcja". Własna kwota podstawy nie używa.
 *
 * Stare wyceny (bez nowych pól): `copyrightType: 'przekazanie'` = prawa „W cenie"
 * z dotychczasowym procentem; `licencja` = prawa „Nie pokazuj"; surowy materiał
 * = „Nie pokazuj". Cena i PDF starych wycen się nie zmieniają.
 *
 * Żadna z dwóch pozycji nie jest kosztem w Realizacji (to przychód).
 */

import type { ExtraAmountKind, ExtraMode, QuoteData } from './quote-types'
import { DEFAULT_PRICING, type PricingConfigShape } from './pricing-config'
import { formatPdfAmount, type PdfCurrency } from './pdf-currency'
import { PDF_LABELS } from './pdf-i18n'
import { safeNum } from './safe-numbers'

export type ExtraKey = 'rights' | 'raw'

/** Nazwy pozycji w fazie Dodatkowe (po nich rozpoznaje je PDF i ekran). */
export const EXTRA_LINE_LABEL: Record<ExtraKey, string> = {
  rights: 'Pełne przekazanie praw',
  raw: 'Przekazanie surowego materiału',
}

/** Tryb startowy nowej wyceny (decyzja M.J.: „Jako opcja"). */
export const DEFAULT_EXTRA_MODE: ExtraMode = 'opcja'

export interface ExtraSetting {
  mode: ExtraMode
  kind: ExtraAmountKind
  /** Procent z cennika wyceny (używany, gdy kind = percent). */
  percent: number
  /** Własna kwota w walucie wyceny (używana, gdy kind = fixed). */
  fixed: number
}

const isMode = (v: unknown): v is ExtraMode => v === 'w-cenie' || v === 'opcja' || v === 'ukryj'

type ExtraFields = Pick<
  QuoteData,
  'copyrightType' | 'rightsMode' | 'rightsAmountKind' | 'rightsFixedAmount' | 'rawMode' | 'rawAmountKind' | 'rawFixedAmount'
>

export function resolveExtra(
  data: Partial<ExtraFields>,
  pricing: Pick<PricingConfigShape, 'dodatkowe'> | null | undefined,
  key: ExtraKey
): ExtraSetting {
  const dod = pricing?.dodatkowe
  const rights = key === 'rights'
  const rawMode = rights ? data.rightsMode : data.rawMode
  const mode: ExtraMode = isMode(rawMode)
    ? rawMode
    : rights && data.copyrightType === 'przekazanie'
      ? 'w-cenie'
      : 'ukryj'
  const kindRaw = rights ? data.rightsAmountKind : data.rawAmountKind
  const percentRaw = rights ? dod?.pelnePrzekazaniePrawProcent : dod?.surowyMaterialProcent
  const percentFallback = rights
    ? DEFAULT_PRICING.dodatkowe.pelnePrzekazaniePrawProcent
    : DEFAULT_PRICING.dodatkowe.surowyMaterialProcent
  return {
    mode,
    kind: kindRaw === 'fixed' ? 'fixed' : 'percent',
    percent: safeNum(percentRaw, percentFallback, 0),
    fixed: safeNum(rights ? data.rightsFixedAmount : data.rawFixedAmount, 0, 0),
  }
}

/** Kwota pozycji przy danej podstawie (0 dla „Nie pokazuj"). Własna kwota ignoruje podstawę. */
export function extraAmount(setting: ExtraSetting, base: number): number {
  if (setting.mode === 'ukryj') return 0
  return setting.kind === 'fixed' ? setting.fixed : base * (setting.percent / 100)
}

/** Opis kwoty w linii kalkulatora („30% od sumy" / „własna kwota"). */
export function extraLineValue(setting: ExtraSetting): string {
  return setting.kind === 'fixed' ? 'własna kwota' : `${setting.percent}% od sumy`
}

/** Ustawienia nowej wyceny: tryb startowy, procenty zostają w cenniku wyceny. */
export function newQuoteExtras(): Pick<QuoteData, 'rightsMode' | 'rightsAmountKind' | 'rawMode' | 'rawAmountKind'> {
  return {
    rightsMode: DEFAULT_EXTRA_MODE,
    rightsAmountKind: 'percent',
    rawMode: DEFAULT_EXTRA_MODE,
    rawAmountKind: 'percent',
  }
}

/**
 * Prawa „W cenie" — jedyna prawda dla Uwag, opisu PDF i honorarium aktorów.
 * `copyrightType` zostaje w danych tylko dla starych czytników (zapis w sync
 * ze zmianą trybu); stara wycena bez `rightsMode` czyta się jak dotąd.
 */
export function rightsIncluded(data: Partial<ExtraFields>): boolean {
  return resolveExtra(data, null, 'rights').mode === 'w-cenie'
}

/** Te same pola wyzerowane (do porównań „czy wycena jest pusta"). */
export const noExtras = {
  rightsMode: undefined,
  rightsAmountKind: undefined,
  rawMode: undefined,
  rawAmountKind: undefined,
}

/** Pozycje „W cenie" — wymienia je opis wiersza „Inne koszty" w PDF. */
export function includedExtraKeys(data: Partial<ExtraFields>): ExtraKey[] {
  return (['rights', 'raw'] as const).filter((k) => resolveExtra(data, null, k).mode === 'w-cenie')
}

/**
 * Automatyczne linijki „Opcje dodatkowe" w PDF (pozycje „Jako opcja"), w
 * języku i walucie PDF. Stoją nad ręcznym tekstem; nie są w nim zapisane.
 * `convert` — przeliczenie kwoty z waluty wyceny na walutę PDF (szkic EUR
 * sprzed S3), domyślnie bez zmian.
 */
export function buildOptionLines(
  data: Partial<ExtraFields>,
  pricing: Pick<PricingConfigShape, 'dodatkowe'> | null | undefined,
  base: number,
  lang: 'pl' | 'en',
  currency: PdfCurrency,
  convert: (amount: number) => number = (a) => a
): string[] {
  const L = PDF_LABELS[lang]
  const out: string[] = []
  for (const key of ['rights', 'raw'] as const) {
    const setting = resolveExtra(data, pricing, key)
    if (setting.mode !== 'opcja') continue
    const amount = extraAmount(setting, base)
    if (!(amount > 0)) continue
    const label = key === 'rights' ? L.optionRights : L.optionRaw
    out.push(`${label}: +${formatPdfAmount(Math.round(convert(amount)), currency, lang)} ${L.optionNetSuffix}`)
  }
  return out
}

/** Ręczny tekst „Opcji dodatkowych" pod automatycznymi linijkami (do wydruku). */
export function joinOptionText(autoLines: string[], manual: string): string {
  const m = (manual ?? '').trim()
  return [...autoLines, ...(m ? [m] : [])].join('\n')
}
