'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { QuoteData, defaultQuoteData, createDefaultShootingDay, cloneShootingDay, createDefaultDeliverable, type ShootingDay, type Deliverable, type SavedTemplate, type PersistedAppSettings } from './quote-types'
import type { PricingConfigShape } from './pricing-config'
import { getPricingConfig, savePricingConfig, resetPricingToDefault, saveAsUserDefault, getUserDefault, migratePricingConfig, DEFAULT_PRICING, DEFAULT_FORMAT_KEY } from './pricing-config'
import type { PdfTextsConfig } from './pdf-texts-config'
import { getPdfTextsConfig, savePdfTextsConfig, buildTermsAndConditions, type TermsMoney } from './pdf-texts-config'
import type { PortfolioCatalogueEntry } from './portfolio-catalogue'
import { getPortfolioCatalogue, savePortfolioCatalogue } from './portfolio-catalogue'
import type { PdfLang } from './pdf-i18n'
import { formatCurrency, type Totals, type PhaseBreakdown } from './quote-calc'
import { buildQuoteBreakdown, computeQuoteTotals, computeTotalCrewDays, mergeQuoteDataPartial, quoteViews } from './quote-financials'
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
import { loadPersistedSnapshot, savePersistedSnapshot } from './persisted-state'
import { buildPersistedSnapshot } from './storage'
import {
  listSavedQuotes,
  upsertSavedQuote,
  deleteSavedQuote,
  createQuoteId,
  type QuoteSnapshot,
  type SavedQuoteRecord,
} from './quote-library'

interface QuoteContextValue {
  data: QuoteData
  updateField: <K extends keyof QuoteData>(key: K, value: QuoteData[K]) => void
  templates: SavedTemplate[]
  saveTemplate: (name: string) => void
  deleteTemplate: (id: string) => void
  loadTemplate: (id: string) => void
  /** Sumy oferty w walucie wyceny (EUR w wycenie w euro). */
  totals: Totals
  /** Kwota w walucie wyceny, np. „1 500,00 zł" / „351,00 €". */
  formatCurrency: (amount: number) => string
  /** Kwota zawsze w zł — koszty, plan, finanse. */
  formatPln: (amount: number) => string
  isCalculating: boolean
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
  // Settings: custom pricing (persisted in localStorage) — ZAWSZE w PLN
  pricingConfig: PricingConfigShape
  setPricingConfig: (config: PricingConfigShape) => void
  updatePricingValue: (category: keyof PricingConfigShape, key: string, value: number) => void
  reloadPricingFromStorage: () => void
  resetPricingToDefault: () => void
  // Produkcja detailed: shooting days
  addShootingDay: () => void
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
  resetToZero: () => void
  /** Save current pricingConfig as user-defined defaults (hard reset target) */
  saveAsDefaults: () => void
  /** Reset quote data + margin to zero AND restore pricing to user/factory defaults */
  hardReset: () => void
  /** Apply a saved quote snapshot (data + pricing + margin + PDF draft) loaded from a file */
  loadQuoteSnapshot: (snapshot: {
    data?: Partial<QuoteData>
    pricingConfig?: unknown
    marginMultiplier?: number
    pdfDraft?: unknown
  }) => void
  /** Editable PDF placeholder texts (company info + terms templates) */
  pdfTexts: PdfTextsConfig
  setPdfTexts: (config: PdfTextsConfig) => void
  /** App-level catalogue of reusable video references for the PDF "Przykładowe realizacje" section. */
  portfolioCatalogue: PortfolioCatalogueEntry[]
  setPortfolioCatalogue: (entries: PortfolioCatalogueEntry[]) => void
  /**
   * Bridge for the PDF preview tab so the sticky-header save/load JSON flow can
   * snapshot and restore the PDF draft (toggles, opisy, terminZdjec, etc.)
   * without lifting the entire localPdfState reducer up here.
   */
  registerPdfDraftBridge: (bridge: PdfDraftBridge | null) => void
  /** Keep the latest PDF draft in context so save/load works when the PDF tab is unmounted. */
  syncPdfDraftSnapshot: (snapshot: unknown) => void
  getPdfDraftSnapshot: () => unknown
  // Biblioteka wycen (AppData) — "save game / load game"
  savedQuotes: SavedQuoteRecord[]
  /** Aktualnie otwarta wycena z biblioteki (null = niezapisana / robocza). */
  activeQuoteId: string | null
  activeQuoteName: string | null
  /** Builds the full snapshot of the current state (also used by JSON export). */
  buildQuoteSnapshot: () => QuoteSnapshot
  /** Save current state under a name; overwrites when `id` given. Returns the record id. */
  saveQuoteToLibrary: (name: string, id?: string) => Promise<string>
  loadQuoteFromLibrary: (id: string) => void
  deleteQuoteFromLibrary: (id: string) => Promise<void>
  /** Detach from the active library quote (start a fresh unsaved draft). */
  startNewQuote: () => void
}

