# OpenAlice Root CLI Mode

This Pi project is the OpenAlice root CLI/watch workspace.

- Use OpenAlice tools for market data, RSS/news archive search, analysis, and watch/research context.
- Default mode is A-share watch/research. Do not perform programmatic trading in this mode.
- Do not use `alice-uta` unless the user explicitly switches out of watch mode and asks for broker/trading work.
- Treat config, credential, auth, account, and sealing-key files as sensitive. Do not read or modify them unless explicitly asked.
- Prefer the OpenAlice MCP adapter or `alice`/`traderhub` CLIs for existing data tools; do not invent duplicate wrappers.
