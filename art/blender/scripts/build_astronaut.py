# Builds the Hollow Star EVA-suit astronaut (mesh, materials, rig, skin weights) and exports it
# for Unity. Run inside Blender (e.g. through the Blender MCP):
#     exec(open("/Users/mikkel/Hollow Star/art/blender/scripts/build_astronaut.py").read())
#
# Everything is placed in UNITY coordinates through U(), so the joint table matches
# HollowStarUnity/Assets/_Project/Scripts/Game/Characters/SuitRig.cs (and the web version's
# src/characters/rig.ts) number for number. The FBX exporter settings below map Blender
# (x, y, z) to Unity (-x, z, -y) and import every bone unrotated, which the procedural
# locomotion relies on.

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = "/Users/mikkel/Hollow Star"
FBX_PATH = f"{ROOT}/HollowStarUnity/Assets/_Project/Art/Models/Characters/SK_Astronaut.fbx"
BLEND_PATH = f"{ROOT}/art/blender/astronaut.blend"


def U(x, y, z):
    """Unity position -> Blender position."""
    return Vector((-x, -z, y))


def to_unity(v):
    return Vector((-v.x, v.z, -v.y))


# ---- rig (same numbers as rig.ts) --------------------------------------------------------------

DIM = dict(hipY=0.95, hipX=0.105, thigh=0.43, shin=0.42, ankleY=0.1, shoulderX=0.235, shoulderY=1.425,
           upperArm=0.29, forearm=0.26)
SX, SY = DIM["shoulderX"], DIM["shoulderY"]
JOINTS = {
    "pelvis": (0, 0.98, 0),
    "spine": (0, 1.08, -0.01),
    "chest": (0, 1.24, -0.012),
    "neck": (0, 1.5, -0.005),
    "head": (0, 1.535, 0),
    "clavL": (0.06, 1.42, -0.012),
    "armL": (SX, SY, -0.012),
    "foreL": (SX, SY - DIM["upperArm"], -0.012),
    "handL": (SX, SY - DIM["upperArm"] - DIM["forearm"], -0.008),
    "clavR": (-0.06, 1.42, -0.012),
    "armR": (-SX, SY, -0.012),
    "foreR": (-SX, SY - DIM["upperArm"], -0.012),
    "handR": (-SX, SY - DIM["upperArm"] - DIM["forearm"], -0.008),
    "thighL": (DIM["hipX"], DIM["hipY"], 0),
    "shinL": (DIM["hipX"], DIM["hipY"] - DIM["thigh"], 0),
    "footL": (DIM["hipX"], DIM["ankleY"], 0),
    "thighR": (-DIM["hipX"], DIM["hipY"], 0),
    "shinR": (-DIM["hipX"], DIM["hipY"] - DIM["thigh"], 0),
    "footR": (-DIM["hipX"], DIM["ankleY"], 0),
    "pack": (0, 1.26, -0.17),
    "antenna": (-0.15, 1.53, -0.3),
}
PARENT = {
    "pelvis": None, "spine": "pelvis", "chest": "spine", "neck": "chest", "head": "neck",
    "clavL": "chest", "armL": "clavL", "foreL": "armL", "handL": "foreL",
    "clavR": "chest", "armR": "clavR", "foreR": "armR", "handR": "foreR",
    "thighL": "pelvis", "shinL": "thighL", "footL": "shinL",
    "thighR": "pelvis", "shinR": "thighR", "footR": "shinR",
    "pack": "chest", "antenna": "pack",
}


def J(name):
    return Vector(JOINTS[name])


# Bone segments (Unity coordinates) used to compute skin weights.
def seg(name):
    a = J(name)
    ends = {
        "pelvis": J("spine"), "spine": J("chest"), "chest": J("neck"), "neck": J("head"),
        "head": a + Vector((0, 0.22, 0)),
        "clavL": J("armL"), "armL": J("foreL"), "foreL": J("handL"), "handL": a + Vector((0, -0.11, 0)),
        "clavR": J("armR"), "armR": J("foreR"), "foreR": J("handR"), "handR": a + Vector((0, -0.11, 0)),
        "thighL": J("shinL"), "shinL": J("footL"), "footL": a + Vector((0, -0.08, 0.2)),
        "thighR": J("shinR"), "shinR": J("footR"), "footR": a + Vector((0, -0.08, 0.2)),
        "pack": a + Vector((0, 0.1, 0)), "antenna": a + Vector((0, 0.3, 0)),
    }
    return a, ends[name]


