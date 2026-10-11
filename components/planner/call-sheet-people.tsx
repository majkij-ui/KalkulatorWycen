'use client'

/**
 * Ekipa i kontakty dnia na call sheecie. Szare wartości w polach to
 * podpowiedzi z huba (Realizacja, baza Ekipa, kontakt projektu) — trafiają na
 * call sheet, dopóki nie wpiszesz własnych. Wpisane zostają tylko tutaj i hub
 * ich nie nadpisze; wyczyszczone pole wraca do podpowiedzi.
 */

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Plus, StickyNote, Trash2 } from 'lucide-react'
import type { ResolvedCallSheet, ResolvedCrewRow } from '@/lib/call-sheet'
import type { CallSheetClient, CallSheetContact, CallSheetCrewEntry } from '@/lib/call-sheet-types'
import { hhmmToMinutes, minutesToHHMM } from '@/lib/time'
import { SectionTitle, iconButton, inputClass, smallButton } from './planner-bits'

type CrewPatch = Partial<Omit<CallSheetCrewEntry, 'id' | 'costId'>>

interface CallSheetPeopleProps {
  sheet: ResolvedCallSheet
  onPatchCrew: (row: ResolvedCrewRow, patch: CrewPatch) => void
  onAddCrew: () => void
  onRemoveCrew: (row: ResolvedCrewRow) => void
  onPatchClient: (patch: Partial<CallSheetClient>) => void
  onAddContact: () => void
  onPatchContact: (id: string, patch: Partial<CallSheetContact>) => void
  onRemoveContact: (contact: CallSheetContact) => void
}

const cell = `${inputClass} h-7 text-xs`

/** Godzina wpisywana tekstem; zapis po wyjściu z pola albo Enter. Puste = ogólna zbiórka. */
export function MinutesField({
  value,
  placeholder,
  label,
  onCommit,
  className = '',
}: {
  value: number | undefined
  placeholder: string
  label: string
  onCommit: (minutes: number | undefined) => void
  className?: string
}) {
  const [text, setText] = useState(value !== undefined ? minutesToHHMM(value) : '')
  useEffect(() => {
    setText(value !== undefined ? minutesToHHMM(value) : '')
  }, [value])
  const commit = () => {
    if (!text.trim()) {
      onCommit(undefined)
      return
    }
    const parsed = hhmmToMinutes(text)
    if (parsed === null) setText(value !== undefined ? minutesToHHMM(value) : '')
    else onCommit(parsed)
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      placeholder={placeholder}
      aria-label={label}
      inputMode="numeric"
      className={`${className} tabular-nums`}
      style={{ fontFamily: 'var(--font-jetbrains-mono)' }}
    />
  )
}

function CrewRow({
  row,
  generalCall,
  onPatch,
  onRemove,
}: {
  row: ResolvedCrewRow
  generalCall: number | null
  onPatch: (patch: CrewPatch) => void
  onRemove: () => void
}) {
  const [noteOpen, setNoteOpen] = useState(!!row.entry?.note)
  const who = row.value.name || row.value.role || 'osoba'
  const hints: string[] = []
  if (!row.extra && row.personId && !row.base.phone) hints.push('brak telefonu w bazie Ekipa')
  if (!row.extra && !row.personId && row.base.name) hints.push('spoza bazy Ekipa — bez kontaktu z bazy')
  if (!row.extra && !row.base.name) hints.push('do obsadzenia w Realizacji')

  return (
    <li className={`rounded-lg px-2 py-1.5 ${row.hidden ? 'opacity-45' : ''} ${row.extra ? 'bg-sky-400/[0.04]' : 'bg-white/[0.02]'}`}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1.2fr_1fr_1fr_1.3fr_4.5rem_auto] sm:items-center">
        <input
          value={row.entry?.name ?? ''}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder={row.base.name || (row.extra ? 'Imię i nazwisko' : 'do obsadzenia')}
          aria-label={`Imię: ${who}`}
          className={cell}
        />
        <input
          value={row.entry?.role ?? ''}
          onChange={(e) => onPatch({ role: e.target.value })}
          placeholder={row.base.role || 'Rola'}
          aria-label={`Rola: ${who}`}
          className={cell}
        />
        <input
          value={row.entry?.phone ?? ''}
          onChange={(e) => onPatch({ phone: e.target.value })}
          placeholder={row.base.phone || 'Telefon'}
          aria-label={`Telefon: ${who}`}
          inputMode="tel"
          className={cell}
        />
        <input
          value={row.entry?.email ?? ''}
          onChange={(e) => onPatch({ email: e.target.value })}
          placeholder={row.base.email || 'E-mail'}
          aria-label={`E-mail: ${who}`}
          inputMode="email"
          className={cell}
        />
        <MinutesField
          value={row.entry?.callTime}
          placeholder={generalCall !== null ? minutesToHHMM(generalCall) : 'GG:MM'}
          label={`Zbiórka: ${who}`}
          onCommit={(callTime) => onPatch({ callTime })}
          className={`${cell} text-center`}
        />
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className={`${iconButton} ${row.entry?.note ? 'text-zinc-200' : ''}`}
            aria-label={`Uwaga: ${who}`}
            aria-expanded={noteOpen}
            title={'Uwaga przy osobie (np. „przywozi lampy")'}
          >
            <StickyNote className="size-3.5" />
          </button>
          {row.extra ? (
            <button type="button" onClick={onRemove} className={`${iconButton} hover:text-red-300`} aria-label={`Usuń ${who} z call sheetu`}>
              <Trash2 className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onPatch({ hidden: !row.hidden })}
              className={iconButton}
              aria-pressed={row.hidden}
              aria-label={row.hidden ? `Pokaż ${who} na call sheecie` : `Ukryj ${who} na call sheecie`}
              title={row.hidden ? 'Ukryta na call sheecie — kliknij, żeby pokazać' : 'Ukryj na call sheecie (np. nie ma jej na planie)'}
            >
              {row.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          )}
        </div>
      </div>
      {noteOpen && (
        <input
          value={row.entry?.note ?? ''}
          onChange={(e) => onPatch({ note: e.target.value })}
          placeholder="Uwaga przy osobie, trafi na call sheet"
          aria-label={`Treść uwagi: ${who}`}
          className={`${cell} mt-1.5`}
        />
      )}
      {(hints.length > 0 || row.extra || row.hidden) && (
        <p className="mt-1 text-[10.5px] text-zinc-500">
          {row.extra && <span className="text-sky-300/80">tylko na call sheecie</span>}
          {row.hidden && <span>ukryta na wydruku</span>}
          {hints.length > 0 && <span className="text-amber-200/70">{(row.extra || row.hidden ? ' · ' : '') + hints.join(' · ')}</span>}
        </p>
      )}
    </li>
  )
}

