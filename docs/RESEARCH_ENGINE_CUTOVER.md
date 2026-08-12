# Agent V1 연구 엔진 전환

이 front 저장소는 `krw-agent` bundle을 빌드하지 않는다. release host에서 봉인된
provider bundle을 설치한 뒤 이 앱을 그 공개 descriptor와 DB ABI에 연결한다.

## 배포 순서

1. `krw-agent`에서 한 번의 Rust/Image build로 `glm`과 `deepseek` bundle을 생성한다.
2. 두 bundle 각각에 실제 binding/endpoint, descriptor, authorization/trust를 넣고
   offline verifier를 통과시킨다.
3. GLM과 DeepSeek를 각각 선택해 같은 quality corpus와 same-session follow-up을
   실행한다. 두 acceptance report가 없으면 production admission을 열지 않는다.
4. front의 `@krw-agent/host` vendor tgz를 agent release commit/tree provenance와
   동기화하고 lockfile/hash preflight를 통과시킨다.
5. 선택한 bundle을 이 Mac의
   `~/.local/share/krw-agent/current` 원자 symlink로 설치하고 user-level
   `launchd`의 `com.krw.agentd`를 재시작한다. Rust daemon은 시작 직후와 이후 30초마다
   provider·descriptor hash를 포함한 자기 heartbeat를 공유 DB에 직접 기록한다.
6. 이 앱과 `agent-v1-outbox`를 GCP에 새 이미지로 배포한다. GCP에는 Rust binary,
   AgentImage, provider key를 올리지 않고 선택한 `public-release.json` 한 파일과
   그 hash만 mount한다. DB migration/compatibility, descriptor hash,
   provider/model, TLS, deep health를 확인한다.
7. 처음에는 `KRW_AGENT_ADMISSION_MODE=closed`로 시작한다. private canary와
   durable terminal projection을 확인한 뒤에만 `open`으로 바꾼다.

마지막에는 front commit, host package provenance, DB compatibility, GLM/DeepSeek
acceptance, DeepSeek product canary를 agent release의 `production-evidence-index.json`에
묶어야 한다(봉인 bundle 자체 밖의 evidence store에 둔다). 이 index가 없으면 production
admission을 열지 않는다.

## front가 받는 값

front는 provider API key를 받지 않는다. 다음 공개 pin과 DB secret만 runtime env로
받는다.

```dotenv
KRW_AGENT_BACKEND_MODE=rust
KRW_AGENT_PROVIDER=deepseek
KRW_AGENT_ADMISSION_MODE=closed
KRW_RUNTIME_ENVIRONMENT=prod
# GCP host: a single public descriptor file, never the complete Rust release.
KRW_AGENT_PUBLIC_DESCRIPTOR_HOST_PATH=/opt/krw-agent/public-release.json
KRW_AGENT_RELEASE_DESCRIPTOR_PATH=/run/krw-agent/public-release.json
KRW_AGENT_RELEASE_ARTIFACT_HASH=sha256:<descriptor-bytes>
KRW_AGENT_RELEASE_SET_HASH=sha256:<release-set>
# GCP web은 Rust daemon이 직접 작성한 heartbeat만 읽는다.
KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED=1
KRW_AGENT_TENANT_ID=<tenant-id>
AGENT_V1_DATABASE_URL=<secret-manager-injected>
AGENT_V1_DATABASE_CA_FILE=/run/secrets/agent-v1-ca.pem
```

`docker-compose.yml`은 descriptor **파일 하나만** read-only로 mount하고, web readiness가 선택
provider의 모든 descriptor entry와 hash를 확인한다. `agent-v1-outbox`는 같은 DB ABI로
terminal answer를 제품 채팅 read model에 반영한다.

GCP web은 Mac에 직접 접속하지 않는다. Rust daemon이 시작 직후와 이후 30초마다 자신의
provider/descriptor/release-set hash를 공유 DB heartbeat에 직접 기록하고, web은 그 receipt가
현재 GCP pin과 일치할 때만
새 Rust run을 enqueue한다. Mac이 잠들거나 daemon이 죽으면 질문은 저장되지만 credit이나
실행 run은 만들지 않고 즉시 준비 안내로 끝난다.

