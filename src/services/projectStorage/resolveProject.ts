import { getProjectStorage } from './getProjectStorage'
import type { ProjectRecord } from './types'

export async function resolveProjectRecord(projectId: string): Promise<ProjectRecord | null> {
  const rows = await getProjectStorage().list()
  return rows.find((project) => project.id === projectId) ?? null
}
