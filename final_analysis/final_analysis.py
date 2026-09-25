"""
final_analysis.py

Final confirmatory analysis for N=60 valid participants, per the
pre-registered analysis plan (OSF).

Usage:
    pip install pandas openpyxl statsmodels scipy
    python final_analysis.py NLE2_Survey_Data.xlsx

Input: the raw exported Google Sheets data (.xlsx), containing ALL
submitted participants (valid and excluded). This script re-applies
the pre-registered exclusion criteria itself, so you can safely point
it at the full raw export.
"""

import sys
import json
import warnings

import pandas as pd
import numpy as np
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats
from collections import Counter

warnings.filterwarnings("ignore")


def determine_valid_participants(df):
    """
    Applies the pre-registered exclusion criteria:
      - Duration >= 10 minutes
      - Attention check passed
      - Exactly 5 correct + 5 incorrect trials per explanation condition
      - All Likert/self-confidence items answered (no blanks)
    Returns the set of valid participant_ids.
    """
    valid_ids = []
    for pid in df["participant_id"].unique():
        sub = df[df["participant_id"] == pid]

        duration = sub["time_elapsed"].max() / 60000
        ac = sub[sub["screen_type"] == "attention_check"]
        ac_passed = ac.iloc[0]["attention_check_passed"] if len(ac) > 0 else None

        j2 = sub[sub["screen_type"] == "judgment2"]
        balance_ok = True
        for cond in j2["explanation_condition"].dropna().unique():
            block = j2[j2["explanation_condition"] == cond]
            dist = dict(Counter(block["correct_trial"]))
            if dist.get(0.0, 0) != 5 or dist.get(1.0, 0) != 5:
                balance_ok = False

        li = sub[sub["screen_type"] == "likert_block"]
        all_filled = True
        for _, row in li.iterrows():
            resp = json.loads(row["response"]) if isinstance(row["response"], str) else row["response"]
            if any(v == "" or pd.isna(v) for v in resp.values()):
                all_filled = False

        valid = (
            (duration >= 10)
            and (ac_passed == 1.0 or ac_passed is True)
            and balance_ok
            and all_filled
        )
        if valid:
            valid_ids.append(pid)

    return set(valid_ids)


def run_hypothesis_tests(incorrect):
    """
    Fits the pre-registered GEE model and runs the three omnibus Wald
    tests (H1: explanation, H2: subjectivity, H3: interaction),
    Bonferroni-corrected for 3 hypotheses.
    """
    data = incorrect.copy()
    data["y"] = data["over_relied"].astype(int)
    data["subjectivity"] = pd.Categorical(
        data["subjectivity"], categories=["sentiment", "irony", "sarcasm"]
    )
    data["explanation_condition"] = pd.Categorical(
        data["explanation_condition"],
        categories=["control", "standard_nle", "cognitive_forcing_nle"],
    )

    model = smf.gee(
        "y ~ C(subjectivity) + C(explanation_condition) + C(subjectivity):C(explanation_condition)",
        groups="participant_id",
        data=data,
        family=sm.families.Binomial(),
    )
    result = model.fit()
    params = list(result.params.index)

    alpha = 0.05 / 3

    exp_terms = [p for p in params if "explanation_condition" in p and ":" not in p]
    h1_p = result.wald_test(exp_terms, scalar=True).pvalue

    subj_terms = [p for p in params if "subjectivity" in p and ":" not in p]
    h2_p = result.wald_test(subj_terms, scalar=True).pvalue

    inter_terms = [p for p in params if ":" in p]
    h3_p = result.wald_test(inter_terms, scalar=True).pvalue

    return result, alpha, h1_p, h2_p, h3_p


def compute_secondary_metrics(df, valid_ids, j2_all):
    """
    Pre-registered secondary behavioral outcomes:
      - Appropriate Disagreement Rate: on INCORRECT-prediction trials,
        proportion where the participant correctly rejected the AI's
        incorrect prediction (i.e., did NOT over-rely).
      - Decision-Shift Rate: on ALL trials (correct + incorrect), the
        proportion where Initial Judgment != Final Decision, regardless
        of correctness.

    initial_judgment lives on each trial's "judgment1" row, while
    final_decision lives on the "judgment2" row -- these must be
    joined on (participant_id, trial_number) before comparing, since
    judgment2's own row does not carry initial_judgment.
    """
    incorrect = j2_all[j2_all["correct_trial"] == False]
    appropriate_disagreement_rate = 1 - incorrect["over_relied"].mean()

    df_valid = df[df["participant_id"].isin(valid_ids)]
    j1 = df_valid[df_valid["screen_type"] == "judgment1"][
        ["participant_id", "trial_number", "initial_judgment"]
    ]
    j2 = j2_all[["participant_id", "trial_number", "final_decision"]]

    merged = j1.merge(j2, on=["participant_id", "trial_number"], how="inner")
    shifted = merged["initial_judgment"] != merged["final_decision"]
    decision_shift_rate = shifted.mean()

    return appropriate_disagreement_rate, decision_shift_rate


