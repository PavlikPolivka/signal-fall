"""Map props: obstacles per biome, decorations and Echo crystal clusters.

Each builder takes (style, seed) and returns a list of objects sitting on one
tile centred at the origin (1 unit = 1 tile).
"""
import math
import random

import bpy
from kit import box, cylinder, lattice_tower, material, strut, wedge
from mathutils import Euler, Vector


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


def deco_crater(style, seed):
    """Shell crater: scorched bowl with a raised, broken rim."""
    rnd = random.Random(seed)
    scorch = material("scorch", "1e1b18", rough=1.0, style=style)
    dirt = material("crater_rim", "5a4c3a", rough=1.0, style=style)
    r = 0.36 + seed * 0.04
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.01, location=(0, 0, 0.005), vertices=16)
    bowl = bpy.context.active_object
    bowl.data.materials.append(scorch)
    out = [bowl]
    for k in range(12):
        a = k / 12 * 6.28 + rnd.uniform(-0.1, 0.1)
        s = rnd.uniform(0.06, 0.11)
        out.append(_rock(rnd, (math.cos(a) * r, math.sin(a) * r, 0.02), s, dirt, flat=0.5))
    return out


# --- landmarks: big impassable set pieces; footprint side in tiles, centered at the origin ---


def lm_tower(style, seed):
    """The old relay tower: a lattice mast snapped halfway, its top and dish fallen beside it."""
    rnd = random.Random(seed)
    steel = material("mast_steel", "6a625a", rough=0.6, metal=0.5, style=style)
    rust = material("mast_rust", "7a4a30", rough=0.9, metal=0.2, style=style)
    conc = material("pad_concrete", "8a867e", rough=1.0, style=style)
    dish = material("dish", "b8b4aa", rough=0.5, metal=0.3, style=style)
    out = [box("pad", (1.7, 1.7, 0.12), (0, 0, 0.06), conc, bevel=0.03)]
    out += lattice_tower(0, 0, 1.9, 1.1, steel, levels=6)
    # Snapped top section lying across the pad, rusted.
    top = lattice_tower(0, 0, 1.2, 0.33, rust, levels=4)
    for o in top:
        o.location.rotate(Euler((0, math.radians(84), 0.6)))
        o.rotation_euler.rotate(Euler((0, math.radians(84), 0.6)))
        o.location += Vector((0.35, -0.55, 0.2))
    out += top
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.45, location=(-0.55, 0.5, 0.18), segments=16, ring_count=8)
    d = bpy.context.active_object
    d.scale = (1, 1, 0.35)
    d.rotation_euler = (0.9, 0.3, 0)
    d.data.materials.append(dish)
    out.append(d)
    for k in range(3):
        p0 = Vector((0.15, 0.1, 1.85))
        out.append(strut(p0, Vector((rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), 0.02)), 0.01, steel))
    out.append(box("hut", (0.45, 0.35, 0.32), (0.55, 0.55, 0.28), conc, bevel=0.02))
    return out


def lm_building(style, seed):
    """Collapsed three-storey block: slabs on pillars, one corner fallen in."""
    rnd = random.Random(seed)
    conc = material("block_concrete", "86827a", rough=1.0, style=style)
    dark = material("block_dark", "4a4743", rough=1.0, style=style)
    brick = material("block_brick", "7a4a36", rough=1.0, style=style)
    out = []
    w = 2.5
    for floor in range(3):
        z = floor * 0.6
        # Slabs: the +x,+y corner is missing on upper floors.
        if floor == 0:
            out.append(box("slab", (w, w, 0.08), (0, 0, z + 0.04), conc))
        else:
            out.append(box("slab", (w, w * 0.55, 0.08), (0, -w * 0.225, z + 0.04), conc, rot=(rnd.uniform(-0.03, 0.03), 0, 0)))
            out.append(box("slab", (w * 0.5, w * 0.45, 0.08), (-w * 0.25, w * 0.275, z + 0.04), conc))
        for px in (-1, 0, 1):
            for py in (-1, 0, 1):
                if floor > 0 and px >= 0 and py == 1:
                    continue
                out.append(box("pillar", (0.12, 0.12, 0.6), (px * (w / 2 - 0.08), py * (w / 2 - 0.08), z + 0.38), dark))
        # Brick infill walls with window gaps on the back sides.
        for k in range(4):
            if rnd.random() < 0.7:
                out.append(box("wall", (0.5, 0.08, 0.36), (-w / 2 + 0.35 + k * 0.6, -w / 2 + 0.04, z + 0.26), brick))
            if rnd.random() < 0.7:
                out.append(box("wall", (0.08, 0.5, 0.36), (-w / 2 + 0.04, -w / 2 + 0.35 + k * 0.6, z + 0.26), brick))
    # The fallen corner: a tilted slab and rubble.
    out.append(box("fallen", (1.2, 1.0, 0.08), (0.6, 0.75, 0.35), conc, rot=(0.5, -0.3, 0.2)))
    for _ in range(14):
        s = rnd.uniform(0.08, 0.2)
        out.append(_rock(rnd, (rnd.uniform(0, 1.2), rnd.uniform(0.3, 1.25), 0.05), s, dark if rnd.random() < 0.5 else conc, flat=0.6))
    return out


