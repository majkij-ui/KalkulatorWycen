'use client'

/**
 * Waluta wyceny (S3, decyzja E): PLN | EUR i kurs zamrożony w wycenie.
 *
 * Przejście na EUR pyta o kurs: NBP z wybranego dnia (tabela A z tego dnia
 * albo ostatnia wcześniejsza) albo wpisany ręcznie — bez cichego kursu
 * domyślnego. Zasady przeliczeń są w `lib/quote-currency.ts`.
 */

import { useEffect, useState } from 'react'
import { Loader2, RefreshCcw } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuote } from '@/lib/quote-context'
import { fetchEurPlnRate, todayIso } from '@/lib/nbp-fx'
import { formatRate, isValidRate, type ExchangeRateChoice } from '@/lib/quote-currency'

type Mode = 'toEur' | 'rate' | 'toPln'

function formatDay(iso: string | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function parseRate(text: string): number {
  const value = Number(text.replace(',', '.').trim())
  return Number.isFinite(value) ? value : Number.NaN
}

export function rateLabel(rate: number, source: string | undefined, date: string | undefined): string {
  const origin = source === 'nbp' && date ? `NBP z ${formatDay(date)}` : 'wpisany ręcznie'
  return `kurs ${formatRate(rate)} · ${origin}`
}

export function QuoteCurrencyControl({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { data, money, setQuoteCurrency, setExchangeRate } = useQuote()
  const [mode, setMode] = useState<Mode | null>(null)
  // Treść zostaje na czas animacji zamykania (inaczej mignęłaby treść „Kurs wyceny").
  const [view, setView] = useState<Mode>('rate')
  const [day, setDay] = useState(todayIso())
  const [rateText, setRateText] = useState('')
  const [source, setSource] = useState<ExchangeRateChoice['source']>('manual')
  const [fetchedDate, setFetchedDate] = useState('')
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle')

  const isEur = money.currency === 'EUR'

  const fetchRate = async (forDay: string) => {
    setFetchState('loading')
    try {
      const result = await fetchEurPlnRate(forDay)
      setRateText(String(result.rate).replace('.', ','))
      setSource('nbp')
      setFetchedDate(result.effectiveDate)
      setFetchState('idle')
    } catch {
      setFetchState('error')
    }
  }

  const open = (next: Mode) => {
    const previous = isValidRate(data.exchangeRate) ? data.exchangeRate : null
    const startDay = data.exchangeRateDate ?? todayIso()
    setDay(next === 'toEur' ? todayIso() : startDay)
    setRateText(previous ? String(previous).replace('.', ',') : '')
    setSource(data.exchangeRateSource === 'nbp' && next !== 'toEur' ? 'nbp' : 'manual')
    setFetchedDate(next !== 'toEur' ? (data.exchangeRateDate ?? '') : '')
    setFetchState('idle')
    setView(next)
    setMode(next)
  }

  // Przejście na EUR od razu pobiera dzisiejszy kurs NBP (można zmienić dzień albo wpisać ręcznie).
  useEffect(() => {
    if (mode === 'toEur') void fetchRate(todayIso())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const rate = parseRate(rateText)
  const rateOk = isValidRate(rate)
  const choice: ExchangeRateChoice = {
    rate,
    source,
    ...(source === 'nbp' && fetchedDate ? { date: fetchedDate } : {}),
  }

  const apply = () => {
    if (mode === 'toPln') setQuoteCurrency('PLN')
    else if (rateOk && mode === 'toEur') setQuoteCurrency('EUR', choice)
    else if (rateOk && mode === 'rate') setExchangeRate(choice)
    setMode(null)
  }

  return (
    <Popover open={mode !== null} onOpenChange={(v) => !v && setMode(null)}>
      <PopoverAnchor asChild>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            role="group"
            aria-label="Waluta wyceny"
            className="inline-flex items-center rounded-md border border-white/10 bg-zinc-900/40 p-0.5"
          >
            {(['PLN', 'EUR'] as const).map((currency) => {
              const active = money.currency === currency
              return (
                <button
                  key={currency}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return
                    open(currency === 'EUR' ? 'toEur' : 'toPln')
                  }}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                    active ? 'bg-primary text-primary-foreground' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {currency}
                </button>
              )
            })}
          </div>
          {isEur && (
            <button
              type="button"
              onClick={() => open('rate')}
              title="Zmień kurs wyceny"
              className="rounded px-1 text-[11px] tabular-nums text-zinc-400 underline-offset-2 hover:text-white hover:underline"
            >
              {rateLabel(money.rate, data.exchangeRateSource, data.exchangeRateDate)}
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent align={align} className="w-80 border-white/10 bg-zinc-950 text-sm text-zinc-200">
        {view === 'toPln' ? (
          <div className="space-y-3">
            <p className="font-semibold text-white">Wrócić do wyceny w PLN?</p>
            <p className="text-xs text-zinc-400">
              Ceny z cennika, sprzętu i ról wrócą do złotych. Kwoty wpisane w wycenie w euro (korekty dni,
              wypożyczalnia, catering, noclegi, honorarium aktorów, poprawki i nadgodziny) przeliczą się po kursie{' '}
              {formatRate(money.rate)} i zaokrąglą do pełnych złotych.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
                Anuluj
              </Button>
              <Button type="button" size="sm" onClick={apply}>
                Przełącz na PLN
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-semibold text-white">{view === 'toEur' ? 'Wycena w EUR' : 'Kurs wyceny'}</p>
            <p className="text-xs text-zinc-400">
              {view === 'toEur'
                ? 'Ceny z cennika, sprzętu i ról pokażą się w euro (zł ÷ kurs, pełne euro). Kwoty wpisane w wycenie przeliczą się raz po tym kursie. Finanse liczą się w złotych po tym kursie.'
                : 'Nowy kurs przelicza ceny z cennika, sprzętu i ról. Kwoty wpisane w wycenie w euro zostają bez zmian.'}
            </p>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1">
                <span className="text-[11px] text-zinc-500">Kurs NBP z dnia</span>
                <Input
                  type="date"
                  value={day}
                  max={todayIso()}
                  onChange={(e) => setDay(e.target.value)}
                  className="h-8 border-white/10 bg-black/40 text-sm"
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void fetchRate(day)}
                disabled={fetchState === 'loading' || !day}
                className="h-8 gap-1.5 border-white/10 bg-zinc-900/40"
              >
                {fetchState === 'loading' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
                Pobierz z NBP
              </Button>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] text-zinc-500">Kurs EUR (zł za 1 €)</span>
              <Input
                inputMode="decimal"
                value={rateText}
                placeholder="np. 4,2735"
                onChange={(e) => {
                  setRateText(e.target.value)
                  setSource('manual')
                  setFetchedDate('')
                }}
                aria-label="Kurs EUR w złotych"
                className="h-8 border-white/10 bg-black/40 text-right text-sm tabular-nums"
              />
            </label>
            <p className="text-[11px] text-zinc-500">
              {fetchState === 'loading'
                ? 'Pobieram kurs z NBP…'
                : fetchState === 'error'
                ? 'Nie udało się pobrać kursu z NBP — wpisz go ręcznie.'
                : source === 'nbp' && fetchedDate
                  ? `Tabela NBP z ${formatDay(fetchedDate)}${fetchedDate !== day ? ' (ostatnia przed wybranym dniem)' : ''}.`
                  : 'Kurs wpisany ręcznie.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
                Anuluj
              </Button>
              <Button type="button" size="sm" onClick={apply} disabled={!rateOk}>
                {view === 'toEur' ? 'Przełącz na EUR' : 'Zastosuj kurs'}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
