'use client'

/**
 * Zakładka „Finanse" projektu (R2, plan §13.1 C1–C4; U1, plan §18 U-CENA i
 * U-DOSPRZEDAŻ): zatwierdzona cena (zamrożona przy przyjęciu, „PDF: X zł ·
 * Odśwież", wpisywana ręcznie), dosprzedaż z kategorią i fazą, „Do zapłaty",
 * „Wpłynęło na konto", zysk netto (marża), ryczałt, koszty, marża producencka i
 * plan a Realizacja wg kategorii. Liczby: `lib/project-finance.ts` (ta sama pętla
 * pieniędzy co Finanse firmy); tu tylko układ i pola.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Pencil, RotateCcw } from 'lucide-react'
import { useEvents } from '@/lib/events-context'
import { createEvent } from '@/lib/events-store'
import { parseAmount } from '@/lib/event-draft'
import { editedExtraSaleData, extraSaleCategories, extraSaleData } from '@/lib/extra-sales'
import { formatRate } from '@/lib/quote-currency'
import { useProjectHub, useQuoteDocState } from '@/lib/project-hub-context'
import { useQuote } from '@/lib/quote-context'
import { costCategoryLabel, countsTowardRevenue, toDateKey, type Project } from '@/lib/project-types'
import { gapAsExtraSale, projectFinanceView, refreshedPrice, revenueSourceText, typedPrice, type PaymentRow } from '@/lib/project-finance'
import type { ApprovedPriceRecord } from '@/lib/quote-types'
import type { ExtraSale } from '@/lib/money-loop'
import { archivo, mono, pln } from '@/components/calendar/calendar-bits'
import { ExtraSalesSection, type ExtraSaleInput } from './extra-sales'
import { PaymentsSection } from './payments'

function pct(value: number | null): string {
  if (value === null) return '—'
  return `${value.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

function signedPln(value: number): string {
  const rounded = Math.sign(value) * Math.round(Math.abs(value))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${pln(Math.abs(rounded))}`
}

/** Odliczenie w rozliczeniu: „−1 234 zł", a zero bez znaku. */
function minus(amount: number): string {
  return Math.abs(amount) < 0.5 ? pln(0) : `−${pln(amount)}`
}

function eur(amount: number): string {
  return `${Math.round(amount).toLocaleString('pl-PL', { useGrouping: 'always' })} €`
}

function dateText(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d ? `${d}.${m}.${y}` : iso
}

const fieldClass =
  'h-10 w-44 rounded-md border border-white/15 bg-black/40 px-2 text-right text-2xl font-bold tabular-nums text-zinc-100 outline-none focus:border-white/40'

