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
    """Under every Choir vehicle: a soft glowing resonance disc instead of wheels."""
    return [cylinder("resonance", r * 0.5, 0.015, (0, 0, z * 0.5), m["hum"], verts=14)]


def cluster(m, rnd, n, spread, z, r, h, mat):
    out = []
    for _ in range(n):
        a = rnd.random() * 2 * math.pi
        d = spread * rnd.random() ** 0.6
        out += shard("crystal", r * rnd.uniform(0.7, 1.2), h * rnd.uniform(0.7, 1.2), (d * math.cos(a), d * math.sin(a), z), mat, rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))
    return out


def glissando(style, team=None):
    """Scout: a long horizontal shard skimming the ground."""
    m = mats(style, team)
    hull = levitate(m, 0.32)
    hull += shard("body", 0.16, 1.0, (0, 0, 0.36), m["violet"], rot=(0, math.pi / 2, 0))
    hull += shard("fin", 0.06, 0.4, (-0.15, 0, 0.5), m["amber"])
    hull.append(cone("core", 0.06, 0, 0.18, (0.05, 0, 0.36), m["core"], rot=(0, math.pi / 2, 0)))
    hull.append(cylinder("team_ring", 0.17, 0.04, (-0.2, 0, 0.36), m["team"], rot=(0, math.pi / 2, 0), verts=8))
    return {"hull": hull}


def refrain(style, team=None):
    """Harvester: a floating geode bowl with an amber collecting maw."""
    m = mats(style, team)
    rnd = random.Random(3)
    hull = levitate(m, 0.55)
    hull.append(cone("bowl", 0.62, 0.3, 0.42, (0, 0, 0.42), m["stone"], rot=(math.pi, 0, 0), verts=8))
    hull += cluster(m, rnd, 7, 0.36, 0.72, 0.07, 0.3, m["violet"])
    hull.append(cylinder("maw", 0.22, 0.12, (0.5, 0, 0.42), m["core_amber"], rot=(0, math.pi / 2, 0), verts=8))
    hull.append(cylinder("team_rim", 0.63, 0.05, (0, 0, 0.62), m["team"], verts=8))
    return {"hull": hull}


def basso(style, team=None):
    """Tank: heavy crystal mass with a rotating prism cannon."""
    m = mats(style, team)
    rnd = random.Random(5)
    hull = levitate(m, 0.55)
    hull.append(cone("base", 0.62, 0.35, 0.3, (0, 0, 0.3), m["stone"], verts=8))
    hull += cluster(m, rnd, 6, 0.42, 0.52, 0.1, 0.38, m["violet_deep"])
    hull.append(cylinder("team_rim", 0.61, 0.04, (0, 0, 0.42), m["team"], verts=8))
    turret = shard("prism", 0.14, 0.8, (0.25, 0, 0.72), m["violet"], rot=(0, math.pi / 2, 0))
    turret.append(cone("core", 0.1, 0, 0.3, (0.0, 0, 0.72), m["core"], rot=(0, math.pi / 2, 0)))
    turret += shard("crest", 0.06, 0.3, (-0.1, 0, 0.92), m["amber"])
    return {"hull": hull, "turret": turret}


def falsetto(style, team=None):
    """Mobile AA: twin tuning-fork spires that ring at aircraft."""
    m = mats(style, team)
    hull = levitate(m, 0.45)
    hull.append(cone("base", 0.5, 0.3, 0.26, (0, 0, 0.28), m["stone"], verts=8))
    hull.append(cylinder("team_rim", 0.46, 0.05, (0, 0, 0.36), m["team"], verts=8))
    turret = []
    for dy in (-0.12, 0.12):
        turret += shard("tine", 0.05, 0.7, (0.05, dy, 0.8), m["violet"], rot=(0, math.radians(-20), 0))
    turret.append(cylinder("node", 0.1, 0.1, (0, 0, 0.48), m["core_amber"], verts=8))
    return {"hull": hull, "turret": turret}


