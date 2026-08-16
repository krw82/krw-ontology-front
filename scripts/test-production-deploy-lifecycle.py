#!/usr/bin/env python3
"""Behavioral regression tests for the production deployment lifecycle."""

from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent


def write_executable(path: pathlib.Path, body: str) -> None:
    path.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")
    path.chmod(0o755)


class ProductionDeployLifecycleTest(unittest.TestCase):
    def test_full_build_failure_does_not_mutate_live_gateway(self) -> None:
        """A failed release build must leave the running gateway untouched."""

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            front = root / "front"
            scripts = front / "scripts"
            scripts.mkdir(parents=True)
            (front / "ops").mkdir()
            (front / ".deploy").mkdir()
            (front / ".env").write_text(
                "KRW_FEED_MCP_TOKEN=test-feed-token\n", encoding="utf-8"
            )
            (front / "ops" / "agent-v1-deployment-contract.json").write_text(
                "{}\n", encoding="utf-8"
            )
            for name in (
                "verify-supabase-schema-smoke-rpc-contract.mjs",
                "krw-agent-mcp-contract.mjs",
            ):
                (scripts / name).write_text("// test fixture\n", encoding="utf-8")
            (scripts / "deploy-production-full.sh").write_bytes(
                (REPO_ROOT / "scripts" / "deploy-production-full.sh").read_bytes()
            )
            (scripts / "deploy-production-full.sh").chmod(0o755)
            early_preflight = root / "early-preflight"
            write_executable(
                scripts / "deploy-production-fast.sh",
                f"""
                #!/bin/sh
                [ "$1" = "--preflight-only" ]
                [ "$2" = "--apply-migrations" ]
                [ "$3" = "--skip-mac" ]
                : > {early_preflight}
                """,
            )

            agent = root / "agent"
            (agent / "scripts").mkdir(parents=True)
            build_observation = root / "build-observation"
            write_executable(
                agent / "scripts" / "build_sealed_dual_provider_release.sh",
                f"""
                #!/bin/sh
                printf '%s\n' "$@" > {build_observation}
                exit 42
                """,
            )

            operator = root / "operator"
            (operator / "runtime").mkdir(parents=True)
            (operator / "config" / "runtime").mkdir(parents=True)
            (operator / "config" / "deepseek").mkdir(parents=True)
            (operator / "config" / "glm").mkdir(parents=True)
            ca_file = operator / "runtime" / "ca.pem"
            ca_file.write_text("test-ca\n", encoding="utf-8")
            runtime_env = operator / "runtime" / "krw-agent-deploy.env"
            runtime_env.write_text(
                "\n".join(
                    [
                        f"KRW_AGENT_MCP_CA_FILE={ca_file}",
                        "KRW_ONTOLOGY_MCP_URL=https://127.0.0.1:21431/mcp",
                        "KRW_ONTOLOGY_READY_URL=https://127.0.0.1:21431/readyz",
                        "KRW_FEED_MCP_URL=https://127.0.0.1:21433/mcp",
                        "KRW_FEED_MCP_READY_URL=https://127.0.0.1:21433/readyz",
                        "KRW_FILINGS_MCP_URL=https://127.0.0.1:21432/mcp",
                        "KRW_FILINGS_MCP_READY_URL=https://127.0.0.1:21432/readyz",
                        "KRW_GURU_MCP_URL=https://127.0.0.1:21434/mcp",
                        "KRW_GURU_MCP_READY_URL=https://127.0.0.1:21434/readyz",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (operator / "config" / "runtime" / "feed-tls.json").write_text(
                '{"allowedOrigins":["https://krwontology.com"]}\n',
                encoding="utf-8",
            )
            for provider in ("deepseek", "glm"):
                (operator / "config" / provider / "endpoint-registry.yaml").write_text(
                    "fixture: true\n", encoding="utf-8"
                )

            fake_bin = root / "bin"
            fake_bin.mkdir()
            gateway_mutation = root / "gateway-mutated"
            write_executable(
                fake_bin / "git",
                """
                #!/bin/sh
                case " $* " in
                  *" status "*) exit 0 ;;
                  *" rev-parse --short=12 HEAD "*) echo abcdef123456; exit 0 ;;
                esac
                exit 1
                """,
            )
            write_executable(
                fake_bin / "node",
                f"""
                #!/bin/sh
                case "$1" in
                  *krw-agent-mcp-contract.mjs|-)
                    echo https://krwontology.com
                    exit 0
                    ;;
                  *verify-supabase-schema-smoke-rpc-contract.mjs)
                    exit 0
                    ;;
                esac
                exit 1
                """,
            )
            write_executable(
                fake_bin / "launchctl",
                f"#!/bin/sh\n: > {gateway_mutation}\nexit 0\n",
            )
            write_executable(
                fake_bin / "curl",
                """
                #!/bin/sh
                output=
                while [ "$#" -gt 0 ]; do
                  if [ "$1" = "-o" ]; then shift; output=$1; fi
                  shift
                done
                printf '%s\n' '{"ok":true,"service":"krw-feed-mcp","database_ready":true}' > "$output"
                """,
            )

            env = os.environ.copy()
            env.update(
                {
                    "PATH": f"{fake_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
                    "SIMPLE_PRODUCTION_LOCK_HELD": "1",
                    "KRW_AGENT_SOURCE_ROOT": str(agent),
                    "KRW_AGENT_OPERATOR_ROOT": str(operator),
                    "KRW_AGENT_RUNTIME_ENV_FILE": str(runtime_env),
                }
            )
            result = subprocess.run(
                [str(scripts / "deploy-production-full.sh")],
                cwd=front,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(result.returncode, 42, result.stderr)
            self.assertTrue(
                early_preflight.is_file(),
                "full deployment built Rust before the shared GCP/Supabase preflight ran",
            )
            self.assertTrue(build_observation.is_file(), result.stderr)
            self.assertFalse(
                gateway_mutation.exists(),
                "release preflight restarted or rewrote the live MCP gateway before the build completed",
            )

    def test_failed_forward_cutover_cleans_only_temporary_state(self) -> None:
        """Cleanup after the migration boundary must preserve forward runtime state."""

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            temporary_stage = root / "krw-temporary-stage"
            temporary_stage.mkdir()
            data_lock = root / "production-deploy.lock"
            data_lock.mkdir()
            (data_lock / "owner").write_text("test-owner\n", encoding="utf-8")
            active_release = root / "active-release"
            active_release.write_text("new-release\n", encoding="utf-8")
            admission = root / "admission"
            admission.write_text("closed\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "/bin/sh",
                    str(REPO_ROOT / "scripts" / "cleanup-forward-deployment.sh"),
                    "--temporary-dir",
                    str(temporary_stage),
                    "--data-lock-dir",
                    str(data_lock),
                    "--forward-cutover-started",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(temporary_stage.exists())
            self.assertFalse(data_lock.exists())
            self.assertEqual(active_release.read_text(encoding="utf-8"), "new-release\n")
            self.assertEqual(admission.read_text(encoding="utf-8"), "closed\n")

    def test_cleanup_refuses_non_deployment_directory(self) -> None:
        """A corrupted cleanup variable must not erase an arbitrary directory."""

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            unrelated = root / "operator-data"
            unrelated.mkdir()
            marker = unrelated / "keep"
            marker.write_text("keep\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "/bin/sh",
                    str(REPO_ROOT / "scripts" / "cleanup-forward-deployment.sh"),
                    "--temporary-dir",
                    str(unrelated),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(marker.is_file())

    def test_runtime_env_candidate_is_installed_forward_without_backup(self) -> None:
        """Runtime env activation must atomically move forward, never create rollback state."""

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            active = root / "runtime.env"
            active.write_text("RELEASE=old\n", encoding="utf-8")
            candidate = root / "candidate.env"
            candidate.write_text("RELEASE=new\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "/bin/sh",
                    str(REPO_ROOT / "scripts" / "activate-forward-runtime-env.sh"),
                    "--candidate",
                    str(candidate),
                    "--destination",
                    str(active),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(active.read_text(encoding="utf-8"), "RELEASE=new\n")
            self.assertEqual(candidate.read_text(encoding="utf-8"), "RELEASE=new\n")
            self.assertEqual(list(root.glob("*.previous*")), [])


if __name__ == "__main__":
    unittest.main()
