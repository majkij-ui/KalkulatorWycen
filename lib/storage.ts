import { writeTextFile, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import type { PersistedAppSettings, QuoteData, SavedTemplate } from './quote-types'
import type { PricingConfigShape, PricingTier } from './pricing-config'

const SETTINGS_FILE = 'settings.json'

export function isTauriRuntime(): boolean {
  return isTauri()
}

/** Zapis dowolnego obiektu JSON do katalogu aplikacji (AppData). */
export async function writeJsonFile<T>(
  fileName: string,
  data: T,
  baseDir: BaseDirectory = BaseDirectory.AppData
): Promise<void> {
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
  pricingTier: PricingTier
  marginMultiplier: number
  pricingConfig: PricingConfigShape
  templates: SavedTemplate[]
}): PersistedAppSettings {
  return {
    data: params.data,
    pricingTier: params.pricingTier,
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
