import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  deleteLibraryProject,
  listLibraryProjects,
  readLibraryProject,
  registerExternalProjectFile,
  writeLibraryProject
} from './projectLibrary'

const PROJECT_FILTER = { name: 'SVG Motion Project', extensions: ['svgmotion', 'json'] }
const SVG_FILTER = { name: 'SVG', extensions: ['svg'] }
const RASTER_FILTER = {
  name: 'PNG / JPEG / WebP',
  extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
}
const ALL_PROJECTS = [PROJECT_FILTER, { name: 'All Files', extensions: ['*'] }]

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

/** Open import dialog attached to a window (required on macOS for a reliable sheet/modal). */
function rasterMimeForExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

export async function openRasterImportDialog(targetWindow: BrowserWindow | null): Promise<void> {
  const win = targetWindow ?? BrowserWindow.getFocusedWindow()
  if (!win || win.isDestroyed()) return
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import raster (auto trace)',
    filters: [RASTER_FILTER, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  })
  if (canceled || !filePaths[0]) return
  const buf = await fs.readFile(filePaths[0])
  const ext = path.extname(filePaths[0])
  const mime = rasterMimeForExt(ext)
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
  if (!win.isDestroyed()) {
    win.webContents.send('menu:importRasterData', { path: filePaths[0], dataUrl })
  }
}

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

  ipcMain.handle('dialog:importRaster', async (event) => {
    const parent = senderWindow(event)
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Import raster (auto trace)',
      filters: [RASTER_FILTER, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const buf = await fs.readFile(filePaths[0])
    const ext = path.extname(filePaths[0])
    const mime = rasterMimeForExt(ext)
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    return { path: filePaths[0], dataUrl }
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

  type SaveExportPayload = {
    encoding: 'utf8' | 'base64'
    data: string
    defaultFileName: string
    filters?: { name: string; extensions: string[] }[]
  }

  async function runSaveExportDialog(
    event: Electron.IpcMainInvokeEvent,
    payload: SaveExportPayload
  ): Promise<string | null> {
    const parent = senderWindow(event)
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Export',
      defaultPath: path.join(app.getPath('documents'), payload.defaultFileName),
      filters: payload.filters?.length ? payload.filters : [{ name: 'All Files', extensions: ['*'] }]
    })
    if (canceled || !filePath) return null
    if (payload.encoding === 'utf8') {
      await fs.writeFile(filePath, payload.data, 'utf-8')
    } else {
      await fs.writeFile(filePath, Buffer.from(payload.data, 'base64'))
    }
    return filePath
  }

  ipcMain.handle('dialog:saveExport', async (event, payload: SaveExportPayload) => {
    return runSaveExportDialog(event, payload)
  })

  ipcMain.handle('dialog:exportSvg', async (event, content: string, suggestedName?: string) => {
    return runSaveExportDialog(event, {
      encoding: 'utf8',
      data: content,
      defaultFileName: suggestedName ?? 'export.svg',
      filters: [{ name: 'SVG', extensions: ['svg'] }]
    })
  })

  ipcMain.handle('projectLibrary:list', () => listLibraryProjects())

  ipcMain.handle('projectLibrary:read', (_event, storageUri: string) => readLibraryProject(storageUri))

  ipcMain.handle('projectLibrary:write', (_event, input) => writeLibraryProject(input))

  ipcMain.handle('projectLibrary:delete', (_event, storageUri: string) =>
    deleteLibraryProject(storageUri)
  )

  ipcMain.handle('projectLibrary:openFromDialog', async (event) => {
    const parent = senderWindow(event)
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Open project',
      filters: ALL_PROJECTS,
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const content = await fs.readFile(filePaths[0], 'utf-8')
    const record = await registerExternalProjectFile(filePaths[0], content)
    return { record, json: content }
  })
}
