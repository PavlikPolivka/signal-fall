"""Shared Blender helpers for Signal Fall sprites.

Run inside Blender (blender -b -P ...). Builds models from primitives, sets up
the fixed isometric camera and lighting, and renders color / team-mask passes.
"""
import math

import bpy
from mathutils import Vector

# 2:1 dimetric: camera 30 degrees above the ground, 45 degrees around.
ELEVATION = math.radians(30)
AZIMUTH = math.radians(45)

# Faction palettes (linear-ish sRGB hex).
PALETTES = {
    "holdout": {
        "olive": "6b7240",
        "olive_dark": "4a5030",
        "rust": "8a4b2a",
        "steel": "5e6366",
        "steel_dark": "36393b",
        "rubber": "1d1d1c",
        "concrete": "8d8a80",
        "glass": "e8c35a",
    },
}

# Team color placeholder: a neutral mid grey in the color pass, tinted at runtime via the mask.
TEAM_NEUTRAL = "9a9a9a"


def hex_rgba(h, alpha=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, alpha)


def reset():
    global _mask_black, _mask_white
    _mask_black = _mask_white = None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = hex_rgba("b8c4d0")
    bg.inputs[1].default_value = 0.55
    return scene


_materials = {}


def saturate(rgba, amount):
    r, g, b, a = rgba
    grey = (r + g + b) / 3
    return tuple(max(0.0, grey + (c - grey) * amount) for c in (r, g, b)) + (a,)


def material(name, color, *, rough=0.8, metal=0.0, emission=None, style="clean"):
    """Flat material. style 'toon' adds banded shading via Shader-to-RGB + ramp."""
    key = (name, color, style)
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(f"{name}.{style}")
    m.use_nodes = True
    nt = m.node_tree
    nodes = nt.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = hex_rgba(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emission:
        bsdf.inputs["Emission Color"].default_value = hex_rgba(emission)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    if style == "gritty" and not emission:
        # Grime: large-scale noise darkens the base color in patches; fine noise adds roughness variation.
        coord = nodes.new("ShaderNodeTexCoord")
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 9.0
        noise.inputs["Detail"].default_value = 6.0
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[0].color = (0.45, 0.42, 0.38, 1)
        ramp.color_ramp.elements[1].position = 0.65
        ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = hex_rgba(color)
        nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
        nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = min(1.0, rough + 0.1)
    if style == "sleek" and not emission:
        # Manufactured surfaces: almost flat, a faint large-scale tone shift so big panels don't look plastic.
        coord = nodes.new("ShaderNodeTexCoord")
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 3.0
        noise.inputs["Detail"].default_value = 2.0
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.9, 0.91, 0.93, 1)
        ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = hex_rgba(color)
        nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
        nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        bsdf.inputs["Coat Weight"].default_value = 0.3
    if style == "toon":
        # Diffuse lighting quantized into 3 bands, multiplied over the base color.
        diff = nodes.new("ShaderNodeBsdfDiffuse")
        diff.inputs["Color"].default_value = (1, 1, 1, 1)
        to_rgb = nodes.new("ShaderNodeShaderToRGB")
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        els = ramp.color_ramp.elements
        els[0].position = 0.0
        els[0].color = (0.30, 0.30, 0.38, 1)
        els[1].position = 0.15
        els[1].color = (0.68, 0.66, 0.70, 1)
        e3 = els.new(0.5)
        e3.color = (1.12, 1.08, 1.0, 1)
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = saturate(hex_rgba(color), 1.25)
        emit = nodes.new("ShaderNodeEmission")
        nt.links.new(diff.outputs[0], to_rgb.inputs[0])
        nt.links.new(to_rgb.outputs[0], ramp.inputs[0])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        if emission:
            emit.inputs["Color"].default_value = hex_rgba(emission)
            emit.inputs["Strength"].default_value = 2.0
        else:
            nt.links.new(mix.outputs[2], emit.inputs["Color"])
        nt.links.new(emit.outputs[0], out.inputs[0])
    else:
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    _materials[key] = m
    return m


def _finish(obj, mat, bevel=0.0, segments=2):
    if mat is not None:
        obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def box(name, size, loc, mat, *, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, mat, bevel)


