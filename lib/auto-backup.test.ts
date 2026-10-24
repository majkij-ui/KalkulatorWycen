import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_BACKUP_FILES,
  autoBackupFolderName,
  autoBackupNotice,
  autoBackupsToPrune,
  parseAutoBackupName,
  runAutoBackup,
  type BackupFs,
} from './auto-backup'
import { PROJECTS_FILE } from './project-library'
import { EVENTS_FILE } from './events-store'
import { FINANCES_FILE } from './finances-store'
import { SUBSCRIPTIONS_FILE } from './subscriptions-store'
import { CAMPAIGNS_FILE } from './campaigns-store'
import { EQUIPMENT_FILE } from './equipment-catalog'
import { GEAR_KITS_FILE } from './gear-kits'
import { CREW_FILE, CREW_ROLES_FILE } from './crew-store'
import { CLIENT_GROUPS_FILE } from './client-groups-store'
import { RENTAL_ITEMS_FILE } from './rental-items-store'
import { CALL_SHEETS_FILE } from './call-sheets-store'
import { INBOX_DECISIONS_FILE } from './inbox-types'
import { COMPANY_FILE } from './company-settings-core'

test('kopia obejmuje każdy plik danych huba', () => {
  const all = [
    PROJECTS_FILE,
    EVENTS_FILE,
    FINANCES_FILE,
    SUBSCRIPTIONS_FILE,
    CAMPAIGNS_FILE,
    EQUIPMENT_FILE,
    GEAR_KITS_FILE,
    CREW_FILE,
    CREW_ROLES_FILE,
    CLIENT_GROUPS_FILE,
    RENTAL_ITEMS_FILE,
    CALL_SHEETS_FILE,
    INBOX_DECISIONS_FILE,
    COMPANY_FILE,
  ]
  assert.deepEqual([...AUTO_BACKUP_FILES].sort(), [...all].sort())
})

test('nazwa folderu: czas lokalny, minuty, zera wiodące', () => {
  assert.equal(autoBackupFolderName(new Date(2026, 0, 5, 7, 3)), 'auto-2026-01-05-0703')
  assert.equal(autoBackupFolderName(new Date(2026, 9, 16, 23, 59)), 'auto-2026-10-16-2359')
})

test('parsowanie nazwy: tylko nasze foldery', () => {
  assert.deepEqual(parseAutoBackupName('auto-2026-10-16-0905'), new Date(2026, 9, 16, 9, 5))
  for (const name of [
    'projects.2026-10-13T08-00-00-000Z.json', // kopia z `npm run data`
    'auto-2026-10-16',
    'auto-2026-10-16-0905-x',
    'xauto-2026-10-16-0905',
    'auto-2026-02-31-1200',
    'auto-2026-10-16-2460',
    'auto-2026-10-16-1260',
    'auto-2026-13-01-1200',
  ]) {
    assert.equal(parseAutoBackupName(name), null, name)
  }
})

const at = (d: number, h = 9, m = 0) => new Date(2026, 9, d, h, m)
const names = (dates: Date[]) => dates.map(autoBackupFolderName)

test('retencja: mniej niż 14 kopii — nic nie znika', () => {
  const list = names([at(1), at(2), at(3), at(16)])
  assert.deepEqual(autoBackupsToPrune(list, at(16, 12)), [])
})

test('retencja: 14 ostatnich zostaje nawet z jednego dnia', () => {
  const today = Array.from({ length: 20 }, (_, i) => at(16, 8, i))
  const pruned = autoBackupsToPrune(names(today), at(16, 12))
  // 14 najnowszych zostaje; najstarsze 6 z tego dnia odpada (najnowsza z dnia i tak jest w 14).
  assert.deepEqual(pruned.sort(), names(today.slice(0, 6)).sort())
})

test('retencja: wczorajsza kopia przeżywa wiele startów dzisiaj', () => {
  const yesterday = at(15, 18)
  const today = Array.from({ length: 20 }, (_, i) => at(16, 8, i))
  const pruned = autoBackupsToPrune(names([yesterday, ...today]), at(16, 12))
  assert.ok(!pruned.includes(autoBackupFolderName(yesterday)))
})

