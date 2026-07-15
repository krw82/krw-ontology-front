# KRW Ontology Deploy Commands

이 문서는 운영자가 외워야 하는 명령어 UX를 기준으로 정리한다.

이 문서는 서버/Web 운영 명령어 기준이다. 장기 제품 구조의 macOS Desktop 앱은
별도 배포 단위이며, Desktop이 Web app의 agent run을 claim해서 실행하는 구조를
목표로 하지 않는다. Desktop/Web 제품 경계는
[`docs/DESKTOP_WEB_BOUNDARY.md`](./DESKTOP_WEB_BOUNDARY.md)를 기준으로 한다.

핵심 원칙은 세 가지다.

```text
1. dev/prod는 명령어 맨 앞에서 구분한다.
2. plugin + skills + MCP sidecar + Mac workers는 runtime으로 묶는다.
3. ontology/index/catalog 전환은 data가 아니라 release로 부른다.
```

기존 `deploy:*` 명령어는 호환용으로 남겨둔다. 새 작업에서는 아래의
`dev:*`, `prod:*`, `legacy:*` 명령어를 우선 사용한다.

## Mental Model

운영 시스템은 세 덩어리로 나뉜다.

```text
web
  GCP Next.js web/API
  Supabase queue enqueue
  Supabase web catalog read

runtime
  local plugin files
  local skills
  prod/dev MCP HTTP sidecar
  Mac agent worker bundle/processes

release
  immutable ontology release directory
  manifest.json
  indexes/global_spine.sqlite
  indexes/shard_manifest.json
  indexes/companies/<TICKER>.sqlite
  Supabase web catalog publish
```

GCP web은 full SQLite index를 직접 읽지 않는다. Web은 Supabase의 compact
catalog만 보고, full SQLite index는 Mac MCP/worker runtime만 읽는다.

## Daily Commands

### Local development

```bash
npm run dev
```

Next dev server와 dev agent worker를 같이 띄운다. 기본 dev MCP는
`http://127.0.0.1:8766/mcp`이고, dev plugin은
`ref/plugins/dev/krw-ontology`를 사용한다.

```bash
npm run dev:runtime
```

dev plugin/skills를 다시 materialize하고 dev MCP sidecar를 재시작한다.
prod MCP나 prod workers는 건드리지 않는다.

```bash
npm run dev:release:publish -- --release-id <release_id>
```

dev release를 `dev/current`로 전환하고, 해당 release에서 web catalog를
export해서 local Supabase에 publish한다. full SQLite index는 local dev
release root에만 남는다.

`dev:release`는 같은 명령의 짧은 alias다.

### Production code

```bash
npm run prod:deploy:web
```

GCP web/API만 배포한다. Mac runtime과 ontology release는 건드리지 않는다.

```bash
npm run prod:deploy:runtime
```

prod plugin/skills를 materialize하고, prod MCP sidecar를 재시작한 뒤, Mac
production workers를 재시작한다. GCP web/API는 배포하지 않는다.

```bash
npm run prod:deploy:code
```

평소 코드 배포 경로다.

```text
Supabase migration dry-run
-> schema smoke
-> GCP web/API deploy
-> prod runtime deploy
```

ontology release, prod/current, Supabase web catalog는 바꾸지 않는다.

### Production release

```bash
npm run prod:release:publish -- --release-id <release_id>
```

운영 ontology/index/catalog release 전환 경로다.

```text
optional prod/current promote
-> release verify
-> export web_catalog.json
-> publish active catalog to Supabase
-> restart prod MCP sidecar
-> restart Mac production workers
-> verify worker heartbeat release_id
```

이 명령은 v3 SQLite indexes를 GCP로 올리지 않는다. global spine과 company
shards는 Mac의 `~/krw-ontology-data/releases/prod/current/indexes/`에 남고,
GCP web/API는 Supabase catalog만 본다.

### Full production deploy

```bash
npm run prod:deploy:full -- --release-id <release_id>
```

가장 큰 작업이다.

```text
Supabase migration apply
-> prod release publish
-> GCP web/API + Redis document queue deploy
-> document-worker + document-outbox-dispatcher restart
-> prod runtime deploy
```

DB migration, ontology release, web code, runtime code가 모두 바뀌는 경우에만
쓴다. 문서 ingestion은 GCP compose의 persistent Redis service와 BullMQ
`document-worker`, `document-outbox-dispatcher`를 같이 올린다.

document-ingestion claim-token migration이 pending이면 배포 스크립트는 먼저
`scripts/drain-document-workers-for-migration.sh`로 원격
`document-worker`와 `document-outbox-dispatcher`를 중지·검증한 뒤 DB migration을
적용한다. 이 구간에는 이전 worker를 수동으로 다시 시작하지 않는다. migration
직후 compose 배포가 v2 worker를 다시 시작한다. 이 migration은 `--skip-code`와
함께 적용할 수 없다.

### Safe production deploy

```bash
npm run prod:deploy:safe -- --release-id <release_id> --apply-migrations
```

local ontology queue를 잠깐 멈춘 뒤 전체 배포하고 다시 시작하는 경로다.
queue writer와 prod release 전환이 겹칠 위험이 있을 때 사용한다.

### Production status

```bash
npm run prod:status
```

prod MCP health와 prod Mac worker heartbeat 상태를 확인한다.

## Ontology Release Build Flow

release를 만드는 작업은 `krw-ontology-front`가 아니라
`~/krw-ontology`에서 한다.

```bash
cd ~/krw-ontology
```

1. 실행 전 build plan 확인

```bash
uv run krw-ontology release plan
```

