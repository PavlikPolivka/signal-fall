"""Map props: obstacles per biome, decorations and Echo crystal clusters.

Each builder takes (style, seed) and returns a list of objects sitting on one
tile centred at the origin (1 unit = 1 tile).
"""
import math
import random

import bpy
from kit import box, cylinder, material, strut, wedge
from mathutils import Vector


def _rock(rnd, loc, scale, mat, flat=0.7):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=loc)
    o = bpy.context.active_object
    for v in o.data.vertices:
        # Lumpy, with a flattened base so it sits on the ground.
        v.co *= 0.72 + rnd.random() * 0.5
        if v.co.z < -0.2:
            v.co.z = -0.2
    o.scale = (scale * rnd.uniform(0.8, 1.2), scale * rnd.uniform(0.8, 1.2), scale * flat * rnd.uniform(0.8, 1.3))
    o.rotation_euler = (rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), rnd.random() * 6.28)
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def rock_wasteland(style, seed):
    rnd = random.Random(seed)
    a = material("sandstone", "8a7552", rough=1.0, style=style)
    b = material("sandstone_dark", "6b5a40", rough=1.0, style=style)
    out = [_rock(rnd, (0, 0, 0.25), 0.42, a if seed % 2 else b, flat=0.9)]
    for _ in range(rnd.randint(1, 3)):
        out.append(_rock(rnd, (rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), 0.1), rnd.uniform(0.12, 0.24), b))
    return out


def rock_city(style, seed):
    """Ruins: broken wall sections, a collapsed slab, rebar, rubble."""
    rnd = random.Random(seed)
    conc = material("ruin_concrete", "7d7a74", rough=1.0, style=style)
    dark = material("ruin_dark", "56534e", rough=1.0, style=style)
    brick = material("ruin_brick", "7a4a36", rough=1.0, style=style)
    steel = material("rebar", "4a3a30", rough=0.8, metal=0.4, style=style)
    out = []
    h = rnd.uniform(0.45, 0.9)
    wall = box("wall", (0.8, 0.14, h), (0, rnd.uniform(-0.2, 0.2), h / 2), brick if seed % 3 == 0 else conc)
    # Jagged broken top: drop some upper vertices.
    for v in wall.data.vertices:
        if v.co.z > 0 and rnd.random() < 0.6:
            v.co.z -= rnd.uniform(0.05, 0.3)
    wall.rotation_euler = (0, 0, rnd.choice((0, math.pi / 2)) + rnd.uniform(-0.1, 0.1))
    out.append(wall)
    if seed % 2 == 0:
        out.append(box("slab", (0.6, 0.5, 0.08), (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0.12), conc, rot=(rnd.uniform(-0.4, 0.4), rnd.uniform(-0.3, 0.3), rnd.random())))
    for _ in range(rnd.randint(2, 4)):
        p0 = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.2, 0.2), h * 0.6))
        out.append(strut(p0, p0 + Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), rnd.uniform(0.15, 0.3))), 0.012, steel))
    for _ in range(rnd.randint(3, 6)):
        s = rnd.uniform(0.06, 0.14)
        out.append(box("rubble", (s, s * 1.3, s * 0.7), (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), s * 0.3), dark, rot=(0, 0, rnd.random() * 3)))
    return out


def rock_crystal(style, seed):
    """Crystal fields: dark rock studded with violet crystal spires."""
    rnd = random.Random(seed)
    stone = material("crystal_stone", "3d3a4a", rough=1.0, style=style)
    violet = material("violet_crystal", "8f6ad8", rough=0.25, emission="5a3aa8", style=style)
    out = [_rock(rnd, (0, 0, 0.2), 0.38, stone, flat=0.8)]
    for _ in range(rnd.randint(3, 6)):
        x, y = rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3)
        hgt = rnd.uniform(0.3, 0.75)
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=rnd.uniform(0.05, 0.1), radius2=0, depth=hgt, location=(x, y, hgt / 2 + 0.1))
        o = bpy.context.active_object
        o.rotation_euler = (rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), 0)
        o.data.materials.append(violet)
        out.append(o)
    return out


