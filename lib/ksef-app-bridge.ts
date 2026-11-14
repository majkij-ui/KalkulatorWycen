/**
 * Most między klientem KSeF a częścią systemową aplikacji, plus teksty dla
 * przycisku „Pobierz z KSeF". Moduł czysty (bez Tauri), testy w `ksef-sync.test.ts`.
 *
 * Okno aplikacji nie łączy się z siecią samo: każde żądanie idzie przez polecenie
 * `ksef_request` (src-tauri/src/ksef.rs), które drugi raz sprawdza, czy to odczyt.
 */

import { KSEF_BASE_URLS, type KsefEnvironment } from './ksef-client'
import { plural } from './pl-plural'
import type { KsefSyncProgress, KsefSyncResult } from './ksef-sync'

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

interface KsefReply {
  status: number
  retryAfter: string | null
  body: string
}

/** `fetch` dla `createKsefClient`, który zamiast sieci woła polecenie aplikacji. */
export function ksefFetchVia(invoke: Invoke, environment: KsefEnvironment): typeof fetch {
  const base = KSEF_BASE_URLS[environment]
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (!url.startsWith(base)) throw new Error('KSeF: żądanie poza adresem KSeF')
    const headers = new Headers(init?.headers)
    const reply = await invoke<KsefReply>('ksef_request', {
      request: {
        environment,
        method: init?.method ?? 'GET',
        path: url.slice(base.length),
        bearer: headers.get('Authorization')?.replace(/^Bearer /, '') ?? null,
        body: typeof init?.body === 'string' ? init.body : null,
        accept: headers.get('Accept'),
      },
    })
    const empty = reply.status === 204 || reply.status === 205 || reply.status === 304
    return new Response(empty ? null : reply.body, {
      status: reply.status,
      headers: reply.retryAfter ? { 'Retry-After': reply.retryAfter } : undefined,
    })
  }) as typeof fetch
}

const invoices = (count: number) => `${count} ${plural(count, 'faktura', 'faktury', 'faktur')}`

/** Co aplikacja właśnie robi, jednym zdaniem pod przyciskiem. */
export function syncProgressText(progress: KsefSyncProgress): string | null {
  if (progress.step === 'listing') {
    return progress.direction === 'sale' ? 'Sprawdzam nowe faktury sprzedaży…' : 'Sprawdzam nowe faktury zakupu…'
  }
  if (progress.step === 'details-plan' && progress.planned > 0) {
    const seconds = progress.planned * 4
    const time = seconds < 90 ? `ok. ${Math.max(5, Math.round(seconds / 5) * 5)} s` : `ok. ${Math.ceil(seconds / 60)} min`
    return `Pobieram treść: ${invoices(progress.planned)}, ${time} (KSeF wydaje je powoli)…`
  }
  if (progress.step === 'details') return `Pobieram treść faktur: ${progress.done} z ${progress.planned}…`
  return null
}

/** Wynik synchronizacji po ludzku. `warning` = coś zostało na później. */
export function syncSummary(result: KsefSyncResult): { text: string; warning: string | null } {
  const fresh = result.fresh.sale + result.fresh.purchase
  const parts = [
    result.fresh.sale ? `${result.fresh.sale} ${plural(result.fresh.sale, 'nowa faktura', 'nowe faktury', 'nowych faktur')} sprzedaży` : '',
    result.fresh.purchase ? `${result.fresh.purchase} ${plural(result.fresh.purchase, 'nowa faktura', 'nowe faktury', 'nowych faktur')} zakupu` : '',
  ].filter(Boolean)
  const listedAll = result.listed.sale && result.listed.purchase
  const text = fresh
    ? `Pobrano z KSeF: ${parts.join(' i ')}.`
    : listedAll
      ? result.downloaded
        ? `Bez nowych faktur. Dociągnięto treść: ${invoices(result.downloaded)}.`
        : 'W KSeF nie ma nowych faktur.'
      : 'Nie udało się sprawdzić nowych faktur.'
  const wait = result.retryInMinutes ? `za ok. ${result.retryInMinutes} min` : 'później'
  const warnings = [
    !listedAll ? `KSeF wstrzymał listę faktur (limit na godzinę). Spróbuj ${wait}.` : '',
    result.waiting ? `Treść ${result.waiting} ${plural(result.waiting, 'faktury', 'faktur', 'faktur')} (pozycje, termin płatności) pobierze się przy następnym razie${result.retryInMinutes ? `, ${wait}` : ''}.` : '',
  ].filter(Boolean)
  return { text, warning: warnings.length ? warnings.join(' ') : null }
}
