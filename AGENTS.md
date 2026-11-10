<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Tables: server-side by default

Base case for every table in this repo, new or redone:

- Build it with the data-table kit in `@gmd/ui` (`packages/ui/src/components/data-table/*`: `DataTable`, `useServerTable`, `Pagination`, `SearchField`, `FilterChips`). Reference implementation: Physical Stock (`packages/physical-stock`). Do not use or extend `GMDUpdateTable`.
- All data is server-side paginated. The client holds one page; it never loads the full set to page, sort, filter or search in the browser.
- Filters, search, sort and facets run on the server too. Facet (dropdown) options come from a server query under the other active filters, not from the rows on screen. Totals, KPI cards and charts are aggregated in SQL over the filtered set.
- Each page lives in its own package (`packages/<name>`): SQL page/facet functions in `src/server`, per-column rules in a column definition file, query state in a Redux Toolkit slice. The host app's Server Actions own auth and flags.
