"""Process the NASA LRO 8k Moon topography model for the web globe navigation.

Applies vertical exaggeration to the topography so crater rims, mountain peaks,
and basin depressions stand out distinctly in 3D under grazing sunlight.
Recomputes smooth vertex normals from the exaggerated geometry so lighting and
shadows match the steeper slopes. Preserves the embedded 8k NASA color texture.
"""

import argparse
import json
import struct
import time
from pathlib import Path
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process NASA LRO moon GLB with height exaggeration.")
    parser.add_argument("--input", default="python/data/Moon_NASA_LRO_8k_Topo.glb", help="input GLB path")
    parser.add_argument("--out", default="web/public/models/moon.glb", help="output GLB path")
    parser.add_argument("--multiplier", type=float, default=5.0, help="vertical height exaggeration multiplier")
    return parser.parse_args()


def process_glb(input_path: Path, output_path: Path, multiplier: float) -> None:
    t0 = time.time()
    print(f"Reading {input_path}...")
    with open(input_path, "rb") as f:
        data = bytearray(f.read())

    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError(f"Not a valid glTF file: {magic}")

    # Chunk 0: JSON
    chunk0_len, chunk0_type = struct.unpack_from("<I4s", data, 12)
    if chunk0_type != b"JSON":
        raise ValueError(f"First chunk is not JSON: {chunk0_type}")
    
    json_bytes = data[20 : 20 + chunk0_len]
    gltf = json.loads(json_bytes.decode("utf-8"))

    # Chunk 1: BIN
    bin_header_offset = 20 + chunk0_len
    chunk1_len, chunk1_type = struct.unpack_from("<I4s", data, bin_header_offset)
    if chunk1_type != b"BIN\x00":
        raise ValueError(f"Second chunk is not BIN: {chunk1_type}")
    
    bin_start = bin_header_offset + 8

    # Identify accessors
    mesh = gltf["meshes"][0]
    prim = mesh["primitives"][0]
    pos_acc_idx = prim["attributes"]["POSITION"]
    norm_acc_idx = prim["attributes"]["NORMAL"]
    idx_acc_idx = prim["indices"]

    pos_acc = gltf["accessors"][pos_acc_idx]
    norm_acc = gltf["accessors"][norm_acc_idx]
    idx_acc = gltf["accessors"][idx_acc_idx]

    pos_bv = gltf["bufferViews"][pos_acc["bufferView"]]
    norm_bv = gltf["bufferViews"][norm_acc["bufferView"]]
    idx_bv = gltf["bufferViews"][idx_acc["bufferView"]]

    pos_offset = bin_start + pos_bv.get("byteOffset", 0)
    norm_offset = bin_start + norm_bv.get("byteOffset", 0)
    idx_offset = bin_start + idx_bv.get("byteOffset", 0)

    n_verts = pos_acc["count"]
    n_indices = idx_acc["count"]
    n_tris = n_indices // 3

    print(f"Loaded GLTF structure in {time.time() - t0:.2f}s: {n_verts:,} verts, {n_tris:,} triangles.")

    # Read positions as float32 array
    pos = np.frombuffer(data, dtype=np.float32, count=n_verts * 3, offset=pos_offset).reshape(-1, 3).copy()
    indices = np.frombuffer(data, dtype=np.uint32, count=n_indices, offset=idx_offset).reshape(-1, 3)

    # Radial heights relative to mean radius (normalized to 1.0)
    r = np.linalg.norm(pos, axis=1, keepdims=True)
    r_mean = float(np.mean(r))
    rel_delta = (r - r_mean) / r_mean
    print(f"Original topography: mean radius = {r_mean:.6f}, rel delta min = {rel_delta.min():.4%}, max = {rel_delta.max():.4%}")

    # Apply height exaggeration with mean radius normalized to 1.0
    new_r = 1.0 + multiplier * rel_delta
    unit_vectors = pos / r
    new_pos = unit_vectors * new_r

    new_delta = new_r - 1.0
    print(f"Exaggerated ({multiplier:.1f}x): mean radius = 1.000000, delta min = {new_delta.min():.4%}, delta max = {new_delta.max():.4%}")

    # Recompute vertex normals (area-weighted from face normals)
    t_norm = time.time()
    v0 = new_pos[indices[:, 0]]
    v1 = new_pos[indices[:, 1]]
    v2 = new_pos[indices[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)

    vert_normals = np.zeros((n_verts, 3), dtype=np.float32)
    np.add.at(vert_normals, indices[:, 0], face_normals)
    np.add.at(vert_normals, indices[:, 1], face_normals)
    np.add.at(vert_normals, indices[:, 2], face_normals)

    norm_lens = np.linalg.norm(vert_normals, axis=1, keepdims=True)
    norm_lens[norm_lens == 0] = 1.0
    vert_normals /= norm_lens
    print(f"Recomputed smooth vertex normals in {time.time() - t_norm:.2f}s.")

    # Write new positions and normals back into data buffer
    data[pos_offset : pos_offset + pos.nbytes] = new_pos.tobytes()
    data[norm_offset : norm_offset + vert_normals.nbytes] = vert_normals.tobytes()

    # Update accessor min/max
    pos_acc["min"] = [float(x) for x in new_pos.min(axis=0)]
    pos_acc["max"] = [float(x) for x in new_pos.max(axis=0)]
    norm_acc["min"] = [float(x) for x in vert_normals.min(axis=0)]
    norm_acc["max"] = [float(x) for x in vert_normals.max(axis=0)]

    # Serialize JSON with padding to keep 4-byte alignment
    new_json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    pad_len = (4 - (len(new_json_bytes) % 4)) % 4
    new_json_bytes += b" " * pad_len
    new_chunk0_len = len(new_json_bytes)

    # Reconstruct GLB
    # Header: magic (4), version (4), total_length (4)
    # Chunk 0: len (4), type (4), data
    # Chunk 1: len (4), type (4), data
    chunk1_data = data[bin_start : bin_start + chunk1_len]
    total_len = 12 + 8 + new_chunk0_len + 8 + chunk1_len

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f_out:
        f_out.write(struct.pack("<4sII", b"glTF", version, total_len))
        f_out.write(struct.pack("<I4s", new_chunk0_len, b"JSON"))
        f_out.write(new_json_bytes)
        f_out.write(struct.pack("<I4s", chunk1_len, b"BIN\x00"))
        f_out.write(chunk1_data)

    print(f"Wrote {output_path} ({total_len / (1024*1024):.1f} MB) in {time.time() - t0:.2f}s total.")


if __name__ == "__main__":
    args = parse_args()
    process_glb(Path(args.input), Path(args.out), args.multiplier)
