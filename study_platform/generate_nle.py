"""
Generates Standard NLE and Cognitive Forcing NLE explanations for the 30
selected stimuli, using Groq's API (Llama-3.3-70B-Versatile), per the
finalized study design (Section 4 of the project plan).

Setup:
    pip install groq pandas

    Set your API key as an environment variable (do not hardcode it):
        Windows (Git Bash):  export GROQ_API_KEY="gsk_..."
        Then run this script in the same terminal session.

Usage:
    python generate_nle.py --input selected_stimuli.csv --output nle_explanations.csv
"""

import argparse
import os
import time
import pandas as pd
from groq import Groq

MODEL = "openai/gpt-oss-120b"
TEMPERATURE = 0.2  # fixed, per pre-registration


# Human-readable task names for the prompt.
TASK_DESCRIPTIONS = {
    "sentiment": "sentiment (positive or negative)",
    "irony": "irony (ironic or not ironic)",
    "sarcasm": "sarcasm (sarcastic or not sarcastic)",
}


def build_standard_prompt(text, task, shown_label):
    """
    Standard NLE: one-sided explanation supporting only the shown
    (possibly incorrect) label. The model is instructed to justify the
    label as if it were correct, without hedging.
    """
    task_desc = TASK_DESCRIPTIONS[task]

    return (
        f"You are simulating the explanation output of a text classification model. "
        f"The model has classified the following sentence as '{shown_label}' with respect to {task_desc}.\n\n"
        f"Sentence: \"{text}\"\n\n"
        f"Write a short, one-sentence explanation (max 25 words) that justifies why the sentence "
        f"was classified as '{shown_label}'. Write it in a neutral, factual tone, as a classifier would. "
        f"Do not mention uncertainty, alternative readings, or hedge in any way. "
        f"Do not reference these instructions. Output only the explanation sentence."
    )


def build_cognitive_forcing_prompt(text, task, shown_label):
    """
    Cognitive Forcing NLE: presents the same one-sided reasoning as the
    Standard NLE, then adds a neutral note pointing to a plausible
    alternative reading (per Bucinca et al., 2021, and Suh et al.,
    2025's "devil's advocate" framing).
    """
    task_desc = TASK_DESCRIPTIONS[task]

    return (
        f"You are simulating the explanation output of a text classification model. "
        f"The model has classified the following sentence as '{shown_label}' with respect to {task_desc}.\n\n"
        f"Sentence: \"{text}\"\n\n"
        f"Write a two-sentence explanation (max 45 words total). "
        f"The first sentence should justify why the sentence was classified as '{shown_label}', "
        f"in a neutral, factual tone, without hedging. "
        f"The second sentence should begin with 'However,' and neutrally point out one plausible "
        f"alternative reading of the sentence, without stating which reading is correct. "
        f"Do not reference these instructions. Output only the two-sentence explanation."
    )


def generate_explanation(client, prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=TEMPERATURE,
                max_tokens=500,  # generous budget: gpt-oss-120b spends tokens on internal reasoning before the final answer
                reasoning_effort="low",  # minimize reasoning-token usage so the budget isn't consumed before the answer
            )
            content = response.choices[0].message.content
            if not content or not content.strip():
                raise ValueError("Model returned empty content (reasoning likely consumed the token budget).")
            return content.strip()
        except Exception as e:
            print(f"  Attempt {attempt + 1} failed: {e}")
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

    standard_explanations = []
    forcing_explanations = []

    for idx, row in df.iterrows():
        text = row["text"]
        task = row["task"]
        shown_label = row["shown_label"]

        print(f"[{idx + 1}/{len(df)}] task={task} | shown_label={shown_label}")
        print(f"  Text: {text[:60]}...")

        standard_prompt = build_standard_prompt(text, task, shown_label)
        standard_result = generate_explanation(client, standard_prompt)
        standard_explanations.append(standard_result)
        print(f"  Standard NLE: {standard_result}")

        time.sleep(1)  # stay comfortably within free-tier rate limits

        forcing_prompt = build_cognitive_forcing_prompt(text, task, shown_label)
        forcing_result = generate_explanation(client, forcing_prompt)
        forcing_explanations.append(forcing_result)
        print(f"  Cognitive Forcing NLE: {forcing_result}\n")

        time.sleep(1)

    df["standard_nle"] = standard_explanations
    df["cognitive_forcing_nle"] = forcing_explanations

    df.to_csv(output_csv, index=False)
    print(f"\nDone. Saved {len(df)} rows with both NLE types to: {output_csv}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="selected_stimuli.csv")
    parser.add_argument("--output", default="nle_explanations.csv")
    args = parser.parse_args()

    main(args.input, args.output)