def lm_crashed(style, seed):
    """A downed dropship, nose buried, one wing torn off."""
    rnd = random.Random(seed)
    hull = material("dropship_hull", "6d6e66", rough=0.6, metal=0.4, style=style)
    burnt = material("dropship_burnt", "2a2622", rough=1.0, style=style)
    stripe = material("dropship_stripe", "a08a3a", rough=0.6, style=style)
    dirt = material("plough_dirt", "5a4a34", rough=1.0, style=style)
    glass = material("dropship_glass", "1d2a30", rough=0.2, metal=0.3, style=style)
    tilt = (0, 0.14, 0)
    out = [box("fuselage", (2.2, 0.8, 0.55), (0.1, 0, 0.36), hull, rot=tilt, bevel=0.08)]
    out.append(wedge("nose", (0.6, 0.7, 0.45), (-1.2, 0, 0.18), burnt, rot=(0, 0.3, math.pi), taper=0.4))
    out.append(wedge("cockpit", (0.5, 0.6, 0.18), (-0.75, 0, 0.66), glass, rot=(0, 0.14, math.pi), taper=0.5))
    out.append(box("stripe", (0.3, 0.82, 0.04), (0.35, 0, 0.66), stripe, rot=tilt))
    for y in (-0.5, 0.5):
        out.append(cylinder("engine", 0.18, 0.7, (1.0, y, 0.55), burnt if y > 0 else hull, rot=(0, math.pi / 2 + 0.14, 0), verts=10))
    out.append(wedge("tail", (0.6, 0.08, 0.55), (1.0, 0, 0.95), hull, rot=tilt))
    out.append(box("wing", (0.8, 0.9, 0.06), (0.35, 0.8, 0.4), hull, rot=(0.25, 0.14, 0)))
    out.append(box("torn_wing", (0.8, 0.8, 0.05), (0.7, -1.15, 0.04), burnt, rot=(0.05, 0.1, 2.6)))
    # Ploughed earth piled at the nose.
    for _ in range(9):
        out.append(_rock(rnd, (rnd.uniform(-1.4, -0.9), rnd.uniform(-0.5, 0.5), 0.05), rnd.uniform(0.12, 0.22), dirt, flat=0.5))
    for _ in range(6):
        out.append(box("debris", (0.15, 0.1, 0.03), (rnd.uniform(-1, 1.3), rnd.uniform(-1.2, 1.2), 0.02), burnt, rot=(0, 0, rnd.random() * 3)))
    for o in out:
        o.location.rotate(Euler((0, 0, 0.35)))
        o.rotation_euler.z += 0.35
    return out


def lm_monolith(style, seed):
    """A towering Echo-violet crystal monolith over a cracked rock base."""
    rnd = random.Random(seed)
    stone = material("monolith_stone", "3d3a4a", rough=1.0, style=style)
    violet = material("monolith_crystal", "a07ae8", rough=0.2, emission="6a40c8", style=style)
    out = [_rock(rnd, (0, 0, 0.2), 0.8, stone, flat=0.5)]
    for k in range(5):
        out.append(_rock(rnd, (rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), 0.1), rnd.uniform(0.2, 0.35), stone))
    spires = [(0, 0, 2.6, 0.32), (0.35, -0.2, 1.6, 0.2), (-0.3, 0.3, 1.3, 0.18), (0.2, 0.45, 0.9, 0.14), (-0.45, -0.35, 0.8, 0.13)]
    for (x, y, h, r) in spires:
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=r, radius2=r * 0.15, depth=h, location=(x, y, h / 2 + 0.15))
        o = bpy.context.active_object
        o.rotation_euler = (rnd.uniform(-0.12, 0.12) + x * 0.25, rnd.uniform(-0.12, 0.12) - y * 0.25, rnd.random())
        o.data.materials.append(violet)
        out.append(o)
    return out


VARIANTS = 6

import props_real as real  # noqa: E402  (real models: Poly Haven scans, the Meshy Echo cluster)
import city  # noqa: E402  (buildings from Poly Haven's modular facade kits)

# City blocks per footprint (w x d tiles): frame px. The client fills ruins clusters with these.
BUILDINGS = {(1, 1): 160, (2, 1): 256, (2, 2): 288, (3, 2): 352, (3, 3): 384}
BUILDING_VARIANTS = 4

# id -> (builder, frame px, variants)
PROPS = {
    "rock_wasteland": (real.rock_wasteland, 112, VARIANTS),
    "rock_city": (rock_city, 112, VARIANTS),
    "rock_crystal": (real.rock_crystal, 112, VARIANTS),
    "deco_rubble": (real.deco_rubble, 64, 3),
    "deco_wreck": (real.deco_wreck, 96, 3),
    "deco_outcrop": (real.deco_outcrop, 80, 3),
    "deco_tree": (real.deco_tree, 128, 3),
    "deco_crater": (deco_crater, 80, 3),
    # Scattered by the client on open ground (cosmetic).
    "clutter_wasteland": (real.clutter_wasteland, 80, 4),
    "clutter_city": (real.clutter_city, 128, 6),
    "clutter_crystal": (real.clutter_crystal, 64, 4),
    "tree_wasteland": (real.tree_wasteland, 224, 6),
    "tree_city": (real.tree_city, 208, 3),
}
for (_w, _d), _frame in BUILDINGS.items():
    # Even variants stand, odd ones are ruins.
    PROPS[f"bld_{_w}x{_d}"] = (lambda style, seed, w=_w, d=_d: city.block(w, d, seed, ruined=seed % 2 == 1), _frame, BUILDING_VARIANTS)

# id -> (builder, frame px); one variant each.
LANDMARKS = {
    "lm_tower": (lm_tower, 256),
    "lm_building": (lm_building, 288),
    "lm_crashed": (lm_crashed, 256),
    "lm_monolith": (lm_monolith, 256),
}
ECHO_SIZES = 4
