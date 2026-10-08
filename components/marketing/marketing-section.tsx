'use client'

/**
 * Sekcja „Marketing" — kampanie, leady i ich koszt.
 *
 * Nie ma tu własnych danych o pieniądzach ani projektach: wydatki z panelu to
 * koszty stałe `marketing` z `campaignId` (te same co w Finansach), leady to
 * wydarzenia `lead_in` (te same co w Kalendarzu), a zlecenia i ich wynik to
 * projekty. Ten plik wybiera kampanię i składa widoki; liczy `marketing-calc.ts`.
 */

import { useMemo, useRef, useState } from 'react'
import { Loader2, Megaphone, Plus } from 'lucide-react'
import { useEvents } from '@/lib/events-context'
import { todayKey, useProjectHub } from '@/lib/project-hub-context'
import { leadsFromEvents, patchLeadEvent, type Lead } from '@/lib/marketing-leads'
import {
  campaignActiveOn,
  campaignSpendInYear,
  summarizeCampaign,
  type CampaignMonth,
} from '@/lib/marketing-calc'
import type { Campaign, LeadQuality } from '@/lib/marketing-types'
import { createFixedCost, listFixedCosts } from '@/lib/finances-store'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useFixedCosts } from '@/components/finance/use-fixed-costs'
import { CampaignForm } from './campaign-form'
import { LeadForm } from './lead-form'
import { LeadsPanel } from './leads-panel'
import { OriginsPanel } from './origins-panel'
import {
  CampaignFunnel,
  CampaignHeader,
  CampaignKpis,
  CampaignMonths,
  CampaignTraffic,
  type MonthReading,
} from './campaign-overview'
import { useCampaigns } from './use-campaigns'

/** Wybór w selektorze: id kampanii albo leady spoza kampanii. */
const NO_CAMPAIGN = '__none__'

type SheetState =
  | { type: 'campaign'; campaign: Campaign | null }
  | { type: 'lead'; lead: Lead | null }
  | null

