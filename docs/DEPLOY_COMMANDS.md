# KRW Ontology Deploy Commands

이 문서는 운영자가 외워야 하는 명령어 UX를 기준으로 정리한다.

이 문서는 서버/Web 운영 명령어 기준이다. 장기 제품 구조의 macOS Desktop 앱은
별도 배포 단위이며, Desktop이 Web app의 agent run을 claim해서 실행하는 구조를
목표로 하지 않는다. Desktop/Web 제품 경계는
[`docs/DESKTOP_WEB_BOUNDARY.md`](./DESKTOP_WEB_BOUNDARY.md)를 기준으로 한다.

핵심 원칙은 세 가지다.

```text
1. dev/prod는 명령어 맨 앞에서 구분한다.
2. plugin + skills + Mac-local MCP + Mac workers는 runtime으로 묶는다.
3. ontology/index/catalog 전환은 data가 아니라 release로 부른다.
```

일반 production deploy는 agent-repo 12-stage forward-only controller로만
실행한다(`npm run prod:deploy:full`). 이 경로는 현재 서비스가 살아 있는
동안 새 GCP 이미지를 원격 빌드하고, admission 게이트를 닫았다 열며 전 단계에
receipt를 남긴다. 전환 실패 시 되돌리기는 존재하지 않고 fix-forward로만
재실행한다.

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
  Mac-local prod/dev MCP HTTP server (GCP sidecar 없음)
  Mac rust agent daemon (launchd com.krw.agentd)

release
  immutable ontology release directory
  manifest.json
  indexes/global_spine.sqlite
  indexes/shard_manifest.json
  indexes/companies/<TICKER>.sqlite
  Supabase web catalog publish
```

GCP web은 full SQLite index를 직접 읽지 않고 ontology MCP/agent sidecar도
실행하지 않는다. Web은 Supabase의 compact catalog만 보고, full SQLite index와
agent execution은 Mac MCP/worker runtime만 담당한다.

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

dev plugin/skills를 다시 materialize하고 Mac-local dev MCP 서비스를 재시작한다.
prod MCP나 prod workers는 건드리지 않는다.

```bash
npm run dev:release:publish -- --release-id <release_id>
```

dev release를 `dev/current`로 전환하고, 해당 release에서 web catalog를
export해서 local Supabase에 publish한다. full SQLite index는 local dev
release root에만 남는다.

`dev:release`는 같은 명령의 짧은 alias다.

### Production code

배포 전의 느린 로컬 검증은 필요할 때 별도로 실행한다.

```bash
npm run prod:preflight
```

이 명령은 typecheck, lint, unit/build, Desktop 계약, production-mode
browser/PWA 검증을 수행한다. 일반 배포 명령은 이 검증을 다시 실행하지 않는다.

```bash
npm run prod:deploy:full -- --agent-provider deepseek
```

production 코드 배포의 유일한 경로다. legacy fast script
(`scripts/deploy-production-fast.sh`)와 부분 전환 변형들
(`prod:deploy:web` / `prod:deploy:runtime` / `prod:deploy:mac-runtime` /
`prod:deploy:code` / `prod:deploy:safe`)은 삭제됐다. 무엇을 어디까지
전환할지 고르는 대신, 12-stage forward-only controller가 항상 전체
(DB migration, GCP web/API/workers, sealed Rust agent daemon, local MCP
gateway)를 검증하며 배포한다:

```text
canonical Supabase/GCP target 검증
-> exact source commit release build + seal
-> forward-only migration apply
-> admission close -> Mac daemon activation -> GCP 원격 빌드/전환
-> deep readiness -> admission open -> terminal success receipt
```

실패하면 중단 지점까지의 receipt와 admission 상태(closed)를 남기고
fix-forward로만 재실행한다. 컨테이너 자동 되돌리기나 migration 되돌리기는
존재하지 않는다. schema rollback이 필요한 변경은 별도 migration으로
처리해야 한다.

### Production release

```bash
npm run publish:web-catalog
```

현재 활성 release의 compact catalog만 다시 게시하는 경로다. 다른 release를
`prod/current`로 바꾸는 cross-release promotion은 아직 자동화하지 않았으며
fail-closed된다.

```text
active release verify
-> export web_catalog.json
-> publish active catalog to Supabase
```

이 명령은 v3 SQLite indexes를 GCP로 올리지 않는다. global spine과 company
shards는 Mac의 `~/krw-ontology-data/releases/prod/current/indexes/`에 남고,
GCP web/API는 Supabase catalog만 본다.

### Full production deploy

```bash
npm run prod:deploy:full
```

가장 넓은 일반 배포 명령이다.

```text
새 GCP image build (현재 runtime 계속 서비스)
-> Supabase migration apply + schema smoke
-> GCP web/API + application workers switch
-> sealed Rust agent daemon + local MCP gateway activation
```

DB migration, web code, Rust agent runtime을 함께 반영할 때 쓴다. Catalog publication은
ontology source/data identity를 검증하는 별도 `publish:web-catalog` 명령으로 남긴다.
SQLite release의 `prod/current` pointer를 다른 release로 promote하지는 않는다. Redis는
persistent service로 유지되고, document worker, outbox dispatcher, filing/billing worker는
새 image로 재생성된다.

### Legacy sealed bootstrap / interrupted-cutover recovery (removed)

과거의 one-time immutable Mac bootstrap(`npm run prod:deploy:bootstrap`)과
interrupted-cutover recovery(`npm run prod:deploy:recover`) 경로는 legacy
sealed cutover orchestrator와 함께 삭제됐다. production 배포는 fix-forward
원칙으로만 처리한다.

- `npm run prod:deploy:bootstrap`은 이제 안내 메시지와 함께 거부만 한다.
- activation 전에 만들어진 미사용 candidate 정리만 필요하면
  `scripts/deploy-production-simple.sh --recover-prepared-local-only`를 쓴다.
- 일상 배포는 `npm run prod:deploy:full`만 사용한다.

### Planning without mutation

```bash
~/krw-agnet/target/release/krw-agent-deploy \
  --config ~/krw-agnet-prod/config/production-config-deepseek.json dry-run
