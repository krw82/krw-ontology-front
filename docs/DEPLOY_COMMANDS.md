# KRW Ontology Deploy Commands

이 문서는 운영자가 외워야 하는 명령어 UX를 기준으로 정리한다.

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
  indexes/agent_index.sqlite
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

이 명령은 full SQLite index를 GCP로 올리지 않는다. full index는 Mac의
`~/krw-ontology-data/releases/prod/current/indexes/agent_index.sqlite`에
남고, GCP web/API는 Supabase catalog만 본다.

### Full production deploy

```bash
npm run prod:deploy:full -- --release-id <release_id>
```

가장 큰 작업이다.

```text
Supabase migration apply
-> prod release publish
-> GCP web/API deploy
-> prod runtime deploy
```

DB migration, ontology release, web code, runtime code가 모두 바뀌는 경우에만
쓴다.

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

1. 새 dev release 작업 공간 준비

```bash
uv run krw-ontology release prepare-dev <release_id>
```

이 명령은 새 dev release workspace를 만들고 queue publish target을 그쪽으로
돌린다.

2. Queue 작업 실행

```bash
uv run krw-ontology queue add AAPL NVDA TSLA
uv run krw-ontology queue update AAPL --document-type 10-Q --latest
uv run krw-ontology queue start
uv run krw-ontology queue status
uv run krw-ontology queue watch
```

queue는 기본적으로 `agent_index.sqlite`를 자동 rebuild하지 않는다.

3. Dev release finalize

```bash
uv run krw-ontology release finalize-dev <release_id>
```

이 명령은 agent index rebuild, manifest 작성, release verify,
`dev/current` promote, publish-root config 정리를 수행한다.

4. Prod release materialize

```bash
uv run krw-ontology release materialize-prod <release_id>
```

검증된 dev release를 prod release space로 복사한다. 이 단계는 아직
`prod/current`를 바꾸지 않는다.

5. Prod publish

```bash
cd ~/krw-ontology-front
npm run prod:release:publish -- --release-id <release_id>
```

이 단계에서만 prod/current, Supabase web catalog, prod MCP, prod workers가
같은 release로 전환된다.

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

## Legacy Commands

정상 운영에서는 Mac worker가 production agent execution을 담당한다. 아래는
예전 GCP MCP/data sync용이다.

```bash
npm run legacy:gcp-mcp
npm run legacy:data-gcp
```

호환용 이름도 남아 있다.

```bash
npm run deploy:legacy:gcp-mcp
npm run deploy:legacy:data-gcp
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

