'use client'

/**
 * Sprzęt w kosztach firmy (S4, decyzja B): co z katalogu i z ręcznych pozycji
 * „Sprzęt spoza katalogu" liczy się w okresie, w którym widoku i dlaczego.
 * Liczby z `gear-costs.ts` (przez rejestr marży); tu tylko układ i słowa.
 */

import { useState } from 'react'
import type { GearPeriodCost } from '@/lib/gear-costs'
import { formatDate, pln } from '@/lib/money-loop-labels'
import { plural } from '@/lib/pl-plural'

const monthLabel = (month: string) => `${month.slice(5, 7)}.${month.slice(0, 4)}`

/** Ile wierszy katalogu pokazać przed „pokaż wszystkie". */
const VISIBLE_LINES = 6

export function GearCostsPanel({ gear, periodLabel }: { gear: GearPeriodCost; periodLabel: string }) {
  const [all, setAll] = useState(false)
  const { settings } = gear
  const carriedLines = gear.lines.filter((l) => l.carried)
  const biggestCarried = [...carriedLines].sort((a, b) => b.amount - a.amount)[0]
  const lines = all ? gear.lines : gear.lines.slice(0, VISIBLE_LINES)
  const undatedTotal = gear.undated.reduce((sum, p) => sum + p.price, 0)
  const empty = gear.lines.length === 0 && gear.manualCosts.length === 0

  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4" aria-label="Sprzęt w kosztach firmy">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          Sprzęt w kosztach firmy · <span className="tabular-nums text-zinc-300">{pln(gear.total)}</span>
        </h2>
        <p className="text-[11px] text-zinc-500">
          {gear.spread
            ? `Zakupy sprzętu rozłożone na ${settings.months} mies.: zakupy od ${pln(settings.thresholdPln)} po równo, tańsze liczone jednorazowo w miesiącu zakupu.`
            : 'Zakupy sprzętu liczone jednorazowo: każdy zakup w miesiącu, w którym go kupiono (jak zakupy uderzyły w konto).'}
        </p>
      </div>

      {gear.carried > 0.5 && (
        <p className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-200/90">
          {periodLabel} niesie <span className="font-semibold tabular-nums">{pln(gear.carried)}</span> z rozkładania
          zakupów sprzed tego okresu
          {biggestCarried &&
            ` (np. ${biggestCarried.line.name}: ${pln(biggestCarried.line.monthly)} / mies. do ${monthLabel(biggestCarried.line.lastMonth)})`}
          .
        </p>
      )}

      {empty ? (
        <p className="px-1 py-2 text-sm text-zinc-600">Żaden zakup sprzętu nie liczy się w tym okresie.</p>
      ) : (
        <div className="flex flex-col divide-y divide-white/5">
          {lines.map(({ line, amount, carried }) => (
            <div key={line.itemId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-zinc-200">
                {line.name}
                {!line.onSet && <span className="ml-1.5 text-[11px] text-zinc-500">zaplecze</span>}
                {carried && <span className="ml-1.5 text-[11px] text-sky-300/80">z {line.firstMonth.slice(0, 4)}</span>}
              </span>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {formatDate(line.date)} · {pln(line.price)}
                {line.mode === 'spread'
                  ? ` · ${pln(line.monthly)} / mies. ${monthLabel(line.firstMonth)}–${monthLabel(line.lastMonth)}`
                  : ' · jednorazowo'}
                {line.retiredMonth && ` · wycofany ${monthLabel(line.retiredMonth)}`}
              </span>
              <span className="w-24 text-right tabular-nums text-zinc-100">{pln(amount)}</span>
            </div>
          ))}
          {gear.lines.length > VISIBLE_LINES && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="py-1.5 text-left text-xs font-medium text-zinc-400 hover:text-zinc-200"
            >
              {all ? 'Pokaż mniej' : `Pokaż wszystkie (${gear.lines.length})`}
            </button>
          )}
          {gear.manualCosts.map(({ cost, counted, link }) => (
            <div key={cost.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-zinc-300">
                {cost.label || 'Sprzęt'}
                <span className="ml-1.5 text-[11px] text-zinc-500">spoza katalogu</span>
              </span>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {monthLabel(cost.month)}
                {link &&
                  link.linked.length > 0 &&
                  ` · z ${pln(link.amount)} odjęto ${link.linked.map((l) => l.name).join(', ')} (${pln(link.linkedTotal)}, w katalogu)`}
                {link && link.missing.length > 0 && ` · brak w katalogu: ${link.missing.join(', ')}`}
              </span>
              <span className="w-24 text-right tabular-nums text-zinc-100">{pln(counted)}</span>
            </div>
          ))}
        </div>
      )}

      {(gear.retired.length > 0 || gear.undated.length > 0 || gear.unpriced.length > 0) && (
        <div className="mt-3 flex flex-col gap-1 text-[11px] text-amber-300/80">
          {gear.retired.map((line) => (
            <p key={line.itemId}>
              {line.name}: wycofany {monthLabel(line.retiredMonth!)} — nierozłożone {pln(line.unspread)} się nie liczy (brak
              ceny sprzedaży).
            </p>
          ))}
          {gear.undated.length > 0 && (
            <p>
              Bez daty zakupu — nie liczą się w żadnym miesiącu ({pln(undatedTotal)}):{' '}
              {gear.undated.map((p) => p.name).join(', ')}. Uzupełnij datę w Sprzęcie.
            </p>
          )}
          {gear.unpriced.length > 0 && (
            <p>
              Bez ceny zakupu ({gear.unpriced.length}{' '}
              {plural(gear.unpriced.length, 'pozycja', 'pozycje', 'pozycji')}): {gear.unpriced.map((p) => p.name).join(', ')}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
