/** Recognize cancellation from our process/transport APIs, not ordinary Git failures. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted' || /(?:^|: )\$\.process\.(?:run|spawn)\([^()\r\n]+\) aborted\.?$/.test(error.message))
}
