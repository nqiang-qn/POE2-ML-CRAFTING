"""Monte Carlo validation for policies computed from PoE 2 crafting graphs."""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from value_iteration import GraphValidationError, graph_fingerprint, validate_graph


def _percentile(sorted_values: list[float], percentage: float) -> float | None:
	"""Return a linearly interpolated percentile from sorted observations."""
	if not sorted_values:
		return None
	position = (len(sorted_values) - 1) * percentage
	lower = math.floor(position)
	upper = math.ceil(position)
	if lower == upper:
		return sorted_values[lower]
	weight = position - lower
	return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def _select_outcome(transition: dict[str, Any], rng: random.Random) -> str:
	"""Sample one successor state from a normalized transition distribution."""
	draw = rng.random()
	cumulative = 0.0
	for outcome in transition["outcomes"]:
		cumulative += outcome["probability"]
		if draw < cumulative:
			return outcome["stateKey"]
	return transition["outcomes"][-1]["stateKey"]


def validate_policy_rollouts(
	graph: dict[str, Any],
	policy_artifact: dict[str, Any],
	*,
	episodes: int = 10_000,
	seed: int = 1,
	max_steps: int = 10_000,
	allow_truncated: bool = False,
	allow_collisions: bool = False,
) -> dict[str, Any]:
	"""Estimate the cost and termination behavior of a stationary policy.

	Args:
		graph: Parsed schema-version-2 reachable graph used by the solver.
		policy_artifact: Parsed policy artifact from ``solve_expected_cost``.
		episodes: Number of independent crafting episodes to sample.
		seed: Seed for deterministic transition sampling.
		max_steps: Per-episode bound used to detect looping policies.
		allow_truncated: Allow an incomplete graph as an explicit approximation.
		allow_collisions: Allow abstraction collisions as an explicit approximation.

	Returns:
		A JSON-serializable report containing success, cost, step, and prediction
		comparison statistics.

	Raises:
		GraphValidationError: If artifacts are incompatible or the policy is invalid.
	"""
	if not isinstance(episodes, int) or episodes < 1:
		raise GraphValidationError("episodes must be a positive integer")
	if not isinstance(max_steps, int) or max_steps < 1:
		raise GraphValidationError("max_steps must be a positive integer")
	validate_graph(
		graph, allow_truncated=allow_truncated, allow_collisions=allow_collisions
	)
	if policy_artifact.get("schemaVersion") != 1:
		raise GraphValidationError("Only policy schemaVersion 1 is supported")
	if policy_artifact.get("sourceGraphSchemaVersion") != graph["schemaVersion"]:
		raise GraphValidationError("Policy and graph schema versions do not match")
	if policy_artifact.get("sourceGraphSha256") != graph_fingerprint(graph):
		raise GraphValidationError("Policy was generated from different graph content")
	if policy_artifact.get("initialStateKey") != graph["initialStateKey"]:
		raise GraphValidationError("Policy was generated for a different initial state")
	if policy_artifact.get("marketSnapshot") != graph.get("marketSnapshot"):
		raise GraphValidationError("Policy and graph market snapshots do not match")
	policy = policy_artifact.get("policy")
	if not isinstance(policy, dict):
		raise GraphValidationError("Policy artifact has no policy mapping")

	states = {state["stateKey"]: state for state in graph["states"]}
	transitions: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
	for transition in graph["transitions"]:
		state_transitions = transitions[transition["fromStateKey"]]
		variant_id = transition["variantId"]
		if variant_id in state_transitions:
			raise GraphValidationError(
				f"Duplicate variant {variant_id!r} for state {transition['fromStateKey']!r}"
			)
		state_transitions[variant_id] = transition
	for state_key, state in states.items():
		if state["terminal"]:
			continue
		variant_id = policy.get(state_key)
		if not isinstance(variant_id, str):
			raise GraphValidationError(f"Policy has no action for state {state_key!r}")
		if variant_id not in transitions.get(state_key, {}):
			raise GraphValidationError(
				f"Policy variant {variant_id!r} is unavailable in state {state_key!r}"
			)

	rng = random.Random(seed)
	successful_costs: list[float] = []
	successful_steps: list[float] = []
	failure_states: dict[str, int] = defaultdict(int)
	for _ in range(episodes):
		state_key = graph["initialStateKey"]
		total_cost = 0.0
		for step in range(max_steps + 1):
			if states[state_key]["terminal"]:
				successful_costs.append(total_cost)
				successful_steps.append(float(step))
				break
			if step == max_steps:
				failure_states[state_key] += 1
				break
			transition = transitions[state_key][policy[state_key]]
			total_cost += transition["cost"]["totalExalted"]
			state_key = _select_outcome(transition, rng)

	successes = len(successful_costs)
	failures = episodes - successes
	sorted_costs = sorted(successful_costs)
	sorted_steps = sorted(successful_steps)
	mean_cost = statistics.fmean(successful_costs) if successful_costs else None
	standard_error = None
	if successes > 1:
		standard_error = statistics.stdev(successful_costs) / math.sqrt(successes)
	predicted = policy_artifact.get("initialExpectedCostExalted")
	prediction_error = (
		mean_cost - predicted
		if failures == 0 and mean_cost is not None and isinstance(predicted, (int, float))
		else None
	)
	return {
		"schemaVersion": 1,
		"sourcePolicySchemaVersion": policy_artifact["schemaVersion"],
		"marketSnapshot": graph.get("marketSnapshot"),
		"seed": seed,
		"episodes": episodes,
		"maxSteps": max_steps,
		"successes": successes,
		"failures": failures,
		"successRate": successes / episodes,
		"predictedExpectedCostExalted": predicted,
		"successfulCostExalted": {
			"mean": mean_cost,
			"median": statistics.median(successful_costs) if successful_costs else None,
			"p90": _percentile(sorted_costs, 0.90),
			"p95": _percentile(sorted_costs, 0.95),
			"p99": _percentile(sorted_costs, 0.99),
			"standardError": standard_error,
		},
		"successfulSteps": {
			"mean": statistics.fmean(successful_steps) if successful_steps else None,
			"median": statistics.median(successful_steps) if successful_steps else None,
			"p95": _percentile(sorted_steps, 0.95),
		},
		"predictionErrorExalted": prediction_error,
		"failureStates": dict(sorted(failure_states.items())),
	}


def main() -> None:
	"""Validate a policy with seeded rollouts and write a JSON report."""
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--graph", required=True, type=Path)
	parser.add_argument("--policy", required=True, type=Path)
	parser.add_argument("--output", required=True, type=Path)
	parser.add_argument("--episodes", type=int, default=10_000)
	parser.add_argument("--seed", type=int, default=1)
	parser.add_argument("--max-steps", type=int, default=10_000)
	parser.add_argument("--allow-truncated", action="store_true")
	parser.add_argument("--allow-collisions", action="store_true")
	args = parser.parse_args()
	graph = json.loads(args.graph.read_text(encoding="utf-8"))
	policy = json.loads(args.policy.read_text(encoding="utf-8"))
	report = validate_policy_rollouts(
		graph,
		policy,
		episodes=args.episodes,
		seed=args.seed,
		max_steps=args.max_steps,
		allow_truncated=args.allow_truncated,
		allow_collisions=args.allow_collisions,
	)
	args.output.parent.mkdir(parents=True, exist_ok=True)
	args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
	print(
		f"Successful episodes: {report['successes']}/{report['episodes']}; "
		f"mean cost: {report['successfulCostExalted']['mean']} Exalted Orbs"
	)


if __name__ == "__main__":
	main()
