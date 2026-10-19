"""Holdout models: welded plates, olive and rust, diesel stacks, sandbags, searchlights.

1 Blender unit = 1 map tile, units face +X. Every builder returns a dict of
named part lists:
  hull / turret        vehicles (turret rotates independently in game)
  body / turret        buildings (turret only for armed defenses)
  joints               infantry / walker: {name: empty} posed per animation frame
"""
import math

from kit import (
    PALETTES,
    TEAM_NEUTRAL,
    box,
    crates,
    cylinder,
    lattice_tower,
    material,
    root,
    sandbags,
    scaffold,
    strut,
    track,
    wedge,
    wheels,
)
from mathutils import Vector

P = PALETTES["holdout"]
# Team areas render in light grey; the game multiplies them by the team color.
TEAM_GREY = "d8d8d8"


def mats(style, team=None):
    return {
        "olive": material("olive", P["olive"], style=style),
        "olive_dark": material("olive_dark", P["olive_dark"], style=style),
        "khaki": material("khaki", "8b8460", style=style),
        "rust": material("rust", P["rust"], rough=0.9, style=style),
        "steel": material("steel", P["steel"], rough=0.5, metal=0.6, style=style),
        "steel_dark": material("steel_dark", P["steel_dark"], rough=0.6, metal=0.5, style=style),
        "rubber": material("rubber", P["rubber"], rough=1.0, style=style),
        "concrete": material("concrete", P["concrete"], rough=1.0, style=style),
        "concrete_dark": material("concrete_dark", "6a675f", rough=1.0, style=style),
        "sand": material("sand", "a38f66", rough=1.0, style=style),
        "wood": material("wood", "6e5236", rough=1.0, style=style),
        "skin": material("skin", "c49a7a", style=style),
        "canvas": material("canvas", "7d7656", style=style),
        "glass": material("glass", "2c3b44", rough=0.2, metal=0.3, style=style),
        "light": material("light", P["glass"], emission=P["glass"], style=style),
        "fire": material("fire", "ffb347", emission="ff8a1f", style=style),
        "team": material("team", team or TEAM_GREY, style=style),
    }


# --- helpers ---------------------------------------------------------------


def joint(name, loc, parent=None):
    j = root(name)
    j.location = loc
    if parent is not None:
        j.parent = parent
    return j


def attach(objs, to):
    """Parent objects to `to`, keeping their world positions."""
    for o in objs:
        o.parent = to
        o.matrix_parent_inverse = to.matrix_world.inverted()
    return objs


# --- infantry ---------------------------------------------------------------


def soldier(style, team, weapon="rifle"):
    """A small soldier built around joints so animations can pose it."""
    m = mats(style, team)
    pelvis = joint("pelvis", (0, 0, 0.17))
    torso = joint("torso", (0, 0, 0.17), pelvis)
    hip_l = joint("hip_l", (0, 0.035, 0.17), pelvis)
    hip_r = joint("hip_r", (0, -0.035, 0.17), pelvis)
    sh_l = joint("shoulder_l", (0, 0.06, 0.29), torso)
    sh_r = joint("shoulder_r", (0, -0.06, 0.29), torso)
    for j in (torso, hip_l, hip_r, sh_l, sh_r):
        j.matrix_parent_inverse = j.parent.matrix_world.inverted()
    parts = []
    # Legs (boots at the bottom).
    for hip, y in ((hip_l, 0.035), (hip_r, -0.035)):
        parts += attach([box("leg", (0.05, 0.045, 0.15), (0, y, 0.095), m["olive_dark"])], hip)
        parts += attach([box("boot", (0.07, 0.05, 0.03), (0.01, y, 0.02), m["rubber"])], hip)
    # Torso with webbing, team armband, head and helmet.
    parts += attach([box("chest", (0.08, 0.12, 0.13), (0, 0, 0.245), m["olive"], bevel=0.01)], torso)
    parts += attach([box("webbing", (0.085, 0.125, 0.03), (0, 0, 0.21), m["khaki"])], torso)
    parts += attach([box("pack", (0.05, 0.09, 0.09), (-0.065, 0, 0.25), m["canvas"], bevel=0.01)], torso)
    parts += attach([cylinder("head", 0.03, 0.05, (0.005, 0, 0.335), m["skin"], verts=8)], torso)
    parts += attach([cylinder("helmet", 0.045, 0.03, (0.0, 0, 0.37), m["olive_dark"], verts=10)], torso)
    parts += attach([box("team_band", (0.082, 0.124, 0.025), (0, 0, 0.28), m["team"])], torso)
    # Arms reaching forward to the weapon.
    for sh, y in ((sh_l, 0.06), (sh_r, -0.06)):
        parts += attach([box("arm", (0.11, 0.035, 0.035), (0.05, y * 0.8, 0.27), m["olive"])], sh)
    # Weapon in the hands.
    if weapon == "rifle":
        parts += attach([box("rifle", (0.2, 0.02, 0.025), (0.12, -0.02, 0.275), m["steel_dark"])], torso)
        flash_at = (0.24, -0.02, 0.275)
    elif weapon == "launcher":
        parts += attach([cylinder("tube", 0.025, 0.3, (0.04, -0.045, 0.33), m["olive_dark"], rot=(0, math.pi / 2, 0), verts=10)], torso)
        parts += attach([cylinder("warhead", 0.032, 0.06, (0.21, -0.045, 0.33), m["rust"], rot=(0, math.pi / 2, 0), verts=10)], torso)
        flash_at = (-0.13, -0.045, 0.33)  # backblast
    else:  # engineer: toolbox and wrench
        parts += attach([box("toolbox", (0.08, 0.05, 0.05), (0.05, -0.08, 0.17), m["rust"], bevel=0.008)], torso)
        parts += attach([box("wrench", (0.12, 0.015, 0.02), (0.1, 0.05, 0.26), m["steel"])], torso)
        flash_at = None
    flash = None
    if flash_at:
        flash = cylinder("flash", 0.03, 0.06, flash_at, m["fire"], rot=(0, math.pi / 2, 0), verts=6)
        attach([flash], torso)
        flash.hide_render = True
    return {
        "joints": {"pelvis": pelvis, "torso": torso, "hip_l": hip_l, "hip_r": hip_r, "sh_l": sh_l, "sh_r": sh_r},
        "flash": flash,
        "hull": parts + ([flash] if flash else []),
    }


