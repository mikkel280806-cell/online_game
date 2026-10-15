#!/usr/bin/env python3
"""Download the CC0 surface textures the Unity project uses (Poly Haven, 2K JPG).

They are not in git. Run once after cloning, before "Hollow Star > Build Vigil Scene":

    python3 tools/fetch_textures.py

Each set gets its own folder with diffuse, OpenGL normal, ARM (AO/roughness/metal) and displacement maps.
All Poly Haven assets are CC0 (https://polyhaven.com/license).
"""
import json
import os
import sys
import urllib.request

# Poly Haven id -> what it is for in the game.
SETS = {
    # Vesper terrain
    "forest_ground_04": "mossy lowland ground",
    "mossy_rock": "moss-covered rock",
    "lichen_rock": "lichen rock, highland",
    "rock_face_03": "cliff face",
    "cliff_side": "cliff face, layered",
    "rocks_ground_02": "rocky ground",
    "coast_sand_rocks_02": "sand with stones",
    "gravelly_sand": "gravel flats",
    "red_laterite_soil_stones": "red mineral soil",
    "snow_02": "snow and frost",
    # Wren, outpost and salvage
    "rusty_metal_02": "weathered metal",
    "metal_plate": "painted metal plate",
    "green_metal_rust": "painted metal, rusting",
}
MAPS = {"Diffuse": "diff", "nor_gl": "nor_gl", "arm": "arm", "Displacement": "disp"}
RES = "2k"

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "HollowStarUnity", "Assets", "_Project", "Art", "Textures", "CC0")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "HollowStar-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT)
    os.makedirs(out, exist_ok=True)
    total = 0
    for asset in SETS:
        files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
        folder = os.path.join(out, asset)
        os.makedirs(folder, exist_ok=True)
        for key, short in MAPS.items():
            entry = files.get(key, {}).get(RES, {}).get("jpg")
            if not entry:
                print(f"  {asset}: no {key}")
                continue
            path = os.path.join(folder, f"{asset}_{short}_{RES}.jpg")
            if os.path.exists(path) and os.path.getsize(path) == entry.get("size"):
                continue
            data = get(entry["url"])
            with open(path, "wb") as f:
                f.write(data)
            total += len(data)
        print(f"{asset}: ok")
    print(f"downloaded {total / 1e6:.0f} MB into {out}")


if __name__ == "__main__":
    main()
