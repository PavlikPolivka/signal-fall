"""Halcyon models: white and graphite shells, cyan light lines, hexagonal panels, hover drives.

Same conventions as the Holdout models: 1 Blender unit = 1 tile, units face +X,
builders return named part lists (hull / turret / body / joints).
"""
import math

from kit import box, cone, cylinder, hexprism, material, root, strut, wedge
from mathutils import Euler, Vector

TEAM_GREY = "d8d8d8"


def mats(style, team=None):
    # Halcyon is manufactured: smooth "sleek" shells regardless of the global grit; only the ground pads weather.
    sl = "sleek"
    return {
        "shell": material("hc_shell", "e6eaec", rough=0.32, style=sl),
        "shell_dim": material("hc_shell_dim", "c3cace", rough=0.38, style=sl),
        "graphite": material("hc_graphite", "2b2f36", rough=0.45, metal=0.3, style=sl),
        "graphite_dark": material("hc_graphite_dark", "191c21", rough=0.5, metal=0.3, style=sl),
        "metal": material("hc_metal", "8a939a", rough=0.28, metal=0.85, style=sl),
        "glass": material("hc_glass", "122a33", rough=0.06, metal=0.5, style=sl),
        "cyan": material("hc_cyan", "3ee6ff", emission="1fc8ec", style=sl),
        "cyan_dim": material("hc_cyan_dim", "2a9fb5", emission="137a8f", style=sl),
        "fire": material("hc_fire", "bff6ff", emission="6fe9ff", style=sl),
        "pad": material("hc_pad", "8f989d", rough=0.8, style=style),
        "pad_dark": material("hc_pad_dark", "5d656a", rough=0.8, style=style),
        "team": material("team", team or TEAM_GREY, rough=0.35, style=sl),
    }


def trim(objs, m):
    """Graphite trim strips along the top edges of a box-like part: panel lines that read at sprite size."""
    out = []
    for o in objs:
        d = o.dimensions
        x, y, z = o.location
        top = z + d.z / 2
        out.append(box("trim", (d.x + 0.01, 0.025, 0.025), (x, y + d.y / 2, top - 0.02), m["graphite"]))
        out.append(box("trim", (d.x + 0.01, 0.025, 0.025), (x, y - d.y / 2, top - 0.02), m["graphite"]))
        out.append(box("trim", (0.025, d.y + 0.01, 0.025), (x + d.x / 2, y, top - 0.02), m["graphite"]))
        out.append(box("trim", (0.025, d.y + 0.01, 0.025), (x - d.x / 2, y, top - 0.02), m["graphite"]))
    return out


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
        parts += attach([box("emitter_line", (0.12, 0.012, 0.006), (0.12, -0.03, 0.3), m["cyan"])], torso)
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
    out.append(box("pad_rim", (w - 0.02, d - 0.02, h * 0.6), (0, 0, h * 0.3), m["pad_dark"]))
    # Cyan seam lines around the pad: every building is a network node.
    for sx, sy, lx, ly in ((0, -1, w - 0.25, 0.02), (0, 1, w - 0.25, 0.02), (1, 0, 0.02, d - 0.25), (-1, 0, 0.02, d - 0.25)):
        out.append(box("seam", (lx, ly, 0.01), (sx * (w - 0.25) / 2, sy * (d - 0.25) / 2, h + 0.005), m["cyan_dim"]))
    return out


def light_slits(x, y, z, r, n, h, m, phase=0.0):
    """Vertical glowing slits around a hex/cylindrical core."""
    out = []
    for k in range(n):
        a = phase + k * 2 * math.pi / n
        out.append(box("slit", (0.03, 0.06, h), (x + r * math.cos(a), y + r * math.sin(a), z), m["cyan"], rot=(0, 0, a)))
    return out


