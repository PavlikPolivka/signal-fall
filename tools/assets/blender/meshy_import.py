"""Bring a Meshy model (tools/assets/meshy/models/<id>.glb, compacted) into the sprite pipeline.

The model is turned to face +X (the barrel or the longest reach marks the front), scaled to a
target length, set on the ground, and optionally split into hull and turret with a horizontal cut
around the turret. Magenta panels in the texture become the team mask: grey in the color pass,
white in the mask pass.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(__file__)
# Compact copies (committed, see meshy_compact.py); the full downloads stay in build/meshy/.
MODELS = os.path.normpath(os.path.join(HERE, "..", "meshy", "models"))


def glb_path(sid):
    return os.path.join(MODELS, f"{sid}.glb")


def has_model(sid):
    return os.path.exists(glb_path(sid))


def _import(sid):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path(sid))
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    # One mesh, transforms applied.
    for o in bpy.data.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY" and o not in before:
            bpy.data.objects.remove(o)
    return obj


def _orient(obj, length=None, footprint=None):
    """Face +X, scale (largest size to `length`, or fit the footprint), sit on the ground, centered."""
    vs = [v.co.copy() for v in obj.data.vertices]
    xs = [v.x for v in vs]
    ys = [v.y for v in vs]
    zs = [v.z for v in vs]
    ext_x = max(xs) - min(xs)
    ext_y = max(ys) - min(ys)
    axis = 0 if ext_x >= ext_y else 1
    zmax = max(zs)
    zmin = min(zs)
    # The barrel sticks out high up: the end of the long axis with the farthest high vertex is the front.
    high = [v for v in vs if v.z > zmin + (zmax - zmin) * 0.55]
    lo = min((v[axis] for v in vs))
    hi = max((v[axis] for v in vs))
    mid = (lo + hi) / 2
    reach_hi = max((v[axis] for v in high), default=mid) - mid
    reach_lo = mid - min((v[axis] for v in high), default=mid)
    front_sign = 1 if reach_hi >= reach_lo else -1
    # Rotation that maps the front direction onto +X.
    if axis == 0:
        angle = 0 if front_sign > 0 else math.pi
    else:
        angle = -math.pi / 2 if front_sign > 0 else math.pi / 2
    obj.data.transform(Matrix.Rotation(angle, 4, "Z"))
    vs = [v.co for v in obj.data.vertices]
    cx = (max(v.x for v in vs) + min(v.x for v in vs)) / 2
    cy = (max(v.y for v in vs) + min(v.y for v in vs)) / 2
    z0 = min(v.z for v in vs)
    ex = max(v.x for v in vs) - min(v.x for v in vs)
    ey = max(v.y for v in vs) - min(v.y for v in vs)
    ez = max(v.z for v in vs) - z0
    if footprint:
        s = 0.96 * min(footprint[0] / max(1e-6, ex), footprint[1] / max(1e-6, ey))
    else:
        s = length / max(1e-6, ex, ey, ez * 1.2)
    obj.data.transform(Matrix.Translation(Vector((-cx, -cy, -z0))))
    obj.data.transform(Matrix.Scale(s, 4))
    obj.data.update()


KEYS = {
    # (hue from, hue full, hue full until, hue to): magenta for Holdout and Halcyon, green for Choir.
    "magenta": (0.78, 0.84, 0.985, 1.0),
    # Choir: green through cyan (their accent shards come out either way).
    "green": (0.22, 0.27, 0.52, 0.56),
}
_key = KEYS["magenta"]


def _team_material(src):
    """Wrap a glTF material: magenta in the base color becomes neutral grey (team tint goes on top)."""
    nt = src.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    link = bsdf.inputs["Base Color"].links[0] if bsdf.inputs["Base Color"].is_linked else None
    if link is None:
        return None
    color_src = link.from_socket
    src["mask_from"] = link.from_node.name
    mask = _magenta_mask(nt, color_src)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(mask, mix.inputs["Factor"])
    nt.links.new(color_src, mix.inputs[6])
    mix.inputs[7].default_value = (0.72, 0.72, 0.72, 1)
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return color_src


def _magenta_mask(nt, color_socket):
    """0..1 how magenta a color is (hue ~ 0.83-0.95, saturated, bright)."""
    hsv = nt.nodes.new("ShaderNodeSeparateColor")
    hsv.mode = "HSV"
    nt.links.new(color_socket, hsv.inputs[0])
    k = _key
    hue = nt.nodes.new("ShaderNodeMapRange")
    hue.interpolation_type = "SMOOTHSTEP"
    hue.inputs["From Min"].default_value = k[0]
    hue.inputs["From Max"].default_value = k[1]
    nt.links.new(hsv.outputs[0], hue.inputs["Value"])
    hue_hi = nt.nodes.new("ShaderNodeMapRange")
    hue_hi.interpolation_type = "SMOOTHSTEP"
    hue_hi.inputs["From Min"].default_value = k[3]
    hue_hi.inputs["From Max"].default_value = k[2]
    nt.links.new(hsv.outputs[0], hue_hi.inputs["Value"])
    sat = nt.nodes.new("ShaderNodeMapRange")
    sat.inputs["From Min"].default_value = 0.4
    sat.inputs["From Max"].default_value = 0.6
    nt.links.new(hsv.outputs[1], sat.inputs["Value"])
    val = nt.nodes.new("ShaderNodeMapRange")
    val.inputs["From Min"].default_value = 0.3
    val.inputs["From Max"].default_value = 0.45
    nt.links.new(hsv.outputs[2], val.inputs["Value"])
    m1 = nt.nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    nt.links.new(hue.outputs[0], m1.inputs[0])
    nt.links.new(hue_hi.outputs[0], m1.inputs[1])
    m2 = nt.nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    nt.links.new(m1.outputs[0], m2.inputs[0])
    nt.links.new(sat.outputs[0], m2.inputs[1])
    m3 = nt.nodes.new("ShaderNodeMath")
    m3.operation = "MULTIPLY"
    nt.links.new(m2.outputs[0], m3.inputs[0])
    nt.links.new(val.outputs[0], m3.inputs[1])
    return m3.outputs[0]


def mask_material(src):
    """Mask pass material: white where magenta, black elsewhere (emission, unlit)."""
    m = src.copy()
    m.name = f"{src.name}.mask"
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    del bsdf
    source = nt.nodes[src["mask_from"]]
    mask = _magenta_mask(nt, source.outputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mask, em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def _split(obj, cut_frac, radius_frac):
    """Duplicate into hull (below the cut, or outside the turret circle) and turret (above, inside)."""
    vs = [v.co for v in obj.data.vertices]
    zmax = max(v.z for v in vs)
    zc = zmax * cut_frac
    above = [v for v in vs if v.z > zc]
    # Turret center: the middle of the stuff above the cut, ignoring the barrel (front half of the reach).
    cx = sorted(v.x for v in above)[len(above) // 3] if above else 0.0
    cy = sum(v.y for v in above) / max(1, len(above))
    turret = obj.copy()
    turret.data = obj.data.copy()
    turret.name = "turret"
    bpy.context.scene.collection.objects.link(turret)
    obj.name = "hull"
    r = (max(v.x for v in vs) - min(v.x for v in vs)) * radius_frac

    def keep(o, want_turret):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        drop = []
        for f in bm.faces:
            c = f.calc_center_median()
            in_turret = c.z > zc and (math.hypot(c.x - cx, c.y - cy) < r or c.x > cx)
            if in_turret != want_turret:
                drop.append(f)
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()

    keep(obj, False)
    keep(turret, True)
    return obj, turret


def _cut_rotor(obj, band, radius):
    """Move the faces in a height band (a share of the model's height) and within `radius` of the hub into
    their own object, pivoting on the hub."""
    vs = [v.co for v in obj.data.vertices]
    zmax = max(v.z for v in vs)
    lo, hi = band[0] * zmax, band[1] * zmax
    inside = [v for v in vs if lo <= v.z <= hi]
    # The blades crowd around the hub: the median of the band is the hub, whatever else pokes into it.
    hub = Vector((sorted(v.x for v in inside)[len(inside) // 2], sorted(v.y for v in inside)[len(inside) // 2], (lo + hi) / 2))

    def is_rotor(f):
        c = f.calc_center_median()
        return lo <= c.z <= hi and math.hypot(c.x - hub.x, c.y - hub.y) <= radius
    rotor = obj.copy()
    rotor.data = obj.data.copy()
    rotor.name = "rotor"
    bpy.context.scene.collection.objects.link(rotor)

    def keep(o, want):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if is_rotor(f) != want], context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()

    keep(obj, False)
    keep(rotor, True)
    rotor.data.transform(Matrix.Translation(-hub))
    rotor.location = hub
    # Imported glTF objects rotate by quaternion, which ignores rotation_euler: spin it by Euler angles.
    rotor.rotation_mode = "XYZ"
    reach = max(math.hypot(v.co.x, v.co.y) for v in rotor.data.vertices)
    return rotor, hub, reach


def _blur_disc(hub, reach):
    """A faint dark disc where the blades sweep: reads as a spinning rotor at sprite size."""
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=reach * 0.98, fill_type="NGON", location=hub)
    disc = bpy.context.active_object
    disc.name = "rotor_blur"
    mat = bpy.data.materials.new("rotor_blur")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.03, 0.03, 0.03, 1)
    bsdf.inputs["Alpha"].default_value = 0.16
    bsdf.inputs["Roughness"].default_value = 1.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED"
    else:
        mat.blend_method = "BLEND"
    disc.data.materials.append(mat)
    disc.visible_shadow = False
    return disc


def _tread_links(tracks):
    """Grousers along the outer side of each track's lower run, stepped back one link spacing across the
    "walk" frames: the run on the ground stays put while the hull rolls over it."""
    mat = bpy.data.materials.new("tread")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    # Worn steel: lighter than the dark track, so the moving links read at sprite size.
    bsdf.inputs["Base Color"].default_value = (0.11, 0.105, 0.095, 1)
    bsdf.inputs["Roughness"].default_value = 0.45
    bsdf.inputs["Metallic"].default_value = 0.6
    x0, x1 = tracks["x"]
    z0, z1 = tracks["z"]
    pitch = tracks.get("pitch", 0.1)
    links = []
    for y in tracks["y"]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        link = bpy.context.active_object
        link.scale = (pitch * 0.3, 0.012, z1 - z0)
        bpy.ops.object.transform_apply(scale=True)
        link.data.materials.append(mat)
        arr = link.modifiers.new("links", "ARRAY")
        arr.use_relative_offset = False
        arr.use_constant_offset = True
        arr.constant_offset_displace = (pitch, 0, 0)
        arr.count = max(1, int((x1 - x0) / pitch))
        # Just outside the track face.
        link.location = (x0 + pitch, y + math.copysign(0.01, y), (z0 + z1) / 2)
        link["x0"] = x0 + pitch
        link.name = "tread"
        links.append(link)
    return links, pitch


def load(sid, *, length=None, footprint=None, turret_cut=None, turret_radius=0.3, key="magenta", building=False, turn=0, rotors=None, tracks=None):
    """Import, orient, scale; returns {"hull"/"body": [...], "turret": [...]}.

    turn: degrees to turn the model after import when it guessed the front wrong (180 = it faced backwards,
        90 = its front looked to the side).
    rotors: {"band": [lo, hi], "radius": r, "blades": n}, the height band (share of the model's height) and
        reach around the hub the rotor blades sit in; they become their own part, spun across the "fly" frames, with a blur disc.
    tracks: {"y": [left, right] outer faces, "z": [bottom, top] of the visible lower run, "x": [rear, front],
        "pitch": link spacing}; grousers that crawl along the tracks across the "walk" frames.
    """
    global _key
    _key = KEYS[key]
    obj = _import(sid)
    _orient(obj, length, footprint)
    if turn:
        obj.data.transform(Matrix.Rotation(math.radians(turn), 4, "Z"))
        obj.data.update()
    for slot in obj.material_slots:
        if slot.material:
            _team_material(slot.material)
    part = "body" if building else "hull"
    extra = []
    poses = []
    if rotors:
        rotor, hub, reach = _cut_rotor(obj, rotors["band"], rotors.get("radius", 1.2))
        extra += [rotor, _blur_disc(hub, reach)]
        step = 2 * math.pi / rotors.get("blades", 4)

        def spin(_model, anim, frame):
            count = max(1, POSE_COUNTS.get(anim, 1))
            # One blade spacing across the loop: the last frame leads straight back into the first.
            rotor.rotation_euler = (0, 0, step * frame / count)

        poses.append(spin)
    if tracks:
        links, pitch = _tread_links(tracks)
        extra += links

        def crawl(_model, anim, frame):
            count = max(1, POSE_COUNTS.get(anim, 1))
            shift = -pitch * frame / count if anim == "walk" else 0.0
            for link in links:
                link.location.x = link["x0"] + shift

        poses.append(crawl)

    def pose(model, anim, frame):
        for p in poses:
            p(model, anim, frame)

    out = {part: [obj] + extra, "meshy": True}
    if poses:
        out["pose"] = pose
    if turret_cut is None:
        return out
    hull, turret = _split(obj, turret_cut, turret_radius)
    out[part] = [hull] + extra
    out["turret"] = [turret]
    return out


# --- characters (rigged and animated) -----------------------------------------

# Meshy library clips -> the game's animations, and which moments of each clip become the frames.
CLIP_NAMES = {
    # The gun-ready stance of the walk-and-shoot clip doubles as idle and firing.
    "idle": "Walk_Forward_While_Shooting_inplace",
    "walk": "Walk_Forward_While_Shooting_inplace",
    "fire": "Walk_Forward_While_Shooting_inplace",
    "death": "Shot_and_Fall_Forward",
}


def anim_path(sid):
    return os.path.join(MODELS, f"{sid}.anim.glb")


def has_character(sid):
    return os.path.exists(anim_path(sid))


def _frame_times(anim, count, length):
    if anim == "walk":
        # A loop: evenly spaced, the last frame one step before the first again.
        return [length * f / count for f in range(count)]
    if anim == "death":
        # Ends lying down.
        return [length * (f + 1) / count for f in range(count)]
    if anim == "fire":
        # Three close moments of the gun-ready stride: recoil-like jitter.
        return [length * (0.05 + 0.04 * f) for f in range(count)]
    return [0.0]


# Hand-held prop per weapon: (length, width, height) as a share of the character's height, and color.
WEAPONS = {
    "rifle": ((0.55, 0.03, 0.04), "1f1f1e"),
    "launcher": ((0.7, 0.11, 0.11), "4a5030"),
    "tool": ((0.3, 0.05, 0.05), "6e6e66"),
}


def load_character(sid, *, height=0.42, weapon="rifle", key="magenta"):
    """Import a rigged, animated character; returns parts and a pose(anim, frame) function."""
    global _key
    _key = KEYS[key]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=anim_path(sid))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    meshes = [o for o in new if o.type == "MESH" and o.parent == arm]
    for o in new:
        if o.type == "MESH" and o not in meshes:
            bpy.data.objects.remove(o)
    # Face +X: the head's "headfront" bone shows which way the character looks.
    bpy.context.view_layer.update()
    tall = max(o.dimensions.z for o in meshes)
    pb = arm.pose.bones
    fwd = (arm.matrix_world @ pb["headfront"].head) - (arm.matrix_world @ pb["Head"].head) if "headfront" in pb else Vector((0, -1, 0))
    # The clips animate the armature object itself, so turn and scale a holder above it instead.
    holder = bpy.data.objects.new("holder", None)
    bpy.context.scene.collection.objects.link(holder)
    arm.parent = holder
    holder.rotation_euler = (0, 0, -math.atan2(fwd.y, fwd.x))
    s = height / max(1e-6, tall)
    holder.scale = (s, s, s)
    for o in meshes:
        for slot in o.material_slots:
            if slot.material:
                _team_material(slot.material)
    parts = list(meshes)
    gun = None
    if weapon in WEAPONS:
        import kit

        (gl, gw, gh), color = WEAPONS[weapon]
        mat = kit.material(f"weapon_{weapon}", color, rough=0.6, metal=0.4, style="gritty")
        # Along local +X; placed each frame between the hands (a two-handed hold).
        gun = kit.box(f"weapon_{weapon}", (height * gl, height * gw, height * gh), (0, 0, 0), mat)
        parts.append(gun)

    def place_gun():
        if gun is None:
            return
        bpy.context.view_layer.update()
        rh = arm.matrix_world @ arm.pose.bones["RightHand"].head
        lh = arm.matrix_world @ arm.pose.bones["LeftHand"].head
        # Held at the hands, pointing where the soldier faces (not hand to hand: that line can cross
        # the face), tipped toward the left hand's height.
        fwd = holder.parent.matrix_world.to_quaternion() @ Vector((1, 0, 0)) if holder.parent else Vector((1, 0, 0))
        fwd.z = 0
        fwd.normalize()
        grip = (rh + lh) / 2
        d = (fwd + Vector((0, 0, (lh.z - rh.z) / max(1e-4, height) * 0.5))).normalized()
        center = grip + fwd * (height * 0.12)
        gun.matrix_world = Matrix.Translation(center) @ d.to_track_quat("X", "Z").to_matrix().to_4x4()
    actions = {a.name: a for a in bpy.data.actions}
    arm.animation_data_create()

    def pose(_model, anim, frame):
        clip = actions.get(CLIP_NAMES.get(anim, "Idle")) or actions.get("Idle")
        arm.animation_data.action = clip
        start, end = clip.frame_range
        count = POSE_COUNTS.get(anim, 1)
        t = _frame_times(anim, count, end - start)[min(frame, count - 1)]
        bpy.context.scene.frame_set(int(start + t), subframe=(start + t) % 1)
        place_gun()

    return {"hull": parts, "joints": {"holder": holder}, "meshy": True, "pose": pose}


# Filled by render.py from the unit spec (frames per animation).
POSE_COUNTS = {}


_CFG = None


def build(sid, spec, procedural):
    """The generated (Meshy) model when one exists for this id, else `procedural()`.

    `spec` is the unit or building spec from the faction's models.py (kind, footprint, anims).
    """
    global _CFG
    if _CFG is None:
        import json

        _CFG = json.load(open(os.path.join(HERE, "..", "meshy", "models.json")))["models"]
    entry = _CFG.get(sid, {})
    if entry.get("disabled"):
        return procedural()
    cfg = dict(entry.get("render", {}))
    if spec.get("kind") == "infantry":
        if entry and has_character(sid):
            POSE_COUNTS.clear()
            POSE_COUNTS.update(spec.get("anims", {}))
            if entry.get("faction", "").startswith("choir"):
                cfg.setdefault("key", "green")
            return load_character(sid, **cfg)
        return procedural()
    if entry and has_model(sid):
        POSE_COUNTS.clear()
        POSE_COUNTS.update(spec.get("anims", {}))
        if "footprint" in spec:
            cfg.setdefault("footprint", spec["footprint"])
            cfg["building"] = True
        if entry.get("faction") == "choir":
            cfg.setdefault("key", "green")
        return load(sid, **cfg)
    return procedural()
