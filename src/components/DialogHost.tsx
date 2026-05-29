import { useEffect, useRef, useState } from 'react'
import { useDialogStore, type DialogModel } from '@/store/dialogStore'

function PromptBody({
  dialog
}: {
  dialog: Extract<NonNullable<DialogModel>, { variant: 'prompt' }>
}) {
  const [value, setValue] = useState(dialog.defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [dialog.id])

  const submit = () => {
    dialog.onResult(value)
  }

  return (
    <>
      <h2 id="app-dialog-title" style={{ margin: 0, fontSize: 16 }}>
        {dialog.title}
      </h2>
      {dialog.message ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>{dialog.message}</p>
      ) : null}
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={dialog.placeholder}
        aria-labelledby="app-dialog-title"
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'inherit',
          fontSize: 14
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          /**
           * The dialog floats over the editor canvas, so any keystroke that
           * bubbles out hits the editor's global shortcut handler. We stop
           * propagation universally and still handle Enter ourselves to
           * submit. Without this, typing things like "z" with Cmd held would
           * undo the underlying document while the dialog is open.
           */
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="button" onClick={() => dialog.onResult(null)}>
          {dialog.cancelLabel}
        </button>
        <button type="button" className="primary" onClick={submit}>
          {dialog.confirmLabel}
        </button>
      </div>
    </>
  )
}

export function DialogHost() {
  const dialog = useDialogStore((s) => s.dialog)

  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (dialog.variant === 'alert') dialog.onClose()
      else if (dialog.variant === 'confirm') dialog.onResult(false)
      else dialog.onResult(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog])

  if (!dialog) return null

  const backdropDismiss = () => {
    if (dialog.variant === 'alert') dialog.onClose()
    else if (dialog.variant === 'confirm') dialog.onResult(false)
    else dialog.onResult(null)
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10050,
        padding: 16
      }}
      onMouseDown={backdropDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialog.variant === 'prompt' ? 'app-dialog-title' : 'app-dialog-heading'}
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--bg-panel)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {dialog.variant === 'alert' && (
          <>
            <h2 id="app-dialog-heading" style={{ margin: 0, fontSize: 16 }}>
              Notice
            </h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{dialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="primary" onClick={dialog.onClose}>
                OK
              </button>
            </div>
          </>
        )}

        {dialog.variant === 'confirm' && (
          <>
            <h2 id="app-dialog-heading" style={{ margin: 0, fontSize: 16 }}>
              Confirm
            </h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{dialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => dialog.onResult(false)}>
                {dialog.cancelLabel}
              </button>
              <button type="button" className="primary" onClick={() => dialog.onResult(true)}>
                {dialog.confirmLabel}
              </button>
            </div>
          </>
        )}

        {dialog.variant === 'prompt' && <PromptBody key={dialog.id} dialog={dialog} />}
      </div>
    </div>
  )
}
