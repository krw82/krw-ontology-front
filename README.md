# KRW Ontology Front

KRW Ontology의 웹 채팅/기업 브라우저 프론트엔드입니다. Next.js 앱이 Claude Agent SDK를 실행하고, 로컬 Claude plugin의 `.mcp.json`을 통해 KRW Ontology MCP를 stdio로 붙입니다.

## Architecture

```text
Browser
  -> Next.js /api/chat/run
  -> Claude Agent SDK
  -> local Claude plugin path
  -> plugin .mcp.json stdio MCP
  -> ~/krw-ontology package
  -> ~/krw-ontology-data indexes
```

운영은 현재 단일 VM을 명시적 전제로 둡니다. `abort-manager`와 local SDK session state는 다중 인스턴스 공유를 지원하지 않으므로, 수평 확장 전에는 Redis/DB 기반 cancel/reconnect 설계가 필요합니다.

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
  indexes/agent_index.sqlite
```

`krw-ontology/plugins/krw-ontology/.mcp.json`은 개발/운영에서 각각 올바른 `KRW_ONTOLOGY_ROOT`와 MCP command를 가리켜야 합니다.

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

전체 배포:

```bash
npm run deploy:all -- --replace-remote-data
```

기본 순서:

1. Supabase migration drift check
2. Supabase schema smoke test
3. data snapshot deploy
4. frontend/plugin/MCP source sync
5. Docker Compose build/restart
6. public and live MCP health checks

마이그레이션을 함께 적용해야 할 때만 명시적으로 실행합니다.

```bash
npm run deploy:all -- --apply-migrations --replace-remote-data
```

## Operations

운영 절차와 장애 대응은 [docs/OPERATIONS.md](docs/OPERATIONS.md)를 기준으로 합니다.
