/**
 * Szkic PDF (zakładka „Podgląd i PDF") — czyste funkcje, bez Reacta.
 *
 * Wiersze PDF powstają z kalkulatora: kwoty faz (`breakdown`) i podział
 * produkcji na ekipę / obsadę / sprzęt, opisy z danych wyceny. Szkic zapisany
 * w localStorage albo w migawce wyceny wraca przez `coerceLocalPdfDraft`.
 * Komponent zakładki tylko trzyma stan i rysuje; liczby i teksty są tutaj, żeby
 * dało się je przypiąć testami (stare wyceny drukują się tak jak dawniej).
 */

import { addDays, format } from 'date-fns'
import { getProductionEkipaCastSprzetNetto, hasMarginLine, marginLineAmount, type LineItemRow, type PhaseBreakdown } from './quote-calc'
import { pdfGearSentences } from './quote-gear'
import { pdfCrewSentences } from './quote-crew'
import type { LocalPdfState, PdfAnyRowKey, PdfRowKey, PdfRowState, PortfolioRow, QuoteData } from './quote-types'
import type { PricingConfigShape } from './pricing-config'
import { PDF_LABELS, type PdfLang } from './pdf-i18n'
import { formatPdfAmount, pdfCurrencyUnit, type PdfCurrency } from './pdf-currency'
import { quoteMoney } from './quote-currency'
import { safeArray, safeNum } from './safe-numbers'

export const DEFAULT_EXCHANGE_RATE = 4.3

export const PDF_ROW_KEYS: PdfRowKey[] = ['preprodukcja', 'ekipa', 'obsada', 'sprzet', 'logistyka', 'postprodukcja', 'inne']

/**
 * Wiersze szkicu w kolejności druku: siedem stałych, a na końcu wiersz marży
 * (R1, A5), jeśli szkic go ma — tylko wyceny z `marginAsLine`. Stare szkice
 * mają dokładnie te same wiersze co dawniej.
 */
export function pdfRowKeys(rows: Pick<LocalPdfState, 'rows'>['rows']): PdfAnyRowKey[] {
  return rows.marza ? [...PDF_ROW_KEYS, 'marza'] : PDF_ROW_KEYS
}

/** Tytuł wiersza marży: „Koordynacja i produkcja", a przy kwocie ujemnej „Rabat". */
export function pdfMarginRowTitle(amount: number, lang: PdfLang): string {
  const L = PDF_LABELS[lang]
  return safeNum(amount, 0) < 0 ? L.rowDiscount : L.rowMargin
}

/** Czy wiersz marży trafia na wydruk (jest i ma kwotę ≠ 0). */
export function printsMarginRow(rows: Pick<LocalPdfState, 'rows'>['rows']): boolean {
  return !!rows.marza && Math.round(safeNum(rows.marza.cenaNetto, 0)) !== 0
}

export function roundToUnit(n: number): number {
  const safe = safeNum(n, 0)
  return Math.round(safe)
}

export function formatPdfDate(d: Date, lang: PdfLang): string {
  return format(d, lang === 'en' ? 'dd/MM/yyyy' : 'dd.MM.yyyy')
}

/** Two empty portfolio rows by default; the user can add more with the + button. */
export function defaultPortfolioRows(): PortfolioRow[] {
  return [
    { url: '', description: '' },
    { url: '', description: '' },
  ]
}

/**
 * Coerce persisted portfolio data into structured rows. Accepts the new
 * `portfolioRows` array and, for backward compatibility, migrates the legacy
 * newline-separated `portfolioLinksText` string from older saved drafts.
 */
export function coercePortfolioRows(raw: unknown, legacyText: unknown, fallbackRows: PortfolioRow[]): PortfolioRow[] {
  if (Array.isArray(raw)) {
    const rows = raw
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((o) => ({
        url: typeof o.url === 'string' ? o.url : '',
        description: typeof o.description === 'string' ? o.description : '',
      }))
      .slice(0, 50)
    return rows.length ? rows : fallbackRows.map((r) => ({ ...r }))
  }
  if (typeof legacyText === 'string' && legacyText.trim()) {
    const rows = legacyText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((url) => ({ url, description: '' }))
    if (rows.length) return rows
  }
  return fallbackRows.map((r) => ({ ...r }))
}

