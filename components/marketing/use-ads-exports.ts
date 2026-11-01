'use client'

/**
 * Zapis eksportów do Google Ads dla zakładki Marketing.
 *
 * Jak `useCampaigns`: przeładowanie przy powrocie okna. Po restarcie aplikacji
 * rekordy `pending` wracają z pliku, więc „Czeka na potwierdzenie" nie ginie.
 */

import { useCallback, useEffect, useState } from 'react'
import { appendAdsExports, listAdsExports, resolveAdsExport } from '@/lib/ads-exports-store'
import type { AdsExportRecord } from '@/lib/ads-export-types'

export function useAdsExports() {
  const [records, setRecords] = useState<AdsExportRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setRecords(await listAdsExports())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const addRecords = useCallback(async (added: AdsExportRecord[]) => {
    setRecords(await appendAdsExports(added))
  }, [])

  const resolve = useCallback(async (exportedAt: string, status: 'confirmed' | 'cancelled') => {
    setRecords(await resolveAdsExport(exportedAt, status))
  }, [])

  return { records, isLoading, reload, addRecords, resolve }
}
