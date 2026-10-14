# Builds the Hollow Star dropship *Wren* (static mesh, materials, UVs) and exports it for Unity.
# Run inside Blender (e.g. through the Blender MCP):
#     exec(open("/Users/mikkel/Hollow Star/art/blender/scripts/build_wren.py").read())
# Set WREN_PREVIEW_DIR in the exec globals first to also render the preview images there.
#
# Everything is modelled in UNITY ship space and mapped into Blender through U(), exactly like
# build_astronaut.py: nose toward -Z, stern and lowered cargo ramp toward +Z, origin on the pad
# surface under the hull. The numbers follow the web version (src/env/props/ship.ts and the WREN
# constants in src/env/props/layout.ts). The FBX exporter settings map Blender (x, y, z) to Unity
# (-x, z, -y), so the model imports in ship space with identity transforms.
#
# Objects: Wren_Body (hull, nacelles, pylons, tail, canopy, details), Wren_Interior (cargo bay),
# Wren_Gear (landing gear), Wren_Ramp (cargo ramp, pivot on the hinge line: rotate about local X
# to raise it).

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = "/Users/mikkel/Hollow Star"
FBX_PATH = f"{ROOT}/HollowStarUnity/Assets/_Project/Art/Models/Props/SM_Wren.fbx"
BLEND_PATH = f"{ROOT}/art/blender/wren.blend"

PI = math.pi
TAU = 2 * math.pi
UP = Vector((0, 1, 0))


def U(x, y, z):
    """Unity position -> Blender position."""
    return Vector((-x, -z, y))


# Unity -> Blender as a matrix (a mirror: faces are reversed after applying it).
MU = Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# ---- layout constants (layout.ts) ----------------------------------------------------------------

WREN = dict(noseZ=-11.0, tailZ=10.9, floorY=1.45, rampHingeZ=4.6, rampWidth=3.0, rampLength=5.1,
            nacelleX=4.35, nacelleY=2.65, nacelleZ0=0.4, nacelleZ1=10.1, nacelleR=1.08,
            mainGearZ=4.2, noseGearZ=-7.3)
FLOOR_Y = WREN["floorY"]
HINGE_Z = WREN["rampHingeZ"]
RAMP_RUN = math.sqrt(WREN["rampLength"] ** 2 - FLOOR_Y ** 2)
RAMP_LIP_Z = HINGE_Z + RAMP_RUN
UMBILICAL = Vector((-1.95, 1.95, -1.0))

# Cargo opening in the belly: |x| < OPEN_X, HINGE_Z < z < OPEN_Z1, below the tilted plane y = cut_top(z).
OPEN_X = 1.62
OPEN_Z1 = 9.75


def cut_top(z):
    return 3.23 + (z - 8.0) * 0.143


def in_opening(p, pad=0.0):
    return abs(p.x) < OPEN_X + pad and HINGE_Z - pad < p.z < OPEN_Z1 + pad and p.y < cut_top(p.z) + pad


# ---- small math helpers (Unity space) ------------------------------------------------------------

