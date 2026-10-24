'use client'

/**
 * Kalkulator otwartego projektu (Q1): `useQuote()` czyta i zmienia DOKUMENT
 * wyceny tego projektu (`quote-documents.ts`), a nie jeden wspólny kalkulator.
 * Zakładki widzą tę samą powierzchnię co dawniej (dane, cennik, marża, sumy,
 * waluta), więc nie musiały się zmieniać. Zmiany zapisują się same do
 * projektu; nie ma „Zapisz", biblioteki wycen ani globalnego stanu w
 * `settings.json` / localStorage.
 *
 * Bez otwartego projektu (np. ekran Ekipa) kalkulator pokazuje pustą wycenę z
 * domyślnym cennikiem i ignoruje zmiany.
 *
 * Siedzi WEWNĄTRZ `ProjectHubProvider` (otwarty projekt i magazyn dokumentów)
 * i NAD resztą dostawców (Ekipa czyta role z cennika otwartej wyceny).
 *
 * Warianty (Q2): `QuoteProvider` daje wariant WYBRANY do rozliczeń (Realizacja,
 * Ekipa). Kalkulator w zakładce Wycena owija się w `QuoteDocScope` z
 * dokumentem oglądanego wariantu, więc reszta aplikacji nigdy nie liczy z
 * wariantu, który tylko przeglądasz.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { QuoteData, defaultQuoteData, createDefaultShootingDay, cloneShootingDay, createDefaultDeliverable, type QuoteCrewLine, type ShootingDay, type Deliverable } from './quote-types'
import type { PricingConfigShape } from './pricing-config'
import { saveAsUserDefault, getSavedUserDefault, getUserDefault, DEFAULT_FORMAT_KEY, USER_DEFAULT_PRICING_EVENT } from './pricing-config'
import type { PdfTextsConfig } from './pdf-texts-config'
import { getPdfTextsConfig, savePdfTextsConfig, buildTermsAndConditions, type TermsMoney } from './pdf-texts-config'
import type { PortfolioCatalogueEntry } from './portfolio-catalogue'
import { getPortfolioCatalogue, savePortfolioCatalogue } from './portfolio-catalogue'
import type { PdfLang } from './pdf-i18n'
import { formatCurrency, type Totals, type PhaseBreakdown } from './quote-calc'
import { buildQuoteBreakdown, computeQuoteTotals, computeTotalCrewDays, quoteViews } from './quote-financials'
import {
  formatMoney,
  quoteMoney,
  switchQuoteCurrency,
  toPln,
  withRate,
  type ExchangeRateChoice,
  type QuoteCurrency,
  type QuoteMoney,
} from './quote-currency'
import { PriceDisplayProvider } from './price-display'
import { blankDoc, docFromSnapshot, docToSnapshot, type QuoteDoc } from './quote-documents'
import { hasAlternatives, listVariants, parseDocId } from './quote-variants'
import type { QuoteSnapshot } from './quote-library'
import { useProjectHub } from './project-hub-context'

interface QuoteContextValue {
  /** Id projektu, którego wycenę widać (`null` = żaden projekt nie jest otwarty). */
  projectId: string | null
  /** Dokument w magazynie (id projektu = wybrany wariant, `projekt#wariant` = pozostały). */
  docId: string | null
  /**
   * Nazwa oglądanego wariantu, gdy projekt ma kilka (do nazwy pliku PDF i
   * „Wycena wysłana"); `null` = projekt z jedną wyceną, jak dotąd.
   */
  variantLabel: string | null
  data: QuoteData
  updateField: <K extends keyof QuoteData>(key: K, value: QuoteData[K]) => void
  /** Sumy oferty w walucie wyceny (EUR w wycenie w euro). */
  totals: Totals
  /** Kwota w walucie wyceny, np. „1 500,00 zł" / „351,00 €". */
  formatCurrency: (amount: number) => string
  /** Kwota zawsze w zł — koszty, plan, finanse. */
  formatPln: (amount: number) => string
  // Waluta wyceny (S3) — zasady w lib/quote-currency.ts
  money: QuoteMoney
  /** Dane wyceny w walucie wyceny (stawki sprzętu i ról przeliczone) — do pokazywania cen. */
  clientData: QuoteData
  /** Cennik w walucie wyceny (pełne euro w EUR) — do pokazywania i liczenia cen. */
  clientPricing: PricingConfigShape
  /** Dane wyceny w PLN — plan kosztów (Profit). */
  costData: QuoteData
  /** Suma netto wyceny w zł (suma × kurs w EUR). */
  sumaNettoPln: number
  /** Fazy wyceny w zł (do porównań w planie). */
  breakdownPln: PhaseBreakdown[]
  setQuoteCurrency: (next: QuoteCurrency, choice?: ExchangeRateChoice) => void
  setExchangeRate: (choice: ExchangeRateChoice) => void
  // Margin
  marginMultiplier: number
  setMarginMultiplier: (value: number) => void
  // Breakdown for summary & PDF (w walucie wyceny)
  breakdown: PhaseBreakdown[]
  /** Cennik TEJ wyceny — ZAWSZE w PLN. Zmiana dotyczy tylko otwartego projektu. */
  pricingConfig: PricingConfigShape
  setPricingConfig: (config: PricingConfigShape) => void
  updatePricingValue: (category: keyof PricingConfigShape, key: string, value: number) => void
  // Produkcja detailed: shooting days
  /**
   * Kolejny dzień (kopia ostatniego). Gdy to dzień 1 od zera, dostaje
   * `firstDayCrew` (A2: „ReżOp · Ja", `defaultFirstDayCrew`).
   */
  addShootingDay: (firstDayCrew?: QuoteCrewLine[]) => void
  removeShootingDay: (id: string) => void
  updateShootingDay: <K extends keyof ShootingDay>(id: string, field: K, value: ShootingDay[K]) => void
  // Postprodukcja detailed: deliverables
  addDeliverable: () => void
  removeDeliverable: (id: string) => void
  updateDeliverable: <K extends keyof Deliverable>(id: string, field: K, value: Deliverable[K]) => void
  // Format Manager: dynamic delivery formats
  availableFormats: string[]
  getFormatStandardPrice: (formatKey: string) => number
  getFormatPriceAtTier: (formatKey: string) => number
  addCustomFormat: (name: string, standardPrice: number) => void
  editCustomFormat: (oldName: string, newName: string, standardPrice: number) => void
  removeCustomFormat: (name: string) => void
  // Osobodni (man-days) for logistics
  calculateTotalCrewDays: () => number
  /**
   * T&Cs for PDF "Uwagi" section – array of strings from active toggles. Defaults to Polish; pass 'en' for the
   * English-language PDF. Amounts are in the quote's currency unless `money` says otherwise (pre-S3 EUR draft).
   */
  getTermsAndConditions: (lang?: PdfLang, money?: TermsMoney) => string[]
  /** ↺ Wycena tego projektu od zera; cennik zostaje. Klient i nazwa projektu też. */
  resetToZero: () => void
  /** Save current pricingConfig as user-defined defaults (new quotes and „Wyczyść" start from it) */
  saveAsDefaults: () => void
  /** ⌫ Jak `resetToZero`, a cennik wraca do moich domyślnych stawek. */
  hardReset: () => void
  /**
   * Szkic PDF tej wyceny (`LocalPdfState` + `uwagiManualText`); `null` = PDF
   * jeszcze nie edytowany, idzie za kalkulatorem.
   */
  pdfDraft: unknown
  /** `silent` = poprawka automatyczna (bez zapisu, jedzie z następną zmianą). */
  setPdfDraft: (draft: unknown, options?: { silent?: boolean }) => void
  /** Pola danych odświeżane bez zapisu (lustro nazw ze szkicu PDF). */
  syncFieldsSilently: (patch: Partial<QuoteData>) => void
  /** Rośnie, gdy dokument podmieniono w całości — zakładka PDF montuje się od nowa. */
  docEpoch: number
  /** Migawka do pliku JSON (ten sam kształt co `Project.quote`). */
  exportSnapshot: () => QuoteSnapshot
  /** Wycena z pliku JSON zastępuje wycenę tego projektu. `false` = plik nie jest wyceną. */
  importSnapshot: (raw: unknown) => boolean
  /** Editable PDF placeholder texts (company info + terms templates) */
  pdfTexts: PdfTextsConfig
  setPdfTexts: (config: PdfTextsConfig) => void
  /** App-level catalogue of reusable video references for the PDF "Przykładowe realizacje" section. */
  portfolioCatalogue: PortfolioCatalogueEntry[]
  setPortfolioCatalogue: (entries: PortfolioCatalogueEntry[]) => void
}

