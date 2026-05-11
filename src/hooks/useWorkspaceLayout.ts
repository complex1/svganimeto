import { useCallback, useState } from 'react'

const STORAGE_KEY = 'svg-animation.workspaceLayout'

export type WorkspaceLayout = {
  inspectorWidth: number
  bottomHeight: number
  layersWidth: number
}

const DEFAULT_LAYOUT: WorkspaceLayout = {
  inspectorWidth: 260,
  bottomHeight: 200,
  layersWidth: 220
}

const LIMITS = {
  inspectorWidth: { min: 200, max: 480 },
  bottomHeight: { min: 120, max: 420 },
  layersWidth: { min: 160, max: 420 }
} as const

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clampLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    inspectorWidth: clamp(
      layout.inspectorWidth,
      LIMITS.inspectorWidth.min,
      LIMITS.inspectorWidth.max
    ),
    bottomHeight: clamp(layout.bottomHeight, LIMITS.bottomHeight.min, LIMITS.bottomHeight.max),
    layersWidth: clamp(layout.layersWidth, LIMITS.layersWidth.min, LIMITS.layersWidth.max)
  }
}

function readLayout(): WorkspaceLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>
    return clampLayout({ ...DEFAULT_LAYOUT, ...parsed })
  } catch {
    return DEFAULT_LAYOUT
  }
}

function writeLayout(layout: WorkspaceLayout) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function useWorkspaceLayout() {
  const [layout, setLayoutState] = useState<WorkspaceLayout>(() => readLayout())

  const setLayout = useCallback((patch: Partial<WorkspaceLayout>) => {
    setLayoutState((prev) => {
      const next = clampLayout({ ...prev, ...patch })
      writeLayout(next)
      return next
    })
  }, [])

  const resizeInspector = useCallback((delta: number) => {
    setLayoutState((prev) => {
      const next = clampLayout({ ...prev, inspectorWidth: prev.inspectorWidth - delta })
      writeLayout(next)
      return next
    })
  }, [])

  const resizeBottom = useCallback((delta: number) => {
    setLayoutState((prev) => {
      const next = clampLayout({ ...prev, bottomHeight: prev.bottomHeight - delta })
      writeLayout(next)
      return next
    })
  }, [])

  const resizeLayers = useCallback((delta: number) => {
    setLayoutState((prev) => {
      const next = clampLayout({ ...prev, layersWidth: prev.layersWidth + delta })
      writeLayout(next)
      return next
    })
  }, [])

  return {
    layout,
    setLayout,
    resizeInspector,
    resizeBottom,
    resizeLayers
  }
}
