"""Map props built from real models: Poly Haven (CC0) scans in props/models/, and the Meshy Echo cluster.

Each builder takes (style, seed) like the procedural ones in props.py and returns the objects of
one prop sitting on a tile centred at the origin (1 unit = 1 tile).
"""
import math
import os
import random

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(__file__)
PROPS = os.path.normpath(os.path.join(HERE, "..", "..", "props", "models"))
MESHY = os.path.normpath(os.path.join(HERE, "..", "..", "meshy", "models"))


def _load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    others = [o.name for o in new if o.type != "MESH"]
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for name in others:
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name])
    return obj


def _tint(obj, rgb, amount):
    """Pull the base color toward `rgb` (linear 0-1) by `amount` (0-1)."""
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["Factor"].default_value = amount
        mix.inputs[7].default_value = (*rgb, 1)
        if bsdf.inputs["Base Color"].is_linked:
            nt.links.new(bsdf.inputs["Base Color"].links[0].from_socket, mix.inputs[6])
        else:
            mix.inputs[6].default_value = bsdf.inputs["Base Color"].default_value
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])


def place(name, *, size, x=0.0, y=0.0, z=0.0, yaw=0.0, height=None, stretch=1.0, tint=None, tint_amount=0.5, glow=None, folder=PROPS):
    """Import a model, rest it on the ground, scale its widest side to `size` tiles (or its height to
    `height`), turn it by `yaw` and move it to (x, y)."""
    obj = _load(os.path.join(folder, f"{name}.glb"))
    vs = [v.co for v in obj.data.vertices]
    cx = (max(v.x for v in vs) + min(v.x for v in vs)) / 2
    cy = (max(v.y for v in vs) + min(v.y for v in vs)) / 2
    z0 = min(v.z for v in vs)
    ex = max(v.x for v in vs) - min(v.x for v in vs)
    ey = max(v.y for v in vs) - min(v.y for v in vs)
    ez = max(v.z for v in vs) - z0
    s = (height / max(1e-6, ez)) if height else (size / max(1e-6, ex, ey))
    obj.data.transform(Matrix.Translation(Vector((-cx, -cy, -z0))))
    obj.data.transform(Matrix.Scale(s, 4))
    if stretch != 1.0:
        obj.data.transform(Matrix.Scale(stretch, 4, Vector((0, 0, 1))))
    obj.data.transform(Matrix.Rotation(yaw, 4, "Z"))
    obj.data.transform(Matrix.Translation(Vector((x, y, z))))
    obj.data.update()
    if tint:
        _tint(obj, tint, tint_amount)
    if glow:
        for slot in obj.material_slots:
            bsdf = next((n for n in slot.material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if slot.material else None
            if bsdf:
                bsdf.inputs["Emission Color"].default_value = (*glow, 1)
                bsdf.inputs["Emission Strength"].default_value = 0.6
    return obj


BOULDERS = ["namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_04", "namaqualand_boulder_05", "namaqualand_boulder_06", "namaqualand_boulders_01"]
MOON = ["moon_rock_01", "moon_rock_02", "moon_rock_03", "moon_rock_04", "moon_rock_05"]
VIOLET = (0.16, 0.08, 0.32)


def rock_wasteland(style, seed):
    rnd = random.Random(seed)
    out = [place(BOULDERS[seed % len(BOULDERS)], size=rnd.uniform(0.85, 1.05), yaw=rnd.random() * 6.28)]
    if rnd.random() < 0.6:
        out.append(place("namaqualand_stones_01", size=0.45, x=rnd.uniform(-0.3, 0.3), y=rnd.uniform(-0.3, 0.3), yaw=rnd.random() * 6.28))
    return out


def rock_crystal(style, seed):
    """Dark violet rock with crystal growths."""
    rnd = random.Random(seed + 50)
    out = [place(MOON[seed % len(MOON)], size=rnd.uniform(0.85, 1.0), yaw=rnd.random() * 6.28, tint=VIOLET, tint_amount=0.55)]
    for _ in range(rnd.randint(1, 2)):
        out.append(echo_growth(rnd, x=rnd.uniform(-0.2, 0.2), y=rnd.uniform(-0.2, 0.2), height=rnd.uniform(0.35, 0.6), violet=True))
    return out


def echo_growth(rnd, *, x=0.0, y=0.0, z=0.0, height=0.4, violet=False):
    """The Meshy crystal cluster, scaled and turned; violet-tinted for Choir crystal biomes."""
    return place(
        "echo_cluster",
        size=0,
        height=height,
        x=x,
        y=y,
        z=z,
        yaw=rnd.random() * 6.28,
        folder=MESHY,
        tint=(0.26, 0.07, 0.55) if violet else None,
        tint_amount=0.82,
        glow=(0.4, 0.1, 0.75) if violet else None,
    )


def deco_rubble(style, seed):
    rnd = random.Random(seed + 10)
    name = ["namaqualand_stones_01", "sand_rocks_small_01", "namaqualand_rocks_01"][seed % 3]
    return [place(name, size=rnd.uniform(0.5, 0.65), yaw=rnd.random() * 6.28)]


def deco_wreck(style, seed):
    """Junk: barrels and a tyre, crates and a jerrycan, or a covered car."""
    rnd = random.Random(seed + 20)
    if seed % 3 == 0:
        return [
            place("Barrel_01", size=0, height=0.32, x=-0.12, y=0.05, yaw=rnd.random() * 6.28),
            place("barrel_03", size=0, height=0.3, x=0.1, y=-0.08, yaw=rnd.random() * 6.28),
            place("old_tyre", size=0.28, x=0.05, y=0.22, yaw=rnd.random() * 6.28),
        ]
    if seed % 3 == 1:
        return [
            place("old_military_crate", size=0.38, x=-0.1, y=0.0, yaw=rnd.random() * 6.28),
            place("wooden_crate_01", size=0.3, x=0.16, y=-0.12, yaw=rnd.random() * 6.28),
            place("metal_jerrycan", size=0, height=0.16, x=0.12, y=0.2, yaw=rnd.random() * 6.28),
        ]
    return [place("covered_car", size=0.95, yaw=rnd.random() * 6.28)]


def deco_outcrop(style, seed):
    """Crystal biome: a small violet rock with a crystal growth."""
    rnd = random.Random(seed + 30)
    return [
        place(MOON[(seed + 2) % len(MOON)], size=rnd.uniform(0.4, 0.55), yaw=rnd.random() * 6.28, tint=VIOLET, tint_amount=0.55),
        echo_growth(rnd, x=0.08, y=0.05, height=rnd.uniform(0.3, 0.45), violet=True),
    ]


def deco_tree(style, seed):
    rnd = random.Random(seed + 40)
    name, kw = [("quiver_tree_01", dict(size=0, height=1.1)), ("dead_quiver_trunk", dict(size=0, height=0.8)), ("dead_tree_trunk_02", dict(size=1.3))][seed % 3]
    return [place(name, yaw=rnd.random() * 6.28, **kw)]


# Clutter scattered on open ground by the client (cosmetic only).
def clutter_wasteland(style, seed):
    rnd = random.Random(seed + 60)
    name, kw = [
        ("searsia_burchellii", dict(size=0.55)),
        ("wild_rooibos_bush", dict(size=0.45)),
        ("dry_branches_medium_01", dict(size=0.55)),
        ("namaqualand_stones_01", dict(size=0.4)),
        ("shrub_02", dict(size=0, height=0.32, tint=DRY, tint_amount=0.45)),
        ("shrub_03", dict(size=0, height=0.28, tint=DRY, tint_amount=0.45)),
        ("shrub_04", dict(size=0, height=0.36, tint=DRY, tint_amount=0.4)),
        ("grass_medium_01", dict(size=0.5, tint=(0.3, 0.26, 0.12), tint_amount=0.55)),
    ][seed % 8]
    return [place(name, yaw=rnd.random() * 6.28, **kw)]


def clutter_city(style, seed):
    rnd = random.Random(seed + 70)
    name, kw = [
        ("concrete_road_barrier", dict(size=0.7)),
        ("street_lamp_01", dict(size=0, height=1.1)),
        ("modular_electricity_poles", dict(size=0, height=1.4)),
        ("utility_box_01", dict(size=0, height=0.35)),
        ("metal_trash_can", dict(size=0, height=0.25)),
        ("concrete_road_barrier_02", dict(size=0.7)),
        ("covered_car", dict(size=0.8)),
        ("fire_hydrant", dict(size=0, height=0.18)),
        ("street_lamp_02", dict(size=0, height=1.1)),
        ("covered_car", dict(size=0.8)),
    ][seed % 10]
    return [place(name, yaw=rnd.choice([0.0, 1.57, 3.14, 4.71]) + rnd.uniform(-0.15, 0.15) if name == "covered_car" else rnd.random() * 6.28, **kw)]


def clutter_crystal(style, seed):
    """Dark stones, pale alien succulents, violet grass and the odd crystal shard."""
    rnd = random.Random(seed + 80)
    k = seed % 6
    if k == 0:
        return [echo_growth(rnd, height=rnd.uniform(0.3, 0.42), violet=True),
                place(MOON[seed % len(MOON)], size=0.3, x=0.15, y=-0.1, yaw=rnd.random() * 6.28, tint=DARK, tint_amount=0.6)]
    if k in (1, 2):
        return [place("othonna_cerarioides", size=rnd.uniform(0.45, 0.6), yaw=rnd.random() * 6.28, tint=(0.1, 0.3, 0.32), tint_amount=0.65, glow=(0.02, 0.1, 0.12))]
    if k == 3:
        return [place("othonna_cerarioides", size=rnd.uniform(0.4, 0.5), yaw=rnd.random() * 6.28, tint=(0.3, 0.12, 0.42), tint_amount=0.65, glow=(0.1, 0.02, 0.14))]
    return [place(MOON[(seed + i) % len(MOON)], size=rnd.uniform(0.22, 0.4), x=rnd.uniform(-0.2, 0.2), y=rnd.uniform(-0.2, 0.2), yaw=rnd.random() * 6.28, tint=DARK, tint_amount=0.6)
            for i in range(1 + seed % 3)]


def echo(style, size, variant):
    """Echo crystals on a tile: the cluster, bigger the more crystals are left (size 1..4)."""
    rnd = random.Random(size * 7 + variant * 101)
    height = (0.28, 0.4, 0.52, 0.66)[size - 1]
    out = [echo_growth(rnd, height=height)]
    # Bigger fields: a smaller second cluster beside the main one.
    if size >= 3:
        a = rnd.random() * 6.28
        out.append(echo_growth(rnd, x=0.22 * math.cos(a), y=0.22 * math.sin(a), height=height * 0.55))
    return out


# Trees (Poly Haven scans). Wasteland trees are sun-bleached toward olive; groves of two or three
# fill an obstacle tile like a copse.
DRY = (0.2, 0.18, 0.08)
WASTE_TREES = [
    ("island_tree_01", 2.2), ("island_tree_02", 2.1), ("island_tree_03", 2.2),
    ("jacaranda_tree", 2.1), ("searsia_lucida", 1.4), ("quiver_tree_02", 1.6),
]


def tree_wasteland(style, seed):
    rnd = random.Random(seed + 90)
    name, h = WASTE_TREES[seed % len(WASTE_TREES)]
    out = [place(name, size=0, height=h * rnd.uniform(0.9, 1.1), x=-0.08, y=0.05, yaw=rnd.random() * 6.28, tint=DRY, tint_amount=0.3)]
    # Undergrowth: a shrub or a second, smaller tree.
    if seed % 2:
        n2, h2 = WASTE_TREES[(seed + 2) % len(WASTE_TREES)]
        out.append(place(n2, size=0, height=h2 * 0.65, x=0.28, y=-0.22, yaw=rnd.random() * 6.28, tint=DRY, tint_amount=0.35))
    else:
        out.append(place("othonna_cerarioides", size=0, height=0.45, x=0.25, y=-0.25, yaw=rnd.random() * 6.28, tint=DRY, tint_amount=0.3))
    return out


def tree_city(style, seed):
    """Street and park trees, a little greener than the wasteland's."""
    rnd = random.Random(seed + 95)
    name, h = [("tree_small_02", 1.7), ("jacaranda_tree", 1.7), ("island_tree_02", 1.6)][seed % 3]
    return [place(name, size=0, height=h, yaw=rnd.random() * 6.28, tint=DRY, tint_amount=0.15)]


# Rock formations: the client cuts every cluster of rock obstacles into rectangles (3x3 down to 1x1)
# and draws one of these per rectangle, so outcrops read as big landforms instead of tile-sized stones.
MASSES = [
    ("namaqualand_cliff_01", 1.0), ("namaqualand_boulder_03", 0.8), ("namaqualand_boulder_06", 0.8),
    ("namaqualand_boulder_02", 0.75), ("namaqualand_boulder_04", 0.8), ("namaqualand_boulder_05", 0.8), ("boulder_01", 0.85),
]
FRINGE = ["namaqualand_stones_01", "namaqualand_rocks_01", "sand_rocks_small_01", "namaqualand_boulders_01"]
DARK = (0.05, 0.045, 0.08)
SAND = (0.36, 0.26, 0.17)


def formation(fw, fd, seed, biome):
    """Rocks over an fw x fd tile footprint centred on the origin. Wasteland: sun-baked sandstone
    with scrub at the foot. Crystal: dark rock split by tall violet crystal spires."""
    rnd = random.Random(seed * 131 + fw * 17 + fd * 5 + (0 if biome == "wasteland" else 1000))
    crystal = biome == "crystal"
    tint = dict(tint=DARK, tint_amount=0.62) if crystal else dict(tint=SAND, tint_amount=0.25)
    out = []
    # A long ridge along the long side of big footprints.
    if max(fw, fd) >= 3 and rnd.random() < 0.6:
        along = 0.0 if fw >= fd else 1.5708
        out.append(place("namaqualand_cliff_02", size=max(fw, fd) * 0.95, yaw=along + rnd.uniform(-0.25, 0.25) + rnd.choice([0, 3.1416]), stretch=rnd.uniform(1.0, 1.4), **tint))
    # Masses on every cell, overlapping so the rock reads as one body; the middle stands taller.
    for i in range(fw):
        for j in range(fd):
            cx, cy = i - (fw - 1) / 2, j - (fd - 1) / 2
            centre = 1 - (abs(cx) / max(1, fw) + abs(cy) / max(1, fd))
            for big in (True, False):
                name, k = MASSES[rnd.randrange(len(MASSES))]
                out.append(place(
                    name,
                    size=(rnd.uniform(1.1, 1.35) if big else rnd.uniform(0.6, 0.8)) * k,
                    x=cx + rnd.uniform(-0.15, 0.15) + (0 if big else rnd.choice([-0.35, 0.35])),
                    y=cy + rnd.uniform(-0.15, 0.15) + (0 if big else rnd.choice([-0.35, 0.35])),
                    yaw=rnd.random() * 6.28,
                    stretch=rnd.uniform(1.5, 2.1) * (0.8 + 0.5 * centre) * (1 if big else 0.8),
                    **tint,
                ))
    # Scree and stones around the foot.
    for _ in range(fw + fd + rnd.randint(0, 2)):
        side = rnd.randrange(4)
        t = rnd.uniform(-0.5, 0.5)
        x = (fw / 2 + 0.05) * (1 if side == 0 else -1) if side < 2 else t * fw
        y = (fd / 2 + 0.05) * (1 if side == 2 else -1) if side >= 2 else t * fd
        out.append(place(FRINGE[rnd.randrange(len(FRINGE))], size=rnd.uniform(0.3, 0.5), x=x, y=y, yaw=rnd.random() * 6.28, **tint))
    if crystal:
        # Spires break through the rock: a few tall ones, a crown of smaller growths.
        for _ in range(max(1, fw * fd * 2 // 3) + rnd.randint(0, 1)):
            out.append(echo_growth(rnd, x=rnd.uniform(-0.35, 0.35) * fw, y=rnd.uniform(-0.35, 0.35) * fd, z=0.15, height=rnd.uniform(0.9, 1.5), violet=True))
        for _ in range((fw + fd) // 2):
            out.append(echo_growth(rnd, x=rnd.uniform(-0.5, 0.5) * fw, y=rnd.uniform(-0.5, 0.5) * fd, height=rnd.uniform(0.3, 0.5), violet=True))
    else:
        for _ in range(rnd.randint(1, 1 + fw)):
            side = rnd.choice([-1, 1])
            name, h = [("shrub_02", 0.32), ("shrub_04", 0.36), ("searsia_burchellii", 0)][rnd.randrange(3)]
            kw = dict(size=0, height=h, tint=DRY, tint_amount=0.45) if h else dict(size=0.55)
            out.append(place(name, x=side * (fw / 2) * rnd.uniform(0.7, 1.0), y=rnd.uniform(-0.5, 0.5) * fd, yaw=rnd.random() * 6.28, **kw))
    return out
