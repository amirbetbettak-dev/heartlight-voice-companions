<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Voice calls go through `src/lib/live-relay.server.ts` (dispatched from `src/server.ts`, dev via `live-vite-plugin.ts`); the relay verifies the user token from `app.start` before opening a paid session and saves transcripts on close — keeps calls restricted and transcripts server-owned.
- Each persona has its own conversations (`conversations`, `messages.conversation_id`); `/talk?c=<id>` is the active conversation, and text chat (`/api/chat`) and voice both take that id and load history from the database, never trusting client history or a client-sent persona.
- Persona prompts, voices and openings live only in `src/lib/personas.ts`; each opening variant must stay under 480 UTF-8 bytes (relay append limit).
- Long-term memory is one AI-maintained summary per user (`user_memory`), refreshed by `refreshMemory` using `updated_at` as the message watermark.
- PWA is manifest-only (no service worker) — installability without stale-cache risk.
- Sign-in methods: Google, phone SMS code, and anonymous guest; any `authenticated` user (including guests) can use the app, so RLS must scope by `auth.uid()` rather than by sign-in method.
- Tokens derived from `--glow` are re-declared under `[data-persona]` in styles.css, because custom properties resolve `var()` where they are declared.
