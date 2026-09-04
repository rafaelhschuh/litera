import { createApp } from 'vue'
import App from './App.vue'
import { loadSession } from './lib/auth'
import { router } from './router'
import { initializeTheme } from './lib/theme'
import './styles.css'
import { initializePwa } from './lib/pwa'
import { initializeOfflineSync } from './lib/offline-sync'

initializeTheme()
initializePwa()
await loadSession()
initializeOfflineSync()
createApp(App).use(router).mount('#app')
