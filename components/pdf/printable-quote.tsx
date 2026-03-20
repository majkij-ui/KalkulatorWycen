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

  const clientName = localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : '—'
  const projectName = localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : '—'
  const terminZdjec = localPdfState.validUntilIso || '—'
  const currentDate = localPdfState.issueDateIso || '—'

  const terms = localPdfState.termsAndConditions ?? []
  const adjustedTerms = !showVat
    ? terms.map((t) =>
        t.includes('Podane kwoty są kwotami netto.')
          ? 'Sprzedaż na fakturze bez VAT, kwoty netto są równe kwotom brutto.'
          : t
      )
    : terms

  return (
    <div
      className="printable-quote w-[210mm] bg-white p-8 text-[9.5pt] text-zinc-900 font-sans break-inside-avoid print:m-0 print:p-8"
      style={{ fontFamily: 'var(--font-inter, Inter)' }}
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
      <div className="mt-6 mb-6 grid grid-cols-2 gap-20 text-[9pt]">
        <div className="text-zinc-900">
          <span className="font-bold">Wykonawca:</span> Michał Jagniątkowski | Nonoise Media | contact@nonoise.media
        </div>
        <div className="text-right space-y-1.5 text-zinc-900">
          <div>
            <span className="font-bold">Klient:</span> {clientName}
          </div>
          <div>
            <span className="font-bold">Projekt:</span> {projectName}
          </div>
          <div>
            <span className="font-bold">Data:</span> {currentDate}
          </div>
          <div>
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
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-right w-1/6">
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
              const displayValue = valueForDisplay(row?.cenaNetto ?? 0, showVat)
              return (
                <tr key={key}>
                  <td className="border-b border-zinc-200 py-2 px-3 font-bold w-1/4 align-top">
                    {row?.title ?? '—'}
                  </td>
                  <td className="border-b border-zinc-200 py-2 px-3 w-1/6 text-right align-top tabular-nums whitespace-nowrap">
                    {formatCurrency(displayValue)}
                  </td>
                  <td className="border-b border-zinc-200 py-2 px-3 w-7/12 text-zinc-600 leading-relaxed align-top whitespace-pre-wrap">
                    {row?.opis?.trim() ? row.opis.trim() : '—'}
                  </td>
                </tr>
              )
            })}

            <tr className="bg-zinc-900 text-white">
              <td colSpan={2} className="p-3 font-bold text-left text-[8pt] uppercase tracking-tight">
                CAŁKOWITY KOSZT PROJEKTU (NETTO)
              </td>
              <td className="p-3 text-right font-extrabold text-[11pt] text-primary tabular-nums">
                {formatCurrency(totalDisplay)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-6 grid gap-4">
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

          <div className="mt-0">
            <div className="text-[8pt] font-bold text-zinc-700 mb-2">Portfolio</div>
            {portfolioLinks.length > 0 ? (
              <ul className="space-y-1 text-[8pt] text-zinc-700">
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
              <div className="text-[8pt] text-zinc-700">—</div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

