"""Build an optimized 3D Moon GLB with clean poles and natural topography.

Features:
- High-performance mesh: 360 x 180 UV sphere (65,341 vertices, 128,880 triangles), uses uint16 indices.
- Global elevation: sampled from the NASA LRO 8k topography dataset.
- South Pole elevation: sampled directly from the NASA LOLA 240 m/pixel south-pole DEM (LDEM_60S_240MPP_ADJ.TIF).
- Natural vertical height enhancement: 3.0x multiplier so craters and massifs catch grazing light distinctly without warping the sphere.
- Clean poles:
  - Pole vertex normals point strictly along [0, 1, 0] (north) and [0, -1, 0] (south).
  - Polar apex texture smoothly blends into the mean polar regolith color, eliminating radial starburst/pinwheel artifacts.
- Embedded high-quality NASA color texture (2048 x 1024 JPEG).
- Output file size: ~3.35 MB (down from 313 MB, a ~94x reduction!).
"""

import argparse
import json
import struct
import time
from pathlib import Path
import numpy as np
import rasterio

from lunar.dem import polar_stereo_xy

ROOT = Path(__file__).resolve().parents[2]
INPUT_GLB = ROOT / "python" / "data" / "Moon_NASA_LRO_8k_Topo.glb"
DEM_PATH = ROOT / "python" / "data" / "dem" / "LDEM_60S_240MPP_ADJ.TIF"
OUTPUT_GLB = ROOT / "web" / "public" / "models" / "moon.glb"


def build_global_elevation_grid(glb_path: Path, width: int = 1024, height: int = 512) -> np.ndarray:
    """Extract a 2D global relative elevation grid from the NASA 8k topography GLB."""
    print("Reading NASA 8k topography GLB...")
    with open(glb_path, "rb") as f:
        magic, ver, length = struct.unpack_from("<4sII", f.read(12), 0)
        chunk0_len, _ = struct.unpack_from("<I4s", f.read(8), 0)
        gltf = json.loads(f.read(chunk0_len).decode("utf-8"))
        bin_start = 20 + chunk0_len + 8

        pos_acc = gltf["accessors"][0]
        pos_bv = gltf["bufferViews"][pos_acc["bufferView"]]
        f.seek(bin_start + pos_bv.get("byteOffset", 0))
        n_verts = pos_acc["count"]
        pos = np.fromfile(f, dtype=np.float32, count=n_verts * 3).reshape(-1, 3)

        uv_acc = gltf["accessors"][2]
        uv_bv = gltf["bufferViews"][uv_acc["bufferView"]]
        f.seek(bin_start + uv_bv.get("byteOffset", 0))
        uvs = np.fromfile(f, dtype=np.float32, count=uv_acc["count"] * 2).reshape(-1, 2)

    r = np.linalg.norm(pos, axis=1)
    r_mean = float(np.mean(r))
    rel = (r - r_mean) / r_mean

    u_col = np.clip((uvs[:, 0] * (width - 1)).astype(int), 0, width - 1)
    v_row = np.clip((uvs[:, 1] * (height - 1)).astype(int), 0, height - 1)

    grid_sum = np.zeros((height, width), dtype=np.float32)
    grid_count = np.zeros((height, width), dtype=np.int32)
    flat_idx = v_row * width + u_col
    np.add.at(grid_sum.ravel(), flat_idx, rel)
    np.add.at(grid_count.ravel(), flat_idx, 1)

    valid = grid_count > 0
    elev_grid = np.zeros((height, width), dtype=np.float32)
    elev_grid[valid] = grid_sum[valid] / grid_count[valid]

    # Fill any sparse unbinned pixels with periodic row interpolation
    for row in range(height):
        r_valid = valid[row]
        if not np.all(r_valid) and np.any(r_valid):
            x = np.where(r_valid)[0]
            y = elev_grid[row, x]
            elev_grid[row] = np.interp(np.arange(width), x, y, period=width)
        elif not np.any(r_valid):
            elev_grid[row] = elev_grid[max(0, row - 1)]

    return elev_grid