def kernel(style, team=None):
    """Construction yard / core node: buttressed hex tower, glowing slits, a floating ring of data segments, antenna."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(hexprism("base", 1.25, 0.28, (0, 0, 0.22), m["shell_dim"], bevel=0.03))
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        b.append(wedge("buttress", (0.5, 0.16, 0.55), (0.9 * math.cos(a), 0.9 * math.sin(a), 0.5), m["shell"], rot=(0, 0, a), taper=0.3))
    b.append(hexprism("tower", 0.66, 1.0, (0, 0, 0.88), m["shell"], bevel=0.03))
    b += light_slits(0, 0, 0.9, 0.6, 6, 0.7, m, math.pi / 6)
    b.append(hexprism("collar", 0.74, 0.08, (0, 0, 1.42), m["graphite"]))
    b.append(hexprism("crown", 0.48, 0.32, (0, 0, 1.62), m["shell_dim"], bevel=0.03))
    b.append(hexprism("crown_glow", 0.3, 0.34, (0, 0, 1.63), m["cyan_dim"]))
    for k in range(6):
        a = k * math.pi / 3
        b.append(box("ring_seg", (0.36, 0.06, 0.05), (1.05 * math.cos(a), 1.05 * math.sin(a), 1.25), m["cyan"], rot=(0, 0, a + math.pi / 2)))
    b.append(cylinder("antenna", 0.02, 0.6, (0, 0, 2.08), m["metal"], verts=6))
    b.append(cylinder("antenna_tip", 0.05, 0.05, (0, 0, 2.4), m["cyan"], verts=8))
    b.append(hexprism("team_band", 1.26, 0.07, (0, 0, 0.32), m["team"]))
    b.append(hexprism("team_crown", 0.49, 0.06, (0, 0, 1.79), m["team"]))
    return {"body": b}


def powerd(style, team=None):
    """Power daemon: a reactor cell glowing through slots in a white housing, tall fins, conduits to the pad."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(hexprism("housing", 0.6, 0.62, (0, 0, 0.39), m["shell"], bevel=0.03))
    b += light_slits(0, 0, 0.42, 0.55, 6, 0.45, m)
    b.append(hexprism("cell", 0.28, 0.5, (0, 0, 0.92), m["cyan"]))
    for k in range(3):
        a = k * 2 * math.pi / 3
        b.append(box("cell_cage", (0.04, 0.04, 0.5), (0.3 * math.cos(a), 0.3 * math.sin(a), 0.92), m["metal"]))
    b.append(hexprism("cap", 0.36, 0.07, (0, 0, 1.2), m["graphite"]))
    for k in range(6):
        a = k * math.pi / 3
        b.append(wedge("fin", (0.3, 0.035, 0.7), (0.76 * math.cos(a), 0.76 * math.sin(a), 0.42), m["shell_dim"], rot=(0, 0, a), taper=0.4))
    b.append(cylinder("conduit", 0.05, 0.5, (0.55, -0.55, 0.15), m["graphite"], rot=(0, math.pi / 2, math.pi / 4), verts=8))
    b.append(hexprism("team_band", 0.61, 0.07, (0, 0, 0.66), m["team"]))
    return {"body": b}


def ingest(style, team=None):
    """Refinery: twin intake funnels on a processor, a conveyor arm to the dock on the front (-y) side, Echo tanks."""
    m = mats(style, team)
    b = pad(3, 3, m)
    proc = box("processor", (1.5, 1.2, 0.72), (-0.5, 0.5, 0.44), m["shell"], bevel=0.04)
    b.append(proc)
    b += trim([proc], m)
    b.append(box("processor_top", (1.3, 1.0, 0.08), (-0.5, 0.5, 0.84), m["graphite"]))
    for fx, fy in ((-0.85, 0.75), (-0.2, 0.75)):
        b.append(cone("funnel", 0.3, 0.12, 0.4, (fx, fy, 1.08), m["shell_dim"], verts=6))
        b.append(cylinder("funnel_glow", 0.13, 0.02, (fx, fy, 1.29), m["cyan"], verts=6))
    for k in range(2):
        b.append(cylinder("echo_tank", 0.22, 0.6, (0.75, 0.25 + k * 0.55, 0.38), material("hc_echo", "2fb7c9", emission="12707d", style="sleek"), verts=12))
        b.append(cylinder("tank_cap", 0.24, 0.05, (0.75, 0.25 + k * 0.55, 0.7), m["graphite"], verts=12))
    b.append(strut(Vector((-0.2, 0.0, 0.7)), Vector((0.3, -0.75, 0.3)), 0.06, m["metal"]))
    b.append(box("dock", (0.9, 0.55, 0.12), (0.3, -1.05, 0.12), m["graphite"]))
    b.append(box("dock_glow", (0.8, 0.02, 0.02), (0.3, -0.8, 0.19), m["cyan"]))
    b.append(box("window", (1.2, 0.012, 0.1), (-0.5, -0.105, 0.55), m["cyan_dim"]))
    b.append(box("team_band", (1.52, 1.22, 0.07), (-0.5, 0.5, 0.62), m["team"]))
    return {"body": b}


