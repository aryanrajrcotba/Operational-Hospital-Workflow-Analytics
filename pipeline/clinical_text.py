"""Synthetic radiology reports with gold annotations, for T10-T12.

The workbook holds no free text, so (as with the CT phantom for T4-T6) text is generated.  Every report is
built from templates around a vocabulary of exam-specific anatomy and findings, so the *truth* is known:
exam category, abnormal/normal, entity spans (ANATOMY, FINDING, SIZE) and whether each finding is present,
negated or uncertain.  It is much simpler and cleaner than real dictated reports (no copy-forward text, far
fewer abbreviations, no PHI quirks); method rankings are informative, absolute scores will not transfer.
A second generator makes short sentences containing ambiguous abbreviations for word-sense disambiguation.
"""
import random
import re

CATEGORIES = ["chest", "abdomen", "neuro", "msk", "cardiac", "vascular", "pediatric"]
MODALITY = {"chest": ["CT", "XR", "XR"], "abdomen": ["CT", "US", "CT"], "neuro": ["MRI", "CT", "MRI"], "msk": ["XR", "MRI", "XR"],
            "cardiac": ["CT", "MRI"], "vascular": ["CT", "US", "CT"], "pediatric": ["XR", "US", "MRI"]}
REGION = {"chest": "chest", "abdomen": "abdomen and pelvis", "neuro": "head", "msk": "extremity", "cardiac": "heart", "vascular": "angiogram", "pediatric": "pediatric study"}

ANAT = {
    "chest": ["right lower lobe", "left upper lobe", "right middle lobe", "left lower lobe", "right upper lobe", "lingula", "right hemithorax", "left hemithorax", "mediastinum", "pleural space", "left hilum", "trachea", "aortic arch", "costophrenic angle"],
    "abdomen": ["liver", "gallbladder", "pancreatic head", "spleen", "left kidney", "right kidney", "appendix", "sigmoid colon", "small bowel", "bladder", "right adrenal gland", "common bile duct"],
    "neuro": ["frontal lobe", "temporal lobe", "parietal lobe", "occipital lobe", "cerebellum", "brainstem", "lateral ventricle", "basal ganglia", "pituitary fossa", "corpus callosum", "thalamus"],
    "msk": ["distal radius", "proximal femur", "lumbar spine", "right knee", "left shoulder", "tibial plateau", "ankle mortise", "hip joint", "thoracic spine", "humeral head", "calcaneus"],
    "cardiac": ["left ventricle", "right ventricle", "left atrium", "aortic valve", "mitral valve", "pericardium", "proximal LAD", "right coronary artery", "interventricular septum", "left main coronary artery"],
    "vascular": ["abdominal aorta", "right carotid artery", "left femoral artery", "common iliac artery", "renal artery", "main pulmonary artery", "popliteal artery", "internal jugular vein", "superficial femoral artery"],
    "pediatric": ["thymus", "growth plate", "pylorus", "terminal ileum", "distal femoral epiphysis", "right lung", "left lung", "airway", "hip", "ileocecal valve"],
}
FIND = {
    "chest": ["pneumonia", "consolidation", "pleural effusion", "pneumothorax", "atelectasis", "pulmonary nodule", "emphysema", "pulmonary edema", "cardiomegaly", "rib fracture", "lymphadenopathy", "interstitial fibrosis", "mass lesion"],
    "abdomen": ["appendicitis", "cholelithiasis", "hepatic steatosis", "renal calculus", "hydronephrosis", "bowel obstruction", "diverticulitis", "ascites", "splenomegaly", "pancreatic cyst", "hepatic lesion", "free air"],
    "neuro": ["intracranial hemorrhage", "acute infarct", "subdural hematoma", "cerebral edema", "hydrocephalus", "meningioma", "midline shift", "white matter lesion", "aneurysm", "mass effect"],
    "msk": ["fracture", "osteoarthritis", "joint effusion", "meniscal tear", "rotator cuff tear", "disc herniation", "osteophyte", "spondylolisthesis", "bone lesion", "dislocation"],
    "cardiac": ["coronary stenosis", "calcified plaque", "pericardial effusion", "ventricular hypertrophy", "valvular regurgitation", "myocardial scar", "atrial enlargement", "intracardiac thrombus"],
    "vascular": ["aneurysm", "stenosis", "dissection", "thrombosis", "pulmonary embolism", "occlusion", "atherosclerotic plaque", "pseudoaneurysm", "arteriovenous malformation"],
    "pediatric": ["intussusception", "pyloric stenosis", "bronchiolitis", "buckle fracture", "hip dysplasia", "foreign body", "pneumonia", "subglottic narrowing", "fracture", "bowel obstruction"],
}
ABBREV = {"right lower lobe": "RLL", "left upper lobe": "LUL", "right middle lobe": "RML", "left lower lobe": "LLL", "right upper lobe": "RUL", "proximal LAD": "LAD", "right coronary artery": "RCA", "left main coronary artery": "LMCA"}
SEVERITY = ["mild", "moderate", "small", "large", "marked", "trace", "focal", "extensive"]
HISTORY = {"chest": ["cough and fever", "shortness of breath", "chest pain", "smoker with weight loss", "follow-up of prior abnormality"],
           "abdomen": ["right lower quadrant pain", "abdominal pain and vomiting", "flank pain", "elevated liver enzymes", "post-operative follow-up"],
           "neuro": ["headache", "fall with head strike", "new weakness", "seizure", "confusion"],
           "msk": ["fall with pain", "chronic joint pain", "sports injury", "back pain", "trauma"],
           "cardiac": ["chest pain", "dyspnea on exertion", "abnormal stress test", "palpitations", "family history of coronary disease"],
           "vascular": ["leg swelling", "claudication", "pulsatile mass", "sudden dyspnea", "follow-up of known aneurysm"],
           "pediatric": ["fever and cough", "vomiting", "fall from height", "limp", "irritability"]}
