"""
Simulation-based power analysis for the fully-counterbalanced
item-rotation design (30 trials/participant, 10 per explanation
condition; all 6 orderings of Control/Standard/Cognitive Forcing used
across participants, so Control is no longer confounded with trial
position and can be included in a formal hypothesis test).

Hypotheses (Bonferroni alpha = 0.05/3 ~= 0.0167):
    H1 (primary):     Explanation condition affects over-reliance
                       (omnibus test across Control/Standard/Cognitive
                       Forcing; Control now validly included).
    H2 (primary):      Task subjectivity increases over-reliance.
    H3 (exploratory):  Interaction: subjectivity x explanation.

Parameter sources:
    - Standard NLE vs Cognitive Forcing gap (64% -> 48%): Bucinca
      et al. (2021), the only statistically significant overreliance
      comparison in that paper (p = .003).
    - Control baseline (72.5%): "The Persuasion Paradox" (arXiv
      2604.03237), Prediction-Only condition.
    - H2 and H3 effect sizes: no directly comparable prior estimate;
      set via Cohen's (1988) conventional small/medium benchmarks,
      converted to the logit scale via Chinn's (2000) formula
      (log(OR) = d * pi/sqrt(3)).
    - Participant-level SD (0.6) and item-level SD (0.3): planning
      assumptions, not derived from a specific published estimate.

Required package:
    pip install statsmodels
"""

import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf


warnings.filterwarnings("ignore")
np.random.seed(42)


# ---------------------------------------------------------------------------
# Simulation settings
# ---------------------------------------------------------------------------

ALPHA = 0.05 / 3  # Bonferroni correction for 3 hypotheses
TARGET_POWER = 0.80
N_SIMS = 500

# Items per condition per participant, split across the 3 subjectivity tasks.
ITEMS_PER_TASK_PER_BLOCK = {"sentiment": 3, "irony": 3, "sarcasm": 4}  # sums to 10


# ---------------------------------------------------------------------------
# Effect sizes (grounded, same sources as previous versions)
# ---------------------------------------------------------------------------

STANDARD_NLE_RATE = 0.64
COGNITIVE_FORCING_RATE = 0.48


def logit(p):
    return np.log(p / (1 - p))


standard_nle_logit = logit(STANDARD_NLE_RATE)
cognitive_forcing_logit = logit(COGNITIVE_FORCING_RATE)
H2_EFFECT = cognitive_forcing_logit - standard_nle_logit  # grounded contrast

CONTROL_RATE = 0.725  # now part of the H1 omnibus test (order confound resolved)
BASE_LOGIT = logit(CONTROL_RATE)

COHEN_SMALL = 0.2 * (np.pi / np.sqrt(3))
COHEN_MEDIUM = 0.5 * (np.pi / np.sqrt(3))

SUBJECTIVITY_EFFECT = {
    "sentiment": 0.0,
    "irony": COHEN_MEDIUM / 2,
    "sarcasm": COHEN_MEDIUM,
}

INTERACTION_SCALE = ((COHEN_SMALL + COHEN_MEDIUM) / 2) / COHEN_MEDIUM

PARTICIPANT_SD = 0.6  # same planning assumption as before

# Item-level random effect (stimulus-level idiosyncrasy).
ITEM_SD = 0.3


