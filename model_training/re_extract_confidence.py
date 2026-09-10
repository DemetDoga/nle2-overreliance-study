"""
Re-extracts confidence scores from an ALREADY fine-tuned model (no
re-training), using a wider confidence threshold. Use this when the
default [0.4, 0.6] range does not yield enough candidate stimuli.

Usage:
    python re_extract_confidence.py --task sentiment --model_dir ./distilbert_sentiment --low 0.35 --high 0.65
"""

import argparse
import torch
import pandas as pd
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForSequenceClassification


def load_eval_texts_labels(task, data_path=None):
    if task == "sentiment":
        raw = load_dataset("stanfordnlp/sst2")
        return raw["validation"]["sentence"], raw["validation"]["label"]

    elif task == "irony":
        raw = load_dataset("cardiffnlp/tweet_eval", "irony")
        return raw["validation"]["text"], raw["validation"]["label"]

    elif task == "sarcasm":
        if data_path is None:
            raise ValueError("For task='sarcasm', pass --data_path pointing to train.En.csv")
        df = pd.read_csv(data_path)
        df = df.dropna(subset=["tweet", "sarcastic"])
        df["sarcastic"] = df["sarcastic"].astype(int)
        df = df.sample(frac=1.0, random_state=42).reset_index(drop=True)
        split_idx = int(0.8 * len(df))
        return df["tweet"][split_idx:].tolist(), df["sarcastic"][split_idx:].tolist()

    else:
        raise ValueError(f"Unknown task: {task}")


def re_extract(task, model_dir, low, high, data_path=None, output_csv=None):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading model from {model_dir} on {device}...")

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir).to(device)
    model.eval()

    texts, labels = load_eval_texts_labels(task, data_path)
    print(f"Loaded {len(texts)} evaluation examples for task '{task}'.")

    results = []
    batch_size = 32

    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i : i + batch_size]
            batch_labels = labels[i : i + batch_size]

            encodings = tokenizer(
                list(batch_texts),
                truncation=True,
                max_length=128,
                padding=True,
                return_tensors="pt",
            ).to(device)

            logits = model(**encodings).logits
            probs = torch.softmax(logits, dim=-1)
            confidences, predictions = torch.max(probs, dim=-1)

            for text, true_label, pred, conf in zip(
                batch_texts, batch_labels, predictions.cpu().tolist(), confidences.cpu().tolist()
            ):
                results.append(
                    {
                        "text": text,
                        "true_label": true_label,
                        "predicted_label": pred,
                        "confidence": conf,
                        "is_candidate_stimulus": low <= conf <= high,
                    }
                )

    results_df = pd.DataFrame(results)
    n_candidates = results_df["is_candidate_stimulus"].sum()
    n_correct_candidates = results_df[
        results_df["is_candidate_stimulus"] & (results_df["true_label"] == results_df["predicted_label"])
    ].shape[0]
    n_incorrect_candidates = n_candidates - n_correct_candidates

    print(f"\n{task}: {n_candidates} sentences fall in the [{low}, {high}] confidence range "
          f"({n_correct_candidates} correctly predicted, {n_incorrect_candidates} incorrectly predicted).")

    if output_csv is None:
        output_csv = f"./confidence_scores_{task}_widened.csv"
    results_df.to_csv(output_csv, index=False)

    candidates_csv = output_csv.replace(".csv", "_candidates_only.csv")
    results_df[results_df["is_candidate_stimulus"]].to_csv(candidates_csv, index=False)
    print(f"Saved: {output_csv}")
    print(f"Saved: {candidates_csv}")

    return results_df


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", required=True, choices=["sentiment", "irony", "sarcasm"])
    parser.add_argument("--model_dir", required=True, help="Path to the already fine-tuned model directory")
    parser.add_argument("--data_path", default=None, help="Required for --task sarcasm")
    parser.add_argument("--low", type=float, default=0.35)
    parser.add_argument("--high", type=float, default=0.65)
    args = parser.parse_args()

    re_extract(args.task, args.model_dir, args.low, args.high, args.data_path)