AGE = {"pediatric": lambda r: f"{r.randint(1, 12)}-year-old", "default": lambda r: f"{r.randint(24, 88)}-year-old"}

GEN_ANAT = ["aorta", "lymph nodes", "soft tissues", "vertebral body", "osseous structures", "adjacent fat", "vessels", "right side", "left side"]
GEN_FIND = ["mass", "cyst", "calcification", "edema", "effusion", "lymphadenopathy", "hemorrhage", "thrombus", "fracture", "inflammation", "abscess", "enlargement"]
PRESENT = ["There is {sev}{F} in the {A}.", "{F} is seen involving the {A}.", "The {A} demonstrates {sev}{F}.", "Findings are consistent with {F} of the {A}.",
           "{F} noted at the {A}.", "Evidence of {sev}{F} within the {A}.", "{F} is seen in the {A}, no change since prior.", "There is {sev}{F} in the {A} without complication.",
           "Known {F} of the {A}; no new abnormality."]
PRESENT_SIZE = ["{F} of the {A} measures {S}.", "There is {F} in the {A}, measuring {S}.", "The {A} shows {F} measuring up to {S}."]
NEG_WITH = ["No evidence of {F} in the {A}.", "No {F} is seen in the {A}.", "The {A} is negative for {F}.", "There is no {F} involving the {A}.", "Without {F} of the {A}.",
            "Previously seen {F} of the {A} has resolved.", "Absence of {F} in the {A}.", "The {A} is free of {F}.", "{F} is not seen in the {A}.", "{F} of the {A} was ruled out.", "No {F} greater than {S} in the {A}."]
NEG_BARE = ["No {F}.", "Negative for {F}.", "There is no evidence of {F}.", "No {F} identified."]
UNC_WITH = ["Possible {F} in the {A}.", "Cannot exclude {F} involving the {A}.", "Findings may represent {F} of the {A}.", "Suspicious for {F} at the {A}.", "{F} is likely in the {A}.", "Questionable {F} at the {A}.", "Probable {F} of the {A}."]
UNREM = ["The {A} is unremarkable.", "The {A} appears normal.", "Normal appearance of the {A}."]


def _typo(w, rng):
    if len(w) > 4 and rng.random() < 0.5:
        i = rng.randint(1, len(w) - 3)
        return w[:i] + w[i + 1] + w[i] + w[i + 2:]
    return w


class _Builder:
    """Collects (text, entity-type, finding-id) segments, then joins them while recording character offsets."""
    def __init__(self):
        self.parts = []

    def add(self, s, typ=None, fid=None):
        self.parts.append((s, typ, fid))

    def build(self):
        text, ents, pos = "", [], 0
        for s, typ, fid in self.parts:
            if typ:
                ents.append({"start": pos, "end": pos + len(s), "type": typ, "text": s, "fid": fid})
            text += s
            pos += len(s)
        return text, ents


def _sentence(b, tpl, fields, rng, typo_p, fid):
    """fields: {'F': finding, 'A': anatomy, 'S': size, 'sev': severity prefix or ''}."""
    for chunk in re.split(r"(\{[A-Za-z]+\})", tpl):
        m = re.fullmatch(r"\{([A-Za-z]+)\}", chunk)
        if not m:
            b.add(chunk)
            continue
        k = m.group(1)
        if k == "sev":
            b.add(fields["sev"])
        elif k == "F":
            w = fields["F"]
            b.add(_typo(w, rng) if rng.random() < typo_p else w, "FINDING", fid)
        elif k == "A":
            a = fields["A"]
            if a in ABBREV and rng.random() < 0.18:
                a = ABBREV[a]
            b.add(a, "ANATOMY", fid)
        elif k == "S":
            b.add(fields["S"], "SIZE", fid)


