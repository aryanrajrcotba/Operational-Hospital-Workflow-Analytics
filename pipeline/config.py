"""Paths, facility ids and the feature-family map for the WaitData workbook."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
RAW_XLSX = ROOT / "WaitData.Published.xlsx"
INTERIM = ROOT / "data" / "interim"
PROCESSED = ROOT / "data" / "processed"
FRONTEND_DATA = ROOT / "frontend" / "data"
FRONTEND_ASSETS = ROOT / "frontend" / "assets"

FACILITIES = ["F1", "F2", "F3", "F4"]

# Raw column names -> feature family. Every raw column must appear exactly once
# (checked in build.py) so a new column in a future workbook fails loudly.
FAMILIES = {
    "Target & timestamps": [
        "Wait", "x_ArrivalDTTM", "x_ScheduledDTTM", "x_BeginDTTM",
    ],
    "Queue state (patients waiting)": [
        "LineCount0Strict", "LineCount0", "LineCount1", "LineCount2", "LineCount3", "LineCount4",
        "SumWaits", "SumHowEarlyWaiting", "AvgHowEarlyWaiting", "NoneInLine", "DelayedInLine",
        "SumWaitByTaskTypeLine", "AvgWaitByTaskTypeLine", "SumDelayWaitingByExamCode",
        "SumDelayWaitingInLine", "AvgAgePeopleWaiting", "OutpatientWaitingCount",
        "MalesWaitingCount", "AheadCount",
    ],
    "Exam mix (waiting)": [
        "ThoracicCount", "PediatricCount", "NeuroCount", "AbdominalCount", "VascularCount",
        "CardiacCount", "MSKCount", "WithContrastCountWaiting",
        "WithAndWithoutContrastCountWaiting",
    ],
    "In-progress & capacity": [
        "SumInProgress", "SumTimeToCompleteInProgress", "SumDelayInProgress", "InProgressSize",
        "NoneInProgress", "NumScannersUsedToday", "WithContrastCountInProgress",
        "WithAndWithoutContrastCountInProgress",
    ],
    "Flow & throughput": [
        "FlowCount2", "FlowCount4", "SchFlowCount2", "SchFlowCount4", "FutFlowCount2",
        "FutFlowCount4", "NumCompletedToday", "NumCompletedInLastW1", "NumCompletedInLastW2",
        "NumCompletedInLastW3", "NumCustomersInLastW1", "NumCustomersInLastW2",
        "NumCustomersInLastW3", "NoneCompleted",
    ],
    "Recent delay history": [
        "DelayCount", "DelayCountLastHour", "mintime", "maxtime", "Median5", "MostRecent1",
        "MostRecent2", "MostRecent3", "MostRecent4", "MostRecent5", "AvgWaitLastK1Customers",
        "AvgWaitLastK2Customers", "AvgWaitLastK3Customers", "AvgWaitLastW1", "AvgWaitLastW2",
        "AvgWaitLastW3", "AvgDelayForDay", "AvgWaitForDay", "ExpectedDelayNextExam",
    ],
    "Schedule context": [
        "BeforeSlot", "AfterSlot", "NumScheduledNextSlot", "NumScheduledNextW2",
        "SumTimeToCompleteNextSlot", "SumTimeToCompleteNextW2", "NumAddOnsToday",
        "NumAddOnsLastW2", "IsFirst", "IsLast",
    ],
    "Calendar & time of day": [
        "StartTime", "StartTime2", "StartTime3", "StartTime4", "DayOfWeek", "Month", "DayOfYear",
    ],
}
FAMILY_OF = {c: fam for fam, cols in FAMILIES.items() for c in cols}

RENAME_OVERRIDES = {
    "Wait": "wait_source_min",
    "x_ArrivalDTTM": "arrival_dttm",
    "x_ScheduledDTTM": "scheduled_dttm",
    "x_BeginDTTM": "begin_dttm",
    "mintime": "day_min_wait",
    "maxtime": "day_max_wait",
    "StartTime": "start_hour",
    "StartTime2": "start_hour_sq",
    "StartTime3": "start_hour_cu",
    "StartTime4": "start_hour_4th",
    "DayOfWeek": "day_of_week_src",
    "Month": "month_src",
    "DayOfYear": "day_of_year_src",
    "MSKCount": "msk_count",
}


def snake(name: str) -> str:
    if name in RENAME_OVERRIDES:
        return RENAME_OVERRIDES[name]
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", s)
    return s.lower()


# Boolean-like 0/1 indicators (stored as int8, never scaled)
FLAGS = ["IsFirst", "IsLast", "NoneInProgress", "NoneCompleted", "NoneInLine"]