export function coerceLocalPdfDraft(raw: unknown, fallback: LocalPdfState, today: Date = new Date()): LocalPdfState {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Partial<LocalPdfState> & { [k: string]: unknown }

  const draftRows = (r.rows && typeof r.rows === 'object' ? (r.rows as Record<string, unknown>) : {}) as Record<
    PdfRowKey,
    unknown
  >

  const coerceStr = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb)
  const coerceBool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb)

  // Older drafts stored cast inside `ekipa` before the separate `obsada` row existed.
  const draftHasObsada =
    'obsada' in draftRows && draftRows.obsada != null && typeof draftRows.obsada === 'object'

  const nextRows: LocalPdfState['rows'] = { ...fallback.rows }
  PDF_ROW_KEYS.forEach((key) => {
    const base = fallback.rows[key]
    const candidate = (draftRows as Record<PdfRowKey, unknown>)[key] as Record<string, unknown> | undefined
    const candidateObj = candidate && typeof candidate === 'object' ? candidate : {}

    nextRows[key] = {
      key,
      title: coerceStr(candidateObj?.title, base.title),
      opis: coerceStr(candidateObj?.opis, base.opis),
      cenaNetto:
        key === 'obsada' && !draftHasObsada
          ? 0
          : safeNum(candidateObj?.cenaNetto, base.cenaNetto, 0),
    }
  })

  // Wiersz marży (R1): szkic bez niego (np. kopia starej wyceny poprawionej
  // ręcznie) czyta go jako 0 — ceny wpisane ręcznie nigdy się nie zmieniają.
  // Może być ujemny (rabat).
  const rawMargin = (draftRows as Record<string, unknown>).marza
  const marginObj = rawMargin && typeof rawMargin === 'object' ? (rawMargin as Record<string, unknown>) : null
  delete nextRows.marza
  if (fallback.rows.marza || marginObj) {
    const base: PdfRowState = fallback.rows.marza ?? { key: 'marza', title: '', opis: '', cenaNetto: 0 }
    nextRows.marza = {
      key: 'marza',
      title: coerceStr(marginObj?.title, base.title),
      opis: coerceStr(marginObj?.opis, base.opis),
      cenaNetto: marginObj ? safeNum(marginObj.cenaNetto, 0) : 0,
    }
  }

  const coercedLang: 'pl' | 'en' = r.pdfLanguage === 'en' ? 'en' : 'pl'
  const coercedCurrency: 'PLN' | 'EUR' = r.currency === 'EUR' ? 'EUR' : 'PLN'
  const coercedRate = safeNum(r.exchangeRate, fallback.exchangeRate, DEFAULT_EXCHANGE_RATE)

  // The issue date must always reflect when the PDF is actually generated — never a
  // stale value frozen into a persisted draft. Recompute "today" (in the active
  // language's format) on every hydration/restore instead of trusting the saved string.
  const dateFmt = coercedLang === 'en' ? 'dd/MM/yyyy' : 'dd.MM.yyyy'

  return {
    ...fallback,
    clientName: coerceStr(r.clientName, fallback.clientName),
    projectName: coerceStr(r.projectName, fallback.projectName),
    issueDateIso: format(today, dateFmt),
    validUntilIso: format(addDays(today, 30), dateFmt),
    terminZdjec: coerceStr(r.terminZdjec, fallback.terminZdjec),
    showVat: coerceBool(r.showVat, fallback.showVat),
    pdfLanguage: coercedLang,
    currency: coercedCurrency,
    exchangeRate: coercedRate > 0 ? coercedRate : DEFAULT_EXCHANGE_RATE,
    rows: nextRows,
    materialyKoncowe: coerceStr(r.materialyKoncowe, fallback.materialyKoncowe),
    opcjeDodatkowe: coerceStr(r.opcjeDodatkowe, fallback.opcjeDodatkowe),
    portfolioRows: coercePortfolioRows(r.portfolioRows, r.portfolioLinksText, fallback.portfolioRows),
    termsAndConditions: safeArray<string>(r.termsAndConditions).slice(0, 200),
    // Bez znacznika = szkic sprzed S3 (wycena w PLN, euro tylko na PDF).
    followsQuote: r.followsQuote === true,
  }
}

