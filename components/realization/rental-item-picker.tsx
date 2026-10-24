'use client'

/**
 * Pole „co wynajęte" w wierszu wynajmu (U2, plan §17.1): wybór ze słownika
 * wynajmowanego sprzętu albo „+ Dodaj do wynajmowanego sprzętu" na miejscu
 * (jak nowa osoba w ekipie). Wolny tekst dalej działa — to opis wiersza bez
 * pozycji; wybór pozycji ustawia `rentalItemId`, a opis zostaje (np. z wyceny).
 */

import { useEffect, useId, useMemo, useState } from 'react'
import { Plus, Tag } from 'lucide-react'
import { findRentalItemByName, rentalNameKey } from '@/lib/rentals'
import type { ProjectCost } from '@/lib/project-types'
import type { RentalItem } from '@/lib/rental-types'

export interface RentalDictionary {
  /** Pozycje bez usuniętych (do wyboru). */
  items: RentalItem[]
  /** Wszystkie, także usunięte (żeby wiersz pokazał nazwę). */
  allItems: RentalItem[]
  addItem: (name: string) => Promise<RentalItem | null>
}

type Option = { type: 'item'; item: RentalItem } | { type: 'create'; name: string }

const MAX_OPTIONS = 30

export function rentalItemName(dictionary: RentalDictionary, cost: Pick<ProjectCost, 'rentalItemId'>): string | null {
  if (!cost.rentalItemId) return null
  const item = dictionary.allItems.find((i) => i.id === cost.rentalItemId)
  return item ? `${item.name}${item.deletedAt ? ' (usunięta ze słownika)' : ''}` : 'pozycja usunięta'
}

export function RentalItemPicker({
  cost,
  dictionary,
  onChange,
  className = '',
  autoFocus = false,
}: {
  cost: Pick<ProjectCost, 'rentalItemId' | 'label'>
  dictionary: RentalDictionary
  onChange: (patch: Partial<ProjectCost>) => void
  className?: string
  autoFocus?: boolean
}) {
  const id = useId()
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const linkedName = rentalItemName(dictionary, cost)
  const [text, setText] = useState(linkedName ?? cost.label ?? '')
  const [typing, setTyping] = useState(false)

  // Zmiana z zewnątrz (wybór, cofnięcie) — pokazujemy to, co jest w wierszu.
  useEffect(() => {
    if (!typing) setText(linkedName ?? cost.label ?? '')
  }, [linkedName, cost.label, typing])

  const query = typing ? text : ''
  const options = useMemo<Option[]>(() => {
    const needle = rentalNameKey(query)
    const list: Option[] = dictionary.items
      .filter((item) => !needle || rentalNameKey(item.name).includes(needle))
      .slice(0, MAX_OPTIONS)
      .map((item) => ({ type: 'item' as const, item }))
    const typed = query.trim()
    if (typed && !findRentalItemByName(dictionary.items, typed)) list.push({ type: 'create', name: typed })
    return list
  }, [dictionary.items, query])

  useEffect(() => {
    setActive(-1)
  }, [query])

  const choose = async (option: Option) => {
    setOpen(false)
    setTyping(false)
    if (option.type === 'item') {
      onChange({ rentalItemId: option.item.id, ...(cost.label?.trim() ? {} : { label: option.item.name }) })
      return
    }
    setBusy(true)
    try {
      const item = await dictionary.addItem(option.name)
      if (item) onChange({ rentalItemId: item.id, ...(cost.label?.trim() ? {} : { label: item.name }) })
    } finally {
      setBusy(false)
    }
  }

  const showList = open && options.length > 0

  return (
    <div className={`relative ${className}`}>
      <input
        role="combobox"
        aria-label="Co wynajęte"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        value={text}
        placeholder="Co wynajęte (np. Sony FX6)"
        disabled={busy}
        autoFocus={autoFocus}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          setTyping(true)
          setOpen(true)
          // Wiersz bez pozycji: tekst to opis. Z pozycją: inna nazwa = koniec powiązania.
          const keep = linkedName !== null && rentalNameKey(next) === rentalNameKey(linkedName)
          onChange({ label: next, ...(cost.rentalItemId && !keep ? { rentalItemId: undefined } : {}) })
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setTyping(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => (options.length ? (i + step + options.length) % options.length : -1))
          } else if (e.key === 'Enter') {
            if (showList && active >= 0) {
              e.preventDefault()
              void choose(options[active])
            } else {
              setOpen(false)
            }
          } else if (e.key === 'Escape' && showList) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className={`h-8 w-full min-w-0 rounded-md border border-white/10 bg-black/40 pl-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/30 ${
          cost.rentalItemId ? 'pr-7' : 'pr-2'
        }`}
      />
      {cost.rentalItemId && (
        <Tag
          className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-emerald-400/80"
          aria-label="Pozycja ze słownika wynajmowanego sprzętu"
        />
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Wynajmowany sprzęt"
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full min-w-[240px] overflow-auto rounded-lg border border-white/10 bg-zinc-950/95 p-1 shadow-xl backdrop-blur-xl"
        >
          {options.map((option, index) => (
            <li key={option.type === 'item' ? option.item.id : 'create'} role="presentation">
              {index === 0 && option.type === 'item' && (
                <div className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-zinc-600" aria-hidden>
                  Wynajmowany sprzęt
                </div>
              )}
              <div
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={index === active}
                // mousedown zamiast click: inaczej blur pola zamknąłby listę przed wyborem
                onMouseDown={(e) => {
                  e.preventDefault()
                  void choose(option)
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${
                  index === active ? 'bg-white/10 text-white' : 'text-zinc-300'
                }`}
              >
                {option.type === 'item' ? (
                  <span className="min-w-0 truncate">
                    {option.item.name}
                    {option.item.id === cost.rentalItemId && <span className="ml-1.5 text-[11px] text-emerald-400">wybrana</span>}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-semibold text-primary">
                    <Plus className="size-3.5" />
                    Dodaj „{option.name}" do wynajmowanego sprzętu
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
