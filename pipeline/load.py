"""Read the workbook once (slow: ~40 s) and cache each sheet as a pickle."""
import pandas as pd
from .config import RAW_XLSX, INTERIM, FACILITIES


def load_raw(force: bool = False) -> dict:
    INTERIM.mkdir(parents=True, exist_ok=True)
    paths = {f: INTERIM / f"{f}.pkl" for f in FACILITIES}
    if force or not all(p.exists() for p in paths.values()):
        print("Reading workbook (first run only)...")
        sheets = pd.read_excel(RAW_XLSX, sheet_name=FACILITIES)
        for f, df in sheets.items():
            df.to_pickle(paths[f])
    return {f: pd.read_pickle(p) for f, p in paths.items()}


def load_dictionary() -> dict:
    """Feature -> description, expanding the 'A0/1/2' shorthand used in the Contents sheet."""
    c = pd.read_excel(RAW_XLSX, sheet_name="Contents", header=None).iloc[2:, 1:3].dropna()
    out = {}
    for key, desc in zip(c[1], c[2]):
        key, desc = str(key).strip(), str(desc).strip()
        parts = key.split("/")
        out[parts[0]] = desc
        for t in parts[1:]:
            out[parts[0][: len(parts[0]) - len(t)] + t] = desc
    return out


MANUAL_DESCRIPTIONS = {
    "Wait": "Reported wait/delay in minutes (definition differs by facility; see T2).",
    "AvgWaitForDay": "Average wait for patients for that day (F4 name for AvgDelayForDay).",
    "NoneCompleted": "No exams completed that day.",
}


def describe(raw_col: str, dictionary: dict) -> str:
    import re
    if raw_col in dictionary:
        return dictionary[raw_col]
    if raw_col in MANUAL_DESCRIPTIONS:
        return MANUAL_DESCRIPTIONS[raw_col]
    stripped = re.sub(r"\d+$", "", raw_col)
    for cand in (stripped, re.sub(r"(K|W)\d", r"\g<1>1", raw_col), stripped + "1"):
        if cand in dictionary:
            return dictionary[cand]
    return ""
