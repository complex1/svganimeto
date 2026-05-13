export const routes = {
  home: '/',
  editor: '/editor/:projectId'
} as const

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
