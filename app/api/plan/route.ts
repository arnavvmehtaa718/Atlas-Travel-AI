import { z } from 'zod'
import { tripDossierSchema } from '@/lib/travel/types'
import { buildTrip, normalizePlaces, parseRequest } from '@/lib/travel/planner'
import { destinationRadius, distanceKm, isExcludedRegion, pickDestination } from '@/lib/travel/geography'

export const maxDuration = 60

async function json(url: string, init?: RequestInit, retries = 2): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) })
  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 0)
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 700), 2500)))
    return json(url, init, retries - 1)
  }
  if (!response.ok) throw new Error(response.status === 429 ? 'A live data source is busy. Please retry in a moment.' : `Source returned ${response.status}`)
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
          const extract = String(page.extract ?? '')
          const nonPlaceTitle = /^(list of|tourism in|history of|geography of|timeline of|culture of|economy of|demographics of|transport in|\d{4} in)|\b(operation|expo|exposition|conference|festival|election|protest|battle|massacre|incident|attack|war|campaign|movement|mission|project|treaty|agreement|pandemic|disaster|earthquake|cyclone|film|song|album|book|episode|season|team|organization)\b/i.test(title)
          const nonPlaceExtract = /\b(was an? (operation|event|military action|political movement|exposition|world expo|conference|incident|attack|battle|campaign)|is an? (annual event|festival|exhibition event|military operation|political movement))\b/i.test(extract)
          if (!coordinate || nonPlaceTitle || nonPlaceExtract || lower === destination.toLocaleLowerCase()) return
          const candidate = { ...page, appearances: 1, score: 110 - queryIndex * 4 - resultIndex * 2 }
          const existing = anchorCandidates.get(lower)
          anchorCandidates.set(lower, existing ? { ...existing, appearances: existing.appearances + 1, score: existing.score + 22 } : candidate)
        }))
        const base = { lat: latitude, lon: longitude }
        const famousAnchors = [...anchorCandidates.values()].filter((page: any) => !isExcludedRegion(page) && distanceKm(base, { lat: page.coordinates[0].lat, lon: page.coordinates[0].lon }) <= radiusKm).sort((a: any, b: any) => b.score - a.score).slice(0, Math.max(profile.days * 3, 10))
        if (famousAnchors.length) sources.push('Wikipedia landmark search')
        const anchorRadius = regional ? 12000 : Math.min(Math.max(radiusMeters, 7000), 15000)
        const anchorCoordinates = [[latitude, longitude], ...famousAnchors.slice(0, Math.max(profile.days * 2, 6)).map((page: any) => [page.coordinates[0].lat, page.coordinates[0].lon])]
          .filter(([lat, lon], index, values) => values.findIndex(([otherLat, otherLon]) => Math.abs(lat - otherLat) < .001 && Math.abs(lon - otherLon) < .001) === index)
        const selectors = ['["tourism"~"attraction|museum|gallery|viewpoint|zoo|theme_park|hotel|hostel|guest_house|motel|apartment"]', '["historic"~"monument|memorial|castle|ruins|archaeological_site"]', '["amenity"~"place_of_worship|restaurant|fast_food|food_court|cafe|ice_cream|marketplace|pharmacy|bank|atm|car_rental"]', '["leisure"~"park|garden|sports_centre"]', '["shop"~"mall|department_store|marketplace|supermarket"]']
        const overpassClauses = selectors.flatMap((selector) => anchorCoordinates.map(([lat, lon]) => `nwr${selector}(around:${anchorRadius},${lat},${lon});`)).join('')
        event(controller, encoder, 'status', { phase: 'researching', label: 'Finding food, stays and experiences near the famous landmarks' })
        const overpass = `[out:json][timeout:25];(${overpassClauses});out center 350;`
        const overpassEndpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
        const fetchOverpass = async () => {
          for (const endpoint of overpassEndpoints) {
            try { return await json(`${endpoint}?data=${encodeURIComponent(overpass)}`, undefined, 1) } catch { /* Try the next public mirror. */ }
          }
          return null
        }
        const categoryQueries = ['attractions', 'restaurants', 'hotels', 'shopping malls', 'viewpoints parks']
        const categorySearches = await Promise.all(categoryQueries.map((category) => json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=8&bounded=1&viewbox=${longitude - radiusKm / 80},${latitude + radiusKm / 111},${longitude + radiusKm / 80},${latitude - radiusKm / 111}&q=${encodeURIComponent(`${category} in ${destination}, ${country}`)}`, { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (public travel research)' } }, 1).catch(() => [])))
        const destinationImagePayload = await json(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(`${destination} ${country} landmark architecture`)}&gsrnamespace=0&gsrlimit=20&prop=coordinates|pageimages&piprop=thumbnail&pithumbsize=1200`, wikiHeaders).catch(() => null)
        const destinationImages = Object.values(destinationImagePayload?.query?.pages ?? {}).filter((page: any) => page.thumbnail?.source && (!page.coordinates?.[0] || distanceKm(base, { lat: page.coordinates[0].lat, lon: page.coordinates[0].lon }) <= radiusKm))
        const commonsPayload = await json(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(`${destination} ${country}`)}&gsrnamespace=6&gsrlimit=16&prop=imageinfo&iiprop=url&iiurlwidth=1200`, wikiHeaders).catch(() => null)
        const commonsImages = Object.values(commonsPayload?.query?.pages ?? {}).filter((page: any) => /\.(jpe?g|png|webp)$/i.test(page.title ?? '') && page.imageinfo?.[0]?.thumburl).map((page: any) => ({ pageid: `commons-${page.pageid}`, title: page.title.replace(/^File:/, ''), thumbnail: { source: page.imageinfo[0].thumburl }, fullurl: page.imageinfo[0].descriptionurl }))
        const wikiImages = [...famousAnchors, ...destinationImages, ...commonsImages, ...[...anchorCandidates.values()].filter((page: any) => page.thumbnail?.source && distanceKm(base, { lat: page.coordinates?.[0]?.lat ?? latitude, lon: page.coordinates?.[0]?.lon ?? longitude }) <= radiusKm)]
          .filter((page: any, index: number, values: any[]) => page.thumbnail?.source && values.findIndex((candidate: any) => candidate.pageid === page.pageid) === index)
          .slice(0, 8)
          .map((page: any) => ({ thumbnail: page.thumbnail, title: page.title, fullurl: `https://en.wikipedia.org/?curid=${page.pageid}` }))
        const requests = await Promise.allSettled([
          json(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7`),
          json(`https://restcountries.com/v3.1/name/${encodeURIComponent(country)}?fullText=true&fields=name,currencies,languages,timezones`),
          fetchOverpass(),
          process.env.UNSPLASH_ACCESS_KEY ? json(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(`${destination} ${geo.address?.state ?? ''} ${country} travel landmarks food cafes`)}&orientation=landscape&per_page=8`, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' } }) : Promise.reject(new Error('Unsplash not configured')),
          json(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=40&bounded=1&viewbox=${longitude - radiusKm / 80},${latitude + radiusKm / 111},${longitude + radiusKm / 80},${latitude - radiusKm / 111}&q=${encodeURIComponent(`tourism ${destination} ${geo.address?.state ?? ''}`)}`, { headers: { 'User-Agent': 'AtlasTravelPlanner/1.0 (travel-planner)' } }),
          Promise.resolve(null),
          Promise.resolve(null),
          Promise.resolve(categorySearches),
        ])
        const [weatherResult, factsResult, placesResult, photoResult, searchPlacesResult, wikiResult, iconicWikiResult, categorySearchResult] = requests
        const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null
        const factsPayload = factsResult.status === 'fulfilled' ? factsResult.value : null
        const placesPayload = placesResult.status === 'fulfilled' ? placesResult.value : null
        const photoPayload = photoResult.status === 'fulfilled' ? photoResult.value : null
        const searchPlacesPayload = searchPlacesResult.status === 'fulfilled' ? searchPlacesResult.value : []
        const wikiPayload = wikiResult.status === 'fulfilled' ? wikiResult.value : null
        const iconicWikiPayload = iconicWikiResult.status === 'fulfilled' ? iconicWikiResult.value : null
        const categoryTypes = ['attraction', 'restaurant', 'hotel', 'mall', 'viewpoint']
        const categoryPayload = categorySearchResult.status === 'fulfilled' ? categorySearchResult.value.flatMap((items: any[], index: number) => items.map((item: any) => ({ ...item, atlasCategory: categoryTypes[index] }))) : []
        if (weather) sources.push('Open-Meteo')
        if (factsPayload) sources.push('REST Countries')
        if (placesPayload) sources.push('OpenStreetMap Overpass')
        if (searchPlacesPayload.length) sources.push('OpenStreetMap Nominatim place search')
        const facts = factsPayload?.[0]
        const fallbackElements = [...searchPlacesPayload, ...categoryPayload].filter((place: any) => !isExcludedRegion(place)).map((place: any) => ({ lat: place.lat, lon: place.lon, source: 'OpenStreetMap Nominatim', prominence: Number(place.importance ?? 0) * 100, tags: { name: String(place.namedetails?.name ?? place.display_name).split(',')[0], tourism: place.atlasCategory === 'hotel' ? 'hotel' : place.atlasCategory === 'attraction' || place.atlasCategory === 'viewpoint' ? place.atlasCategory : place.atlasCategory ? undefined : place.type ?? place.category ?? 'place', amenity: place.atlasCategory === 'restaurant' ? 'restaurant' : place.atlasCategory ? undefined : place.type, shop: place.atlasCategory === 'mall' ? 'mall' : undefined, 'addr:full': place.display_name } }))
        const iconicElements = famousAnchors.map((page: any) => ({ lat: page.coordinates[0].lat, lon: page.coordinates[0].lon, prominence: page.score, isAnchor: true, source: 'Wikipedia', description: page.extract, tags: { name: page.title, tourism: 'iconic landmark', wikipedia: page.title } }))
        const normalizedPlaces = normalizePlaces([...iconicElements, ...(placesPayload?.elements ?? []).filter((place: any) => !isExcludedRegion(place)), ...fallbackElements]).filter((place) => !isExcludedRegion(place) && distanceKm(base, place) <= radiusKm)
        const hasWikipediaAnchors = normalizedPlaces.some((place) => place.isAnchor)
        const fallbackAnchorNames = new Set(normalizedPlaces.filter((place) => /attraction|museum|gallery|viewpoint|monument|memorial|castle|ruins|archaeological|place_of_worship|park|garden/.test(place.type.toLocaleLowerCase())).sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0)).slice(0, Math.max(profile.days * 2, 6)).map((place) => place.name.toLocaleLowerCase()))
        const places = normalizedPlaces.map((place) => ({ ...place, isAnchor: place.isAnchor || (!hasWikipediaAnchors && fallbackAnchorNames.has(place.name.toLocaleLowerCase())), distanceFromBaseKm: distanceKm(base, place) }))
        const providerPhotos = (photoPayload?.results ?? []).filter((photo: any) => !isExcludedRegion(`${photo.alt_description ?? ''} ${photo.description ?? ''}`))
        const photos = providerPhotos.length >= 4 ? providerPhotos : [...providerPhotos, ...wikiImages].filter((photo: any, index: number, values: any[]) => {
          const url = photo?.urls?.regular ?? photo?.thumbnail?.source
          return url && values.findIndex((candidate: any) => (candidate?.urls?.regular ?? candidate?.thumbnail?.source) === url) === index
        })
        if (providerPhotos.length) sources.push('Destination image search')
        if (wikiImages.length) sources.push('Wikipedia destination images')

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
