import { z } from 'zod'

export const imageSchema = z.object({ url: z.string().url(), alt: z.string(), photographerName: z.string(), photographerUrl: z.string().url() })
export const placeSchema = z.object({
  name: z.string(), note: z.string(), lat: z.number(), lon: z.number(), tag: z.string().optional(),
  category: z.string(), address: z.string().optional(), openingHours: z.string().optional(), cuisine: z.string().optional(), website: z.string().url().optional(),
  source: z.string(), duration: z.string(), transition: z.string().optional(), prominence: z.number().default(0), distanceFromBaseKm: z.number().nonnegative(),
  estimatedCostInr: z.number().nonnegative(), mapsUrl: z.string().url(),
})
export const dayPlanSchema = z.object({ day: z.number().int().positive(), date: z.string(), title: z.string(), theme: z.string(), summary: z.string(), stops: z.array(placeSchema).min(1) })
export const tripDossierSchema = z.object({
  id: z.string(), dataOrigin: z.literal('live-api'), request: z.string(), thesis: z.string(), destination: z.string(), country: z.string(),
  coordinates: z.tuple([z.number(), z.number()]), dates: z.string(), duration: z.string(), temperature: z.string(), weather: z.string(),
  currency: z.literal('INR'), language: z.string(), budget: z.array(z.object({ label: z.string(), amount: z.number().nonnegative() })).min(1),
  estimatedBudgetInr: z.number().positive(), requestedBudgetInr: z.number().positive().optional(), partySize: z.number().int().positive(),
  days: z.array(dayPlanSchema).min(1), packing: z.array(z.string()).min(1), atlasNote: z.string(), nearby: z.array(z.string()).default([]),
  guide: z.object({
    attractions: z.array(placeSchema), food: z.array(placeSchema), hotels: z.array(placeSchema), shopping: z.array(placeSchema),
    photoSpots: z.array(placeSchema), experiences: z.array(placeSchema),
    transportation: z.array(z.string()), safety: z.array(z.string()),
  }),
  heroImage: z.string().url().optional(), imageAlt: z.string().optional(), photographerName: z.string().optional(), photographerUrl: z.string().url().optional(),
  gallery: z.array(imageSchema).default([]), sources: z.array(z.string()).default([]), generatedAt: z.string(),
})

export type Place = z.infer<typeof placeSchema>
export type DayPlan = z.infer<typeof dayPlanSchema>
export type TripDossier = z.infer<typeof tripDossierSchema>
export type PlanningPhase = 'idle' | 'researching' | 'composing' | 'complete' | 'error'
