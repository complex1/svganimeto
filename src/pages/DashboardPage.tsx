import { DialogHost } from '@/components/DialogHost'
import { HomeScreen } from '@/components/HomeScreen'

export function DashboardPage() {
  return (
    <div className="app-root app-root--home">
      <DialogHost />
      <HomeScreen />
    </div>
  )
}