export function getOpisInitial({
  key,
  data,
  lang = 'pl',
  money = (pln: number) => formatPdfAmount(pln, 'PLN', lang),
  amount = (value: number) => `${value.toLocaleString('pl-PL')} ${lang === 'en' ? 'PLN' : 'zł'}`,
}: {
  key: PdfRowKey
  data: QuoteData
  lang?: PdfLang
  /** Kwota z wyceny → tekst w walucie PDF (opis sprzętu pokazuje wartość i rabat). */
  money?: (value: number) => string
  /** Kwota wpisana w wycenie (honorarium aktora) → tekst w walucie PDF, bez grupowania tysięcy jak dotąd. */
  amount?: (value: number) => string
}): string {
  const L = PDF_LABELS[lang]
  const yn = (v: boolean) => (v ? L.yes : L.no)

  // Equipment class enum is a Polish-only string in QuoteData; map it for EN.
  const equipmentClass =
    data.klasaSprzetu === 'minimalistyczny'
      ? L.equipmentMinimal
      : data.klasaSprzetu === 'kinowy'
        ? L.equipmentCinematic
        : L.equipmentStandard

  if (key === 'preprodukcja') {
    const scen =
      data.scenariusz === 'brak'
        ? L.scenarioNone
        : data.scenariusz === 'podstawowy'
          ? L.scenarioBasic
          : L.scenarioExtended

    if (!data.isDetailedPrepro) {
      return `${L.opisDocumentation}: ${safeNum(data.dniDokumentacji, 0, 0)} ${L.opisDays}.\n${L.opisScenario}: ${scen}.`
    }

    return `${L.opisScenario}: ${scen}.\n${L.opisLocationVisit}: ${yn(data.wizjaLokalna)}.\n${L.opisProductionMgr}: ${yn(data.kierownikProdukcji)}.`
  }

  if (key === 'ekipa') {
    if (!data.isDetailedProdukcja) {
      return `${L.opisQuickQuoteMode}: ${safeNum(data.dniZdjeciowe, 0, 0)} ${L.opisDays} × ${safeNum(data.wielkoscEkipy, 1, 1)} ${L.opisCrewSize}\n${L.opisRezOpSurcharge}: ${yn(data.crudeRezOpSurcharge)}.`
    }

    // Ekipa z bazy (T9b): role z osobodniami; imiona tylko na życzenie.
    return [
      `${L.opisDetailedCrew} ${safeArray(data.detailedShootingDays).length} ${L.opisShootingDays}.`,
      ...pdfCrewSentences(data, 'ekipa', L, data.crewPeopleInPdf),
    ].join('\n')
  }

  if (key === 'obsada') {
    const liczbaAktorow = safeNum(data.liczbaAktorow, 0, 0)
    const perActor = safeNum(data.actorRightsTransferAmount, 0, 0)
    const hasActorRights =
      data.copyrightType === 'przekazanie' && liczbaAktorow > 0 && perActor > 0
    const actorRightsLine = hasActorRights
      ? `${L.opisActorRightsTransfer}: ${liczbaAktorow} ${L.opisActorUnit}(s) × ${amount(perActor)}.`
      : null

    if (!data.isDetailedProdukcja) {
      // Quick mode has no actor/model/extra split. If user still set a
      // per-actor rights transfer, surface it; otherwise show the placeholder.
      if (actorRightsLine) return actorRightsLine
      return L.opisCastQuickModeNote
    }

    const days = safeArray(data.detailedShootingDays) as QuoteData['detailedShootingDays']
    const sum = (pick: (d: QuoteData['detailedShootingDays'][number]) => number): number =>
      days.reduce((acc, d) => acc + safeNum(pick(d), 0, 0), 0)
    const aktorPD = sum((d) => d.aktor)
    const modelPD = sum((d) => d.model)
    const statystaPD = sum((d) => d.statysta)

    const lines: string[] = [`${L.opisDetailedCast} ${days.length} ${L.opisShootingDays}.`]
    if (aktorPD > 0) lines.push(`${L.opisActor}: ${aktorPD} ${L.opisPersonDays}.`)
    if (modelPD > 0) lines.push(`${L.opisModel}: ${modelPD} ${L.opisPersonDays}.`)
    if (statystaPD > 0) lines.push(`${L.opisExtra}: ${statystaPD} ${L.opisPersonDays}.`)
    lines.push(...pdfCrewSentences(data, 'obsada', L, data.crewPeopleInPdf))
    if (actorRightsLine) lines.push(actorRightsLine)
    return lines.join('\n')
  }

  if (key === 'sprzet') {
    if (!data.isDetailedProdukcja) {
      return `${L.opisEquipmentClass}: ${equipmentClass}.\n${L.opisDroneSurcharge}: ${yn(data.crudeDroneSurcharge)}.`
    }

    return [
      `${L.opisDetailedEquipment} ${safeArray(data.detailedShootingDays).length} ${L.opisShootingDays}.`,
      ...pdfGearSentences(data, L, money),
    ].join('\n')
  }

  if (key === 'logistyka') {
    return `${L.opisTravel}: ${safeNum(data.kosztDojazduKm, 0, 0)} km.\n${L.opisCatering}: ${yn(data.includeCatering)}.\n${L.opisLodging}: ${yn(data.includeLodging)}.`
  }

  if (key === 'postprodukcja') {
    if (!data.isDetailedPostpro) {
      const unit = data.crudeEditUnit === 'dni' ? L.unitDays : L.unitHours
      return `${L.opisEditingQuickMode}: ${safeNum(data.crudeEditCount, 0, 0)} ${unit}.`
    }

    return `${L.opisDetailedPostpro}: ${safeArray(data.detailedDeliverables).length} ${L.opisItems}.`
  }

  // Legacy lektor/licencjaMuzyczna fields are no longer priced anywhere
  // (voiceover & music live in per-deliverable postpro now), so the PDF
  // description only mentions the copyright arrangement.
  if (key === 'inne') {
    const prawa = data.copyrightType === 'przekazanie' ? L.copyrightTransfer : L.copyrightLicense
    return `${L.opisCopyright}: ${prawa}.`
  }

  return ''
}

