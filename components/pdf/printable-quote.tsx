'use client'

import React from 'react'
import { formatCurrency } from '@/lib/quote-calc'
import type { LocalPdfState, PdfRowKey } from '@/lib/quote-types'

const VAT_RATE = 0.23

const ROW_ORDER: PdfRowKey[] = ['preprodukcja', 'ekipa', 'sprzet', 'logistyka', 'postprodukcja', 'inne']

function valueForDisplay(cenaNetto: number, showVat: boolean): number {
  return showVat ? cenaNetto * (1 + VAT_RATE) : cenaNetto
}

export function PrintableQuote({ localPdfState }: { localPdfState: LocalPdfState }) {
  const { showVat } = localPdfState

  const totalNetto = ROW_ORDER.reduce((sum, key) => sum + (localPdfState.rows[key]?.cenaNetto ?? 0), 0)
  const totalDisplay = valueForDisplay(totalNetto, showVat)

  const portfolioLinks = localPdfState.portfolioLinksText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return (
    <div
      className="printable-quote w-[210mm] bg-white text-zinc-900 px-8 py-6 break-inside-avoid"
      style={{ fontFamily: 'var(--font-inter, Inter)' }}
    >
      <header className="flex items-start justify-between gap-6 border-b border-zinc-200 pb-3 mb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="NonoiseMedia" className="h-11 w-auto" />
          <div className="leading-tight">
            <div className="text-[12px] font-bold text-zinc-900">NonoiseMedia</div>
            <div className="text-[9.5px] text-zinc-500">Kalkulator wyceny wideo</div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[11px] font-black uppercase tracking-wide text-primary">
            Oferta współpracy
          </div>
          <div className="mt-2 text-[9.5px] text-zinc-600">
            Data sporządzenia: {localPdfState.issueDateIso}
          </div>
          <div className="text-[9.5px] text-zinc-600">
            Termin ważności: 30 dni (do {localPdfState.validUntilIso})
          </div>
          <div className="text-[9.5px] text-zinc-700 font-semibold">
            Klient / Projekt: {localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : '—'}
          </div>
        </div>
      </header>

      <section className="mb-4">
        <table className="w-full border border-zinc-200 rounded-lg overflow-hidden text-[10px]">
          <thead>
            <tr className="bg-primary/10">
              <th className="text-left px-3 py-2 border-b border-primary text-primary font-extrabold w-[32%]">Kategoria</th>
              <th className="text-right px-3 py-2 border-b border-primary text-primary font-extrabold w-[18%]">
                Szacunkowo {showVat ? '(brutto)' : '(netto)'}
              </th>
              <th className="text-left px-3 py-2 border-b border-primary text-primary font-extrabold">Opis</th>
            </tr>
          </thead>
          <tbody>
            {ROW_ORDER.map((key) => {
              const row = localPdfState.rows[key]
              const displayValue = valueForDisplay(row?.cenaNetto ?? 0, showVat)
              return (
                <tr key={key} className="border-b border-zinc-200 break-inside-avoid last:border-b-0">
                  <td className="px-3 py-2 font-semibold text-zinc-900 align-top">{row?.title ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap align-top">
                    {formatCurrency(displayValue)}
                  </td>
                  <td className="px-3 py-2 whitespace-pre-wrap leading-snug text-zinc-800 align-top">
                    {row?.opis?.trim() ? row.opis.trim() : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="mt-3 pt-3 border-t border-zinc-200 flex items-baseline justify-between">
          <div className="text-[11px] font-bold text-zinc-900">
            Całkowity koszt {showVat ? 'brutto' : 'netto'}
          </div>
          <div className="text-[15px] font-black text-primary tabular-nums">{formatCurrency(totalDisplay)}</div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="border border-zinc-200 rounded-lg p-2">
          <div className="text-[9.5px] font-extrabold uppercase tracking-wide text-primary mb-1">
            Materiały końcowe
          </div>
          <div className="text-[10px] text-zinc-800 whitespace-pre-wrap leading-snug">
            {localPdfState.materialyKoncowe?.trim() ? localPdfState.materialyKoncowe.trim() : '—'}
          </div>
        </div>

        <div className="border border-zinc-200 rounded-lg p-2">
          <div className="text-[9.5px] font-extrabold uppercase tracking-wide text-primary mb-1">
            Opcje dodatkowe
          </div>
          <div className="text-[10px] text-zinc-800 whitespace-pre-wrap leading-snug">
            {localPdfState.opcjeDodatkowe?.trim() ? localPdfState.opcjeDodatkowe.trim() : '—'}
          </div>
        </div>

        <div className="border border-zinc-200 rounded-lg p-2">
          <div className="text-[9.5px] font-extrabold uppercase tracking-wide text-primary mb-1">
            Linki do portfolio
          </div>
          {portfolioLinks.length > 0 ? (
            <ul className="list-disc list-inside text-[10px] text-zinc-800 space-y-0.5">
              {portfolioLinks.map((l, idx) => (
                <li key={`${l}-${idx}`} className="break-words">
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[10px] text-zinc-800">—</div>
          )}
        </div>

        <div className="mt-0.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-700 mb-2">
            Uwagi
          </div>
          {localPdfState.termsAndConditions?.length ? (
            <ol className="list-decimal list-inside text-[9.5px] text-zinc-700 space-y-1">
              {localPdfState.termsAndConditions.map((t, i) => (
                <li key={`${i}-${t.slice(0, 24)}`} className="leading-snug">
                  {t}
                </li>
              ))}
            </ol>
          ) : (
            <div className="text-[10px] text-zinc-700">—</div>
          )}
        </div>
      </section>
    </div>
  )
}

