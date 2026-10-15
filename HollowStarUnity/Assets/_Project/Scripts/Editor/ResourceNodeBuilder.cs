using System;
using System.Collections.Generic;
using System.Linq;
using HollowStar.Core;
using HollowStar.Core.Survival;
using HollowStar.Core.Terrain;
using HollowStar.Game.Survival;
using UnityEditor;
using UnityEngine;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Places the ~70 resource nodes from the deterministic scatter (<see cref="ResourceScatter"/>) and gives each a stand-in model
    /// built from primitives and small procedural meshes (<see cref="NodeMeshes"/>) with distinct colours and silhouettes. The Blender
    /// models replace <see cref="BuildModel"/> in U4. Nodes are saved in the scene with their scatter index, so both machines have the
    /// same nodes at the same indices.
    /// </summary>
    public static class ResourceNodeBuilder
    {
        private const string MatFolder = "Assets/_Project/Art/Materials/Nodes";
        private const int IgnoreRaycastLayer = 2;
        /// <summary>The stand-ins are sized to read from the 3/4 camera at 13 m.</summary>
        private const float ModelScale = 1.0f;

#pragma warning disable 0649
        [Serializable] private class RawCollider { public bool circle; public float x, z, r, minX, maxX, minZ, maxZ; }
        [Serializable] private class RawLayout { public RawCollider[] colliders; }
#pragma warning restore 0649

        private static readonly Dictionary<string, Material> mats = new Dictionary<string, Material>();

        // ---- Materials ----

        private static Material Mat(string name, string hex, float smooth = 0.3f, float metal = 0f, Color? emission = null)
        {
            if (mats.TryGetValue(name, out var cached) && cached != null) return cached;
            System.IO.Directory.CreateDirectory(MatFolder);
            string path = $"{MatFolder}/M_Node_{name}.mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null)
            {
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
            else
            {
                m.DisableKeyword("_EMISSION");
            }
            EditorUtility.SetDirty(m);
            mats[name] = m;
            return m;
        }

        private static Color Glow(float r, float g, float b, float k) => new Color(r, g, b) * k;

        // ---- Building ----

        public static List<FlatCollider> LoadBuildings()
        {
            var raw = JsonUtility.FromJson<RawLayout>(AssetDatabase.LoadAssetAtPath<TextAsset>(OutpostGreyboxBuilder.DataPath).text);
            return raw.colliders
                .Select(c => c.circle ? FlatCollider.Circle(c.x, c.z, c.r) : FlatCollider.Box(c.minX, c.maxX, c.minZ, c.maxZ))
                .ToList();
        }

        /// <summary>Scatters the nodes over the near terrain and builds their models. Returns the root.</summary>
        public static Transform Build(Transform parent, Terrain near)
        {
            mats.Clear();
            NodeMeshes.ClearCache();
            var placements = ResourceScatter.Generate(new TerrainModel(7), LoadBuildings());
            var root = new GameObject("ResourceNodes").transform;
            root.SetParent(parent, false);

            for (int i = 0; i < placements.Count; i++)
            {
                var p = placements[i];
                var def = NodeKinds.Get(p.Kind);
                float y = GroundY(near, p.X, p.Z, def.Footprint * p.Scale);

                var go = new GameObject($"Node_{i:00}_{p.Kind}");
                go.transform.SetParent(root, false);
                go.transform.SetPositionAndRotation(new Vector3(p.X, y, p.Z), Quaternion.Euler(0f, p.Yaw * Mathf.Rad2Deg, 0f));
                go.transform.localScale = Vector3.one * p.Scale;

                var visual = new GameObject("Visual").transform;
                visual.SetParent(go.transform, false);
                visual.localScale = Vector3.one * ModelScale;
                BuildModel(p.Kind, p.Variant, i, visual);
                AddCollider(visual.gameObject, p.Kind);
                SetLayerRecursive(visual.gameObject, IgnoreRaycastLayer);

                var node = go.AddComponent<ResourceNode>();
                node.Index = i;
                node.Kind = p.Kind;
                node.Visual = visual.gameObject;
                node.ScanId = def.ScanId;
            }
            AssetDatabase.SaveAssets();
            Debug.Log($"[HollowStar] Resource nodes placed: {placements.Count}.");
            return root;
        }

        private static void SetLayerRecursive(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform t in go.transform) SetLayerRecursive(t.gameObject, layer);
        }

        /// <summary>Never floating: the base sits at the lowest ground under the footprint, sunk a few centimetres.</summary>
        private static float GroundY(Terrain near, float x, float z, float footprint)
        {
            float oy = near.transform.position.y;
            float Sample(float px, float pz) => near.SampleHeight(new Vector3(px, 0f, pz)) + oy;
            float low = Sample(x, z);
            float r = Mathf.Max(0.5f, footprint * 0.8f);
            low = Mathf.Min(low, Sample(x + r, z), Sample(x - r, z), Sample(x, z + r), Sample(x, z - r));
            return low - 0.06f;
        }

        private static void AddCollider(GameObject visual, NodeKind kind)
        {
            switch (kind)
            {
                case NodeKind.FerriteRock:
                case NodeKind.CopperVein:
                {
                    var c = visual.AddComponent<SphereCollider>();
                    c.center = new Vector3(0f, 0.45f, 0f);
                    c.radius = 0.8f;
                    break;
                }
                case NodeKind.QuartzCluster:
                case NodeKind.IceChunk:
                {
                    var c = visual.AddComponent<SphereCollider>();
                    c.center = new Vector3(0f, 0.4f, 0f);
                    c.radius = 0.6f;
                    break;
                }
                case NodeKind.ScrapPile:
                {
                    var c = visual.AddComponent<BoxCollider>();
                    c.center = new Vector3(0f, 0.3f, 0f);
                    c.size = new Vector3(1.6f, 0.6f, 1.3f);
                    break;
                }
                // Plants, sand and cables are walked through.
            }
        }

        // ---- Primitive helpers ----

        private static GameObject Prim(PrimitiveType type, string name, Transform parent, Vector3 pos, Vector3 euler, Vector3 scale, Material mat)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localEulerAngles = euler;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go;
        }

        private static GameObject Msh(Mesh mesh, string name, Transform parent, Vector3 pos, Vector3 euler, Vector3 scale, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localEulerAngles = euler;
            go.transform.localScale = scale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = mat;
            return go;
        }

        private static Vector3 V(float x, float y, float z) => new Vector3(x, y, z);

        /// <summary>A stalk from the ground up, leaning away from the centre.</summary>
        private static GameObject Stalk(Transform parent, Vector3 basePos, float height, float thickness, float lean, float yawDeg, Material mat)
        {
            var go = Prim(PrimitiveType.Cylinder, "Stalk", parent, basePos, V(lean, yawDeg, 0f), V(thickness, height * 0.5f, thickness), mat);
            // A cylinder's pivot is its middle; lift so the base stays on the ground, along the lean.
            go.transform.localPosition = basePos + Quaternion.Euler(lean, yawDeg, 0f) * V(0f, height * 0.5f, 0f);
            return go;
        }

        /// <summary>Points a crystal's +Y along a direction.</summary>
        private static void Aim(GameObject go, Vector3 up) => go.transform.localRotation = Quaternion.FromToRotation(Vector3.up, up.normalized);

        // ---- The stand-in models ----

        /// <summary>One model per kind. About a metre and a half across, bold colours, and a little emission so they read in the Hollow's low light.</summary>
        private static void BuildModel(NodeKind kind, int variant, int index, Transform v)
        {
            var rng = new Mulberry32(unchecked((uint)index * 2654435761u + 977u + (uint)variant));
            float R(float a, float b) => a + (b - a) * (float)rng.NextDouble();

            switch (kind)
            {
                case NodeKind.FerriteRock:
                {
                    var rock = Mat("FerriteRock", "#9a6347", 0.2f, 0.3f, Glow(0.6f, 0.26f, 0.12f, 0.45f));
                    var dark = Mat("FerriteDark", "#6e4535", 0.2f, 0.3f, Glow(0.5f, 0.2f, 0.1f, 0.35f));
                    var ore = Mat("FerriteOre", "#ffb070", 0.5f, 0.5f, Glow(1f, 0.42f, 0.12f, 1.6f));
                    Msh(NodeMeshes.Rock(variant, 0.3f), "Boulder", v, V(0f, 0.34f, 0f), V(0f, R(0, 360), 0f), V(1.25f, 1.25f, 1.25f), rock);
                    Msh(NodeMeshes.Rock(variant + 1, 0.3f), "Boulder2", v, V(0.85f, 0.22f, 0.35f), V(0f, R(0, 360), 0f), V(0.8f, 0.85f, 0.8f), dark);
                    Msh(NodeMeshes.Rock(variant + 2, 0.35f), "Shard", v, V(-0.75f, 0.16f, -0.5f), V(0f, R(0, 360), 0f), V(0.55f, 0.6f, 0.55f), rock);
                    var crystal = NodeMeshes.Crystal(0.7f);
                    for (int k = 0; k < 4; k++)
                    {
                        float a = k * 1.65f + R(0f, 0.5f);
                        var c = Msh(crystal, "OreNodule", v, V(Mathf.Cos(a) * 0.55f, 0.35f + 0.14f * k, Mathf.Sin(a) * 0.55f), V(0f, 0f, 0f), V(0.16f, 0.34f, 0.16f), ore);
                        Aim(c, V(Mathf.Cos(a), 0.6f, Mathf.Sin(a)));
                    }
                    break;
                }
                case NodeKind.CopperVein:
                {
                    var rock = Mat("CopperRock", "#627270", 0.2f, 0.15f, Glow(0.3f, 0.45f, 0.42f, 0.4f));
                    var dark = Mat("CopperDark", "#46524f", 0.2f, 0.15f, Glow(0.25f, 0.36f, 0.34f, 0.35f));
                    var vein = Mat("CopperVein", "#5dffc2", 0.7f, 0.4f, Glow(0.15f, 1f, 0.6f, 2.2f));
                    Msh(NodeMeshes.Rock(variant + 3, 0.28f), "Boulder", v, V(0f, 0.32f, 0f), V(0f, R(0, 360), 0f), V(1.2f, 1.2f, 1.2f), rock);
                    Msh(NodeMeshes.Rock(variant, 0.3f), "Boulder2", v, V(-0.8f, 0.2f, 0.4f), V(0f, R(0, 360), 0f), V(0.75f, 0.8f, 0.75f), dark);
                    var crystal = NodeMeshes.Crystal(0.6f);
                    for (int k = 0; k < 6; k++)
                    {
                        float a = k * 1.05f + R(0f, 0.5f);
                        var c = Msh(crystal, "Vein", v, V(Mathf.Cos(a) * 0.5f, 0.3f + 0.1f * k, Mathf.Sin(a) * 0.5f), V(0f, 0f, 0f), V(0.09f, R(0.4f, 0.75f), 0.09f), vein);
                        Aim(c, V(Mathf.Cos(a), R(0.3f, 1.2f), Mathf.Sin(a)));
                    }
                    break;
                }
                case NodeKind.SilicaPatch:
                {
                    var sand = Mat("Silica", "#f3ecd6", 0.35f, 0f);
                    var glint = Mat("SilicaGlint", "#ffffff", 0.95f, 0f, Glow(1f, 0.95f, 0.8f, 1.6f));
                    Prim(PrimitiveType.Sphere, "Patch", v, V(0f, 0.04f, 0f), V(0f, 0f, 0f), V(3.0f, 0.2f, 2.6f), sand);
                    Prim(PrimitiveType.Sphere, "Dune", v, V(0.3f, 0.07f, 0.1f), V(0f, 25f, 0f), V(1.7f, 0.42f, 0.95f), sand);
                    Prim(PrimitiveType.Sphere, "Dune2", v, V(-0.7f, 0.05f, -0.55f), V(0f, -35f, 0f), V(1.2f, 0.32f, 0.75f), sand);
                    for (int k = 0; k < 6; k++)
                        Prim(PrimitiveType.Cube, "Glint", v, V(R(-1f, 1f), 0.22f, R(-0.9f, 0.9f)), V(R(0, 40), R(0, 90), R(0, 40)), V(0.09f, 0.09f, 0.09f), glint);
                    break;
                }
                case NodeKind.QuartzCluster:
                {
                    var q = Mat("Quartz", "#e6f6ff", 0.95f, 0f, Glow(0.45f, 0.85f, 1.2f, 1.7f));
                    var basalt = Mat("QuartzBase", "#5a5961", 0.2f, 0f, Glow(0.3f, 0.3f, 0.35f, 0.3f));
                    Msh(NodeMeshes.Rock(variant, 0.25f), "Base", v, V(0f, 0.12f, 0f), V(0f, R(0, 360), 0f), V(0.95f, 0.5f, 0.95f), basalt);
                    var crystal = NodeMeshes.Crystal(0.8f);
                    for (int k = 0; k < 7; k++)
                    {
                        float a = k * 0.9f;
                        float h = k == 0 ? 2.1f : R(0.9f, 1.7f);
                        float dist = k == 0 ? 0f : R(0.25f, 0.55f);
                        var c = Msh(crystal, "Crystal", v, V(Mathf.Cos(a) * dist, 0.1f, Mathf.Sin(a) * dist), V(0f, 0f, 0f), V(0.42f, h, 0.42f), q);
                        c.transform.localRotation = Quaternion.Euler(k == 0 ? 0f : Mathf.Cos(a) * 16f, k * 40f, k == 0 ? 0f : Mathf.Sin(a) * 16f);
                    }
                    break;
                }
                case NodeKind.IceChunk:
                {
                    var ice = Mat("Ice", "#c3ecff", 0.98f, 0f, Glow(0.3f, 0.7f, 1.2f, 1.4f));
                    var frost = Mat("Frost", "#f2fbff", 0.6f, 0f);
                    Msh(NodeMeshes.Rock(variant + 1, 0.42f), "Block", v, V(0f, 0.32f, 0f), V(0f, R(0, 360), 0f), V(1.2f, 1.15f, 1.2f), ice);
                    Msh(NodeMeshes.Rock(variant + 2, 0.45f), "Block2", v, V(0.75f, 0.2f, 0.35f), V(0f, R(0, 360), 0f), V(0.7f, 0.8f, 0.7f), ice);
                    var crystal = NodeMeshes.Crystal(0.55f);
                    for (int k = 0; k < 3; k++)
                    {
                        float a = k * 2.1f + R(0f, 0.6f);
                        var c = Msh(crystal, "Spike", v, V(Mathf.Cos(a) * 0.35f - 0.2f, 0.45f, Mathf.Sin(a) * 0.35f - 0.2f), V(0f, 0f, 0f), V(0.5f, R(1.1f, 1.6f), 0.5f), ice);
                        c.transform.localRotation = Quaternion.Euler(Mathf.Cos(a) * 14f, k * 55f, Mathf.Sin(a) * 14f);
                    }
                    Prim(PrimitiveType.Cylinder, "Frost", v, V(0f, 0.03f, 0f), V(0f, 10f, 0f), V(1.9f, 0.03f, 1.7f), frost);
                    break;
                }
                case NodeKind.ScrapPile:
                {
                    var steel = Mat("ScrapSteel", "#a8aeb6", 0.45f, 0.8f, Glow(0.4f, 0.42f, 0.46f, 0.35f));
                    var white = Mat("ScrapHull", "#e2ded2", 0.35f, 0.2f, Glow(0.55f, 0.52f, 0.46f, 0.35f));
                    var dark = Mat("ScrapDark", "#5a5f66", 0.45f, 0.5f, Glow(0.3f, 0.32f, 0.36f, 0.3f));
                    var yellow = Mat("ScrapHazard", "#f2b81c", 0.4f, 0.15f);
                    var warn = Mat("ScrapWarn", "#ff4a2a", 0.5f, 0f, Glow(1f, 0.2f, 0.08f, 3f));
                    Prim(PrimitiveType.Cube, "Plate", v, V(0f, 0.3f, 0f), V(R(8, 20), R(0, 40), R(-10, 10)), V(1.7f, 0.1f, 1.15f), white);
                    Prim(PrimitiveType.Cube, "Plate2", v, V(0.35f, 0.58f, -0.2f), V(R(-28, -12), R(30, 70), R(12, 28)), V(1.35f, 0.09f, 0.9f), steel);
                    Prim(PrimitiveType.Cube, "Plate3", v, V(-0.4f, 0.45f, 0.3f), V(R(12, 30), R(-60, -20), R(-22, -8)), V(1.15f, 0.09f, 0.8f), dark);
                    Prim(PrimitiveType.Cube, "Hazard", v, V(0.2f, 0.75f, 0.4f), V(R(-8, 8), R(10, 50), R(20, 35)), V(0.9f, 0.08f, 0.4f), yellow);
                    Prim(PrimitiveType.Cylinder, "Pipe", v, V(-0.5f, 0.24f, -0.5f), V(90f, R(0, 60), R(70, 100)), V(0.2f, 0.8f, 0.2f), steel);
                    Prim(PrimitiveType.Cube, "Beam", v, V(0.65f, 0.2f, 0.6f), V(0f, R(-40, 40), 0f), V(1.2f, 0.18f, 0.18f), dark);
                    Prim(PrimitiveType.Sphere, "WarnLight", v, V(0.05f, 0.9f, -0.05f), V(0f, 0f, 0f), V(0.14f, 0.14f, 0.14f), warn);
                    break;
                }
                case NodeKind.WiringBundle:
                {
                    var box = Mat("WiringBox", "#3b4048", 0.4f, 0.6f);
                    string[] hex = { "#ff7a2b", "#3aa8ff", "#ffe04c", "#f2f2f2", "#ff7a2b", "#3aa8ff" };
                    Prim(PrimitiveType.Cube, "Junction", v, V(0f, 0.24f, 0f), V(0f, R(0, 90), 0f), V(0.8f, 0.48f, 0.6f), box);
                    Prim(PrimitiveType.Cube, "Lid", v, V(0f, 0.5f, 0f), V(0f, 0f, 0f), V(0.86f, 0.06f, 0.66f), Mat("WiringLid", "#9aa0a7", 0.5f, 0.7f));
                    for (int k = 0; k < hex.Length; k++)
                    {
                        float a = k * 1.05f + R(0f, 0.4f);
                        float len = R(0.9f, 1.4f);
                        Prim(PrimitiveType.Cylinder, "Cable", v, V(Mathf.Cos(a) * (0.35f + len * 0.4f), 0.09f, Mathf.Sin(a) * (0.35f + len * 0.4f)),
                            V(90f, -a * Mathf.Rad2Deg + 90f, 0f), V(0.12f, len * 0.5f, 0.12f), Mat("Wire" + k, hex[k], 0.5f, 0f, Glow(0.12f, 0.12f, 0.12f, 1f) * (k % 2)));
                    }
                    Prim(PrimitiveType.Sphere, "Spark", v, V(0.2f, 0.62f, 0.1f), V(0f, 0f, 0f), V(0.16f, 0.16f, 0.16f),
                        Mat("Spark", "#fff3a0", 0.5f, 0f, Glow(1f, 0.85f, 0.3f, 4.5f)));
                    break;
                }
                case NodeKind.FibreReeds:
                {
                    var a = Mat("ReedA", "#e8d98e", 0.3f, 0f, Glow(0.5f, 0.42f, 0.15f, 0.5f));
                    var b = Mat("ReedB", "#c4b265", 0.3f);
                    var tuft = Mat("ReedTuft", "#fff0b0", 0.25f, 0f, Glow(0.7f, 0.6f, 0.25f, 0.6f));
                    for (int k = 0; k < 14; k++)
                    {
                        float ang = k * 2.4f;
                        float dist = k == 0 ? 0f : R(0.08f, 0.55f);
                        float h = R(1.25f, 2.1f);
                        var s = Stalk(v, V(Mathf.Cos(ang) * dist, 0f, Mathf.Sin(ang) * dist), h, 0.08f, R(4f, 15f), ang * Mathf.Rad2Deg, k % 2 == 0 ? a : b);
                        var top = s.transform;
                        Prim(PrimitiveType.Sphere, "Tuft", v, top.localPosition + top.localRotation * V(0f, h * 0.5f, 0f), V(0f, 0f, 0f), V(0.16f, 0.34f, 0.16f), tuft);
                    }
                    break;
                }
                case NodeKind.ResinPods:
                {
                    var stem = Mat("ResinStem", "#5b4a33", 0.3f);
                    var amber = Mat("Resin", "#ffb83d", 0.95f, 0f, Glow(1f, 0.55f, 0.1f, 1.1f));
                    var mound = Mat("ResinMound", "#4c3f31", 0.2f);
                    Prim(PrimitiveType.Sphere, "Mound", v, V(0f, 0.08f, 0f), V(0f, 0f, 0f), V(1.3f, 0.32f, 1.3f), mound);
                    for (int k = 0; k < 4; k++)
                    {
                        float a = k * 1.6f + R(0f, 0.5f);
                        float h = R(0.5f, 0.85f);
                        var pos = V(Mathf.Cos(a) * 0.38f, 0f, Mathf.Sin(a) * 0.38f);
                        Stalk(v, pos, h, 0.08f, R(6f, 12f), a * Mathf.Rad2Deg, stem);
                        Prim(PrimitiveType.Sphere, "Pod", v, pos + V(0f, h + 0.14f, 0f), V(0f, 0f, 0f), V(0.5f, 0.62f, 0.5f), amber);
                    }
                    break;
                }
                case NodeKind.LumenBulbs:
                {
                    var stem = Mat("LumenStem", "#3a6b58", 0.3f);
                    var leaf = Mat("LumenLeaf", "#2a5f55", 0.3f);
                    var glow = Mat("LumenGlow", "#86ffd6", 0.9f, 0f, Glow(0.25f, 1.2f, 0.85f, 2.6f));
                    Prim(PrimitiveType.Sphere, "Leaf", v, V(0f, 0.05f, 0f), V(0f, 0f, 0f), V(1.5f, 0.15f, 1.4f), leaf);
                    for (int k = 0; k < 4; k++)
                    {
                        float a = k * 1.6f + R(0f, 0.6f);
                        float h = R(0.45f, 0.95f);
                        var pos = V(Mathf.Cos(a) * 0.34f, 0f, Mathf.Sin(a) * 0.34f);
                        Stalk(v, pos, h, 0.07f, R(5f, 12f), a * Mathf.Rad2Deg, stem);
                        Prim(PrimitiveType.Sphere, "Bulb", v, pos + V(0f, h + 0.16f, 0f), V(0f, 0f, 0f), V(0.4f, 0.44f, 0.4f), glow);
                    }
                    break;
                }
                case NodeKind.SporeberryBush:
                {
                    var leaf = Mat("BushLeaf", "#6e3d89", 0.25f);
                    var leaf2 = Mat("BushLeaf2", "#552f6e", 0.25f);
                    var berry = Mat("Berry", "#ff3b7c", 0.85f, 0f, Glow(1f, 0.1f, 0.35f, 1.1f));
                    Prim(PrimitiveType.Sphere, "Mass", v, V(0f, 0.45f, 0f), V(0f, 0f, 0f), V(1.4f, 0.95f, 1.35f), leaf);
                    Prim(PrimitiveType.Sphere, "Mass2", v, V(0.5f, 0.35f, 0.3f), V(0f, 0f, 0f), V(0.9f, 0.75f, 0.85f), leaf2);
                    Prim(PrimitiveType.Sphere, "Mass3", v, V(-0.45f, 0.32f, -0.3f), V(0f, 0f, 0f), V(0.85f, 0.7f, 0.8f), leaf2);
                    for (int k = 0; k < 11; k++)
                    {
                        float a = k * 0.58f + R(0f, 0.3f);
                        float up = R(0.15f, 0.8f);
                        Prim(PrimitiveType.Sphere, "Berry", v, V(Mathf.Cos(a) * 0.74f * (1.15f - up * 0.4f), 0.35f + up, Mathf.Sin(a) * 0.7f * (1.15f - up * 0.4f)),
                            V(0f, 0f, 0f), V(0.2f, 0.2f, 0.2f), berry);
                    }
                    break;
                }
                case NodeKind.TuberMound:
                {
                    var soil = Mat("TuberSoil", "#9c744a", 0.15f);
                    var shoot = Mat("TuberShoot", "#a8d655", 0.3f, 0f, Glow(0.3f, 0.45f, 0.1f, 0.5f));
                    var knob = Mat("Tuber", "#f0d8a2", 0.45f);
                    Prim(PrimitiveType.Sphere, "Mound", v, V(0f, 0.14f, 0f), V(0f, 0f, 0f), V(1.8f, 0.7f, 1.65f), soil);
                    for (int k = 0; k < 5; k++)
                    {
                        float a = k * 1.3f + R(0f, 0.5f);
                        float dist = R(0.1f, 0.5f);
                        float h = R(0.55f, 1.0f);
                        var pos = V(Mathf.Cos(a) * dist, 0.25f, Mathf.Sin(a) * dist);
                        Stalk(v, pos, h, 0.08f, R(10f, 25f), a * Mathf.Rad2Deg, shoot);
                        Prim(PrimitiveType.Sphere, "Leaf", v, pos + V(Mathf.Cos(a) * 0.14f, h, Mathf.Sin(a) * 0.14f), V(R(-20, 20), a * Mathf.Rad2Deg, 0f), V(0.42f, 0.09f, 0.26f), shoot);
                    }
                    Prim(PrimitiveType.Sphere, "Tuber", v, V(0.6f, 0.3f, 0.2f), V(0f, 30f, 0f), V(0.34f, 0.23f, 0.25f), knob);
                    Prim(PrimitiveType.Sphere, "Tuber2", v, V(-0.45f, 0.32f, -0.45f), V(0f, -20f, 0f), V(0.3f, 0.2f, 0.23f), knob);
                    break;
                }
            }
        }
    }
}