def sample_south_pole_dem(dem_path: Path, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Sample LOLA south pole DEM onto equirectangular lat/lon grid for lat <= -58 deg."""
    lats = np.linspace(90, -90, height)
    lons = np.linspace(-180, 180, width)
    south_idx = np.where(lats <= -58.0)[0]
    lat_sub = lats[south_idx]

    lat_grid, lon_grid = np.meshgrid(lat_sub, lons, indexing="ij")
    xs, ys = polar_stereo_xy(lat_grid, lon_grid)

    with rasterio.open(dem_path) as ds:
        inv_t = ~ds.transform
        cols, rows = inv_t * (xs, ys)
        cols = np.clip(np.round(cols).astype(int), 0, ds.width - 1)
        rows = np.clip(np.round(rows).astype(int), 0, ds.height - 1)
        dem = ds.read(1)
        dem_sub = dem[rows, cols]

    # Reference radius 1737.4 km -> relative radial delta
    rel_south = dem_sub.astype(np.float32) / 1737400.0
    return south_idx, rel_south


def extract_and_clean_texture(
    glb_path: Path,
    out_width: int = 2048,
    out_height: int = 1024,
) -> bytes:
    """Extract embedded NASA texture, downsample, and smooth the polar singularities."""
    print("Extracting embedded NASA texture...")
    with open(glb_path, "rb") as f:
        magic, ver, length = struct.unpack_from("<4sII", f.read(12), 0)
        chunk0_len, _ = struct.unpack_from("<I4s", f.read(8), 0)
        gltf = json.loads(f.read(chunk0_len).decode("utf-8"))
        bin_start = 20 + chunk0_len + 8

        img = gltf["images"][0]
        bv = gltf["bufferViews"][img["bufferView"]]
        f.seek(bin_start + bv.get("byteOffset", 0))
        img_bytes = f.read(bv["byteLength"])

    with rasterio.io.MemoryFile(img_bytes) as memfile:
        with memfile.open() as ds:
            data = ds.read(
                out_shape=(ds.count, out_height, out_width),
                resampling=rasterio.enums.Resampling.bilinear,
            ).astype(np.float32)

    # South Pole smoothing:
    # Blend smoothly starting at lat = -86.5 deg down to -88.5 deg.
    # From lat = -88.5 deg down to -90.0 deg (the bottom rows),
    # the color is clamped to the exact uniform mean polar color across all 360 longitudes.
    r_sp_blend_start = int(out_height * 176.5 / 180)  # ~lat -86.5 deg
    r_sp_clamp_start = int(out_height * 178.5 / 180)  # ~lat -88.5 deg
    mean_sp = np.mean(data[:, r_sp_clamp_start:, :], axis=(1, 2), keepdims=True)

    n_blend = r_sp_clamp_start - r_sp_blend_start
    blend_weights = np.linspace(0.0, 1.0, n_blend)[None, :, None] ** 2.0
    data[:, r_sp_blend_start:r_sp_clamp_start, :] = (
        (1.0 - blend_weights) * data[:, r_sp_blend_start:r_sp_clamp_start, :]
        + blend_weights * mean_sp
    )
    data[:, r_sp_clamp_start:, :] = mean_sp

    # North Pole smoothing:
    r_np_clamp_end = int(out_height * 1.5 / 180)   # ~lat +88.5 deg
    r_np_blend_end = int(out_height * 3.5 / 180)   # ~lat +86.5 deg
    mean_np = np.mean(data[:, :r_np_clamp_end, :], axis=(1, 2), keepdims=True)

    n_np_blend = r_np_blend_end - r_np_clamp_end
    blend_np = np.linspace(1.0, 0.0, n_np_blend)[None, :, None] ** 2.0
    data[:, r_np_clamp_end:r_np_blend_end, :] = (
        blend_np * mean_np + (1.0 - blend_np) * data[:, r_np_clamp_end:r_np_blend_end, :]
    )
    data[:, :r_np_clamp_end, :] = mean_np

    data_uint8 = np.clip(data, 0, 255).astype(np.uint8)

    # Encode as JPEG
    with rasterio.io.MemoryFile() as out_memfile:
        meta = {
            "driver": "JPEG",
            "height": out_height,
            "width": out_width,
            "count": 3,
            "dtype": "uint8",
            "quality": 88,
        }
        with out_memfile.open(**meta) as dst:
            dst.write(data_uint8)
        jpeg_bytes = out_memfile.read()

    print(f"Generated clean {out_width}x{out_height} texture ({len(jpeg_bytes)/1024:.1f} KB).")
    return jpeg_bytes


def build_mesh(
    elev_grid: np.ndarray,
    n_lon: int = 360,
    n_lat: int = 180,
    multiplier: float = 3.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Generate UV sphere mesh with natural topography and smooth normals."""
    grid_h, grid_w = elev_grid.shape

    lats = np.linspace(90, -90, n_lat + 1)
    lons = np.linspace(-180, 180, n_lon + 1)

    phi = np.radians(lats)
    lam = np.radians(lons)

    # Unit sphere positions:
    # +Y = North Pole, -Y = South Pole, +X = lon 0, -Z = lon 90E
    cos_phi = np.cos(phi)[:, None]
    sin_phi = np.sin(phi)[:, None]
    cos_lam = np.cos(lam)[None, :]
    sin_lam = np.sin(lam)[None, :]

    ux = cos_phi * cos_lam
    uy = np.repeat(sin_phi, n_lon + 1, axis=1)
    uz = -cos_phi * sin_lam

    # Sample elevation grid
    v_coords = np.linspace(0, grid_h - 1, n_lat + 1)
    u_coords = np.linspace(0, grid_w - 1, n_lon + 1)

    v_idx = np.clip(np.round(v_coords).astype(int), 0, grid_h - 1)
    u_idx = np.clip(np.round(u_coords).astype(int), 0, grid_w - 1)
    elev_sampled = elev_grid[v_idx[:, None], u_idx[None, :]]

    # Ensure global mean of sampled elevation is zero so mean radius is strictly 1.00000
    elev_sampled -= float(np.mean(elev_sampled))

    # Mean radius = 1.0, vertical enhancement applied
    r = 1.0 + multiplier * elev_sampled

    # Ensure exact single polar radii at apexes
    r[0, :] = float(np.mean(r[0, :]))
    r[-1, :] = float(np.mean(r[-1, :]))

    pos = np.stack([ux * r, uy * r, uz * r], axis=-1)  # (n_lat + 1, n_lon + 1, 3)

    # UVs: U in [0, 1] from lon -180 to 180, V in [0, 1] from lat 90 to -90
    u_grid, v_grid = np.meshgrid(np.linspace(0, 1, n_lon + 1), np.linspace(0, 1, n_lat + 1))
    uvs = np.stack([u_grid, v_grid], axis=-1).astype(np.float32)

    # Flatten vertices
    n_verts = (n_lat + 1) * (n_lon + 1)
    pos_flat = pos.reshape(-1, 3).astype(np.float32)
    uvs_flat = uvs.reshape(-1, 2).astype(np.float32)

    # Build triangles
    indices = []
    w = n_lon + 1

    # North pole cap (j = 0)
    for i in range(n_lon):
        v_top = i
        v_bl = w + i
        v_br = w + i + 1
        indices.append([v_top, v_bl, v_br])

    # Body quads (j = 1 to n_lat - 2)
    for j in range(1, n_lat - 1):
        for i in range(n_lon):
            v0 = j * w + i
            v1 = (j + 1) * w + i
            v2 = j * w + (i + 1)
            v3 = (j + 1) * w + (i + 1)
            indices.append([v0, v1, v2])
            indices.append([v2, v1, v3])

    # South pole cap (j = n_lat - 1)
    for i in range(n_lon):
        v_tl = (n_lat - 1) * w + i
        v_tr = (n_lat - 1) * w + i + 1
        v_bot = n_lat * w + i
        indices.append([v_tl, v_bot, v_tr])

    indices_arr = np.array(indices, dtype=np.uint16)

    # Compute area-weighted vertex normals
    v0 = pos_flat[indices_arr[:, 0]]
    v1 = pos_flat[indices_arr[:, 1]]
    v2 = pos_flat[indices_arr[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)

    vert_normals = np.zeros((n_verts, 3), dtype=np.float32)
    np.add.at(vert_normals, indices_arr[:, 0], face_normals)
    np.add.at(vert_normals, indices_arr[:, 1], face_normals)
    np.add.at(vert_normals, indices_arr[:, 2], face_normals)

    # Weld antimeridian seam (lon -180 and lon +180 share identical normals)
    for j in range(n_lat + 1):
        idx_left = j * w
        idx_right = j * w + n_lon
        n_seam = vert_normals[idx_left] + vert_normals[idx_right]
        vert_normals[idx_left] = n_seam
        vert_normals[idx_right] = n_seam

    # Smooth South Pole normals:
    for j in range(n_lat + 1):
        lat_deg = lats[j]
        if lat_deg <= -89.9:
            vert_normals[j * w : (j + 1) * w] = np.array([0.0, -1.0, 0.0], dtype=np.float32)
        elif lat_deg < -85.0:
            weight = float(((lat_deg - (-85.0)) / (-90.0 - (-85.0))) ** 1.5)
            target = np.array([0.0, -1.0, 0.0], dtype=np.float32)
            for i in range(w):
                idx = j * w + i
                vert_normals[idx] = (1.0 - weight) * vert_normals[idx] + weight * target
        elif lat_deg >= 89.9:
            vert_normals[j * w : (j + 1) * w] = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        elif lat_deg > 85.0:
            weight = float(((lat_deg - 85.0) / (90.0 - 85.0)) ** 1.5)
            target = np.array([0.0, 1.0, 0.0], dtype=np.float32)
            for i in range(w):
                idx = j * w + i
                vert_normals[idx] = (1.0 - weight) * vert_normals[idx] + weight * target

    # Normalize normals
    norm_lens = np.linalg.norm(vert_normals, axis=1, keepdims=True)
    norm_lens[norm_lens == 0] = 1.0
    vert_normals /= norm_lens

    return pos_flat, vert_normals, uvs_flat, indices_arr.ravel()


def assemble_glb(
    pos: np.ndarray,
    normals: np.ndarray,
    uvs: np.ndarray,
    indices: np.ndarray,
    jpeg_bytes: bytes,
    out_path: Path,
) -> None:
    """Pack mesh attributes, indices, and texture into standard binary glTF 2.0."""
    pos_bytes = pos.tobytes()
    norm_bytes = normals.tobytes()
    uv_bytes = uvs.tobytes()
    idx_bytes = indices.tobytes()

    def pad4(b: bytes) -> bytes:
        pad = (4 - (len(b) % 4)) % 4
        return b + b"\x00" * pad

    padded_pos = pad4(pos_bytes)
    padded_norm = pad4(norm_bytes)
    padded_uv = pad4(uv_bytes)
    padded_idx = pad4(idx_bytes)
    padded_img = pad4(jpeg_bytes)

    offset_pos = 0
    offset_norm = offset_pos + len(padded_pos)
    offset_uv = offset_norm + len(padded_norm)
    offset_idx = offset_uv + len(padded_uv)
    offset_img = offset_idx + len(padded_idx)

    bin_data = padded_pos + padded_norm + padded_uv + padded_idx + padded_img
    total_bin_len = len(bin_data)

    n_verts = len(pos)
    n_indices = len(indices)

    gltf = {
        "asset": {"version": "2.0", "generator": "LunarNavigator-TopoBuilder"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "Moon"}],
        "materials": [
            {
                "name": "MoonSurface",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.94,
                },
                "doubleSided": False,
            }
        ],
        "textures": [{"sampler": 0, "source": 0}],
        "images": [{"bufferView": 4, "mimeType": "image/jpeg", "name": "MoonColor"}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 33071}],
        "meshes": [
            {
                "name": "Sphere",
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": 0,
                            "NORMAL": 1,
                            "TEXCOORD_0": 2,
                        },
                        "indices": 3,
                        "material": 0,
                    }
                ],
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,  # FLOAT
                "count": n_verts,
                "type": "VEC3",
                "min": [float(x) for x in pos.min(axis=0)],
                "max": [float(x) for x in pos.max(axis=0)],
            },
            {
                "bufferView": 1,
                "componentType": 5126,  # FLOAT
                "count": n_verts,
                "type": "VEC3",
                "min": [float(x) for x in normals.min(axis=0)],
                "max": [float(x) for x in normals.max(axis=0)],
            },
            {
                "bufferView": 2,
                "componentType": 5126,  # FLOAT
                "count": n_verts,
                "type": "VEC2",
                "min": [float(x) for x in uvs.min(axis=0)],
                "max": [float(x) for x in uvs.max(axis=0)],
            },
            {
                "bufferView": 3,
                "componentType": 5123,  # UNSIGNED_SHORT
                "count": n_indices,
                "type": "SCALAR",
                "min": [int(indices.min())],
                "max": [int(indices.max())],
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": offset_pos, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": offset_norm, "byteLength": len(norm_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": offset_uv, "byteLength": len(uv_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": offset_idx, "byteLength": len(idx_bytes), "target": 34963},
            {"buffer": 0, "byteOffset": offset_img, "byteLength": len(jpeg_bytes)},
        ],
        "buffers": [{"byteLength": total_bin_len}],
    }

    json_str = json.dumps(gltf, separators=(",", ":"))
    json_bytes = json_str.encode("utf-8")
    pad_len = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b" " * pad_len
    chunk0_len = len(json_bytes)

    total_len = 12 + 8 + chunk0_len + 8 + total_bin_len

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f_out:
        f_out.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f_out.write(struct.pack("<I4s", chunk0_len, b"JSON"))
        f_out.write(json_bytes)
        f_out.write(struct.pack("<I4s", total_bin_len, b"BIN\x00"))
        f_out.write(bin_data)

    print(f"Exported {out_path} ({total_len / (1024*1024):.2f} MB).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build optimized low-poly Moon GLB.")
    parser.add_argument("--input", default=str(INPUT_GLB), help="Input NASA 8k GLB")
    parser.add_argument("--dem", default=str(DEM_PATH), help="NASA LOLA south-pole DEM")
    parser.add_argument("--out", default=str(OUTPUT_GLB), help="Output GLB path")
    parser.add_argument("--multiplier", type=float, default=3.0, help="Vertical exaggeration multiplier")
    parser.add_argument("--n-lon", type=int, default=360, help="Longitude subdivisions")
    parser.add_argument("--n-lat", type=int, default=180, help="Latitude subdivisions")
    parser.add_argument("--tex-w", type=int, default=2048, help="Texture width")
    parser.add_argument("--tex-h", type=int, default=1024, help="Texture height")
    args = parser.parse_args()

    t0 = time.time()
    print("=== Building Optimized Low-Poly Moon GLB ===")

    # 1. Global elevation
    elev_grid = build_global_elevation_grid(Path(args.input))

    # 2. Blend LOLA South Pole DEM
    if Path(args.dem).exists():
        print(f"Blending NASA LOLA south-pole DEM: {args.dem}...")
        grid_h, grid_w = elev_grid.shape
        south_idx, rel_south = sample_south_pole_dem(Path(args.dem), grid_w, grid_h)

        # Transition zone from lat -58 deg to -64 deg (top 15 rows of south_idx)
        n_blend = min(len(south_idx), 18)
        blend_weights = np.linspace(0.0, 1.0, n_blend)[:, None]

        for i, row in enumerate(south_idx):
            w = blend_weights[i, 0] if i < n_blend else 1.0
            elev_grid[row] = (1.0 - w) * elev_grid[row] + w * rel_south[i]
        print(f"Integrated real LOLA data for {len(south_idx)} polar rows.")

    # 3. Clean polar texture
    jpeg_bytes = extract_and_clean_texture(Path(args.input), args.tex_w, args.tex_h)

    # 4. Generate mesh
    print(f"Generating sphere mesh ({args.n_lon} x {args.n_lat}, {args.multiplier}x exaggeration)...")
    pos, normals, uvs, indices = build_mesh(elev_grid, args.n_lon, args.n_lat, args.multiplier)
    print(f"Generated mesh: {len(pos):,} vertices, {len(indices)//3:,} triangles.")

    # 5. Assemble GLB
    assemble_glb(pos, normals, uvs, indices, jpeg_bytes, Path(args.out))
    print(f"Finished in {time.time() - t0:.2f}s total.")


if __name__ == "__main__":
    main()
