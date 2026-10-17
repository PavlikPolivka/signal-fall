"""City blocks assembled from Poly Haven's modular facade kits (CC0): brick apartment and factory
buildings of any footprint, for the city's ruins obstacles.

The kits are grids of 3 m panels. A wall panel spans local x -3..0 and height 0..3 with its face at
y = 0 looking toward -y (Blender axes after the glTF import); the window or door insert with the same
name minus "wall_" sits in the same frame. Base, cornice and crown trims follow the same layout.
"""
import math
import os
import random

import bpy
from mathutils import Vector

HERE = os.path.dirname(__file__)
MODELS = os.path.normpath(os.path.join(HERE, "..", "..", "props", "models"))
PANEL = 3.0
# A 1x1 tile footprint holds 2 x 2 panels (about 6 m a tile).

KITS = {
    "apt": "modular_urban_apartments_facade",
    "fac": "modular_factory_facade",
}


def _import_kit(kind):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{KITS[kind]}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    pieces = {}
    for o in new:
        if o.type == "MESH":
            pieces[o.name] = o.data
    for o in new:
        bpy.data.objects.remove(o)
    return pieces


def _names(pieces, prefix):
    return sorted(n for n in pieces if n.startswith(prefix))


class Builder:
    def __init__(self, kind, rnd):
        self.kind = kind
        self.rnd = rnd
        self.pieces = _import_kit(kind)
        self.objs = []

    def put(self, name, loc, yaw):
        data = self.pieces.get(name)
        if data is None:
            return None
        o = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (0, 0, yaw)
        self.objs.append(o)
        return o

    def panel(self, wall, loc, yaw):
        self.put(wall, loc, yaw)
        insert = wall[len("wall_"):]
        if insert in self.pieces:
            self.put(insert, loc, yaw)


def _sides(w, d):
    """(start, direction along the wall, yaw, panel count) for the four walls of a w x d metre box,
    walking each wall so the panel's local x (-3..0) maps onto it and its face looks outward."""
    return [
        # south (y = 0, faces -y)
        (lambda k: Vector(((k + 1) * PANEL, 0, 0)), 0.0, int(w / PANEL)),
        # east (x = w, faces +x)
        (lambda k: Vector((w, (k + 1) * PANEL, 0)), math.pi / 2, int(d / PANEL)),
        # north (y = d, faces +y)
        (lambda k: Vector((w - (k + 1) * PANEL, d, 0)), math.pi, int(w / PANEL)),
        # west (x = 0, faces -x)
        (lambda k: Vector((0, d - (k + 1) * PANEL, 0)), -math.pi / 2, int(d / PANEL)),
    ]


