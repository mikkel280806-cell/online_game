using System;
using System.Collections.Generic;
using HollowStar.Core;
using HollowStar.Game.Survival;
using UnityEditor;
using UnityEngine;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Greybox of Survey Outpost Kestrel-7, placed from OutpostLayout.json (exported from the web version's
    /// src/env/props/layout.ts), plus the Blender dropship Wren (<see cref="WrenBuilder"/>). Simple shapes with
    /// real colliders at the right scale; the Blender models replace them piece by piece. The habs get pressurised
    /// zones and the outpost can be scanned.
    /// </summary>
    public static class OutpostGreyboxBuilder
    {
        public const string DataPath = "Assets/_Project/Data/OutpostLayout.json";
        private const string MatFolder = "Assets/_Project/Art/Materials/Greybox";

#pragma warning disable 0649 // fields are filled by JsonUtility
        [Serializable] private class Pad { public float x, z, top, topRadius, baseRadius; }
        [Serializable] private class Profile { public float z, w; }
        [Serializable] private class Ship
        {
            public float x, z, y, yaw, noseZ, tailZ, floorY, rampHingeZ, rampWidth, rampLength;
            public float nacelleX, nacelleY, nacelleZ0, nacelleZ1, nacelleR;
            public Profile[] hull, nacelle;
        }
        [Serializable] private class Hab { public string name; public float x, z; public bool alongX; public float length, radius, lift; }
        [Serializable] private class Tunnel { public float ax, az, bx, bz, radius, y; }
        [Serializable] private class ContainerDims { public float length, width, height; }
        [Serializable] private class Container { public float x, z, y, yaw; public string color, label; }
        [Serializable] private class Crate { public float x, z, y, w, h, d, yaw; public string kind, color; }
        [Serializable] private class Rover { public float x, z, yaw, length, width; }
        [Serializable] private class Mast { public float x, z, height; }
        [Serializable] private class Spot { public float x, z, yaw; }
        [Serializable] private class Flood { public float x, z, height, aimX, aimZ; public bool realLight; public int deadLamp; }
        [Serializable] private class Tank { public float x, z, yaw, length, radius; public string label; }
        [Serializable] private class Panel { public float x, z; public bool fallen, cracked; }
        [Serializable] private class Data
        {
            public Pad pad;
            public Ship ship;
            public Hab[] habs;
            public Tunnel[] tunnels;
            public ContainerDims container;
            public Container[] containers;
            public Crate[] crates;
            public Rover rover;
            public Mast mast;
            public Spot cabinet, pedestal, sign;
            public Flood[] floods;
            public Tank[] tanks;
            public Panel[] solar;
            public float solarYaw;
        }
#pragma warning restore 0649

        private static readonly Dictionary<string, Material> mats = new Dictionary<string, Material>();

        /// <summary>A URP Lit material per colour (sRGB hex), saved under Art/Materials/Greybox.</summary>
        private static Material Mat(string hex, float smooth = 0.3f, float metal = 0f, Color? emission = null)
        {
            string key = $"{hex}_{smooth}_{metal}_{emission}";
            if (mats.TryGetValue(key, out var m) && m != null) return m;
            string name = "M_GB_" + hex.TrimStart('#') + (emission.HasValue ? "_Emit" : "") + (metal > 0 ? "_Metal" : "");
            string path = $"{MatFolder}/{name}.mat";
            m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null)
            {
                System.IO.Directory.CreateDirectory(MatFolder);
                m = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                AssetDatabase.CreateAsset(m, path);
            }
            ColorUtility.TryParseHtmlString(hex, out Color c);
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Smoothness", smooth);
            m.SetFloat("_Metallic", metal);
            if (emission.HasValue)
            {
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", emission.Value);
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            }
            EditorUtility.SetDirty(m);
            mats[key] = m;
            return m;
        }

        private static GameObject Prim(PrimitiveType type, string name, Transform parent, Vector3 pos, Quaternion rot, Vector3 scale, Material mat, bool collide = true)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetLocalPositionAndRotation(pos, rot);
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            if (!collide)
            {
                UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            }
            else if (type == PrimitiveType.Cylinder)
            {
                // A cylinder's default capsule collider grows into a sphere when the cylinder is wider
                // than tall: the flat landing pad became a 13 m invisible dome. Collide with the mesh.
                UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
                go.AddComponent<MeshCollider>().sharedMesh = go.GetComponent<MeshFilter>().sharedMesh;
            }
            go.isStatic = true;
            return go;
        }

        private static Quaternion Yaw(float yaw) => Quaternion.Euler(0f, yaw * Mathf.Rad2Deg, 0f);

        /// <summary>A horizontal cylinder from a to b (Unity's cylinder runs along Y, 2 units long).</summary>
        private static GameObject Tube(string name, Transform parent, Vector3 a, Vector3 b, float radius, Material mat, bool collide = true)
        {
            Vector3 d = b - a;
            return Prim(PrimitiveType.Cylinder, name, parent, (a + b) / 2f, Quaternion.FromToRotation(Vector3.up, d.normalized),
                new Vector3(radius * 2f, d.magnitude / 2f, radius * 2f), mat, collide);
        }

        public static GameObject Build(Transform parent)
        {
            var data = JsonUtility.FromJson<Data>(AssetDatabase.LoadAssetAtPath<TextAsset>(DataPath).text);
            var root = new GameObject("Outpost_Greybox").transform;
            root.SetParent(parent, false);

            var offWhite = Mat("#c9c6bd", 0.35f);
            var gunmetal = Mat("#2b2e33", 0.4f, 0.6f);
            var hazard = Mat("#d1a21f", 0.3f);
            var concrete = Mat("#8e877d", 0.15f);
            var warmLamp = Mat("#ffd9a8", 0.5f, 0f, new Color(1f, 0.85f, 0.66f) * 6f);
            var coolLamp = Mat("#cfe6ff", 0.5f, 0f, new Color(0.81f, 0.9f, 1f) * 6f);
            var beacon = Mat("#ff2a1a", 0.5f, 0f, new Color(1f, 0.16f, 0.1f) * 8f);

            // ---- landing pad -------------------------------------------------------------------
            var pad = data.pad;
            Prim(PrimitiveType.Cylinder, "Pad", root, new Vector3(pad.x, pad.top / 2f, pad.z), Quaternion.identity,
                new Vector3(pad.baseRadius * 2f, pad.top / 2f, pad.baseRadius * 2f), concrete);
            for (int k = 0; k < 12; k++)
            {
                float a = k * Mathf.PI / 6f;
                Prim(PrimitiveType.Cube, "PadEdgeLight", root, new Vector3(pad.x + Mathf.Cos(a) * (pad.topRadius - 0.3f), pad.top + 0.04f, pad.z + Mathf.Sin(a) * (pad.topRadius - 0.3f)),
                    Quaternion.identity, new Vector3(0.25f, 0.08f, 0.25f), k % 2 == 0 ? hazard : warmLamp, false);
            }

            // The Wren is the Blender model; the pad is already under it.
            WrenBuilder.Build(root, new Vector3(data.ship.x, data.ship.y, data.ship.z), data.ship.yaw);

            // ---- habitat modules and tunnels ---------------------------------------------------
            foreach (var h in data.habs)
            {
                var c = new Vector3(h.x, h.lift + h.radius, h.z);
                Vector3 axis = h.alongX ? Vector3.right : Vector3.forward;
                var hab = Tube(h.name, root, c - axis * (h.length / 2f - h.radius * 0.45f), c + axis * (h.length / 2f - h.radius * 0.45f), h.radius, offWhite);
                Prim(PrimitiveType.Sphere, h.name + "_EndA", hab.transform.parent, c - axis * (h.length / 2f - h.radius * 0.45f), Quaternion.identity, new Vector3(h.radius * 2f, h.radius * 2f, h.radius * 2f) * 0.98f, offWhite);
                Prim(PrimitiveType.Sphere, h.name + "_EndB", hab.transform.parent, c + axis * (h.length / 2f - h.radius * 0.45f), Quaternion.identity, new Vector3(h.radius * 2f, h.radius * 2f, h.radius * 2f) * 0.98f, offWhite);
                // Legs.
                Vector3 side = h.alongX ? Vector3.forward : Vector3.right;
                foreach (float s in new[] { -0.35f, 0.35f })
                foreach (float t in new[] { -1f, 1f })
                {
                    Vector3 p = c + axis * (s * h.length) + side * (t * h.radius * 0.7f);
                    Prim(PrimitiveType.Cube, "Leg", root, new Vector3(p.x, h.lift / 2f + 0.2f, p.z), Quaternion.identity, new Vector3(0.18f, h.lift + 0.4f, 0.18f), gunmetal, false);
                }
                // A warm window strip so the lit habs read at dusk.
                Prim(PrimitiveType.Cube, h.name + "_Window", root, c + side * (h.radius * 0.97f) + Vector3.up * 0.3f,
                    Quaternion.LookRotation(axis), new Vector3(0.05f, 0.35f, 0.9f), warmLamp, false);
                AddHabVolumes(root, h, c);
            }
            foreach (var t in data.tunnels)
                Tube("Tunnel", root, new Vector3(t.ax, t.y, t.az), new Vector3(t.bx, t.y, t.bz), t.radius, offWhite);

            // ---- containers, crates, drums -----------------------------------------------------
            var dims = data.container;
            foreach (var c in data.containers)
                Prim(PrimitiveType.Cube, "Container_" + c.label, root, new Vector3(c.x, c.y + dims.height / 2f, c.z), Yaw(c.yaw),
                    new Vector3(dims.length, dims.height, dims.width), Mat(c.color, 0.35f, 0.3f));
            foreach (var c in data.crates)
            {
                if (c.kind == "drum")
                    Prim(PrimitiveType.Cylinder, "Drum", root, new Vector3(c.x, c.y + c.h / 2f, c.z), Quaternion.identity, new Vector3(0.6f, c.h / 2f, 0.6f), Mat(c.color, 0.4f, 0.4f));
                else
                    Prim(PrimitiveType.Cube, c.kind == "case" ? "Case" : "Crate", root, new Vector3(c.x, c.y + c.h / 2f, c.z), Yaw(c.yaw), new Vector3(c.w, c.h, c.d), Mat(c.color, 0.3f));
            }

            // ---- rover ------------------------------------------------------------------------------
            var r = data.rover;
            var rover = Prim(PrimitiveType.Cube, "Rover", root, new Vector3(r.x, 1.25f, r.z), Yaw(r.yaw), new Vector3(r.width, 1.3f, r.length), offWhite);
            foreach (float sx in new[] { -1f, 1f })
            foreach (float sz in new[] { -0.32f, 0.32f })
            {
                Vector3 local = new Vector3(sx * (r.width / 2f + 0.05f), 0.55f, sz * r.length);
                Vector3 w = new Vector3(r.x, 0f, r.z) + Yaw(r.yaw) * local;
                Prim(PrimitiveType.Cylinder, "Wheel", root, w, Yaw(r.yaw) * Quaternion.Euler(0, 0, 90f), new Vector3(1.1f, 0.25f, 1.1f), gunmetal, false);
            }

            // ---- comms mast: the beacon -------------------------------------------------------------
            var mast = data.mast;
            Prim(PrimitiveType.Cube, "Mast_Footing", root, new Vector3(mast.x, 0.2f, mast.z), Quaternion.identity, new Vector3(2.4f, 0.4f, 2.4f), concrete);
            Prim(PrimitiveType.Cube, "Mast", root, new Vector3(mast.x, mast.height / 2f, mast.z), Quaternion.identity, new Vector3(0.7f, mast.height, 0.7f), gunmetal);
            AddScanVolume(root, "Mast_Scan", new Vector3(mast.x, mast.height / 2f, mast.z), new Vector3(4f, mast.height, 4f));
            Prim(PrimitiveType.Sphere, "Mast_Beacon", root, new Vector3(mast.x, mast.height + 0.3f, mast.z), Quaternion.identity, Vector3.one * 0.45f, beacon, false);
            Prim(PrimitiveType.Cube, "Mast_Cabinet", root, new Vector3(data.cabinet.x, 0.75f, data.cabinet.z), Quaternion.identity, new Vector3(1.1f, 1.5f, 0.8f), hazard);
            Prim(PrimitiveType.Cube, "Pad_Pedestal", root, new Vector3(data.pedestal.x, 0.6f, data.pedestal.z), Yaw(data.pedestal.yaw), new Vector3(0.8f, 1.2f, 0.6f), hazard);

            // ---- floodlights ---------------------------------------------------------------------------
            foreach (var f in data.floods)
            {
                Prim(PrimitiveType.Cylinder, "Flood_Pole", root, new Vector3(f.x, f.height / 2f, f.z), Quaternion.identity, new Vector3(0.2f, f.height / 2f, 0.2f), gunmetal);
                var aim = new Vector3(f.aimX, 0f, f.aimZ);
                var head = new Vector3(f.x, f.height, f.z);
                var rot = Quaternion.LookRotation(aim - head);
                Prim(PrimitiveType.Cube, "Flood_Head", root, head, rot, new Vector3(1.0f, 0.5f, 0.25f), f.deadLamp >= 0 ? gunmetal : coolLamp, false);
                if (!f.realLight) continue;
                var lightGo = new GameObject("Flood_Light");
                lightGo.transform.SetParent(root, false);
                lightGo.transform.SetPositionAndRotation(head + rot * Vector3.forward * 0.3f, rot);
                var l = lightGo.AddComponent<Light>();
                l.type = LightType.Spot;
                ColorUtility.TryParseHtmlString("#d8e8ff", out Color lc);
                l.color = lc;
                l.intensity = 60f;
                l.range = 32f;
                l.spotAngle = 80f;
                l.innerSpotAngle = 40f;
                l.shadows = LightShadows.None;
            }

            // ---- fuel tanks ----------------------------------------------------------------------------
            foreach (var t in data.tanks)
            {
                Vector3 axis = Yaw(t.yaw) * Vector3.right;
                var c = new Vector3(t.x, t.radius + 0.5f, t.z);
                Tube("Tank_" + t.label, root, c - axis * (t.length / 2f - t.radius), c + axis * (t.length / 2f - t.radius), t.radius, offWhite);
                Prim(PrimitiveType.Sphere, "Tank_End", root, c - axis * (t.length / 2f - t.radius), Quaternion.identity, Vector3.one * t.radius * 1.96f, offWhite);
                Prim(PrimitiveType.Sphere, "Tank_End", root, c + axis * (t.length / 2f - t.radius), Quaternion.identity, Vector3.one * t.radius * 1.96f, offWhite);
            }

            // ---- solar array: panels tilted toward the Hollow ------------------------------------------
            var panelMat = Mat("#1d2433", 0.8f, 0.5f);
            foreach (var p in data.solar)
            {
                Quaternion q = Yaw(data.solarYaw) * Quaternion.Euler(p.fallen ? -8f : -55f, 0f, 0f);
                Prim(PrimitiveType.Cube, p.fallen ? "Solar_Fallen" : "Solar", root, new Vector3(p.x, p.fallen ? 0.25f : 1.4f, p.z), q, new Vector3(1.9f, 0.05f, 3.3f), panelMat);
                if (!p.fallen) Prim(PrimitiveType.Cube, "Solar_Post", root, new Vector3(p.x, 0.7f, p.z), Quaternion.identity, new Vector3(0.12f, 1.4f, 0.12f), gunmetal, false);
            }

            // ---- sign ----------------------------------------------------------------------------------
            Prim(PrimitiveType.Cube, "Sign", root, new Vector3(data.sign.x, 2.4f, data.sign.z), Yaw(data.sign.yaw), new Vector3(4.4f, 1.1f, 0.08f), offWhite);

            return root.gameObject;
        }

        private const int IgnoreRaycastLayer = 2;

        /// <summary>A pressurised zone inside a hab (the hull is solid for now, so nobody can stand in it until the habs get doors in U5), and a box to scan the outpost from.</summary>
        private static void AddHabVolumes(Transform root, Hab h, Vector3 centre)
        {
            Vector3 inner = h.alongX
                ? new Vector3(h.length * 0.8f, h.radius * 1.5f, h.radius * 1.7f)
                : new Vector3(h.radius * 1.7f, h.radius * 1.5f, h.length * 0.8f);
            var zone = new GameObject(h.name + "_Zone");
            zone.transform.SetParent(root, false);
            zone.transform.position = centre;
            zone.layer = IgnoreRaycastLayer;
            var box = zone.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.size = inner;
            zone.AddComponent<PressurisedZone>().Label = h.name;

            Vector3 outer = h.alongX
                ? new Vector3(h.length + 2f, h.radius * 2f + 2f, h.radius * 2f + 3f)
                : new Vector3(h.radius * 2f + 3f, h.radius * 2f + 2f, h.length + 2f);
            AddScanVolume(root, h.name + "_Scan", centre, outer);
        }

        private static void AddScanVolume(Transform root, string name, Vector3 centre, Vector3 size)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.position = centre;
            go.layer = IgnoreRaycastLayer;
            var box = go.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.size = size;
            var s = go.AddComponent<Scannable>();
            s.ScanId = DatabankContent.OutpostId;
            s.DisplayName = "Kestrel-7 Outpost";
            s.Volume = box;
        }
    }
}
