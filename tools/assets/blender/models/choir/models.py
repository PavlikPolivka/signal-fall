"""Choir models: violet and amber crystal, glowing cores, floating segments, no legs or wheels.

Same conventions as the Holdout models: 1 Blender unit = 1 tile, units face +X,
builders return named part lists (hull / turret / body / joints).
"""
import math
import random

from kit import box, cone, cylinder, material, root
from mathutils import Euler, Vector

TEAM_GREY = "d8d8d8"


def mats(style, team=None):
    return {
        "violet": material("ch_violet", "8f6ad8", rough=0.25, emission="3a2470", style=style),
        "violet_deep": material("ch_violet_deep", "4b2f86", rough=0.3, emission="22113f", style=style),
        "amber": material("ch_amber", "e0a640", rough=0.25, emission="7a4a10", style=style),
        "core": material("ch_core", "f2d4ff", emission="c58cff", style=style),
        "core_amber": material("ch_core_amber", "ffe2a8", emission="ffb347", style=style),
        "stone": material("ch_stone", "2e2b38", rough=1.0, style=style),
        "stone_dark": material("ch_stone_dark", "1f1d26", rough=1.0, style=style),
        "fire": material("ch_fire", "f4e0ff", emission="d9a8ff", style=style),
        "hum": material("ch_hum", "4a3478", emission="2e1a5c", style=style),
        "pool": material("ch_pool", "6a4ab0", emission="4d2f9a", style=style),
        "team": material("team", team or TEAM_GREY, rough=0.3, style=style),
    }


def joint(name, loc, parent=None):
    j = root(name)
    j.location = loc
    if parent is not None:
        j.parent = parent
    return j


def attach(objs, to):
    for o in objs:
        o.parent = to
        o.matrix_parent_inverse = to.matrix_world.inverted()
    return objs


def shard(name, r, h, loc, mat, rot=(0, 0, 0), verts=6):
    """Double-pointed crystal: two cones base to base."""
    x, y, z = loc
    up = cone(name, r, 0, h * 0.62, (x, y, z + h * 0.19), mat, verts=verts)
    down = cone(name + "_b", r, 0, h * 0.38, (x, y, z - h * 0.31), mat, rot=(math.pi, 0, 0), verts=verts)
    out = [up, down]
    if rot != (0, 0, 0):
        # Rotate both halves about the crystal's own center.
        e = Euler(rot)
        center = Vector(loc)
        for o in out:
            off = o.location - center
            off.rotate(e)
            o.location = center + off
            o.rotation_euler.rotate(e)
    return out


# --- infantry: floating crystal figures -------------------------------------


def figure(style, team, kind="grace"):
    """A tall core crystal with orbiting shards; walking is a glide with bobbing shards."""
    m = mats(style, team)
    body = joint("body", (0, 0, 0))
    orbit = joint("orbit", (0, 0, 0), body)
    orbit.matrix_parent_inverse = body.matrix_world.inverted()
    parts = []
    parts += attach(shard("core", 0.06, 0.32, (0, 0, 0.3), m["violet"]), body)
    parts += attach([cone("glow", 0.025, 0, 0.1, (0, 0, 0.3), m["core"], verts=6)], body)
    parts += attach([cylinder("team_ring", 0.075, 0.02, (0, 0, 0.26), m["team"], verts=10)], body)
    flash_at = (0.12, 0, 0.33)
    if kind == "grace":
        for k in range(3):
            a = k * 2 * math.pi / 3
            parts += attach(shard("orbit_shard", 0.022, 0.1, (0.1 * math.cos(a), 0.1 * math.sin(a), 0.33), m["amber"]), orbit)
    elif kind == "staccato":
        # A long spear shard held forward: the anti-armor lance.
        parts += attach(shard("spear", 0.03, 0.34, (0.12, -0.04, 0.33), m["amber"], rot=(0, math.pi / 2, 0)), body)
        for k in range(2):
            a = k * math.pi
            parts += attach(shard("orbit_shard", 0.02, 0.08, (0.09 * math.cos(a), 0.09 * math.sin(a), 0.38), m["violet_deep"]), orbit)
        flash_at = (0.3, -0.04, 0.33)
    else:  # cantor: a ring of small amber shards, no weapon
        for k in range(6):
            a = k * math.pi / 3
            parts += attach(shard("halo_shard", 0.015, 0.06, (0.11 * math.cos(a), 0.11 * math.sin(a), 0.3 + 0.03 * (k % 2)), m["core_amber"]), orbit)
        flash_at = None
    parts += attach([cylinder("shadow_core", 0.04, 0.02, (0, 0, 0.06), m["stone_dark"], verts=8)], body)
    flash = None
    if flash_at:
        flash = cone("flash", 0.04, 0, 0.08, flash_at, m["fire"], rot=(0, math.pi / 2, 0), verts=6)
        attach([flash], body)
        flash.hide_render = True
    return {"joints": {"body": body, "orbit": orbit}, "flash": flash, "hull": parts + ([flash] if flash else [])}


