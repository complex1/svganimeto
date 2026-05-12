import { nanoid } from 'nanoid'

type ProjectJson = {
  id?: string
  name?: string
}

export function parseProjectJson(json: string): ProjectJson {
  try {
    return JSON.parse(json) as ProjectJson
  } catch {
    return {}
  }
}

export function projectNameFromJson(json: string, fallback = 'Untitled'): string {
  const name = parseProjectJson(json).name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : fallback
}

export function projectIdFromJson(json: string): string | undefined {
  const id = parseProjectJson(json).id
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined
}

export function ensureProjectIdInJson(json: string, id = nanoid(10)): string {
  const data = parseProjectJson(json)
  if (typeof data.id === 'string' && data.id.trim().length > 0) return json
  const parsed = JSON.parse(json) as Record<string, unknown>
  parsed.id = id
  return JSON.stringify(parsed, null, 2)
}
