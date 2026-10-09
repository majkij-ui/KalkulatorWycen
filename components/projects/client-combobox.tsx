'use client'

/**
 * Pole klienta z podpowiedziami nazw już użytych (plan §3.2a).
 *
 * Dwa tryby:
 *  - `free` (nagłówek projektu): wolny tekst, podpowiedzi tylko pomagają;
 *    zatwierdza Enter, wybór z listy albo wyjście z pola.
 *  - wybór (filtr listy): tylko istniejący klient; pusty tekst = wszyscy,
 *    tekst bez dopasowania wraca do poprzedniego wyboru.
 *
 * Dopasowanie i kolejność podpowiedzi: `suggestClients` (bez wielkości liter
 * i polskich znaków).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { clientKey, suggestClients, type ClientInfo } from '@/lib/clients'
import { plural } from '@/lib/pl-plural'

function projectsLabel(count: number): string {
  return `${count} ${plural(count, 'projekt', 'projekty', 'projektów')}`
}

export function ClientCombobox({
  value,
  directory,
  onCommit,
  free = false,
  placeholder,
  ariaLabel,
  className = '',
}: {
  value: string
  directory: ClientInfo[]
  /** `picked` = klient z listy (albo wpisany dokładnie jak istniejący). */
  onCommit: (name: string, picked: ClientInfo | null) => void
  free?: boolean
  placeholder?: string
  ariaLabel: string
  className?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [focused, setFocused] = useState(false)
  // Enter i wybór z listy już zatwierdziły — wyjście z pola nie może
  // zatwierdzić drugi raz (ze starym, niedopisanym tekstem).
  const committedRef = useRef(false)

  // Zmiana z zewnątrz (inny projekt, przywrócony filtr) — gdy nikt nie pisze.
  useEffect(() => {
    if (!focused) setText(value)
  }, [value, focused])

  // Dopóki tekst = bieżąca wartość, pokazujemy ostatnio używanych, nie tylko ją.
  const query = text === value ? '' : text
  const suggestions = useMemo(() => suggestClients(directory, query, 8), [directory, query])
  const showList = open && suggestions.length > 0

  const matchFor = (name: string) => {
    const key = clientKey(name)
    return key ? (directory.find((c) => c.key === key) ?? null) : null
  }

  const commit = (name: string, picked: ClientInfo | null) => {
    committedRef.current = true
    setOpen(false)
    setActive(-1)
    setText(name)
    if (name !== value) onCommit(name, picked)
  }

  const commitText = () => {
    const trimmed = text.trim()
    const match = matchFor(trimmed)
    if (free) {
      commit(trimmed, match)
    } else if (!trimmed) {
      commit('', null)
    } else if (match) {
      commit(match.name, match)
    } else {
      setText(value)
      setOpen(false)
    }
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          committedRef.current = false
          setText(e.target.value)
          setOpen(true)
          // W filtrze Enter bierze pierwszą podpowiedź; w nagłówku wpisany tekst
          // (nowy klient może być początkiem nazwy istniejącego).
          setActive(free || !e.target.value.trim() ? -1 : 0)
        }}
        onFocus={() => {
          committedRef.current = false
          setFocused(true)
          setOpen(true)
        }}
        onBlur={() => {
          setFocused(false)
          if (!committedRef.current) commitText()
          committedRef.current = false
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => (suggestions.length ? (i + step + suggestions.length) % suggestions.length : -1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (showList && active >= 0) commit(suggestions[active].name, suggestions[active])
            else commitText()
            inputRef.current?.blur()
          } else if (e.key === 'Escape') {
            if (showList) {
              e.stopPropagation()
              setOpen(false)
            } else {
              committedRef.current = true
              setText(value)
              inputRef.current?.blur()
            }
          }
        }}
        className={`h-8 w-full rounded-md border border-white/10 bg-black/40 pl-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-white/30 ${
          !free && value ? 'pr-7' : 'pr-2'
        }`}
      />
      {!free && value && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => commit('', null)}
          aria-label="Wszyscy klienci"
          title="Wszyscy klienci"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 outline-none hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <X className="size-3.5" />
        </button>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-lg border border-white/10 bg-zinc-950/95 p-1 shadow-xl backdrop-blur-xl"
        >
          {!query && (
            <li className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-zinc-600" aria-hidden>
              Ostatnio
            </li>
          )}
          {suggestions.map((client, index) => (
            <li
              key={client.key}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown zamiast click: inaczej blur pola zatwierdziłby wpisany tekst pierwszy
              onMouseDown={(e) => {
                e.preventDefault()
                commit(client.name, client)
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${
                index === active ? 'bg-white/10 text-white' : 'text-zinc-300'
              }`}
            >
              <span className="min-w-0 truncate">{client.name}</span>
              <span className="shrink-0 text-[11px] text-zinc-500">{projectsLabel(client.projectCount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