def report(rng, cat=None, abnormal=None, typo_p=0.04):
    cat = cat or rng.choice(CATEGORIES)
    abnormal = rng.random() < 0.5 if abnormal is None else abnormal
    b = _Builder()
    mod = rng.choice(MODALITY[cat])
    age = (AGE.get(cat) or AGE["default"])(rng)
    sex = rng.choice(["male", "female", "boy" if cat == "pediatric" else "male"])
    if rng.random() < 0.75:
        b.add(f"Clinical history: {age} {sex} with {rng.choice(HISTORY[cat])}. ")
    if rng.random() < 0.45:
        con = rng.choice(["with IV contrast", "without contrast", "with and without contrast"]) if mod in ("CT", "MRI") else ""
        b.add(f"Technique: {mod} of the {REGION[cat]} {con}".strip() + ". ")
    b.add("Findings: ")
    gold = []                                    # one dict per finding mention
    n_present = rng.choice([1, 1, 2, 3]) if abnormal else 0
    n_other = rng.choice([1, 2, 3]) if abnormal else rng.choice([2, 3, 4, 5])
    pool = FIND[cat]
    anat_pool = ANAT[cat]
    fid = 0
    plan = ["present"] * n_present + ["negated"] * n_other
    if abnormal and rng.random() < 0.3:
        plan.append("uncertain")
    rng.shuffle(plan)
    for status in plan:
        if rng.random() < 0.2:                   # incidental finding from another exam type
            other = rng.choice([c for c in CATEGORIES if c != cat])
            F, A = rng.choice(FIND[other]), rng.choice(ANAT[other])
        else:
            F = rng.choice(GEN_FIND) if rng.random() < 0.25 else rng.choice(pool)
            A = rng.choice(GEN_ANAT) if rng.random() < 0.25 else rng.choice(anat_pool)
        sev = (rng.choice(SEVERITY) + " ") if rng.random() < 0.5 else ""
        if status == "present":
            tpl = rng.choice(PRESENT_SIZE) if rng.random() < 0.45 else rng.choice(PRESENT)
        elif status == "negated":
            tpl = rng.choice(NEG_WITH if rng.random() < 0.65 else NEG_BARE)
            sev = ""
        else:
            tpl = rng.choice(UNC_WITH)
            sev = ""
        size = None
        if "{S}" in tpl:
            size = f"{rng.randint(3, 60)} mm" if rng.random() < 0.5 else f"{rng.randint(1, 9)}.{rng.randint(0, 9)} cm"
        _sentence(b, tpl, {"F": F, "A": A, "S": size, "sev": sev}, rng, typo_p, fid)
        b.add(" ")
        gold.append({"fid": fid, "finding": F, "anatomy": A if "{A}" in tpl else None, "status": status, "size": size if status == "present" else None})
        fid += 1
    for _ in range(rng.randint(0, 2)):           # unremarkable structures: ANATOMY with no finding
        _sentence(b, rng.choice(UNREM), {"A": rng.choice(anat_pool), "F": "", "S": None, "sev": ""}, rng, typo_p, None)
        b.add(" ")
    present = [g for g in gold if g["status"] == "present"]
    if rng.random() < (0.4 if present else 0.3):
        text, ents = b.build()
        return {"text": text.strip(), "category": cat, "abnormal": int(bool(present)), "entities": ents, "findings": gold, "modality": mod}
    b.add("Impression: ")
    if present:
        for k, g in enumerate(present):
            b.add(("" if k == 0 else "; "))
            b.add(g["finding"], "FINDING", g["fid"])
        b.add(". ")
    else:
        b.add(rng.choice(["No acute abnormality.", "Unremarkable examination.", "No significant abnormality identified.", "Normal study."]))
    text, ents = b.build()
    return {"text": text.strip(), "category": cat, "abnormal": int(bool(present)), "entities": ents, "findings": gold, "modality": mod}


def make_reports(n=3000, seed=0):
    rng = random.Random(seed)
    cats = [CATEGORIES[i % len(CATEGORIES)] for i in range(n)]
    rng.shuffle(cats)
    out = [report(rng, c) for c in cats]
    for i, d in enumerate(out):
        d["id"] = i
    return out


# --------------------------------------------------------------------------- tokens
TOKEN = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?|[^\w\s]")


def tokenize(text):
    return [(m.group(), m.start(), m.end()) for m in TOKEN.finditer(text)]


def bio_tags(text, ents):
    toks = tokenize(text)
    tags = ["O"] * len(toks)
    for e in ents:
        first = True
        for i, (_, s, t) in enumerate(toks):
            if s >= e["start"] and t <= e["end"]:
                tags[i] = ("B-" if first else "I-") + e["type"]
                first = False
    return toks, tags


