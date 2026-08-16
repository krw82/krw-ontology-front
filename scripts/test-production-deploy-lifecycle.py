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
    def test_failed_controller_deploy_does_not_mutate_live_gateway(self) -> None:
        """A failing controller deployment must leave the running gateway untouched."""

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            front = root / "front"
            scripts = front / "scripts"
            scripts.mkdir(parents=True)
            (front / "ops").mkdir()
            (front / ".deploy").mkdir()

            full_script = scripts / "deploy-production-full.sh"
            full_script.write_bytes(
                (REPO_ROOT / "scripts" / "deploy-production-full.sh").read_bytes()
            )
            full_script.chmod(0o755)

            # The adapter delegates the whole deployment to one explicit
            # controller invocation and owns no build/migration/activation
            # logic of its own. A controller that fails before touching the
            # host must propagate its exit status without side effects.
            controller_observation = root / "controller-observation"
            controller = root / "krw-agent-deploy"
            write_executable(
                controller,
                f"""
                #!/bin/sh
                printf '%s\\n' "$@" > {controller_observation}
                exit 42
                """,
            )
            deploy_config = root / "operator-config.json"
            deploy_config.write_text('{"fixture": true}\n', encoding="utf-8")

            fake_bin = root / "bin"
            fake_bin.mkdir()
            gateway_mutation = root / "gateway-mutated"
            write_executable(
                fake_bin / "launchctl",
                f"#!/bin/sh\n: > {gateway_mutation}\nexit 0\n",
            )
            write_executable(
                fake_bin / "git",
                """
                #!/bin/sh
                case " $* " in
                  *" status "*) exit 0 ;;
                esac
                exit 1
                """,
            )

            env = os.environ.copy()
            env.update(
                {
                    "PATH": f"{fake_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
                    "SIMPLE_PRODUCTION_LOCK_HELD": "1",
                    "KRW_AGENT_DEPLOY_BIN": str(controller),
                    "KRW_AGENT_DEPLOY_CONFIG": str(deploy_config),
                    "HOME": str(root / "home"),
                }
            )
            result = subprocess.run(
                [str(full_script)],
                cwd=front,
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(result.returncode, 42, result.stderr)
            self.assertTrue(controller_observation.is_file(), result.stderr)
            self.assertEqual(
                controller_observation.read_text(encoding="utf-8").split(),
                ["--config", str(deploy_config), "deploy"],
                "the adapter must exec exactly one explicit controller invocation",
            )
            self.assertFalse(
                gateway_mutation.exists(),
                "a failed controller deployment restarted or rewrote the live MCP gateway",
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
