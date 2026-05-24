from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
STATIC_DIR = PROJECT_ROOT / "static"
ASSET_SITE_DIR = APP_ROOT / "app" / "src" / "main" / "assets" / "site"
DATA_DIR = ASSET_SITE_DIR / "data"
STRUCTURE_DIR = DATA_DIR / "structures"
BOOTSTRAP_PATH = DATA_DIR / "bootstrap.json"
OFFLINE_COMPOUNDS_PATH = DATA_DIR / "offline_compounds.json"

sys.path.insert(0, str(PROJECT_ROOT))
import app as molecule_app  # noqa: E402


def copy_static_site() -> None:
    shutil.copytree(
        STATIC_DIR,
        ASSET_SITE_DIR,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("downloads"),
    )


def existing_bundle_is_complete() -> bool:
    if not BOOTSTRAP_PATH.exists() or not OFFLINE_COMPOUNDS_PATH.exists():
        return False
    try:
        payload = json.loads(OFFLINE_COMPOUNDS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return False

    compounds = payload.get("compounds", [])
    if not compounds:
        return False

    for compound in compounds:
        cid = compound.get("cid")
        if not cid:
            return False
        image_url = compound.get("structure", {}).get("imageUrl", "")
        sdf_url = compound.get("structure", {}).get("sdfUrl", "")
        if image_url and not (STRUCTURE_DIR / f"{cid}.png").exists():
            return False
        if sdf_url and not (STRUCTURE_DIR / f"{cid}.sdf").exists():
            return False

    return True


def export_bootstrap() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BOOTSTRAP_PATH.write_text(
        json.dumps(molecule_app.bootstrap_payload(), indent=2),
        encoding="utf-8",
    )


def export_offline_compounds() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STRUCTURE_DIR.mkdir(parents=True, exist_ok=True)

    compounds_by_cid: dict[int, dict] = {}

    for item in molecule_app.CURATED_LIBRARY:
        query = item["name"]
        payload = molecule_app.resolve_compound(query)
        if payload.get("status") != "ok":
            formula = item.get("formula", "")
            if formula:
                payload = molecule_app.resolve_compound(formula)
        if payload.get("status") != "ok":
            print(f"Skipping '{query}' because no compound payload could be resolved.")
            continue

        cid = int(payload["cid"])
        offline_payload = compounds_by_cid.get(cid)
        if not offline_payload:
            offline_payload = json.loads(json.dumps(payload))
            offline_payload["status"] = "ok"
            offline_payload["message"] = "Compound loaded from the bundled library."
            offline_payload["offlineQueries"] = []
            compounds_by_cid[cid] = offline_payload

            image_url = ""
            sdf_url = ""

            try:
                (STRUCTURE_DIR / f"{cid}.png").write_bytes(molecule_app.fetch_png(cid))
                image_url = f"./data/structures/{cid}.png"
            except Exception as exc:
                print(f"PNG export unavailable for CID {cid}: {exc}")

            try:
                (STRUCTURE_DIR / f"{cid}.sdf").write_text(
                    molecule_app.fetch_sdf(cid),
                    encoding="utf-8",
                )
                sdf_url = f"./data/structures/{cid}.sdf"
            except Exception as exc:
                print(f"SDF export unavailable for CID {cid}: {exc}")

            offline_payload["structure"] = {
                "imageUrl": image_url,
                "sdfUrl": sdf_url,
            }

        query_values = {query, item.get("formula", ""), *item.get("aliases", [])}
        query_values.update(offline_payload.get("synonyms", []))
        offline_payload["offlineQueries"] = sorted(
            {value.strip() for value in query_values if value and value.strip()},
            key=str.lower,
        )

    offline_payload = {
        "compounds": sorted(compounds_by_cid.values(), key=lambda item: item.get("displayName", "")),
    }
    OFFLINE_COMPOUNDS_PATH.write_text(json.dumps(offline_payload, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the Android offline bundle for Molecule Builder.")
    parser.add_argument(
        "--refresh-data",
        action="store_true",
        help="Rebuild the bundled compound payloads and structures even if they already exist.",
    )
    args = parser.parse_args()

    ASSET_SITE_DIR.mkdir(parents=True, exist_ok=True)
    copy_static_site()
    export_bootstrap()

    if args.refresh_data or not existing_bundle_is_complete():
        export_offline_compounds()
        print(f"Prepared offline compound payloads at {OFFLINE_COMPOUNDS_PATH}")
    else:
        print(f"Reused existing offline compound payloads at {OFFLINE_COMPOUNDS_PATH}")

    print(f"Offline site assets are ready in {ASSET_SITE_DIR}")


if __name__ == "__main__":
    main()
