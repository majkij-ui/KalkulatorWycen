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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useQuote } from '@/lib/quote-context'
import type { PdfTextsConfig } from '@/lib/pdf-texts-config'
import { DEFAULT_PDF_TEXTS } from '@/lib/pdf-texts-config'

interface PdfTextsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function PdfTextsModal({ open, onOpenChange }: PdfTextsModalProps) {
  const { pdfTexts, setPdfTexts } = useQuote()
  const [local, setLocal] = useState<PdfTextsConfig>(() => deepClone(pdfTexts))

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) setLocal(deepClone(pdfTexts))
      onOpenChange(next)
    },
    [onOpenChange, pdfTexts]
  )

  const set = <K extends keyof PdfTextsConfig>(key: K, value: PdfTextsConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
  }

  const save = useCallback(() => {
    setPdfTexts(local)
    onOpenChange(false)
  }, [local, setPdfTexts, onOpenChange])

  const reset = useCallback(() => {
    const defaults = deepClone(DEFAULT_PDF_TEXTS)
    setLocal(defaults)
    setPdfTexts(defaults)
  }, [setPdfTexts])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] flex flex-col overflow-hidden border-white/10 bg-slate-900/95 text-foreground backdrop-blur-xl sm:max-w-lg"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Treści PDF</DialogTitle>
          <p className="text-sm text-zinc-400">
            Dane firmy i szablony uwag wyświetlane w eksportowanym dokumencie PDF.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 min-h-0">
          <Accordion type="multiple" defaultValue={['firma', 'uwagi']} className="w-full">

            {/* ── Company info ────────────────────────────────────── */}
            <AccordionItem value="firma" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold text-white hover:text-white/90 py-3">
                DANE FIRMY
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-xl border border-white/10 bg-zinc-900/20 divide-y divide-white/5 overflow-hidden">
                  {([
                    { key: 'documentTitle', label: 'Tytuł dokumentu', placeholder: 'WYCENA PRODUKCJI WIDEO' },
                    { key: 'companyName', label: 'Nazwa firmy', placeholder: 'Nonoise Media' },
                    { key: 'producerName', label: 'Producent / Osoba kontaktowa', placeholder: 'Imię Nazwisko' },
                    { key: 'contactEmail', label: 'Email kontaktowy', placeholder: 'kontakt@firma.pl' },
                  ] as { key: keyof PdfTextsConfig; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                    <div key={key} className="flex items-center gap-4 p-3">
                      <Label className="flex-1 text-sm text-white min-w-0 shrink-0 w-40">{label}</Label>
                      <Input
                        value={local[key] as string}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder={placeholder}
                        className="flex-1 h-8 text-sm bg-black/40 border-white/10"
                      />
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ── Terms / Uwagi templates ──────────────────────────── */}
            <AccordionItem value="uwagi" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold text-white hover:text-white/90 py-3">
                SZABLONY UWAG W PDF
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-xl border border-white/10 bg-zinc-900/20 divide-y divide-white/5 overflow-hidden">

                  <TermRow
                    label="Prawa autorskie — niewyłączna licencja"
                    hint="Dodawana gdy wybrano: Niewyłączna licencja"
                    value={local.termLicencja}
                    onChange={(v) => set('termLicencja', v)}
                  />

                  <TermRow
                    label="Prawa autorskie — pełne przekazanie"
                    hint="Dodawana gdy wybrano: Pełne przekazanie praw"
                    value={local.termPrzekazanie}
                    onChange={(v) => set('termPrzekazanie', v)}
                  />

                  <TermRow
                    label="Nadgodziny"
                    hint={<>Dodawana gdy włączono opcję nadgodzin. Tokeny: <code className="text-amber-400">{'{hours}'}</code> = liczba godzin, <code className="text-amber-400">{'{rate}'}</code> = stawka zł</>}
                    value={local.termOvertime}
                    onChange={(v) => set('termOvertime', v)}
                  />

                  <TermRow
                    label="Rundy poprawek"
                    hint={<>Dodawana gdy włączono opcję poprawek. Tokeny: <code className="text-amber-400">{'{count}'}</code> = liczba rund, <code className="text-amber-400">{'{price}'}</code> = cena zł</>}
                    value={local.termRevisions}
                    onChange={(v) => set('termRevisions', v)}
                  />

                  <TermRow
                    label="Zastrzeżenie netto/VAT"
                    hint='Zawsze dodawana. Zawiera tekst "Podane kwoty są kwotami netto." — użyty do zamiany tekstu gdy włączony jest tryb VAT.'
                    value={local.termNetto}
                    onChange={(v) => set('termNetto', v)}
                  />

                </div>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </div>

        <DialogFooter className="flex-shrink-0 flex-row justify-between gap-2 border-t border-white/10 pt-4 mt-4">
          <Button
            type="button"
            variant="outline"
            className="border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={reset}
          >
            Przywróć domyślne
          </Button>
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

// ── TermRow ──────────────────────────────────────────────────────────────────

function TermRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: React.ReactNode
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="text-[11px] text-zinc-500 leading-snug">{hint}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    </div>
  )
}