def crescendo(style, team=None):
    """Artillery: a tall obelisk that lobs resonance charges."""
    m = mats(style, team)
    hull = levitate(m, 0.5)
    hull.append(cone("base", 0.55, 0.32, 0.3, (0, 0, 0.3), m["stone"], verts=8))
    hull.append(cylinder("team_rim", 0.5, 0.05, (0, 0, 0.4), m["team"], verts=8))
    turret = shard("obelisk", 0.12, 1.1, (0.1, 0, 0.98), m["violet_deep"], rot=(0, math.radians(-30), 0))
    turret.append(cone("tip", 0.07, 0, 0.2, (0.38, 0, 1.45), m["core_amber"], rot=(0, math.radians(-30), 0)))
    for k in range(3):
        turret.append(cylinder("band", 0.15, 0.02, (0.02 + k * 0.08, 0, 0.7 + k * 0.14), m["amber"], rot=(0, math.radians(-30), 0), verts=10))
    return {"hull": hull, "turret": turret}


def aria(style, team=None):
    """Air: a crystal with two blade wings, flickering as it flies."""
    m = mats(style, team)
    body = joint("body", (0, 0, 0))
    hull = shard("body", 0.12, 0.8, (0, 0, 1.0), m["violet"], rot=(0, math.pi / 2, 0))
    for side in (-1, 1):
        hull += shard("wing", 0.05, 0.9, (-0.05, side * 0.42, 1.03), m["amber"], rot=(side * math.radians(70), 0, side * math.radians(-15)))
    hull.append(cone("core", 0.07, 0, 0.2, (0.1, 0, 1.0), m["core"], rot=(0, math.pi / 2, 0)))
    hull.append(cylinder("team_ring", 0.13, 0.03, (-0.15, 0, 1.0), m["team"], rot=(0, math.pi / 2, 0), verts=8))
    attach(hull, body)
    return {"hull": hull, "joints": {"body": body}}


def pose_aria(model, anim, frame):
    model["joints"]["body"].location = (0, 0, 0.04 * (1 if frame else -1))


def requiem(style, team=None):
    """T3: a great floating ring around a beam crystal."""
    m = mats(style, team)
    hull = levitate(m, 0.75)
    hull.append(cylinder("ring", 0.8, 0.1, (0, 0, 0.55), m["violet_deep"], verts=16))
    hull.append(cylinder("ring_inner", 0.62, 0.11, (0, 0, 0.55), m["stone_dark"], verts=16))
    for k in range(8):
        a = k * math.pi / 4
        hull += shard("ring_shard", 0.06, 0.3, (0.72 * math.cos(a), 0.72 * math.sin(a), 0.72), m["amber"])
    hull.append(cylinder("team_band", 0.81, 0.04, (0, 0, 0.48), m["team"], verts=16))
    turret = shard("beam", 0.16, 1.0, (0.15, 0, 0.95), m["violet"], rot=(0, math.radians(70), 0))
    turret.append(cone("eye", 0.12, 0, 0.3, (0.45, 0, 0.98), m["core"], rot=(0, math.pi / 2, 0)))
    return {"hull": hull, "turret": turret}


def overture(style, team=None):
    """Construction unit: a floating seed pod that will grow into an Opus."""
    m = mats(style, team)
    rnd = random.Random(9)
    hull = levitate(m, 0.7)
    hull.append(cone("pod", 0.6, 0.0, 1.1, (0, 0, 0.95), m["stone"], verts=8))
    hull.append(cone("pod_base", 0.6, 0.0, 0.4, (0, 0, 0.2), m["stone_dark"], rot=(math.pi, 0, 0), verts=8))
    hull += cluster(m, rnd, 6, 0.4, 0.75, 0.08, 0.35, m["violet"])
    hull.append(cylinder("seam", 0.62, 0.04, (0, 0, 0.42), m["core_amber"], verts=8))
    hull.append(cylinder("team_band", 0.5, 0.05, (0, 0, 0.75), m["team"], verts=8))
    return {"hull": hull}


