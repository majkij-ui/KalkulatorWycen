/**
 * Cena końcowa (decyzja M.J. 2026-11-05): wyceny zapisane przed zmianą (YoPro,
 * Misty Cliffs for WOO, Z natury gościnni) mają w `financials` / `approvedPrice`
 * sumę PDF zamiast faktur. Realizacja i Finanse projektu czytają już cenę z
 * faktur przy odczycie (`final-price.ts`), ale ekrany czytające `financials`
 * wprost (rozbicie płatności, Klienci bez pętli) widzą jeszcze starą kwotę.
 * Patch zapisuje sumę faktur w wycenie (`approvedPrice`, źródło `import` —
 * to retro-projekty zbudowane z faktur) i przelicza `financials`.
 *
 * Skrypt TYLKO CZYTA folder danych i wypisuje patch dla `npm run data -- apply`
 * (stdout) oraz listę zmian (stderr). Uruchamiaj przy zamkniętym hubie:
 *
 *   node --import ./scripts/register-ts.mjs scripts/final-price-patch.mts [folder] > imports/2026-11-05-cena-koncowa.json
 *   npm run data -- apply imports/2026-11-05-cena-koncowa.json --dry-run
 *
 * Projekt, któremu przeliczenie ruszyłoby koszty albo moją pracę, NIE trafia do
 * patcha (lista na stderr: „pominięty").
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { finalPrice, overrideFinalPrice, quotePriceRecord } from '../lib/final-price'
import { projectSchema } from '../lib/project-types'
import { computeSnapshotFinancials, snapshotPlanRevenue, type FinancialsSource } from '../lib/quote-financials'
import type { MoneyEvent } from '../lib/money-loop'

const dir = process.argv[2] ?? join(homedir(), 'Library', 'Application Support', 'com.michal.nonoisehub')
const read = (file: string) => {
  const path = join(dir, file)
  if (!existsSync(path)) {
    console.error(`Brak ${path}`)
    process.exit(1)
  }
  return (JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown[] }).items ?? []
}
const events = read('events.json') as MoneyEvent[]
const now = new Date()
const at = now.toISOString()
const today = at.slice(0, 10)
const differs = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) >= 0.005
const zl = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`

const updates: { id: string; set: Record<string, unknown> }[] = []
for (const item of read('projects.json')) {
  const parsed = projectSchema.safeParse(item)
  if (!parsed.success) continue
  const p = parsed.data
  if (p.deletedAt || !p.quote) continue
  const rawQuote = (item as { quote?: unknown }).quote as NonNullable<typeof p.quote>
  const final = finalPrice(p, quotePriceRecord(rawQuote), events, today)
  if (!final || final.source !== 'invoices') continue
  const stored = snapshotPlanRevenue(rawQuote as FinancialsSource)?.pln
  if (stored === undefined || !differs(stored, final.pln) || Math.abs(stored - final.pln) < 0.5) continue
  // Rekord ceny z faktur: `import` (retro-projekt zbudowany z faktur), nie `override` — nowa faktura dalej wygrywa przy odczycie.
  const stamped = overrideFinalPrice(rawQuote, final.pln, at) as unknown as { data: { approvedPrice: { source: string } } }
  stamped.data.approvedPrice = { ...stamped.data.approvedPrice, source: 'import' }
  const next = computeSnapshotFinancials(stamped as unknown as FinancialsSource, now)
  if (!next) continue
  const old = p.financials
  if (old && (differs(next.koszty, old.koszty) || differs(next.ownWork, old.ownWork))) {
    console.error(`POMINIĘTY ${p.name} (${p.status}): przeliczenie ruszyłoby koszty / moją pracę — do wyjaśnienia`)
    continue
  }
  updates.push({ id: p.id, set: { quote: stamped, financials: next } })
  console.error(`${p.name} (${p.status}): plan ${zl(stored)} → ${zl(final.pln)} (${final.label}), koszty bez zmian ${zl(next.koszty)}`)
}
console.error(`${updates.length} projektów do zapisania ceny z faktur.`)
console.log(
  JSON.stringify(
    {
      note: `Cena końcowa: suma faktur w wycenie i finansach ${updates.length} retro-projektów (decyzja M.J. 2026-11-05) — wygenerowane ${at}`,
      update: { 'projects.json': updates },
    },
    null,
    2
  )
)
