
# Molecule Builder

Molecule Builder is a standalone local chemistry workbench built in Python and browser-native JavaScript. It lives in its own folder, opens from a `.bat` file, and combines molecule lookup, a full periodic table, element detail exploration, 2D and 3D visualization, reaction balancing, and an animated atom viewer.

## Features

- Full 118-element periodic table with click-to-detail exploration
- Expanded element profiles with history, geography-style occurrence context, and civics relevance notes
- Full data matrix for all elements with searchable fields
- Animated Bohr-style atom visualizer for each selected element
- Compound search by name with formula fallback
- Ambiguity handling for formula queries such as `C6H12O6`
- 2D structure images and 3D molecular viewer
- Formula breakdown with element mass percentages
- Heuristic symmetry and polarity analysis from 3D conformers
- Reaction balancing with exact integer coefficients
- Starter library of 85 compounds

## Run

Double-click `run_molecule_builder.bat`

Or run:

```powershell
cd "C:\Users\ACER\OneDrive\Desktop\Codex work\Molecule Builder"
python app.py
```

The app opens at `http://127.0.0.1:8000`.

For wider network visibility on your own machine or server:

```powershell
python app.py --host 0.0.0.0 --port 8000
```

When it starts in LAN mode, the server prints one or more local Wi-Fi URLs such as `http://10.243.x.x:8000`. Open that exact URL on your phone or tablet if it is connected to the same Wi-Fi.

If Windows blocks the connection, right-click `allow_molecule_builder_firewall.bat` and run it as administrator once.

To share it worldwide with `ngrok`:

```powershell
ngrok http 8000
```

Then use the public `https://...ngrok...` URL that ngrok prints.

There is also a built-in Cloudflare helper in this project:

```powershell
python start_public_tunnel.py
```

Or double-click `start_public_tunnel.bat`

That helper writes the live public URL into `logs\public_url.txt`.

## Data Sources

- IUPAC periodic table reference
- PubChem Periodic Table CSV
- PubChem PUG REST compound endpoints
- Bowserinator Periodic Table JSON for enriched educational element-profile fields

## Notes

- Compound lookup and 3D model fetching rely on network access to PubChem.
- The symmetry and polarity readouts are educational heuristics, not full quantum-chemistry calculations.
- Formula-only queries may map to several compounds or isomers, so the app exposes alternate matches instead of guessing silently.
- To make it publicly reachable worldwide, this app needs to be deployed on a public server or exposed through a tunnel/reverse proxy. Running it locally on `127.0.0.1` keeps it private to your machine.
- If another device on the same Wi-Fi still cannot connect, the usual blocker is the Windows firewall. Allow inbound TCP traffic on port `8000` for private networks.

