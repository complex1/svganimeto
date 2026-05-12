import { getProjectStorage } from '@/services/projectStorage/getProjectStorage'
import { openProjectFileFromDialog } from '@/services/projectStorage/electronProjectStorage'
import type { ProjectRecord } from '@/services/projectStorage/types'
import { useEditorStore } from '@/store/editorStore'
import { useSessionStore } from '@/store/sessionStore'
import { dialogAlert } from '@/store/dialogStore'

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

function openEditorWithProject(json: string, storageUri: string) {
  useEditorStore.getState().hydrateFromJson(json)
  useEditorStore.setState({ projectPath: filePathFromStorageUri(storageUri) })
  useSessionStore.getState().setActiveStorageUri(storageUri)
  useSessionStore.getState().setScreen('editor')
}

export async function createNewProjectAndOpen() {
  if (guardSymbolEditing()) return
  useEditorStore.getState().newProject()
  const json = useEditorStore.getState().serializeProject()
  const record = await getProjectStorage().write({ json })
  openEditorWithProject(json, record.storageUri)
}

export async function openStoredProject(record: ProjectRecord) {
  if (guardSymbolEditing()) return
  const json = await getProjectStorage().read(record.storageUri)
  openEditorWithProject(json, record.storageUri)
}

export async function openProjectFromDialog(): Promise<boolean> {
  if (guardSymbolEditing()) return true
  if (window.api?.projectLibrary?.openFromDialog) {
    const res = await openProjectFileFromDialog()
    if (!res) return true
    openEditorWithProject(res.json, res.record.storageUri)
    return true
  }
  return false
}

export async function importProjectJsonFromFile(json: string) {
  if (guardSymbolEditing()) return
  const record = await getProjectStorage().write({ json })
  openEditorWithProject(json, record.storageUri)
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
  useSessionStore.getState().setScreen('home')
  useSessionStore.getState().setActiveStorageUri(null)
}
