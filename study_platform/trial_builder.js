/**
 * trial_builder.js
 *
 * Two responsibilities:
 *   1. mergeStimuliAndNle(stimuliRows, nleRows) -- joins the two CSVs
 *      (selected_stimuli.csv and nle_explanations.csv) on task+text,
 *      producing one array of stimulus objects that each carry their
 *      own standard_nle and cognitive_forcing_nle text.
 *   2. buildTrialSequence(mergedStimuli, participantId) -- expands
 *      those stimuli into the full 90-trial sequence for one
 *      participant: for each of the 3 subjectivity blocks (fixed
 *      order) x 3 explanation conditions (counterbalanced order), the
 *      10 stimuli for that task are shown under that explanation
 *      condition.
 *
 * Depends on counterbalancing.js for order assignment.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.TrialBuilder = mod;
  }
})(typeof window !== "undefined" ? window : global, function () {

const Counterbalancing = typeof require === "function" ? require("./counterbalancing.js") : window.Counterbalancing;
const { getExplanationOrder, getSubjectivityOrder } = Counterbalancing;

/**
 * Joins stimuli rows with their NLE text. Both arrays are expected to
 * have "task" and "text" fields; nleRows additionally has
 * "standard_nle" and "cognitive_forcing_nle".
 */
/**
 * A simple, deterministic string hash (djb2 algorithm) used to seed
 * the shuffle below.
 */
function hashSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * A small, seeded pseudo-random number generator (mulberry32), so that
 * shuffle order is reproducible for a given seed string rather than
 * using Math.random() (which would reshuffle differently on every
 * page reload for the same participant).
 */
function seededRandom(seedString) {
  let a = hashSeed(seedString);
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a NEW array containing the same items in a deterministically
 * shuffled order, seeded by seedString (Fisher-Yates shuffle). The
 * input array is not mutated.
 */
function shuffleDeterministic(array, seedString) {
  const rng = seededRandom(seedString);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function mergeStimuliAndNle(stimuliRows, nleRows) {
  const nleByKey = new Map();
  for (const row of nleRows) {
    const key = row.task + "||" + row.text;
    nleByKey.set(key, row);
  }

  return stimuliRows.map((stim) => {
    const key = stim.task + "||" + stim.text;
    const nle = nleByKey.get(key);

    if (!nle) {
      throw new Error(
        `No NLE explanation found for stimulus (task=${stim.task}): "${stim.text.slice(0, 40)}..."`
      );
    }

    return {
      task: stim.task,
      text: stim.text,
      true_label: stim.true_label,
      shown_label: stim.shown_label,
      correct_trial: stim.correct_trial === "True" || stim.correct_trial === true,
      confidence: parseFloat(stim.confidence), // model's genuine softmax probability for shown_label
      standard_nle: nle.standard_nle,
      cognitive_forcing_nle: nle.cognitive_forcing_nle,
    };
  });
}

/**
 * Returns the explanation text to display for a given stimulus and
 * explanation condition. Control shows no explanation text at all.
 */
function getExplanationText(stimulus, explanationCondition) {
  if (explanationCondition === "control") return null;
  if (explanationCondition === "standard_nle") return stimulus.standard_nle;
  if (explanationCondition === "cognitive_forcing_nle") return stimulus.cognitive_forcing_nle;
  throw new Error(`Unknown explanation condition: ${explanationCondition}`);
}

/**
 * Builds the full ordered trial sequence for one participant.
 *
 * mergedStimuli: array of stimulus objects (from mergeStimuliAndNle),
 *   expected to contain exactly 10 stimuli per task (5 correct-trial,
 *   5 incorrect-trial), for tasks "sentiment", "irony", "sarcasm".
 * participantId: any string/number identifying this participant.
 *
 * Returns an array of 90 trial objects, each with:
 *   trial_number, subjectivity, explanation_condition, text,
 *   true_label, shown_label, correct_trial, explanation_text
 */
function buildTrialSequence(mergedStimuli, participantId) {
  const subjectivityOrder = getSubjectivityOrder(); // fixed: sentiment, irony, sarcasm
  const explanationOrder = getExplanationOrder(participantId); // counterbalanced per participant

  const stimuliByTask = {};
  for (const stim of mergedStimuli) {
    if (!stimuliByTask[stim.task]) stimuliByTask[stim.task] = [];
    stimuliByTask[stim.task].push(stim);
  }

  for (const task of subjectivityOrder) {
    const count = (stimuliByTask[task] || []).length;
    if (count !== 10) {
      throw new Error(`Expected exactly 10 stimuli for task "${task}", found ${count}.`);
    }
  }

  const trials = [];
  let trialNumber = 1;

  // Explanation condition is the outer loop here so that, within each
  // explanation block, all three subjectivity levels appear in their
  // fixed order -- i.e., the participant sees one full pass through
  // sentiment/irony/sarcasm under Explanation A, then again under
  // Explanation B, then again under Explanation C.
  for (const explanationCondition of explanationOrder) {
    for (const task of subjectivityOrder) {
      // Shuffle the 10 stimuli WITHIN this (explanationCondition, task)
      // cell only. This does not change the pre-registered structure --
      // the 9-cell block order (task and explanation sequencing) is
      // unchanged and still governed by counterbalancing -- it only
      // makes the item order within each 10-item cell less predictable,
      // seeded deterministically so the same participant always gets
      // the same item order on reload.
      const taskStimuli = shuffleDeterministic(
        stimuliByTask[task],
        String(participantId) + "|" + explanationCondition + "|" + task
      );

      for (const stim of taskStimuli) {
        trials.push({
          trial_number: trialNumber++,
          subjectivity: task,
          explanation_condition: explanationCondition,
          text: stim.text,
          true_label: stim.true_label,
          shown_label: stim.shown_label,
          correct_trial: stim.correct_trial,
          confidence: stim.confidence,
          explanation_text: getExplanationText(stim, explanationCondition),
        });
      }
    }
  }

  return trials;
}

return { mergeStimuliAndNle, getExplanationText, buildTrialSequence, shuffleDeterministic };
});