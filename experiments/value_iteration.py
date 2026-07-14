"""Expected-cost value iteration for reachable PoE 2 crafting graphs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


class GraphValidationError(ValueError):
	"""Raised when a graph cannot safely be used by the optimizer."""


def graph_fingerprint(graph: dict[str, Any]) -> str:
	"""Return a stable SHA-256 identity for a parsed graph artifact.

	Args:
		graph: Parsed graph whose JSON content should be identified.

	Returns:
		Lowercase hexadecimal SHA-256 digest of canonical compact JSON.
	"""
	canonical = json.dumps(graph, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
	return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_graph(
	graph: dict[str, Any], *, allow_truncated: bool, allow_collisions: bool
) -> None:
	"""Validate solver-critical graph invariants.

	Args:
		graph: Parsed reachable graph artifact.
		allow_truncated: Permit incomplete state expansion when true.
		allow_collisions: Permit lossy feature-state merges when true.

	Raises:
		GraphValidationError: If the graph is unsafe or structurally invalid.
	"""
	if graph.get("schemaVersion") not in (2, 3):
		raise GraphValidationError("Only reachable graph schemaVersion 2 or 3 is supported")
	if graph.get("truncated") and not allow_truncated:
		raise GraphValidationError("Graph is truncated; regenerate it with larger bounds")
	if graph.get("collisions") and not allow_collisions:
		raise GraphValidationError(
			"Graph has state-abstraction collisions; choose an approximation policy explicitly"
		)

	states = graph.get("states")
	transitions = graph.get("transitions")
	if not isinstance(states, list) or not isinstance(transitions, list):
		raise GraphValidationError("Graph states and transitions must be arrays")
	state_keys = {state.get("stateKey") for state in states}
	if None in state_keys or len(state_keys) != len(states):
		raise GraphValidationError("State keys must be present and unique")
	if graph.get("initialStateKey") not in state_keys:
		raise GraphValidationError("Initial state is absent from graph states")

	for transition in transitions:
		if transition.get("fromStateKey") not in state_keys:
			raise GraphValidationError("Transition source is absent from graph states")
		cost = transition.get("cost")
		value = cost.get("totalExalted") if isinstance(cost, dict) else None
		if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
			raise GraphValidationError(
				f"Transition {transition.get('variantId')!r} has no valid Exalted cost"
			)
		outcomes = transition.get("outcomes")
		if not isinstance(outcomes, list) or not outcomes:
			raise GraphValidationError("Every transition must have at least one outcome")
		probability_sum = 0.0
		for outcome in outcomes:
			probability = outcome.get("probability")
			if outcome.get("stateKey") not in state_keys:
				raise GraphValidationError("Transition outcome is absent from graph states")
			if not isinstance(probability, (int, float)) or probability < 0:
				raise GraphValidationError("Outcome probabilities must be non-negative numbers")
			probability_sum += probability
		if not math.isclose(probability_sum, 1.0, rel_tol=1e-9, abs_tol=1e-9):
			raise GraphValidationError("Transition outcome probabilities must sum to one")


def solve_expected_cost(
	graph: dict[str, Any],
	*,
	tolerance: float = 1e-9,
	max_iterations: int = 100_000,
	allow_truncated: bool = False,
	allow_collisions: bool = False,
) -> dict[str, Any]:
	"""Find the stationary policy with minimum expected Exalted cost.

	Terminal states have value zero. Each Bellman update adds the fixed snapshot
	cost of an action variant to its probability-weighted successor values.

	Args:
		graph: Parsed schema-version-2 reachable graph.
		tolerance: Maximum Bellman value change required for convergence.
		max_iterations: Hard iteration bound for improper or slow-converging graphs.
		allow_truncated: Allow incomplete graphs as an explicit approximation.
		allow_collisions: Allow state abstraction collisions explicitly.

	Returns:
		A JSON-serializable artifact containing values, selected variants, and
		convergence metadata.

	Raises:
		GraphValidationError: If the graph or solver parameters are invalid.
		RuntimeError: If value iteration does not converge within the bound.
	"""
	if not math.isfinite(tolerance) or tolerance <= 0:
		raise GraphValidationError("tolerance must be a positive finite number")
	if not isinstance(max_iterations, int) or max_iterations < 1:
		raise GraphValidationError("max_iterations must be a positive integer")
	validate_graph(
		graph, allow_truncated=allow_truncated, allow_collisions=allow_collisions
	)

	states = {state["stateKey"]: state for state in graph["states"]}
	by_state: dict[str, list[dict[str, Any]]] = defaultdict(list)
	for transition in graph["transitions"]:
		by_state[transition["fromStateKey"]].append(transition)
	for transitions in by_state.values():
		transitions.sort(key=lambda transition: transition["variantId"])

	values = {state_key: 0.0 for state_key in states}
	policy: dict[str, str] = {}
	residual = math.inf
	for iteration in range(1, max_iterations + 1):
		updated = values.copy()
		updated_policy: dict[str, str] = {}
		residual = 0.0
		for state_key, state in states.items():
			if state["terminal"]:
				updated[state_key] = 0.0
				continue
			choices = by_state.get(state_key, [])
			if not choices:
				raise GraphValidationError(f"Non-terminal state {state_key!r} has no actions")
			scored = []
			for transition in choices:
				expected = transition["cost"]["totalExalted"] + sum(
					outcome["probability"] * values[outcome["stateKey"]]
					for outcome in transition["outcomes"]
				)
				scored.append((expected, transition["variantId"]))
			best_value, best_variant = min(scored)
			updated[state_key] = best_value
			updated_policy[state_key] = best_variant
			residual = max(residual, abs(best_value - values[state_key]))
		values = updated
		policy = updated_policy
		if residual <= tolerance:
			break
	else:
		raise RuntimeError(
			f"Value iteration did not converge after {max_iterations} iterations "
			f"(residual={residual})"
		)

	ordered_values = {key: values[key] for key in sorted(values)}
	ordered_policy = {key: policy[key] for key in sorted(policy)}
	return {
		"schemaVersion": 1,
		"sourceGraphSchemaVersion": graph["schemaVersion"],
		"sourceGraphSha256": graph_fingerprint(graph),
		"marketSnapshot": graph.get("marketSnapshot"),
		"initialStateKey": graph["initialStateKey"],
		"initialExpectedCostExalted": values[graph["initialStateKey"]],
		"iterations": iteration,
		"residual": residual,
		"tolerance": tolerance,
		"valuesExalted": ordered_values,
		"policy": ordered_policy,
	}


def main() -> None:
	"""Run value iteration from a graph JSON file and write a policy artifact."""
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--graph", required=True, type=Path)
	parser.add_argument("--output", required=True, type=Path)
	parser.add_argument("--tolerance", type=float, default=1e-9)
	parser.add_argument("--max-iterations", type=int, default=100_000)
	parser.add_argument("--allow-truncated", action="store_true")
	parser.add_argument("--allow-collisions", action="store_true")
	args = parser.parse_args()
	graph = json.loads(args.graph.read_text(encoding="utf-8"))
	result = solve_expected_cost(
		graph,
		tolerance=args.tolerance,
		max_iterations=args.max_iterations,
		allow_truncated=args.allow_truncated,
		allow_collisions=args.allow_collisions,
	)
	args.output.parent.mkdir(parents=True, exist_ok=True)
	args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
	print(
		f"Expected cost from initial state: "
		f"{result['initialExpectedCostExalted']:.6g} Exalted Orbs"
	)


if __name__ == "__main__":
	main()
