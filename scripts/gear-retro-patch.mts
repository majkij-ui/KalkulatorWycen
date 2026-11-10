/**
 * Sprzęt retro 2021–2024 (10.11.2026): patch z wyboru zestawów i projektów
 * zrobionego w jednorazowym narzędziu. Reguły: `lib/gear-retro.ts`
 * i docs/PLAN-W-WYCENA-REALIZACJA.md („Sprzęt retro 2021–2024").
 *
 * Skrypt TYLKO CZYTA folder danych, wypisuje patch dla `npm run data -- apply`
 * (stdout) i podsumowanie (stderr). Uruchamiaj przy zamkniętym hubie:
 *
 *   node --import ./scripts/register-ts.mjs scripts/gear-retro-patch.mts <wybor.json> [folder] > imports/<nazwa>.json
 *   npm run data -- apply imports/<nazwa>.json --dry-run
 *
 * Wybór: { kits: { klucz: { name, price, items: [idPozycji] } },
 *          projects: [{ id, kit, days, percent?, postOnly? }],
 *          equipmentDates?: { idPozycji: "YYYY-MM-DD" } }
 *
 * Finanse (przychód, koszty, wynik) się nie zmieniają: patch dotyka tylko
 * `gearDays` / `gearEarnedOverride` projektów, kalendarza i dat zakupu sprzętu.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eventSchema } from '../lib/event-types'
import { planGearRetro, type RetroSelection } from '../lib/gear-retro'
import { moneyLedger } from '../lib/money-loop'
import { equipmentItemSchema, projectSchema } from '../lib/project-types'

const selectionPath = process.argv[2]
if (!selectionPath) {
  console.error('Użycie: gear-retro-patch.mts <wybor.json> [folder-danych] > imports/<nazwa>.json')
  process.exit(1)
}
const dir = process.argv[3] ?? join(homedir(), 'Library', 'Application Support', 'com.michal.nonoisehub')
const readItems = (file: string): unknown[] => {
  const path = join(dir, file)
  if (!existsSync(path)) {
    console.error(`Brak ${path}`)
    process.exit(1)
  }
  return (JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown[] }).items ?? []
}
const parseAll = <T,>(file: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }) =>
  readItems(file).flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data as T] : []
  })

const selection = JSON.parse(readFileSync(selectionPath, 'utf8')) as RetroSelection
const projects = parseAll('projects.json', projectSchema)
const events = parseAll('events.json', eventSchema)
const equipment = parseAll('equipment.json', equipmentItemSchema)
const now = new Date()
const today = now.toISOString().slice(0, 10)

// Przychód netto projektu w zł — ta sama liczba, którą pokazują Finanse.
const wanted = new Set(selection.projects.map((p) => p.id))
const ledger = moneyLedger(
  projects.filter((p) => wanted.has(p.id)),
  events,
  today
)
const revenue = new Map(ledger.map((m) => [m.id, m.revenue]))

let plan
try {
  plan = planGearRetro({ selection, projects, events, equipment, revenue, now: now.toISOString() })
} catch (error) {
  console.error(`✗ ${(error as Error).message}`)
  process.exit(1)
}

const zl = (n: number) => `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
const { report } = plan
console.error(`Zmienione: ${report.changed.length}, pominięte: ${report.skipped.length}`)
report.changed.forEach((line) => console.error(`  + ${line}`))
report.skipped.forEach((line) => console.error(`  = pominięty ${line}`))
report.leftOut.forEach((line) => console.error(`  ! poza projektem: ${line}`))
report.warnings.forEach((line) => console.error(`  ! ${line}`))
console.error('\nPer pozycja (dni · Odpracował · Zarobił):')
const names = new Map(equipment.map((item) => [item.id, item.name]))
;[...report.perItem.entries()].forEach(([id, total]) =>
  console.error(`  ${names.get(id) ?? id}: ${total.days} dni · ${zl(total.worked)} · ${zl(total.earned)}`)
)
console.error(
  `\nKalendarz: ${plan.eventUpserts.length} nowych dni, ${plan.eventUpdates.length} zmienionych wydarzeń; katalog: ${plan.equipment.length} dat zakupu.`
)

const update: Record<string, unknown[]> = {}
if (plan.projects.length) update['projects.json'] = plan.projects
if (plan.eventUpdates.length) update['events.json'] = plan.eventUpdates
if (plan.equipment.length) update['equipment.json'] = plan.equipment
console.log(
  JSON.stringify(
    {
      note: `Sprzęt retro 2021–2024: ${report.changed.length} projektów (wybór ${selectionPath}) — wygenerowane ${now.toISOString()}`,
      ...(plan.eventUpserts.length ? { upsert: { 'events.json': plan.eventUpserts } } : {}),
      update,
    },
    null,
    2
  )
)