def cylinder(name, radius, depth, loc, mat, *, rot=(0, 0, 0), verts=16, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    return _finish(o, mat, bevel, segments=1)


def cone(name, r1, r2, depth, loc, mat, *, rot=(0, 0, 0), verts=6):
    """Cone or frustum (r2 > 0); crystals and spires."""
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    return _finish(o, mat)


def hexprism(name, radius, depth, loc, mat, *, rot=(0, 0, 0), bevel=0.0):
    """Hexagonal prism (Halcyon panels and nodes)."""
    return cylinder(name, radius, depth, loc, mat, rot=rot, verts=6, bevel=bevel)


def wedge(name, size, loc, mat, *, rot=(0, 0, 0), taper=0.6):
    """Box whose top face is shrunk along X: sloped armor plates."""
    o = box(name, size, loc, mat, rot=rot)
    for v in o.data.vertices:
        if v.co.z > 0:
            v.co.x *= taper
    return o


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def camera_and_light(target_height, ortho_scale):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    dist = 40
    # Looking from the south-west-ish corner so the sprite reads like the game's iso grid.
    dx = math.cos(ELEVATION) * math.cos(AZIMUTH) * dist
    dy = -math.cos(ELEVATION) * math.sin(AZIMUTH) * dist
    dz = math.sin(ELEVATION) * dist
    cam.location = Vector((dx, dy, dz + target_height))
    direction = Vector((0, 0, target_height)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(-12), math.radians(-30))
    scene.collection.objects.link(sun)
    return cam


def shadow_catcher(size=12):
    """Ground plane that only shows shadows (EEVEE: holdout via shadow-only material)."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    plane = bpy.context.active_object
    m = bpy.data.materials.new("shadow")
    m.use_nodes = True
    nt = m.node_tree
    nodes = nt.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    diff = nodes.new("ShaderNodeBsdfDiffuse")
    to_rgb = nodes.new("ShaderNodeShaderToRGB")
    transp = nodes.new("ShaderNodeBsdfTransparent")
    black = nodes.new("ShaderNodeEmission")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    mix = nodes.new("ShaderNodeMixShader")
    nt.links.new(diff.outputs[0], to_rgb.inputs[0])
    # Brightness -> shadow strength: fully lit ground (bright) contributes nothing,
    # only clearly shaded ground becomes shadow. Max opacity 50%.
    bw = nodes.new("ShaderNodeRGBToBW")
    rng = nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = 0.08
    rng.inputs["From Max"].default_value = 0.35
    rng.inputs["To Min"].default_value = 0.5
    rng.inputs["To Max"].default_value = 0.0
    rng.clamp = True
    nt.links.new(to_rgb.outputs[0], bw.inputs[0])
    nt.links.new(bw.outputs[0], rng.inputs["Value"])
    nt.links.new(rng.outputs[0], mix.inputs[0])
    nt.links.new(transp.outputs[0], mix.inputs[1])
    nt.links.new(black.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    m.surface_render_method = "BLENDED"
    plane.data.materials.append(m)
    return plane


def outline(thickness=1.6, color=(0.05, 0.05, 0.06)):
    scene = bpy.context.scene
    scene.render.use_freestyle = True
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = thickness
    fs = bpy.context.view_layer.freestyle_settings
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("ink")
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new("ink")
    ls.select_by_visibility = True
    ls.select_by_edge_types = True
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.linestyle.color = color


def render(path, size_px, samples=32):
    scene = bpy.context.scene
    scene.render.resolution_x = size_px
    scene.render.resolution_y = size_px
    scene.eevee.taa_render_samples = samples
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# --- terrain for dioramas ---

GROUND = {
    "wasteland": ("6b5c3e", "4e4330"),
    "city": ("55575a", "3f4043"),
    "crystal": ("3f5544", "2c3d31"),
}


def ground(size, style, biome="wasteland"):
    """Ground plane with two-tone noise (patchy dirt / rubble / moss)."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    plane = bpy.context.active_object
    a, b = GROUND[biome]
    m = bpy.data.materials.new(f"ground.{style}")
    m.use_nodes = True
    nt = m.node_tree
    nodes = nt.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    coord = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.6 if style != "gritty" else 1.4
    noise.inputs["Detail"].default_value = 2.0 if style == "clean" else 8.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT" if style == "toon" else "LINEAR"
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[0].color = hex_rgba(b)
    ramp.color_ramp.elements[1].position = 0.58
    ramp.color_ramp.elements[1].color = hex_rgba(a)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    plane.data.materials.append(m)
    return plane


def rock(loc, scale, style, seed=0):
    import random

    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=loc)
    o = bpy.context.active_object
    for v in o.data.vertices:
        v.co *= 0.75 + rnd.random() * 0.5
    o.scale = (scale, scale * (0.8 + rnd.random() * 0.4), scale * 0.7)
    o.rotation_euler = (0, 0, rnd.random() * 6.28)
    return _finish(o, material("rock", "7a756c", style=style))


