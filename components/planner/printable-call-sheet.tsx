'use client'

/**
 * Arkusz A4 call sheetu (biały, do PDF) — następca szwajcarskiej tabeli z
 * `print-call-sheet.ts` CallSheetWiz, w barwach marki jak PDF oferty
 * (`printable-quote.tsx`): czarny pasek z logo, etykiety JetBrains Mono,
 * akcent Ember. Kolejność: dzień i miejsce → kontakty → ekipa →
 * harmonogram z kratkami → lista pakowania → uwagi.
 *
 * `data-pdf-break="after"` = bezpieczne miejsca cięcia strony (wiersze i końce
 * sekcji, nigdy zaraz po nagłówku); `data-pdf-href` = klikalny telefon/e-mail.
 */

import type { ReactNode } from 'react'
import type { ResolvedCallSheet } from '@/lib/call-sheet'
import { tagStyle } from '@/lib/schedule-types'
import { formatDuration, minutesToHHMM } from '@/lib/time'
import { mailHref, telHref } from '@/lib/pdf-pages'
import { equipmentCategoryLabel } from '@/lib/project-types'

const BRAND = { ink: '#09090B', ember: '#EC5A29', emberDeep: '#D8431F' }
const FONT_SANS = 'var(--font-archivo, var(--font-inter, Inter), sans-serif)'
const FONT_MONO = 'var(--font-jetbrains-mono, ui-monospace, monospace)'
const mono = { fontFamily: FONT_MONO }

export interface PrintableCallSheetProps {
  sheet: ResolvedCallSheet
  /** „Zdjęciowy" / „Przygotowań". */
  dayKind: string
  /** Produkcja z tekstów PDF (firma, producent, e-mail). */
  production: { company: string; producer: string; email: string }
  /** Kiedy wygenerowano (stopka). */
  generatedAt: string
}

/** „wtorek, 28 października 2026" z klucza `YYYY-MM-DD` (w południe — bez przeskoku doby). */
export function longDateFromKey(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return ''
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="h-px w-4 shrink-0" style={{ backgroundColor: BRAND.ember }} aria-hidden />
      <span className="text-[7pt] font-semibold uppercase tracking-[0.14em]" style={{ ...mono, color: BRAND.emberDeep }}>
        {children}
      </span>
    </div>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[6.5pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>
        {label}
      </div>
      <div className="mt-0.5 break-words text-[10pt] font-semibold text-zinc-900">{children}</div>
    </div>
  )
}

function Phone({ value }: { value: string }) {
  if (!value) return <span className="text-zinc-400">—</span>
  const href = telHref(value)
  return (
    <span data-pdf-href={href ?? undefined} style={mono}>
      {value}
    </span>
  )
}

function Email({ value }: { value: string }) {
  if (!value) return <span className="text-zinc-400">—</span>
  const href = mailHref(value)
  return (
    <span data-pdf-href={href ?? undefined} className="break-all" style={{ color: href ? BRAND.emberDeep : undefined }}>
      {value}
    </span>
  )
}

const box = <span className="mt-[2px] inline-block size-[9px] shrink-0 rounded-[1px] border border-zinc-500" aria-hidden />

