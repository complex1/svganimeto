import { useEffect, useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SvgAnimetoLogo } from '@/components/brand/SvgAnimetoLogo'
import { APP_NAME, APP_TAGLINE, GITHUB_REPO_URL } from '@/constants/brand'
import { routes } from '@/navigation'
import '@/styles/landing.css'

const HERO_WORDS = ['Design', 'and', 'animate', 'SVG', 'motion', '—', 'in', 'the', 'open.']

const FEATURES = [
  {
    icon: '◆',
    title: 'Draw + animate in one flow',
    body: 'Vector tools, timeline keyframes, motion paths, symbols, and export without leaving the artboard mental model.'
  },
  {
    icon: '◇',
    title: 'True SVG pipeline',
    body: 'Transforms and animatable attributes stay in SVG space—ideal when you need crisp scaling and accessible output.'
  },
  {
    icon: '◎',
    title: 'Desktop & web storage',
    body: 'IndexedDB in the browser, filesystem on Electron, with a storage port ready for a future hosted backend.'
  },
  {
    icon: '▣',
    title: 'Export that matches your stack',
    body: 'Self-contained animated SVG, HTML with CSS keyframes, GIF, or browser-recorded WebM/MP4 when available.'
  },
  {
    icon: '⎔',
    title: 'GSAP-backed preview path',
    body: 'Optional compiled timeline driver for parity checks between classic sampling and GSAP-driven motion.'
  },
  {
    icon: '✦',
    title: 'Open source',
    body: 'Inspect, fork, and extend on GitHub—no subscription wall on the codebase itself.'
  }
] as const

