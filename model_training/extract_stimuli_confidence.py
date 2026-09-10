"""
Extracts DistilBERT's actual softmax confidence for the SHOWN label
(shown_label column) on each of the 30 selected stimuli, and adds it as
a new "confidence" column to selected_stimuli.csv.

This is the real, model-produced probability -- not an invented number
-- consistent with the pre-registration's requirement that displayed
confidence scores be genuine model output.

Usage:
    python extract_stimuli_confidence.py --input selected_stimuli.csv --output selected_stimuli_with_confidence.csv
"""

import argparse
import torch
import pandas as pd
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MODEL_DIRS = {
    "sentiment": "./distilbert_sentiment",
    "irony": "./distilbert_irony",
    "sarcasm": "./distilbert_sarcasm",
}

# Maps each task's string labels to the model's output class indices.
# IMPORTANT: this must match the label encoding used during fine-tuning.
# - sentiment (SST-2): 0 = negative, 1 = positive
# - irony (tweet_eval): 0 = not_ironic, 1 = ironic
# - sarcasm (iSarcasmEval "sarcastic" column): 0 = not_sarcastic, 1 = sarcastic
LABEL_TO_INDEX = {
    "sentiment": {"negative": 0, "positive": 1},
    "irony": {"not_ironic": 0, "ironic": 1},
    "sarcasm": {"not_sarcastic": 0, "sarcastic": 1},
}


def load_model(task):
    model_dir = MODEL_DIRS[task]
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    model.eval()
    return tokenizer, model, device


def get_confidence_for_shown_label(text, shown_label, task, tokenizer, model, device):
    """
    Returns the model's softmax probability for the SHOWN label
    specifically (which may be the model's top prediction, or may be
    the deliberately incorrect label for error-injection trials -- in
    either case, we display the model's genuine probability for
    whichever label is being shown to the participant).
    """
    encoding = tokenizer(
        text, truncation=True, max_length=128, return_tensors="pt", return_token_type_ids=False
    ).to(device)
    with torch.no_grad():
        logits = model(**encoding).logits
        probs = torch.softmax(logits, dim=-1)[0]

    label_index = LABEL_TO_INDEX[task][shown_label]
    return probs[label_index].item()


def main(input_csv, output_csv):
    df = pd.read_csv(input_csv)
    print(f"Loaded {len(df)} stimuli from {input_csv}.\n")

    models = {}
    confidences = []

    for idx, row in df.iterrows():
        task = row["task"]
        text = row["text"]
        shown_label = row["shown_label"]

        if task not in models:
            print(f"Loading model for task: {task}...")
            models[task] = load_model(task)

        tokenizer, model, device = models[task]
        confidence = get_confidence_for_shown_label(text, shown_label, task, tokenizer, model, device)
        confidences.append(confidence)

        print(f"[{idx + 1}/{len(df)}] task={task} | shown_label={shown_label} | confidence={confidence:.3f}")

    df["confidence"] = confidences
    df.to_csv(output_csv, index=False)
    print(f"\nSaved: {output_csv}")

    print("\nConfidence summary by task:")
    print(df.groupby("task")["confidence"].agg(["mean", "min", "max"]).round(3))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="selected_stimuli.csv")
    parser.add_argument("--output", default="selected_stimuli_with_confidence.csv")
    args = parser.parse_args()

    main(args.input, args.output)