/**
 * Automatyczna kopia danych przy starcie aplikacji (F1).
 *
 * Przy każdym starcie wszystkie pliki danych huba trafiają do
 * `backups/auto-<RRRR-MM-DD-GGmm>/`. Kopiujemy TEKST pliku bez parsowania —
 * uszkodzony plik też ląduje w kopii, a kopia jest bajt w bajt tym, co leżało
 * na dysku.
 *
 * Retencja (potwierdzona przez M.J. 2026-10-16, jedna stała): zostaje 14 ostatnich kopii ORAZ
 * najnowsza kopia z każdego dnia z ostatnich 30 dni. Kilka startów dziennie nie
 * wypycha więc wczorajszej kopii, a po wypadku wciąż jest kopia sprzed godziny.
 *
 * Zasady:
 *  - dotykamy wyłącznie folderów `auto-…` o poprawnej nazwie; kopie
 *    `backups/*.json` robione przez `npm run data` są nietykalne,
 *  - stare kopie usuwamy tylko po UDANEJ nowej kopii (nieudane starty nie
 *    zjadają historii),
 *  - nic nie rzuca: wynik mówi, co się udało, a aplikacja startuje zawsze.
 *
 * Ta część jest czysta (system plików wstrzykiwany) — testy w
 * `auto-backup.test.ts`. Podpięcie do Tauri: `auto-backup-tauri.ts`.
 */

/** Pliki danych huba (kolekcje + ustawienia firmy). Brakujący plik jest pomijany. */
export const AUTO_BACKUP_FILES = [
  'projects.json',
  'events.json',
  'finances.json',
  'subscriptions.json',
  'campaigns.json',
  'equipment.json',
  'gear-kits.json',
  'crew.json',
  'crew-roles.json',
  'client-groups.json',
  'call-sheets.json',
  'inbox-decisions.json',
  'company.json',
] as const

export const BACKUPS_DIR = 'backups'
export const AUTO_BACKUP_PREFIX = 'auto-'

export interface RetentionPolicy {
  /** Ile ostatnich kopii zostaje zawsze. */
  keepLast: number
  /** Z ilu ostatnich dni zostaje najnowsza kopia każdego dnia. */
  dailyDays: number
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepLast: 14, dailyDays: 30 }

const pad = (n: number) => String(n).padStart(2, '0')

/** `auto-2026-10-16-0905` w czasie lokalnym. */
export function autoBackupFolderName(date: Date): string {
  return `${AUTO_BACKUP_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`
}

const NAME_PATTERN = /^auto-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/

/** Data z nazwy folderu kopii albo `null`, gdy to nie nasz folder. */
export function parseAutoBackupName(name: string): Date | null {
  const m = NAME_PATTERN.exec(name)
  if (!m) return null
  const [year, month, day, hours, minutes] = m.slice(1).map(Number)
  const date = new Date(year, month - 1, day, hours, minutes)
  // 2026-02-31 itp. — Date przesunąłby datę; taki folder nie jest nasz.
  if (date.getMonth() !== month - 1 || date.getDate() !== day || hours > 23 || minutes > 59) return null
  return date
}

const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/**
 * Foldery kopii do usunięcia. Nazwy spoza wzorca `auto-RRRR-MM-DD-GGmm` nigdy
 * nie trafiają na listę. Kopie z przyszłości (przestawiony zegar) zostają.
 */
export function autoBackupsToPrune(
  names: string[],
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION
): string[] {
  const dated = names
    .map((name) => ({ name, date: parseAutoBackupName(name) }))
    .filter((entry): entry is { name: string; date: Date } => entry.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.name.localeCompare(a.name))

  const keep = new Set<string>()
  dated.slice(0, Math.max(0, policy.keepLast)).forEach((entry) => keep.add(entry.name))

  const oldestDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (policy.dailyDays - 1))
  const seenDays = new Set<string>()
  dated.forEach((entry) => {
    if (entry.date.getTime() > now.getTime()) {
      keep.add(entry.name)
      return
    }
    if (policy.dailyDays <= 0 || entry.date.getTime() < oldestDay.getTime()) return
    const key = dayKey(entry.date)
    if (seenDays.has(key)) return
    seenDays.add(key)
    keep.add(entry.name) // lista jest od najnowszych, więc to najnowsza kopia tego dnia
  })

  return dated.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name)
}

/** Minimalny system plików (ścieżki względem folderu danych huba). */
export interface BackupFs {
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string>
  writeText: (path: string, content: string) => Promise<void>
  mkdir: (path: string) => Promise<void>
  /** Nazwy folderów w `path`. */
  listDirs: (path: string) => Promise<string[]>
  removeDir: (path: string) => Promise<void>
}

export interface AutoBackupResult {
  /** `true`, gdy każdy istniejący plik danych jest w kopii. */
  ok: boolean
  /** Folder kopii (`backups/auto-…`), `null` gdy nie było czego kopiować albo zapis padł. */
  folder: string | null
  copied: string[]
  failed: { file: string; error: string }[]
  pruned: string[]
  /** Błąd retencji — nie psuje kopii, tylko zostawia stare foldery. */
  pruneError?: string
  error?: string
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Robi kopię i (po sukcesie) sprząta stare. Nigdy nie rzuca. */
export async function runAutoBackup(
  fs: BackupFs,
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  files: readonly string[] = AUTO_BACKUP_FILES
): Promise<AutoBackupResult> {
  const result: AutoBackupResult = { ok: false, folder: null, copied: [], failed: [], pruned: [] }
  try {
    const present: string[] = []
    for (const file of files) {
      if (await fs.exists(file)) present.push(file)
    }
    if (present.length === 0) {
      // Świeża instalacja — nic do kopiowania i nic do sprzątania.
      result.ok = true
      return result
    }

    const folder = `${BACKUPS_DIR}/${autoBackupFolderName(now)}`
    await fs.mkdir(folder)
    for (const file of present) {
      try {
        await fs.writeText(`${folder}/${file}`, await fs.readText(file))
        result.copied.push(file)
      } catch (error) {
        result.failed.push({ file, error: message(error) })
      }
    }
    result.folder = folder
    result.ok = result.failed.length === 0
  } catch (error) {
    result.error = message(error)
    return result
  }

  if (!result.ok) return result
  try {
    const current = result.folder?.slice(BACKUPS_DIR.length + 1)
    const names = await fs.listDirs(BACKUPS_DIR)
    for (const name of autoBackupsToPrune(names, now, policy)) {
      if (name === current) continue
      await fs.removeDir(`${BACKUPS_DIR}/${name}`)
      result.pruned.push(name)
    }
  } catch (error) {
    result.pruneError = message(error)
  }
  return result
}

/** Komunikat dla użytkownika, gdy kopia się nie udała (albo `null`). */
export function autoBackupNotice(result: AutoBackupResult): string | null {
  if (result.ok) return null
  const what = result.failed.length
    ? `nie skopiowano: ${result.failed.map((f) => f.file).join(', ')}`
    : (result.error ?? 'nieznany błąd')
  return `Nie udało się zrobić automatycznej kopii danych (${what}). Aplikacja działa normalnie; spróbuj uruchomić ją ponownie.`
}
