/**
 * build_timeline_spec.js
 *
 * Builds a plain-data "timeline specification" -- an ordered array of
 * screen descriptions -- from the 90-trial sequence produced by
 * trial_builder.js. This file has NO dependency on jsPsych itself, so
 * its logic (ordering, screen counts, content assembly) can be fully
 * unit-tested in Node before ever touching a browser.
 *
 * experiment.js (browser-only) consumes this spec and translates each
 * entry into an actual jsPsych plugin trial.
 *
 * Screen types produced:
 *   "instructions"      - one-time intro screen
 *   "block_intro"        - shown once at the start of each of the 3
 *                          explanation-condition blocks
 *   "judgment1"           - participant's Initial Judgment for one item
 *   "reveal"              - shows the AI's prediction (+ explanation,
 *                          if the condition has one)
 *   "judgment2"           - participant's Final Decision for the same item
 *   "attention_check"     - one instructed-response check, inserted
 *                          between block 1 and block 2
 *   "likert_block"        - Perceived Trust / Mental Demand / Perceived
 *                          Utility questions, shown once after each of
 *                          the 3 explanation blocks (so ratings reflect
 *                          the condition just experienced)
 *   "demographics"        - age + education, shown once at the very end
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.TimelineSpec = mod;
  }
})(typeof window !== "undefined" ? window : global, function () {

const TASK_LABELS = {
  sentiment: { positive: "Positive", negative: "Negative" },
  irony: { ironic: "Ironic", not_ironic: "Not Ironic" },
  sarcasm: { sarcastic: "Sarcastic", not_sarcastic: "Not Sarcastic" },
};

const EXPLANATION_CONDITION_NAMES = {
  control: "Control",
  standard_nle: "Standard Explanation",
  cognitive_forcing_nle: "Cognitive Forcing Explanation",
};

function labelOptionsForTask(task) {
  const labels = TASK_LABELS[task];
  if (!labels) throw new Error(`Unknown task: ${task}`);
  return Object.keys(labels).map((key) => ({ value: key, display: labels[key] }));
}

/**
 * Builds the ordered timeline spec for one participant, given their
 * already-ordered 90-trial sequence (from trial_builder.js).
 */
function buildTimelineSpec(trials) {
  if (trials.length !== 90) {
    throw new Error(`Expected exactly 90 trials, got ${trials.length}.`);
  }

  const spec = [];

  spec.push({
    type: "instructions",
    text:
      "In this study, you will read a series of short sentences and judge their intended meaning. " +
      "For each sentence, you will first give your own judgment, then see an AI system's prediction, " +
      "and then give your final judgment. Please read each sentence carefully.",
  });

  // Split the 90 trials into their 3 explanation-condition blocks of 30.
  const blocks = [trials.slice(0, 30), trials.slice(30, 60), trials.slice(60, 90)];

  blocks.forEach((block, blockIndex) => {
    const explanationCondition = block[0].explanation_condition;
    const allSameCondition = block.every((t) => t.explanation_condition === explanationCondition);
    if (!allSameCondition) {
      throw new Error(`Block ${blockIndex} does not have a single, consistent explanation condition.`);
    }

    spec.push({
      type: "block_intro",
      block_index: blockIndex,
      explanation_condition: explanationCondition,
      text: `You will now see ${block.length} sentences. Please read each one and give your judgment.`,
    });

    block.forEach((trial) => {
      const options = labelOptionsForTask(trial.subjectivity);

      spec.push({
        type: "judgment1",
        trial_number: trial.trial_number,
        subjectivity: trial.subjectivity,
        explanation_condition: trial.explanation_condition,
        text: trial.text,
        options,
      });

      spec.push({
        type: "reveal",
        trial_number: trial.trial_number,
        subjectivity: trial.subjectivity,
        explanation_condition: trial.explanation_condition,
        text: trial.text,
        shown_label: trial.shown_label,
        shown_label_display: TASK_LABELS[trial.subjectivity][trial.shown_label],
        confidence: trial.confidence, // genuine model softmax probability, not invented
        explanation_text: trial.explanation_text, // null for control
        true_label: trial.true_label, // kept for data logging, not shown to participant
        correct_trial: trial.correct_trial,
      });

      spec.push({
        type: "judgment2",
        trial_number: trial.trial_number,
        subjectivity: trial.subjectivity,
        explanation_condition: trial.explanation_condition,
        text: trial.text,
        options,
        true_label: trial.true_label,
        shown_label: trial.shown_label,
        correct_trial: trial.correct_trial,
      });
    });

    // Attention check: inserted once, right after the first block ends
    // (i.e., after 30 real trials = 90 screens so far), per the
    // pre-registered design ("a comprehension question inserted among
    // the stimuli").
    if (blockIndex === 0) {
      spec.push({
        type: "attention_check",
        text:
          "To confirm you are reading carefully, please select the option below that says " +
          '"I am reading carefully."',
        options: [
          { value: "correct", display: "I am reading carefully." },
          { value: "incorrect_a", display: "I like online shopping." },
          { value: "incorrect_b", display: "This is a weather report." },
        ],
        correct_value: "correct",
      });
    }

    spec.push({
      type: "likert_block",
      block_index: blockIndex,
      explanation_condition: explanationCondition,
      items: [
        {
          id: "trust",
          text: `I trust this AI system's predictions for this type of task.`,
        },
        {
          id: "mental_demand",
          text: "I found this task mentally demanding.",
        },
        {
          id: "utility",
          text: "The information shown (prediction and/or explanation) was useful for making my decision.",
        },
      ],
      scale: [1, 2, 3, 4, 5],
      scale_labels: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"],
    });
  });

  spec.push({
    type: "demographics",
    items: [
      { id: "age", label: "What is your age?", input_type: "number" },
      {
        id: "education",
        label: "What is your highest completed level of education?",
        input_type: "select",
        options: [
          "High school",
          "Bachelor's degree",
          "Master's degree",
          "Doctorate",
          "Other",
        ],
      },
    ],
  });

  return spec;
}

return { buildTimelineSpec, TASK_LABELS, EXPLANATION_CONDITION_NAMES, labelOptionsForTask };
});
