import type { Register } from 'claude-code'
import { VERSION } from '../core/version.ts'

// Wiring only. The pane and its hooks arrive with the Claude Code adapter.
export const register: Register = _on => {
  void VERSION
}