export function MarketingSection({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const today = todayKey()
  const { campaigns, isLoading, saveCampaign, removeCampaign } = useCampaigns()
  const fixed = useFixedCosts()
  const { events, isLoading: eventsLoading, save } = useEvents()
  const { projects, updateProject } = useProjectHub()

  const [selected, setSelected] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetState>(null)

  const leads = useMemo(() => leadsFromEvents(events), [events])
  const campaignIds = useMemo(() => new Set(campaigns.map((c) => c.id)), [campaigns])
  /** Bez kampanii albo z kampanią, której już nie ma. */
  const outsideLeads = useMemo(
    () => leads.filter((l) => !l.campaignId || !campaignIds.has(l.campaignId)),
    [leads, campaignIds]
  )

  // Domyślnie: kampania, która trwa, a gdy żadna — najnowsza.
  const fallback = campaignActiveOn(campaigns, today) ?? campaigns[0] ?? null
  const current = selected === NO_CAMPAIGN ? null : (campaigns.find((c) => c.id === selected) ?? fallback)
  const showingOutside = selected === NO_CAMPAIGN || (!current && campaigns.length === 0)

  const quoteSentProjectIds = useMemo(
    () => new Set(events.filter((e) => e.kind === 'quote_sent' && e.projectId).map((e) => e.projectId as string)),
    [events]
  )
  const summary = useMemo(
    () =>
      current
        ? summarizeCampaign(current, { costs: fixed.costs, leads, projects, quoteSentProjectIds, today })
        : null,
    [current, fixed.costs, leads, projects, quoteSentProjectIds, today]
  )

  const adsSpendForYear = (year: number | null) =>
    campaigns
      .filter((c) => c.platform === 'google_ads')
      .reduce((sum, c) => {
        if (year !== null) return sum + campaignSpendInYear(c, fixed.costs, leads, today, year)
        return sum + summarizeCampaign(c, { costs: fixed.costs, leads, projects, today }).spend
      }, 0)

  /**
   * Odczyt z panelu za miesiąc → pozycja kosztów `marketing` tej kampanii.
   * Zapisy idą po kolei, a istniejącą pozycję szukamy w pliku na świeżo:
   * szybkie przejście Tab z wydatków do kliknięć nie może założyć dwóch pozycji.
   */
  const saveQueue = useRef(Promise.resolve())
  const saveMonth = (month: CampaignMonth, reading: MonthReading) => {
    const campaign = current
    if (!campaign) return Promise.resolve()
    const run = async () => {
      const existing = (await listFixedCosts()).find(
        (c) => c.campaignId === campaign.id && c.month === month.month
      )
      if (reading.spend === undefined) {
        if (existing) await fixed.removeCost(existing.id)
        return
      }
      const base =
        existing ?? createFixedCost({ month: month.month, type: 'marketing', amount: reading.spend, label: campaign.name })
      await fixed.updateCost({
        ...base,
        amount: reading.spend,
        campaignId: campaign.id,
        clicks: reading.clicks,
        impressions: reading.impressions,
      })
    }
    saveQueue.current = saveQueue.current.then(run, run)
    return saveQueue.current
  }

  const rate = async (lead: Lead, quality: LeadQuality) => {
    await save(patchLeadEvent(lead.event, { quality }))
  }

  const loading = isLoading || fixed.isLoading || eventsLoading
  const currentLeads = current ? leads.filter((l) => l.campaignId === current.id) : outsideLeads

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Marketing</h1>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Kampanie, leady i ile kosztuje klient. Wydatki z panelu liczą się też w Finansach, leady widać w Kalendarzu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(campaigns.length > 0 || outsideLeads.length > 0) && (
            <select
              aria-label="Kampania"
              value={showingOutside ? NO_CAMPAIGN : (current?.id ?? '')}
              onChange={(e) => setSelected(e.target.value)}
              className="h-8 max-w-[22rem] rounded-lg border border-white/10 bg-black/30 px-2 text-xs font-medium text-zinc-200 [color-scheme:dark]"
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || 'Kampania bez nazwy'}
                  {c.startDate ? ` · ${c.startDate.slice(0, 7)}` : ''}
                </option>
              ))}
              <option value={NO_CAMPAIGN}>Leady spoza kampanii ({outsideLeads.length})</option>
            </select>
          )}
          <button
            type="button"
            onClick={() => setSheet({ type: 'campaign', campaign: null })}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
          >
            <Plus className="size-3.5" />
            Nowa kampania
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-16 text-zinc-600">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          {current && summary ? (
            <>
              <CampaignHeader
                campaign={current}
                summary={summary}
                today={today}
                onEdit={() => setSheet({ type: 'campaign', campaign: current })}
              />
              <CampaignKpis summary={summary} />
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <CampaignFunnel summary={summary} />
                <CampaignTraffic summary={summary} />
              </div>
              <CampaignMonths summary={summary} onSave={saveMonth} />
            </>
          ) : (
            campaigns.length === 0 && (
              <section className="mb-6 flex flex-col items-center rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                <Megaphone className="size-7 text-zinc-700" />
                <p className="mt-3 text-sm text-zinc-400">Dodaj kampanię: start emisji i budżet dzienny z panelu.</p>
                <p className="mt-1 max-w-md text-xs text-zinc-600">
                  Od razu policzymy koszt leada z budżetu, a gdy wpiszesz odczyt z panelu — z prawdziwych wydatków.
                </p>
                <button
                  type="button"
                  onClick={() => setSheet({ type: 'campaign', campaign: null })}
                  className="mt-4 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Plus className="size-3.5" />
                  Nowa kampania
                </button>
              </section>
            )
          )}

          <LeadsPanel
            title={current ? 'Leady z kampanii' : 'Leady spoza kampanii'}
            leads={currentLeads}
            projects={projects}
            showOrigin={!current}
            onAdd={() => setSheet({ type: 'lead', lead: null })}
            onEdit={(lead) => setSheet({ type: 'lead', lead })}
            onRate={rate}
            onOpenProject={onOpenProject}
          />

          <OriginsPanel
            projects={projects}
            adsSpendForYear={adsSpendForYear}
            onSetOrigin={(id, origin) => void updateProject(id, { leadSource: origin })}
            onOpenProject={onOpenProject}
          />
        </>
      )}

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="overflow-y-auto border-l border-white/10 bg-zinc-950/95 p-5 text-white backdrop-blur-2xl sm:max-w-md [&>button:last-child]:hidden"
        >
          <SheetTitle className="sr-only">
            {sheet?.type === 'campaign' ? 'Kampania' : 'Lead'}
          </SheetTitle>
          {sheet?.type === 'campaign' && (
            <CampaignForm
              key={sheet.campaign?.id ?? 'new'}
              campaign={sheet.campaign}
              today={today}
              onSave={async (campaign) => {
                await saveCampaign(campaign)
                setSelected(campaign.id)
              }}
              onDelete={async (id) => {
                await removeCampaign(id)
                setSelected(null)
              }}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet?.type === 'lead' && (
            <LeadForm
              key={sheet.lead?.id ?? 'new'}
              lead={sheet.lead}
              defaults={
                showingOutside
                  ? { date: today, campaignId: null, followDate: false }
                  : { date: today, campaignId: campaignActiveOn(campaigns, today)?.id ?? null, followDate: true }
              }
              campaigns={campaigns}
              onClose={() => setSheet(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