const COMPARE_ROWS = [
  {
    name: 'Lottie / Bodymovin',
    focus: 'After Effects → JSON for app runtimes; huge ecosystem.',
    us: 'svgAnimeto edits SVG natively in the editor and can emit animated SVG or HTML/CSS—no AE license required for this app.'
  },
  {
    name: 'Rive',
    focus: 'State machines & runtime for games and product UI.',
    us: 'Different niche: classic timeline + vector layers for SVG-centric deliverables and static export without Rive’s runtime.'
  },
  {
    name: 'SVGator',
    focus: 'Popular web-based SVG animation with export.',
    us: 'svgAnimeto targets a full editor shell (draw, layers, symbols, trace) and local-first storage; OSS on GitHub for self-hosting.'
  },
  {
    name: 'Haiku / LottieFiles',
    focus: 'Handoff, preview, and marketplace around motion assets.',
    us: 'Integrated authoring: draw, keyframe, preview, and export from one open-source desktop/web bundle.'
  },
  {
    name: 'Figma',
    focus: 'Screen design & prototyping; SVG mostly static or simplified.',
    us: 'Dedicated vector animation timeline—keyframes on transform, path, fills, and effects tuned for motion output.'
  }
] as const

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const root = rootRef.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      gsap.from('.landing-hero-badge', { y: 18, opacity: 0, duration: 0.45, ease: 'power2.out' })
      gsap.from('.landing-hero-word', {
        y: 48,
        opacity: 0,
        stagger: 0.05,
        duration: 0.58,
        ease: 'power3.out',
        delay: 0.06
      })
      gsap.from('.landing-hero-lead', { y: 22, opacity: 0, duration: 0.5, ease: 'power2.out', delay: 0.22 })
      gsap.from('.landing-hero-ctas .landing-btn', {
        y: 18,
        opacity: 0,
        stagger: 0.08,
        duration: 0.42,
        ease: 'power2.out',
        delay: 0.32
      })
      gsap.from('.landing-hero-meta', { opacity: 0, duration: 0.45, delay: 0.42 })
      gsap.from('.landing-hero-visual', {
        scale: 0.9,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
        delay: 0.1
      })

      gsap.to('.landing-orbit', {
        rotation: 360,
        duration: 90,
        repeat: -1,
        ease: 'none',
        transformOrigin: '50% 50%'
      })
      gsap.to('.landing-mock-shape', {
        y: -8,
        duration: 2.4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      })

      root.querySelectorAll<HTMLElement>('.landing-reveal').forEach((el) => {
        gsap.from(el, {
          y: 36,
          opacity: 0,
          duration: 0.52,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 89%',
            once: true
          }
        })
      })
    }, root)

    return () => ctx.revert()
  }, [])

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const onResize = () => {
      ScrollTrigger.refresh()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  return (
    <div className="landing" ref={rootRef}>
      <nav className="landing-nav" aria-label="Primary">
        <a href="#top" className="landing-nav-brand">
          <SvgAnimetoLogo size={36} className="landing-nav-logo" />
          <span>{APP_NAME}</span>
        </a>
        <div className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#compare">Compare</a>
          <a href="#opensource">Open source</a>
        </div>
        <div className="landing-nav-actions">
          <a className="landing-btn" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
          <Link className="landing-btn landing-btn--primary" to={routes.dashboard}>
            Open dashboard
          </Link>
        </div>
      </nav>

      <header className="landing-hero" id="top">
        <div className="landing-hero-grid">
          <div className="landing-hero-inner">
            <span className="landing-hero-badge">Vector animation studio</span>
            <h1>
              {HERO_WORDS.map((w, i) => (
                <span className="landing-hero-word" key={`${w}-${i}`}>
                  {w}
                </span>
              ))}
            </h1>
            <p className="landing-hero-lead">
              {APP_TAGLINE}. svgAnimeto combines Illustrator-style layout with a keyframe timeline, motion paths, and
              export options so your SVGs stay sharp from first sketch to shipped animation.
            </p>
            <div className="landing-hero-ctas">
              <Link className="landing-btn landing-btn--primary" to={routes.dashboard}>
                Go to dashboard
              </Link>
              <a className="landing-btn" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
                View on GitHub
              </a>
            </div>
            <div className="landing-hero-meta">
              <span>
                <strong>Open source</strong> · MIT-friendly workflow
              </span>
              <span>
                <strong>Routes</strong> · <code>#/</code> landing · <code>#/dashboard</code> projects
              </span>
            </div>
          </div>
          <div className="landing-hero-visual" aria-hidden>
            <div className="landing-orbit" />
            <div className="landing-mock">
              <div className="landing-mock-chrome">
                <span className="landing-mock-dot" />
                <span className="landing-mock-dot" />
                <span className="landing-mock-dot" />
              </div>
              <div className="landing-mock-body">
                <div className="landing-mock-sidebar" />
                <div className="landing-mock-canvas">
                  <div className="landing-mock-shape" />
                </div>
                <div className="landing-mock-inspector">
                  <div className="landing-mock-bar" style={{ width: '70%' }} />
                  <div className="landing-mock-bar" />
                  <div className="landing-mock-bar" style={{ width: '55%' }} />
                  <div className="landing-mock-bar" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="landing-section landing-reveal" id="features">
        <h2>Built for teams who still believe in SVG</h2>
        <p className="landing-section-intro">
          Market leaders each optimize for their own runtime or pipeline. svgAnimeto optimizes for{' '}
          <strong>editable vectors</strong>, a <strong>transparent file model</strong>, and{' '}
          <strong>export you can host anywhere</strong>—whether that is a static site, Electron shell, or your own API
          layer later.
        </p>
        <div className="landing-features">
          {FEATURES.map((f) => (
            <article className="landing-card" key={f.title}>
              <div className="landing-card-icon" aria-hidden>
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-reveal" id="compare">
        <h2>How svgAnimeto fits next to common tools</h2>
        <p className="landing-section-intro">
          The table below is a high-level positioning guide—not a feature scorecard. Products like Lottie, Rive, and
          SVGator excel in their lanes; svgAnimeto is for authors who want a <strong>desktop-grade SVG editor</strong>{' '}
          with <strong>timeline animation</strong> and <strong>code-first export</strong> under an OSS license.
        </p>
        <div
          className="landing-compare-wrap"
          role="region"
          aria-label="Comparison table — scroll horizontally on small screens"
        >
          <table className="landing-compare">
            <thead>
              <tr>
                <th>Product / pattern</th>
                <th>What the market optimizes for</th>
                <th>svgAnimeto angle</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.focus}</td>
                  <td>{row.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="landing-cta-panel landing-reveal" id="opensource">
        <h2>Source on GitHub</h2>
        <p>
          Fork, report issues, or contribute: the canonical repository is hosted at{' '}
          <strong>github.com/complex1/svganimeto</strong>. The app uses React, Vite, Zustand, and GSAP—familiar pieces if
          you are extending the timeline or storage adapters.
        </p>
        <div className="landing-cta-actions">
          <a className="landing-btn landing-btn--primary" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
            Open repository
          </a>
          <Link className="landing-btn" to={routes.dashboard}>
            Launch dashboard
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <p>
          {APP_NAME} ·{' '}
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
            {GITHUB_REPO_URL}
          </a>{' '}
          · <Link to={routes.dashboard}>Dashboard</Link>
        </p>
      </footer>
    </div>
  )
}