def pose_soldier(model, anim, frame):
    j = model["joints"]
    for k in j.values():
        k.rotation_euler = (0, 0, 0)
    j["pelvis"].location = (0, 0, 0.17)
    if model["flash"]:
        model["flash"].hide_render = True
    if anim == "walk":
        a = math.sin(2 * math.pi * frame / 6)
        j["hip_l"].rotation_euler = (0, math.radians(28 * a), 0)
        j["hip_r"].rotation_euler = (0, math.radians(-28 * a), 0)
        j["sh_l"].rotation_euler = (0, math.radians(-8 * a), 0)
        j["sh_r"].rotation_euler = (0, math.radians(8 * a), 0)
        j["pelvis"].location = (0, 0, 0.17 + 0.008 * abs(a))
    elif anim == "fire":
        j["torso"].rotation_euler = (0, math.radians((-6, 4, 0)[frame]), 0)
        if model["flash"] and frame == 0:
            model["flash"].hide_render = False
    elif anim == "death":
        t = (frame + 1) / 4
        j["pelvis"].rotation_euler = (0, math.radians(-85 * t), 0)
        j["pelvis"].location = (-0.08 * t, 0, 0.17 - 0.12 * t)
        j["hip_l"].rotation_euler = (0, math.radians(20 * t), 0)


def grunt(style, team=None):
    return soldier(style, team, "rifle")


def tankbuster(style, team=None):
    return soldier(style, team, "launcher")


def wrench(style, team=None):
    return soldier(style, team, "tools")


# --- vehicles -----------------------------------------------------------------


def bulldog(style, team=None):
    """Main battle tank: tracked hull, welded turret, long gun."""
    m = mats(style, team)
    hull = []
    for side in (-1, 1):
        hull += track(1.62, side * 0.5, 0.17, 0.34, 0.28, m["rubber"], m["steel_dark"])
        hull.append(box("skirt", (1.5, 0.05, 0.12), (0, side * 0.67, 0.32), m["olive_dark"]))
    hull.append(box("hull", (1.3, 0.92, 0.3), (-0.05, 0, 0.42), m["olive"], bevel=0.03))
    hull.append(wedge("glacis", (0.32, 0.9, 0.3), (0.74, 0, 0.42), m["olive"], rot=(0, math.radians(-90), 0), taper=0.35))
    hull.append(box("deck", (0.38, 0.8, 0.06), (-0.5, 0, 0.6), m["steel_dark"]))
    for i in range(3):
        hull.append(box("grille", (0.05, 0.7, 0.03), (-0.62 + i * 0.12, 0, 0.64), m["rubber"]))
    for side in (-1, 1):
        hull.append(cylinder("exhaust", 0.045, 0.28, (-0.6, side * 0.32, 0.72), m["rust"], verts=8))
        hull.append(box("fender", (0.2, 0.3, 0.03), (0.72, side * 0.5, 0.38), m["olive_dark"]))
    hull += crates(-0.55, -0.32, m["wood"], 2, seed=4)
    hull.append(box("team_stripe", (0.12, 0.93, 0.02), (0.25, 0, 0.575), m["team"]))
    turret = []
    turret.append(box("turret", (0.62, 0.58, 0.26), (0.02, 0, 0.71), m["olive"], bevel=0.04))
    turret.append(wedge("mantlet", (0.18, 0.4, 0.22), (0.38, 0, 0.71), m["olive_dark"], rot=(0, math.radians(-90), 0), taper=0.6))
    turret.append(cylinder("barrel", 0.05, 0.95, (0.85, 0, 0.72), m["steel"], rot=(0, math.pi / 2, 0), verts=12))
    turret.append(cylinder("muzzle", 0.075, 0.12, (1.3, 0, 0.72), m["steel_dark"], rot=(0, math.pi / 2, 0), verts=12))
    turret.append(cylinder("hatch", 0.11, 0.05, (-0.08, 0.1, 0.86), m["steel_dark"], verts=12))
    turret.append(cylinder("light", 0.05, 0.07, (0.2, -0.24, 0.88), m["light"], rot=(0, math.pi / 2, 0), verts=10))
    turret.append(box("mg", (0.25, 0.03, 0.03), (0.0, 0.18, 0.92), m["steel_dark"]))
    for side in (-1, 1):
        turret.append(box("team_band", (0.5, 0.012, 0.09), (0.02, side * 0.296, 0.72), m["team"]))
    return {"hull": hull, "turret": turret}


