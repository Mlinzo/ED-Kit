import '@fontsource-variable/inter'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { DataProvider } from './api/DataProvider.tsx'
import { Store } from './api/store.ts'
import { createLiveTransport, type Transport } from './api/transport.ts'
import { lang, t } from './i18n'

document.documentElement.lang = lang
document.title = t.appName

function isMockMode(): boolean {
  const value = new URLSearchParams(window.location.search).get('mock')
  return value !== null && value !== '0' && value !== 'false'
}

async function createTransport(): Promise<Transport> {
  if (isMockMode()) {
    // Fixtures and the simulation live in a separate chunk, loaded only in demo mode.
    const { createMockTransport } = await import('./mock/index.ts')
    return createMockTransport()
  }
  return createLiveTransport()
}

void createTransport().then((transport) => {
  const store = new Store(transport)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DataProvider store={store}>
        <App />
      </DataProvider>
    </StrictMode>,
  )
})
