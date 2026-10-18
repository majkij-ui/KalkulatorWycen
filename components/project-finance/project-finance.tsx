'use client'

/**
 * Zakładka „Finanse" projektu (R2, plan §13.1 C1–C4): zatwierdzona cena z PDF,
 * kwota finalnego przelewu, zysk netto (marża), ryczałt, koszty, marża
 * producencka i plan a Realizacja wg kategorii. Liczby: `lib/project-finance.ts`
 * (ta sama pętla pieniędzy co Finanse firmy); tu tylko układ i pola.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { useEvents } from '@/lib/events-context'
import { createEvent } from '@/lib/events-store'
import { parseAmount } from '@/lib/event-draft'
import { formatRate } from '@/lib/quote-currency'
import { useProjectHub } from '@/lib/project-hub-context'
import { useQuote } from '@/lib/quote-context'
import { costCategoryLabel, countsTowardRevenue, toDateKey, type Project } from '@/lib/project-types'
import { gapAsExtraSale, projectFinanceView, revenueSourceText } from '@/lib/project-finance'
import { archivo, mono, pln } from '@/components/calendar/calendar-bits'

function pct(value: number | null): string {
  if (value === null) return '—'
  return `${value.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

function signedPln(value: number): string {
  const rounded = Math.sign(value) * Math.round(Math.abs(value))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${pln(Math.abs(rounded))}`
}

function eur(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} €`
}

function dateText(day: string): string {
  const [y, m, d] = day.split('-')
  return d ? `${d}.${m}.${y}` : day
}

const fieldClass =
  'h-9 w-36 rounded-md border border-white/10 bg-black/40 px-2 text-right text-base tabular-nums text-zinc-100 outline-none focus:border-white/30'

/** Pole kwoty po polsku; `null` w danych = pole pokazuje wartość domyślną. */
function TransferInput({ value, onCommit, label }: { value: number; onCommit: (value: number) => void; label: string }) {
  const format = (n: number) => (Math.round(n * 100) / 100).toLocaleString('pl-PL', { maximumFractionDigits: 2, useGrouping: false })
  const [text, setText] = useState(() => format(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(format(value))
  }, [value])
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={text}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false
        const parsed = parseAmount(text)
        if (parsed === undefined || Math.abs(parsed - value) < 0.005) setText(format(value))
        else onCommit(parsed)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={fieldClass}
      style={mono}
    />
  )
}

