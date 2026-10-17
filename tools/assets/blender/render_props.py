"""Render map props (obstacles, decorations, Echo clusters) to raw frames + manifest.

blender -b --factory-startup -P tools/assets/blender/render_props.py -- <out_dir>

Frames are named prop/<id>/<variant> with color and shadow passes (no team mask).
"""
import json
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "models"))

import kit  # noqa: E402
import props  # noqa: E402

out_dir = sys.argv[sys.argv.index("--") + 1]
os.makedirs(out_dir, exist_ok=True)
STYLE = "gritty"
manifest = {"faction": "props", "sprites": {}}


def render(sid, frame_px, builder):
    kit.reset()
    kit._materials.clear()
    kit.setup_sprite_camera(frame_px)
    catcher = kit.shadow_catcher(size=10)
    objs = builder()
    name = f"{sid}/body/idle/00/0"
    kit.render_passes(objs, catcher, os.path.join(out_dir, name.replace("/", "_")), frame_px, samples=32)
    manifest["sprites"][sid] = {"kind": "prop", "frame": frame_px, "turret": False, "frames": [name]}


for pid, (builder, frame, variants) in props.PROPS.items():
    for v in range(variants):
        render(f"{pid}_{v}", frame, lambda b=builder, s=v: b(STYLE, s))
    print("RENDERED", pid)
for lid, (builder, frame) in props.LANDMARKS.items():
    render(lid, frame, lambda b=builder: b(STYLE, 0))
    print("RENDERED", lid)
# Echo: the crystal cluster per size (crystals left) in three variants.
for size in range(1, props.ECHO_SIZES + 1):
    for v in range(3):
        render(f"echo_{size}_{v}", 80, lambda s=size, var=v: props.real.echo(STYLE, s, var))
print("RENDERED echo")
json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=1)
print("RENDER DONE")
