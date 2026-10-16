'use client'

/**
 * Korzeń aplikacji: strażnik hydracji. Dostawców stanu ustawia `AppShell`
 * (projekty → wycena otwartego projektu → reszta).
 */

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { applyCarryOver } from '@/lib/legacy-app'

export function AppRoot() {
  const [mounted, setMounted] = useState(false)

  // Renderujemy dopiero po hydracji — inaczej generowane id rozjeżdżają się
  // między serwerem a klientem (zachowanie przeniesione z QuoteCalculator).
  // Przy okazji: jednorazowe przeniesienie ustawień ze starej aplikacji —
  // PRZED startem providerów, bo cennik i katalog realizacji czytają
  // localStorage przy pierwszym renderze.
  useEffect(() => {
    void applyCarryOver().finally(() => setMounted(true))
  }, [])

  if (!mounted) {
    return <div className="min-h-screen bg-zinc-950" />
  }

  return <AppShell />
}
