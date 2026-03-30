import { getPricingConfig } from './pricing-config'
import type { PersistedAppSettings, SavedTemplate } from './quote-types'
import { isTauriRuntime, loadSettings, saveSettings } from './storage'

const WEB_SNAPSHOT_KEY = 'nonoise-app-state-v1'
const TEMPLATES_LEGACY_KEY = 'nonoise-templates'

function readTemplatesLegacy(): SavedTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(TEMPLATES_LEGACY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedTemplate[]) : []
  } catch {
    return []
  }
}

export function readWebSnapshot(): PersistedAppSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(WEB_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as PersistedAppSettings
    return null
  } catch {
    return null
  }
}

export function writeWebSnapshot(snapshot: PersistedAppSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WEB_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore quota / private mode
  }
}

/** Dane z poprzednich kluczy (cennik + szablony), zanim powstał jeden snapshot w localStorage. */
export function buildLegacyWebSnapshot(): PersistedAppSettings {
  return {
    pricingConfig: getPricingConfig(),
    templates: readTemplatesLegacy(),
  }
}

/**
 * Odczyt z localStorage bez pliku Tauri — do `useState` przy pierwszym renderze (przeglądarka).
 * W Tauri pierwszy render nadal bez pliku; plik dołącza `loadPersistedSnapshot`.
 */
export function getSyncInitialFromWeb(): PersistedAppSettings | null {
  if (typeof window === 'undefined') return null
  const unified = readWebSnapshot()
  if (unified) return unified
  return buildLegacyWebSnapshot()
}

/**
 * Kolejność: plik Tauri (AppData) → snapshot web → legacy (cennik + szablony).
 */
export async function loadPersistedSnapshot(): Promise<PersistedAppSettings | null> {
  if (typeof window === 'undefined') return null

  if (isTauriRuntime()) {
    const fromFile = await loadSettings()
    if (fromFile) return fromFile
  }

  return getSyncInitialFromWeb()
}

export function savePersistedSnapshot(snapshot: PersistedAppSettings): Promise<void> {
  if (isTauriRuntime()) {
    return saveSettings(snapshot)
  }
  writeWebSnapshot(snapshot)
  return Promise.resolve()
}
