/**
 * Dane klienta z faktur: nazwa jak w KSeF i NIP (decyzja M.J. 2026-11-13).
 *
 * Klient to nadal pole `client` projektu — i to jest NAZWA WYŚWIETLANA (krótka,
 * „Piotrek", „DE Group"). Ten rekord dopisuje do niej to, co stoi na fakturze:
 * pełną nazwę i NIP. Jeden NIP = jedna nazwa wyświetlana, więc kolejne faktury
 * tej samej firmy trafiają do tego samego klienta, a interfejs zostaje czysty.
 *
 * Rekordy pisze ekran „Zgodność z KSeF"; „Scal nazwy" przenosi je na nową nazwę.
 *
 * Moduł czysty — testy w `ksef-reconcile.test.ts`.
 */

import { z } from 'zod'
import { clientKey } from './clients'

export const clientDetailsSchema = z
  .object({
    /** Identyfikator z faktury (`Nip:…`, `VatUe:…`) — jeden rekord na firmę. */
    id: z.string().min(1),
    /** Nazwa wyświetlana = wartość pola `client` w projektach. */
    client: z.string().catch(''),
    /** Nazwa z faktury (KSeF). */
    legalName: z.string().catch(''),
    /** NIP, gdy firma go ma; pusty dla firm z zagranicy. */
    nip: z.string().catch(''),
    updatedAt: z.string().catch(''),
  })
  .passthrough()
export type ClientDetails = z.infer<typeof clientDetailsSchema>

/** Dane z faktur dla klienta o tej nazwie wyświetlanej (może być kilka firm, np. po scaleniu). */
export function detailsOfClient(details: ClientDetails[], clientName: string): ClientDetails[] {
  const key = clientKey(clientName)
  return key ? details.filter((d) => clientKey(d.client) === key) : []
}

/** Po „Scal nazwy": rekordy scalonych klientów dostają nową nazwę wyświetlaną. */
export function renameDetails(
  details: ClientDetails[],
  keys: string[],
  target: string,
  now: string,
): ClientDetails[] {
  const merged = new Set(keys)
  return details.map((d) => (merged.has(clientKey(d.client)) && d.client !== target ? { ...d, client: target, updatedAt: now } : d))
}
