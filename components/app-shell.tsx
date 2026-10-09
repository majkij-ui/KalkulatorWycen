'use client'

/**
 * Shell aplikacji — zmiana tożsamości z „kreatora wycen" na kokpit firmy.
 *
 * Świadomie BEZ routingu Next.js: apka buduje się jako `output: 'export'` do
 * Tauri, więc przełączanie sekcji trzymamy w stanie klienta. Zero zmian w
 * konfiguracji builda, identyczne zachowanie w przeglądarce i w desktopie.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, Calculator, CalendarDays, FolderKanban, Megaphone, Package, Settings2 } from 'lucide-react'
import { ProjectHubProvider, useProjectHub } from '@/lib/project-hub-context'
import { EquipmentProvider } from '@/lib/equipment-context'
import { EventsProvider } from '@/lib/events-context'
import { QuoteCalculatorView } from '@/components/quote-calculator'
import { ProjectList } from '@/components/projects/project-list'
import { ProjectBar } from '@/components/projects/project-bar'
import { EquipmentSection } from '@/components/equipment/equipment-section'
import { ProjectEquipment } from '@/components/equipment/project-equipment'
import { FinanceSection } from '@/components/finance/finance-section'
import { CalendarSection } from '@/components/calendar/calendar-section'
import { MarketingSection } from '@/components/marketing/marketing-section'
import { AmbientGlow } from '@/components/ambient-glow'

type Section = 'kalendarz' | 'projekty' | 'finanse' | 'marketing' | 'sprzet' | 'ustawienia'

const NAV: { value: Section; label: string; icon: typeof FolderKanban }[] = [
  { value: 'kalendarz', label: 'Kalendarz', icon: CalendarDays },
  { value: 'projekty', label: 'Projekty', icon: FolderKanban },
  { value: 'finanse', label: 'Finanse', icon: BarChart3 },
  { value: 'marketing', label: 'Marketing', icon: Megaphone },
  { value: 'sprzet', label: 'Sprzęt', icon: Package },
  { value: 'ustawienia', label: 'Ustawienia', icon: Settings2 },
]

/** Sekcja jeszcze niezbudowana — mówi wprost, co i kiedy, zamiast udawać. */
function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500">{description}</p>
    </div>
  )
}

function Sidebar({
  section,
  onChange,
}: {
  section: Section
  onChange: (next: Section) => void
}) {
  return (
    <nav
      aria-label="Nawigacja główna"
      className="sticky top-0 z-50 flex shrink-0 gap-1 border-b border-white/5 bg-black/70 px-3 py-2 backdrop-blur-xl md:h-screen md:w-52 md:flex-col md:border-b-0 md:border-r md:px-3 md:py-5"
    >
      <div className="mb-0 hidden px-2 md:mb-4 md:block">
        <div className="text-sm font-bold tracking-tight text-white">NonoiseMedia</div>
        <div className="text-[11px] text-zinc-500">Kokpit projektów</div>
      </div>

      {NAV.map(({ value, label, icon: Icon }) => {
        const active = value === section
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:flex-none md:justify-start ${
              active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg border border-white/10 bg-zinc-800/70"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <Icon className="relative size-4 shrink-0" />
            <span className="relative hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

type ProjectTab = 'wycena' | 'sprzet'

const PROJECT_TABS: { value: ProjectTab; label: string; icon: typeof Calculator }[] = [
  { value: 'wycena', label: 'Wycena', icon: Calculator },
  { value: 'sprzet', label: 'Sprzęt', icon: Package },
]

/**
 * Otwarty projekt. Kalkulator zostaje nietknięty w zakładce „Wycena";
 * „Sprzęt" to warstwa projektowa, która nie dotyka kwot oferty.
 */
function ProjectView() {
  const { activeProject } = useProjectHub()
  const [tab, setTab] = useState<ProjectTab>('wycena')

  // Zmiana projektu wraca na wycenę — inaczej otwarcie kolejnego projektu
  // lądowałoby w zakładce sprzętu poprzedniego.
  useEffect(() => {
    setTab('wycena')
  }, [activeProject?.id])

  return (
    <>
      <ProjectBar />
      <div className="border-b border-white/5 bg-black/20">
        <div className="mx-auto flex max-w-4xl gap-1 px-4 py-1.5" role="tablist">
          {PROJECT_TABS.map(({ value, label, icon: Icon }) => {
            const active = value === tab
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(value)}
                className={`relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="project-tab-active"
                    className="absolute inset-0 rounded-lg bg-zinc-800/80"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon className="relative size-3.5" />
                <span className="relative">{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'wycena' ? <QuoteCalculatorView /> : <ProjectEquipment />}
    </>
  )
}

function ShellContent() {
  // Kalendarz jest ekranem startowym — przegląd firmy zaczyna się od czasu.
  const [section, setSection] = useState<Section>('kalendarz')
  const { activeProject, openProject, closeProject } = useProjectHub()

  // Klik w „Projekty" w pasku bocznym zawsze wraca do LISTY — także z otwartego
  // projektu (pasek boczny jest zawsze widoczny, przycisk „Projekty" w pasku
  // projektu trzeba by najpierw przewinąć). Otwarcie projektu z kalendarza czy
  // finansów idzie przez `goToProject`, więc tego nie dotyczy.
  const changeSection = (next: Section) => {
    if (next === 'projekty') closeProject()
    setSection(next)
    window.scrollTo({ top: 0 })
  }

  const goToProject = (id: string) => {
    void openProject(id)
    setSection('projekty')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="relative min-h-screen bg-[#050505] md:flex">
      <AmbientGlow />
      <Sidebar section={section} onChange={changeSection} />

      <div className="relative min-w-0 flex-1">
        {section === 'kalendarz' && <CalendarSection onOpenProject={goToProject} />}

        {section === 'projekty' && (activeProject ? <ProjectView /> : <ProjectList />)}

        {section === 'finanse' && <FinanceSection onOpenProject={goToProject} />}

        {section === 'marketing' && <MarketingSection onOpenProject={goToProject} />}

        {section === 'sprzet' && <EquipmentSection onOpenProject={goToProject} />}

        {section === 'ustawienia' && (
          <ComingSoon
            title="Ustawienia"
            description="Cennik, teksty PDF i dane firmy są na razie dostępne z poziomu kalkulatora — ikona koła zębatego w nagłówku otwartego projektu."
          />
        )}
      </div>
    </div>
  )
}

export function AppShell() {
  return (
    <ProjectHubProvider>
      <EquipmentProvider>
        <EventsProvider>
          <ShellContent />
        </EventsProvider>
      </EquipmentProvider>
    </ProjectHubProvider>
  )
}
