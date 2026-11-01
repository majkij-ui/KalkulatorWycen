/**
 * Eksport konwersji offline do Google Ads — wszystkie liczby i nazwy w jednym miejscu.
 *
 * Nazwy akcji muszą być dokładnie takie, jak w Google Ads (plan §5, etap 0);
 * zmiana tu bez zmiany tam daje odrzucony import. Wartości leada to założenie
 * M.J. do korekty (plan §7, decyzja 2). Moduł czysty.
 */

import type { LeadQuality } from './marketing-types'

export type AdsConversionKey = 'lead' | 'won'

export interface AdsExportConfig {
  /** Nazwy akcji konwersji w Google Ads (kolumna `conversion_name`). */
  actionNames: Record<AdsConversionKey, string>
  /** Wartość konwersji „Lead realny" zależna od oceny leada. */
  leadValues: Record<Exclude<LeadQuality, 'fake'>, number>
  currency: string
  /** Strefa dopisywana do `conversion_time`; czas w hubie jest już warszawski. */
  timeZone: string
  /** Okno od kliknięcia dla wiersza z click id. */
  windowDaysClickId: number
  /** Okno od kliknięcia dla wiersza dopasowanego samym kontaktem. */
  windowDaysContact: number
  /** Do końca okna zostało mniej dni niż tyle: wiersz jedzie, ale jest ostrzeżenie. */
  warnDaysLeft: number
  /** Leady sprzed tej daty (`YYYY-MM-DD`) nie mają danych ze strony i nie są błędem. */
  trackingStart: string
  /** Różnica kwoty wygranej (zł), od której pojawia się „do ręcznej korekty". */
  revenueToleranceZl: number
}

export const ADS_EXPORT_CONFIG: AdsExportConfig = {
  actionNames: {
    lead: 'Lead realny (offline)',
    won: 'Zlecenie wygrane (offline)',
  },
  leadValues: { good: 300, very_good: 600 },
  currency: 'PLN',
  timeZone: 'Europe/Warsaw',
  windowDaysClickId: 90,
  windowDaysContact: 63,
  warnDaysLeft: 14,
  trackingStart: '2026-11-01',
  revenueToleranceZl: 0.5,
}
