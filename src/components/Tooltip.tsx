import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export type TooltipProps = {
  content?: ReactNode
  children: ReactElement
  side?: TooltipSide
  anchorClassName?: string
  anchorStyle?: CSSProperties
}

const GAP = 8

function mergeHandlers<T extends MouseEvent | FocusEvent>(
  ours: (event: T) => void,
  theirs?: (event: T) => void
) {
  return (event: T) => {
    ours(event)
    theirs?.(event)
  }
}

function hasTooltipContent(content: ReactNode) {
  if (content == null) return false
  if (typeof content === 'boolean') return false
  if (typeof content === 'string') return content.trim().length > 0
  return true
}

export function Tooltip({
  content,
  children,
  side = 'top',
  anchorClassName,
  anchorStyle
}: TooltipProps) {
  if (!isValidElement(children) || !hasTooltipContent(content)) {
    return children
  }

  const tooltipId = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [bubbleStyle, setBubbleStyle] = useState<CSSProperties>({
    top: -9999,
    left: -9999,
    visibility: 'hidden'
  })

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const bubble = bubbleRef.current
    if (!anchor || !bubble) return

    const place = () => {
      const a = anchor.getBoundingClientRect()
      const b = bubble.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let top = 0
      let left = 0

      if (side === 'bottom') {
        top = a.bottom + GAP
        left = a.left + a.width / 2 - b.width / 2
      } else if (side === 'left') {
        top = a.top + a.height / 2 - b.height / 2
        left = a.left - GAP - b.width
      } else if (side === 'right') {
        top = a.top + a.height / 2 - b.height / 2
        left = a.right + GAP
      } else {
        top = a.top - GAP - b.height
        left = a.left + a.width / 2 - b.width / 2
      }

      top = Math.max(4, Math.min(top, vh - b.height - 4))
      left = Math.max(4, Math.min(left, vw - b.width - 4))
      setBubbleStyle({ top, left, visibility: 'visible' })
    }

    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, side, content])

  const show = () => setOpen(true)
  const hide = () => {
    setOpen(false)
    setBubbleStyle({ top: -9999, left: -9999, visibility: 'hidden' })
  }

  const child = cloneElement(children, {
    title: undefined,
    'aria-describedby': open ? tooltipId : undefined,
    onMouseEnter: mergeHandlers(show, children.props.onMouseEnter),
    onMouseLeave: mergeHandlers(hide, children.props.onMouseLeave),
    onFocus: mergeHandlers(show, children.props.onFocus),
    onBlur: mergeHandlers(hide, children.props.onBlur)
  })

  return (
    <>
      <span
        ref={anchorRef}
        className={['tooltip-anchor', anchorClassName].filter(Boolean).join(' ')}
        style={anchorStyle}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {child}
      </span>
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              id={tooltipId}
              role="tooltip"
              className="app-tooltip"
              style={bubbleStyle}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
