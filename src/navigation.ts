export const routes = {
  /** Marketing landing (hero, compare, GitHub). */
  landing: '/',
  /** Project library and open/create flows. */
  dashboard: '/dashboard',
  editor: '/editor/:projectId'
} as const

/** Alias for post-editor navigation (library home). */
export const routesHome = routes.dashboard

export function editorPath(projectId: string) {
  return `/editor/${encodeURIComponent(projectId)}`
}

type NavigateFn = (to: string) => void

let navigateFn: NavigateFn | null = null

export function setAppNavigate(fn: NavigateFn | null) {
  navigateFn = fn
}

export function navigateApp(to: string) {
  navigateFn?.(to)
}
