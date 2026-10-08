'use client'

/**
 * Widok kampanii: nagłówek, kafle KPI, lejek, wnioski i tabela miesięcy.
 *
 * Matematyka w `marketing-calc.ts`; tu tylko rysowanie i wpisywanie odczytów
 * z panelu (wydatek, kliknięcia, wyświetlenia za miesiąc).
 */

import { useEffect, useState } from 'react'
import { Lightbulb, Pencil } from 'lucide-react'
import { parseAmount } from '@/lib/event-draft'
import { dailyBudgetOn, type CampaignMonth, type CampaignSummary } from '@/lib/marketing-calc'
import { platformLabel, type Campaign } from '@/lib/marketing-types'
import { plural } from '@/lib/pl-plural'
import { archivo, mono } from '@/components/calendar/calendar-bits'
import { count, monthName, monthShort, pct, pln, shortDate } from './marketing-bits'

/** Jedna seria = jeden kolor (ten sam co zysk w Finansach, walidowany na ciemnym tle). */
const FUNNEL_COLOR = '#0284c7'

// ── Nagłówek kampanii ────────────────────────────────────────────────────────

export function CampaignHeader({
  campaign,
  summary,
  today,
  onEdit,
}: {
  campaign: Campaign
  summary: CampaignSummary
  today: string
  onEdit: () => void
}) {
  const w = summary.window
  const state = !w ? null : w.upcoming ? 'Zaplanowana' : w.running ? 'Trwa' : 'Zakończona'
  const stateClass = w?.running
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : w?.upcoming
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
      : 'border-zinc-600/40 bg-zinc-700/20 text-zinc-400'
  const budgetNow = dailyBudgetOn(campaign, w?.running ? today : (campaign.endDate ?? today))

  return (
    <section className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-white" style={archivo}>
            {campaign.name || 'Kampania bez nazwy'}
          </h2>
          {state && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateClass}`}>{state}</span>
          )}
          <span className="text-xs text-zinc-500">{platformLabel(campaign.platform)}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          {campaign.startDate ? shortDate(campaign.startDate) : 'brak daty startu'}
          {' – '}
          {campaign.endDate ? shortDate(campaign.endDate) : 'trwa'}
          {w && w.days > 0 && (
            <span className="text-zinc-500">
              {' · '}
              {w.running ? `dzień ${w.days}` : `${w.days} ${plural(w.days, 'dzień', 'dni', 'dni')} emisji`}
            </span>
          )}
          {' · '}
          budżet <span style={mono}>{pln(budgetNow)}</span>/dzień
          {campaign.budgets.length > 1 && (
            <span className="text-zinc-500"> ({campaign.budgets.length - 1} {plural(campaign.budgets.length - 1, 'zmiana', 'zmiany', 'zmian')})</span>
          )}
        </p>
        {campaign.notes && <p className="mt-1.5 max-w-2xl whitespace-pre-line text-xs text-zinc-500">{campaign.notes}</p>}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
      >
        <Pencil className="size-3.5" />
        Ustawienia
      </button>
    </section>
  )
}

// ── Kafle KPI ────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  children,
  tone,
}: {
  label: string
  value: string
  children?: React.ReactNode
  tone?: 'good' | 'bad'
}) {
  const box =
    tone === 'good'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : tone === 'bad'
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-white/5 bg-zinc-900/40'
  return (
    <div className={`rounded-xl border p-4 ${box}`}>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-zinc-100" style={mono}>
        {value}
      </div>
      <div className="mt-1 space-y-0.5 text-xs text-zinc-500">{children}</div>
    </div>
  )
}

export function CampaignKpis({ summary }: { summary: CampaignSummary }) {
  const s = summary
  const estimated = s.estimatedMonths.length
  const won = s.projects.won.length
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Wydatki" value={pln(s.spend)}>
        <div>{estimated ? `w tym ${estimated} ${plural(estimated, 'miesiąc', 'miesiące', 'miesięcy')} z budżetu (szac.)` : 'z panelu reklamowego'}</div>
        {s.dailyAverage !== null && <div>śr. {pln(s.dailyAverage)} na dzień emisji</div>}
      </Tile>
      <Tile label="Zapytania" value={count(s.leads.total)}>
        <div>
          {s.leads.real} {plural(s.leads.real, 'realne', 'realne', 'realnych')} · {s.leads.veryGood} bardzo{' '}
          {plural(s.leads.veryGood, 'dobre', 'dobre', 'dobrych')}
        </div>
        <div>
          {s.leads.fake} {plural(s.leads.fake, 'fałszywe', 'fałszywe', 'fałszywych')}
          {s.leads.unrated > 0 && <span className="text-amber-300/90"> · {s.leads.unrated} do oceny</span>}
        </div>
      </Tile>
      <Tile label="Koszt realnego leada" value={pln(s.costPerRealLead)}>
        <div>zapytanie (z fałszywymi) {pln(s.costPerLead)}</div>
        <div>bardzo dobry lead {pln(s.costPerVeryGoodLead)}</div>
      </Tile>
      <Tile
        label="Zwrot z reklam"
        value={s.roas !== null && won > 0 ? `${s.roas.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}×` : '—'}
        tone={won === 0 ? undefined : s.profitAfterAds >= 0 ? 'good' : 'bad'}
      >
        <div>
          {won} {plural(won, 'zlecenie', 'zlecenia', 'zleceń')} · {pln(s.revenue)} netto
        </div>
        <div>
          zysk po reklamach <span className={s.profitAfterAds < 0 ? 'text-red-300' : 'text-zinc-300'}>{pln(s.profitAfterAds)}</span>
        </div>
      </Tile>
    </div>
  )
}

// ── Lejek ────────────────────────────────────────────────────────────────────

export function CampaignFunnel({ summary }: { summary: CampaignSummary }) {
  const s = summary
  const steps = [
    { label: 'Zapytania', value: s.leads.total, note: 'wszystkie zgłoszenia' },
    { label: 'Realne leady', value: s.leads.real, note: 'dobre + bardzo dobre' },
    { label: 'Z wyceną', value: s.projects.quoted, note: 'projekt z wyceną' },
    { label: 'Zlecenia', value: s.projects.won.length, note: 'w realizacji + zrealizowane' },
  ]
  const max = Math.max(1, steps[0].value)

  return (
    <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Lejek</h3>
      <ol className="space-y-2.5">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1].value : null
          const conversion = prev ? step.value / prev : null
          return (
            <li key={step.label}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="text-zinc-300">
                  {step.label} <span className="text-zinc-600">· {step.note}</span>
                </span>
                <span className="shrink-0 text-zinc-400" style={mono}>
                  <span className="font-semibold text-zinc-100">{step.value}</span>
                  {conversion !== null && <span className="ml-2 text-zinc-500">{pct(conversion, 0)}</span>}
                </span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-white/5"
                title={`${step.label}: ${step.value}${conversion !== null ? ` (${pct(conversion, 0)} poprzedniego etapu)` : ''}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(step.value / max) * 100}%`, minWidth: step.value > 0 ? 4 : 0, background: FUNNEL_COLOR }}
                />
              </div>
            </li>
          )
        })}
      </ol>
      {s.pipeline > 0 && (
        <p className="mt-3 text-xs text-zinc-500">
          Otwarte wyceny z kampanii: <span className="text-zinc-300" style={mono}>{pln(s.pipeline)}</span>
        </p>
      )}
    </section>
  )
}

// ── Ruch i wnioski ───────────────────────────────────────────────────────────

function insightsFor(summary: CampaignSummary): string[] {
  const s = summary
  const out: string[] = []
  if (s.estimatedMonths.length) {
    out.push(
      `Wydatki za ${s.estimatedMonths.map(monthShort).join(', ')} liczone z budżetu dziennego — wpisz kwoty z panelu w tabeli miesięcy.`
    )
  }
  if (s.clicks === null) out.push('Wpisz kliknięcia i wyświetlenia z panelu, żeby policzyć CTR, CPC i konwersję strony.')
  if (s.leads.unrated) out.push(`${s.leads.unrated} ${plural(s.leads.unrated, 'lead czeka', 'leady czekają', 'leadów czeka')} na ocenę.`)
  if (s.fakeShare !== null && s.fakeShare >= 0.08) {
    out.push(
      `${pct(s.fakeShare, 0)} zapytań to nie klienci — dodaj wykluczenia (praca, staż, „przykłady") w słowach kluczowych.`
    )
  }
  if (s.monthsFundedPerWon !== null && s.projects.won.length) {
    out.push(
      `Średni zysk z jednego zlecenia (${pln(s.profit / s.projects.won.length)}) opłaca ${s.monthsFundedPerWon.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mies. reklam w obecnym tempie.`
    )
  }
  if (!s.projects.won.length && s.leads.real >= 5) {
    out.push('Żaden lead nie jest jeszcze zleceniem. Sprawdź, czy realne leady mają powiązane projekty.')
  }
  return out
}

