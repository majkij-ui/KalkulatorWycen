'use client'

/**
 * Kontekst skrzynki propozycji (ekran „Skrzynka" + licznik w pasku bocznym).
 *
 * Czyta `inbox/` i decyzje, liczy, co czeka (`inbox.ts`), a akceptację
 * zapisuje przez ISTNIEJĄCE store'y: wydarzenie (nowe i zmiana istniejącego)
 * przez `useEvents().save`, projekt przez `useProjectHub()` (nowy bez wyceny,
 * uzupełnienie pól). Status
 * projektu nigdy nie zmienia się tutaj — wynik akceptacji podaje tylko
 * podpowiedź, którą ekran pokazuje do potwierdzenia.
 *
 * Musi siedzieć wewnątrz `ProjectHubProvider` i `EventsProvider`.
 * Przeładowuje się przy powrocie okna — Claude mógł dopisać nowy plik.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useEvents } from './events-context'
import { useProjectHub } from './project-hub-context'
import { listCampaigns } from './campaigns-store'
import { listInboxDecisions, readInboxFiles, saveInboxDecisions } from './inbox-store'
import {
  applyEventUpdate,
  decisionRecord,
  eventFromProposal,
  groupProposals,
  pendingProposals,
  projectPatchFromFields,
  proposalProblems,
  statusAfter,
  usesTarget,
  type InboxTarget,
  type PendingProposal,
  type ProposalGroup,
  type ProposalProblem,
} from './inbox'
import type { InboxDecision, ParsedInboxFile, Proposal } from './inbox-types'
import type { Campaign } from './marketing-types'
import type { Project, ProjectStatus } from './project-types'

export interface AcceptResult {
  accepted: number
  /** Propozycje, których nie dało się przyjąć (zostają w skrzynce). */
  failed: { key: string; problems: ProposalProblem[] }[]
  /** Projekt, do którego trafiły (także świeżo założony). */
  project: Pick<Project, 'id' | 'name' | 'status'> | null
  createdProject: boolean
  /** Status do zaproponowania (forward-only); `null` = nic. */
  statusSuggestion: ProjectStatus | null
}

interface InboxValue {
  isLoading: boolean
  files: ParsedInboxFile[]
  decisions: InboxDecision[]
  campaigns: Campaign[]
  pending: PendingProposal[]
  groups: ProposalGroup[]
  /** Propozycje z plików już rozpatrzone (do informacji). */
  handled: number
  reload: () => Promise<void>
  /**
   * Przyjmuje propozycje (w podanej kolejności) do celu grupy. `proposal` to
   * wersja po edycji (albo oryginał). Projekt `new` zakłada się raz, przed
   * pierwszą propozycją.
   */
  accept: (items: { item: PendingProposal; proposal: Proposal }[], target: InboxTarget) => Promise<AcceptResult>
  reject: (items: PendingProposal[]) => Promise<void>
  /** Cofa odrzucenie — propozycja znów czeka. */
  reopen: (ref: string) => Promise<void>
}

const InboxContext = createContext<InboxValue | null>(null)

