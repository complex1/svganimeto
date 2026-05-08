import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const PROJECT_FILTER = { name: 'SVG Motion Project', extensions: ['svgmotion', 'json'] }
const SVG_FILTER = { name: 'SVG', extensions: ['svg'] }
const ALL_PROJECTS = [PROJECT_FILTER, { name: 'All Files', extensions: ['*'] }]

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

/** Open import dialog attached to a window (required on macOS for a reliable sheet/modal). */
export async function openSvgImportDialog(targetWindow: BrowserWindow | null): Promise<void> {
  const win = targetWindow ?? BrowserWindow.getFocusedWindow()
  if (!win || win.isDestroyed()) return
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import SVG',
    filters: [SVG_FILTER, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  })
  if (canceled || !filePaths[0]) return
  const content = await fs.readFile(filePaths[0], 'utf-8')
  if (!win.isDestroyed()) {
    win.webContents.send('menu:importSvgData', { path: filePaths[0], content })
  }
}

export function registerIpcHandlers() {
  ipcMain.handle('dialog:openProject', async (event) => {
    const parent = senderWindow(event)
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Open project',
      filters: ALL_PROJECTS,
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const content = await fs.readFile(filePaths[0], 'utf-8')
    return { path: filePaths[0], content }
  })

  ipcMain.handle('dialog:saveProject', async (event, content: string, suggestedName?: string) => {
    const parent = senderWindow(event)
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Save project',
      defaultPath: suggestedName
        ? path.join(app.getPath('documents'), suggestedName)
        : path.join(app.getPath('documents'), 'untitled.svgmotion'),
      filters: [{ name: 'SVG Motion', extensions: ['svgmotion'] }]
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, content, 'utf-8')
    app.addRecentDocument(filePath)
    return filePath
  })

  ipcMain.handle('dialog:importSvg', async (event) => {
    const parent = senderWindow(event)
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Import SVG',
      filters: [SVG_FILTER, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const content = await fs.readFile(filePaths[0], 'utf-8')
    return { path: filePaths[0], content }
  })

  ipcMain.handle('dialog:exportSvg', async (event, content: string, suggestedName?: string) => {
    const parent = senderWindow(event)
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Export animated SVG',
      defaultPath: suggestedName
        ? path.join(app.getPath('documents'), suggestedName)
        : path.join(app.getPath('documents'), 'export.svg'),
      filters: [{ name: 'SVG', extensions: ['svg'] }]
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  })
}
