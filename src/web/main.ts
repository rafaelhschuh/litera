import { createApp } from 'vue'
import App from './App.vue'
import { auth, loadSession } from './lib/auth'
import { router } from './router'
import { initializeTheme } from './lib/theme'
import { initializeNavigation } from './lib/navigation'
import { prepareHome } from './lib/catalog-warmup'
import './styles.css'
import './reader-controls.css'
import { initializePwa } from './lib/pwa'
import { initializeOfflineSync } from './lib/offline-sync'

initializeTheme()
initializeNavigation()
initializePwa()
await loadSession()
initializeOfflineSync()
if (auth.user && location.pathname === '/') await prepareHome()
createApp(App).use(router).mount('#app')