export function PrintableCallSheet({ sheet, dayKind, production, generatedAt }: PrintableCallSheetProps) {
  const crew = sheet.crew.filter((r) => !r.hidden)
  const date = longDateFromKey(sheet.date)
  const categoryById = new Map(sheet.categories.map((c) => [c.id, c]))
  const contacts = [
    ...(production.producer || production.email
      ? [{ key: 'prod', label: 'Produkcja', who: [production.producer, production.company].filter(Boolean).join(' · '), phone: '', email: production.email }]
      : []),
    ...(!sheet.client.hidden && (sheet.client.value.name || sheet.client.value.phone || sheet.client.value.email || sheet.client.client)
      ? [
          {
            key: 'client',
            label: sheet.client.client ? `Klient · ${sheet.client.client}` : 'Klient',
            who: sheet.client.value.name,
            phone: sheet.client.value.phone,
            email: sheet.client.value.email,
          },
        ]
      : []),
    ...sheet.contacts.map((c) => ({
      key: c.id,
      label: c.label?.trim() || 'Kontakt',
      who: [c.name?.trim(), c.note?.trim()].filter(Boolean).join(' · '),
      phone: c.phone?.trim() ?? '',
      email: c.email?.trim() ?? '',
    })),
  ]
  const hasPacking = sheet.packing.length > 0 || sheet.gearExtra.length > 0

  return (
    <div
      className="w-[210mm] bg-white px-8 pb-8 pt-4 text-[9pt] leading-snug text-zinc-900"
      style={{ fontFamily: FONT_SANS }}
    >
      <div data-pdf-break="after">
        <div className="flex w-full items-center justify-between rounded-xl px-7 py-3" style={{ backgroundColor: BRAND.ink }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="NonoiseMedia" className="h-9 w-9 rounded-full object-cover" />
          <div className="flex-1 text-center text-[15px] font-bold tracking-[0.2em] text-white">CALL SHEET</div>
          <div className="w-9" aria-hidden />
        </div>

        <div className="mt-3 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[17pt] font-bold leading-tight">{sheet.title}</div>
            <div className="mt-0.5 text-[10pt] text-zinc-600">
              {sheet.dayLabel}
              {dayKind ? ` · dzień ${dayKind.toLowerCase()}` : ''}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[6.5pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>
              Zbiórka
            </div>
            <div className="text-[22pt] font-bold leading-none" style={{ ...mono, color: BRAND.emberDeep }}>
              {sheet.callTime !== null ? minutesToHHMM(sheet.callTime) : '—'}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-x-6 gap-y-2 border-y border-zinc-200 py-2.5">
          <Meta label="Data">{date || 'bez daty'}</Meta>
          <Meta label="Miejsce">{sheet.location.value || '—'}</Meta>
          <Meta label="Koniec dnia (plan)">
            <span style={mono}>{sheet.wrapTime !== null ? minutesToHHMM(sheet.wrapTime) : '—'}</span>
          </Meta>
          {sheet.locationNotes && (
            <div className="col-span-3 whitespace-pre-wrap text-[8.5pt] text-zinc-600">{sheet.locationNotes}</div>
          )}
        </div>
      </div>

      {contacts.length > 0 && (
        <section className="mt-4">
          <Eyebrow>Kontakty</Eyebrow>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            {contacts.map((c, i) => (
              <div
                key={c.key}
                data-pdf-break="after"
                className={`grid grid-cols-[22%_1fr_19%_27%] gap-x-3 px-3 py-1.5 ${i > 0 ? 'border-t border-zinc-200' : ''}`}
              >
                <span className="font-semibold">{c.label}</span>
                <span className="min-w-0 break-words">{c.who || '—'}</span>
                <Phone value={c.phone} />
                <Email value={c.email} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-4">
        <Eyebrow>Ekipa</Eyebrow>
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <div
            className="grid grid-cols-[22%_24%_19%_1fr_12%] gap-x-3 bg-zinc-50 px-3 py-1.5 text-[6.5pt] font-semibold uppercase tracking-[0.12em] text-zinc-500"
            style={mono}
          >
            <span>Rola</span>
            <span>Imię i nazwisko</span>
            <span>Telefon</span>
            <span>E-mail</span>
            <span className="text-right">Zbiórka</span>
          </div>
          {crew.length === 0 && (
            <div data-pdf-break="after" className="border-t border-zinc-200 px-3 py-2 text-zinc-500">
              Ekipa nie jest jeszcze wpisana.
            </div>
          )}
          {crew.map((row) => (
            <div
              key={row.key}
              data-pdf-break="after"
              className="grid grid-cols-[22%_24%_19%_1fr_12%] gap-x-3 border-t border-zinc-200 px-3 py-1.5"
            >
              <span className="min-w-0 break-words text-zinc-600">{row.value.role || '—'}</span>
              <span className="min-w-0 break-words font-semibold">
                {row.value.name || <span className="font-normal italic text-zinc-400">do obsadzenia</span>}
                {row.note && <span className="block text-[8pt] font-normal text-zinc-500">{row.note}</span>}
              </span>
              <Phone value={row.value.phone} />
              <Email value={row.value.email} />
              <span className={`text-right ${row.ownCallTime ? 'font-bold' : ''}`} style={{ ...mono, color: row.ownCallTime ? BRAND.emberDeep : undefined }}>
                {row.callTime !== null ? minutesToHHMM(row.callTime) : '—'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-4">
        <Eyebrow>Harmonogram</Eyebrow>
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <div
            className="grid grid-cols-[19%_11%_1fr_15%_7%] gap-x-3 bg-zinc-50 px-3 py-1.5 text-[6.5pt] font-semibold uppercase tracking-[0.12em] text-zinc-500"
            style={mono}
          >
            <span>Godzina</span>
            <span>Czas</span>
            <span>Co</span>
            <span>Dział</span>
            <span className="text-center">✓</span>
          </div>
          {sheet.schedule.length === 0 && (
            <div data-pdf-break="after" className="border-t border-zinc-200 px-3 py-2 text-zinc-500">
              Harmonogram jest pusty.
            </div>
          )}
          {sheet.schedule.map((event, i) => {
            const tag = tagStyle(categoryById.get(event.categoryId))
            return (
              <div
                key={event.id}
                data-pdf-break="after"
                className="grid grid-cols-[19%_11%_1fr_15%_7%] gap-x-3 border-t border-zinc-200 px-3 py-1.5"
                style={{ backgroundColor: i % 2 ? '#fafafa' : '#ffffff' }}
              >
                <span className="text-[10pt] font-bold" style={mono}>
                  {minutesToHHMM(event.startMinutes)}–{minutesToHHMM(event.endMinutes)}
                </span>
                <span className="text-zinc-600" style={mono}>
                  {formatDuration(event.startMinutes, event.endMinutes)}
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-[9.5pt] font-semibold">{event.title}</span>
                  {event.notes && <span className="block whitespace-pre-wrap text-[8.5pt] text-zinc-600">{event.notes}</span>}
                  {(event.subItems ?? []).length > 0 && (
                    <span className="mt-1 flex flex-col gap-0.5">
                      {(event.subItems ?? []).map((sub) => (
                        <span key={sub.id} className="flex items-start gap-1.5 text-[8.5pt] text-zinc-700">
                          {box}
                          <span>{sub.text}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="flex items-start">
                  <span
                    className="rounded-[2px] border-l-[3px] px-1 text-[7pt] font-semibold uppercase tracking-[0.04em] text-zinc-700"
                    style={{ borderColor: tag.tile.edge, backgroundColor: '#f4f4f5' }}
                  >
                    {tag.label}
                  </span>
                </span>
                <span className="flex justify-center pt-0.5">
                  <span className="inline-block size-[12px] rounded-[2px] border border-zinc-600" aria-hidden />
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {hasPacking && (
        <section className="mt-4">
          <Eyebrow>Sprzęt — lista pakowania</Eyebrow>
          <div className="rounded-lg border border-zinc-200 px-3 py-2">
            {sheet.packing.map((group) => (
              <div key={group.category} className="mb-1.5">
                <div className="text-[6.5pt] font-semibold uppercase tracking-[0.12em] text-zinc-500" style={mono}>
                  {equipmentCategoryLabel(group.category)}
                </div>
                <div className="grid grid-cols-2 gap-x-6">
                  {group.items.map(({ item, qty }) => (
                    <div key={item.id} data-pdf-break="after" className="flex items-start gap-1.5 py-[1px]">
                      {box}
                      <span>
                        {qty > 1 ? `${qty}× ` : ''}
                        {item.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {sheet.gearExtra.length > 0 && (
              <div className="mb-1.5">
                <div className="text-[6.5pt] font-semibold uppercase tracking-[0.12em] text-zinc-500" style={mono}>
                  Dodatkowo
                </div>
                <div className="grid grid-cols-2 gap-x-6">
                  {sheet.gearExtra.map((g) => (
                    <div key={g.id} data-pdf-break="after" className="flex items-start gap-1.5 py-[1px]">
                      {box}
                      <span>{g.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {sheet.notes && (
        <section className="mt-4" data-pdf-break="after">
          <Eyebrow>Uwagi</Eyebrow>
          <div className="whitespace-pre-wrap rounded-lg border border-zinc-200 px-3 py-2">{sheet.notes}</div>
        </section>
      )}

      <div data-pdf-break="after" className="mt-4 flex justify-between text-[7pt] text-zinc-400" style={mono}>
        <span>{production.company || 'NonoiseMedia'}</span>
        <span>{generatedAt}</span>
      </div>
    </div>
  )
}
