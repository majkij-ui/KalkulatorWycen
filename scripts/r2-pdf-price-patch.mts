/**
 * R2 (decyzja M.J. 13.2a/5): finanse projektu liczą się z sumy PDF. Zapisane
 * `financials` (zamrożony plan) zmieniają się dopiero przy następnym zapisie
 * wyceny, więc te, które reguła PDF przesuwa, poprawia jawny patch — żeby nic
 * nie ruszyło się „samo" przy pierwszej edycji.
 *
 * Skrypt TYLKO CZYTA folder danych i wypisuje patch dla `npm run data -- apply`
 * (na stdout) oraz listę zmian (na stderr). Uruchamiaj tuż przed zastosowaniem
 * (M.J. edytuje na żywo), przy zamkniętym hubie:
 *
 *   node --import ./scripts/register-ts.mjs scripts/r2-pdf-price-patch.mts [folder] > imports/2026-10-18-r2-pdf-price.json
 *   npm run data -- apply imports/2026-10-18-r2-pdf-price.json --dry-run
 *
 * Patch ustawia `financials` tylko tam, gdzie liczby (przychód, koszty, moja
 * praca) różnią się od zapisanych o co najmniej grosz.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { projectSchema } from '../lib/project-types'
import { computeSnapshotFinancials, type FinancialsSource } from '../lib/quote-financials'

const dir = process.argv[2] ?? join(homedir(), 'Library', 'Application Support', 'com.michal.nonoisehub')
const path = join(dir, 'projects.json')
if (!existsSync(path)) {
  console.error(`Brak ${path}`)
  process.exit(1)
}
const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown[] }
const now = new Date()
const differs = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) >= 0.005
const zl = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`

const updates: { id: string; set: Record<string, unknown> }[] = []
for (const item of raw.items ?? []) {
  const parsed = projectSchema.safeParse(item)
  if (!parsed.success) continue
  const p = parsed.data
  if (p.deletedAt || !p.quote) continue
  const next = computeSnapshotFinancials(p.quote as FinancialsSource, now)
  const stored = p.financials
  if (!next || !stored) continue
  if (!differs(next.sumaNetto, stored.sumaNetto) && !differs(next.koszty, stored.koszty) && !differs(next.ownWork, stored.ownWork)) continue
  updates.push({ id: p.id, set: { financials: next } })
  console.error(
    `${p.name} (${p.status}): przychód ${zl(stored.sumaNetto)} → ${zl(next.sumaNetto)} [${next.revenueSource}]` +
      (differs(next.koszty, stored.koszty) ? `, koszty ${zl(stored.koszty)} → ${zl(next.koszty)}` : '') +
      (differs(next.ownWork, stored.ownWork) ? `, moja praca ${zl(stored.ownWork ?? 0)} → ${zl(next.ownWork ?? 0)}` : '')
  )
}
console.error(`${updates.length} ${updates.length === 1 ? 'projekt' : 'projekty/ów'} do poprawy.`)
console.log(
  JSON.stringify(
    {
      note: `R2: finanse z sumy PDF (decyzja 13.2a/5) — ${updates.length} projektów, wygenerowane ${now.toISOString()}`,
      update: { 'projects.json': updates },
    },
    null,
    2
  )
)
