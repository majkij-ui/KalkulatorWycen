'use client'

/**
 * „Wpłynęło na konto" w zakładce Finanse projektu (U1, decyzje 18.3/6 i U1/3):
 * kwota NETTO i data → wydarzenie `invoice_paid` na osi projektu. Wpłata
 * odhaczona bez kwoty dostaje kwotę w tym samym wydarzeniu (nie drugą wpłatę).
 * Reguły (kto decyduje o przychodzie, różnica jako dosprzedaż) — `project-finance.ts`.
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import type { PaymentRow, ReceivedView } from '@/lib/project-finance'
import { mono, pln } from '@/components/calendar/calendar-bits'

function dateText(day: string): string {
  const [y, m, d] = day.split('-')
  return d ? `${d}.${m}.${y}` : day
}

const inputClass =
  'h-8 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-white/30'

function AmountField({ label, onCommit }: { label: string; onCommit: (amount: number) => void | Promise<void> }) {
  const [text, setText] = useState('')
  const parsed = parseAmount(text)
  return (
    <form
      className="inline-flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (parsed !== undefined && parsed > 0) void onCommit(parsed)
      }}
    >
      <input
        inputMode="decimal"
        aria-label={label}
        placeholder="kwota netto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={`${inputClass} w-28 text-right tabular-nums`}
        style={mono}
      />
      <button type="submit" disabled={parsed === undefined || parsed <= 0} className="h-8 rounded-md px-2 text-xs font-medium text-primary disabled:opacity-40">
        Zapisz
      </button>
    </form>
  )
}

export function PaymentsSection({
  received,
  baseLabel,
  hasInvoices,
  today,
  onAdd,
  onFill,
  onGapAsExtraSale,
}: {
  received: ReceivedView
  /** Z czym porównujemy wpłaty: „cena + dosprzedaż" albo „wpisana kwota przelewu". */
  baseLabel: string
  /** Projekt ma wystawione faktury (wtedy wpłata je opłaca). */
  hasInvoices: boolean
  today: string
  onAdd: (amount: number, day: string) => Promise<void>
  onFill: (payment: PaymentRow, amount: number) => Promise<void>
  onGapAsExtraSale: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(today)
  const parsed = parseAmount(amount)
  const valid = parsed !== undefined && parsed > 0 && /^\d{4}-\d{2}-\d{2}$/.test(day)

  return (
    <section aria-label="Wpłynęło na konto" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">
          Wpłynęło na konto {received.total > 0 && <span className="font-normal text-zinc-500">· {pln(received.total)}</span>}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 hover:bg-white/5 hover:text-white"
          >
            <Plus className="size-3.5" />
            Wpłata
          </button>
        )}
      </div>
      {received.payments.length === 0 && !adding && <p className="text-xs text-zinc-500">Jeszcze nic. Wpisz kwotę netto i datę przelewu.</p>}
      <ul className="space-y-1">
        {received.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-zinc-900/30 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 text-zinc-300">
              {dateText(p.day)}
              {p.number && <span className="ml-2 text-xs text-zinc-500">FV {p.number}</span>}
            </span>
            {p.amount === null ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                bez kwoty
                <AmountField label={`Kwota wpłaty z ${dateText(p.day)} (zł netto)`} onCommit={(value) => onFill(p, value)} />
              </span>
            ) : (
              <span className="tabular-nums text-zinc-100" style={mono}>
                {pln(p.amount)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!valid) return
            await onAdd(parsed!, day)
            setAdding(false)
            setAmount('')
            setDay(today)
          }}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-3"
        >
          <input
            inputMode="decimal"
            aria-label="Kwota wpłaty (zł netto)"
            placeholder="Kwota netto"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} w-32 text-right tabular-nums`}
            style={mono}
          />
          <span className="text-xs text-zinc-500">zł netto</span>
          <input type="date" aria-label="Data wpłaty" value={day} onChange={(e) => setDay(e.target.value)} className={`${inputClass} w-36`} />
          <button type="submit" disabled={!valid} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">
            Zapisz wpłatę
          </button>
          <button type="button" onClick={() => setAdding(false)} className="h-8 px-2 text-xs text-zinc-400 hover:text-white">
            Anuluj
          </button>
          <p className="w-full text-[11px] text-zinc-500">
            {hasInvoices
              ? 'Wpłata opłaca fakturę; o przychodzie decyduje faktura (gdy ma kwotę).'
              : 'Bez faktury przychód liczy się w dniu wpłaty — projekt przechodzi do miesiąca przelewu.'}
          </p>
        </form>
      )}
      {received.invoiceDecides && received.total > 0 && (
        <p className="text-xs text-zinc-500">O przychodzie decyduje faktura; wpłaty pokazują, co już jest na koncie.</p>
      )}
      {received.gap !== null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          <span>
            Wpłynęło o {pln(received.gap)} więcej niż {baseLabel} ({pln(received.base)}).
          </span>
          <button
            type="button"
            onClick={() => void onGapAsExtraSale()}
            className="inline-flex h-7 items-center rounded-md border border-white/10 px-2 text-xs font-medium text-zinc-200 hover:bg-white/5"
          >
            Zapisz różnicę jako dosprzedaż (+{pln(received.gap)})
          </button>
        </div>
      )}
      {received.short !== null && (
        <p className="text-xs text-amber-200/80">
          Wpłynęło o {pln(received.short)} mniej niż {baseLabel} ({pln(received.base)}).
        </p>
      )}
    </section>
  )
}
