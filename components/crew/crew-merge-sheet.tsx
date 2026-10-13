'use client'

/**
 * „Scal osoby" (S2): ta sama osoba wpisana kilka razy staje się jedną kartą.
 * Wybór osób (z podpowiedzią duplikatów po imieniu), która karta zostaje,
 * podgląd połączonej karty i tego, co się przepnie, potwierdzenie. Zapis i
 * „Cofnij" robi sekcja (`crew-section.tsx`); logika: `lib/crew-merge.ts`.
 */

import { useMemo, useState } from 'react'
import { GitMerge, Search } from 'lucide-react'
import { useCrew } from '@/lib/crew-context'
import { useEquipment } from '@/lib/equipment-context'
import { useProjectHub } from '@/lib/project-hub-context'
import { crewDuplicateGroups, planCrewMerge, type CrewMergePlan } from '@/lib/crew-merge'
import type { CrewMemberStats } from '@/lib/crew-stats'
import type { CrewMember } from '@/lib/crew-types'
import { personKey } from '@/lib/project-costs'
import type { Project } from '@/lib/project-types'
import { dayLabel, plural } from '@/lib/pl-plural'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pln } from './crew-format'

/** Która karta zostaje, gdy nikt nie wybrał: najwięcej dni pracy, potem projektów, potem najstarsza. */
function defaultTarget(ids: string[], people: CrewMember[], stats: Map<string, CrewMemberStats<Project>>): string {
  const chosen = people.filter((m) => ids.includes(m.id))
  chosen.sort(
    (a, b) =>
      (stats.get(b.id)?.days ?? 0) - (stats.get(a.id)?.days ?? 0) ||
      (stats.get(b.id)?.projects ?? 0) - (stats.get(a.id)?.projects ?? 0) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  )
  return chosen[0]?.id ?? ''
}

