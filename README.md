# Operational & Hospital Workflow Analytics

Wait-time analytics on `WaitData.Published.xlsx` (imaging exams at four facilities, 130,431 rows).

| Topic | Status | Where |
|---|---|---|
| T1 · Understanding EHR | done | `pipeline/t1_understanding.py` → frontend tab **T1** |
| T2 · Preprocessing: standardization, data cleaning | done | `pipeline/t2_preprocessing.py` → frontend tab **T2** |
| T3+ | to be added | |

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.build        # ~30 s; first run also reads the 54 MB workbook (~40 s more)
open frontend/index.html                  # works from file://, no server needed
```

`pipeline.build` writes cleaned data to `data/processed/` and the numbers the frontend shows to `frontend/data/data.js`.

## What the pipeline found in the data

* `Wait` means **begin − scheduled** at F1–F3 but **begin − arrival** at F4. We recompute `wait_min`, `start_delay_min`, `early_arrival_min` from the timestamps for every site.
* Timestamps are **date-shifted** by a constant (identical at all sites). Source calendar columns agree 100% only after that shift. Durations and time of day are unaffected. Calendar dates/years are deliberately not reconstructed.
* `DayOfWeek` uses Sunday = 1; converted to ISO (Monday = 1).
* 96 null cells (F1: 3, F4: 93) are all calendar fields, derived deterministically. 32 `is_first` values contradicted `ahead_count` and were recomputed.
* F1 has 8 zero-variance columns (not applicable at that site), dropped from its file.
* No rows are deleted. Long waits and odd timings are flagged (`flag_*` columns), not removed.
* Unresolved: source `StartTime` equals the arrival clock time minus exactly 1 h at every site (cause not documented).

## Assumptions

* "HER" was read as **EHR** (electronic health record).
* The workbook does not name its source system or the imaging modality, so the app says "scanner-based imaging exams".
* No synthetic data was needed; the real data already has enough standardization and quality issues to demonstrate T2.

## Adding a topic

1. Add `pipeline/t3_<name>.py` returning a dict; call it from `pipeline/build.py` and add it to the `DATA` payload.
2. Add a `view…`/`mount…` pair in `frontend/js/app.js` and one entry in `TOPICS`.
