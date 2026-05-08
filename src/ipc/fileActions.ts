import { useEditorStore } from '@/store/editorStore'

export async function openProjectFile() {
  const api = window.api
  if (!api?.openProject) return
  const res = await api.openProject()
  if (!res) return
  useEditorStore.getState().hydrateFromJson(res.content)
  useEditorStore.setState({ projectPath: res.path })
}

export async function saveProjectFile() {
  const api = window.api
  const json = useEditorStore.getState().serializeProject()
  const name = `${useEditorStore.getState().project.name || 'project'}.svgmotion`
  if (!api?.saveProject) {
    await navigator.clipboard.writeText(json)
    alert('Copied project JSON (desktop save unavailable).')
    return
  }
  const path = await api.saveProject(json, name)
  if (path) useEditorStore.setState({ projectPath: path })
}

export async function importSvgFile() {
  const api = window.api
  if (!api?.importSvg) return
  const res = await api.importSvg()
  if (!res) return
  applyImportedSvg(res.content, res.path.split(/[/\\]/).pop() ?? 'Imported')
}

/** Shared path for Electron IPC and browser file picker. */
export function applyImportedSvg(svgText: string, label: string) {
  const name = label.replace(/\.svg$/i, '') || 'Imported'
  useEditorStore.getState().importSvgFromString(svgText, name)
  if (useEditorStore.getState().project.elements.length === 0) {
    console.warn(
      '[SVG Animation Studio] Import produced no layers. Common causes: SVG is `<use>` / `<symbol>` only, malformed XML, or wrappers we do not parse yet.'
    )
  }
}
