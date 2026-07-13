'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Bookmark, Check, CircleStop, Map, Menu, Moon, Share2, Sparkles, Sun } from 'lucide-react'
import { tripDossierSchema, type PlanningPhase, type TripDossier } from '@/lib/travel/types'
import { TripDossierView } from './trip-dossier'
import { MotionShell } from './motion-shell'

const TravelMap = dynamic(() => import('./travel-map').then((mod) => mod.TravelMap), { ssr: false, loading: () => <div className="map-loading">Drawing the atlas…</div> })

export function TravelPlanner() {
  const [input, setInput] = useState('')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [saved, setSaved] = useState(false)
  const [mapOpen, setMapOpen] = useState(true)
  const [trip, setTrip] = useState<TripDossier | null>(null)
  const [phase, setPhase] = useState<PlanningPhase>('idle')
  const [label, setLabel] = useState('Atlas is ready')
  const [activeRequest, setActiveRequest] = useState('')
  const [activity, setActivity] = useState<string[]>([])
  const [error, setError] = useState('')
  const busy = phase === 'researching' || phase === 'composing'

  useEffect(() => {
    const stored = localStorage.getItem('atlas-latest-trip')
    if (!stored) return
    try {
      const parsed = tripDossierSchema.safeParse(JSON.parse(stored))
      if (parsed.success) { setTrip(parsed.data); setActiveRequest(parsed.data.request); setPhase('complete'); setLabel('Restored live itinerary') }
      else localStorage.removeItem('atlas-latest-trip')
    } catch { localStorage.removeItem('atlas-latest-trip') }
  }, [])

  async function submit(text = input) {
    const request = text.trim()
    if (!request || busy) return
    setInput(''); setActiveRequest(request); setError(''); setActivity(['Request received']); setPhase('researching'); setLabel('Locating your destination')
    try {
      const response = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }) })
      if (!response.ok || !response.body) throw new Error('The planning service is unavailable.')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line) continue
          const event = JSON.parse(line)
          if (event.type === 'status') { setPhase(event.data.phase); setLabel(event.data.label); setActivity((items) => [...items, event.data.label]) }
          if (event.type === 'location') { setLabel(`Found ${event.data.destination}, ${event.data.country}`); setActivity((items) => [...items, `Mapped ${event.data.destination}`]) }
          if (event.type === 'research') setActivity((items) => [...items, `Checked ${event.data.sources.join(', ')}`])
          if (event.type === 'trip') { const parsed = tripDossierSchema.parse(event.data); setTrip(parsed); localStorage.setItem('atlas-latest-trip', JSON.stringify(parsed)) }
          if (event.type === 'error') throw new Error(event.data.message)
        }
      }
    } catch (caught) { setPhase('error'); setError(caught instanceof Error ? caught.message : 'Planning failed.'); setLabel('Request needs attention') }
  }

  function startNewJourney() { setTrip(null); setPhase('idle'); setActiveRequest(''); setActivity([]); setError(''); setLabel('Atlas is ready'); localStorage.removeItem('atlas-latest-trip') }

  return (
    <div className={theme}>
      <MotionShell><main className="app-shell">
        <header className="nav">
          <a className="brand" href="#top" aria-label="Atlas home"><span className="brand-mark">A</span><span><strong>ATLAS</strong><small>Travel intelligence</small></span></a>
          <nav aria-label="Primary navigation"><a href="#plan">Plan</a><a href="#itinerary">Itinerary</a><a href="#notes">Field notes</a></nav>
          <div className="nav-actions"><button aria-label="Save trip" onClick={() => setSaved(!saved)}>{saved ? <Check /> : <Bookmark />}</button><button aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</button><button className="menu" aria-label="Open menu"><Menu /></button></div>
        </header>

        <section className="hero" id="top">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
            <span className="eyebrow"><Sparkles /> Autonomous trip design</span>
            <h1><span className="hero-line"><span className="hero-motion-line">Go somewhere</span></span><span className="hero-line"><em className="hero-motion-line">worth remembering.</em></span></h1>
            <p>Tell Atlas what moves you. It researches the weather, places, culture and costs—then composes a journey that feels distinctly yours.</p>
          </motion.div>
          <div className="hero-aside"><span>{trip ? `${trip.coordinates[0].toFixed(4)}°` : 'LIVE WORLD DATA'}</span><div /><span>{trip ? `${trip.destination} · ${trip.country}` : 'ANY DESTINATION'}</span></div>
        </section>

        <section className="planner" id="plan">
          <div className="conversation">
            <div className="conversation-top"><div><span className="status-dot" />{label}</div><span>{phase === 'idle' ? 'Awaiting request' : phase}</span></div>
            <div className="messages" aria-live="polite">
              {!activeRequest ? <div className="empty-chat"><p>Where shall we begin?</p><span>A place, a feeling, a rough budget—any of these will do.</span></div> : <><div className="message user"><span>YOU</span><div><p>{activeRequest}</p></div></div><div className="message assistant"><span>ATLAS</span><div><p>{phase === 'complete' && trip ? trip.thesis : label}</p>{activity.slice(-4).map((item, index) => <div className="tool-call" key={`${item}-${index}`}><span className={index < activity.length - 1 || phase === 'complete' ? 'complete' : ''}><Check /></span><p><strong>{item}</strong><small>{phase === 'complete' ? 'Complete' : 'Live request activity'}</small></p></div>)}</div></div></>}
              {busy && <div className="thinking"><i /><i /><i /><span>{label}</span></div>}
              {error && <div className="error"><p>{error}</p><button onClick={() => submit(activeRequest)}>Retry request</button></div>}
            </div>
            <form className="composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
              <label className="sr-only" htmlFor="trip-request">Describe your ideal trip</label>
              <textarea id="trip-request" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() } }} placeholder="Where do you want to go, for how long, and on what budget?" rows={2} />
              <button type="submit" disabled={busy} aria-label={busy ? 'Planning request' : 'Send request'}>{busy ? <CircleStop /> : <ArrowUp />}</button>
            </form>
          </div>
          <motion.div className="map-panel" layout transition={{ type: 'spring', stiffness: 180, damping: 24 }}><AnimatePresence mode="wait">{mapOpen ? <motion.div key="map-open" className="map-motion-frame" initial={{ opacity: 0, scale: .985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .985 }}><TravelMap trip={trip ?? undefined} /></motion.div> : <motion.div key="map-closed" className="map-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Map folded away.</motion.div>}</AnimatePresence><motion.button whileHover={{ y: -2 }} whileTap={{ scale: .96 }} className="map-toggle" onClick={() => setMapOpen(!mapOpen)}><Map />{mapOpen ? 'Hide map' : 'Open map'}</motion.button></motion.div>
        </section>

        <AnimatePresence>{(busy || activity.length > 0) && <motion.section className="agent-trace" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div><span>LIVE FIELDWORK</span><strong>{busy ? 'Research in progress' : 'Research complete'}</strong></div><div className="trace-list">{activity.slice(-5).map((item, index) => <span key={`${item}-${index}`}><i className={index < activity.length - 1 || phase === 'complete' ? 'done' : ''} />{item}</span>)}</div></motion.section>}</AnimatePresence>

        {trip ? <>
          <div className="result-heading"><span>Generated live from your request</span><button onClick={startNewJourney}>Start a new journey</button></div>
          <div id="itinerary"><TripDossierView key={trip.id} trip={trip} /></div>
          {trip.gallery.length > 0 && <section className="destination-gallery motion-reveal" aria-labelledby="gallery-title"><div className="gallery-heading"><span>Destination photography</span><h2 id="gallery-title">A glimpse of {trip.destination}</h2><p>Verified views connected to this destination.</p></div><motion.div className="gallery-grid" initial="hidden" whileInView="visible" viewport={{ once: true, amount: .15 }} variants={{ hidden: {}, visible: { transition: { staggerChildren: .09 } } }}>{trip.gallery.map((image, index) => <motion.figure key={`${image.url}-${index}`} className={index === 0 ? 'gallery-feature' : ''} variants={{ hidden: { opacity: 0, y: 30, clipPath: 'inset(12% 0 0 0)' }, visible: { opacity: 1, y: 0, clipPath: 'inset(0% 0 0 0)', transition: { duration: .7 } } }} whileHover={{ y: -5 }}><img src={image.url} alt={image.alt} loading="lazy" /><figcaption><a href={image.photographerUrl} target="_blank" rel="noreferrer">View image source</a></figcaption></motion.figure>)}</motion.div></section>}
          <section className="postcard" id="notes" style={trip.heroImage ? { backgroundImage: `linear-gradient(rgba(17,19,15,.2),rgba(17,19,15,.78)),url(${trip.heroImage})` } : undefined} aria-label={trip.imageAlt}><div className="postcard-inner"><span className="eyebrow">A place to remember</span><h2>{trip.destination}.<br /><em>{trip.country}.</em></h2>{trip.photographerUrl && <a className="photo-credit" href={trip.photographerUrl} target="_blank" rel="noreferrer">View image source</a>}</div><div className="postcard-actions"><p>{trip.thesis}</p><button onClick={() => navigator.clipboard?.writeText(window.location.href)}><Share2 /> Share this journey</button></div></section>
        </> : <section className="awaiting-result" id="itinerary"><Sparkles /><span>Live itinerary workspace</span><h2>Your destination has not been chosen yet.</h2><p>Submit a request and Atlas will populate every section from current API results—nothing is prewritten.</p></section>}
        <footer><div className="brand"><span className="brand-mark">A</span><span><strong>ATLAS</strong><small>Travel intelligence</small></span></div><p>Recommendations, never reservations.<br />Live data can change—verify before you go.</p><span>© 2026 ATLAS</span></footer>
      </main></MotionShell>
    </div>
  )
}