def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def sstep(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def V(x, y, z):
    return Vector((x, y, z))


def T(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0):
    """Like three.js: translation and Euler XYZ (R = Rx Ry Rz)."""
    return (Matrix.Translation((x, y, z)) @ Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(ry, 4, "Y")
            @ Matrix.Rotation(rz, 4, "Z"))


def facing(p, n, up=UP):
    """Frame at p: local +Z along n, local +Y toward `up`."""
    z = n.normalized()
    if abs(z.dot(up)) > 0.95:
        up = V(0, 0, -1)
    x = up.cross(z).normalized()
    y = z.cross(x)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = x[i], y[i], z[i], p[i]
    return m


def between(a, b):
    """Frame whose local +Y runs from a to b, centred between them; returns (matrix, length)."""
    d = b - a
    L = d.length
    y = d / L
    ref = V(1, 0, 0) if abs(y.x) < 0.9 else V(0, 0, 1)
    x = ref.cross(y).normalized()
    z = x.cross(y)
    c = (a + b) / 2
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = x[i], y[i], z[i], c[i]
    return m, L


# ---- materials ------------------------------------------------------------------------------------

def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(name, hexcol, rough, metal=0.0, emit=None, strength=6.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    b = nt.nodes.get("Principled BSDF")
    col = srgb(hexcol)
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        b.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*col, 1)
    return m


MAT = {}


def make_materials():
    MAT["hull"] = material("M_Wren_Hull", "#c9c6bd", 0.5, 0.08)
    MAT["dark"] = material("M_Wren_Dark", "#2b2e33", 0.5, 0.3)
    MAT["metal"] = material("M_Wren_Metal", "#7a7d80", 0.36, 0.85)
    MAT["glass"] = material("M_Wren_Glass", "#1a1e24", 0.05, 0.4)
    MAT["lamp"] = material("M_Wren_Lamp", "#ffd9a8", 0.3, 0.0, emit="#ffd9a8", strength=6.0)
    MAT["hazard"] = material("M_Hazard", "#d1a21f", 0.5, 0.1)


# ---- parts: bmesh in Unity space, one object per part until the final join ------------------------

GROUPS = {"Body": [], "Interior": [], "Gear": [], "Ramp": []}
PARTS = []


class Part:
    def __init__(self, name, group="Body", sharp=48.0, weighted=True):
        self.name = name
        self.group = group
        self.bm = bmesh.new()
        self.mats = []
        self.sharp = sharp
        self.weighted = weighted
        PARTS.append(self)

    def mi(self, key):
        if key not in self.mats:
            self.mats.append(key)
        return self.mats.index(key)

    def add(self, src, key, M=None, recalc=True, keys=None):
        """Append bmesh `src` (consumed). key: material for all faces, or keys: per-face index list."""
        if M is not None:
            bmesh.ops.transform(src, matrix=M, verts=src.verts)
        if recalc:
            bmesh.ops.recalc_face_normals(src, faces=src.faces)
        for f in src.faces:
            f.material_index = self.mi(keys[f.material_index] if keys else key)
        me = bpy.data.meshes.new("_tmp")
        src.to_mesh(me)
        src.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def finish(self):
        bm = self.bm
        if not bm.faces:
            bm.free()
            return None
        bmesh.ops.transform(bm, matrix=MU, verts=bm.verts)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:
            bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for k in self.mats:
            me.materials.append(MAT[k])
        for p in me.polygons:
            p.use_smooth = True
        if self.sharp:
            me.set_sharp_from_angle(angle=math.radians(self.sharp))
        if self.weighted:
            mod = ob.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.weight = 50
            mod.keep_sharp = True
        GROUPS[self.group].append(ob)
        return ob


# ---- primitive builders (return a new bmesh in local or Unity space) ------------------------------

def bm_box(size, r=0.0, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = V(v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])
    r = min(r, 0.45 * min(size))
    if r > 0.0005:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=r, offset_type="OFFSET", segments=segs,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    return bm


def at(M):
    return M if isinstance(M, Matrix) else Matrix.Translation(M)


def box(part, key, M, size, r=0.02, segs=2):
    part.add(bm_box(size, r, segs), key, at(M))


def bm_cyl(r0, r1, h, segs=16, bevel=0.0, bsegs=1):
    """Cylinder/cone along local Y, centred."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=h)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(-PI / 2, 4, "X"), verts=bm.verts)
    if bevel > 0:
        bm.normal_update()
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0].normal.angle(e.link_faces[1].normal) > 0.7]
        bmesh.ops.bevel(bm, geom=edges, offset=min(bevel, 0.45 * min(r0 if r0 > 0 else r1, h)), offset_type="OFFSET",
                        segments=bsegs, profile=0.5, affect="EDGES", clamp_overlap=True)
    return bm


def cyl(part, key, M, r, h, segs=16, bevel=0.0, r1=None, bsegs=1):
    part.add(bm_cyl(r, r if r1 is None else r1, h, segs, bevel, bsegs), key, at(M))


def strut(part, key, a, b, r, segs=10, bevel=0.0):
    m, L = between(a, b)
    part.add(bm_cyl(r, r, L, segs, bevel), key, m)


def bm_lathe(profile, segs=24):
    """Surface of revolution about local Y. profile: [(r, y)], closed (first == last) or ending on the axis."""
    bm = bmesh.new()
    pts = list(profile)
    closed = abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9
    if closed:
        pts = pts[:-1]
    rings = []
    for r, y in pts:
        if r < 1e-6:
            rings.append([bm.verts.new((0, y, 0))])
        else:
            rings.append([bm.verts.new((r * math.cos(TAU * i / segs), y, r * math.sin(TAU * i / segs))) for i in range(segs)])
    n = len(rings)
    for k in range(n if closed else n - 1):
        a, b = rings[k], rings[(k + 1) % n]
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    return bm


def lathe(part, key, M, profile, segs=24):
    part.add(bm_lathe(profile, segs), key, at(M))


def sphere(part, key, M, r, segs=12, rings=8, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = V(v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])
    part.add(bm, key, at(M))


def bm_rings(rings, closed_path=False, cap0=True, cap1=True):
    """Loft closed loops (equal vertex count) into a tube, optionally capped."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vs[0])
    count = len(vs)
    for k in range(count if closed_path else count - 1):
        a, b = vs[k], vs[(k + 1) % count]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if not closed_path:
        if cap0:
            bm.faces.new(vs[0])
        if cap1:
            bm.faces.new(vs[-1])
    return bm


def rrect(w, h, r, n=3, cx=0.0, cy=0.0):
    """Rounded rectangle outline (CCW), n segments per corner."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    pts = []
    for cxs, cys, a0 in ((1, 1, 0.0), (-1, 1, PI / 2), (-1, -1, PI), (1, -1, 1.5 * PI)):
        ox = cx + cxs * (w / 2 - r)
        oy = cy + cys * (h / 2 - r)
        for i in range(n + 1):
            a = a0 + (PI / 2) * i / n
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def circle2(r, n):
    return [(r * math.cos(TAU * i / n), r * math.sin(TAU * i / n)) for i in range(n)]


def sweep_rings(path, ups, profile, closed=False, scale=None):
    """Rings of `profile` ((b, n) pairs) along `path`; ups give the profile's +n direction."""
    N = len(path)
    rings = []
    for i in range(N):
        p = path[i]
        has_prev = i > 0 or closed
        has_next = i < N - 1 or closed
        t1 = (p - path[i - 1]).normalized() if has_prev else None
        t2 = (path[(i + 1) % N] - p).normalized() if has_next else None
        t = (t1 + t2) if (t1 is not None and t2 is not None) else (t1 if t1 is not None else t2)
        t = t.normalized()
        up = ups[i]
        nrm = (up - t * up.dot(t)).normalized()
        b = nrm.cross(t)
        mit = 1.0
        if t1 is not None and t2 is not None:
            mit = 1.0 / max(0.55, t1.dot(t))
        sx, sy = scale(i) if scale else (1.0, 1.0)
        rings.append([p + b * (px * sx * mit) + nrm * (py * sy) for px, py in profile])
    return rings


def sweep(part, key, path, ups, profile, closed=False, caps=True, scale=None):
    rings = sweep_rings(path, ups, profile, closed, scale)
    part.add(bm_rings(rings, closed_path=closed, cap0=caps, cap1=caps), key)


def transport_ups(path):
    """Parallel-transported normals along a polyline (for round tubes)."""
    t0 = (path[1] - path[0]).normalized()
    ref = V(0, 1, 0) if abs(t0.y) < 0.9 else V(1, 0, 0)
    u = (ref - t0 * ref.dot(t0)).normalized()
    ups = [u]
    for i in range(1, len(path)):
        t = (path[min(i + 1, len(path) - 1)] - path[i - 1]).normalized()
        u = (u - t * u.dot(t)).normalized()
        ups.append(u)
    return ups


def tube(part, key, path, r, sides=8):
    sweep(part, key, path, transport_ups(path), circle2(r, sides), closed=False, caps=True)


def bm_grid(f, nu, nv, closed_v=False):
    """Parametric patch f(u, v) -> Vector with (nu+1) x (nv+1) samples."""
    bm = bmesh.new()
    cols = nv if closed_v else nv + 1
    vs = [[bm.verts.new(f(i / nu, j / nv)) for j in range(cols)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            j2 = (j + 1) % cols
            bm.faces.new((vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j]))
    return bm


def orient(bm, expected):
    """Flip faces whose normal disagrees with expected(center) (open surfaces)."""
    bm.normal_update()
    for fc in bm.faces:
        if fc.normal.dot(expected(fc.calc_center_median())) < 0:
            fc.normal_flip()
    bm.normal_update()


def frame(xaxis, zaxis, origin=(0, 0, 0)):
    """Matrix with local X along xaxis, local Z along zaxis (Y = Z x X), at origin."""
    x = Vector(xaxis).normalized()
    z = Vector(zaxis).normalized()
    y = z.cross(x)
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = x[i], y[i], z[i], origin[i]
    return m


def hazard_stripes(part, M, length, width, stripe=0.18, lift=0.003, thick=0.004):
    """Dark diagonal bands on a yellow surface. Local frame: X along the strip (0..length), Y across
    (centred), Z out of the surface."""
    u = 0.0
    while u + stripe + width <= length + 1e-6:
        bm = bmesh.new()
        pts = ((u, -width / 2), (u + stripe, -width / 2), (u + stripe + width, width / 2), (u + width, width / 2))
        top = [bm.verts.new((x, y, lift + thick)) for x, y in pts]
        bot = [bm.verts.new((x, y, lift)) for x, y in pts]
        bm.faces.new(top)
        bm.faces.new(list(reversed(bot)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        part.add(bm, "dark", M)
        u += 2 * stripe


# ---- lofted hulls: superellipse stations (shapes.ts) ----------------------------------------------

def _cr(a, b, c, d, s):
    s2 = s * s
    s3 = s2 * s
    return 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3)


def _crc(a, b, c, d, s):
    v = _cr(a, b, c, d, s)
    lo, hi = min(b, c), max(b, c)
    m = (hi - lo) * 0.15
    return max(lo - m, min(hi + m, v))


class Loft:
    """Stations (z, w, ht, hb, y, nt, nb) interpolated like stationAt(); points like hullPoint()."""

    def __init__(self, stations, cx=0.0, cy=0.0):
        self.S = stations
        self.cx = cx
        self.cy = cy
        n = 2048
        self.table = [self.st_u(i / n)[0] for i in range(n + 1)]

    def st_u(self, t):
        S = self.S
        n = len(S) - 1
        f = clamp(t, 0.0, 1.0) * n
        i = min(int(f), n - 1)
        s = f - i
        p0, p1, p2, p3 = S[max(i - 1, 0)], S[i], S[i + 1], S[min(i + 2, n)]
        return [_cr(p0[0], p1[0], p2[0], p3[0], s)] + [_crc(p0[k], p1[k], p2[k], p3[k], s) for k in range(1, 7)]

    def u_at(self, z):
        tb = self.table
        n = len(tb) - 1
        if z <= tb[0]:
            return 0.0
        if z >= tb[n]:
            return 1.0
        lo, hi = 0, n
        while hi - lo > 1:
            mid = (lo + hi) >> 1
            if tb[mid] < z:
                lo = mid
            else:
                hi = mid
        t = (z - tb[lo]) / max(tb[hi] - tb[lo], 1e-9)
        return (lo + t) / n

    def st(self, z):
        return self.st_u(self.u_at(z))

    def z_of_u(self, u):
        return self.st_u(u)[0]

    def point(self, z, a, off=0.0, inset=0.0):
        s = self.st(z)
        hw = max(s[1] / 2 - inset, 1e-3)
        c, sn = math.cos(a), math.sin(a)
        if sn >= 0:
            h, n = max(s[2] - inset, 1e-3), s[5]
        else:
            h, n = max(s[3] - inset, 1e-3), s[6]
        e = 2 / n
        p = V(self.cx + hw * math.copysign(abs(c) ** e, c), self.cy + s[4] + h * math.copysign(abs(sn) ** e, sn), z)
        if off:
            p += self.normal(z, a) * off
        return p

    def normal(self, z, a):
        e = 0.004
        dz = self.point(z + e, a) - self.point(z - e, a)
        da = self.point(z, a + e) - self.point(z, a - e)
        n = da.cross(dz)
        if n.length < 1e-9:
            return V(0, 1 if math.sin(a) >= 0 else -1, 0)
        return n.normalized()

    def centre(self, z):
        s = self.st(z)
        return V(self.cx, self.cy + s[4], z)

    def half_width(self, z, y, inset=0.0):
        s = self.st(z)
        dy = y - (self.cy + s[4])
        h, n = (s[2], s[5]) if dy >= 0 else (s[3], s[6])
        h -= inset
        if abs(dy) >= h:
            return None
        return (s[1] / 2 - inset) * (1 - abs(dy / h) ** n) ** (1 / n)

    def top(self, z, x=0.0):
        s = self.st(z)
        hw = s[1] / 2
        c = min(abs(x - self.cx) / hw, 0.999)
        return self.cy + s[4] + s[2] * (1 - c ** s[5]) ** (1 / s[5])

    def bottom(self, z, x=0.0):
        s = self.st(z)
        hw = s[1] / 2
        c = min(abs(x - self.cx) / hw, 0.999)
        return self.cy + s[4] - s[3] * (1 - c ** s[6]) ** (1 / s[6])

    def arc_angles(self, z, n):
        """n angles from -PI/2 spaced uniformly in arc length around the section at z."""
        m = 2000
        angs = [-PI / 2 + TAU * i / m for i in range(m + 1)]
        pts = [self.point(z, a) for a in angs]
        acc = [0.0]
        for i in range(m):
            acc.append(acc[-1] + (pts[i + 1] - pts[i]).length)
        total = acc[-1]
        out = []
        k = 0
        for i in range(n):
            target = total * i / n
            while acc[k + 1] < target:
                k += 1
            t = (target - acc[k]) / max(acc[k + 1] - acc[k], 1e-9)
            out.append(angs[k] + (angs[k + 1] - angs[k]) * t)
        return out

    def arc_speed(self, z, a):
        e = 0.002
        return (self.point(z, a + e) - self.point(z, a - e)).length / (2 * e)


# Fuselage stations from ship.ts. Two belly changes: the station at z 3.6 is a little deeper and one
# is added at z 4.85, so the belly stays under the 1.45 m cargo floor all the way to the ramp hinge
# (in the web version the floor poked out below the hull there). Aft of z 6.2 it is unchanged.
FUSE = [
    (-11.0, 0.9, 0.22, 0.25, 2.0, 3.0, 3.0),
    (-10.35, 1.9, 0.55, 0.5, 2.1, 3.4, 3.6),
    (-9.3, 2.75, 0.98, 0.78, 2.28, 3.8, 4.4),
    (-7.9, 3.35, 1.42, 1.0, 2.42, 4.2, 5.0),
    (-6.2, 3.75, 1.66, 1.15, 2.52, 4.6, 5.5),
    (-3.3, 4.0, 1.62, 1.27, 2.6, 5.0, 6.0),
    (0.5, 4.1, 1.62, 1.33, 2.65, 5.0, 6.0),
    (3.6, 4.05, 1.6, 1.36, 2.7, 5.0, 6.0),
    (4.85, 3.98, 1.56, 1.43, 2.78, 5.0, 5.8),
    (6.2, 3.8, 1.46, 0.94, 3.0, 4.6, 5.0),
    (8.3, 3.15, 1.1, 0.56, 3.42, 4.0, 3.6),
    (9.6, 2.1, 0.72, 0.36, 3.6, 3.4, 3.0),
    (10.15, 0.8, 0.26, 0.2, 3.62, 3.0, 3.0),
]
NAC = [
    (WREN["nacelleZ0"], 1.62, 0.8, 0.8, 0.0, 2.3, 2.3),
    (WREN["nacelleZ0"] + 0.35, 2.0, 1.0, 0.98, 0.0, 2.5, 2.4),
    (3.4, 2.18, 1.08, 1.06, 0.0, 2.7, 2.5),
    (6.6, 2.08, 1.02, 1.0, 0.0, 2.7, 2.5),
    (9.0, 1.78, 0.88, 0.86, 0.0, 2.5, 2.4),
    (WREN["nacelleZ1"], 1.58, 0.78, 0.78, 0.0, 2.3, 2.3),
]
HULL = None  # Loft(FUSE), created in main()

# Hull paint split (ship.ts: white for v in [-0.045, 0.545], gunmetal below).
SPLIT_A0 = -0.045 * TAU
SPLIT_A1 = 0.545 * TAU
GROOVE_DEPTH = 0.026
GROOVE_W = 0.02


def norm_a(a):
    """Angle into [-PI/2, 3PI/2)."""
    while a < -PI / 2:
        a += TAU
    while a >= 1.5 * PI:
        a -= TAU
    return a


def a_in(a, a0, a1):
    a = norm_a(a)
    a0, a1 = norm_a(a0), norm_a(a1)
    if a0 <= a1:
        return a0 - 1e-6 <= a <= a1 + 1e-6
    return a >= a0 - 1e-6 or a <= a1 + 1e-6


def D(deg):
    return math.radians(deg)


def panel_grid(loft, nu, nv, z0, z1, ring_seams, long_seams, extra_z=(), extra_a=(), ref_z=0.5):
    """Row z values and column angles for a lofted skin with V-groove panel seams."""
    zs = [loft.z_of_u(i / nu) for i in range(nu + 1)]
    zs = [z for z in zs if z0 - 1e-6 <= z <= z1 + 1e-6] + [z0, z1]
    for zc, _, _ in ring_seams:
        zs += [zc - GROOVE_W, zc, zc + GROOVE_W]
    zs += list(extra_z)
    zs = sorted(z for z in zs if z0 - 1e-6 <= z <= z1 + 1e-6)
    rows = []
    for z in zs:
        if not rows or z - rows[-1] > 0.008:
            rows.append(z)
        elif z in [s[0] for s in ring_seams]:
            rows[-1] = z
    uniform = [norm_a(a) for a in loft.arc_angles(ref_z, nv)]
    exact = [norm_a(a) for a, _, _ in long_seams] + [norm_a(a) for a in extra_a]
    anchors = []
    for ac, _, _ in long_seams:
        da = max(GROOVE_W / loft.arc_speed(ref_z, ac), 0.002)
        anchors += [norm_a(ac - da), norm_a(ac + da)]
    special = exact + anchors
    uniform = [a for a in uniform if all(abs(a - k) > 0.01 for k in special)]
    angs = sorted(set(round(a, 7) for a in uniform + special))
    return rows, angs


def groove_at(z, a, ring_seams, long_seams):
    for zc, a0, a1 in ring_seams:
        if abs(z - zc) < 1e-6 and a_in(a, a0, a1):
            return True
    for ac, z0, z1 in long_seams:
        if abs(norm_a(a) - norm_a(ac)) < 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6:
            return True
    return False


def skin_grid(loft, rows, angs, ring_seams, long_seams, inset=0.0):
    pts = []
    for z in rows:
        row = []
        for a in angs:
            p = loft.point(z, a, inset=inset)
            if groove_at(z, a, ring_seams, long_seams):
                p = p - loft.normal(z, a) * GROOVE_DEPTH
            row.append(p)
        pts.append(row)
    return pts


# ---- fuselage ---------------------------------------------------------------------------------------

HULL_RING_SEAMS = [
    (-10.82, -PI / 2, 1.5 * PI),
    (-5.9, -PI / 2, 1.5 * PI),
    (-3.9, -PI / 2, 1.5 * PI),
    (-1.6, D(-40), D(220)),
    (0.9, -PI / 2, 1.5 * PI),
    (3.2, -PI / 2, 1.5 * PI),
    (HINGE_Z, -PI / 2, 1.5 * PI),
    (6.6, -PI / 2, 1.5 * PI),
    (8.5, -PI / 2, 1.5 * PI),
]
HULL_LONG_SEAMS = [
    (D(30), -5.9, 8.5), (D(150), -5.9, 8.5),
    (D(62), -9.4, 8.5), (D(118), -9.4, 8.5),
    (D(6), -5.9, 6.6), (D(174), -5.9, 6.6),
    (D(-48), -8.6, HINGE_Z), (D(228), -8.6, HINGE_Z),
    (D(-90), -5.9, 3.2),
]


def bisect_region(bm, planes, region):
    for co, no in planes:
        faces = [f for f in bm.faces if region(f.calc_center_median())]
        if not faces:
            continue
        edges = {e for f in faces for e in f.edges}
        verts = {v for f in faces for v in f.verts}
        bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, dist=1e-6, plane_co=co, plane_no=no)


OPEN_PLANES = [
    (V(OPEN_X, 0, 0), V(1, 0, 0)),
    (V(-OPEN_X, 0, 0), V(1, 0, 0)),
    (V(0, 0, HINGE_Z), V(0, 0, 1)),
    (V(0, 0, OPEN_Z1), V(0, 0, 1)),
    (V(0, cut_top(8.0), 8.0), V(0, 1, -0.143).normalized()),
]


def cut_opening(bm):
    bisect_region(bm, OPEN_PLANES, lambda c: abs(c.x) < 2.3 and HINGE_Z - 0.6 < c.z < OPEN_Z1 + 0.6 and c.y < 3.9)
    dead = [f for f in bm.faces if in_opening(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=dead, context="FACES")


def boundary_loops(bm):
    edges = [e for e in bm.edges if e.is_boundary]
    left = set(edges)
    loops = []
    while left:
        e = left.pop()
        loop = [e.verts[0], e.verts[1]]
        while True:
            v = loop[-1]
            nxt = None
            for e2 in v.link_edges:
                if e2 in left:
                    nxt = e2
                    break
            if nxt is None:
                break
            left.discard(nxt)
            w = nxt.other_vert(v)
            if w == loop[0]:
                break
            loop.append(w)
        loops.append(loop)
    return loops


def build_fuselage():
    L = HULL
    z0, z1 = FUSE[0][0], FUSE[-1][0]
    rows, angs = panel_grid(L, 84, 72, z0, z1, HULL_RING_SEAMS, HULL_LONG_SEAMS,
                            extra_z=[-10.25, -6.9], extra_a=[SPLIT_A0, SPLIT_A1])
    grid = skin_grid(L, rows, angs, HULL_RING_SEAMS, HULL_LONG_SEAMS)
    bm = bmesh.new()
    nc = len(angs)
    vs = [[bm.verts.new(p) for p in row] for row in grid]

    def face_mat(zc, ac):
        if zc < -10.82:
            return 1
        return 0 if (SPLIT_A0 - 1e-4 <= norm_a(ac) <= SPLIT_A1 + 1e-4) else 1

    for i in range(len(rows) - 1):
        for j in range(nc):
            j2 = (j + 1) % nc
            f = bm.faces.new((vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j]))
            a0, a1 = angs[j], angs[j2] if j2 else angs[0] + TAU
            f.material_index = face_mat((rows[i] + rows[i + 1]) / 2, (a0 + a1) / 2)

    # End domes (nose and tail) close the loft.
    for end, depth in ((0, -0.16), (len(rows) - 1, 0.12)):
        dome_mat = 1 if end == 0 else 0
        ring = vs[end]
        c = L.centre(rows[end])
        prev = ring
        steps = 5
        for k in range(1, steps + 1):
            t = (k / steps) * PI / 2
            if k == steps:
                pole = bm.verts.new(c + V(0, 0, depth))
                for j in range(nc):
                    f = bm.faces.new((prev[j], prev[(j + 1) % nc], pole))
                    f.material_index = dome_mat
                break
            cur = [bm.verts.new(c + (grid[end][j] - c) * math.cos(t) + V(0, 0, depth * math.sin(t))) for j in range(nc)]
            for j in range(nc):
                f = bm.faces.new((prev[j], prev[(j + 1) % nc], cur[(j + 1) % nc], cur[j]))
                f.material_index = dome_mat
            prev = cur
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cut_opening(bm)
    loop = max(boundary_loops(bm), key=len)
    bm.normal_update()
    edge_pts = [v.co.copy() for v in loop]
    edge_ups = [v.normal.copy() for v in loop]
    hull = Part("Wren_Hull", "Body", sharp=36, weighted=False)
    hull.add(bm, None, recalc=False, keys=["hull", "dark"])
    return edge_pts, edge_ups


def build_opening_frame(edge_pts, edge_ups):
    """Gunmetal frame wrapped around the cut edge of the skin and the liner behind it."""
    pts, ups = [], []
    for p, n in zip(edge_pts, edge_ups):
        if pts and (p - pts[-1]).length < 0.05:
            continue
        pts.append(p)
        ups.append(n)
    if (pts[0] - pts[-1]).length < 0.05:
        pts.pop()
        ups.pop()
    # make b (profile x) point away from the opening: test with the first point
    rings = sweep_rings(pts, ups, [(0, 0), (1, 0)], closed=True)
    b0 = (rings[0][1] - rings[0][0])
    probe = pts[0] + b0 * 0.05
    sign = -1 if in_opening(probe) else 1
    prof = [(sign * x, y) for x, y in rrect(0.2, 0.17, 0.035, 2, cx=0.03, cy=-0.045)]
    if sign < 0:
        prof = list(reversed(prof))
    part = Part("OpeningFrame", "Body")
    sweep(part, "dark", pts, ups, prof, closed=True)


# ---- cargo bay interior -------------------------------------------------------------------------------

LINER_INSET = 0.06
BAY_Z0 = -2.2
BAY_Z1 = OPEN_Z1 - 0.03
LOCKER_Z = (-2.0, 3.9)


def build_liner():
    L = HULL
    rows = [z for z in (L.z_of_u(i / 90) for i in range(91)) if BAY_Z0 < z < BAY_Z1]
    rows = sorted(rows + [BAY_Z0, BAY_Z1, HINGE_Z, 2.0, 3.0, 5.4, 6.0, 7.0, 7.5, 8.0, 8.6, 9.2])
    angs = L.arc_angles(0.5, 64)
    grid = [[L.point(z, a, inset=LINER_INSET) for a in angs] for z in rows]
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in row] for row in grid]
    n = len(angs)
    for i in range(len(rows) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            bm.faces.new((vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j]))
    orient(bm, lambda c: L.centre(c.z) - c)
    cut_opening(bm)
    # Under the floor and behind the side lockers nothing is visible: drop it.
    dead = [f for f in bm.faces if (lambda c: (c.z < HINGE_Z and c.y < FLOOR_Y - 0.03) or
                                    (LOCKER_Z[0] < c.z < LOCKER_Z[1] and c.y < FLOOR_Y + 0.42 and abs(c.x) > 1.4))(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    part = Part("BayLiner", "Interior", sharp=0, weighted=False)
    part.add(bm, "dark", recalc=False)


def section_disc(z, inset, facing_z, clip_y=None):
    """Flat plate filling the hull section at z (inset), optionally only above y = clip_y."""
    L = HULL
    angs = L.arc_angles(z, 64)
    pts = [L.point(z, a, inset=inset) for a in angs]
    if clip_y is not None:
        out = []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            if a.y >= clip_y:
                out.append(a)
            if (a.y - clip_y) * (b.y - clip_y) < 0:
                t = (clip_y - a.y) / (b.y - a.y)
                out.append(a.lerp(b, t))
        pts = out
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bm.faces.new(vs)
    orient(bm, lambda c: V(0, 0, facing_z))
    return bm


def build_bay():
    L = HULL
    inner = Part("BayStructure", "Interior")
    detail = Part("BayDetail", "Interior")
    # Floor: a structural slab with tread plates (gaps between them read as seams) and tie-down rails.
    z_edges = [BAY_Z0 + k * (HINGE_Z - BAY_Z0) / 6 for k in range(7)]
    for k in range(6):
        za, zb = z_edges[k], z_edges[k + 1]
        hw = min((L.half_width(z, FLOOR_Y + 0.01, LINER_INSET) or 1.5) for z in (za, (za + zb) / 2, zb)) - 0.02
        box(inner, "dark", V(0, FLOOR_Y - 0.08, (za + zb) / 2), (2 * hw, 0.14, zb - za), r=0.01, segs=1)
        box(detail, "metal", V(0, FLOOR_Y - 0.01, (za + zb) / 2), (2 * hw - 0.08, 0.02, zb - za - 0.03), r=0.006, segs=1)
    for x in (-1.0, -0.35, 0.35, 1.0):
        box(detail, "metal", V(x, FLOOR_Y + 0.008, (BAY_Z0 + HINGE_Z) / 2 + 0.1), (0.07, 0.022, HINGE_Z - BAY_Z0 - 0.4), r=0.006, segs=1)
        for z in [BAY_Z0 + 0.5 + i * 1.1 for i in range(6)]:
            cyl(detail, "dark", V(x, FLOOR_Y + 0.02, z), 0.045, 0.02, segs=8)
    # Hinge beam across the rear edge of the floor.
    box(inner, "dark", V(0, FLOOR_Y - 0.09, HINGE_Z - 0.1), (2 * OPEN_X + 0.2, 0.2, 0.3), r=0.04, segs=2)

    # Side lockers / troop benches along both walls.
    for s in (-1, 1):
        z0, z1 = LOCKER_Z
        hwall = min((L.half_width(z, FLOOR_Y + 0.25, LINER_INSET) or 1.8) for z in (z0, (z0 + z1) / 2, z1))
        xi = 1.34
        box(inner, "dark", V(s * (xi + hwall) / 2, FLOOR_Y + 0.22, (z0 + z1) / 2), (hwall - xi + 0.04, 0.44, z1 - z0), r=0.03)
        for k in range(5):
            zc = z0 + 0.4 + k * (z1 - z0 - 0.8) / 4
            box(detail, "metal", V(s * (xi - 0.005), FLOOR_Y + 0.22, zc), (0.02, 0.32, 0.9), r=0.006, segs=1)
            box(detail, "hazard", V(s * (xi - 0.02), FLOOR_Y + 0.33, zc + 0.36), (0.025, 0.05, 0.1), r=0.008, segs=1)
        # Seat pads and back cushions on the wall.
        for k in range(6):
            zc = z0 + 0.45 + k * (z1 - z0 - 0.9) / 5
            box(detail, "dark", V(s * (xi + 0.24), FLOOR_Y + 0.48, zc), (0.46, 0.08, 0.5), r=0.03, segs=2)
            yb = FLOOR_Y + 0.85
            xb = (L.half_width(zc, yb, LINER_INSET) or 1.9) - 0.06
            box(detail, "dark", V(s * xb, yb, zc), (0.08, 0.5, 0.46), r=0.03, segs=2)
            # Harness straps.
            box(detail, "hazard", V(s * (xb - 0.05), yb + 0.05, zc - 0.12), (0.012, 0.55, 0.05), r=0.004, segs=1)
            box(detail, "hazard", V(s * (xb - 0.05), yb + 0.05, zc + 0.12), (0.012, 0.55, 0.05), r=0.004, segs=1)

    # Ring frames: the hull's ribs, standing 10 cm proud of the liner.
    zr = BAY_Z0 + 0.45
    while zr < BAY_Z1 - 0.2:
        angs = [a for a in L.arc_angles(zr, 52)]
        angs.sort()
        pts = [L.point(zr, a, inset=LINER_INSET) for a in angs]
        ok = []
        for p in pts:
            low = FLOOR_Y + 0.46 if (LOCKER_Z[0] < zr < LOCKER_Z[1]) else FLOOR_Y
            good = p.y > low and not in_opening(p, 0.12)
            ok.append(good)
        # longest run of good points (the arch over the top)
        n = len(pts)
        best, cur = [], []
        start = ok.index(False) if False in ok else 0
        for k in range(n + 1):
            idx = (start + k) % n
            if ok[idx]:
                cur.append(idx)
            else:
                if len(cur) > len(best):
                    best = cur
                cur = []
        if len(cur) > len(best):
            best = cur
        if len(best) > 4:
            path = [pts[i] for i in best]
            ups = [(L.centre(zr) - p).normalized() for p in path]
            ups = [V(u.x, u.y, 0).normalized() for u in ups]
            sweep(inner, "dark", path, ups, rrect(0.14, 0.11, 0.02, 1, cy=0.045), closed=False, caps=True)
        zr += 0.9

    # Ceiling strip lights in housings, following the liner roof.
    for s in (-1, 1):
        zs = [BAY_Z0 + 0.3 + k * 0.5 for k in range(int((BAY_Z1 - BAY_Z0 - 0.6) / 0.5) + 1)]
        xs = s * 0.75
        path = [V(xs, L.top(z, xs) - LINER_INSET - 0.2, z) for z in zs]
        tube_path = path
        ups = [V(0, -1, 0)] * len(path)
        sweep(detail, "dark", tube_path, ups, rrect(0.2, 0.07, 0.02, 1, cy=0.0), caps=True)
        sweep(detail, "lamp", tube_path, ups, rrect(0.11, 0.03, 0.01, 1, cy=0.03), caps=True)
        # Cable trays along the roof.
        xt = s * 1.35
        path = [V(xt, L.top(z, xt) - LINER_INSET - 0.16, z) for z in zs]
        sweep(detail, "metal", path, ups, rrect(0.24, 0.07, 0.015, 1), caps=True)

    # Forward bulkhead with the flight-deck door, and the short aft bulkhead above the opening.
    inner.add(section_disc(BAY_Z0, LINER_INSET - 0.01, 1.0), "dark", recalc=False)
    box(detail, "dark", V(0, FLOOR_Y + 1.05, BAY_Z0 + 0.05), (1.3, 2.25, 0.1), r=0.03)
    box(detail, "metal", V(0, FLOOR_Y + 1.0, BAY_Z0 + 0.1), (1.0, 2.0, 0.06), r=0.02)
    for k in range(3):
        box(detail, "dark", V(0, FLOOR_Y + 0.45 + k * 0.6, BAY_Z0 + 0.14), (0.8, 0.06, 0.03), r=0.01, segs=1)
    box(detail, "lamp", V(0, FLOOR_Y + 2.2, BAY_Z0 + 0.12), (1.1, 0.04, 0.04), r=0.01, segs=1)
    box(detail, "lamp", V(0.85, FLOOR_Y + 1.5, BAY_Z0 + 0.1), (0.22, 0.14, 0.04), r=0.01, segs=1)
    box(detail, "dark", V(-1.05, FLOOR_Y + 1.35, BAY_Z0 + 0.12), (0.5, 0.8, 0.14), r=0.03)
    box(detail, "hazard", V(-1.05, FLOOR_Y + 1.7, BAY_Z0 + 0.2), (0.4, 0.05, 0.02), r=0.005, segs=1)
    inner.add(section_disc(BAY_Z1, LINER_INSET - 0.01, -1.0, clip_y=cut_top(BAY_Z1) + 0.02), "dark", recalc=False)
    # Work lights over the opening, on the aft bulkhead.
    for s in (-1, 1):
        y = cut_top(BAY_Z1) + 0.12
        box(detail, "dark", V(s * 0.75, y, BAY_Z1 - 0.12), (0.6, 0.14, 0.22), r=0.03)
        box(detail, "lamp", V(s * 0.75, y - 0.07, BAY_Z1 - 0.12), (0.5, 0.02, 0.14), r=0.005, segs=1)

    # Strapped cargo.
    box(detail, "dark", V(-0.75, FLOOR_Y + 0.45, -1.2), (1.2, 0.9, 1.0), r=0.04)
    box(detail, "hazard", V(-0.8, FLOOR_Y + 1.25, -1.2), (1.0, 0.7, 0.8), r=0.04)
    box(detail, "hazard", V(0.85, FLOOR_Y + 0.3, 0.3), (0.8, 0.6, 1.4), r=0.04)
    box(detail, "dark", V(0.85, FLOOR_Y + 0.3, 0.3), (0.82, 0.08, 1.42), r=0.02, segs=1)
    for z in (-1.55, -0.85):
        box(detail, "hazard", V(-0.75, FLOOR_Y + 0.82, z), (1.26, 0.04, 0.06), r=0.01, segs=1)
    for z in (-0.1, 0.7):
        box(detail, "dark", V(0.85, FLOOR_Y + 0.61, z), (0.86, 0.025, 0.06), r=0.008, segs=1)


# ---- canopy ---------------------------------------------------------------------------------------

def z_front(a):
    return -10.25 + 0.55 * abs(math.cos(a)) ** 1.5


def z_rear(a):
    return -6.9 + 0.75 * abs(math.cos(a)) ** 1.2


CAN_A0 = 0.065 * TAU
CAN_A1 = 0.435 * TAU


def build_canopy():
    L = HULL
    glass = Part("Canopy", "Body", sharp=0, weighted=False)

    def f(u, v):
        a = CAN_A0 + (CAN_A1 - CAN_A0) * v
        z = z_front(a) + (z_rear(a) - z_front(a)) * u
        return L.point(z, a, off=0.03)

    bm = bm_grid(f, 18, 28)
    orient(bm, lambda c: c - L.centre(c.z))
    glass.add(bm, "glass", recalc=False)

    frame = Part("CanopyFrame", "Body")

    def line(fn, n, w):
        pts = [fn(i / n) for i in range(n + 1)]
        path = [L.point(z, a) for z, a in pts]
        ups = [L.normal(z, a) for z, a in pts]
        sweep(frame, "dark", path, ups, rrect(w, 0.11, 0.03, 2, cy=0.03), caps=True)

    def zt(a, t):
        return z_front(a) + (z_rear(a) - z_front(a)) * t

    line(lambda t: (zt(CAN_A0 + (CAN_A1 - CAN_A0) * t, 0.0), CAN_A0 + (CAN_A1 - CAN_A0) * t), 28, 0.15)
    line(lambda t: (zt(CAN_A0 + (CAN_A1 - CAN_A0) * t, 1.0), CAN_A0 + (CAN_A1 - CAN_A0) * t), 28, 0.17)
    for fr in (0.0, 0.25, 0.5, 0.75, 1.0):
        a = CAN_A0 + (CAN_A1 - CAN_A0) * fr
        line(lambda t, a=a: (zt(a, t), a), 14, 0.17 if fr in (0.0, 1.0) else 0.1)
    line(lambda t: (zt(CAN_A0 + (CAN_A1 - CAN_A0) * t, 0.5), CAN_A0 + (CAN_A1 - CAN_A0) * t), 28, 0.08)

    # Matte anti-glare panel ahead of the windshield and the gunmetal nose cap ring.
    def g(u, v):
        a = PI / 2 + (v - 0.5) * 0.9
        z = -10.6 + (z_front(a) - 0.1 + 10.6) * u
        return L.point(z, a, off=0.012)

    bm = bm_grid(g, 6, 12)
    orient(bm, lambda c: c - L.centre(c.z))
    ag = Part("AntiGlare", "Body", sharp=0, weighted=False)
    ag.add(bm, "dark", recalc=False)


# ---- nacelles -------------------------------------------------------------------------------------------

NAC_RING_SEAMS = [(1.5, -PI / 2, 1.5 * PI), (3.4, -PI / 2, 1.5 * PI), (5.6, D(-40), D(220)), (7.6, -PI / 2, 1.5 * PI),
                  (9.2, -PI / 2, 1.5 * PI)]
NAC_LONG_SEAMS = [(D(40), 1.5, 9.2), (D(140), 1.5, 9.2), (D(-55), 1.5, 7.6), (D(235), 1.5, 7.6), (D(90), 3.4, 7.6)]
NAC_SPLIT = (-0.06 * TAU, 0.56 * TAU)


def build_nacelle(side):
    nx, ny = side * WREN["nacelleX"], WREN["nacelleY"]
    L = Loft(NAC, nx, ny)
    z0, z1 = WREN["nacelleZ0"], WREN["nacelleZ1"]
    rows, angs = panel_grid(L, 44, 56, z0, z1, NAC_RING_SEAMS, NAC_LONG_SEAMS, extra_a=list(NAC_SPLIT), ref_z=3.4)
    grid = skin_grid(L, rows, angs, NAC_RING_SEAMS, NAC_LONG_SEAMS)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in row] for row in grid]
    nc = len(angs)
    for i in range(len(rows) - 1):
        for j in range(nc):
            j2 = (j + 1) % nc
            f = bm.faces.new((vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j]))
            a0, a1 = angs[j], (angs[j2] if j2 else angs[0] + TAU)
            ac = norm_a((a0 + a1) / 2)
            f.material_index = 0 if NAC_SPLIT[0] - 1e-4 <= ac <= NAC_SPLIT[1] + 1e-4 else 1
    orient(bm, lambda c: c - L.centre(c.z))
    skin = Part(f"NacelleSkin{side}", "Body", sharp=36, weighted=False)
    skin.add(bm, None, recalc=False, keys=["hull", "dark"])

    nac = Part(f"Nacelle{side}", "Body")
    C = Matrix.Translation((nx, ny, 0))
    intake = C @ T(0, 0, z0 + 0.02, -PI / 2, 0, 0)  # lathe +Y -> ship -Z (forward)
    lathe(nac, "hazard", intake, [(0.62, -0.1), (0.84, -0.06), (0.92, 0.06), (0.84, 0.2), (0.7, 0.24), (0.6, 0.12),
                                  (0.6, -0.08), (0.62, -0.1)], 40)
    lathe(nac, "dark", intake, [(0.6, -0.5), (0.74, -0.5), (0.74, -0.02), (0.6, -0.02), (0.6, -0.5)], 40)
    cyl(nac, "dark", C @ T(0, 0, z0 + 0.42, PI / 2, 0, 0), 0.74, 0.06, segs=40)
    lathe(nac, "metal", C @ T(0, 0, z0 + 0.36, -PI / 2, 0, 0), [(0, 0.0), (0.24, 0.0), (0.23, 0.1), (0.15, 0.28), (0.06, 0.38), (0, 0.4)], 20)
    blades = Part(f"Fan{side}", "Body", sharp=40)
    for i in range(16):
        a = i / 16 * TAU
        box(blades, "metal", C @ T(math.cos(a) * 0.42, math.sin(a) * 0.42, z0 + 0.33, 0, 0, a - PI / 2) @ T(0, 0, 0, 0.0, 0.45, 0),
            (0.05, 0.38, 0.15), r=0.01, segs=1)
    # Nozzle: bell, cold turbine cone, aft trim ring and petals.
    nz = z1
    lathe(nac, "metal", C @ T(0, 0, nz - 0.08, PI / 2, 0, 0), [(0.76, 0), (0.74, 0.25), (0.7, 0.62), (0.66, 0.66), (0.6, 0.6),
                                                             (0.58, 0.1), (0.6, 0), (0.76, 0)], 40)
    lathe(nac, "dark", C @ T(0, 0, nz + 0.12, PI / 2, 0, 0), [(0, -0.04), (0.57, -0.04), (0.57, 0.0), (0.35, 0.14), (0.08, 0.26), (0, 0.27)], 32)
    lathe(nac, "dark", C @ T(0, 0, nz, PI / 2, 0, 0), [(0.62, -0.18), (0.84, -0.18), (0.87, -0.14), (0.87, 0.04), (0.83, 0.08),
                                                      (0.62, 0.08), (0.62, -0.18)], 40)
    petals = Part(f"Petals{side}", "Body", sharp=40)
    for i in range(20):
        a = (i + 0.5) / 20 * TAU
        box(petals, "metal", C @ T(math.cos(a) * 0.735, math.sin(a) * 0.735, nz + 0.3, 0, 0, a) @ T(0, 0, 0, 0, -0.15, 0),
            (0.03, 0.25, 0.56), r=0.01, segs=1)
    # Hazard band behind the intake and a heat band before the nozzle.
    for zb, key in ((z0 + 0.95, "hazard"), (nz - 0.55, "dark")):
        ring = [L.point(zb, a, off=0.004) for a in L.arc_angles(zb, 48)]
        ring2 = [L.point(zb + 0.22, a, off=0.004) for a in L.arc_angles(zb + 0.22, 48)]
        nrm_out = [(p - L.centre(zb)).normalized() * 0.012 for p in ring]
        rings = [[p - n for p, n in zip(ring, nrm_out)], [p + n for p, n in zip(ring, nrm_out)],
                 [p + n for p, n in zip(ring2, nrm_out)], [p - n for p, n in zip(ring2, nrm_out)]]
        bmr = bmesh.new()
        vv = [[bmr.verts.new(p) for p in r] for r in rings]
        m = len(ring)
        for k in range(4):
            a_, b_ = vv[k], vv[(k + 1) % 4]
            for i in range(m):
                j = (i + 1) % m
                bmr.faces.new((a_[i], a_[j], b_[j], b_[i]))
        nac.add(bmr, key)

    # Tilt-pivot boss where the pylon enters (the nacelles swivel for VTOL), bolt ring and hub.
    hx = nx - side * 1.12
    piv = T(hx, ny + 0.27, 4.75, 0, 0, PI / 2)
    cyl(nac, "dark", piv, 0.52, 0.34, segs=32, bevel=0.04, bsegs=2)
    cyl(nac, "metal", piv @ T(0, side * 0.19, 0), 0.3, 0.06, segs=24, bevel=0.015)
    for i in range(10):
        a = i / 10 * TAU
        cyl(nac, "metal", piv @ T(math.cos(a) * 0.42, side * 0.18, math.sin(a) * 0.42), 0.035, 0.04, segs=6)
    # Structural band (engine mount ring) behind the pivot.
    zb = 7.0
    ring = [L.point(zb, a) for a in L.arc_angles(zb, 48)]
    ring2 = [L.point(zb + 0.16, a) for a in L.arc_angles(zb + 0.16, 48)]
    ctr = L.centre(zb)
    rs = []
    for (p_, q_), off in (((ring, ring), -0.01), ((ring, ring), 0.035), ((ring2, ring2), 0.035), ((ring2, ring2), -0.01)):
        rs.append([p + (p - ctr).normalized() * off for p in p_])
    bmr = bmesh.new()
    vv = [[bmr.verts.new(p) for p in r_] for r_ in rs]
    for k in range(4):
        a_, b_ = vv[k], vv[(k + 1) % 4]
        for i in range(48):
            j = (i + 1) % 48
            bmr.faces.new((a_[i], a_[j], b_[j], b_[i]))
    nac.add(bmr, "dark")

    # Top cooling vents, access hatch, side panel and the navigation light.
    def onn(z, ang, off=0.0):
        return facing(L.point(z, ang, off), L.normal(z, ang))

    grille = onn(4.9, PI / 2, 0.0)
    box(nac, "dark", grille @ T(0, 0, 0.0), (0.95, 1.05, 0.06), r=0.025)
    for k in range(7):
        box(nac, "metal", grille @ T(0, -0.42 + k * 0.14, 0.04, 0.5, 0, 0), (0.85, 0.08, 0.02), r=0.006, segs=1)
    box(nac, "hull", onn(2.3, PI / 2) @ T(0, 0, 0.012), (1.0, 1.15, 0.04), r=0.015)
    box(nac, "dark", onn(1.7, PI / 2 + side * -1.0) @ T(0, 0, 0.01), (0.5, 0.5, 0.05), r=0.015)
    for k in range(4):
        box(nac, "hull", onn(6.4 + k * 0.5, PI / 2 + side * -0.45) @ T(0, 0, 0.012), (0.36, 0.3, 0.03), r=0.01, segs=1)
    navm = onn(1.0, 0.12 if side > 0 else PI - 0.12)
    cyl(nac, "dark", navm @ T(0, 0, 0.03, PI / 2, 0, 0), 0.11, 0.08, segs=12, bevel=0.015)
    sphere(nac, "lamp", navm @ T(0, 0, 0.08), 0.075, 12, 8, scale=(1, 1, 0.8))
    # Exhaust-side heat shield on the inboard flank.
    box(nac, "metal", onn(8.4, PI if side > 0 else 0.0) @ T(0, 0, 0.012), (0.9, 0.5, 0.03), r=0.012, segs=1)
    return L


