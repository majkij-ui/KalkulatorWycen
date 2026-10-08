/**
 * Most Claude ↔ aplikacja desktopowa (plan §5a): zapis do plików danych huba
 * przez TE SAME schematy Zod, których używa aplikacja.
 *
 *   npm run data -- apply <patch.json> [--dir <folder>] [--dry-run]
 *
 * Patch:
 *   {
 *     "note": "co i skąd",
 *     "upsert": { "events.json": [ ...rekordy ], "campaigns.json": [...] },
 *     "update": { "projects.json": [ { "id": "p-…", "set": { "leadSource": "google_ads" }, "ifMissing": true } ] }
 *   }
 *
 * Zasady:
 *  - Rekord, którego schemat nie przyjmie, ALBO który schemat by po cichu
 *    „poprawił" (`.catch` podmieniłby wartość), zatrzymuje cały zapis. Aplikacja
 *    czyta defensywnie i takie rzeczy by połknęła — tu mają być głośne.
 *  - `upsert` po `id`: ponowne uruchomienie tego samego patcha niczego nie dubluje.
 *  - `update` zmienia tylko podane pola; `ifMissing` = tylko te, których rekord
 *    jeszcze nie ma (nie nadpisuje decyzji użytkownika).
 *  - Przed zapisem każdy zmieniany plik trafia do `backups/<plik>.<czas>.json`.
 *    Bez kopii — bez zapisu.
 *  - Zapis do folderu huba odmawia, gdy aplikacja jest otwarta: trzyma projekty
 *    w pamięci i jej następny zapis nadpisałby patch.
 *
 * Domyślny folder: dane „NonoiseMedia Hub" (`com.michal.nonoisehub`).
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import { eventSchema } from '../lib/event-types'
import { campaignSchema } from '../lib/marketing-types'
import { equipmentItemSchema, fixedCostSchema, projectSchema, PROJECT_SCHEMA_VERSION } from '../lib/project-types'

const HUB_DIR = join(homedir(), 'Library', 'Application Support', 'com.michal.nonoisehub')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SCHEMAS: Record<string, z.ZodType<any, z.ZodTypeDef, any>> = {
  'projects.json': projectSchema,
  'events.json': eventSchema,
  'finances.json': fixedCostSchema,
  'campaigns.json': campaignSchema,
  'equipment.json': equipmentItemSchema,
}

type Item = Record<string, unknown> & { id: string }

interface Patch {
  note?: string
  upsert?: Record<string, Item[]>
  update?: Record<string, { id: string; set: Record<string, unknown>; ifMissing?: boolean }[]>
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** Waliduje rekord i sprawdza, że schemat niczego w nim nie podmienił. */
function strictParse(file: string, item: unknown, where: string, keys?: string[]): Item {
  const schema = SCHEMAS[file]
  const parsed = schema.safeParse(item)
  if (!parsed.success) fail(`${where}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const input = item as Record<string, unknown>
  const output = parsed.data as Record<string, unknown>
  for (const key of keys ?? Object.keys(input)) {
    if (input[key] === undefined) continue
    if (!isDeepStrictEqual(input[key], output[key])) {
      fail(`${where}: schemat poprawiłby pole „${key}" (${JSON.stringify(input[key])} → ${JSON.stringify(output[key])})`)
    }
  }
  return output as Item
}

function readCollection(dir: string, file: string): { exists: boolean; items: Item[] } {
  const path = join(dir, file)
  if (!existsSync(path)) return { exists: false, items: [] }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown }
  if (!Array.isArray(raw.items)) fail(`${file}: nieznany format pliku (brak "items")`)
  return { exists: true, items: raw.items as Item[] }
}

