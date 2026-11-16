import type { BusinessModelKey, BusinessTable } from '../business/types'
import type { BuildingMetricFilters } from '../lib/buildingFilters'
import type { SectionBoxSettings } from '../lib/sectionBox'

export type ProjectCamera = {
  position: [number, number, number]
  target: [number, number, number]
  zoom: number
  viewport: [number, number]
}

export type ProjectWorkspace = {
  activeView: 'space' | 'data'
  metricFilters: BuildingMetricFilters
  kind: 'all' | 'column' | 'beam' | 'slab' | 'wall' | 'other'
  query: string
  selectedId: string
  sectionBox: SectionBoxSettings | null
  camera: ProjectCamera | null
  tablePage: number
}

export type ProjectBusiness = {
  fileName: string
  table: BusinessTable
  modelKey: BusinessModelKey
  column: string
}

export type ProjectSnapshot = {
  ifcFile: File
  elementCount: number
  business: ProjectBusiness | null
  workspace: ProjectWorkspace
}

export type SavedProject = {
  version: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: ProjectSnapshot
}

export type ProjectSummary = Pick<SavedProject, 'id' | 'name' | 'createdAt' | 'updatedAt'> & {
  ifcName: string
  ifcBytes: number
  elementCount: number
}
