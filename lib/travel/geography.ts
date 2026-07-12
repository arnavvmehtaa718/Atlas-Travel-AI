const EXCLUDED_TERMS = ['pakistan', 'pakistan-administered', 'pakistan administered', 'azad kashmir', 'gilgit-baltistan', 'gilgit baltistan', 'pok']

export function isExcludedRegion(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const normalized = text.toLocaleLowerCase()
  return EXCLUDED_TERMS.some((term) => normalized.includes(term))
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radians = (value: number) => value * Math.PI / 180
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon)
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export function destinationRadius(type: string, osmClass: string, days: number) {
  const regional = ['state', 'region', 'province', 'administrative'].includes(type) || osmClass === 'boundary'
  return regional ? Math.min(160, 70 + days * 12) : Math.min(45, 18 + days * 4)
}

export function scoreGeocoderResult(result: any, query: string) {
  if (isExcludedRegion(result)) return -Infinity
  const requested = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2)
  const display = String(result.display_name ?? '').toLocaleLowerCase()
  const named = String(result.name ?? display.split(',')[0]).toLocaleLowerCase()
  const overlap = requested.filter((token) => display.includes(token)).length
  const exact = requested.some((token) => named === token) ? 40 : 0
  const placeBonus = ['city', 'town', 'village', 'state', 'region', 'administrative'].includes(result.type) ? 15 : 0
  return exact + overlap * 12 + placeBonus + Number(result.importance ?? 0) * 20
}

export function pickDestination(results: any[], query: string) {
  return [...results].sort((a, b) => scoreGeocoderResult(b, query) - scoreGeocoderResult(a, query))[0]
}
