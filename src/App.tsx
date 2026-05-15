import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NavigationBinder } from '@/components/NavigationBinder'
import { DashboardPage } from '@/pages/DashboardPage'
import { EditorPage } from '@/pages/EditorPage'
import { LandingPage } from '@/pages/LandingPage'
import { routes } from '@/navigation'

export default function App() {
  return (
    <HashRouter>
      <NavigationBinder />
      <Routes>
        <Route path={routes.landing} element={<LandingPage />} />
        <Route path={routes.dashboard} element={<DashboardPage />} />
        <Route path={routes.editor} element={<EditorPage />} />
        <Route path="*" element={<Navigate to={routes.landing} replace />} />
      </Routes>
    </HashRouter>
  )
}