const QuoteContext = createContext<QuoteContextValue | null>(null)

/**
 * Wycena od zera z zachowaniem tego, dla kogo jest (klient i nazwa projektu na
 * PDF). Szkic PDF zostaje jak dawniej: jego teksty nie są częścią kalkulatora,
 * a ceny pokaże ostrzeżenie „Ceny w PDF różnią się".
 */
function clearedDoc(doc: QuoteDoc, pricingConfig: PricingConfigShape): QuoteDoc {
  return {
    ...doc,
    // Wycena od zera to nowa wycena: marża jako osobna pozycja (R1, A5).
    data: {
      ...defaultQuoteData,
      clientName: doc.data.clientName,
      projectName: doc.data.projectName,
      marginAsLine: true,
      // U1: cenę zatwierdził klient — wyczyszczenie kalkulatora jej nie rusza.
      ...(doc.data.approvedPrice ? { approvedPrice: doc.data.approvedPrice } : {}),
    },
    pricingConfig,
    marginMultiplier: 1,
  }
}

/** Domyślny cennik użytkownika, odświeżany po „Zapisz stawki jako domyślne". */
function useDefaultPricing(): PricingConfigShape | null {
  const [pricing, setPricing] = useState(() => getSavedUserDefault())
  useEffect(() => {
    const refresh = () => setPricing(getSavedUserDefault())
    window.addEventListener(USER_DEFAULT_PRICING_EVENT, refresh)
    return () => window.removeEventListener(USER_DEFAULT_PRICING_EVENT, refresh)
  }, [])
  return pricing
}

