import { Rpc } from '@opencode/plugin'

// Shared server <-> TUI contract. Methods arrive in Tasks 13-15.
export const JeiRpc = Rpc.define({ id: 'jei', methods: {}, events: {} })
