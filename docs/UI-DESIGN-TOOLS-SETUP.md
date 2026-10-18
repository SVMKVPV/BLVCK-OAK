# BLVCK OAK — UI design developer tooling

These are **developer-only tools**, not website runtime dependencies. Do not insert their API keys into frontend JavaScript, commit credentials, or enable the MCP server in production Netlify functions.

## UI UX Pro Max (nextlevelbuilder)

Original repository: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

From your local BLVCK-OAK checkout, with Node.js/npm and Python 3.x available:

```powershell
npx ui-ux-pro-max-cli init --ai codex
```

For GitHub Copilot in VS Code instead:

```powershell
npx ui-ux-pro-max-cli init --ai copilot
```

This installs a skill into your **local coding agent setup**. It is not installed merely by adding this document to GitHub. See the upstream README for updating/uninstalling.

## Magic MCP → 21st MCP

Original repository: https://github.com/21st-dev/magic-mcp

The legacy `@21st-dev/magic` package is now a compatibility proxy. Use the successor **21st MCP**: https://21st.dev/mcp

From your local BLVCK-OAK checkout:

```powershell
npx @21st-dev/cli@latest init --client vscode
```

For Codex CLI use `--client codex`. Supported choices also include cursor, claude, and windsurf.

The server requires a fresh 21st.dev API key from https://21st.dev/mcp. Supply the key through the coding client’s secure local configuration or environment (such as `API_KEY_21ST`); do **not** commit it. Old Magic API keys no longer work.

Whether hosted AI generation is enabled depends on your 21st account. Component search and generation availability are not guaranteed just by configuring the server.

## BLVCK OAK compatibility rules

- Keep existing black/gold brand, tree animation, site behavior, and responsive layout unchanged unless specifically requested.
- Prefer using either tool for editor-assisted design and generated source files, reviewing proposed changes before deploying.
- Never expose MCP credentials in the public repository, frontend, or Netlify static output.
- After installing locally, restart the coding assistant and verify that the skill / 21st MCP tools are listed.
- Run the existing project tests before merging generated changes.
