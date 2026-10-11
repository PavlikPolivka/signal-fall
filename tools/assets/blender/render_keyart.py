"""Key art for the title / setup screen: the three factions face off over an Echo field at dusk.

blender -b --factory-startup -P tools/assets/blender/render_keyart.py -- <out.png> [width height]
"""
import importlib.util
import math
import os
import random
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import kit  # noqa: E402
from mathutils import Vector  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
out = args[0]
W = int(args[1]) if len(args) > 1 else 1920
H = int(args[2]) if len(args) > 2 else 1080
STYLE = "gritty"


def faction_models(name):
    spec = importlib.util.spec_from_file_location(f"models_{name}", os.path.join(HERE, "models", name, "models.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def place(model, parts_keys, loc, yaw, scale=1.0, team=None):
    root = kit.root("unit")
    for key in parts_keys:
        for o in model.get(key, []):
            if o is not None and o.parent is None:
                o.parent = root
    for j in model.get("joints", {}).values():
        if j.parent is None:
            j.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, yaw)
    root.scale = (scale, scale, scale)
    return root


kit.reset()
kit._materials.clear()
scene = bpy.context.scene
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.film_transparent = False
scene.eevee.taa_render_samples = 96
try:
    scene.eevee.use_bloom = True  # older EEVEE
except AttributeError:
    pass
scene.view_settings.look = "AgX - Punchy" if "AgX - Punchy" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items] else "None"

# Dusk sky: deep blue-violet gradient via the world color.
world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes["Background"]
# Physical sky with the sun just below the horizon: amber glow low, deep blue-violet overhead.
sky = nt.nodes.new("ShaderNodeTexSky")
for t in ("NISHITA", "MULTIPLE_SCATTERING", "SINGLE_SCATTERING"):
    try:
        sky.sky_type = t
        break
    except TypeError:
        continue
sky.sun_elevation = math.radians(2)
sky.sun_rotation = math.radians(110)
for attr, val in (("altitude", 200), ("air_density", 3.0), ("aerosol_density", 4.0), ("dust_density", 4.0)):
    if hasattr(sky, attr):
        setattr(sky, attr, val)
nt.links.new(sky.outputs[0], bg.inputs[0])
bg.inputs[1].default_value = 0.25

# Ground: wasteland dirt, rocks, a big Echo field in the middle.
g = kit.ground(400, STYLE, "wasteland")
# Distant mesas on the skyline.
haze = kit.material("mesa_haze", "4a3248", rough=1.0, style="clean")
for i in range(9):
    a = math.radians(48 + i * 10 + (i * 17) % 6)
    d = 85 + (i * 37) % 40
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(d * math.cos(a), d * math.sin(a), 0))
    mesa = bpy.context.active_object
    for v in mesa.data.vertices:
        v.co *= 0.85 + ((hash((i, round(v.co.x, 2), round(v.co.y, 2))) % 100) / 100) * 0.3
        if v.co.z > 0.35:
            v.co.z = 0.35 + (v.co.z - 0.35) * 0.15  # flat top
    mesa.scale = (10 + (i * 13) % 8, 7, 9 + (i * 7) % 7)
    mesa.data.materials.append(haze)
rnd = random.Random(4)
for i in range(40):
    a = rnd.random() * 2 * math.pi
    d = rnd.uniform(4, 22)
    kit.rock((d * math.cos(a), d * math.sin(a), 0.1), rnd.uniform(0.2, 0.9), STYLE, seed=i)
kit.crystals((0, 0, 0), 55, STYLE, seed=3, spread=2.0)
kit.crystals((2.5, 2.0, 0), 25, STYLE, seed=8, spread=1.0)
echo_light = bpy.data.lights.new("echo_glow", "POINT")
echo_light.energy = 600
echo_light.color = (0.3, 0.9, 1.0)
eo = bpy.data.objects.new("echo_glow", echo_light)
eo.location = (0, 0, 1.2)
scene.collection.objects.link(eo)

# The three factions converge on the field.
holdout = faction_models("holdout")
halcyon = faction_models("halcyon")
choir = faction_models("choir")
place(holdout.bulldog(STYLE, "3d8bfd"), ["hull", "turret"], (-2.4, -2.1, 0), math.radians(25), 1.0)
place(holdout.grunt(STYLE, "3d8bfd"), ["hull"], (-1.7, -3.3, 0), math.radians(35), 1.4)
place(holdout.grunt(STYLE, "3d8bfd"), ["hull"], (-2.1, -3.0, 0), math.radians(30), 1.4)
place(halcyon.vector(STYLE, "e5484d"), ["hull", "turret"], (2.3, -2.5, 0), math.radians(150), 1.0)
place(halcyon.sentry(STYLE, "e5484d"), ["hull"], (1.6, -3.5, 0), math.radians(140), 1.4)
place(choir.basso(STYLE, "30a46c"), ["hull", "turret"], (0.5, 2.6, 0.2), math.radians(-95), 1.25)
place(choir.grace(STYLE, "30a46c"), ["hull"], (-0.8, 2.2, 0.1), math.radians(-80), 1.5)

# Camera: low, slightly above the crystals, looking across the field.
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 34
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = Vector((0.3, -8.6, 1.7))
direction = Vector((0, 1.0, 1.1)) - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

# Lights: low warm sun from behind-left (rim), cool fill from the camera side.
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.5
sun.color = (1.0, 0.72, 0.5)
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(78), 0, math.radians(200))
scene.collection.objects.link(so)
fill = bpy.data.lights.new("fill", "SUN")
fill.energy = 0.8
fill.color = (0.55, 0.6, 1.0)
fo = bpy.data.objects.new("fill", fill)
fo.rotation_euler = (math.radians(55), 0, math.radians(10))
scene.collection.objects.link(fo)
for loc, col, e in (((-4.2, -1.2, 1.5), (1.0, 0.75, 0.4), 120), ((3.6, -2.6, 1.0), (0.3, 0.9, 1.0), 150), ((0.8, 3.5, 1.2), (0.7, 0.45, 1.0), 200)):
    l = bpy.data.lights.new("accent", "POINT")
    l.energy = e
    l.color = col
    lo = bpy.data.objects.new("accent", l)
    lo.location = loc
    scene.collection.objects.link(lo)

scene.render.filepath = out
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("KEYART DONE", out)