export interface PdfBuildInput {
  data: QuoteData
  /** Fazy kalkulatora z cateringiem i noclegami (jak w kontekście wyceny). */
  breakdown: PhaseBreakdown[]
  sumaNetto: number
  marginMultiplier: number
  pricing: PricingConfigShape
  lang: PdfLang
  currency: PdfCurrency
  exchangeRate: number
  terms: string[]
  issueDate: Date
  validUntilDate: Date
}

/** Świeży szkic PDF z kalkulatora (ceny wierszy, opisy, teksty domyślne). */
export function buildInitialPdfState({
  data,
  breakdown,
  sumaNetto,
  marginMultiplier,
  pricing,
  lang,
  currency,
  exchangeRate,
  terms,
  issueDate,
  validUntilDate,
}: PdfBuildInput): LocalPdfState {
  const preNetto = safeNum(breakdown?.find((p) => p.category === 'Preprodukcja')?.phaseNetto, 0, 0)
  const postNetto = safeNum(breakdown?.find((p) => p.category === 'Postprodukcja')?.phaseNetto, 0, 0)

  const { ekipaNetto, castNetto, sprzetNetto } = getProductionEkipaCastSprzetNetto(data, marginMultiplier, pricing)

  const dodPhase = breakdown?.find((p) => p.category === 'Dodatkowe')
  const dodItems = safeArray<LineItemRow>(dodPhase?.items)

  const dojazd = dodItems.filter((i) => i.label === 'Koszty dojazdu').reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)
  const catering = dodItems.filter((i) => i.label === 'Catering').reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)
  const noclegi = dodItems.filter((i) => i.label === 'Noclegi').reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)

  const excluded = new Set(['Koszty dojazdu', 'Catering', 'Noclegi'])
  const inneNetto = dodItems
    .filter((i) => !excluded.has(i.label))
    .reduce((s, i) => s + safeNum(i.lineNetto, 0, 0), 0)

  const logistykaNetto = dojazd + catering + noclegi
  // R1 (A5): marża jako osobny wiersz (wiersze wyżej są wtedy bez marży).
  const marginNetto = marginLineAmount(breakdown)

  const computedSum = preNetto + ekipaNetto + castNetto + sprzetNetto + logistykaNetto + postNetto + inneNetto + marginNetto
  const delta = safeNum(sumaNetto, 0, 0) - computedSum

  // Od S3 kwoty kalkulatora są już w walucie wyceny (EUR w wycenie w euro).
  // Przelicza tylko szkic sprzed S3: wycena w PLN, a PDF w EUR po kursie szkicu.
  const convertsFromPln = currency === 'EUR' && quoteMoney(data).currency === 'PLN'
  const safeRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : DEFAULT_EXCHANGE_RATE
  const toCurrency = (value: number): number => {
    const v = convertsFromPln ? value / safeRate : value
    return roundToUnit(v)
  }
  const typedAmount = (value: number): string =>
    `${(convertsFromPln ? roundToUnit(value / safeRate) : value).toLocaleString('pl-PL')} ${pdfCurrencyUnit(currency, lang)}`

  const L = PDF_LABELS[lang]

  return {
    clientName: data.clientName ?? '',
    projectName: data.projectName ?? '',
    issueDateIso: formatPdfDate(issueDate, lang),
    validUntilIso: formatPdfDate(validUntilDate, lang),
    terminZdjec: L.tbd,
    showVat: false,
    pdfLanguage: lang,
    currency,
    exchangeRate,
    rows: {
      preprodukcja: {
        key: 'preprodukcja',
        title: L.rowPreprodukcja,
        cenaNetto: toCurrency(preNetto),
        opis: getOpisInitial({ key: 'preprodukcja', data, lang }),
      },
      ekipa: {
        key: 'ekipa',
        title: L.rowEkipa,
        cenaNetto: toCurrency(ekipaNetto),
        opis: getOpisInitial({ key: 'ekipa', data, lang }),
      },
      obsada: {
        key: 'obsada',
        title: L.rowObsada,
        cenaNetto: toCurrency(castNetto),
        opis: getOpisInitial({ key: 'obsada', data, lang, amount: typedAmount }),
      },
      sprzet: {
        key: 'sprzet',
        title: L.rowSprzet,
        cenaNetto: toCurrency(sprzetNetto),
        opis: getOpisInitial({
          key: 'sprzet',
          data,
          lang,
          money: (value) => formatPdfAmount(toCurrency(value), currency, lang),
        }),
      },
      logistyka: {
        key: 'logistyka',
        title: L.rowLogistyka,
        cenaNetto: toCurrency(logistykaNetto),
        opis: getOpisInitial({ key: 'logistyka', data, lang }),
      },
      postprodukcja: {
        key: 'postprodukcja',
        title: L.rowPostprodukcja,
        cenaNetto: toCurrency(postNetto),
        opis: getOpisInitial({ key: 'postprodukcja', data, lang }),
      },
      inne: {
        key: 'inne',
        title: L.rowInne,
        cenaNetto: toCurrency(inneNetto + delta),
        opis: getOpisInitial({ key: 'inne', data, lang }),
      },
      ...(hasMarginLine(data)
        ? {
            marza: {
              key: 'marza' as const,
              title: pdfMarginRowTitle(marginNetto, lang),
              cenaNetto: toCurrency(marginNetto),
              opis: marginNetto < 0 ? L.opisDiscount : L.opisMargin,
            },
          }
        : {}),
    },

    materialyKoncowe: '',
    opcjeDodatkowe: data.opcjeDodatkowe ?? '',
    portfolioRows: defaultPortfolioRows(),
    termsAndConditions: terms,
    followsQuote: !convertsFromPln,
  }
}

