'use client'

import { useCallback, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQuote } from '@/lib/quote-context'
import { TIER_LABELS } from '@/lib/quote-context'
import type { PricingConfigShape, PricingTier } from '@/lib/pricing-config'
import { DEFAULT_PRICING } from '@/lib/pricing-config'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TIERS: PricingTier[] = ['tani', 'standard', 'agresywny']

/** Convert camelCase key to display label (e.g. "dzienZdjeciowyEkipa" -> "Dzien zdjeciowy ekipa") */
function keyToLabel(key: string): string {
  const withSpaces = key.replace(/([A-Z])/g, ' $1').trim()
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase()
}

/** Convert category key to display name (e.g. "preprodukcja" -> "Preprodukcja") */
function categoryToLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
}

/** Type guard for tier prices object */
function isTierPrices(
  val: unknown
): val is { tani: number; standard: number; agresywny: number } {
  return (
    typeof val === 'object' &&
    val !== null &&
    'tani' in val &&
    'standard' in val &&
    'agresywny' in val
  )
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { pricingConfig, setPricingConfig, resetPricingToDefault } = useQuote()
  const [local, setLocal] = useState<PricingConfigShape>(pricingConfig)

  const syncFromContext = useCallback(() => {
    setLocal(pricingConfig)
  }, [pricingConfig])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) syncFromContext()
      onOpenChange(next)
    },
    [onOpenChange, syncFromContext]
  )

  const update = useCallback(
    (category: keyof PricingConfigShape, itemKey: string, tier: PricingTier, value: number) => {
      setLocal((prev) => {
        const cat = { ...(prev[category] as Record<string, { tani: number; standard: number; agresywny: number }>) }
        const item = { ...(cat[itemKey] ?? { tani: 0, standard: 0, agresywny: 0 }), [tier]: value }
        cat[itemKey] = item
        return { ...prev, [category]: cat } as PricingConfigShape
      })
    },
    []
  )

  const save = useCallback(() => {
    setPricingConfig(local)
    onOpenChange(false)
  }, [local, setPricingConfig, onOpenChange])

  const reset = useCallback(() => {
    setLocal(DEFAULT_PRICING)
    resetPricingToDefault()
  }, [resetPricingToDefault])

  const categories = Object.entries(local) as [keyof PricingConfigShape, Record<string, { tani: number; standard: number; agresywny: number }>][]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-hidden border-white/10 bg-slate-900/95 text-foreground backdrop-blur-xl sm:max-w-2xl"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Ustawienia stawek</DialogTitle>
          <p className="text-sm text-zinc-400">
            Edytuj stawki netto (PLN) dla każdej pozycji i poziomu. Zmiany zapisują się lokalnie.
          </p>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[50vh] space-y-6 pr-2">
          {categories.map(([categoryKey, categoryObj]) => (
            <div key={categoryKey}>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary/80">
                {categoryToLabel(categoryKey)}
              </h4>
              <div className="space-y-3">
                {Object.entries(categoryObj).map(([itemKey, itemVal]) => {
                  if (!isTierPrices(itemVal)) return null
                  return (
                    <div
                      key={itemKey}
                      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                    >
                      <Label className="text-sm text-zinc-400">{keyToLabel(itemKey)}</Label>
                      {TIERS.map((t) => (
                        <div key={t} className="flex flex-col gap-1">
                          <span className="text-[10px] text-zinc-400">{TIER_LABELS[t].split(' ')[0]}</span>
                          <Input
                            type="number"
                            min={0}
                            step={50}
                            value={itemVal[t] ?? 0}
                            onChange={(e) => update(categoryKey, itemKey, t, Number(e.target.value) || 0)}
                            className="w-24 border-white/10 bg-white/5 text-foreground"
                          />
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-row gap-2 border-t border-white/10 pt-4">
          <Button
            type="button"
            variant="outline"
            className="border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={reset}
          >
            Przywróć domyślne
          </Button>
          <Button type="button" onClick={save} className="bg-primary text-primary-foreground hover:bg-primary/90">
            Zapisz i zamknij
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
