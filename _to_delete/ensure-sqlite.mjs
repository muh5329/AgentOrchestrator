/**
 * Keeps better-sqlite3's native binary matched to whichever runtime is about to
 * load it.
 *
 * The app runs on Electron's Node, the test suite runs on your system Node, and
 * a compiled addon only loads under the ABI it was built for. Rather than
 * leaving that as a footgun, `predev` and `pretest` call this and it swaps the
 * binary when needed - a download, not a compile, when a prebuild exists.
 *
 *   node scripts/ensure-sqlite.mjs electron|node
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const wanted = process.argv[2] === 'node' ? 'node' : 'electron'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const stampFile = path.join(root, 'node_modules', '.cache', 'better-sqlite3-runtime')

const electronVersion = (() => {
  // The installed version is what actually matters; the range in package.json
  // is only a fallback for a fresh checkout.
  try {
    return JSON.parse(
      readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
    ).version
  } catch {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    return (pkg.devDependencies.electron ?? '').replace(/^[^\d]*/, '') || '32.3.3'
  }
})()

function currentStamp() {
  try {
    return readFileSync(stampFile, 'utf8').trim()
  } catch {
    return ''
  }
}

function stamp(value) {
  mkdirSync(path.dirname(stampFile), { recursive: true })
  writeFileSync(stampFile, value, 'utf8')
}

const target = wanted === 'electron' ? `electron-${electronVersion}` : `node-${process.versions.modules}`

if (currentStamp() === target) {
  process.exit(0)
}

/**
 * Opens a database in a throwaway child process.
 *
 * Never load the addon in this process: dlopening one built for a different ABI
 * leaves the process in a state that can fault on exit, which turns a helpful
 * message into a bare "Segmentation fault".
 */
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

// A binary built for this exact Node already works; leave it alone.
if (wanted === 'node' && loadsUnderThisNode()) {
  stamp(target)
  process.exit(0)
}

const args = ['rebuild', 'better-sqlite3']
if (wanted === 'electron') {
  args.push(
    `--runtime=electron`,
    `--target=${electronVersion}`,
    `--dist-url=https://electronjs.org/headers`
  )
} else {
  args.push('--runtime=node', '--target=', '--dist-url=')
}

console.log(`[ensure-sqlite] building better-sqlite3 for ${target}…`)
try {
  execFileSync('npm', args, { cwd: root, stdio: 'inherit' })
  stamp(target)
} catch {
  if (wanted === 'node') {
    console.error(
      `\n[ensure-sqlite] Could not build better-sqlite3 for Node ${process.versions.node}.\n` +
        `better-sqlite3 publishes prebuilt binaries up to Node 23 and cannot compile against\n` +
        `newer V8 headers. The application itself is unaffected - it runs on Electron's Node -\n` +
        `but the test suite needs a Node it supports:\n\n` +
        `  nvm install 22 && nvm use 22 && npm test\n`
    )
  } else {
    console.error(
      `\n[ensure-sqlite] Could not prepare better-sqlite3 for Electron ${electronVersion}.\n` +
        `Check your network, then try: npm run rebuild:electron\n`
    )
  }
  process.exit(1)
}

const binary = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
if (!existsSync(binary)) {
  console.error('[ensure-sqlite] rebuild finished but no binary was produced')
  process.exit(1)
}

// Prove the new binary actually loads before anything else opens it. This also
// guarantees the file is fully written before the test runner starts.
if (wanted === 'node' && !loadsUnderThisNode()) {
  console.error('[ensure-sqlite] the rebuilt binary still does not load under this Node.')
  process.exit(1)
}
