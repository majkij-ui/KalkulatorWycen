'use client'

/**
 * Shell aplikacji — zmiana tożsamości z „kreatora wycen" na kokpit firmy.
 *
 * Świadomie BEZ routingu Next.js: apka buduje się jako `output: 'export'` do
 * Tauri, więc przełączanie sekcji trzymamy w stanie klienta. Zero zmian w
 * konfiguracji builda, identyczne zachowanie w przeglądarce i w desktopie.
 */

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3,
  Calculator,
  CalendarDays,
  Clapperboard,
  FolderKanban,
  Handshake,
  Inbox,
  Megaphone,
  NotebookPen,
  Package,
  Settings2,
  Users,
  Waypoints,
} from 'lucide-react'
import { ProjectHubProvider, useProjectHub } from '@/lib/project-hub-context'
import { EquipmentProvider } from '@/lib/equipment-context'
import { EventsProvider } from '@/lib/events-context'
import { InboxProvider, useInbox } from '@/lib/inbox-context'
import { CrewProvider } from '@/lib/crew-context'
import { QuoteProvider } from '@/lib/quote-context'
import { QuoteCalculatorView, type CalculatorTab } from '@/components/quote-calculator'
import { ProjectList } from '@/components/projects/project-list'
import { ProjectHeader } from '@/components/projects/project-header'
import { ProjectTimeline } from '@/components/projects/project-timeline'
import { ProjectNotes } from '@/components/projects/project-notes'
import { defaultProjectTab, type Project, type ProjectTab } from '@/lib/project-types'
import { EquipmentSection } from '@/components/equipment/equipment-section'
import { ProjectRealization } from '@/components/realization/project-realization'
import { FinanceSection } from '@/components/finance/finance-section'
import { CalendarSection } from '@/components/calendar/calendar-section'
import { MarketingSection } from '@/components/marketing/marketing-section'
import { InboxSection } from '@/components/inbox/inbox-section'
import { ClientsSection } from '@/components/clients/clients-section'
import { CrewSection } from '@/components/crew/crew-section'
import { AmbientGlow } from '@/components/ambient-glow'
import { SettingsSection } from '@/components/settings-section'

type Section =
  | 'kalendarz'
  | 'skrzynka'
  | 'projekty'
  | 'klienci'
  | 'finanse'
  | 'marketing'
  | 'sprzet'
  | 'ekipa'
  | 'ustawienia'

const NAV: { value: Section; label: string; icon: typeof FolderKanban }[] = [
  { value: 'kalendarz', label: 'Kalendarz', icon: CalendarDays },
  { value: 'skrzynka', label: 'Skrzynka', icon: Inbox },
  { value: 'projekty', label: 'Projekty', icon: FolderKanban },
  { value: 'klienci', label: 'Klienci', icon: Handshake },
  { value: 'finanse', label: 'Finanse', icon: BarChart3 },
  { value: 'marketing', label: 'Marketing', icon: Megaphone },
  { value: 'sprzet', label: 'Sprzęt', icon: Package },
  { value: 'ekipa', label: 'Ekipa', icon: Users },
  { value: 'ustawienia', label: 'Ustawienia', icon: Settings2 },
]

