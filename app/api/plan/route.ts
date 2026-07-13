import { z } from 'zod'
import { tripDossierSchema } from '@/lib/travel/types'
import { buildTrip, normalizePlaces, parseRequest } from '@/lib/travel/planner'
import { destinationRadius, distanceKm, isExcludedRegion, pickDestination } from '@/lib/travel/geography'

export const maxDuration = 60

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Source returned ${response.status}`)
  return response.json()
}

function event(controller: ReadableStreamDefaultController, encoder: TextEncoder, type: string, data: unknown) {
  controller.enqueue(encoder.encode(`${JSON.stringify({ type, data })}\n`))
}

export async function POST(request: Request) {
  const body = z.object({ request: z.string().min(2).max(1200) }).parse(await request.json())
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sources: string[] = []
      try {
        event(controller, encoder, 'status', { phase: 'researching', label: 'Parsing your request' })
        const profile = parseRequest(body.request)
        event(controller, encoder, 'status', { phase: 'researching', label: `Locating ${profile.destinationQuery}` })
        const geoResults = await json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=8&featuretype=settlement&q=${encodeURIComponent(profile.destinationQuery)}`, { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (travel-planner)' } })
        const geo = pickDestination(geoResults, profile.destinationQuery)
        if (!geo) throw new Error('I could not locate that exact destination without crossing an excluded region. Add the city, state, or country explicitly.')
        if (isExcludedRegion(geo)) throw new Error('That destination is outside the regions supported by this planner.')
        sources.push('OpenStreetMap Nominatim')
        let latitude = Number(geo.lat), longitude = Number(geo.lon)
        const destination = geo.address?.city ?? geo.address?.town ?? geo.address?.village ?? geo.address?.state ?? String(geo.display_name).split(',')[0]
        const country = geo.address?.country ?? ''
        const regional = ['state', 'region', 'administrative'].includes(geo.type) || geo.class === 'boundary'
        if (regional) {
          const hubs = await json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&featuretype=settlement&q=${encodeURIComponent(`${destination} main city ${country}`)}`, { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (travel-planner)' } }).catch(() => [])
          const hub = hubs.filter((item: any) => !isExcludedRegion(item) && String(item.address?.state ?? item.display_name).toLocaleLowerCase().includes(destination.toLocaleLowerCase())).sort((a: any, b: any) => Number(b.importance ?? 0) - Number(a.importance ?? 0))[0]
          if (hub) { latitude = Number(hub.lat); longitude = Number(hub.lon) }
        }
        const radiusKm = destinationRadius(geo.type, geo.class, profile.days)
        const radiusMeters = Math.round(radiusKm * 1000)
        event(controller, encoder, 'location', { destination, country, coordinates: [latitude, longitude] })

        event(controller, encoder, 'status', { phase: 'researching', label: 'Identifying famous cultural landmarks from Wikipedia' })
        const wikiQueries = ['top tourist attractions', 'famous landmarks monuments', 'museums cultural heritage', 'religious sites', 'major natural attractions']
        const wikiHeaders = { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (public travel research)' } }
        const wikiSearches = await Promise.all([
          json(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggsprimary=all&ggsnamespace=0&ggsradius=10000&ggslimit=50&ggscoord=${latitude}%7C${longitude}&prop=coordinates|extracts&pageimages&exintro=1&explaintext=1&exsentences=3&pithumbsize=800`, wikiHeaders).catch(() => null),
          ...wikiQueries.map((query) => json(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(`${destination} ${country} ${query}`)}&gsrnamespace=0&gsrlimit=12&prop=coordinates|extracts&pageimages&exintro=1&explaintext=1&exsentences=3&pithumbsize=800`, wikiHeaders).catch(() => null)),
        ])
        const anchorCandidates = new Map<string, any>()
        wikiSearches.forEach((payload, queryIndex) => Object.values(payload?.query?.pages ?? {}).forEach((page: any, resultIndex) => {
          const coordinate = page.coordinates?.[0], title = String(page.title ?? ''), lower = title.toLocaleLowerCase()
          if (!coordinate || /^(list of|tourism in|history of|geography of)/i.test(title) || lower === destination.toLocaleLowerCase()) return
          const candidate = { ...page, appearances: 1, score: 110 - queryIndex * 4 - resultIndex * 2 }
          const existing = anchorCandidates.get(lower)
          anchorCandidates.set(lower, existing ? { ...existing, appearances: existing.appearances + 1, score: existing.score + 22 } : candidate)
        }))
        const base = { lat: latitude, lon: longitude }
        const famousAnchors = [...anchorCandidates.values()].filter((page: any) => !isExcludedRegion(page) && distanceKm(base, { lat: page.coordinates[0].lat, lon: page.coordinates[0].lon }) <= radiusKm).sort((a: any, b: any) => b.score - a.score).slice(0, Math.max(profile.days * 3, 10))
        if (famousAnchors.length) sources.push('Wikipedia landmark search')
        const anchorRadius = regional ? 12000 : 5000
        const anchorCoordinates = famousAnchors.length
          ? famousAnchors.slice(0, Math.max(profile.days * 2, 6)).map((page: any) => [page.coordinates[0].lat, page.coordinates[0].lon])
          : [[latitude, longitude]]
        const selectors = ['["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park|hotel|hostel|guest_house|motel|apartment"]', '["historic"~"monument|memorial|castle|ruins|archaeological_site"]', '["amenity"~"place_of_worship|restaurant|fast_food|food_court|cafe|ice_cream|marketplace|pharmacy|bank|atm|car_rental"]', '["leisure"~"park|garden|sports_centre"]', '["shop"~"mall|department_store|marketplace|supermarket"]']
        const overpassClauses = selectors.flatMap((selector) => anchorCoordinates.map(([lat, lon]) => `nwr${selector}(around:${anchorRadius},${lat},${lon});`)).join('')
        event(controller, encoder, 'status', { phase: 'researching', label: 'Finding food, stays and experiences near the famous landmarks' })
        const overpass = `[out:json][timeout:25];(${overpassClauses});out center 350;`
        const requests = await Promise.allSettled([
          json(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`),
          json(`https://restcountries.com/v3.1/name/${encodeURIComponent(country)}?fullText=true&fields=name,currencies,languages,timezones`),
          json(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpass)}`),
          process.env.UNSPLASH_ACCESS_KEY ? json(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(`${destination} ${geo.address?.state ?? ''} ${country} travel landmarks food cafes`)}&orientation=landscape&per_page=8`, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' } }) : Promise.reject(new Error('Unsplash not configured')),
          json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=40&bounded=1&viewbox=${longitude - radiusKm / 80},${latitude + radiusKm / 111},${longitude + radiusKm / 80},${latitude - radiusKm / 111}&q=${encodeURIComponent(`tourism ${destination} ${geo.address?.state ?? ''}`)}`, { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (travel-planner)' } }),
          Promise.resolve(null),
          Promise.resolve(null),
          Promise.all(['famous attraction','restaurant','cafe','hotel','market','viewpoint','local experience','pharmacy'].map((category) => json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&bounded=1&viewbox=${longitude - radiusKm / 80},${latitude + radiusKm / 111},${longitude + radiusKm / 80},${latitude - radiusKm / 111}&q=${encodeURIComponent(`${category} in ${destination} ${country}`)}`, { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (travel-planner)' } }).catch(() => []))),
        ])
        const [weatherResult, factsResult, placesResult, photoResult, searchPlacesResult, wikiResult, iconicWikiResult, categorySearchResult] = requests
        const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null
        const factsPayload = factsResult.status === 'fulfilled' ? factsResult.value : null
        const placesPayload = placesResult.status === 'fulfilled' ? placesResult.value : null
        const photoPayload = photoResult.status === 'fulfilled' ? photoResult.value : null
        const searchPlacesPayload = searchPlacesResult.status === 'fulfilled' ? searchPlacesResult.value : []
        const wikiPayload = wikiResult.status === 'fulfilled' ? wikiResult.value : null
        const iconicWikiPayload = iconicWikiResult.status === 'fulfilled' ? iconicWikiResult.value : null
        const categoryPayload = categorySearchResult.status === 'fulfilled' ? categorySearchResult.value.flat() : []
        if (weather) sources.push('Open-Meteo')
        if (factsPayload) sources.push('REST Countries')
        if (placesPayload) sources.push('OpenStreetMap Overpass')
        if (searchPlacesPayload.length) sources.push('OpenStreetMap Nominatim place search')
        const facts = factsPayload?.[0]
        const fallbackElements = [...searchPlacesPayload, ...categoryPayload].filter((place: any) => !isExcludedRegion(place)).map((place: any) => ({ lat: place.lat, lon: place.lon, source: 'OpenStreetMap Nominatim', tags: { name: String(place.display_name).split(',')[0], tourism: place.type ?? place.category ?? 'place', amenity: place.type, 'addr:full': place.display_name } }))
        const iconicElements = famousAnchors.map((page: any) => ({ lat: page.coordinates[0].lat, lon: page.coordinates[0].lon, prominence: page.score, isAnchor: true, source: 'Wikipedia', description: page.extract, tags: { name: page.title, tourism: 'iconic landmark', wikipedia: page.title } }))
        const normalizedPlaces = normalizePlaces([...iconicElements, ...(placesPayload?.elements ?? []).filter((place: any) => !isExcludedRegion(place)), ...fallbackElements]).filter((place) => !isExcludedRegion(place) && distanceKm(base, place) <= radiusKm)
        const hasWikipediaAnchors = normalizedPlaces.some((place) => place.isAnchor)
        const fallbackAnchorNames = new Set(normalizedPlaces.filter((place) => /attraction|museum|gallery|viewpoint|monument|memorial|castle|ruins|archaeological|place_of_worship|park|garden/.test(place.type.toLocaleLowerCase())).sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0)).slice(0, Math.max(profile.days * 2, 6)).map((place) => place.name.toLocaleLowerCase()))
        const places = normalizedPlaces.map((place) => ({ ...place, isAnchor: place.isAnchor || (!hasWikipediaAnchors && fallbackAnchorNames.has(place.name.toLocaleLowerCase())), distanceFromBaseKm: distanceKm(base, place) }))
        const photos = (photoPayload?.results ?? []).filter((photo: any) => !isExcludedRegion(`${photo.alt_description ?? ''} ${photo.description ?? ''}`))
        if (photos.length) sources.push('Unsplash')

        let exchangeRate: number | undefined
        if (profile.currency !== 'INR' && process.env.EXCHANGE_RATE_API_KEY) {
          try {
            const rates = await json(`https://v6.exchangerate-api.com/v6/${process.env.EXCHANGE_RATE_API_KEY}/pair/${profile.currency}/INR/1`)
            if (rates.result === 'success') { exchangeRate = rates.conversion_rate; sources.push('ExchangeRate-API') }
          } catch { /* The automatic INR estimate remains available when conversion is unavailable. */ }
        }
        event(controller, encoder, 'research', { weatherAvailable: Boolean(weather), factsAvailable: Boolean(facts), nearbyCount: places.length, sources })
        event(controller, encoder, 'status', { phase: 'composing', label: 'Assembling verified places into your itinerary' })
        const trip = tripDossierSchema.parse(buildTrip({ request: body.request, profile, destination, country, coordinates: [latitude, longitude], weather, facts, places, exchangeRate, photos, sources }))
        event(controller, encoder, 'trip', trip)
        event(controller, encoder, 'status', { phase: 'complete', label: 'Your live itinerary is ready' })
      } catch (error) {
        event(controller, encoder, 'error', { message: error instanceof Error ? error.message : 'Planning failed. Please try again.' })
      } finally { controller.close() }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}