# --- buildings: grown crystal on dark stone -----------------------------------------


def bed(w, d, m, h=0.08):
    """Dark stone bed with crystal growth at the edges instead of a concrete pad."""
    return [box("bed", (w - 0.08, d - 0.08, h), (0, 0, h / 2), m["stone_dark"], bevel=0.04)]


def opus(style, team=None):
    """Construction yard: a cathedral of crystal spires around a glowing core."""
    m = mats(style, team)
    rnd = random.Random(1)
    b = bed(3, 3, m)
    b.append(cone("mound", 1.3, 0.6, 0.4, (0, 0, 0.28), m["stone"], verts=10))
    b += shard("spire", 0.32, 2.2, (0, 0, 1.4), m["violet"])
    b.append(cone("core", 0.2, 0, 0.6, (0, 0, 1.0), m["core"], verts=6))
    b += cluster(m, rnd, 9, 1.0, 0.7, 0.14, 0.8, m["violet_deep"])
    b += cluster(m, rnd, 5, 1.1, 0.5, 0.08, 0.4, m["amber"])
    b.append(cylinder("team_ring", 1.0, 0.06, (0, 0, 0.5), m["team"], verts=10))
    return {"body": b}


def bell(style, team=None):
    """Power: a resonating crystal bell hanging in a stone arch."""
    m = mats(style, team)
    b = bed(2, 2, m)
    for y in (-0.55, 0.55):
        b.append(cone("pillar", 0.16, 0.1, 1.1, (0, y, 0.6), m["stone"], verts=6))
    b.append(box("lintel", (0.24, 1.3, 0.12), (0, 0, 1.15), m["stone"]))
    b.append(cone("bell", 0.4, 0.12, 0.6, (0, 0, 0.72), m["violet"], verts=8))
    b.append(cylinder("clapper", 0.08, 0.1, (0, 0, 0.42), m["core_amber"], verts=8))
    b.append(cylinder("team_rim", 0.41, 0.05, (0, 0, 0.45), m["team"], verts=8))
    return {"body": b}


def coda(style, team=None):
    """Refinery: a crystal basin that sings Echo into credits; dock on the front (-y) side."""
    m = mats(style, team)
    rnd = random.Random(2)
    b = bed(3, 3, m)
    b.append(cone("basin", 1.0, 0.7, 0.45, (-0.3, 0.4, 0.3), m["stone"], rot=(math.pi, 0, 0), verts=10))
    b.append(cylinder("pool", 0.75, 0.04, (-0.3, 0.4, 0.5), material("ch_echo", "38d8ee", emission="1aa6c4", style=style), verts=10))
    b += cluster(m, rnd, 6, 0.85, 0.75, 0.1, 0.6, m["violet"])
    b.append(box("dock", (0.9, 0.5, 0.1), (0.3, -1.05, 0.1), m["stone_dark"]))
    b.append(cone("dock_light", 0.08, 0, 0.3, (0.3, -0.8, 0.3), m["core_amber"]))
    b.append(cylinder("team_ring", 1.01, 0.06, (-0.3, 0.4, 0.42), m["team"], verts=10))
    return {"body": b}


def loft(style, team=None):
    """Barracks: a cluster of hollow spires where figures crystallize."""
    m = mats(style, team)
    rnd = random.Random(4)
    b = bed(2, 2, m)
    b += shard("spire", 0.24, 1.3, (-0.1, 0.1, 0.8), m["violet"])
    b += cluster(m, rnd, 5, 0.6, 0.45, 0.1, 0.6, m["violet_deep"])
    b.append(cylinder("gate", 0.3, 0.04, (0.55, 0.1, 0.35), m["core"], rot=(0, math.pi / 2, 0), verts=12))
    b.append(cylinder("team_ring", 0.3, 0.05, (-0.1, 0.1, 0.4), m["team"], verts=8))
    return {"body": b}