# ---- pylons, spine, fins ---------------------------------------------------------------------------------

def build_pylons():
    L = HULL
    part = Part("Pylons", "Body")
    x0, x1 = 1.6, WREN["nacelleX"] - 0.35

    def dims(t):
        return lerp(6.4, 5.4, t), lerp(0.74, 0.58, t), lerp(4.6, 4.9, t), lerp(2.98, 2.88, t), lerp(0.26, 0.2, t)

    def top_at(x):
        t = clamp((x - x0) / (x1 - x0), 0, 1)
        _, h, _, yc, _ = dims(t)
        return yc + h / 2

    for s in (-1, 1):
        rings = []
        for t in (0.0, 0.07, 0.3, 0.6, 1.0):
            length, h, zc, yc, r = dims(t)
            ring = []
            for zp, yp in rrect(length, h, r, 4, cx=zc, cy=yc):
                hw = L.half_width(zp, yp) or 1.2
                if t == 0.0:
                    x = hw - 0.035
                elif t < 0.1:
                    x = hw + 0.07
                else:
                    x = max(lerp(x0, x1, t), hw + 0.2)
                ring.append(V(s * x, yp, zp))
            rings.append(ring)
        bm = bm_rings(rings, cap0=True, cap1=True)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        for f in bm.faces:
            f.material_index = 1 if f.normal.y < -0.6 else 0
        part.add(bm, None, recalc=False, keys=["hull", "dark"])
        # Walkway stripes and a hatch on top.
        for xx in (2.45, 3.2):
            box(part, "hazard", V(s * xx, top_at(xx) + 0.008, 4.6), (0.08, 0.03, 4.6), r=0.008, segs=1)
        box(part, "hull", V(s * 2.85, top_at(2.85) + 0.012, 3.0), (0.5, 0.04, 0.9), r=0.012, segs=1)
        box(part, "dark", V(s * 2.85, top_at(2.85) + 0.012, 6.0), (0.5, 0.04, 0.7), r=0.012, segs=1)