export interface PdfDraftBridge {
  /** Returns a JSON-serialisable snapshot of the current PDF draft (or null). */
  snapshot: () => unknown
  /** Applies a previously saved PDF draft snapshot, coercing missing fields. */
  apply: (raw: unknown) => void
  /** Czysty szkic PDF — to samo co „Wyczyść edytor" w zakładce PDF. */
  reset: () => void
}

/** Szkic PDF w localStorage — zakładka PDF odtwarza go przy otwarciu. */
export const PDF_DRAFT_STORAGE_KEY = 'nonoise-pdf-draft'

/** Znacznik „wyczyść szkic", gdy zakładka PDF nie jest jeszcze zamontowana. */
const PDF_DRAFT_RESET = { __reset: true } as const

const QuoteContext = createContext<QuoteContextValue | null>(null)

const TEMPLATES_STORAGE_KEY = 'nonoise-templates'

function loadTemplatesFromStorage(): SavedTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedTemplate[]) : []
  } catch {
    return []
  }
}

function saveTemplatesToStorage(templates: SavedTemplate[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates))
  } catch {
    // ignore
  }
}

export function QuoteProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<QuoteData>(defaultQuoteData)
  const [isCalculating, setIsCalculating] = useState(false)
  const [marginMultiplier, setMarginMultiplier] = useState(1.0)
  const [pricingConfig, setPricingConfigState] = useState<PricingConfigShape>(DEFAULT_PRICING)
  const [pdfTexts, setPdfTextsState] = useState<PdfTextsConfig>(() => getPdfTextsConfig())
  const [portfolioCatalogue, setPortfolioCatalogueState] = useState<PortfolioCatalogueEntry[]>(() =>
    getPortfolioCatalogue()
  )
  const [templates, setTemplates] = useState<SavedTemplate[]>([])
  const [restorationComplete, setRestorationComplete] = useState(false)
  const [savedQuotes, setSavedQuotes] = useState<SavedQuoteRecord[]>([])
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null)
  const [activeQuoteName, setActiveQuoteName] = useState<string | null>(null)

  const applyPersistedSettings = useCallback((saved: PersistedAppSettings) => {
    if (saved.data) {
      setData(mergeQuoteDataPartial(saved.data))
    }
    if (typeof saved.marginMultiplier === 'number' && Number.isFinite(saved.marginMultiplier)) {
      setMarginMultiplier(saved.marginMultiplier)
    }
    if (saved.pricingConfig && typeof saved.pricingConfig === 'object') {
      const migrated = migratePricingConfig(
        saved.pricingConfig as unknown as Record<string, Record<string, unknown>>
      )
      setPricingConfigState(migrated)
      savePricingConfig(migrated)
    }
    if (Array.isArray(saved.templates)) {
      setTemplates(saved.templates)
      saveTemplatesToStorage(saved.templates)
    }
  }, [])

  const reloadPricingFromStorage = useCallback(() => {
    setPricingConfigState(getPricingConfig())
  }, [])

  const setPricingConfig = useCallback((config: PricingConfigShape) => {
    setPricingConfigState(config)
    savePricingConfig(config)
  }, [])

  const resetPricing = useCallback(() => {
    const def = resetPricingToDefault()
    setPricingConfigState(def)
  }, [])

  const updatePricingValue = useCallback((
    category: keyof PricingConfigShape,
    key: string,
    value: number,
  ) => {
    setPricingConfigState((prev) => {
      const next: PricingConfigShape = {
        ...prev,
        [category]: { ...(prev[category] as Record<string, number>), [key]: value },
      }
      savePricingConfig(next)
      return next
    })
  }, [])

  const setPdfTexts = useCallback((config: PdfTextsConfig) => {
    setPdfTextsState(config)
    savePdfTextsConfig(config)
  }, [])

  const setPortfolioCatalogue = useCallback((entries: PortfolioCatalogueEntry[]) => {
    setPortfolioCatalogueState(entries)
    savePortfolioCatalogue(entries)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadPersistedSnapshot()
      .then((saved) => {
        if (cancelled || !saved) return
        applyPersistedSettings(saved)
      })
      .finally(() => {
        if (!cancelled) setRestorationComplete(true)
      })
    return () => {
      cancelled = true
    }
  }, [applyPersistedSettings])

  const PERSIST_DEBOUNCE_MS = 500

  useEffect(() => {
    if (!restorationComplete) return
    const snapshot = buildPersistedSnapshot({
      data,
      marginMultiplier,
      pricingConfig,
      templates,
    })
    const t = window.setTimeout(() => {
      void savePersistedSnapshot(snapshot).catch((err) => {
        // Keep the app usable, but never swallow persistence failures invisibly —
        // a missing AppData dir made autosave fail silently for months.
        console.error('Autozapis settings.json nie powiódł się:', err)
      })
    }, PERSIST_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [restorationComplete, data, marginMultiplier, pricingConfig, templates])

  const updateField = useCallback(<K extends keyof QuoteData>(key: K, value: QuoteData[K]) => {
    setData(prev => ({ ...prev, [key]: value }))
  }, [])

  const addShootingDay = useCallback(() => {
    setData(prev => {
      const days = prev.detailedShootingDays ?? []
      const lastDay = days[days.length - 1]
      const nextDay = lastDay ? cloneShootingDay(lastDay) : createDefaultShootingDay()
      return {
        ...prev,
        detailedShootingDays: [...days, nextDay],
      }
    })
  }, [])

  const removeShootingDay = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      detailedShootingDays: (prev.detailedShootingDays ?? []).filter(d => d.id !== id),
    }))
  }, [])

  const updateShootingDay = useCallback(<K extends keyof ShootingDay>(id: string, field: K, value: ShootingDay[K]) => {
    setData(prev => ({
      ...prev,
      detailedShootingDays: (prev.detailedShootingDays ?? []).map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }, [])

  /** All format keys for delivery dropdown (config keys starting with "Format: ") */
  const availableFormats = useMemo(() => {
    return Object.keys(pricingConfig.postprodukcja).filter(k => k.startsWith('Format: '))
  }, [pricingConfig])

  const addDeliverable = useCallback(() => {
    // Use the first available format so new cards never show a stale/missing format
    const firstFormat = availableFormats[0] ?? DEFAULT_FORMAT_KEY
    setData(prev => ({
      ...prev,
      detailedDeliverables: [
        ...(prev.detailedDeliverables ?? []),
        { ...createDefaultDeliverable(), format: firstFormat },
      ],
    }))
  }, [availableFormats])

  const removeDeliverable = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      detailedDeliverables: (prev.detailedDeliverables ?? []).filter(d => d.id !== id),
    }))
  }, [])

  const updateDeliverable = useCallback(<K extends keyof Deliverable>(id: string, field: K, value: Deliverable[K]) => {
    setData(prev => ({
      ...prev,
      detailedDeliverables: (prev.detailedDeliverables ?? []).map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }, [])

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

  const addCustomFormat = useCallback((name: string, standardPrice: number) => {
    const key = `Format: ${name.trim()}`
    if (!key || key === 'Format: ') return
    setPricingConfig({
      ...pricingConfig,
      postprodukcja: { ...pricingConfig.postprodukcja, [key]: Math.round(standardPrice) },
    })
  }, [pricingConfig, setPricingConfig])

  const editCustomFormat = useCallback((oldName: string, newName: string, standardPrice: number) => {
    const oldKey = oldName.startsWith('Format: ') ? oldName : `Format: ${oldName}`
    const newKey = `Format: ${newName.trim()}`
    if (!newKey || newKey === 'Format: ') return
    const post = { ...pricingConfig.postprodukcja }
    delete post[oldKey]
    post[newKey] = Math.round(standardPrice)
    setPricingConfig({ ...pricingConfig, postprodukcja: post })
    setData(prev => ({
      ...prev,
      detailedDeliverables: (prev.detailedDeliverables ?? []).map(d =>
        d.format === oldKey ? { ...d, format: newKey } : d
      ),
    }))
  }, [pricingConfig, setPricingConfig])

  const removeCustomFormat = useCallback((name: string) => {
    const key = name.startsWith('Format: ') ? name : `Format: ${name}`
    const post = { ...pricingConfig.postprodukcja }
    delete post[key]
    setPricingConfig({ ...pricingConfig, postprodukcja: post })
    const remaining = Object.keys(post).filter(k => k.startsWith('Format: '))
    const fallback = remaining[0] ?? ''
    setData(prev => ({
      ...prev,
      detailedDeliverables: (prev.detailedDeliverables ?? []).map(d =>
        d.format === key ? { ...d, format: fallback } : d
      ),
    }))
  }, [pricingConfig, setPricingConfig])

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
    setData({ ...defaultQuoteData })
    setMarginMultiplier(1.0)
  }, [])

  const saveAsDefaults = useCallback(() => {
    saveAsUserDefault(pricingConfig)
  }, [pricingConfig])

  const hardReset = useCallback(() => {
    setData({ ...defaultQuoteData })
    setMarginMultiplier(1.0)
    const target = getUserDefault()
    setPricingConfigState(target)
    savePricingConfig(target)
    // Write the combined snapshot immediately so a quick refresh can't restore old pricing
    // from the debounced persist effect's stale capture.
    void savePersistedSnapshot(buildPersistedSnapshot({
      data: defaultQuoteData,
      marginMultiplier: 1.0,
      pricingConfig: target,
      templates,
    })).catch((err) => {
      console.error('Zapis snapshotu po twardym resecie nie powiódł się:', err)
    })
  }, [templates])

  const pdfDraftBridgeRef = useRef<PdfDraftBridge | null>(null)
  const pdfDraftSnapshotRef = useRef<unknown>(null)
  const pendingPdfDraftRef = useRef<unknown>(null)

  const syncPdfDraftSnapshot = useCallback((snapshot: unknown) => {
    pdfDraftSnapshotRef.current = snapshot
  }, [])

  const registerPdfDraftBridge = useCallback((bridge: PdfDraftBridge | null) => {
    pdfDraftBridgeRef.current = bridge
    if (bridge && pendingPdfDraftRef.current != null) {
      try {
        if (pendingPdfDraftRef.current === PDF_DRAFT_RESET) bridge.reset()
        else bridge.apply(pendingPdfDraftRef.current)
        pendingPdfDraftRef.current = null
      } catch {
        // ignore corrupted pending draft
      }
    }
  }, [])

  /**
   * Czysty szkic PDF dla wyceny, która nie ma własnego. Bez tego zakładka PDF
   * odtworzyłaby szkic POPRZEDNIEGO projektu z localStorage — razem z jego
   * klientem, który trafiał potem do kalkulatora (tak S-AI dostało klienta
   * Morris & Lloyd).
   */
  const resetPdfDraft = useCallback(() => {
    pdfDraftSnapshotRef.current = null
    if (pdfDraftBridgeRef.current) {
      pdfDraftBridgeRef.current.reset()
      return
    }
    pendingPdfDraftRef.current = PDF_DRAFT_RESET
    try {
      localStorage.removeItem(PDF_DRAFT_STORAGE_KEY)
    } catch {
      // brak localStorage — zakładka PDF i tak dostanie znacznik przy montowaniu
    }
  }, [])

  const getPdfDraftSnapshot = useCallback((): unknown => {
    try {
      return pdfDraftBridgeRef.current?.snapshot() ?? pdfDraftSnapshotRef.current ?? null
    } catch {
      return pdfDraftSnapshotRef.current ?? null
    }
  }, [])

  const loadQuoteSnapshot = useCallback((snapshot: {
    data?: Partial<QuoteData>
    pricingConfig?: unknown
    marginMultiplier?: number
    pdfDraft?: unknown
  }) => {
    if (snapshot.data) setData(mergeQuoteDataPartial(snapshot.data))
    if (snapshot.pricingConfig && typeof snapshot.pricingConfig === 'object') {
      const migrated = migratePricingConfig(
        snapshot.pricingConfig as Record<string, Record<string, unknown>>
      )
      setPricingConfigState(migrated)
      savePricingConfig(migrated)
    }
    if (typeof snapshot.marginMultiplier === 'number' && Number.isFinite(snapshot.marginMultiplier)) {
      setMarginMultiplier(snapshot.marginMultiplier)
    }
    if (snapshot.pdfDraft && typeof snapshot.pdfDraft === 'object') {
      pdfDraftSnapshotRef.current = snapshot.pdfDraft
      if (pdfDraftBridgeRef.current) {
        try {
          pdfDraftBridgeRef.current.apply(snapshot.pdfDraft)
        } catch {
          // ignore corrupted PDF draft — keep currently active draft
        }
      } else {
        pendingPdfDraftRef.current = snapshot.pdfDraft
      }
    } else {
      // Wycena bez własnego szkicu PDF (nowy projekt, starsze zapisy) dostaje
      // czysty szkic, a nie szkic poprzednio otwartej wyceny.
      resetPdfDraft()
    }
  }, [resetPdfDraft])

  // ── Biblioteka wycen (AppData / localStorage) ────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void listSavedQuotes()
      .then((quotes) => {
        if (!cancelled) setSavedQuotes(quotes)
      })
      .catch(() => {
        /* brak pliku / brak uprawnień — pusta biblioteka */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const buildQuoteSnapshot = useCallback((): QuoteSnapshot => ({
    version: 2,
    savedAt: new Date().toISOString(),
    data,
    pricingConfig,
    marginMultiplier,
    pdfDraft: getPdfDraftSnapshot(),
  }), [data, pricingConfig, marginMultiplier, getPdfDraftSnapshot])

  const saveQuoteToLibrary = useCallback(async (name: string, id?: string): Promise<string> => {
    const trimmed = name.trim() || 'Bez nazwy'
    const now = new Date().toISOString()
    const existing = id ? savedQuotes.find((q) => q.id === id) : undefined
    const record: SavedQuoteRecord = {
      id: existing?.id ?? createQuoteId(),
      name: trimmed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      snapshot: buildQuoteSnapshot(),
    }
    const next = await upsertSavedQuote(record)
    setSavedQuotes(next)
    setActiveQuoteId(record.id)
    setActiveQuoteName(record.name)
    return record.id
  }, [savedQuotes, buildQuoteSnapshot])

  const loadQuoteFromLibrary = useCallback((id: string) => {
    const record = savedQuotes.find((q) => q.id === id)
    if (!record) return
    loadQuoteSnapshot(record.snapshot)
    setActiveQuoteId(record.id)
    setActiveQuoteName(record.name)
  }, [savedQuotes, loadQuoteSnapshot])

  const deleteQuoteFromLibrary = useCallback(async (id: string) => {
    const next = await deleteSavedQuote(id)
    setSavedQuotes(next)
    if (activeQuoteId === id) {
      setActiveQuoteId(null)
      setActiveQuoteName(null)
    }
  }, [activeQuoteId])

  const startNewQuote = useCallback(() => {
    setActiveQuoteId(null)
    setActiveQuoteName(null)
  }, [])

  const saveTemplate = useCallback((name: string) => {
    const template: SavedTemplate = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: name.trim() || 'Bez nazwy',
      state: { ...data },
      createdAt: new Date().toISOString(),
    }
    setTemplates(prev => {
      const next = [...prev, template]
      saveTemplatesToStorage(next)
      return next
    })
  }, [data])

  const deleteTemplate = useCallback((id: string) => {
    setTemplates(prev => {
      const next = prev.filter(t => t.id !== id)
      saveTemplatesToStorage(next)
      return next
    })
  }, [])

  const loadTemplate = useCallback((id: string) => {
    const list = templates ?? []
    const template = list.find(t => t.id === id)
    if (!template) return
    setIsCalculating(true)
    setTimeout(() => {
      setData(mergeQuoteDataPartial(template.state))
      setIsCalculating(false)
    }, 500)
  }, [templates])

  const setQuoteCurrency = useCallback((next: QuoteCurrency, choice?: ExchangeRateChoice) => {
    setData((prev) => switchQuoteCurrency(prev, next, choice))
  }, [])

  const setExchangeRate = useCallback((choice: ExchangeRateChoice) => {
    setData((prev) => withRate(prev, choice))
  }, [])

  // Wycena w PLN: oba widoki to te same obiekty co `data` i `pricingConfig`.
  const views = useMemo(() => quoteViews(data, pricingConfig), [data, pricingConfig])
  const { money } = views
  const clientData = views.client.data
  const clientPricing = views.client.pricing
  const { sumaNetto, vat, sumaBrutto } = computeQuoteTotals(clientData, marginMultiplier, clientPricing)
  const totals: Totals = { sumaNetto, vat, sumaBrutto }
  const breakdown = buildQuoteBreakdown(clientData, marginMultiplier, clientPricing)
  const breakdownPln =
    money.currency === 'PLN'
      ? breakdown
      : breakdown.map((phase) => ({ ...phase, phaseNetto: toPln(phase.phaseNetto, money) }))
  const formatQuoteCurrency = useCallback((amount: number) => formatMoney(amount, money.currency), [money.currency])

  const value: QuoteContextValue = {
    data,
    updateField,
    templates,
    saveTemplate,
    deleteTemplate,
    loadTemplate,
    totals,
    formatCurrency: formatQuoteCurrency,
    formatPln: formatCurrency,
    isCalculating,
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
    reloadPricingFromStorage,
    resetPricingToDefault: resetPricing,
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
    loadQuoteSnapshot,
    pdfTexts,
    setPdfTexts,
    portfolioCatalogue,
    setPortfolioCatalogue,
    registerPdfDraftBridge,
    syncPdfDraftSnapshot,
    getPdfDraftSnapshot,
    savedQuotes,
    activeQuoteId,
    activeQuoteName,
    buildQuoteSnapshot,
    saveQuoteToLibrary,
    loadQuoteFromLibrary,
    deleteQuoteFromLibrary,
    startNewQuote,
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
