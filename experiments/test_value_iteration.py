"""Tests for the crafting graph value-iteration experiment."""

import copy
import unittest

from value_iteration import GraphValidationError, solve_expected_cost
from policy_rollout import validate_policy_rollouts


def fixture_graph() -> dict:
	"""Return a graph whose optimal initial expected cost is exactly two."""
	return {
		"schemaVersion": 2,
		"initialStateKey": "start",
		"marketSnapshot": {"league": "Test", "capturedAt": "2026-01-01T00:00:00Z"},
		"truncated": False,
		"collisions": [],
		"states": [
			{"stateKey": "start", "terminal": False},
			{"stateKey": "retry", "terminal": False},
			{"stateKey": "done", "terminal": True},
		],
		"transitions": [
			{
				"fromStateKey": "start",
				"variantId": "expensive",
				"cost": {"totalExalted": 3},
				"outcomes": [{"stateKey": "done", "probability": 1}],
			},
			{
				"fromStateKey": "start",
				"variantId": "cheap",
				"cost": {"totalExalted": 1},
				"outcomes": [{"stateKey": "retry", "probability": 1}],
			},
			{
				"fromStateKey": "retry",
				"variantId": "finish",
				"cost": {"totalExalted": 1},
				"outcomes": [{"stateKey": "done", "probability": 1}],
			},
		],
	}


class ValueIterationTests(unittest.TestCase):
	"""Exercise optimal-policy selection and default safety behavior."""

	def test_finds_cheapest_expected_policy(self) -> None:
		result = solve_expected_cost(fixture_graph())
		self.assertEqual(result["initialExpectedCostExalted"], 2)
		self.assertEqual(result["policy"]["start"], "cheap")
		self.assertEqual(result["policy"]["retry"], "finish")

	def test_rejects_truncated_graph_by_default(self) -> None:
		graph = fixture_graph()
		graph["truncated"] = True
		with self.assertRaisesRegex(GraphValidationError, "truncated"):
			solve_expected_cost(graph)

	def test_rejects_collisions_by_default(self) -> None:
		graph = fixture_graph()
		graph["collisions"] = [{"stateKey": "start"}]
		with self.assertRaisesRegex(GraphValidationError, "collisions"):
			solve_expected_cost(graph)

	def test_rejects_missing_market_cost(self) -> None:
		graph = copy.deepcopy(fixture_graph())
		graph["transitions"][0]["cost"]["totalExalted"] = None
		with self.assertRaisesRegex(GraphValidationError, "no valid Exalted cost"):
			solve_expected_cost(graph)

	def test_rollouts_match_a_deterministic_policy(self) -> None:
		graph = fixture_graph()
		policy = solve_expected_cost(graph)
		report = validate_policy_rollouts(graph, policy, episodes=100, seed=42)
		self.assertEqual(report["successRate"], 1)
		self.assertEqual(report["successfulCostExalted"]["mean"], 2)
		self.assertEqual(report["successfulSteps"]["mean"], 2)
		self.assertEqual(report["predictionErrorExalted"], 0)

	def test_rollouts_are_seeded_and_report_step_bound_failures(self) -> None:
		graph = fixture_graph()
		graph["transitions"][1]["outcomes"] = [
			{"stateKey": "retry", "probability": 0.5},
			{"stateKey": "done", "probability": 0.5},
		]
		policy = solve_expected_cost(graph)
		first = validate_policy_rollouts(graph, policy, episodes=100, seed=7, max_steps=1)
		second = validate_policy_rollouts(graph, policy, episodes=100, seed=7, max_steps=1)
		self.assertEqual(first, second)
		self.assertGreater(first["failures"], 0)

	def test_rollouts_reject_a_policy_from_another_snapshot(self) -> None:
		graph = fixture_graph()
		policy = solve_expected_cost(graph)
		policy["marketSnapshot"] = {"league": "Other", "capturedAt": "later"}
		with self.assertRaisesRegex(GraphValidationError, "market snapshots"):
			validate_policy_rollouts(graph, policy)

	def test_rollouts_reject_changed_graph_content(self) -> None:
		graph = fixture_graph()
		policy = solve_expected_cost(graph)
		graph["transitions"][0]["cost"]["totalExalted"] = 4
		with self.assertRaisesRegex(GraphValidationError, "different graph content"):
			validate_policy_rollouts(graph, policy)


if __name__ == "__main__":
	unittest.main()