def pose_figure(model, anim, frame):
    j = model["joints"]
    j["body"].rotation_euler = (0, 0, 0)
    j["body"].location = (0, 0, 0)
    j["orbit"].rotation_euler = (0, 0, 0)
    if model["flash"]:
        model["flash"].hide_render = True
    if anim == "walk":
        t = 2 * math.pi * frame / 6
        j["body"].location = (0, 0, 0.02 * math.sin(t))
        j["body"].rotation_euler = (0, math.radians(8), 0)
        j["orbit"].rotation_euler = (0, 0, t / 3)
    elif anim == "idle":
        j["body"].location = (0, 0, 0.01)
    elif anim == "fire":
        j["orbit"].rotation_euler = (0, 0, math.radians(20 * frame))
        if model["flash"] and frame == 0:
            model["flash"].hide_render = False
    elif anim == "death":
        # The figure shatters: shards drop and tilt.
        t = (frame + 1) / 4
        j["body"].rotation_euler = (math.radians(70 * t), 0, math.radians(30 * t))
        j["body"].location = (0, 0, -0.18 * t)


def grace(style, team=None):
    return figure(style, team, "grace")


def staccato(style, team=None):
    return figure(style, team, "staccato")


def cantor(style, team=None):
    return figure(style, team, "cantor")


# --- floating vehicles ----------------------------------------------------------


def levitate(m, r, z=0.12):
    """Under every Choir vehicle: a faint resonance glow on the ground instead of wheels."""
    return [cylinder("resonance", r * 0.35, 0.01, (0, 0, 0.01), m["hum"], verts=14)]


