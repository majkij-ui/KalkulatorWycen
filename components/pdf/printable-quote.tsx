'use client'

import React from 'react'
import type { LocalPdfState, PdfRowKey } from '@/lib/quote-types'
import { useQuote } from '@/lib/quote-context'
import { PDF_LABELS, type PdfLang } from '@/lib/pdf-i18n'
import { formatPdfAmount } from '@/lib/pdf-currency'

const VAT_RATE = 0.23

const ROW_ORDER: PdfRowKey[] = ['preprodukcja', 'ekipa', 'obsada', 'sprzet', 'logistyka', 'postprodukcja', 'inne']

function rowTitleForLang(key: PdfRowKey, lang: PdfLang): string {
  const L = PDF_LABELS[lang]
  switch (key) {
    case 'preprodukcja':
      return L.rowPreprodukcja
    case 'ekipa':
      return L.rowEkipa
    case 'obsada':
      return L.rowObsada
    case 'sprzet':
      return L.rowSprzet
    case 'logistyka':
      return L.rowLogistyka
    case 'postprodukcja':
      return L.rowPostprodukcja
    case 'inne':
      return L.rowInne
  }
}

export function PrintableQuote({ localPdfState }: { localPdfState: LocalPdfState }) {
  const { pdfTexts } = useQuote()
  const { showVat, pdfLanguage, currency } = localPdfState
  const lang: PdfLang = pdfLanguage ?? 'pl'
  const L = PDF_LABELS[lang]

  const fmt = (amount: number) => formatPdfAmount(amount, currency ?? 'PLN')

  const totalNetto = ROW_ORDER.reduce((sum, key) => sum + (localPdfState.rows[key]?.cenaNetto ?? 0), 0)
  const totalVat = totalNetto * VAT_RATE
  const totalBrutto = totalNetto + totalVat

  // Prefer structured portfolio rows; fall back to the legacy newline-separated
  // string for any old draft snapshot that hasn't been migrated yet.
  const portfolioItems: { url: string; description: string }[] = Array.isArray(localPdfState.portfolioRows)
    ? localPdfState.portfolioRows
        .map((r) => ({ url: (r?.url ?? '').trim(), description: (r?.description ?? '').trim() }))
        .filter((r) => r.url || r.description)
    : (localPdfState.portfolioLinksText ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((url) => ({ url, description: '' }))

  const clientName = localPdfState.clientName?.trim() ? localPdfState.clientName.trim() : L.emptyDash
  const projectName = localPdfState.projectName?.trim() ? localPdfState.projectName.trim() : L.emptyDash
  const terminZdjec = localPdfState.terminZdjec?.trim() ? localPdfState.terminZdjec.trim() : L.emptyDash
  const currentDate = localPdfState.issueDateIso || L.emptyDash

  // Pull the user-editable header strings for the active language
  const documentTitle = lang === 'en' ? pdfTexts.documentTitle_en : pdfTexts.documentTitle
  const companyName = lang === 'en' ? pdfTexts.companyName_en : pdfTexts.companyName
  const producerName = lang === 'en' ? pdfTexts.producerName_en : pdfTexts.producerName
  const contactEmail = lang === 'en' ? pdfTexts.contactEmail_en : pdfTexts.contactEmail

  // VAT/netto term swap. Detect the netto-disclaimer by its language-specific lead
  // substring (matches the default termNetto / termNetto_en).
  const terms = localPdfState.termsAndConditions ?? []
  const nettoLead = L.nettoDisclaimer
  const adjustedTerms = showVat
    ? terms.filter((t) => !t.includes(nettoLead))
    : terms.map((t) => (t.includes(nettoLead) ? L.nettoDisclaimerSwap : t))

  return (
    <div
      className="printable-quote w-[210mm] bg-white px-8 pb-8 pt-4 text-[9.5pt] text-zinc-900 font-sans select-text print:m-0 print:px-8 print:pb-8 print:pt-4"
      style={{ fontFamily: 'var(--font-inter, Inter)', userSelect: 'text' }}
    >
      {/* Black header bar */}
      <div className="w-full bg-zinc-950 text-white flex items-center justify-between px-8 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="NonoiseMedia" className="h-10 w-10 rounded-md object-cover" />
        <div className="flex-1 text-center">
          <div className="text-[16px] font-bold tracking-widest">{documentTitle}</div>
        </div>
        <div className="w-10" aria-hidden />
      </div>

      {/* Metadata */}
      <div className="mt-4 mb-4 grid grid-cols-2 gap-8 text-[9pt]">
        {/* Wykonawca / Contractor: 3 lines */}
        <div className="text-zinc-900 leading-tight min-w-0">
          <div>
            <span className="font-bold">{L.contractor}:</span> {companyName}
          </div>
          <div>
            <span className="font-bold">{L.producer}:</span> {producerName}
          </div>
          <div>
            <span className="font-bold">{L.email}:</span> {contactEmail}
          </div>
        </div>

        {/* Metadata right: 4 lines */}
        <div className="text-right leading-tight text-zinc-900 min-w-0">
          <div>
            <span className="font-bold">{L.client}:</span>{' '}
            <span className="break-words">{clientName}</span>
          </div>
          <div className="mt-1">
            <span className="font-bold">{L.project}:</span>{' '}
            <span className="break-words">{projectName}</span>
          </div>
          <div className="mt-1">
            <span className="font-bold">{L.issueDate}:</span> {currentDate}{' '}
            <span className="text-zinc-600">({L.validityNote})</span>
          </div>
          <div className="mt-1">
            <span className="font-bold">{L.shootingDate}:</span> {terminZdjec}
          </div>
        </div>
      </div>

      <section>
        <table className="w-full border-collapse text-[9pt]">
          <thead>
            <tr>
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-left w-1/4">
                {L.tableCategory}
              </th>
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-right w-1/6 whitespace-nowrap">
                {L.tableEstimateNetto}
              </th>
              <th className="bg-zinc-100 text-zinc-500 uppercase tracking-tight text-[8pt] font-bold py-2 px-3 text-left w-7/12">
                {L.tableDescription}
              </th>
            </tr>
          </thead>

          <tbody>
            {ROW_ORDER.map((key) => {
              const row = localPdfState.rows[key]
              const nettoValue = row?.cenaNetto ?? 0
              return (
                <tr key={key} data-pdf-break="after" className="break-inside-avoid">
                  <td className="border-b border-zinc-200 py-2 px-3 font-bold w-1/4 align-top">
                    {rowTitleForLang(key, lang)}
                  </td>
                  <td className="border-b border-zinc-200 py-2 px-3 w-1/6 text-right align-top tabular-nums whitespace-nowrap">
                    <div className="text-[9.5pt] font-bold">{fmt(nettoValue)}</div>
                  </td>
                  <td className="border-b border-zinc-200 py-2 px-3 w-7/12 text-zinc-600 leading-relaxed align-top whitespace-pre-wrap">
                    {row?.opis?.trim() ? row.opis.trim() : L.emptyDash}
                  </td>
                </tr>
              )
            })}

            <tr data-pdf-break="after" className="bg-zinc-900 text-white break-inside-avoid">
              <td colSpan={3} className="p-3">
                {showVat ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                      <span className="text-zinc-200">{L.sumNetto}</span>
                      <span className="tabular-nums text-zinc-100">{fmt(totalNetto)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-[8pt] font-bold uppercase tracking-tight">
                      <span className="text-zinc-200">{L.vatRow}</span>
                      <span className="tabular-nums text-zinc-100">{fmt(totalVat)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-[12pt] font-black tracking-tight">
                      <span>{L.sumBrutto}</span>
                      <span className="text-primary tabular-nums">{fmt(totalBrutto)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between text-[9pt] font-bold uppercase tracking-tight">
                    <span>{L.totalProject}</span>
                    <span className="text-primary tabular-nums text-[11pt] font-extrabold">{fmt(totalNetto)}</span>
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 grid gap-4">
          <div data-pdf-break="after" className="border border-zinc-200 rounded-md p-3 break-inside-avoid">
            <div className="text-[8pt] font-bold text-zinc-700">{L.finalMaterials}</div>
            <div className="mt-1.5 text-[9pt] text-zinc-600 whitespace-pre-wrap leading-relaxed">
              {localPdfState.materialyKoncowe?.trim() ? localPdfState.materialyKoncowe.trim() : L.emptyDash}
            </div>
          </div>

          <div data-pdf-break="after" className="border border-zinc-200 rounded-md p-3 break-inside-avoid">
            <div className="text-[8pt] font-bold text-zinc-700">{L.additionalOptions}</div>
            <div className="mt-1.5 text-[9pt] text-zinc-600 whitespace-pre-wrap leading-relaxed">
              {localPdfState.opcjeDodatkowe?.trim() ? localPdfState.opcjeDodatkowe.trim() : L.emptyDash}
            </div>
          </div>

          {/* Portfolio: right after additional options */}
          <div data-pdf-break="after" className="border border-zinc-200 rounded-md p-3 break-inside-avoid">
            <div className="text-[8pt] font-bold text-zinc-700">{L.portfolio}</div>
            {portfolioItems.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-[8pt] text-zinc-700">
                {portfolioItems.map((it, i) => {
                  const href = it.url.startsWith('http') ? it.url : `https://${it.url}`
                  return (
                    <li key={`${i}-${it.url || it.description.slice(0, 16)}`} className="break-words">
                      {it.url && (
                        <a href={href} className="text-primary">
                          {it.url}
                        </a>
                      )}
                      {it.url && it.description && <span className="text-zinc-600"> — </span>}
                      {it.description && <span className="text-zinc-600">{it.description}</span>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="mt-1.5 text-[8pt] text-zinc-700">{L.emptyDash}</div>
            )}
          </div>

          {/* Uwagi / Notes at the bottom */}
          <div data-pdf-break="after" className="mt-0 break-inside-avoid">
            <div className="text-[8pt] font-bold text-zinc-700 mb-1.5">{L.notes}</div>
            {adjustedTerms?.length ? (
              <div className="columns-2 gap-6 text-[8pt] text-zinc-700 leading-relaxed">
                {adjustedTerms.map((t, i) => (
                  <div key={`${i}-${t.slice(0, 20)}`} className="break-inside-avoid mb-1.5">
                    {i + 1}. {t}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[8pt] text-zinc-700">{L.emptyDash}</div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
