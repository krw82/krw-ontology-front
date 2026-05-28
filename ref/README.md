# Reference Sources

`ref/plugins/<env>/krw-ontology` contains the env-specific Claude plugin bundle
used by local workers.

Runtime ontology data and indexes stay outside the front repo under
`~/krw-ontology-data/releases/<env>/current`. Python MCP server code and the
ontology CLI stay in `~/krw-ontology`.

The plugin bundles keep skills in this tree, while each `.mcp.json` points to
that env's long-running local HTTP MCP server:

- prod: `http://127.0.0.1:8765/mcp`
- dev: `http://127.0.0.1:8766/mcp`
