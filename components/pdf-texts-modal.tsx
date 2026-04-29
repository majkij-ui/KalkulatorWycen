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

type StringKey = {
  [K in keyof PdfTextsConfig]: PdfTextsConfig[K] extends string ? K : never
}[keyof PdfTextsConfig]

function LangPill({ lang }: { lang: 'PL' | 'EN' }) {
  return (
    <span
      className={`inline-flex h-5 min-w-[26px] items-center justify-center rounded border px-1.5 text-[10px] font-bold tracking-wider uppercase ${
        lang === 'PL'
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-sky-400/30 bg-sky-400/10 text-sky-300'
      }`}
    >
      {lang}
    </span>
  )
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

  const companyFields: { plKey: StringKey; enKey: StringKey; label: string; placeholderPl: string; placeholderEn: string }[] = [
    { plKey: 'documentTitle', enKey: 'documentTitle_en', label: 'Tytuł dokumentu', placeholderPl: 'WYCENA PRODUKCJI WIDEO', placeholderEn: 'VIDEO PRODUCTION QUOTE' },
    { plKey: 'companyName', enKey: 'companyName_en', label: 'Nazwa firmy', placeholderPl: 'Nonoise Media', placeholderEn: 'Nonoise Media' },
    { plKey: 'producerName', enKey: 'producerName_en', label: 'Producent / Osoba kontaktowa', placeholderPl: 'Imię Nazwisko', placeholderEn: 'First Last' },
    { plKey: 'contactEmail', enKey: 'contactEmail_en', label: 'Email kontaktowy', placeholderPl: 'kontakt@firma.pl', placeholderEn: 'contact@company.com' },
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] flex flex-col overflow-hidden border-white/10 bg-slate-900/95 text-foreground backdrop-blur-xl sm:max-w-2xl"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Treści PDF</DialogTitle>
          <p className="text-sm text-zinc-400">
            Dane firmy i szablony uwag w wersji polskiej (PL) oraz angielskiej (EN). Wybór języka PDF na zakładce „Podgląd" decyduje, która wersja zostanie użyta.
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
                  {companyFields.map(({ plKey, enKey, label, placeholderPl, placeholderEn }) => (
                    <div key={plKey} className="flex flex-col gap-2 p-3">
                      <Label className="text-sm font-medium text-white">{label}</Label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="flex items-center gap-2">
                          <LangPill lang="PL" />
                          <Input
                            value={local[plKey] as string}
                            onChange={(e) => set(plKey, e.target.value)}
                            placeholder={placeholderPl}
                            className="flex-1 h-8 text-sm bg-black/40 border-white/10"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <LangPill lang="EN" />
                          <Input
                            value={local[enKey] as string}
                            onChange={(e) => set(enKey, e.target.value)}
                            placeholder={placeholderEn}
                            className="flex-1 h-8 text-sm bg-black/40 border-white/10"
                          />
                        </div>
                      </div>
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

                  <BilingualTermRow
                    label="Prawa autorskie — niewyłączna licencja"
                    hint="Dodawana gdy wybrano: Niewyłączna licencja"
                    plValue={local.termLicencja}
                    enValue={local.termLicencja_en}
                    onPlChange={(v) => set('termLicencja', v)}
                    onEnChange={(v) => set('termLicencja_en', v)}
                  />

                  <BilingualTermRow
                    label="Prawa autorskie — pełne przekazanie"
                    hint="Dodawana gdy wybrano: Pełne przekazanie praw"
                    plValue={local.termPrzekazanie}
                    enValue={local.termPrzekazanie_en}
                    onPlChange={(v) => set('termPrzekazanie', v)}
                    onEnChange={(v) => set('termPrzekazanie_en', v)}
                  />

                  <BilingualTermRow
                    label="Nadgodziny"
                    hint={<>Tokeny: <code className="text-amber-400">{'{hours}'}</code> = liczba godzin, <code className="text-amber-400">{'{rate}'}</code> = stawka zł</>}
                    plValue={local.termOvertime}
                    enValue={local.termOvertime_en}
                    onPlChange={(v) => set('termOvertime', v)}
                    onEnChange={(v) => set('termOvertime_en', v)}
                  />

                  <BilingualTermRow
                    label="Rundy poprawek"
                    hint={<>Tokeny: <code className="text-amber-400">{'{count}'}</code> = liczba rund, <code className="text-amber-400">{'{price}'}</code> = cena zł</>}
                    plValue={local.termRevisions}
                    enValue={local.termRevisions_en}
                    onPlChange={(v) => set('termRevisions', v)}
                    onEnChange={(v) => set('termRevisions_en', v)}
                  />

                  <BilingualTermRow
                    label="Zastrzeżenie netto/VAT"
                    hint='Zawsze dodawana. PL musi zawierać tekst „Podane kwoty są kwotami netto.", EN tekst „Amounts are stated net of VAT." — używane do przełącznika VAT.'
                    plValue={local.termNetto}
                    enValue={local.termNetto_en}
                    onPlChange={(v) => set('termNetto', v)}
                    onEnChange={(v) => set('termNetto_en', v)}
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
            Przywróć domyślne (PL + EN)
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

// ── BilingualTermRow ─────────────────────────────────────────────────────────

function BilingualTermRow({
  label,
  hint,
  plValue,
  enValue,
  onPlChange,
  onEnChange,
}: {
  label: string
  hint: React.ReactNode
  plValue: string
  enValue: string
  onPlChange: (v: string) => void
  onEnChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="text-[11px] text-zinc-500 leading-snug">{hint}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <LangPill lang="PL" />
          <textarea
            value={plValue}
            onChange={(e) => onPlChange(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <LangPill lang="EN" />
          <textarea
            value={enValue}
            onChange={(e) => onEnChange(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </div>
      </div>
    </div>
  )
}
