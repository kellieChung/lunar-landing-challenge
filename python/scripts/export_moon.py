"""Export the low-poly moon mesh from a .blend file to a GLB for the web globe.

Runs inside Blender (not the project venv):

    /Applications/Blender.app/Contents/MacOS/Blender -b path/to/moon.blend \
        --factory-startup --python python/scripts/export_moon.py -- \
        --out web/public/models/moon.glb [--object Icosphere] [--keep-uv]

The .blend file is never saved or modified; recentering happens in memory only.

Axis convention (matters if you paint the mesh):
    Blender +Z = lunar north pole, -Z = south pole
    Blender +X = longitude 0 (the side that faces Earth)
    Blender +Y = longitude 90 deg E
This matches the MOON_ME body-fixed frame. The web app places pins with
web/src/globe/coords.ts using the same convention (after glTF's Y-up swap).
"""

import argparse
import sys

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Export the moon mesh to GLB.")
    parser.add_argument("--out", required=True, help="output .glb path")
    parser.add_argument("--object", default="Icosphere", help="mesh object name")
    parser.add_argument("--keep-uv", action="store_true",
                        help="keep UVs (only needed once the mesh is painted/textured)")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    obj = bpy.data.objects.get(args.object)
    if obj is None or obj.type != "MESH":
        raise SystemExit(f"No mesh object named '{args.object}' in this file.")

    # Center the geometry on its vertex centroid, then put the object at the origin,
    # so lat/lon directions from (0, 0, 0) point at the right part of the surface.
    mesh = obj.data
    centroid = sum((v.co for v in mesh.vertices), Vector()) / len(mesh.vertices)
    for v in mesh.vertices:
        v.co -= centroid
    obj.location = (0.0, 0.0, 0.0)
    obj.rotation_euler = (0.0, 0.0, 0.0)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="NONE",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # The web app flat-shades and computes its own normals; skipping normals
        # and UVs keeps shared vertices shared (~8x smaller file).
        export_normals=False,
        export_texcoords=args.keep_uv,
    )
    print(f"wrote {args.out} ({len(mesh.vertices)} verts)")


main()
