"""
Fine-tunes DistilBERT on three tasks (sentiment, irony, sarcasm), then
extracts model confidence scores on the test/validation split to identify
ambiguous ("intermediate confidence") sentences as candidate stimuli for
the user study.

Run this on a machine with an NVIDIA GPU (tested setup: RTX 3060, CUDA 12.1).

Install (already done in your venv):
    pip install torch --index-url https://download.pytorch.org/whl/cu121
    pip install transformers datasets accelerate scikit-learn pandas numpy

Usage:
    python finetune_distilbert.py --task sentiment
    python finetune_distilbert.py --task irony
    python finetune_distilbert.py --task sarcasm --data_path isarcasm2022.csv
"""

import argparse
import os
import numpy as np
import pandas as pd
import torch
from datasets import load_dataset, Dataset
from sklearn.metrics import accuracy_score, f1_score
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    DataCollatorWithPadding,
)

MODEL_NAME = "distilbert-base-uncased"
CONFIDENCE_LOW = 0.4
CONFIDENCE_HIGH = 0.6


def load_task_data(task, data_path=None):
    """
    Returns (train_texts, train_labels, eval_texts, eval_labels), and the
    number of classes for the given task.
    """

    if task == "sentiment":
        # SST-2 via HuggingFace datasets (GLUE benchmark)
        raw = load_dataset("stanfordnlp/sst2")
        train_texts = raw["train"]["sentence"]
        train_labels = raw["train"]["label"]
        eval_texts = raw["validation"]["sentence"]
        eval_labels = raw["validation"]["label"]
        num_labels = 2

    elif task == "irony":
        # SemEval-2018 Task 3 (irony detection), Task A (binary: ironic / not)
        # Loaded via the "tweet_eval" collection, which hosts this dataset.
        raw = load_dataset("cardiffnlp/tweet_eval", "irony")
        train_texts = raw["train"]["text"]
        train_labels = raw["train"]["label"]
        eval_texts = raw["validation"]["text"]
        eval_labels = raw["validation"]["label"]
        num_labels = 2

    elif task == "sarcasm":
        # iSarcasmEval, loaded from a local CSV (see Section 6 of the
        # project plan; expects columns "tweet" and "sarcastic").
        if data_path is None:
            raise ValueError("For task='sarcasm', pass --data_path pointing to isarcasm2022.csv")

        df = pd.read_csv(data_path)
        df = df.dropna(subset=["tweet", "sarcastic"])
        df["sarcastic"] = df["sarcastic"].astype(int)

        # simple, fixed 80/20 split (not from the original benchmark's
        # official split, since iSarcasmEval's public release combines
        # train/test differently across versions -- document this choice
        # in the paper's reproducibility notes).
        df = df.sample(frac=1.0, random_state=42).reset_index(drop=True)
        split_idx = int(0.8 * len(df))
        train_texts = df["tweet"][:split_idx].tolist()
        train_labels = df["sarcastic"][:split_idx].tolist()
        eval_texts = df["tweet"][split_idx:].tolist()
        eval_labels = df["sarcastic"][split_idx:].tolist()
        num_labels = 2

    else:
        raise ValueError(f"Unknown task: {task}")

    return train_texts, train_labels, eval_texts, eval_labels, num_labels


def tokenize_dataset(texts, labels, tokenizer, max_length=128):
    encodings = tokenizer(
        list(texts),
        truncation=True,
        max_length=max_length,
        padding=False,
    )
    dataset = Dataset.from_dict(
        {
            "input_ids": encodings["input_ids"],
            "attention_mask": encodings["attention_mask"],
            "label": list(labels),
        }
    )
    return dataset


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)
    return {
        "accuracy": accuracy_score(labels, predictions),
        "macro_f1": f1_score(labels, predictions, average="macro"),
    }


def finetune(task, data_path=None, output_dir=None, epochs=3, batch_size=16, lr=2e-5):
    print(f"\n=== Fine-tuning DistilBERT for task: {task} ===\n")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    train_texts, train_labels, eval_texts, eval_labels, num_labels = load_task_data(task, data_path)
    print(f"Train examples: {len(train_texts)} | Eval examples: {len(eval_texts)}")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, num_labels=num_labels)

    train_dataset = tokenize_dataset(train_texts, train_labels, tokenizer)
    eval_dataset = tokenize_dataset(eval_texts, eval_labels, tokenizer)

    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)

    if output_dir is None:
        output_dir = f"./distilbert_{task}"

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=lr,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        logging_steps=50,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
    )

    trainer.train()
    metrics = trainer.evaluate()
    print(f"\nFinal eval metrics for {task}: {metrics}\n")

    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"Model saved to: {output_dir}")

    return trainer, tokenizer, eval_texts, eval_labels


def extract_confidence_and_filter(trainer, tokenizer, texts, labels, task, output_csv=None):
    """
    Runs the fine-tuned model over the eval set, extracts the predicted
    class's softmax probability (confidence), and flags sentences whose
    confidence falls in the intermediate [0.4, 0.6] range as candidate
    stimuli (per the project plan's confidence-based selection strategy).
    """

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = trainer.model.to(device)
    model.eval()

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
                        "is_candidate_stimulus": CONFIDENCE_LOW <= conf <= CONFIDENCE_HIGH,
                    }
                )

    results_df = pd.DataFrame(results)

    n_candidates = results_df["is_candidate_stimulus"].sum()
    print(f"\n{task}: {n_candidates} / {len(results_df)} sentences fall in the "
          f"[{CONFIDENCE_LOW}, {CONFIDENCE_HIGH}] confidence range.")

    if output_csv is None:
        output_csv = f"./confidence_scores_{task}.csv"
    results_df.to_csv(output_csv, index=False)
    print(f"Full confidence scores saved to: {output_csv}")

    candidates_csv = output_csv.replace(".csv", "_candidates_only.csv")
    results_df[results_df["is_candidate_stimulus"]].to_csv(candidates_csv, index=False)
    print(f"Candidate stimuli (intermediate confidence) saved to: {candidates_csv}")

    return results_df


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fine-tune DistilBERT and extract confidence-based stimuli.")
    parser.add_argument("--task", required=True, choices=["sentiment", "irony", "sarcasm"])
    parser.add_argument("--data_path", default=None, help="Required for --task sarcasm (path to isarcasm2022.csv)")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    args = parser.parse_args()

    trainer, tokenizer, eval_texts, eval_labels = finetune(
        task=args.task,
        data_path=args.data_path,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
    )

    extract_confidence_and_filter(trainer, tokenizer, eval_texts, eval_labels, args.task)