/** Wspólne dla wszystkich dokumentów: teksty PDF, katalog realizacji, mój domyślny cennik. */
interface QuoteSharedValue {
  pdfTexts: PdfTextsConfig
  setPdfTexts: (config: PdfTextsConfig) => void
  portfolioCatalogue: PortfolioCatalogueEntry[]
  setPortfolioCatalogue: (entries: PortfolioCatalogueEntry[]) => void
  defaultPricing: PricingConfigShape | null
}

const QuoteSharedContext = createContext<QuoteSharedValue | null>(null)

/** Kalkulator wariantu wybranego do rozliczeń w otwartym projekcie. */
export function QuoteProvider({ children }: { children: React.ReactNode }) {
  const { activeProject } = useProjectHub()
  const [pdfTexts, setPdfTextsState] = useState<PdfTextsConfig>(() => getPdfTextsConfig())
  const [portfolioCatalogue, setPortfolioCatalogueState] = useState<PortfolioCatalogueEntry[]>(() =>
    getPortfolioCatalogue()
  )
  const defaultPricing = useDefaultPricing()

  const setPdfTexts = useCallback((config: PdfTextsConfig) => {
    setPdfTextsState(config)
    savePdfTextsConfig(config)
  }, [])

  const setPortfolioCatalogue = useCallback((entries: PortfolioCatalogueEntry[]) => {
    setPortfolioCatalogueState(entries)
    savePortfolioCatalogue(entries)
  }, [])

  const shared = useMemo(
    () => ({ pdfTexts, setPdfTexts, portfolioCatalogue, setPortfolioCatalogue, defaultPricing }),
    [pdfTexts, setPdfTexts, portfolioCatalogue, setPortfolioCatalogue, defaultPricing]
  )

  return (
    <QuoteSharedContext.Provider value={shared}>
      <QuoteDocScope docId={activeProject?.id ?? null}>{children}</QuoteDocScope>
    </QuoteSharedContext.Provider>
  )
}

/**
 * Kalkulator jednego dokumentu wyceny otwartego projektu (`docId` z
 * `variantDocId`). Dokument innego projektu niż otwarty = pusta wycena, jak
 * bez projektu.
 */
