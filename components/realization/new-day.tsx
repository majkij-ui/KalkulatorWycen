'use client'

/**
 * „+ Dzień" w Realizacji. Z datą dzień trafia do kalendarza (tam żyje jego
 * data); bez daty zostaje tylko w projekcie, dopóki nie dostanie daty.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { REALIZATION_KINDS, REALIZATION_KIND_LABELS, type RealizationKind } from '@/lib/realization-days'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fieldClass } from './cost-rows'

export interface NewDay {
  kind: RealizationKind
  /** `YYYY-MM-DD` albo '' (bez daty — nie trafia do kalendarza). */
  date: string
  location: string
}

export function NewDayButton({ onAdd }: { onAdd: (day: NewDay) => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<RealizationKind>('shoot_day')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2000-01-01'

  const reset = () => {
    setKind('shoot_day')
    setDate('')
    setLocation('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/10 text-xs">
          <Plus className="size-3.5" />
          Dzień
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-white/10 bg-zinc-950 p-3 text-white">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await onAdd({ kind, date: dated ? date : '', location: dated ? location : '' })
              setOpen(false)
              reset()
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5 text-xs" role="group" aria-label="Typ dnia">
            {REALIZATION_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-md px-2.5 py-1 transition-colors ${
                  kind === k ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {REALIZATION_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <label className="text-[11px] text-zinc-500">
            Data (opcjonalnie)
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${fieldClass} mt-1 w-full [color-scheme:dark]`}
            />
          </label>
          {dated && (
            <label className="text-[11px] text-zinc-500">
              Miejsce (opcjonalnie)
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="np. studio, adres klienta"
                className={`${fieldClass} mt-1 w-full`}
              />
            </label>
          )}
          <p className="text-[11px] text-zinc-500">
            {dated
              ? 'Dzień pojawi się też w kalendarzu — tam zmienisz jego datę.'
              : 'Bez daty dzień zostaje tylko w projekcie. Datę dodasz później.'}
          </p>
          <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs">
            {dated ? 'Dodaj do projektu i kalendarza' : 'Dodaj dzień bez daty'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
