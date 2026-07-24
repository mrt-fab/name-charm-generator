#!/usr/bin/env python3
"""Trace 2D outlines from the private reference models into js/hw_templates.js.

One-off asset generation. The reference meshes themselves are NEVER redistributed —
this extracts mechanical outlines (hook clasp, carabiner body/gate) which we re-model
parametrically. Reads from the vault's Fab/ folder (outside the repo, gitignored).

Usage:  python3 scripts/trace_reference.py /path/to/Fab
"""
import json
import math
import os
import re
import struct
import sys
import zipfile

EPS = 0.03  # endpoint weld tolerance (mm)


def stl_tris(path):
    data = open(path, "rb").read()
    n = struct.unpack_from("<I", data, 80)[0]
    tris = []
    for t in range(n):
        o = 84 + t * 50 + 12
        tris.append([struct.unpack_from("<3f", data, o + v * 12) for v in range(3)])
    return tris


def mf_tris(path, obj):
    z = zipfile.ZipFile(path)
    xml = z.read(obj).decode("utf-8", "replace")
    verts = [(float(m.group(1)), float(m.group(2)), float(m.group(3)))
             for m in re.finditer(r'<vertex x="([-\d.e]+)" y="([-\d.e]+)" z="([-\d.e]+)"', xml)]
    return [[verts[int(m.group(1))], verts[int(m.group(2))], verts[int(m.group(3))]]
            for m in re.finditer(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', xml)]


def section(tris, zc):
    segs = []
    for tri in tris:
        pts = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            z1, z2 = tri[i][2], tri[j][2]
            if (z1 - zc) * (z2 - zc) < 0:
                f = (zc - z1) / (z2 - z1)
                pts.append((tri[i][0] + f * (tri[j][0] - tri[i][0]),
                            tri[i][1] + f * (tri[j][1] - tri[i][1])))
        if len(pts) == 2 and math.dist(pts[0], pts[1]) > 1e-6:
            segs.append(pts)
    return segs


def chain_loops(segs):
    """Weld segments into closed loops by endpoint proximity."""
    used = [False] * len(segs)
    loops = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        used[i] = True
        loop = [s[0], s[1]]
        grown = True
        while grown:
            grown = False
            for j, t in enumerate(segs):
                if used[j]:
                    continue
                for a, b in ((0, 1), (1, 0)):
                    if math.dist(loop[-1], t[a]) < EPS:
                        loop.append(t[b])
                        used[j] = True
                        grown = True
                        break
                if grown:
                    break
        if math.dist(loop[0], loop[-1]) < EPS and len(loop) > 8:
            loops.append(loop[:-1])
    return loops


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        num = abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1)
        den = math.hypot(y2 - y1, x2 - x1) or 1e-12
        d = num / den
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        left = rdp(pts[: idx + 1], eps)
        return left[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def simplify_loop(loop, eps=0.04):
    # rotate to a stable corner-ish start, run RDP over the closed path
    out = rdp(loop + [loop[0]], eps)[:-1]
    return out if len(out) >= 3 else loop


def area(loop):
    a = 0.0
    for i in range(len(loop)):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % len(loop)]
        a += x1 * y2 - x2 * y1
    return a / 2


def emit(loops, min_area=0.5):
    loops = [simplify_loop(l) for l in loops if abs(area(l)) > min_area]
    # center on combined bbox
    xs = [p[0] for l in loops for p in l]
    ys = [p[1] for l in loops for p in l]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    out = [[[round(p[0] - cx, 3), round(p[1] - cy, 3)] for p in l] for l in loops]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    return out, round(w, 2), round(h, 2)


def main():
    fab = sys.argv[1] if len(sys.argv) > 1 else "../Fab"
    ring_tris = mf_tris(os.path.join(fab, "Wisiorek+z+łańcuszkiem+-+one+item.3mf"),
                        "3D/Objects/object_13.model")
    # section the whole pendant, then keep loops living in the ring region (y ≳ 5)
    all_ring = chain_loops(section(ring_tris, 0.0))
    ring_sel = [l for l in all_ring if min(p[1] for p in l) > 5]
    ring_loops, rw, rh = emit(ring_sel)

    carab = stl_tris(os.path.join(fab, "Small+-+Standard+Carabiner.stl"))
    segs = section(carab, 2.5)
    loops = chain_loops(segs)
    # split into the two parts by loop bbox: the gate is the smaller-x cluster
    def bbox(l):
        return (min(p[0] for p in l), max(p[0] for p in l))
    # body outline is the loop with the widest x-extent
    loops.sort(key=lambda l: bbox(l)[1] - bbox(l)[0], reverse=True)
    widest = bbox(loops[0])[1] - bbox(loops[0])[0]
    body_loops, gate_loops = [], []
    for l in loops:
        # loops fully inside the widest loop's x-range but disjoint material → decide by
        # containment test against loop[0]
        body_loops.append(l) if l is loops[0] else None
    # simpler: classify by point-in-polygon winding vs biggest loop later in JS; here
    # export ALL loops with signed areas and let the JS side assemble
    all_loops, cw, ch = emit(loops)
    ring_out = {"loops": ring_loops, "w": rw, "h": rh}
    carab_out = {"loops": all_loops, "w": cw, "h": ch}

    js = (
        "// hw_templates.js — mechanical outlines traced from the user's reference models\n"
        "// (generated by scripts/trace_reference.py; the reference meshes are NOT distributed).\n"
        "// Coordinates in mm, centered. Loops carry sign via winding (CCW solid / CW hole).\n"
        f"export const SNAP_RING = {json.dumps(ring_out)};\n"
        f"export const CARABINER = {json.dumps(carab_out)};\n"
    )
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js", "hw_templates.js")
    open(out, "w").write(js)
    print(f"ring: {len(ring_loops)} loops, {rw}x{rh}mm")
    print(f"carabiner: {len(all_loops)} loops, {cw}x{ch}mm")
    for i, l in enumerate(all_loops):
        print(f"  loop {i}: {len(l)} pts, area {round(area(l),1)}")


if __name__ == "__main__":
    main()
