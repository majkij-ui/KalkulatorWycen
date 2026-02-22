'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { QuoteData, defaultQuoteData, createDefaultShootingDay, createDefaultDeliverable, type ShootingDay, type Deliverable, type SavedTemplate } from './quote-types'
import type { PricingTier, PricingConfigShape } from './pricing-config'
import { getPricingConfig, savePricingConfig, resetPricingToDefault, DEFAULT_PRICING } from './pricing-config'
import { getTotals, getBreakdownWithPricing, formatCurrency, type Totals, type PhaseBreakdown } from './quote-calc'

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
  marginPercent: number
  setMarginPercent: (value: number) => void
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
  resetToZero: () => void
}

const QuoteContext = createContext<QuoteContextValue | null>(null)

const TEMPLATES_STORAGE_KEY = 'nonoise-templates'

function loadTemplatesFromStorage(): SavedTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
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
  const [marginPercent, setMarginPercent] = useState(0)
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
      detailedShootingDays: [...prev.detailedShootingDays, createDefaultShootingDay()],
    }))
  }, [])

  const removeShootingDay = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      detailedShootingDays: prev.detailedShootingDays.filter(d => d.id !== id),
    }))
  }, [])

  const updateShootingDay = useCallback(<K extends keyof ShootingDay>(id: string, field: K, value: ShootingDay[K]) => {
    setData(prev => ({
      ...prev,
      detailedShootingDays: prev.detailedShootingDays.map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }, [])

  const addDeliverable = useCallback(() => {
    setData(prev => ({
      ...prev,
      detailedDeliverables: [...prev.detailedDeliverables, createDefaultDeliverable()],
    }))
  }, [])

  const removeDeliverable = useCallback((id: string) => {
    setData(prev => ({
      ...prev,
      detailedDeliverables: prev.detailedDeliverables.filter(d => d.id !== id),
    }))
  }, [])

  const updateDeliverable = useCallback(<K extends keyof Deliverable>(id: string, field: K, value: Deliverable[K]) => {
    setData(prev => ({
      ...prev,
      detailedDeliverables: prev.detailedDeliverables.map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }, [])

  const resetToZero = useCallback(() => {
    setData({ ...defaultQuoteData })
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
    const template = templates.find(t => t.id === id)
    if (!template) return
    setIsCalculating(true)
    setTimeout(() => {
      const merged: QuoteData = { ...defaultQuoteData, ...template.state }
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

  const totals = getTotals(data, pricingTier, marginPercent, pricingConfig)
  const breakdown = getBreakdownWithPricing(data, pricingTier, marginPercent, pricingConfig)

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
    marginPercent,
    setMarginPercent,
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