def build_spine():
    L = HULL
    part = Part("Spine", "Body")
    z0, z1 = -5.4, 4.2
    zs = [z0 + (z1 - z0) * k / 30 for k in range(31)]
    rings, top = [], {}
    for z in zs:
        e = min(sstep(z0, z0 + 0.9, z), 1 - sstep(z1 - 0.7, z1, z))
        w = lerp(0.7, 1.15, e)
        h = lerp(0.1, 0.42, e)
        yb = L.top(z, 0) - 0.03
        prof = rrect(w, h + 0.03, min(0.14, h / 2), 3, cy=yb + (h + 0.03) / 2)
        rings.append([V(px, py, z) for px, py in prof])
        top[z] = yb + h + 0.03
    part.add(bm_rings(rings), "dark")

    def ytop(z):
        return L.top(z, 0) + 0.42

    # Vent grilles, sensor dome, beacon, antenna mast.
    for zc in (-3.5, 2.3):
        box(part, "metal", V(0, ytop(zc) - 0.005, zc), (0.8, 0.03, 1.5), r=0.01, segs=1)
        for k in range(9):
            box(part, "dark", V(0, ytop(zc) + 0.015, zc - 0.6 + k * 0.15), (0.72, 0.03, 0.06), r=0.008, segs=1)
    lathe(part, "hull", V(0, ytop(0.3) - 0.02, 0.3), [(0, 0), (0.32, 0), (0.31, 0.1), (0.24, 0.24), (0.12, 0.31), (0, 0.33)], 24)
    cyl(part, "dark", V(0, ytop(3.6) + 0.02, 3.6), 0.13, 0.06, segs=16, bevel=0.01)
    cyl(part, "lamp", V(0, ytop(3.6) + 0.11, 3.6), 0.09, 0.14, segs=16, bevel=0.02, r1=0.07)
    cyl(part, "metal", V(0.3, ytop(-1.0) + 0.8, -1.0), 0.02, 1.6, segs=8, r1=0.012)
    cyl(part, "dark", V(0.3, ytop(-1.0) + 0.05, -1.0), 0.07, 0.1, segs=10, bevel=0.015)
    sphere(part, "dark", V(0.3, ytop(-1.0) + 1.62, -1.0), 0.04, 8, 6)
    box(part, "metal", V(-0.28, ytop(-2.0) + 0.02, -2.0), (0.36, 0.06, 0.6), r=0.02)
    # Blade antennas.
    for zc, x in ((-4.6, -0.3), (1.2, 0.32)):
        box(part, "dark", T(x, ytop(zc) + 0.18, zc, 0.35, 0, 0), (0.03, 0.36, 0.28), r=0.01, segs=1)