def spawn_bld(style, team=None):
    """Barracks: a bot printer: glass canopy over a print bed with a half-printed bot and a gantry head."""
    m = mats(style, team)
    b = pad(2, 2, m)
    base = box("printer_base", (1.3, 1.1, 0.25), (-0.1, 0.1, 0.2), m["shell"], bevel=0.03)
    b.append(base)
    b += trim([base], m)
    b.append(box("bed", (0.7, 0.6, 0.03), (-0.1, 0.1, 0.34), m["cyan_dim"]))
    for x in (-0.65, 0.45):
        for y in (-0.35, 0.55):
            b.append(box("post", (0.05, 0.05, 0.7), (x, y, 0.65), m["graphite"]))
    b.append(box("canopy", (1.15, 0.95, 0.04), (-0.1, 0.1, 1.0), m["glass"]))
    b.append(box("gantry", (1.15, 0.06, 0.06), (-0.1, 0.1, 0.93), m["metal"]))
    b.append(box("head", (0.12, 0.12, 0.12), (0.05, 0.1, 0.85), m["shell_dim"]))
    b.append(box("head_glow", (0.04, 0.04, 0.06), (0.05, 0.1, 0.77), m["cyan"]))
    # The bot being printed: legs and half a torso.
    for y in (0.05, 0.15):
        b.append(box("bot_leg", (0.04, 0.035, 0.18), (-0.15, y, 0.45), m["shell"]))
    b.append(hexprism("bot_core", 0.07, 0.07, (-0.15, 0.1, 0.58), m["shell"]))
    b.append(box("team_band", (1.32, 1.12, 0.06), (-0.1, 0.1, 0.27), m["team"]))
    return {"body": b}


def make(style, team=None):
    """Vehicle fabricator: a hall of hex roof panels, a cyan-framed bay door, an overhead crane on the apron."""
    m = mats(style, team)
    b = pad(3, 3, m)
    hall = box("hall", (2.0, 1.8, 0.8), (-0.3, 0.2, 0.5), m["shell"], bevel=0.05)
    b.append(hall)
    b += trim([hall], m)
    for i in range(4):
        for j in range(3):
            b.append(hexprism("roof_panel", 0.24, 0.05, (-1.0 + i * 0.47, -0.4 + j * 0.6, 0.93), m["shell_dim"] if (i + j) % 2 else m["graphite"]))
    b.append(box("door", (0.04, 1.1, 0.62), (0.71, 0.2, 0.42), m["graphite_dark"]))
    for dy in (-0.36, 0.76):
        b.append(box("door_frame", (0.06, 0.05, 0.66), (0.72, dy, 0.44), m["cyan"]))
    b.append(box("door_lintel", (0.06, 1.17, 0.05), (0.72, 0.2, 0.76), m["cyan"]))
    for y in (-0.7, 1.05):
        b.append(box("crane_leg", (0.07, 0.07, 1.0), (1.15, y, 0.55), m["graphite"]))
    b.append(box("crane_beam", (0.1, 1.85, 0.1), (1.15, 0.18, 1.08), m["metal"]))
    b.append(box("crane_head", (0.16, 0.2, 0.14), (1.15, 0.35, 0.96), m["shell_dim"]))
    b.append(box("apron", (0.7, 1.4, 0.02), (1.15, 0.2, 0.09), m["pad_dark"]))
    b.append(box("team_band", (2.02, 1.82, 0.07), (-0.3, 0.2, 0.7), m["team"]))
    return {"body": b}


