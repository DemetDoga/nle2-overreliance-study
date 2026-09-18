/**
 * experiment.js - Automatic Data Saving Version with Fixed Self-Confidence Export
 */

function generateParticipantId() {
  return "p_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const DISPLAY_LABELS = {
  positive: "Positive",
  negative: "Negative",
  ironic: "Ironic",
  not_ironic: "Not Ironic",
  sarcastic: "Sarcastic",
  not_sarcastic: "Not Sarcastic",
};

function getConfidenceLabel(confidence) {
  if (confidence >= 0.60) return "HIGH CONFIDENCE";
  if (confidence >= 0.50) return "MEDIUM CONFIDENCE";
  return "MODERATE CONFIDENCE";
}

let dataSaved = false;

// Replace with your own Google Apps Script Web App URL (ends in /exec).
const DATA_COLLECTION_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbx509RWnO_lrkS4PKvVHccgP9zqbpriLHnF_FXYQiEg0MXmG90uYh2DQyO5U0iQivKxSA/exec";

function saveExperimentData(jsPsych, participantId) {
  if (dataSaved) return;
  dataSaved = true;

  const rows = jsPsych.data.get().values();

  // Content-Type "text/plain" keeps this a CORS "simple request" (no
  // preflight OPTIONS call, which Apps Script web apps don't handle),
  // while still letting us read the real response instead of an
  // opaque no-cors one.
  fetch(DATA_COLLECTION_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(rows),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Webhook responded with status ${response.status}`);
      console.log("Data submitted to central data collection.");
    })
    .catch((err) => {
      console.error("Central data submission failed, falling back to local CSV download:", err);
      jsPsych.data.get().localSave("csv", `data_${participantId}.csv`);
    });
}

function screenToJsPsychTrial(screen, jsPsych, participantId) {
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
        stimulus: `
          <div class="task-badge-wrapper">
            <span class="task-label">${capitalize(screen.subjectivity)} Task</span>
          </div>
          <div class="stimulus-card">
            <p class="stimulus-text">"${screen.text}"</p>
          </div>
          <p class="prompt-text">What is your initial judgment?</p>
        `,
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
      const confidenceLabel = getConfidenceLabel(screen.confidence);
      const explanationText = screen.explanation_text || "";

      return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgmentRaw =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;
          const initialJudgmentDisplay = DISPLAY_LABELS[initialJudgmentRaw] || initialJudgmentRaw || "";

          const explanationBlock = explanationText
            ? `<div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.06);"><span class="typing-cursor" id="ai-explanation-text"></span></div>`
            : "";

          return `
            <div class="task-badge-wrapper">
              <span class="task-label">${capitalize(screen.subjectivity)} Task</span>
            </div>
            <div class="chat-thread">
              <div class="chat-message chat-message--user">
                <div class="chat-bubble chat-bubble--user">
                  <span class="chat-quote">"${screen.text}"</span>
                  My judgment: <strong>${initialJudgmentDisplay}</strong>
                </div>
              </div>
              <div class="chat-message chat-message--ai" id="ai-thinking">
                <div class="chat-bubble chat-bubble--ai">
                  <span class="chat-label">AI System</span><br>
                  <div class="typing-dots"><span></span><span></span><span></span></div>
                </div>
              </div>
              <div class="chat-message chat-message--ai" id="ai-prediction-box" style="display: none;">
                <div class="chat-bubble chat-bubble--ai">
                  <div>
                    <span class="chat-label">AI System</span>
                    <span class="chat-confidence">${confidenceLabel}</span>
                  </div>
                  <div style="margin-top:4px;">
                    Prediction: <strong>${screen.shown_label_display}</strong>
                  </div>
                  ${explanationBlock}
                </div>
              </div>
            </div>
          `;
        },
        choices: ["Continue"],
        button_html: (choice) => `<button class="jspsych-btn hidden-next-btn" id="auto-next-btn">${choice}</button>`,
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
          const thinkingDelay = explanationText
            ? Math.min(700 + explanationText.length * 6, 1800)
            : 700;

          setTimeout(() => {
            const thinkingEl = document.getElementById("ai-thinking");
            const predictionEl = document.getElementById("ai-prediction-box");
            const explanationEl = document.getElementById("ai-explanation-text");

            if (thinkingEl) thinkingEl.style.display = "none";
            if (predictionEl) predictionEl.style.display = "flex";

            if (explanationEl && explanationText) {
              let i = 0;
              const typeSpeed = 16;
              const typingInterval = setInterval(() => {
                explanationEl.textContent = explanationText.slice(0, i + 1);
                i++;
                if (i >= explanationText.length) {
                  clearInterval(typingInterval);
                  explanationEl.classList.remove("typing-cursor");
                  setTimeout(() => {
                    const btn = document.getElementById("auto-next-btn");
                    if (btn) btn.click();
                  }, 800);
                }
              }, typeSpeed);
            } else {
              setTimeout(() => {
                const btn = document.getElementById("auto-next-btn");
                if (btn) btn.click();
              }, 1000);
            }
          }, thinkingDelay);
        },
      };
    }

    case "judgment2": {
      const metaTrialContent = {
        type: jsPsychHtmlButtonResponse,
        stimulus: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgmentRaw =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;
          const initialJudgmentDisplay = DISPLAY_LABELS[initialJudgmentRaw] || initialJudgmentRaw || "";
          const confidenceLabel = getConfidenceLabel(screen.confidence);

          const explanationMarkup = screen.explanation_text
            ? `<div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.06); color:var(--ink-soft); font-size:0.9rem;">${screen.explanation_text}</div>`
            : "";

          return `
            <div class="task-badge-wrapper">
              <span class="task-label">${capitalize(screen.subjectivity)} Task</span>
            </div>
            <div class="chat-thread">
              <div class="chat-message chat-message--user">
                <div class="chat-bubble chat-bubble--user">
                  <span class="chat-quote">"${screen.text}"</span>
                  My judgment: <strong>${initialJudgmentDisplay}</strong>
                </div>
              </div>
              <div class="chat-message chat-message--ai">
                <div class="chat-bubble chat-bubble--ai">
                  <div>
                    <span class="chat-label">AI System</span>
                    <span class="chat-confidence">${confidenceLabel}</span>
                  </div>
                  <div style="margin-top:4px;">
                    Prediction: <strong>${screen.shown_label_display}</strong>
                  </div>
                  ${explanationMarkup}
                  <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-subtle); font-size: 0.85rem; color: var(--ink-soft);">
                    The AI agrees with your judgment. Select an option to proceed:
                  </div>
                </div>
              </div>
            </div>
          `;
        },
        choices: ["Keep my answer", "Change my answer"],
        data: {
          screen_type: "judgment2_meta",
          trial_number: screen.trial_number,
          subjectivity: screen.subjectivity,
          explanation_condition: screen.explanation_condition,
        },
        on_finish: function (data) {
          if (data.response === 0) {
            const priorResponses = jsPsych.data
              .get()
              .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
              .values();
            const initialJudgment =
              priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;

            data.final_decision = initialJudgment;
            data.true_label = screen.true_label;
            data.shown_label = screen.shown_label;
            data.correct_trial = screen.correct_trial;
            if (!data.correct_trial) {
              data.over_relied = data.final_decision === data.shown_label;
            }
            data.screen_type = "judgment2";
          }
        },
      };

      const metaTrial = {
        timeline: [metaTrialContent],
        conditional_function: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgment =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;
          return initialJudgment !== null && initialJudgment === screen.shown_label;
        },
      };

      const labelChoiceTrialContent = {
        type: jsPsychHtmlButtonResponse,
        stimulus: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgmentRaw =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;
          const initialJudgmentDisplay = DISPLAY_LABELS[initialJudgmentRaw] || initialJudgmentRaw || "";
          const confidenceLabel = getConfidenceLabel(screen.confidence);

          const explanationMarkup = screen.explanation_text
            ? `<div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.06); color:var(--ink-soft); font-size:0.9rem;">${screen.explanation_text}</div>`
            : "";

          return `
            <div class="task-badge-wrapper">
              <span class="task-label">${capitalize(screen.subjectivity)} Task</span>
            </div>
            <div class="chat-thread">
              <div class="chat-message chat-message--user">
                <div class="chat-bubble chat-bubble--user">
                  <span class="chat-quote">"${screen.text}"</span>
                  My judgment: <strong>${initialJudgmentDisplay}</strong>
                </div>
              </div>
              <div class="chat-message chat-message--ai">
                <div class="chat-bubble chat-bubble--ai">
                  <div>
                    <span class="chat-label">AI System</span>
                    <span class="chat-confidence">${confidenceLabel}</span>
                  </div>
                  <div style="margin-top:4px;">
                    Prediction: <strong>${screen.shown_label_display}</strong>
                  </div>
                  ${explanationMarkup}
                  <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-subtle); font-size: 0.85rem; color: var(--ink-soft);">
                    The AI interpreted this differently than you. Would you like to keep your answer or change it?
                  </div>
                </div>
              </div>
            </div>
          `;
        },
        choices: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgmentRaw =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;

          return screen.options.map((o) => {
            const isInitial = o.value === initialJudgmentRaw;
            return isInitial ? `Keep "${o.display}"` : `Change to "${o.display}"`;
          });
        },
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
          if (!data.correct_trial) {
            data.over_relied = data.final_decision === data.shown_label;
          }
        },
      };

      const labelChoiceTrial = {
        timeline: [labelChoiceTrialContent],
        conditional_function: function () {
          const priorResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment1", trial_number: screen.trial_number })
            .values();
          const initialJudgment =
            priorResponses.length > 0 ? priorResponses[priorResponses.length - 1].initial_judgment : null;
          const agreesWithAi = initialJudgment !== null && initialJudgment === screen.shown_label;

          if (!agreesWithAi) return true;

          const metaResponses = jsPsych.data
            .get()
            .filter({ screen_type: "judgment2_meta", trial_number: screen.trial_number })
            .values();
          if (metaResponses.length === 0) return false;
          const metaChoice = metaResponses[metaResponses.length - 1].response;
          return metaChoice === 1;
        },
      };

      return { timeline: [metaTrial, labelChoiceTrial] };
    }

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
        required: true,
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

    case "self_confidence": {
      const questions = screen.items.map((item) => ({
        prompt: item.text,
        labels: screen.scale_labels,
        name: item.id,
        required: true,
      }));
      return {
        type: jsPsychSurveyLikert,
        questions,
        data: {
          screen_type: "self_confidence",
        },
        // DÜZELTME: CSV kaydı artık katılımcı bu son özgüven anketini bitirdiği an tetikleniyor!
        on_finish: function () {
          saveExperimentData(jsPsych, participantId);
        },
      };
    }

    case "demographics": {
      const htmlItems = screen.items.map((item) => {
        if (item.input_type === "select") {
          const opts = item.options
            .map((o) => `<option value="${o}">${o}</option>`)
            .join("");
          return `
            <div class="form-field">
              <label class="form-label">${item.label}</label>
              <select class="form-select" name="${item.id}" required>
                <option value="" disabled selected>Select an option</option>
                ${opts}
              </select>
            </div>`;
        }
        return `
          <div class="form-field">
            <label class="form-label">${item.label}</label>
            <input class="form-input" type="${item.input_type}" name="${item.id}" required />
          </div>`;
      });
      return {
        type: jsPsychSurveyHtmlForm,
        preamble: `
          <div class="task-badge-wrapper">
            <span class="task-label">Before You Begin</span>
          </div>
          <p class="prompt-text">A couple of quick questions before the main task.</p>
        `,
        html: htmlItems.join(""),
        button_label: "Continue",
        data: { screen_type: "demographics" },
      };
    }

    case "closing":
      return {
        type: jsPsychInstructions,
        pages: [
          `
          <div class="closing-screen" style="text-align: center; padding: 20px 0;">
            <div class="closing-icon" style="font-size: 3rem; color: var(--human); margin-bottom: 16px;">&#10003;</div>
            <h2 style="font-size: 1.5rem; color: var(--ink); margin-bottom: 12px;">You're all done!</h2>
            <p style="color: var(--ink-soft); font-size: 1rem; max-width: 480px; margin: 0 auto;">${screen.text}</p>
            <p style="margin-top: 24px; font-size: 0.85rem; color: var(--ink-muted);">You can now safely close this window.</p>
          </div>
          `
        ],
        show_clickable_nav: false, 
        data: { screen_type: "closing" },
      };

    default:
      throw new Error(`Unknown screen type: ${screen.type}`);
  }
}

function runExperiment() {
  const participantId = generateParticipantId();

  const stimuliRows = window.STIMULI_ROWS;
  const nleRows = window.NLE_ROWS;

  const { mergeStimuliAndNle, buildTrialSequence } = window.TrialBuilder;
  const { buildTimelineSpec } = window.TimelineSpec;

  const merged = mergeStimuliAndNle(stimuliRows, nleRows);
  const trials = buildTrialSequence(merged, participantId);
  const spec = buildTimelineSpec(trials);

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_finish: function () {
      saveExperimentData(jsPsych, participantId);
    },
  });

  window.jsPsychInstance = jsPsych;

  const timeline = spec.map((screen) => screenToJsPsychTrial(screen, jsPsych, participantId));

  jsPsych.data.addProperties({ participant_id: participantId });
  jsPsych.run(timeline);
}

window.addEventListener("DOMContentLoaded", runExperiment);