export function CampaignTraffic({ summary }: { summary: CampaignSummary }) {
  const s = summary
  const rows = [
    { label: 'Wyświetlenia', value: count(s.impressions) },
    { label: 'Kliknięcia', value: count(s.clicks) },
    { label: 'CTR', value: pct(s.ctr, 2), note: 'B2B w wyszukiwarce: zwykle 3–5%' },
    { label: 'Śr. koszt kliknięcia', value: pln(s.cpc, 2) },
    { label: 'Klik → realne zapytanie', value: pct(s.clickToLead, 1) },
    { label: 'Koszt zlecenia', value: pln(s.costPerWon) },
  ]
  const insights = insightsFor(s)
  return (
    <section className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Ruch</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] pb-1" title={r.note}>
            <dt className="text-zinc-500">{r.label}</dt>
            <dd className="text-zinc-100" style={mono}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {insights.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {insights.map((text) => (
            <li key={text} className="flex gap-2 text-xs text-zinc-400">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-300/80" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Miesiące ─────────────────────────────────────────────────────────────────

export interface MonthReading {
  spend: number | undefined
  clicks: number | undefined
  impressions: number | undefined
}

const cellInput =
  'h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-right text-xs text-zinc-100 outline-none [color-scheme:dark] placeholder:text-zinc-600 hover:border-white/10 focus:border-white/30 focus:bg-black/40'

function MonthRow({
  month,
  onSave,
}: {
  month: CampaignMonth
  onSave: (month: CampaignMonth, reading: MonthReading) => Promise<void>
}) {
  const fromMonth = () => ({
    spend: month.spend === null ? '' : String(Math.round(month.spend * 100) / 100).replace('.', ','),
    clicks: month.clicks === null ? '' : String(month.clicks),
    impressions: month.impressions === null ? '' : String(month.impressions),
  })
  const [draft, setDraft] = useState(fromMonth)
  useEffect(() => setDraft(fromMonth()), [month.spend, month.clicks, month.impressions]) // eslint-disable-line react-hooks/exhaustive-deps

  const editable = month.costs.length <= 1
  const commit = () => {
    const reading = {
      spend: parseAmount(draft.spend),
      clicks: parseAmount(draft.clicks),
      impressions: parseAmount(draft.impressions),
    }
    const same =
      reading.spend === (month.spend ?? undefined) &&
      reading.clicks === (month.clicks ?? undefined) &&
      reading.impressions === (month.impressions ?? undefined)
    if (!same) void onSave(month, reading)
  }
  const field = (key: keyof typeof draft, label: string, placeholder?: string) => (
    <input
      inputMode="decimal"
      aria-label={`${label} — ${monthName(month.month)}`}
      value={draft[key]}
      placeholder={placeholder}
      disabled={!editable}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={cellInput}
      style={mono}
    />
  )

  const ctr = month.clicks !== null && month.impressions ? month.clicks / month.impressions : null
  const cpc = month.spend !== null && month.clicks ? month.spend / month.clicks : null
  const cpl = month.leads.real ? month.effectiveSpend / month.leads.real : null

  return (
    <tr className="border-t border-white/[0.04]">
      <td className="whitespace-nowrap py-1 pr-2 text-zinc-300">
        {monthShort(month.month)}
        <span className="ml-1.5 text-[11px] text-zinc-600" style={mono}>
          {month.activeDays} d
        </span>
      </td>
      <td className="px-1 text-right text-zinc-500" style={mono}>
        {month.budget ? pln(month.budget) : '—'}
      </td>
      <td className="w-28 px-1" title={editable ? undefined : 'Kilka pozycji w tym miesiącu — edytuj je w Finansach'}>
        {field('spend', 'Wydatki z panelu', month.estimated ? `~${Math.round(month.budget)}` : '')}
      </td>
      <td className="w-24 px-1">{field('clicks', 'Kliknięcia')}</td>
      <td className="w-28 px-1">{field('impressions', 'Wyświetlenia')}</td>
      <td className="px-1 text-right text-zinc-400" style={mono}>
        {pct(ctr, 2)}
      </td>
      <td className="px-1 text-right text-zinc-400" style={mono}>
        {pln(cpc, 2)}
      </td>
      <td className="px-1 text-right text-zinc-300" style={mono}>
        {month.leads.real}
        <span className="text-zinc-600">/{month.leads.total}</span>
      </td>
      <td className={`pl-1 text-right ${month.estimated ? 'text-zinc-500' : 'text-zinc-100'}`} style={mono}>
        {month.estimated && cpl !== null ? '~' : ''}
        {pln(cpl)}
      </td>
    </tr>
  )
}

export function CampaignMonths({
  summary,
  onSave,
}: {
  summary: CampaignSummary
  onSave: (month: CampaignMonth, reading: MonthReading) => Promise<void>
}) {
  if (!summary.months.length) return null
  return (
    <section className="mb-6 rounded-xl border border-white/5 bg-zinc-900/40 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Miesiące</h3>
        <p className="text-[11px] text-zinc-600">
          Wpisz odczyt z panelu. Wydatki trafiają do Finansów jako koszt marketingu. Puste = szacunek z budżetu (~).
        </p>
      </div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="text-[11px] text-zinc-500">
              <th className="py-1 pr-2 text-left font-medium">Miesiąc</th>
              <th className="px-1 text-right font-medium">Budżet</th>
              <th className="px-2.5 text-right font-medium">Wydatki</th>
              <th className="px-2.5 text-right font-medium">Kliknięcia</th>
              <th className="px-2.5 text-right font-medium">Wyświetlenia</th>
              <th className="px-1 text-right font-medium">CTR</th>
              <th className="px-1 text-right font-medium">CPC</th>
              <th className="px-1 text-right font-medium" title="realne / wszystkie">
                Leady
              </th>
              <th className="pl-1 text-right font-medium">Koszt real. leada</th>
            </tr>
          </thead>
          <tbody>
            {summary.months.map((m) => (
              <MonthRow key={m.month} month={m} onSave={onSave} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-semibold text-zinc-200">
              <td className="py-1.5 pr-2">Razem</td>
              <td className="px-1 text-right text-zinc-500" style={mono}>
                {pln(summary.budget)}
              </td>
              <td className="px-2.5 text-right" style={mono}>
                {pln(summary.spend)}
              </td>
              <td className="px-2.5 text-right" style={mono}>
                {count(summary.clicks)}
              </td>
              <td className="px-2.5 text-right" style={mono}>
                {count(summary.impressions)}
              </td>
              <td className="px-1 text-right" style={mono}>
                {pct(summary.ctr, 2)}
              </td>
              <td className="px-1 text-right" style={mono}>
                {pln(summary.cpc, 2)}
              </td>
              <td className="px-1 text-right" style={mono}>
                {summary.leads.real}
                <span className="text-zinc-600">/{summary.leads.total}</span>
              </td>
              <td className="pl-1 text-right" style={mono}>
                {pln(summary.costPerRealLead)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
