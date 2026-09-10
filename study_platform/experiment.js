/**
 * experiment.js
 *
 * Browser-only file: translates the pure-data timeline spec (from
 * build_timeline_spec.js) into actual jsPsych plugin trials, and runs
 * the experiment. This file is intentionally kept thin/mechanical --
 * all the ordering and content-assembly logic it depends on was
 * already unit-tested in Node (see trial_builder.js and
 * build_timeline_spec.js).
 *
 * Requires (loaded via <script> tags in index.html, in this order):
 *   - jsPsych core + plugins (CDN)
 *   - simple_csv_parser.js
 *   - counterbalancing.js
 *   - trial_builder.js
 *   - build_timeline_spec.js
 *   - STIMULI_DATA and NLE_DATA (embedded data, see stimuli_data.js)
 */

function generateParticipantId() {
  // Simple unique ID: timestamp + random suffix. Used only for
  // deterministic counterbalancing assignment (see counterbalancing.js)
  // and for labeling the exported data file.
  return "p_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Converts a raw model confidence score into a verbal category rather
 * than displaying the raw percentage directly. This preserves genuine,
 * model-derived information (the underlying score still drives the bar
 * width) while avoiding a very low-looking number (e.g., "51%") from
 * unintentionally signaling "the AI itself is unsure" in a way that
 * could suppress the over-reliance effect the study aims to measure.
 * Thresholds are based on the observed confidence range across the 30
 * stimuli (roughly 0.40-0.70).
 */
function getConfidenceLabel(confidence) {
  if (confidence >= 0.7) return "Highly confident";
  if (confidence >= 0.55) return "Fairly confident";
  return "Moderate confidence";
}

function screenToJsPsychTrial(screen, jsPsych) {
  switch (screen.type) {
    case "instructions":
      return {
        type: jsPsychInstructions,
        pages: [`<div class="instructions">${screen.text}</div>`],
        show_clickable_nav: true,
        data: { screen_type: "instructions" },
      };

    case "block_intro":
      return {
        type: jsPsychInstructions,
        pages: [`<div class="block-intro">${screen.text}</div>`],
        show_clickable_nav: true,
        data: {
          screen_type: "block_intro",
          block_index: screen.block_index,
          explanation_condition: screen.explanation_condition,
        },
      };

    case "judgment1":
      return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `<div class="task-label">${capitalize(screen.subjectivity)}</div>
                   <div class="stimulus-text">"${screen.text}"</div>
                   <p class="prompt-text">What is your judgment?</p>`,
        choices: screen.options.map((o) => o.display),
        data: {
          screen_type: "judgment1",
          trial_number: screen.trial_number,
          subjectivity: screen.subjectivity,
          explanation_condition: screen.explanation_condition,
          option_values: screen.options.map((o) => o.value),
        },
        on_finish: function (data) {
          data.initial_judgment = data.option_values[data.response];
        },
      };

    case "reveal": {
      const explanationHtml = screen.explanation_text
        ? `<div class="ai-explanation" id="ai-explanation-text" style="visibility: hidden;">${screen.explanation_text}</div>`
        : "";
      const confidencePercent = Math.round(screen.confidence * 100);
      const confidenceLabel = getConfidenceLabel(screen.confidence);
      return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `<div class="task-label">${capitalize(screen.subjectivity)}</div>
                   <div class="stimulus-text">"${screen.text}"</div>
                   <div id="ai-thinking" class="ai-thinking">
                     <span class="ai-thinking-dots">AI is analyzing<span>.</span><span>.</span><span>.</span></span>
                   </div>
                   <div id="ai-prediction-box" class="ai-prediction" style="visibility: hidden;">
                     <span class="ai-prediction-label">AI prediction</span>
                     <span class="ai-prediction-value">${screen.shown_label_display}</span>
                     <div class="ai-confidence-row">
                       <div class="ai-confidence-bar-track">
                         <div class="ai-confidence-bar-fill" style="width: ${confidencePercent}%;"></div>
                       </div>
                       <span class="ai-confidence-text">${confidenceLabel}</span>
                     </div>
                   </div>
                   ${explanationHtml}`,
        choices: ["Continue"],
        data: {
          screen_type: "reveal",
          trial_number: screen.trial_number,
          subjectivity: screen.subjectivity,
          explanation_condition: screen.explanation_condition,
          shown_label: screen.shown_label,
          confidence: screen.confidence,
          true_label: screen.true_label,
          correct_trial: screen.correct_trial,
        },
        on_load: function () {
          // Disable the Continue button until the "typing" reveal finishes,
          // so participants can't skip past the AI's prediction unseen.
          const btnContainer = document.querySelector(".jspsych-btn");
          if (btnContainer) btnContainer.disabled = true;

          setTimeout(() => {
            const thinkingEl = document.getElementById("ai-thinking");
            const predictionEl = document.getElementById("ai-prediction-box");
            const explanationEl = document.getElementById("ai-explanation-text");

            if (thinkingEl) thinkingEl.style.display = "none";
            if (predictionEl) predictionEl.style.visibility = "visible";
            if (explanationEl) explanationEl.style.visibility = "visible";
            if (btnContainer) btnContainer.disabled = false;
          }, 1200); // 1.2s "thinking" delay before the prediction appears
        },
      };
    }

    case "judgment2":
      return {
        type: jsPsychHtmlButtonResponse,
        // stimulus is a FUNCTION here (jsPsych evaluates it at trial
        // run-time), because we need to look up the participant's own
        // Initial Judgment for this same trial_number -- that answer
        // does not exist yet when the timeline is built, only once the
        // judgment1 trial has actually run.
        stimulus: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgment =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;
          const agreesWithAi = initialJudgment !== null && initialJudgment === screen.shown_label;

          // Framing changes only; a Final Decision response is still
          // required either way -- this does not skip or shortcut data
          // collection, it only adjusts the wording of the prompt.
          const promptText = agreesWithAi
            ? "You gave the same answer as the AI. Do you want to keep your answer?"
            : "What is your final judgment?";

          return `<div class="task-label">${capitalize(screen.subjectivity)}</div>
                  <div class="stimulus-text">"${screen.text}"</div>
                  <p class="prompt-text">${promptText}</p>`;
        },
        choices: screen.options.map((o) => o.display),
        data: {
          screen_type: "judgment2",
          trial_number: screen.trial_number,
          subjectivity: screen.subjectivity,
          explanation_condition: screen.explanation_condition,
          true_label: screen.true_label,
          shown_label: screen.shown_label,
          correct_trial: screen.correct_trial,
          option_values: screen.options.map((o) => o.value),
        },
        on_finish: function (data) {
          data.final_decision = data.option_values[data.response];
          // over-reliance is only defined on incorrect-prediction trials:
          // did the participant's final decision match the AI's (incorrect) shown_label?
          if (!data.correct_trial) {
            data.over_relied = data.final_decision === data.shown_label;
          }
        },
      };

    case "attention_check":
      return {
        type: jsPsychHtmlButtonResponse,
        stimulus: `<p>${screen.text}</p>`,
        choices: screen.options.map((o) => o.display),
        data: {
          screen_type: "attention_check",
          option_values: screen.options.map((o) => o.value),
          correct_value: screen.correct_value,
        },
        on_finish: function (data) {
          data.attention_check_response = data.option_values[data.response];
          data.attention_check_passed = data.attention_check_response === data.correct_value;
        },
      };

    case "likert_block": {
      const questions = screen.items.map((item) => ({
        prompt: item.text,
        labels: screen.scale_labels,
        name: item.id,
      }));
      return {
        type: jsPsychSurveyLikert,
        questions,
        data: {
          screen_type: "likert_block",
          block_index: screen.block_index,
          explanation_condition: screen.explanation_condition,
        },
      };
    }

    case "demographics": {
      const htmlItems = screen.items.map((item) => {
        if (item.input_type === "select") {
          const opts = item.options.map((o) => `<option value="${o}">${o}</option>`).join("");
          return `<p>${item.label}<br><select name="${item.id}">${opts}</select></p>`;
        }
        return `<p>${item.label}<br><input type="${item.input_type}" name="${item.id}" /></p>`;
      });
      return {
        type: jsPsychSurveyHtmlForm,
        html: htmlItems.join(""),
        data: { screen_type: "demographics" },
      };
    }

    default:
      throw new Error(`Unknown screen type: ${screen.type}`);
  }
}

function runExperiment() {
  const participantId = generateParticipantId();

  const stimuliRows = window.STIMULI_ROWS; // from stimuli_data.js
  const nleRows = window.NLE_ROWS; // from stimuli_data.js

  const { mergeStimuliAndNle, buildTrialSequence } = window.TrialBuilder;
  const { buildTimelineSpec } = window.TimelineSpec;

  const merged = mergeStimuliAndNle(stimuliRows, nleRows);
  const trials = buildTrialSequence(merged, participantId);
  const spec = buildTimelineSpec(trials);

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_finish: function () {
      jsPsych.data.get().localSave("csv", `data_${participantId}.csv`);
    },
  });

  const timeline = spec.map((screen) => screenToJsPsychTrial(screen, jsPsych));

  jsPsych.data.addProperties({ participant_id: participantId });
  jsPsych.run(timeline);
}

window.addEventListener("DOMContentLoaded", runExperiment);