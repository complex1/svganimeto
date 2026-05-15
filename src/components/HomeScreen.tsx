import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileArrowUp, faPlus, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { Link } from 'react-router-dom'
import { SvgAnimetoLogo } from '@/components/brand/SvgAnimetoLogo'
import { getProjectStorage } from '@/services/projectStorage/getProjectStorage'
import type { ProjectRecord } from '@/services/projectStorage/types'
import { APP_NAME, APP_TAGLINE } from '@/constants/brand'
import { routes } from '@/navigation'
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
      <header className="home-screen-topbar">
        <div className="home-screen-brand">
          <SvgAnimetoLogo size={40} />
          <div>
            <h1 className="home-screen-title">{APP_NAME}</h1>
            <p className="home-screen-subtitle">{APP_TAGLINE}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to={routes.landing} className="home-screen-site-link">
            About & compare
          </Link>
          <button type="button" className="home-screen-refresh" disabled={loading} onClick={() => void refresh()}>
            <FontAwesomeIcon icon={faRotateRight} style={{ marginRight: 6 }} />
            Refresh
          </button>
        </div>
      </header>

      <div className="home-screen-body">
        <section className="home-screen-actions" aria-label="Start a project">
          <button
            type="button"
            className="home-screen-action-card home-screen-action-card--primary"
            disabled={busyId === 'create'}
            onClick={() => void onCreate()}
          >
            <span className="home-screen-action-icon" aria-hidden>
              <FontAwesomeIcon icon={faPlus} />
            </span>
            <span className="home-screen-action-label">New project</span>
            <span className="home-screen-action-meta">Start with a blank artboard</span>
          </button>
          <button
            type="button"
            className="home-screen-action-card"
            disabled={busyId === 'open-file'}
            onClick={() => void onOpenFromDisk()}
          >
            <span className="home-screen-action-icon" aria-hidden>
              <FontAwesomeIcon icon={faFileArrowUp} />
            </span>
            <span className="home-screen-action-label">
              {hasDesktopLibrary ? 'Open from computer' : 'Import project file'}
            </span>
            <span className="home-screen-action-meta">Browse for a saved .svgmotion file</span>
          </button>
        </section>

        <input
          ref={fileInputRef}
          type="file"
          accept=".svgmotion,.json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => void onPickProjectFile(e)}
        />

        {error ? <p className="home-screen-error">{error}</p> : null}

        <section className="home-screen-recents">
          <div className="home-screen-recents-heading">
            <h2>Recent projects</h2>
            <span className="home-screen-recents-count">
              {loading ? 'Loading…' : `${projects.length} saved`}
            </span>
          </div>

          {loading ? (
            <p className="home-screen-muted">Loading your library…</p>
          ) : projects.length === 0 ? (
            <div className="home-screen-empty">
              <SvgAnimetoLogo size={56} />
              <p className="home-screen-empty-title">No projects yet</p>
              <p className="home-screen-muted">Create a new project or open a file to get started.</p>
            </div>
          ) : (
            <ul className="home-screen-grid">
              {projects.map((project) => (
                <li key={project.storageUri} className="home-screen-grid-item">
                  <button
                    type="button"
                    className="home-screen-project-card"
                    disabled={busyId === project.id}
                    onClick={() => void onOpen(project)}
                  >
                    <span className="home-screen-project-thumb" aria-hidden>
                      <SvgAnimetoLogo size={28} />
                    </span>
                    <span className="home-screen-project-name">{project.name}</span>
                    <span className="home-screen-project-meta">Updated {formatWhen(project.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="home-screen-project-delete"
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
