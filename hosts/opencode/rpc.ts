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
    startOpen: flag, defaultTab: { enum: ['files', 'search', 'git'] },
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
    type: 'object', properties: { kind: activityKind, at: { type: 'number' }, active: { type: 'integer', minimum: 1 } }, required: ['kind', 'at'], additionalProperties: false,
  },
} as const
const diffFile = {
  type: 'object', properties: {
    path: text, origPath: text, binary: flag, added: { type: 'integer', minimum: 0 }, removed: { type: 'integer', minimum: 0 }, change: { enum: ['new', 'deleted'] },
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

const hash = { type: 'string', minLength: 40, maxLength: 40 } as const
const source = { oneOf: [
  { type: 'object', properties: { kind: { const: 'working' }, staged: flag, untracked: flag }, required: ['kind', 'staged', 'untracked'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'commit' }, hash }, required: ['kind', 'hash'], additionalProperties: false },
  { type: 'object', properties: { kind: { const: 'compare' }, base: hash, head: hash }, required: ['kind', 'base', 'head'], additionalProperties: false },
] } as const
const commitFile = { type: 'object', properties: { path: text, from: text, status: { enum: ['M', 'A', 'D', 'R', 'T'] }, added: count, removed: count }, required: ['path', 'status', 'added', 'removed'], additionalProperties: false } as const
const files = { type: 'array', items: commitFile } as const
const hashInput = { type: 'object', properties: { hash }, required: ['hash'], additionalProperties: false } as const
const confirmedHash = { type: 'object', properties: { hash, confirmed: flag }, required: ['hash', 'confirmed'], additionalProperties: false } as const
const actionResult = { oneOf: [
  { type: 'object', properties: { ok: { const: true } }, required: ['ok'], additionalProperties: false },
  { type: 'object', properties: { ok: { const: false }, confirm: text }, required: ['ok', 'confirm'], additionalProperties: false },
] } as const

const query = { type: 'object', properties: { text, caseSensitive: flag, regex: flag, wholeWord: flag, include: strings, exclude: strings }, required: ['text', 'caseSensitive', 'regex', 'wholeWord', 'include', 'exclude'], additionalProperties: false } as const
const match = { type: 'object', properties: { rel: text, line: { type: 'integer', minimum: 1 }, text, ranges: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 } } }, required: ['rel', 'line', 'text', 'ranges'], additionalProperties: false } as const
const skipped = { type: 'array', items: { type: 'object', properties: { rel: text, reason: { enum: ['binary', 'not-utf8', 'changed', 'case-differs', 'regex-differs', 'outside-root', 'too-large', 'unreadable', 'unsupported-path'] } }, required: ['rel', 'reason'], additionalProperties: false } } as const
const replacements = { type: 'array', items: { type: 'object', properties: { rel: text, before: text, after: text, count: { type: 'integer', minimum: 1 } }, required: ['rel', 'before', 'after', 'count'], additionalProperties: false } } as const

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
    fsPrepare: {
      input: { type: 'object', properties: { sessionID: text, kind: { enum: ['new', 'rename', 'move', 'delete'] }, source: text }, required: ['sessionID', 'kind', 'source'], additionalProperties: false },
      output: { type: 'object', properties: { planId: text, root: text, kind: { enum: ['new', 'rename', 'move', 'delete'] }, source: text, sourceKind: { enum: ['file', 'dir', null] }, parent: text }, required: ['planId', 'root', 'kind', 'source', 'sourceKind', 'parent'], additionalProperties: false },
    },
    fsApply: {
      input: { type: 'object', properties: { sessionID: text, planId: text, value: text, confirmed: flag }, required: ['sessionID', 'planId', 'confirmed'], additionalProperties: false },
      output: { type: 'object', properties: { ok: flag, attempted: flag, rel: text, error: text, refreshError: text }, required: ['ok', 'attempted', 'rel'], additionalProperties: false },
    },
    open: {
      input: { type: 'object', properties: { rel: text, line: { type: 'integer', minimum: 1 } }, required: ['rel'], additionalProperties: false },
      // `refused`: why the OS opener was not run (a runnable type with no editorCommand).
      output: { type: 'object', properties: { refused: text }, additionalProperties: false }, errors: pathErrors,
    },
    stage: { input: paths, output: empty, errors: pathErrors },
    unstage: { input: paths, output: empty, errors: pathErrors },
    discard: { input: paths, output: empty, errors: pathErrors },
    diff: {
      input: { type: 'object', properties: { path: text, source }, required: ['path', 'source'], additionalProperties: false },
      output: {
        type: 'object', properties: { file: { anyOf: [diffFile, { type: 'null' }] }, truncated: flag, label: text },
        required: ['file', 'truncated'], additionalProperties: false,
      }, errors: pathErrors,
    },
    generate: { input: empty, output: { type: 'object', properties: { message: text }, required: ['message'], additionalProperties: false } },
    commitPlan: {
      input: { type: 'object', properties: { message: text, mode }, required: ['message', 'mode'], additionalProperties: false },
      output: {
        type: 'object', properties: { steps: { type: 'array', items: strings }, sensitive: strings, viaAgentShell: flag, refusal: text },
        required: ['steps', 'sensitive', 'viaAgentShell'], additionalProperties: false,
      },
    },
    commit: {
      input: { type: 'object', properties: { message: text, mode, approvedSensitive: strings }, required: ['message', 'mode', 'approvedSensitive'], additionalProperties: false },
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
    graph: {
      input: { type: 'object', properties: { filter: text, count: { type: 'integer', minimum: 1 }, sessionID: text }, required: ['filter', 'count', 'sessionID'], additionalProperties: false },
      output: { type: 'object', properties: { more: flag, commits: { type: 'array', items: {
        type: 'object', properties: { hash, parents: { type: 'array', items: hash }, author: text, time: { type: 'number' }, subject: text, agent: flag,
          refs: { type: 'array', items: { type: 'object', properties: { kind: { enum: ['head', 'local', 'remote', 'tag'] }, name: text }, required: ['kind', 'name'], additionalProperties: false } } },
        required: ['hash', 'parents', 'author', 'time', 'subject', 'agent', 'refs'], additionalProperties: false,
      } } }, required: ['commits', 'more'], additionalProperties: false },
    },
    commitFiles: { input: hashInput, output: { type: 'object', properties: { files }, required: ['files'], additionalProperties: false } },
    branches: { input: empty, output: { type: 'object', properties: { base: nullableText, branches: { type: 'array', items: {
      type: 'object', properties: { name: text, hash, remote: flag, current: flag, upstream: nullableText, gone: flag, ahead: { type: 'integer', minimum: 0 }, behind: { type: 'integer', minimum: 0 } },
      required: ['name', 'hash', 'remote', 'current', 'upstream', 'gone', 'ahead', 'behind'], additionalProperties: false,
    } } }, required: ['branches', 'base'], additionalProperties: false } },
    switchBranch: { input: { type: 'object', properties: { name: text, remote: flag, confirmed: flag }, required: ['name', 'remote', 'confirmed'], additionalProperties: false }, output: actionResult },
    createBranch: { input: { type: 'object', properties: { name: text, start: hash, confirmed: flag }, required: ['name', 'confirmed'], additionalProperties: false }, output: actionResult },
    compare: { input: { type: 'object', properties: { base: text, head: text }, required: ['base', 'head'], additionalProperties: false },
      output: { type: 'object', properties: { files, source: source.oneOf[2] }, required: ['files', 'source'], additionalProperties: false } },
    checkout: { input: confirmedHash, output: actionResult },
    revert: { input: confirmedHash, output: actionResult },
    fetch: { input: empty, output: empty },
    webUrl: { input: hashInput, output: { type: 'object', properties: { url: nullableText }, required: ['url'], additionalProperties: false } },
    openWeb: { input: hashInput, output: empty },
    searchStart: { input: { type: 'object', properties: { sessionID: text, id: text, query }, required: ['sessionID', 'id', 'query'], additionalProperties: false }, output: empty },
    searchCancel: { input: { type: 'object', properties: { sessionID: text, id: text }, required: ['sessionID', 'id'], additionalProperties: false }, output: empty },
    replacePlan: { input: { type: 'object', properties: { sessionID: text, query, replacement: text }, required: ['sessionID', 'query', 'replacement'], additionalProperties: false }, output: { type: 'object', properties: { planId: text, files: replacements, skipped }, required: ['planId', 'files', 'skipped'], additionalProperties: false } },
    replaceApply: { input: { type: 'object', properties: { sessionID: text, planId: text, rels: strings }, required: ['sessionID', 'planId', 'rels'], additionalProperties: false }, output: { type: 'object', properties: { written: strings, skipped, error: text }, required: ['written', 'skipped'], additionalProperties: false }, errors: pathErrors },
    quickOpenFiles: { input: empty, output: { type: 'object', properties: { files: strings }, required: ['files'], additionalProperties: false } },
  },
  events: {
    activity: { schema: { type: 'object', properties: { rel: text, kind: activityKind, active: flag }, required: ['rel', 'kind'], additionalProperties: false } },
    changed: { schema: empty },
    searchMatches: { schema: { type: 'object', properties: { sessionID: text, id: text, matches: { type: 'array', items: match, maxItems: 200 } }, required: ['sessionID', 'id', 'matches'], additionalProperties: false } },
    searchDone: { schema: { type: 'object', properties: { sessionID: text, id: text, engine: { enum: ['rg', 'git grep'] }, error: nullableText, ms: { type: 'number', minimum: 0 }, truncated: flag }, required: ['sessionID', 'id', 'engine', 'error', 'ms', 'truncated'], additionalProperties: false } },
  },
} as const satisfies Rpc.PortableDefinition)