def jackrabbit(style, team=None):
    """Fast four-wheeled scout car with a ring-mounted machine gun."""
    m = mats(style, team)
    hull = []
    for x in (-0.38, 0.38):
        for side in (-1, 1):
            hull.append(cylinder("tyre", 0.16, 0.12, (x, side * 0.36, 0.16), m["rubber"], rot=(math.pi / 2, 0, 0), verts=14, bevel=0.02))
            hull.append(cylinder("rim", 0.08, 0.125, (x, side * 0.36, 0.16), m["steel_dark"], rot=(math.pi / 2, 0, 0), verts=8))
    hull.append(box("chassis", (1.05, 0.56, 0.2), (0, 0, 0.3), m["olive"], bevel=0.03))
    hull.append(wedge("nose", (0.22, 0.5, 0.2), (0.6, 0, 0.3), m["olive"], rot=(0, math.radians(-90), 0), taper=0.4))
    hull.append(box("cab", (0.36, 0.5, 0.16), (0.05, 0, 0.48), m["olive_dark"], bevel=0.02))
    hull.append(box("windshield", (0.04, 0.42, 0.1), (0.24, 0, 0.5), m["glass"]))
    hull.append(box("bumper", (0.06, 0.62, 0.06), (0.7, 0, 0.26), m["steel_dark"]))
    for side in (-1, 1):
        hull.append(cylinder("light", 0.035, 0.04, (0.7, side * 0.2, 0.36), m["light"], rot=(0, math.pi / 2, 0), verts=8))
    hull.append(box("jerrycans", (0.12, 0.4, 0.14), (-0.5, 0, 0.47), m["rust"], bevel=0.02))
    hull.append(box("team_stripe", (0.5, 0.57, 0.02), (-0.15, 0, 0.41), m["team"]))
    turret = [
        cylinder("ring", 0.14, 0.05, (-0.15, 0, 0.58), m["steel_dark"], verts=12),
        box("gun", (0.36, 0.035, 0.04), (0.05, 0, 0.66), m["steel_dark"]),
        box("shield", (0.04, 0.2, 0.12), (-0.04, 0, 0.66), m["olive_dark"]),
    ]
    return {"hull": hull, "turret": turret}


def mule(style, team=None):
    """Harvester: armored cab, ore hopper, front scoop, six wheels."""
    m = mats(style, team)
    hull = []
    for x in (-0.55, 0.0, 0.55):
        for side in (-1, 1):
            hull.append(cylinder("tyre", 0.2, 0.16, (x, side * 0.46, 0.2), m["rubber"], rot=(math.pi / 2, 0, 0), verts=16, bevel=0.02))
            hull.append(cylinder("rim", 0.1, 0.165, (x, side * 0.46, 0.2), m["steel_dark"], rot=(math.pi / 2, 0, 0), verts=8))
    hull.append(box("chassis", (1.6, 0.72, 0.2), (0, 0, 0.36), m["olive_dark"], bevel=0.02))
    hull.append(box("cab", (0.4, 0.66, 0.36), (0.55, 0, 0.62), m["olive"], bevel=0.03))
    hull.append(box("windows", (0.04, 0.56, 0.12), (0.76, 0, 0.7), m["glass"]))
    hull.append(wedge("scoop", (0.3, 0.86, 0.22), (0.95, 0, 0.26), m["steel"], rot=(0, math.radians(90), 0), taper=0.4))
    # Hopper with an Echo load glinting on top.
    hull.append(box("hopper", (0.95, 0.74, 0.42), (-0.25, 0, 0.68), m["rust"], bevel=0.03))
    hull.append(box("hopper_rim", (1.0, 0.78, 0.04), (-0.25, 0, 0.9), m["steel_dark"]))
    hull.append(box("ore", (0.85, 0.64, 0.05), (-0.25, 0, 0.91), material("echo_load", "2a8f9e", style=style)))
    for side in (-1, 1):
        hull.append(box("ladder", (0.04, 0.02, 0.4), (0.3, side * 0.37, 0.5), m["steel_dark"]))
    hull.append(cylinder("stack", 0.04, 0.4, (0.33, -0.25, 0.95), m["rust"], verts=8))
    hull.append(cylinder("light", 0.05, 0.05, (0.6, 0.22, 0.83), m["light"], verts=8))
    hull.append(box("team_band", (0.97, 0.75, 0.08), (-0.25, 0, 0.6), m["team"]))
    return {"hull": hull}


def flak_track(style, team=None):
    """Half-track with a quad anti-air mount."""
    m = mats(style, team)
    hull = []
    for side in (-1, 1):
        hull += track(0.9, side * 0.38, 0.15, 0.3, 0.2, m["rubber"], m["steel_dark"], n=4)
        hull[-1].location.x -= 0.25
        hull.append(cylinder("front_wheel", 0.15, 0.12, (0.48, side * 0.4, 0.15), m["rubber"], rot=(math.pi / 2, 0, 0), verts=12))
    hull.append(box("body", (1.3, 0.66, 0.26), (0, 0, 0.38), m["olive"], bevel=0.03))
    hull.append(box("cab", (0.32, 0.6, 0.2), (0.38, 0, 0.6), m["olive_dark"], bevel=0.02))
    hull.append(box("windshield", (0.03, 0.5, 0.1), (0.55, 0, 0.62), m["glass"]))
    hull.append(box("team_stripe", (0.6, 0.67, 0.02), (-0.25, 0, 0.515), m["team"]))
    turret = [cylinder("mount", 0.2, 0.08, (-0.25, 0, 0.56), m["steel_dark"], verts=14)]
    turret.append(box("cradle", (0.3, 0.42, 0.12), (-0.25, 0, 0.66), m["olive_dark"], bevel=0.02))
    for dy in (-0.15, -0.07, 0.07, 0.15):
        turret.append(cylinder("aa_barrel", 0.022, 0.55, (0.02, dy, 0.76), m["steel"], rot=(0, math.radians(65), 0), verts=8))
    turret.append(box("seat", (0.1, 0.12, 0.08), (-0.4, 0, 0.72), m["rubber"]))
    return {"hull": hull, "turret": turret}


def thumper(style, team=None):
    """Self-propelled howitzer: open casemate, huge barrel."""
    m = mats(style, team)
    hull = []
    for side in (-1, 1):
        hull += track(1.5, side * 0.46, 0.16, 0.32, 0.24, m["rubber"], m["steel_dark"])
    hull.append(box("hull", (1.4, 0.8, 0.24), (0, 0, 0.42), m["olive"], bevel=0.03))
    hull.append(box("spade", (0.08, 0.7, 0.2), (-0.78, 0, 0.32), m["steel_dark"]))
    hull += crates(0.45, 0.25, m["wood"], 2, seed=9)
    hull.append(box("shells", (0.2, 0.3, 0.1), (0.45, -0.2, 0.6), m["rust"]))
    turret = [box("casemate", (0.7, 0.66, 0.26), (-0.1, 0, 0.68), m["olive"], bevel=0.03)]
    turret.append(box("shield", (0.06, 0.6, 0.24), (0.22, 0, 0.74), m["olive_dark"]))
    turret.append(cylinder("barrel", 0.07, 1.35, (0.65, 0, 0.88), m["steel"], rot=(0, math.radians(75), 0), verts=12))
    turret.append(cylinder("brake", 0.1, 0.14, (1.28, 0, 1.05), m["steel_dark"], rot=(0, math.radians(75), 0), verts=12))
    turret.append(box("team_band", (0.6, 0.67, 0.07), (-0.1, 0, 0.66), m["team"]))
    return {"hull": hull, "turret": turret}


