'use client'

/**
 * Strona jednego klienta: kafelki z liczbami, rytm powrotów (z przypomnieniem,
 * gdy przerwa jest dużo dłuższa niż zwykle), wielkość zleceń w czasie,
 * przychód w latach, projekty (klik otwiera projekt), ostatni kontakt i
 * „Scal nazwy". Wszystko liczy `client-stats.ts` — tu tylko widok.
 */

import { ArrowLeft, ArrowUpRight, BellRing, Repeat } from 'lucide-react'
import { describeGap, describeSince, SIZE_TREND_LABELS, type ClientStats } from '@/lib/client-stats'
import type { ClientMergePlan } from '@/lib/client-merge'
import { hasContact } from '@/lib/clients'
import { countsTowardRevenue, leadSourceLabel, type Project } from '@/lib/project-types'
import { plural } from '@/lib/pl-plural'
import { ProjectSwatch, archivo, mono } from '@/components/calendar/calendar-bits'
import { ProjectStatusBadge } from '@/components/projects/project-status-badge'
import { CopyButton, Tile, formatDate, pct, pln } from './client-bits'
import { SizeBars } from './size-bars'
import { ClientMerge } from './client-merge'

const daysLabel = (n: number) => `${Math.round(n)} ${plural(Math.round(n), 'dniu', 'dniach', 'dniach')}`

