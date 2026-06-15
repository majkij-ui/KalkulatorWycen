'use client'

import { useRef, useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useQuote } from '@/lib/quote-context'
import type { PortfolioRow } from '@/lib/quote-types'
import { Plus, Trash2 } from 'lucide-react'

const CUSTOM_VALUE = '__custom__'

function AutoGrowDescription({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-9 w-full resize-none overflow-hidden rounded-md border border-zinc-200 bg-white/70 px-3 py-1.5 text-[11px] leading-snug text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
      style={{ height: 0 }}
    />
  )
}

export function PortfolioRowsEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: PortfolioRow[]
  onChange: (rows: PortfolioRow[]) => void
  disabled?: boolean
}) {
  const { portfolioCatalogue } = useQuote()

  const updateRow = (index: number, patch: Partial<PortfolioRow>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    onChange([...rows, { url: '', description: '' }])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        // If the row's URL matches a catalogue entry, surface that entry as the
        // selected option; otherwise leave the dropdown on its placeholder so a
        // manually-typed URL doesn't masquerade as a catalogue pick.
        const matched = portfolioCatalogue.find((e) => e.url === row.url)
        const selectValue = matched ? matched.id : ''

        return (
          <div key={index} className="rounded-md border border-zinc-200 bg-white/40 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              {portfolioCatalogue.length > 0 && (
                <Select
                  disabled={disabled}
                  value={selectValue}
                  onValueChange={(val) => {
                    // "Wpis ręczny" clears the field so the user can type a one-off URL.
                    if (val === CUSTOM_VALUE) {
                      updateRow(index, { url: '' })
                      return
                    }
                    const entry = portfolioCatalogue.find((e) => e.id === val)
                    if (entry) updateRow(index, { url: entry.url })
                  }}
                >
                  <SelectTrigger className="h-8 w-[160px] shrink-0 border-zinc-200 bg-white/70 text-[11px] text-zinc-900">
                    <SelectValue placeholder="Z katalogu…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CUSTOM_VALUE} className="text-[12px] italic text-zinc-500">
                      Wpis ręczny
                    </SelectItem>
                    {portfolioCatalogue.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id} className="text-[12px]">
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <input
                type="text"
                disabled={disabled}
                value={row.url}
                onChange={(e) => updateRow(index, { url: e.target.value })}
                placeholder="https://… (wybierz z katalogu lub wpisz)"
                className="h-8 flex-1 min-w-0 rounded-md border border-zinc-200 bg-white/70 px-3 text-[11px] text-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeRow(index)}
                aria-label="Usuń realizację"
                className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <AutoGrowDescription
              disabled={disabled}
              value={row.description}
              onChange={(next) => updateRow(index, { description: next })}
              placeholder="Opis (opcjonalnie)…"
            />
          </div>
        )
      })}

      <button
        type="button"
        disabled={disabled}
        onClick={addRow}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-[11px] font-semibold text-zinc-600 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
      >
        <Plus className="size-3.5" />
        Dodaj realizację
      </button>
    </div>
  )
}
