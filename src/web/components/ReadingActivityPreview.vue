<script setup lang="ts">
/* global KeyboardEvent, HTMLButtonElement */
import { computed, ref } from 'vue'
import UiButton from './UiButton.vue'
import UiDialog from './UiDialog.vue'
import UiIcon from './UiIcon.vue'

// Deliberately visual-only and mounted exclusively in development. No session,
// progress or elapsed-time data is written by this preview.
const props = defineProps<{ books: Array<{ id: number; title: string }> }>()
const today = new Date(); today.setHours(0, 0, 0, 0)
const mondayOffset = (today.getDay() + 6) % 7
const start = new Date(today); start.setDate(start.getDate() - mondayOffset - 175)
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const fullDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const days = Array.from({ length: 182 }, (_, index) => {
  const date = new Date(start); date.setDate(start.getDate() + index)
  const offset = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  const seed = date.getDate() + date.getMonth() * 31
  const minutes = offset < 0 ? 0 : offset === 0 ? 38 : offset === 1 ? 27 : offset === 2 ? 19 : seed % 6 === 0 || seed % 9 === 0 ? 0 : [12, 24, 47, 65, 18, 36, 54][seed % 7]!
  return { date, key: key(date), minutes, future: offset < 0, level: minutes === 0 ? 0 : minutes < 20 ? 1 : minutes < 40 ? 2 : minutes < 60 ? 3 : 4 }
})
const todayIndex = 175 + mondayOffset
const selected = ref(todayIndex), open = ref(false), mode = ref<'day' | 'week'>('day')
const calendar = ref<HTMLElement>()
const currentWeek = days.slice(175, todayIndex + 1)
const selectedDay = computed(() => days[selected.value]!)
const period = computed(() => mode.value === 'day' ? [selectedDay.value] : days.slice(Math.floor(selected.value / 7) * 7, Math.floor(selected.value / 7) * 7 + 7).filter(day => !day.future))
const minutes = computed(() => period.value.reduce((sum, day) => sum + day.minutes, 0))
const highlights = (value: number) => Math.floor(value / 12)
function duration(value: number) { return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ''}` }
const weekMinutes = currentWeek.reduce((sum, day) => sum + day.minutes, 0)
const weekDays = currentWeek.filter(day => day.minutes > 0).length
const previousMinutes = days.slice(168, 168 + mondayOffset + 1).reduce((sum, day) => sum + day.minutes, 0)
const difference = previousMinutes ? Math.round((weekMinutes / previousMinutes - 1) * 100) : 0
const exampleBooks = computed(() => props.books.length ? props.books.slice(0, 2) : [{ id: 0, title: 'Livro em leitura' }, { id: -1, title: 'Outro livro' }])
const bookCount = (value: number) => value === 0 ? 0 : Math.min(exampleBooks.value.length, value >= 30 ? 2 : 1)
const periodTitle = computed(() => mode.value === 'day' ? fullDate.format(selectedDay.value.date) : `${shortDate.format(period.value[0]!.date)} — ${shortDate.format(period.value.at(-1)!.date)}`)
const dateValue = computed({ get: () => selectedDay.value.key, set: value => { const index = days.findIndex(day => day.key === value && !day.future); if (index >= 0) selected.value = index } })
const months = days.filter((day, index) => !day.future && (index === 0 || day.date.getDate() === 1)).map(day => new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(day.date)).join(' · ')
function details(index = todayIndex) { selected.value = index; mode.value = 'day'; open.value = true }
function move(direction: number) { selected.value = Math.max(0, Math.min(todayIndex, selected.value + direction * (mode.value === 'week' ? 7 : 1))) }
function calendarKey(event: KeyboardEvent, index: number) {
  const firstVisible = window.matchMedia('(max-width: 639px)').matches ? 98 : 0
  const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
  if (!(event.key in offsets)) return
  event.preventDefault(); selected.value = Math.max(firstVisible, Math.min(todayIndex, index + offsets[event.key]!))
  calendar.value?.querySelector<HTMLButtonElement>(`[data-day="${selected.value}"]`)?.focus()
}
</script>

<template>
  <section class="reading-activity" aria-labelledby="activity-title">
    <header class="reading-activity__header"><h2 id="activity-title">Sua leitura</h2><span class="reading-activity__preview">Prévia · dados ilustrativos</span></header>
    <dl class="reading-activity__numbers">
      <div><dt>Hoje</dt><dd>{{ duration(days[todayIndex]!.minutes) }}</dd><p>{{ bookCount(days[todayIndex]!.minutes) }} livros · {{ highlights(days[todayIndex]!.minutes) }} destaques</p></div>
      <div><dt>Esta semana</dt><dd>{{ duration(weekMinutes) }}</dd><p>{{ weekDays }} {{ weekDays === 1 ? 'dia' : 'dias' }} de leitura</p></div>
    </dl>
    <div class="reading-activity__calendar-heading"><span class="reading-activity__desktop-period">Últimos 6 meses</span><span class="reading-activity__mobile-period">Últimas 12 semanas</span><span class="reading-activity__desktop-period">{{ months }}</span></div>
    <div class="reading-activity__calendar-wrap">
      <div class="reading-activity__weekdays" aria-hidden="true"><span>Seg</span><span></span><span>Qua</span><span></span><span>Sex</span><span></span><span></span></div>
      <div ref="calendar" class="reading-activity__calendar" role="group" aria-label="Calendário de leitura ilustrativo. Use as setas para explorar e Enter para abrir o dia.">
        <button v-for="(day, index) in days" :key="day.key" :data-day="index" class="reading-activity__day" :class="{ 'is-today': index === todayIndex }" :data-level="day.level" :disabled="day.future" :tabindex="index === todayIndex ? 0 : -1" :aria-label="`${fullDate.format(day.date)}: ${day.minutes ? duration(day.minutes) + ' de leitura' : 'sem leitura'} (ilustrativo)`" :title="`${fullDate.format(day.date)} · ${duration(day.minutes)}`" @keydown="calendarKey($event, index)" @click="details(index)"></button>
      </div>
    </div>
    <footer class="reading-activity__footer"><span class="reading-activity__legend" aria-hidden="true">Menos <i v-for="level in 5" :key="level" :data-level="level - 1"></i> Mais</span><UiButton variant="quiet" @click="details()">Ver detalhes<UiIcon name="chevron-right" :size="16" /></UiButton></footer>
  </section>

  <UiDialog :open="open" title="Sua leitura" @close="open = false">
    <div class="reading-activity-detail">
      <div class="segmented-control" aria-label="Período"><button :aria-pressed="mode === 'day'" @click="mode = 'day'">Dia</button><button :aria-pressed="mode === 'week'" @click="mode = 'week'">Semana</button></div>
      <div class="reading-activity-detail__date"><button class="icon-button" :disabled="selected === 0 || (mode === 'week' && Math.floor(selected / 7) === 0)" aria-label="Período anterior" @click="move(-1)"><UiIcon name="chevron-left" /></button><label class="sr-only" for="activity-date">Escolher dia</label><input id="activity-date" v-model="dateValue" type="date" :min="days[0]!.key" :max="days[todayIndex]!.key" /><button class="icon-button" :disabled="selected >= todayIndex || (mode === 'week' && Math.floor(selected / 7) === 25)" aria-label="Próximo período" @click="move(1)"><UiIcon name="chevron-right" /></button></div>
      <h3>{{ periodTitle }}</h3>
      <dl class="reading-activity-detail__numbers"><div><dt>Tempo de leitura</dt><dd>{{ duration(minutes) }}</dd></div><div><dt>{{ mode === 'day' ? 'Destaques' : 'Dias com leitura' }}</dt><dd>{{ mode === 'day' ? highlights(minutes) : period.filter(day => day.minutes).length }}</dd></div></dl>
      <p v-if="mode === 'week' && Math.floor(selected / 7) === 25 && difference" class="field__hint">{{ difference > 0 ? '+' : '' }}{{ difference }}% em relação ao mesmo período da semana passada.</p>
      <div v-if="mode === 'week'" class="reading-activity-detail__bars" aria-label="Tempo por dia"><div v-for="(day, index) in period" :key="day.key"><span>{{ day.minutes }} min</span><i :style="{ height: `${Math.max(4, day.minutes / Math.max(...period.map(item => item.minutes), 1) * 100)}%` }" aria-hidden="true"></i><small>{{ ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][index] }}</small></div></div>
      <ul v-if="minutes" class="reading-activity-detail__books"><li v-for="book in exampleBooks.slice(0, bookCount(minutes))" :key="book.id"><UiIcon name="book-open" /><span>{{ book.title }}</span></li></ul>
      <p v-else class="field__hint">Nenhuma leitura neste dia ilustrativo.</p>
      <p class="reading-activity-detail__notice">Prévia visual. O tempo de leitura ainda não está sendo registrado.</p>
    </div>
  </UiDialog>
</template>

<style scoped>
.reading-activity{--activity-0:var(--surface-secondary);--activity-1:var(--accent-soft);--activity-2:var(--accent);--activity-3:var(--accent);--activity-4:var(--accent);margin-bottom:var(--space-7);padding:var(--space-5);border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)}
@supports(background:color-mix(in srgb,red,white)){.reading-activity{--activity-2:color-mix(in srgb,var(--accent) 42%,var(--accent-soft));--activity-3:color-mix(in srgb,var(--accent) 72%,var(--accent-soft))}}
.reading-activity__header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-5)}
.reading-activity__header h2{margin:0;font-size:var(--text-lg)}
.reading-activity__preview{color:var(--text-secondary);font-size:var(--text-xs)}
.reading-activity__numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-5);margin:0 0 var(--space-6)}
.reading-activity__numbers>div+div{padding-left:var(--space-5);border-left:1px solid var(--border)}
.reading-activity__numbers dt{margin-bottom:var(--space-2);color:var(--text-secondary);font-size:var(--text-sm)}
.reading-activity__numbers dd{margin:0;font:400 var(--text-2xl)/1.2 var(--font-editorial);font-variant-numeric:tabular-nums}
.reading-activity__numbers p{margin:var(--space-2) 0 0;color:var(--text-secondary);font-size:var(--text-xs)}
.reading-activity__calendar-heading{display:flex;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-3);color:var(--text-secondary);font-size:var(--text-xs)}
.reading-activity__calendar-wrap{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--space-3)}
.reading-activity__weekdays{display:grid;grid-template-rows:repeat(7,1fr);gap:var(--space-1);color:var(--text-tertiary);font-size:var(--text-xs)}
.reading-activity__weekdays span{display:flex;align-items:center}
.reading-activity__calendar{display:grid;grid-template-columns:repeat(26,minmax(0,1fr));grid-template-rows:repeat(7,1fr);grid-auto-flow:column;gap:var(--space-1)}
.reading-activity__day{display:block;width:100%;min-width:0;min-height:0;aspect-ratio:1;padding:0;border:0;border-radius:var(--space-1);cursor:pointer;transition:transform var(--motion-fast) var(--ease-standard)}
.reading-activity__day:hover:not(:disabled){transform:scale(1.12)}
.reading-activity [data-level="0"]{background:var(--activity-0)}.reading-activity [data-level="1"]{background:var(--activity-1)}.reading-activity [data-level="2"]{background:var(--activity-2)}.reading-activity [data-level="3"]{background:var(--activity-3)}.reading-activity [data-level="4"]{background:var(--activity-4)}
.reading-activity__day.is-today{outline:1px solid var(--accent);outline-offset:2px}
.reading-activity__day:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.reading-activity__day:disabled{opacity:.3;cursor:default}
.reading-activity__footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3)}
.reading-activity__legend{display:flex;align-items:center;gap:var(--space-1);color:var(--text-secondary);font-size:var(--text-xs)}
.reading-activity__legend i{width:var(--space-3);height:var(--space-3);border-radius:var(--space-1)}
.reading-activity__footer .button{padding-inline:var(--space-2);font-size:var(--text-sm)}
.reading-activity-detail{display:grid;gap:var(--space-5)}
.reading-activity-detail .segmented-control{justify-self:start}
.reading-activity-detail__date{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:var(--space-2)}
.reading-activity-detail h3{margin:0;color:var(--text-secondary);font-size:var(--text-md);font-weight:500}
.reading-activity-detail__numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4);margin:0}
.reading-activity-detail__numbers dt{color:var(--text-secondary);font-size:var(--text-sm)}
.reading-activity-detail__numbers dd{margin:var(--space-2) 0 0;font:400 var(--text-2xl)/1.2 var(--font-editorial)}
.reading-activity-detail__books{display:grid;gap:var(--space-3);list-style:none;margin:0;padding:0}
.reading-activity-detail__books li{display:flex;align-items:center;gap:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--border);font-size:var(--text-sm)}
.reading-activity-detail__books .ui-icon{color:var(--accent)}
.reading-activity-detail__notice{margin:0;padding-top:var(--space-4);border-top:1px solid var(--border);color:var(--text-secondary);font-size:var(--text-xs)}
.reading-activity-detail__bars{display:flex;align-items:stretch;gap:var(--space-2);height:var(--space-8);margin-block:var(--space-4)}
.reading-activity-detail__bars>div{position:relative;display:flex;flex:1;align-items:flex-end;justify-content:center;min-width:0}
.reading-activity-detail__bars i{width:var(--space-4);min-height:var(--space-1);border-radius:var(--space-1);background:var(--accent)}
.reading-activity-detail__bars span{position:absolute;bottom:calc(100% + var(--space-2));color:var(--text-secondary);font-size:var(--text-xs);white-space:nowrap}
.reading-activity-detail__bars small{position:absolute;top:calc(100% + var(--space-1));color:var(--text-secondary);font-size:var(--text-xs)}
.reading-activity__mobile-period{display:none}
@media(min-width:900px){.reading-activity{max-width:48rem}}
@media(max-width:639px){.reading-activity__desktop-period{display:none}.reading-activity__mobile-period{display:inline}.reading-activity__calendar{grid-template-columns:repeat(12,minmax(0,1fr))}.reading-activity__day:nth-child(-n+98){display:none}.reading-activity{padding:var(--space-4)}.reading-activity__numbers{gap:var(--space-3)}.reading-activity__numbers>div+div{padding-left:var(--space-3)}.reading-activity__numbers dd{font-size:var(--text-2xl)}.reading-activity__calendar-wrap{gap:var(--space-2)}.reading-activity-detail__numbers dd{font-size:var(--text-xl);white-space:nowrap}}
</style>
