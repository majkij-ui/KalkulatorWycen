'use client'

/**
 * Korzeń aplikacji: strażnik hydracji + dostawcy stanu.
 *
 * Kolejność jest istotna — `ProjectHubProvider` (wewnątrz `AppShell`) czyta
 * `useQuote()`, więc musi siedzieć pod `QuoteProvider`.
 */

import { useEffect, useState } from 'react'
import { QuoteProvider } from '@/lib/quote-context'
import { AppShell } from '@/components/app-shell'

export function AppRoot() {
  const [mounted, setMounted] = useState(false)

  // Renderujemy dopiero po hydracji — inaczej generowane id rozjeżdżają się
  // między serwerem a klientem (zachowanie przeniesione z QuoteCalculator).
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="min-h-screen bg-zinc-950" />
  }

  return (
    <QuoteProvider>
      <AppShell />
    </QuoteProvider>
  )
}
