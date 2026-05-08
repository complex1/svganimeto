import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowPointer,
  faBezierCurve,
  faCircle,
  faFont,
  faMinus,
  faPaintbrush,
  faPenNib,
  faSquare
} from '@fortawesome/free-solid-svg-icons'
import { useEditorStore, type DrawTool } from '@/store/editorStore'

export function LeftToolbar() {
  const mode = useEditorStore((s) => s.mode)
  const activeTool = useEditorStore((s) => s.activeTool)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)

  const tools: { id: DrawTool; label: string; icon: typeof faArrowPointer }[] = [
    { id: 'select', label: 'Select (V)', icon: faArrowPointer },
    { id: 'rect', label: 'Rectangle (R)', icon: faSquare },
    { id: 'circle', label: 'Circle (O)', icon: faCircle },
    { id: 'ellipse', label: 'Ellipse (E)', icon: faCircle },
    { id: 'line', label: 'Line (L)', icon: faMinus },
    { id: 'pen', label: 'Pen (P)', icon: faPenNib },
    { id: 'path-edit', label: 'Path Edit (N)', icon: faBezierCurve },
    { id: 'brush', label: 'Brush (B)', icon: faPaintbrush },
    { id: 'text', label: 'Text (T)', icon: faFont }
  ]

  return (
    <aside className="area-toolbar">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          title={tool.label}
          className={activeTool === tool.id ? 'primary' : undefined}
          disabled={mode !== 'draw'}
          style={{ width: 36, height: 36, padding: 0 }}
          onClick={() => setActiveTool(tool.id)}
        >
          <FontAwesomeIcon icon={tool.icon} />
        </button>
      ))}
      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>MVP</span>
    </aside>
  )
}
