# Operational & Hospital Workflow Analytics

Wait-time analytics on `WaitData.Published.xlsx` (imaging exams at four facilities, 130,431 rows).

| Topic | Status | Where |
|---|---|---|
| T1 · Understanding EHR | done | `pipeline/t1_understanding.py` → frontend tab **T1** |
| T2 · Preprocessing: standardization, data cleaning | done | `pipeline/t2_preprocessing.py` → frontend tab **T2** |
| T3 · Preprocessing of EHR data: redundant data removal, missing data | done | `pipeline/t3_ehr_preprocessing.py` → frontend tab **T3** |
| T4 · Biomedical image processing: enhancement, restoration, segmentation, compression | done | `pipeline/t4_image_processing.py` → frontend tab **T4** |
| T5 · Biomedical image analysis: SIFT, RANSAC, CNN | done | `pipeline/t5_image_analysis.py` → frontend tab **T5** |
| T6 · Biomedical image visualisation | done | `pipeline/t6_visualisation.py` → frontend tab **T6** (interactive viewer) |
| T7+ | to be added | |

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline.build                    # everything, ~4 min (first run also reads the 54 MB workbook, ~40 s more)
.venv/bin/python -m pipeline.build --only workbook    # T1-T3 only, ~1 min
.venv/bin/python -m pipeline.build --only imaging     # T4-T6 only, ~3 min, needs no workbook
open frontend/index.html                              # works from file://, no server needed
```

`pipeline.build` writes cleaned data to `data/processed/`, the numbers the frontend shows to `frontend/data/*.js`, and the generated pictures to `frontend/assets/`. T6's volume (`frontend/data/t6_volume.js`, ~1 MB) is only loaded when the T6 tab is opened.

## What the pipeline found in the data

* `Wait` means **begin − scheduled** at F1–F3 but **begin − arrival** at F4. We recompute `wait_min`, `start_delay_min`, `early_arrival_min` from the timestamps for every site.
* Timestamps are **date-shifted** by a constant (identical at all sites). Source calendar columns agree 100% only after that shift. Durations and time of day are unaffected. Calendar dates/years are deliberately not reconstructed.
* `DayOfWeek` uses Sunday = 1; converted to ISO (Monday = 1).
* 96 null cells (F1: 3, F4: 93) are all calendar fields, derived deterministically. 32 `is_first` values contradicted `ahead_count` and were recomputed.
* F1 has 8 zero-variance columns (not applicable at that site), dropped from its file.
* No rows are deleted. Long waits and odd timings are flagged (`flag_*` columns), not removed.
* Unresolved: source `StartTime` equals the arrival clock time minus exactly 1 h at every site (cause not documented).

## T3: what the pipeline found

* **No records are removed.** No exact duplicates and no repeated (arrival, scheduled, begin) keys at any site. About 400 rows share an arrival second with one other row, but always with a different wait, so they are distinct exams.
* **Columns removed in four stages** (constant → identical → copy of another column → complete-linkage cluster with every pair |r| ≥ 0.95), keeping one representative each: 87 → 65 features at F1, 87 → 77 at F2, 87 → 76 at F3, 59 → 49 at F4. Correlations use only each site's first 70 % (chronological). On the chronological hold-out, gradient-boosting wait-time MAE changes by ≤ 0.1 min and ridge MAE by ≤ 0.3 min (≤ 2 % of the error) at every site. Every decision is in `data/processed/t3_column_decisions.csv`.
* **Missing data.** The 96 blank cells are all calendar fields and are derived exactly from the timestamp (T2). The larger problem is *hidden* missingness: statistics of an empty set stored as 0 (e.g. `avg_age_people_waiting` is exactly 0 whenever nobody is in line). A rule search (count = 0 ⇒ statistic = 0, precision ≥ 99 %, recall ≥ 85 %) finds them; ~197k cells across the four sites are set to blank in `F*_reduced.csv.gz`. The rules are inferred from the data and should be confirmed with the system's owner.
* **Imputation benchmark** (values hidden under MCAR / MAR / MNAR, then recovered): time interpolation is best on these smooth, time-ordered features but uses future rows (offline only); mean fill is worst and collapses the variance.

## T4–T6: synthetic images

The workbook contains **no images**, so T4–T6 run on a generated chest-CT phantom (`pipeline/phantom.py`): HU values, body, lungs, heart, spine, ribs, vessels, couch and nodules with known position, size and density. It is not patient data and is much simpler than real anatomy: method *rankings* are informative, absolute numbers will not transfer. To use real data, replace `phantom.render(...)`/`acquire(...)` with a loader that returns HU arrays and the masks you have.

* **T4** scores every method against ground truth: enhancement (windows vs equalisation/CLAHE/sharpening), restoration (Gaussian, median, bilateral, non-local means, TV; Wiener, Richardson–Lucy; parameters tuned on the scored image, i.e. oracle-tuned), segmentation (threshold, Otsu, k-means, region growing, watershed, morphology; Dice/IoU), compression (lossless coders and entropy bounds, JPEG vs JPEG 2000, DCT energy compaction).
* **T5** registers a re-scan with a known rotation/scale/shift using SIFT + RANSAC (error measured at the nodules; least squares vs RANSAC as wrong matches are added), and trains a 6k-parameter CNN (BatchNorm, soft-max pooling) on nodule/non-nodule patches from separate phantom patients, compared with logistic regression and a centre-surround rule, plus a sliding-window detector. Train and test patients come from the same generator, so the CNN's accuracy is in-distribution.
* **T6** is an interactive multi-planar viewer (window/level, colormaps, MIP/MinIP/average slabs, overlays, montage) and a measured comparison of colormaps (CIELAB lightness).

## Assumptions

* "HER" was read as **EHR** (electronic health record).
* The workbook does not name its source system or the imaging modality, so the app says "scanner-based imaging exams".
* No synthetic data was needed; the real data already has enough standardization and quality issues to demonstrate T2.

## Adding a topic

1. Add `pipeline/tN_<name>.py` returning a dict; call it from `pipeline/build.py` and write it with `to_js_key(FRONTEND_DATA / "data_tN.js", "tN", payload)`.
2. Add `frontend/js/tN.js` that ends with `App.add({ id, label, view, mount })` (see `t3.js`), and load its data file and script in `frontend/index.html` before `App.start()`.
