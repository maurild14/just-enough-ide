/** Prompt asking for one Conventional Commits message for `diff`, cut to `maxChars`. */
export function commitPrompt(diff: string, maxChars: number): string {
  const cut = diff.length > maxChars
  let end = maxChars
  const last = diff.charCodeAt(end - 1)
  if (cut && last >= 0xd800 && last <= 0xdbff) end -= 1 // do not split a surrogate pair
  const body = cut ? `${diff.slice(0, end)}\n[diff truncated at ${maxChars} characters]` : diff
  return [
    'Write one Conventional Commits message for the following git diff.',
    'Format: "type(scope): subject" with the subject at most 72 characters; an optional body after a blank line.',
    'Reply with the commit message only: no code fences, no quotes, no explanation.',
    '',
    'Diff:',
    body,
  ].join('\n')
}

/**
 * Strips a leading "Commit message:", unwraps a fence only when the text starts with one (it closes at
 * the last fence, so a code block in the body stays whole; an unterminated fence runs to the end; fences
 * later in an unfenced body are kept), then strips surrounding quotes or backticks.
 */
export function cleanMessage(raw: string): string {
  let s = raw.trim().replace(/^commit message:\s*/i, '')
  const inline = /^```([^`\n]+)```$/.exec(s) // a fence on one line: ```feat: x```
  if (inline) s = (inline[1] ?? '').trim()
  const open = /^```[^\n]*\n/.exec(s)
  if (open) {
    const rest = s.slice(open[0].length)
    const close = rest.lastIndexOf('\n```')
    s = (close === -1 ? rest.replace(/\n?```\s*$/, '') : rest.slice(0, close)).trim()
  }
  const q = s[0]
  if (s.length >= 2 && (q === '"' || q === "'" || q === '`') && s.endsWith(q)) s = s.slice(1, -1)
  return s.trim()
}