def patch(style, team=None):
    """Repair truck: flatbed with a crane arm and welding rig."""
    m = mats(style, team)
    hull = []
    for x in (-0.4, 0.4):
        for side in (-1, 1):
            hull.append(cylinder("tyre", 0.17, 0.13, (x, side * 0.4, 0.17), m["rubber"], rot=(math.pi / 2, 0, 0), verts=14))
    hull.append(box("chassis", (1.25, 0.62, 0.18), (0, 0, 0.32), m["olive_dark"]))
    hull.append(box("cab", (0.36, 0.6, 0.3), (0.42, 0, 0.55), m["olive"], bevel=0.03))
    hull.append(box("windshield", (0.03, 0.5, 0.12), (0.61, 0, 0.6), m["glass"]))
    hull.append(box("bed", (0.75, 0.62, 0.06), (-0.22, 0, 0.44), m["steel_dark"]))
    hull.append(cylinder("crane_base", 0.1, 0.12, (-0.3, 0, 0.53), m["rust"], verts=10))
    hull.append(strut(Vector((-0.3, 0, 0.58)), Vector((0.2, 0.0, 1.05)), 0.035, m["rust"]))
    hull.append(box("hook", (0.04, 0.04, 0.14), (0.22, 0, 0.95), m["steel_dark"]))
    hull.append(cylinder("tank_o2", 0.06, 0.32, (-0.48, 0.18, 0.62), m["team"], verts=10))
    hull.append(cylinder("tank_ac", 0.06, 0.32, (-0.48, 0.0, 0.62), m["rust"], verts=10))
    hull.append(cylinder("beacon", 0.04, 0.05, (0.42, 0.0, 0.73), m["light"], verts=8))
    hull.append(box("team_stripe", (0.37, 0.61, 0.05), (0.42, 0, 0.45), m["team"]))
    return {"hull": hull}


def hornet(style, team=None):
    """Gunship helicopter: twin rotors (animated), side guns."""
    m = mats(style, team)
    hull = []
    hull.append(box("fuselage", (0.9, 0.36, 0.3), (0, 0, 0.9), m["olive"], bevel=0.06))
    hull.append(wedge("nose", (0.32, 0.32, 0.26), (0.58, 0, 0.88), m["olive"], rot=(0, math.radians(-90), 0), taper=0.4))
    hull.append(box("canopy", (0.22, 0.3, 0.12), (0.38, 0, 1.06), m["glass"], bevel=0.03))
    hull.append(box("tail", (0.8, 0.08, 0.08), (-0.82, 0, 0.98), m["olive_dark"]))
    hull.append(box("fin", (0.12, 0.03, 0.24), (-1.18, 0, 1.08), m["olive_dark"]))
    for side in (-1, 1):
        hull.append(box("stub", (0.2, 0.3, 0.04), (0.05, side * 0.3, 0.84), m["olive_dark"]))
        hull.append(cylinder("gun", 0.025, 0.36, (0.2, side * 0.44, 0.8), m["steel_dark"], rot=(0, math.pi / 2, 0), verts=8))
        hull.append(cylinder("pod", 0.05, 0.26, (0.1, side * 0.36, 0.78), m["steel"], rot=(0, math.pi / 2, 0), verts=10))
        hull.append(box("skid", (0.7, 0.03, 0.03), (0.05, side * 0.18, 0.66), m["steel_dark"]))
    hull.append(box("team_band", (0.3, 0.37, 0.08), (-0.2, 0, 0.92), m["team"]))
    hull.append(cylinder("mast", 0.04, 0.12, (0, 0, 1.12), m["steel_dark"], verts=8))
    rotor = []
    for k in range(4):
        a = k * math.pi / 2
        rotor.append(box("blade", (0.9, 0.06, 0.012), (0.45 * math.cos(a), 0.45 * math.sin(a), 1.19), m["rubber"], rot=(0, 0, a)))
    rotor_root = joint("rotor", (0, 0, 0))
    attach(rotor, rotor_root)
    tail_rotor = [box("tail_rotor", (0.03, 0.3, 0.03), (-1.2, 0.05, 1.12), m["rubber"])]
    return {"hull": hull + rotor + tail_rotor, "joints": {"rotor": rotor_root}}


def pose_hornet(model, anim, frame):
    model["joints"]["rotor"].rotation_euler = (0, 0, math.radians(frame * 22.5))


