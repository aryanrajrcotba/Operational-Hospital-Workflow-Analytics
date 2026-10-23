"""Synthetic adult lifestyle / body-weight data for T14-T15.

The workbook has nothing on body weight, so (like the CT phantom and the report generator) the data are simulated, in the
shape of survey studies of eating habits and physical condition.  The point of simulating is that the true mechanism is known:
`true_bmi(df)` is the noiseless function the outcome is built from, so T15 can ask whether a method *recovered* it.
Built-in features: genuine linear effects, a U-shaped sleep effect, a saturating screen-time effect, an interaction (high-calorie
food hurts more when inactive), a sex x age interaction, a mediated path (stress -> snacking -> BMI), confounded variables with no
direct effect (income, transport) and a pure-noise variable (water).  Effect sizes are invented; they are not findings about people.
"""
import numpy as np
import pandas as pd

TRANSPORT = ["car", "public transport", "walking", "bicycle"]
NUMERIC = ["age", "height_cm", "activity_hrs_week", "screen_hrs_day", "veg_freq", "meals_per_day", "snacking", "water_l_day", "alcohol", "sleep_hrs", "stress"]
BINARY = ["male", "family_history", "high_cal_food", "smoker", "calorie_monitor"]
ORD_INCOME = ["income_band"]
FEATURES = ["age", "male", "height_cm", "income_band", "family_history", "high_cal_food", "veg_freq", "meals_per_day", "snacking", "water_l_day", "alcohol", "smoker", "calorie_monitor",
            "activity_hrs_week", "screen_hrs_day", "sleep_hrs", "stress", "transport"]
LABEL = {"age": "Age (years)", "male": "Male", "height_cm": "Height (cm)", "income_band": "Income band (1-4)", "family_history": "Family history of overweight",
         "high_cal_food": "Frequent high-calorie food", "veg_freq": "Vegetables with meals (1-3)", "meals_per_day": "Main meals per day", "snacking": "Snacking between meals (0-3)",
         "water_l_day": "Water (L/day)", "alcohol": "Alcohol (0-3)", "smoker": "Smoker", "calorie_monitor": "Monitors calories", "activity_hrs_week": "Exercise (h/week)",
         "screen_hrs_day": "Screen time (h/day)", "sleep_hrs": "Sleep (h/night)", "stress": "Stress score (0-10)", "transport": "Main transport"}
# direct-effect parameters used by true_bmi (documented so the app can print them)
EFFECT = {"age": "+0.045 BMI per year over 35 (males +0.02 more)", "male": "+0.6", "family_history": "+2.0", "high_cal_food": "+1.7, and +1.3 more if exercise < 2 h/week",
          "veg_freq": "-0.9 per level", "snacking": "+0.5 per level", "activity_hrs_week": "-0.35 per hour", "screen_hrs_day": "+0.28 per hour, flat beyond 6 h",
          "sleep_hrs": "U-shape: +0.5 x (hours - 7.5)^2", "alcohol": "+0.15 per level", "smoker": "-0.6", "calorie_monitor": "-0.8", "stress": "+0.1 per point (plus the path through snacking)",
          "income_band": "none (confounded)", "transport": "none (confounded)", "water_l_day": "none (noise)", "meals_per_day": "none", "height_cm": "none (weight = BMI x height^2)"}


def true_bmi(d):
    """Noiseless BMI as a function of the covariates (the data-generating mechanism)."""
    return (22.0 + 0.045 * (d.age - 35) + 0.02 * d.male * (d.age - 35) + 0.6 * d.male + 2.0 * d.family_history + 1.7 * d.high_cal_food
            + 1.3 * d.high_cal_food * (d.activity_hrs_week < 2) - 0.35 * d.activity_hrs_week + 0.28 * np.minimum(d.screen_hrs_day, 6) - 0.9 * (d.veg_freq - 2)
            + 0.5 * d.snacking + 0.5 * (d.sleep_hrs - 7.5) ** 2 + 0.15 * d.alcohol - 0.6 * d.smoker - 0.8 * d.calorie_monitor + 0.1 * d.stress)


