import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'

export type ProjectRecord = {
  id: string
  name: string
  storageUri: string
  createdAt: number
  updatedAt: number
}

type Manifest = {
  version: 1
  projects: Array<{
    id: string
    name: string
    filePath: string
    createdAt: number
    updatedAt: number
  }>
}

type ProjectWriteInput = {
  storageUri?: string | null
  json: string
  name?: string
}

function projectsRoot() {
  return path.join(app.getPath('userData'), 'projects')
}

function fileUri(filePath: string) {
  return `file:${filePath}`
}

function parseFileUri(storageUri: string) {
  if (!storageUri.startsWith('file:')) {
    throw new Error(`Not a file project URI: ${storageUri}`)
  }
  return storageUri.slice(5)
}

function sanitizeFileBase(name: string) {
  const base = name
    .trim()
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : 'project'
}

function parseProjectJson(json: string): { id?: string; name?: string } {
  try {
    return JSON.parse(json) as { id?: string; name?: string }
  } catch {
    return {}
  }
}

function projectNameFromJson(json: string, fallback = 'Untitled') {
  const name = parseProjectJson(json).name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : fallback
}

function projectIdFromJson(json: string) {
  const id = parseProjectJson(json).id
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined
}

function ensureProjectIdInJson(json: string, id: string) {
  const parsed = JSON.parse(json) as Record<string, unknown>
  if (typeof parsed.id !== 'string' || parsed.id.trim().length === 0) {
    parsed.id = id
  }
  return JSON.stringify(parsed, null, 2)
}

async function ensureProjectsDir() {
  await fs.mkdir(projectsRoot(), { recursive: true })
}

async function readManifest(): Promise<Manifest> {
  await ensureProjectsDir()
  const manifestPath = path.join(projectsRoot(), 'manifest.json')
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw) as Manifest
    if (parsed.version === 1 && Array.isArray(parsed.projects)) return parsed
  } catch {
    /* first run */
  }
  return { version: 1, projects: [] }
}

async function writeManifest(manifest: Manifest) {
  await ensureProjectsDir()
  await fs.writeFile(
    path.join(projectsRoot(), 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  )
}

function toRecord(entry: Manifest['projects'][number]): ProjectRecord {
  return {
    id: entry.id,
    name: entry.name,
    storageUri: fileUri(entry.filePath),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  }
}

async function upsertManifestEntry(
  entry: Manifest['projects'][number]
): Promise<ProjectRecord> {
  const manifest = await readManifest()
  const idx = manifest.projects.findIndex((p) => p.id === entry.id)
  if (idx >= 0) manifest.projects[idx] = entry
  else manifest.projects.push(entry)
  manifest.projects.sort((a, b) => b.updatedAt - a.updatedAt)
  await writeManifest(manifest)
  return toRecord(entry)
}

export async function listLibraryProjects(): Promise<ProjectRecord[]> {
  const manifest = await readManifest()
  const existing: ProjectRecord[] = []
  for (const entry of manifest.projects) {
    try {
      await fs.access(entry.filePath)
      existing.push(toRecord(entry))
    } catch {
      /* drop missing files on next write */
    }
  }
  return existing.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function readLibraryProject(storageUri: string): Promise<string> {
  const filePath = parseFileUri(storageUri)
  return fs.readFile(filePath, 'utf-8')
}

export async function writeLibraryProject(input: ProjectWriteInput): Promise<ProjectRecord> {
  await ensureProjectsDir()
  const now = Date.now()
  const manifest = await readManifest()
  const parsedName = input.name?.trim() || projectNameFromJson(input.json)
  let id = input.storageUri
    ? manifest.projects.find((p) => fileUri(p.filePath) === input.storageUri)?.id
    : undefined
  if (!id) id = projectIdFromJson(input.json) ?? nanoid(10)
  const json = ensureProjectIdInJson(input.json, id)

  const existing = manifest.projects.find((p) => p.id === id)
  const filePath = input.storageUri
    ? parseFileUri(input.storageUri)
    : existing?.filePath ?? path.join(projectsRoot(), `${sanitizeFileBase(parsedName)}-${id.slice(0, 6)}.svgmotion`)
  await fs.writeFile(filePath, json, 'utf-8')

  const entry = {
    id,
    name: parsedName,
    filePath,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  return upsertManifestEntry(entry)
}

export async function deleteLibraryProject(storageUri: string): Promise<void> {
  const filePath = parseFileUri(storageUri)
  const manifest = await readManifest()
  manifest.projects = manifest.projects.filter((p) => p.filePath !== filePath)
  await writeManifest(manifest)
  try {
    await fs.unlink(filePath)
  } catch {
    /* already removed */
  }
}

export async function registerExternalProjectFile(
  filePath: string,
  json: string
): Promise<ProjectRecord> {
  const now = Date.now()
  const id = projectIdFromJson(json) ?? nanoid(10)
  const name = projectNameFromJson(json)
  const entry = {
    id,
    name,
    filePath,
    createdAt: now,
    updatedAt: now
  }
  const manifest = await readManifest()
  const existing = manifest.projects.find((p) => p.filePath === filePath)
  if (existing) {
    return upsertManifestEntry({ ...existing, name, updatedAt: now })
  }
  return upsertManifestEntry(entry)
}
