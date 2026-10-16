"""Render faction sprites to raw frames + a manifest.

blender -b --factory-startup -P tools/assets/blender/render.py -- <faction> <out_dir> [id ...]

For each unit: directions x animation frames, passes color/mask/shadow.
Vehicles with a turret render the hull and the turret separately.
Buildings render built / damaged / construction states; armed defenses add a
16-direction turret. The manifest lists every frame and its passes.
"""
import importlib
import json
import math
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import kit  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
faction, out_dir, only = args[0], args[1], set(args[2:])
sys.path.insert(0, os.path.join(HERE, "models", faction))
models = importlib.import_module("models")
# "pbr" = textured materials, edge wear and grime, rendered with Cycles; "gritty" = the original EEVEE look.
STYLE = os.environ.get("SF_STYLE", "gritty")
os.makedirs(out_dir, exist_ok=True)
manifest_path = os.path.join(out_dir, "manifest.json")
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"faction": faction, "sprites": {}}


def fresh(frame_px):
    kit.reset()
    kit._materials.clear()
    kit._images.clear()
    if STYLE == "pbr":
        kit.use_cycles()
    kit.setup_sprite_camera(frame_px)
    catcher = kit.shadow_catcher(size=12)
    return catcher


def link(parts, root):
    for o in parts:
        if o.parent is None:
            o.parent = root
    return parts


def frame_name(sid, part, anim, d, f):
    return f"{sid}/{part}/{anim}/{d:02d}/{f}"


# Vehicles and aircraft are modelled a bit large for detail; shrink them to sit well on 1-tile scale.
UNIT_SCALE = {"vehicle": 0.72, "air": 0.72, "infantry": 1.0}


MESHY_CFG = json.load(open(os.path.join(HERE, "..", "meshy", "models.json")))["models"]


def build_model(sid, spec):
    """A generated (Meshy) model when one has been made for this id, else the procedural one."""
    import meshy_import

    entry = MESHY_CFG.get(sid, {})
    cfg = dict(entry.get("render", {}))
    if spec.get("kind") == "infantry":
        if entry and meshy_import.has_character(sid):
            meshy_import.POSE_COUNTS.clear()
            meshy_import.POSE_COUNTS.update(spec.get("anims", {}))
            return meshy_import.load_character(sid, **cfg)
        return spec["build"](STYLE)
    if entry and meshy_import.has_model(sid):
        if "footprint" in spec:
            cfg.setdefault("footprint", spec["footprint"])
            cfg["building"] = True
        if entry.get("faction") == "choir":
            cfg.setdefault("key", "green")
        return meshy_import.load(sid, **cfg)
    return spec["build"](STYLE)


def render_unit(sid, spec):
    scale = UNIT_SCALE[spec["kind"]]
    frame_px = int(round(spec["frame"] * scale / 8) * 8)
    catcher = fresh(frame_px)
    model = build_model(sid, spec)
    root = kit.root()
    root.scale = (scale, scale, scale)
    hull = [o for o in model["hull"] if o is not None]
    turret = model.get("turret", [])
    # Joints (empties) parent the parts that hang off them; top-level things go under the root.
    for j in model.get("joints", {}).values():
        if j.parent is None:
            j.parent = root
    link(hull + turret, root)
    anims = spec.get("anims", {"idle": 1})
    dirs = spec["dirs"]
    entry = {"kind": spec["kind"], "frame": frame_px, "dirs": dirs, "anims": anims, "turret": bool(turret), "frames": []}
    pose = model.get("pose") if model.get("meshy") else spec.get("pose")
    for d in range(dirs):
        root.rotation_euler = (0, 0, kit.sim_yaw(d, dirs))
        for anim, count in anims.items():
            for f in range(count):
                if pose:
                    pose(model, anim, f)
                for o in turret:
                    o.visible_camera = False
                name = frame_name(sid, "hull", anim, d, f)
                kit.render_passes(hull, catcher, os.path.join(out_dir, name.replace("/", "_")), frame_px, shadow=spec["kind"] != "air")
                entry["frames"].append(name)
                for o in turret:
                    o.visible_camera = True
        if turret:
            for o in hull:
                o.visible_camera = False
            name = frame_name(sid, "turret", "idle", d, 0)
            kit.render_passes(turret, catcher, os.path.join(out_dir, name.replace("/", "_")), frame_px, shadow=False)
            entry["frames"].append(name)
            for o in hull:
                o.visible_camera = True
    return entry


