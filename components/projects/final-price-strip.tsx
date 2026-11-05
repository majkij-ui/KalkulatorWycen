'use client'

/**
 * Pasek nad wyceną projektu z ceną końcową (decyzja M.J. 2026-11-05):
 * „Wycena X · Cena końcowa (faktura 3/03/2026 | import) Y · różnica Z".
 * Nic nie blokuje — przelicza się przy każdej zmianie wyceny. „Ustaw cenę z
 * wyceny" pyta najpierw (okno z źródłem, kwotą i numerami faktur); dopiero
 * potwierdzenie zapisuje cenę jako ręczne nadpisanie.
 */

import { useMemo, useState } from 'react'
import { useEvents } from '@/lib/events-context'
import { finalPrice, finalPriceStrip, overrideFinalPrice, quotePriceRecord } from '@/lib/final-price'
import { toDateKey, type Project } from '@/lib/project-types'
import { approvedPrice } from '@/lib/quote-financials'
import { useQuote } from '@/lib/quote-context'
import { mono, pln } from '@/components/calendar/calendar-bits'
import { signedPln } from '@/components/realization/realization-totals'
import { FinalPriceDialog } from '@/components/project-finance/final-price-dialog'

export function FinalPriceStripBar({ project }: { project: Project }) {
  const { allEvents } = useEvents()
  const { data, pricingConfig, marginMultiplier, pdfDraft, updateField } = useQuote()
  const [confirm, setConfirm] = useState<number | null>(null)
  const today = toDateKey(new Date())

  const final = useMemo(() => {
    // Projekt z importem, któremu wycena jeszcze się nie zapisała: cena z importu jest już ceną końcową.
    const imported = !project.quote && project.financials && project.financials.sumaNetto > 0 ? project.financials.sumaNetto : null
    const record = quotePriceRecord({ data }) ?? (imported !== null ? { pln: imported, source: 'import' as const, at: '' } : null)
    return finalPrice(project, record, allEvents, today)
  }, [project, data, allEvents, today])
  const quotePln = useMemo(() => approvedPrice(data, pricingConfig, marginMultiplier, pdfDraft).pln, [data, pricingConfig, marginMultiplier, pdfDraft])
  if (!final) return null

  const strip = finalPriceStrip(quotePln, final)
  const same = Math.abs(strip.diff) < 0.5
  return (
    <>
      <div
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300"
        role="status"
        aria-label="Cena końcowa projektu"
        data-testid="final-price-strip"
      >
        <span>
          Wycena <b className="text-white" style={mono}>{pln(strip.quotePln)}</b>
        </span>
        <span aria-hidden className="text-zinc-600">·</span>
        <span>
          Cena końcowa ({strip.label}) <b className="text-white" style={mono}>{pln(strip.finalPln)}</b>
        </span>
        <span aria-hidden className="text-zinc-600">·</span>
        <span className={same ? 'text-emerald-300/90' : 'text-amber-200/90'} style={mono}>
          {same ? 'bez różnicy' : `różnica ${signedPln(strip.diff)}`}
        </span>
        {!same && strip.quotePln > 0 && (
          <button
            type="button"
            onClick={() => setConfirm(strip.quotePln)}
            className="ml-auto rounded-md border border-white/10 px-2 py-1 font-medium text-zinc-100 hover:bg-white/5"
          >
            Ustaw cenę z wyceny
          </button>
        )}
        <span className="basis-full text-[11px] text-zinc-500">Edycja wyceny nie zmienia ceny końcowej.</span>
      </div>
      <FinalPriceDialog
        final={final}
        newPln={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={(next) => {
          setConfirm(null)
          const record = quotePriceRecord(overrideFinalPrice({ data: {} }, next, new Date().toISOString()))
          if (record) updateField('approvedPrice', record)
        }}
      />
    </>
  )
}
