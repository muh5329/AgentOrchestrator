import { promises as fs } from 'node:fs'
import path from 'node:path'
import { bool, fail, num, obj, ok, str, type ToolDefinition, type ToolInvocation } from './types'

const TOOLKIT = 'Filesystem'
const MAX_READ_BYTES = 256 * 1024

/**
 * Resolves a tool-supplied path inside the execution's workspace and refuses
 * anything that escapes it. Agents get a sandbox, not the whole disk.
 */
export function resolveInWorkspace(
  inv: ToolInvocation,
  candidate: string
): { path: string } | { error: string } {
  if (!inv.workspaceDir) {
    return { error: 'This project has no workspace directory, so file tools are unavailable.' }
  }
  const root = path.resolve(inv.workspaceDir)
  const resolved = path.resolve(root, candidate)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { error: `Refused: "${candidate}" is outside the project workspace.` }
  }
  return { path: resolved }
}

export const filesystemTools: ToolDefinition[] = [
  {
    name: 'read_file',
    toolkit: TOOLKIT,
    description: 'Read a UTF-8 file from the project workspace.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj(
      { path: str('Path relative to the project workspace.'), max_bytes: num('Read cap.') },
      ['path']
    ),
    async handler(input, inv) {
      const target = resolveInWorkspace(inv, String(input.path))
      if ('error' in target) return fail(target.error)
      try {
        const stat = await fs.stat(target.path)
        const cap = Math.min(Number(input.max_bytes ?? MAX_READ_BYTES), MAX_READ_BYTES)
        if (stat.size > cap) {
          const handle = await fs.open(target.path, 'r')
          const buf = Buffer.alloc(cap)
          await handle.read(buf, 0, cap, 0)
          await handle.close()
          return ok(`${buf.toString('utf8')}\n\n[truncated at ${cap} bytes of ${stat.size}]`)
        }
        return ok(await fs.readFile(target.path, 'utf8'))
      } catch (err) {
        return fail(`Could not read ${input.path}: ${(err as Error).message}`)
      }
    }
  },

  {
    name: 'write_file',
    toolkit: TOOLKIT,
    description:
      'Write a file in the project workspace, creating parent directories as needed. ' +
      'Overwrites existing content.',
    requiredPermissions: ['FILES_WRITE'],
    inputSchema: obj({ path: str('Path relative to the workspace.'), content: str('File contents.') }, [
      'path',
      'content'
    ]),
    async handler(input, inv) {
      const target = resolveInWorkspace(inv, String(input.path))
      if ('error' in target) return fail(target.error)
      try {
        await fs.mkdir(path.dirname(target.path), { recursive: true })
        await fs.writeFile(target.path, String(input.content), 'utf8')
        inv.ctx.artifacts.create({
          projectId: inv.projectId,
          taskId: inv.taskId,
          executionId: inv.executionId,
          agentId: inv.agentId,
          kind: 'file',
          title: String(input.path),
          path: target.path
        })
        return ok(`Wrote ${input.path} (${String(input.content).length} bytes).`)
      } catch (err) {
        return fail(`Could not write ${input.path}: ${(err as Error).message}`)
      }
    }
  },

  {
    name: 'edit_file',
    toolkit: TOOLKIT,
    description:
      'Replace an exact string in a file. Fails if the string is absent or ambiguous, which ' +
      'is deliberate - it stops silent bad edits.',
    requiredPermissions: ['FILES_WRITE'],
    inputSchema: obj(
      {
        path: str('Path relative to the workspace.'),
        old_string: str('Exact text to replace.'),
        new_string: str('Replacement text.'),
        replace_all: bool('Replace every occurrence instead of requiring uniqueness.')
      },
      ['path', 'old_string', 'new_string']
    ),
    async handler(input, inv) {
      const target = resolveInWorkspace(inv, String(input.path))
      if ('error' in target) return fail(target.error)
      try {
        const original = await fs.readFile(target.path, 'utf8')
        const oldStr = String(input.old_string)
        const occurrences = original.split(oldStr).length - 1
        if (occurrences === 0) return fail(`That exact text is not present in ${input.path}.`)
        if (occurrences > 1 && input.replace_all !== true) {
          return fail(
            `That text appears ${occurrences} times in ${input.path}. Add more context to make it unique, or set replace_all.`
          )
        }
        const updated =
          input.replace_all === true
            ? original.split(oldStr).join(String(input.new_string))
            : original.replace(oldStr, String(input.new_string))
        await fs.writeFile(target.path, updated, 'utf8')
        return ok(`Edited ${input.path} (${occurrences} replacement${occurrences > 1 ? 's' : ''}).`)
      } catch (err) {
        return fail(`Could not edit ${input.path}: ${(err as Error).message}`)
      }
    }
  },

  {
    name: 'list_dir',
    toolkit: TOOLKIT,
    description: 'List a directory in the project workspace.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj({ path: str('Directory, relative to the workspace. Default ".".') }),
    async handler(input, inv) {
      const target = resolveInWorkspace(inv, String(input.path ?? '.'))
      if ('error' in target) return fail(target.error)
      try {
        const entries = await fs.readdir(target.path, { withFileTypes: true })
        const lines = entries
          .filter((e) => !e.name.startsWith('.git'))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
        return ok(lines.join('\n') || '(empty)', lines)
      } catch (err) {
        return fail(`Could not list ${input.path ?? '.'}: ${(err as Error).message}`)
      }
    }
  },

  {
    name: 'search_files',
    toolkit: TOOLKIT,
    description: 'Search the workspace for a regular expression and return matching lines.',
    requiredPermissions: ['FILES_READ'],
    inputSchema: obj(
      {
        pattern: str('Regular expression.'),
        glob: str('Optional filename substring filter, e.g. ".ts".'),
        max_results: num('Default 60.')
      },
      ['pattern']
    ),
    async handler(input, inv) {
      if (!inv.workspaceDir) return fail('This project has no workspace directory.')
      let re: RegExp
      try {
        re = new RegExp(String(input.pattern), 'i')
      } catch (err) {
        return fail(`Invalid pattern: ${(err as Error).message}`)
      }
      const filter = input.glob ? String(input.glob) : null
      const max = Number(input.max_results ?? 60)
      const results: string[] = []

      const walk = async (dir: string): Promise<void> => {
        if (results.length >= max) return
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (results.length >= max) return
          if (['node_modules', '.git', 'dist', 'out', 'release'].includes(entry.name)) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(full)
            continue
          }
          if (filter && !entry.name.includes(filter)) continue
          try {
            const stat = await fs.stat(full)
            if (stat.size > MAX_READ_BYTES) continue
            const content = await fs.readFile(full, 'utf8')
            const lines = content.split('\n')
            for (let i = 0; i < lines.length && results.length < max; i++) {
              if (re.test(lines[i])) {
                results.push(
                  `${path.relative(inv.workspaceDir as string, full)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`
                )
              }
            }
          } catch {
            /* binary or unreadable: skip */
          }
        }
      }

      await walk(path.resolve(inv.workspaceDir))
      return ok(results.length ? results.join('\n') : 'No matches.', results)
    }
  }
]
