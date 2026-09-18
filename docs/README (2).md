# Study Platform — Setup Instructions

This folder contains a complete, tested jsPsych experiment implementing
the 3 (Task Subjectivity) x 3 (Explanation Condition) fully within-subjects
design from the project's pre-registration.

## What's already tested (in Node, before you ever open a browser)

- `counterbalancing.js` — assigns each participant one of 6 explanation
  orders, deterministically and evenly distributed.
- `trial_builder.js` — merges your stimuli + NLE data and expands it
  into the full 90-trial sequence per participant.
- `build_timeline_spec.js` — turns those 90 trials into the full
  279-screen experiment structure (instructions, block intros, 90 x
  [judgment1 + reveal + judgment2], 1 attention check, 3 Likert blocks,
  1 demographics screen).

All three were unit-tested with realistic synthetic data (30 stimuli,
10 per task) and verified to produce exactly the expected counts and
structure. `experiment.js` is a thin layer that translates this
already-tested spec into real jsPsych trials — it is syntax-checked but
can only be fully verified by actually opening the page in a browser
(jsPsych requires a real DOM).

## One-time setup (do this once you have your final CSVs)

You need two files from your Python pipeline:
- `selected_stimuli.csv` (30 rows: task, text, true_label, shown_label, correct_trial)
- `nle_explanations.csv` (30 rows: same stimuli + standard_nle, cognitive_forcing_nle columns)

Put both files in this same folder, then run:

```bash
node build_data_file.js selected_stimuli.csv nle_explanations.csv stimuli_data.js
```

This creates `stimuli_data.js`, which embeds your data directly as
JavaScript (no CSV parsing happens inside the browser — this avoids
file:// CORS issues when opening the page locally).

You should see:
```
Parsed 30 rows from selected_stimuli.csv
Parsed 30 rows from nle_explanations.csv
Wrote stimuli_data.js
```

If you see a warning about a row count not being 30, double-check your
CSVs before proceeding.

## Running the experiment locally (for your own testing)

Simply open `index.html` in a browser (double-click it, or drag it into
a browser window). You should see the instructions screen, then the
first block.

**Note:** jsPsych's `on_finish` handler in `experiment.js` currently
saves data locally via `jsPsych.data.get().localSave(...)`, which
triggers a CSV download in the browser at the end of the session. This
works for local testing. Before recruiting real participants, you will
need to replace this with a proper data-saving method (e.g., posting
to a server endpoint, or using a hosting platform like JATOS, Cognition.run,
or a simple backend you control) so that participant data is actually
collected centrally rather than downloaded to each participant's own
computer.

## Hosting for real participants

To actually run the study with N=50 real participants, this needs to be
hosted somewhere participants can access via a link (e.g., GitHub Pages
for the static files, combined with a small server or third-party
service for data collection — this is a separate step from what's
included here and should be planned before recruitment begins).

## File checklist

- [x] `simple_csv_parser.js` — tested
- [x] `counterbalancing.js` — tested (Node + simulated-browser)
- [x] `trial_builder.js` — tested (Node + simulated-browser)
- [x] `build_timeline_spec.js` — tested (Node + simulated-browser)
- [x] `build_data_file.js` — tested (with sample comma-containing data)
- [ ] `stimuli_data.js` — **you generate this** once you have your real CSVs
- [x] `experiment.js` — syntax-checked; needs real-browser testing (jsPsych requires a DOM)
- [x] `index.html` — loads everything in the correct order
