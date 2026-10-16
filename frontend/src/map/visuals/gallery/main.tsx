import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Bench } from './Bench'
import { Gallery } from './Gallery'

const bench = new URLSearchParams(window.location.search).has('bench')

createRoot(document.getElementById('root')!).render(<StrictMode>{bench ? <Bench /> : <Gallery />}</StrictMode>)
