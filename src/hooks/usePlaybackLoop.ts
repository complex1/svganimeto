import { useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/editorStore'

/** Advances timeline while `isPlaying` is true. */
export function usePlaybackLoop() {
  const raf = useRef(0)

  useEffect(() => {
    let startWall = performance.now()
    let startTime = useEditorStore.getState().currentTime

    const tick = (now: number) => {
      const s = useEditorStore.getState()
      if (!s.isPlaying) return
      const elapsed = (now - startWall) / 1000
      let t = startTime + elapsed
      const d = s.duration
      if (t >= d) {
        if (s.loop) {
          startWall = now
          startTime = 0
          t = 0
        } else {
          useEditorStore.setState({ isPlaying: false, currentTime: d })
          return
        }
      }
      useEditorStore.setState({ currentTime: Math.min(t, d) })
      raf.current = requestAnimationFrame(tick)
    }

    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.isPlaying && !prev.isPlaying) {
        cancelAnimationFrame(raf.current)
        startWall = performance.now()
        startTime = s.currentTime
        raf.current = requestAnimationFrame(tick)
      }
      if (!s.isPlaying && prev.isPlaying) {
        cancelAnimationFrame(raf.current)
      }
    })

    if (useEditorStore.getState().isPlaying) {
      raf.current = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(raf.current)
      unsub()
    }
  }, [])
}