export function QuoteDocScope({ docId: requestedDocId, children }: { docId: string | null; children: React.ReactNode }) {
  const shared = useContext(QuoteSharedContext)
  if (!shared) throw new Error('QuoteDocScope musi być użyty wewnątrz QuoteProvider')
  const { pdfTexts, setPdfTexts, portfolioCatalogue, setPortfolioCatalogue, defaultPricing } = shared
  const { activeProject, quoteDocs } = useProjectHub()
  // Każda zmiana w magazynie (edycja, zapis, nowy dokument) odświeża kalkulator.
  useSyncExternalStore(quoteDocs.subscribe, quoteDocs.version, quoteDocs.version)

  const idleDoc = useMemo(() => blankDoc('', defaultPricing), [defaultPricing])

  const projectId = activeProject?.id ?? null
  const docId = requestedDocId && projectId && parseDocId(requestedDocId).projectId === projectId ? requestedDocId : null
  const doc = docId ? quoteDocs.get(docId) : idleDoc
  const docEpoch = docId ? quoteDocs.state(docId).epoch : 0
  const { data, pricingConfig, marginMultiplier } = doc
  const variantLabel = useMemo(() => {
    if (!activeProject || !docId || !hasAlternatives(activeProject)) return null
    return listVariants(activeProject).find((v) => v.docId === docId)?.label ?? null
  }, [activeProject, docId])

  /** Zmiana tego dokumentu (bez projektu — nic). */
  const edit = useCallback(
    (updater: (doc: QuoteDoc) => QuoteDoc, options?: { silent?: boolean; replace?: boolean }) => {
      if (docId) quoteDocs.edit(docId, updater, options)
    },
    [docId, quoteDocs]
  )
  const editData = useCallback(
    (updater: (data: QuoteData) => QuoteData) =>
      edit((current) => {
        const next = updater(current.data)
        return next === current.data ? current : { ...current, data: next }
      }),
    [edit]
  )

  const updateField = useCallback(<K extends keyof QuoteData>(key: K, value: QuoteData[K]) => {
    editData((prev) => (Object.is(prev[key], value) ? prev : { ...prev, [key]: value }))
  }, [editData])

  const syncFieldsSilently = useCallback(
    (patch: Partial<QuoteData>) => {
      edit(
        (current) => {
          const changed = (Object.keys(patch) as (keyof QuoteData)[]).some((key) => !Object.is(current.data[key], patch[key]))
          return changed ? { ...current, data: { ...current.data, ...patch } } : current
        },
        { silent: true }
      )
    },
    [edit]
  )

  const setMarginMultiplier = useCallback(
    (value: number) => edit((current) => (current.marginMultiplier === value ? current : { ...current, marginMultiplier: value })),
    [edit]
  )

  const setPricingConfig = useCallback(
    (config: PricingConfigShape) => edit((current) => ({ ...current, pricingConfig: config })),
    [edit]
  )

  const updatePricingValue = useCallback((
    category: keyof PricingConfigShape,
    key: string,
    value: number,
  ) => {
    edit((current) => {
      const section = current.pricingConfig[category] as Record<string, number>
      if (section[key] === value) return current
      return { ...current, pricingConfig: { ...current.pricingConfig, [category]: { ...section, [key]: value } } }
    })
  }, [edit])

  const addShootingDay = useCallback((firstDayCrew?: QuoteCrewLine[]) => {
    editData(prev => {
      const days = prev.detailedShootingDays ?? []
      const lastDay = days[days.length - 1]
      const nextDay = lastDay
        ? cloneShootingDay(lastDay)
        : { ...createDefaultShootingDay(), ...(firstDayCrew?.length ? { crew: firstDayCrew } : {}) }
      return {
        ...prev,
        detailedShootingDays: [...days, nextDay],
      }
    })
  }, [editData])

  const removeShootingDay = useCallback((id: string) => {
    editData(prev => ({
      ...prev,
      detailedShootingDays: (prev.detailedShootingDays ?? []).filter(d => d.id !== id),
    }))
  }, [editData])

  const updateShootingDay = useCallback(<K extends keyof ShootingDay>(id: string, field: K, value: ShootingDay[K]) => {
    editData(prev => ({
      ...prev,
      detailedShootingDays: (prev.detailedShootingDays ?? []).map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }, [editData])

  /** All format keys for delivery dropdown (config keys starting with "Format: ") */
  const availableFormats = useMemo(() => {
    return Object.keys(pricingConfig.postprodukcja).filter(k => k.startsWith('Format: '))
  }, [pricingConfig])

  const addDeliverable = useCallback(() => {
    // Use the first available format so new cards never show a stale/missing format
    const firstFormat = availableFormats[0] ?? DEFAULT_FORMAT_KEY
    editData(prev => ({
      ...prev,
      detailedDeliverables: [
        ...(prev.detailedDeliverables ?? []),
        { ...createDefaultDeliverable(), format: firstFormat },
      ],
    }))
  }, [availableFormats, editData])

  const removeDeliverable = useCallback((id: string) => {
    editData(prev => ({
      ...prev,
      detailedDeliverables: (prev.detailedDeliverables ?? []).filter(d => d.id !== id),
    }))
  }, [editData])

  const updateDeliverable = useCallback(<K extends keyof Deliverable>(id: string, field: K, value: Deliverable[K]) => {
    editData(prev => ({
      ...prev,
      detailedDeliverables: (prev.detailedDeliverables ?? []).map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }, [editData])

  const getFormatStandardPrice = useCallback((formatKey: string): number => {
    const post = pricingConfig.postprodukcja
    const price = post[formatKey]
    return typeof price === 'number' ? price : 0
  }, [pricingConfig])

  // Alias — with single-tier pricing both functions return the same value
  const getFormatPriceAtTier = useCallback((formatKey: string): number => {
    const post = pricingConfig.postprodukcja
    let price = post[formatKey]
    // Fall back to first available format so display matches the total calculation
    if (typeof price !== 'number') {
      const firstKey = Object.keys(post).find(k => k.startsWith('Format: '))
      price = firstKey != null ? post[firstKey] : 0
    }
    return typeof price === 'number' ? price : 0
  }, [pricingConfig])

  // Format w cenniku i karty, które go używają, zmieniają się jedną zmianą dokumentu.
  const addCustomFormat = useCallback((name: string, standardPrice: number) => {
    const key = `Format: ${name.trim()}`
    if (!key || key === 'Format: ') return
    edit((current) => ({
      ...current,
      pricingConfig: {
        ...current.pricingConfig,
        postprodukcja: { ...current.pricingConfig.postprodukcja, [key]: Math.round(standardPrice) },
      },
    }))
  }, [edit])

  const editCustomFormat = useCallback((oldName: string, newName: string, standardPrice: number) => {
    const oldKey = oldName.startsWith('Format: ') ? oldName : `Format: ${oldName}`
    const newKey = `Format: ${newName.trim()}`
    if (!newKey || newKey === 'Format: ') return
    edit((current) => {
      const post = { ...current.pricingConfig.postprodukcja }
      delete post[oldKey]
      post[newKey] = Math.round(standardPrice)
      return {
        ...current,
        pricingConfig: { ...current.pricingConfig, postprodukcja: post },
        data: {
          ...current.data,
          detailedDeliverables: (current.data.detailedDeliverables ?? []).map(d =>
            d.format === oldKey ? { ...d, format: newKey } : d
          ),
        },
      }
    })
  }, [edit])

  const removeCustomFormat = useCallback((name: string) => {
    const key = name.startsWith('Format: ') ? name : `Format: ${name}`
    edit((current) => {
      const post = { ...current.pricingConfig.postprodukcja }
      delete post[key]
      const remaining = Object.keys(post).filter(k => k.startsWith('Format: '))
      const fallback = remaining[0] ?? ''
      return {
        ...current,
        pricingConfig: { ...current.pricingConfig, postprodukcja: post },
        data: {
          ...current.data,
          detailedDeliverables: (current.data.detailedDeliverables ?? []).map(d =>
            d.format === key ? { ...d, format: fallback } : d
          ),
        },
      }
    })
  }, [edit])

  const calculateTotalCrewDays = useMemo(() => {
    return function totalCrewDays(): number {
      return computeTotalCrewDays(data)
    }
  }, [data])

  const getTermsAndConditions = useMemo(() => {
    return function terms(lang: PdfLang = 'pl', money?: TermsMoney): string[] {
      return buildTermsAndConditions(data, pdfTexts, lang, money ?? { currency: quoteMoney(data).currency })
    }
  }, [
    pdfTexts,
    data,
  ])

  const resetToZero = useCallback(() => {
    edit((current) => clearedDoc(current, current.pricingConfig))
  }, [edit])

  const hardReset = useCallback(() => {
    edit((current) => clearedDoc(current, getUserDefault()))
  }, [edit])

  const saveAsDefaults = useCallback(() => {
    saveAsUserDefault(pricingConfig)
  }, [pricingConfig])

  // Ten sam szkic (także nowy obiekt o tej samej treści) to nie zmiana.
  const setPdfDraft = useCallback(
    (draft: unknown, options?: { silent?: boolean }) =>
      edit(
        (current) =>
          current.pdfDraft === draft || JSON.stringify(current.pdfDraft) === JSON.stringify(draft)
            ? current
            : { ...current, pdfDraft: draft },
        options
      ),
    [edit]
  )

  const exportSnapshot = useCallback(() => docToSnapshot(doc), [doc])

  const importSnapshot = useCallback(
    (raw: unknown) => {
      const imported = docFromSnapshot(raw)
      if (!imported || !docId) return false
      edit(() => imported, { replace: true })
      return true
    },
    [edit, docId]
  )

  const setQuoteCurrency = useCallback((next: QuoteCurrency, choice?: ExchangeRateChoice) => {
    editData((prev) => switchQuoteCurrency(prev, next, choice))
  }, [editData])

  const setExchangeRate = useCallback((choice: ExchangeRateChoice) => {
    editData((prev) => withRate(prev, choice))
  }, [editData])

  // Wycena w PLN: oba widoki to te same obiekty co `data` i `pricingConfig`.
  const views = useMemo(() => quoteViews(data, pricingConfig), [data, pricingConfig])
  const { money } = views
  const clientData = views.client.data
  const clientPricing = views.client.pricing
  // Stałe między renderami, dopóki wycena się nie zmieni — zakładka PDF odbudowuje
  // szkic na zmianę tych wartości, a zapis szkicu odświeża kontekst.
  const totals = useMemo<Totals>(() => {
    const { sumaNetto, vat, sumaBrutto } = computeQuoteTotals(clientData, marginMultiplier, clientPricing)
    return { sumaNetto, vat, sumaBrutto }
  }, [clientData, marginMultiplier, clientPricing])
  const breakdown = useMemo(
    () => buildQuoteBreakdown(clientData, marginMultiplier, clientPricing),
    [clientData, marginMultiplier, clientPricing]
  )
  const breakdownPln = useMemo(
    () =>
      money.currency === 'PLN'
        ? breakdown
        : breakdown.map((phase) => ({ ...phase, phaseNetto: toPln(phase.phaseNetto, money) })),
    [breakdown, money]
  )
  const formatQuoteCurrency = useCallback((amount: number) => formatMoney(amount, money.currency), [money.currency])

  const value: QuoteContextValue = {
    projectId,
    docId,
    variantLabel,
    data,
    updateField,
    totals,
    formatCurrency: formatQuoteCurrency,
    formatPln: formatCurrency,
    money,
    clientData,
    clientPricing,
    costData: views.cost,
    sumaNettoPln: toPln(totals.sumaNetto, money),
    breakdownPln,
    setQuoteCurrency,
    setExchangeRate,
    marginMultiplier,
    setMarginMultiplier,
    breakdown,
    pricingConfig,
    setPricingConfig,
    updatePricingValue,
    addShootingDay,
    removeShootingDay,
    updateShootingDay,
    addDeliverable,
    removeDeliverable,
    updateDeliverable,
    availableFormats,
    getFormatStandardPrice,
    getFormatPriceAtTier,
    addCustomFormat,
    editCustomFormat,
    removeCustomFormat,
    calculateTotalCrewDays,
    getTermsAndConditions,
    resetToZero,
    saveAsDefaults,
    hardReset,
    pdfDraft: doc.pdfDraft,
    setPdfDraft,
    syncFieldsSilently,
    docEpoch,
    exportSnapshot,
    importSnapshot,
    pdfTexts,
    setPdfTexts,
    portfolioCatalogue,
    setPortfolioCatalogue,
  }

  return (
    <QuoteContext.Provider value={value}>
      <PriceDisplayProvider money={money}>{children}</PriceDisplayProvider>
    </QuoteContext.Provider>
  )
}

export function useQuote() {
  const ctx = useContext(QuoteContext)
  if (!ctx) throw new Error('useQuote must be used within QuoteProvider')
  return ctx
}
