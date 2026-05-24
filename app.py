from __future__ import annotations

import argparse
import hashlib
import json
import math
import mimetypes
import os
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from collections import Counter
from fractions import Fraction
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = BASE_DIR / "cache"

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
IUPAC_SOURCE = "https://iupac.org/what-we-do/periodic-table-of-elements/"
PUBCHEM_PERIODIC_SOURCE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/CSV"

FORMULA_PATTERN = re.compile("^[A-Za-z0-9()[\\]{}.+\\-.\\u00b7]+$")
STATE_SUFFIX_PATTERN = re.compile(r"\((aq|s|l|g)\)$", re.IGNORECASE)


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


ELEMENTS = load_json(DATA_DIR / "elements.json")
ELEMENTS_BY_SYMBOL = {entry["symbol"]: entry for entry in ELEMENTS}
ELEMENTS_BY_NUMBER = {entry["atomicNumber"]: entry for entry in ELEMENTS}
CURATED_LIBRARY = load_json(DATA_DIR / "curated_compounds.json")
ELEMENT_PROFILES = load_json(DATA_DIR / "element_profiles.json")
ELEMENT_PROFILES_BY_NUMBER = {entry["atomicNumber"]: entry for entry in ELEMENT_PROFILES}


def sha1(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def cache_path(kind: str, key: str, suffix: str) -> Path:
    folder = CACHE_DIR / kind
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{sha1(key)}{suffix}"


def fetch_url(url: str, *, binary: bool = False, cache_kind: str | None = None, suffix: str = ""):
    if cache_kind:
        cached = cache_path(cache_kind, url, suffix)
        if cached.exists():
            return cached.read_bytes() if binary else cached.read_text(encoding="utf-8")

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MoleculeBuilder/1.0 (+local desktop app)",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = response.read()

    if cache_kind:
        cached = cache_path(cache_kind, url, suffix)
        if binary:
            cached.write_bytes(payload)
        else:
            cached.write_text(payload.decode("utf-8"), encoding="utf-8")

    if binary:
        return payload
    return payload.decode("utf-8")


def fetch_json(url: str, *, cache_kind: str | None = None) -> dict:
    return json.loads(fetch_url(url, cache_kind=cache_kind, suffix=".json"))


def split_leading_multiplier(text: str) -> tuple[int, str]:
    match = re.match(r"^(\d+)(.*)$", text)
    if not match:
        return 1, text
    return int(match.group(1)), match.group(2)


def strip_phase_suffix(formula: str) -> str:
    return STATE_SUFFIX_PATTERN.sub("", formula.strip())


def parse_formula(formula: str) -> dict[str, int]:
    cleaned = strip_phase_suffix(formula).replace(" ", "").replace("\u00b7", ".")
    if not cleaned:
        raise ValueError("Empty formula.")

    total = Counter()
    for part in cleaned.split("."):
        if not part:
            continue
        multiplier, core = split_leading_multiplier(part)
        counts, index = parse_group(core, 0)
        if index != len(core):
            raise ValueError(f"Could not fully parse formula near '{core[index:]}'")
        for symbol, amount in counts.items():
            total[symbol] += amount * multiplier

    if not total:
        raise ValueError("No atoms were found in the formula.")
    return dict(total)


def parse_group(text: str, index: int) -> tuple[Counter, int]:
    counts: Counter[str] = Counter()
    while index < len(text):
        char = text[index]
        if char in "([{":
            nested, index = parse_group(text, index + 1)
            if index >= len(text) or text[index] not in ")]}":
                raise ValueError("Unmatched parenthesis in formula.")
            index += 1
            multiplier, index = parse_number(text, index)
            for symbol, amount in nested.items():
                counts[symbol] += amount * multiplier
            continue
        if char in ")]}":
            return counts, index
        if char.isalpha():
            match = re.match(r"[A-Z][a-z]?", text[index:])
            if not match:
                raise ValueError(f"Invalid element token near '{text[index:]}'")
            symbol = match.group(0)
            if symbol not in ELEMENTS_BY_SYMBOL:
                raise ValueError(f"Unknown element symbol '{symbol}'")
            index += len(symbol)
            multiplier, index = parse_number(text, index)
            counts[symbol] += multiplier
            continue
        raise ValueError(f"Unexpected token '{char}' in formula.")

    return counts, index


def parse_number(text: str, index: int) -> tuple[int, int]:
    match = re.match(r"\d+", text[index:])
    if not match:
        return 1, index
    return int(match.group(0)), index + len(match.group(0))


def formula_breakdown(formula: str) -> list[dict]:
    composition = parse_formula(formula)
    rows = []
    total_mass = 0.0
    for symbol, count in composition.items():
        element = ELEMENTS_BY_SYMBOL[symbol]
        atomic_mass = float(element["atomicMass"])
        contribution = atomic_mass * count
        total_mass += contribution
        rows.append(
            {
                "symbol": symbol,
                "name": element["name"],
                "count": count,
                "atomicMass": round(atomic_mass, 6),
                "contribution": round(contribution, 6),
            }
        )
    rows.sort(key=lambda row: row["symbol"])
    for row in rows:
        row["percentByMass"] = round((row["contribution"] / total_mass) * 100, 4) if total_mass else 0.0
    return rows


def molar_mass(formula: str) -> float:
    return round(sum(item["contribution"] for item in formula_breakdown(formula)), 6)


def normalize_compound_token(token: str) -> tuple[int, str]:
    stripped = token.strip()
    if not stripped:
        raise ValueError("Empty compound token.")
    stripped = strip_phase_suffix(stripped)
    match = re.match(r"^(\d+)\s*([A-Za-z(].*)$", stripped)
    if match:
        return int(match.group(1)), match.group(2).strip()
    return 1, stripped


def parse_equation(equation: str) -> tuple[list[str], list[str]]:
    normalized = equation.replace("<->", "->").replace("\u21cc", "->").replace("=", "->")
    if "->" not in normalized:
        raise ValueError("Use '->' or '=' to separate reactants and products.")
    reactants_text, products_text = normalized.split("->", 1)
    reactants = [token.strip() for token in reactants_text.split("+") if token.strip()]
    products = [token.strip() for token in products_text.split("+") if token.strip()]
    if not reactants or not products:
        raise ValueError("Both reactants and products are required.")
    return reactants, products


def solve_nullspace(matrix: list[list[Fraction]]) -> list[Fraction]:
    rows = len(matrix)
    cols = len(matrix[0]) if matrix else 0
    working = [row[:] for row in matrix]
    pivot_columns: list[int] = []
    row_index = 0

    for col_index in range(cols):
        pivot = None
        for candidate in range(row_index, rows):
            if working[candidate][col_index] != 0:
                pivot = candidate
                break
        if pivot is None:
            continue

        working[row_index], working[pivot] = working[pivot], working[row_index]
        divisor = working[row_index][col_index]
        working[row_index] = [value / divisor for value in working[row_index]]

        for candidate in range(rows):
            if candidate == row_index:
                continue
            factor = working[candidate][col_index]
            if factor == 0:
                continue
            working[candidate] = [
                current - factor * pivot_value
                for current, pivot_value in zip(working[candidate], working[row_index])
            ]

        pivot_columns.append(col_index)
        row_index += 1
        if row_index == rows:
            break

    free_columns = [index for index in range(cols) if index not in pivot_columns]
    if not free_columns:
        raise ValueError("Could not find a balancing solution.")

    solution = [Fraction(0, 1) for _ in range(cols)]
    for free_column in free_columns:
        solution[free_column] = Fraction(1, 1)

    for row_idx in reversed(range(len(pivot_columns))):
        pivot_column = pivot_columns[row_idx]
        value = Fraction(0, 1)
        for col_idx in free_columns:
            value -= working[row_idx][col_idx] * solution[col_idx]
        solution[pivot_column] = value

    denominators = [value.denominator for value in solution]
    lcm = 1
    for denominator in denominators:
        lcm = math.lcm(lcm, denominator)

    integers = [int(value * lcm) for value in solution]
    non_zero = [abs(value) for value in integers if value]
    gcd = non_zero[0]
    for value in non_zero[1:]:
        gcd = math.gcd(gcd, value)
    integers = [value // gcd for value in integers]

    if any(value < 0 for value in integers):
        integers = [-value for value in integers]
    return [Fraction(value, 1) for value in integers]


def balance_equation(equation: str) -> dict:
    reactants, products = parse_equation(equation)
    compounds = reactants + products
    compositions = []
    elements = set()

    for token in compounds:
        _, formula = normalize_compound_token(token)
        counts = parse_formula(formula)
        compositions.append(counts)
        elements.update(counts.keys())

    ordered_elements = sorted(elements)
    matrix = []
    for symbol in ordered_elements:
        row = []
        for index, counts in enumerate(compositions):
            coefficient = counts.get(symbol, 0)
            row.append(Fraction(coefficient if index < len(reactants) else -coefficient, 1))
        matrix.append(row)

    coefficients = [value.numerator for value in solve_nullspace(matrix)]
    left_parts = []
    right_parts = []

    for idx, token in enumerate(reactants):
        coefficient = coefficients[idx]
        left_parts.append(f"{coefficient} {normalize_compound_token(token)[1]}" if coefficient != 1 else normalize_compound_token(token)[1])

    for idx, token in enumerate(products, start=len(reactants)):
        coefficient = coefficients[idx]
        right_parts.append(f"{coefficient} {normalize_compound_token(token)[1]}" if coefficient != 1 else normalize_compound_token(token)[1])

    return {
        "balancedEquation": " + ".join(left_parts) + " -> " + " + ".join(right_parts),
        "coefficients": coefficients,
        "elements": ordered_elements,
    }


def determinant3(matrix: list[list[float]]) -> float:
    return (
        matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
        - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
        + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
    )


def eigenvalues_symmetric3(matrix: list[list[float]]) -> list[float]:
    a11, a12, a13 = matrix[0]
    _, a22, a23 = matrix[1]
    _, _, a33 = matrix[2]
    p1 = a12 * a12 + a13 * a13 + a23 * a23
    if p1 == 0:
        return sorted([a11, a22, a33])

    q = (a11 + a22 + a33) / 3
    p2 = (a11 - q) ** 2 + (a22 - q) ** 2 + (a33 - q) ** 2 + 2 * p1
    p = math.sqrt(p2 / 6)
    identity = [[1 if row == col else 0 for col in range(3)] for row in range(3)]
    normalized = [[(matrix[row][col] - q * identity[row][col]) / p for col in range(3)] for row in range(3)]
    r = determinant3(normalized) / 2
    r = max(-1.0, min(1.0, r))
    phi = math.acos(r) / 3
    eig1 = q + 2 * p * math.cos(phi)
    eig3 = q + 2 * p * math.cos(phi + (2 * math.pi / 3))
    eig2 = 3 * q - eig1 - eig3
    return sorted([eig1, eig2, eig3])


def parse_sdf(sdf_text: str) -> tuple[list[dict], list[dict]]:
    lines = sdf_text.splitlines()
    if len(lines) < 4:
        raise ValueError("SDF data is incomplete.")
    counts_line = lines[3]
    atom_count = int(counts_line[:3].strip())
    bond_count = int(counts_line[3:6].strip())
    atom_lines = lines[4 : 4 + atom_count]
    bond_lines = lines[4 + atom_count : 4 + atom_count + bond_count]

    atoms = []
    for line in atom_lines:
        atoms.append(
            {
                "x": float(line[0:10].strip()),
                "y": float(line[10:20].strip()),
                "z": float(line[20:30].strip()),
                "symbol": line[31:34].strip(),
            }
        )

    bonds = []
    for line in bond_lines:
        bonds.append(
            {
                "a": int(line[0:3].strip()) - 1,
                "b": int(line[3:6].strip()) - 1,
                "order": int(line[6:9].strip()),
            }
        )

    return atoms, bonds


def geometry_from_coordinates(atoms: list[dict]) -> dict:
    if len(atoms) < 2:
        return {
            "shape": "Atomic species",
            "rotorClass": "Not applicable",
            "planarity": "Single atom",
            "principalMoments": [0.0, 0.0, 0.0],
        }

    masses = [float(ELEMENTS_BY_SYMBOL[atom["symbol"]]["atomicMass"]) for atom in atoms]
    total_mass = sum(masses)
    center = {
        axis: sum(atom[axis] * mass for atom, mass in zip(atoms, masses)) / total_mass
        for axis in ("x", "y", "z")
    }

    inertia = [[0.0, 0.0, 0.0] for _ in range(3)]
    covariance = [[0.0, 0.0, 0.0] for _ in range(3)]
    for atom, mass in zip(atoms, masses):
        x = atom["x"] - center["x"]
        y = atom["y"] - center["y"]
        z = atom["z"] - center["z"]

        inertia[0][0] += mass * (y * y + z * z)
        inertia[1][1] += mass * (x * x + z * z)
        inertia[2][2] += mass * (x * x + y * y)
        inertia[0][1] -= mass * x * y
        inertia[0][2] -= mass * x * z
        inertia[1][2] -= mass * y * z

        covariance[0][0] += x * x
        covariance[1][1] += y * y
        covariance[2][2] += z * z
        covariance[0][1] += x * y
        covariance[0][2] += x * z
        covariance[1][2] += y * z

    inertia[1][0] = inertia[0][1]
    inertia[2][0] = inertia[0][2]
    inertia[2][1] = inertia[1][2]
    covariance[1][0] = covariance[0][1]
    covariance[2][0] = covariance[0][2]
    covariance[2][1] = covariance[1][2]

    principal_moments = eigenvalues_symmetric3(inertia)
    spread = eigenvalues_symmetric3(covariance)

    normalized_spread = [value / max(spread[-1], 1e-9) for value in spread]
    if len(atoms) == 2 or normalized_spread[1] < 0.03:
        planarity = "Linear"
    elif normalized_spread[0] < 0.02:
        planarity = "Nearly planar"
    else:
        planarity = "Three-dimensional"

    i1, i2, i3 = principal_moments
    if i1 < 1e-5:
        rotor = "Linear rotor"
    elif abs(i1 - i2) / max(i3, 1e-9) < 0.05 and abs(i2 - i3) / max(i3, 1e-9) < 0.05:
        rotor = "Near-spherical top"
    elif abs(i1 - i2) / max(i3, 1e-9) < 0.05 or abs(i2 - i3) / max(i3, 1e-9) < 0.05:
        rotor = "Symmetric top"
    else:
        rotor = "Asymmetric top"

    if planarity == "Linear":
        shape = "Linear"
    elif planarity == "Nearly planar":
        shape = "Planar / sheet-like"
    else:
        shape = "Three-dimensional framework"

    return {
        "shape": shape,
        "rotorClass": rotor,
        "planarity": planarity,
        "principalMoments": [round(value, 4) for value in principal_moments],
    }


def polarity_from_structure(atoms: list[dict], bonds: list[dict]) -> dict:
    if not bonds:
        return {"label": "Insufficient bond data", "score": 0.0, "note": "No bond network was available."}

    vector = [0.0, 0.0, 0.0]
    active_bonds = 0
    for bond in bonds:
        atom_a = atoms[bond["a"]]
        atom_b = atoms[bond["b"]]
        en_a = ELEMENTS_BY_SYMBOL[atom_a["symbol"]].get("electronegativity")
        en_b = ELEMENTS_BY_SYMBOL[atom_b["symbol"]].get("electronegativity")
        if en_a is None or en_b is None:
            continue
        delta = abs(float(en_a) - float(en_b))
        dx = atom_b["x"] - atom_a["x"]
        dy = atom_b["y"] - atom_a["y"]
        dz = atom_b["z"] - atom_a["z"]
        length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
        if float(en_b) < float(en_a):
            dx, dy, dz = -dx, -dy, -dz
        scale = delta * max(1, bond["order"]) / length
        vector[0] += dx * scale
        vector[1] += dy * scale
        vector[2] += dz * scale
        active_bonds += 1

    score = math.sqrt(vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2)
    if active_bonds == 0:
        return {"label": "Insufficient electronegativity data", "score": 0.0, "note": "Bond polarity could not be estimated."}
    if score < 0.25:
        label = "Likely nonpolar or weakly polar"
    elif score < 0.9:
        label = "Moderately polar"
    else:
        label = "Strongly polar"

    return {
        "label": label,
        "score": round(score, 4),
        "note": "Heuristic bond-dipole estimate from the 3D conformer and element electronegativities.",
    }


def compound_display_name(query: str | None, synonyms: list[str], iupac_name: str | None, formula: str) -> str:
    if query:
        raw_query = query.strip()
        cleaned_query = raw_query.lower()
        if raw_query and not looks_like_formula(raw_query):
            return raw_query[:1].upper() + raw_query[1:]
        for synonym in synonyms:
            if synonym.strip().lower() == cleaned_query:
                return synonym
    for synonym in synonyms:
        if 2 <= len(synonym) <= 48 and not re.match(r"^[A-Z0-9:_-]+$", synonym):
            return synonym
    if iupac_name:
        return iupac_name
    if query:
        return query.strip().title()
    return formula


def looks_like_formula(query: str) -> bool:
    cleaned = query.strip().replace("\u00b7", ".")
    return bool(cleaned) and bool(FORMULA_PATTERN.fullmatch(cleaned)) and (cleaned[0].isupper() or cleaned[0].isdigit())


def search_cids(query: str) -> list[int]:
    encoded = urllib.parse.quote(query.strip())
    url = f"{PUBCHEM_BASE}/compound/name/{encoded}/cids/JSON"
    try:
        payload = fetch_json(url, cache_kind="pubchem_search")
        return payload.get("IdentifierList", {}).get("CID", [])
    except Exception:
        return []


def fetch_properties_for_cids(cids: list[int]) -> list[dict]:
    if not cids:
        return []
    cid_list = ",".join(str(cid) for cid in cids)
    properties = [
        "MolecularFormula",
        "MolecularWeight",
        "CanonicalSMILES",
        "IsomericSMILES",
        "IUPACName",
        "XLogP",
        "TPSA",
        "HBondDonorCount",
        "HBondAcceptorCount",
        "Charge",
        "Complexity",
        "ExactMass",
        "MonoisotopicMass",
    ]
    url = f"{PUBCHEM_BASE}/compound/cid/{cid_list}/property/{','.join(properties)}/JSON"
    payload = fetch_json(url, cache_kind="pubchem_properties")
    return payload.get("PropertyTable", {}).get("Properties", [])


def fetch_synonyms(cid: int) -> list[str]:
    url = f"{PUBCHEM_BASE}/compound/cid/{cid}/synonyms/JSON"
    payload = fetch_json(url, cache_kind="pubchem_synonyms")
    info = payload.get("InformationList", {}).get("Information", [])
    if not info:
        return []
    return info[0].get("Synonym", [])[:15]


def fetch_sdf(cid: int) -> str:
    url = f"{PUBCHEM_BASE}/compound/cid/{cid}/record/SDF/?record_type=3d"
    return fetch_url(url, cache_kind="pubchem_sdf", suffix=".sdf")


def fetch_png(cid: int) -> bytes:
    url = f"{PUBCHEM_BASE}/compound/cid/{cid}/PNG?image_size=large"
    return fetch_url(url, binary=True, cache_kind="pubchem_png", suffix=".png")


def candidate_label(properties: dict, fallback_formula: str) -> str:
    return properties.get("IUPACName") or fallback_formula


def compound_from_cid(cid: int, *, query: str | None = None, ambiguous: bool = False, candidates: list[dict] | None = None) -> dict:
    properties = fetch_properties_for_cids([cid])[0]
    synonyms = fetch_synonyms(cid)
    formula = properties.get("MolecularFormula", "")
    breakdown = formula_breakdown(formula) if formula else []
    formula_mass = molar_mass(formula) if formula else None

    sdf_analysis = None
    try:
        atoms, bonds = parse_sdf(fetch_sdf(cid))
        geometry = geometry_from_coordinates(atoms)
        polarity = polarity_from_structure(atoms, bonds)
        sdf_analysis = {
            "atomCount": len(atoms),
            "bondCount": len(bonds),
            "geometry": geometry,
            "polarity": polarity,
        }
    except Exception as exc:
        sdf_analysis = {
            "atomCount": None,
            "bondCount": None,
            "geometry": {
                "shape": "Unavailable",
                "rotorClass": "Unavailable",
                "planarity": "Unavailable",
                "principalMoments": [],
            },
            "polarity": {
                "label": "Unavailable",
                "score": 0.0,
                "note": f"3D geometry analysis was unavailable: {exc}",
            },
        }

    display_name = compound_display_name(query, synonyms, properties.get("IUPACName"), formula)
    return {
        "cid": cid,
        "displayName": display_name,
        "iupacName": properties.get("IUPACName"),
        "formula": formula,
        "molecularWeight": properties.get("MolecularWeight"),
        "exactMass": properties.get("ExactMass"),
        "monoisotopicMass": properties.get("MonoisotopicMass"),
        "charge": properties.get("Charge"),
        "xlogp": properties.get("XLogP"),
        "tpsa": properties.get("TPSA"),
        "hBondDonorCount": properties.get("HBondDonorCount"),
        "hBondAcceptorCount": properties.get("HBondAcceptorCount"),
        "complexity": properties.get("Complexity"),
        "smiles": properties.get("SMILES") or properties.get("IsomericSMILES"),
        "connectivitySmiles": properties.get("ConnectivitySMILES") or properties.get("CanonicalSMILES"),
        "synonyms": synonyms,
        "formulaBreakdown": breakdown,
        "formulaMolarMass": formula_mass,
        "structure": {
            "imageUrl": f"/api/compound/cid/{cid}/png",
            "sdfUrl": f"/api/compound/cid/{cid}/sdf",
        },
        "analysis": sdf_analysis,
        "ambiguous": ambiguous,
        "candidates": candidates or [],
    }


def resolve_compound(query: str) -> dict:
    normalized = query.strip()
    if not normalized:
        return {"status": "error", "message": "Enter a compound name or chemical formula."}

    cids = search_cids(normalized)
    if not cids:
        matches = [
            item
            for item in CURATED_LIBRARY
            if item["name"].lower() == normalized.lower()
            or item["formula"].lower() == normalized.lower()
            or any(alias.lower() == normalized.lower() for alias in item.get("aliases", []))
        ]
        if matches:
            fallback_formula = matches[0]["formula"]
            cids = search_cids(fallback_formula)
        if not cids:
            return {
                "status": "not_found",
                "message": "No direct PubChem match was found. Try entering the chemical formula.",
                "promptForFormula": True,
                "query": normalized,
            }

    candidate_properties = fetch_properties_for_cids(cids[:8])
    candidates = []
    formula_mode = looks_like_formula(normalized)
    for props in candidate_properties:
        cid = props["CID"]
        candidates.append(
            {
                "cid": cid,
                "formula": props.get("MolecularFormula"),
                "molecularWeight": props.get("MolecularWeight"),
                "label": candidate_label(props, props.get("MolecularFormula", f"CID {cid}")),
            }
        )

    ambiguous = formula_mode and len(cids) > 1
    payload = compound_from_cid(cids[0], query=normalized, ambiguous=ambiguous, candidates=candidates)
    payload["status"] = "ok"
    if ambiguous:
        payload["message"] = "This formula maps to multiple compounds or isomers. The first match is shown below, and you can choose another candidate."
    elif len(cids) > 1:
        payload["message"] = "Multiple matches were found. The best-ranked result is shown first."
    else:
        payload["message"] = "Compound loaded successfully."
    return payload


def enriched_elements() -> list[dict]:
    merged = []
    for element in ELEMENTS:
        profile = ELEMENT_PROFILES_BY_NUMBER.get(element["atomicNumber"], {})
        merged.append({**element, "profile": profile})
    return merged


def element_detail(symbol: str | None = None, atomic_number: int | None = None) -> dict:
    target = None
    if symbol:
        cleaned = symbol.strip().title()
        for element in ELEMENTS:
            if element["symbol"] == cleaned:
                target = element
                break
    elif atomic_number is not None:
        target = ELEMENTS_BY_NUMBER.get(int(atomic_number))

    if not target:
        raise ValueError("Element was not found.")

    return {**target, "profile": ELEMENT_PROFILES_BY_NUMBER.get(target["atomicNumber"], {})}


def bootstrap_payload() -> dict:
    return {
        "elements": enriched_elements(),
        "library": CURATED_LIBRARY,
        "sources": {
            "iupac": IUPAC_SOURCE,
            "pubchemPeriodic": PUBCHEM_PERIODIC_SOURCE,
            "pubchemApi": "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
            "periodicProfiles": "https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json",
        },
    }


def local_network_urls(port: int) -> list[str]:
    urls: set[str] = set()

    try:
        hostname = socket.gethostname()
        for family, _, _, _, sockaddr in socket.getaddrinfo(hostname, None, socket.AF_INET):
            if family != socket.AF_INET:
                continue
            ip = sockaddr[0]
            if ip.startswith("127."):
                continue
            urls.add(f"http://{ip}:{port}")
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                urls.add(f"http://{ip}:{port}")
    except OSError:
        pass

    return sorted(urls)


class MoleculeBuilderHandler(BaseHTTPRequestHandler):
    server_version = "MoleculeBuilder/1.0"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if path == "/api/bootstrap":
                self.send_json(bootstrap_payload())
                return
            if path == "/api/elements":
                self.send_json({"status": "ok", "elements": enriched_elements()})
                return
            if path == "/api/element":
                symbol = query.get("symbol", [None])[0]
                atomic_number_value = query.get("atomicNumber", [None])[0]
                atomic_number = int(atomic_number_value) if atomic_number_value else None
                self.send_json({"status": "ok", "element": element_detail(symbol=symbol, atomic_number=atomic_number)})
                return
            if path == "/api/compound":
                self.send_json(resolve_compound(query.get("query", [""])[0]))
                return
            if path.startswith("/api/compound/cid/") and path.endswith("/sdf"):
                cid = int(path.split("/")[-2])
                self.send_bytes(fetch_sdf(cid).encode("utf-8"), "chemical/x-mdl-sdfile; charset=utf-8")
                return
            if path.startswith("/api/compound/cid/") and path.endswith("/png"):
                cid = int(path.split("/")[-2])
                self.send_bytes(fetch_png(cid), "image/png")
                return
            if path.startswith("/api/compound/cid/"):
                cid = int(path.split("/")[-1])
                payload = compound_from_cid(cid, ambiguous=False, candidates=[])
                payload["status"] = "ok"
                payload["message"] = "Compound loaded successfully."
                self.send_json(payload)
                return
            if path == "/api/balance":
                equation = query.get("equation", [""])[0]
                self.send_json({"status": "ok", **balance_equation(equation)})
                return
            self.serve_static(path)
        except Exception as exc:
            self.send_json({"status": "error", "message": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def log_message(self, format: str, *args) -> None:
        return

    def send_json(self, payload: dict, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_bytes(self, payload: bytes, content_type: str, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def serve_static(self, path: str) -> None:
        if path in ("", "/"):
            file_path = STATIC_DIR / "index.html"
        else:
            relative = path.lstrip("/")
            file_path = (STATIC_DIR / relative).resolve()
            if not str(file_path).startswith(str(STATIC_DIR.resolve())):
                self.send_error(HTTPStatus.FORBIDDEN)
                return

        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_bytes(file_path.read_bytes(), content_type)


def run_server(host: str, port: int, open_browser: bool) -> None:
    server = ThreadingHTTPServer((host, port), MoleculeBuilderHandler)
    browser_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    if open_browser:
        url = f"http://{browser_host}:{port}"
        threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()

    print(f"Molecule Builder is running at http://{browser_host}:{port}")
    if host not in {"127.0.0.1", "localhost"}:
        print(f"Server bind address: {host}:{port}")
        lan_urls = local_network_urls(port)
        if lan_urls:
            print("Open from phones or tablets on the same Wi-Fi using one of these URLs:")
            for lan_url in lan_urls:
                print(f"  {lan_url}")
        print("For worldwide sharing through ngrok, run: ngrok http 8000")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Molecule Builder...")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Molecule Builder local server.")
    parser.add_argument(
        "--host",
        default=os.environ.get("HOST", "0.0.0.0"),
        help="Host/interface to bind the server to. Use 0.0.0.0 for broader network access.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8000")),
        help="Port to run the app on.",
    )
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    args = parser.parse_args()
    run_server(args.host, args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()