function Row({ label, value, strong = false, muted = false, children }: { label: React.ReactNode; value: string; strong?: boolean; muted?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? 'border-t border-white/10 pt-2' : ''}`}>
      <span className={`min-w-0 ${muted ? 'text-zinc-500' : 'text-zinc-300'} ${strong ? 'font-semibold text-white' : ''}`}>
        {label}
        {children}
      </span>
      <span className={`shrink-0 tabular-nums ${strong ? 'font-semibold text-white' : muted ? 'text-zinc-500' : 'text-zinc-200'}`} style={mono}>
        {value}
      </span>
    </div>
  )
}

export function ProjectFinance({ project }: { project: Project }) {
  const { allEvents, save: saveEvent, remove: removeEvent } = useEvents()
  const { data, pricingConfig, marginMultiplier, pdfDraft, updateField, variantLabel } = useQuote()
  const { projects } = useProjectHub()
  const latest = projects.find((p) => p.id === project.id) ?? project
  const today = toDateKey(new Date())
  const live = useMemo(() => ({ data, pricingConfig, marginMultiplier, pdfDraft }), [data, pricingConfig, marginMultiplier, pdfDraft])
  const view = useMemo(() => projectFinanceView(latest, live, allEvents, today), [latest, live, allEvents, today])
  const [notice, setNotice] = useState<{ message: string; undo?: () => void | Promise<void> } | null>(null)
  const [showCategories, setShowCategories] = useState(false)

  const { money, approved, transfer, plan } = view
  const counts = countsTowardRevenue(latest.status)
  const revenue = money.revenue
  const extra = gapAsExtraSale(transfer)

  const saveGap = async () => {
    if (!extra) return
    const typedBefore = transfer?.typed ?? null
    const event = createEvent({ kind: 'extra_sale', start: today, projectId: project.id, data: { what: extra.what, amountNetto: extra.amountNetto } })
    await saveEvent(event)
    updateField('profitTransferAmount', null)
    setNotice({
      message: `Zapisano dosprzedaż ${pln(extra.amountNetto)} na osi projektu; kwota przelewu liczy się teraz z ceny i dosprzedaży (bez zmiany).`,
      undo: async () => {
        await removeEvent(event.id)
        updateField('profitTransferAmount', typedBefore)
      },
    })
  }

  const statusNote =
    latest.status === 'lost'
      ? 'Projekt nieprzyjęty — te liczby nie wchodzą do Finansów firmy.'
      : latest.status === 'quote'
        ? 'Wycena — do Finansów firmy wejdzie po akceptacji (W realizacji).'
        : null

  const costsText =
    money.costsBasis === 'actual'
      ? 'z Realizacji'
      : money.costsNote === 'partial'
        ? `z planu (w Realizacji ${pln((money.actualCosts ?? 0) + (money.actualOwnWork ?? 0))} z ${pln(plan.costs + plan.ownWork)})`
        : money.costsBasis === 'plan'
          ? 'z planu'
          : 'brak kosztów'

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight text-white" style={archivo}>
          Finanse projektu
        </h2>
        <p className="max-w-2xl text-xs text-zinc-500">
          Cena to PDF{variantLabel ? ` (wariant ${variantLabel})` : ''}, przychód to przelew z dosprzedażą, a gdy są faktury —
          faktury. Koszty z Realizacji, a dopóki jej nie ma — z planu.
          {statusNote ? ` ${statusNote}` : ''}
        </p>
      </header>

      {notice && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300" role="status">
          <span className="min-w-0 flex-1">{notice.message}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={async () => {
                const undo = notice.undo
                setNotice(null)
                await undo?.()
              }}
              className="font-semibold text-primary hover:underline"
            >
              Cofnij
            </button>
          )}
          <button type="button" onClick={() => setNotice(null)} className="text-zinc-500 hover:text-zinc-200" aria-label="Zamknij komunikat">
            ×
          </button>
        </div>
      )}

      {/* C1 — cena i przelew */}
      <section aria-label="Cena i przelew" className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-5">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Zatwierdzona cena</div>
        {approved ? (
          <>
            <div className="mt-1 text-4xl font-bold text-white" style={mono}>
              {pln(approved.pln)}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {approved.source === 'pdf' ? 'Suma netto z PDF' : 'Z kalkulatora — PDF jeszcze nie edytowany'}
              {approved.currency === 'EUR' && approved.rate
                ? ` · ${eur(approved.amount)} × kurs ${formatRate(approved.rate)}`
                : ''}
              {approved.source === 'pdf' && Math.abs(approved.pln - approved.calculatorPln) >= 0.5
                ? ` · kalkulator ${pln(approved.calculatorPln)} (różnica to normalne — liczy się PDF)`
                : ''}
            </p>
          </>
        ) : (
          <>
            <div className="mt-1 text-4xl font-bold text-white" style={mono}>
              {view.imported === null ? '—' : pln(view.imported)}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Projekt bez wyceny — przychód z importu.</p>
          </>
        )}

        {transfer && (
          <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-zinc-300">Kwota finalnego przelewu</span>
              <TransferInput
                value={transfer.shown}
                label="Kwota finalnego przelewu (zł netto)"
                onCommit={(next) => updateField('profitTransferAmount', Math.abs(next - transfer.expected) < 0.005 ? null : next)}
              />
              <span className="text-xs text-zinc-500">zł netto</span>
              {transfer.typed !== null && (
                <button
                  type="button"
                  onClick={() => updateField('profitTransferAmount', null)}
                  title={`Z ceny i dosprzedaży: ${pln(transfer.expected)}`}
                  aria-label="Kwota z ceny i dosprzedaży"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  <RotateCcw className="size-3.5" />
                  z ceny
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {transfer.typed === null
                ? `= zatwierdzona cena${view.extrasTotal > 0 ? ` + dosprzedaż ${pln(view.extrasTotal)}` : ''}. Wpisz inną kwotę, jeśli przelew się różni.`
                : `Wpisana ręcznie. Cena${view.extrasTotal > 0 ? ' z dosprzedażą' : ''}: ${pln(transfer.expected)}.`}
            </p>
            {transfer.gap !== null && transfer.gap > 0 && extra && (
              <button
                type="button"
                onClick={() => void saveGap()}
                className="inline-flex h-8 items-center rounded-md border border-white/10 px-2.5 text-xs font-medium text-zinc-200 hover:bg-white/5"
              >
                Zapisz różnicę jako dosprzedaż (+{pln(extra.amountNetto)})
              </button>
            )}
            {transfer.gap !== null && transfer.gap < 0 && (
              <p className="text-xs text-amber-200/80">
                O {pln(-transfer.gap)} mniej niż cena{view.extrasTotal > 0 ? ' z dosprzedażą' : ''} — liczy się wpisana kwota.
              </p>
            )}
          </div>
        )}

        {view.extras.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-xs text-zinc-400">
            {view.extras.map((x, i) => (
              <li key={`${x.day}-${i}`}>
                Dosprzedaż {dateText(x.day)}: {x.what || 'bez opisu'} — {x.amount === null ? 'bez kwoty' : pln(x.amount)}
              </li>
            ))}
          </ul>
        )}
        {money.invoiced !== null && (
          <p className="mt-3 text-xs text-zinc-400">
            Faktury: {pln(money.invoiced)}
            {money.revenueBasis === 'invoices' ? ' — w Finansach liczą się faktury.' : ` z ${pln(money.expected ?? 0)} — dopóki projekt trwa, liczy się kwota przelewu.`}
          </p>
        )}
      </section>

      {/* C2 + C4 — wynik */}
      <section aria-label="Wynik projektu" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
          <div className="text-[11px] text-zinc-500">Zysk netto (marża)</div>
          <div className={`mt-0.5 text-2xl font-semibold ${money.profit !== null && money.profit < 0 ? 'text-red-300' : 'text-emerald-300'}`} style={mono}>
            {money.profit === null ? '—' : pln(money.profit)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{pct(money.marginPct)} przychodu · po kosztach zewnętrznych i ryczałcie</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
          <div className="text-[11px] text-zinc-500">Marża producencka</div>
          <div className={`mt-0.5 text-2xl font-semibold ${money.producerMargin !== null && money.producerMargin < 0 ? 'text-red-300' : 'text-white'}`} style={mono}>
            {money.producerMargin === null ? '—' : pln(money.producerMargin)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {pct(money.producerMarginPct)} przychodu ·{' '}
            {money.ownWork > 0 ? `bez Twojej pracy (${pln(money.ownWork)})` : 'nic nie oznaczono jako „Moja praca"'}
          </div>
        </div>
      </section>

      <section aria-label="Rozliczenie" className="rounded-xl border border-white/5 bg-zinc-900/20 px-4 py-3 text-sm">
        <Row label={<>Przychód <span className="text-xs text-zinc-500">({revenueSourceText(view)})</span></>} value={revenue === null ? '—' : pln(revenue)} />
        <Row label="" value={revenue === null ? '' : `−${pln(money.tax)}`}>
          <span className="inline-flex items-center gap-1.5">
            Ryczałt
            {view.hasQuote ? (
              <TaxInput value={data.profitTaxRatePercent} onCommit={(rate) => updateField('profitTaxRatePercent', rate)} />
            ) : (
              <span className="text-zinc-500">{pct(money.taxRatePercent)}</span>
            )}
          </span>
        </Row>
        <Row label={<>Koszty zewnętrzne <span className="text-xs text-zinc-500">({costsText})</span></>} value={money.costs === null ? '—' : `−${pln(money.costs)}`} />
        <Row label="Zysk netto (marża)" value={money.profit === null ? '—' : pln(money.profit)} strong />
        <Row label="Moja praca (po koszcie z wyceny / Realizacji)" value={`−${pln(money.ownWork)}`} muted />
        <Row label="Marża producencka" value={money.producerMargin === null ? '—' : pln(money.producerMargin)} strong />
        {!counts && <p className="pt-2 text-[11px] text-zinc-500">{statusNote}</p>}
      </section>

      {/* C3 — plan a Realizacja */}
      {view.actual && (view.categories.length > 0 || plan.ownWork > 0 || view.actual.ownWork > 0) && (
        <section aria-label="Plan a Realizacja">
          <button
            type="button"
            onClick={() => setShowCategories((v) => !v)}
            aria-expanded={showCategories}
            className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-zinc-100"
          >
            <ChevronDown className={`size-3.5 transition-transform ${showCategories ? 'rotate-180' : ''}`} />
            Plan a Realizacja wg kategorii
          </button>
          {showCategories && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full max-w-xl text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-500">
                    <th className="py-1 font-normal">Kategoria</th>
                    <th className="py-1 text-right font-normal">Plan</th>
                    <th className="py-1 text-right font-normal">Realizacja</th>
                    <th className="py-1 text-right font-normal">Różnica</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...view.categories.map((r) => ({ key: r.category, label: costCategoryLabel(r.category), plan: r.plan, actual: r.actual })),
                    ...(plan.ownWork > 0 || view.actual.ownWork > 0
                      ? [{ key: 'own', label: 'Moja praca', plan: plan.source === 'quote' ? plan.ownWork : null, actual: view.actual.ownWork }]
                      : []),
                  ].map((row) => {
                    const diff = row.plan === null ? null : row.actual - row.plan
                    return (
                      <tr key={row.key} className="border-t border-white/5">
                        <td className="py-1.5 text-zinc-300">{row.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-500">{row.plan === null ? '—' : pln(row.plan)}</td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-200">{pln(row.actual)}</td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-400">{diff === null ? '—' : signedPln(diff)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function TaxInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value).replace('.', ','))
  useEffect(() => setText(String(value).replace('.', ',')), [value])
  return (
    <>
      <input
        inputMode="decimal"
        aria-label="Stawka ryczałtu (%)"
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseAmount(text)
          if (n === undefined || n > 100) setText(String(value).replace('.', ','))
          else if (n !== value) onCommit(n)
        }}
        className="h-7 w-14 rounded-md border border-white/10 bg-black/40 px-1.5 text-right text-sm tabular-nums text-zinc-100 outline-none focus:border-white/30"
      />
      <span className="text-zinc-500">%</span>
    </>
  )
}
