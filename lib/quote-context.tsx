'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { QuoteData, defaultQuoteData, createDefaultShootingDay, createDefaultDeliverable, type ShootingDay, type Deliverable, type SavedTemplate } from './quote-types'
import type { PricingTier, PricingConfigShape, TierPrices } from './pricing-config'
import { getPricingConfig, savePricingConfig, resetPricingToDefault, DEFAULT_PRICING } from './pricing-config'
import { getTotals, getBreakdownWithPricing, formatCurrency, type Totals, type PhaseBreakdown, type LineItemRow } from './quote-calc'
import { safeNum, safeArray } from './safe-numbers'

interface QuoteContextValue {
  data: QuoteData
  updateField: <K extends keyof QuoteData>(key: K, value: QuoteData[K]) => void
  templates: SavedTemplate[]
  saveTemplate: (name: string) => void
  deleteTemplate: (id: string) => void
  loadTemplate: (id: string) => void
  totals: Totals
  formatCurrency: (amount: number) => string
  isCalculating: boolean
  // Pricing tier & margin
  pricingTier: PricingTier
  setPricingTier: (tier: PricingTier) => void
  marginMultiplier: number
  setMarginMultiplier: (value: number) => void
  // Breakdown for summary & PDF
  breakdown: PhaseBreakdown[]
  // Settings: custom pricing (persisted in localStorage)
  pricingConfig: PricingConfigShape
  setPricingConfig: (config: PricingConfigShape) => void
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
  /** T&Cs for PDF "Uwagi" section – array of strings from active toggles */
  getTermsAndConditions: () => string[]
  resetToZero: () => void
}

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

const TIER_LABELS: Record<PricingTier, string> = {
  tani: 'Tani (Freelancer)',
  standard: 'Standard (Boutique)',
  agresywny: 'Agresywny (Agency)',
}