def naca(f):
    return 5 * (0.2969 * math.sqrt(f) - 0.126 * f - 0.3516 * f * f + 0.2843 * f ** 3 - 0.1036 * f ** 4)


def build_fins():
    L = HULL
    part = Part("Fins", "Body")
    for s in (-1, 1):
        roll = s * -0.42
        base_y = L.top(8.0, 0) - 0.12
        fm = T(s * 0.62, base_y, 0, 0, 0, roll)
        sr, cr_ = math.sin(roll), math.cos(roll)
        fs = [1 - math.cos(PI / 2 * k / 12) for k in range(13)]  # chord stations, dense at the LE
        rings = []
        for sp in (0.0, 0.15, 0.35, 0.55, 0.75, 0.9, 1.0):
            le = lerp(5.9, 9.2, sp)
            te = lerp(10.0, 10.95, sp)
            thick = lerp(0.24, 0.1, sp)
            top, bot = [], []
            for f in fs:
                z = lerp(le, te, f)
                half = thick * naca(max(f, 1e-4)) + 0.004
                if sp == 0.0:
                    ys = []
                    for xi in (half, -half):
                        x_w = s * 0.62 + xi * cr_
                        ys.append((L.top(z, x_w) - 0.035 - base_y - xi * sr) / cr_)
                    yt, yb = ys
                else:
                    yroot = (L.top(z, s * 0.62) - 0.035 - base_y) / cr_
                    yt = yb = lerp(yroot, lerp(2.45, 2.4, f), sp)
                top.append(V(half, yt, z))
                bot.append(V(-half, yb, z))
            rings.append([fm @ p for p in top + list(reversed(bot))])
        part.add(bm_rings(rings, cap0=True, cap1=True), "hull")
        tip = fm @ V(0, 2.47, 10.15)
        sphere(part, "lamp", tip, 0.06, 10, 6)
        box(part, "hazard", fm @ T(0, 2.41, 9.95), (0.13, 0.1, 1.5), r=0.035)
        # Rudder hinge line (75% chord), thinner toward the tip.
        for sp0, sp1 in ((0.08, 0.5), (0.5, 0.9)):
            pts = []
            for sp in (sp0, sp1):
                le, te = lerp(5.9, 9.2, sp), lerp(10.0, 10.95, sp)
                yroot = (L.top(lerp(le, te, 0.75), s * 0.62) - 0.035 - base_y) / cr_
                pts.append(V(0, lerp(yroot, 2.42, sp), lerp(le, te, 0.75)))
            thick = lerp(0.24, 0.1, (sp0 + sp1) / 2) * naca(0.75) * 2 + 0.012
            m, length = between(pts[0], pts[1])
            box(part, "dark", fm @ m, (0.025, length, thick), r=0.004, segs=1)
        # Root fillet strip and static dischargers.
        for k in range(3):
            cyl(part, "dark", fm @ T(0, 2.3 - k * 0.5, 10.75 - k * 0.15, PI / 2, 0, 0), 0.008, 0.25, segs=6)


