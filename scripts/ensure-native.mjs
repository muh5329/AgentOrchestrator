/**
 * Provisions the two binaries this app needs, without depending on npm
 * lifecycle scripts.
 *
 * Two things make the naive path fail:
 *
 *  1. npm 11+ blocks dependency install scripts by default, so `electron`'s
 *     postinstall never downloads its binary and `better-sqlite3`'s never
 *     fetches a prebuild.
 *  2. A compiled addon only loads under the ABI it was built for, and the app
 *     runs on Electron's Node while the tests run on yours.
 *
 * So this script downloads the Electron binary directly and asks
 * prebuild-install for the right better-sqlite3 prebuild itself. Nothing is
 * compiled, and it is idempotent - a stamp file makes repeat runs instant.
 *
 *   node scripts/ensure-native.mjs electron|node
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wanted = process.argv[2] === 'node' ? 'node' : 'electron'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modules = path.join(root, 'node_modules')
const electronDir = path.join(modules, 'electron')
const sqliteDir = path.join(modules, 'better-sqlite3')
const sqliteBinary = path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node')
const stampFile = path.join(modules, '.cache', 'native-runtime')

function readStamp() {
  try {
    return readFileSync(stampFile, 'utf8').trim()
  } catch {
    return ''
  }
}

function writeStamp(value) {
  mkdirSync(path.dirname(stampFile), { recursive: true })
  writeFileSync(stampFile, value, 'utf8')
}

function fail(message) {
  console.error(`\n[ensure-native] ${message}\n`)
  process.exit(1)
}

const electronVersion = (() => {
  try {
    return JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf8')).version
  } catch {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    return (pkg.devDependencies?.electron ?? '').replace(/^[^\d]*/, '') || '32.3.3'
  }
})()

/* ------------------------------------------------------------------ */
/* Electron's own binary                                               */
/* ------------------------------------------------------------------ */

/** Where the executable lives inside `dist`, per platform. */
function platformRelativePath() {
  switch (process.platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'win32':
      return 'electron.exe'
    default:
      return 'electron'
  }
}

function electronBinaryPath() {
  // path.txt is written by the installer; fall back to the platform default so
  // a half-finished install is still detectable.
  let name = platformRelativePath()
  try {
    name = readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim() || name
  } catch {
    /* not installed yet */
  }
  return path.join(electronDir, 'dist', name)
}

function electronInstalled() {
  return existsSync(electronBinaryPath())
}

