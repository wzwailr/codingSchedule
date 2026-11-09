# Third-party resources

Runtime dependencies are pinned in package-lock.json. The phase-one probe bundles MCP SDK server/client/core 2.4.0 and Zod 4.6.7 into its dedicated bridge script.

Preserved license resources:
- licenses/mcp-server-LICENSE.txt — copied byte-for-byte from @modelcontextprotocol/server 2.4.0.
- licenses/mcp-client-LICENSE.txt — copied byte-for-byte from @modelcontextprotocol/client 2.4.0.
- licenses/mcp-core-LICENSE.txt — copied byte-for-byte from @modelcontextprotocol/core 2.4.0.
- licenses/zod-LICENSE.txt — copied byte-for-byte from Zod 4.6.7.

The MCP texts contain the current licensing transition and retained contribution terms. The Node runtime download preserves its separate upstream LICENSE next to node.exe. See the root THIRD_PARTY_NOTICES.md.

Phase three selectively vendors CCAM commit 3cb22ae4a4e2ca31145351e1d73e05d0ff41f2dc: executable-call locator (verbatim), extracted bounded data-literal parser, and adapted message normalization. Exact source ranges, changes and local SHA-256 values are in origins.json; full MIT text is licenses/CCAM-MIT.txt. Local regression scenarios are in tests/adapters. The upstream full suite has not been run. Snapshot archiving, raw log cleanup and the upstream task reset/finalize reducer are excluded.

New bundled dependencies: smol-toml 1.9.1 and jsonc-parser 3.3.1, both MIT, with full texts in licenses/. The build selects jsonc-parser's ESM entry to produce a self-contained bundle.

Herdr/how-long/task-progress-reporter are design references, not copied runtime code. AgentHUD and Agent Island code/assets are not included.
