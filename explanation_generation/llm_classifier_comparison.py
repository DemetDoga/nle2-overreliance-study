"""
Runs the general-purpose LLM (via Groq) on the same 30 stimuli used for
the user study, to produce a descriptive accuracy/macro-F1 comparison
against the fine-tuned DistilBERT classifiers (Section 4 of the project
plan). This is NOT a formal hypothesis -- purely a robustness check.

Setup (same as generate_nle.py):
    pip install groq pandas scikit-learn
    export GROQ_API_KEY="gsk_..."

Usage:
    python llm_classifier_comparison.py --input selected_stimuli.csv --output llm_predictions.csv
"""

import argparse
import os
import time
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score
from groq import Groq

MODEL = "openai/gpt-oss-120b"
TEMPERATURE = 0.2

# Valid label sets per task, and the prompt wording for each.
TASK_LABELS = {
    "sentiment": ["positive", "negative"],
    "irony": ["ironic", "not_ironic"],
    "sarcasm": ["sarcastic", "not_sarcastic"],
}

TASK_QUESTION = {
    "sentiment": "Is the sentiment of this sentence 'positive' or 'negative'?",
    "irony": "Is this sentence 'ironic' or 'not_ironic'?",
    "sarcasm": "Is this sentence 'sarcastic' or 'not_sarcastic'?",
}


def build_classification_prompt(text, task):
    labels = TASK_LABELS[task]
    question = TASK_QUESTION[task]
    return (
        f"{question}\n\n"
        f"Sentence: \"{text}\"\n\n"
        f"Respond with exactly one word: either \"{labels[0]}\" or \"{labels[1]}\". "
        f"Do not explain your reasoning. Output only the single label word."
    )


def classify(client, text, task, max_retries=3):
    prompt = build_classification_prompt(text, task)
    labels = TASK_LABELS[task]

    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=TEMPERATURE,
                max_tokens=300,
                reasoning_effort="low",
            )
            content = response.choices[0].message.content
            if not content or not content.strip():
                raise ValueError("Empty response from model.")

            content_clean = content.strip().lower()

            # Check labels longest-first, so e.g. "not_sarcastic" is matched
            # before "sarcastic" (otherwise "not_sarcastic" would incorrectly
            # match the substring "sarcastic" first).
            for label in sorted(labels, key=len, reverse=True):
                if label in content_clean:
                    return label

            # If neither label matched cleanly, flag it for manual review
            # rather than silently guessing.
            return f"[UNPARSEABLE: {content_clean[:50]}]"

        except Exception as e:
            print(f"    Attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(3)
            else:
                return f"[ERROR: {e}]"


def main(input_csv, output_csv):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GROQ_API_KEY environment variable not set. "
            "Run: export GROQ_API_KEY=\"your_key_here\" before running this script."
        )

    client = Groq(api_key=api_key)

    df = pd.read_csv(input_csv)
    print(f"Loaded {len(df)} stimuli from {input_csv}.\n")

    llm_predictions = []

    for idx, row in df.iterrows():
        text = row["text"]
        task = row["task"]
        true_label = row["true_label"]

        print(f"[{idx + 1}/{len(df)}] task={task}")
        prediction = classify(client, text, task)
        llm_predictions.append(prediction)
        print(f"    True: {true_label} | LLM predicted: {prediction}\n")

        time.sleep(1)  # stay within free-tier rate limits

    df["llm_predicted_label"] = llm_predictions
    df.to_csv(output_csv, index=False)
    print(f"Saved raw predictions to: {output_csv}\n")

    # ---- Descriptive accuracy / macro-F1 per task ----
    print("=" * 60)
    print("DESCRIPTIVE COMPARISON: LLM vs. DistilBERT")
    print("(DistilBERT metrics are from fine-tuning on the full validation")
    print(" set; LLM metrics below are computed only on these 30 stimuli,")
    print(" so they are not directly comparable in an apples-to-apples")
    print(" sense -- report both numbers with this caveat in the paper.)")
    print("=" * 60)

    unparseable_count = df["llm_predicted_label"].astype(str).str.startswith("[").sum()
    if unparseable_count > 0:
        print(f"\nWARNING: {unparseable_count} prediction(s) were unparseable or errored. "
              f"These are excluded from the metrics below and should be reviewed manually.\n")

    for task in df["task"].unique():
        task_df = df[df["task"] == task].copy()
        valid_df = task_df[~task_df["llm_predicted_label"].astype(str).str.startswith("[")]

        if len(valid_df) == 0:
            print(f"\n{task}: no valid predictions to compute metrics.")
            continue

        acc = accuracy_score(valid_df["true_label"], valid_df["llm_predicted_label"])
        f1 = f1_score(valid_df["true_label"], valid_df["llm_predicted_label"], average="macro")

        print(f"\n{task} (n={len(valid_df)}/{len(task_df)} valid predictions):")
        print(f"  LLM accuracy: {acc:.3f} | LLM macro F1: {f1:.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="selected_stimuli.csv")
    parser.add_argument("--output", default="llm_predictions.csv")
    args = parser.parse_args()

    main(args.input, args.output)
