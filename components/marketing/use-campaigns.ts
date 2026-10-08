'use client'

/**
 * Stan kampanii dla zakładki Marketing.
 *
 * Zwykły hook, jak `useFixedCosts`: kampanie edytuje tylko ta zakładka.
 * Przeładowanie przy powrocie okna — dane może dopisać rozmowa z Claude.
 */

import { useCallback, useEffect, useState } from 'react'
import { deleteCampaign, listCampaigns, upsertCampaign } from '@/lib/campaigns-store'
import type { Campaign } from '@/lib/marketing-types'

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setCampaigns(await listCampaigns())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const saveCampaign = useCallback(async (campaign: Campaign) => {
    setCampaigns(await upsertCampaign(campaign))
  }, [])

  const removeCampaign = useCallback(async (id: string) => {
    setCampaigns(await deleteCampaign(id))
  }, [])

  return { campaigns, isLoading, saveCampaign, removeCampaign }
}