export function CrewMergeSheet({
  initialTargetId,
  stats,
  onMerge,
  onClose,
}: {
  /** Osoba, z której karty otwarto scalanie — domyślnie zostaje. */
  initialTargetId?: string | null
  stats: Map<string, CrewMemberStats<Project>>
  onMerge: (plan: CrewMergePlan) => Promise<void>
  onClose: () => void
}) {
  const { people, allPeople, roles } = useCrew()
  const { projects } = useProjectHub()
  const { kits } = useEquipment()
  const [selected, setSelected] = useState<string[]>(() => (initialTargetId ? [initialTargetId] : []))
  const [targetId, setTargetId] = useState<string>(initialTargetId ?? '')
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id
  const groups = useMemo(() => crewDuplicateGroups(people), [people])
  const target = selected.includes(targetId) ? targetId : defaultTarget(selected, people, stats)
  const plan = useMemo(
    () =>
      selected.length > 1 && target
        ? planCrewMerge({
            members: allPeople,
            targetId: target,
            sourceIds: selected.filter((id) => id !== target),
            projects,
            kits,
            at: new Date().toISOString(),
            roleName,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, target, allPeople, projects, kits, roles]
  )

  const shown = useMemo(() => {
    const needle = personKey(query)
    return [...people]
      .filter((m) => selected.includes(m.id) || !needle || personKey(m.name).includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  }, [people, query, selected])

  const toggle = (id: string) => {
    setConfirming(false)
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const pickGroup = (group: CrewMember[]) => {
    setConfirming(false)
    setSelected(group.map((m) => m.id))
    setTargetId(defaultTarget(group.map((m) => m.id), people, stats))
  }

  const run = async () => {
    if (!plan) return
    setBusy(true)
    try {
      await onMerge(plan)
    } finally {
      setBusy(false)
    }
  }

  const costRefs = plan?.refs.filter((r) => r.kind === 'cost') ?? []
  const quoteRefs = plan?.refs.filter((r) => r.kind === 'quote') ?? []
  const touchedProjects = new Set(plan?.refs.map((r) => r.projectId) ?? []).size
  const label = 'text-[11px] text-zinc-500'

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">Ekipa</div>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-bold tracking-tight text-white">
          <GitMerge className="size-5 text-zinc-400" />
          Scal osoby
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Ta sama osoba wpisana kilka razy staje się jedną kartą. Wiersze ekipy w projektach, osoby w wycenach i w
          zestawach przejdą na kartę, która zostaje; imiona wpisane w projektach się nie zmienią. Pozostałe karty
          znikną z listy — da się to cofnąć zaraz po scaleniu.
        </p>
      </header>

      {groups.length > 0 && (
        <section>
          <div className={label}>Podobne imiona</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <button
                key={group.map((m) => m.id).join('|')}
                type="button"
                onClick={() => pickGroup(group)}
                className="rounded-full border border-amber-500/30 px-2.5 py-1 text-xs text-amber-200 outline-none hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-white/60"
              >
                {group.map((m) => m.name).join(' · ')}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className={label}>Kogo scalić (zaznacz co najmniej dwie osoby), potem wybierz, kto zostaje</div>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj osoby"
            aria-label="Szukaj osoby do scalenia"
            className="h-9 border-white/10 bg-black/40 pl-8 text-sm"
          />
        </div>
        <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
          {shown.map((m) => {
            const on = selected.includes(m.id)
            const s = stats.get(m.id)
            return (
              <li key={m.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(m.id)}
                  aria-label={`Scal: ${m.name}`}
                  className="accent-emerald-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{m.name}</div>
                  <div className="truncate text-[11px] text-zinc-500">
                    {[
                      m.roleIds.map(roleName).join(', ') || 'bez roli',
                      m.rate ? `${pln(m.rate)}/dzień` : '',
                      s && s.projects > 0 ? `${s.days} ${dayLabel(s.days)} · ${s.projects} proj.` : 'bez pracy',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {on && selected.length > 1 && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-zinc-400">
                    <input
                      type="radio"
                      name="crew-merge-target"
                      checked={target === m.id}
                      onChange={() => {
                        setTargetId(m.id)
                        setConfirming(false)
                      }}
                      className="accent-emerald-500"
                    />
                    zostaje
                  </label>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {plan && (
        <section className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs">
          <div className="text-zinc-300">
            Zostaje <span className="font-semibold text-white">{plan.merged.name}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-zinc-400">
            <dt className="text-zinc-500">Role</dt>
            <dd>{plan.merged.roleIds.map(roleName).join(', ') || '—'}</dd>
            <dt className="text-zinc-500">Stawka</dt>
            <dd>
              {plan.merged.rate ? `${pln(plan.merged.rate)}/dzień` : '—'}
              {(plan.merged.roleRates ?? []).length > 0 &&
                ` · w rolach: ${plan.merged
                  .roleRates!.map((r) => `${roleName(r.roleId)} ${pln(r.rate)}`)
                  .join(', ')}`}
            </dd>
            <dt className="text-zinc-500">Kontakt</dt>
            <dd>
              {[plan.merged.contact.phone, plan.merged.contact.email, plan.merged.city].filter(Boolean).join(' · ') || '—'}
            </dd>
          </dl>
          {plan.merged.notes && plan.merged.notes !== (plan.before.notes ?? '') && (
            <p className="mt-2 whitespace-pre-line text-[11px] text-zinc-500">Notatka: {plan.merged.notes}</p>
          )}
          <p className="mt-3 text-zinc-300">
            Przepnie się: {costRefs.length} {plural(costRefs.length, 'wiersz ekipy', 'wiersze ekipy', 'wierszy ekipy')}
            {', '}
            {quoteRefs.length} {plural(quoteRefs.length, 'pozycja w wycenie', 'pozycje w wycenach', 'pozycji w wycenach')}
            {touchedProjects > 0 && ` (${touchedProjects} ${plural(touchedProjects, 'projekt', 'projekty', 'projektów')})`}
            {', '}
            {plan.kits.length} {plural(plan.kits.length, 'zestaw', 'zestawy', 'zestawów')}.
          </p>
          <p className="mt-1 text-zinc-500">
            Znikną z listy: {plan.sources.map((m) => `„${m.name}"`).join(', ')}.
          </p>
        </section>
      )}

      {confirming && plan ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" role="alert">
          <p className="text-xs text-amber-100/90">
            Scalić {plan.sources.length + 1} {plural(plan.sources.length + 1, 'kartę', 'karty', 'kart')} w „{plan.merged.name}"?
            Można to cofnąć zaraz po scaleniu.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={run} disabled={busy} className="h-8">
              Scal ({plan.sources.length + 1})
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} className="h-8">
              Anuluj
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirming(true)} disabled={!plan} className="h-9 gap-2">
            <GitMerge className="size-4" />
            Scal…
          </Button>
          <Button variant="ghost" onClick={onClose} className="h-9 text-zinc-400">
            Zamknij
          </Button>
        </div>
      )}
    </div>
  )
}
