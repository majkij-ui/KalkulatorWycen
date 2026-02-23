'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Car, Utensils, Bed, Scale, FileText, Minus, Plus, Sparkles } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Counter } from '@/components/counter'
import { GlassCard } from '@/components/glass-card'
import { useQuote } from '@/lib/quote-context'
import type { QuoteData } from '@/lib/quote-types'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

const COPYRIGHT_OPCJE: { value: QuoteData['copyrightType']; label: string; subtext: string }[] = [
  {
    value: 'licencja',
    label: 'Licencja podstawowa',
    subtext: 'Ograniczona czasowo i polami eksploatacji (w cenie)',
  },
  {
    value: 'przekazanie',
    label: 'Pełne przekazanie praw',
    subtext: 'Dodatkowa opłata procentowa doliczana do całości',
  },
]

const inputClass =
  'w-20 h-8 text-right bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white'

function LogistykaRow({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-white/5 text-zinc-400">
          <Icon className="size-3.5" />
        </div>
        <span className="text-sm text-zinc-400">{label}</span>
      </div>
      <div className="min-w-0 flex-1 flex justify-end">
        {children}
      </div>
    </div>
  )
}

export function DodatkoweTab() {
  const { data, updateField, calculateTotalCrewDays } = useQuote()
  const totalCrewDays = calculateTotalCrewDays()

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* Logistyka na planie: Dojazd + Wyżywienie + Nocleg */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-6">
            <h3 className="font-semibold text-white">Logistyka na planie</h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Dojazd, wyżywienie i noclegi dla ekipy i obsady
            </p>
          </div>

          {/* Row 1: Dojazd */}
          <LogistykaRow label="Dojazd" icon={Car}>
            <div className="flex w-full max-w-md flex-col gap-2">
              <div className="flex items-center gap-2 justify-end">
                <Input
                  type="number"
                  min={0}
                  max={500}
                  value={data.kosztDojazduKm}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      updateField('kosztDojazduKm', 0)
                      return
                    }
                    const n = parseInt(raw, 10)
                    if (!isNaN(n)) updateField('kosztDojazduKm', Math.max(0, Math.min(500, n)))
                  }}
                  className="w-20 h-8 text-right bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white"
                />
                <span className="text-sm text-zinc-400">km</span>
              </div>
              <Slider
                value={[data.kosztDojazduKm]}
                onValueChange={([val]) => updateField('kosztDojazduKm', val)}
                min={0}
                max={500}
                step={10}
                className="flex-1 py-1"
              />
            </div>
          </LogistykaRow>
          <div className="flex justify-between px-0 text-[10px] text-zinc-500">
            <span>0 km</span>
            <span>500 km</span>
          </div>

          <Separator className="my-6 bg-white/5" />

          {/* Row 2: Wyżywienie (Catering) */}
          <div className="flex flex-col gap-3">
            <LogistykaRow label="Wyżywienie (Catering)" icon={Utensils}>
              <Switch
                checked={data.includeCatering}
                onCheckedChange={(v) => updateField('includeCatering', v)}
                aria-label="Wyżywienie (Catering)"
              />
            </LogistykaRow>
            <AnimatePresence initial={false}>
              {data.includeCatering && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="overflow-hidden space-y-3 pl-9"
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Stawka za osobodzień (PLN)</span>
                    <Counter
                      compact
                      label=""
                      value={data.cateringRate}
                      onChange={(v) => updateField('cateringRate', Math.max(0, Math.min(2000, v)))}
                      min={0}
                      max={2000}
                      step={10}
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Ręczna liczba osobodni</span>
                    <Switch
                      checked={data.cateringOverride}
                      onCheckedChange={(v) => updateField('cateringOverride', v)}
                      aria-label="Ręczna liczba osobodni"
                    />
                  </div>
                  {!data.cateringOverride ? (
                    <span className="text-sm text-zinc-500">
                      Wyliczono automatycznie: {totalCrewDays} osobodni
                    </span>
                  ) : (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-zinc-400">Podaj liczbę osobodni</span>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('cateringCustomDays', Math.max(1, data.cateringCustomDays - 1))}
                          disabled={data.cateringCustomDays <= 1}
                          aria-label="Zmniejsz"
                        >
                          <Minus className="size-4" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          value={data.cateringCustomDays}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              updateField('cateringCustomDays', 1)
                              return
                            }
                            const n = parseInt(raw, 10)
                            if (!isNaN(n)) updateField('cateringCustomDays', Math.max(1, Math.min(999, n)))
                          }}
                          className="w-16 h-8 text-center bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('cateringCustomDays', Math.min(999, data.cateringCustomDays + 1))}
                          disabled={data.cateringCustomDays >= 999}
                          aria-label="Zwiększ"
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Separator className="my-6 bg-white/5" />

          {/* Row 3: Nocleg (Lodging) */}
          <div className="flex flex-col gap-3">
            <LogistykaRow label="Nocleg (Hotele/Apartamenty)" icon={Bed}>
              <Switch
                checked={data.includeLodging}
                onCheckedChange={(v) => updateField('includeLodging', v)}
                aria-label="Nocleg"
              />
            </LogistykaRow>
            <AnimatePresence initial={false}>
              {data.includeLodging && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="overflow-hidden space-y-3 pl-9"
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Stawka za osobodzień (PLN)</span>
                    <Counter
                      compact
                      label=""
                      value={data.lodgingRate}
                      onChange={(v) => updateField('lodgingRate', Math.max(0, Math.min(2000, v)))}
                      min={0}
                      max={2000}
                      step={10}
                    />
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-sm text-zinc-400">Ręczna liczba osobodni</span>
                    <Switch
                      checked={data.lodgingOverride}
                      onCheckedChange={(v) => updateField('lodgingOverride', v)}
                      aria-label="Ręczna liczba osobodni (nocleg)"
                    />
                  </div>
                  {!data.lodgingOverride ? (
                    <span className="text-sm text-zinc-500">
                      Wyliczono automatycznie: {totalCrewDays} osobodni
                    </span>
                  ) : (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-zinc-400">Podaj liczbę osobodni</span>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('lodgingCustomDays', Math.max(1, data.lodgingCustomDays - 1))}
                          disabled={data.lodgingCustomDays <= 1}
                          aria-label="Zmniejsz"
                        >
                          <Minus className="size-4" />
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          value={data.lodgingCustomDays}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              updateField('lodgingCustomDays', 1)
                              return
                            }
                            const n = parseInt(raw, 10)
                            if (!isNaN(n)) updateField('lodgingCustomDays', Math.max(1, Math.min(999, n)))
                          }}
                          className="w-16 h-8 text-center bg-black/40 border-white/10 text-sm rounded-md tabular-nums text-white"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => updateField('lodgingCustomDays', Math.min(999, data.lodgingCustomDays + 1))}
                          disabled={data.lodgingCustomDays >= 999}
                          aria-label="Zwiększ"
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </GlassCard>
      </motion.div>

      {/* Section A: Prawa autorskie */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Scale className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Licencja i Prawa Autorskie</h3>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {COPYRIGHT_OPCJE.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => updateField('copyrightType', o.value)}
                className={`flex flex-1 min-w-[200px] flex-col items-start rounded-lg border p-3 text-left transition-all ${
                  data.copyrightType === o.value
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-white/5 bg-zinc-900/50 hover:bg-white/5 hover:border-white/10'
                }`}
              >
                <span className="text-sm font-medium text-white">{o.label}</span>
                <span className="mt-0.5 text-xs text-zinc-400">{o.subtext}</span>
              </button>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* Section B: Warunki współpracy (PDF) */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Warunki współpracy (PDF)</h3>
              <p className="text-xs text-zinc-400">
                Te informacje pojawią się jako klauzule na wygenerowanej wycenie.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Revisions */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="revisions-toggle" className="text-sm text-zinc-300 cursor-pointer">
                  Limit darmowych poprawek
                </Label>
                <Switch
                  id="revisions-toggle"
                  checked={data.includeRevisionsInfo}
                  onCheckedChange={(v) => updateField('includeRevisionsInfo', v)}
                  aria-label="Limit darmowych poprawek"
                />
              </div>
              <AnimatePresence initial={false}>
                {data.includeRevisionsInfo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center gap-4 pt-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="included-revisions" className="text-xs text-zinc-400 whitespace-nowrap">
                          Liczba darmowych rund
                        </Label>
                        <Input
                          id="included-revisions"
                          type="number"
                          min={0}
                          max={20}
                          value={data.includedRevisions}
                          onChange={(e) => updateField('includedRevisions', Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="extra-revision-price" className="text-xs text-zinc-400 whitespace-nowrap">
                          Koszt dodatkowej rundy (PLN)
                        </Label>
                        <Input
                          id="extra-revision-price"
                          type="number"
                          min={0}
                          step={50}
                          value={data.extraRevisionPrice}
                          onChange={(e) => updateField('extraRevisionPrice', Math.max(0, Number(e.target.value) || 0))}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Separator className="my-4 bg-white/5" />

            {/* Overtime */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="overtime-toggle" className="text-sm text-zinc-300 cursor-pointer">
                  Zasady nadgodzin na planie
                </Label>
                <Switch
                  id="overtime-toggle"
                  checked={data.includeOvertimeInfo}
                  onCheckedChange={(v) => updateField('includeOvertimeInfo', v)}
                  aria-label="Zasady nadgodzin na planie"
                />
              </div>
              <AnimatePresence initial={false}>
                {data.includeOvertimeInfo && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap items-center gap-4 pt-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="standard-day-hours" className="text-xs text-zinc-400 whitespace-nowrap">
                          Długość dnia pracy (godziny)
                        </Label>
                        <Input
                          id="standard-day-hours"
                          type="number"
                          min={1}
                          max={24}
                          value={data.standardDayHours}
                          onChange={(e) => updateField('standardDayHours', Math.max(1, Math.min(24, Number(e.target.value) || 10)))}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="overtime-hourly-rate" className="text-xs text-zinc-400 whitespace-nowrap">
                          Koszt nadgodziny (PLN/osobę)
                        </Label>
                        <Input
                          id="overtime-hourly-rate"
                          type="number"
                          min={0}
                          step={50}
                          value={data.overtimeHourlyRate}
                          onChange={(e) => updateField('overtimeHourlyRate', Math.max(0, Number(e.target.value) || 0))}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Opcje dodatkowe (Upsell) */}
      <motion.div variants={item}>
        <GlassCard>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Opcje dodatkowe (Upsell)</h3>
              <p className="text-xs text-zinc-400">
                Zasugeruj klientowi płatne opcje, które nie wchodzą w główną wycenę.
              </p>
            </div>
          </div>
          <Textarea
            value={data.opcjeDodatkowe}
            onChange={(e) => updateField('opcjeDodatkowe', e.target.value)}
            placeholder={'np. - ujęcia z drona FPV: 500 zł\n- dodatkowa wersja 9:16 (Reels): 800 zł'}
            className="bg-black/40 border-white/10 resize-none min-h-[100px] text-sm text-white placeholder:text-zinc-500"
          />
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}
