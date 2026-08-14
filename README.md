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
Node @anthropic-ai/claude-agent-sdk: 0.3.204
Python claude-agent-sdk: 0.2.85
Claude Code native binary: 2.1.204
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

`prod:deploy:web`은 GCP web/API와 stateless support worker만, `prod:deploy:runtime`은
Mac MCP/agent runtime만 갱신합니다. runtime 배포는 새 버전 경로에 Ontology plugin을
동일 소스에서 materialize한 뒤 MCP fingerprint와 worker heartbeat를 검증하고, 둘 중
하나라도 실패하면 active runtime 전환을 중단합니다. 둘을 함께 반영할 때는
`prod:deploy:code`를 사용합니다. GCP ontology MCP/agent sidecar는 운영하지 않습니다.

현재 prod/current의 web catalog만 재게시:

```bash
npm run prod:release:publish
```

전체 배포:

```bash
npm run prod:deploy:full
```

`prod:deploy:full`은 DB schema, web, 그리고 sealed Rust agent release를 함께
전환하지만 ontology catalog를 재발행하지는 않는다. catalog publication은 ontology
source/data release 자체를 검증하는 별도 작업이므로, 실제 catalog 변경이 있을 때만
`npm run prod:release:publish`를 명시적으로 실행한다.

서로 다른 ontology release를 `prod/current`로 승격하는 자동 경로는 현재
fail-closed입니다. `--release-id`는 이미 current인 ID만 허용합니다. 운영자가
symlink를 수동 변경하지 말고, candidate release·plugin·worker를 함께 seal하는
전용 cutover가 구현되기 전에는 기존 current를 유지합니다.

## Production 13F Refresh

13F 최신 보고서를 production DB에 반영할 때는 GCP VM의 호스트에서 `npm run 13f`를
직접 실행하지 않는다. VM 호스트에는 Node만 있고 npm이 없으며, production image에는
원본 `scripts/` 디렉터리가 포함되지 않는다. 대신 active release의 `scripts/`와 `src/`를
읽기 전용으로 production image에 연결하고, active release의 `runtime.env`를 사용한다.

최신 보고 기간 1개씩을 15개 등록 매니저에 반영하는 명령은 다음과 같다.

```bash
gcloud compute ssh krw-onto-v3 \
  --project=project-98c109e3-2546-4786-bac \
  --zone=asia-northeast3-a \
  --command='docker run --rm \
    --network container:krw-ontology-front-web-1 \
    --env-file /home/username/krw-ontology-front/.simple-deploy/current/runtime.env \
    -v /home/username/krw-ontology-front/.simple-deploy/current/scripts:/app/scripts:ro \
    -v /home/username/krw-ontology-front/.simple-deploy/current/src:/app/src:ro \
    -w /app \
    krw-ontology-front-web:local \
    node scripts/refresh-sec-13f.mjs --limit 1'
```

`--limit 1`은 매니저 1개가 아니라 각 매니저의 최신 보고 기간 1개를 의미한다. 성공하면
`[saved:pg]` 로그와 `SEC 13F refresh complete. Saved ... filing(s).`가 출력된다.

DB에 쓰지 않고 SEC 조회와 파싱만 확인하려면 마지막 인자를 다음처럼 바꾼다.

```text
node scripts/refresh-sec-13f.mjs --limit 1 --dry-run
```

이 명령은 `/home/username/krw-ontology-front/.simple-deploy/current/runtime.env`
을 사용하므로 `.env.production`을 source하지 않는다. `npm run 13f`는 로컬 또는 npm이
설치된 개발 환경의 alias이며, production VM에서 `gcloud npm run 13f`처럼 실행하는
명령은 아니다. `...`를 명령에 그대로 넣어도 안 된다.

## Operations

운영 절차와 장애 대응은 [docs/OPERATIONS.md](docs/OPERATIONS.md)를 기준으로 합니다.
