import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { getProjectStorage } from '@/services/projectStorage/getProjectStorage'
import type { ProjectRecord } from '@/services/projectStorage/types'
import {
  createNewProjectAndOpen,
  importProjectJsonFromFile,
  openProjectFromDialog,
  openStoredProject
} from '@/ipc/projectActions'
import { dialogConfirm } from '@/store/dialogStore'

function formatWhen(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export function HomeScreen() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasDesktopLibrary = typeof window.api?.projectLibrary?.openFromDialog === 'function'

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await getProjectStorage().list()
      setProjects(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onCreate() {
    setBusyId('create')
    try {
      await createNewProjectAndOpen()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onOpen(record: ProjectRecord) {
    setBusyId(record.id)
    try {
      await openStoredProject(record)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(record: ProjectRecord) {
    const ok = await dialogConfirm({
      message: `Delete “${record.name}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel'
    })
    if (!ok) return
    setBusyId(record.id)
    try {
      await getProjectStorage().delete(record.storageUri)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onOpenFromDisk() {
    setBusyId('open-file')
    try {
      const usedDialog = await openProjectFromDialog()
      if (usedDialog === false) fileInputRef.current?.click()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function onPickProjectFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusyId('open-file')
    try {
      const json = await file.text()
      await importProjectJsonFromFile(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="home-screen">
      <div className="home-screen-card">
        <header className="home-screen-header">
          <div>
            <h1 className="home-screen-title">SVG Animation Studio</h1>
            <p className="home-screen-subtitle">
              Create a project or open one from your local library.
            </p>
          </div>
          <div className="home-screen-actions">
            <button
              type="button"
              className="primary"
              disabled={busyId === 'create'}
              onClick={() => void onCreate()}
            >
              New project
            </button>
            <button
              type="button"
              disabled={busyId === 'open-file'}
              onClick={() => void onOpenFromDisk()}
            >
              {hasDesktopLibrary ? 'Open file…' : 'Import file…'}
            </button>
          </div>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept=".svgmotion,.json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => void onPickProjectFile(e)}
        />

        {error ? <p className="home-screen-error">{error}</p> : null}

        <section className="home-screen-list-section">
          <div className="home-screen-list-heading">
            <h2>Projects</h2>
            <button type="button" disabled={loading} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="home-screen-muted">Loading projects…</p>
          ) : projects.length === 0 ? (
            <p className="home-screen-muted">No saved projects yet. Create one to get started.</p>
          ) : (
            <ul className="home-screen-list">
              {projects.map((project) => (
                <li key={project.storageUri} className="home-screen-list-item">
                  <button
                    type="button"
                    className="home-screen-open"
                    disabled={busyId === project.id}
                    onClick={() => void onOpen(project)}
                  >
                    <span className="home-screen-open-name">{project.name}</span>
                    <span className="home-screen-open-meta">
                      Updated {formatWhen(project.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="home-screen-delete"
                    disabled={busyId === project.id}
                    onClick={() => void onDelete(project)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