def ironclad(style, team=None):
    """Crewed four-legged walker with a heavy cannon."""
    m = mats(style, team)
    body = joint("body", (0, 0, 0.0))
    parts = []
    parts += attach([box("hull", (1.0, 0.8, 0.45), (0, 0, 1.05), m["olive"], bevel=0.05)], body)
    parts += attach([wedge("front", (0.3, 0.75, 0.4), (0.62, 0, 1.05), m["olive"], rot=(0, math.radians(-90), 0), taper=0.5)], body)
    parts += attach([box("cupola", (0.34, 0.34, 0.18), (-0.05, 0, 1.36), m["olive_dark"], bevel=0.03)], body)
    parts += attach([cylinder("cannon", 0.07, 1.1, (0.85, 0.22, 1.12), m["steel"], rot=(0, math.pi / 2, 0), verts=12)], body)
    parts += attach([cylinder("cannon_b", 0.07, 1.1, (0.85, -0.22, 1.12), m["steel"], rot=(0, math.pi / 2, 0), verts=12)], body)
    parts += attach([box("vision", (0.04, 0.5, 0.06), (0.76, 0, 1.2), m["light"])], body)
    for side in (-1, 1):
        parts += attach([cylinder("stack", 0.05, 0.4, (-0.45, side * 0.25, 1.45), m["rust"], verts=8)], body)
    parts += attach([box("team_band", (0.9, 0.81, 0.1), (-0.05, 0, 1.0), m["team"])], body)
    legs = {}
    for i, (lx, ly) in enumerate(((0.35, 0.45), (0.35, -0.45), (-0.35, 0.45), (-0.35, -0.45))):
        hip = joint(f"leg{i}", (lx, ly, 0.95), body)
        hip.matrix_parent_inverse = body.matrix_world.inverted()
        parts += attach([box("thigh", (0.14, 0.12, 0.5), (lx, ly * 1.15, 0.7), m["olive_dark"], bevel=0.02)], hip)
        parts += attach([box("shin", (0.12, 0.1, 0.45), (lx + 0.04, ly * 1.2, 0.28), m["steel_dark"])], hip)
        parts += attach([box("foot", (0.26, 0.2, 0.06), (lx + 0.06, ly * 1.2, 0.03), m["rubber"])], hip)
        legs[f"leg{i}"] = hip
    return {"hull": parts, "joints": {"body": body, **legs}}


def pose_ironclad(model, anim, frame):
    j = model["joints"]
    a = math.sin(2 * math.pi * frame / 4) if anim == "walk" else 0
    j["body"].location = (0, 0, 0.02 * abs(a))
    for i in range(4):
        sign = 1 if i in (0, 3) else -1
        j[f"leg{i}"].rotation_euler = (0, math.radians(14 * a * sign), 0)


def homestead(style, team=None):
    """Mobile construction vehicle: big truck carrying a folded workshop and crane."""
    m = mats(style, team)
    hull = []
    for x in (-0.65, -0.15, 0.35, 0.75):
        for side in (-1, 1):
            hull.append(cylinder("tyre", 0.21, 0.18, (x, side * 0.5, 0.21), m["rubber"], rot=(math.pi / 2, 0, 0), verts=16, bevel=0.02))
    hull.append(box("chassis", (1.9, 0.86, 0.22), (0, 0, 0.4), m["olive_dark"], bevel=0.02))
    hull.append(box("cab", (0.42, 0.8, 0.42), (0.78, 0, 0.72), m["olive"], bevel=0.04))
    hull.append(box("windows", (0.04, 0.7, 0.14), (1.0, 0, 0.8), m["glass"]))
    hull.append(box("module", (1.2, 0.82, 0.5), (-0.25, 0, 0.76), m["khaki"], bevel=0.04))
    hull.append(box("module_roof", (1.24, 0.86, 0.05), (-0.25, 0, 1.03), m["steel_dark"]))
    hull.append(strut(Vector((-0.8, 0.25, 1.05)), Vector((0.55, 0.25, 1.15)), 0.04, m["rust"]))
    hull.append(box("outrigger", (0.12, 1.0, 0.06), (-0.8, 0, 0.36), m["steel_dark"]))
    hull.append(cylinder("dish", 0.12, 0.03, (0.2, -0.25, 1.1), m["steel"], verts=14))
    hull.append(cylinder("beacon", 0.05, 0.06, (0.78, 0.25, 0.97), m["light"], verts=8))
    hull.append(box("team_band", (1.22, 0.84, 0.1), (-0.25, 0, 0.62), m["team"]))
    return {"hull": hull}


# --- buildings ----------------------------------------------------------------


def pad(w, d, m, h=0.1):
    return [box("pad", (w - 0.04, d - 0.04, h), (0, 0, h / 2), m["concrete"], bevel=0.02)]