/**
 * Stary przełącznik „Waluta PDF": jednorazowe przeliczenie zapisanych kwot
 * wierszy po kursie szkicu (PLN → EUR dzieli, EUR → PLN mnoży).
 */
export function flipPdfCurrency(prev: LocalPdfState, nextCurrency: PdfCurrency): LocalPdfState {
  if (prev.currency === nextCurrency) return prev
  const rate = Number.isFinite(prev.exchangeRate) && prev.exchangeRate > 0 ? prev.exchangeRate : DEFAULT_EXCHANGE_RATE
  const factor = nextCurrency === 'EUR' ? 1 / rate : rate
  const nextRows = { ...prev.rows }
  ;(Object.keys(nextRows) as PdfAnyRowKey[]).forEach((key) => {
    const r = nextRows[key]
    if (!r) return
    nextRows[key] = { ...r, cenaNetto: roundToUnit(safeNum(r.cenaNetto, 0, key === 'marza' ? undefined : 0) * factor) }
  })
  return { ...prev, currency: nextCurrency, rows: nextRows }
}

/** Suma netto wierszy szkicu (to, co drukuje PDF) — z wierszem marży, gdy jest (może być ujemny). */
export function pdfRowsTotal(rows: LocalPdfState['rows']): number {
  const base = PDF_ROW_KEYS.reduce((sum, key) => sum + safeNum(rows[key]?.cenaNetto, 0, 0), 0)
  return rows?.marza ? base + safeNum(rows.marza.cenaNetto, 0) : base
}

