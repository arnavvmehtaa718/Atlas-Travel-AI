import type { DayPlan, TripDossier } from './types'
import { distanceKm } from './geography'

type RequestProfile = { destinationQuery: string; days: number; budget?: number; currency: string; party: number; interests: string[] }
export type ApiPlace = { name: string; lat: number; lon: number; type: string; cuisine?: string; openingHours?: string; address?: string; website?: string; source?: string; prominence?: number; description?: string; distanceFromBaseKm?: number; isAnchor?: boolean }

type StopKind = 'landmark' | 'food' | 'cafe' | 'activity' | 'market' | 'service' | 'hotel'
function stopKind(place: ApiPlace): StopKind {
  const type = place.type.toLocaleLowerCase()
  if (/hotel|hostel|guest_house|motel|apartment/.test(type)) return 'hotel'
  if (/restaurant|fast_food|food_court/.test(type)) return 'food'
  if (/cafe|ice_cream/.test(type)) return 'cafe'
  if (/market|mall|department_store|supermarket|shop/.test(type)) return 'market'
  if (/pharmacy|hospital|clinic|bank|atm|fuel|car_rental|tourist_information/.test(type)) return 'service'
  if (/park|garden|viewpoint|nature|beach|zoo|theme_park|arts_centre|activity/.test(type)) return 'activity'
  return 'landmark'
}

