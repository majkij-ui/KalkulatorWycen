/**
 * Free Polish National Bank (NBP) exchange-rate fetch.
 * https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json
 *
 * No API key required. Table A is the daily mid-rate published by NBP (working days).
 * Used by the PDF "Pobierz z NBP" button to auto-fill the EUR rate input.
 *
 * Errors propagate to the caller so the UI can show a graceful "wpisz ręcznie" hint.
 */

const NBP_EUR_URL = 'https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json'

interface NbpResponse {
  rates?: Array<{ mid?: number; effectiveDate?: string }>
}

export async function fetchEurPlnRate(): Promise<{ rate: number; effectiveDate: string }> {
  const res = await fetch(NBP_EUR_URL, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`NBP responded ${res.status}`)

  const data = (await res.json()) as NbpResponse
  const r = data.rates?.[0]
  if (!r || typeof r.mid !== 'number' || !Number.isFinite(r.mid) || r.mid <= 0) {
    throw new Error('Malformed NBP response')
  }

  return {
    rate: r.mid,
    effectiveDate: typeof r.effectiveDate === 'string' ? r.effectiveDate : '',
  }
}
