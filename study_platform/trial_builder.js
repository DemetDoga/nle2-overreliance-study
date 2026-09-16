/**
 * trial_builder.js - Revised Design (Fully Counterbalanced Explanation Order, Fixed 10-Item Splitting, 30 Total Trials)
 *
 * Changes:
 *   - All 3 explanation conditions (Control, Standard NLE, Cognitive
 *     Forcing NLE) are fully counterbalanced across participants (all
 *     6 possible orderings used), removing any fixed-position order
 *     confound.
 *   - Exactly 30 items are split evenly into 3 Sets (A, B, C) of 10 items each.
 *   - Participant sees each item exactly ONCE (no repetition / no memorization).
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.TrialBuilder = mod;
  }
})(typeof window !== "undefined" ? window : global, function () {

function hashSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

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
      confidence: parseFloat(stim.confidence),
      standard_nle: nle.standard_nle,
      cognitive_forcing_nle: nle.cognitive_forcing_nle,
    };
  });
}

function getExplanationText(stimulus, explanationCondition) {
  if (explanationCondition === "control") return null;
  if (explanationCondition === "standard_nle") return stimulus.standard_nle;
  if (explanationCondition === "cognitive_forcing_nle") return stimulus.cognitive_forcing_nle;
  throw new Error(`Unknown explanation condition: ${explanationCondition}`);
}

/**
 * Returns one of the 6 possible orderings of the 3 explanation
 * conditions, deterministically chosen from the participant's seed so
 * that all 6 permutations are used roughly equally often across the
 * full sample -- Control is no longer fixed to any position, removing
 * the order confound between explanation content and trial position.
 */
function getExplanationOrder(participantId) {
  const ALL_ORDERS = [
    ["control", "standard_nle", "cognitive_forcing_nle"],
    ["control", "cognitive_forcing_nle", "standard_nle"],
    ["standard_nle", "control", "cognitive_forcing_nle"],
    ["standard_nle", "cognitive_forcing_nle", "control"],
    ["cognitive_forcing_nle", "control", "standard_nle"],
    ["cognitive_forcing_nle", "standard_nle", "control"],
  ];
  const seedNum = hashSeed(String(participantId));
  return ALL_ORDERS[seedNum % 6];
}

/**
 * Assigns items into 3 Sets (A, B, C) ensuring EXACTLY 10 items per set.
 * Balanced task distribution: Each set gets 10 items total.
 */
/**
 * Assigns items into 3 Sets (A, B, C) ensuring EXACTLY 10 items per
 * set, AND ensuring each set gets a balanced mix of correct-trial and
 * incorrect-trial items (not just a positional slice of the raw list,
 * which could accidentally group all-correct or all-incorrect items
 * into the same set -- since over_relied is only computed for
 * incorrect_trial items, an unbalanced set would make over-reliance
 * unmeasurable in whichever explanation condition receives it).
 */
function assignItemSets(mergedStimuli) {
  const byTask = { sentiment: [], irony: [], sarcasm: [] };
  mergedStimuli.forEach((stim) => {
    if (byTask[stim.task]) byTask[stim.task].push(stim);
  });

  const setA = [], setB = [], setC = [];
  const targets = [setA, setB, setC];

  // For each task, [countA, countB, countC] (must sum to 10) and the
  // matching [correctA, correctB, correctC] sub-split (must sum to 5,
  // the number of correct-trial items per task), chosen so every
  // set's share is as close to a 50/50 correct/incorrect mix as the
  // integer counts allow.
  const TASK_SPLITS = {
    sentiment: { counts: [3, 3, 4], correctCounts: [2, 1, 2] }, // incorrect: [1,2,2]
    irony: { counts: [3, 4, 3], correctCounts: [2, 2, 1] }, // incorrect: [1,2,2]
    sarcasm: { counts: [4, 3, 3], correctCounts: [1, 2, 2] }, // incorrect: [3,1,1]
  };

  for (const task of ["sentiment", "irony", "sarcasm"]) {
    const items = byTask[task];
    const correctItems = items.filter((i) => i.correct_trial === true);
    const incorrectItems = items.filter((i) => i.correct_trial !== true);

    if (correctItems.length !== 5 || incorrectItems.length !== 5) {
      throw new Error(
        `Expected exactly 5 correct + 5 incorrect items for task "${task}", ` +
        `got ${correctItems.length} correct + ${incorrectItems.length} incorrect.`
      );
    }

    const { counts, correctCounts } = TASK_SPLITS[task];
    let correctIdx = 0;
    let incorrectIdx = 0;

    for (let i = 0; i < 3; i++) {
      const takeCorrect = correctCounts[i];
      const takeIncorrect = counts[i] - takeCorrect;

      targets[i].push(...correctItems.slice(correctIdx, correctIdx + takeCorrect));
      correctIdx += takeCorrect;
      targets[i].push(...incorrectItems.slice(incorrectIdx, incorrectIdx + takeIncorrect));
      incorrectIdx += takeIncorrect;
    }
  }

  return { A: setA, B: setB, C: setC };
}

function getItemSetOrder(participantId) {
  const seedNum = hashSeed(String(participantId));
  const group = seedNum % 3;
  if (group === 0) return ["A", "B", "C"];
  if (group === 1) return ["B", "C", "A"];
  return ["C", "A", "B"];
}

function buildTrialSequence(mergedStimuli, participantId) {
  const subjectivityOrder = ["sentiment", "irony", "sarcasm"];
  const explanationOrder = getExplanationOrder(participantId);
  const itemSetOrder = getItemSetOrder(participantId);
  const sets = assignItemSets(mergedStimuli);

  const trials = [];
  let trialNumber = 1;

  for (let b = 0; b < 3; b++) {
    const explanationCondition = explanationOrder[b];
    const currentSetKey = itemSetOrder[b];
    const currentSetItems = sets[currentSetKey];

    const itemsByTask = { sentiment: [], irony: [], sarcasm: [] };
    currentSetItems.forEach((item) => itemsByTask[item.task].push(item));

    for (const task of subjectivityOrder) {
      const taskItems = shuffleDeterministic(
        itemsByTask[task],
        String(participantId) + "|" + explanationCondition + "|" + task
      );

      for (const stim of taskItems) {
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