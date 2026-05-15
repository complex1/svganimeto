import { getProjectStorage } from '@/services/projectStorage/getProjectStorage'
import { resolveProjectRecord } from '@/services/projectStorage/resolveProject'
import { openProjectFileFromDialog } from '@/services/projectStorage/electronProjectStorage'
import type { ProjectRecord } from '@/services/projectStorage/types'
import { useEditorStore } from '@/store/editorStore'
import { useSessionStore } from '@/store/sessionStore'
import { dialogAlert } from '@/store/dialogStore'
import { editorPath, navigateApp, routesHome } from '@/navigation'

function guardSymbolEditing(): boolean {
  if (useEditorStore.getState().symbolEditBackup) {
    void dialogAlert('Finish or cancel symbol editing first.')
    return true
  }
  return false
}

function filePathFromStorageUri(storageUri: string | null) {
  if (!storageUri?.startsWith('file:')) return null
  return storageUri.slice(5)
}

function openEditorWithProject(json: string, storageUri: string, projectId: string) {
  useEditorStore.getState().hydrateFromJson(json)
  useEditorStore.setState({ projectPath: filePathFromStorageUri(storageUri) })
  useSessionStore.getState().setActiveStorageUri(storageUri)
  navigateApp(editorPath(projectId))
}

export async function loadProjectForEditor(projectId: string): Promise<boolean> {
  const record = await resolveProjectRecord(projectId)
  if (!record) return false

  const session = useSessionStore.getState()
  const editor = useEditorStore.getState()
  if (session.activeStorageUri === record.storageUri && editor.project.id === projectId) {
    return true
  }

  const json = await getProjectStorage().read(record.storageUri)
  openEditorWithProject(json, record.storageUri, record.id)
  return true
}

export async function createNewProjectAndOpen() {
  if (guardSymbolEditing()) return
  useEditorStore.getState().newProject()
  const json = useEditorStore.getState().serializeProject()
  const record = await getProjectStorage().write({ json })
  openEditorWithProject(json, record.storageUri, record.id)
}

export async function openStoredProject(record: ProjectRecord) {
  if (guardSymbolEditing()) return
  const json = await getProjectStorage().read(record.storageUri)
  openEditorWithProject(json, record.storageUri, record.id)
}

export async function openProjectFromDialog(): Promise<boolean> {
  if (guardSymbolEditing()) return true
  if (window.api?.projectLibrary?.openFromDialog) {
    const res = await openProjectFileFromDialog()
    if (!res) return true
    openEditorWithProject(res.json, res.record.storageUri, res.record.id)
    return true
  }
  return false
}

export async function importProjectJsonFromFile(json: string) {
  if (guardSymbolEditing()) return
  const record = await getProjectStorage().write({ json })
  openEditorWithProject(json, record.storageUri, record.id)
}

export async function saveActiveProject() {
  if (guardSymbolEditing()) return
  const json = useEditorStore.getState().serializeProject()
  const storageUri = useSessionStore.getState().activeStorageUri
  const name = useEditorStore.getState().project.name
  const record = await getProjectStorage().write({
    storageUri,
    json,
    name
  })
  useSessionStore.getState().setActiveStorageUri(record.storageUri)
  useEditorStore.setState({ projectPath: filePathFromStorageUri(record.storageUri) })
  return record
}

export function returnToHome() {
  if (guardSymbolEditing()) return
  useSessionStore.getState().setActiveStorageUri(null)
  navigateApp(routesHome)
}
