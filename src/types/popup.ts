import type { PageDetectionResult, TechnologyRecord } from './rules'

export interface HeaderRecord {
  name: string
  value: string
  source?: string
}

export interface PopupCounts {
  high: number
  medium: number
  low: number
  total: number
}

export interface PopupResult {
  url: string
  title: string
  generatedAt: string
  updatedAt: number
  technologies: TechnologyRecord[]
  resources: { total: number }
  headers?: HeaderRecord[]
  counts: PopupCounts
  categoryCounts: Record<string, number>
  headerCount: number
}

export interface PopupRawResult {
  url: string
  title: string
  generatedAt: string
  technologies: TechnologyRecord[]
  resources: PageDetectionResult['resources'] | null
  headers: HeaderRecord[]
}

export interface TabData {
  headers: HeaderRecord[]
  page: PageDetectionResult | null
  updatedAt: number
}

export interface PopupCachedResponse {
  ok: true
  data: PopupResult
  hasCache: boolean
  stale: boolean
  updatedAt: number
}
