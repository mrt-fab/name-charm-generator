#!/usr/bin/env python3
"""Full-fidelity band trace of the reference carabiner + knob into js/hw_carabiner_full.js.

Unlike trace_reference.py (single mechanical outline), this slices the meshes into
0.2mm z-bands and stores per-band outlines — a direct banded copy of the models.
The user confirmed the source (a MakerWorld publication) permits this reproduction.
The body STL contains two connected components (frame + print-in-place gate with its
pivot and printed spring); they are traced separately so the generator can keep them
as independent printable pieces.

Usage:  python3 scripts/trace_carabiner_full.py /path/to/Fab
"""
import json
import math
import os
import struct
import sys

BAND = 0.2       # z band height (mm) — matches the print layer pitch
EPS = 0.03       # endpoint weld tolerance
RDP_EPS = 0.05   # outline simplification


def stl_tris(path):
    data = open(path, "rb").read()
    n = struct.unpack_from("<I", data, 80)[0]
    tris = []
    for t in range(n):
        o = 84 + t * 50 + 12
        tris.append(tuple(struct.unpack_from("<3f", data, o + v * 12) for v in range(3)))
    return tris


def components(tris):
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def uni(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    def key(v):
        return (round(v[0], 3), round(v[1], 3), round(v[2], 3))

    for t in tris:
        for v in t:
            k = key(v)
            if k not in parent:
                parent[k] = k
        uni(key(t[0]), key(t[1]))
        uni(key(t[1]), key(t[2]))
    comp = {}
    for t in tris:
        comp.setdefault(find(key(t[0])), []).append(t)
    return sorted(comp.values(), key=len, reverse=True)


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
        if math.dist(loop[0], loop[-1]) < EPS and len(loop) > 6:
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


def simplify_loop(loop, eps):
    # closed loop → split at the point farthest from loop[0] so each RDP arc has
    # distinct endpoints (identical endpoints degenerate the distance formula)
    far = max(range(len(loop)),
              key=lambda i: (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2)
    if far == 0:
        return loop
    a = rdp(loop[: far + 1], eps)
    b = rdp(loop[far:] + [loop[0]], eps)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else loop


def area(loop):
    a = 0.0
    for i in range(len(loop)):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % len(loop)]
        a += x1 * y2 - x2 * y1
    return a / 2


def trace(tris, name):
    zs = [p[2] for t in tris for p in t]
    z0, z1 = min(zs), max(zs)
    bands = []
    total_src = total_out = 0.0
    z = z0
    while z < z1 - 1e-6:
        zt = min(z + BAND, z1)
        zm = (z + zt) / 2
        loops = chain_loops(section(tris, zm))
        out = []
        for l in loops:
            if abs(area(l)) < 0.05:
                continue
            simp = simplify_loop(l, RDP_EPS)
            if len(simp) >= 3:
                total_src += abs(area(l))
                total_out += abs(area(simp))
                out.append([[round(p[0], 3), round(p[1], 3)] for p in simp])
        bands.append({"z0": round(z - z0, 3), "z1": round(zt - z0, 3), "loops": out})
        z = zt
    fid = total_out / total_src if total_src else 1.0
    print(f"{name}: z {z0:.2f}..{z1:.2f} → {len(bands)} bands, area fidelity {fid:.4f}")
    return {"h": round(z1 - z0, 3), "bands": bands}


def main():
    fab = sys.argv[1] if len(sys.argv) > 1 else "../Fab"
    body_tris = stl_tris(os.path.join(fab, "Small+-+Standard+Carabiner.stl"))
    comps = components(body_tris)
    # larger component = the gate (denser mesh: spring + thread); classify by bbox
    def bbox_w(ts):
        xs = [p[0] for t in ts for p in t]
        return max(xs) - min(xs)
    comps.sort(key=bbox_w, reverse=True)
    frame, gate = comps[0], comps[1]

    # shared XY normalization: center on the FULL body bbox so frame and gate keep
    # their printed relative positions
    xs = [p[0] for t in body_tris for p in t]
    ys = [p[1] for t in body_tris for p in t]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

    def shift(ts):
        return [tuple((v[0] - cx, v[1] - cy, v[2]) for v in t) for t in ts]

    frame_o = trace(shift(frame), "frame")
    gate_o = trace(shift(gate), "gate")

    knob_tris = stl_tris(os.path.join(fab, "Small+-+Carabiner+Knob.stl"))
    kxs = [p[0] for t in knob_tris for p in t]
    kys = [p[1] for t in knob_tris for p in t]
    kcx, kcy = (min(kxs) + max(kxs)) / 2, (min(kys) + max(kys)) / 2
    knob_o = trace([tuple((v[0] - kcx, v[1] - kcy, v[2]) for v in t) for t in knob_tris], "knob")

    w, h = max(xs) - min(xs), max(ys) - min(ys)
    js = (
        "// hw_carabiner_full.js — full-fidelity banded copy of the reference carabiner\n"
        "// (MakerWorld publication; the user confirmed reproduction is permitted).\n"
        "// Generated by scripts/trace_carabiner_full.py — do not edit by hand.\n"
        "// Coordinates in mm, XY centered on the body bbox; bands are z-ranges from 0.\n"
        f"export const CARB_W = {round(w, 2)};\n"
        f"export const CARB_H = {round(h, 2)};\n"
        f"export const CARB_FRAME = {json.dumps(frame_o, separators=(',', ':'))};\n"
        f"export const CARB_GATE = {json.dumps(gate_o, separators=(',', ':'))};\n"
        f"export const CARB_KNOB = {json.dumps(knob_o, separators=(',', ':'))};\n"
    )
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js", "hw_carabiner_full.js")
    open(out, "w").write(js)
    print(f"wrote {out} ({len(js) // 1024}KB)")


if __name__ == "__main__":
    main()
