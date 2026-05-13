import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { NavigationBinder } from '@/components/NavigationBinder'
import { EditorPage } from '@/pages/EditorPage'
import { HomePage } from '@/pages/HomePage'
import { routes } from '@/navigation'

export default function App() {
  return (
    <HashRouter>
      <NavigationBinder />
      <Routes>
        <Route path={routes.home} element={<HomePage />} />
        <Route path={routes.editor} element={<EditorPage />} />
        <Route path="*" element={<Navigate to={routes.home} replace />} />
      </Routes>
    </HashRouter>
  )
}
