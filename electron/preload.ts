import { contextBridge, ipcRenderer } from 'electron'

export type ElectronAPI = {
  openProject: () => Promise<{ path: string; content: string } | null>
  saveProject: (content: string, suggestedName?: string) => Promise<string | null>
  importSvg: () => Promise<{ path: string; content: string } | null>
  exportSvg: (content: string, suggestedName?: string) => Promise<string | null>
  onMenuAction: (callback: (action: string) => void) => () => void
  /** Fired when Import completes in the main process (menu / shortcut). */
  onImportSvgData: (callback: (data: { path: string; content: string }) => void) => () => void
}

type ImportPayload = { path: string; content: string }

/** Register IPC listener before renderer mounts so events are never dropped. */
const importSvgCallbacks = new Set<(data: ImportPayload) => void>()
ipcRenderer.on('menu:importSvgData', (_event, data: ImportPayload) => {
  importSvgCallbacks.forEach((cb) => {
    try {
      cb(data)
    } catch {
      /* renderer bug — avoid crashing preload */
    }
  })
})

const api: ElectronAPI = {
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  saveProject: (content, suggestedName) => ipcRenderer.invoke('dialog:saveProject', content, suggestedName),
  importSvg: () => ipcRenderer.invoke('dialog:importSvg'),
  exportSvg: (content, suggestedName) => ipcRenderer.invoke('dialog:exportSvg', content, suggestedName),
  onMenuAction: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },
  onImportSvgData: (callback) => {
    importSvgCallbacks.add(callback)
    return () => importSvgCallbacks.delete(callback)
  }
}

contextBridge.exposeInMainWorld('api', api)