def scan(style, team=None):
    """Radar: a hex-tiled phased array on a pylon, with a sensor dome and a small equipment hut."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(hexprism("pylon", 0.26, 1.1, (0, 0, 0.62), m["shell"], bevel=0.02))
    b.append(cylinder("bearing", 0.3, 0.1, (0, 0, 1.2), m["graphite"], verts=12))
    tilt = (0, math.radians(-25), math.radians(20))
    b.append(box("array", (0.07, 1.1, 0.75), (0.08, 0, 1.6), m["graphite"], rot=tilt, bevel=0.02))
    for i in range(3):
        for j in range(4):
            p = Vector((0.12, -0.39 + j * 0.26, -0.24 + i * 0.24))
            p.rotate(Euler(tilt))
            b.append(hexprism("cell", 0.1, 0.03, (p.x, p.y, 1.6 + p.z), m["shell_dim"] if (i + j) % 2 else m["cyan_dim"], rot=(0, math.radians(90 - 25), math.radians(20))))
    b.append(cylinder("dome", 0.18, 0.18, (-0.55, -0.55, 0.4), m["shell"], verts=12))
    b.append(cone("dome_top", 0.18, 0.0, 0.12, (-0.55, -0.55, 0.55), m["cyan_dim"], verts=12))
    b.append(box("hut", (0.45, 0.4, 0.28), (0.5, -0.55, 0.22), m["graphite"], bevel=0.02))
    b.append(hexprism("team_band", 0.27, 0.07, (0, 0, 0.5), m["team"]))
    return {"body": b}


def relay(style, team=None):
    """Relay node (1x1): tripod pylon with stacked coverage rings."""
    m = mats(style, team)
    b = [hexprism("foot", 0.4, 0.1, (0, 0, 0.05), m["pad"])]
    for k in range(3):
        a = k * 2 * math.pi / 3
        b.append(strut(Vector((0.32 * math.cos(a), 0.32 * math.sin(a), 0.08)), Vector((0, 0, 0.6)), 0.025, m["graphite"]))
    b.append(hexprism("pylon", 0.08, 1.0, (0, 0, 0.62), m["shell"]))
    b.append(cylinder("ring", 0.3, 0.025, (0, 0, 1.08), m["cyan"], verts=6))
    b.append(cylinder("ring2", 0.22, 0.025, (0, 0, 0.88), m["cyan_dim"], verts=6))
    b.append(hexprism("tip", 0.06, 0.14, (0, 0, 1.2), m["cyan"]))
    b.append(hexprism("team_band", 0.09, 0.08, (0, 0, 0.4), m["team"]))
    return {"body": b}


def launchd(style, team=None):
    """Airfield: hex landing pad with light ring, a slim control tower and a launch rail with a parked drone."""
    m = mats(style, team)
    b = pad(3, 3, m, h=0.06)
    b.append(hexprism("landing", 0.95, 0.06, (0.3, -0.3, 0.1), m["graphite"]))
    b.append(cylinder("landing_ring", 0.82, 0.012, (0.3, -0.3, 0.135), m["cyan"], verts=6))
    b.append(hexprism("team_mark", 0.28, 0.014, (0.3, -0.3, 0.14), m["team"]))
    for k in range(6):
        a = k * math.pi / 3
        b.append(cylinder("pad_light", 0.03, 0.03, (0.3 + 0.9 * math.cos(a), -0.3 + 0.9 * math.sin(a), 0.14), m["cyan"], verts=6))
    tower = box("tower", (0.36, 0.36, 1.0), (-0.95, 0.95, 0.55), m["shell"], bevel=0.03)
    b.append(tower)
    b.append(box("tower_cab", (0.56, 0.56, 0.24), (-0.95, 0.95, 1.15), m["shell_dim"], bevel=0.03))
    b.append(box("tower_glass", (0.58, 0.58, 0.08), (-0.95, 0.95, 1.16), m["glass"]))
    b.append(box("rail", (1.3, 0.12, 0.05), (0.2, 1.0, 0.4), m["metal"], rot=(0, math.radians(-12), 0)))
    for x in (-0.3, 0.6):
        b.append(box("rail_post", (0.05, 0.05, 0.4), (x, 1.0, 0.2), m["graphite"]))
    b.append(wedge("parked", (0.4, 0.5, 0.05), (0.15, 1.0, 0.5), m["shell"], rot=(0, math.radians(-12), 0), taper=0.2))
    return {"body": b}


def sudo(style, team=None):
    """Tech center: server monoliths around a holo-projector, under a cantilevered canopy."""
    m = mats(style, team)
    b = pad(3, 3, m)
    for i in range(5):
        a = math.pi * 0.15 + i * math.pi * 0.28
        x, y = 0.95 * math.cos(a), 0.95 * math.sin(a) - 0.2
        b.append(box("rack", (0.32, 0.4, 1.0 + 0.12 * (i % 2)), (x, y, 0.6 + 0.06 * (i % 2)), m["graphite"], rot=(0, 0, a), bevel=0.02))
        b.append(box("rack_light", (0.02, 0.3, 0.8), (x - 0.17 * math.cos(a), y - 0.17 * math.sin(a), 0.6), m["cyan_dim"], rot=(0, 0, a)))
    b.append(hexprism("projector", 0.32, 0.25, (0, -0.2, 0.2), m["shell"]))
    b.append(cone("holo", 0.04, 0.42, 0.7, (0, -0.2, 0.7), material("hc_holo", "7ff0ff", emission="2fd8f5", style="sleek"), verts=12))
    b.append(hexprism("holo_core", 0.12, 0.12, (0, -0.2, 0.75), m["cyan"]))
    b.append(box("canopy", (1.4, 1.0, 0.05), (-0.6, 0.7, 1.4), m["shell"], rot=(0, math.radians(6), 0)))
    b.append(box("canopy_arm", (0.08, 0.08, 1.4), (-1.15, 1.05, 0.72), m["graphite"]))
    b.append(box("team_band", (1.41, 1.01, 0.04), (-0.6, 0.7, 1.44), m["team"]))
    return {"body": b}


def rmrf(style, team=None):
    """Superweapon (3x3): stepped hex base, a big dish tilted at the sky over a cyan beam column, four emitter pylons."""
    m = mats(style, team)
    b = pad(3, 3, m)
    b.append(hexprism("base", 1.25, 0.3, (0, 0, 0.23), m["shell_dim"], bevel=0.03))
    b.append(hexprism("base2", 0.95, 0.25, (0, 0, 0.5), m["shell"], bevel=0.03))
    b.append(hexprism("team_band", 0.96, 0.06, (0, 0, 0.6), m["team"]))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = 1.15 * math.cos(a), 1.15 * math.sin(a)
        b.append(box("pylon", (0.2, 0.2, 1.1), (x, y, 0.63), m["graphite"], rot=(0, 0, a), bevel=0.02))
        b.append(box("pylon_light", (0.04, 0.21, 0.9), (x - 0.1 * math.cos(a), y - 0.1 * math.sin(a), 0.65), m["cyan"], rot=(0, 0, a)))
        b.append(cone("pylon_tip", 0.12, 0.0, 0.25, (x, y, 1.3), m["shell"], verts=6))
    b.append(cylinder("mast", 0.16, 0.7, (0, 0, 0.95), m["graphite"], verts=12))
    beam = material("hc_beam", "7ff0ff", emission="2fd8f5", style="sleek")
    b.append(cylinder("beam", 0.07, 1.0, (0, 0, 1.3), beam, verts=10))
    b.append(cone("dish", 0.12, 0.95, 0.35, (0.05, 0, 1.45), m["shell"], rot=(0, math.radians(-25), 0), verts=16))
    b.append(cone("dish_rim", 0.9, 0.97, 0.05, (0.13, 0, 1.6), m["cyan_dim"], rot=(0, math.radians(-25), 0), verts=16))
    b.append(cylinder("feed", 0.03, 0.7, (0.2, 0, 1.75), m["metal"], rot=(0, math.radians(-25), 0), verts=6))
    b.append(hexprism("feed_core", 0.08, 0.1, (0.33, 0, 2.05), m["cyan"]))
    return {"body": b}


def guard(style, team=None):
    """Laser turret (1x1): stepped hex base, rotating emitter head."""
    m = mats(style, team)
    b = [hexprism("base", 0.44, 0.18, (0, 0, 0.09), m["shell_dim"], bevel=0.02)]
    b.append(hexprism("base2", 0.34, 0.16, (0, 0, 0.25), m["shell"], bevel=0.02))
    b.append(hexprism("team_band", 0.35, 0.05, (0, 0, 0.27), m["team"]))
    turret = [cylinder("head", 0.18, 0.16, (0, 0, 0.42), m["graphite"], verts=10)]
    turret.append(box("cowl", (0.3, 0.22, 0.1), (0.05, 0, 0.52), m["shell"], bevel=0.02))
    turret.append(box("emitter", (0.38, 0.06, 0.06), (0.28, 0, 0.45), m["metal"]))
    turret.append(cylinder("lens", 0.045, 0.03, (0.47, 0, 0.45), m["cyan"], rot=(0, math.pi / 2, 0), verts=8))
    return {"body": b, "turret": turret}


def filter_bld(style, team=None):
    """AA defense (2x2): ring of radiator fins around a twin-barrel flak turret."""
    m = mats(style, team)
    b = pad(2, 2, m, h=0.06)
    b.append(hexprism("base", 0.7, 0.3, (0, 0, 0.21), m["shell"], bevel=0.03))
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        b.append(wedge("fin", (0.22, 0.04, 0.4), (0.78 * math.cos(a), 0.78 * math.sin(a), 0.26), m["shell_dim"], rot=(0, 0, a), taper=0.3))
    b.append(hexprism("team_band", 0.71, 0.06, (0, 0, 0.28), m["team"]))
    turret = [cylinder("ring", 0.3, 0.1, (0, 0, 0.42), m["graphite"], verts=12)]
    turret.append(box("cradle", (0.32, 0.4, 0.18), (0, 0, 0.56), m["shell"], bevel=0.03))
    for dy in (-0.12, 0.12):
        turret.append(box("barrel", (0.55, 0.06, 0.06), (0.22, dy, 0.72), m["metal"], rot=(0, math.radians(-45), 0)))
        turret.append(box("barrel_glow", (0.05, 0.065, 0.065), (0.42, dy, 0.92), m["cyan"], rot=(0, math.radians(-45), 0)))
    return {"body": b, "turret": turret}


def sigkill(style, team=None):
    """Heavy defense (2x2): long-range rail cannon on an armored hex plinth with capacitor banks."""
    m = mats(style, team)
    b = pad(2, 2, m)
    b.append(hexprism("plinth", 0.85, 0.45, (0, 0, 0.3), m["shell_dim"], bevel=0.04))
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 2
        b.append(box("capacitor", (0.2, 0.3, 0.35), (0.7 * math.cos(a), 0.7 * math.sin(a), 0.25), m["graphite"], rot=(0, 0, a)))
        b.append(box("cap_glow", (0.21, 0.04, 0.25), (0.7 * math.cos(a), 0.7 * math.sin(a), 0.25), m["cyan_dim"], rot=(0, 0, a)))
    b.append(hexprism("team_band", 0.86, 0.07, (0, 0, 0.42), m["team"]))
    turret = [cylinder("mount", 0.38, 0.12, (0, 0, 0.6), m["graphite"], verts=6)]
    body = box("body", (0.7, 0.5, 0.3), (0, 0, 0.8), m["shell"], bevel=0.05)
    turret.append(body)
    turret += trim([body], m)
    for dy in (-0.1, 0.1):
        turret.append(box("rail", (1.3, 0.06, 0.08), (0.8, dy, 0.82), m["metal"]))
    turret.append(box("rail_glow", (1.25, 0.12, 0.02), (0.82, 0, 0.87), m["cyan"]))
    return {"body": b, "turret": turret}


def block(style, team=None):
    """Wall: a hex barrier block with a glowing seam and a graphite cap."""
    m = mats(style, team)
    b = [hexprism("block", 0.48, 0.45, (0, 0, 0.23), m["shell"], bevel=0.03)]
    b.append(hexprism("cap", 0.4, 0.05, (0, 0, 0.47), m["graphite"]))
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
    "seek": dict(kind="air", frame=128, dirs=16, anims={"fly": 1}, build=seek, pose=pose_seek),
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
    # Superweapon: procedural for now (the first Meshy try came out as a bar; see models.json).
    "rmrf": dict(footprint=(3, 3), frame=288, build=rmrf),
}