def holdfast(style, team=None):
    """Construction yard: workshop hall, gantry crane, stacked materials."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(box("hall", (1.6, 1.3, 0.75), (-0.5, 0.5, 0.48), m["olive"], bevel=0.03))
    b.append(wedge("roof", (1.6, 1.36, 0.25), (-0.5, 0.5, 0.98), m["rust"], taper=0.3))
    b.append(box("door", (0.04, 0.8, 0.55), (0.31, 0.5, 0.38), m["steel_dark"]))
    for x in (-1.3, 1.25):
        b.append(box("gantry_leg", (0.08, 0.08, 1.3), (x, -0.9, 0.75), m["rust"]))
    b.append(box("gantry_beam", (2.65, 0.1, 0.1), (0, -0.9, 1.42), m["rust"]))
    b.append(box("trolley", (0.2, 0.16, 0.12), (0.5, -0.9, 1.32), m["steel_dark"]))
    b.append(box("cable", (0.015, 0.015, 0.6), (0.5, -0.9, 1.0), m["rubber"]))
    b.append(box("load", (0.4, 0.3, 0.25), (0.5, -0.9, 0.6), m["olive_dark"], bevel=0.02))
    b += crates(1.0, 0.6, m["wood"], 4, seed=2)
    b.append(box("pipes", (0.9, 0.12, 0.12), (0.7, 1.0, 0.18), m["steel"]))
    b.append(box("team_sign", (0.04, 0.9, 0.2), (0.31, 0.5, 0.82), m["team"]))
    b.append(cylinder("light", 0.06, 0.08, (-1.25, -0.9, 1.5), m["light"], verts=8))
    return {"body": b}


def dynamo(style, team=None):
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(box("block", (1.2, 0.9, 0.62), (-0.15, 0.1, 0.43), m["olive"], bevel=0.03))
    b.append(box("roof", (1.3, 1.0, 0.06), (-0.15, 0.1, 0.77), m["olive_dark"]))
    b.append(box("radiator", (0.36, 0.8, 0.52), (0.62, 0.1, 0.38), m["steel_dark"]))
    for i in range(6):
        b.append(box("fin", (0.04, 0.82, 0.48), (0.81, -0.22 + i * 0.13, 0.38), m["steel"]))
    for i, y in enumerate((-0.15, 0.25)):
        b.append(cylinder("stack", 0.09, 1.0 + i * 0.15, (-0.55, y, 0.9 + i * 0.07), m["rust"], verts=10))
        b.append(cylinder("cap", 0.12, 0.05, (-0.55, y, 1.42 + i * 0.15), m["steel_dark"], verts=10))
    b.append(cylinder("flywheel", 0.26, 0.1, (-0.2, -0.43, 0.42), m["steel"], rot=(math.pi / 2, 0, 0), verts=20))
    b.append(cylinder("tank", 0.22, 0.7, (0.25, -0.62, 0.34), m["rust"], rot=(0, math.pi / 2, 0), verts=14))
    b.append(box("team_panel", (0.5, 0.012, 0.22), (-0.2, -0.355, 0.55), m["team"]))
    b.append(box("team_roof", (0.9, 0.5, 0.012), (-0.15, 0.1, 0.81), m["team"]))
    b.append(cylinder("beacon", 0.06, 0.08, (0.2, 0.4, 0.84), m["light"], verts=10))
    return {"body": b}


def smelter(style, team=None):
    """Refinery: furnace with a tall stack, ore silo, conveyor, unloading dock (front, -x... +y side)."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(box("furnace", (1.2, 1.1, 0.9), (-0.6, 0.4, 0.55), m["olive"], bevel=0.04))
    b.append(cylinder("stack", 0.16, 1.9, (-0.9, 0.7, 1.05), m["rust"], verts=12))
    b.append(cylinder("glow", 0.1, 0.05, (-0.9, 0.7, 2.0), m["fire"], verts=10))
    b.append(cylinder("silo", 0.38, 1.1, (0.75, 0.75, 0.65), m["steel"], verts=16))
    b.append(cylinder("silo_cap", 0.4, 0.08, (0.75, 0.75, 1.24), m["steel_dark"], verts=16))
    b.append(strut(Vector((0.6, -0.9, 0.2)), Vector((0.6, 0.45, 1.0)), 0.06, m["steel_dark"]))
    b.append(box("dock", (0.9, 0.5, 0.18), (0.3, -1.1, 0.15), m["concrete_dark"]))
    b.append(box("dock_hopper", (0.7, 0.4, 0.3), (0.3, -0.75, 0.35), m["rust"], bevel=0.02))
    b.append(box("echo_bin", (0.6, 0.5, 0.12), (-0.6, -0.4, 0.3), material("echo_load", "2a8f9e", style=style)))
    b.append(box("team_band", (1.22, 1.12, 0.12), (-0.6, 0.4, 0.75), m["team"]))
    b.append(cylinder("light", 0.05, 0.06, (0.3, -1.3, 0.3), m["light"], verts=8))
    return {"body": b}


def bunkhouse(style, team=None):
    """Barracks: corrugated hut behind sandbags, flag."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(box("hut", (1.2, 1.1, 0.5), (0.0, 0.15, 0.35), m["khaki"], bevel=0.02))
    b.append(cylinder("roof", 0.58, 1.24, (0.0, 0.15, 0.6), m["olive_dark"], rot=(0, math.pi / 2, 0), verts=14))
    b.append(box("door", (0.04, 0.32, 0.36), (0.62, 0.15, 0.28), m["wood"]))
    b += sandbags(-0.9, -0.7, 0.9, -0.7, 0.1, m["sand"])
    b += sandbags(0.85, -0.65, 0.85, -0.2, 0.1, m["sand"])
    b.append(cylinder("flagpole", 0.02, 1.1, (-0.75, 0.75, 0.6), m["steel_dark"], verts=6))
    b.append(box("flag", (0.04, 0.32, 0.2), (-0.75, 0.6, 1.02), m["team"]))
    b.append(box("team_door", (0.03, 0.4, 0.06), (0.63, 0.15, 0.5), m["team"]))
    b += crates(-0.6, -0.3, m["wood"], 2, seed=5)
    return {"body": b}


def motor_pool(style, team=None):
    """Vehicle factory: big hangar with roller doors, crane rail, fuel tank."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(box("hangar", (2.2, 1.9, 0.95), (-0.2, 0.2, 0.58), m["olive"], bevel=0.03))
    b.append(cylinder("roof", 0.98, 2.24, (-0.2, 0.2, 1.0), m["rust"], rot=(0, math.pi / 2, 0), verts=20))
    b.append(box("door", (0.04, 1.2, 0.8), (0.91, 0.2, 0.5), m["steel_dark"]))
    for i in range(6):
        b.append(box("door_rib", (0.045, 1.22, 0.02), (0.915, 0.2, 0.15 + i * 0.13), m["steel"]))
    b.append(box("apron", (0.6, 1.4, 0.04), (1.2, 0.2, 0.12), m["concrete_dark"]))
    b.append(cylinder("fuel", 0.28, 0.9, (0.6, -1.15, 0.38), m["rust"], rot=(0, math.pi / 2, 0), verts=14))
    b.append(box("team_band", (2.22, 1.92, 0.12), (-0.2, 0.2, 0.75), m["team"]))
    b.append(cylinder("light", 0.05, 0.06, (0.93, 0.95, 1.0), m["light"], verts=8))
    return {"body": b}