test('retencja: jedna na dzień przez 30 dni — najnowsza z dnia', () => {
  const now = new Date(2026, 10, 30, 12) // 30 listopada
  const list: Date[] = []
  for (let day = 0; day < 40; day++) {
    list.push(new Date(2026, 10, 30 - day, 8), new Date(2026, 10, 30 - day, 20))
  }
  const pruned = new Set(autoBackupsToPrune(names(list), now))
  const kept = names(list).filter((n) => !pruned.has(n))
  // 14 ostatnich (7 dni × 2) + po jednej z kolejnych 23 dni w oknie 30 dni.
  assert.equal(kept.length, 14 + 23)
  // dzień 30 dni temu (1 listopada) — w oknie, zostaje kopia 20:00, ta z 8:00 odpada
  assert.ok(kept.includes(autoBackupFolderName(new Date(2026, 10, 1, 20))))
  assert.ok(pruned.has(autoBackupFolderName(new Date(2026, 10, 1, 8))))
  // 31 października — poza oknem
  assert.ok(pruned.has(autoBackupFolderName(new Date(2026, 9, 31, 20))))
})

test('retencja: obce nazwy i kopie z przyszłości nigdy nie znikają', () => {
  const list = [
    'projects.2026-01-01T00-00-00-000Z.json',
    'auto-backup-notatki',
    autoBackupFolderName(new Date(2027, 0, 1)),
    ...names(Array.from({ length: 30 }, (_, i) => new Date(2026, 0, 1, 8, i))),
  ]
  const pruned = autoBackupsToPrune(list, at(16), { keepLast: 2, dailyDays: 30 })
  assert.ok(!pruned.includes('projects.2026-01-01T00-00-00-000Z.json'))
  assert.ok(!pruned.includes('auto-backup-notatki'))
  assert.ok(!pruned.includes(autoBackupFolderName(new Date(2027, 0, 1))))
  // z 30 styczniowych zostaje 1 (z kopią z przyszłości to 2 ostatnie); styczeń jest poza oknem 30 dni
  assert.equal(pruned.length, 29)
  // kopia z przyszłości zostaje także wtedy, gdy nie mieści się w „ostatnich"
  const future = autoBackupFolderName(new Date(2027, 0, 1))
  assert.deepEqual(autoBackupsToPrune([future], at(16), { keepLast: 0, dailyDays: 0 }), [])
})

/** System plików w pamięci. */
function memoryFs(initial: Record<string, string>, failOn: (op: string, path: string) => boolean = () => false) {
  const files = new Map(Object.entries(initial))
  const dirs = new Set<string>(['backups'])
  const guard = (op: string, path: string) => {
    if (failOn(op, path)) throw new Error(`${op} ${path}: odmowa`)
  }
  const fs: BackupFs = {
    async exists(path) {
      guard('exists', path)
      return files.has(path)
    },
    async readText(path) {
      guard('read', path)
      const content = files.get(path)
      if (content === undefined) throw new Error('brak pliku')
      return content
    },
    async writeText(path, content) {
      guard('write', path)
      files.set(path, content)
    },
    async mkdir(path) {
      guard('mkdir', path)
      dirs.add(path)
    },
    async listDirs(path) {
      guard('list', path)
      return [...dirs].filter((d) => d.startsWith(`${path}/`)).map((d) => d.slice(path.length + 1))
    },
    async removeDir(path) {
      guard('remove', path)
      dirs.delete(path)
      ;[...files.keys()].filter((f) => f.startsWith(`${path}/`)).forEach((f) => files.delete(f))
    },
  }
  return { fs, files, dirs }
}

