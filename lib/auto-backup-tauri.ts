'use client'

/**
 * Automatyczna kopia przy starcie — podpięcie do systemu plików Tauri.
 * Logika i retencja: `auto-backup.ts`. W przeglądarce nic nie robi (dane
 * podglądu żyją w localStorage i nie są prawdziwymi danymi).
 *
 * Uprawnienia (`src-tauri/capabilities/default.json`): odczyt, zapis, mkdir i
 * listowanie w `$APPDATA/**` już były; usuwanie wolno WYŁĄCZNIE w
 * `$APPDATA/backups/auto-*`.
 */

import { BaseDirectory, exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { isTauriRuntime } from './storage'
import { autoBackupNotice, runAutoBackup, type AutoBackupResult, type BackupFs } from './auto-backup'
import { pushNotice } from './app-notices'

const baseDir = BaseDirectory.AppData

const tauriFs: BackupFs = {
  exists: (path) => exists(path, { baseDir }),
  readText: (path) => readTextFile(path, { baseDir }),
  writeText: (path, content) => writeTextFile(path, content, { baseDir }),
  mkdir: (path) => mkdir(path, { baseDir, recursive: true }),
  listDirs: async (path) => (await readDir(path, { baseDir })).filter((e) => e.isDirectory).map((e) => e.name),
  removeDir: (path) => remove(path, { baseDir, recursive: true }),
}

let last: { at: string; result: AutoBackupResult; dir: string | null } | null = null

/** Ostatnia kopia z tej sesji (Ustawienia). */
export function lastAutoBackup() {
  return last
}

/** Kopia przy starcie. Nigdy nie rzuca; porażka = komunikat w oknie. */
export async function startupBackup(now: Date = new Date()): Promise<AutoBackupResult | null> {
  if (!isTauriRuntime()) return null
  const result = await runAutoBackup(tauriFs, now)
  let dir: string | null = null
  try {
    dir = await appDataDir()
  } catch {
    dir = null
  }
  last = { at: now.toISOString(), result, dir }
  const notice = autoBackupNotice(result)
  if (notice) pushNotice('auto-backup', notice)
  if (result.pruneError) console.warn('[kopia] sprzątanie starych kopii nie powiodło się:', result.pruneError)
  return result
}
