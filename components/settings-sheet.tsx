'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQuote, TIER_LABELS } from '@/lib/quote-context'
import type { PricingTier } from '@/lib/pricing-config'
import { SettingsModal } from '@/components/settings-modal'
import { BookmarkPlus, Trash2 } from 'lucide-react'

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const {
    templates,
    saveTemplate,
    deleteTemplate,
    loadTemplate,
    pricingTier,
    setPricingTier,
  } = useQuote()
  const [priceEditorOpen, setPriceEditorOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')

  const handleSaveTemplate = () => {
    saveTemplate(saveTemplateName)
    setSaveTemplateName('')
    setSaveTemplateOpen(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="border-l border-white/10 bg-zinc-950/70 text-white backdrop-blur-2xl sm:max-w-sm"
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
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
              onClick={() => setSaveTemplateOpen(true)}
            >
              <BookmarkPlus className="size-4 mr-2" />
              Zapisz obecną wycenę jako szablon
            </Button>
            <Separator className="bg-white/10" />

            <div className="space-y-2">
              <Label className="text-zinc-400">Szablony wyceny</Label>
              <div className="rounded-xl border border-white/10 bg-zinc-900/40 divide-y divide-white/5 overflow-hidden">
                {(templates ?? []).length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-zinc-500">
                    Brak zapisanych szablonów
                  </div>
                ) : (
                  (templates ?? []).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 p-3 hover:bg-white/5 transition-colors"
                    >
                      <button
                        type="button"
                        className="flex-1 text-left text-sm text-white truncate min-w-0"
                        onClick={() => loadTemplate(t.id)}
                      >
                        {t.name}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-zinc-500 hover:text-red-400 hover:bg-transparent"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteTemplate(t.id)
                        }}
                        aria-label="Usuń szablon"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
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
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
        <DialogContent
          className="border-white/10 bg-slate-900/95 text-white backdrop-blur-xl"
          showCloseButton={true}
        >
          <DialogHeader>
            <DialogTitle className="text-white">Zapisz nowy szablon</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="np. Teledysk 2 dni"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
              className="border-white/10 bg-zinc-900/40 text-white placeholder:text-zinc-500"
            />
          </div>
          <DialogFooter className="gap-2 border-t border-white/10 pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
              onClick={() => setSaveTemplateOpen(false)}
            >
              Anuluj
            </Button>
            <Button
              type="button"
              onClick={handleSaveTemplate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Zapisz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsModal open={priceEditorOpen} onOpenChange={setPriceEditorOpen} />
    </>
  )
}
