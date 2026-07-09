'use client'

import { useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useQuote } from '@/lib/quote-context'
import { isTauriRuntime } from '@/lib/storage'
import { FolderOpen, Save, FilePlus2, Trash2, Download, Upload, Check } from 'lucide-react'

interface QuoteLibrarySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatSavedDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : format(d, 'dd.MM.yyyy HH:mm')
}

export function QuoteLibrarySheet({ open, onOpenChange }: QuoteLibrarySheetProps) {
  const {
    savedQuotes,
    activeQuoteId,
    activeQuoteName,
    saveQuoteToLibrary,
    loadQuoteFromLibrary,
    deleteQuoteFromLibrary,
    startNewQuote,
    buildQuoteSnapshot,
    loadQuoteSnapshot,
    data,
  } = useQuote()

  const [newName, setNewName] = useState('')
  const [justSavedId, setJustSavedId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashSaved = (id: string) => {
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    setJustSavedId(id)
    savedFlashTimerRef.current = setTimeout(() => setJustSavedId(null), 2000)
  }

  /** Sensowna domyślna nazwa: klient / projekt, jeśli wpisane. */
  const suggestedName = (): string => {
    const parts = [data.clientName?.trim(), data.projectName?.trim()].filter(Boolean)
    return parts.length ? parts.join(' — ') : `Wycena ${format(new Date(), 'dd.MM.yyyy')}`
  }

  const handleSaveAsNew = async () => {
    const id = await saveQuoteToLibrary(newName.trim() || suggestedName())
    setNewName('')
    flashSaved(id)
  }

  const handleOverwriteActive = async () => {
    if (!activeQuoteId) return
    const id = await saveQuoteToLibrary(activeQuoteName ?? suggestedName(), activeQuoteId)
    flashSaved(id)
  }

  const handleLoad = (id: string) => {
    loadQuoteFromLibrary(id)
    onOpenChange(false)
  }

  const handleDelete = (id: string) => {
    if (pendingDeleteId !== id) {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      setPendingDeleteId(id)
      deleteTimerRef.current = setTimeout(() => setPendingDeleteId(null), 3000)
      return
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    setPendingDeleteId(null)
    void deleteQuoteFromLibrary(id)
  }

  // ── Kopia zapasowa: eksport / import pliku JSON ──────────────────────────────
  const handleExportJson = async () => {
    const snapshot = buildQuoteSnapshot()
    const json = JSON.stringify(snapshot, null, 2)
    const base = (activeQuoteName ?? suggestedName()).replace(/[\\/:*?"<>|]/g, '-')
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
        return
      } catch (err) {
        console.error('Eksport JSON (Tauri) nie powiódł się:', err)
        return
      }
    }
    downloadBlob(json, fileName)
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(reader.result as string) as {
          data?: Record<string, unknown>
          pricingConfig?: unknown
          marginMultiplier?: number
          pdfDraft?: unknown
        }
        loadQuoteSnapshot(snapshot as Parameters<typeof loadQuoteSnapshot>[0])
        // Import z pliku = wycena spoza biblioteki; odepnij aktywny wpis,
        // żeby "Zapisz zmiany" nie nadpisał niepowiązanej wyceny.
        startNewQuote()
        onOpenChange(false)
      } catch {
        alert('Błąd: Nieprawidłowy plik wyceny.')
      }
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col border-l border-white/10 bg-zinc-950/70 text-white backdrop-blur-2xl sm:max-w-sm"
      >
        <SheetHeader className="pb-4">
          <SheetTitle className="text-xl font-bold tracking-tight text-white">
            Moje wyceny
          </SheetTitle>
        </SheetHeader>

        {/* Aktywna wycena + zapis */}
        <div className="space-y-3">
          {activeQuoteId ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-zinc-400">Otwarta wycena</p>
              <p className="mt-0.5 truncate text-sm font-medium text-white">{activeQuoteName}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={handleOverwriteActive}
                  className="flex-1 gap-1.5"
                >
                  {justSavedId === activeQuoteId ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                  {justSavedId === activeQuoteId ? 'Zapisano' : 'Zapisz zmiany'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startNewQuote}
                  className="gap-1.5 border-white/10 bg-white/5 hover:bg-white/10"
                  title="Odepnij od zapisanej wyceny i pracuj na kopii roboczej"
                >
                  <FilePlus2 className="size-3.5" />
                  Nowa
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              Pracujesz na niezapisanej wycenie. Nadaj jej nazwę i zapisz, aby wrócić do niej później.
            </p>
          )}

          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveAsNew()
              }}
              placeholder={suggestedName()}
              className="border-white/10 bg-white/5 text-sm text-white placeholder:text-zinc-500"
            />
            <Button size="sm" onClick={handleSaveAsNew} className="h-9 shrink-0 gap-1.5">
              <Save className="size-3.5" />
              Zapisz jako
            </Button>
          </div>
        </div>

        <Separator className="my-4 bg-white/10" />

        {/* Lista zapisanych wycen */}
        <div className="min-h-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Zapisane wyceny ({savedQuotes.length})
          </p>
          {savedQuotes.length === 0 ? (
            <p className="text-sm text-zinc-500">Brak zapisanych wycen.</p>
          ) : (
            <ScrollArea className="h-full pr-2">
              <div className="space-y-2 pb-2">
                {savedQuotes.map((q) => {
                  const isActive = q.id === activeQuoteId
                  const client = q.snapshot?.data?.clientName?.trim()
                  const project = q.snapshot?.data?.projectName?.trim()
                  const subtitle = [client, project].filter(Boolean).join(' · ')
                  return (
                    <div
                      key={q.id}
                      className={`rounded-lg border p-3 transition-colors ${
                        isActive ? 'border-primary/40 bg-primary/10' : 'border-white/10 bg-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{q.name}</p>
                          {subtitle && <p className="truncate text-xs text-zinc-400">{subtitle}</p>}
                          <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500">
                            {formatSavedDate(q.updatedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleLoad(q.id)}
                            className="h-8 gap-1.5 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="size-3.5" />
                            Wczytaj
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDelete(q.id)}
                            className={`size-8 ${
                              pendingDeleteId === q.id
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300'
                                : 'text-zinc-500 hover:bg-white/10 hover:text-white'
                            }`}
                            title={pendingDeleteId === q.id ? 'Kliknij ponownie, aby usunąć' : 'Usuń wycenę'}
                            aria-label="Usuń wycenę"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <Separator className="my-4 bg-white/10" />

        {/* Kopia zapasowa / wymiana plikiem */}
        <div className="space-y-2 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Kopia zapasowa (plik JSON)
          </p>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportJson}
              className="flex-1 gap-1.5 border-white/10 bg-white/5 hover:bg-white/10"
            >
              <Download className="size-3.5" />
              Eksportuj do pliku
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 gap-1.5 border-white/10 bg-white/5 hover:bg-white/10"
            >
              <Upload className="size-3.5" />
              Importuj z pliku
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
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
