# KRW Ontology Front

KRW Ontology의 웹 제품과 서버 API입니다. 장기 제품 구조에서는 Web app과
Desktop app을 분리하고, 이 저장소는 인증, 과금, catalog, ontology search
API, chat/session/artifact 저장 같은 서버 쪽 control/data plane을 담당합니다.

Desktop app은 별도 macOS 앱/로컬 런타임으로 배포합니다. Desktop API는
server-issued desktop device token만 받으며, 일반 Web session/Supabase bearer
token을 Desktop API 인증으로 사용하지 않습니다.

## Architecture

```text
Web product
  Browser
    -> Next.js web/API
    -> server-side auth, billing, chat/session/artifact storage
    -> server-side ontology/news/indicator services

Desktop product
  KRW Desktop for macOS
    -> local agent/LLM/MCP proxy runtime
    -> /api/desktop/* with desktop device tokens
    -> server-side ontology search API
```

온톨로지 데이터, 인덱스, release metadata, 뉴스 후보 cache, 지표 store는
서버가 관리합니다. 사용자 PC는 full ontology SQLite/index를 내려받지 않고,
agent/LLM 실행과 thin MCP proxy만 담당합니다.

새 Desktop/Web 경계의 상세 설계는
[docs/DESKTOP_WEB_BOUNDARY.md](docs/DESKTOP_WEB_BOUNDARY.md)를 기준으로 합니다.

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
