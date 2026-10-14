# Builds the Survey Outpost Kestrel-7 structures kit (static meshes, shared materials, UVs) and
# exports one FBX per piece for Unity. Run inside Blender (e.g. through the Blender MCP):
#     exec(open("/Users/mikkel/Hollow Star/art/blender/scripts/build_outpost.py").read())
# Set OUTPOST_PREVIEW_DIR in the exec globals first to also render the lookdev previews there
# (or call render_previews(dir, names) afterwards).
#
# Same conventions as build_wren.py / build_astronaut.py: every piece is modelled in UNITY space
# through U() and the FBX exporter maps Blender (x, y, z) to Unity (-x, z, -y), so each model
# imports with identity transforms. Each piece's pivot is on the ground (y = 0) under its centre,
# and its local frame is the one the web version builds it in (src/env/props/outpost.ts), so the
# scene builder places it at the layout's (x, z) with Quaternion.Euler(0, yaw * Rad2Deg, 0):
#
#   SM_Hab_11 / _10 / _8   HAB-1 / LAB-2 / HAB-3. Hull along local X, local +Z = habFrame ez
#                          (airlock side +1). Airlock side, door and windows baked per HABS.
#                          yaw = 0 for axis 'x', PI/2 for axis 'z' (habFrame).
#   SM_Tunnel              1 m tube segment, z in [-0.5, 0.5], axis 2.45 m up (TUNNELS.y).
#                          Corrugation tiles every 0.2 m: tile n = round(len) segments or scale Z.
#   SM_TunnelSupport       saddle + splayed legs for tunnelPlan().supports (yaw along the tube).
#   SM_TunnelCollar        docking collar; pivot under the skin point, +Z points out of the hull.
#   SM_Mast (+SM_Mast_Dish) lattice mast, yaw 0; the dish is a separate object (turns about Y).
#   SM_MastCabinet         door on +Z, yaw PI/2 + 0.1.
#   SM_Floodlight          8 m pole, lamps aim along +Z, 35 deg down; yaw = atan2(aimX-x, aimZ-z).
#   SM_Floodlight_DeadLamp same with lamp 2 (local x = +0.8) burnt out (FLOODLIGHTS[2]).
#   SM_Tank                hull along X, valve box at +X, ladder on +Z; TANKS yaw.
#   SM_Container           6 x 2.4 x 2.6, length along X, doors at +X; CONTAINERS yaw / y.
#   SM_SolarPanel          cells face local +Z (tilt 0.95 rad); yaw SOLAR_YAW.
#   SM_Pedestal            cable gland at local (0, 1.0, 0.3) (umbilicalPath start); PEDESTAL_YAW.

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = "/Users/mikkel/Hollow Star"
OUT_DIR = f"{ROOT}/HollowStarUnity/Assets/_Project/Art/Models/Props/Outpost"
BLEND_PATH = f"{ROOT}/art/blender/outpost.blend"

PI = math.pi
TAU = 2 * math.pi
UP = Vector((0, 1, 0))


def U(x, y, z):
    """Unity position -> Blender position."""
    return Vector((-x, -z, y))


# Unity -> Blender as a matrix (a mirror: faces are reversed after applying it).
MU = Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# ---- layout constants (src/env/props/layout.ts) -------------------------------------------------

HAB_LIFT = 0.95
HAB_DOME = 1.05
HABS = [
    dict(name="HAB-1", file="SM_Hab_11", x=-13.0, z=6.0, axis="z", length=11.0, radius=2.3, airlock=(1, 2.2),
         windows=[(-3.4, 1, True), (-1.6, 1, False), (4.4, 1, True), (-2.5, -1, False), (2.0, -1, True)],
         ports=(True, False)),  # dome end plates at (-X, +X); the +X (north) dome takes a tunnel
    dict(name="LAB-2", file="SM_Hab_10", x=-16.5, z=-10.5, axis="x", length=10.0, radius=2.3, airlock=(-1, 2.6),
         windows=[(-2.8, 1, False), (-0.8, 1, True), (0.3, -1, False), (-2.0, -1, True)],
         ports=(True, True)),
    dict(name="HAB-3", file="SM_Hab_8", x=-26.5, z=4.0, axis="x", length=8.0, radius=2.1, airlock=(1, -1.2),
         windows=[(1.4, 1, False), (0.8, -1, False)],
         ports=(True, False)),  # the +X (east) dome takes a tunnel
]
TUNNEL_R = 1.05
TUNNEL_Y = 2.45
TUNNELS = [
    dict(ax=-13.0, az=0.35, bx=-13.0, bz=-9.25, radius=TUNNEL_R, y=TUNNEL_Y),
    dict(ax=-14.3, az=3.6, bx=-23.0, bz=3.6, radius=TUNNEL_R, y=TUNNEL_Y),
]
CONTAINER = dict(length=6.0, width=2.4, height=2.6)
CONTAINERS = [
    (-7.2, 21.6, 0.0, 0.02, "#566466"),
    (-7.0, 24.0, 0.0, 0.02, "#8a5634"),
    (-7.4, 22.8, 2.6, 0.07, "#b4afa3"),
    (8.5, -24.0, 0.0, PI / 2 + 0.05, "#3f4756"),
]
MAST = dict(x=-21.0, z=-3.0, height=16.0)
MAST_CABINET = dict(x=MAST["x"] - 1.2, z=MAST["z"] + 2.2, yaw=PI / 2 + 0.1)
FLOODLIGHTS = [
    dict(x=-9.3, z=14.2, height=8.0, aimX=-7.5, aimZ=7.0, dead=None),
    dict(x=23.5, z=18.8, height=8.5, aimX=13.5, aimZ=7.5, dead=None),
    dict(x=-24.0, z=-14.5, height=7.5, aimX=-17.0, aimZ=-12.5, dead=2),
]
SOLAR = dict(x=-23.5, z=-25.0, count=6, spacing=2.25, panelW=1.9, panelL=3.3)
SOLAR_YAW = math.atan2(-0.87, -0.49)
TANKS = [(24.5, -13.5, 0.0), (24.8, -16.9, 0.03)]
TANK_L, TANK_R = 7.0, 1.2
PEDESTAL = dict(x=1.8, z=1.2, yaw=1.0)
LANDING_PAD = dict(x=12.0, z=6.0)
SUN_DIR = Vector((-0.85, 0.2, -0.48)).normalized()
PLANET_DIR = Vector((0.78, 0.42, -0.46)).normalized()


def mast_guy_anchors_local():
    return [(math.cos(i / 3 * TAU + 0.9) * 5.2, math.sin(i / 3 * TAU + 0.9) * 5.2) for i in range(3)]


def solar_panels():
    rx, rz = 0.49, -0.87
    out = []
    for i in range(SOLAR["count"]):
        t = (i - (SOLAR["count"] - 1) / 2) * SOLAR["spacing"]
        out.append((SOLAR["x"] + rx * t, SOLAR["z"] + rz * t))
    return out


def hab_frame(h):
    return ((1, 0), (0, 1), 0.0) if h["axis"] == "x" else ((0, -1), (1, 0), PI / 2)


def hab_inside(h, x, y, z):
    ex, ez, _ = hab_frame(h)
    dx, dz = x - h["x"], z - h["z"]
    along = dx * ex[0] + dz * ex[1]
    across = dx * ez[0] + dz * ez[1]
    rho = math.hypot(across, y - (HAB_LIFT + h["radius"]))
    cyl_ = h["length"] / 2 - HAB_DOME
    a = abs(along)
    if a <= cyl_:
        return min(h["radius"] - rho, h["length"] / 2 - a)
    t = (a - cyl_) / HAB_DOME
    r = rho / h["radius"]
    return (1 - math.hypot(t, r)) * min(HAB_DOME, h["radius"])