function trendSentence(stats: ClientStats): string {
  const { trend, ratio, points } = stats.size
  if (trend === null || ratio === null) {
    return points.length
      ? `Trend pokaże się od 3 zleceń z kwotą (jest ${points.length}).`
      : 'Brak zleceń z policzoną kwotą.'
  }
  const change = Math.round(Math.abs(ratio - 1) * 100)
  if (trend === 'rosnie') return `Ostatnie zlecenia średnio o ${change}% większe niż pierwsze.`
  if (trend === 'maleje') return `Ostatnie zlecenia średnio o ${change}% mniejsze niż pierwsze.`
  return `Ostatnie zlecenia podobne do pierwszych (różnica ${change}%).`
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function ContactCard({ stats }: { stats: ClientStats }) {
  if (!stats.contact || !hasContact(stats.contact.contact)) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs text-zinc-500">
        Brak danych kontaktowych w projektach tego klienta. Uzupełnisz je na osi czasu projektu.
      </p>
    )
  }
  const { contact, projectName } = stats.contact
  const rows = [
    { label: 'Osoba', value: contact.name },
    { label: 'E-mail', value: contact.email },
    { label: 'Telefon', value: contact.phone },
  ].filter((r) => r.value?.trim())
  const all = rows.map((r) => r.value.trim()).join(', ')
  return (
    <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 py-3">
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-[11px] text-zinc-500">{r.label}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-200">{r.value}</span>
            <CopyButton text={r.value.trim()} label={`Kopiuj: ${r.label.toLowerCase()}`} />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/5 pt-2 text-[11px] text-zinc-500">
        <span className="min-w-0 truncate">z projektu „{projectName}"</span>
        {rows.length > 1 && <CopyButton text={all} label="Kopiuj wszystko" caption="kopiuj wszystko" />}
      </div>
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen?: () => void }) {
  const counts = countsTowardRevenue(project.status)
  const value = project.financials?.sumaNetto
  return (
    <button
      type="button"
      disabled={!onOpen}
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-lg border border-white/5 bg-zinc-900/40 px-3 py-2 text-left transition-colors enabled:hover:border-white/15"
    >
      <ProjectSwatch project={project} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-zinc-200">{project.name || 'Bez nazwy'}</span>
          <ProjectStatusBadge status={project.status} />
        </div>
        <div className="text-[11px] text-zinc-500" style={mono}>
          {formatDate(project.date)}
          {project.client.trim() && <span className="ml-2 font-sans">„{project.client.trim()}"</span>}
        </div>
      </div>
      <div
        className={`shrink-0 text-right text-sm ${counts ? 'font-semibold text-zinc-100' : project.status === 'lost' ? 'text-zinc-600' : 'text-zinc-500'}`}
        style={mono}
      >
        {value !== undefined ? pln(value) : '—'}
      </div>
      {onOpen && <ArrowUpRight className="size-4 shrink-0 text-zinc-600 group-hover:text-zinc-300" />}
    </button>
  )
}

export function ClientPage({
  stats,
  projects,
  onBack,
  onOpenProject,
  onMerge,
}: {
  stats: ClientStats
  projects: Project[]
  onBack: () => void
  onOpenProject?: (id: string) => void
  onMerge: (plan: ClientMergePlan) => Promise<void>
}) {
  const { rhythm, outcomes, payments, size } = stats
  const jobs = outcomes.won
  const source = stats.firstSource
  const projectsById = new Map(projects.map((p) => [p.id, p]))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1.5 rounded-md text-xs font-medium text-zinc-500 outline-none hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <ArrowLeft className="size-3.5" />
          Klienci
        </button>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-zinc-500">
          Klient
          {stats.repeat && (
            <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-px normal-case tracking-normal text-emerald-300">
              <Repeat className="size-3" />
              wraca
            </span>
          )}
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl" style={archivo}>
          {stats.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {outcomes.total} {plural(outcomes.total, 'projekt', 'projekty', 'projektów')}
          {' · '}
          {jobs} {plural(jobs, 'zlecenie', 'zlecenia', 'zleceń')}
          {' · '}
          pierwszy <span style={mono}>{formatDate(source.date)}</span>
        </p>
      </div>

      {rhythm.nudge && rhythm.medianGapDays !== null && rhythm.monthsSinceLast !== null && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3" role="status">
          <BellRing className="mt-0.5 size-4 shrink-0 text-amber-300/80" />
          <p className="text-sm text-amber-100/90">
            Zwykle wraca {describeGap(Math.round(rhythm.medianGapDays))}, a ostatnie zlecenie było{' '}
            {describeSince(rhythm.monthsSinceLast)}.{' '}
            <span className="text-amber-100/60">Może warto się odezwać.</span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile
          label="Przychód"
          value={pln(stats.revenue)}
          good={stats.revenue > 0}
          lines={[
            stats.sharePct === null ? '' : `${pct(stats.sharePct, 1)} przychodu firmy`,
            `${jobs} ${plural(jobs, 'zlecenie', 'zlecenia', 'zleceń')}`,
          ]}
          warn={
            stats.missingFinancials > 0
              ? `${stats.missingFinancials} ${plural(stats.missingFinancials, 'zlecenie', 'zlecenia', 'zleceń')} bez policzonych finansów`
              : undefined
          }
        />
        <Tile
          label="Zysk"
          value={pln(stats.profit)}
          lines={[stats.marginPct === null ? 'brak zleceń' : `marża ${pct(stats.marginPct)}`, 'z planu w wycenie']}
        />
        <Tile
          label="Skuteczność wycen"
          value={pct(outcomes.winRatePct)}
          lines={[
            `${outcomes.won} ${plural(outcomes.won, 'przyjęta', 'przyjęte', 'przyjętych')} · ${outcomes.lost} ${plural(outcomes.lost, 'nieprzyjęta', 'nieprzyjęte', 'nieprzyjętych')}`,
            outcomes.open ? `${outcomes.open} ${plural(outcomes.open, 'czeka', 'czekają', 'czeka')} na decyzję` : '',
          ]}
        />
        <Tile
          label="Powroty"
          value={rhythm.medianGapDays === null ? '—' : describeGap(Math.round(rhythm.medianGapDays))}
          lines={[
            rhythm.monthsSinceLast === null
              ? 'jeszcze bez zlecenia'
              : `ostatnie zlecenie ${describeSince(rhythm.monthsSinceLast)}`,
            rhythm.medianGapDays === null && rhythm.jobDates.length === 1 ? 'jedno zlecenie' : '',
            rhythm.openQuoteSinceLast ? 'nowa wycena czeka' : '',
          ]}
        />
        <Tile
          label="Płaci"
          value={payments.medianDays === null ? '—' : `po ${daysLabel(payments.medianDays)}`}
          lines={[
            payments.paidCount
              ? `mediana z ${payments.paidCount} ${plural(payments.paidCount, 'faktury', 'faktur', 'faktur')}${
                  payments.maxDays !== null && payments.paidCount > 1 ? ` · najdłużej ${payments.maxDays} dni` : ''
                }`
              : 'brak opłaconych faktur w kalendarzu',
          ]}
          warn={
            payments.openCount
              ? `${payments.openCount} ${plural(payments.openCount, 'faktura czeka', 'faktury czekają', 'faktur czeka')} (najdłużej ${payments.oldestOpenDays} dni)`
              : undefined
          }
        />
        <Tile
          label="Pierwszy kontakt"
          value={source.source ? leadSourceLabel(source.source) : 'nieustalone'}
          lines={[`„${source.projectName || 'Bez nazwy'}", ${formatDate(source.date)}`]}
        />
      </div>

      <Section
        title="Wielkość zleceń"
        aside={
          size.trend && (
            <span
              className={`text-xs font-semibold ${
                size.trend === 'rosnie' ? 'text-emerald-400' : size.trend === 'maleje' ? 'text-amber-300/90' : 'text-zinc-300'
              }`}
            >
              {SIZE_TREND_LABELS[size.trend]}
            </span>
          )
        }
      >
        <div className="rounded-xl border border-white/5 bg-zinc-900/40 px-4 pb-3 pt-2">
          <SizeBars size={size} onOpenProject={onOpenProject} />
          <p className={`text-xs text-zinc-500 ${size.points.length ? 'mt-2' : ''}`}>{trendSentence(stats)}</p>
        </div>
      </Section>

      {stats.years.length > 0 && (
        <Section title="Przychód w latach">
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Rok</th>
                <th>Zlecenia</th>
                <th>Przychód</th>
                <th>Udział w przychodzie firmy</th>
              </tr>
            </thead>
            <tbody>
              {stats.years.map((y) => (
                <tr key={y.year} className="border-b border-white/5 last:border-0">
                  <td className="w-16 py-1.5 pr-3 text-zinc-400" style={mono}>
                    {y.year}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-500">
                    {y.jobs} {plural(y.jobs, 'zlecenie', 'zlecenia', 'zleceń')}
                  </td>
                  <td className="w-32 py-1.5 pr-3 text-right font-semibold text-zinc-100" style={mono}>
                    {pln(y.revenue)}
                  </td>
                  <td className="w-28 py-1.5 text-right text-xs text-zinc-500">
                    {y.sharePct === null ? '—' : `${pct(y.sharePct, 1)} firmy`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Projekty">
        <ul className="flex flex-col gap-1.5">
          {stats.projects.map((p) => {
            const project = projectsById.get(p.id)
            return project ? (
              <li key={p.id}>
                <ProjectRow project={project} onOpen={onOpenProject ? () => onOpenProject(p.id) : undefined} />
              </li>
            ) : null
          })}
        </ul>
      </Section>

      <Section title="Ostatni kontakt">
        <ContactCard stats={stats} />
      </Section>

      <ClientMerge key={stats.key} stats={stats} projects={projects} onMerge={onMerge} />
    </div>
  )
}