test('kopia: każdy istniejący plik, tekst bez zmian, brakujące pominięte', async () => {
  const broken = '{"version":1,"items":[ uszkodzony'
  const { fs, files } = memoryFs({
    'projects.json': '{"version":1,"items":[]}',
    'events.json': broken,
    'quotes.json': '{"stary":"plik"}',
    'backups/projects.2026-10-13T08-00-00-000Z.json': '{}',
  })
  const result = await runAutoBackup(fs, at(16, 9, 5))
  assert.equal(result.ok, true)
  assert.equal(result.folder, 'backups/auto-2026-10-16-0905')
  assert.deepEqual(result.copied, ['projects.json', 'events.json'])
  assert.equal(files.get('backups/auto-2026-10-16-0905/events.json'), broken)
  assert.equal(files.get('backups/auto-2026-10-16-0905/projects.json'), '{"version":1,"items":[]}')
  assert.equal(files.has('backups/auto-2026-10-16-0905/quotes.json'), false)
  assert.equal(files.get('backups/projects.2026-10-13T08-00-00-000Z.json'), '{}')
  assert.equal(files.get('projects.json'), '{"version":1,"items":[]}')
})

test('kopia: świeża instalacja — nic nie tworzy', async () => {
  const { fs, dirs } = memoryFs({})
  const result = await runAutoBackup(fs, at(16))
  assert.equal(result.ok, true)
  assert.equal(result.folder, null)
  assert.deepEqual([...dirs], ['backups'])
})

test('kopia: sprząta stare foldery auto-, nie dotyka reszty', async () => {
  const { fs, dirs } = memoryFs({ 'projects.json': '{}' })
  for (let i = 0; i < 16; i++) dirs.add(`backups/${autoBackupFolderName(new Date(2026, 0, 1, 8, i))}`)
  dirs.add('backups/reczna-kopia')
  const result = await runAutoBackup(fs, at(16), { keepLast: 14, dailyDays: 30 })
  assert.equal(result.ok, true)
  // 16 starych + nowa = 17; zostaje 14 → 3 najstarsze znikają
  assert.deepEqual(result.pruned.sort(), ['auto-2026-01-01-0800', 'auto-2026-01-01-0801', 'auto-2026-01-01-0802'])
  assert.ok(dirs.has('backups/reczna-kopia'))
  assert.ok(dirs.has('backups/auto-2026-10-16-0900'))
})

test('kopia: błąd zapisu pliku → nie ok, stare kopie nietknięte', async () => {
  const { fs, dirs } = memoryFs({ 'projects.json': '{}', 'events.json': '{}' }, (op, path) =>
    op === 'write' && path.endsWith('/events.json')
  )
  for (let i = 0; i < 20; i++) dirs.add(`backups/${autoBackupFolderName(new Date(2026, 0, 1, 8, i))}`)
  const result = await runAutoBackup(fs, at(16))
  assert.equal(result.ok, false)
  assert.deepEqual(result.copied, ['projects.json'])
  assert.deepEqual(result.failed.map((f) => f.file), ['events.json'])
  assert.deepEqual(result.pruned, [])
  assert.equal(dirs.size, 1 + 20 + 1)
  assert.match(autoBackupNotice(result) ?? '', /nie skopiowano: events\.json/)
})

test('kopia: brak uprawnień do folderu → wynik z błędem, bez wyjątku', async () => {
  const { fs } = memoryFs({ 'projects.json': '{}' }, (op) => op === 'mkdir')
  const result = await runAutoBackup(fs, at(16))
  assert.equal(result.ok, false)
  assert.equal(result.folder, null)
  assert.match(result.error ?? '', /odmowa/)
  assert.match(autoBackupNotice(result) ?? '', /Nie udało się zrobić automatycznej kopii/)
})

test('kopia: błąd sprzątania nie psuje kopii', async () => {
  const { fs } = memoryFs({ 'projects.json': '{}' }, (op) => op === 'list')
  const result = await runAutoBackup(fs, at(16))
  assert.equal(result.ok, true)
  assert.match(result.pruneError ?? '', /odmowa/)
  assert.equal(autoBackupNotice(result), null)
})

test('kopia: drugi start w tej samej minucie nadpisuje tę samą kopię', async () => {
  const { fs, files } = memoryFs({ 'projects.json': 'v1' })
  await runAutoBackup(fs, at(16, 9, 5))
  files.set('projects.json', 'v2')
  const result = await runAutoBackup(fs, at(16, 9, 5))
  assert.equal(result.ok, true)
  assert.deepEqual(result.pruned, [])
  assert.equal(files.get('backups/auto-2026-10-16-0905/projects.json'), 'v2')
})