def pit(style, team=None):
    """Vehicle factory: a sunken pit spanned by crystal arches."""
    m = mats(style, team)
    rnd = random.Random(6)
    b = bed(3, 3, m)
    b.append(cylinder("pit", 1.1, 0.04, (0, 0, 0.1), m["core"], verts=12))
    for k in range(3):
        a = k * math.pi / 3
        b.append(cylinder("arch", 1.05, 0.12, (0, 0, 0.05), m["violet_deep"], rot=(math.pi / 2, 0, a), verts=16))
    b += cluster(m, rnd, 8, 1.25, 0.35, 0.1, 0.5, m["violet"])
    b.append(cylinder("team_ring", 1.15, 0.05, (0, 0, 0.12), m["team"], verts=12))
    return {"body": b}


def antiphon(style, team=None):
    """Radar: twin spires answering each other with a floating amber node between."""
    m = mats(style, team)
    b = bed(2, 2, m)
    for y in (-0.4, 0.4):
        b += shard("spire", 0.18, 1.8, (0, y, 1.0), m["violet"])
    b += shard("node", 0.12, 0.3, (0, 0, 1.5), m["core_amber"])
    b.append(cylinder("team_ring", 0.2, 0.05, (0, 0.4, 0.4), m["team"], verts=8))
    b.append(cylinder("team_ring2", 0.2, 0.05, (0, -0.4, 0.4), m["team"], verts=8))
    return {"body": b}


def chord(style, team=None):
    """Faction special (1x1): a ring of crystals that regrows Echo around it."""
    m = mats(style, team)
    b = bed(1, 1, m)
    for k in range(6):
        a = k * math.pi / 3
        b += shard("ring_crystal", 0.06, 0.45, (0.3 * math.cos(a), 0.3 * math.sin(a), 0.3), m["violet"] if k % 2 else m["amber"])
    b.append(cylinder("seed", 0.12, 0.16, (0, 0, 0.16), material("ch_echo2", "38d8ee", emission="1aa6c4", style=style), verts=6))
    b.append(cylinder("team_ring", 0.38, 0.04, (0, 0, 0.1), m["team"], verts=12))
    return {"body": b}


def belfry(style, team=None):
    """Airfield: a floating landing disc tethered by crystal arches."""
    m = mats(style, team)
    rnd = random.Random(7)
    b = bed(3, 3, m)
    b.append(cylinder("disc", 0.95, 0.08, (0.3, -0.3, 0.45), m["violet_deep"], verts=12))
    b.append(cylinder("disc_glow", 0.8, 0.02, (0.3, -0.3, 0.5), m["core"], verts=12))
    for k in range(3):
        a = k * 2 * math.pi / 3
        b.append(cone("tether", 0.06, 0.03, 0.45, (0.3 + 0.8 * math.cos(a), -0.3 + 0.8 * math.sin(a), 0.22), m["stone"], verts=6))
    b += cluster(m, rnd, 4, 0.5, 0.5, 0.1, 0.6, m["violet"])
    b.append(cylinder("team_ring", 0.96, 0.03, (0.3, -0.3, 0.4), m["team"], verts=12))
    return {"body": b}


def conservatory(style, team=None):
    """Tech center: a faceted crystal dome over a glowing core."""
    m = mats(style, team)
    rnd = random.Random(8)
    b = bed(3, 3, m)
    b.append(cone("dome", 1.1, 0.4, 0.9, (0, 0, 0.55), m["violet"], verts=8))
    b.append(cone("dome_top", 0.4, 0.0, 0.5, (0, 0, 1.25), m["violet_deep"], verts=8))
    b.append(cylinder("core", 0.25, 0.3, (0, 0, 1.0), m["core"], verts=8))
    b += cluster(m, rnd, 4, 1.25, 0.4, 0.1, 0.5, m["amber"])
    b.append(cylinder("team_ring", 1.05, 0.06, (0, 0, 0.3), m["team"], verts=8))
    return {"body": b}


