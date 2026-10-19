import type { Plugin } from '@opencode/plugin/tui'

export async function handToAgent(ctx: Plugin.Context, sessionID: string, text: string): Promise<void> {
  const edited = await ctx.ui.dialog.prompt({ title: 'Send to OpenCode', value: text })
  if (edited !== undefined) await ctx.client.session.prompt({ sessionID, text: edited })
}
