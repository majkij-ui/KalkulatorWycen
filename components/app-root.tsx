'use client'

/**
 * Korzeń aplikacji: strażnik hydracji. Dostawców stanu ustawia `AppShell`
 * (projekty → wycena otwartego projektu → reszta).
 */

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { AppNotices } from '@/components/app-notices'
import { applyCarryOver } from '@/lib/legacy-app'
import { startupBackup } from '@/lib/auto-backup-tauri'
import { loadCompanySettings } from '@/lib/company-settings'

/** Kopia przy starcie czeka najwyżej tyle; potem okno startuje, a kopia kończy się w tle. */
const BACKUP_WAIT_MS = 3000

function atMost(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))])
}

/**
 * Kroki przed startem providerów, po kolei:
 *  1. jednorazowe przeniesienie ustawień ze starej aplikacji (do localStorage),
 *  2. automatyczna kopia plików danych (F1) — zanim cokolwiek je zapisze,
 *  3. `company.json` do pamięci (F1; przy pierwszym starcie tworzony z localStorage),
 *     bo cennik, teksty PDF i katalog realizacji są czytane przy pierwszym renderze.
 * Żaden krok nie rzuca i żaden nie zatrzymuje startu.
 */
async function beforeProviders(): Promise<void> {
  await applyCarryOver()
  await atMost(
    startupBackup().catch((error) => console.error('[kopia] nieoczekiwany błąd', error)),
    BACKUP_WAIT_MS
  )
  await loadCompanySettings()
}

export function AppRoot() {
  const [mounted, setMounted] = useState(false)

  // Renderujemy dopiero po hydracji — inaczej generowane id rozjeżdżają się
  // między serwerem a klientem (zachowanie przeniesione z QuoteCalculator).
  useEffect(() => {
    void beforeProviders().finally(() => setMounted(true))
  }, [])

  if (!mounted) {
    return <div className="min-h-screen bg-zinc-950" />
  }

  return (
    <>
      <AppShell />
      <AppNotices />
    </>
  )
}