/**
 * Szkic po zmianie waluty wyceny (S3). `before` to szkic, jaki kalkulator dałby
 * w starej walucie, `after` — w nowej. Cena wiersza równa tej z kalkulatora
 * bierze nową cenę z kalkulatora; cena poprawiona ręcznie przelicza się po
 * kursie (zaokrąglona). Opis taki jak wygenerowany bierze nowy opis (kwoty w
 * nowej walucie), opis zmieniony ręcznie zostaje. Reszta szkicu bez zmian.
 */
export function reconcilePdfCurrency(
  draft: LocalPdfState,
  before: LocalPdfState,
  after: LocalPdfState,
  /** Kurs EUR (zł za 1 €) do przeliczenia cen poprawionych ręcznie. */
  rate: number
): LocalPdfState {
  if (draft.currency === after.currency) return { ...draft, followsQuote: true, exchangeRate: after.exchangeRate }
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_EXCHANGE_RATE
  const convert = (value: number) => roundToUnit(after.currency === 'EUR' ? value / safeRate : value * safeRate)
  const rows = { ...draft.rows }
  pdfRowKeys(draft.rows).forEach((key) => {
    const row = draft.rows[key]
    if (!row) return
    const calcBefore = before.rows[key] ?? { cenaNetto: 0, opis: '' }
    const calcAfter = after.rows[key] ?? { cenaNetto: 0, opis: calcBefore.opis }
    const sameAsCalculator = Math.abs(safeNum(row.cenaNetto, 0) - safeNum(calcBefore.cenaNetto, 0)) < 0.5
    rows[key] = {
      ...row,
      cenaNetto: sameAsCalculator ? calcAfter.cenaNetto : convert(safeNum(row.cenaNetto, 0)),
      opis: row.opis === calcBefore.opis ? calcAfter.opis : row.opis,
    }
  })
  return { ...draft, rows, currency: after.currency, exchangeRate: after.exchangeRate, followsQuote: true }
}

/** Szkic sprzed S3: wycena w PLN, a PDF w EUR po własnym kursie. */
export function isLegacyEurDraft(draft: Pick<LocalPdfState, 'currency' | 'followsQuote'>, quoteCurrency: PdfCurrency): boolean {
  return !draft.followsQuote && draft.currency === 'EUR' && quoteCurrency === 'PLN'
}
