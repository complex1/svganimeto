import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useEditorStore } from '@/store/editorStore'

/**
 * Advances `currentTime` while `isPlaying` is true.
 *
 * Uses GSAP’s global ticker so playback shares one clock with any future GSAP timelines.
 *
 * Full GSAP rewrite (future): replace per-frame `mergeTransformFromTracks` / `mergeAttrsFromTracks`
 * sampling with a `gsap.timeline()` that tweens layer proxy objects and syncs React from `onUpdate`.
 */
export function usePlaybackLoop() {
  const playFromRef = useRef(0)
  const accumRef = useRef(0)
  const tickRef = useRef<((time: number, deltaTime: number) => void) | null>(null)

  useEffect(() => {
    const tick = (_time: number, deltaTime: number) => {
      const s = useEditorStore.getState()
      if (!s.isPlaying) return
      const speed = Math.max(0.05, Math.min(8, s.playbackSpeed))
      accumRef.current += (deltaTime / 1000) * speed
      const d = Math.max(1e-6, s.duration)
      let t = playFromRef.current + accumRef.current

      if (!s.loop) {
        if (t >= d) {
          useEditorStore.setState({ isPlaying: false, currentTime: d })
          return
        }
        useEditorStore.setState({ currentTime: t })
        return
      }

      t = ((t % d) + d) % d
      useEditorStore.setState({ currentTime: t })
    }
    tickRef.current = tick

    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.isPlaying && !prev.isPlaying) {
        playFromRef.current = s.currentTime
        accumRef.current = 0
        gsap.ticker.add(tick)
      }
      if (!s.isPlaying && prev.isPlaying) {
        gsap.ticker.remove(tick)
      }
    })

    if (useEditorStore.getState().isPlaying) {
      const s = useEditorStore.getState()
      playFromRef.current = s.currentTime
      accumRef.current = 0
      gsap.ticker.add(tick)
    }

    return () => {
      if (tickRef.current) gsap.ticker.remove(tickRef.current)
      unsub()
    }
  }, [])
}