def discord(style, team=None):
    """Basic defense (1x1): a dissonance spire whose head crystal turns to aim."""
    m = mats(style, team)
    b = [cone("base", 0.4, 0.2, 0.3, (0, 0, 0.15), m["stone"], verts=6)]
    b.append(cylinder("team_ring", 0.3, 0.04, (0, 0, 0.22), m["team"], verts=8))
    turret = shard("head", 0.1, 0.5, (0.08, 0, 0.5), m["violet"], rot=(0, math.radians(70), 0))
    turret.append(cone("eye", 0.06, 0, 0.12, (0.25, 0, 0.52), m["core"], rot=(0, math.pi / 2, 0)))
    return {"body": b, "turret": turret}


def descant(style, team=None):
    """AA defense (2x2): high crystal spikes that sing at aircraft."""
    m = mats(style, team)
    b = bed(2, 2, m)
    b.append(cone("base", 0.7, 0.45, 0.3, (0, 0, 0.23), m["stone"], verts=8))
    b.append(cylinder("team_ring", 0.6, 0.05, (0, 0, 0.32), m["team"], verts=8))
    turret = []
    for k in range(3):
        a = k * 2 * math.pi / 3
        turret += shard("spike", 0.06, 0.8, (0.15 * math.cos(a) + 0.1, 0.15 * math.sin(a), 0.8), m["violet"], rot=(0, math.radians(-25), 0))
    turret.append(cylinder("node", 0.12, 0.1, (0, 0, 0.45), m["core_amber"], verts=8))
    return {"body": b, "turret": turret}


def fortissimo(style, team=None):
    """Heavy defense (2x2): a massive resonating cannon crystal."""
    m = mats(style, team)
    b = bed(2, 2, m)
    b.append(cone("plinth", 0.85, 0.55, 0.45, (0, 0, 0.3), m["stone"], verts=8))
    b.append(cylinder("team_ring", 0.75, 0.06, (0, 0, 0.42), m["team"], verts=8))
    turret = shard("cannon", 0.2, 1.4, (0.45, 0, 0.85), m["violet"], rot=(0, math.radians(80), 0))
    turret.append(cone("core", 0.14, 0, 0.4, (0.1, 0, 0.85), m["core"], rot=(0, math.pi / 2, 0)))
    turret += shard("crest", 0.08, 0.4, (-0.1, 0, 1.1), m["amber"])
    return {"body": b, "turret": turret}


def fermata(style, team=None):
    """Wall: a short wall of fused crystals."""
    m = mats(style, team)
    rnd = random.Random(10)
    b = [box("ridge", (0.9, 0.36, 0.2), (0, 0, 0.1), m["stone"], bevel=0.05)]
    b += cluster(m, rnd, 4, 0.35, 0.35, 0.09, 0.45, m["violet_deep"])
    b.append(box("team_stripe", (0.6, 0.37, 0.04), (0, 0, 0.18), m["team"]))
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

BUILDINGS = {
    "opus": dict(footprint=(3, 3), frame=288, build=opus),
    "bell": dict(footprint=(2, 2), frame=176, build=bell),
    "coda": dict(footprint=(3, 3), frame=256, build=coda),
    "loft": dict(footprint=(2, 2), frame=192, build=loft),
    "pit": dict(footprint=(3, 3), frame=256, build=pit),
    "antiphon": dict(footprint=(2, 2), frame=224, build=antiphon),
    "chord": dict(footprint=(1, 1), frame=112, build=chord),
    "belfry": dict(footprint=(3, 3), frame=256, build=belfry),
    "conservatory": dict(footprint=(3, 3), frame=256, build=conservatory),
    "discord": dict(footprint=(1, 1), frame=96, build=discord),
    "descant": dict(footprint=(2, 2), frame=176, build=descant),
    "fortissimo": dict(footprint=(2, 2), frame=192, build=fortissimo),
    "fermata": dict(footprint=(1, 1), frame=80, build=fermata),
}
