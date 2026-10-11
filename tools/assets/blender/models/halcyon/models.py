"""Halcyon models: white and graphite shells, cyan light lines, hexagonal panels, hover drives.

Same conventions as the Holdout models: 1 Blender unit = 1 tile, units face +X,
builders return named part lists (hull / turret / body / joints).
"""
import math

from kit import box, cone, cylinder, hexprism, material, root, strut, wedge
from mathutils import Vector

TEAM_GREY = "d8d8d8"


def mats(style, team=None):
    return {
        "shell": material("hc_shell", "e4e8ea", rough=0.35, style=style),
        "shell_dim": material("hc_shell_dim", "b9c0c4", rough=0.4, style=style),
        "graphite": material("hc_graphite", "2b2f36", rough=0.5, metal=0.3, style=style),
        "graphite_dark": material("hc_graphite_dark", "1a1d22", rough=0.6, metal=0.3, style=style),
        "metal": material("hc_metal", "7d868d", rough=0.3, metal=0.8, style=style),
        "glass": material("hc_glass", "16303a", rough=0.1, metal=0.4, style=style),
        "cyan": material("hc_cyan", "3ee6ff", emission="1fc8ec", style=style),
        "cyan_dim": material("hc_cyan_dim", "2a9fb5", emission="137a8f", style=style),
        "fire": material("hc_fire", "bff6ff", emission="6fe9ff", style=style),
        "pad": material("hc_pad", "9aa3a8", rough=0.8, style=style),
        "team": material("team", team or TEAM_GREY, style=style),
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


def glow_line(length, loc, m, *, axis="x", w=0.015):
    size = (length, w, w) if axis == "x" else (w, length, w)
    return box("glow_line", size, loc, m["cyan"])


# --- infantry: printed bipedal bots -----------------------------------------


def bot(style, team, kit="rifle"):
    m = mats(style, team)
    pelvis = joint("pelvis", (0, 0, 0.18))
    torso = joint("torso", (0, 0, 0.18), pelvis)
    hip_l = joint("hip_l", (0, 0.04, 0.18), pelvis)
    hip_r = joint("hip_r", (0, -0.04, 0.18), pelvis)
    sh_l = joint("shoulder_l", (0, 0.07, 0.3), torso)
    sh_r = joint("shoulder_r", (0, -0.07, 0.3), torso)
    for j in (torso, hip_l, hip_r, sh_l, sh_r):
        j.matrix_parent_inverse = j.parent.matrix_world.inverted()
    parts = []
    for hip, y in ((hip_l, 0.04), (hip_r, -0.04)):
        # Digitigrade legs: thigh forward, shin back, flat foot.
        parts += attach([box("thigh", (0.04, 0.035, 0.1), (0.015, y, 0.13), m["graphite"])], hip)
        parts += attach([box("shin", (0.035, 0.03, 0.1), (-0.01, y, 0.06), m["shell"])], hip)
        parts += attach([box("foot", (0.08, 0.04, 0.02), (0.015, y, 0.01), m["graphite_dark"])], hip)
    parts += attach([hexprism("core", 0.07, 0.14, (0, 0, 0.26), m["shell"], bevel=0.008)], torso)
    parts += attach([box("spine", (0.03, 0.05, 0.14), (-0.06, 0, 0.26), m["graphite"])], torso)
    parts += attach([box("head", (0.07, 0.06, 0.045), (0.015, 0, 0.36), m["shell_dim"], bevel=0.008)], torso)
    parts += attach([box("visor", (0.012, 0.05, 0.015), (0.052, 0, 0.365), m["cyan"])], torso)
    parts += attach([box("team_plate", (0.072, 0.142, 0.03), (0, 0, 0.3), m["team"])], torso)
    parts += attach([box("core_light", (0.073, 0.02, 0.06), (0.0, 0, 0.24), m["cyan_dim"])], torso)
    for sh, y in ((sh_l, 0.07), (sh_r, -0.07)):
        parts += attach([box("arm", (0.1, 0.03, 0.03), (0.04, y * 0.85, 0.28), m["graphite"])], sh)
    flash_at = None
    if kit == "rifle":
        parts += attach([box("emitter", (0.18, 0.03, 0.035), (0.11, -0.03, 0.28), m["shell_dim"])], torso)
        parts += attach([box("emitter_line", (0.16, 0.032, 0.008), (0.11, -0.03, 0.3), m["cyan"])], torso)
        flash_at = (0.21, -0.03, 0.28)
    elif kit == "launcher":
        parts += attach([hexprism("pod", 0.045, 0.22, (0.02, -0.08, 0.38), m["shell"], rot=(0, math.pi / 2, 0))], torso)
        for dz in (-0.015, 0.015):
            parts += attach([cylinder("tube", 0.012, 0.03, (0.135, -0.08, 0.38 + dz), m["cyan"], rot=(0, math.pi / 2, 0), verts=6)], torso)
        flash_at = (0.16, -0.08, 0.38)
    else:  # engineer: manipulator arms and a tool head
        parts += attach([strut(Vector((0.03, 0.06, 0.3)), Vector((0.16, 0.08, 0.22)), 0.012, m["metal"])], torso)
        parts += attach([strut(Vector((0.03, -0.06, 0.3)), Vector((0.16, -0.08, 0.22)), 0.012, m["metal"])], torso)
        parts += attach([box("tool", (0.04, 0.2, 0.03), (0.17, 0, 0.22), m["cyan_dim"])], torso)
    flash = None
    if flash_at:
        flash = cylinder("flash", 0.025, 0.05, flash_at, m["fire"], rot=(0, math.pi / 2, 0), verts=6)
        attach([flash], torso)
        flash.hide_render = True
    return {
        "joints": {"pelvis": pelvis, "torso": torso, "hip_l": hip_l, "hip_r": hip_r, "sh_l": sh_l, "sh_r": sh_r},
        "flash": flash,
        "hull": parts + ([flash] if flash else []),
    }


def pose_bot(model, anim, frame):
    j = model["joints"]
    for k in j.values():
        k.rotation_euler = (0, 0, 0)
    j["pelvis"].location = (0, 0, 0.18)
    if model["flash"]:
        model["flash"].hide_render = True
    if anim == "walk":
        a = math.sin(2 * math.pi * frame / 6)
        j["hip_l"].rotation_euler = (0, math.radians(24 * a), 0)
        j["hip_r"].rotation_euler = (0, math.radians(-24 * a), 0)
        j["pelvis"].location = (0, 0, 0.18 + 0.006 * abs(a))
    elif anim == "fire":
        j["torso"].rotation_euler = (0, math.radians((-4, 3, 0)[frame]), 0)
        if model["flash"] and frame == 0:
            model["flash"].hide_render = False
    elif anim == "death":
        # Bots fold at the knees and topple sideways.
        t = (frame + 1) / 4
        j["pelvis"].rotation_euler = (math.radians(80 * t), 0, 0)
        j["pelvis"].location = (0, 0.05 * t, 0.18 - 0.13 * t)


def sentry(style, team=None):
    return bot(style, team, "rifle")


def lance(style, team=None):
    return bot(style, team, "launcher")


def fork(style, team=None):
    return bot(style, team, "tools")


# --- hover vehicles ------------------------------------------------------------


def hover_skirt(m, length, width, z=0.16):
    """Hover base: graphite skirt with a cyan drive glow underneath."""
    out = [box("skirt", (length, width, 0.1), (0, 0, z), m["graphite"], bevel=0.03)]
    out.append(box("drive_glow", (length * 0.85, width * 0.8, 0.02), (0, 0, z - 0.06), m["cyan"]))
    for sx in (-1, 1):
        out.append(cylinder("thruster", width * 0.18, 0.05, (sx * length * 0.32, 0, z - 0.05), m["cyan_dim"], verts=12))
    return out


def ping(style, team=None):
    """Fast hover scout: a flat white dart with a small energy gun."""
    m = mats(style, team)
    hull = hover_skirt(m, 0.9, 0.5, 0.18)
    hull.append(wedge("body", (0.8, 0.46, 0.16), (0.02, 0, 0.3), m["shell"], taper=0.5))
    hull.append(wedge("nose", (0.3, 0.4, 0.12), (0.48, 0, 0.27), m["shell"], rot=(0, math.radians(-90), 0), taper=0.3))
    hull.append(box("canopy", (0.2, 0.22, 0.06), (0.05, 0, 0.4), m["glass"], bevel=0.02))
    hull.append(glow_line(0.7, (0.0, 0.235, 0.3), m))
    hull.append(glow_line(0.7, (0.0, -0.235, 0.3), m))
    hull.append(box("team_fin", (0.18, 0.03, 0.14), (-0.32, 0, 0.44), m["team"]))
    hull.append(box("gun", (0.32, 0.04, 0.04), (0.3, 0.14, 0.36), m["metal"]))
    return {"hull": hull}


def fetch(style, team=None):
    """Harvester: hover hauler with a scoop intake at the front and a hex cargo pod."""
    m = mats(style, team)
    hull = hover_skirt(m, 1.3, 0.84, 0.2)
    hull.append(box("chassis", (1.2, 0.8, 0.22), (0, 0, 0.36), m["shell"], bevel=0.04))
    hull.append(hexprism("cargo", 0.34, 0.7, (-0.25, 0, 0.64), m["shell_dim"], rot=(0, math.pi / 2, 0), bevel=0.02))
    hull.append(box("cargo_window", (0.5, 0.012, 0.12), (-0.25, -0.3, 0.64), m["cyan_dim"]))
    hull.append(wedge("scoop", (0.32, 0.86, 0.22), (0.68, 0, 0.3), m["graphite"], rot=(0, math.radians(90), 0), taper=0.4))
    hull.append(box("cab", (0.3, 0.5, 0.2), (0.38, 0, 0.56), m["shell"], bevel=0.03))
    hull.append(box("cab_glass", (0.02, 0.4, 0.08), (0.535, 0, 0.58), m["glass"]))
    hull.append(box("team_band", (0.3, 0.82, 0.04), (0.1, 0, 0.48), m["team"]))
    hull.append(glow_line(1.1, (0, 0.41, 0.36), m))
    hull.append(glow_line(1.1, (0, -0.41, 0.36), m))
    return {"hull": hull}


def vector(style, team=None):
    """Fast hover tank: wedge hull, low turret with a split-rail energy cannon."""
    m = mats(style, team)
    hull = hover_skirt(m, 1.3, 0.86, 0.2)
    hull.append(wedge("hull", (1.3, 0.84, 0.24), (0, 0, 0.38), m["shell"], taper=0.7))
    hull.append(wedge("prow", (0.3, 0.8, 0.2), (0.72, 0, 0.34), m["shell"], rot=(0, math.radians(-90), 0), taper=0.3))
    hull.append(glow_line(1.2, (0, 0.43, 0.32), m))
    hull.append(glow_line(1.2, (0, -0.43, 0.32), m))
    hull.append(box("team_stripe", (0.14, 0.86, 0.02), (-0.35, 0, 0.51), m["team"]))
    turret = [hexprism("turret", 0.3, 0.2, (-0.05, 0, 0.6), m["shell_dim"], bevel=0.02)]
    turret.append(box("turret_top", (0.3, 0.36, 0.05), (-0.05, 0, 0.72), m["graphite"]))
    for dy in (-0.07, 0.07):
        turret.append(box("rail", (0.75, 0.04, 0.06), (0.5, dy, 0.62), m["metal"]))
    turret.append(box("rail_glow", (0.7, 0.08, 0.015), (0.52, 0, 0.66), m["cyan"]))
    turret.append(box("sensor", (0.06, 0.12, 0.05), (0.12, 0.18, 0.74), m["cyan_dim"]))
    turret.append(box("team_band", (0.3, 0.012, 0.06), (-0.05, 0.27, 0.6), m["team"]))
    return {"hull": hull, "turret": turret}


def firewall(style, team=None):
    """Mobile AA: hover platform with a hex missile cell that points skyward."""
    m = mats(style, team)
    hull = hover_skirt(m, 1.1, 0.76, 0.2)
    hull.append(box("deck", (1.0, 0.72, 0.2), (0, 0, 0.36), m["shell"], bevel=0.04))
    hull.append(glow_line(0.9, (0, 0.37, 0.4), m))
    hull.append(box("team_stripe", (0.12, 0.74, 0.02), (0.35, 0, 0.47), m["team"]))
    turret = [cylinder("ring", 0.24, 0.08, (-0.05, 0, 0.5), m["graphite"], verts=12)]
    cell = []
    for i in range(7):
        a = i * math.pi / 3
        r = 0 if i == 6 else 0.1
        cell.append(hexprism("cell", 0.055, 0.32, (-0.05 + r * math.cos(a), r * math.sin(a), 0.72), m["shell_dim"], rot=(0, math.radians(-30), 0)))
        cell.append(cylinder("cell_glow", 0.03, 0.01, (0.03 + r * math.cos(a), r * math.sin(a), 0.86), m["cyan"], rot=(0, math.radians(-30), 0), verts=6))
    turret += cell
    turret.append(box("team_band", (0.26, 0.012, 0.05), (-0.05, -0.2, 0.55), m["team"]))
    return {"hull": hull, "turret": turret}


def broadcast(style, team=None):
    """Artillery: hover base carrying a tall emitter coil that throws arcing bolts."""
    m = mats(style, team)
    hull = hover_skirt(m, 1.2, 0.8, 0.2)
    hull.append(box("base", (1.1, 0.76, 0.2), (0, 0, 0.36), m["shell"], bevel=0.04))
    hull.append(box("capacitor", (0.4, 0.6, 0.18), (-0.36, 0, 0.55), m["graphite"], bevel=0.02))
    hull.append(glow_line(0.36, (-0.36, 0.305, 0.55), m))
    hull.append(box("team_stripe", (0.12, 0.78, 0.02), (0.3, 0, 0.47), m["team"]))
    turret = [cylinder("mount", 0.2, 0.1, (0.05, 0, 0.52), m["graphite"], verts=12)]
    turret.append(cylinder("coil", 0.07, 0.62, (0.15, 0, 0.82), m["metal"], rot=(0, math.radians(-35), 0), verts=10))
    for k in range(4):
        z = 0.65 + k * 0.1
        turret.append(cylinder("winding", 0.1, 0.025, (0.15 + (z - 0.82) * 0.7, 0, z), m["cyan_dim"], rot=(0, math.radians(-35), 0), verts=12))
    turret.append(cylinder("tip", 0.07, 0.06, (0.36, 0, 1.08), m["cyan"], rot=(0, math.radians(-35), 0), verts=10))
    return {"hull": hull, "turret": turret}


def seek(style, team=None):
    """Anti-armor drone: flying wing with underslung missiles and a cyan sensor eye."""
    m = mats(style, team)
    hull = []
    hull.append(wedge("wing", (0.7, 1.3, 0.08), (0, 0, 1.0), m["shell"], rot=(0, 0, 0), taper=0.2))
    hull.append(box("spine", (0.8, 0.22, 0.12), (0.05, 0, 1.06), m["shell_dim"], bevel=0.03))
    hull.append(box("eye", (0.06, 0.1, 0.05), (0.46, 0, 1.06), m["cyan"]))
    for side in (-1, 1):
        hull.append(cylinder("missile", 0.035, 0.4, (0.08, side * 0.28, 0.93), m["metal"], rot=(0, math.pi / 2, 0), verts=8))
        hull.append(cylinder("engine", 0.06, 0.16, (-0.32, side * 0.16, 1.04), m["graphite"], rot=(0, math.pi / 2, 0), verts=10))
        hull.append(cylinder("engine_glow", 0.045, 0.02, (-0.41, side * 0.16, 1.04), m["cyan"], rot=(0, math.pi / 2, 0), verts=10))
        hull.append(box("wingtip", (0.2, 0.03, 0.03), (-0.2, side * 0.62, 1.0), m["cyan_dim"]))
    hull.append(box("team_wing", (0.25, 0.9, 0.012), (-0.08, 0, 1.045), m["team"]))
    body = joint("body", (0, 0, 0))
    attach(hull, body)
    return {"hull": hull, "joints": {"body": body}}


def pose_seek(model, anim, frame):
    model["joints"]["body"].location = (0, 0, 0.03 * math.sin(math.pi * frame))


def root_unit(style, team=None):
    """T3 hover platform: broad hex deck, Override dish turret."""
    m = mats(style, team)
    hull = hover_skirt(m, 1.6, 1.4, 0.22)
    hull.append(hexprism("deck", 0.85, 0.26, (0, 0, 0.42), m["shell"], bevel=0.04))
    hull.append(hexprism("deck_top", 0.7, 0.06, (0, 0, 0.58), m["graphite"]))
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        hull.append(box("deck_light", (0.5, 0.02, 0.02), (0.72 * math.cos(a), 0.72 * math.sin(a), 0.48), m["cyan"], rot=(0, 0, a + math.pi / 2)))
    hull.append(hexprism("team_ring", 0.86, 0.06, (0, 0, 0.33), m["team"]))
    turret = [cylinder("pylon", 0.14, 0.4, (0, 0, 0.8), m["metal"], verts=10)]
    turret.append(cylinder("dish", 0.42, 0.06, (0.05, 0, 1.06), m["shell_dim"], rot=(0, math.radians(-50), 0), verts=18))
    turret.append(cone("dish_horn", 0.06, 0.0, 0.3, (0.2, 0, 1.15), m["cyan"], rot=(0, math.radians(40), 0), verts=8))
    turret.append(box("cannon", (0.6, 0.08, 0.08), (0.42, 0.25, 0.72), m["metal"]))
    turret.append(box("cannon_glow", (0.55, 0.09, 0.015), (0.44, 0.25, 0.76), m["cyan"]))
    return {"hull": hull, "turret": turret}


def init(style, team=None):
    """Construction unit: big hover carrier holding a folded kernel node."""
    m = mats(style, team)
    hull = hover_skirt(m, 1.8, 0.95, 0.22)
    hull.append(box("frame", (1.75, 0.92, 0.22), (0, 0, 0.4), m["shell"], bevel=0.04))
    hull.append(hexprism("kernel", 0.4, 0.5, (-0.25, 0, 0.76), m["shell_dim"], bevel=0.03))
    hull.append(hexprism("kernel_core", 0.18, 0.52, (-0.25, 0, 0.77), m["cyan_dim"]))
    for dx in (-0.6, 0.1):
        hull.append(box("clamp", (0.1, 0.9, 0.18), (dx, 0, 0.6), m["graphite"]))
    hull.append(box("cab", (0.4, 0.7, 0.26), (0.62, 0, 0.62), m["shell"], bevel=0.04))
    hull.append(box("cab_glass", (0.02, 0.56, 0.1), (0.825, 0, 0.66), m["glass"]))
    hull.append(box("team_band", (1.4, 0.94, 0.05), (-0.1, 0, 0.5), m["team"]))
    hull.append(glow_line(1.6, (0, 0.47, 0.4), m))
    hull.append(glow_line(1.6, (0, -0.47, 0.4), m))
    return {"hull": hull}


# --- buildings: network nodes on hex pads ------------------------------------------


def pad(w, d, m, h=0.08):
    out = [box("pad", (w - 0.06, d - 0.06, h), (0, 0, h / 2), m["pad"], bevel=0.02)]
    # Cyan seam lines around the pad: every building is a network node.
    out.append(box("seam", (w - 0.2, 0.02, 0.01), (0, -(d - 0.2) / 2, h + 0.005), m["cyan_dim"]))
    out.append(box("seam", (0.02, d - 0.2, 0.01), ((w - 0.2) / 2, 0, h + 0.005), m["cyan_dim"]))
    return out


def kernel(style, team=None):
    """Construction yard / core node: stacked hex tower with a floating data ring."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(hexprism("base", 1.2, 0.35, (0, 0, 0.26), m["shell"], bevel=0.03))
    b.append(hexprism("tower", 0.7, 0.9, (0, 0, 0.88), m["shell_dim"], bevel=0.03))
    b.append(hexprism("crown", 0.5, 0.3, (0, 0, 1.48), m["shell"], bevel=0.03))
    b.append(hexprism("core", 0.28, 1.6, (0, 0, 0.9), m["cyan_dim"]))
    b.append(cylinder("ring", 0.95, 0.05, (0, 0, 1.2), m["cyan"], verts=6))
    b.append(hexprism("team_band", 1.21, 0.08, (0, 0, 0.34), m["team"]))
    for k in range(3):
        a = k * 2 * math.pi / 3
        b.append(box("arm", (0.7, 0.12, 0.1), (0.95 * math.cos(a), 0.95 * math.sin(a), 0.5), m["graphite"], rot=(0, 0, a)))
    return {"body": b}


def powerd(style, team=None):
    """Power daemon: a glowing reactor cell in a white hex housing with cooling fins."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(hexprism("housing", 0.62, 0.55, (0, 0, 0.36), m["shell"], bevel=0.03))
    b.append(hexprism("cell", 0.32, 0.7, (0, 0, 0.6), m["cyan"]))
    b.append(hexprism("cap", 0.4, 0.06, (0, 0, 0.97), m["graphite"]))
    for k in range(6):
        a = k * math.pi / 3
        b.append(box("fin", (0.3, 0.03, 0.45), (0.72 * math.cos(a), 0.72 * math.sin(a), 0.32), m["shell_dim"], rot=(0, 0, a)))
    b.append(hexprism("team_band", 0.63, 0.06, (0, 0, 0.5), m["team"]))
    return {"body": b}


def ingest(style, team=None):
    """Refinery: funnel intake, processing block and the dock on the front (-y) side."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(box("processor", (1.5, 1.2, 0.7), (-0.5, 0.5, 0.43), m["shell"], bevel=0.04))
    b.append(box("processor_top", (1.3, 1.0, 0.08), (-0.5, 0.5, 0.82), m["graphite"]))
    b.append(cone("funnel", 0.5, 0.22, 0.5, (0.7, 0.6, 0.6), m["shell_dim"], verts=6))
    b.append(cylinder("funnel_glow", 0.22, 0.02, (0.7, 0.6, 0.86), m["cyan"], verts=6))
    b.append(box("dock", (0.9, 0.55, 0.12), (0.3, -1.05, 0.12), m["graphite"]))
    b.append(box("dock_glow", (0.8, 0.02, 0.02), (0.3, -0.8, 0.19), m["cyan"]))
    b.append(box("echo_tank", (0.6, 0.4, 0.3), (-0.5, -0.35, 0.25), material("hc_echo", "2a8f9e", emission="135c66", style=style)))
    b.append(box("team_band", (1.52, 1.22, 0.08), (-0.5, 0.5, 0.6), m["team"]))
    return {"body": b}


def spawn_bld(style, team=None):
    """Barracks: a bot printer: open frame with a print bed and gantry."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(box("printer", (1.2, 1.0, 0.55), (-0.15, 0.1, 0.36), m["shell"], bevel=0.03))
    b.append(box("bay", (0.04, 0.6, 0.4), (0.46, 0.1, 0.3), m["glass"]))
    b.append(box("bay_glow", (0.045, 0.6, 0.02), (0.465, 0.1, 0.52), m["cyan"]))
    b.append(box("gantry", (1.3, 0.08, 0.08), (-0.15, -0.45, 0.75), m["graphite"]))
    for x in (-0.75, 0.45):
        b.append(box("gantry_leg", (0.06, 0.06, 0.7), (x, -0.45, 0.4), m["graphite"]))
    b.append(box("team_band", (1.22, 1.02, 0.06), (-0.15, 0.1, 0.5), m["team"]))
    return {"body": b}


def make(style, team=None):
    """Vehicle fabricator: long white hall with a glowing fabrication slot and robot arms."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(box("hall", (2.2, 1.8, 0.8), (-0.2, 0.2, 0.5), m["shell"], bevel=0.05))
    b.append(wedge("roof", (2.2, 1.8, 0.2), (-0.2, 0.2, 1.0), m["shell_dim"], taper=0.7))
    b.append(box("slot", (0.04, 1.1, 0.6), (0.91, 0.2, 0.42), m["graphite_dark"]))
    b.append(box("slot_glow", (0.05, 1.1, 0.03), (0.915, 0.2, 0.74), m["cyan"]))
    for y in (-0.5, 0.9):
        b.append(strut(Vector((1.0, y, 0.1)), Vector((1.2, y * 0.6, 0.7)), 0.04, m["metal"]))
    b.append(box("team_band", (2.22, 1.82, 0.08), (-0.2, 0.2, 0.7), m["team"]))
    return {"body": b}


def scan(style, team=None):
    """Radar: a phased-array panel on a hex pylon."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(hexprism("pylon", 0.3, 1.2, (0, 0, 0.66), m["shell"], bevel=0.02))
    b.append(box("array", (0.08, 1.1, 0.8), (0.1, 0, 1.5), m["shell_dim"], rot=(0, math.radians(-20), 0), bevel=0.02))
    for k in range(4):
        b.append(box("array_line", (0.09, 1.0, 0.015), (0.12, 0, 1.25 + k * 0.17), m["cyan"], rot=(0, math.radians(-20), 0)))
    b.append(box("hut", (0.5, 0.45, 0.3), (-0.5, -0.5, 0.23), m["graphite"], bevel=0.02))
    b.append(hexprism("team_band", 0.31, 0.08, (0, 0, 0.5), m["team"]))
    return {"body": b}


def relay(style, team=None):
    """Relay node (1x1): thin pylon with a floating coverage ring."""
    m = mats(style, team)
    b = [hexprism("foot", 0.4, 0.12, (0, 0, 0.06), m["pad"])]
    b.append(hexprism("pylon", 0.1, 1.0, (0, 0, 0.6), m["shell"]))
    b.append(cylinder("ring", 0.32, 0.03, (0, 0, 1.05), m["cyan"], verts=6))
    b.append(cylinder("ring2", 0.22, 0.03, (0, 0, 0.8), m["cyan_dim"], verts=6))
    b.append(hexprism("tip", 0.06, 0.12, (0, 0, 1.16), m["cyan"]))
    b.append(hexprism("team_band", 0.11, 0.08, (0, 0, 0.3), m["team"]))
    return {"body": b}


def launchd(style, team=None):
    """Airfield: hex landing pad with light ring and a launch rail tower."""
    m = mats(style, team)
    b = pad(3, 3, m, h=0.06)
    b.append(hexprism("landing", 0.95, 0.06, (0.3, -0.3, 0.1), m["graphite"]))
    b.append(cylinder("landing_ring", 0.8, 0.012, (0.3, -0.3, 0.135), m["cyan"], verts=6))
    b.append(hexprism("team_mark", 0.3, 0.014, (0.3, -0.3, 0.14), m["team"]))
    b.append(box("tower", (0.6, 0.6, 0.9), (-0.9, 0.9, 0.5), m["shell"], bevel=0.03))
    b.append(box("tower_glass", (0.02, 0.5, 0.18), (-0.59, 0.9, 0.82), m["glass"]))
    b.append(box("rail", (1.2, 0.1, 0.06), (-0.2, 1.0, 0.7), m["metal"], rot=(0, math.radians(-12), 0)))
    return {"body": b}


def sudo(style, team=None):
    """Tech center: racks of server monoliths under a canopy, glowing data lines."""
    m = mats(style, team)
    b = pad(3, 3, m)
    for i in range(4):
        x = -0.9 + i * 0.6
        b.append(box("rack", (0.4, 0.9, 1.0 + 0.15 * (i % 2)), (x, 0.3, 0.6 + 0.075 * (i % 2)), m["graphite"], bevel=0.02))
        b.append(box("rack_light", (0.41, 0.02, 0.8), (x, -0.155, 0.6), m["cyan_dim"]))
    b.append(box("canopy", (2.6, 1.4, 0.06), (0, 0.3, 1.35), m["shell"]))
    b.append(hexprism("antenna", 0.08, 0.6, (0.9, -0.9, 0.4), m["shell"]))
    b.append(box("team_band", (2.6, 1.4, 0.04), (0, 0.3, 1.4), m["team"]))
    return {"body": b}


def guard(style, team=None):
    """Laser turret (1x1): hex base, rotating emitter."""
    m = mats(style, team)
    b = [hexprism("base", 0.42, 0.3, (0, 0, 0.15), m["shell"], bevel=0.02)]
    b.append(hexprism("team_band", 0.43, 0.06, (0, 0, 0.22), m["team"]))
    turret = [cylinder("head", 0.18, 0.16, (0, 0, 0.4), m["graphite"], verts=10)]
    turret.append(box("emitter", (0.4, 0.07, 0.07), (0.25, 0, 0.42), m["metal"]))
    turret.append(box("emitter_glow", (0.36, 0.075, 0.015), (0.26, 0, 0.46), m["cyan"]))
    return {"body": b, "turret": turret}


def filter_bld(style, team=None):
    """AA defense (2x2): ring of fins around a turret that fires flak bursts upward."""
    m = mats(style, team)
    b = pad(2, 2, m, h=0.06)
    b.append(hexprism("base", 0.7, 0.3, (0, 0, 0.21), m["shell"], bevel=0.03))
    b.append(hexprism("team_band", 0.71, 0.06, (0, 0, 0.28), m["team"]))
    turret = [cylinder("ring", 0.3, 0.1, (0, 0, 0.42), m["graphite"], verts=12)]
    for dy in (-0.12, 0.12):
        turret.append(box("barrel", (0.5, 0.06, 0.06), (0.2, dy, 0.65), m["metal"], rot=(0, math.radians(-45), 0)))
    turret.append(box("glow", (0.2, 0.3, 0.02), (0.05, 0, 0.55), m["cyan"]))
    return {"body": b, "turret": turret}


def sigkill(style, team=None):
    """Heavy defense (2x2): long-range energy cannon on an armored hex plinth."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(hexprism("plinth", 0.85, 0.45, (0, 0, 0.3), m["shell_dim"], bevel=0.04))
    b.append(hexprism("team_band", 0.86, 0.08, (0, 0, 0.42), m["team"]))
    turret = [cylinder("mount", 0.38, 0.12, (0, 0, 0.6), m["graphite"], verts=6)]
    turret.append(box("body", (0.7, 0.5, 0.3), (0, 0, 0.8), m["shell"], bevel=0.05))
    for dy in (-0.1, 0.1):
        turret.append(box("rail", (1.3, 0.06, 0.08), (0.8, dy, 0.82), m["metal"]))
    turret.append(box("rail_glow", (1.25, 0.12, 0.02), (0.82, 0, 0.87), m["cyan"]))
    return {"body": b, "turret": turret}


def block(style, team=None):
    """Wall: a hex barrier block with a glowing seam."""
    m = mats(style, team)
    b = [hexprism("block", 0.48, 0.45, (0, 0, 0.23), m["shell"], bevel=0.03)]
    b.append(cylinder("seam", 0.49, 0.03, (0, 0, 0.32), m["cyan_dim"], verts=6))
    b.append(hexprism("team_band", 0.49, 0.05, (0, 0, 0.12), m["team"]))
    return {"body": b}


# --- catalog ----------------------------------------------------------------------

INF = {"idle": 1, "walk": 6, "fire": 3, "death": 4}
UNITS = {
    "sentry": dict(kind="infantry", frame=64, dirs=8, anims=INF, build=sentry, pose=pose_bot),
    "lance": dict(kind="infantry", frame=64, dirs=8, anims=INF, build=lance, pose=pose_bot),
    "fork": dict(kind="infantry", frame=64, dirs=8, anims=INF, build=fork, pose=pose_bot),
    "ping": dict(kind="vehicle", frame=96, dirs=16, build=ping),
    "fetch": dict(kind="vehicle", frame=128, dirs=16, build=fetch),
    "vector": dict(kind="vehicle", frame=128, dirs=16, build=vector),
    "firewall": dict(kind="vehicle", frame=112, dirs=16, build=firewall),
    "broadcast": dict(kind="vehicle", frame=128, dirs=16, build=broadcast),
    "seek": dict(kind="air", frame=128, dirs=16, anims={"fly": 2}, build=seek, pose=pose_seek),
    "root": dict(kind="vehicle", frame=160, dirs=16, build=root_unit),
    "init": dict(kind="vehicle", frame=144, dirs=16, build=init),
}

BUILDINGS = {
    "kernel": dict(footprint=(3, 3), frame=256, build=kernel),
    "powerd": dict(footprint=(2, 2), frame=176, build=powerd),
    "ingest": dict(footprint=(3, 3), frame=256, build=ingest),
    "spawn": dict(footprint=(2, 2), frame=160, build=spawn_bld),
    "make": dict(footprint=(3, 3), frame=256, build=make),
    "scan": dict(footprint=(2, 2), frame=224, build=scan),
    "relay": dict(footprint=(1, 1), frame=112, build=relay),
    "launchd": dict(footprint=(3, 3), frame=256, build=launchd),
    "sudo": dict(footprint=(3, 3), frame=256, build=sudo),
    "guard": dict(footprint=(1, 1), frame=96, build=guard),
    "filter": dict(footprint=(2, 2), frame=160, build=filter_bld),
    "sigkill": dict(footprint=(2, 2), frame=192, build=sigkill),
    "block": dict(footprint=(1, 1), frame=80, build=block),
}
