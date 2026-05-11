import clsx from 'clsx'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

export type ResizeAxis = 'horizontal' | 'vertical'

type ResizeHandleProps = {
  axis: ResizeAxis
  onResize: (delta: number) => void
  className?: string
  ariaLabel: string
}

export function ResizeHandle({ axis, onResize, className, ariaLabel }: ResizeHandleProps) {
  const draggingRef = useRef(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    event.currentTarget.classList.add('is-dragging')
    document.body.classList.add('is-resizing')
    document.body.style.cursor = axis === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    let previous = axis === 'horizontal' ? event.clientX : event.clientY

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!draggingRef.current) return
      const current = axis === 'horizontal' ? moveEvent.clientX : moveEvent.clientY
      const delta = current - previous
      if (delta !== 0) {
        onResize(delta)
        previous = current
      }
    }

    const endDrag = () => {
      draggingRef.current = false
      document.body.classList.remove('is-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.classList.remove('is-dragging')
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      className={clsx(
        'resize-handle',
        axis === 'horizontal' ? 'resize-handle-horizontal' : 'resize-handle-vertical',
        className
      )}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
