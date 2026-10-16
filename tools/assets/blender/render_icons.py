"""Render sidebar icons / portraits: a 3/4 view framed tightly on each model.

blender -b --factory-startup -P tools/assets/blender/render_icons.py -- <faction> <out_dir> [id ...]

Writes <out_dir>/<id>.color.png and <id>.mask.png (team-colored areas white) at ICON_RENDER px.
The packer trims both identically and scales them down for the client.
"""
import importlib
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import kit  # noqa: E402
import meshy_import  # noqa: E402
from mathutils import Vector  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
faction, out_dir, only = args[0], args[1], set(args[2:])
sys.path.insert(0, os.path.join(HERE, "models", faction))
models = importlib.import_module("models")
STYLE = "gritty"
ICON_RENDER = 384
os.makedirs(out_dir, exist_ok=True)


def frame_tight(cam, objects, margin=1.08):
    """Center the orthographic camera on the objects' silhouette and zoom to fit."""
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    xs, ys = [], []
    for o in objects:
        if o.type != "MESH":
            continue
        for corner in o.bound_box:
            p = inv @ (o.matrix_world @ Vector(corner))
            xs.append(p.x)
            ys.append(p.y)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    size = max(max(xs) - min(xs), max(ys) - min(ys)) * margin
    cam.data.ortho_scale = size
    right = cam.matrix_world.to_quaternion() @ Vector((1, 0, 0))
    up = cam.matrix_world.to_quaternion() @ Vector((0, 1, 0))
    cam.location += right * cx + up * cy


def render(sid, objects):
    cam = bpy.context.scene.camera
    frame_tight(cam, objects)
    catcher = kit.shadow_catcher(size=1)
    catcher.hide_render = True
    # Icons render at full size with one pass of supersampling handled by EEVEE's AA.
    prefix = os.path.join(out_dir, sid)
    old = kit.SUPERSAMPLE
    kit.SUPERSAMPLE = 1
    kit.render_passes(objects, catcher, prefix, ICON_RENDER, samples=48, shadow=False)
    kit.SUPERSAMPLE = old


def setup():
    kit.reset()
    kit._materials.clear()
    kit.setup_sprite_camera(128)


for sid, spec in models.UNITS.items():
    if only and sid not in only:
        continue
    setup()
    model = meshy_import.build(sid, spec, lambda: spec["build"](STYLE))
    root = kit.root()
    for j in model.get("joints", {}).values():
        if j.parent is None:
            j.parent = root
    parts = [o for o in model["hull"] + model.get("turret", []) if o is not None]
    for o in parts:
        if o.parent is None:
            o.parent = root
    # Three-quarter view: facing the screen's lower left.
    root.rotation_euler = (0, 0, kit.sim_yaw(2, 8))
    pose = model.get("pose") if model.get("meshy") else spec.get("pose")
    if pose:
        pose(model, "idle", 0)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name != "shadow"]
    render(sid, meshes)
    print("ICON", sid)

for sid, spec in models.BUILDINGS.items():
    if only and sid not in only:
        continue
    setup()
    model = meshy_import.build(sid, spec, lambda: spec["build"](STYLE))
    parts = model["body"] + model.get("turret", [])
    meshes = [o for o in parts if o.type == "MESH"]
    render(sid, meshes)
    print("ICON", sid)
print("ICONS DONE")