# ---- materials ----------------------------------------------------------------------------------

def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(name, hexcol, rough, metal=0.0, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    col = srgb(hexcol)
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        b.inputs["Emission Strength"].default_value = 6.0
    m.diffuse_color = (*col, 1)
    return m


MAT = {}


def make_materials():
    MAT["fabric"] = material("M_SuitFabric", "#cfcac0", 0.85)
    MAT["shell"] = material("M_SuitShell", "#d9d6cf", 0.45)
    MAT["dark"] = material("M_SuitDark", "#33363b", 0.6, 0.3)
    MAT["metal"] = material("M_SuitMetal", "#8e9298", 0.35, 0.9)
    MAT["accent"] = material("M_SuitAccent", "#ff7a1a", 0.5)
    MAT["visor"] = material("M_Visor", "#2a1c08", 0.05, 1.0)
    MAT["lamp"] = material("M_SuitLamp", "#fff2dd", 0.3, 0.0, emit="#fff2dd")


# ---- mesh helpers -------------------------------------------------------------------------------

PARTS = []  # (object, candidate bones)


def basis_for(axis):
    """Two unit vectors perpendicular to `axis` (Blender space): side (x-ish) and front (y-ish)."""
    axis = axis.normalized()
    ref = Vector((0, -1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    e1 = ref.cross(axis).normalized()
    e2 = axis.cross(e1).normalized()
    return e1, e2


def add_part(name, bm, mat, bones, subsurf=0, smooth=True, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MAT[mat])
    for p in me.polygons:
        p.use_smooth = smooth
    if bevel > 0:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    if subsurf > 0:
        mod = ob.modifiers.new("Subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf
    PARTS.append((ob, bones))
    return ob


def lathe(name, a, b, profile, mat, bones, segs=18, ellipse=(1.0, 1.0), cap0=True, cap1=True, subsurf=1, offset=None):
    """Surface of revolution from Unity point a to b. profile: [(t 0..1, radius)]."""
    A, B = U(*a), U(*b)
    axis = B - A
    e1, e2 = basis_for(axis)
    bm = bmesh.new()
    rings = []
    for t, r in profile:
        c = A + axis * t
        if offset:
            c = c + U(*offset(t)) - U(0, 0, 0)
        ring = []
        for i in range(segs):
            ang = 2 * math.pi * i / segs
            p = c + e1 * (math.cos(ang) * r * ellipse[0]) + e2 * (math.sin(ang) * r * ellipse[1])
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    if cap0:
        bm.faces.new(list(reversed(rings[0])))
    if cap1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return add_part(name, bm, mat, bones, subsurf=subsurf)


def ellipsoid(name, center, radii, mat, bones, segs=24, rings=14, subsurf=0, keep=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    c = U(*center)
    for v in bm.verts:
        u = to_unity(v.co)  # unit sphere in Unity axes
        v.co = U(center[0] + u.x * radii[0], center[1] + u.y * radii[1], center[2] + u.z * radii[2])
    if keep:
        dead = [v for v in bm.verts if not keep(to_unity(v.co) - Vector(center))]
        bmesh.ops.delete(bm, geom=dead, context="VERTS")
    return add_part(name, bm, mat, bones, subsurf=subsurf)


def box(name, center, size, mat, bones, bevel=0.01, subsurf=0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        u = to_unity(v.co)
        u = Vector((u.x * size[0], u.y * size[1], u.z * size[2]))
        if rot:
            u = rot @ u
        v.co = U(center[0] + u.x, center[1] + u.y, center[2] + u.z)
    return add_part(name, bm, mat, bones, smooth=bevel > 0, bevel=bevel, subsurf=subsurf)


def torus(name, center, axis_unity, major, minor, mat, bones, segs=28, sides=10, squash=1.0):
    bm = bmesh.new()
    c = U(*center)
    axis = (U(*axis_unity) - U(0, 0, 0)).normalized()
    e1, e2 = basis_for(axis)
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        d = e1 * math.cos(a) + e2 * math.sin(a)
        ring = []
        for j in range(sides):
            b = 2 * math.pi * j / sides
            p = c + d * (major + minor * math.cos(b)) + axis * (minor * squash * math.sin(b))
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(segs):
        for j in range(sides):
            i2, j2 = (i + 1) % segs, (j + 1) % sides
            bm.faces.new((rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return add_part(name, bm, mat, bones)


def convolute(t, t0, t1, n, amp):
    """Bellows ribs between t0 and t1: n bumps of height amp."""
    if t < t0 or t > t1:
        return 0.0
    s = (t - t0) / (t1 - t0)
    return amp * max(0.0, math.sin(math.pi * s * n)) ** 0.7


def samples(t0, t1, n):
    return [t0 + (t1 - t0) * i / n for i in range(n + 1)]


# ---- the suit -------------------------------------------------------------------------------------

def build_suit():
    # Torso: hard upper torso shell, bellows waist, brief.
    lathe("HUT", (0, 1.11, -0.015), (0, 1.52, -0.015),
          [(0, 0.16), (0.15, 0.185), (0.35, 0.205), (0.6, 0.212), (0.78, 0.2), (0.9, 0.17), (0.97, 0.12), (1, 0.08)],
          "shell", ["chest", "spine"], segs=24, ellipse=(1.0, 0.76))
    ts = samples(0, 1, 16)
    lathe("Waist", (0, 0.96, -0.01), (0, 1.15, -0.012),
          [(t, 0.158 + convolute(t, 0.1, 0.9, 4, 0.012)) for t in ts], "fabric", ["pelvis", "spine", "chest"],
          segs=22, ellipse=(1.0, 0.74), subsurf=1)
    ellipsoid("Brief", (0, 0.935, 0.0), (0.165, 0.09, 0.118), "fabric", ["pelvis", "thighL", "thighR"], subsurf=1)
    torus("WaistRing", (0, 1.13, -0.012), (0, 1, 0), 0.165, 0.016, "metal", ["spine"], squash=1.4)
    # Chest display and control module.
    box("DCM", (0, 1.24, 0.15), (0.2, 0.11, 0.07), "dark", ["chest"], bevel=0.012)
    box("DCM_Screen", (0, 1.255, 0.186), (0.11, 0.045, 0.004), "lamp", ["chest"], bevel=0.0)
    for s in (1, -1):
        box(f"DCM_Hose{s}", (0.07 * s, 1.18, 0.14), (0.025, 0.06, 0.025), "dark", ["chest"], bevel=0.008)

    # Legs: thigh, knee convolutes, shin; boots.
    for side, suffix in ((1, "L"), (-1, "R")):
        x = DIM["hipX"] * side
        hip = (x, 0.98, 0.0)
        ankle = (x, 0.12, 0.0)
        length = hip[1] - ankle[1]
        knee_t = (hip[1] - 0.52) / length
        prof = []
        for t in samples(0, 1, 30):
            r = 0.094 - 0.03 * t
            r += 0.006 * math.sin(math.pi * min(1, t / knee_t))  # thigh bulk
            r += 0.007 * math.sin(math.pi * max(0, (t - knee_t) / (1 - knee_t)) * 0.9)  # calf
            r += convolute(t, knee_t - 0.07, knee_t + 0.07, 3, 0.009)
            prof.append((t, r))
        lathe(f"Leg{suffix}", hip, ankle, prof, "fabric", ["pelvis", f"thigh{suffix}", f"shin{suffix}", f"foot{suffix}"],
              segs=18, cap0=False, offset=lambda t: (0, 0, 0.012 * math.sin(math.pi * t)))
        lathe(f"ShinAccent{suffix}", (x, 0.36, 0.004), (x, 0.31, 0.004), [(0, 0.071), (1, 0.071)], "accent",
              [f"shin{suffix}"], segs=18, subsurf=0)
        lathe(f"ThighAccent{suffix}", (x, 0.84, 0.0), (x, 0.8, 0.0), [(0, 0.093), (1, 0.092)], "accent",
              [f"thigh{suffix}"], segs=18, subsurf=0)
        torus(f"KneePad{suffix}", (x, 0.52, 0.07), (0, 0, 1), 0.035, 0.016, "shell", [f"shin{suffix}"], segs=16, sides=8)
        torus(f"BootCuff{suffix}", (x, 0.17, 0.0), (0, 1, 0), 0.064, 0.016, "metal", [f"foot{suffix}", f"shin{suffix}"])
        box(f"Boot{suffix}", (x, 0.085, 0.055), (0.13, 0.13, 0.3), "shell", [f"foot{suffix}"], bevel=0.035, subsurf=1)
        box(f"BootToeCap{suffix}", (x, 0.07, 0.17), (0.125, 0.09, 0.09), "dark", [f"foot{suffix}"], bevel=0.03, subsurf=1)
        box(f"BootSole{suffix}", (x, 0.016, 0.055), (0.135, 0.032, 0.31), "dark", [f"foot{suffix}"], bevel=0.012)

    # Arms: shoulder bearing, upper arm, elbow convolutes, forearm, wrist disconnect, glove.
    for side, suffix in ((1, "L"), (-1, "R")):
        x = SX * side
        sh = (x, SY + 0.005, -0.012)
        wr = (x, 0.885, -0.008)
        length = sh[1] - wr[1]
        elbow_t = DIM["upperArm"] / length
        prof = []
        for t in samples(0, 1, 26):
            r = 0.068 - 0.022 * t + 0.004 * math.sin(math.pi * min(1, t / elbow_t))
            r += convolute(t, elbow_t - 0.08, elbow_t + 0.08, 3, 0.008)
            prof.append((t, r))
        lathe(f"Arm{suffix}", sh, wr, prof, "fabric", ["chest", f"arm{suffix}", f"fore{suffix}", f"hand{suffix}"],
              segs=16, cap0=False)
        lathe(f"ArmAccent{suffix}", (x, 1.31, -0.012), (x, 1.27, -0.012), [(0, 0.069), (1, 0.068)], "accent",
              [f"arm{suffix}"], segs=16, subsurf=0)
        torus(f"ShoulderBearing{suffix}", (x * 0.93, SY - 0.01, -0.012), (1, 0, 0), 0.082, 0.02, "shell", ["chest", f"arm{suffix}"],
              squash=1.6)
        ellipsoid(f"ShoulderCap{suffix}", (x * 0.9, SY + 0.03, -0.015), (0.075, 0.06, 0.1), "shell", ["chest"], subsurf=1)
        torus(f"Wrist{suffix}", (x, 0.89, -0.008), (0, 1, 0), 0.05, 0.014, "accent", [f"fore{suffix}"], squash=1.5)
        # Glove: palm faces the body (+-X), fingers down.
        box(f"Glove{suffix}", (x, 0.815, 0.0), (0.05, 0.1, 0.09), "dark", [f"hand{suffix}"], bevel=0.02, subsurf=1)
        box(f"GloveCuff{suffix}", (x, 0.87, -0.006), (0.075, 0.035, 0.082), "dark", [f"hand{suffix}"], bevel=0.012, subsurf=1)
        lathe(f"Thumb{suffix}", (x - 0.012 * side, 0.845, 0.04), (x - 0.02 * side, 0.79, 0.075), [(0, 0.016), (0.8, 0.015), (1, 0.008)],
              "dark", [f"hand{suffix}"], segs=10)

    # Helmet: shell, gold visor, neck ring, lamps.
    hc = (0, 1.648, 0.012)
    ellipsoid("Helmet", hc, (0.152, 0.152, 0.158), "shell", ["head"], segs=32, rings=18)
    ellipsoid("Visor", (hc[0], hc[1] - 0.004, hc[2] + 0.004), (0.155, 0.152, 0.161), "visor", ["head"], segs=40, rings=24,
              keep=lambda d: d.z > 0.035 and -0.075 < d.y < 0.105 and abs(d.x) < 0.14)
    torus("NeckRing", (0, 1.505, -0.004), (0, 1, 0), 0.118, 0.026, "metal", ["neck", "chest"], squash=1.2)
    for s in (1, -1):
        lathe(f"Lamp{s}", (0.138 * s, 1.705, 0.03), (0.138 * s, 1.705, 0.09), [(0, 0.022), (1, 0.022)], "shell", ["head"], segs=12, subsurf=0)
        lathe(f"LampLens{s}", (0.138 * s, 1.705, 0.09), (0.138 * s, 1.705, 0.094), [(0, 0.018), (1, 0.018)], "lamp", ["head"], segs=12,
              subsurf=0)
        box(f"HelmetRail{s}", (0.145 * s, 1.66, -0.01), (0.012, 0.03, 0.16), "dark", ["head"], bevel=0.004)

    # Backpack (PLSS) and antenna.
    box("PLSS", (0, 1.24, -0.255), (0.44, 0.56, 0.2), "shell", ["pack"], bevel=0.04, subsurf=1)
    box("PLSS_Top", (0, 1.54, -0.235), (0.34, 0.07, 0.15), "dark", ["pack"], bevel=0.015)
    box("PLSS_Stripe", (0, 1.38, -0.357), (0.4, 0.035, 0.01), "accent", ["pack"], bevel=0.0)
    for s in (1, -1):
        box(f"PLSS_Side{s}", (0.225 * s, 1.18, -0.255), (0.02, 0.36, 0.14), "dark", ["pack"], bevel=0.006)
        lathe(f"PLSS_Hose{s}", (0.17 * s, 1.08, -0.17), (0.09 * s, 1.16, 0.12), [(0, 0.016), (1, 0.016)], "dark", ["pack", "chest"],
              segs=10, subsurf=0)
    for k in range(4):
        box(f"PLSS_Vent{k}", (0, 1.06 + k * 0.035, -0.357), (0.26, 0.012, 0.008), "dark", ["pack"], bevel=0.0)
    lathe("Antenna", JOINTS["antenna"], (-0.15, 1.86, -0.31), [(0, 0.008), (1, 0.004)], "metal", ["antenna"], segs=8, subsurf=0)
    ellipsoid("AntennaTip", (-0.15, 1.865, -0.31), (0.012, 0.012, 0.012), "lamp", ["antenna"], segs=8, rings=6)


# ---- finalize: apply modifiers, weight, join, rig, export -------------------------------------------

def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def apply_and_weight():
    dg = bpy.context.evaluated_depsgraph_get()
    for ob, bones in PARTS:
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.clear()
        old = ob.data
        ob.data = me
        bpy.data.meshes.remove(old)
        groups = {b: ob.vertex_groups.new(name=b) for b in bones}
        segs = {b: seg(b) for b in bones}
        for v in me.vertices:
            p = to_unity(v.co)
            if len(bones) == 1:
                groups[bones[0]].add([v.index], 1.0, "REPLACE")
                continue
            ws = {b: 1.0 / (seg_dist(p, *segs[b]) + 0.012) ** 6 for b in bones}
            top = sorted(ws.items(), key=lambda kv: -kv[1])[:3]
            total = sum(w for _, w in top)
            for b, w in top:
                if w / total > 0.01:
                    groups[b].add([v.index], w / total, "REPLACE")


def build_armature():
    arm = bpy.data.armatures.new("SuitRig")
    rig = bpy.data.objects.new("SuitRig", arm)
    bpy.context.scene.collection.objects.link(rig)
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    bpy.context.view_layer.objects.active = rig
    with bpy.context.temp_override(window=win, area=area, active_object=rig, object=rig):
        bpy.ops.object.mode_set(mode="EDIT")
        eb = {}
        for name in JOINTS:
            b = arm.edit_bones.new(name)
            b.head = U(*JOINTS[name])
            b.tail = b.head + Vector((0, 0, 0.06))
            eb[name] = b
        for name, parent in PARENT.items():
            if parent:
                eb[name].parent = eb[parent]
        bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def join_parts(rig):
    objs = [ob for ob, _ in PARTS]
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    target = objs[0]
    with bpy.context.temp_override(window=win, area=area, active_object=target, object=target,
                                   selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    target.name = "SK_Astronaut"
    target.data.name = "SK_Astronaut"
    # Weld coincident vertices inside each part only (parts stay separate shells).
    target.parent = rig
    mod = target.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return target


def export(rig, mesh):
    os.makedirs(os.path.dirname(FBX_PATH), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o in (rig, mesh))
    bpy.ops.export_scene.fbx(
        filepath=FBX_PATH, use_selection=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
        apply_unit_scale=True, bake_space_transform=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False,
        primary_bone_axis="Y", secondary_bone_axis="X", armature_nodetype="NULL", bake_anim=False,
        mesh_smooth_type="FACE", use_mesh_modifiers=True)


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    PARTS.clear()
    make_materials()
    build_suit()
    apply_and_weight()
    rig = build_armature()
    mesh = join_parts(rig)
    export(rig, mesh)
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, copy=True)
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    return {"triangles": tris, "vertices": len(mesh.data.vertices), "materials": [m.name for m in mesh.data.materials]}


result = main()
