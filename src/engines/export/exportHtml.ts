import type { Project } from '@/types/document'
import type { AnimationTrack } from '@/types/animation'
import { exportAnimatedSvg } from '@/engines/export/exportSvg'

function stripXmlDeclaration(s: string) {
  return s.replace(/<\?xml[^?]*\?>\s*/i, '')
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Self-contained HTML page embedding the animated SVG (CSS keyframe animation). */
export function exportAnimatedHtml(
  project: Project,
  tracks: AnimationTrack[],
  durationSec: number,
  options?: { loop?: boolean; minify?: boolean; title?: string }
): string {
  const svg = exportAnimatedSvg(project, tracks, durationSec, options)
  const title = escapeHtml(options?.title ?? project.name ?? 'Animation')
  const body = stripXmlDeclaration(svg)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  html, body { height: 100%; margin: 0; background: #1a1d23; }
  .wrap {
    min-height: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .wrap svg { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; }
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`
}