def block(fw, fd, seed, kind=None, floors=None, ruined=None):
    """A building on an fw x fd tile footprint, centred on the origin (1 unit = 1 tile).

    Ruined buildings lose their roof and part of the top floor, are sooted, and stand in rubble."""
    import props_real as real

    rnd = random.Random(seed * 7919 + fw * 31 + fd)
    kind = kind or ("apt" if rnd.random() < 0.55 else "fac")
    ruined = rnd.random() < 0.5 if ruined is None else ruined
    b = Builder(kind, rnd)
    p = b.pieces
    nw, nd = fw * 2, fd * 2
    w, d = nw * PANEL, nd * PANEL
    floors = floors or rnd.choice([2, 3, 3, 4] if fw * fd > 1 else [2, 2, 3])
    _weather(p, rnd, ruined)

    if kind == "apt":
        upper = [n for n in _names(p, "wall_window_") if "angled" not in n]
        ground = [n for n in _names(p, "wall_door_") if "angled" not in n] + upper
        base, cornice, crown = "base_standard_01", "cornice_standard_standard_01", "crown_standard_standard_01"
    else:
        upper = [n for n in _names(p, "wall_window_")]
        ground = [n for n in _names(p, "wall_door_") if "garage" not in n] + upper
        base, cornice, crown = "base_standard_standard_01", "cornice01_standard_standard_01", "crown_standard_standard_01"
    pier = "wall_pier_standard_01"
    # One window style per building (two for big ones), like a real facade.
    style = [rnd.choice(upper) for _ in range(2)]
    # Ruins: the top floor is broken along a stretch of the outline (a random arc of panels).
    perimeter = 2 * (nw + nd)
    gap0 = rnd.randrange(perimeter)
    gap = rnd.randint(perimeter // 3, perimeter * 2 // 3) if ruined else 0
    idx = 0
    for start, yaw, count in _sides(w, d):
        for k in range(count):
            broken = ruined and (idx - gap0) % perimeter < gap
            top = floors - 1 if broken else floors
            if broken and rnd.random() < 0.5 and floors > 2:
                top -= 1
            for f in range(top):
                loc = start(k) + Vector((0, 0, f * PANEL))
                if f == 0:
                    name = rnd.choice(ground) if rnd.random() < 0.6 else style[0]
                else:
                    name = style[(k // 2 + f) % len(style)] if fw * fd > 2 else style[0]
                b.panel(name, loc, yaw)
                if k > 0:
                    b.put(pier, loc + _along(yaw, PANEL), yaw)
            b.put(base, start(k), yaw)
            if floors > 1:
                b.put(cornice, start(k) + Vector((0, 0, PANEL)), yaw)
            if not broken:
                b.put(crown, start(k) + Vector((0, 0, floors * PANEL)), yaw)
            idx += 1

    trim = _material(p, kind)
    for cx, cy in ((0, 0), (w, 0), (w, d), (0, d)):
        h = floors * PANEL + (0.6 if not ruined else -rnd.uniform(0, PANEL))
        bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, h / 2))
        c = bpy.context.active_object
        c.scale = (0.45, 0.45, h)
        c.data.materials.append(trim)
        b.objs.append(c)
    roof_h = floors * PANEL + 0.05
    if not ruined:
        bpy.ops.mesh.primitive_plane_add(size=1, location=(w / 2, d / 2, roof_h))
        roof = bpy.context.active_object
        roof.scale = (w - 0.1, d - 0.1, 1)
        roof.data.materials.append(_roof_material())
        b.objs.append(roof)
    # Interior fill so open windows don't show the sky; in ruins, a burnt floor under the open top.
    inner_h = floors * PANEL - 0.1 if not ruined else (floors - 1) * PANEL - 0.3
    bpy.ops.mesh.primitive_cube_add(size=1, location=(w / 2, d / 2, inner_h / 2))
    core = bpy.context.active_object
    core.scale = (w - 0.6, d - 0.6, inner_h)
    core.data.materials.append(_roof_material(0.05 if ruined else 0.1))
    b.objs.append(core)
    debris = []
    if ruined:
        # Broken brick and concrete chunks inside the shell and spilling out of the broken side.
        brick = _brick(p)
        for _ in range(14 + 5 * fw * fd):
            inside = rnd.random() < 0.55
            if inside:
                x, y, z = rnd.uniform(1, w - 1), rnd.uniform(1, d - 1), inner_h
            else:
                t = rnd.uniform(0, 1)
                x, y = (t * w, -rnd.uniform(0.3, 2.2)) if rnd.random() < 0.5 else (w + rnd.uniform(0.3, 2.2), t * d)
                z = 0
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + 0.3))
            c = bpy.context.active_object
            c.scale = (rnd.uniform(0.5, 1.6), rnd.uniform(0.4, 1.2), rnd.uniform(0.3, 0.8))
            c.rotation_euler = (rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, 6.3))
            c.data.materials.append(brick if rnd.random() < 0.6 else _roof_material(0.18))
            b.objs.append(c)

    # Into tile units, centred on the footprint.
    s = (fw - 0.08) / w
    for o in b.objs:
        o.location = (Vector(o.location) - Vector((w / 2, d / 2, 0))) * s
        o.scale = Vector(o.scale) * s
    roof_t = roof_h * s
    if not ruined:
        # Rooftop machinery: air conditioners and ducts.
        for _ in range(rnd.randint(1, 1 + fw * fd)):
            name = rnd.choice(["exterior_aircon_unit", "exterior_aircon_unit", "utility_box_02"])
            o = real.place(name, size=rnd.uniform(0.18, 0.3), x=rnd.uniform(-fw / 2 + 0.25, fw / 2 - 0.25), y=rnd.uniform(-fd / 2 + 0.25, fd / 2 - 0.25), yaw=rnd.choice([0, 1.57]))
            o.location.z += roof_t
            b.objs.append(o)
    else:
        for _ in range(2 + fw * fd):
            t = rnd.uniform(-0.5, 0.5)
            x, y = (t * fw, -fd / 2 - rnd.uniform(0.0, 0.25)) if rnd.random() < 0.5 else (fw / 2 + rnd.uniform(0.0, 0.25), t * fd)
            o = real.place(rnd.choice(["namaqualand_stones_01", "sand_rocks_small_01"]), size=rnd.uniform(0.3, 0.5), x=x, y=y, yaw=rnd.random() * 6.28, tint=(0.25, 0.22, 0.2), tint_amount=0.6)
            b.objs.append(o)
    return b.objs


def _weather(pieces, rnd, ruined):
    """Vary the brick (red, brown, grey-washed) and soot ruins."""
    seen = set()
    tone = rnd.choice([None, (0.32, 0.3, 0.28), (0.4, 0.33, 0.24), (0.2, 0.12, 0.08)])
    for data in pieces.values():
        for m in data.materials:
            if not m or m.name in seen or "glass" in m.name:
                continue
            seen.add(m.name)
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf:
                continue
            amount = (0.35 if tone else 0) + (0.3 if ruined else 0)
            rgb = (0.06, 0.05, 0.045) if ruined and not tone else (tone or (0.06, 0.05, 0.045))
            if amount <= 0:
                continue
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.inputs["Factor"].default_value = min(0.7, amount)
            mix.inputs[7].default_value = (*rgb, 1)
            if bsdf.inputs["Base Color"].is_linked:
                nt.links.new(bsdf.inputs["Base Color"].links[0].from_socket, mix.inputs[6])
            else:
                mix.inputs[6].default_value = bsdf.inputs["Base Color"].default_value
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])


def _brick(pieces):
    for data in pieces.values():
        for m in data.materials:
            if m and ("brick" in m.name or "plaster" in m.name or "objects" in m.name):
                return m
    return next(iter(pieces.values())).materials[0]


def _along(yaw, dist):
    return Vector((-math.cos(yaw) * dist, -math.sin(yaw) * dist, 0))


def _material(pieces, kind):
    """The kit's trim material, for the corner columns."""
    for data in pieces.values():
        for m in data.materials:
            if m and "trim" in m.name:
                return m
    return next(iter(pieces.values())).materials[0]


def _roof_material(shade=0.09):
    name = f"roof_{shade}"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    # Tar and gravel: dark, with a little noise so it doesn't read as a flat card.
    nt = m.node_tree
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (shade * 0.75, shade * 0.73, shade * 0.7, 1)
    ramp.color_ramp.elements[1].color = (shade * 1.35, shade * 1.3, shade * 1.22, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m
