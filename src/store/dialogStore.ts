import { create } from 'zustand'

export type DialogModel =
  | null
  | {
      id: number
      variant: 'alert'
      message: string
      onClose: () => void
    }
  | {
      id: number
      variant: 'confirm'
      message: string
      confirmLabel: string
      cancelLabel: string
      onResult: (ok: boolean) => void
    }
  | {
      id: number
      variant: 'prompt'
      title: string
      message?: string
      defaultValue: string
      placeholder?: string
      confirmLabel: string
      cancelLabel: string
      onResult: (value: string | null) => void
    }

type DialogState = {
  dialog: DialogModel
}

let seq = 0

/** Serialize dialog opens so confirmations never stack on top of each other. */
let queueChain: Promise<unknown> = Promise.resolve(undefined)

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueChain.then(() => fn())
  queueChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

export const useDialogStore = create<DialogState>(() => ({
  dialog: null
}))

export function dialogAlert(message: string): Promise<void> {
  return enqueue(
    () =>
      new Promise<void>((resolve) => {
        const id = ++seq
        useDialogStore.setState({
          dialog: {
            id,
            variant: 'alert',
            message,
            onClose: () => {
              useDialogStore.setState({ dialog: null })
              resolve()
            }
          }
        })
      })
  )
}

export function dialogConfirm(opts: {
  message: string
  confirmLabel?: string
  cancelLabel?: string
}): Promise<boolean> {
  return enqueue(
    () =>
      new Promise<boolean>((resolve) => {
        const id = ++seq
        useDialogStore.setState({
          dialog: {
            id,
            variant: 'confirm',
            message: opts.message,
            confirmLabel: opts.confirmLabel ?? 'OK',
            cancelLabel: opts.cancelLabel ?? 'Cancel',
            onResult: (ok: boolean) => {
              useDialogStore.setState({ dialog: null })
              resolve(ok)
            }
          }
        })
      })
  )
}

export function dialogPrompt(opts: {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}): Promise<string | null> {
  return enqueue(
    () =>
      new Promise<string | null>((resolve) => {
        const id = ++seq
        useDialogStore.setState({
          dialog: {
            id,
            variant: 'prompt',
            title: opts.title,
            message: opts.message,
            defaultValue: opts.defaultValue ?? '',
            placeholder: opts.placeholder,
            confirmLabel: opts.confirmLabel ?? 'OK',
            cancelLabel: opts.cancelLabel ?? 'Cancel',
            onResult: (value: string | null) => {
              useDialogStore.setState({ dialog: null })
              resolve(value)
            }
          }
        })
      })
  )
}