def tunnel_plan(t):
    """Port of tunnelPlan(): tube ends sunk in the hulls, skin points (collars) and supports."""
    mid = Vector(((t["ax"] + t["bx"]) / 2, t["y"], (t["az"] + t["bz"]) / 2))
    rr = t["radius"] + 0.06

    def inside(q, margin):
        return any(hab_inside(h, q.x, q.y, q.z) > margin for h in HABS)

    def joint(ex, ez):
        end = Vector((ex, t["y"], ez))
        d = (end - mid).normalized()
        side = Vector((-d.z, 0, d.x))
        up = side.cross(d)
        total = (end - mid).length * 2
        skin = None
        s = 0.0
        while s <= total:
            p = mid + d * s
            if skin is None and inside(p, 0):
                skin = p.copy()
            if skin is not None:
                if all(inside(p + side * (math.cos(TAU * k / 24) * rr) + up * (math.sin(TAU * k / 24) * rr), 0.04)
                       for k in range(24)):
                    return skin, p + d * 0.05
            s += 0.01
        raise RuntimeError("tunnel does not reach a hab")

    skin_a, a = joint(t["ax"], t["az"])
    skin_b, b = joint(t["bx"], t["bz"])
    span = (skin_b - skin_a).length
    count = max(1, int(span // 2.6))
    supports = [skin_a.lerp(skin_b, k / (count + 1)) for k in range(1, count + 1)]
    return dict(a=a, b=b, skinA=skin_a, skinB=skin_b, supports=supports)


# ---- small math helpers (Unity space) ------------------------------------------------------------

def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


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
    MAT["paint"] = material("M_Outpost_Paint", "#c9c6bd", 0.5, 0.08)
    MAT["dark"] = material("M_Outpost_Dark", "#2b2e33", 0.5, 0.3)
    MAT["metal"] = material("M_Outpost_Metal", "#7a7d80", 0.38, 0.85)
    MAT["hazard"] = material("M_Hazard", "#d1a21f", 0.5, 0.1)
    MAT["glass"] = material("M_Outpost_Glass", "#15191e", 0.06, 0.4)
    MAT["warm"] = material("M_Lamp_Warm", "#ffd9a8", 0.3, 0.0, emit="#ffd9a8", strength=4.0)
    MAT["cool"] = material("M_Lamp_Cool", "#cfe6ff", 0.25, 0.0, emit="#cfe6ff", strength=7.0)
    MAT["red"] = material("M_Lamp_Red", "#ff2a1a", 0.3, 0.0, emit="#ff2a1a", strength=6.0)
    MAT["solar"] = material("M_Solar", "#1a2440", 0.22, 0.3)
    MAT["container"] = material("M_Container", "#9a9a96", 0.6, 0.25)


# ---- parts: bmesh in Unity space, one object per piece -------------------------------------------

PARTS = []
PIECES = {}


class Part:
    def __init__(self, name, sharp=48.0, weighted=True, pivot=None):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.sharp = sharp
        self.weighted = weighted
        self.pivot = pivot  # Unity-space object origin (default: the piece origin)
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
        bmesh.ops.transform(bm, matrix=MU, verts=bm.verts)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:
            bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
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
        if self.pivot is not None:
            piv = U(*self.pivot)
            me.transform(Matrix.Translation(-piv))
            ob.location = piv
        PIECES[self.name] = ob
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


def box(part, key, M, size, r=0.02, segs=1):
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


def ring(part, key, M, r0, r1, h, segs=24, ch=0.0):
    """Closed annular band about local Y: inner radius r0, outer r1, height h (chamfer ch on the outside)."""
    prof = [(r0, -h / 2), (r1 - ch, -h / 2), (r1, -h / 2 + ch), (r1, h / 2 - ch), (r1 - ch, h / 2), (r0, h / 2), (r0, -h / 2)]
    lathe(part, key, M, prof, segs)


def sphere(part, key, M, r, segs=12, rings=8, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = V(v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])
    part.add(bm, key, at(M))


def bm_torus(R, r, segs=24, sides=8):
    """Torus about local Y."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = TAU * i / segs
        d = V(math.cos(a), 0, math.sin(a))
        rings.append([bm.verts.new(d * (R + r * math.cos(TAU * j / sides)) + V(0, r * math.sin(TAU * j / sides), 0))
                      for j in range(sides)])
    for i in range(segs):
        for j in range(sides):
            i2, j2 = (i + 1) % segs, (j + 1) % sides
            bm.faces.new((rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]))
    return bm


def torus(part, key, M, R, r, segs=24, sides=8):
    part.add(bm_torus(R, r, segs, sides), key, at(M))


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


def bm_frame(outer, inner, z0, z1):
    """Closed frame (window/door surround): outer and inner outlines (same count) extruded z0..z1."""
    bm = bmesh.new()
    n = len(outer)
    of = [bm.verts.new((x, y, z1)) for x, y in outer]
    ob = [bm.verts.new((x, y, z0)) for x, y in outer]
    inf = [bm.verts.new((x, y, z1)) for x, y in inner]
    ib = [bm.verts.new((x, y, z0)) for x, y in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((of[i], of[j], inf[j], inf[i]))
        bm.faces.new((ob[j], ob[i], ib[i], ib[j]))
        bm.faces.new((ob[i], ob[j], of[j], of[i]))
        bm.faces.new((ib[j], ib[i], inf[i], inf[j]))
    return bm


def bm_prism(outline, z0, z1, bevel=0.0):
    """Extrude a 2D outline (x, y) between z0 and z1 into a closed solid."""
    bm = bmesh.new()
    f = [bm.verts.new((x, y, z1)) for x, y in outline]
    b = [bm.verts.new((x, y, z0)) for x, y in outline]
    n = len(outline)
    cf = bm.faces.new(f)
    cb = bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((b[i], b[j], f[j], f[i]))
    if bevel > 0:
        edges = list({e for face in (cf, cb) for e in face.edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=1, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    return bm


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


def tube(part, key, path, r, sides=8, closed=False):
    rings = sweep_rings(path, transport_ups(path) if not closed else [V(0, 1, 0) if abs((path[(i + 1) % len(path)] - path[i]).normalized().y) < 0.9 else V(1, 0, 0) for i in range(len(path))],
                        circle2(r, sides), closed=closed)
    part.add(bm_rings(rings, closed_path=closed, cap0=not closed, cap1=not closed), key)


def hoop(part, key, center, radius, r, n=24, sides=6):
    """Horizontal closed tube ring (railings)."""
    path = [center + V(math.cos(TAU * i / n) * radius, 0, math.sin(TAU * i / n) * radius) for i in range(n)]
    rings = sweep_rings(path, [V(0, 1, 0)] * n, circle2(r, sides), closed=True)
    part.add(bm_rings(rings, closed_path=True), key)


def orient(bm, expected):
    """Flip faces whose normal disagrees with expected(center) (open surfaces)."""
    bm.normal_update()
    for fc in bm.faces:
        if fc.normal.dot(expected(fc.calc_center_median())) < 0:
            fc.normal_flip()
    bm.normal_update()


def hazard_stripes(part, M, length, width, stripe=0.12, lift=0.0, thick=0.004):
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


def bm_corrugated(w, h, pitch, depth):
    """Single-sided trapezoidal corrugated sheet in local XY (ridges vertical), facing +Z."""
    n = max(1, round(w / pitch))
    p = w / n
    xs = []
    for k in range(n):
        x0 = -w / 2 + k * p
        xs += [(x0, -depth / 2), (x0 + 0.15 * p, depth / 2), (x0 + 0.5 * p, depth / 2), (x0 + 0.65 * p, -depth / 2)]
    xs.append((w / 2, -depth / 2))
    bm = bmesh.new()
    lo = [bm.verts.new((x, -h / 2, z)) for x, z in xs]
    hi = [bm.verts.new((x, h / 2, z)) for x, z in xs]
    for i in range(len(xs) - 1):
        bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
    orient(bm, lambda c: V(0, 0, 1))
    return bm


def saddle_outline(half_w, y_bottom, cy, R, sink=0.04, n=16):
    """Cradle outline in (across, y): flat bottom, top cut to a hull of radius R centred at height cy."""
    top = []
    for k in range(n + 1):
        a = half_w - 2 * half_w * k / n
        top.append((a, cy - math.sqrt(max(R * R - a * a, 0.0)) + sink))
    return [(-half_w, y_bottom), (half_w, y_bottom)] + top


# ---- habitat modules ------------------------------------------------------------------------------

def build_hab(h):
    p = Part(h["file"])
    L, R = h["length"], h["radius"]
    cy = HAB_LIFT + R
    D = HAB_DOME
    y0, y1 = -L / 2 + D, L / 2 - D

    def hull_top(z):
        return cy + math.sqrt(max(R * R - z * z, 0.0))

    # Hull: lathe along the axis with domed ends, end bands and raised ribs (gunmetal).
    prof = []
    N = 14
    for i in range(N + 1):
        a = i / N * PI / 2
        prof.append((R * math.sin(a), -L / 2 + D * (1 - math.cos(a))))
    bw = 0.24
    prof += [(R + 0.07, y0), (R + 0.09, y0 + 0.02), (R + 0.09, y0 + bw - 0.02), (R + 0.07, y0 + bw), (R, y0 + bw + 0.02)]
    ribs = max(2, round((y1 - y0) / 1.25))
    for k in range(1, ribs):
        y = y0 + (y1 - y0) * k / ribs
        prof += [(R, y - 0.1), (R + 0.065, y - 0.06), (R + 0.065, y + 0.06), (R, y + 0.1)]
    prof += [(R, y1 - bw - 0.02), (R + 0.07, y1 - bw), (R + 0.09, y1 - bw + 0.02), (R + 0.09, y1 - 0.02), (R + 0.07, y1)]
    for i in range(N, -1, -1):
        a = i / N * PI / 2
        prof.append((R * math.sin(a), L / 2 - D * (1 - math.cos(a))))
    bm = bm_lathe(prof, 64)
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if math.hypot(c.x, c.z) > R + 0.02 else 0
    p.add(bm, None, T(0, cy, 0, 0, 0, -PI / 2), keys=["paint", "dark"])

    # Dome end plates (where no tunnel docks).
    for e, on in ((-1, h["ports"][0]), (1, h["ports"][1])):
        if not on:
            continue
        M = T(e * L / 2, cy, 0, 0, 0, -PI / 2 * e)
        lathe(p, "dark", M, [(0, -0.12), (0.55, -0.12), (0.62, -0.06), (0.62, 0.02), (0.57, 0.06), (0, 0.06)], 32)
        cyl(p, "metal", M @ T(0, 0.07, 0), 0.2, 0.06, segs=16, bevel=0.015)
        for k in range(10):
            a = TAU * k / 10
            cyl(p, "metal", M @ T(math.cos(a) * 0.48, 0.07, math.sin(a) * 0.48), 0.028, 0.04, segs=6)

    # Skids, cradles (cut to the hull) and legs.
    sk = R * 0.64
    for s in (-1, 1):
        box(p, "dark", V(0, 0.09, s * sk), (L - 0.6, 0.24, 0.32), r=0.04, segs=2)
        for e in (-1, 1):
            box(p, "dark", V(e * (L / 2 - 0.5), 0.02, s * sk), (0.6, 0.07, 0.56), r=0.02)
    cr_y = HAB_LIFT - 0.24
    for x in (-(L / 2 - D - 0.4), 0.0, L / 2 - D - 0.4):
        outline = saddle_outline(sk + 0.22, cr_y, cy, R)
        p.add(bm_prism(outline, -0.15, 0.15, bevel=0.015), "dark", T(x, 0, 0, 0, PI / 2, 0))
        fx = x + 0.7 if x <= 0 else x - 0.7
        for s in (-1, 1):
            box(p, "dark", V(x, (cr_y + 0.2) / 2, s * sk), (0.22, cr_y - 0.2, 0.22), r=0.025)
            strut(p, "dark", V(fx, 0.2, s * sk), V(x, cr_y - 0.08, s * sk), 0.045, 8)
            cyl(p, "metal", V(x, 0.36, s * (sk + 0.15)), 0.055, 0.32, segs=10, bevel=0.01)  # levelling jack
            box(p, "dark", V(x, 0.22, s * (sk + 0.15)), (0.18, 0.05, 0.16), r=0.01)

    # Conduits along the lower hull resting on the ribs: clamps and junction boxes.
    for s in (-1, 1):
        ang = s * 1.15

        def onhull(x, r, ang=ang):
            return V(x, cy - math.cos(ang) * r, math.sin(ang) * r)

        nrm = V(0, -math.cos(ang), math.sin(ang))
        x0, x1 = -L / 2 + D + 0.3, L / 2 - D - 0.3
        tube(p, "dark", [onhull(x0, R + 0.1), onhull(x1, R + 0.1)], 0.05, 8)
        for x in (x0, x1):
            box(p, "dark", facing(onhull(x, R + 0.06), nrm), (0.3, 0.24, 0.2), r=0.03)
        for k in range(1, 4):
            box(p, "metal", facing(onhull(x0 + (x1 - x0) * k / 4, R + 0.08), nrm), (0.06, 0.16, 0.16), r=0.01)

    # Roof: equipment unit with two fans, vent stack, whip antenna, lifting lugs, handrail.
    ux = -L * 0.18
    top = cy + R
    box(p, "dark", V(ux, top + 0.18, 0), (1.8, 0.55, 1.2), r=0.05, segs=2)
    for fx in (ux - 0.45, ux + 0.45):
        ring(p, "metal", V(fx, top + 0.47, 0), 0.27, 0.34, 0.06, segs=20, ch=0.01)
        cyl(p, "dark", V(fx, top + 0.45, 0), 0.28, 0.02, segs=20)
        for a in (0.4, 0.4 + PI / 2):
            box(p, "metal", T(fx, top + 0.47, 0, 0, a, 0), (0.56, 0.02, 0.03), r=0.0)
        cyl(p, "metal", V(fx, top + 0.48, 0), 0.06, 0.04, segs=10)
    for s in (-1, 1):
        for k in range(5):
            box(p, "metal", V(ux - 0.5 + k * 0.25, top + 0.2, s * 0.61), (0.16, 0.3, 0.02), r=0.004)
    cyl(p, "dark", V(L * 0.12, top + 0.25, 0.6), 0.12, 0.6, segs=12, bevel=0.015)
    cyl(p, "metal", V(L * 0.12, top + 0.58, 0.6), 0.15, 0.06, segs=12, bevel=0.01)
    cyl(p, "dark", V(L * 0.25, top + 0.02, -0.4), 0.07, 0.16, segs=10, bevel=0.01)
    cyl(p, "dark", V(L * 0.25, top + 1.2, -0.4), 0.02, 2.25, segs=6, r1=0.012)
    for x in (-(L / 2 - D - 0.35), L / 2 - D - 0.35):
        box(p, "dark", V(x, hull_top(0.9) + 0.06, 0.9), (0.22, 0.2, 0.06), r=0.015)
    zr = -1.0
    yr = hull_top(zr) + 0.42
    xa, xb = -L / 2 + D + 0.25, L / 2 - D - 0.25
    tube(p, "hazard", [V(xa, yr - 0.47, zr), V(xa, yr, zr), V(xb, yr, zr), V(xb, yr - 0.47, zr)], 0.03, 8)
    for k in range(1, 4):
        x = xa + (xb - xa) * k / 4
        cyl(p, "hazard", V(x, yr - 0.23, zr), 0.022, 0.48, segs=6)

    # Windows: deep frame (sinks into the dome where the hull curves away), pane, eyebrow.
    for along, side, lit in h["windows"]:
        ang = 0.28
        nrm = V(0, math.sin(ang), math.cos(ang) * side)
        M = facing(V(along, cy, 0) + nrm * R, nrm)
        p.add(bm_frame(rrect(0.84, 0.6, 0.1), rrect(0.62, 0.4, 0.05), -0.28, 0.09), "dark", M)
        box(p, "warm" if lit else "glass", M @ T(0, 0, -0.02), (0.64, 0.42, 0.1), r=0.0)
        box(p, "dark", M @ T(0, 0.35, 0.08), (0.94, 0.06, 0.22), r=0.02)
        for sx in (-1, 1):
            for sy in (-1, 1):
                cyl(p, "metal", M @ T(sx * 0.36, sy * 0.24, 0.095, PI / 2, 0, 0), 0.018, 0.02, segs=6)

    # Airlock: vestibule, door (2.1 m opening), porch, steps, handrails, lamps.
    s_al, along = h["airlock"]
    Mal = T(along, 0, 0, 0, 0 if s_al > 0 else PI, 0)  # local +Z points out of the hull

    def A(x, y, z, rx=0.0, ry=0.0, rz=0.0):
        return Mal @ T(x, y, z, rx, ry, rz)

    vz0, vd, vh, vw = R - 0.35, 2.0, 2.75, 2.3
    floor = HAB_LIFT + 0.05
    box(p, "paint", A(0, floor + vh / 2 - 0.15, vz0 + vd / 2), (vw, vh, vd), r=0.08, segs=2)
    box(p, "dark", A(0, floor + vh - 0.08, vz0 + vd / 2 + 0.08), (vw + 0.2, 0.16, vd + 0.2), r=0.04)
    for sx in (-1, 1):  # corner bumpers / seams
        box(p, "dark", A(sx * (vw / 2 + 0.005), floor + vh / 2 - 0.15, vz0 + vd - 0.1), (0.06, vh - 0.3, 0.1), r=0.015)
        box(p, "dark", A(sx * (vw / 2 - 0.25), floor - 0.2, vz0 + vd - 0.25), (0.16, 0.12, 0.16), r=0.02)
        box(p, "dark", A(sx * (vw / 2 - 0.25), (floor - 0.2) / 2, vz0 + vd - 0.25), (0.14, floor - 0.2, 0.14), r=0.02)
        box(p, "dark", A(sx * (vw / 2 - 0.25), 0.02, vz0 + vd - 0.25), (0.34, 0.05, 0.34), r=0.01)
    fz = vz0 + vd
    oh = 2.1
    p.add(bm_frame(rrect(1.52, oh + 0.34, 0.06, 2), rrect(1.1, oh, 0.03, 2), -0.06, 0.1), "dark", A(0, floor + oh / 2, fz))
    box(p, "paint", A(0, floor + oh / 2, fz - 0.02), (1.1, oh, 0.06), r=0.015)
    for y in (0.55, 1.15):
        box(p, "paint", A(0, floor + y, fz + 0.015), (0.9, 0.06, 0.03), r=0.01)
    p.add(bm_frame(circle2(0.21, 20), circle2(0.15, 20), -0.03, 0.04), "dark", A(0, floor + 1.6, fz))
    cyl(p, "glass", A(0, floor + 1.6, fz - 0.005, PI / 2, 0, 0), 0.155, 0.03, segs=20)
    box(p, "metal", A(0.4, floor + 1.02, fz + 0.05), (0.06, 0.34, 0.05), r=0.012)
    cyl(p, "dark", A(0.4, floor + 1.15, fz + 0.03, PI / 2, 0, 0), 0.05, 0.05, segs=10)
    for sx in (-1, 1):
        box(p, "hazard", A(sx * 0.655, floor + 1.05, fz + 0.105), (0.13, 2.2, 0.012), r=0.0)
    box(p, "hazard", A(0, floor + oh + 0.27, fz + 0.02), (1.52, 0.2, 0.04), r=0.008)
    hazard_stripes(p, A(-0.76, floor + oh + 0.27, fz + 0.04), 1.52, 0.2, stripe=0.1)
    box(p, "dark", A(0, floor + 2.54, fz + 0.11), (0.56, 0.12, 0.22), r=0.02)
    box(p, "warm", A(0, floor + 2.475, fz + 0.12), (0.48, 0.02, 0.15), r=0.0)
    box(p, "dark", A(0.92, floor + 1.45, fz + 0.02), (0.16, 0.16, 0.05), r=0.012)
    box(p, "red", A(0.92, floor + 1.45, fz + 0.045), (0.1, 0.1, 0.02), r=0.0)
    box(p, "dark", A(-0.92, floor + 1.25, fz + 0.025), (0.2, 0.3, 0.05), r=0.012)
    box(p, "glass", A(-0.92, floor + 1.31, fz + 0.051), (0.14, 0.09, 0.01), r=0.0)
    # Porch grating and steps down to the regolith.
    pz = fz + 0.5
    box(p, "dark", A(0, floor - 0.05, pz), (1.9, 0.08, 1.0), r=0.015)
    for k in range(7):
        box(p, "metal", A(0, floor - 0.005, pz - 0.42 + k * 0.14), (1.8, 0.012, 0.03), r=0.0)
    box(p, "hazard", A(0, floor - 0.01, pz + 0.48), (1.9, 0.012, 0.05), r=0.0)
    rise = floor / 4
    for k in range(1, 4):
        sz = pz + 0.5 + k * 0.3 - 0.15
        box(p, "dark", A(0, floor - rise * k, sz), (1.5, 0.06, 0.32), r=0.012)
        box(p, "hazard", A(0, floor - rise * k + 0.032, sz + 0.13), (1.5, 0.006, 0.05), r=0.0)
    for sx in (-1, 1):
        strut(p, "dark", A(sx * 0.8, floor - 0.05, pz + 0.45).to_translation(), A(sx * 0.8, 0.02, pz + 1.55).to_translation(), 0.05, 8)
        box(p, "dark", A(sx * 0.8, 0.02, pz + 1.55), (0.2, 0.05, 0.24), r=0.01)
        for y in (floor + 0.95, floor + 0.5):
            dy = y - floor
            rail = [A(sx * 0.95, y, fz + 0.1).to_translation(), A(sx * 0.95, y, pz + 0.45).to_translation(),
                    A(sx * 0.82, dy, pz + 1.4).to_translation()]
            tube(p, "hazard", rail, 0.03 if dy > 0.6 else 0.022, 8)
        for q in ((sx * 0.95, fz + 0.1, floor + 0.95), (sx * 0.95, pz + 0.45, floor + 0.95), (sx * 0.82, pz + 1.4, 0.95)):
            cyl(p, "hazard", A(q[0], q[2] / 2, q[1]), 0.025, q[2], segs=8)
    return p


# ---- tunnels --------------------------------------------------------------------------------------

def build_tunnel():
    p = Part("SM_Tunnel")
    r, ay = TUNNEL_R, TUNNEL_Y
    n = 20  # 5 corrugations per metre, 4 samples each: segments tile seamlessly
    prof = [(r + 0.0125 - 0.0225 * math.cos(TAU * 5 * (i / n)), -0.5 + i / n) for i in range(n + 1)]
    bm = bm_lathe(prof, 28)
    orient(bm, lambda c: V(c.x, 0, c.z))
    p.add(bm, "paint", T(0, ay, 0, PI / 2, 0, 0), recalc=False)
    # Conduit along the lower flank (also tiles) with a clamp.
    cx, cyy = math.sin(math.radians(130)) * (r + 0.085), ay + math.cos(math.radians(130)) * (r + 0.085)
    cyl(p, "dark", T(cx, cyy, 0, PI / 2, 0, 0), 0.045, 1.0, segs=8)
    box(p, "metal", T(cx, cyy, 0, 0, 0, math.radians(-40)), (0.14, 0.13, 0.06), r=0.01)
    return p


def build_tunnel_support():
    p = Part("SM_TunnelSupport")
    r, ay = TUNNEL_R, TUNNEL_Y
    wx = r * 0.82
    yb = ay - r - 0.3
    p.add(bm_prism(saddle_outline(wx, yb, ay, r + 0.03, sink=0.0), -0.16, 0.16, bevel=0.012), "dark")
    lathe(p, "metal", T(0, ay, 0, PI / 2, 0, 0),
          [(r + 0.03, -0.06), (r + 0.06, -0.05), (r + 0.065, -0.03), (r + 0.065, 0.03), (r + 0.06, 0.05), (r + 0.03, 0.06), (r + 0.03, -0.06)], 32)
    box(p, "dark", V(0, yb - 0.03, 0), (2 * wx + 0.2, 0.07, 0.36), r=0.015)
    tops = {}
    for s in (-1, 1):
        top = V(s * (wx - 0.02), yb - 0.06, 0)
        foot = V(s * (r + 0.4), 0.04, 0)
        tops[s] = (top, foot)
        strut(p, "dark", foot, top, 0.07, 10, bevel=0.01)
        box(p, "dark", V(foot.x, 0.02, 0), (0.42, 0.05, 0.42), r=0.012)
        for ox in (-0.14, 0.14):
            for oz in (-0.14, 0.14):
                cyl(p, "metal", V(foot.x + ox, 0.055, oz), 0.022, 0.04, segs=6)
    ty = 0.6
    t = (ty - 0.04) / (yb - 0.06 - 0.04)
    xt = lerp(r + 0.4, wx - 0.02, t)
    box(p, "dark", V(0, ty, 0), (2 * xt, 0.09, 0.09), r=0.012)
    for s in (-1, 1):
        strut(p, "dark", V(s * xt, ty, 0), V(-s * 0.25, yb - 0.08, 0), 0.035, 8)
    return p


def build_tunnel_collar():
    p = Part("SM_TunnelCollar")
    r, ay = TUNNEL_R, TUNNEL_Y
    prof = [(0, -0.3), (r + 0.22, -0.3), (r + 0.26, -0.26), (r + 0.26, -0.06), (r + 0.2, -0.02), (r + 0.2, 0.12),
            (r + 0.15, 0.18), (r + 0.09, 0.18), (r + 0.09, 0.28), (r + 0.06, 0.31), (0, 0.31)]
    prof = [(a, b + 0.06) for a, b in prof]
    lathe(p, "metal", T(0, ay, 0, PI / 2, 0, 0), prof, 48)
    for k in range(16):
        a = TAU * (k + 0.5) / 16
        cyl(p, "dark", T(math.cos(a) * (r + 0.12), ay + math.sin(a) * (r + 0.12), 0.25, PI / 2, 0, 0), 0.028, 0.05, segs=6)
    for k in range(8):
        a = TAU * k / 8
        cyl(p, "dark", T(math.cos(a) * (r + 0.26), ay + math.sin(a) * (r + 0.26), -0.06, PI / 2, 0, 0), 0.035, 0.12, segs=6)
    return p


# ---- comms mast, dish and cabinet -------------------------------------------------------------------

def build_mast():
    p = Part("SM_Mast")
    H = MAST["height"]
    box(p, "dark", V(0, 0.15, 0), (2.4, 0.5, 2.4), r=0.06, segs=2)

    def leg(i, y):
        ang = i / 3 * TAU + 0.9
        rr = 0.62 - y / H * 0.3
        return V(math.cos(ang) * rr, y, math.sin(ang) * rr)

    for i in range(3):
        strut(p, "metal", leg(i, 0.4), leg(i, H), 0.055, 8)
        b = leg(i, 0.4)
        box(p, "dark", V(b.x, 0.42, b.z), (0.34, 0.04, 0.34), r=0.01)
        for ox, oz in ((-0.12, -0.12), (0.12, -0.12), (-0.12, 0.12), (0.12, 0.12)):
            cyl(p, "metal", V(b.x + ox, 0.46, b.z + oz), 0.022, 0.06, segs=6)
    step = 1.15
    ys = []
    y = 0.4
    while y < H - 0.1:
        ys.append(y)
        y2 = min(y + step, H)
        for i in range(3):
            j = (i + 1) % 3
            strut(p, "metal", leg(i, y), leg(j, y), 0.025, 6)
            strut(p, "metal", leg(i, y), leg(j, y2), 0.02, 6)
        y += step

    # Ladder up the face between legs 0 and 1 (toward the cabinet), with standoffs at each bay.
    def lad(y, side):
        m = (leg(0, y) + leg(1, y)) / 2
        n = V(m.x, 0, m.z).normalized()
        e = (leg(1, y) - leg(0, y)).normalized()
        return m + n * 0.14 + e * (0.2 * side)

    ytop = H - 1.25
    for sd in (-1, 1):
        strut(p, "metal", lad(0.45, sd), lad(ytop, sd), 0.022, 6)
        for yy in ys[1:]:
            if yy < ytop:
                m = (leg(0, yy) + leg(1, yy)) / 2
                strut(p, "metal", lad(yy, sd), m, 0.015, 4)
    y = 0.75
    while y < ytop:
        strut(p, "metal", lad(y, -1), lad(y, 1), 0.016, 5)
        y += 0.3

    # Platform with railing near the top.
    py = H - 1.2
    cyl(p, "dark", V(0, py, 0), 0.78, 0.08, segs=20, bevel=0.015)
    for k in range(6):
        a = TAU * k / 6 + 0.3
        cyl(p, "hazard", V(math.cos(a) * 0.74, py + 0.5, math.sin(a) * 0.74), 0.022, 1.0, segs=6)
    hoop(p, "hazard", V(0, py + 1.0, 0), 0.74, 0.025, 24, 6)
    hoop(p, "hazard", V(0, py + 0.52, 0), 0.74, 0.018, 24, 6)

    # Sector antennas on the legs, whips, top cap and the red beacon.
    for i in range(3):
        q = leg(i, H - 2.4)
        out = V(q.x, 0, q.z).normalized()
        pos = q + out * 0.2
        box(p, "paint", facing(pos, out), (0.3, 1.15, 0.11), r=0.03)
        for dy in (-0.35, 0.35):
            strut(p, "metal", leg(i, H - 2.4 + dy), pos + V(0, dy, 0) - out * 0.05, 0.02, 5)
    cyl(p, "dark", V(0, H + 0.03, 0), 0.36, 0.06, segs=16, bevel=0.01)
    cyl(p, "metal", V(0.2, H + 0.1, 0.1), 0.05, 0.12, segs=8)
    cyl(p, "dark", V(0.2, H + 1.6, 0.1), 0.028, 3.0, segs=6, r1=0.012)
    cyl(p, "metal", V(-0.24, H + 0.1, -0.12), 0.05, 0.12, segs=8)
    cyl(p, "dark", V(-0.24, H + 1.2, -0.12), 0.025, 2.2, segs=6, r1=0.012)
    cyl(p, "dark", V(0, H + 0.1, 0), 0.13, 0.08, segs=16, bevel=0.01)
    cyl(p, "red", V(0, H + 0.25, 0), 0.105, 0.22, segs=16)
    cyl(p, "dark", V(0, H + 0.385, 0), 0.13, 0.05, segs=16, bevel=0.01)
    for k in range(4):
        a = TAU * k / 4 + PI / 4
        strut(p, "dark", V(math.cos(a) * 0.135, H + 0.13, math.sin(a) * 0.135), V(math.cos(a) * 0.135, H + 0.37, math.sin(a) * 0.135), 0.01, 4)

    # Side boom carrying the dish head (SM_Mast_Dish turns on the turret).
    bx, bz = -0.55, 0.835
    boomY = H - 3.4
    bl = 2.5
    strut(p, "dark", V(bx * 0.25, boomY, bz * 0.25), V(bx * bl, boomY, bz * bl), 0.09, 10, bevel=0.01)
    strut(p, "dark", V(bx * 0.3, boomY + 1.4, bz * 0.3), V(bx * (bl - 0.2), boomY + 0.05, bz * (bl - 0.2)), 0.035, 6)
    cyl(p, "dark", V(bx * bl, boomY + 0.2, bz * bl), 0.2, 0.35, segs=14, bevel=0.02)
    # Cable down the tower from the boom.
    c0 = leg(1, boomY)
    tube(p, "dark", [V(bx * 0.6, boomY - 0.05, bz * 0.6), c0 + V(0.08, -0.3, 0.05), leg(1, 1.0) + V(0.08, 0, 0.05),
                     leg(1, 0.45) + V(0.15, 0, 0.12)], 0.025, 5)

    # Guy wires to concrete anchors with turnbuckles.
    for i, (gx, gz) in enumerate(mast_guy_anchors_local()):
        foot = V(gx, 0.24, gz)
        tip = leg(i, H * 0.72)
        d = (tip - foot).normalized()
        box(p, "dark", V(gx, 0.06, gz), (0.55, 0.32, 0.55), r=0.04)
        box(p, "metal", T(gx, 0.24, gz, 0, -math.atan2(gz, gx), 0), (0.14, 0.08, 0.025), r=0.006)
        strut(p, "metal", foot + d * 0.05, foot + d * 0.55, 0.022, 6)
        strut(p, "metal", foot + d * 0.55, tip, 0.012, 4)
    return p


def build_mast_dish():
    H = MAST["height"]
    bx, bz = -0.55, 0.835
    pivot = (bx * 2.5, H - 3.4 + 0.38, bz * 2.5)
    p = Part("SM_Mast_Dish", pivot=pivot)
    o = V(*pivot)

    def P(M):
        return Matrix.Translation(o) @ at(M)

    cyl(p, "dark", P(V(0, 0.2, 0)), 0.14, 0.4, segs=12, bevel=0.01)
    box(p, "dark", P(V(0, 0.42, 0)), (0.9, 0.12, 0.3), r=0.04)
    for sx in (-1, 1):
        box(p, "dark", P(V(sx * 0.42, 0.75, 0)), (0.1, 0.7, 0.22), r=0.03)
    dm = P(T(0, 0.95, 0.05, -0.55, 0, 0))
    R = 1.25
    prof = [((i / 12) * R, ((i / 12) * R) ** 2 / (4 * 0.9)) for i in range(13)]
    rimY = R * R / (4 * 0.9)
    prof += [(R + 0.05, rimY + 0.02), (R + 0.05, rimY - 0.06), (R * 0.6, -0.02), (0.3, -0.1), (0, -0.12)]
    lathe(p, "paint", dm @ T(0, 0, 0, PI / 2, 0, 0), list(reversed(prof)), 40)
    ring(p, "dark", dm @ T(0, 0, rimY, PI / 2, 0, 0), R - 0.02, R + 0.07, 0.06, segs=40, ch=0.01)
    cyl(p, "dark", dm @ T(0, 0, -0.17, PI / 2, 0, 0), 0.22, 0.3, segs=12, bevel=0.02)
    cyl(p, "dark", dm @ T(sx * 0, 0, 0.0, 0, 0, PI / 2), 0.07, 0.84, segs=10)  # trunnion axle
    for i in range(3):
        a = i / 3 * TAU + PI / 2
        strut(p, "metal", (dm @ V(math.cos(a) * R * 0.92, math.sin(a) * R * 0.92, rimY)), dm @ V(0, 0, 0.9), 0.02, 5)
    cyl(p, "dark", dm @ T(0, 0, 0.95, PI / 2, 0, 0), 0.08, 0.22, segs=10, bevel=0.01)
    cyl(p, "paint", dm @ T(0, 0, 1.07, PI / 2, 0, 0), 0.1, 0.03, segs=10)
    return p


def build_cabinet():
    p = Part("SM_MastCabinet")
    box(p, "dark", V(0, 0.05, 0), (1.3, 0.14, 0.85), r=0.03)
    box(p, "paint", V(0, 0.95, 0), (1.2, 1.7, 0.75), r=0.04, segs=2)
    box(p, "dark", V(0, 1.84, 0), (1.35, 0.1, 0.9), r=0.03)
    fz = 0.375
    box(p, "paint", V(-0.04, 0.98, fz + 0.012), (0.98, 1.5, 0.03), r=0.012)
    for y in (0.4, 0.98, 1.56):
        cyl(p, "dark", V(-0.555, y, fz + 0.02), 0.022, 0.14, segs=8)
    box(p, "metal", V(0.37, 1.0, fz + 0.045), (0.05, 0.24, 0.04), r=0.01)
    box(p, "dark", V(0.37, 1.18, fz + 0.03), (0.08, 0.08, 0.02), r=0.005)
    for k in range(6):
        box(p, "dark", V(-0.04, 0.36 + k * 0.07, fz + 0.032), (0.7, 0.025, 0.025), r=0.004)
    box(p, "hazard", V(-0.04, 1.5, fz + 0.03), (0.7, 0.16, 0.01), r=0.0)
    hazard_stripes(p, T(-0.39, 1.5, fz + 0.035), 0.7, 0.16, stripe=0.07)
    box(p, "dark", V(0.38, 1.66, fz + 0.025), (0.24, 0.08, 0.02), r=0.005)
    box(p, "warm", V(0.44, 1.66, fz + 0.035), (0.06, 0.04, 0.01), r=0.0)
    box(p, "red", V(0.32, 1.66, fz + 0.035), (0.06, 0.04, 0.01), r=0.0)
    for s in (-1, 1):
        for k in range(5):
            box(p, "dark", V(s * 0.605, 1.25 + k * 0.07, 0), (0.02, 0.025, 0.5), r=0.004)
    box(p, "dark", V(0.25, 0.4, -0.42), (0.2, 0.25, 0.1), r=0.02)
    tube(p, "dark", [V(0.25, 0.32, -0.46), V(0.25, 0.18, -0.6), V(0.25, 0.04, -0.75), V(0.25, 0.03, -1.1)], 0.045, 8)
    cyl(p, "dark", V(-0.4, 1.95, -0.2), 0.04, 0.12, segs=8)
    cyl(p, "dark", V(-0.4, 2.5, -0.2), 0.012, 1.1, segs=5, r1=0.008)
    return p


# ---- floodlight -------------------------------------------------------------------------------------

def build_floodlight(name="SM_Floodlight", dead=None):
    p = Part(name)
    H = 8.0
    box(p, "dark", V(0, 0.04, 0), (0.9, 0.12, 0.9), r=0.03)
    cyl(p, "dark", V(0, 0.115, 0), 0.27, 0.03, segs=16, bevel=0.008)
    for x, z in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
        cyl(p, "metal", V(x, 0.15, z), 0.022, 0.08, segs=6)
    for k in range(4):
        a = TAU * k / 4 + PI / 4
        box(p, "dark", T(math.cos(a) * 0.2, 0.22, math.sin(a) * 0.2, 0, -a, 0), (0.12, 0.18, 0.015), r=0.0)
    lathe(p, "metal", V(0, 0, 0), [(0, 0.1), (0.17, 0.1), (0.17, 0.14), (0.15, 0.3), (0.11, H), (0, H)], 16)
    cyl(p, "dark", V(0, H + 0.03, 0), 0.14, 0.06, segs=12, bevel=0.01)

    def pole_r(y):
        return 0.15 - 0.04 * (y - 0.3) / (H - 0.3)

    y = 2.2
    k = 0
    while y < H - 0.6:
        sx = 1 if k % 2 == 0 else -1
        cyl(p, "metal", T(sx * (pole_r(y) + 0.09), y, 0, 0, 0, PI / 2), 0.016, 0.22, segs=6)
        y += 0.42
        k += 1
    box(p, "paint", V(0, 1.2, -0.25), (0.45, 0.6, 0.22), r=0.03)
    box(p, "dark", V(0, 1.2, -0.367), (0.36, 0.48, 0.015), r=0.005)
    box(p, "hazard", V(0, 1.38, -0.37), (0.2, 0.07, 0.008), r=0.0)
    box(p, "dark", V(0, H, 0.06), (2.4, 0.12, 0.14), r=0.03)
    box(p, "dark", V(0, H - 0.25, -0.02), (0.3, 0.35, 0.12), r=0.02)  # mounting bracket
    tilt = math.radians(35)
    for i, lx in enumerate((-0.8, 0.0, 0.8)):
        yo = lx * 0.1
        d = V(math.sin(yo) * math.cos(tilt), -math.sin(tilt), math.cos(yo) * math.cos(tilt))
        lp = V(lx, H - 0.2, 0.32)
        M = facing(lp, d)
        box(p, "dark", M, (0.6, 0.42, 0.26), r=0.05, segs=2)
        p.add(bm_frame(rrect(0.58, 0.4, 0.04), rrect(0.5, 0.32, 0.02), -0.02, 0.025), "dark", M @ T(0, 0, 0.13))
        box(p, "glass" if dead == i else "cool", M @ T(0, 0, 0.125), (0.5, 0.33, 0.03), r=0.0)
        box(p, "dark", M @ T(0, 0.22, 0.2), (0.62, 0.015, 0.16), r=0.004)
        for kk in range(4):
            box(p, "dark", M @ T(0, -0.15 + kk * 0.1, -0.16), (0.56, 0.02, 0.1), r=0.004)
        right = (M.to_3x3() @ V(1, 0, 0)).normalized()
        for s in (-1, 1):
            piv = lp + right * (s * 0.33)
            strut(p, "dark", V(lx + s * 0.33, H - 0.03, 0.1), piv, 0.026, 6)
            cyl(p, "dark", facing(piv, right * s) @ T(0, 0, -0.01, PI / 2, 0, 0), 0.055, 0.06, segs=10)
    tube(p, "dark", [V(0.13, H - 0.08, 0.05), V(0.155, H * 0.6, 0.06), V(0.15, 1.7, 0.02), V(0.1, 1.5, -0.13)], 0.022, 6)
    return p


# ---- fuel tank --------------------------------------------------------------------------------------

def build_tank():
    p = Part("SM_Tank")
    L, R = TANK_L, TANK_R
    cy = R + 0.55
    D = R * 0.7
    y0, y1 = -L / 2 + D, L / 2 - D
    prof = []
    N = 12
    for i in range(N + 1):
        a = i / N * PI / 2
        prof.append((R * math.sin(a), -L / 2 + D * (1 - math.cos(a))))
    prof += [(R + 0.012, y0 + 0.02), (R + 0.012, y0 + 0.05), (R, y0 + 0.07)]
    prof += [(R, y1 - 0.07), (R + 0.012, y1 - 0.05), (R + 0.012, y1 - 0.02)]
    for i in range(N, -1, -1):
        a = i / N * PI / 2
        prof.append((R * math.sin(a), L / 2 - D * (1 - math.cos(a))))
    lathe(p, "paint", T(0, cy, 0, 0, 0, -PI / 2), prof, 48)
    # Strap bands, saddles cut to the shell, base beams.
    for bx in (-L * 0.28, L * 0.28):
        ring(p, "hazard", T(bx, cy, 0, 0, 0, -PI / 2), R - 0.04, R + 0.06, 0.24, segs=48, ch=0.02)
        p.add(bm_prism(saddle_outline(R * 0.95, 0.2, cy, R), -0.17, 0.17, bevel=0.015), "dark", T(bx, 0, 0, 0, PI / 2, 0))
        box(p, "dark", V(bx, 0.21, 0), (0.5, 0.04, 2 * R * 0.95 + 0.1), r=0.01)
        for s in (-1, 1):
            cyl(p, "metal", V(bx, cy - 0.3, s * (R + 0.08)), 0.03, 0.2, segs=6)
    for s in (-1, 1):
        box(p, "dark", V(0, 0.1, s * R * 0.75), (L * 0.9, 0.2, 0.18), r=0.02)
    for x in (-L * 0.45, L * 0.45):
        box(p, "dark", V(x, 0.09, 0), (0.25, 0.16, 2 * R * 0.75 + 0.18), r=0.02)
    # Top manway and relief valve.
    lathe(p, "dark", V(L * 0.22, cy + R - 0.05, 0), [(0, 0), (0.32, 0), (0.32, 0.12), (0.29, 0.15), (0, 0.15)], 24)
    for k in range(8):
        a = TAU * k / 8
        cyl(p, "metal", V(L * 0.22 + math.cos(a) * 0.27, cy + R + 0.11, math.sin(a) * 0.27), 0.02, 0.03, segs=6)
    cyl(p, "metal", V(-L * 0.25, cy + R + 0.08, 0), 0.05, 0.3, segs=10)
    cyl(p, "hazard", V(-L * 0.25, cy + R + 0.25, 0), 0.07, 0.06, segs=10, bevel=0.01)
    # Valve box, plumbing, handwheel, gauge, hose at the +X end.
    ex = L / 2 + 0.25
    box(p, "dark", V(ex, 0.55, 0.3), (0.6, 1.0, 0.7), r=0.04, segs=2)
    tube(p, "metal", [V(L / 2 - 0.25, cy, 0.3), V(ex, cy, 0.3), V(ex, 1.05, 0.3)], 0.07, 10)
    cyl(p, "dark", T(L / 2 + 0.04, cy, 0.3, 0, 0, PI / 2), 0.12, 0.05, segs=12, bevel=0.01)
    cyl(p, "dark", V(ex, 1.38, 0.3), 0.12, 0.08, segs=12, bevel=0.01)
    cyl(p, "dark", V(ex, 1.32, 0.3), 0.1, 0.16, segs=10)
    cyl(p, "metal", T(ex + 0.12, 1.32, 0.3, 0, 0, PI / 2), 0.02, 0.2, segs=6)
    torus(p, "hazard", T(ex + 0.22, 1.32, 0.3, 0, 0, PI / 2), 0.15, 0.018, 20, 6)
    for a in (0, PI / 2):
        box(p, "hazard", T(ex + 0.22, 1.32, 0.3, a, 0, 0), (0.02, 0.28, 0.02), r=0.0)
    p.add(bm_frame(circle2(0.075, 14), circle2(0.06, 14), -0.01, 0.02), "metal", T(ex + 0.3, 0.8, 0.48, 0, PI / 2, 0))
    cyl(p, "glass", T(ex + 0.3, 0.8, 0.48, 0, 0, PI / 2), 0.062, 0.02, segs=14)
    for k in range(4):
        box(p, "metal", V(ex + 0.305, 0.3 + k * 0.08, 0.2), (0.01, 0.025, 0.3), r=0.0)
    tube(p, "dark", [V(ex + 0.2, 0.35, 0.55), V(ex + 0.45, 0.12, 0.8), V(ex + 0.9, 0.07, 1.1), V(ex + 1.7, 0.06, 1.25)], 0.06, 8)
    cyl(p, "metal", T(ex + 1.75, 0.06, 1.26, 0, 0, PI / 2 - 0.18), 0.075, 0.14, segs=10)
    # Ladder on the +Z side, held off the shell, grab rails over the top.
    lx, lz = -L * 0.1, R + 0.2
    topy = cy + R - 0.15
    for s in (-1, 1):
        rx = lx + s * 0.22
        cyl(p, "metal", V(rx, topy / 2, lz), 0.025, topy, segs=8)
        box(p, "dark", V(rx, 0.02, lz), (0.1, 0.04, 0.1), r=0.005)
        for yy in (cy, cy + R * 0.6):
            zs = math.sqrt(max(R * R - (yy - cy) ** 2, 0)) - 0.04
            strut(p, "metal", V(rx, yy, zs), V(rx, yy, lz), 0.02, 6)
        tube(p, "metal", [V(rx, topy - 0.05, lz), V(rx, cy + R + 0.22, lz - 0.12), V(rx, cy + R + 0.3, 0.5),
                          V(rx, cy + R - 0.02, 0.12)], 0.025, 6)
    for k in range(8):
        cyl(p, "metal", T(lx, 0.3 + k * 0.33, lz, 0, 0, PI / 2), 0.018, 0.44, segs=6)
    # Data plate on the shell.
    box(p, "dark", facing(V(L * 0.08, cy + 0.2, 0) + V(0, math.sin(0.17), math.cos(0.17)) * R, V(0, math.sin(0.17), math.cos(0.17))),
        (0.7, 0.35, 0.02), r=0.005)
    return p


# ---- cargo container -----------------------------------------------------------------------------------

def build_container():
    p = Part("SM_Container")
    L, W, H = CONTAINER["length"], CONTAINER["width"], CONTAINER["height"]
    box(p, "dark", V(0, H / 2, 0), (L - 0.2, H - 0.16, W - 0.2), r=0.0)
    box(p, "container", V(0, 0.08, 0), (L, 0.16, W), r=0.02)
    for s in (-1, 1):
        box(p, "container", V(0, H - 0.07, s * (W / 2 - 0.06)), (L, 0.14, 0.12), r=0.015)
    for e in (-1, 1):
        box(p, "container", V(e * (L / 2 - 0.06), H - 0.09, 0), (0.12, 0.18, W), r=0.015)
    roof = bm_corrugated(L - 0.24, W - 0.2, 0.5, 0.025)
    p.add(roof, "container", T(0, H - 0.04, 0, -PI / 2, 0, 0), recalc=False)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(p, "container", V(sx * (L / 2 - 0.08), H / 2, sz * (W / 2 - 0.08)), (0.16, H, 0.16), r=0.02)
            for y in (0.09, H - 0.09):
                box(p, "dark", V(sx * (L / 2 - 0.08), y, sz * (W / 2 - 0.08)), (0.19, 0.18, 0.19), r=0.02)
                box(p, "glass", V(sx * (L / 2 - 0.08), y, sz * (W / 2 + 0.0155)), (0.07, 0.04, 0.002), r=0.0)
    wallH = H - 0.24
    wallY = 0.12 + wallH / 2
    for s in (-1, 1):
        p.add(bm_corrugated(L - 0.24, wallH, 0.28, 0.05), "container", T(0, wallY, s * (W / 2 - 0.06), 0, 0 if s > 0 else PI, 0), recalc=False)
        for x in (-1.0, 1.0):
            box(p, "dark", V(x, 0.08, s * (W / 2 + 0.002)), (0.36, 0.1, 0.004), r=0.0)  # fork pockets
    p.add(bm_corrugated(W - 0.24, wallH, 0.28, 0.04), "container", T(-L / 2 + 0.06, wallY, 0, 0, -PI / 2, 0), recalc=False)
    # Door end: two leaves with ribs, locking bars, cams, handles, hinges.
    leafW = W / 2 - 0.12 + 0.035
    for s in (-1, 1):
        lz = s * (0.004 + leafW / 2)
        box(p, "container", V(L / 2 - 0.04, wallY, lz), (0.06, wallH + 0.04, leafW), r=0.012)
        for y in (0.5, 1.0, 1.6, 2.1):
            box(p, "container", V(L / 2 - 0.006, y, lz), (0.012, 0.07, leafW - 0.12), r=0.004)
        for b in (0.18, 0.5):
            z = s * (W / 4 - 0.04) + (b - 0.34) * (W / 2 - 0.2)
            cyl(p, "metal", V(L / 2 + 0.015, H / 2, z), 0.022, H - 0.35, segs=8)
            box(p, "metal", V(L / 2 + 0.045, H * 0.42, z - 0.1), (0.04, 0.05, 0.22), r=0.01)
            for y in (0.22, H - 0.22):
                box(p, "dark", V(L / 2 + 0.02, y, z), (0.07, 0.09, 0.09), r=0.01)
        for y in (0.45, H / 2, H - 0.45):
            box(p, "dark", V(L / 2 + 0.02, y, s * (W / 2 - 0.14)), (0.06, 0.12, 0.1), r=0.01)
    box(p, "paint", V(L / 2 - 0.004, H * 0.72, 0.004 + leafW / 2), (0.006, 0.26, 0.36), r=0.0)
    return p


# ---- solar panel and ground power pedestal -----------------------------------------------------------

def build_solar():
    p = Part("SM_SolarPanel")
    pw, pl = SOLAR["panelW"], SOLAR["panelL"]
    tilt = 0.95
    box(p, "dark", V(0, 0.08, 0), (0.5, 0.25, 0.5), r=0.04)
    cyl(p, "metal", V(0, 0.8, 0), 0.08, 1.5, segs=12, bevel=0.01)
    box(p, "dark", V(0, 1.55, 0), (0.25, 0.2, 0.25), r=0.03)
    cyl(p, "metal", T(0, 1.62, 0, 0, 0, PI / 2), 0.045, 0.6, segs=10)
    pm = T(0, 1.62, 0, tilt, 0, 0)
    box(p, "dark", pm @ T(0, -0.1, 0), (0.12, 0.12, pl * 0.9), r=0.02)
    for zz in (-pl * 0.3, pl * 0.3):
        box(p, "dark", pm @ T(0, -0.055, zz), (pw * 0.92, 0.05, 0.06), r=0.01)
    box(p, "metal", pm, (pw + 0.08, 0.05, pl + 0.08), r=0.012)
    box(p, "paint", pm @ T(0, 0.028, 0), (pw, 0.006, pl), r=0.0)
    nx, nz = 6, 10
    cw, cl = pw / nx, pl / nz
    for i in range(nx):
        for j in range(nz):
            box(p, "solar", pm @ T(-pw / 2 + cw * (i + 0.5), 0.033, -pl / 2 + cl * (j + 0.5)), (cw - 0.014, 0.006, cl - 0.014), r=0.0)
    for s in (-1, 1):
        box(p, "metal", pm @ T(s * (pw / 2 + 0.02), 0.035, 0), (0.04, 0.03, pl + 0.08), r=0.005)
        box(p, "metal", pm @ T(0, 0.035, s * (pl / 2 + 0.02)), (pw + 0.08, 0.03, 0.04), r=0.005)
    box(p, "dark", pm @ T(0.35, -0.05, -0.6), (0.22, 0.05, 0.16), r=0.01)
    a = pm @ V(0.35, -0.08, -0.6)
    tube(p, "dark", [a, V(0.1, 1.3, a.z * 0.5), V(0.09, 0.6, 0.0), V(0.09, 0.25, 0.0)], 0.018, 5)
    return p


def build_pedestal():
    p = Part("SM_Pedestal")
    box(p, "dark", V(0, 0.04, 0), (0.85, 0.12, 0.65), r=0.02)
    box(p, "paint", V(0, 0.59, 0), (0.75, 1.0, 0.55), r=0.035, segs=2)
    box(p, "hazard", V(0, 1.14, 0), (0.82, 0.12, 0.62), r=0.02)
    fz = 0.275
    box(p, "paint", V(0, 0.55, fz + 0.01), (0.6, 0.66, 0.02), r=0.008)
    for y in (0.32, 0.78):
        cyl(p, "dark", V(-0.31, y, fz + 0.015), 0.015, 0.1, segs=6)
    box(p, "metal", V(0.23, 0.56, fz + 0.035), (0.04, 0.16, 0.03), r=0.008)
    box(p, "hazard", V(0, 0.8, fz + 0.022), (0.36, 0.08, 0.004), r=0.0)
    box(p, "dark", V(0.24, 1.0, fz + 0.012), (0.16, 0.07, 0.02), r=0.005)
    box(p, "warm", V(0.21, 1.0, fz + 0.022), (0.04, 0.03, 0.01), r=0.0)
    box(p, "red", V(0.27, 1.0, fz + 0.022), (0.04, 0.03, 0.01), r=0.0)
    cyl(p, "dark", T(0, 1.0, fz + 0.05, PI / 2, 0, 0), 0.08, 0.1, segs=12, bevel=0.01)
    cyl(p, "metal", T(0, 1.0, fz + 0.11, PI / 2, 0, 0), 0.06, 0.04, segs=12)
    for s in (-1, 1):
        for k in range(4):
            box(p, "dark", V(s * 0.377, 0.75 + k * 0.06, 0), (0.01, 0.022, 0.32), r=0.0)
    # Cable drum on the back (axis along local Z).
    zc = -0.44
    cyl(p, "metal", T(0, 0.72, -0.43, PI / 2, 0, 0), 0.04, 0.33, segs=8)
    box(p, "dark", V(0, 0.72, -0.3), (0.14, 0.14, 0.06), r=0.015)
    for z in (zc + 0.115, zc - 0.115):
        cyl(p, "hazard", T(0, 0.72, z, PI / 2, 0, 0), 0.36, 0.025, segs=24, bevel=0.006)
    cyl(p, "dark", T(0, 0.72, zc, PI / 2, 0, 0), 0.22, 0.2, segs=20)
    for k in range(4):
        torus(p, "dark", T(0, 0.72, zc - 0.075 + k * 0.05, PI / 2, 0, 0), 0.245, 0.026, 24, 6)
    box(p, "metal", T(0.18, 0.72, zc - 0.14, 0, 0, 0), (0.04, 0.3, 0.03), r=0.006)
    cyl(p, "dark", T(0.18, 0.6, zc - 0.19, PI / 2, 0, 0), 0.02, 0.1, segs=6)
    tube(p, "dark", [V(0.0, 0.72 - 0.27, zc), V(0.05, 0.25, zc - 0.25), V(0.15, 0.05, zc - 0.5), V(0.35, 0.04, zc - 0.9)], 0.035, 6)
    return p


# ---- finalize: apply modifiers, UVs, export ----------------------------------------------------------

def view3d_override():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    return win, area, region


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


def finalize():
    for p in PARTS:
        p.finish()
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in PIECES.values():
        if ob.modifiers:
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            ob.modifiers.clear()
            old = ob.data
            ob.data = me
            me.name = ob.name
            bpy.data.meshes.remove(old)
        ob.data.validate()
        uv_unwrap(ob)


FILES = {
    "SM_Hab_11": ["SM_Hab_11"], "SM_Hab_10": ["SM_Hab_10"], "SM_Hab_8": ["SM_Hab_8"],
    "SM_Tunnel": ["SM_Tunnel"], "SM_TunnelSupport": ["SM_TunnelSupport"], "SM_TunnelCollar": ["SM_TunnelCollar"],
    "SM_Mast": ["SM_Mast", "SM_Mast_Dish"], "SM_MastCabinet": ["SM_MastCabinet"],
    "SM_Floodlight": ["SM_Floodlight"], "SM_Floodlight_DeadLamp": ["SM_Floodlight_DeadLamp"],
    "SM_Tank": ["SM_Tank"], "SM_Container": ["SM_Container"],
    "SM_SolarPanel": ["SM_SolarPanel"], "SM_Pedestal": ["SM_Pedestal"],
}


def export_all():
    os.makedirs(OUT_DIR, exist_ok=True)
    out = {}
    for fname, names in FILES.items():
        objs = [PIECES[n] for n in names]
        for o in bpy.context.scene.objects:
            o.select_set(o in objs)
        path = f"{OUT_DIR}/{fname}.fbx"
        bpy.ops.export_scene.fbx(
            filepath=path, use_selection=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
            apply_unit_scale=True, bake_space_transform=True, object_types={"MESH"}, bake_anim=False,
            mesh_smooth_type="FACE", use_mesh_modifiers=True, use_triangles=False, path_mode="AUTO")
        out[fname] = path
    return out


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---- preview (lookdev scene, not exported) ------------------------------------------------------------

def sock(sockets, name, kind):
    return next(x for x in sockets if x.name == name and x.type == kind)


def add_weathering(m, dust=0.55, grime=0.35, tint=False):
    """Preview-only shading: dust on up-facing surfaces, grime low down and in crevices, rough variation.
    (The Base Color default value stays the flat paint colour the FBX carries.) tint: multiply by the
    object colour (per-instance container tint)."""
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
    sepp = N("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sepp.inputs[0])
    low = N("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 1.6
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
    if tint:
        oi = N("ShaderNodeObjectInfo")
        nt.links.new(oi.outputs["Color"], sock(paint.inputs, "A", "RGBA"))
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


def inst(name, x, z, yaw=0.0, y=0.0, sy=1.0, sz=1.0, color=None, tag=""):
    """Place a linked copy of a piece at Unity (x, y, z) with the layout's yaw; sz/sy scale Unity Z/Y."""
    src = PIECES[name] if name in PIECES else bpy.data.objects[name]
    ob = bpy.data.objects.new(f"PV_{tag}{name}", src.data)
    bpy.context.scene.collection.objects.link(ob)
    M = (Matrix.Translation(U(x, y, z)) @ Matrix.Rotation(-yaw, 4, "Z") @ Matrix.Diagonal((1, sz, sy, 1)))
    ob.matrix_world = M @ src.matrix_basis
    if color:
        ob.color = (*srgb(color), 1)
    return ob


def figure(x, z, tag=""):
    """1.8 m capsule for scale (signal orange)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.25)
    for v in bm.verts:
        v.co.z += (0.65 if v.co.z > 0 else -0.65) + 0.9
    m = bpy.data.materials.get("PV_Figure") or material("PV_Figure", "#ff7a1a", 0.6)
    ob = preview_object(f"PV_{tag}Figure", bm, m)
    ob.location = U(x, 0, z)
    return ob


ISLANDS = {
    # name: (Unity centre x, z)
    "hab11": (200.0, 0.0), "hab10": (260.0, 0.0), "hab8": (320.0, 0.0), "tunnel": (200.0, 70.0),
    "mast": (260.0, 70.0), "flood": (320.0, 70.0), "tank": (200.0, 140.0), "container": (260.0, 140.0),
    "solar": (320.0, 140.0),
}


def arrange():
    """The outpost as laid out in layout.ts, plus one isolated island per piece for close-ups."""
    placed = {}

    def count(n, k=1):
        placed[n] = placed.get(n, 0) + k

    for h in HABS:
        inst(h["file"], h["x"], h["z"], hab_frame(h)[2])
        count(h["file"])
    for t in TUNNELS:
        pl = tunnel_plan(t)
        a, b = pl["a"], pl["b"]
        d = b - a
        L = d.length
        d.normalize()
        yaw = math.atan2(d.x, d.z)
        n = max(1, round(L))
        seg = L / n
        for k in range(n):
            c = a + d * (seg * (k + 0.5))
            inst("SM_Tunnel", c.x, c.z, yaw, sz=seg)
        count("SM_Tunnel", n)
        for s in pl["supports"]:
            inst("SM_TunnelSupport", s.x, s.z, yaw)
            count("SM_TunnelSupport")
        inst("SM_TunnelCollar", pl["skinA"].x, pl["skinA"].z, yaw)
        inst("SM_TunnelCollar", pl["skinB"].x, pl["skinB"].z, yaw + PI)
        count("SM_TunnelCollar", 2)
    inst("SM_Mast", MAST["x"], MAST["z"])
    inst("SM_Mast_Dish", MAST["x"], MAST["z"])
    count("SM_Mast")
    count("SM_Mast_Dish")
    inst("SM_MastCabinet", MAST_CABINET["x"], MAST_CABINET["z"], MAST_CABINET["yaw"])
    count("SM_MastCabinet")
    for f in FLOODLIGHTS:
        name = "SM_Floodlight_DeadLamp" if f["dead"] is not None else "SM_Floodlight"
        inst(name, f["x"], f["z"], math.atan2(f["aimX"] - f["x"], f["aimZ"] - f["z"]), sy=f["height"] / 8.0)
        count(name)
    for x, z, yaw in TANKS:
        inst("SM_Tank", x, z, yaw)
        count("SM_Tank")
    for x, z, y, yaw, col in CONTAINERS:
        inst("SM_Container", x, z, yaw, y=y, color=col)
        count("SM_Container")
    for x, z in solar_panels():
        inst("SM_SolarPanel", x, z, SOLAR_YAW)
        count("SM_SolarPanel")
    inst("SM_Pedestal", PEDESTAL["x"], PEDESTAL["z"], PEDESTAL["yaw"])
    count("SM_Pedestal")
    figure(-6.6, 4.4)

    # Islands for the close-ups.
    I = ISLANDS
    for key, name in (("hab11", "SM_Hab_11"), ("hab10", "SM_Hab_10"), ("hab8", "SM_Hab_8")):
        inst(name, I[key][0], I[key][1], tag="I_")
    figure(I["hab11"][0] + 3.3, I["hab11"][1] + 6.6, tag="I1_")
    figure(I["hab10"][0] - 4.0, I["hab10"][1] - 5.6, tag="I2_")
    tx, tz = I["tunnel"]
    for k in range(6):
        inst("SM_Tunnel", tx, tz - 2.5 + k, tag="I_")
    inst("SM_TunnelSupport", tx, tz, tag="I_")
    inst("SM_TunnelCollar", tx, tz - 3.0, tag="I_")
    inst("SM_TunnelCollar", tx, tz + 3.0, PI, tag="I_")
    figure(tx + 2.2, tz + 1.5, tag="I3_")
    mx, mz = I["mast"]
    inst("SM_Mast", mx, mz, tag="I_")
    inst("SM_Mast_Dish", mx, mz, tag="I_")
    inst("SM_MastCabinet", mx - 1.2, mz + 2.2, MAST_CABINET["yaw"], tag="I_")
    figure(mx + 1.6, mz + 2.6, tag="I4_")
    inst("SM_Floodlight", I["flood"][0], I["flood"][1], tag="I_")
    inst("SM_Floodlight_DeadLamp", I["flood"][0] - 6.0, I["flood"][1] - 4.0, 0.3, tag="I_")
    figure(I["flood"][0] + 1.0, I["flood"][1] + 1.2, tag="I5_")
    inst("SM_Tank", I["tank"][0], I["tank"][1], tag="I_")
    figure(I["tank"][0] + 1.4, I["tank"][1] + 2.6, tag="I6_")
    cx, cz = I["container"]
    inst("SM_Container", cx, cz, color="#566466", tag="I_")
    inst("SM_Container", cx - 0.2, cz - 2.45, 0.03, color="#8a5634", tag="I_")
    inst("SM_Container", cx - 0.3, cz - 1.2, 0.08, y=2.6, color="#b4afa3", tag="I_")
    figure(cx + 4.0, cz + 1.0, tag="I7_")
    sx, sz = I["solar"]
    inst("SM_SolarPanel", sx, sz, tag="I_")
    inst("SM_SolarPanel", sx - 2.0, sz - 1.1, tag="I_")
    inst("SM_Pedestal", sx + 3.0, sz + 1.6, -0.5, tag="I_")
    figure(sx + 2.0, sz + 2.6, tag="I8_")
    return placed


def setup_preview():
    """Lookdev scene: regolith, the pad, warm low key from WNW, dim cool fill, dark sky."""
    scn = bpy.context.scene
    for o in [o for o in bpy.data.objects if o.name.startswith("PV_")]:
        bpy.data.objects.remove(o, do_unlink=True)
    for ob in PIECES.values():
        ob.hide_render = True
        ob.hide_set(True)
    for key, (d, g) in {"paint": (0.6, 0.4), "dark": (0.45, 0.4), "hazard": (0.6, 0.4), "metal": (0.3, 0.35),
                        "container": (0.6, 0.4), "solar": (0.15, 0.1)}.items():
        m = MAT[key]
        if not any(n.type == "AMBIENT_OCCLUSION" for n in m.node_tree.nodes):
            add_weathering(m, dust=d, grime=g, tint=(key == "container"))
    ground_m = bpy.data.materials.get("PV_Regolith") or material("PV_Regolith", "#6f675d", 0.95)
    pad_m = bpy.data.materials.get("PV_Pad") or material("PV_Pad", "#5d5a55", 0.85)
    if not any(n.type == "AMBIENT_OCCLUSION" for n in pad_m.node_tree.nodes):
        add_weathering(pad_m, dust=0.5, grime=0.0)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=600)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, -0.02))
    preview_object("PV_Ground", bm, ground_m)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=64, radius1=13.6, radius2=12.9, depth=0.18)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.07))
    pad = preview_object("PV_Pad", bm, pad_m)
    pad.location = U(LANDING_PAD["x"], 0, LANDING_PAD["z"])
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
    bounce = bpy.data.lights.get("PV_Bounce") or bpy.data.lights.new("PV_Bounce", "SUN")
    bounce.color = srgb("#c89a6a")
    bounce.energy = 0.25
    bounce.angle = math.radians(30)
    bo = bpy.data.objects.new("PV_Bounce", bounce)
    scn.collection.objects.link(bo)
    bo.rotation_euler = (-U(*PLANET_DIR)).to_track_quat("-Z", "Y").to_euler()
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
    scn.render.resolution_x = 960
    scn.render.resolution_y = 540
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = False
    scn.view_settings.view_transform = "AgX"
    scn.view_settings.exposure = 0.3
    return arrange()


def isl(key, x, y, z):
    cx, cz = ISLANDS[key]
    return V(cx + x, y, cz + z)


SHOTS = {
    # name: (Unity camera position, Unity target, lens mm, ortho scale or None, key: "world" or camera-relative)
    "overview_west": (V(-58.0, 21.0, 30.0), V(-8.0, 0.0, -3.0), 30, None, "world"),
    "overview_pad": (V(10.0, 7.5, 17.0), V(-16.0, 3.0, -4.0), 26, None, "world"),
    "hab11": (isl("hab11", 10.5, 4.0, 13.5), isl("hab11", 0.5, 2.4, 1.0), 30, None, "cam"),
    "airlock": (isl("hab11", 6.6, 1.7, 9.0), isl("hab11", 2.2, 2.0, 3.6), 32, None, "cam"),
    "hab10": (isl("hab10", -8.5, 4.5, -13.0), isl("hab10", 0.5, 2.6, -0.5), 30, None, "cam"),
    "hab8": (isl("hab8", 9.0, 5.0, 11.0), isl("hab8", -0.5, 2.4, 0.0), 30, None, "cam"),
    "tunnel": (isl("tunnel", 5.5, 3.2, 5.0), isl("tunnel", 0.0, 1.7, 0.0), 30, None, "cam"),
    "mast": (isl("mast", 13.0, 7.0, 22.0), isl("mast", 0.0, 8.0, 0.0), 30, None, "cam"),
    "mast_top": (isl("mast", 4.5, 16.5, 7.5), isl("mast", -0.7, 13.8, 1.1), 35, None, "cam"),
    "floodlight": (isl("flood", 6.0, 4.5, 10.0), isl("flood", -1.0, 4.0, 0.0), 30, None, "cam"),
    "tank": (isl("tank", 8.0, 3.6, 8.5), isl("tank", 0.6, 1.5, 0.0), 32, None, "cam"),
    "container": (isl("container", 9.5, 4.0, 7.0), isl("container", 0.0, 2.0, -1.0), 30, None, "cam"),
    "solar": (isl("solar", 6.5, 2.6, 8.5), isl("solar", 0.6, 1.2, 0.3), 32, None, "cam"),
    "plan": (V(-2.0, 90.0, 0.0), V(-2.0, 0.0, 0.0), 50, 66.0, "world"),
}


def render_previews(out_dir, names=None):
    scn = bpy.context.scene
    cam_data = bpy.data.cameras.get("PV_Cam") or bpy.data.cameras.new("PV_Cam")
    cam = bpy.data.objects.get("PV_Cam") or bpy.data.objects.new("PV_Cam", cam_data)
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    scn.camera = cam
    key = bpy.data.objects["PV_Key"]
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for name, (pos, target, lens, ortho, mode) in SHOTS.items():
        if names and name not in names:
            continue
        cam_data.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam_data.ortho_scale = ortho
        cam_data.lens = lens
        cam_data.clip_end = 800
        cam.location = U(*pos)
        if name == "plan":
            cam.rotation_euler = (0, 0, math.radians(180))
        else:
            d = U(*target) - U(*pos)
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        if mode == "world":
            sun_dir = SUN_DIR
        else:
            az = math.atan2(pos.x - target.x, -(pos.z - target.z)) + math.radians(40)
            el = math.radians(11)
            sun_dir = V(math.cos(el) * math.sin(az), math.sin(el), -math.cos(el) * math.cos(az))
        key.rotation_euler = (-U(*sun_dir)).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(out_dir, f"outpost_{name}.png")
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
    PIECES.clear()


def build_all():
    for h in HABS:
        build_hab(h)
    build_tunnel()
    build_tunnel_support()
    build_tunnel_collar()
    build_mast()
    build_mast_dish()
    build_cabinet()
    build_floodlight()
    build_floodlight("SM_Floodlight_DeadLamp", dead=2)
    build_tank()
    build_container()
    build_solar()
    build_pedestal()


def main(preview_dir=None):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    clear_scene()
    make_materials()
    build_all()
    finalize()
    files = export_all()
    stats = {"tris": {n: tris(o) for n, o in PIECES.items()}, "files": sorted(files)}
    placed = setup_preview()
    stats["placed_total"] = sum(stats["tris"][n] * k for n, k in placed.items())
    stats["placed"] = placed
    if preview_dir:
        stats["renders"] = render_previews(preview_dir)
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, copy=True)
    stats["materials"] = sorted({m.name for o in PIECES.values() for m in o.data.materials})
    return stats


if not globals().get("OUTPOST_NO_MAIN"):
    result = main(globals().get("OUTPOST_PREVIEW_DIR"))