function Sidebar({
  section,
  onChange,
}: {
  section: Section
  onChange: (next: Section) => void
}) {
  // Licznik propozycji z poczty, które czekają na decyzję.
  const inboxCount = useInbox().pending.length
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
            {value === 'skrzynka' && inboxCount > 0 && (
              <span
                className="relative ml-auto rounded-full bg-primary px-1.5 py-px text-[10px] font-bold leading-4 text-primary-foreground"
                aria-label={`${inboxCount} do przejrzenia`}
              >
                {inboxCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

const PROJECT_TAB_ITEMS: { value: ProjectTab; label: string; icon: typeof Calculator }[] = [
  { value: 'os', label: 'Oś czasu', icon: Waypoints },
  { value: 'wycena', label: 'Wycena', icon: Calculator },
  // Klucz `sprzet` na stałe; od T5a to zakładka Realizacja (sprzęt jest jej częścią).
  { value: 'sprzet', label: 'Realizacja', icon: Clapperboard },
  { value: 'notatki', label: 'Notatki', icon: NotebookPen },
]

/** Gdzie byłeś w projekcie — zakładka i karta kalkulatora, pamiętane do zamknięcia aplikacji. */
interface ProjectViewMemory {
  tab?: ProjectTab
  calculatorTab?: CalculatorTab
}

/**
 * Otwarty projekt: nagłówek + zakładki. Zakładka „Wycena" to wycena TEGO
 * projektu (jego własny dokument); oś czasu czyta te same wydarzenia co
 * kalendarz. Montowany z `key` = id projektu, więc każdy projekt wraca na
 * swoją zakładkę (albo domyślną, `defaultProjectTab`).
 */
function ProjectView({
  project,
  initialTab,
  memory,
  onOpenClient,
}: {
  project: Project
  initialTab?: ProjectTab
  memory: ProjectViewMemory
  onOpenClient: (key: string) => void
}) {
  const [tab, setTabState] = useState<ProjectTab>(() => initialTab ?? memory.tab ?? defaultProjectTab(project.status))
  const setTab = (next: ProjectTab) => {
    memory.tab = next
    setTabState(next)
  }

  return (
    <>
      <ProjectHeader onOpenClient={onOpenClient} />
      <div className="border-b border-white/5 bg-black/20">
        <div className="mx-auto flex max-w-4xl gap-1 px-4 py-1.5" role="tablist" aria-label="Zakładki projektu">
          {PROJECT_TAB_ITEMS.map(({ value, label, icon: Icon }) => {
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

      {tab === 'os' && <ProjectTimeline project={project} />}
      {tab === 'wycena' && (
        <QuoteCalculatorView
          initialTab={memory.calculatorTab}
          onTabChange={(next) => {
            memory.calculatorTab = next
          }}
        />
      )}
      {tab === 'sprzet' && <ProjectRealization />}
      {tab === 'notatki' && <ProjectNotes project={project} />}
    </>
  )
}

function ShellContent() {
  // Kalendarz jest ekranem startowym — przegląd firmy zaczyna się od czasu.
  const [section, setSection] = useState<Section>('kalendarz')
  const { activeProject, openProject, closeProject, quoteDocs } = useProjectHub()
  // Zakładka, na której ma się otworzyć projekt wskazany z innego ekranu (np. z
  // listy sprzętu prosto na „Realizację"). Trzymana razem z id, żeby nie przeszła
  // na inny projekt otwarty potem z listy.
  const [openTarget, setOpenTarget] = useState<{ id: string; tab: ProjectTab } | null>(null)
  // Klient, którego stronę otworzyć w „Klientach" (z nagłówka projektu); pasek boczny czyści.
  const [clientTarget, setClientTarget] = useState<string | null>(null)
  // Zakładki projektów, w których już byłeś (do zamknięcia aplikacji).
  const viewMemory = useRef(new Map<string, ProjectViewMemory>())
  const memoryFor = (id: string) => {
    let memory = viewMemory.current.get(id)
    if (!memory) {
      memory = {}
      viewMemory.current.set(id, memory)
    }
    return memory
  }

  // „Projekty" w pasku bocznym z innego ekranu wraca do otwartego projektu, tam
  // gdzie byłeś (wycena jest jego dokumentem, nic nie trzeba wczytywać). Drugi
  // klik, już w projekcie, pokazuje LISTĘ (przycisk „Projekty" w nagłówku
  // projektu trzeba by najpierw przewinąć).
  const changeSection = (next: Section) => {
    if (next === 'projekty' && section === 'projekty') closeProject()
    // Wyjście z projektów: czekające zmiany wycen od razu do pliku.
    if (next !== 'projekty') void quoteDocs.flushAll()
    setOpenTarget(null)
    setClientTarget(null)
    setSection(next)
    window.scrollTo({ top: 0 })
  }

  const goToProject = (id: string, tab?: ProjectTab) => {
    setOpenTarget(tab ? { id, tab } : null)
    void openProject(id)
    setSection('projekty')
    window.scrollTo({ top: 0 })
  }

  const goToClient = (key: string) => {
    setClientTarget(key)
    setSection('klienci')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="relative min-h-screen bg-[#050505] md:flex">
      <AmbientGlow />
      <Sidebar section={section} onChange={changeSection} />

      <div className="relative min-w-0 flex-1">
        {section === 'kalendarz' && <CalendarSection onOpenProject={goToProject} />}

        {section === 'skrzynka' && <InboxSection onOpenProject={goToProject} />}

        {section === 'projekty' &&
          (activeProject ? (
            <ProjectView
              key={activeProject.id}
              project={activeProject}
              initialTab={openTarget?.id === activeProject.id ? openTarget.tab : undefined}
              memory={memoryFor(activeProject.id)}
              onOpenClient={goToClient}
            />
          ) : (
            <ProjectList />
          ))}

        {section === 'klienci' && (
          <ClientsSection key={clientTarget ?? 'lista'} initialKey={clientTarget} onOpenProject={goToProject} />
        )}

        {section === 'finanse' && <FinanceSection onOpenProject={goToProject} />}

        {section === 'marketing' && <MarketingSection onOpenProject={goToProject} />}

        {section === 'sprzet' && <EquipmentSection onOpenProject={(id) => goToProject(id, 'sprzet')} />}

        {section === 'ekipa' && <CrewSection onOpenProject={(id) => goToProject(id, 'sprzet')} />}

        {section === 'ustawienia' && <SettingsSection />}
      </div>
    </div>
  )
}

// Kolejność: projekty (z dokumentami wycen) → wycena otwartego projektu → reszta
// (Ekipa czyta role z cennika otwartej wyceny).
export function AppShell() {
  return (
    <ProjectHubProvider>
      <QuoteProvider>
        <EquipmentProvider>
          <EventsProvider>
            <CrewProvider>
              <InboxProvider>
                <ShellContent />
              </InboxProvider>
            </CrewProvider>
          </EventsProvider>
        </EquipmentProvider>
      </QuoteProvider>
    </ProjectHubProvider>
  )
}