/** Pole ceny: Enter / wyjście zatwierdza, Escape anuluje. */
function PriceInput({ value, onCommit, onCancel }: { value: number; onCommit: (value: number) => void; onCancel: () => void }) {
  const format = (n: number) => (Math.round(n * 100) / 100).toLocaleString('pl-PL', { maximumFractionDigits: 2, useGrouping: false })
  const [text, setText] = useState(() => format(value))
  const done = useRef(false)
  const commit = () => {
    if (done.current) return
    done.current = true
    const parsed = parseAmount(text)
    if (parsed === undefined || Math.abs(parsed - value) < 0.005) onCancel()
    else onCommit(parsed)
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      aria-label="Zatwierdzona cena (zł netto)"
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          done.current = true
          onCancel()
        }
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

type Notice = { message: string; undo?: () => void | Promise<void> }

export function ProjectFinance({ project, viewedVariant }: { project: Project; viewedVariant?: { label: string; chosenLabel: string } | null }) {
  const { allEvents, save: saveEvent, remove: removeEvent, restore: restoreEvent } = useEvents()
  const { data, pricingConfig, marginMultiplier, pdfDraft, updateField, variantLabel } = useQuote()
  const { projects } = useProjectHub()
  const docState = useQuoteDocState(project.id)
  const latest = projects.find((p) => p.id === project.id) ?? project
  const today = toDateKey(new Date())
  const live = useMemo(() => ({ data, pricingConfig, marginMultiplier, pdfDraft }), [data, pricingConfig, marginMultiplier, pdfDraft])
  const view = useMemo(() => projectFinanceView(latest, live, allEvents, today), [latest, live, allEvents, today])
  const categories = useMemo(
    () => extraSaleCategories(allEvents.filter((e) => e.kind === 'extra_sale' && !e.deletedAt).map((e) => ({ category: typeof e.data?.category === 'string' ? e.data.category : undefined }))),
    [allEvents]
  )
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [editingPrice, setEditingPrice] = useState(false)

  const { money, price, transfer, plan, received } = view
  const counts = countsTowardRevenue(latest.status)
  const revenue = money.revenue
  const marginBeforeTaxPct = money.margin !== null && revenue !== null && revenue > 0 ? (money.margin / revenue) * 100 : null
  const pendingImport = docState?.status === 'needs-confirmation'
  const hasInvoices = money.invoices.some((i) => i.state !== 'planned')

  const setPrice = (next: ApprovedPriceRecord | null, message: string) => {
    const before = data.approvedPrice ?? null
    updateField('approvedPrice', next)
    setNotice({ message, undo: () => updateField('approvedPrice', before) })
  }

  const saveExtra = async (amountNetto: number, what: string, message: string, afterSave?: () => void, undoExtra?: () => void) => {
    const event = createEvent({ kind: 'extra_sale', start: today, projectId: project.id, data: { what, amountNetto } })
    await saveEvent(event)
    afterSave?.()
    setNotice({
      message,
      undo: async () => {
        await removeEvent(event.id)
        undoExtra?.()
      },
    })
  }

  const legacyGap = gapAsExtraSale(transfer?.gap)
  const paymentGap = gapAsExtraSale(received.gap)

  const addExtra = async (input: ExtraSaleInput) => {
    const event = createEvent({ kind: 'extra_sale', start: input.day, projectId: project.id, data: extraSaleData(input) })
    await saveEvent(event)
    setNotice({ message: `Dodano dosprzedaż ${pln(input.amountNetto)} na osi projektu.`, undo: () => removeEvent(event.id) })
  }
  const editExtra = async (id: string, input: ExtraSaleInput) => {
    const event = allEvents.find((e) => e.id === id)
    if (!event) return
    await saveEvent({ ...event, start: input.day, data: editedExtraSaleData(event.data, input), updatedAt: new Date().toISOString() })
    setNotice({ message: 'Zapisano dosprzedaż.', undo: () => saveEvent(event) })
  }
  const removeExtra = async (extra: ExtraSale) => {
    await removeEvent(extra.id)
    setNotice({ message: `Usunięto dosprzedaż ${extra.amount === null ? '' : pln(extra.amount)}.`, undo: () => restoreEvent(extra.id) })
  }
  const addPayment = async (amount: number, day: string) => {
    const event = createEvent({ kind: 'invoice_paid', start: day, projectId: project.id, data: { amount: Math.round(amount * 100) / 100 } })
    await saveEvent(event)
    setNotice({ message: `Zapisano wpłatę ${pln(amount)} z ${dateText(day)} na osi projektu.`, undo: () => removeEvent(event.id) })
  }
  const fillPayment = async (payment: PaymentRow, amount: number) => {
    const event = allEvents.find((e) => e.id === payment.id)
    if (!event) return
    await saveEvent({ ...event, data: { ...(event.data ?? {}), amount: Math.round(amount * 100) / 100 }, updatedAt: new Date().toISOString() })
    setNotice({ message: `Wpłata z ${dateText(payment.day)}: ${pln(amount)}.`, undo: () => saveEvent(event) })
  }

  const statusNote =
    latest.status === 'lost'
      ? 'Projekt nieprzyjęty — te liczby nie wchodzą do Finansów firmy.'
      : latest.status === 'quote'
        ? 'Wycena — do Finansów firmy wejdzie po akceptacji (W realizacji); wtedy cena się zatwierdzi.'
        : null

  const costsText =
    money.costsBasis === 'actual'
      ? 'z Realizacji'
      : money.costsNote === 'partial'
        ? `z planu — w Realizacji ${pln((money.actualCosts ?? 0) + (money.actualOwnWork ?? 0))} z ${pln(plan.costs + plan.ownWork)}`
        : money.costsBasis === 'plan'
          ? 'z planu'
          : 'brak kosztów'

  const record = price?.record ?? null
  const priceSource = !price
    ? null
    : price.state === 'typed'
      ? `Wpisana ręcznie ${dateText(record!.at)}`
      : price.state === 'frozen'
        ? `Zatwierdzona ${record!.at ? dateText(record!.at) : ''} ${record!.source === 'calculator' ? 'z kalkulatora' : 'z PDF'}`.replace('  ', ' ')
        : price.live.source === 'pdf'
          ? 'Suma netto z PDF — idzie za PDF, dopóki zlecenie nie jest przyjęte'
          : 'Z kalkulatora — PDF jeszcze nie edytowany'
  const priceEur =
    record?.currency === 'EUR' && record.amount !== undefined && record.rate
      ? ` · ${eur(record.amount)} × kurs ${formatRate(record.rate)}`
      : !record && price?.live.currency === 'EUR' && price.live.rate
        ? ` · ${eur(price.live.amount)} × kurs ${formatRate(price.live.rate)}`
        : ''

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight text-white" style={archivo}>
          Finanse projektu
        </h2>
        <p className="max-w-2xl text-xs text-zinc-500">
          Cena to PDF{variantLabel ? ` (wariant ${variantLabel})` : ''}, zatwierdzona przy przyjęciu zlecenia. Przychód to cena z dosprzedażą, a gdy
          są faktury albo wpłaty bez faktury — one. Koszty z Realizacji, a dopóki jej nie ma — z planu.
          {statusNote ? ` ${statusNote}` : ''}
        </p>
        {viewedVariant && (
          <p className="max-w-2xl text-xs text-amber-200/80">
            W Wycenie i PDF oglądasz wariant {viewedVariant.label} — Finanse liczą wariant {viewedVariant.chosenLabel}, wybrany do rozliczeń.
          </p>
        )}
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

      {/* Cena, dosprzedaż, do zapłaty, wpłaty */}
      <section aria-label="Cena i przelew" className="space-y-5 rounded-xl border border-white/10 bg-zinc-900/40 p-4 sm:p-5">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{counts || !price ? 'Zatwierdzona cena' : 'Cena (jeszcze nie zatwierdzona)'}</div>
          {price ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {editingPrice ? (
                  <PriceInput
                    value={price.pln}
                    onCancel={() => setEditingPrice(false)}
                    onCommit={(next) => {
                      setEditingPrice(false)
                      const at = new Date().toISOString()
                      setPrice(typedPrice(next, price.live, counts, at), `Cena: ${pln(next)}. Przychód i zysk liczą się od niej.`)
                    }}
                  />
                ) : (
                  <span className="text-4xl font-bold text-white" style={mono}>
                    {pln(price.pln)}
                  </span>
                )}
                {!editingPrice && (
                  <button
                    type="button"
                    onClick={() => setEditingPrice(true)}
                    aria-label="Wpisz cenę ręcznie"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
                  >
                    <Pencil className="size-3.5" />
                    Zmień
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {priceSource}
                {priceEur}
                {price.state === 'live' && price.live.source === 'pdf' && Math.abs(price.live.pln - price.live.calculatorPln) >= 0.5
                  ? ` · kalkulator ${pln(price.live.calculatorPln)} (różnica to normalne — liczy się PDF)`
                  : ''}
              </p>
              {price.pdfDiff !== null && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-amber-200/90">
                    {price.live.source === 'pdf' ? 'PDF' : 'Kalkulator'}: {pln(price.live.pln)} ({signedPln(price.pdfDiff)})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = refreshedPrice(price.live, counts, new Date().toISOString())
                      setPrice(next, `Cena odświeżona z ${price.live.source === 'pdf' ? 'PDF' : 'kalkulatora'}: ${pln(price.live.pln)}.`)
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 font-medium text-zinc-100 hover:bg-white/5"
                  >
                    <RotateCcw className="size-3.5" />
                    Odśwież
                  </button>
                </div>
              )}
              {!counts && price.state !== 'live' && price.pdfDiff === null && (
                <button
                  type="button"
                  onClick={() => setPrice(null, 'Cena znowu idzie za PDF.')}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  <RotateCcw className="size-3.5" />
                  Za PDF
                </button>
              )}
            </>
          ) : (
            <>
              <div className="mt-1 text-4xl font-bold text-white" style={mono}>
                {view.imported === null ? '—' : pln(view.imported)}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {pendingImport
                  ? 'Wycena czeka na decyzję w nagłówku („Zastąp" / „Cofnij zmiany") — do tego czasu liczy się kwota z importu, a zmiany w PDF nie są zapisane.'
                  : 'Projekt bez wyceny — przychód z importu (a gdy są faktury — z faktur).'}
              </p>
            </>
          )}
        </div>

        <ExtraSalesSection extras={view.extras} categories={categories} today={today} onAdd={addExtra} onEdit={editExtra} onRemove={removeExtra} />

        <div className="border-t border-white/5 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-zinc-300">Do zapłaty <span className="text-xs text-zinc-500">(cena + dosprzedaż)</span></span>
            <span className="text-xl font-semibold text-white" style={mono}>
              {view.due === null ? '—' : pln(view.due)}
            </span>
          </div>
          {transfer && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-400">
              <p>
                Kwota przelewu wpisana ręcznie (przed zmianą): <span className="font-semibold text-zinc-100" style={mono}>{pln(transfer.typed)}</span> — liczy
                się jako cały przelew
                {transfer.gap !== null && transfer.gap < 0 ? `, o ${pln(-transfer.gap)} mniej niż cena z dosprzedażą` : ''}.
              </p>
              <div className="flex flex-wrap gap-2">
                {legacyGap && (
                  <button
                    type="button"
                    onClick={() => {
                      const typedBefore = transfer.typed
                      void saveExtra(
                        legacyGap.amountNetto,
                        legacyGap.what,
                        `Zapisano dosprzedaż ${pln(legacyGap.amountNetto)} na osi projektu; kwota przelewu liczy się teraz z ceny i dosprzedaży (bez zmiany). Nadaj jej kategorię.`,
                        () => updateField('profitTransferAmount', null),
                        () => updateField('profitTransferAmount', typedBefore)
                      )
                    }}
                    className="inline-flex h-7 items-center rounded-md border border-white/10 px-2 font-medium text-zinc-200 hover:bg-white/5"
                  >
                    Zapisz różnicę jako dosprzedaż (+{pln(legacyGap.amountNetto)})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const typedBefore = transfer.typed
                    updateField('profitTransferAmount', null)
                    setNotice({
                      message: `Usunięto wpisaną kwotę przelewu; liczy się cena + dosprzedaż (${pln(transfer.expected)}).`,
                      undo: () => updateField('profitTransferAmount', typedBefore),
                    })
                  }}
                  className="inline-flex h-7 items-center rounded-md px-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  Usuń (liczy się {pln(transfer.expected)})
                </button>
              </div>
            </div>
          )}
        </div>

        <PaymentsSection
          received={received}
          baseLabel={transfer ? 'wpisana kwota przelewu' : 'cena + dosprzedaż'}
          hasInvoices={hasInvoices}
          today={today}
          onAdd={addPayment}
          onFill={fillPayment}
          onGapAsExtraSale={async () => {
            if (!paymentGap) return
            await saveExtra(paymentGap.amountNetto, paymentGap.what, `Zapisano dosprzedaż ${pln(paymentGap.amountNetto)} (różnica we wpłacie). Nadaj jej kategorię.`)
          }}
        />

        {money.invoicesWithoutAmount > 0 && money.invoiced === null && (
          <p className="text-xs text-zinc-400">Faktura bez kwoty — dopóki jej nie uzupełnisz (albo kwoty wpłaty), liczy się cena z dosprzedażą.</p>
        )}
        {money.invoiced !== null && hasInvoices && (
          <p className="text-xs text-zinc-400">
            Faktury: {pln(money.invoiced)}
            {money.revenueBasis === 'invoices' ? ' — w Finansach liczą się faktury.' : ` z ${pln(money.expected ?? 0)} — dopóki projekt trwa, liczy się cena z dosprzedażą.`}
          </p>
        )}
      </section>

      {/* C2 + C4 (V1) — wynik: obie marże przed podatkiem, zysk netto (po podatku) osobno */}
      <section aria-label="Wynik projektu" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
          <div className="text-[11px] text-zinc-500">Marża na realizacji · przed podatkiem</div>
          <div className={`mt-0.5 text-2xl font-semibold ${money.margin !== null && money.margin < 0 ? 'text-red-300' : 'text-white'}`} style={mono}>
            {money.margin === null ? '—' : pln(money.margin)}
          </div>
          {money.margin !== null && (
            <div className="mt-0.5 text-xs font-medium text-zinc-300" style={mono}>po podatku {pln(money.margin - money.tax)}</div>
          )}
          <div className="mt-1 text-xs text-zinc-500">{pct(marginBeforeTaxPct)} przychodu · przychód − koszty zewnętrzne</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
          <div className="text-[11px] text-zinc-500">Marża producencka · przed podatkiem</div>
          <div className={`mt-0.5 text-2xl font-semibold ${money.producerMargin !== null && money.producerMargin < 0 ? 'text-red-300' : 'text-white'}`} style={mono}>
            {money.producerMargin === null ? '—' : pln(money.producerMargin)}
          </div>
          {money.producerMargin !== null && (
            <div className="mt-0.5 text-xs font-medium text-zinc-300" style={mono}>po podatku {pln(money.producerMargin - money.tax)}</div>
          )}
          <div className="mt-1 text-xs text-zinc-500">
            {pct(money.producerMarginPct)} przychodu ·{' '}
            {money.ownWork > 0 ? `bez Twojej pracy (${pln(money.ownWork)})` : 'nic nie oznaczono jako „Moja praca"'}
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-2.5 sm:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[11px] text-zinc-500">Zysk netto · po podatku</span>
            <span className={`text-lg font-semibold ${money.profit !== null && money.profit < 0 ? 'text-red-300' : 'text-emerald-300'}`} style={mono}>
              {money.profit === null ? '—' : pln(money.profit)}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">{pct(money.marginPct)} przychodu · po kosztach zewnętrznych i ryczałcie</div>
        </div>
      </section>

      <section aria-label="Rozliczenie" className="rounded-xl border border-white/5 bg-zinc-900/20 px-4 py-3 text-sm">
        <Row label={<>Przychód <span className="text-xs text-zinc-500">({revenueSourceText(view)})</span></>} value={revenue === null ? '—' : pln(revenue)} />
        <Row label={<>Koszty zewnętrzne <span className="text-xs text-zinc-500">({costsText})</span></>} value={money.costs === null ? '—' : minus(money.costs)} />
        <Row label="Marża na realizacji (przed podatkiem)" value={money.margin === null ? '—' : pln(money.margin)} strong />
        <Row label="Moja praca (po koszcie z wyceny / Realizacji)" value={minus(money.ownWork)} muted />
        <Row label="Marża producencka (przed podatkiem)" value={money.producerMargin === null ? '—' : pln(money.producerMargin)} strong />
        <div className="mt-2 border-t border-white/10 pt-2">
          <Row label="Marża na realizacji" value={money.margin === null ? '—' : pln(money.margin)} muted />
          <Row label="" value={revenue === null ? '' : minus(money.tax)}>
            <span className="inline-flex items-center gap-1.5">
              Ryczałt
              {view.hasQuote ? (
                <TaxInput value={data.profitTaxRatePercent} onCommit={(rate) => updateField('profitTaxRatePercent', rate)} />
              ) : (
                <span className="text-zinc-500">{pct(money.taxRatePercent)}</span>
              )}
            </span>
          </Row>
          <Row label="Zysk netto (po podatku)" value={money.profit === null ? '—' : pln(money.profit)} strong />
        </div>
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
