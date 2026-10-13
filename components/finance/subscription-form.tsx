'use client'

/**
 * Formularz subskrypcji (dodawanie i edycja) w zakładce „Koszty stałe i
 * subskrypcje". Zapisuje tylko fakt — raty liczy `lib/subscriptions.ts`.
 *
 * Dwie straże przed złymi liczbami:
 *  - ręczne wpisy w miesiącach rat, które mogą być tą samą opłatą
 *    (`possibleDoubles`) — z podpowiedzią „zacznij od …";
 *  - nowa cena przy edycji: domyślnie „od bieżącego miesiąca", czyli minione
 *    raty zostają po starej cenie jako poprawki (`pastChargesToKeep`).
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import { plural } from '@/lib/pl-plural'
import { fetchNbpMidRate } from '@/lib/nbp-fx'
import { COST_CATEGORY_KEYS, COST_CATEGORY_LABELS, type CostCategory } from '@/lib/fixed-cost-categories'
import type { FixedCost } from '@/lib/project-types'
import {
  CADENCE_LABELS,
  createSubscription,
  SUBSCRIPTION_CADENCES,
  SUBSCRIPTION_CURRENCIES,
  type Subscription,
  type SubscriptionCadence,
} from '@/lib/subscription-types'
import {
  addMonths,
  changesPrice,
  pastChargesToKeep,
  possibleDoubles,
  subscriptionCategory,
} from '@/lib/subscriptions'
import { Button } from '@/components/ui/button'
import { amountDraft, money, monthFrom, monthShort, rateText } from './finance-format'

const field =
  'h-9 min-w-0 rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/30'
const labelClass = 'flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500'

/** Ten sam dzień w innym miesiącu, przycięty do jego długości (31 → 30 listopada). */
function sameDayIn(month: string, startDate: string): string {
  const day = Number(startDate.slice(8, 10)) || 1
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`
}

interface Draft {
  name: string
  category: CostCategory
  amount: string
  currency: string
  rate: string
  cadence: string
  everyMonths: string
  startDate: string
  endDate: string
  notes: string
}

function draftFrom(sub: Subscription): Draft {
  return {
    name: sub.name,
    category: subscriptionCategory(sub),
    amount: sub.amount ? amountDraft(sub.amount) : '',
    currency: sub.currency,
    rate: sub.rate ? String(sub.rate).replace('.', ',') : '',
    cadence: sub.cadence,
    everyMonths: sub.everyMonths ? String(sub.everyMonths) : '',
    startDate: sub.startDate,
    endDate: sub.endDate ?? '',
    notes: sub.notes ?? '',
  }
}

type Problem = 'name' | 'amount' | 'rate' | 'every' | 'start' | 'end'

const PROBLEM_TEXT: Record<Problem, string> = {
  name: 'Wpisz nazwę.',
  amount: 'Wpisz kwotę raty.',
  rate: 'Wpisz kurs waluty.',
  every: 'Co ile miesięcy?',
  start: 'Podaj dzień pierwszej raty.',
  end: 'Koniec jest przed pierwszą ratą.',
}

/** Subskrypcja z formularza: nieznane pola edytowanej zostają, wyczyszczone znikają. */
function buildSubscription(base: Subscription, draft: Draft): { sub: Subscription; problems: Problem[] } {
  const problems: Problem[] = []
  const amount = parseAmount(draft.amount)
  const rate = parseAmount(draft.rate)
  const every = Number(draft.everyMonths)
  const foreign = draft.currency !== 'PLN'
  if (!draft.name.trim()) problems.push('name')
  if (amount === undefined || amount <= 0) problems.push('amount')
  if (foreign && (rate === undefined || rate <= 0)) problems.push('rate')
  if (draft.cadence === 'custom' && !(Number.isInteger(every) && every >= 1 && every <= 120)) problems.push('every')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) problems.push('start')
  if (draft.endDate && draft.startDate && draft.endDate < draft.startDate) problems.push('end')

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rate: _rate, everyMonths: _every, endDate: _end, notes: _notes, ...rest } = base
  const sub: Subscription = {
    ...rest,
    name: draft.name.trim(),
    category: draft.category,
    amount: amount ?? 0,
    currency: draft.currency,
    cadence: draft.cadence,
    startDate: draft.startDate,
    ...(foreign && rate ? { rate } : {}),
    ...(draft.cadence === 'custom' && every ? { everyMonths: every } : {}),
    ...(draft.endDate ? { endDate: draft.endDate } : {}),
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  }
  return { sub, problems }
}

export function SubscriptionForm({
  initial,
  costs,
  today,
  onSave,
  onCancel,
  onDelete,
}: {
  /** Edytowana subskrypcja; brak = nowa. */
  initial?: Subscription
  /** Nieusunięte koszty stałe (straże przed podwójnym liczeniem). */
  costs: FixedCost[]
  today: string
  onSave: (sub: Subscription, keep: FixedCost[]) => Promise<void>
  onCancel: () => void
  onDelete?: () => void
}) {
  const [base] = useState(() => initial ?? createSubscription({ name: '', startDate: today }))
  const [draft, setDraft] = useState<Draft>(() => draftFrom(base))
  const [touched, setTouched] = useState(false)
  const [keepPast, setKeepPast] = useState(true)
  const [busy, setBusy] = useState(false)
  const [nbp, setNbp] = useState<{ state: 'idle' | 'loading' | 'error' } | { state: 'ok'; date: string }>({
    state: 'idle',
  })
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const { sub, problems } = useMemo(() => buildSubscription(base, draft), [base, draft])
  const currentMonth = today.slice(0, 7)
  const doubles = useMemo(
    () => (problems.length ? [] : possibleDoubles(sub, costs).sort((a, b) => a.month.localeCompare(b.month))),
    [sub, costs, problems]
  )
  const priceChange = !!initial && problems.length === 0 && changesPrice(initial, sub)
  const keep = useMemo(
    () => (initial && priceChange ? pastChargesToKeep(initial, costs, currentMonth) : []),
    [initial, priceChange, costs, currentMonth]
  )

  const lastDouble = doubles.reduce((max, c) => (c.month > max ? c.month : max), '')
  const suggestedStart = lastDouble ? sameDayIn(addMonths(lastDouble, 1), draft.startDate) : null

  const fetchRate = async () => {
    setNbp({ state: 'loading' })
    try {
      const { rate, effectiveDate } = await fetchNbpMidRate(draft.currency)
      set({ rate: String(rate).replace('.', ',') })
      setNbp({ state: 'ok', date: effectiveDate })
    } catch {
      setNbp({ state: 'error' })
    }
  }

  const submit = async () => {
    setTouched(true)
    if (problems.length) return
    setBusy(true)
    try {
      await onSave(sub, keepPast ? keep : [])
    } finally {
      setBusy(false)
    }
  }

  const cadence = draft.cadence as SubscriptionCadence
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="mb-4 flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
      aria-label={initial ? `Edycja: ${initial.name}` : 'Nowa subskrypcja'}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className={labelClass}>
          Nazwa
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="np. Artlist, Adobe CC, konto firmowe"
            className={field}
          />
        </label>
        <label className={labelClass}>
          Kategoria
          <select
            value={draft.category}
            onChange={(e) => set({ category: e.target.value as CostCategory })}
            className={field}
          >
            {COST_CATEGORY_KEYS.map((key) => (
              <option key={key} value={key}>
                {COST_CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className={labelClass}>
          Kwota raty
          <input
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="0"
            className={`${field} w-28 text-right tabular-nums`}
          />
        </label>
        <label className={labelClass}>
          Waluta
          <select value={draft.currency} onChange={(e) => set({ currency: e.target.value })} className={`${field} w-20`}>
            {SUBSCRIPTION_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!(SUBSCRIPTION_CURRENCIES as readonly string[]).includes(draft.currency) && (
              <option value={draft.currency}>{draft.currency}</option>
            )}
          </select>
        </label>
        {draft.currency !== 'PLN' && (
          <label className={labelClass}>
            Kurs (zł za 1 {draft.currency})
            <span className="flex gap-1">
              <input
                inputMode="decimal"
                value={draft.rate}
                onChange={(e) => {
                  set({ rate: e.target.value })
                  setNbp({ state: 'idle' })
                }}
                placeholder="np. 4,05"
                className={`${field} w-24 text-right tabular-nums`}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={fetchRate}
                disabled={nbp.state === 'loading'}
                className="h-9 px-2 text-xs normal-case tracking-normal"
              >
                {nbp.state === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : 'NBP'}
              </Button>
            </span>
          </label>
        )}
        <label className={labelClass}>
          Cykl
          <select value={draft.cadence} onChange={(e) => set({ cadence: e.target.value })} className={`${field} w-36`}>
            {SUBSCRIPTION_CADENCES.map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABELS[c]}
              </option>
            ))}
            {!(SUBSCRIPTION_CADENCES as readonly string[]).includes(draft.cadence) && (
              <option value={draft.cadence}>{draft.cadence} (nieznany)</option>
            )}
          </select>
        </label>
        {cadence === 'custom' && (
          <label className={labelClass}>
            Co ile mies.
            <input
              inputMode="numeric"
              value={draft.everyMonths}
              onChange={(e) => set({ everyMonths: e.target.value.replace(/\D/g, '') })}
              placeholder="3"
              className={`${field} w-16 text-right tabular-nums`}
            />
          </label>
        )}
      </div>
      {nbp.state === 'ok' && (
        <p className="-mt-1 text-xs text-zinc-500">Kurs średni NBP z {nbp.date}. Możesz go zmienić.</p>
      )}
      {nbp.state === 'error' && (
        <p className="-mt-1 text-xs text-amber-300/80">Nie udało się pobrać kursu z NBP — wpisz go ręcznie.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className={labelClass}>
          Pierwsza rata
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
            className={`${field} w-40`}
          />
        </label>
        <label className={labelClass}>
          Koniec (opcjonalnie)
          <span className="flex gap-1">
            <input
              type="date"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
              className={`${field} w-40`}
            />
            {!draft.endDate && initial && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => set({ endDate: today })}
                className="h-9 px-2 text-xs normal-case tracking-normal"
              >
                Dziś
              </Button>
            )}
          </span>
        </label>
        <label className={`${labelClass} min-w-[12rem] flex-1`}>
          Notatka
          <input
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="np. karta firmowa, licencja do 06.2027"
            className={field}
          />
        </label>
      </div>
      <p className="-mt-1 text-xs text-zinc-500">
        Raty liczą się same w każdym miesiącu cyklu. Miesiąc, który był inny, poprawisz niżej na liście miesięcy.
        Kończy się naprawdę? Wpisz koniec — raty po nim znikną.
      </p>

      {doubles.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-200/90" role="status">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              W miesiącach rat są już ręczne wpisy, które mogą być tą samą opłatą — wtedy liczyłaby się dwa razy:{' '}
              {doubles
                .slice(0, 4)
                .map((c) => `${monthShort(c.month)} „${c.label || 'bez opisu'}" ${money(c.amount)}`)
                .join(', ')}
              {doubles.length > 4 && ` i ${doubles.length - 4} więcej`}.
            </span>
          </p>
          {suggestedStart && (
            <button
              type="button"
              onClick={() => set({ startDate: suggestedStart })}
              className="mt-1.5 font-semibold text-amber-100 underline-offset-2 hover:underline"
            >
              Zacznij raty od {monthFrom(suggestedStart.slice(0, 7))}
            </button>
          )}
        </div>
      )}

      {keep.length > 0 && (
        <fieldset className="rounded-lg border border-white/10 p-2.5 text-xs text-zinc-300">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Nowa cena</legend>
          <label className="flex items-start gap-2 py-0.5">
            <input type="radio" checked={keepPast} onChange={() => setKeepPast(true)} className="mt-0.5 accent-sky-500" />
            <span>
              Od {monthFrom(currentMonth)} — {keep.length}{' '}
              {plural(keep.length, 'miniona rata zostaje', 'minione raty zostają', 'minionych rat zostaje')} po starej
              cenie (zapiszą się jako poprawki)
            </span>
          </label>
          <label className="flex items-start gap-2 py-0.5">
            <input type="radio" checked={!keepPast} onChange={() => setKeepPast(false)} className="mt-0.5 accent-sky-500" />
            <span>We wszystkich miesiącach — stara kwota była pomyłką</span>
          </label>
        </fieldset>
      )}

      {touched && problems.length > 0 && (
        <p className="text-xs text-red-300" role="alert">
          {problems.map((p) => PROBLEM_TEXT[p]).join(' ')}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-500 tabular-nums">
          {problems.length === 0 && draft.currency !== 'PLN' && (
            <>
              {money(sub.amount, sub.currency)} × {rateText(sub.rate ?? 0)} ={' '}
              {money(Math.round(sub.amount * (sub.rate ?? 0) * 100) / 100)}
            </>
          )}
        </span>
        <div className="flex gap-1">
          {onDelete && (
            <Button type="button" variant="ghost" onClick={onDelete} className="h-8 text-red-300 hover:text-red-200">
              Usuń
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel} className="h-8">
            Anuluj
          </Button>
          <Button type="submit" disabled={busy} className="h-8">
            {initial ? 'Zapisz' : 'Dodaj'}
          </Button>
        </div>
      </div>
    </form>
  )
}