def make_data(n=4000, seed=0):
    g = np.random.RandomState(seed)
    age = np.clip(16 + g.gamma(5.5, 5.2, n), 18, 75)
    male = g.binomial(1, 0.5, n)
    height = 162 + 12 * male + g.normal(0, 6, n)
    income = np.clip(np.round(2.4 + 0.015 * (age - 40) + g.normal(0, 1.0, n)), 1, 4)
    fam = g.binomial(1, 0.5, n)
    job = np.clip(np.round(1.2 - 0.25 * (income - 2.5) + g.normal(0, 0.8, n)), 0, 2)          # 0 active .. 2 sedentary
    activity = np.clip(3.2 - 0.02 * (age - 35) + 0.5 * male - 0.8 * (job - 1) + g.normal(0, 1.7, n), 0, 10)
    screen = np.clip(4.2 - 0.03 * (age - 40) + 0.5 * (job - 1) + g.normal(0, 1.9, n), 0, 12)
    favc = g.binomial(1, np.clip(0.55 - 0.08 * (income - 2.5) + 0.002 * (40 - age), 0.1, 0.9))
    veg = np.clip(np.round(2.0 + 0.2 * (income - 2.5) - 0.2 * male + g.normal(0, 0.6, n)), 1, 3)
    meals = np.clip(np.round(3 + g.normal(0, 0.8, n)), 1, 4)
    sleep = np.clip(7.2 - 0.01 * (age - 40) + g.normal(0, 1.2, n), 4, 10)
    stress = np.clip(5 - 0.6 * (sleep - 7) + 0.25 * (income < 2.5) + g.normal(0, 1.8, n), 0, 10)
    snack = np.clip(np.round(1.1 + 0.2 * (stress - 5) + 0.3 * favc + g.normal(0, 0.8, n)), 0, 3)
    water = np.clip(2.0 + g.normal(0, 0.6, n), 0.5, 3.5)
    alcohol = np.clip(np.round(0.9 + 0.5 * male + g.normal(0, 0.9, n)), 0, 3)
    smoker = g.binomial(1, 0.14, n)
    mon = g.binomial(1, 0.15, n)
    # transport: depends on income, age, job but has no direct effect on weight
    util = np.c_[1.2 * (income - 2.5) + 0.2 * (job - 1), np.zeros(n) + 0.3, -0.9 * (income - 2.5) + 0.6 * (job == 0), -0.5 - 0.02 * (age - 40) + 0.2 * (job == 0)]
    p = np.exp(util)
    p /= p.sum(1, keepdims=True)
    tr = np.array([TRANSPORT[np.searchsorted(np.cumsum(pi), g.rand())] for pi in p])
    d = pd.DataFrame({"age": age, "male": male, "height_cm": height, "income_band": income, "family_history": fam, "high_cal_food": favc, "veg_freq": veg, "meals_per_day": meals,
                      "snacking": snack, "water_l_day": water, "alcohol": alcohol, "smoker": smoker, "calorie_monitor": mon, "activity_hrs_week": activity, "screen_hrs_day": screen,
                      "sleep_hrs": sleep, "stress": stress, "transport": tr})
    # transport is related to activity (walkers and cyclists exercise more), another path for confounding
    d["activity_hrs_week"] = np.clip(d.activity_hrs_week + 0.9 * d.transport.isin(["walking", "bicycle"]) - 0.4 * (d.transport == "car"), 0, 10)
    bmi = true_bmi(d) + g.normal(0, 1.8, n)
    bmi = bmi - bmi.mean() + 26.4
    d["bmi"] = np.clip(bmi, 15, 55)
    d["weight_kg"] = d.bmi * (d.height_cm / 100) ** 2
    d["obese"] = (d.bmi >= 30).astype(int)
    return d