def compute_self_confidence_correlation(df, valid_ids, incorrect):
    """
    Exploratory: correlates each participant's OVERALL self-reported
    confidence (mean of the 3 task-specific items) with their overall
    over-reliance rate.
    """
    df_valid = df[df["participant_id"].isin(valid_ids)]
    sc_rows = df_valid[df_valid["screen_type"] == "self_confidence"]

    overall_conf = {}
    for _, row in sc_rows.iterrows():
        resp = json.loads(row["response"]) if isinstance(row["response"], str) else row["response"]
        vals = [float(v) for v in resp.values() if v != ""]
        if vals:
            overall_conf[row["participant_id"]] = sum(vals) / len(vals)

    overall_or = incorrect.groupby("participant_id")["over_relied"].mean()

    merged = pd.DataFrame({"confidence": overall_conf}).join(
        overall_or.rename("over_relied")
    ).dropna()

    r, p = stats.pearsonr(merged["confidence"], merged["over_relied"])
    return r, p, len(merged)


def main(xlsx_path):
    df = pd.read_excel(xlsx_path)

    valid_ids = determine_valid_participants(df)
    print(f"Valid participants: {len(valid_ids)}")
    if len(valid_ids) != 60:
        print(f"WARNING: expected exactly 60 valid participants, found {len(valid_ids)}.")
    print()

    df_valid = df[df["participant_id"].isin(valid_ids)]
    j2_all = df_valid[df_valid["screen_type"] == "judgment2"].copy()
    incorrect = j2_all[j2_all["correct_trial"] == False].copy()

    # ---- Descriptive rates ----
    print("=== Descriptive over-reliance rates ===")
    print("By explanation condition:")
    for cond in ["control", "standard_nle", "cognitive_forcing_nle"]:
        sub = incorrect[incorrect["explanation_condition"] == cond]
        print(f"  {cond}: {sub['over_relied'].mean():.1%} (n={len(sub)})")
    print("By task subjectivity:")
    for task in ["sentiment", "irony", "sarcasm"]:
        sub = incorrect[incorrect["subjectivity"] == task]
        print(f"  {task}: {sub['over_relied'].mean():.1%} (n={len(sub)})")
    print()

    # ---- Primary/exploratory hypothesis tests ----
    result, alpha, h1_p, h2_p, h3_p = run_hypothesis_tests(incorrect)
    print(f"=== Pre-registered hypothesis tests (Bonferroni alpha = {alpha:.4f}) ===")
    print(f"H1 (explanation main effect):   p = {h1_p:.4f}  -> {'SIGNIFICANT' if h1_p < alpha else 'not significant'}")
    print(f"H2 (subjectivity main effect):  p = {h2_p:.4f}  -> {'SIGNIFICANT' if h2_p < alpha else 'not significant'}")
    print(f"H3 (interaction, exploratory):  p = {h3_p:.4f}  -> {'SIGNIFICANT' if h3_p < alpha else 'not significant'}")
    print()
    print("Full model summary (for the paper's appendix / methods detail):")
    print(result.summary())
    print()

    # ---- Secondary metrics ----
    adr, dsr = compute_secondary_metrics(df, valid_ids, j2_all)
    print("=== Secondary behavioral outcomes ===")
    print(f"Appropriate Disagreement Rate: {adr:.1%}")
    print(f"Decision-Shift Rate (all trials): {dsr:.1%}")
    print()

    # ---- Self-confidence correlation (exploratory) ----
    r, p, n = compute_self_confidence_correlation(df, valid_ids, incorrect)
    print("=== Exploratory: self-confidence vs. over-reliance ===")
    print(f"Pearson r = {r:.3f}, p = {p:.4f}, n = {n}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python final_analysis.py <path_to_xlsx>")
        sys.exit(1)
    main(sys.argv[1])
