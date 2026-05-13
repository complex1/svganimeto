import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAppNavigate } from '@/navigation'

export function NavigationBinder() {
  const navigate = useNavigate()

  useEffect(() => {
    setAppNavigate((to) => navigate(to))
    return () => setAppNavigate(null)
  }, [navigate])

  return null
}
