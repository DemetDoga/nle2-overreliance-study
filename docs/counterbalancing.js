/**
 * counterbalancing.js
 *
 * Assigns each participant to one of the 6 possible orderings of the
 * three Explanation conditions (Control, Standard NLE, Cognitive Forcing
 * NLE). Task Subjectivity order (Sentiment -> Irony -> Sarcasm) is kept
 * FIXED for every participant, since the increasing-subjectivity order
 * is part of the study's design logic (H1), not a source of order-effect
 * risk we need to counterbalance away.
 *
 * Assignment is deterministic given a participant ID, so re-loading the
 * page (e.g., after an accidental refresh) does not reassign a
 * participant to a different order.
 *
 * Works in both Node (via require, for testing) and the browser (via a
 * plain <script> tag, exposing window.Counterbalancing).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.Counterbalancing = mod;
  }
})(typeof window !== "undefined" ? window : global, function () {

const EXPLANATION_CONDITIONS = ["control", "standard_nle", "cognitive_forcing_nle"];

/**
 * Returns all permutations of a given array. For 3 items this returns
 * exactly 6 permutations (3! = 6).
 */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

const ALL_ORDERS = permutations(EXPLANATION_CONDITIONS);

/**
 * A simple, deterministic string hash (djb2 algorithm), used to convert
 * a participant ID string into a number for order assignment.
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Given a participant ID (e.g., a Prolific/jsPsych-generated ID, or a
 * simple incrementing counter), returns that participant's explanation
 * order as an array of 3 condition names, e.g.
 * ["standard_nle", "cognitive_forcing_nle", "control"].
 */
function getExplanationOrder(participantId) {
  const index = hashString(String(participantId)) % ALL_ORDERS.length;
  return ALL_ORDERS[index];
}

/**
 * Fixed subjectivity order, per the design rationale above.
 */
function getSubjectivityOrder() {
  return ["sentiment", "irony", "sarcasm"];
}

return {
  EXPLANATION_CONDITIONS,
  ALL_ORDERS,
  getExplanationOrder,
  getSubjectivityOrder,
  hashString,
};
});