def radio_mast(style, team=None):
    """Radar: lattice tower with a dish and a radio shack."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b += lattice_tower(0.2, 0.2, 2.2, 0.8, m["rust"])
    b.append(cylinder("dish", 0.32, 0.06, (0.2, 0.2, 2.25), m["steel"], rot=(math.radians(60), 0, math.radians(30)), verts=20))
    b.append(cylinder("light", 0.05, 0.08, (0.2, 0.2, 2.45), material("red_light", "ff4040", emission="ff2020", style=style), verts=8))
    b.append(box("shack", (0.6, 0.5, 0.38), (-0.45, -0.45, 0.28), m["khaki"], bevel=0.02))
    b.append(box("shack_roof", (0.66, 0.56, 0.04), (-0.45, -0.45, 0.49), m["olive_dark"]))
    b.append(box("team_sign", (0.62, 0.012, 0.12), (-0.45, -0.705, 0.32), m["team"]))
    b.append(box("generator", (0.3, 0.25, 0.2), (0.6, -0.6, 0.2), m["olive"]))
    return {"body": b}


def garage(style, team=None):
    """Repair bay: open service frame with a ramp and tool racks (3x2)."""
    m = mats(style, team)
    b = pad(3, 2, m)
    for x in (-1.2, 1.2):
        for y in (-0.7, 0.7):
            b.append(box("post", (0.1, 0.1, 1.0), (x, y, 0.55), m["rust"]))
    b.append(box("roof", (2.6, 1.6, 0.06), (0, 0, 1.08), m["olive_dark"]))
    b.append(wedge("ramp", (1.4, 0.8, 0.18), (0.1, 0, 0.17), m["steel_dark"], taper=0.7))
    b.append(box("crane", (0.08, 1.4, 0.08), (0.1, 0, 0.95), m["steel"]))
    b.append(box("hoist", (0.12, 0.12, 0.2), (0.1, 0.2, 0.82), m["rust"]))
    b += crates(-1.0, 0.45, m["wood"], 3, seed=7)
    b.append(box("rack", (0.6, 0.1, 0.5), (0.8, 0.62, 0.35), m["olive"]))
    b.append(box("team_roof", (1.2, 0.8, 0.012), (0, 0, 1.115), m["team"]))
    return {"body": b}


def airstrip(style, team=None):
    """Airfield: helipad with markings and a small hangar."""
    m = mats(style, team)
    b = pad(3, 3, m, h=0.06)
    b.append(cylinder("helipad", 0.95, 0.04, (0.35, -0.35, 0.09), m["concrete_dark"], verts=24))
    b.append(box("h_mark_a", (0.1, 0.6, 0.012), (0.15, -0.35, 0.115), m["team"]))
    b.append(box("h_mark_b", (0.1, 0.6, 0.012), (0.55, -0.35, 0.115), m["team"]))
    b.append(box("h_mark_c", (0.4, 0.1, 0.012), (0.35, -0.35, 0.115), m["team"]))
    b.append(box("hangar", (1.0, 1.2, 0.6), (-0.9, 0.8, 0.36), m["olive"], bevel=0.03))
    b.append(cylinder("hangar_roof", 0.62, 1.04, (-0.9, 0.8, 0.66), m["rust"], rot=(0, math.pi / 2, 0), verts=14))
    b.append(box("windsock_pole", (0.03, 0.03, 0.7), (1.2, 1.2, 0.4), m["steel_dark"]))
    b.append(box("windsock", (0.25, 0.08, 0.08), (1.32, 1.2, 0.72), material("orange", "e07a2a", style=style)))
    for i in range(4):
        b.append(cylinder("pad_light", 0.03, 0.03, (0.35 + 1.0 * math.cos(i * math.pi / 2), -0.35 + 1.0 * math.sin(i * math.pi / 2), 0.1), m["light"], verts=6))
    return {"body": b}


def foundry(style, team=None):
    """Tech center: heavy industrial hall with two smokestacks and a lab annex."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(box("hall", (1.8, 1.6, 1.0), (-0.3, 0.3, 0.6), m["olive_dark"], bevel=0.04))
    b.append(wedge("roof", (1.8, 1.65, 0.3), (-0.3, 0.3, 1.25), m["rust"], taper=0.25))
    for x in (-0.9, -0.4):
        b.append(cylinder("stack", 0.14, 1.8, (x, 1.0, 1.3), m["rust"], verts=12))
        b.append(cylinder("ring", 0.17, 0.06, (x, 1.0, 1.9), m["steel_dark"], verts=12))
    b.append(box("annex", (0.8, 0.7, 0.55), (0.85, -0.7, 0.38), m["khaki"], bevel=0.03))
    b.append(box("annex_windows", (0.04, 0.5, 0.12), (1.26, -0.7, 0.48), m["light"]))
    b.append(cylinder("tank", 0.25, 0.7, (0.9, 0.7, 0.45), m["steel"], verts=14))
    b.append(box("team_band", (1.82, 1.62, 0.12), (-0.3, 0.3, 0.8), m["team"]))
    return {"body": b}


def pillbox(style, team=None):
    """Concrete MG bunker (1x1)."""
    m = mats(style, team)
    b = [cylinder("bunker", 0.42, 0.34, (0, 0, 0.17), m["concrete"], verts=8, bevel=0.03)]
    b.append(cylinder("roof", 0.46, 0.08, (0, 0, 0.38), m["concrete_dark"], verts=8))
    b.append(box("slit", (0.06, 0.4, 0.05), (0.4, 0, 0.26), m["rubber"]))
    b.append(box("mg", (0.25, 0.03, 0.03), (0.5, 0, 0.26), m["steel_dark"]))
    b += sandbags(-0.35, -0.42, 0.35, -0.42, 0.0, m["sand"], h=0.08, thick=0.1)
    b.append(box("team_band", (0.3, 0.012, 0.06), (0, -0.42, 0.25), m["team"]))
    return {"body": b}


