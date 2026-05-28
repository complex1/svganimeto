import { useEditorStore } from '@/store/editorStore'

export function SymbolEditBanner() {
  const backup = useEditorStore((s) => s.symbolEditBackup)
  const commitSymbolEdit = useEditorStore((s) => s.commitSymbolEdit)
  const cancelSymbolEdit = useEditorStore((s) => s.cancelSymbolEdit)

  if (!backup) return null

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        padding: '10px 16px',
        background: 'linear-gradient(90deg, rgba(91,141,239,0.22), rgba(91,141,239,0.08))',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap'
      }}
    >
      <span style={{ fontSize: 13 }}>
        <strong>Symbol editor</strong>
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{backup.symbolName}</span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 160 }}>
        Edit the master below. Keyframes you add here become the symbol's own timeline and
        play on every instance (looped when Loop is on). Done saves; Cancel restores the
        main document unchanged.
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="primary" onClick={() => commitSymbolEdit()}>
          Done
        </button>
        <button type="button" onClick={() => cancelSymbolEdit()}>
          Cancel
        </button>
      </div>
    </div>
  )
}