# ---- hull greebles ------------------------------------------------------------------------------------

def on_hull(z, deg, off=0.0):
    a = D(deg)
    return facing(HULL.point(z, a, off), HULL.normal(z, a))


def build_greebles():
    L = HULL
    g = Part("HullDetail", "Body")
    # Raised access panels (doublers).
    for z, deg, w, h in [(-5.0, 144, 1.0, 0.55), (2.6, 40, 1.2, 0.45), (2.6, 140, 1.2, 0.45),
                         
                         (-7.4, 160, 0.6, 0.4), (5.6, 60, 0.9, 0.6), (5.6, 120, 0.9, 0.6), (-1.0, 270, 1.2, 0.8),
                         (2.2, 250, 0.8, 0.6), (2.2, 290, 0.8, 0.6)]:
        box(g, "hull" if (SPLIT_A0 <= norm_a(D(deg)) <= SPLIT_A1) else "dark", on_hull(z, deg) @ T(0, 0, 0.012), (w, h, 0.04), r=0.015)
    # RCS thruster quads at nose and tail.
    for z, deg in ((-8.6, 12), (-8.6, 168), (7.4, 22), (7.4, 158)):
        m = on_hull(z, deg) @ T(0, 0, 0.06)
        box(g, "dark", m, (0.44, 0.32, 0.16), r=0.04)
        for ox, oy in ((-0.11, 0.07), (0.11, 0.07), (0.0, -0.08)):
            lathe(g, "metal", m @ T(ox, oy, 0.07, PI / 2, 0, 0), [(0, 0), (0.05, 0), (0.06, 0.07), (0.045, 0.075), (0.035, 0.02), (0, 0.02)], 10)
    # Grab handles beside the cockpit (yellow).
    for deg in (14, 166):
        m = on_hull(-6.0, deg)
        for ox in (-0.32, 0.32):
            box(g, "hazard", m @ T(ox, 0, 0.05), (0.04, 0.04, 0.1), r=0.01, segs=1)
        box(g, "hazard", m @ T(0, 0, 0.1), (0.7, 0.04, 0.04), r=0.015, segs=1)

    def vent(m, w=1.15, h=0.7, n=8):
        box(g, "dark", m, (w, h, 0.05), r=0.02)
        for k in range(n):
            box(g, "metal", m @ T(-w / 2 + 0.08 + k * (w - 0.16) / (n - 1), 0, 0.03, 0, 0.5, 0), (0.025, h - 0.12, 0.07), r=0.006, segs=1)

    # Recessed side vents behind the cockpit, a second one on the port side where the hatch is to starboard.
    for deg in (8, 172):
        vent(on_hull(-2.4, deg))
    vent(on_hull(-4.8, 176), 0.9, 0.9, 6)
    # Portholes in the bay sides.
    for deg in (9, 171):
        for z in (-1.2, -0.3, 0.6):
            m = on_hull(z, deg)
            cyl(g, "dark", m @ T(0, 0, 0.02, PI / 2, 0, 0), 0.2, 0.07, segs=20, bevel=0.02)
            cyl(g, "glass", m @ T(0, 0, 0.05, PI / 2, 0, 0), 0.14, 0.03, segs=20)
    # Conduit runs along the upper flanks, clamped every 0.6 m, ending in junction boxes.
    for deg in (28.5, 151.5):
        for k, da in enumerate((-1.3, 1.3)):
            a = D(deg + da)
            path = [L.point(z, a, off=0.07) for z in [-3.5 + i * 0.3 for i in range(16)]]
            tube(g, "dark" if k == 0 else "metal", path, 0.04, 8)
        for i in range(8):
            z = -3.2 + i * 0.6
            box(g, "dark", on_hull(z, deg) @ T(0, 0, 0.06), (0.12, 0.3, 0.07), r=0.015, segs=1)
        for z in (-3.65, 1.1):
            box(g, "dark", on_hull(z, deg) @ T(0, 0, 0.06), (0.36, 0.42, 0.14), r=0.03)
            box(g, "hazard", on_hull(z, deg) @ T(0, 0.12, 0.13), (0.2, 0.06, 0.02), r=0.006, segs=1)
    # Tail light and rear RCS on the tail cone.
    tz = FUSE[-1][0] + 0.06
    cyl(g, "dark", T(0, L.centre(tz).y + 0.02, tz + 0.02, PI / 2, 0, 0), 0.12, 0.1, segs=14, bevel=0.02)
    cyl(g, "lamp", T(0, L.centre(tz).y + 0.02, tz + 0.08, PI / 2, 0, 0), 0.08, 0.04, segs=14)
    # Non-slip walkway pads either side of the dorsal spine, and an escape hatch behind the canopy.
    for sx in (-1, 1):
        for za, zb in ((-5.2, -1.9), (-1.5, 1.6), (2.0, 4.3)):
            x = sx * 1.02
            zc = (za + zb) / 2
            box(g, "dark", V(x, L.top(zc, x) + 0.004, zc), (0.42, 0.02, zb - za), r=0.006, segs=1)
            box(g, "hazard", V(x + sx * 0.24, L.top(zc, x + sx * 0.24) + 0.006, zc), (0.04, 0.02, zb - za), r=0.005, segs=1)
    hz = -5.85
    yh = L.top(hz, 0.75)
    cyl(g, "dark", V(0.75, yh + 0.01, hz), 0.38, 0.05, segs=24, bevel=0.015)
    cyl(g, "hull", V(0.75, yh + 0.03, hz), 0.31, 0.04, segs=24, bevel=0.012)
    box(g, "hazard", V(0.75, yh + 0.06, hz), (0.36, 0.035, 0.05), r=0.01, segs=1)
    # Crew hatch on the starboard flank, forward (outline frame + handle + step).
    m = on_hull(-4.8, 4)
    hatch = [(-0.55, -0.95), (0.55, -0.95), (0.55, 0.95), (-0.55, 0.95)]
    for (x0, y0), (x1, y1) in zip(hatch, hatch[1:] + hatch[:1]):
        box(g, "dark", m @ T((x0 + x1) / 2, (y0 + y1) / 2, 0.012), (abs(x1 - x0) + 0.08, abs(y1 - y0) + 0.08, 0.035), r=0.012, segs=1)
    box(g, "hazard", m @ T(0.38, 0.1, 0.035), (0.06, 0.3, 0.04), r=0.01, segs=1)
    box(g, "dark", m @ T(0, -1.2, 0.16), (0.8, 0.06, 0.28), r=0.02)
    box(g, "lamp", m @ T(0, 1.08, 0.03), (0.3, 0.05, 0.03), r=0.008, segs=1)
    # Ground-power socket on the port flank where the pad's umbilical plugs in.
    u = UMBILICAL
    box(g, "dark", V(u.x - 0.06, u.y, u.z), (0.18, 0.4, 0.4), r=0.03)
    cyl(g, "metal", T(u.x - 0.15, u.y, u.z, 0, 0, PI / 2), 0.09, 0.06, segs=14, bevel=0.01)
    box(g, "hazard", V(u.x - 0.15, u.y + 0.25, u.z), (0.05, 0.08, 0.3), r=0.01, segs=1)
    # Pitot probes on the nose.
    for s in (-1, 1):
        p = L.point(-10.1, D(10) if s > 0 else D(170))
        cyl(g, "dark", T(p.x, p.y, p.z - 0.02, PI / 2, 0, 0), 0.04, 0.14, segs=8, bevel=0.01)
        cyl(g, "metal", T(p.x, p.y, p.z - 0.3, PI / 2, 0, 0), 0.012, 0.5, segs=6)
    # Chin sensor ball and landing lights.
    yb = L.bottom(-9.2, 0)
    cyl(g, "dark", V(0, yb - 0.02, -9.2), 0.36, 0.14, segs=24, bevel=0.03)
    sphere(g, "glass", V(0, yb - 0.17, -9.2), 0.3, 20, 12)
    for s in (-1, 1):
        y = L.bottom(-8.4, s * 0.6)
        cyl(g, "dark", V(s * 0.6, y - 0.03, -8.4), 0.15, 0.12, segs=16, bevel=0.025)
        cyl(g, "lamp", V(s * 0.6, y - 0.09, -8.4), 0.11, 0.02, segs=16)
    # Belly lift thrusters (cold), belly blade antenna, belly beacon.
    for s in (-1, 1):
        x, z = s * 1.15, -5.2
        y = L.bottom(z, x)
        lathe(g, "metal", V(x, y + 0.02, z), [(0, -0.05), (0.28, -0.05), (0.3, -0.24), (0.36, -0.22), (0.4, -0.1), (0.42, 0.0), (0, 0)], 24)
        cyl(g, "dark", V(x, y - 0.16, z), 0.27, 0.02, segs=20)
    box(g, "dark", T(0, L.bottom(-2.5, 0) - 0.16, -2.5, -0.3, 0, 0), (0.04, 0.4, 0.45), r=0.012, segs=1)
    cyl(g, "dark", V(0, L.bottom(0.5, 0) - 0.01, 0.5), 0.12, 0.05, segs=14, bevel=0.01)
    cyl(g, "lamp", V(0, L.bottom(0.5, 0) - 0.06, 0.5), 0.08, 0.08, segs=14, bevel=0.015)
    # Hull chine rails (hazard), from the nose to where the cargo opening starts.
    for a in (SPLIT_A0, SPLIT_A1):
        pts, ups = [], []
        z = -9.2
        while z <= 8.6:
            p = L.point(z, a)
            if in_opening(p, 0.15):
                break
            pts.append(p)
            ups.append(L.normal(z, a))
            z += 0.3
        sweep(g, "hazard", pts, ups, rrect(0.1, 0.07, 0.025, 2, cy=0.01), caps=True)
    # Keel strake under the nose gear bay and gear bay doors framing.
    return g


