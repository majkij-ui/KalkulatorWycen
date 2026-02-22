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
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useQuote } from '@/lib/quote-context'
import { TIER_LABELS } from '@/lib/quote-context'
import type { PricingConfigShape, PricingTier } from '@/lib/pricing-config'
import { DEFAULT_PRICING } from '@/lib/pricing-config'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TIERS: PricingTier[] = ['tani', 'standard', 'agresywny']

type CategoryKey = keyof PricingConfigShape

interface PricingRowDef {
  key: string
  label: string
  isKeyMetric?: boolean
}

const PRICING_STRUCTURE: { category: CategoryKey; title: string; rows: PricingRowDef[] }[] = [
  {
    category: 'preprodukcja',
    title: 'PREPRODUKCJA',
    rows: [
      { key: 'dzienDokumentacji', label: 'Dzień dokumentacji', isKeyMetric: true },
      { key: 'scenariuszPodstawowy', label: 'Scenariusz podstawowy' },
      { key: 'scenariuszRozbudowany', label: 'Scenariusz rozbudowany' },
      { key: 'wizjaLokalna', label: 'Wizja lokalna' },
      { key: 'kierownikProdukcji', label: 'Kierownik produkcji' },
    ],
  },
  {
    category: 'produkcja',
    title: 'PRODUKCJA',
    rows: [
      { key: 'dzienZdjeciowyEkipa', label: 'Dzień zdjęciowy (Ekipa)', isKeyMetric: true },
      { key: 'pakietSprzetowyMinimalistyczny', label: 'Pakiet sprzętowy (Minimalistyczny)', isKeyMetric: true },
      { key: 'pakietSprzetowyStandard', label: 'Pakiet sprzętowy (Standard)', isKeyMetric: true },
      { key: 'pakietSprzetowyKinowy', label: 'Pakiet sprzętowy (Kinowy)', isKeyMetric: true },
      { key: 'rezOp', label: 'ReżOp' },
      { key: 'asystentOperator', label: 'Asystent/Operator' },
      { key: 'gafer', label: 'Gafer' },
      { key: 'dzwiekowiec', label: 'Dźwiękowiec' },
      { key: 'mua', label: 'MUA' },
      { key: 'aktor', label: 'Aktor' },
      { key: 'model', label: 'Model' },
      { key: 'statystaEpizodysta', label: 'Statysta' },
      { key: 'kameraSonyMirrorless', label: 'Kamera Sony' },
      { key: 'kameraRedKomodoX', label: 'Kamera Red' },
      { key: 'obiektywyStandard', label: 'Obiektywy (Standard)' },
      { key: 'obiektywyRental', label: 'Obiektywy (Rental)' },
      { key: 'stabilizacjaStandard', label: 'Stabilizacja (Standard)' },
      { key: 'stabilizacjaRental', label: 'Stabilizacja (Rental)' },
      { key: 'podgladStandard', label: 'Podgląd (Standard)' },
      { key: 'podgladRental', label: 'Podgląd (Rental)' },
      { key: 'swiatloStandard', label: 'Światło (Standard)' },
      { key: 'swiatloRental', label: 'Światło (Rental)' },
      { key: 'dronDji', label: 'Dron (DJI)' },
      { key: 'dronFpv', label: 'Dron (FPV)' },
    ],
  },
  {
    category: 'postprodukcja',
    title: 'POSTPRODUKCJA',
    rows: [
      { key: 'montazZaDzien', label: 'Montaż (Dzień)', isKeyMetric: true },
      { key: 'montazZaGodzine', label: 'Montaż (Godzina)', isKeyMetric: true },
      { key: 'formatShortsReel', label: 'Format Shorts/Reel' },
      { key: 'formatReportaz', label: 'Format Reportaż' },
      { key: 'korekcjaBarwnaPodstawowa', label: 'Korekcja barwna (Podstawowa)' },
      { key: 'korekcjaBarwnaZaawansowana', label: 'Korekcja barwna (Zaawansowana)' },
      { key: 'animacje2d', label: 'Animacje (2D)' },
      { key: 'animacjeAi', label: 'Animacje (AI)' },
      { key: 'muzykaCopyfree', label: 'Muzyka (Copy-free)' },
      { key: 'muzykaKompozytor', label: 'Muzyka (Kompozytor)' },
      { key: 'soundDesignProsty', label: 'Sound Design (Prosty)' },
      { key: 'soundDesignZlozony', label: 'Sound Design (Złożony)' },
      { key: 'masterDzwiekuPodstawowy', label: 'Master dźwięku (Podstawowy)' },
      { key: 'masterDzwiekuZlozony', label: 'Master dźwięku (Złożony)' },
      { key: 'lektorAi', label: 'Lektor (AI)' },
      { key: 'lektorStudio', label: 'Lektor (Studio)' },
    ],
  },
  {
    category: 'dodatkowe',
    title: 'DODATKOWE',
    rows: [
      { key: 'kosztDojazduKm', label: 'Koszty dojazdu (za km)', isKeyMetric: true },
    ],
  },
]

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
    (category: CategoryKey, itemKey: string, tier: PricingTier, value: number) => {
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] flex flex-col overflow-hidden border-white/10 bg-slate-900/95 text-foreground backdrop-blur-xl sm:max-w-2xl"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Ustawienia stawek</DialogTitle>
          <p className="text-sm text-zinc-400">
            Edytuj stawki netto (PLN) dla każdej pozycji i poziomu. Zmiany zapisują się lokalnie.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 min-h-0">
          <Accordion type="multiple" className="w-full" defaultValue={['preprodukcja', 'produkcja', 'postprodukcja', 'dodatkowe']}>
            {PRICING_STRUCTURE.map(({ category, title, rows }) => {
              const categoryData = local[category] as Record<string, { tani: number; standard: number; agresywny: number }> | undefined
              if (!categoryData) return null
              return (
                <AccordionItem key={category} value={category} className="border-white/10">
                  <AccordionTrigger className="text-sm font-semibold text-white hover:text-white/90 py-3">
                    {title}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="rounded-xl border border-white/10 bg-zinc-900/20 divide-y divide-white/5 overflow-hidden">
                      <div className="flex items-center gap-4 p-3 bg-zinc-900/40">
                        <div className="flex-1 text-[10px] font-medium uppercase text-zinc-500">
                          Puste
                        </div>
                        {TIERS.map((t) => (
                          <span
                            key={t}
                            className="w-20 text-right text-[10px] font-medium uppercase text-zinc-500"
                          >
                            {TIER_LABELS[t].split(' ')[0]}
                          </span>
                        ))}
                      </div>
                      {rows.map((row) => {
                        const itemVal = categoryData[row.key]
                        if (!isTierPrices(itemVal)) return null
                        const isKey = row.isKeyMetric === true
                        return (
                          <div
                            key={row.key}
                            className={`flex items-center gap-4 p-3 ${isKey ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                          >
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <span className="text-sm text-white truncate">{row.label}</span>
                              {isKey && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 shrink-0 text-[10px] text-primary border-primary/20 bg-primary/10"
                                >
                                  Szybka wycena
                                </Badge>
                              )}
                            </div>
                            {TIERS.map((t) => (
                              <Input
                                key={t}
                                type="number"
                                min={0}
                                step={row.key === 'kosztDojazduKm' ? 0.1 : 50}
                                value={itemVal[t] ?? 0}
                                onChange={(e) =>
                                  update(category, row.key, t, Number(e.target.value) || 0)
                                }
                                className="w-20 h-8 text-right bg-black/40 border-white/10 text-sm"
                              />
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </div>

        <DialogFooter className="flex-shrink-0 flex-row gap-2 border-t border-white/10 pt-4 mt-4">
          <Button
            type="button"
            variant="outline"
            className="border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={reset}
          >
            Przywróć domyślne
          </Button>
          <Button type="button" onClick={save} className="bg-primary text-primary-foreground hover:bg-primary/90">
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
