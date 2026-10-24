'use client'

/**
 * Suma Realizacji na górze zakładki (U2, U-SUMA; decyzje M.J. 2026-10-24):
 * Realizacja razem (koszty zewnętrzne i moja praca osobno), zatwierdzona cena (`quotedPrice`, U1: przelew → cena → PDF
 * → kalkulator), ile zarobił sprzęt i bilans wyceny = cena − (koszty
 * zewnętrzne + moja praca + sprzęt), przed podatkiem. Druga linia: to samo
 * względem kwoty z Finansów (z dosprzedażą / przelewem / fakturami).
 * Liczby z `realization-summary.ts` i `gear-earnings.ts`; tu tylko układ.
 */

import { useState } from 'react'
import type { PlanRevenue } from '@/lib/quote-financials'
import type { GearEarnings } from '@/lib/gear-earnings'
import { parseSignedAmount, type Reconciliation, type RealizationTotals } from '@/lib/realization-summary'
import { mono, pln } from '@/components/calendar/calendar-bits'
import { earnedHint } from '@/components/equipment/project-equipment'
import { fieldClass } from './cost-rows'

/** „+1 415 zł" / „−2 675 zł" / „0 zł". */
export function signedPln(amount: number): string {
  const rounded = Math.round(amount)
  if (rounded === 0) return pln(0)
  return `${rounded > 0 ? '+' : '−'}${pln(Math.abs(rounded))}`
}

const SOURCE_LABELS: Record<PlanRevenue['source'], string> = {
  transfer: 'kwota przelewu wpisana ręcznie',
  approved: 'zatwierdzona cena',
  pdf: 'suma PDF wybranego wariantu',
  calculator: 'kalkulator (bez szkicu PDF)',
}

function priceSource(price: PlanRevenue): string {
  const euroOf = (amount: number | undefined, rate: number | null | undefined) =>
    amount !== undefined && rate
      ? ` · ${amount.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} € × ${rate.toLocaleString('pl-PL', { maximumFractionDigits: 4 })}`
      : ''
  const euro =
    price.source === 'transfer'
      ? ''
      : price.source === 'approved'
        ? price.frozen?.currency === 'EUR'
          ? euroOf(price.frozen.amount, price.frozen.rate)
          : ''
        : price.live.currency === 'EUR'
          ? euroOf(price.live.amount, price.live.rate)
          : ''
  const pdf = price.source !== 'pdf' && price.source !== 'calculator' && Math.abs(price.live.pln - price.pln) >= 0.5 ? ` · PDF ${pln(price.live.pln)}` : ''
  return `${SOURCE_LABELS[price.source]}${euro}${pdf}`
}

export interface FinanceComparison {
  /** Kwota z Finansów (z dosprzedażą / przelewem, faktury wygrywają). */
  amount: number
  reconciliation: Reconciliation
  /** `true` = faktury. */
  invoiced: boolean
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-zinc-900/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  )
}

