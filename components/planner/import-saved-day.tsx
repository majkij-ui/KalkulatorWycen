'use client'

/**
 * Import dnia z CallSheetWiz (zastępuje „Manage Days" → Import): plik eksportu
 * („Export all" albo jeden dzień) wybrany z dysku albo wklejony tekst. Jeden
 * wybrany dzień trafia do tego call sheetu: harmonogram, punkty, tagi.
 * Datę i resztę call sheet bierze z huba — data z CallSheetWiz jest tylko
 * informacją. Wklejanie działa zawsze, także gdyby okno wyboru pliku nie
 * zadziałało w aplikacji desktopowej.
 */

import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { parseSavedDaysFile, savedDayDateKey } from '@/lib/call-sheet'
import type { SavedDay } from '@/lib/schedule-types'
import { plural } from '@/lib/pl-plural'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { inputClass, outlineButton } from './planner-bits'
import { longDateFromKey } from './printable-call-sheet'

interface ImportSavedDayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Data dnia w hubie (`YYYY-MM-DD` albo ''). */
  dayDate: string
  /** Ile żywych wpisów ma dziś harmonogram (zostaną zastąpione). */
  currentCount: number
  onImport: (day: SavedDay) => void
}

export function ImportSavedDay({ open, onOpenChange, dayDate, currentCount, onImport }: ImportSavedDayProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [days, setDays] = useState<SavedDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  const reset = () => {
    setText('')
    setDays(null)
    setError(null)
    setChosen(null)
  }

  const load = (content: string) => {
    const parsed = parseSavedDaysFile(content)
    if (parsed === null) {
      setDays(null)
      setError('To nie jest eksport z CallSheetWiz (oczekiwano dni z harmonogramem i tagami).')
      return
    }
    if (parsed.length === 0) {
      setDays([])
      setError('Plik jest poprawny, ale nie ma w nim żadnego dnia.')
      return
    }
    setError(null)
    setDays(parsed)
    setChosen(parsed[0].id)
  }

  const day = days?.find((d) => d.id === chosen) ?? null
  const importedDate = day ? savedDayDateKey(day) : ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-zinc-950/95 text-white backdrop-blur-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Import z CallSheetWiz</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Plik z „Export all" (albo eksport jednego dnia). Harmonogram, punkty i tagi wybranego dnia trafią do tego call
            sheetu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className={outlineButton}>
              <FileUp className="size-3.5" />
              Wybierz plik .json
            </button>
            <span className="text-xs text-zinc-500">albo wklej jego treść niżej</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => load(typeof reader.result === 'string' ? reader.result : '')
                reader.onerror = () => setError('Nie udało się odczytać pliku.')
                reader.readAsText(file)
              }}
            />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder='[{ "id": "…", "dayTitle": "Day 1", "events": [ … ] }]'
            aria-label="Treść pliku z CallSheetWiz"
            className={`${inputClass} h-auto resize-y py-1.5 font-mono text-xs`}
          />
          <button
            type="button"
            onClick={() => load(text)}
            disabled={!text.trim()}
            className={outlineButton}
          >
            Wczytaj wklejone
          </button>

          {error && (
            <p className="text-xs text-red-300" role="alert">
              {error}
            </p>
          )}

          {days && days.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[11px] text-zinc-500">
                {days.length > 1 ? `W pliku jest ${days.length} ${plural(days.length, 'dzień', 'dni', 'dni')} — wybierz jeden` : 'Dzień w pliku'}
              </legend>
              {days.map((d) => {
                const date = savedDayDateKey(d)
                return (
                  <label
                    key={d.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                      chosen === d.id ? 'border-primary/60 bg-primary/10' : 'border-white/10 hover:bg-white/[0.03]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="saved-day"
                      checked={chosen === d.id}
                      onChange={() => setChosen(d.id)}
                      className="mt-1 accent-[var(--primary)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-white">{d.dayTitle || 'Bez nazwy'}</span>
                      <span className="block text-xs text-zinc-500">
                        {date ? longDateFromKey(date) : 'bez daty'} · {d.events.length}{' '}
                        {plural(d.events.length, 'wpis', 'wpisy', 'wpisów')} · {d.categories.length}{' '}
                        {plural(d.categories.length, 'tag', 'tagi', 'tagów')}
                      </span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
          )}

          {day && (
            <div className="space-y-1 text-xs text-zinc-400">
              {currentCount > 0 && (
                <p className="text-amber-200/80">
                  Obecny harmonogram ({currentCount} {plural(currentCount, 'wpis', 'wpisy', 'wpisów')}) zostanie zastąpiony — da
                  się to cofnąć.
                </p>
              )}
              {importedDate && dayDate && importedDate !== dayDate && (
                <p>
                  W CallSheetWiz ten dzień miał datę {longDateFromKey(importedDate)}. Datę call sheetu i tak bierze kalendarz (
                  {longDateFromKey(dayDate)}).
                </p>
              )}
              <p>Tagi, które call sheet już ma (to samo id albo nazwa), się nie dublują; kolory przechodzą na paletę huba.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-100"
            >
              Anuluj
            </button>
            <button
              type="button"
              disabled={!day}
              onClick={() => {
                if (!day) return
                onImport(day)
                onOpenChange(false)
                reset()
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              Importuj dzień
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
