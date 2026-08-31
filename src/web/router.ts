import { createRouter, createWebHistory } from 'vue-router'
import { auth } from './lib/auth'
import AppShell from './shells/AppShell.vue'
import AdminShell from './shells/AdminShell.vue'

export const router = createRouter({
  history: createWebHistory(),
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

router.beforeEach((to) => {
  if (!to.meta.public && !auth.user) return { path: '/login', query: { next: to.fullPath } }
  if (to.meta.admin && auth.user?.role !== 'admin') return '/'
  if (to.path === '/login' && auth.user) return '/'
})
