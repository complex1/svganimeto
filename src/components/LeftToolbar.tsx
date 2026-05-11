import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowPointer,
  faBezierCurve,
  faCircle,
  faEraser,
  faFillDrip,
  faFont,
  faMinus,
  faObjectGroup,
  faPaintbrush,
  faPenNib,
  faPencil,
  faSquare
} from '@fortawesome/free-solid-svg-icons'
import { useEditorStore, type DrawTool } from '@/store/editorStore'

export function LeftToolbar() {
  const mode = useEditorStore((s) => s.mode)
  const activeTool = useEditorStore((s) => s.activeTool)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)

  const tools: { id: DrawTool; label: string; icon: typeof faArrowPointer }[] = [
    { id: 'select', label: 'Select (V)', icon: faArrowPointer },
    { id: 'shape-builder', label: 'Shape builder (G)', icon: faObjectGroup },
    { id: 'rect', label: 'Rectangle (R)', icon: faSquare },
    { id: 'circle', label: 'Circle (O)', icon: faCircle },
    { id: 'ellipse', label: 'Ellipse (E)', icon: faCircle },
    { id: 'line', label: 'Line (L)', icon: faMinus },
    { id: 'pen', label: 'Pen (P)', icon: faPenNib },
    { id: 'pencil', label: 'Pencil (I)', icon: faPencil },
    { id: 'path-edit', label: 'Path Edit (N)', icon: faBezierCurve },
    { id: 'brush', label: 'Brush (B)', icon: faPaintbrush },
    { id: 'eraser', label: 'Eraser (X)', icon: faEraser },
    { id: 'fill', label: 'Fill (F)', icon: faFillDrip },
    { id: 'text', label: 'Text (T)', icon: faFont }
  ]

  const animPathEditOk = mode === 'animate' || mode === 'preview'
  const toolEnabled = (id: DrawTool) => {
    if (mode === 'draw') return true
    if (animPathEditOk && (id === 'select' || id === 'path-edit')) return true
    return false
  }

  return (
    <aside className="area-toolbar">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          title={tool.label}
          className={activeTool === tool.id ? 'primary' : undefined}
          disabled={!toolEnabled(tool.id)}
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
