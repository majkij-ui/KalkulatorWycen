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
  const totalVat = totalNetto * VAT_RATE
  const totalBrutto = totalNetto + totalVat

  const portfolioLinks = localPdfState.portfolioLinksText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const clientName = localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : '—'
  const projectName = localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : '—'
  const terminZdjec = localPdfState.terminZdjec?.trim() ? localPdfState.terminZdjec.trim() : '—'
  const currentDate = localPdfState.issueDateIso || '—'

  const terms = localPdfState.termsAndConditions ?? []
  const NETTO_DISCLAIMER = 'Podane kwoty są kwotami netto.'
  const adjustedTerms = showVat
    ? terms.filter((t) => !t.includes(NETTO_DISCLAIMER))
    : terms.map((t) => (t.includes(NETTO_DISCLAIMER) ? 'Sprzedaż na fakturze bez VAT, kwoty netto są równe kwotom brutto.' : t))

  return (
    <div
      className="printable-quote w-[210mm] bg-white px-8 pb-8 pt-4 text-[9.5pt] text-zinc-900 font-sans break-inside-avoid select-text print:m-0 print:px-8 print:pb-8 print:pt-4"
      style={{ fontFamily: 'var(--font-inter, Inter)', userSelect: 'text' }}
    >
      {/* Black header bar */}
      <div className="w-full bg-zinc-950 text-white flex items-center justify-between px-8 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="NonoiseMedia" className="h-10 w-10 rounded-md object-cover" />
        <div className="flex-1 text-center">
          <div className="text-[16px] font-bold tracking-widest">WYCENA PRODUKCJI WIDEO</div>
        </div>
        <div className="w-10" aria-hidden />
      </div>

      {/* Metadata */}
      <div className="mt-4 mb-4 grid grid-cols-2 gap-8 text-[9pt]">
        {/* Wykonawca: 3 linie */}
        <div className="text-zinc-900 leading-tight min-w-0">
          <div>
            <span className="font-bold">Wykonawca:</span> Nonoise Media
          </div>
          <div>
            <span className="font-bold">Producent:</span> Michał Jagniątkowski
          </div>
          <div>
            <span className="font-bold">email:</span> contact@nonoise.media
          </div>
        </div>

        {/* Metadata right: 3 linie */}
        <div className="text-right leading-tight text-zinc-900 min-w-0">
          <div>
            <span className="font-bold">Klient:</span>{' '}
            <span className="break-words">{clientName}</span>
          </div>
          <div className="mt-1">
            <span className="font-bold">Projekt:</span>{' '}
            <span className="break-words">{projectName}</span>
          </div>
          <div className="mt-1">
            <span className="font-bold">Data sporządzenia:</span> {currentDate}{' '}
            <span className="text-zinc-600">(Termin ważności: 30 dni)</span>
          </div>
          <div className="mt-1">
            <span className="font-bold">Termin zdjęć:</span> {terminZdjec}
          </div>
        </div>
      </div>

      <section>
        <table className="w-full border-collapse text-[9pt]">
          <thead>
            <tr>
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-left w-1/4">
                KATEGORIA
              </th>
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-right w-1/6 whitespace-nowrap">
                SZACUNKOWO (NETTO)
              </th>
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-left w-7/12">
                OPIS
              </th>
            </tr>
          </thead>

          <tbody>
            {ROW_ORDER.map((key) => {
              const row = localPdfState.rows[key]
              const nettoValue = row?.cenaNetto ?? 0
              const bruttoValue = nettoValue + nettoValue * VAT_RATE
              return (
                <tr key={key}>
                  <td className="border-b border-zinc-200 py-2 px-3 font-bold w-1/4 align-top">
                    {row?.title ?? '—'}
                  </td>
                  <td className="border-b border-zinc-200 py-2 px-3 w-1/6 text-right align-top tabular-nums whitespace-nowrap">
                    <div className="text-[9.5pt] font-bold">{formatCurrency(nettoValue)}</div>
                  </td>
                  <td className="border-b border-zinc-200 py-2 px-3 w-7/12 text-zinc-600 leading-relaxed align-top whitespace-pre-wrap">
                    {row?.opis?.trim() ? row.opis.trim() : '—'}
                  </td>
                </tr>
              )
            })}

            <tr className="bg-zinc-900 text-white">
              <td colSpan={3} className="p-3">
                {showVat ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                      <span className="text-zinc-200">Suma Netto</span>
                      <span className="tabular-nums text-zinc-100">{formatCurrency(totalNetto)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                      <span className="text-zinc-200">VAT (23%)</span>
                      <span className="tabular-nums text-zinc-100">{formatCurrency(totalVat)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-[12pt] font-black tracking-tight">
                      <span>SUMA BRUTTO</span>
                      <span className="text-primary tabular-nums">{formatCurrency(totalBrutto)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between text-[9pt] font-bold uppercase tracking-tight">
                    <span>CAŁKOWITY KOSZT PROJEKTU</span>
                    <span className="text-primary tabular-nums text-[11pt] font-extrabold">{formatCurrency(totalNetto)}</span>
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 grid gap-4">
          <div className="border border-zinc-200 rounded-md p-3">
            <div className="text-[8pt] font-bold text-zinc-700">Materiały Końcowe</div>
            <div className="mt-1.5 text-[9pt] text-zinc-600 whitespace-pre-wrap leading-relaxed">
              {localPdfState.materialyKoncowe?.trim() ? localPdfState.materialyKoncowe.trim() : '—'}
            </div>
          </div>

          <div className="border border-zinc-200 rounded-md p-3">
            <div className="text-[8pt] font-bold text-zinc-700">Opcje Dodatkowe</div>
            <div className="mt-1.5 text-[9pt] text-zinc-600 whitespace-pre-wrap leading-relaxed">
              {localPdfState.opcjeDodatkowe?.trim() ? localPdfState.opcjeDodatkowe.trim() : '—'}
            </div>
          </div>

          {/* Portfolio relocation: right after Opcje Dodatkowe */}
          <div className="border border-zinc-200 rounded-md p-3">
            <div className="text-[8pt] font-bold text-zinc-700">Przykładowe realizacje</div>
            {portfolioLinks.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-[8pt] text-zinc-700">
                {portfolioLinks.map((l) => {
                  const href = l.startsWith('http') ? l : `https://${l}`
                  return (
                    <li key={l} className="break-words">
                      <a href={href} className="text-primary">
                        {l}
                      </a>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="mt-1.5 text-[8pt] text-zinc-700">—</div>
            )}
          </div>

          {/* Uwagi at the bottom */}
          <div className="mt-0">
            <div className="text-[8pt] font-bold text-zinc-700 mb-1.5">Uwagi</div>
            {adjustedTerms?.length ? (
              <div className="columns-2 gap-6 text-[8pt] text-zinc-700 leading-relaxed">
                {adjustedTerms.map((t, i) => (
                  <div key={`${i}-${t.slice(0, 20)}`} className="break-inside-avoid mb-1.5">
                    {i + 1}. {t}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[8pt] text-zinc-700">—</div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

