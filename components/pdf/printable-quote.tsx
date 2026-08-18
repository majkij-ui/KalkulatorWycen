'use client'

import React from 'react'
import type { LocalPdfState, PdfRowKey } from '@/lib/quote-types'
import { useQuote } from '@/lib/quote-context'
import { PDF_LABELS, type PdfLang } from '@/lib/pdf-i18n'
import { formatPdfAmount } from '@/lib/pdf-currency'

const VAT_RATE = 0.23

// ── Nonoise Media brand tokens (from the brand book) ─────────────────────────
// Ink + white dominate; Ember is the accent (~8%); Mist/gradient used sparingly as detail.
const BRAND = {
  ink: '#09090B',
  ember: '#EC5A29',
  emberDeep: '#D8431F',
}
// Archivo for headings/text, JetBrains Mono for data/metrics/labels (with graceful fallbacks).
const FONT_SANS = 'var(--font-archivo, var(--font-inter, Inter), sans-serif)'
const FONT_MONO = 'var(--font-jetbrains-mono, ui-monospace, monospace)'
const mono = { fontFamily: FONT_MONO }

/** Brand section eyebrow: mono uppercase Ember label, optionally preceded by a short lead-rule. */
function Eyebrow({ children, rule = false }: { children: React.ReactNode; rule?: boolean }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      {rule && <span className="h-px w-4 shrink-0" style={{ backgroundColor: BRAND.ember }} aria-hidden />}
      <span className="text-[7pt] font-semibold uppercase tracking-[0.14em]" style={{ ...mono, color: BRAND.emberDeep }}>
        {children}
      </span>
    </div>
  )
}

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
      className="printable-quote w-[210mm] bg-white px-8 pb-8 pt-4 text-[9.5pt] text-zinc-900 select-text print:m-0 print:px-8 print:pb-8 print:pt-4"
      style={{ fontFamily: FONT_SANS, userSelect: 'text' }}
    >
      {/* Ink header bar — orb logo, centered uppercase title (brand „czarny pasek nagłówka") */}
      <div
        className="w-full text-white flex items-center justify-between px-7 py-3.5 rounded-xl"
        style={{ backgroundColor: BRAND.ink }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="NonoiseMedia" className="h-9 w-9 rounded-full object-cover" />
        <div className="flex-1 text-center">
          <div className="text-[15px] font-bold tracking-[0.16em]">{documentTitle}</div>
        </div>
        <div className="w-9" aria-hidden />
      </div>

      {/* Metadata — mono uppercase labels, values all in the base font / size */}
      <div className="mt-3 mb-3 grid grid-cols-2 gap-8 text-[9pt] leading-snug">
        {/* Wykonawca / Contractor */}
        <div className="min-w-0 space-y-0.5">
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.contractor}: </span>
            <span className="font-semibold text-zinc-900">{companyName}</span>
          </div>
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.producer}: </span>
            <span className="text-zinc-900">{producerName}</span>
          </div>
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.email}: </span>
            <span className="break-words" style={{ color: BRAND.emberDeep }}>{contactEmail}</span>
          </div>
        </div>

        {/* Metadata right */}
        <div className="min-w-0 space-y-0.5 text-right">
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.client}: </span>
            <span className="break-words font-semibold text-zinc-900">{clientName}</span>
          </div>
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.project}: </span>
            <span className="break-words text-zinc-900">{projectName}</span>
          </div>
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.issueDate}: </span>
            <span className="text-zinc-900">{currentDate}</span>{' '}
            <span className="text-zinc-500">({L.validityNote})</span>
          </div>
          <div>
            <span className="text-[7pt] uppercase tracking-[0.12em] text-zinc-500" style={mono}>{L.shootingDate}: </span>
            <span className="text-zinc-900">{terminZdjec}</span>
          </div>
        </div>
      </div>

      <section>
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                <th className="bg-zinc-50 text-zinc-500 uppercase text-[7pt] font-semibold tracking-[0.12em] py-1.5 px-3 text-left w-1/4" style={mono}>
                  {L.tableCategory}
                </th>
                <th className="bg-zinc-50 text-zinc-500 uppercase text-[7pt] font-semibold tracking-[0.12em] py-1.5 px-3 text-right w-1/6 whitespace-nowrap" style={mono}>
                  {L.tableEstimateNetto}
                </th>
                <th className="bg-zinc-50 text-zinc-500 uppercase text-[7pt] font-semibold tracking-[0.12em] py-1.5 px-3 text-left w-7/12" style={mono}>
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
                    <td className="border-t border-zinc-200 py-1.5 px-3 font-bold w-1/4 align-top">
                      {rowTitleForLang(key, lang)}
                    </td>
                    <td className="border-t border-zinc-200 py-1.5 px-3 w-1/6 text-right align-top whitespace-nowrap">
                      <div className="text-[9.5pt] font-bold" style={mono}>{fmt(nettoValue)}</div>
                    </td>
                    <td className="border-t border-zinc-200 py-1.5 px-3 w-7/12 text-zinc-600 leading-snug align-top whitespace-pre-wrap">
                      {row?.opis?.trim() ? row.opis.trim() : L.emptyDash}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Total bar — Ink, rounded, Ember amount */}
        <div
          data-pdf-break="after"
          className="mt-2.5 rounded-xl px-5 py-2.5 text-white break-inside-avoid"
          style={{ backgroundColor: BRAND.ink }}
        >
          {showVat ? (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between text-[12pt] font-black uppercase tracking-tight">
                <span>{L.sumNetto}</span>
                <span style={{ ...mono, color: BRAND.ember }}>{fmt(totalNetto)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between text-[8pt] font-semibold uppercase tracking-[0.1em]">
                <span className="text-zinc-300">{L.vatRow}</span>
                <span className="text-zinc-100" style={mono}>{fmt(totalVat)}</span>
              </div>
              <div className="flex items-baseline justify-between text-[8pt] font-semibold uppercase tracking-[0.1em]">
                <span className="text-zinc-300">{L.sumBrutto}</span>
                <span className="text-zinc-100" style={mono}>{fmt(totalBrutto)}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="text-[9pt] font-bold uppercase tracking-[0.1em]">{L.totalProject}</span>
              <span className="text-[12pt] font-black" style={{ ...mono, color: BRAND.ember }}>{fmt(totalNetto)}</span>
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2.5">
          <div data-pdf-break="after" className="border border-zinc-200 rounded-lg p-2.5 break-inside-avoid">
            <Eyebrow>{L.finalMaterials}</Eyebrow>
            <div className="text-[9pt] text-zinc-700 whitespace-pre-wrap leading-snug">
              {localPdfState.materialyKoncowe?.trim() ? localPdfState.materialyKoncowe.trim() : L.emptyDash}
            </div>
          </div>

          <div data-pdf-break="after" className="border border-zinc-200 rounded-lg p-2.5 break-inside-avoid">
            <Eyebrow>{L.additionalOptions}</Eyebrow>
            <div className="text-[9pt] text-zinc-700 whitespace-pre-wrap leading-snug">
              {localPdfState.opcjeDodatkowe?.trim() ? localPdfState.opcjeDodatkowe.trim() : L.emptyDash}
            </div>
          </div>

          {/* Portfolio: right after additional options */}
          <div data-pdf-break="after" className="border border-zinc-200 rounded-lg p-2.5 break-inside-avoid">
            <Eyebrow>{L.portfolio}</Eyebrow>
            {portfolioItems.length > 0 ? (
              <ul className="space-y-0.5 text-[8pt] text-zinc-700">
                {portfolioItems.map((it, i) => {
                  const href = it.url.startsWith('http') ? it.url : `https://${it.url}`
                  return (
                    <li key={`${i}-${it.url || it.description.slice(0, 16)}`} className="break-words">
                      {it.url && (
                        <a href={href} style={{ ...mono, color: BRAND.emberDeep }}>
                          {it.url}
                        </a>
                      )}
                      {it.url && it.description && <span className="text-zinc-500"> — </span>}
                      {it.description && <span className="text-zinc-600">{it.description}</span>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="text-[8pt] text-zinc-700">{L.emptyDash}</div>
            )}
          </div>

          {/* Uwagi / Notes at the bottom */}
          <div data-pdf-break="after" className="mt-0 break-inside-avoid">
            <Eyebrow rule>{L.notes}</Eyebrow>
            {adjustedTerms?.length ? (
              <div className="columns-2 gap-6 text-[8pt] text-zinc-700 leading-relaxed">
                {adjustedTerms.map((t, i) => (
                  <div key={`${i}-${t.slice(0, 20)}`} className="break-inside-avoid mb-1.5">
                    <span className="font-semibold" style={{ color: BRAND.emberDeep }}>{i + 1}.</span> {t}
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
