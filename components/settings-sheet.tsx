'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useQuote, TIER_LABELS } from '@/lib/quote-context'
import { presets } from '@/lib/quote-types'
import type { PricingTier } from '@/lib/pricing-config'
import { SettingsModal } from '@/components/settings-modal'

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { applyPreset, pricingTier, setPricingTier, marginPercent, setMarginPercent } = useQuote()
  const [priceEditorOpen, setPriceEditorOpen] = useState(false)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="border-white/10 bg-slate-900/95 text-white backdrop-blur-xl sm:max-w-sm"
        >
          <SheetHeader className="pb-6">
            <SheetTitle className="text-xl font-bold tracking-tight text-white">
              Ustawienia wyceny
            </SheetTitle>
          </SheetHeader>

          <div className="flex flex-1 flex-col space-y-6 px-4">
            <Button
              type="button"
              variant="default"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                onOpenChange(false)
                setPriceEditorOpen(true)
              }}
            >
              Edytuj stawki (cennik)
            </Button>
            <Separator className="bg-white/10" />

            <div className="space-y-2">
              <Label className="text-zinc-400">Szablony wyceny</Label>
              <Select onValueChange={(val) => applyPreset(Number(val))}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Wybierz szablon..." />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-slate-900/95 text-white backdrop-blur-xl">
                  {presets.map((preset, i) => (
                    <SelectItem
                      key={i}
                      value={String(i)}
                      className="text-white focus:bg-white/10 focus:text-white"
                    >
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-400">Poziom stawek</Label>
              <Select value={pricingTier} onValueChange={(v) => setPricingTier(v as PricingTier)}>
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-slate-900/95 text-white backdrop-blur-xl">
                  {(['tani', 'standard', 'agresywny'] as const).map((t) => (
                    <SelectItem
                      key={t}
                      value={t}
                      className="text-white focus:bg-white/10 focus:text-white"
                    >
                      {TIER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-400">Marża</Label>
                <span className="text-sm font-medium tabular-nums text-white">{marginPercent}%</span>
              </div>
              <Slider
                value={[marginPercent]}
                onValueChange={([v]) => setMarginPercent(v)}
                min={0}
                max={50}
                step={5}
                className="py-2"
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SettingsModal open={priceEditorOpen} onOpenChange={setPriceEditorOpen} />
    </>
  )
}
