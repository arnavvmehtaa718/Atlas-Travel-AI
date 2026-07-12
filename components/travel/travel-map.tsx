'use client'

import { useEffect } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { TripDossier } from '@/lib/travel/types'
import 'leaflet/dist/leaflet.css'

const icon = L.divIcon({ className: 'atlas-marker', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })

function FitRoute({ route, center }: { route: [number, number][]; center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const resize = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    resize.observe(container)
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false })
      if (route.length > 1) map.fitBounds(L.latLngBounds(route), { padding: [46, 46], maxZoom: 14, animate: true })
      else map.setView(center, 3, { animate: false })
    })
    return () => { window.cancelAnimationFrame(frame); resize.disconnect() }
  }, [center, map, route])
  return null
}

export function TravelMap({ trip }: { trip?: TripDossier }) {
  const center: [number, number] = trip?.coordinates ?? [20, 10]
  const stops = trip?.days.flatMap((day) => day.stops) ?? []
  const route = trip ? [trip.coordinates, ...stops.map((stop) => [stop.lat, stop.lon] as [number, number])].filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)) as [number, number][] : []
  return (
    <div className="map-frame" aria-label={trip ? `Map of ${trip.destination}` : 'Interactive world map'}>
      <MapContainer key={trip ? `${trip.id}-${trip.coordinates.join('-')}` : 'world-atlas'} center={center} zoom={trip ? 11 : 3} scrollWheelZoom className="h-full w-full" zoomControl maxBoundsViscosity={1}>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitRoute center={center} route={route} />
        {route.length > 1 && <Polyline positions={route.slice(1)} pathOptions={{ color: '#738449', weight: 3, opacity: 0.85, dashArray: '5 8' }} />}
        {trip && stops.map((stop) => <Marker key={`${stop.name}-${stop.lat}`} position={[stop.lat, stop.lon]} icon={icon}><Popup><div className="atlas-popup"><span>{stop.tag} · {stop.duration}</span><strong>{stop.name}</strong><small>{stop.category} · {stop.distanceFromBaseKm.toFixed(1)} km from {trip.destination}</small><p>{stop.note}</p>{stop.address && <em>{stop.address}</em>}</div></Popup></Marker>)}
      </MapContainer>
      <div className="map-label"><span>Live atlas</span><strong>{trip?.destination ?? 'Explore the world'}</strong></div>
    </div>
  )
}
