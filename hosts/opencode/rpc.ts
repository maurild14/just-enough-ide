import { Rpc } from '@opencode/plugin'
import type { GitSnapshot } from '../../core/git/service.ts'

type RepoSnapshot = Extract<GitSnapshot, { root: string }>
type Counts = Record<string, { added: number | null; removed: number | null }>
export type WireGitSnapshot = { root: null } | (Omit<RepoSnapshot, 'numstat' | 'staged'> & { numstat: Counts; staged: Counts })

export function toWire(snapshot: GitSnapshot): WireGitSnapshot {
  if (snapshot.root === null) return { root: null }
  return { ...snapshot, numstat: Object.fromEntries(snapshot.numstat), staged: Object.fromEntries(snapshot.staged) }
}

export function fromWire(snapshot: WireGitSnapshot): GitSnapshot {
  if (snapshot.root === null) return { root: null }
  return { ...snapshot, numstat: new Map(Object.entries(snapshot.numstat)), staged: new Map(Object.entries(snapshot.staged)) }
}

const empty = { type: 'object', properties: {}, required: [], additionalProperties: false } as const
const text = { type: 'string' } as const
const flag = { type: 'boolean' } as const
const strings = { type: 'array', items: text } as const
const nullableText = { anyOf: [text, { type: 'null' }] } as const
const count = { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] } as const
const counts = {
  type: 'object', additionalProperties: {
    type: 'object', properties: { added: count, removed: count }, required: ['added', 'removed'], additionalProperties: false,
  },
} as const
const status = { enum: ['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted', 'ignored', null] } as const
const gitSnapshot = {
  oneOf: [
    { type: 'object', properties: { root: { type: 'null' } }, required: ['root'], additionalProperties: false },
    {
      type: 'object', properties: {
        root: text,
        status: {
          type: 'object', properties: {
            branch: {
              type: 'object', properties: {
                head: nullableText, oid: nullableText, upstream: nullableText,
                ahead: { type: 'integer', minimum: 0 }, behind: { type: 'integer', minimum: 0 },
              }, required: ['head', 'oid', 'upstream', 'ahead', 'behind'], additionalProperties: false,
            },
            entries: {
              type: 'array', items: {
                type: 'object', properties: { path: text, origPath: text, index: status, worktree: status },
                required: ['path', 'index', 'worktree'], additionalProperties: false,
              },
            },
          }, required: ['branch', 'entries'], additionalProperties: false,
        },
        numstat: counts, staged: counts, hooks: flag,
      }, required: ['root', 'status', 'numstat', 'staged', 'hooks'], additionalProperties: false,
    },
  ],
} as const
const options = {
  type: 'object', properties: {
    startOpen: flag, defaultTab: { enum: ['files', 'search', 'symbols', 'git'] },
    activity: { enum: ['reads and writes', 'writes', 'reads', 'none'] }, followAgent: flag,
    glyphs: { enum: ['auto', 'nerd', 'plain'] }, editorCommand: text, commitModel: text,
    smartCommit: flag, graphLimit: { type: 'integer', minimum: 1 },
  },
  required: ['startOpen', 'defaultTab', 'activity', 'followAgent', 'glyphs', 'editorCommand', 'commitModel', 'smartCommit', 'graphLimit'],
  additionalProperties: false,
} as const
const activityKind = { enum: ['read', 'write', 'git'] } as const
const activity = {
  type: 'object', additionalProperties: {
    type: 'object', properties: { kind: activityKind, at: { type: 'number' } }, required: ['kind', 'at'], additionalProperties: false,
  },
} as const
const diffFile = {
  type: 'object', properties: {
    path: text, origPath: text, binary: flag, added: { type: 'integer', minimum: 0 }, removed: { type: 'integer', minimum: 0 },
    hunks: {
      type: 'array', items: {
        type: 'object', properties: {
          header: text,
          lines: {
            type: 'array', items: {
              type: 'object', properties: {
                kind: { enum: ['add', 'del', 'ctx', 'meta'] }, text,
                oldNo: { type: 'integer', minimum: 1 }, newNo: { type: 'integer', minimum: 1 },
              }, required: ['kind', 'text'], additionalProperties: false,
            },
          },
        }, required: ['header', 'lines'], additionalProperties: false,
      },
    },
  }, required: ['path', 'binary', 'added', 'removed', 'hunks'], additionalProperties: false,
} as const
const rel = { type: 'object', properties: { rel: text }, required: ['rel'], additionalProperties: false } as const
const paths = { type: 'object', properties: { paths: strings }, required: ['paths'], additionalProperties: false } as const
const mode = { enum: ['commit', 'commit-push', 'amend'] } as const
const pathErrors = { outside_root: empty } as const

