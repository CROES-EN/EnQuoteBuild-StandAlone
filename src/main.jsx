import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import '@/theme-overrides.css'
import { isWorkerDataSource } from '@/api/dataClient'
import { installBrowserBridge } from '@/api/browserBridge'
import { installPreferenceSync } from '@/lib/preferenceSync'

if (isWorkerDataSource) installBrowserBridge();
installPreferenceSync();

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