const moneyCodes = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'SGD', 'AED', 'THB', 'IDR']
const interestWords = ['food', 'architecture', 'history', 'art', 'nature', 'beach', 'shopping', 'nightlife', 'museum', 'museums', 'cafe', 'restaurant', 'park', 'culture', 'landmark', 'landmarks', 'sightseeing', 'monastery', 'monasteries', 'activity', 'activities', 'adventure', 'cafes', 'restaurants', 'services', 'markets']
const weatherCodes: Record<number, string> = { 0: 'Clear skies', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorms' }

export function parseRequest(request: string): RequestProfile {
  const daysMatch = request.match(/(\d+)\s*(?:day|days|night|nights|week|weeks)/i)
  let days = daysMatch ? Number(daysMatch[1]) : 3
  if (daysMatch && /week/i.test(daysMatch[0])) days *= 7
  const budgetMatch = request.match(/(?:under|budget(?:\s+of)?|spend(?:ing)?(?:\s+up\s+to)?)\s*(?:([$€£₹¥])\s*)?([\d,]+)(?:\s*(USD|EUR|GBP|INR|JPY|AUD|CAD|SGD|AED|THB|IDR))?|([$€£₹¥])\s*([\d,]+)|([\d,]+)\s*(USD|EUR|GBP|INR|JPY|AUD|CAD|SGD|AED|THB|IDR)\b/i)
  const symbolCode: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY' }
  const explicitCode = moneyCodes.find((code) => new RegExp(`\\b${code}\\b`, 'i').test(request))
  const partyMatch = request.match(/(?:for|party of)\s+(\d+)\s*(?:people|persons|travellers|travelers|adults)?/i)
  const cleaned = request
    .replace(/\b(?:plan|build|create|make|find|show me|trip|itinerary|travel|vacation|holiday|visit|to|in|for|a|an|the|please|days?|nights?|weeks?|under|budget|with|of|and|famous|iconic|local|nearby|top|best|people|persons|travellers|travelers)\b/gi, ' ')
    .replace(/[$€£₹¥]?\s*[\d,]+\s*(?:USD|EUR|GBP|INR|JPY|AUD|CAD|SGD|AED|THB|IDR)?/gi, ' ')
    .replace(new RegExp(`\\b(?:${interestWords.join('|')})\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ').replace(/^[,.;\s-]+|[,.;\s-]+$/g, '').trim()
  return {
    destinationQuery: cleaned || request.trim(), days: Math.min(Math.max(days, 1), 10),
    budget: budgetMatch ? Number((budgetMatch[2] ?? budgetMatch[6] ?? budgetMatch[7]).replace(/,/g, '')) : undefined,
    currency: explicitCode ?? symbolCode[budgetMatch?.[1] ?? budgetMatch?.[5] ?? ''] ?? budgetMatch?.[8] ?? 'USD',
    party: partyMatch ? Math.min(Number(partyMatch[1]), 12) : 1,
    interests: interestWords.filter((word) => new RegExp(`\\b${word}`, 'i').test(request)),
  }
}

export function normalizePlaces(elements: any[]): ApiPlace[] {
  const unique = new Map<string, ApiPlace>()
  for (const item of elements) {
    const tags = item.tags ?? {}, name = tags.name, lat = Number(item.lat ?? item.center?.lat), lon = Number(item.lon ?? item.center?.lon)
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const type = tags.tourism ?? tags.historic ?? tags.amenity ?? tags.leisure ?? tags.shop ?? tags.natural ?? 'place'
    const address = tags['addr:full'] ?? ([tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || undefined)
    const signatureType = ['attraction','museum','monument','memorial','castle','viewpoint','place_of_worship','iconic landmark','landmark'].includes(type)
    const prominence = Number(item.prominence ?? 0) + Number(item.importance ?? 0) * 25 + (tags.wikipedia ? 18 : 0) + (tags.wikidata ? 14 : 0) + (tags.website ? 2 : 0) + (signatureType ? 12 : 0)
    const value = { name, lat, lon, type, cuisine: tags.cuisine, openingHours: tags.opening_hours, address, website: tags.website ?? tags['contact:website'], source: item.source ?? 'OpenStreetMap', prominence, description: item.description, isAnchor: Boolean(item.isAnchor) }
    const key = String(name).toLocaleLowerCase()
    const current = unique.get(key)
    if (!current || prominence > (current.prominence ?? 0)) unique.set(key, value)
  }
  return [...unique.values()]
}

function rankPlaces(places: ApiPlace[], interests: string[]) {
  return [...places].sort((a, b) => {
    const score = (place: ApiPlace) => (place.prominence ?? 0) + interests.reduce((sum, interest) => sum + (place.type.includes(interest) || place.cuisine?.includes(interest) ? 5 : 0), 0)
    return score(b) - score(a)
  })
}

function buildDays(places: ApiPlace[], days: number, interests: string[], dateValues: string[], destination: string): DayPlan[] {
  const destinationName = destination.toLocaleLowerCase().trim()
  const ranked = rankPlaces(places.filter((place) => place.name.toLocaleLowerCase().trim() !== destinationName), interests)
  const anchors = ranked.filter((place) => place.isAnchor)
  const pools = new Map<StopKind, ApiPlace[]>(['landmark','food','cafe','activity','market','service'].map((kind) => [kind as StopKind, ranked.filter((place) => stopKind(place) === kind)]))
  const used = new Set<string>(), groups: ApiPlace[][] = []
  const patterns: StopKind[][] = [
    ['landmark','landmark','food','cafe','activity','market'],
    ['landmark','landmark','food','cafe','market','service'],
    ['landmark','landmark','food','activity','cafe','market'],
  ]
  for (let day = 0; day < Math.min(days, anchors.length); day++) {
    const anchor = anchors.find((place) => !used.has(place.name.toLocaleLowerCase()))
    if (!anchor) break
    const group: ApiPlace[] = [anchor], pattern = patterns[day % patterns.length].slice(1)
    used.add(anchor.name.toLocaleLowerCase())
    for (const kind of pattern) {
      const maxLegKm = 32
      const candidates = (pools.get(kind) ?? []).filter((place) => !used.has(place.name.toLocaleLowerCase()) && (!group.length || distanceKm(group.at(-1)!, place) <= maxLegKm))
      const candidate = candidates.sort((a, b) => group.length ? distanceKm(group.at(-1)!, a) - distanceKm(group.at(-1)!, b) : (b.prominence ?? 0) - (a.prominence ?? 0))[0]
      if (candidate) { group.push(candidate); used.add(candidate.name.toLocaleLowerCase()) }
    }
    if (group.length < 4) for (const candidate of ranked.filter((place) => !used.has(place.name.toLocaleLowerCase()) && (!group.length || distanceKm(group.at(-1)!, place) <= 32))) { group.push(candidate); used.add(candidate.name.toLocaleLowerCase()); if (group.length >= 5) break }
    if (group.length) groups.push(group)
  }
  const times = ['08:30','10:30','12:45','15:00','17:30','19:30']
  return groups.map((stops, dayIndex) => {
    const categories = [...new Set(stops.map(stopKind))]
    return { day: dayIndex + 1, date: dateValues[dayIndex] ?? `Day ${dayIndex + 1}`, title: categories.map((value) => value[0].toUpperCase() + value.slice(1)).slice(0, 3).join(', '), theme: 'Sightseeing, local flavour, activities and practical stops', summary: `${stops.length} verified stops within the destination zone, balancing ${categories.join(', ')} while limiting backtracking.`, stops: stops.map((stop, index) => {
      const previous = stops[index - 1], distance = previous ? distanceKm(previous, stop) : 0, kind = stopKind(stop), category = stop.type.replaceAll('_', ' ')
      const mealLabel = kind === 'food' ? 'Meal stop' : kind === 'cafe' ? 'Cafe break' : kind === 'service' ? 'Useful service' : category
      const estimatedCostInr = kind === 'food' ? 700 : kind === 'cafe' ? 350 : kind === 'activity' ? 900 : kind === 'landmark' ? 500 : kind === 'market' ? 600 : 0
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.name}, ${stop.address ?? ''}`)}`
      return { name: stop.name, lat: stop.lat, lon: stop.lon, tag: `${times[index]} · ${mealLabel}`, category, address: stop.address, openingHours: stop.openingHours, cuisine: stop.cuisine?.replaceAll(';', ', '), website: stop.website, source: stop.source ?? 'OpenStreetMap', duration: kind === 'food' ? '75 min' : kind === 'cafe' || kind === 'service' ? '45 min' : '90 min', prominence: stop.prominence ?? 0, distanceFromBaseKm: stop.distanceFromBaseKm ?? 0, estimatedCostInr, mapsUrl, transition: previous ? `${distance.toFixed(1)} km from ${previous.name}; allow approximately ${Math.max(10, Math.round(distance * 8))} minutes by local transport, subject to terrain and traffic.` : `${(stop.distanceFromBaseKm ?? 0).toFixed(1)} km from the destination base.`, note: stop.description ?? `${mealLabel} verified within the destination area${stop.cuisine ? `, serving ${stop.cuisine.replaceAll(';', ', ')}` : ''}. ${stop.openingHours ? `Published hours: ${stop.openingHours}.` : 'Live opening hours are unavailable; confirm directly before departure.'}` }
    }) }
  })
}

function guidePlace(place: ApiPlace, destination: string) {
  const kind = stopKind(place)
  const estimatedCostInr = kind === 'food' ? 700 : kind === 'cafe' ? 350 : kind === 'activity' ? 900 : kind === 'landmark' ? 500 : kind === 'market' ? 600 : kind === 'hotel' ? 3500 : 0
  return {
    name: place.name, note: place.description ?? `${place.name} is a verified ${place.type.replaceAll('_', ' ')} near ${destination}. ${place.openingHours ? `Published hours: ${place.openingHours}.` : 'Confirm current hours and availability before visiting.'}`,
    lat: place.lat, lon: place.lon, category: place.type.replaceAll('_', ' '), address: place.address, openingHours: place.openingHours,
    cuisine: place.cuisine?.replaceAll(';', ', '), website: place.website, source: place.source ?? 'OpenStreetMap', duration: kind === 'hotel' ? 'Stay option' : '60–90 min',
    prominence: place.prominence ?? 0, distanceFromBaseKm: place.distanceFromBaseKm ?? 0, estimatedCostInr,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${destination}`)}`,
  }
}

function buildGuide(places: ApiPlace[], days: DayPlan[], destination: string) {
  const ranked = rankPlaces(places.filter((place) => place.name.toLocaleLowerCase() !== destination.toLocaleLowerCase()), [])
  const identity = (place: Pick<ApiPlace, 'name' | 'lat' | 'lon'>) => `${place.name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')}:${place.lat.toFixed(3)}:${place.lon.toFixed(3)}`
  const scheduled = new Set(days.flatMap((day) => day.stops.map(identity)))
  const claimed = new Set<string>()
  const pick = (test: (place: ApiPlace) => boolean, limit: number) => {
    const selected = ranked.filter((place) => test(place) && !scheduled.has(identity(place)) && !claimed.has(identity(place))).slice(0, limit)
    selected.forEach((place) => claimed.add(identity(place)))
    return selected.map((place) => guidePlace(place, destination))
  }
  const attractions = pick((place) => stopKind(place) === 'landmark', 8)
  return {
    attractions,
    food: pick((place) => ['food', 'cafe'].includes(stopKind(place)), 8),
    hotels: pick((place) => stopKind(place) === 'hotel', 6),
    shopping: pick((place) => stopKind(place) === 'market', 6),
    photoSpots: pick((place) => /viewpoint|monument|castle|garden|peak|beach|attraction/.test(place.type.toLocaleLowerCase()), 6),
    hiddenGems: pick((place) => !place.isAnchor && (place.prominence ?? 0) < 30 && !['hotel', 'service'].includes(stopKind(place)), 5),
    experiences: pick((place) => stopKind(place) === 'activity', 6),
    transportation: ['Use the mapped daily clusters to reduce backtracking.', 'For stops under 2 km, walking may be practical; check terrain and weather first.', 'For longer legs, compare licensed taxi, public transport and hotel transfer options locally.'],
    safety: [`Use official or licensed transport in ${destination}.`, 'Keep emergency contacts and accommodation details available offline.', 'Verify weather, opening hours, permits and road conditions on the day of travel.'],
  }
}

