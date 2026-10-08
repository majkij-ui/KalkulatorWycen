'use client'

/**
 * Kampanie reklamowe — `campaigns.json` w AppData (Tauri) / localStorage (web).
 *
 * Tylko ustawienia kampanii (start, koniec, budżet dzienny). Wydatki z panelu
 * są w kosztach stałych (`finances.json`, typ `marketing` z `campaignId`), a
 * leady w wydarzeniach — patrz `marketing-types.ts`.
 */

import { createCollectionStore } from './v3-store'
import { campaignSchema, type Campaign } from './marketing-types'

export const CAMPAIGNS_FILE = 'campaigns.json'
export const WEB_CAMPAIGNS_KEY = 'nonoise-campaigns-v1'

/** Najnowsza kampania u góry. */
function byStartDesc(a: Campaign, b: Campaign): number {
  return b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)
}

const store = createCollectionStore<Campaign>({
  fileName: CAMPAIGNS_FILE,
  webKey: WEB_CAMPAIGNS_KEY,
  schema: campaignSchema,
  getId: (c) => c.id,
  sort: byStartDesc,
})

export const listCampaigns = store.list
export const deleteCampaign = store.remove

export function upsertCampaign(campaign: Campaign): Promise<Campaign[]> {
  return store.upsert({ ...campaign, updatedAt: new Date().toISOString() })
}