export function RealizationTotalsCard({
  totals,
  price,
  earnings,
  reconciliation,
  finance,
  onOverride,
}: {
  totals: RealizationTotals
  price: PlanRevenue | null
  earnings: GearEarnings
  reconciliation: Reconciliation | null
  finance: FinanceComparison | null
  /** Kwota „Sprzęt zarobił" wpisana ręcznie; `null` = licz z PDF. */
  onOverride: (value: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const balance = reconciliation?.balance ?? null
  const startEdit = () => {
    setText(String(Math.round((earnings.earned ?? 0) * 100) / 100).replace('.', ','))
    setEditing(true)
  }
  const save = (value: number | null) => {
    onOverride(value)
    setEditing(false)
  }

  return (
    <section aria-label="Realizacja razem" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Realizacja razem">
          <div className="text-lg font-bold text-white" style={mono}>
            {pln(totals.total)}
          </div>
          <div className="text-[11px] text-amber-300/80" style={mono}>
            zewnętrzne {pln(totals.external)}
          </div>
          <div className="text-[11px] text-sky-300/80" style={mono}>
            moja praca {pln(totals.own)}
          </div>
        </Tile>

        <Tile label="Zatwierdzona cena">
          {price ? (
            <>
              <div className="text-lg font-bold text-white" style={mono}>
                {pln(price.pln)}
              </div>
              <div className="text-[11px] text-zinc-500">{priceSource(price)}</div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-zinc-500">—</div>
              <div className="text-[11px] text-zinc-500">projekt bez wyceny</div>
            </>
          )}
        </Tile>

        <Tile label="Sprzęt zarobił">
          {editing ? (
            <form
              className="mt-1 space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                const value = parseSignedAmount(text)
                if (value !== null) save(value)
              }}
            >
              <div className="flex items-center gap-1">
                <input
                  value={text}
                  autoFocus
                  inputMode="decimal"
                  aria-label="Ile zarobił sprzęt (zł netto)"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                  className={`${fieldClass} w-24 text-right tabular-nums`}
                />
                <span className="text-xs text-zinc-500">zł</span>
                <button type="submit" className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-zinc-100 hover:bg-white/15">
                  Zapisz
                </button>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                {earnings.pdfGear && (
                  <button type="button" onClick={() => save(earnings.pdfGear!.pln)} className="font-semibold text-primary hover:underline">
                    = cały wiersz Sprzęt ({pln(earnings.pdfGear.pln)}) — wynajem w osobnym wierszu PDF
                  </button>
                )}
                <button type="button" onClick={() => setEditing(false)} className="text-zinc-500 hover:text-zinc-200">
                  Anuluj
                </button>
              </div>
            </form>
          ) : earnings.earned === null ? (
            <>
              <div className="text-lg font-bold text-zinc-500">—</div>
              <div className="text-[11px] text-zinc-500">projekt bez wyceny</div>
            </>
          ) : (
            <>
              <div className={`text-lg font-bold ${earnings.earned < 0 ? 'text-red-300' : 'text-emerald-400'}`} style={mono}>
                {pln(earnings.earned)}
              </div>
              <div className="text-[11px] text-zinc-500">{earnedHint(earnings)}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                <button type="button" onClick={startEdit} className="font-semibold text-zinc-400 hover:text-zinc-100">
                  Zmień
                </button>
                {earnings.override !== null && earnings.computed !== null && (
                  <button type="button" onClick={() => save(null)} className="font-semibold text-primary hover:underline">
                    Licz z PDF ({pln(earnings.computed)})
                  </button>
                )}
              </div>
            </>
          )}
        </Tile>

        <Tile label="Bilans wyceny">
          {balance === null ? (
            <>
              <div className="text-lg font-bold text-zinc-500">—</div>
              <div className="text-[11px] text-zinc-500">bez ceny nie ma z czym porównać</div>
            </>
          ) : (
            <>
              <div className={`text-lg font-bold ${balance < 0 ? 'text-red-300' : 'text-emerald-400'}`} style={mono}>
                {signedPln(balance)}
              </div>
              <div className="text-[11px] text-zinc-500">
                {Math.round(balance) === 0 ? 'wycena w punkt' : balance > 0 ? 'wycenione na Twoją korzyść' : 'wycenione na Twoją niekorzyść'}
              </div>
              {finance && (
                <div className="mt-0.5 text-[11px] text-zinc-400">
                  z dosprzedażą / {finance.invoiced ? 'fakturami' : 'przelewem'} ({pln(finance.amount)}):{' '}
                  <span className={finance.reconciliation.balance < 0 ? 'text-red-300' : 'text-emerald-400'} style={mono}>
                    {signedPln(finance.reconciliation.balance)}
                  </span>
                </div>
              )}
            </>
          )}
        </Tile>
      </div>
      <p className="text-[11px] text-zinc-500">
        Bilans = cena − (koszty zewnętrzne + moja praca + sprzęt zarobił), przed podatkiem. Nie wychodzi na zero — pokazuje, czy
        dobrze wyceniłeś swoją pracę. Sprzęt zarobił = wiersz Sprzęt z PDF − wynajem sprzętu z Realizacji.
      </p>
    </section>
  )
}
