/**
 * While dragging path points in Animate/Preview, the pathD track would otherwise
 * override `d` each frame. The renderer reads this ref to show the in-progress shape.
 */
export const pathDragLiveDRef: { current: { elementId: string; d: string } | null } = { current: null }