/** Czy NonoiseMedia Hub jest uruchomiony (macOS, `pgrep`). */
function hubIsRunning(): boolean {
  try {
    execFileSync('pgrep', ['-f', 'NonoiseMedia Hub.app/Contents/MacOS/'], { stdio: 'ignore' })
    return true
  } catch {
    return false // pgrep kończy się kodem 1, gdy nic nie znalazł
  }
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function apply(patchPath: string, dir: string, dryRun: boolean) {
  const patch = JSON.parse(readFileSync(patchPath, 'utf8')) as Patch
  const files = new Set([...Object.keys(patch.upsert ?? {}), ...Object.keys(patch.update ?? {})])
  for (const file of files) if (!SCHEMAS[file]) fail(`nieznany plik kolekcji: ${file}`)
  if (!existsSync(dir)) fail(`folder danych nie istnieje: ${dir}`)

  console.log(`${dryRun ? '[próba] ' : ''}${patch.note ?? patchPath}`)
  console.log(`folder: ${dir}\n`)

  const results: { file: string; exists: boolean; items: Item[]; summary: string; changed: boolean }[] = []
  for (const file of files) {
    const { exists, items } = readCollection(dir, file)
    const byId = new Map(items.map((item) => [item.id, item]))
    let added = 0
    let replaced = 0
    let unchanged = 0
    let updated = 0

    ;(patch.upsert?.[file] ?? []).forEach((raw, i) => {
      const item = strictParse(file, raw, `${file} upsert[${i}] (${(raw as Item).id ?? 'bez id'})`)
      const existing = byId.get(item.id)
      if (!existing) added += 1
      else if (isDeepStrictEqual(existing, item)) unchanged += 1
      else replaced += 1
      byId.set(item.id, item)
    })

    ;(patch.update?.[file] ?? []).forEach(({ id, set, ifMissing }, i) => {
      const existing = byId.get(id)
      if (!existing) fail(`${file} update[${i}]: nie ma rekordu ${id}`)
      const changes = Object.fromEntries(
        Object.entries(set).filter(([key]) => !ifMissing || isEmpty(existing[key]))
      )
      if (Object.keys(changes).length === 0) {
        unchanged += 1
        return
      }
      const next = strictParse(file, { ...existing, ...changes }, `${file} update[${i}] (${id})`, Object.keys(changes))
      byId.set(id, next)
      updated += 1
    })

    // Kolejność istniejących rekordów zostaje; nowe na końcu (aplikacja i tak sortuje przy odczycie).
    const order = [...items.map((i) => i.id), ...[...byId.keys()].filter((id) => !items.some((i) => i.id === id))]
    const next = order.map((id) => byId.get(id)!)
    results.push({
      file,
      exists,
      items: next,
      changed: added + replaced + updated > 0,
      summary: `${file}: +${added} nowe, ${replaced} zastąpione, ${updated} zmienione, ${unchanged} bez zmian (razem ${next.length})`,
    })
  }

  results.forEach((r) => console.log(r.summary))
  if (dryRun) {
    console.log('\nPróba — nic nie zapisano.')
    return
  }
  const toWrite = results.filter((r) => r.changed)
  if (toWrite.length === 0) {
    console.log('\nNic do zmiany — pliki nietknięte.')
    return
  }
  if (dir === HUB_DIR && hubIsRunning()) {
    fail('NonoiseMedia Hub jest otwarty — zamknij aplikację i uruchom ponownie (inaczej jej zapis nadpisze patch).')
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(dir, 'backups')
  mkdirSync(backupDir, { recursive: true })
  for (const r of toWrite) {
    if (!r.exists) continue
    const backup = join(backupDir, `${r.file.replace(/\.json$/, '')}.${stamp}.json`)
    copyFileSync(join(dir, r.file), backup)
    if (!existsSync(backup)) fail(`nie udało się zrobić kopii ${r.file} — nic nie zapisano`)
  }
  for (const r of toWrite) {
    writeFileSync(join(dir, r.file), JSON.stringify({ version: PROJECT_SCHEMA_VERSION, items: r.items }, null, 2))
  }
  console.log(`\n✓ Zapisano. Kopie zapasowe: ${backupDir} (${stamp})`)
}

const [command, patchPath, ...rest] = process.argv.slice(2)
if (command !== 'apply' || !patchPath) {
  console.log('Użycie: npm run data -- apply <patch.json> [--dir <folder>] [--dry-run]')
  process.exit(command ? 1 : 0)
}
const dirFlag = rest.indexOf('--dir')
apply(patchPath, dirFlag >= 0 ? rest[dirFlag + 1] : HUB_DIR, rest.includes('--dry-run'))
