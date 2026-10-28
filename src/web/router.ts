import { createRouter, createWebHistory } from 'vue-router'
import { nextTick, watch } from 'vue'
import { auth } from './lib/auth'
import AppShell from './shells/AppShell.vue'
import AdminShell from './shells/AdminShell.vue'
import { beginNavigationMotion, clearNavigationMotion, finishNavigationMotion } from './lib/navigation-motion'

const positions = new Map<string, { left: number; top: number }>()
watch(() => auth.user?.id, () => { positions.clear(); clearNavigationMotion() })

export const router = createRouter({
  history: createWebHistory(),
  async scrollBehavior(to, from, saved): Promise<false> {
    if (to.path === from.path) return false
    await nextTick()
    const position = saved ?? positions.get(to.fullPath) ?? { left: 0, top: 0 }
    window.scrollTo(position.left, position.top)
    void finishNavigationMotion(to.path)
    return false
  },
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/read/:id', component: () => import('./pages/ReaderPage.vue') },
    { path: '/', component: AppShell, children: [
      { path: '', component: () => import('./pages/HomePage.vue') },
      { path: 'library', component: () => import('./pages/LibraryPage.vue') },
      { path: 'authors', component: () => import('./pages/TaxonomyPage.vue'), props: { kind: 'authors' } },
      { path: 'authors/:id', component: () => import('./pages/LibraryPage.vue'), props: (route) => ({ filterKind: 'author', filterValue: route.params.id }) },
      { path: 'series', component: () => import('./pages/TaxonomyPage.vue'), props: { kind: 'series' } },
      { path: 'series/:id', component: () => import('./pages/LibraryPage.vue'), props: (route) => ({ filterKind: 'series', filterValue: route.params.id }) },
      { path: 'genres', component: () => import('./pages/TaxonomyPage.vue'), props: { kind: 'genres' } },
      { path: 'genres/:id', component: () => import('./pages/LibraryPage.vue'), props: (route) => ({ filterKind: 'genre', filterValue: route.params.id }) },
      { path: 'favorites', component: () => import('./pages/LibraryPage.vue'), props: { filterKind: 'favorite', filterValue: 'true' } },
      { path: 'search', component: () => import('./pages/SearchPage.vue') },
      { path: 'books/:id', component: () => import('./pages/BookPage.vue') },
      { path: 'settings', component: () => import('./pages/SettingsPage.vue') },
    ] },
    { path: '/admin', component: AdminShell, meta: { admin: true }, children: [
      { path: '', component: () => import('./pages/admin/AdminHomePage.vue') },
      { path: 'libraries', component: () => import('./pages/admin/LibrariesPage.vue') },
      { path: 'libraries/:id', component: () => import('./pages/admin/LibraryDetailPage.vue') },
      { path: 'users', component: () => import('./pages/admin/UsersPage.vue') },
      { path: 'metadata', component: () => import('./pages/admin/MetadataPage.vue') },
      { path: 'jobs', component: () => import('./pages/admin/JobsPage.vue') },
      { path: 'compatibility', component: () => import('./pages/admin/CompatibilityPage.vue') },
      { path: 'system', component: () => import('./pages/admin/SystemPage.vue') },
    ] },
  ],
})

router.beforeEach((to, from) => {
  if (to.path !== from.path) {
    positions.set(from.fullPath, { left: window.scrollX, top: window.scrollY })
    if (positions.size > 60) positions.delete(positions.keys().next().value!)
  }
  if (!to.meta.public && !auth.user) return { path: '/login', query: { next: to.fullPath } }
  if (to.meta.admin && auth.user?.role !== 'admin') return '/'
  if (to.path === '/login' && auth.user) return '/'
})

router.beforeResolve((to, from) => beginNavigationMotion(from.path, to.path, from.fullPath, to.fullPath))

router.afterEach(async (to, from, failure) => {
  if (failure) void finishNavigationMotion(to.path, true)
  if (failure || to.path === from.path) return
  await nextTick()
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>('#main h1')
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
  })
})