def render_building(sid, spec):
    frame_px = spec["frame"]
    w, dpt = spec["footprint"]
    entry = {"kind": "building", "frame": frame_px, "footprint": [w, dpt], "frames": [], "turret": False}
    for state in ("built", "damaged", "construction"):
        catcher = fresh(frame_px)
        model = build_model(sid, spec)
        body = model["body"]
        turret = model.get("turret", [])
        root = kit.root()
        link(body + turret, root)
        if state == "damaged":
            m = kit.material("scorch", "1a1714", rough=1.0, style=STYLE)
            import random

            rnd = random.Random(sid)
            for _ in range(6 + w * dpt):
                s = rnd.uniform(0.15, 0.35)
                o = kit.box("scorch", (s, s, 0.02), (rnd.uniform(-w / 2, w / 2) * 0.8, rnd.uniform(-dpt / 2, dpt / 2) * 0.8, rnd.uniform(0.1, 0.9)), m)
                o.parent = root
                body.append(o)
            for o in body + turret:
                if o.name.startswith(("light", "beacon", "glow", "pad_light")):
                    o.hide_render = True
        if state == "construction" and hasattr(models, "construction") and not model.get("meshy"):
            # The faction draws its own half-built look (Choir: crystals still growing).
            models.construction(body, turret)
        elif state == "construction":
            # Half-built: squash the body, hide the turret, add scaffolding.
            root.scale = (1, 1, 0.45)
            for o in turret:
                o.hide_render = True
            sc = kit.scaffold(w * 0.92, dpt * 0.92, 0.9, kit.material("scaffold", "a8a090", style=STYLE))
            for o in sc:
                o.parent = None
            body = body + sc
        for o in turret:
            o.visible_camera = False
        name = frame_name(sid, "body", state, 0, 0)
        kit.render_passes(body, catcher, os.path.join(out_dir, name.replace("/", "_")), frame_px)
        entry["frames"].append(name)
        for o in turret:
            o.visible_camera = True
        if turret and state == "built":
            entry["turret"] = True
            for o in body:
                o.visible_camera = False
            for d in range(16):
                for o in turret:
                    pass
                # Rotate only the turret around the building center.
                troot = kit.root("troot")
                for o in turret:
                    o.parent = troot
                troot.rotation_euler = (0, 0, kit.sim_yaw(d, 16))
                name = frame_name(sid, "turret", "idle", d, 0)
                kit.render_passes(turret, catcher, os.path.join(out_dir, name.replace("/", "_")), frame_px, shadow=False)
                entry["frames"].append(name)
                for o in turret:
                    o.parent = root
                bpy.data.objects.remove(troot)
            for o in body:
                o.visible_camera = True
    return entry


for sid, spec in models.UNITS.items():
    if only and sid not in only:
        continue
    manifest["sprites"][sid] = render_unit(sid, spec)
    json.dump(manifest, open(manifest_path, "w"), indent=1)
    print("RENDERED", sid, len(manifest["sprites"][sid]["frames"]))
for sid, spec in models.BUILDINGS.items():
    if only and sid not in only:
        continue
    manifest["sprites"][sid] = render_building(sid, spec)
    json.dump(manifest, open(manifest_path, "w"), indent=1)
    print("RENDERED", sid, len(manifest["sprites"][sid]["frames"]))
print("RENDER DONE")
