"""Cross-language integration test for the complete optimizer pipeline."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class EndToEndPipelineTests(unittest.TestCase):
	"""Verify TypeScript graph output through Python solving and validation."""

	def test_typescript_graph_to_python_policy_and_rollouts(self) -> None:
		with tempfile.TemporaryDirectory(dir=ROOT) as temporary_directory:
			temporary = Path(temporary_directory)
			graph_path = temporary / "graph.json"
			policy_path = temporary / "policy.json"
			report_path = temporary / "validation.json"
			npm = "npm.cmd" if os.name == "nt" else "npm"
			subprocess.run(
				[
					npm,
					"run",
					"fixture:e2e-graph",
					"--",
					"--output",
					str(graph_path),
				],
				cwd=ROOT,
				check=True,
				capture_output=True,
				text=True,
			)
			subprocess.run(
				[
					sys.executable,
					str(ROOT / "experiments" / "value_iteration.py"),
					"--graph",
					str(graph_path),
					"--output",
					str(policy_path),
				],
				cwd=ROOT,
				check=True,
				capture_output=True,
				text=True,
			)
			subprocess.run(
				[
					sys.executable,
					str(ROOT / "experiments" / "policy_rollout.py"),
					"--graph",
					str(graph_path),
					"--policy",
					str(policy_path),
					"--output",
					str(report_path),
					"--episodes",
					"100",
					"--seed",
					"42",
				],
				cwd=ROOT,
				check=True,
				capture_output=True,
				text=True,
			)

			policy = json.loads(policy_path.read_text(encoding="utf-8"))
			report = json.loads(report_path.read_text(encoding="utf-8"))
			self.assertEqual(policy["policy"]["start"], "cheap")
			self.assertEqual(policy["initialExpectedCostExalted"], 2)
			self.assertEqual(report["successRate"], 1)
			self.assertEqual(report["successfulCostExalted"]["mean"], 2)
			self.assertEqual(report["predictionErrorExalted"], 0)


if __name__ == "__main__":
	unittest.main()
