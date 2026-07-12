'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Clock3, CloudSun, Compass, ExternalLink, Languages, MapPin, Printer, Route, Share2, Utensils, WalletCards } from 'lucide-react'
import type { TripDossier } from '@/lib/travel/types'

export function TripDossierView({ trip }: { trip: TripDossier }) {
  const [packed, setPacked] = useState<string[]>([])
  const [shareLabel, setShareLabel] = useState('Share guide')
  const originalTotal = trip.budget.reduce((sum, item) => sum + item.amount, 0)
  const [budgetTotal, setBudgetTotal] = useState(() => { if (typeof window === 'undefined') return originalTotal; const saved = Number(localStorage.getItem(`atlas-budget-${trip.id}`)); return saved > 0 ? saved : originalTotal })
  const formatInr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
  const scaledBudget = trip.budget.map((item) => ({ ...item, amount: Math.round(item.amount * budgetTotal / originalTotal) }))
  const dailyBudget = Math.round(budgetTotal / trip.days.length)
  const perPersonDaily = Math.round(dailyBudget / trip.partySize)
  function updateBudget(value: number) {
    const next = Math.max(5000, Math.min(2000000, Math.round(value / 500) * 500)); setBudgetTotal(next)
    localStorage.setItem(`atlas-budget-${trip.id}`, String(next))
  }
  async function shareGuide() {
    const data = { title: `${trip.destination} travel guide`, text: `${trip.duration} in ${trip.destination}: famous attractions, food, transport and practical notes.`, url: window.location.href }
    if (navigator.share) await navigator.share(data)
    else { await navigator.clipboard.writeText(`${data.title}\n${data.text}\n${data.url}`); setShareLabel('Link copied'); window.setTimeout(() => setShareLabel('Share guide'), 1800) }
  }
  const categorySections = [
    ['Attractions', trip.guide.attractions], ['Food guide', trip.guide.food], ['Hotels', trip.guide.hotels], ['Shopping', trip.guide.shopping],
    ['Photo spots', trip.guide.photoSpots], ['Hidden gems', trip.guide.hiddenGems],
  ] as const
  return (
    <section className="dossier" aria-labelledby="dossier-title">
      <div className="dossier-heading">
        <div><span className="eyebrow">Your field guide</span><h2 id="dossier-title">{trip.destination},<br /><em>unhurried.</em></h2></div>
        <div className="trip-stamp"><span>{trip.dates}</span><strong>{trip.duration}</strong></div>
      </div>

      <div className="fact-strip">
        <div><CloudSun /><span>Forecast</span><strong>{trip.temperature}</strong><small>{trip.weather}</small></div>
        <div><WalletCards /><span>Working budget</span><strong>{formatInr(budgetTotal)}</strong><small>{formatInr(perPersonDaily)} per person/day · local costs</small></div>
        <div><Languages /><span>In brief</span><strong>{trip.language}</strong><small>{trip.currency}</small></div>
      </div>

      <div className="itinerary-grid">
        <div className="timeline">
          <div className="route-rail" aria-hidden="true"><i className="route-progress" /></div>
          <div className="section-title"><span>01</span><h3>The itinerary</h3></div>
          {trip.days.map((day) => (
            <article className="day" key={day.day}>
              <div className="day-number">0{day.day}</div>
              <div className="day-content"><p>{day.date} · {day.theme}</p><h4>{day.title}</h4><div className="day-summary">{day.summary}</div>
                <div className="stops">{day.stops.map((stop, index) => <article className="stop" key={`${stop.name}-${stop.lat}`}><div className="stop-time"><strong>{stop.tag}</strong><span>{stop.duration}</span></div><motion.div className="stop-card" whileHover={{ y: -4, transition: { type: 'spring', stiffness: 300, damping: 22 } }} whileFocus={{ y: -4 }}><div className="stop-heading"><span>{stop.category}</span><strong>{stop.name}</strong></div><p>{stop.note}</p><dl className="stop-details">{stop.address && <div><dt><MapPin /></dt><dd>{stop.address}</dd></div>}<div><dt><Clock3 /></dt><dd>{stop.openingHours ?? 'Hours not published — verify before visiting'}</dd></div>{stop.cuisine && <div><dt><Utensils /></dt><dd>{stop.cuisine}</dd></div>}<div><dt><Compass /></dt><dd>{stop.distanceFromBaseKm.toFixed(1)} km from {trip.destination} · {stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}</dd></div></dl><div className="stop-footer"><span>Estimate: {stop.estimatedCostInr ? `${formatInr(stop.estimatedCostInr)} per person` : 'Free / verify locally'} · Source: {stop.source}</span><span className="stop-links"><a href={stop.mapsUrl} target="_blank" rel="noreferrer">Google Maps <MapPin /></a>{stop.website && <a href={stop.website} target="_blank" rel="noreferrer">Official site <ExternalLink /></a>}</span></div>{index > 0 && stop.transition && <div className="transition"><Route />{stop.transition}</div>}</motion.div></article>)}</div>
              </div>
            </article>
          ))}
        </div>

        <aside className="field-notes">
          <div className="section-title"><span>02</span><h3>Field notes</h3></div>
          <div className="budget-block"><p>Editable local budget · Indian rupees</p><div className="budget-editor"><label htmlFor={`budget-${trip.id}`}>Total budget <strong>{formatInr(budgetTotal)}</strong></label><input id={`budget-${trip.id}`} type="range" min={Math.max(5000, Math.round(trip.estimatedBudgetInr * .45 / 500) * 500)} max={Math.round(trip.estimatedBudgetInr * 2.5 / 500) * 500} step="500" value={budgetTotal} onChange={(event) => updateBudget(Number(event.target.value))} /><div className="budget-input"><span>₹</span><input aria-label="Total budget in rupees" type="number" min="5000" step="500" value={budgetTotal} onChange={(event) => updateBudget(Number(event.target.value))} /></div><small>{budgetTotal < trip.estimatedBudgetInr * .8 ? 'Lean: choose budget stays and free sights.' : budgetTotal > trip.estimatedBudgetInr * 1.25 ? 'Comfortable: room for upgrades and shopping.' : 'Balanced for the generated local itinerary.'} {formatInr(dailyBudget)} per day.</small><button type="button" onClick={() => updateBudget(trip.estimatedBudgetInr)}>Reset to Atlas estimate · {formatInr(trip.estimatedBudgetInr)}</button></div>{scaledBudget.map((item) => <div className="budget-row" key={item.label}><span>{item.label}</span><div><motion.i initial={false} animate={{ width: `${Math.round(item.amount / budgetTotal * 100)}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} /></div><motion.strong key={item.amount} initial={{ opacity: .35, y: 4 }} animate={{ opacity: 1, y: 0 }}>{formatInr(item.amount)}</motion.strong></div>)}</div>
          <div className="packing-block"><p>Pack with intent</p>{trip.packing.map((item) => { const checked = packed.includes(item); return <motion.button whileHover={{ x: 4 }} whileTap={{ scale: .98 }} key={item} onClick={() => setPacked(checked ? packed.filter((x) => x !== item) : [...packed, item])} className={checked ? 'packed' : ''}><span>{checked && <Check />}</span>{item}</motion.button> })}</div>
          <div className="tip"><Compass /><p><strong>Atlas note</strong>{trip.atlasNote}</p></div>
        </aside>
      </div>

      <section className="category-guide" aria-labelledby="guide-title">
        <div className="guide-heading"><div><span className="eyebrow">Destination handbook</span><h3 id="guide-title">Famous, useful, and close by.</h3><p>The same verified places used to compose your itinerary, organized for quick decisions.</p></div><div className="guide-actions"><button type="button" onClick={() => window.print()}><Printer />Print / Save PDF</button><button type="button" onClick={shareGuide}><Share2 />{shareLabel}</button></div></div>
        <div className="overview-grid"><article><span>Trip overview</span><strong>{trip.duration} · {trip.partySize} traveller{trip.partySize === 1 ? '' : 's'}</strong><p>{trip.thesis}</p></article><article><span>Weather</span><strong>{trip.temperature} · {trip.weather}</strong><p>Use the forecast with the packing list and verify mountain or road conditions locally.</p></article></div>
        {categorySections.map(([title, places], sectionIndex) => <section className="guide-section" key={title}><div className="section-title"><span>{String(sectionIndex + 3).padStart(2, '0')}</span><h3>{title}</h3></div>{places.length ? <motion.div className="guide-cards" initial="hidden" whileInView="visible" viewport={{ once: true, amount: .15 }} variants={{ hidden: {}, visible: { transition: { staggerChildren: .07 } } }}>{places.map((place) => <motion.article variants={{ hidden: { opacity: 0, y: 22 }, visible: { opacity: 1, y: 0 } }} whileHover={{ y: -5 }} key={`${title}-${place.name}`}><span>{place.category} · {place.distanceFromBaseKm.toFixed(1)} km</span><h4>{place.name}</h4><p>{place.note}</p><div><strong>{place.estimatedCostInr ? `Estimate ${formatInr(place.estimatedCostInr)}` : 'Price unavailable / verify'}</strong><a href={place.mapsUrl} target="_blank" rel="noreferrer">Map <ExternalLink /></a></div></motion.article>)}</motion.div> : <p className="guide-empty">No sufficiently relevant live results were returned for this category; Atlas will not pad the guide with unrelated places.</p>}</section>)}
        <div className="practical-grid"><section><div className="section-title"><span>09</span><h3>Transportation</h3></div>{trip.guide.transportation.map((tip) => <p key={tip}>{tip}</p>)}</section><section><div className="section-title"><span>10</span><h3>Safety tips</h3></div>{trip.guide.safety.map((tip) => <p key={tip}>{tip}</p>)}</section></div>
      </section>
    </section>
  )
}
