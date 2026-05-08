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
