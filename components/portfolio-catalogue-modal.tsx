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
import { makeCatalogueId, type PortfolioCatalogueEntry } from '@/lib/portfolio-catalogue'
import { Plus, Trash2, Film } from 'lucide-react'

interface PortfolioCatalogueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function PortfolioCatalogueModal({ open, onOpenChange }: PortfolioCatalogueModalProps) {
  const { portfolioCatalogue, setPortfolioCatalogue } = useQuote()
  const [local, setLocal] = useState<PortfolioCatalogueEntry[]>(() => deepClone(portfolioCatalogue))

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Re-seed the working copy from the saved catalogue every time the modal opens
      // so a previous "cancel" (closing without Save) doesn't leak stale edits.
      if (next) setLocal(deepClone(portfolioCatalogue))
      onOpenChange(next)
    },
    [onOpenChange, portfolioCatalogue]
  )

  const addEntry = () => {
    setLocal((prev) => [...prev, { id: makeCatalogueId(), name: '', url: '' }])
  }

  const updateEntry = (id: string, field: 'name' | 'url', value: string) => {
    setLocal((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)))
  }

  const removeEntry = (id: string) => {
    setLocal((prev) => prev.filter((e) => e.id !== id))
  }

  const save = useCallback(() => {
    // Drop rows with no URL; fall back name → url is handled by savePortfolioCatalogue.
    const cleaned = local.filter((e) => e.url.trim())
    setPortfolioCatalogue(cleaned)
    onOpenChange(false)
  }, [local, setPortfolioCatalogue, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90vh] flex flex-col overflow-hidden border-white/10 bg-slate-900/95 text-foreground backdrop-blur-xl sm:max-w-2xl"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Katalog realizacji</DialogTitle>
          <p className="text-sm text-zinc-400">
            Twoja biblioteka linków do realizacji wideo. Dodane pozycje pojawią się jako
            lista wyboru w sekcji „Przykładowe realizacje” podczas składania PDF.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 min-h-0">
          {local.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/20 px-4 py-10 text-center text-sm text-zinc-500">
              Brak zapisanych realizacji. Dodaj pierwszą poniżej.
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-zinc-900/20 divide-y divide-white/5 overflow-hidden">
              {local.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
                  <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                    <Label className="text-[11px] font-medium text-zinc-400">Nazwa</Label>
                    <Input
                      value={entry.name}
                      onChange={(e) => updateEntry(entry.id, 'name', e.target.value)}
                      placeholder="np. Teledysk — Artysta X"
                      className="h-8 text-sm bg-black/40 border-white/10"
                    />
                  </div>
                  <div className="flex flex-[1.4] flex-col gap-1.5 min-w-0">
                    <Label className="text-[11px] font-medium text-zinc-400">Link</Label>
                    <Input
                      value={entry.url}
                      onChange={(e) => updateEntry(entry.id, 'url', e.target.value)}
                      placeholder="https://vimeo.com/…"
                      className="h-8 text-sm bg-black/40 border-white/10"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 self-end text-zinc-500 hover:text-red-400 hover:bg-transparent"
                    onClick={() => removeEntry(entry.id)}
                    aria-label="Usuń realizację"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={addEntry}
            className="mt-3 w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
          >
            <Plus className="size-4 mr-2" />
            Dodaj realizację
          </Button>
        </div>

        <DialogFooter className="flex-shrink-0 flex-row items-center justify-between gap-2 border-t border-white/10 pt-4 mt-4">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Film className="size-3.5" />
            {local.filter((e) => e.url.trim()).length} pozycji w katalogu
          </span>
          <Button
            type="button"
            onClick={save}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