```

controller의 read-only dry-run이 canonical target, GCP instance identity,
pending migration과 release 계획을 receipt로 남긴다. GCP upload,
Docker/launchd mutation, migration apply는 하지 않는다.

### Production status

```bash
npm run prod:status
```

현재 활성 Mac runtime의 `runtime.env`를 찾아 MCP fingerprint, filings MCP와
GCP Compose 상태를 확인한다. agent 실행은 러스트 데몬(launchd
`com.krw.agentd`) 토폴로지로 운영된다.

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

5. Prod candidate 보관

검증된 candidate는 immutable release directory에 보관한다. 현재 production
orchestrator는 다른 release로의 atomic `prod/current` promotion을 의도적으로
거부한다. symlink를 수동 변경하거나 `publish:web-catalog`로 우회하지 않는다.

현재 active release의 catalog 재게시만 필요하면 다음을 실행한다.

```bash
cd ~/krw-ontology-front
npm run publish:web-catalog
```

### Production billing

Toss live keys are secret runtime config and must stay only in the production VM
env file, not in git:

```text
TOSS_PAYMENTS_CLIENT_KEY=live_ck_...
TOSS_PAYMENTS_SECRET_KEY=live_sk_...
ANALYSIS_CREDIT_ENFORCEMENT_MODE=enforced
```

VM env 변경은 독립 restart로 반영하지 않는다. 다음 sealed code cutover에
포함한 뒤 paid billing readiness gate를 실행한다.

```bash
npm run prod:deploy:full -- --agent-provider deepseek
npm run billing:prod:readiness
```

## MCP And Worker Operations

결제를 포함한 일상 배포에서는 `prod:deploy:full`과 `prod:status`를 쓴다.
Mac-local 서비스 조정도 배포와 함께 controller가 처리한다. 낮은 수준의
확인이 필요할 때는 아래 명령어를 쓴다.

```bash
npm run mcp:prod:status
npm run mcp:prod:logs
npm run mcp:prod:launchd:install
npm run mcp:prod:launchd:uninstall
```

Mac-local prod MCP 서비스 명령어다. 기본 포트는 `8765`다.

```bash
npm run mcp:dev:status
npm run mcp:dev:logs
npm run mcp:dev:launchd:install
npm run mcp:dev:launchd:uninstall
```

Mac-local dev MCP 서비스 명령어다. 기본 포트는 `8766`이다.

### Mac agent worker (RETIRED)

`worker:mac:preflight` / `worker:mac:start` / `worker:mac:launchd:install`은
2026-08-19 레거시 엔진 은퇴와 함께 제거되었다. 남은 명령: 언인스톨은
`npm run worker:mac:launchd:uninstall`, env 초기화는 `npm run worker:mac:init-env`,
운영 상태는 `npm run prod:status`.

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

`prod:deploy:full`(12-stage controller)은 migration dry-run 후 pending
migration을 적용하고 schema smoke을 수행한다. migration 적용 경로는 이 하나뿐이다.

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

legacy fast script과 그 alias들은 삭제됐다(2026-08-16, controller 배포
검증 완료 후). 남은 배포 관련 alias는 아래뿐이다.

```text
deploy:prod:full        -> prod:deploy:full
deploy:all              -> prod:deploy:full
deploy:runtime:dev      -> dev:runtime
dev:data                -> dev:release:publish
dev:catalog             -> dev:release:publish
```

## Retired GCP Sidecar

GCP ontology MCP와 GCP agent worker sidecar는 운영 토폴로지에서 제거됐다.
관련 Dockerfile, Compose service, npm alias는 제공하지 않는다. production agent
execution과 ontology MCP는 항상 Mac launchd runtime에서만 실행한다.

## Decision Table

```text
로컬 개발 서버를 띄운다
  npm run dev

dev MCP/plugin만 갱신한다
  npm run dev:runtime

dev catalog만 local Supabase에 publish한다
  npm run dev:release:publish -- --release-id <release_id>

production 배포를 한다 (코드/마이그레이션/Mac runtime 전체)
  npm run prod:deploy:full -- --agent-provider deepseek

현재 active release catalog를 다시 게시한다
  npm run publish:web-catalog

상태를 본다
  npm run prod:status
```
