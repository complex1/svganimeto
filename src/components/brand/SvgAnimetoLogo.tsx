import clsx from 'clsx'
import { APP_NAME } from '@/constants/brand'

type SvgAnimetoLogoProps = {
  size?: number
  className?: string
  title?: string
}

export function SvgAnimetoLogo({ size = 32, className, title = APP_NAME }: SvgAnimetoLogoProps) {
  const gradientId = `svgAnimeto-mark-${size}`

  return (
    <svg
      className={clsx('svgAnimeto-logo', className)}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7aa8ff" />
          <stop offset="1" stopColor="#5b8def" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#1a1d23" />
      <path
        d="M14 44 L24 20 L34 44"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 34 H28"
        fill="none"
        stroke="#e8eaed"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="44" cy="24" r="4.5" fill="#7aa8ff" />
      <circle cx="50" cy="40" r="4.5" fill="#5b8def" />
      <path
        d="M44 28.5 C44 28.5 46.5 33 50 35.5"
        fill="none"
        stroke="#9aa0a6"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
