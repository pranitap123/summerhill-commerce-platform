#!/usr/bin/env node
// G7-03: turns the store's frames from the demo recording (tests/e2e/demo.spec.ts) into the README
// GIF, docs/media/fulfilment.gif. Needs ffmpeg on PATH.
//   DEMO_RECORD=1 npx playwright test tests/e2e/demo.spec.ts && node scripts/demo-media.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frames = path.join(app, 'test-results/demo-frames')
const out = path.resolve(app, '../../docs/media/fulfilment.gif')

const count = fs.existsSync(frames)
  ? fs.readdirSync(frames).filter((f) => f.endsWith('.png')).length
  : 0
if (!count) {
  console.error(`demo-media: no frames in ${frames}; run the recording first`)
  process.exit(1)
}
// 2 frames a second (each step is held for a few frames), 960 px wide, one 128-colour palette.
const filter =
  'scale=960:-1:flags=lanczos,split[a][b];' +
  '[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'
const res = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '2',
    '-i',
    path.join(frames, 'frame-%04d.png'),
    '-vf',
    filter,
    out,
  ],
  { stdio: 'inherit' },
)
if (res.status !== 0) process.exit(res.status ?? 1)
console.log(
  `demo-media: ${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`,
)
