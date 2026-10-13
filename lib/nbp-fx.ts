/**
 * Free Polish National Bank (NBP) exchange-rate fetch, table A (daily mid-rate,
 * published on working days). No API key required.
 *
 *   latest:      https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json
 *   chosen day:  https://api.nbp.pl/api/exchangerates/rates/A/EUR/{from}/{to}/?format=json
 *
 * A quote freezes the rate of a chosen day (S3, decision E). Weekends and
 * holidays have no table, so for a day we ask for the ten days up to it and take
 * the last rate published on or before it.
 *
 * Errors propagate to the caller so the UI can show a graceful "wpisz ręcznie" hint.
 */

const NBP_BASE = 'https://api.nbp.pl/api/exchangerates/rates/A/EUR'
/** Days looked back for a chosen day (long holiday weekends included). */
const LOOKBACK_DAYS = 10

interface NbpRate {
  mid?: number
  effectiveDate?: string
}

interface NbpResponse {
  rates?: NbpRate[]
}

export interface NbpRateResult {
  rate: number
  /** Day of the NBP table the rate comes from (YYYY-MM-DD). */
  effectiveDate: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function isoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + days))
}

/** URL for a chosen day: the range of ten days up to it, never past today. */
export function nbpRangeUrl(day: string, today: Date = new Date()): string {
  const todayIso = isoDay(today)
  const end = ISO_DAY.test(day) && day < todayIso ? day : todayIso
  return `${NBP_BASE}/${shiftDay(end, -LOOKBACK_DAYS)}/${end}/?format=json`
}

/** The last valid rate published on or before `day` (NBP returns them oldest first). */
export function pickNbpRate(rates: NbpRate[] | undefined, day: string): NbpRateResult | null {
  let best: NbpRateResult | null = null
  for (const r of rates ?? []) {
    if (typeof r.mid !== 'number' || !Number.isFinite(r.mid) || r.mid <= 0) continue
    const date = typeof r.effectiveDate === 'string' ? r.effectiveDate : ''
    if (!ISO_DAY.test(date) || date > day) continue
    if (!best || date > best.effectiveDate) best = { rate: r.mid, effectiveDate: date }
  }
  return best
}

/**
 * EUR mid-rate. Without `day`: the latest table. With `day` (YYYY-MM-DD): the
 * table of that day, or the last one before it.
 */
export async function fetchEurPlnRate(day?: string, today: Date = new Date()): Promise<NbpRateResult> {
  const url = day ? nbpRangeUrl(day, today) : `${NBP_BASE}/?format=json`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`NBP responded ${res.status}`)

  const data = (await res.json()) as NbpResponse
  const target = day && ISO_DAY.test(day) ? day : '9999-12-31'
  const picked = pickNbpRate(data.rates, target)
  if (!picked) throw new Error('Malformed NBP response')
  return picked
}

/** Today as YYYY-MM-DD in local time (default day for a new rate). */
export function todayIso(today: Date = new Date()): string {
  return isoDay(today)
}

/**
 * Bieżący kurs średni NBP (tabela A) dla dowolnej waluty — kurs subskrypcji
 * w Finansach (S1). Błędy lecą do wywołującego, jak wyżej.
 */
export async function fetchNbpMidRate(code: string): Promise<{ rate: number; effectiveDate: string }> {
  const url = `https://api.nbp.pl/api/exchangerates/rates/A/${encodeURIComponent(code.toUpperCase())}/?format=json`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`NBP responded ${res.status}`)
  const r = ((await res.json()) as NbpResponse).rates?.[0]
  if (!r || typeof r.mid !== 'number' || !Number.isFinite(r.mid) || r.mid <= 0) throw new Error('Malformed NBP response')
  return { rate: r.mid, effectiveDate: typeof r.effectiveDate === 'string' ? r.effectiveDate : '' }
}
