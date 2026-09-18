/**
 * build_timeline_spec.js - Revised Design (30-Trial Spec)
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

function buildTimelineSpec(trials) {
  if (trials.length !== 30) {
    throw new Error(`Expected exactly 30 trials for revised design, got ${trials.length}.`);
  }

  const spec = [];

  spec.push({
    type: "instructions",
    text:
      "In this study, you will read a series of short sentences and judge their intended meaning. " +
      "For each sentence, you will first give your own judgment, then see an AI system's prediction, " +
      "and then give your final judgment. Please read each sentence carefully.",
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

  const blocks = [trials.slice(0, 10), trials.slice(10, 20), trials.slice(20, 30)];

  blocks.forEach((block, blockIndex) => {
    const explanationCondition = block[0].explanation_condition;

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
        confidence: trial.confidence,
        explanation_text: trial.explanation_text,
        true_label: trial.true_label,
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
        shown_label_display: TASK_LABELS[trial.subjectivity][trial.shown_label],
        confidence: trial.confidence,
        explanation_text: trial.explanation_text,
        correct_trial: trial.correct_trial,
      });
    });

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
          id: "trust_confident",
          text: "I am confident in this AI system.",
        },
        {
          id: "trust_reliable",
          text: "This AI system is reliable.",
        },
        {
          id: "trust_can_trust",
          text: "I can trust this AI system.",
        },
        {
          id: "mental_demand",
          text: "I found this task mentally demanding.",
        },
        {
          id: "utility_understand",
          text: "From this AI system's prediction/explanation, I understand how it works.",
        },
        {
          id: "utility_how_to_use",
          text: "This information tells me how to use it in making my decision.",
        },
        {
          id: "utility_useful",
          text: "This information is useful to my goals.",
        },
      ],
      scale: [1, 2, 3, 4, 5],
      scale_labels: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"],
    });
  });

  // Self-confidence in one's own interpretive ability -- asked once, at
  // the end (after participants have actually done the task), so the
  // question is grounded in their real experience rather than an
  // abstract, context-free self-assessment before starting. Used to
  // explore whether high self-confidence relates to lower over-reliance
  // (Lee & Moray, 1992; Dietvorst et al., 2015).
  spec.push({
    type: "self_confidence",
    items: [
      {
        id: "confidence_sentiment",
        text: "I am confident in my own ability to correctly judge the sentiment (positive/negative) of a piece of text.",
      },
      {
        id: "confidence_irony",
        text: "I am confident in my own ability to correctly detect irony in a piece of text.",
      },
      {
        id: "confidence_sarcasm",
        text: "I am confident in my own ability to correctly detect sarcasm in a piece of text.",
      },
    ],
    scale: [1, 2, 3, 4, 5],
    scale_labels: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"],
  });

  spec.push({
    type: "closing",
    text:
      "Thank you for participating in this study. Your responses have been recorded. " +
      "We appreciate the time and attention you gave to each question.",
  });

  return spec;
}

return { buildTimelineSpec, TASK_LABELS, EXPLANATION_CONDITION_NAMES, labelOptionsForTask };
});