# ---- landing gear -----------------------------------------------------------------------------------------

def gear_leg(part, gx, gz, top_y, twin):
    xs = [-0.34, 0.34] if twin else [0.0]
    ro = 0.13 if twin else 0.17
    ri = 0.09 if twin else 0.115
    for ox in xs:
        x = gx + ox
        cyl(part, "dark", V(x, (top_y + 0.7) / 2 + 0.05, gz), ro, top_y - 0.7, segs=18, bevel=0.025)
        cyl(part, "hazard", V(x, 0.92 + (top_y - 0.7) * 0.35, gz), ro + 0.008, 0.12, segs=18, bevel=0.01)
        cyl(part, "metal", V(x, 0.58, gz), ri, 0.62, segs=16, bevel=0.01)
        cyl(part, "dark", V(x, 0.82, gz), ro + 0.035, 0.12, segs=18, bevel=0.025)
        sphere(part, "dark", V(x, 0.26, gz), ro - 0.02, 14, 8)
        # Torque links (scissor) on the front.
        box(part, "dark", T(x, 0.68, gz - 0.19, -0.5, 0, 0), (0.07, 0.36, 0.08), r=0.02, segs=1)
        box(part, "dark", T(x, 0.42, gz - 0.19, 0.5, 0, 0), (0.07, 0.36, 0.08), r=0.02, segs=1)
        cyl(part, "metal", T(x, 0.55, gz - 0.27, 0, 0, PI / 2), 0.035, 0.12, segs=10)
        # Hydraulic line.
        tube(part, "dark", [V(x + 0.18, top_y, gz + 0.08), V(x + 0.2, 1.05, gz + 0.1), V(x + 0.15, 0.55, gz + 0.12),
                            V(x + 0.11, 0.34, gz + 0.1)], 0.02, 6)
    if twin:
        box(part, "dark", V(gx, 0.1, gz), (1.25, 0.16, 0.8), r=0.05)
        box(part, "dark", V(gx, 0.25, gz), (0.92, 0.14, 0.42), r=0.04)
        box(part, "hazard", V(gx, 0.1, gz - 0.405), (1.15, 0.08, 0.02), r=0.008, segs=1)
    else:
        lathe(part, "dark", V(gx, 0.0, gz), [(0, 0.0), (0.64, 0.0), (0.64, 0.08), (0.58, 0.14), (0.28, 0.24), (0.2, 0.3), (0, 0.3)], 32)
        cyl(part, "metal", V(gx, 0.015, gz), 0.66, 0.03, segs=32)


def build_gear():
    L = HULL
    part = Part("Gear", "Gear")
    for s in (-1, 1):
        gx, gz = s * WREN["nacelleX"], WREN["mainGearZ"]
        top_y = WREN["nacelleY"] - 0.95
        gear_leg(part, gx, gz, top_y, False)
        strut(part, "dark", V(gx - s * 0.75, 1.92, gz), V(gx, 0.92, gz), 0.07, 10, 0.01)
        strut(part, "dark", V(gx, 1.78, gz - 1.2), V(gx, 0.98, gz), 0.07, 10, 0.01)
        cyl(part, "metal", T(gx, 0.95, gz, 0, 0, PI / 2), 0.06, 0.4, segs=10)
        for d in (-1, 1):
            box(part, "dark", T(gx + d * 0.52, 1.5, gz - 0.2, 0, 0, d * 0.35), (0.05, 0.62, 1.5), r=0.02, segs=1)
    top_y = L.bottom(WREN["noseGearZ"], 0.34) + 0.12
    gz = WREN["noseGearZ"]
    gear_leg(part, 0.0, gz, top_y, True)
    strut(part, "dark", V(0, L.bottom(gz - 0.9, 0) + 0.1, gz - 0.9), V(0, 0.85, gz), 0.06, 10, 0.01)
    for d in (-1, 1):
        hinge = L.bottom(gz - 0.3, 0.62) + 0.04
        box(part, "dark", T(d * 0.64, hinge - 0.27 * math.cos(0.25), gz - 0.3, 0, 0, d * 0.25), (0.04, 0.55, 1.2), r=0.015, segs=1)


# ---- cargo ramp --------------------------------------------------------------------------------------------

def build_ramp():
    hinge = V(0, FLOOR_Y, HINGE_Z)
    rl = WREN["rampLength"]
    rw = WREN["rampWidth"]
    lip_top = 0.04
    theta = math.atan2(FLOOR_Y - lip_top, math.sqrt(rl * rl - (FLOOR_Y - lip_top) ** 2))
    M = Matrix.Translation(hinge) @ Matrix.Rotation(theta, 4, "X")  # local +Z runs down the ramp, +Y up off the deck
    part = Part("Wren_Ramp", "Ramp")
    # Deck plate tapering from a thick hinge end to a thin toe resting on the pad.
    rings = []
    for z, t in ((0.0, 0.3), (0.12, 0.3), (3.8, 0.16), (4.75, 0.08), (rl - 0.04, 0.045), (rl, 0.04)):
        prof = rrect(rw, t, min(0.03, t / 2 - 0.002), 2, cy=-t / 2)
        rings.append([M @ V(px, py, z) for px, py in prof])
    part.add(bm_rings(rings), "dark")
    # Tread plates and anti-slip bars.
    box(part, "metal", M @ T(0, 0.006, rl / 2 - 0.05), (rw - 0.42, 0.016, rl - 0.5), r=0.005, segs=1)
    for k in range(16):
        box(part, "metal", M @ T(0, 0.026, 0.3 + k * 0.29), (rw - 0.6, 0.03, 0.06), r=0.01, segs=1)
    # Side curbs: hazard yellow with dark diagonal bands, small edge lamps.
    for s in (-1, 1):
        cx = s * (rw / 2 - 0.08)
        box(part, "hazard", M @ T(cx, 0.08, (rl - 0.25) / 2 + 0.05), (0.14, 0.16, rl - 0.35), r=0.025)
        hazard_stripes(part, M @ frame((0, 0, 1), (0, 1, 0), (cx, 0.16, 0.14)), rl - 0.5, 0.1, stripe=0.2)
        hazard_stripes(part, M @ frame((0, 0, 1), (s, 0, 0), (cx + s * 0.07, 0.08, 0.14)), rl - 0.5, 0.12, stripe=0.2)
        for k in range(3):
            box(part, "lamp", M @ T(cx - s * 0.071, 0.09, 0.9 + k * 1.5), (0.012, 0.05, 0.16), r=0.004, segs=1)
        # Underside stiffener (visible from the side).
        rings = []
        for z, d in ((0.15, 0.22), (2.5, 0.16), (4.6, 0.04)):
            prof = rrect(0.1, d, 0.02, 1, cx=s * (rw / 2 - 0.25), cy=-lerp(0.3, 0.06, z / rl) - d / 2 + 0.02)
            rings.append([M @ V(px, py, z) for px, py in prof])
        part.add(bm_rings(rings), "dark")
    for x in (-0.55, 0.55):
        rings = []
        for z, d in ((0.15, 0.18), (2.5, 0.12), (4.4, 0.03)):
            prof = rrect(0.08, d, 0.02, 1, cx=x, cy=-lerp(0.3, 0.06, z / rl) - d / 2 + 0.02)
            rings.append([M @ V(px, py, z) for px, py in prof])
        part.add(bm_rings(rings), "dark")
    # Hinge knuckles on the ramp side and the toe plate.
    for x in (-1.2, -0.4, 0.4, 1.2):
        cyl(part, "metal", M @ T(x, -0.15, 0.02, 0, 0, PI / 2), 0.12, 0.36, segs=16, bevel=0.015)
    box(part, "metal", M @ T(0, -0.005, rl - 0.2), (rw - 0.1, 0.02, 0.36), r=0.006, segs=1)
    return M


def build_rams(M):
    rl = WREN["rampLength"]
    rw = WREN["rampWidth"]
    part = Part("RampRams", "Body")
    L = HULL
    for s in (-1, 1):
        ya = 3.2
        xa = (L.half_width(5.1, ya, LINER_INSET) or 1.8) - 0.1
        a = V(s * xa, ya, 5.1)
        b = M @ V(s * (rw / 2 - 0.08), 0.2, rl * 0.42)
        mid = a.lerp(b, 0.55)
        box(part, "dark", V(s * (xa + 0.02), ya, 5.1), (0.2, 0.3, 0.36), r=0.03)
        strut(part, "dark", a, mid, 0.08, 14, 0.015)
        strut(part, "metal", mid, b, 0.045, 12)
        sphere(part, "dark", b, 0.07, 10, 6)
    # Hinge knuckles on the hull side.
    for x in (-1.6, -0.8, 0.0, 0.8, 1.6):
        cyl(part, "dark", M @ T(x, -0.15, 0.02, 0, 0, PI / 2), 0.125, 0.36, segs=16, bevel=0.015)


# ---- finalize: apply modifiers, join, UVs, export --------------------------------------------------------

def view3d_override():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    return win, area, region


def finalize():
    for p in PARTS:
        p.finish()
    dg = bpy.context.evaluated_depsgraph_get()
    finals = {}
    for group, objs in GROUPS.items():
        if not objs:
            continue
        for ob in objs:
            if ob.modifiers:
                me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
                ob.modifiers.clear()
                old = ob.data
                ob.data = me
                bpy.data.meshes.remove(old)
        win, area, region = view3d_override()
        target = objs[0]
        if len(objs) > 1:
            with bpy.context.temp_override(window=win, area=area, region=region, active_object=target, object=target,
                                           selected_objects=objs, selected_editable_objects=objs):
                bpy.ops.object.join()
        name = "Wren_Ramp" if group == "Ramp" else f"Wren_{group}"
        target.name = name
        target.data.name = name
        finals[group] = target
    # Ramp pivot on the hinge line.
    ramp = finals["Ramp"]
    pivot = U(0, FLOOR_Y, HINGE_Z)
    ramp.data.transform(Matrix.Translation(-pivot))
    ramp.location = pivot
    for ob in finals.values():
        ob.data.validate()
        uv_unwrap(ob)
    return finals


def uv_unwrap(ob):
    win, area, region = view3d_override()
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(window=win, area=area, region=region, active_object=ob, object=ob,
                                   selected_objects=[ob], selected_editable_objects=[ob], edit_object=ob):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")