`agent-v1-outbox`의 컨테이너 healthcheck는 worker 파일 존재 여부가 아니라 최근
성공한 DB/outbox pass heartbeat를 확인한다. DB 연결이나 projection이 실패하면
heartbeat가 `degraded`가 되어 배포 orchestration이 이를 정상 worker로 오인하지 않는다.
worker 재시작 직후에는 이전 heartbeat를 무효화하는 `degraded/starting` 상태를 먼저
기록하고, 실제 pass가 성공한 뒤에만 `ready`로 바뀐다.

개발 환경에서만 오래된 `frontend.env`에 provider pin이 아예 없으면 단일 모델
descriptor에서 provider를 한 번 추론할 수 있다. 하지만 `KRW_AGENT_PROVIDER`가
명시되어 있고 값이 잘못되었거나 descriptor의 모델과 다르면 추론으로 덮어쓰지 않고
즉시 준비 실패로 닫힌다. 운영 환경은 provider pin을 항상 명시해야 한다.
개발 환경에서 실행 중인 Next 프로세스가 provider를 바꿀 때는 이전에 파일에서 주입한
pin을 제거한 뒤 새 descriptor를 읽으므로, GLM 값을 DeepSeek 전환에 재사용하지 않는다.

### 모델별 비용 정책

Agent V1의 outbox 정산은 실행 결과에 기록된 정확한 물리 모델을 기준으로
`provider_pricing_policies`를 조회한다. DeepSeek 정책이 있다고 해서 GLM에
재사용하지 않는다. 선택한 모델의 현재 유효한 가격 정책이 없는 staging/prod
환경은 deep health에서 닫히며, 임의의 가격이나 0달러로 조용히 정산하지 않는다.

GLM 가격은 운영자가 공식 가격표를 확인한 뒤 별도 migration/운영 change로
추가해야 한다. 이 저장소는 확인되지 않은 가격을 추정해 seed하지 않는다. 개발
환경에서는 이 정책 검사를 요구하지 않으므로, 가격 seed 없이도 로컬 연구 흐름과
GLM 품질 검증을 실행할 수 있다.

## 세션과 실패 동작

- 사용자/채팅방/메시지/후속질문은 front의 정확한 `session_id` 범위로 전달한다.
- Rust engine은 그 session의 checkpoint와 evidence를 이어가며 다른 회원/채팅방의
  기억을 자동으로 섞지 않는다.
- enqueue, provider, MCP, DB, projection 중 하나가 실패해도 질문 row와 assistant
  메시지는 terminal 상태로 남긴다. 사용자가 계속 pending 화면에 갇히지 않는다.
- provider 전환은 실행 중 hot-swap하지 않고 `drain → Mac symlink switch → launchd restart →
  deep health → canary → open` 순서로 수행한다.

## DeepSeek ↔ GLM 전환

운영 queue에는 하나만 연다. `KRW_AGENT_PROVIDER`와 이 Mac의
`~/.local/share/krw-agent/current`가 같은 provider bundle을 가리키고,
descriptor/model hash가 서로 맞는지 확인한 후 web/outbox를
재시작한다. DB migration은 additive만 적용하며 rollback은 이전 compatible bundle로
한다. `krw-ontology` source와 schema는 이 전환에서 수정하지 않는다.

## 배포 명령의 역할

`npm run prod:deploy:full`은 sealed dual release를 이 Mac에 stage/activate하고,
선택 provider의 공개 descriptor만 GCP front candidate에 전달한다. final evidence index를
아직 넘기지 않으면 의도적으로 `closed` 상태에서 끝난다. 이 상태에서도 질문은 terminal
안내로 끝나므로 사용자가 무기한 대기하지 않는다.

private DeepSeek canary와 final evidence index가 완성된 뒤에는 별도 open 명령이 현재
Mac daemon의 직접 heartbeat, GCP current descriptor/hash, front commit을 모두 대조한
후에만 admission을 연다.

```bash
npm run prod:agent:admission:open -- \
  --release-root /absolute/sealed-dual-release \
  --release-id <front-deploy-id> \
  --provider deepseek \
  --evidence-index /absolute/production-evidence-index.json
```