def crystals(loc, count, style, seed=0, spread=0.9):
    import random

    rnd = random.Random(seed)
    m = material("echo", "3ee6ff", rough=0.2, emission="1fb8d6", style=style)
    objs = []
    for i in range(count):
        # Clustered: denser and taller toward the middle of the field.
        r = spread * (rnd.random() ** 0.7)
        a = rnd.random() * 6.283
        x = loc[0] + r * math.cos(a)
        y = loc[1] + r * math.sin(a)
        h = rnd.uniform(0.2, 0.75) * (1.2 - r / spread * 0.6)
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=rnd.uniform(0.06, 0.12), radius2=0.0, depth=h, location=(x, y, h / 2))
        o = bpy.context.active_object
        o.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.random() * 6.28)
        objs.append(_finish(o, m))
    return objs


# --- sprite rendering -------------------------------------------------------

# A 1x1 tile is a 64x32 px diamond: one metre across the view is 64/sqrt(2) px.
PX_PER_M = 64 / math.sqrt(2)
# Sprites render at 2x and get downsampled by the packer.
SUPERSAMPLE = 2


def setup_sprite_camera(frame_px):
    """Camera aimed at the ground origin; frame_px is the final (1x) square sprite size."""
    cam = camera_and_light(0.0, frame_px / PX_PER_M)
    rim = bpy.data.lights.new("rim", "SUN")
    rim.energy = 1.6
    rim.color = (0.75, 0.85, 1.0)
    o = bpy.data.objects.new("rim", rim)
    o.rotation_euler = (math.radians(70), 0, math.radians(150))
    bpy.context.scene.collection.objects.link(o)
    world = bpy.data.worlds["World"].node_tree.nodes["Background"]
    world.inputs[1].default_value = 0.3
    bpy.data.lights["sun"].energy = 4.6
    return cam


_mask_black = None
_mask_white = None


def _mask_materials():
    global _mask_black, _mask_white
    if _mask_black is None:
        def emit(name, rgb):
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            nt = m.node_tree
            nt.nodes.clear()
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Color"].default_value = (*rgb, 1)
            nt.links.new(em.outputs[0], out.inputs[0])
            return m
        _mask_black = emit("mask_black", (0, 0, 0))
        _mask_white = emit("mask_white", (1, 1, 1))
    return _mask_black, _mask_white


def render_passes(objects, catcher, path_prefix, frame_px, samples=24, shadow=True):
    """Render color, team mask and shadow passes of `objects` to <prefix>.{color,mask,shadow}.png.

    color:  the model lit, transparent background, no ground shadow
    mask:   white where team-colored, black elsewhere (alpha = model coverage)
    shadow: only the shadow the model casts on the ground
    """
    scene = bpy.context.scene
    size = frame_px * SUPERSAMPLE
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.eevee.taa_render_samples = samples
    scene.render.film_transparent = True

    def go(suffix):
        scene.render.filepath = f"{path_prefix}.{suffix}.png"
        bpy.ops.render.render(write_still=True)

    # color
    catcher.hide_render = True
    go("color")
    # mask: swap materials per slot, then restore
    black, white = _mask_materials()
    saved = []
    for o in objects:
        for slot in o.material_slots:
            saved.append((slot, slot.material))
            is_team = slot.material is not None and slot.material.name.startswith("team")
            slot.material = white if is_team else black
    world = scene.world.node_tree.nodes["Background"]
    strength = world.inputs[1].default_value
    world.inputs[1].default_value = 0.0
    go("mask")
    world.inputs[1].default_value = strength
    for slot, mat in saved:
        slot.material = mat
    if not shadow:
        return
    # shadow: model invisible to the camera but still casting
    catcher.hide_render = False
    for o in objects:
        o.visible_camera = False
    go("shadow")
    for o in objects:
        o.visible_camera = True
    catcher.hide_render = True