def export(objs):
    os.makedirs(os.path.dirname(FBX_PATH), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.fbx(
        filepath=FBX_PATH, use_selection=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
        apply_unit_scale=True, bake_space_transform=True, object_types={"MESH"}, bake_anim=False,
        mesh_smooth_type="FACE", use_mesh_modifiers=True, use_triangles=False, path_mode="AUTO")


# ---- preview renders (EEVEE) ------------------------------------------------------------------------------

def sock(sockets, name, kind):
    return next(x for x in sockets if x.name == name and x.type == kind)


def add_weathering(m, dust=0.55, grime=0.35):
    """Preview-only shading: dust on up-facing surfaces, grime low down and in crevices, rough variation.
    (The Base Color default value stays the flat paint colour the FBX carries.)"""
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    base = tuple(b.inputs["Base Color"].default_value)
    rough = b.inputs["Roughness"].default_value
    N = nt.nodes.new
    geo = N("ShaderNodeNewGeometry")
    sep = N("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sep.inputs[0])
    up = N("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = 0.55
    up.inputs["From Max"].default_value = 0.9
    nt.links.new(sep.outputs["Z"], up.inputs["Value"])
    tex = N("ShaderNodeTexCoord")
    noise = N("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.9
    noise.inputs["Detail"].default_value = 6.0
    nt.links.new(tex.outputs["Object"], noise.inputs["Vector"])
    nm = N("ShaderNodeMapRange")
    nm.inputs["From Min"].default_value = 0.38
    nm.inputs["From Max"].default_value = 0.68
    nt.links.new(noise.outputs["Fac"], nm.inputs["Value"])
    dmask = N("ShaderNodeMath")
    dmask.operation = "MULTIPLY"
    nt.links.new(up.outputs["Result"], dmask.inputs[0])
    nt.links.new(nm.outputs["Result"], dmask.inputs[1])
    dm2 = N("ShaderNodeMath")
    dm2.operation = "MULTIPLY"
    dm2.inputs[1].default_value = dust
    nt.links.new(dmask.outputs[0], dm2.inputs[0])
    # Grime: low on the ship and in occluded corners.
    sepp = N("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sepp.inputs[0])
    low = N("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 2.2
    low.inputs["From Max"].default_value = 0.0
    nt.links.new(sepp.outputs["Z"], low.inputs["Value"])
    ao = N("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.35
    inv = N("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(ao.outputs["AO"], inv.inputs[1])
    gsum = N("ShaderNodeMath")
    gsum.operation = "ADD"
    nt.links.new(low.outputs["Result"], gsum.inputs[0])
    nt.links.new(inv.outputs[0], gsum.inputs[1])
    gn = N("ShaderNodeTexNoise")
    gn.inputs["Scale"].default_value = 3.0
    gn.inputs["Detail"].default_value = 8.0
    nt.links.new(tex.outputs["Object"], gn.inputs["Vector"])
    gmul = N("ShaderNodeMath")
    gmul.operation = "MULTIPLY"
    nt.links.new(gsum.outputs[0], gmul.inputs[0])
    nt.links.new(gn.outputs["Fac"], gmul.inputs[1])
    gcl = N("ShaderNodeMath")
    gcl.operation = "MULTIPLY"
    gcl.use_clamp = True
    gcl.inputs[1].default_value = grime
    nt.links.new(gmul.outputs[0], gcl.inputs[0])
    # Paint mottling.
    mott = N("ShaderNodeTexNoise")
    mott.inputs["Scale"].default_value = 6.0
    mott.inputs["Detail"].default_value = 10.0
    nt.links.new(tex.outputs["Object"], mott.inputs["Vector"])
    mr = N("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = 0.88
    mr.inputs["To Max"].default_value = 1.06
    nt.links.new(mott.outputs["Fac"], mr.inputs["Value"])
    paint = N("ShaderNodeMix")
    paint.data_type = "RGBA"
    paint.blend_type = "MULTIPLY"
    sock(paint.inputs, "Factor", "VALUE").default_value = 1.0
    sock(paint.inputs, "A", "RGBA").default_value = base
    nt.links.new(mr.outputs["Result"], sock(paint.inputs, "B", "RGBA"))
    grim = N("ShaderNodeMix")
    grim.data_type = "RGBA"
    sock(grim.inputs, "B", "RGBA").default_value = (*srgb("#2a2622"), 1)
    nt.links.new(sock(paint.outputs, "Result", "RGBA"), sock(grim.inputs, "A", "RGBA"))
    nt.links.new(gcl.outputs[0], sock(grim.inputs, "Factor", "VALUE"))
    dmix = N("ShaderNodeMix")
    dmix.data_type = "RGBA"
    sock(dmix.inputs, "B", "RGBA").default_value = (*srgb("#7d7368"), 1)
    nt.links.new(sock(grim.outputs, "Result", "RGBA"), sock(dmix.inputs, "A", "RGBA"))
    nt.links.new(dm2.outputs[0], sock(dmix.inputs, "Factor", "VALUE"))
    nt.links.new(sock(dmix.outputs, "Result", "RGBA"), b.inputs["Base Color"])
    rr = N("ShaderNodeMapRange")
    rr.inputs["To Min"].default_value = rough - 0.08
    rr.inputs["To Max"].default_value = rough + 0.12
    nt.links.new(gn.outputs["Fac"], rr.inputs["Value"])
    radd = N("ShaderNodeMath")
    radd.operation = "ADD"
    radd.use_clamp = True
    nt.links.new(rr.outputs["Result"], radd.inputs[0])
    nt.links.new(dm2.outputs[0], radd.inputs[1])
    nt.links.new(radd.outputs[0], b.inputs["Roughness"])


def preview_object(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    return ob


def setup_preview():
    """Lookdev scene (not exported): pad and regolith, warm low key, dim cool fill, dark sky."""
    scn = bpy.context.scene
    for o in [o for o in bpy.data.objects if o.name.startswith("PV_")]:
        bpy.data.objects.remove(o, do_unlink=True)
    for name in ("M_Wren_Hull", "M_Wren_Dark", "M_Hazard", "M_Wren_Metal"):
        m = bpy.data.materials[name]
        if not any(n.type == "AMBIENT_OCCLUSION" for n in m.node_tree.nodes):
            add_weathering(m, dust=0.6 if name != "M_Wren_Metal" else 0.35, grime=0.4)
    ground_m = material("PV_Regolith", "#6f675d", 0.95)
    pad_m = material("PV_Pad", "#5d5a55", 0.85)
    add_weathering(pad_m, dust=0.5, grime=0.0)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=200)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, -0.04))
    preview_object("PV_Ground", bm, ground_m)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=64, radius1=15, radius2=15, depth=0.2)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, -0.1))
    preview_object("PV_Pad", bm, pad_m)
    key = bpy.data.lights.get("PV_Key") or bpy.data.lights.new("PV_Key", "SUN")
    key.color = srgb("#ffb27a")
    key.energy = 4.5
    key.angle = math.radians(0.6)
    ko = bpy.data.objects.new("PV_Key", key)
    scn.collection.objects.link(ko)
    fill = bpy.data.lights.get("PV_Fill") or bpy.data.lights.new("PV_Fill", "SUN")
    fill.color = srgb("#8a9cc8")
    fill.energy = 0.5
    fill.angle = math.radians(40)
    fo = bpy.data.objects.new("PV_Fill", fill)
    scn.collection.objects.link(fo)
    fo.rotation_euler = (-U(-0.3, 1.0, 0.4).normalized()).to_track_quat("-Z", "Y").to_euler()
    bay = bpy.data.lights.get("PV_Bay") or bpy.data.lights.new("PV_Bay", "POINT")
    bay.color = srgb("#ffd9a8")
    bay.energy = 300
    bay.shadow_soft_size = 0.3
    bo = bpy.data.objects.new("PV_Bay", bay)
    scn.collection.objects.link(bo)
    bo.location = U(0, 3.4, 2.5)
    world = bpy.data.worlds.get("PV_World") or bpy.data.worlds.new("PV_World")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.012, 0.012, 0.016, 1)
    bg.inputs["Strength"].default_value = 1.0
    scn.render.engine = "BLENDER_EEVEE"
    ee = scn.eevee
    for attr, val in (("taa_render_samples", 48), ("use_raytracing", True), ("use_shadows", True),
                      ("shadow_ray_count", 2), ("shadow_step_count", 8)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    scn.render.resolution_x = 1280
    scn.render.resolution_y = 720
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = False
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.exposure = 0.3


CAMERAS = {
    # name: (Unity position, Unity target, lens mm, ortho scale or None)
    "front": (V(12.5, 4.8, -21.0), V(0.4, 2.1, -1.5), 38, None),
    "side": (V(34.0, 3.2, 0.2), V(0.0, 2.4, -0.1), 45, None),
    "rear": (V(8.0, 4.4, 22.0), V(0.0, 1.8, 5.5), 36, None),
    "top": (V(0.0, 40.0, 0.0), V(0.0, 0.0, 0.0), 50, 25.0),
    "bay": (V(0.5, 1.75, 13.0), V(0.0, 2.3, 2.0), 22, None),
}


def render_previews(out_dir, names=None):
    """Key light sits ~11 deg up and ~40 deg to the right of each camera (lookdev convention)."""
    scn = bpy.context.scene
    cam_data = bpy.data.cameras.get("PV_Cam") or bpy.data.cameras.new("PV_Cam")
    cam = bpy.data.objects.get("PV_Cam") or bpy.data.objects.new("PV_Cam", cam_data)
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    scn.camera = cam
    key = bpy.data.objects["PV_Key"]
    paths = []
    for name, (pos, target, lens, ortho) in CAMERAS.items():
        if names and name not in names:
            continue
        cam_data.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam_data.ortho_scale = ortho
        cam_data.lens = lens
        cam_data.clip_end = 500
        cam.location = U(*pos)
        if name == "top":
            cam.rotation_euler = (0, 0, math.radians(90))
            az = math.radians(58)
        else:
            d = U(*target) - U(*pos)
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
            az = math.atan2(pos.x - target.x, -(pos.z - target.z)) + math.radians(40)
        el = math.radians(11)
        sun_dir = V(math.cos(el) * math.sin(az), math.sin(el), -math.cos(el) * math.cos(az))
        key.rotation_euler = (-U(*sun_dir)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(out_dir, f"wren_{name}.png")
        bpy.ops.render.render(write_still=True)
        paths.append(scn.render.filepath)
    return paths


# ---- main ----------------------------------------------------------------------------------------------------

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras, bpy.data.armatures):
        for d in list(coll):
            coll.remove(d)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    PARTS.clear()
    for v in GROUPS.values():
        v.clear()


def main(preview_dir=None):
    global HULL
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    clear_scene()
    make_materials()
    HULL = Loft(FUSE)
    edge_pts, edge_ups = build_fuselage()
    build_opening_frame(edge_pts, edge_ups)
    build_liner()
    build_bay()
    build_canopy()
    for s in (-1, 1):
        build_nacelle(s)
    build_pylons()
    build_spine()
    build_fins()
    build_greebles()
    build_gear()
    M = build_ramp()
    build_rams(M)
    finals = finalize()
    objs = list(finals.values())
    export(objs)
    stats = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs}
    stats["total"] = sum(stats.values())
    if preview_dir:
        setup_preview()
        os.makedirs(preview_dir, exist_ok=True)
        stats["renders"] = render_previews(preview_dir)
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, copy=True)
    stats["materials"] = sorted({m.name for o in objs for m in o.data.materials})
    return stats


if not globals().get("WREN_NO_MAIN"):
    result = main(globals().get("WREN_PREVIEW_DIR"))