export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { allEvents, save: saveEvent, reload: reloadEvents } = useEvents()
  const { projects, createProjectWithoutQuote, updateProject } = useProjectHub()
  const [files, setFiles] = useState<ParsedInboxFile[]>([])
  const [decisions, setDecisions] = useState<InboxDecision[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    const [nextFiles, nextDecisions, nextCampaigns] = await Promise.all([
      readInboxFiles(),
      listInboxDecisions(),
      listCampaigns(),
    ])
    setFiles(nextFiles)
    setDecisions(nextDecisions)
    setCampaigns(nextCampaigns)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])

  const { pending, handled } = useMemo(
    () => pendingProposals(files, allEvents, decisions),
    [files, allEvents, decisions]
  )
  const groups = useMemo(() => groupProposals(pending), [pending])

  const record = useCallback(async (records: InboxDecision[]) => {
    if (records.length) setDecisions(await saveInboxDecisions(records))
  }, [])

  const accept = useCallback<InboxValue['accept']>(
    async (items, target) => {
      const eventOf = (proposal: Proposal) =>
        proposal.type === 'event_update' ? (allEvents.find((e) => e.id === proposal.eventId) ?? null) : undefined
      const failed = items
        .map(({ item, proposal }) => ({ key: item.key, problems: proposalProblems(proposal, target, eventOf(proposal)) }))
        .filter((f) => f.problems.length > 0)
      const valid = items.filter(({ item }) => !failed.some((f) => f.key === item.key))
      const result: AcceptResult = { accepted: 0, failed, project: null, createdProject: false, statusSuggestion: null }
      if (!valid.length) return result
      // Sama godzina albo dane istniejącego wydarzenia nie potrzebują projektu.
      const needsProject = valid.some(({ proposal }) => usesTarget(proposal))

      let project: Project | null =
        target.type === 'existing' ? (projects.find((p) => p.id === target.projectId) ?? null) : null
      if (needsProject && target.type === 'existing' && !project) {
        return { ...result, failed: items.map(({ item }) => ({ key: item.key, problems: ['project'] })) }
      }
      if (needsProject && target.type === 'new') {
        const { name, client, date, leadSource, contact } = target.fields
        project = await createProjectWithoutQuote({ name, client, date, leadSource, contact })
        if (!project) return { ...result, failed: items.map(({ item }) => ({ key: item.key, problems: ['projectName'] })) }
        result.createdProject = true
        // Projekt powstał z propozycji `project_new` — ta jest przyjęta, nawet gdy
        // przyjmujesz tylko jedno wydarzenie. Decyzja od razu: przerwany import
        // nie może potem założyć projektu drugi raz.
        const origin = pending.find((item) => item.key === target.fromRef)
        if (origin) await record([decisionRecord(origin, 'accepted', { projectId: project.id })])
      }

      const kinds: string[] = []
      for (const { item, proposal } of valid) {
        if (proposal.type === 'project_new' && target.type === 'new' && item.key === target.fromRef) {
          result.accepted += 1
          continue
        }
        if (proposal.type === 'event') {
          const event = eventFromProposal(proposal, project?.id ?? null, item.file)
          await saveEvent(event)
          kinds.push(event.kind)
          await record([decisionRecord(item, 'accepted', { projectId: event.projectId ?? undefined, eventId: event.id })])
        } else if (proposal.type === 'event_update') {
          // Zmiana istniejącego wydarzenia: od oryginału z pliku (z nieznanymi
          // polami i `source`), ślad w `updatedFrom`. Brak zmian = sama decyzja.
          const original = eventOf(proposal)!
          const projectId = proposal.set.linkProject ? (project?.id ?? null) : null
          const next = applyEventUpdate(original, proposal, projectId, item.file)
          if (next) await saveEvent(next)
          await record([
            decisionRecord(item, 'accepted', {
              projectId: next?.projectId ?? undefined,
              eventId: original.id,
              eventTitle: original.title,
            }),
          ])
        } else if (project) {
          // Uzupełnienie projektu — także `project_new`, gdy wybrano istniejący projekt.
          const fields = proposal.type === 'project_update' ? proposal.set : proposal.project
          const ifMissing = proposal.type === 'project_update' ? proposal.ifMissing : true
          const patch = projectPatchFromFields(project, fields, ifMissing)
          if (Object.keys(patch).length) {
            await updateProject(project.id, patch)
            project = { ...project, ...patch }
          }
          await record([decisionRecord(item, 'accepted', { projectId: project.id })])
        }
        result.accepted += 1
      }

      if (project) {
        result.project = { id: project.id, name: project.name, status: project.status }
        result.statusSuggestion = statusAfter(project.status, kinds)
      }
      return result
    },
    [projects, pending, allEvents, createProjectWithoutQuote, updateProject, saveEvent, record]
  )

  const reject = useCallback(
    async (items: PendingProposal[]) => {
      const titleOf = (p: Proposal) =>
        p.type === 'event_update' ? allEvents.find((e) => e.id === p.eventId)?.title : undefined
      await record(items.map((item) => decisionRecord(item, 'rejected', { eventTitle: titleOf(item.proposal) })))
    },
    [record, allEvents]
  )

  const reopen = useCallback(
    async (ref: string) => {
      const existing = decisions.find((d) => d.ref === ref)
      if (existing) await record([{ ...existing, decision: 'reopened', at: new Date().toISOString() }])
    },
    [decisions, record]
  )

  const fullReload = useCallback(async () => {
    await Promise.all([reload(), reloadEvents()])
  }, [reload, reloadEvents])

  const value = useMemo<InboxValue>(
    () => ({
      isLoading,
      files,
      decisions,
      campaigns,
      pending,
      groups,
      handled,
      reload: fullReload,
      accept,
      reject,
      reopen,
    }),
    [isLoading, files, decisions, campaigns, pending, groups, handled, fullReload, accept, reject, reopen]
  )

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

export function useInbox(): InboxValue {
  const ctx = useContext(InboxContext)
  if (!ctx) throw new Error('useInbox musi być użyty wewnątrz InboxProvider')
  return ctx
}