/** One portable JSON Schema contract, shared by the server and a possibly remote TUI. */
export const JeiRpc = Rpc.define({
  id: 'jei',
  methods: {
    state: {
      input: empty,
      output: {
        type: 'object', properties: { cwd: text, options, git: gitSnapshot, activity },
        required: ['cwd', 'options', 'git', 'activity'], additionalProperties: false,
      },
    },
    listDir: {
      input: rel,
      output: {
        type: 'object', properties: {
          entries: {
            type: 'array', items: {
              type: 'object', properties: { name: text, kind: { enum: ['file', 'dir', 'other'] }, size: { type: 'number', minimum: 0 } },
              required: ['name', 'kind', 'size'], additionalProperties: false,
            },
          }, ignored: strings,
        }, required: ['entries', 'ignored'], additionalProperties: false,
      }, errors: pathErrors,
    },
    preview: {
      input: rel,
      output: {
        type: 'object', properties: {
          kind: { enum: ['code', 'markdown', 'csv', 'tsv', 'image', 'binary', 'too-large', 'empty', 'error'] },
          text, rows: { type: 'array', items: strings }, language: text,
        }, required: ['kind'], additionalProperties: false,
      }, errors: pathErrors,
    },
    allFiles: { input: empty, output: { type: 'object', properties: { files: strings }, required: ['files'], additionalProperties: false } },
    open: {
      input: { type: 'object', properties: { rel: text, line: { type: 'integer', minimum: 1 } }, required: ['rel'], additionalProperties: false },
      output: empty, errors: pathErrors,
    },
    stage: { input: paths, output: empty, errors: pathErrors },
    unstage: { input: paths, output: empty, errors: pathErrors },
    discard: { input: paths, output: empty, errors: pathErrors },
    diff: {
      input: { type: 'object', properties: { path: text, staged: flag, untracked: flag }, required: ['path', 'staged', 'untracked'], additionalProperties: false },
      output: {
        type: 'object', properties: { file: { anyOf: [diffFile, { type: 'null' }] }, truncated: flag },
        required: ['file', 'truncated'], additionalProperties: false,
      }, errors: pathErrors,
    },
    generate: { input: empty, output: { type: 'object', properties: { message: text }, required: ['message'], additionalProperties: false } },
    commitPlan: {
      input: { type: 'object', properties: { message: text, mode }, required: ['message', 'mode'], additionalProperties: false },
      output: {
        type: 'object', properties: { steps: { type: 'array', items: strings }, sensitive: strings, viaAgentShell: flag },
        required: ['steps', 'sensitive', 'viaAgentShell'], additionalProperties: false,
      },
    },
    commit: {
      input: { type: 'object', properties: { message: text, mode, allowSensitive: flag }, required: ['message', 'mode', 'allowSensitive'], additionalProperties: false },
      output: empty,
    },
    init: { input: empty, output: empty },
    sync: {
      input: { type: 'object', properties: { choice: { enum: ['merge', 'rebase'] } }, required: [], additionalProperties: false },
      output: {
        type: 'object',
        oneOf: [
          { type: 'object', properties: { ok: { const: true } }, required: ['ok'], additionalProperties: false },
          { type: 'object', properties: { ok: { const: false }, divergence: { const: true } }, required: ['ok', 'divergence'], additionalProperties: false },
          { type: 'object', properties: { ok: { const: false }, error: text }, required: ['ok', 'error'], additionalProperties: false },
        ],
      },
    },
  },
  events: {
    activity: { schema: { type: 'object', properties: { rel: text, kind: activityKind }, required: ['rel', 'kind'], additionalProperties: false } },
    changed: { schema: empty },
  },
} as const satisfies Rpc.PortableDefinition)