def deco_rubble(style, seed):
    rnd = random.Random(seed)
    mats = [material("rubble_a", "77716a", style=style), material("rubble_b", "5d5852", style=style)]
    out = []
    for i in range(rnd.randint(4, 8)):
        s = rnd.uniform(0.05, 0.12)
        out.append(box("rubble", (s, s * 1.4, s * 0.6), (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), s * 0.3), mats[i % 2], rot=(0, 0, rnd.random() * 3)))
    return out


def deco_wreck(style, seed):
    """Burnt-out civilian car."""
    rnd = random.Random(seed)
    burnt = material("burnt", "2e2925", rough=1.0, style=style)
    rust = material("wreck_rust", "6e3e26", rough=1.0, style=style)
    out = [box("body", (0.62, 0.3, 0.14), (0, 0, 0.14), rust, bevel=0.03)]
    out.append(box("cabin", (0.32, 0.27, 0.12), (-0.04, 0, 0.27), burnt, bevel=0.02))
    for x in (-0.2, 0.2):
        for y in (-0.15, 0.15):
            if rnd.random() < 0.7:
                out.append(cylinder("wheel", 0.07, 0.05, (x, y, 0.07), burnt, rot=(math.pi / 2, 0, 0), verts=8))
    for o in out:
        o.rotation_euler.z += rnd.random() * 6.28
    root = out[0]
    for o in out[1:]:
        o.location.rotate(root.rotation_euler)
    return out


def deco_outcrop(style, seed):
    rnd = random.Random(seed)
    m = material("outcrop", "9a7bd8", rough=0.3, emission="4a2a90", style=style)
    out = []
    for _ in range(rnd.randint(2, 4)):
        hgt = rnd.uniform(0.15, 0.35)
        bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=0.05, radius2=0, depth=hgt, location=(rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), hgt / 2))
        o = bpy.context.active_object
        o.rotation_euler = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 0)
        o.data.materials.append(m)
        out.append(o)
    return out


def deco_tree(style, seed):
    """Dead tree: trunk with a few bare branches."""
    rnd = random.Random(seed)
    bark = material("bark", "4a3a2a", rough=1.0, style=style)
    h = rnd.uniform(0.6, 0.95)
    top = Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), h))
    out = [strut(Vector((0, 0, 0)), top, 0.04, bark)]
    for _ in range(rnd.randint(2, 4)):
        p0 = top * rnd.uniform(0.45, 0.9)
        a = rnd.random() * 6.28
        p1 = p0 + Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, rnd.uniform(0.05, 0.2)))
        out.append(strut(p0, p1, 0.018, bark))
    return out


def echo_cluster(style, size):
    """Echo crystal cluster; size 1..4 (crystals left in the tile)."""
    rnd = random.Random(size * 31)
    m = material("echo", "38d8ee", rough=0.15, emission="1aa6c4", style=style)
    base = material("echo_base", "1d4d58", rough=0.6, style=style)
    out = []
    count = (2, 4, 7, 11)[size - 1]
    spread = (0.18, 0.26, 0.34, 0.4)[size - 1]
    for i in range(count):
        r = spread * (rnd.random() ** 0.7)
        a = rnd.random() * 6.28
        hgt = rnd.uniform(0.15, 0.42) * (0.75 + size * 0.12)
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=rnd.uniform(0.04, 0.08), radius2=0, depth=hgt, location=(r * math.cos(a), r * math.sin(a), hgt / 2))
        o = bpy.context.active_object
        o.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.random() * 6.28)
        o.data.materials.append(m)
        out.append(o)
    bpy.ops.mesh.primitive_cylinder_add(radius=spread + 0.08, depth=0.02, location=(0, 0, 0.01), vertices=10)
    o = bpy.context.active_object
    o.data.materials.append(base)
    out.append(o)
    return out


VARIANTS = 6

# id -> (builder, frame px, variants)
PROPS = {
    "rock_wasteland": (rock_wasteland, 96, VARIANTS),
    "rock_city": (rock_city, 112, VARIANTS),
    "rock_crystal": (rock_crystal, 112, VARIANTS),
    "deco_rubble": (deco_rubble, 64, 3),
    "deco_wreck": (deco_wreck, 80, 3),
    "deco_outcrop": (deco_outcrop, 64, 3),
    "deco_tree": (deco_tree, 96, 3),
}
ECHO_SIZES = 4
