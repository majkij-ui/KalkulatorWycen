import { writeTextFile, readTextFile, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { appDataDir } from '@tauri-apps/api/path'
import type { PersistedAppSettings, QuoteData, SavedTemplate } from './quote-types'
import type { PricingConfigShape } from './pricing-config'

const SETTINGS_FILE = 'settings.json'

export function isTauriRuntime(): boolean {
  return isTauri()
}

// plugin-fs does NOT create the base directory: on a fresh install
// $APPDATA/<identifier> doesn't exist yet, so every write fails with
// "No such file or directory". Ensure it exists once before the first write.
let appDataDirEnsured = false
async function ensureAppDataDir(): Promise<void> {
  if (appDataDirEnsured) return
  const dir = await appDataDir()
  await mkdir(dir, { recursive: true }) // no-op when the directory already exists
  appDataDirEnsured = true
}

/** Zapis dowolnego obiektu JSON do katalogu aplikacji (AppData). */
export async function writeJsonFile<T>(
  fileName: string,
  data: T,
  baseDir: BaseDirectory = BaseDirectory.AppData
): Promise<void> {
  if (baseDir === BaseDirectory.AppData) {
    await ensureAppDataDir()
  }
  await writeTextFile(fileName, JSON.stringify(data, null, 2), { baseDir })
}

/** Odczyt JSON z AppData; brak pliku lub błąd → `null`. */
export async function readJsonFile<T>(
  fileName: string,
  baseDir: BaseDirectory = BaseDirectory.AppData
): Promise<T | null> {
  try {
    const content = await readTextFile(fileName, { baseDir })
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export function buildPersistedSnapshot(params: {
  data: QuoteData
  marginMultiplier: number
  pricingConfig: PricingConfigShape
  templates: SavedTemplate[]
}): PersistedAppSettings {
  return {
    data: params.data,
    marginMultiplier: params.marginMultiplier,
    pricingConfig: params.pricingConfig,
    templates: params.templates,
  }
}

export async function saveSettings(data: PersistedAppSettings): Promise<void> {
  await writeJsonFile(SETTINGS_FILE, data)
}

export async function loadSettings(): Promise<PersistedAppSettings | null> {
  return readJsonFile<PersistedAppSettings>(SETTINGS_FILE)
}