def simulate_dataset(n_participants):
    explanations = ["control", "standard_nle", "cognitive_forcing_nle"]
    subjectivities = ["sentiment", "irony", "sarcasm"]

    explanation_effect = {
        "control": 0.0,
        "standard_nle": standard_nle_logit - BASE_LOGIT,
        "cognitive_forcing_nle": cognitive_forcing_logit - BASE_LOGIT,
    }
    max_effect = max(abs(v) for v in explanation_effect.values())

    # 30 base items, each with its own random intercept.
    item_effects = {}
    item_id = 0
    item_lookup = {}
    for task in subjectivities:
        for _ in range(10):
            item_effects[item_id] = np.random.normal(0, ITEM_SD)
            item_lookup[item_id] = task
            item_id += 1

    rows = []

    for participant_id in range(1, n_participants + 1):
        participant_effect = np.random.normal(0, PARTICIPANT_SD)

        # Each participant sees each of the 30 items exactly once,
        # 10 per condition, split across tasks.
        item_ids_by_task = {t: [i for i in item_lookup if item_lookup[i] == t] for t in subjectivities}
        for t in subjectivities:
            np.random.shuffle(item_ids_by_task[t])

        # Distribute this participant's 30 items across the 3
        # conditions, respecting the per-task-per-block split.
        condition_task_items = {c: {t: [] for t in subjectivities} for c in explanations}
        for t in subjectivities:
            pool = item_ids_by_task[t]
            idx = 0
            counts = [ITEMS_PER_TASK_PER_BLOCK[t]] * 3
            # adjust so total across 3 blocks equals available items for this task (10)
            for c, count in zip(explanations, counts):
                condition_task_items[c][t] = pool[idx : idx + count]
                idx += count

        for explanation in explanations:
            for task in subjectivities:
                subj_idx = subjectivities.index(task)

                if explanation == "control":
                    interaction = 0
                else:
                    interaction = (
                        INTERACTION_SCALE
                        * subj_idx
                        * (explanation_effect[explanation] / max_effect)
                    )

                for item_id_this in condition_task_items[explanation][task]:
                    linear_predictor = (
                        BASE_LOGIT
                        + SUBJECTIVITY_EFFECT[task]
                        + explanation_effect[explanation]
                        + interaction
                        + participant_effect
                        + item_effects[item_id_this]
                    )
                    probability = 1 / (1 + np.exp(-linear_predictor))
                    outcome = np.random.binomial(1, probability)
                    rows.append(
                        {
                            "pid": participant_id,
                            "item_id": item_id_this,
                            "explanation": explanation,
                            "subjectivity": task,
                            "y": outcome,
                        }
                    )

    return pd.DataFrame(rows)


def run_one_simulation(n_participants):
    data = simulate_dataset(n_participants)
    data["subjectivity"] = pd.Categorical(
        data["subjectivity"], categories=["sentiment", "irony", "sarcasm"]
    )
    data["explanation"] = pd.Categorical(
        data["explanation"], categories=["control", "standard_nle", "cognitive_forcing_nle"]
    )

    try:
        model = smf.gee(
            "y ~ C(subjectivity) + C(explanation) + C(subjectivity):C(explanation)",
            groups="pid",
            data=data,
            family=sm.families.Binomial(),
        )
        result = model.fit()
        params = list(result.params.index)

        # H1: omnibus test of the explanation main effect (2 df) --
        # Control, Standard, and Cognitive Forcing are now all validly
        # compared, since order confounding has been resolved via full
        # counterbalancing.
        explanation_terms = [p for p in params if "explanation" in p and ":" not in p]
        h1_p = result.wald_test(explanation_terms, scalar=True).pvalue

        # H2: omnibus test of the subjectivity main effect (2 df).
        subjectivity_terms = [p for p in params if "subjectivity" in p and ":" not in p]
        h2_p = result.wald_test(subjectivity_terms, scalar=True).pvalue

        # H3 (exploratory): full omnibus interaction test (4 df) --
        # subjectivity x explanation, all levels now included.
        interaction_terms = [p for p in params if ":" in p]
        h3_p = result.wald_test(interaction_terms, scalar=True).pvalue

        return h1_p < ALPHA, h2_p < ALPHA, h3_p < ALPHA

    except Exception:
        return False, False, False


def estimate_power(n_participants, n_sims=N_SIMS):
    results = np.array([run_one_simulation(n_participants) for _ in range(n_sims)])
    return results[:, 0].mean(), results[:, 1].mean(), results[:, 2].mean()


if __name__ == "__main__":
    print(f"Standard NLE -> Cognitive Forcing gap, grounded: "
          f"{STANDARD_NLE_RATE:.0%} -> {COGNITIVE_FORCING_RATE:.0%} (logit diff = {H2_EFFECT:.3f})")
    print(f"Control baseline: {CONTROL_RATE:.1%} (now part of H1's omnibus test)")
    print(f"Item-level SD: {ITEM_SD}")
    print(f"Participant-level SD: {PARTICIPANT_SD}")
    print(f"Items per condition per participant: 10")
    print(f"Bonferroni alpha (3 hypotheses): {ALPHA:.4f}\n")

    print(f"{'Total N':>8} {'H1 power':>10} {'H2 power':>10} {'H3 power (exploratory)':>24}")
    for n_participants in [50, 60, 70, 80, 90, 100, 120, 140, 160]:
        h1, h2, h3 = estimate_power(n_participants)
        print(f"{n_participants:>8} {h1:>10.2f} {h2:>10.2f} {h3:>24.2f}")
        if min(h1, h2) >= TARGET_POWER:
            print(f"\n>>> Target power ({TARGET_POWER:.0%}) reached for primary hypotheses "
                  f"(H1, H2) at N = {n_participants} participants.")
            print(f">>> H3 (exploratory) power at this N: {h3:.2f}")
            break