function buildPacking(weather: any) {
  const codes: number[] = weather?.daily?.weather_code ?? []
  const rain = Math.max(...(weather?.daily?.precipitation_probability_max ?? [0]))
  const low = Math.min(...(weather?.daily?.temperature_2m_min ?? [15]))
  const high = Math.max(...(weather?.daily?.temperature_2m_max ?? [24]))
  return ['Comfortable walking shoes', 'Reusable water bottle', 'Portable battery', ...(rain > 35 || codes.some((code) => code >= 51 && code <= 82) ? ['Compact rain shell'] : []), ...(low < 12 ? ['Warm layers'] : []), ...(high > 27 ? ['Sun protection and light clothing'] : [])]
}

export function buildTrip(input: { request: string; profile: RequestProfile; destination: string; country: string; coordinates: [number, number]; weather: any; facts: any; places: ApiPlace[]; exchangeRate?: number; photos?: any[]; sources: string[] }): TripDossier {
  const { request, profile, destination, country, coordinates, weather, facts, places, exchangeRate, photos = [], sources } = input
  const photo = photos[0]
  const days = buildDays(places, profile.days, profile.interests, weather?.daily?.time ?? [], destination)
  if (!days.length || !days[0].stops.length) throw new Error('No verified places were returned for this destination. Try a nearby city or broader region.')
  const highs: number[] = weather?.daily?.temperature_2m_max ?? [], lows: number[] = weather?.daily?.temperature_2m_min ?? []
  const min = lows.length ? Math.round(Math.min(...lows)) : Math.round(weather?.current?.temperature_2m ?? 0)
  const max = highs.length ? Math.round(Math.max(...highs)) : Math.round(weather?.current?.temperature_2m ?? 0)
  const itineraryCosts = days.flatMap((day) => day.stops).reduce((sum, stop) => sum + stop.estimatedCostInr, 0) * profile.party
  const accommodation = Math.round(profile.days * (2800 + Math.max(0, profile.party - 1) * 1300))
  const meals = Math.round(profile.days * profile.party * 1400)
  const transit = Math.round(profile.days * profile.party * 650 + days.flatMap((day) => day.stops).reduce((sum, stop) => sum + stop.distanceFromBaseKm * 18, 0))
  const experiences = Math.max(itineraryCosts, profile.days * profile.party * 900)
  const cafesShopping = profile.days * profile.party * 650
  const subtotal = accommodation + meals + transit + experiences + cafesShopping
  const estimatedBudgetInr = Math.round((subtotal * 1.1) / 500) * 500
  const requestedBudgetInr = profile.budget ? Math.round(profile.budget * (profile.currency === 'INR' ? 1 : exchangeRate ?? 1)) : undefined
  const targetTotal = requestedBudgetInr ?? estimatedBudgetInr
  const shares = [['Accommodation', accommodation], ['Food', meals], ['Local transport', transit], ['Attractions', experiences], ['Cafes & shopping', cafesShopping], ['Contingency', Math.max(0, targetTotal - subtotal)]] as const
  const scale = shares.reduce((sum, [, amount]) => sum + amount, 0) > 0 ? targetTotal / shares.reduce((sum, [, amount]) => sum + amount, 0) : 1
  const dates = weather?.daily?.time?.length ? `${weather.daily.time[0]} — ${weather.daily.time[Math.min(profile.days, weather.daily.time.length) - 1]}` : `${profile.days} days from arrival`
  const languages = Object.values(facts?.languages ?? {}).join(', ') || 'Language data unavailable'
  return {
    id: crypto.randomUUID(), dataOrigin: 'live-api', request,
    thesis: `${profile.days} days in ${destination}, assembled from ${places.length} live mapped places${profile.interests.length ? ` with an emphasis on ${profile.interests.join(', ')}` : ''}.`,
    destination, country, coordinates, dates, duration: `${profile.days} day${profile.days === 1 ? '' : 's'}`,
    temperature: weather ? `${min}–${max}°C` : 'Weather unavailable',
    weather: weather ? weatherCodes[weather.current?.weather_code] ?? 'Mixed conditions' : 'Weather source unavailable',
    currency: 'INR', language: languages, estimatedBudgetInr, requestedBudgetInr, partySize: profile.party,
    budget: shares.map(([label, amount]) => ({ label, amount: Math.round(amount * scale) })),
    days, guide: buildGuide(places, days, destination), packing: buildPacking(weather),
    atlasNote: `This route uses named places returned live around ${destination}. Verify opening hours directly before visiting.`,
    nearby: places.slice(days.flatMap((day) => day.stops).length, days.flatMap((day) => day.stops).length + 3).map((place) => place.name),
    heroImage: photo?.urls?.regular, imageAlt: photo?.alt_description ?? (photo ? `Travel view of ${destination}, ${country}` : undefined),
    photographerName: photo?.user?.name, photographerUrl: photo?.user?.links?.html ? `${photo.user.links.html}?utm_source=atlas_travel_planner&utm_medium=referral` : undefined,
    gallery: photos.slice(0, 6).filter((item) => item?.urls?.regular && item?.user?.links?.html).map((item) => ({ url: item.urls.regular, alt: item.alt_description ?? `Travel view of ${destination}`, photographerName: item.user.name, photographerUrl: `${item.user.links.html}?utm_source=atlas_travel_planner&utm_medium=referral` })),
    sources, generatedAt: new Date().toISOString(),
  }
}