export function QuoteProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<QuoteData>(defaultQuoteData)
  const [isCalculating, setIsCalculating] = useState(false)
  const [pricingTier, setPricingTierState] = useState<PricingTier>('standard')
  const [marginMultiplier, setMarginMultiplier] = useState(1.0)
  const [pricingConfig, setPricingConfigState] = useState<PricingConfigShape>(DEFAULT_PRICING)
  const [templates, setTemplates] = useState<SavedTemplate[]>([])

  useEffect(() => {
    setTemplates(loadTemplatesFromStorage())
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

  useEffect(() => {
    setPricingConfigState(getPricingConfig())
  }, [])

  const updateField = useCallback(<K extends keyof QuoteData>(key: K, value: QuoteData[K]) => {
    setData(prev => ({ ...prev, [key]: value }))
  }, [])

  const addShootingDay = useCallback(() => {
    setData(prev => ({
      ...prev,
      detailedShootingDays: [...(prev.detailedShootingDays ?? []), createDefaultShootingDay()],
    }))
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

  const addDeliverable = useCallback(() => {
    setData(prev => ({
      ...prev,
      detailedDeliverables: [...(prev.detailedDeliverables ?? []), createDefaultDeliverable()],
    }))
  }, [])

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

  /** All format keys for delivery dropdown (config keys starting with "Format: ") */
  const availableFormats = useMemo(() => {
    return Object.keys(pricingConfig.postprodukcja).filter(k => k.startsWith('Format: '))
  }, [pricingConfig])

  const getFormatStandardPrice = useCallback((formatKey: string): number => {
    const post = pricingConfig.postprodukcja
    const prices = post[formatKey]
    return prices && typeof prices.standard === 'number' ? prices.standard : 0
  }, [pricingConfig])

  const getFormatPriceAtTier = useCallback((formatKey: string): number => {
    const post = pricingConfig.postprodukcja
    const prices = post[formatKey]
    if (!prices || typeof prices[pricingTier] !== 'number') return 0
    return prices[pricingTier]
  }, [pricingConfig, pricingTier])

  const addCustomFormat = useCallback((name: string, standardPrice: number) => {
    const key = `Format: ${name.trim()}`
    if (!key || key === 'Format: ') return
    const tiers: TierPrices = {
      tani: Math.round(standardPrice * 0.5),
      standard: Math.round(standardPrice),
      agresywny: Math.round(standardPrice * 2),
    }
    setPricingConfig({ ...pricingConfig, postprodukcja: { ...pricingConfig.postprodukcja, [key]: tiers } })
  }, [pricingConfig, setPricingConfig])

  const editCustomFormat = useCallback((oldName: string, newName: string, standardPrice: number) => {
    const oldKey = oldName.startsWith('Format: ') ? oldName : `Format: ${oldName}`
    const newKey = `Format: ${newName.trim()}`
    if (!newKey || newKey === 'Format: ') return
    const post = { ...pricingConfig.postprodukcja }
    delete post[oldKey]
    post[newKey] = {
      tani: Math.round(standardPrice * 0.5),
      standard: Math.round(standardPrice),
      agresywny: Math.round(standardPrice * 2),
    }
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
      if (!data.isDetailedProdukcja) {
        return safeNum(data.dniZdjeciowe, 0, 0) * safeNum(data.wielkoscEkipy, 1, 1)
      }
      return safeArray<ShootingDay>(data.detailedShootingDays).reduce((acc, day) => {
        const crew =
          day.rezOp +
          day.asystent +
          day.gafer +
          day.dzwiekowiec +
          day.mua +
          day.aktor +
          day.model +
          day.statysta +
          day.kameraSony +
          day.kameraRed
        return acc + crew
      }, 0)
    }
  }, [
    data.isDetailedProdukcja,
    data.dniZdjeciowe,
    data.wielkoscEkipy,
    data.detailedShootingDays,
  ])

  const getTermsAndConditions = useMemo(() => {
    return function terms(): string[] {
      const terms: string[] = []
      if (data.copyrightType === 'licencja') {
        terms.push(
          'Cena obejmuje realizację filmu oraz udzielenie niewyłącznej licencji na jego wykorzystanie w Internecie na kanałach własnych Zamawiającego oraz do użytku wewnętrznego, bez ograniczeń terytorialnych, na czas nieoznaczony, z zastrzeżeniem że w przypadku wykorzystania wizerunku aktorów lub materiałów licencjonowanych, okres licencji może zostać ograniczony zgodnie z warunkami udzielonych zgód i licencji.'
        )
      }
      if (data.copyrightType === 'przekazanie') {
        terms.push(
          'Cena obejmuje realizację filmu oraz pełne przeniesienie autorskich praw majątkowych do dzieła na Zamawiającego na wszystkich znanych polach eksploatacji, bez ograniczeń czasowych i terytorialnych.'
        )
      }
      if (data.includeOvertimeInfo) {
        terms.push(
          `1 dzień zdjęciowy obejmuje maksymalnie ${data.standardDayHours} godzin pracy na planie. Praca powyżej tego czasu rozliczana jest jako nadgodziny w kwocie ${data.overtimeHourlyRate} zł netto za członka ekipy, liczone za każdą rozpoczętą godzinę.`
        )
      }
      if (data.includeRevisionsInfo) {
        terms.push(
          `Cena obejmuje do ${data.includedRevisions} rund poprawek montażowych. Kolejne zmiany podlegają dodatkowej wycenie w kwocie ${data.extraRevisionPrice} zł netto za rundę.`
        )
      }
      terms.push(
        'Podane kwoty są kwotami netto. Do kwot należy doliczyć VAT zgodnie z obowiązującymi przepisami.'
      )
      return terms
    }
  }, [
    data.copyrightType,
    data.includeOvertimeInfo,
    data.standardDayHours,
    data.overtimeHourlyRate,
    data.includeRevisionsInfo,
    data.includedRevisions,
    data.extraRevisionPrice,
  ])

  const resetToZero = useCallback(() => {
    setData({ ...defaultQuoteData })
    setMarginMultiplier(1.0)
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
      const merged: QuoteData = { ...defaultQuoteData, ...template.state }
      merged.detailedShootingDays = Array.isArray(merged.detailedShootingDays) ? merged.detailedShootingDays : []
      merged.detailedDeliverables = Array.isArray(merged.detailedDeliverables) ? merged.detailedDeliverables : []
      if (merged.dniMontazu != null && merged.crudeEditCount === undefined) {
        merged.crudeEditCount = merged.dniMontazu
      }
      setData(merged)
      setIsCalculating(false)
    }, 500)
  }, [templates])

  const setPricingTier = useCallback((tier: PricingTier) => {
    setPricingTierState(tier)
    setIsCalculating(true)
    setTimeout(() => setIsCalculating(false), 500)
  }, [])

  const baseTotals = getTotals(data, pricingTier, marginMultiplier, pricingConfig)
  const autoCrewDays = calculateTotalCrewDays()
  const cateringCost = data.includeCatering
    ? (data.cateringOverride ? safeNum(data.cateringCustomDays, 1, 1) : autoCrewDays) * safeNum(data.cateringRate, 100, 0)
    : 0
  const lodgingCost = data.includeLodging
    ? (data.lodgingOverride ? safeNum(data.lodgingCustomDays, 1, 1) : autoCrewDays) * safeNum(data.lodgingRate, 300, 0)
    : 0
  const VAT_RATE = 0.23
  const sumaNettoWithLogistics = baseTotals.sumaNetto + cateringCost + lodgingCost
  const totals = {
    sumaNetto: sumaNettoWithLogistics,
    vat: sumaNettoWithLogistics * VAT_RATE,
    sumaBrutto: sumaNettoWithLogistics * (1 + VAT_RATE),
  }

  const baseBreakdown = getBreakdownWithPricing(data, pricingTier, marginMultiplier, pricingConfig)
  const breakdown =
    cateringCost > 0 || lodgingCost > 0
      ? (() => {
          const phases = baseBreakdown.map((p) => ({ ...p, items: [...(p.items ?? [])] }))
          const dodIndex = phases.findIndex((p) => p.category === 'Dodatkowe')
          if (dodIndex === -1) return baseBreakdown
          const dod = phases[dodIndex]
          const extraItems: LineItemRow[] = []
          if (cateringCost > 0) {
            const qty = data.cateringOverride ? safeNum(data.cateringCustomDays, 1, 1) : autoCrewDays
            extraItems.push({
              label: 'Catering',
              value: `${qty} osobodni`,
              quantity: qty,
              unitPriceNet: data.cateringRate,
              lineNetto: cateringCost,
            })
          }
          if (lodgingCost > 0) {
            const qty = data.lodgingOverride ? safeNum(data.lodgingCustomDays, 1, 1) : autoCrewDays
            extraItems.push({
              label: 'Noclegi',
              value: `${qty} osobodni`,
              quantity: qty,
              unitPriceNet: data.lodgingRate,
              lineNetto: lodgingCost,
            })
          }
          const newItems = [...dod.items, ...extraItems]
          phases[dodIndex] = {
            ...dod,
            items: newItems,
            phaseNetto: newItems.reduce((s, i) => s + i.lineNetto, 0),
          }
          return phases
        })()
      : baseBreakdown

  const value: QuoteContextValue = {
    data,
    updateField,
    templates,
    saveTemplate,
    deleteTemplate,
    loadTemplate,
    totals,
    formatCurrency,
    isCalculating,
    pricingTier,
    setPricingTier,
    marginMultiplier,
    setMarginMultiplier,
    breakdown,
    pricingConfig,
    setPricingConfig,
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
  }

  return (
    <QuoteContext.Provider value={value}>
      {children}
    </QuoteContext.Provider>
  )
}

export function useQuote() {
  const ctx = useContext(QuoteContext)
  if (!ctx) throw new Error('useQuote must be used within QuoteProvider')
  return ctx
}

export { TIER_LABELS }
