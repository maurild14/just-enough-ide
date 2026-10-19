/** Prompt asking for one Conventional Commits message for `diff`, cut to `maxChars`. */
export function commitPrompt(diff: string, maxChars: number): string {
  const cut = diff.length > maxChars
  const body = cut ? `${diff.slice(0, maxChars)}\n[diff truncated at ${maxChars} characters]` : diff
  return [
    'Write one Conventional Commits message for the following git diff.',
    'Format: "type(scope): subject" with the subject at most 72 characters; an optional body after a blank line.',
    'Reply with the commit message only: no code fences, no quotes, no explanation.',
    '',
    'Diff:',
    body,
  ].join('\n')
}

/** Strips code fences, a leading "Commit message:", and surrounding quotes or backticks. */
export function cleanMessage(raw: string): string {
  let s = raw.trim()
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(s)
  if (fence) s = (fence[1] ?? '').trim()
  s = s.replace(/^commit message:\s*/i, '')
  const q = s[0]
  if (s.length >= 2 && (q === '"' || q === "'" || q === '`') && s.endsWith(q)) s = s.slice(1, -1)
  return s.trim()
}