def cluster(m, rnd, n, spread, z, r, h, mat):
    out = []
    for _ in range(n):
        a = rnd.random() * 2 * math.pi
        d = spread * rnd.random() ** 0.6
        out += shard("crystal", r * rnd.uniform(0.7, 1.2), h * rnd.uniform(0.7, 1.2), (d * math.cos(a), d * math.sin(a), z), mat, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    return out


def keel(m, r, z, depth, verts=6):
    """The floating body: one big faceted crystal, a pointed deep-violet crown over a long keel."""
    r *= 0.72
    out = [cone("keel", r, 0.0, depth * 1.1, (0, 0, z - depth * 0.55), m["violet"], rot=(math.pi, 0, 0), verts=verts)]
    out.append(cone("crown", r, r * 0.25, depth * 0.7, (0, 0, z + depth * 0.35), m["violet_deep"], verts=verts))
    out.append(cylinder("seam", r * 1.01, 0.012, (0, 0, z + 0.004), m["core_amber"], verts=verts))
    return out


def team_shards(m, n, radius, z, h=0.18, phase=0.0):
    """Small crystals in the team color, orbiting the hull: how Choir shows allegiance."""
    out = []
    for k in range(n):
        a = phase + k * 2 * math.pi / n
        out += shard("team_shard", 0.035, h, (radius * math.cos(a), radius * math.sin(a), z), m["team"])
    return out


def glissando(style, team=None):
    """Scout: a long horizontal shard skimming the ground, fins of amber."""
    m = mats(style, team)
    hull = levitate(m, 0.32)
    hull += shard("body", 0.15, 1.0, (0, 0, 0.36), m["violet"], rot=(0, math.pi / 2, 0))
    hull += shard("keelfin", 0.06, 0.35, (-0.05, 0, 0.24), m["violet_deep"])
    for side in (-1, 1):
        hull += shard("fin", 0.04, 0.4, (-0.2, side * 0.16, 0.42), m["amber"], rot=(side * 0.9, -0.4, 0))
    hull.append(cone("core", 0.05, 0, 0.16, (0.12, 0, 0.36), m["core"], rot=(0, math.pi / 2, 0)))
    hull += team_shards(m, 2, 0.2, 0.5, h=0.14, phase=math.pi / 2)
    return {"hull": hull}


def refrain(style, team=None):
    """Harvester: a floating geode split open, its crystal bowl gathering Echo; an amber maw at the front."""
    m = mats(style, team)
    rnd = random.Random(3)
    hull = levitate(m, 0.55)
    hull += keel(m, 0.55, 0.42, 0.42, verts=8)
    hull += cluster(m, rnd, 8, 0.36, 0.62, 0.07, 0.32, m["violet"])
    hull.append(cylinder("echo_store", 0.22, 0.1, (-0.1, 0, 0.56), material("ch_echo3", "38d8ee", emission="1aa6c4", style=style), verts=8))
    hull.append(cone("maw", 0.13, 0.05, 0.18, (0.48, 0, 0.42), m["core_amber"], rot=(0, -math.pi / 2, 0), verts=8))
    hull += team_shards(m, 3, 0.62, 0.5, phase=math.pi / 3)
    return {"hull": hull}


def basso(style, team=None):
    """Tank: a heavy floating crystal mass, a long prism cannon that turns, orbiting armor shards."""
    m = mats(style, team)
    rnd = random.Random(5)
    hull = levitate(m, 0.55)
    hull += keel(m, 0.56, 0.4, 0.45)
    hull += cluster(m, rnd, 5, 0.42, 0.55, 0.1, 0.34, m["violet_deep"])
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        hull += shard("armor_shard", 0.08, 0.3, (0.68 * math.cos(a), 0.68 * math.sin(a), 0.42), m["violet"], rot=(0, 0, a))
    hull += team_shards(m, 2, 0.5, 0.62, phase=math.pi / 2)
    turret = shard("prism", 0.14, 0.85, (0.28, 0, 0.78), m["violet"], rot=(0, math.pi / 2, 0))
    turret.append(cone("core", 0.1, 0, 0.3, (0.0, 0, 0.78), m["core"], rot=(0, math.pi / 2, 0)))
    turret += shard("crest", 0.06, 0.32, (-0.12, 0, 0.98), m["amber"])
    return {"hull": hull, "turret": turret}


def falsetto(style, team=None):
    """Mobile AA: twin tuning-fork spires that ring at aircraft, over a small floating keel."""
    m = mats(style, team)
    hull = levitate(m, 0.45)
    hull += keel(m, 0.45, 0.36, 0.36)
    hull += team_shards(m, 3, 0.5, 0.42)
    turret = []
    for dy in (-0.12, 0.12):
        turret += shard("tine", 0.05, 0.75, (0.05, dy, 0.85), m["violet"], rot=(0, math.radians(-20), 0))
    turret.append(cylinder("node", 0.1, 0.1, (0, 0, 0.5), m["core_amber"], verts=8))
    return {"hull": hull, "turret": turret}


def crescendo(style, team=None):
    """Artillery: a tall obelisk that lobs resonance charges, ringed by amber bands."""
    m = mats(style, team)
    hull = levitate(m, 0.5)
    hull += keel(m, 0.5, 0.38, 0.4)
    hull += team_shards(m, 3, 0.56, 0.44, phase=0.4)
    turret = shard("obelisk", 0.12, 1.1, (0.1, 0, 1.0), m["violet_deep"], rot=(0, math.radians(-30), 0))
    turret.append(cone("tip", 0.07, 0, 0.2, (0.38, 0, 1.47), m["core_amber"], rot=(0, math.radians(-30), 0)))
    for k in range(3):
        turret.append(cylinder("band", 0.15, 0.02, (0.02 + k * 0.08, 0, 0.72 + k * 0.14), m["amber"], rot=(0, math.radians(-30), 0), verts=10))
    return {"hull": hull, "turret": turret}


def aria(style, team=None):
    """Air: a crystal with two blade wings, flickering as it flies."""
    m = mats(style, team)
    body = joint("body", (0, 0, 0))
    hull = shard("body", 0.12, 0.8, (0, 0, 1.0), m["violet"], rot=(0, math.pi / 2, 0))
    for side in (-1, 1):
        hull += shard("wing", 0.05, 0.9, (-0.05, side * 0.42, 1.03), m["amber"], rot=(side * math.radians(70), 0, side * math.radians(-15)))
        hull += shard("team_wingtip", 0.03, 0.2, (-0.2, side * 0.78, 1.05), m["team"], rot=(side * math.radians(70), 0, 0))
    hull.append(cone("core", 0.07, 0, 0.2, (0.1, 0, 1.0), m["core"], rot=(0, math.pi / 2, 0)))
    attach(hull, body)
    return {"hull": hull, "joints": {"body": body}}


def pose_aria(model, anim, frame):
    model["joints"]["body"].location = (0, 0, 0.04 * (1 if frame else -1))


def requiem(style, team=None):
    """T3: a great floating ring of shards around a beam crystal."""
    m = mats(style, team)
    hull = levitate(m, 0.75)
    hull += keel(m, 0.4, 0.42, 0.4)
    hull.append(cylinder("ring", 0.82, 0.08, (0, 0, 0.6), m["violet_deep"], verts=16))
    hull.append(cylinder("ring_inner", 0.66, 0.09, (0, 0, 0.6), m["stone_dark"], verts=16))
    for k in range(8):
        a = k * math.pi / 4
        hull += shard("ring_shard", 0.06, 0.3, (0.74 * math.cos(a), 0.74 * math.sin(a), 0.76), m["team"] if k % 2 else m["amber"])
    turret = shard("beam", 0.16, 1.0, (0.15, 0, 1.0), m["violet"], rot=(0, math.radians(70), 0))
    turret.append(cone("eye", 0.12, 0, 0.3, (0.45, 0, 1.03), m["core"], rot=(0, math.pi / 2, 0)))
    return {"hull": hull, "turret": turret}


def overture(style, team=None):
    """Construction unit: a floating seed pod that will grow into an Opus."""
    m = mats(style, team)
    rnd = random.Random(9)
    hull = levitate(m, 0.7)
    hull.append(cone("pod", 0.55, 0.0, 1.0, (0, 0, 1.0), m["stone"], verts=8))
    hull.append(cone("pod_base", 0.55, 0.0, 0.45, (0, 0, 0.27), m["stone_dark"], rot=(math.pi, 0, 0), verts=8))
    for k in range(4):
        a = k * math.pi / 2
        hull.append(box("vein", (0.04, 0.02, 0.8), (0.33 * math.cos(a), 0.33 * math.sin(a), 0.85), m["core"], rot=(0, math.radians(-25) * math.cos(a), a)))
    hull += cluster(m, rnd, 5, 0.35, 0.6, 0.08, 0.3, m["violet"])
    hull.append(cylinder("seam", 0.56, 0.04, (0, 0, 0.5), m["core_amber"], verts=8))
    hull += team_shards(m, 4, 0.7, 0.6, h=0.22)
    return {"hull": hull}


# --- buildings: floating crystal over a resonance bed, the same language as the vehicles ---
#
# Every structure is one or more faceted crystal masses (crown + keel + amber seam)
# hovering over a thin dark bed with a glowing resonance ring, with small shards
# orbiting it and team-colored shards marking the owner. Parts named glow_* go dark
# when the building is damaged.


def bed(w, d, m, h=0.06):
    """Thin dark bed with a faint resonance ring: the footprint, without a heavy slab."""
    out = [box("bed", (w - 0.1, d - 0.1, h), (0, 0, h / 2), m["stone_dark"], bevel=0.03)]
    r = min(w, d) * 0.42
    out.append(cylinder("glow_resonance", r, 0.012, (0, 0, h + 0.006), m["hum"], verts=24))
    out.append(cylinder("bed_inner", r * 0.86, 0.014, (0, 0, h + 0.008), m["stone_dark"], verts=24))
    return out


def mass(m, r, loc, depth, verts=6, crown="violet_deep", body="violet", seam="core_amber"):
    """A floating crystal mass at loc: deep crown above, long keel below, amber seam between (the vehicle hull)."""
    x, y, z = loc
    return [
        cone("keel", r, 0.0, depth * 1.1, (x, y, z - depth * 0.55), m[body], rot=(math.pi, 0, 0), verts=verts),
        cone("crown", r, r * 0.25, depth * 0.7, (x, y, z + depth * 0.35), m[crown], verts=verts),
        cylinder("seam", r * 1.01, 0.014, (x, y, z + 0.004), m[seam], verts=verts),
    ]


def orbit(m, n, radius, z, r=0.06, h=0.26, mat="violet", center=(0, 0), phase=0.0, team_every=0):
    """A ring of small shards around a mass; every team_every-th one in the team color."""
    out = []
    cx, cy = center
    for k in range(n):
        a = phase + k * 2 * math.pi / n
        mt = m["team"] if team_every and k % team_every == 0 else m[mat]
        out += shard("orbit", r, h, (cx + radius * math.cos(a), cy + radius * math.sin(a), z + 0.05 * math.sin(3 * a)), mt, rot=(0, 0.25 * math.cos(a), 0))
    return out


def ground_glow(m, r, loc=(0, 0)):
    """Light pooled under a floating mass."""
    return [cylinder("glow_under", r, 0.01, (loc[0], loc[1], 0.075), m["pool"], verts=12)]


def opus(style, team=None):
    """Construction yard: a great floating crystal with a spire crown, three satellite crystals and a ring of shards."""
    m = mats(style, team)
    b = bed(3, 3, m)
    b += ground_glow(m, 0.5)
    b += mass(m, 1.0, (0, 0, 1.3), 0.95, verts=8)
    b += shard("spire", 0.26, 1.3, (0, 0, 2.4), m["violet"])
    b.append(cone("glow_core", 0.2, 0, 0.5, (0, 0, 1.75), m["core"], verts=6))
    for k in range(3):
        a = math.radians(30) + k * 2 * math.pi / 3
        b += mass(m, 0.36, (1.05 * math.cos(a), 1.05 * math.sin(a), 0.72), 0.45, crown="violet", body="violet_deep")
    b += orbit(m, 10, 1.3, 1.4, r=0.08, h=0.34, team_every=2)
    return {"body": b}


def bell(style, team=None):
    """Power: an inverted crystal bell hanging in the air, its amber clapper glowing, two resonance rings around it."""
    m = mats(style, team)
    b = bed(2, 2, m)
    b += ground_glow(m, 0.38)
    b.append(cone("bell", 0.68, 0.18, 1.0, (0, 0, 1.15), m["violet"], verts=8))
    b.append(cone("bell_cap", 0.18, 0.0, 0.32, (0, 0, 1.81), m["violet_deep"], verts=8))
    b.append(cylinder("seam", 0.69, 0.025, (0, 0, 0.66), m["core_amber"], verts=8))
    b.append(cone("glow_clapper", 0.17, 0, 0.32, (0, 0, 0.45), m["core_amber"], rot=(math.pi, 0, 0), verts=6))
    for z, r in ((0.85, 0.86), (1.35, 0.66)):
        b.append(cylinder("ring", r, 0.045, (0, 0, z), m["violet_deep"], verts=16))
    b += orbit(m, 4, 0.86, 1.05, r=0.06, h=0.26, mat="team", phase=math.pi / 4)
    return {"body": b}


def coda(style, team=None):
    """Refinery: a floating geode split open around an Echo pool; the dock glows on the front (-y) side."""
    m = mats(style, team)
    rnd = random.Random(2)
    echo = material("ch_echo", "38d8ee", emission="1aa6c4", style=style)
    b = bed(3, 3, m)
    cx, cy = -0.25, 0.35
    b += ground_glow(m, 0.4, (cx, cy))
    b.append(cone("geode", 1.05, 0.0, 1.15, (cx, cy, 0.78), m["violet"], rot=(math.pi, 0, 0), verts=10))
    b.append(cylinder("geode_rim", 1.06, 0.12, (cx, cy, 1.4), m["violet_deep"], verts=10))
    b.append(cylinder("seam", 1.07, 0.025, (cx, cy, 1.33), m["core_amber"], verts=10))
    b.append(cylinder("glow_pool", 0.88, 0.03, (cx, cy, 1.45), echo, verts=10))
    for k in range(8):
        a = k * 2 * math.pi / 8 + rnd.uniform(-0.2, 0.2)
        b += shard("rim_crystal", 0.12, rnd.uniform(0.5, 0.8), (cx + 0.92 * math.cos(a), cy + 0.92 * math.sin(a), 1.68), m["violet"], rot=(0.35 * math.sin(a), -0.35 * math.cos(a), 0))
    # Dock: a floating amber plate where Refrains unload.
    b.append(cylinder("dock", 0.42, 0.08, (0.45, -1.0, 0.24), m["violet_deep"], verts=6))
    b.append(cylinder("glow_dock", 0.33, 0.02, (0.45, -1.0, 0.29), m["core_amber"], verts=6))
    b += orbit(m, 6, 1.22, 1.05, r=0.07, h=0.3, center=(cx, cy), mat="amber", team_every=2, phase=0.3)
    return {"body": b}


def loft(style, team=None):
    """Barracks: three tall floating shards in a triangle; figures crystallize in the light between them."""
    m = mats(style, team)
    b = bed(2, 2, m)
    b += ground_glow(m, 0.34)
    for k, (h, tilt) in enumerate(((1.65, 0.12), (1.3, 0.18), (1.15, 0.2))):
        a = math.radians(160) + k * 2 * math.pi / 3
        x, y = 0.48 * math.cos(a), 0.48 * math.sin(a)
        b += shard("pillar", 0.25, h, (x, y, 0.3 + h * 0.5), m["violet"] if k else m["violet_deep"], rot=(-tilt * math.sin(a), tilt * math.cos(a), 0))
        b.append(cylinder("seam", 0.17, 0.025, (x, y, 0.3 + h * 0.5), m["core_amber"], verts=6))
    b.append(cone("glow_heart", 0.15, 0, 0.36, (0, 0, 0.85), m["core"], verts=6))
    b.append(cone("glow_heart_b", 0.15, 0, 0.22, (0, 0, 0.56), m["core"], rot=(math.pi, 0, 0), verts=6))
    b += orbit(m, 6, 0.86, 0.75, r=0.055, h=0.24, team_every=2)
    return {"body": b}


def pit(style, team=None):
    """Vehicle factory: a floating ring of crystal over a glowing birthing pool, two heavy crystals guarding the back."""
    m = mats(style, team)
    b = bed(3, 3, m)
    b.append(cylinder("glow_pool", 0.9, 0.02, (0.2, -0.2, 0.08), m["pool"], verts=16))
    b.append(cylinder("ring", 1.05, 0.18, (0.2, -0.2, 1.1), m["violet_deep"], verts=16))
    b.append(cylinder("ring_inner", 0.88, 0.19, (0.2, -0.2, 1.1), m["stone_dark"], verts=16))
    b.append(cylinder("seam", 1.06, 0.025, (0.2, -0.2, 1.0), m["core_amber"], verts=16))
    b += orbit(m, 12, 0.97, 1.32, r=0.08, h=0.36, center=(0.2, -0.2), team_every=3)
    for x, y in ((-0.85, 0.85), (-1.0, -0.3), (0.3, 1.0)):
        b += mass(m, 0.4, (x, y, 0.95), 0.62)
    return {"body": b}


def antiphon(style, team=None):
    """Radar: two floating spires answering each other across an amber node."""
    m = mats(style, team)
    b = bed(2, 2, m)
    for y in (-0.42, 0.42):
        b += ground_glow(m, 0.2, (0, y))
        b += shard("spire", 0.27, 1.9, (0, y, 1.25), m["violet"])
        b.append(cylinder("seam", 0.19, 0.025, (0, y, 1.25), m["core_amber"], verts=6))
        b += orbit(m, 3, 0.34, 0.65, r=0.05, h=0.22, center=(0, y), mat="team")
    b += shard("glow_node", 0.15, 0.38, (0, 0, 1.7), m["core_amber"])
    for z in (1.45, 1.95):
        b.append(box("glow_link", (0.025, 0.6, 0.025), (0, 0, z), m["core"]))
    return {"body": b}


def chord(style, team=None):
    """Faction special (1x1): a small floating crystal over an Echo seed, ringed by shards that make it regrow."""
    m = mats(style, team)
    echo = material("ch_echo2", "38d8ee", emission="1aa6c4", style=style)
    b = bed(1, 1, m)
    b.append(cylinder("glow_seed", 0.13, 0.12, (0, 0, 0.12), echo, verts=6))
    b += mass(m, 0.2, (0, 0, 0.75), 0.32)
    b += orbit(m, 6, 0.34, 0.42, r=0.05, h=0.26, mat="amber", team_every=2)
    return {"body": b}


def belfry(style, team=None):
    """Airfield: a floating landing disc held up by three hovering crystals."""
    m = mats(style, team)
    b = bed(3, 3, m)
    cx, cy = 0.25, -0.25
    b += ground_glow(m, 0.5, (cx, cy))
    b.append(cylinder("disc", 1.0, 0.12, (cx, cy, 0.8), m["violet_deep"], verts=12))
    b.append(cylinder("glow_disc", 0.82, 0.02, (cx, cy, 0.87), m["pool"], verts=12))
    b.append(cylinder("seam", 1.01, 0.025, (cx, cy, 0.75), m["core_amber"], verts=12))
    b.append(cone("disc_keel", 0.75, 0.0, 0.6, (cx, cy, 0.44), m["violet"], rot=(math.pi, 0, 0), verts=12))
    for k in range(3):
        a = math.radians(100) + k * 2 * math.pi / 3
        x, y = cx + 1.12 * math.cos(a), cy + 1.12 * math.sin(a)
        b += mass(m, 0.3, (x, y, 1.0), 0.5)
        b += orbit(m, 2, 0.4, 1.05, r=0.045, h=0.2, center=(x, y), mat="team", phase=a)
    return {"body": b}


def conservatory(style, team=None):
    """Tech center: a huge geode floating open, its glowing core between two halves, rings turning around it."""
    m = mats(style, team)
    b = bed(3, 3, m)
    b += ground_glow(m, 0.45)
    b.append(cone("lower", 1.0, 0.0, 1.0, (0, 0, 0.72), m["violet"], rot=(math.pi, 0, 0), verts=8))
    b.append(cylinder("seam_lower", 1.01, 0.025, (0, 0, 1.22), m["core_amber"], verts=8))
    b.append(cone("glow_core", 0.42, 0.0, 0.4, (0, 0, 1.45), m["core"], verts=8))
    b.append(cone("glow_core_b", 0.42, 0.0, 0.2, (0, 0, 1.35), m["core"], rot=(math.pi, 0, 0), verts=8))
    b.append(cone("upper", 0.85, 0.0, 1.25, (0, 0, 2.25), m["violet_deep"], verts=8))
    b.append(cylinder("seam_upper", 0.86, 0.025, (0, 0, 1.63), m["core_amber"], verts=8))
    b += orbit(m, 8, 1.25, 1.42, r=0.08, h=0.32, mat="amber", team_every=2)
    return {"body": b}


def discord(style, team=None):
    """Basic defense (1x1): a small floating crystal whose head shard turns to aim."""
    m = mats(style, team)
    b = [cylinder("glow_resonance", 0.36, 0.012, (0, 0, 0.01), m["hum"], verts=16)]
    b += ground_glow(m, 0.14)
    b += mass(m, 0.26, (0, 0, 0.45), 0.34)
    b += orbit(m, 3, 0.36, 0.42, r=0.03, h=0.14, mat="team")
    turret = shard("head", 0.1, 0.5, (0.08, 0, 0.72), m["violet"], rot=(0, math.radians(70), 0))
    turret.append(cone("eye", 0.06, 0, 0.12, (0.25, 0, 0.74), m["core"], rot=(0, math.pi / 2, 0)))
    return {"body": b, "turret": turret}


def descant(style, team=None):
    """AA defense (2x2): a floating crystal crowned with high spikes that sing at aircraft."""
    m = mats(style, team)
    b = bed(2, 2, m)
    b += ground_glow(m, 0.3)
    b += mass(m, 0.62, (0, 0, 0.68), 0.6, verts=8)
    b += orbit(m, 6, 0.8, 0.68, r=0.06, h=0.26, team_every=2)
    turret = []
    for k in range(3):
        a = k * 2 * math.pi / 3
        turret += shard("spike", 0.08, 1.0, (0.18 * math.cos(a) + 0.1, 0.18 * math.sin(a), 1.45), m["violet"], rot=(0, math.radians(-25), 0))
    turret.append(cylinder("node", 0.15, 0.12, (0, 0, 1.08), m["core_amber"], verts=8))
    return {"body": b, "turret": turret}


def fortissimo(style, team=None):
    """Heavy defense (2x2): a heavy floating crystal carrying a massive resonating cannon."""
    m = mats(style, team)
    b = bed(2, 2, m)
    b += ground_glow(m, 0.32)
    b += mass(m, 0.7, (0, 0, 0.7), 0.65, verts=8)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        b += shard("armor_shard", 0.11, 0.42, (0.85 * math.cos(a), 0.85 * math.sin(a), 0.7), m["violet"] if k % 2 else m["team"], rot=(0, 0, a))
    turret = shard("cannon", 0.24, 1.55, (0.45, 0, 1.38), m["violet"], rot=(0, math.radians(80), 0))
    turret.append(cone("core", 0.17, 0, 0.45, (0.05, 0, 1.38), m["core"], rot=(0, math.pi / 2, 0)))
    turret += shard("crest", 0.1, 0.48, (-0.15, 0, 1.68), m["amber"])
    return {"body": b, "turret": turret}


def fermata(style, team=None):
    """Wall: fused crystals hovering just above a low stone ridge, joined by an amber seam."""
    m = mats(style, team)
    rnd = random.Random(10)
    b = [box("ridge", (0.86, 0.34, 0.12), (0, 0, 0.06), m["stone_dark"], bevel=0.04)]
    b.append(box("glow_seam", (0.8, 0.06, 0.02), (0, 0, 0.13), m["core_amber"]))
    for k, x in enumerate((-0.28, 0, 0.28)):
        b += shard("block", 0.17, rnd.uniform(0.6, 0.75), (x, 0, 0.5), m["violet_deep"] if k % 2 else m["violet"], rot=(rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 0))
    b.append(box("team_band", (0.7, 0.2, 0.05), (0, 0, 0.47), m["team"]))
    return {"body": b}


# --- catalog ----------------------------------------------------------------------

INF = {"idle": 1, "walk": 6, "fire": 3, "death": 4}
UNITS = {
    "grace": dict(kind="infantry", frame=64, dirs=8, anims=INF, build=grace, pose=pose_figure),
    "staccato": dict(kind="infantry", frame=64, dirs=8, anims=INF, build=staccato, pose=pose_figure),
    "cantor": dict(kind="infantry", frame=64, dirs=8, anims=INF, build=cantor, pose=pose_figure),
    "glissando": dict(kind="vehicle", frame=112, dirs=16, build=glissando),
    "refrain": dict(kind="vehicle", frame=128, dirs=16, build=refrain),
    "basso": dict(kind="vehicle", frame=128, dirs=16, build=basso),
    "falsetto": dict(kind="vehicle", frame=112, dirs=16, build=falsetto),
    "crescendo": dict(kind="vehicle", frame=144, dirs=16, build=crescendo),
    "aria": dict(kind="air", frame=128, dirs=16, anims={"fly": 2}, build=aria, pose=pose_aria),
    "requiem": dict(kind="vehicle", frame=160, dirs=16, build=requiem),
    "overture": dict(kind="vehicle", frame=160, dirs=16, build=overture),
}

def grown(build, k):
    """Scale everything standing on the bed by k about the ground origin; the bed keeps the footprint."""

    def make(style, team=None):
        model = build(style, team)
        for o in model["body"] + model.get("turret", []):
            if o.name.startswith(("bed", "glow_resonance")):
                continue
            o.location = o.location * k
            o.scale = o.scale * k
        return model

    return make


def construction(body, turret):
    """Half-grown: no scaffolding; the crystals are seedlings, a third of their size, low over the bed."""
    for o in turret:
        o.hide_render = True
    for o in body:
        if o.name.startswith(("bed", "glow_resonance")):
            continue
        o.location = o.location * 0.4
        o.scale = o.scale * 0.4


BUILDINGS = {
    "opus": dict(footprint=(3, 3), frame=320, build=grown(opus, 1.25)),
    "bell": dict(footprint=(2, 2), frame=224, build=grown(bell, 1.2)),
    "coda": dict(footprint=(3, 3), frame=288, build=grown(coda, 1.25)),
    "loft": dict(footprint=(2, 2), frame=224, build=grown(loft, 1.2)),
    "pit": dict(footprint=(3, 3), frame=288, build=grown(pit, 1.2)),
    "antiphon": dict(footprint=(2, 2), frame=256, build=grown(antiphon, 1.2)),
    "chord": dict(footprint=(1, 1), frame=128, build=grown(chord, 1.2)),
    "belfry": dict(footprint=(3, 3), frame=288, build=grown(belfry, 1.25)),
    "conservatory": dict(footprint=(3, 3), frame=320, build=grown(conservatory, 1.2)),
    "discord": dict(footprint=(1, 1), frame=112, build=grown(discord, 1.2)),
    "descant": dict(footprint=(2, 2), frame=224, build=grown(descant, 1.2)),
    "fortissimo": dict(footprint=(2, 2), frame=224, build=grown(fortissimo, 1.2)),
    "fermata": dict(footprint=(1, 1), frame=96, build=fermata),
}