def flak_nest(style, team=None):
    """AA emplacement: sandbag ring with a rotating twin flak gun."""
    m = mats(style, team)
    b = pad(2, 2, m, h=0.06)
    for k in range(8):
        a0 = k * math.pi / 4
        a1 = (k + 1) * math.pi / 4
        if k == 2:
            continue  # entrance gap
        b += sandbags(0.75 * math.cos(a0), 0.75 * math.sin(a0), 0.75 * math.cos(a1), 0.75 * math.sin(a1), 0.06, m["sand"], h=0.1)
    b.append(box("ammo", (0.25, 0.18, 0.14), (-0.5, -0.1, 0.14), m["olive_dark"]))
    turret = [cylinder("base", 0.22, 0.12, (0, 0, 0.14), m["steel_dark"], verts=14)]
    turret.append(box("cradle", (0.3, 0.36, 0.16), (0, 0, 0.3), m["olive"], bevel=0.02))
    for dy in (-0.09, 0.09):
        turret.append(cylinder("barrel", 0.03, 0.7, (0.25, dy, 0.55), m["steel"], rot=(0, math.radians(55), 0), verts=8))
    turret.append(box("team_band", (0.31, 0.37, 0.04), (0, 0, 0.36), m["team"]))
    return {"body": b, "turret": turret}


def bastion(style, team=None):
    """Heavy anti-armor fortification: concrete casemate with a long-barrel gun turret."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(box("casemate", (1.6, 1.6, 0.5), (0, 0, 0.35), m["concrete"], bevel=0.06))
    b.append(box("ledge", (1.7, 1.7, 0.06), (0, 0, 0.62), m["concrete_dark"]))
    b.append(box("team_band", (1.62, 1.62, 0.08), (0, 0, 0.45), m["team"]))
    turret = [cylinder("ring", 0.45, 0.1, (0, 0, 0.7), m["steel_dark"], verts=16)]
    turret.append(box("turret", (0.7, 0.62, 0.3), (0, 0, 0.9), m["olive"], bevel=0.05))
    turret.append(cylinder("barrel", 0.07, 1.3, (0.95, 0, 0.92), m["steel"], rot=(0, math.pi / 2, 0), verts=12))
    turret.append(cylinder("brake", 0.1, 0.14, (1.6, 0, 0.92), m["steel_dark"], rot=(0, math.pi / 2, 0), verts=12))
    turret.append(cylinder("light", 0.05, 0.06, (0.2, -0.25, 1.08), m["light"], verts=8))
    return {"body": b, "turret": turret}


def barricade(style, team=None):
    """Wall segment: concrete jersey blocks with barbed wire."""
    m = mats(style, team)
    b = [wedge("block", (0.9, 0.36, 0.4), (0, 0, 0.2), m["concrete"], taper=0.5)]
    b.append(box("wire", (0.9, 0.02, 0.02), (0, 0, 0.44), m["steel_dark"]))
    for i in range(4):
        b.append(cylinder("coil", 0.06, 0.02, (-0.33 + i * 0.22, 0, 0.46), m["steel"], rot=(0, math.pi / 2, 0), verts=8))
    b.append(box("team_stripe", (0.6, 0.37, 0.04), (0, 0, 0.12), m["team"]))
    return {"body": b}


# --- catalog ------------------------------------------------------------------

# kind, frame size (1x px), directions, animations {name: frames}, builder, poser
UNITS = {
    "grunt": dict(kind="infantry", frame=64, dirs=8, anims={"idle": 1, "walk": 6, "fire": 3, "death": 4}, build=grunt, pose=pose_soldier),
    "tankbuster": dict(kind="infantry", frame=64, dirs=8, anims={"idle": 1, "walk": 6, "fire": 3, "death": 4}, build=tankbuster, pose=pose_soldier),
    "wrench": dict(kind="infantry", frame=64, dirs=8, anims={"idle": 1, "walk": 6, "fire": 3, "death": 4}, build=wrench, pose=pose_soldier),
    "jackrabbit": dict(kind="vehicle", frame=96, dirs=16, build=jackrabbit),
    "mule": dict(kind="vehicle", frame=128, dirs=16, build=mule),
    "bulldog": dict(kind="vehicle", frame=128, dirs=16, anims={"idle": 1, "walk": 4}, build=bulldog),
    "flak_track": dict(kind="vehicle", frame=112, dirs=16, anims={"idle": 1, "walk": 4}, build=flak_track),
    "thumper": dict(kind="vehicle", frame=128, dirs=16, anims={"idle": 1, "walk": 4}, build=thumper),
    "patch": dict(kind="vehicle", frame=112, dirs=16, build=patch),
    "hornet": dict(kind="air", frame=128, dirs=16, anims={"fly": 4}, build=hornet, pose=pose_hornet),
    "ironclad": dict(kind="vehicle", frame=160, dirs=16, anims={"idle": 1}, build=ironclad, pose=pose_ironclad),
    "homestead": dict(kind="vehicle", frame=144, dirs=16, build=homestead),
}

# footprint (w, d) in tiles; frame size covers the footprint diamond plus height.
BUILDINGS = {
    "holdfast": dict(footprint=(3, 3), frame=256, build=holdfast),
    "dynamo": dict(footprint=(2, 2), frame=176, build=dynamo),
    "smelter": dict(footprint=(3, 3), frame=256, build=smelter),
    "bunkhouse": dict(footprint=(2, 2), frame=160, build=bunkhouse),
    "motor_pool": dict(footprint=(3, 3), frame=256, build=motor_pool),
    "radio_mast": dict(footprint=(2, 2), frame=224, build=radio_mast),
    "garage": dict(footprint=(3, 2), frame=224, build=garage),
    "airstrip": dict(footprint=(3, 3), frame=256, build=airstrip),
    "foundry": dict(footprint=(3, 3), frame=256, build=foundry),
    "pillbox": dict(footprint=(1, 1), frame=96, build=pillbox),
    "flak_nest": dict(footprint=(2, 2), frame=160, build=flak_nest),
    "bastion": dict(footprint=(2, 2), frame=176, build=bastion),
    "barricade": dict(footprint=(1, 1), frame=80, build=barricade),
    # Superweapon; the Meshy model stands in (the procedural fallback reuses the Foundry).
    "long_tom": dict(footprint=(3, 3), frame=288, build=foundry),
}
