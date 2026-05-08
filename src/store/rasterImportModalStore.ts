import { create } from 'zustand'

type RasterImportModalState = {
  open: boolean
  blob: Blob | null
  label: string
  /** Source file name for dialogs / naming */
  displayName: string
}

export const useRasterImportModalStore = create<RasterImportModalState>(() => ({
  open: false,
  blob: null,
  label: '',
  displayName: ''
}))

export function openRasterImportModal(blob: Blob, displayName: string) {
  const base =
    displayName.replace(/\.(png|jpe?g|webp|gif)$/i, '').trim() || 'Raster import'
  useRasterImportModalStore.setState({
    open: true,
    blob,
    label: base,
    displayName
  })
}

export function closeRasterImportModal() {
  useRasterImportModalStore.setState({
    open: false,
    blob: null,
    label: '',
    displayName: ''
  })
}
