import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowPointer,
  faBezierCurve,
  faCircle,
  faEraser,
  faFillDrip,
  faFont,
  faHand,
  faMinus,
  faObjectGroup,
  faPaintbrush,
  faPenNib,
  faPencil,
  faSquare
} from '@fortawesome/free-solid-svg-icons'
import { Tooltip } from '@/components/Tooltip'
import { useEditorStore, type DrawTool } from '@/store/editorStore'

type ToolDef = { id: DrawTool; label: string; icon: typeof faArrowPointer }

const TOOL_GROUPS: { id: string; label: string; tools: ToolDef[] }[] = [
  {
    id: 'navigate',
    label: 'Navigate',
    tools: [
      { id: 'select', label: 'Select (V)', icon: faArrowPointer },
      { id: 'hand', label: 'Hand (H)', icon: faHand }
    ]
  },
  {
    id: 'shapes',
    label: 'Shapes',
    tools: [
      { id: 'shape-builder', label: 'Shape builder (G)', icon: faObjectGroup },
      { id: 'rect', label: 'Rectangle (R)', icon: faSquare },
      { id: 'circle', label: 'Circle (O)', icon: faCircle },
      { id: 'ellipse', label: 'Ellipse (E)', icon: faCircle },
      { id: 'line', label: 'Line (L)', icon: faMinus }
    ]
  },
  {
    id: 'paths',
    label: 'Paths',
    tools: [
      { id: 'pen', label: 'Pen (P)', icon: faPenNib },
      { id: 'pencil', label: 'Pencil (I)', icon: faPencil },
      { id: 'path-edit', label: 'Path Edit (N)', icon: faBezierCurve },
      { id: 'brush', label: 'Brush (B)', icon: faPaintbrush }
    ]
  },
  {
    id: 'paint',
    label: 'Paint',
    tools: [
      { id: 'fill', label: 'Fill (F)', icon: faFillDrip },
      { id: 'eraser', label: 'Eraser (X)', icon: faEraser }
    ]
  },
  {
    id: 'type',
    label: 'Type',
    tools: [{ id: 'text', label: 'Text (T)', icon: faFont }]
  }
]

export function LeftToolbar() {
  const mode = useEditorStore((s) => s.mode)
  const activeTool = useEditorStore((s) => s.activeTool)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)

  const animPathEditOk = mode === 'animate' || mode === 'preview'
  const toolEnabled = (id: DrawTool) => {
    if (mode === 'draw') return true
    if (animPathEditOk && (id === 'select' || id === 'hand' || id === 'path-edit')) return true
    return false
  }

  return (
    <aside className="area-toolbar" aria-label="Drawing tools">
      <div className="toolbar-groups">
        {TOOL_GROUPS.map((group) => {
          /**
           * Only show tools that are usable in the current mode — in Animate / Preview
           * the shape, paint, type, and pencil tools are inert, so hiding them keeps the
           * toolbar focused on what can actually be done here (Select / Hand / Path Edit).
           */
          const visibleTools = group.tools.filter((t) => toolEnabled(t.id))
          if (visibleTools.length === 0) return null
          return (
            <section key={group.id} className="toolbar-group" aria-label={group.label}>
              {visibleTools.map((tool) => (
                <Tooltip key={tool.id} content={tool.label}>
                  <button
                    type="button"
                    className={activeTool === tool.id ? 'primary' : undefined}
                    style={{ width: 36, height: 36, padding: 0 }}
                    onClick={() => setActiveTool(tool.id)}
                  >
                    <FontAwesomeIcon icon={tool.icon} />
                  </button>
                </Tooltip>
              ))}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
