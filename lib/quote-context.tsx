'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { QuoteData, defaultQuoteData, presets, createDefaultShootingDay, createDefaultDeliverable, type ShootingDay, type Deliverable } from './quote-types'
import type { PricingTier, PricingConfigShape } from './pricing-config'
import { getPricingConfig, savePricingConfig, resetPricingToDefault, DEFAULT_PRICING } from './pricing-config'
import { getTotals, getBreakdownWithPricing, formatCurrency, type Totals, type PhaseBreakdown } from './quote-calc'

interface QuoteContextValue {
  data: QuoteData
  updateField: <K extends keyof QuoteData>(key: K, value: QuoteData[K]) => void
  applyPreset: (presetIndex: number) => void
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
}

const QuoteContext = createContext<QuoteContextValue | null>(null)

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

  const applyPreset = useCallback((presetIndex: number) => {
    const preset = presets[presetIndex]
    if (!preset) return
    setIsCalculating(true)
    setTimeout(() => {
      const merged = { ...defaultQuoteData, ...preset.data }
      if (merged.dniMontazu != null && !('crudeEditCount' in (preset.data ?? {}))) {
        merged.crudeEditCount = merged.dniMontazu
      }
      setData(merged)
      setIsCalculating(false)
    }, 500)
  }, [])

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
    applyPreset,
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
