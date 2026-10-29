<script setup lang="ts">
/* global KeyboardEvent, HTMLButtonElement */
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import UiButton from './UiButton.vue'
import UiDialog from './UiDialog.vue'
import UiIcon from './UiIcon.vue'
import { loadReadingActivity, syncState } from '../lib/offline-sync'
import { usePageData } from '../lib/page-data'
import { emptyActivity, localDate, type ActivityDay } from '../../shared/reading-activity'

const today = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date }
const range = () => { const end = today(), start = new Date(end); start.setDate(start.getDate() - 181); return { from: localDate(start), to: localDate(end), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } }
const { data, state, error, refreshing, refresh } = usePageData(() => { const value = range(); return loadReadingActivity(value.from, value.to, value.timeZone) })
const activity = computed(() => { const value = range(); return data.value ?? emptyActivity(value.from, value.to, value.timeZone) })
const lastSeven = computed(() => activity.value.days.slice(-7))
const selected = ref(localDate()), open = ref(false), mode = ref<'day' | 'week' | 'month'>('day')
const selectedDate = computed({
  get: () => selected.value,
  set: (value: string) => {
    const parsed = date(value)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && localDate(parsed) === value) selected.value = [activity.value.from, value, activity.value.to].sort()[1]!
  },
})
const calendar = ref<HTMLElement>(), showAllBooks = ref(false)
const fullDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
function date(value: string) { return new Date(`${value}T12:00:00`) }
function duration(seconds: number) {
  if (seconds > 0 && seconds < 60) return '< 1 min'
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}
function compactDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return seconds > 0 && minutes === 0 ? '<1m' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`
}
function level(seconds: number) { return seconds <= 0 ? 0 : seconds < 15 * 60 ? 1 : seconds < 30 * 60 ? 2 : seconds < 60 * 60 ? 3 : 4 }
const totalWeek = computed(() => lastSeven.value.reduce((sum, day) => sum + day.seconds, 0))
const bounds = computed(() => {
  const start = date(selected.value), end = date(selected.value)
  if (mode.value === 'week') { start.setDate(start.getDate() - (start.getDay() + 6) % 7); end.setTime(start.getTime()); end.setDate(end.getDate() + 6) }
  if (mode.value === 'month') { start.setDate(1); end.setMonth(end.getMonth() + 1, 0) }
  return { from: localDate(start) < activity.value.from ? activity.value.from : localDate(start), to: localDate(end) > activity.value.to ? activity.value.to : localDate(end) }
})
const period = computed(() => activity.value.days.filter(day => day.date >= bounds.value.from && day.date <= bounds.value.to))
const seconds = computed(() => period.value.reduce((sum, day) => sum + day.seconds, 0))
const sessions = computed(() => new Set(period.value.flatMap(day => day.sessionIds)).size)
const highlights = computed(() => period.value.reduce((sum, day) => sum + day.highlights, 0))
const books = computed(() => activity.value.books.map(book => ({ ...book, seconds: book.days.filter(day => day.date >= bounds.value.from && day.date <= bounds.value.to).reduce((sum, day) => sum + day.seconds, 0), highlights: book.days.filter(day => day.date >= bounds.value.from && day.date <= bounds.value.to).reduce((sum, day) => sum + day.highlights, 0) })).filter(book => book.seconds || book.highlights).sort((a, b) => b.seconds - a.seconds))
const title = computed(() => mode.value === 'day' ? fullDate.format(date(selected.value)) : mode.value === 'month' ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date(selected.value)) : `${shortDate.format(date(bounds.value.from))} — ${shortDate.format(date(bounds.value.to))}`)
const previousSeconds = computed(() => {
  const length = period.value.length, previousEnd = date(bounds.value.from); previousEnd.setDate(previousEnd.getDate() - 1)
  const previousStart = new Date(previousEnd); previousStart.setDate(previousEnd.getDate() - length + 1)
  return activity.value.days.filter(day => day.date >= localDate(previousStart) && day.date <= localDate(previousEnd)).reduce((sum, day) => sum + day.seconds, 0)
})
const change = computed(() => {
  const previousStart = date(bounds.value.from); previousStart.setDate(previousStart.getDate() - period.value.length)
  return previousSeconds.value && activity.value.recordingSince && localDate(previousStart) >= activity.value.from && localDate(previousStart) >= activity.value.recordingSince ? Math.round((seconds.value / previousSeconds.value - 1) * 100) : undefined
})
const calendarDays = computed(() => {
  const result: Array<ActivityDay | undefined> = [], first = date(activity.value.from)
  for (let index = 0; index < (first.getDay() + 6) % 7; index++) result.push(undefined)
  return [...result, ...activity.value.days]
})
function details(day = activity.value.to) { selected.value = day; mode.value = 'day'; showAllBooks.value = false; open.value = true }
function move(direction: number) {
  const target = date(selected.value)
  if (mode.value === 'month') target.setMonth(target.getMonth() + direction, 1)
  else target.setDate(target.getDate() + direction * (mode.value === 'week' ? 7 : 1))
  selected.value = [activity.value.from, localDate(target), activity.value.to].sort()[1]!
}
function calendarKey(event: KeyboardEvent, index: number) {
  const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
  if (!(event.key in offsets)) return
  event.preventDefault()
  let next = Math.max(0, Math.min(calendarDays.value.length - 1, index + offsets[event.key]!))
  while (next < calendarDays.value.length && !calendarDays.value[next]) next++
  const day = calendarDays.value[next]
  if (day) { selected.value = day.date; mode.value = 'day'; calendar.value?.querySelector<HTMLButtonElement>(`[data-date="${day.date}"]`)?.focus() }
}
let active = true, refreshTimer: ReturnType<typeof window.setTimeout> | undefined
onActivated(() => { active = true })
onDeactivated(() => { active = false; open.value = false })
watch(() => syncState.lastSyncedAt, () => { if (active) { window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => { void refresh() }, 500) } })
onBeforeUnmount(() => window.clearTimeout(refreshTimer))
</script>

<template>
  <section class="reading-activity" aria-label="Sua leitura nos últimos sete dias" :aria-busy="refreshing">
    <template v-if="state === 'loading'"><span class="loading-spinner" aria-hidden="true"></span><span class="field__hint">Carregando leitura…</span></template>
    <template v-else-if="state === 'error'"><span class="field__hint">Histórico indisponível</span><button class="text-link" @click="refresh">Tentar novamente</button></template>
    <template v-else>
      <div class="reading-activity__seven" aria-label="Últimos sete dias"><button v-for="day in lastSeven" :key="day.date" :title="`${fullDate.format(date(day.date))} · ${duration(day.seconds)}`" :aria-label="`${fullDate.format(date(day.date))}: ${duration(day.seconds)} de leitura. Abrir detalhes.`" @click="details(day.date)"><i :data-level="level(day.seconds)" :class="{'is-today':day.date===activity.to}" aria-hidden="true"></i></button></div>
      <span class="reading-activity__total" :title="`${duration(totalWeek)} nos últimos sete dias`">{{ duration(totalWeek) }}</span>
      <UiButton variant="quiet" @click="details()">Detalhes<UiIcon name="chevron-right" :size="16" /></UiButton>
    </template>
  </section>
  <UiDialog :open="open" title="Sua leitura" @close="open = false">
    <div class="activity-details">
      <div class="activity-details__toolbar"><div class="segmented-control" aria-label="Período de leitura"><button v-for="option in (['day','week','month'] as const)" :key="option" :aria-pressed="mode===option" @click="mode=option">{{ {day:'Dia',week:'Semana',month:'Mês'}[option] }}</button></div><button class="icon-button" :disabled="refreshing" aria-label="Atualizar histórico" @click="refresh"><UiIcon name="refresh" /></button></div>
      <div class="activity-details__date"><button class="icon-button" :disabled="bounds.from<=activity.from" aria-label="Período anterior" @click="move(-1)"><UiIcon name="chevron-left" /></button><label class="sr-only" for="activity-date">Escolher data</label><input id="activity-date" v-model="selectedDate" type="date" :min="activity.from" :max="activity.to" /><button class="icon-button" :disabled="bounds.to>=activity.to" aria-label="Próximo período" @click="move(1)"><UiIcon name="chevron-right" /></button></div>
      <h3 class="activity-details__period">{{ title }}</h3>
      <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
      <dl class="activity-details__numbers"><div><dt>Tempo ativo</dt><dd>{{ duration(seconds) }}</dd></div><div><dt>Sessões</dt><dd>{{ sessions }}</dd></div><div><dt>Livros</dt><dd>{{ books.length }}</dd></div><div><dt>Destaques</dt><dd>{{ highlights }}</dd></div></dl>
      <p v-if="change!==undefined && activity.recordingSince && bounds.from>activity.recordingSince" class="field__hint">{{ change>0?'+':'' }}{{ change }}% em relação aos {{ period.length }} {{ period.length===1?'dia anterior':'dias anteriores' }}.</p>
      <div v-if="mode==='week'" class="activity-details__bars" aria-label="Tempo por dia"><div v-for="day in period" :key="day.date"><span :title="duration(day.seconds)">{{ compactDuration(day.seconds) }}</span><i :style="{height:`${Math.max(3,day.seconds/Math.max(...period.map(item=>item.seconds),1)*100)}%`}" :class="{'is-empty':!day.seconds}" aria-hidden="true"></i><small>{{ new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(date(day.date)).slice(0,3) }}</small></div></div>
      <details class="activity-details__history"><summary>Calendário completo <span>6 meses</span></summary><div class="activity-details__calendar-scroll"><div ref="calendar" class="activity-details__calendar" role="group" aria-label="Calendário. Use setas para explorar dias e Enter para selecionar."><template v-for="(day,index) in calendarDays" :key="day?.date??`pad-${index}`"><button v-if="day" :data-date="day.date" :tabindex="day.date===selected?0:-1" :aria-label="`${fullDate.format(date(day.date))}: ${duration(day.seconds)}`" :title="`${fullDate.format(date(day.date))} · ${duration(day.seconds)}`" @click="selected=day.date;mode='day'" @keydown="calendarKey($event,index)"><i :data-level="level(day.seconds)" :class="{'is-selected':day.date===selected}" aria-hidden="true"></i></button><span v-else></span></template></div></div><span class="activity-details__legend" aria-hidden="true">Menos <i v-for="value in 5" :key="value" :data-level="value-1"></i> Mais</span></details>
      <section class="activity-details__books"><h3>Livros no período</h3><ul v-if="books.length"><li v-for="book in (showAllBooks?books:books.slice(0,5))" :key="book.id"><RouterLink :to="`/books/${book.id}`" @click="open=false"><UiIcon name="book-open" /><span>{{ book.title }}<small v-if="book.author">{{ book.author }}</small></span><strong>{{ duration(book.seconds) }}</strong></RouterLink></li></ul><p v-else class="field__hint">Nenhuma atividade registrada neste período.</p><button v-if="books.length>5" class="text-link" @click="showAllBooks=!showAllBooks">{{ showAllBooks?'Mostrar menos':`Ver os ${books.length} livros` }}</button></section>
      <footer class="activity-details__note"><p v-if="activity.offline">Offline · histórico salvo neste dispositivo.</p><p v-if="activity.pending">Inclui leituras locais ainda não confirmadas no histórico.</p><p>{{ activity.recordingSince ? `Medição desde ${fullDate.format(date(activity.recordingSince))}.` : 'A medição começa quando você lê um livro.' }} Tempo estimado com o leitor visível; pausa após 2 minutos sem interação. Não há medição retroativa.</p></footer>
    </div>
  </UiDialog>
</template>

<style scoped>
.reading-activity,.activity-details{--activity-0:var(--surface-secondary);--activity-1:var(--accent-soft);--activity-2:var(--accent);--activity-3:var(--accent);--activity-4:var(--accent)}
@supports(background:color-mix(in srgb,red,white)){.reading-activity,.activity-details{--activity-2:color-mix(in srgb,var(--accent) 42%,var(--accent-soft));--activity-3:color-mix(in srgb,var(--accent) 72%,var(--accent-soft))}}
[data-level="0"]{background:var(--activity-0);border:1px solid var(--border)}[data-level="1"]{background:var(--activity-1)}[data-level="2"]{background:var(--activity-2)}[data-level="3"]{background:var(--activity-3)}[data-level="4"]{background:var(--activity-4)}
.reading-activity{display:flex;align-items:center;gap:var(--space-3);min-height:var(--space-7);margin-bottom:var(--space-6);border-bottom:1px solid var(--border)}
.reading-activity__seven{display:flex;flex-shrink:0}
.reading-activity__seven button{display:grid;place-items:center;width:var(--space-5);padding:0;border:0;border-radius:var(--radius-xs);background:none;cursor:pointer}
.reading-activity__seven i{width:var(--space-4);height:var(--space-4);border-radius:var(--space-1)}
.reading-activity__seven .is-today{outline:1px solid var(--accent);outline-offset:2px}
.reading-activity__total{color:var(--text-secondary);font-size:var(--text-sm);white-space:nowrap;font-variant-numeric:tabular-nums}
.reading-activity>.button{margin-left:auto;padding-inline:var(--space-2);font-size:var(--text-sm);white-space:nowrap}
.activity-details{display:grid;gap:var(--space-5)}
.activity-details__toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2)}
.activity-details__date{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:var(--space-2)}
.activity-details__period{margin:0;color:var(--text-secondary);font-size:var(--text-md);font-weight:500}
.activity-details__numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-5);margin:0}
.activity-details__numbers dt{color:var(--text-secondary);font-size:var(--text-sm)}
.activity-details__numbers dd{margin:var(--space-2) 0 0;font:400 var(--text-2xl)/1.2 var(--font-editorial);white-space:nowrap}
.activity-details__bars{display:flex;gap:var(--space-2);height:var(--space-8);margin-block:var(--space-4)}
.activity-details__bars>div{position:relative;display:flex;flex:1;align-items:flex-end;justify-content:center;min-width:0}
.activity-details__bars i{width:var(--space-4);min-height:var(--space-1);border-radius:var(--space-1);background:var(--accent)}
.activity-details__bars i.is-empty{background:var(--surface-secondary)}
.activity-details__bars span{position:absolute;bottom:calc(100% + var(--space-2));color:var(--text-secondary);font-size:var(--text-xs);white-space:nowrap}
.activity-details__bars small{position:absolute;top:calc(100% + var(--space-1));color:var(--text-secondary);font-size:var(--text-xs)}
.activity-details__history{border-block:1px solid var(--border);padding-block:var(--space-2)}
.activity-details__history summary{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);min-height:44px;cursor:pointer;font-size:var(--text-sm)}
.activity-details__history summary span{color:var(--text-secondary);font-size:var(--text-xs)}
.activity-details__history summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.activity-details__calendar-scroll{overflow-x:auto;padding:var(--space-2) 0}
.activity-details__calendar{display:grid;grid-auto-flow:column;grid-template-columns:repeat(27,var(--space-4));grid-template-rows:repeat(7,var(--space-4));gap:var(--space-1);width:max-content;padding:var(--space-1)}
.activity-details__calendar button{min-height:0;width:var(--space-4);height:var(--space-4);padding:0;border:0;border-radius:var(--space-1);background:none;cursor:pointer}
.activity-details__calendar i{display:block;width:100%;height:100%;border-radius:var(--space-1)}
.activity-details__calendar .is-selected{outline:1px solid var(--accent);outline-offset:2px}
.activity-details__legend{display:flex;align-items:center;justify-content:flex-end;gap:var(--space-1);margin-top:var(--space-2);color:var(--text-secondary);font-size:var(--text-xs)}
.activity-details__legend i{width:var(--space-3);height:var(--space-3);border-radius:var(--space-1)}
.activity-details__books h3{font-size:var(--text-md)}
.activity-details__books ul{list-style:none;margin:0;padding:0}
.activity-details__books li{border-top:1px solid var(--border)}
.activity-details__books a{display:flex;align-items:center;gap:var(--space-3);min-height:var(--space-8);padding-block:var(--space-3);text-decoration:none}
.activity-details__books a>span{flex:1;min-width:0;overflow-wrap:anywhere;font-size:var(--text-sm)}
.activity-details__books small{display:block;color:var(--text-secondary);font-size:var(--text-xs)}
.activity-details__books strong{font-size:var(--text-sm);font-weight:500;white-space:nowrap}
.activity-details__books .ui-icon{color:var(--accent)}
.activity-details__note{padding-top:var(--space-4);border-top:1px solid var(--border);color:var(--text-secondary);font-size:var(--text-xs)}
.activity-details__note p{margin:0 0 var(--space-2)}
@media(max-width:639px){.activity-details .segmented-control button{padding-inline:var(--space-3)}.activity-details__numbers dd{font-size:var(--text-xl)}}
@media(max-width:359px){.reading-activity{gap:var(--space-2)}.reading-activity__total{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}}
</style>
