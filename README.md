# KRW Ontology Front

KRW Ontology의 웹 채팅/기업 브라우저 프론트엔드입니다. GCP web/API는
Supabase queue/catalog를 다루고, 실제 agent execution과 full SQLite
ontology index 접근은 Mac runtime이 담당합니다.

## Architecture

```text
Browser
  -> Next.js /api/chat/run
  -> Supabase queue/catalog
  -> Mac agent workers
  -> local Claude plugin path
  -> prod/dev MCP HTTP sidecar
  -> ~/krw-ontology-data/releases/<env>/current
```

GCP web/API는 full ontology SQLite index를 직접 읽지 않습니다. Web이 보는
데이터는 Supabase의 compact web catalog이고, full index는 Mac MCP/runtime만
읽습니다.

## Local Development

```bash
npm install
npm run verify:sdk-freeze
npm run dev
```

기본 개발 주소는 [http://localhost:3000](http://localhost:3000)입니다. 보호 화면 E2E는 개발 인증 우회를 사용합니다.

```bash
npm run test:e2e
```

## Required Local Sources

프론트 배포는 `~/krw-ontology`를 canonical source로 사용합니다.

```text
~/krw-ontology
  pyproject.toml
  src/krw_ontology
  ontology
  plugins/krw-ontology

~/krw-ontology-data
  releases/dev/current
  releases/prod/current
```

`ref/plugins/dev/krw-ontology/.mcp.json`은 dev MCP `8766`을,
`ref/plugins/prod/krw-ontology/.mcp.json`은 prod MCP `8765`를 가리켜야 합니다.

## Checks

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run supabase:db:push:dry
npm run supabase:schema:smoke
```

`npm run check`는 타입, lint, unit, build를 묶어 실행합니다.

## SDK Freeze

Claude Agent SDK는 의도적으로 고정합니다.

```text
Node @anthropic-ai/claude-agent-sdk: 0.2.141
Python claude-agent-sdk: 0.2.85
Claude Code native binary: 2.1.141
```

업데이트는 별도 브랜치에서 SDK 회귀 테스트와 운영 smoke를 통과한 뒤에만 진행합니다. 일반 배포 중 자동 업그레이드는 금지합니다.

## Production Deploy

자세한 명령어 기준은 [docs/DEPLOY_COMMANDS.md](docs/DEPLOY_COMMANDS.md)에
있습니다. 새 자동화와 수동 작업은 `dev:*`, `prod:*`, `legacy:*` 이름을
우선 사용합니다.

평소 코드 배포:

```bash
npm run prod:deploy:code
```

Prod runtime만 갱신:

```bash
npm run prod:deploy:runtime
```

Prod ontology/index/catalog release 전환:

```bash
npm run prod:release:publish -- --release-id <release_id>
```

전체 배포:

```bash
npm run prod:deploy:full -- --release-id <release_id>
```

## Operations

운영 절차와 장애 대응은 [docs/OPERATIONS.md](docs/OPERATIONS.md)를 기준으로 합니다.
