'use client'

/**
 * „Ustawienia wyceny" (koło zębate w nagłówku kalkulatora): cennik TEJ wyceny,
 * moje stawki domyślne, teksty PDF, katalog realizacji i plik JSON wyceny
 * (eksport / wczytanie do tego projektu). Szablony wycen wycofano w Q1 —
 * żaden nie był zapisany, a warianty (Q2) zastąpią „start od innej wyceny".
 */

import { useRef, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useQuote } from '@/lib/quote-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { isTauriRuntime } from '@/lib/storage'
import { SettingsModal } from '@/components/settings-modal'
import { PdfTextsModal } from '@/components/pdf-texts-modal'
import { PortfolioCatalogueModal } from '@/components/portfolio-catalogue-modal'
import { Download, FileText, Film, Save, Check, Upload } from 'lucide-react'

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function downloadBlob(content: string, fileName: string, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { saveAsDefaults, exportSnapshot, importSnapshot } = useQuote()
  const { activeProject } = useProjectHub()
  const [priceEditorOpen, setPriceEditorOpen] = useState(false)
  const [pdfTextsOpen, setPdfTextsOpen] = useState(false)
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const defaultsSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileMessage, setFileMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const handleSaveDefaults = () => {
    saveAsDefaults()
    if (defaultsSavedTimerRef.current) clearTimeout(defaultsSavedTimerRef.current)
    setDefaultsSaved(true)
    defaultsSavedTimerRef.current = setTimeout(() => setDefaultsSaved(false), 2000)
  }

  // ── Plik wyceny (JSON): kopia na dysk / wczytanie do TEGO projektu ──────────
  const handleExportJson = async () => {
    setFileMessage(null)
    const json = JSON.stringify(exportSnapshot(), null, 2)
    const base = (activeProject?.name.trim() || 'Wycena').replace(/[\\/:*?"<>|]/g, '-')
    const fileName = `${base}.json`

    if (isTauriRuntime()) {
      try {
        const { save: showSaveDialog } = await import('@tauri-apps/plugin-dialog')
        const { writeFile } = await import('@tauri-apps/plugin-fs')
        const chosen = await showSaveDialog({
          defaultPath: fileName,
          filters: [{ name: 'Wycena JSON', extensions: ['json'] }],
        })
        if (!chosen) return
        await writeFile(chosen, new TextEncoder().encode(json))
        setFileMessage({ tone: 'ok', text: 'Zapisano plik wyceny.' })
      } catch (err) {
        console.error('Eksport JSON (Tauri) nie powiódł się:', err)
        setFileMessage({ tone: 'error', text: 'Nie udało się zapisać pliku.' })
      }
      return
    }
    downloadBlob(json, fileName)
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileMessage(null)
    const reader = new FileReader()
    reader.onload = () => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(reader.result as string)
      } catch {
        parsed = null
      }
      if (!importSnapshot(parsed)) {
        setFileMessage({ tone: 'error', text: `„${file.name}" to nie jest plik wyceny — nic nie zmieniono.` })
        return
      }
      setFileMessage({
        tone: 'ok',
        text: `Wczytano „${file.name}". Wycenę sprzed wczytania przywraca „Cofnij zmiany z tej sesji" w nagłówku projektu.`,
      })
    }
    reader.readAsText(file)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
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
              title="Cennik tej wyceny — zmiana dotyczy tylko otwartego projektu"
            >
              Edytuj stawki (cennik)
            </Button>
            <Button
              type="button"
              variant="outline"
              className={`w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10 ${
                defaultsSaved ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : ''
              }`}
              onClick={handleSaveDefaults}
              title="Zapisz cennik tej wyceny jako moje domyślne stawki — od nich startują nowe wyceny i „Wyczyść”"
            >
              {defaultsSaved ? <Check className="size-4 mr-2" /> : <Save className="size-4 mr-2" />}
              {defaultsSaved ? 'Zapisano stawki domyślne' : 'Zapisz stawki jako domyślne'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
              onClick={() => {
                onOpenChange(false)
                setPdfTextsOpen(true)
              }}
            >
              <FileText className="size-4 mr-2" />
              Edytuj treści PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
              onClick={() => {
                onOpenChange(false)
                setPortfolioOpen(true)
              }}
            >
              <Film className="size-4 mr-2" />
              Katalog realizacji
            </Button>
            <Separator className="bg-white/10" />

            <div className="space-y-2">
              <Label className="text-zinc-400">Plik wyceny (JSON)</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
                onClick={() => void handleExportJson()}
              >
                <Download className="size-4 mr-2" />
                Eksportuj wycenę do pliku
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full border-white/10 bg-zinc-900/40 text-white hover:bg-white/10"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4 mr-2" />
                Wczytaj wycenę z pliku do tego projektu
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <p className="text-xs text-zinc-500">
                Wczytany plik zastępuje wycenę tego projektu (dane, cennik, marżę i szkic PDF).
              </p>
              {fileMessage && (
                <p
                  className={`text-xs ${fileMessage.tone === 'ok' ? 'text-emerald-300/90' : 'text-red-300'}`}
                  role={fileMessage.tone === 'ok' ? 'status' : 'alert'}
                >
                  {fileMessage.text}
                </p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SettingsModal open={priceEditorOpen} onOpenChange={setPriceEditorOpen} />
      <PdfTextsModal open={pdfTextsOpen} onOpenChange={setPdfTextsOpen} />
      <PortfolioCatalogueModal open={portfolioOpen} onOpenChange={setPortfolioOpen} />
    </>
  )
}