def sim_yaw(direction, count):
    """Blender Z rotation for sprite direction index (0 = sim +x, increasing toward sim +y)."""
    return -2 * math.pi * direction / count


# --- part helpers -----------------------------------------------------------


def wheels(n, x0, x1, y, z, r, mat, width=0.08):
    out = []
    for i in range(n):
        x = x0 + (x1 - x0) * i / max(1, n - 1)
        out.append(cylinder("wheel", r, width, (x, y, z), mat, rot=(math.pi / 2, 0, 0), verts=12))
    return out


def track(length, y, z, h, w, rubber, wheel_mat, n=5):
    out = [box("track", (length, w, h), (0, y, z), rubber, bevel=min(h, w) * 0.3)]
    out += wheels(n, -length / 2 + 0.12, length / 2 - 0.12, y + (w / 2 + 0.01) * (1 if y > 0 else -1), z, h * 0.38, wheel_mat, 0.04)
    return out


def sandbags(x0, y0, x1, y1, z, mat, h=0.12, thick=0.14):
    """A row of sandbags along a segment (two courses)."""
    out = []
    length = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(length / 0.22))
    ang = math.atan2(y1 - y0, x1 - x0)
    for course in range(2):
        for i in range(n - course):
            t = (i + 0.5 + course * 0.5) / n
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            o = box("bag", (0.2, thick, h), (x, y, z + h / 2 + course * h * 0.9), mat, rot=(0, 0, ang), bevel=0.04)
            out.append(o)
    return out


def lattice_tower(x, y, height, base, mat, levels=6):
    """Four-legged steel lattice tower."""
    out = []
    top = base * 0.3
    for sx in (-1, 1):
        for sy in (-1, 1):
            p0 = Vector((x + sx * base / 2, y + sy * base / 2, 0))
            p1 = Vector((x + sx * top / 2, y + sy * top / 2, height))
            out.append(strut(p0, p1, 0.025, mat))
    for i in range(1, levels + 1):
        z = height * i / levels
        w = base + (top - base) * i / levels
        for (ax, ay, bx, by) in ((-1, -1, 1, -1), (1, -1, 1, 1), (1, 1, -1, 1), (-1, 1, -1, -1)):
            out.append(strut(Vector((x + ax * w / 2, y + ay * w / 2, z)), Vector((x + bx * w / 2, y + by * w / 2, z)), 0.015, mat))
    return out


def strut(p0, p1, r, mat):
    d = p1 - p0
    mid = (p0 + p1) / 2
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=mid, vertices=6)
    o = bpy.context.active_object
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return _finish(o, mat)


def crates(x, y, mat, n=3, seed=0):
    import random

    rnd = random.Random(seed)
    out = []
    for i in range(n):
        s = rnd.uniform(0.14, 0.22)
        out.append(box("crate", (s, s, s), (x + rnd.uniform(-0.2, 0.2), y + rnd.uniform(-0.2, 0.2), s / 2 + (0.0 if i < 2 else 0.2)), mat, rot=(0, 0, rnd.random()), bevel=0.015))
    return out


def scaffold(w, d, h, mat):
    """Scaffolding poles + planks around a footprint (construction state)."""
    out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append(cylinder("pole", 0.025, h, (sx * w / 2, sy * d / 2, h / 2), mat, verts=6))
    for z in (h * 0.35, h * 0.7):
        out.append(box("plank", (w, 0.06, 0.03), (0, -d / 2, z), mat))
        out.append(box("plank", (0.06, d, 0.03), (w / 2, 0, z), mat))
    return out


def root(name="root"):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    return o


def parent(objs, to):
    for o in objs:
        o.parent = to
    return objs
