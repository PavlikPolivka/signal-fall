"""Shrink a Meshy GLB for the repo: about 40k triangles, 1024 px JPEG textures, Draco mesh compression.

blender -b --factory-startup -P tools/assets/blender/meshy_compact.py -- <in.glb> <out.glb>

The originals (tens of MB, 2K textures) stay in tools/assets/build/meshy/; sprites are 100-300 px,
so the compact copy (committed under tools/assets/meshy/models/) renders the same.
"""
import sys

import bpy

import os

TARGET_TRIS = int(os.environ.get("SF_TRIS", 40000))
TEXTURE_PX = int(os.environ.get("SF_TEXTURE", 1024))

src, dst = sys.argv[sys.argv.index("--") + 1 :][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
rigged = any(o.type == "ARMATURE" for o in bpy.data.objects)
for o in bpy.data.objects:
    # Rigged characters were remeshed by Meshy already; decimating would break the skinning.
    if o.type != "MESH" or rigged:
        continue
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > TARGET_TRIS:
        mod = o.modifiers.new("decimate", "DECIMATE")
        mod.ratio = TARGET_TRIS / tris
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
for img in bpy.data.images:
    if img.size[0] > TEXTURE_PX:
        img.scale(TEXTURE_PX, TEXTURE_PX)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=85,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_animations=True,
)
print("COMPACT", dst)
