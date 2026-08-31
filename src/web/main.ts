import { createApp } from 'vue'
import App from './App.vue'
import { loadSession } from './lib/auth'
import { router } from './router'
import { initializeTheme } from './lib/theme'
import './styles.css'
import { initializePwa } from './lib/pwa'

initializeTheme()
initializePwa()
await loadSession()
createApp(App).use(router).mount('#app')