이 명령은 source와 cache를 읽어 dirty/cached ticker와 v3 build DAG를 보여주지만
release output은 쓰지 않는다.

2. 필요한 source/queue 작업 실행

```bash
uv run krw-ontology queue add AAPL NVDA TSLA
uv run krw-ontology queue update AAPL --document-type 10-Q --latest
uv run krw-ontology queue start
uv run krw-ontology queue status
uv run krw-ontology queue watch
```

queue에서 v3 index refresh를 하지 않으려면 `--no-refresh-index`를 명시한다.

3. 새 immutable dev v3 release 생성

```bash
uv run krw-ontology release force
uv run krw-ontology release watch
uv run krw-ontology quality check
```

`release force`는 company shard와 spine fragment cache를 재사용할 수 있으며,
global spine merge, manifest v3 작성, deep verification, `dev/current` atomic
promote를 수행한다.

4. Prod release materialize

```bash
uv run krw-ontology release materialize-prod <release_id>
```

검증된 dev v3 release를 prod release space로 복사한다. 이 단계는 아직
`prod/current`를 바꾸지 않는다.

5. Prod publish

```bash
cd ~/krw-ontology-front
npm run prod:release:publish -- --release-id <release_id>
```

이 단계에서만 prod/current, Supabase web catalog, prod MCP, prod workers가
같은 release로 전환된다.

### Production billing

Toss live keys are secret runtime config and must stay only in the production VM
env file, not in git:

```text
TOSS_PAYMENTS_CLIENT_KEY=live_ck_...
TOSS_PAYMENTS_SECRET_KEY=live_sk_...
ANALYSIS_CREDIT_ENFORCEMENT_MODE=enforced
```

After changing the VM env, restart the GCP compose services and run the paid
billing readiness gate:

```bash
scripts/restart-production-compose.sh
npm run billing:prod:readiness
```

## MCP And Worker Operations

일상 운영에서는 `prod:deploy:runtime`과 `prod:status`만 외우면 된다. 낮은
수준의 확인이 필요할 때는 아래 명령어를 쓴다.

```bash
npm run mcp:prod:status
npm run mcp:prod:logs
npm run mcp:prod:launchd:install
npm run mcp:prod:launchd:uninstall
```

prod MCP sidecar 명령어다. 기본 포트는 `8765`다.

```bash
npm run mcp:dev:status
npm run mcp:dev:logs
npm run mcp:dev:launchd:install
npm run mcp:dev:launchd:uninstall
```

dev MCP sidecar 명령어다. 기본 포트는 `8766`이다.

```bash
npm run worker:mac:preflight
npm run worker:prod:status
npm run worker:mac:launchd:install
npm run worker:mac:launchd:uninstall
```

prod Mac worker preflight/status/launchd 명령어다.

## Supabase

```bash
npm run supabase:db:push:dry
npm run supabase:db:push
npm run supabase:schema:smoke
```

Supabase CLI는 `scripts/supabase-cli.sh`를 통해 실행한다. 이 wrapper는
`SUPABASE_CLI`, local `node_modules/.bin`, PATH, `$HOME/.local/bin`, Homebrew
경로 순서로 CLI를 찾는다. `npx supabase`는 darwin-arm64 native package
해결이 불안정할 수 있어 배포 경로에서 직접 사용하지 않는다.

`prod:deploy:code`는 migration dry-run만 수행한다.
`prod:deploy:full`은 `--apply-migrations`가 포함되어 migration을 실제 apply한다.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run check
```

`check`는 typecheck, lint, unit test, build를 모두 실행한다.

## Compatibility Aliases

아래 명령어들은 기존 사용 습관과 자동화 호환을 위해 남겨둔다. 새 문서와 새
운영 습관에서는 `dev:*`, `prod:*`, `legacy:*` 이름을 우선한다.

```text
deploy:web              -> prod:deploy:web
deploy:runtime          -> prod:deploy:runtime
deploy:runtime:prod     -> prod:deploy:runtime
deploy:mcp              -> prod:deploy:runtime
deploy:plugin           -> prod:deploy:runtime
deploy:prod             -> prod:deploy:code
deploy:prod:code        -> prod:deploy:code
deploy:prod:full        -> prod:deploy:full
deploy:data             -> prod:release:publish
deploy:safe             -> prod:deploy:safe
dev:data                -> dev:release:publish
dev:catalog             -> dev:release:publish
deploy:runtime:dev      -> dev:runtime
```

## Legacy GCP Plugin Command

정상 운영에서는 Mac worker가 production agent execution을 담당한다. 아래 명령은
예전 GCP MCP/plugin 배포용이다. GCP ontology data upload 경로는 삭제되었다.

```bash
npm run legacy:gcp-mcp
```

GCP plugin 호환용 이름:

```bash
npm run deploy:legacy:gcp-mcp
npm run deploy:plugin:gcp
```

## Decision Table

```text
로컬 개발 서버를 띄운다
  npm run dev

dev MCP/plugin만 갱신한다
  npm run dev:runtime

dev catalog만 local Supabase에 publish한다
  npm run dev:release:publish -- --release-id <release_id>

GCP web/API만 올린다
  npm run prod:deploy:web

prod plugin/skills/MCP/workers만 재시작한다
  npm run prod:deploy:runtime

평소 코드 배포를 한다
  npm run prod:deploy:code

prod ontology/index/catalog release를 바꾼다
  npm run prod:release:publish -- --release-id <release_id>

DB migration, release, web, runtime을 모두 바꾼다
  npm run prod:deploy:full -- --release-id <release_id>

상태를 본다
  npm run prod:status
```