# --------------------------------------------------------------------------- word-sense disambiguation
SENSES = {
    "MS": {"multiple sclerosis": ("demyelinating disease of the brain and spinal cord", ["demyelinating", "plaques", "periventricular", "lesions", "optic", "neuritis", "relapse", "brain", "mri", "white", "matter", "interferon"]),
           "mitral stenosis": ("narrowing of the mitral valve of the heart", ["valve", "murmur", "atrial", "rheumatic", "echocardiogram", "diastolic", "mitral", "leaflets", "fibrillation", "cardiac"]),
           "morphine sulfate": ("opioid analgesic given for severe pain", ["mg", "iv", "pain", "dose", "opioid", "analgesia", "given", "prn", "sedation", "administered"])},
    "PE": {"pulmonary embolism": ("blood clot lodged in the pulmonary arteries", ["ct", "angiogram", "dyspnea", "clot", "anticoagulation", "heparin", "filling", "defect", "pleuritic", "dvt"]),
           "physical exam": ("examination of the patient's body by the clinician", ["abdomen", "soft", "auscultation", "vitals", "normal", "palpation", "reflexes", "general", "benign", "regular"])},
    "CP": {"chest pain": ("pain felt in the chest", ["exertional", "radiating", "troponin", "ecg", "angina", "pressure", "emergency", "nitroglycerin", "sternal", "diaphoresis"]),
           "cerebral palsy": ("movement disorder caused by early brain injury", ["spastic", "developmental", "gait", "contracture", "birth", "hypertonia", "therapy", "wheelchair", "motor", "pediatric"])},
    "RA": {"rheumatoid arthritis": ("autoimmune disease causing joint inflammation", ["joints", "synovitis", "methotrexate", "erosions", "hands", "rheumatoid", "morning", "stiffness", "swelling", "anti"]),
           "right atrium": ("upper right chamber of the heart", ["chamber", "enlarged", "tricuspid", "cardiac", "pressure", "catheter", "echo", "venous", "dilated", "ventricle"])},
    "cold": {"common cold": ("viral infection of the upper airway", ["rhinorrhea", "sore", "throat", "congestion", "sneezing", "viral", "cough", "symptoms", "runny", "nose"]),
             "low temperature": ("sensation or measurement of low temperature", ["extremities", "clammy", "pale", "exposure", "pulse", "skin", "hypothermia", "touch", "fingers", "toes"])},
    "discharge": {"hospital discharge": ("release of a patient from hospital care", ["home", "follow-up", "instructions", "planned", "tomorrow", "medications", "summary", "stable", "clinic", "appointment"]),
                  "bodily fluid discharge": ("fluid or pus emitted from the body", ["purulent", "wound", "nipple", "vaginal", "ear", "foul", "drainage", "odor", "yellow", "culture"])},
    "ca": {"cancer": ("malignant tumour", ["metastatic", "biopsy", "oncology", "tumor", "carcinoma", "staging", "chemotherapy", "malignant", "mass", "resection"]),
           "calcium": ("mineral element measured in blood", ["serum", "mg", "dl", "hypercalcemia", "level", "supplement", "bone", "phosphate", "vitamin", "lab"])},
    "pt": {"patient": ("person receiving medical care", ["admitted", "complains", "reports", "history", "denies", "male", "female", "presented", "stated", "year-old"]),
           "physical therapy": ("rehabilitation exercises supervised by a therapist", ["rehab", "exercises", "mobility", "strength", "gait", "sessions", "range", "motion", "recovery", "walking"])},
}
NOISE = ["today", "stable", "noted", "per", "chart", "review", "also", "seen", "current", "recent", "overall", "prior", "again", "plan", "continue", "assessment", "evaluate", "further", "see", "report"]
TEMPL = ["{a} {b} {T} {c} {d}", "{T}: {a}, {b}, {c}", "{a} and {b} suggest {T} {c}", "history of {T} with {a} {b} {c}", "{T} {a} {b} noted {c} {d}", "{a} {T} {b} {c}"]


def make_wsd(per_sense=140, seed=1, p_cue=0.55, p_confuse=0.12):
    rng = random.Random(seed)
    data = []
    for term, senses in SENSES.items():
        all_cues = {s: c for s, (_, c) in senses.items()}
        for sense, cues in all_cues.items():
            others = [w for s, c in all_cues.items() if s != sense for w in c]
            for _ in range(per_sense):
                slots = []
                for _k in range(4):
                    u = rng.random()
                    slots.append(rng.choice(cues) if u < p_cue else rng.choice(others) if u < p_cue + p_confuse else rng.choice(NOISE))
                t = rng.choice(TEMPL)
                d = dict(zip("abcd", slots))
                T = term if rng.random() < 0.85 else term.upper()
                s = t.format(T="@@", **d).replace("@@", T)
                data.append({"term": term, "sense": sense, "text": s})
    rng.shuffle(data)
    return data
