/**
 * U1 (decyzja M.J. U1/1, plan §19): zatwierdzona cena zamraża się przy
 * przyjęciu zlecenia. Projekty przyjęte PRZED U1 (W realizacji / Zrealizowany,
 * z wyceną) nie mają jej zapisanej — bez patcha ich cena dalej szłaby za PDF.
 * Patch zamraża DZISIEJSZĄ sumę PDF wybranego wariantu (albo kalkulatora bez
 * szkicu PDF), więc żaden przychód się nie rusza; `financials` przeliczone tymi
 * samymi regułami (zmienia się tylko `revenueSource` → `approved` / `transfer`).
 *
 * Skrypt TYLKO CZYTA folder danych i wypisuje patch dla `npm run data -- apply`
 * (na stdout) oraz listę zmian (na stderr). M.J. edytuje na żywo — uruchamiaj
 * tuż przed zastosowaniem, przy zamkniętym hubie:
 *
 *   node --import ./scripts/register-ts.mjs scripts/u1-approved-price-patch.mts [folder] > imports/2026-10-24-u1-approved-price.json
 *   npm run data -- apply imports/2026-10-24-u1-approved-price.json --dry-run
 *
 * Projekt, któremu przeliczenie ruszyłoby przychód, koszty albo moją pracę o
 * grosz lub więcej, NIE trafia do patcha (lista na stderr: „pominięty") —
 * żadna liczba nie zmienia się po cichu.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { withFrozenPrice } from '../lib/approved-price'
import { countsTowardRevenue, projectSchema } from '../lib/project-types'
import { approvedPriceRecord, computeSnapshotFinancials, type FinancialsSource } from '../lib/quote-financials'

const dir = process.argv[2] ?? join(homedir(), 'Library', 'Application Support', 'com.michal.nonoisehub')
const path = join(dir, 'projects.json')
if (!existsSync(path)) {
  console.error(`Brak ${path}`)
  process.exit(1)
}
const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown[] }
const now = new Date()
const at = now.toISOString()
const differs = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) >= 0.005
const zl = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`

const updates: { id: string; set: Record<string, unknown> }[] = []
for (const item of raw.items ?? []) {
  const parsed = projectSchema.safeParse(item)
  if (!parsed.success) continue
  const p = parsed.data
  if (p.deletedAt || !p.quote || !countsTowardRevenue(p.status)) continue
  const data = (p.quote as { data?: { approvedPrice?: unknown } }).data
  if (!data || approvedPriceRecord(data.approvedPrice)) continue
  // Z surowego rekordu (passthrough) — patch nie gubi żadnego pola migawki.
  const rawQuote = (item as { quote?: unknown }).quote as NonNullable<typeof p.quote>
  const quote = withFrozenPrice(rawQuote, at)
  if (quote === rawQuote) continue
  const next = computeSnapshotFinancials(quote as FinancialsSource, now)
  const stored = p.financials
  const price = (quote as { data: { approvedPrice: { pln: number; source: string } } }).data.approvedPrice
  if (!next) continue
  if (stored && (differs(next.sumaNetto, stored.sumaNetto) || differs(next.koszty, stored.koszty) || differs(next.ownWork, stored.ownWork))) {
    console.error(`POMINIĘTY ${p.name} (${p.status}): przeliczenie ruszyłoby plan ${zl(stored.sumaNetto)} → ${zl(next.sumaNetto)} — do wyjaśnienia`)
    continue
  }
  updates.push({ id: p.id, set: { quote, financials: next } })
  console.error(
    `${p.name} (${p.status}): zatwierdzona cena ${zl(price.pln)} [${price.source}], przychód planu ${zl(next.sumaNetto)} [${next.revenueSource}] — bez zmian`
  )
}
console.error(`${updates.length} ${updates.length === 1 ? 'projekt' : 'projekty/ów'} do zamrożenia ceny.`)
console.log(
  JSON.stringify(
    {
      note: `U1: zatwierdzona cena = dzisiejsza suma PDF przyjętych zleceń (decyzja U1/1) — ${updates.length} projektów, wygenerowane ${at}`,
      update: { 'projects.json': updates },
    },
    null,
    2
  )
)