function describeElectronState() {
  const lines = []
  const dist = path.join(electronDir, 'dist')
  lines.push(`  package:  ${existsSync(electronDir) ? 'present' : 'MISSING'}`)
  lines.push(`  dist/:    ${existsSync(dist) ? readdirSafe(dist).join(', ') || '(empty)' : 'MISSING'}`)
  try {
    lines.push(`  path.txt: ${readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim()}`)
  } catch {
    lines.push('  path.txt: MISSING')
  }
  lines.push(`  expected: ${electronBinaryPath()}`)
  return lines.join('\n')
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Runs the electron package's own installer.
 *
 * `force_no_cache` and a private cache directory are how we get past a
 * truncated or corrupt zip in the shared Electron cache, which otherwise makes
 * the installer exit successfully having extracted nothing.
 */
function runElectronInstaller({ freshCache }) {
  const env = { ...process.env }
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
  if (freshCache) {
    env.force_no_cache = 'true'
    env.electron_config_cache = path.join(modules, '.cache', 'electron-download')
    mkdirSync(env.electron_config_cache, { recursive: true })
  }
  try {
    execFileSync(process.execPath, ['install.js'], { cwd: electronDir, stdio: 'inherit', env })
    return true
  } catch {
    return false
  }
}

/**
 * Last resort: fetch the release zip and unpack it ourselves.
 *
 * Deliberately uses curl and unzip rather than @electron/get. The library hides
 * its failures behind a promise that can simply never settle, which surfaces as
 * "unsettled top-level await" and tells you nothing; curl either prints an
 * error or produces a file.
 */
function downloadElectronDirectly() {
  const mirror = process.env.ELECTRON_MIRROR ?? 'https://github.com/electron/electron/releases/download/'
  const asset = `electron-v${electronVersion}-${process.platform}-${process.arch}.zip`
  const url = `${mirror}v${electronVersion}/${asset}`
  const zipPath = path.join(modules, '.cache', asset)
  const dist = path.join(electronDir, 'dist')

  mkdirSync(path.dirname(zipPath), { recursive: true })
  console.log(`[ensure-native] fetching ${url}`)

  try {
    execFileSync('curl', ['-fL', '--retry', '3', '--retry-delay', '2', '-o', zipPath, url], {
      stdio: 'inherit'
    })
  } catch {
    console.error('[ensure-native] download failed.')
    return false
  }

  const size = statSizeOf(zipPath)
  if (size < 10_000_000) {
    console.error(`[ensure-native] the downloaded archive is only ${size} bytes; that is not Electron.`)
    return false
  }

  mkdirSync(dist, { recursive: true })
  if (!unzipInto(zipPath, dist)) return false

  const relative = platformRelativePath()
  writeFileSync(path.join(electronDir, 'path.txt'), relative, 'utf8')
  try {
    chmodSync(path.join(dist, relative), 0o755)
  } catch {
    /* the archive usually preserves the mode already */
  }
  rmSync(zipPath, { force: true })
  return existsSync(electronBinaryPath())
}

function statSizeOf(file) {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** Unpacks with whatever this machine has: unzip, then Python, then Node. */
function unzipInto(zipPath, dir) {
  const attempts = [
    { label: 'unzip', run: () => execFileSync('unzip', ['-q', '-o', zipPath, '-d', dir], { stdio: 'pipe' }) },
    {
      label: 'python3',
      run: () =>
        execFileSync(
          'python3',
          ['-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, dir],
          { stdio: 'pipe' }
        )
    },
    {
      label: 'ditto',
      run: () => execFileSync('ditto', ['-x', '-k', zipPath, dir], { stdio: 'pipe' })
    }
  ]

  for (const attempt of attempts) {
    try {
      attempt.run()
      if (readdirSafe(dir).length > 1) return true
    } catch {
      /* try the next extractor */
    }
  }
  console.error('[ensure-native] could not unpack the archive (tried unzip, python3, ditto).')
  return false
}

function ensureElectronBinary() {
  if (electronInstalled()) return

  if (!existsSync(path.join(electronDir, 'install.js'))) {
    fail('The electron package is missing. Run `npm install` first.')
  }

  console.log(`[ensure-native] downloading the Electron ${electronVersion} binary…`)
  runElectronInstaller({ freshCache: false })
  if (electronInstalled()) return

  // A `dist` that exists but has no executable in it means a previous run
  // extracted a truncated archive and still exited cleanly. Clear it, and
  // bypass the shared download cache that produced it.
  const dist = path.join(electronDir, 'dist')
  if (existsSync(dist)) {
    console.log(`[ensure-native] discarding a partial extraction (${readdirSafe(dist).length} files)…`)
    rmSync(dist, { recursive: true, force: true })
    rmSync(path.join(electronDir, 'path.txt'), { force: true })
  }

  console.log('[ensure-native] retrying with a fresh download cache…')
  runElectronInstaller({ freshCache: true })
  if (electronInstalled()) return

  console.log('[ensure-native] falling back to a direct download…')
  if (downloadElectronDirectly()) return

  fail(
    `Could not obtain the Electron ${electronVersion} binary.\n\n` +
      `${describeElectronState()}\n\n` +
      `Things worth trying:\n` +
      `  • rm -rf ~/Library/Caches/electron && npm run rebuild:electron\n` +
      `  • if you are behind a proxy or mirror, set ELECTRON_MIRROR and re-run\n` +
      `  • npx electron --version   (to see the underlying error directly)`
  )
}

/* ------------------------------------------------------------------ */
/* better-sqlite3                                                      */
/* ------------------------------------------------------------------ */

/** Opens a database in a throwaway child; never dlopen a foreign ABI in-process. */
function loadsUnderThisNode() {
  try {
    execFileSync(process.execPath, ['-e', "new (require('better-sqlite3'))(':memory:').close()"], {
      cwd: root,
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}

function fetchPrebuild(runtime) {
  const bin = path.join(modules, 'prebuild-install', 'bin.js')
  if (!existsSync(bin)) return false

  const args = [bin, '--tag-prefix', 'v', '--runtime', runtime]
  if (runtime === 'electron') {
    args.push('--target', electronVersion, '--dist-url', 'https://electronjs.org/headers')
  } else {
    args.push('--target', process.versions.node)
  }

  try {
    execFileSync(process.execPath, args, {
      cwd: sqliteDir,
      stdio: 'pipe',
      // npm may export these from .npmrc; they would override our flags.
      env: {
        ...process.env,
        npm_config_runtime: '',
        npm_config_target: '',
        npm_config_disturl: '',
        npm_config_build_from_source: ''
      }
    })
    return existsSync(sqliteBinary)
  } catch {
    return false
  }
}

function ensureSqlite(target) {
  if (target === 'node' && loadsUnderThisNode()) return

  console.log(`[ensure-native] fetching better-sqlite3 for ${target}…`)
  if (fetchPrebuild(target)) {
    if (target === 'node' && !loadsUnderThisNode()) {
      fail('The downloaded better-sqlite3 prebuild does not load under this Node.')
    }
    return
  }

  if (target === 'node') {
    fail(
      `No better-sqlite3 prebuild exists for Node ${process.versions.node}, and it cannot compile\n` +
        `against this version's V8 headers.\n\n` +
        `The application is unaffected - it runs on Electron's own Node - but the test suite needs\n` +
        `a Node that better-sqlite3 supports (20 to 23). With Homebrew:\n\n` +
        `  brew install node@22\n` +
        `  PATH="$(brew --prefix node@22)/bin:$PATH" npm test\n`
    )
  }

  fail(
    `Could not fetch a better-sqlite3 prebuild for Electron ${electronVersion}.\n` +
      `Check your network, then re-run. To build from source instead:\n\n` +
      `  npx @electron/rebuild -f -o better-sqlite3 -v ${electronVersion}\n`
  )
}

/* ------------------------------------------------------------------ */

const stamp = wanted === 'electron' ? `electron-${electronVersion}` : `node-${process.versions.modules}`

if (readStamp() === stamp && (wanted !== 'electron' || existsSync(electronBinaryPath() ?? ''))) {
  process.exit(0)
}

function main() {
  if (wanted === 'electron') ensureElectronBinary()
  ensureSqlite(wanted)
  writeStamp(stamp)
}

main()
