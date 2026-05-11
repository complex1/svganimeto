import type { Transform } from '@/types/document'

/** SVG transform string for editor wrapper (rotation about local origin 0,0 of inner geometry — use translate for pivot if needed later). */
export function transformToSvgString(t: Transform): string {
  const parts: string[] = []
  if (t.x !== 0 || t.y !== 0) parts.push(`translate(${t.x} ${t.y})`)
  if (t.rotation !== 0) parts.push(`rotate(${t.rotation})`)
  if (t.skewX !== 0 || t.skewY !== 0) parts.push(`skewX(${t.skewX}) skewY(${t.skewY})`)
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${t.scaleX} ${t.scaleY})`)
  return parts.length ? parts.join(' ') : 'translate(0 0)'
}

/**
 * CSS `transform` value for exported @keyframes (HTML/SVG animation).
 * Unlike SVG attribute transforms, CSS requires `px` on translate lengths and `deg` on angles.
 */
export function transformToCssTransformValue(t: Transform): string {
  const parts: string[] = []
  if (t.x !== 0 || t.y !== 0) parts.push(`translate(${t.x}px, ${t.y}px)`)
  if (t.rotation !== 0) parts.push(`rotate(${t.rotation}deg)`)
  if (t.skewX !== 0 || t.skewY !== 0) parts.push(`skewX(${t.skewX}deg) skewY(${t.skewY}deg)`)
  if (t.scaleX !== 1 || t.scaleY !== 1) parts.push(`scale(${t.scaleX}, ${t.scaleY})`)
  return parts.length ? parts.join(' ') : 'translate(0px, 0px)'
}

export function getTransformPropKey(property: string): keyof Transform | null {
  const keys: (keyof Transform)[] = [
    'x',
    'y',
    'scaleX',
    'scaleY',
    'rotation',
    'skewX',
    'skewY',
    'opacity'
  ]
  return keys.includes(property as keyof Transform) ? (property as keyof Transform) : null
}