export function CallSheetPeople({
  sheet,
  onPatchCrew,
  onAddCrew,
  onRemoveCrew,
  onPatchClient,
  onAddContact,
  onPatchContact,
  onRemoveContact,
}: CallSheetPeopleProps) {
  const client = sheet.client
  return (
    <div className="space-y-5">
      <div>
        <SectionTitle
          aside={
            <button type="button" onClick={onAddCrew} className={smallButton}>
              <Plus className="size-3.5" />
              Osoba tylko na call sheecie
            </button>
          }
        >
          Ekipa dnia
        </SectionTitle>
        {sheet.crew.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-zinc-500">
            Ten dzień nie ma jeszcze ekipy. Dodaj osoby w Realizacji („+ Osoba") — pojawią się tu z telefonami z bazy Ekipa.
          </p>
        ) : (
          <ul className="space-y-1">
            {sheet.crew.map((row) => (
              <CrewRow
                key={row.key}
                row={row}
                generalCall={sheet.callTime}
                onPatch={(patch) => onPatchCrew(row, patch)}
                onRemove={() => onRemoveCrew(row)}
              />
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Szare wartości są z Realizacji i bazy Ekipa. Wpisz, żeby poprawić tylko na tym call sheecie; wyczyść, żeby wrócić do bazy.
        </p>
      </div>

      <div>
        <SectionTitle
          aside={
            <button type="button" onClick={onAddContact} className={smallButton}>
              <Plus className="size-3.5" />
              Kontakt (lokacja, catering…)
            </button>
          }
        >
          Kontakty
        </SectionTitle>
        <ul className="space-y-1">
          <li className={`rounded-lg bg-white/[0.02] px-2 py-1.5 ${client.hidden ? 'opacity-45' : ''}`}>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1.2fr_1fr_1fr_1.3fr_4.5rem_auto] sm:items-center">
              <span className="truncate px-1 text-xs font-semibold text-zinc-300" title={client.client}>
                Klient{client.client ? ` · ${client.client}` : ''}
              </span>
              <input
                value={client.raw?.name ?? ''}
                onChange={(e) => onPatchClient({ name: e.target.value })}
                placeholder={client.base.name || 'Osoba'}
                aria-label="Osoba kontaktowa klienta"
                className={cell}
              />
              <input
                value={client.raw?.phone ?? ''}
                onChange={(e) => onPatchClient({ phone: e.target.value })}
                placeholder={client.base.phone || 'Telefon'}
                aria-label="Telefon klienta"
                inputMode="tel"
                className={cell}
              />
              <input
                value={client.raw?.email ?? ''}
                onChange={(e) => onPatchClient({ email: e.target.value })}
                placeholder={client.base.email || 'E-mail'}
                aria-label="E-mail klienta"
                inputMode="email"
                className={cell}
              />
              <span className="hidden sm:block" />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onPatchClient({ hidden: !client.hidden })}
                  className={iconButton}
                  aria-pressed={client.hidden}
                  aria-label={client.hidden ? 'Pokaż klienta na call sheecie' : 'Ukryj klienta na call sheecie'}
                >
                  {client.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </div>
          </li>
          {sheet.contacts.map((contact) => (
            <li key={contact.id} className="rounded-lg bg-white/[0.02] px-2 py-1.5">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1.2fr_1fr_1fr_1.3fr_4.5rem_auto] sm:items-center">
                <input
                  value={contact.label ?? ''}
                  onChange={(e) => onPatchContact(contact.id, { label: e.target.value })}
                  placeholder="Kto (Lokacja, Catering)"
                  aria-label="Kto to dla dnia"
                  className={cell}
                />
                <input
                  value={contact.name ?? ''}
                  onChange={(e) => onPatchContact(contact.id, { name: e.target.value })}
                  placeholder="Osoba"
                  aria-label="Osoba"
                  className={cell}
                />
                <input
                  value={contact.phone ?? ''}
                  onChange={(e) => onPatchContact(contact.id, { phone: e.target.value })}
                  placeholder="Telefon"
                  aria-label="Telefon"
                  inputMode="tel"
                  className={cell}
                />
                <input
                  value={contact.email ?? ''}
                  onChange={(e) => onPatchContact(contact.id, { email: e.target.value })}
                  placeholder="E-mail"
                  aria-label="E-mail"
                  inputMode="email"
                  className={cell}
                />
                <span className="hidden sm:block" />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onRemoveContact(contact)}
                    className={`${iconButton} hover:text-red-300`}
                    aria-label={`Usuń kontakt ${contact.label || contact.name || ''}`.trim()}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

