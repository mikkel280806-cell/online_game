using HollowStar.Game.Survival;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// The Wren: imports <c>SM_Wren.fbx</c> with URP materials (like <see cref="CharacterImport"/>), places it on the pad with
    /// mesh colliders, and hangs everything that belongs to the ship under its root so a later milestone can move the
    /// whole thing: the bay's pressurised zone, the fabricator, the respawn points and the two session spawn points.
    /// </summary>
    public static class WrenBuilder
    {
        public const string FbxPath = "Assets/_Project/Art/Models/Props/SM_Wren.fbx";
        private const string MatFolder = "Assets/_Project/Art/Materials/Wren";
        private const int IgnoreRaycastLayer = 2;

        // The bay, in the Wren's own frame (metres; +Z is toward the tail, the floor is at y = 1.45, the ramp hinge at z = 4.6).
        public static readonly Vector3 BayZoneCenter = new Vector3(0f, 2.9f, 1.9f);
        public static readonly Vector3 BayZoneSize = new Vector3(3.8f, 3.2f, 8.2f);
        public static readonly Vector3 FabricatorPosition = new Vector3(-0.2f, 1.45f, 0.05f);
        public static readonly Vector3[] SessionSpawns = { new Vector3(-0.55f, 1.5f, 2.9f), new Vector3(0.55f, 1.5f, 2.9f) };
        public static readonly Vector3[] RespawnPoints = { new Vector3(-0.5f, 1.5f, 2.2f), new Vector3(0.5f, 1.5f, 2.2f) };

        // ---- Materials ----

        private static Material Lit(string name, string hex, float smooth, float metal, Color? emission = null, float alpha = 1f)
        {
            System.IO.Directory.CreateDirectory(MatFolder);
            string path = $"{MatFolder}/{name}.mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null)
            {
                m = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                AssetDatabase.CreateAsset(m, path);
            }
            ColorUtility.TryParseHtmlString(hex, out Color c);
            c.a = alpha;
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
            if (alpha < 1f)
            {
                // Transparent surface: alpha blend, no depth write, no shadow.
                m.SetFloat("_Surface", 1f);
                m.SetFloat("_Blend", 0f);
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                m.SetFloat("_ZWrite", 0f);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                m.SetOverrideTag("RenderType", "Transparent");
                m.renderQueue = (int)RenderQueue.Transparent;
                m.SetShaderPassEnabled("ShadowCaster", false);
            }
            EditorUtility.SetDirty(m);
            return m;
        }

        /// <summary>Remaps the FBX's Blender materials onto URP ones and keeps the meshes readable for colliders.</summary>
        public static void ImportModel()
        {
            var hull = Lit("M_Wren_Hull", "#cfccc3", 0.45f, 0.08f);
            var dark = Lit("M_Wren_Dark", "#2f3237", 0.45f, 0.3f);
            var metal = Lit("M_Wren_Metal", "#8a8d90", 0.62f, 0.85f);
            var glass = Lit("M_Wren_Glass", "#27323d", 0.95f, 0.2f, alpha: 0.42f);
            var lamp = Lit("M_Wren_Lamp", "#ffd9a8", 0.3f, 0f, new Color(1f, 0.85f, 0.66f) * 5f);
            var hazard = Lit("M_Hazard", "#d1a21f", 0.45f, 0.1f);

            var imp = (ModelImporter)AssetImporter.GetAtPath(FbxPath);
            bool dirty = false;
            void Remap(string name, Material m)
            {
                var id = new AssetImporter.SourceAssetIdentifier(typeof(Material), name);
                if (imp.GetExternalObjectMap().TryGetValue(id, out var existing) && existing == m) return;
                imp.AddRemap(id, m);
                dirty = true;
            }
            if (imp.materialImportMode != ModelImporterMaterialImportMode.ImportViaMaterialDescription)
            {
                imp.materialImportMode = ModelImporterMaterialImportMode.ImportViaMaterialDescription;
                dirty = true;
            }
            if (!imp.isReadable)
            {
                imp.isReadable = true;
                dirty = true;
            }
            if (imp.importCameras || imp.importLights)
            {
                imp.importCameras = false;
                imp.importLights = false;
                dirty = true;
            }
            Remap("M_Wren_Hull", hull);
            Remap("M_Wren_Dark", dark);
            Remap("M_Wren_Metal", metal);
            Remap("M_Wren_Glass", glass);
            Remap("M_Wren_Lamp", lamp);
            Remap("M_Hazard", hazard);
            if (dirty) imp.SaveAndReimport();
        }

        private static void SetLayerRecursive(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform t in go.transform) SetLayerRecursive(t.gameObject, layer);
        }

        // ---- Building ----

        /// <summary>Places the Wren and everything attached to it. <paramref name="yaw"/> is in radians.</summary>
        public static GameObject Build(Transform parent, Vector3 position, float yaw)
        {
            ImportModel();

            var root = new GameObject("Wren");
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw * Mathf.Rad2Deg, 0f));
            root.isStatic = true;

            var model = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(FbxPath), root.transform);
            model.name = "Model";
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.identity;
            foreach (var mf in model.GetComponentsInChildren<MeshFilter>())
            {
                mf.gameObject.isStatic = true;
                var mc = mf.gameObject.AddComponent<MeshCollider>();
                mc.sharedMesh = mf.sharedMesh;
            }

            var anchors = root.AddComponent<WrenAnchors>();
            anchors.SessionSpawns = MakePoints(root.transform, "Spawn_", SessionSpawns, new[] { "Host", "Guest" });
            anchors.RespawnPoints = MakePoints(root.transform, "Respawn_", RespawnPoints, new[] { "A", "B" });

            BuildBayZone(root.transform);
            BuildFabricator(root.transform);
            BuildScanVolume(root.transform);
            return root;
        }

        private static Transform[] MakePoints(Transform root, string prefix, Vector3[] points, string[] names)
        {
            var result = new Transform[points.Length];
            for (int i = 0; i < points.Length; i++)
            {
                var t = new GameObject(prefix + names[i]).transform;
                t.SetParent(root, false);
                // Facing the ramp (the +Z of the ship).
                t.SetLocalPositionAndRotation(points[i], Quaternion.identity);
                result[i] = t;
            }
            return result;
        }

        private static void BuildBayZone(Transform root)
        {
            var go = new GameObject("BayZone");
            go.transform.SetParent(root, false);
            go.layer = IgnoreRaycastLayer;
            var box = go.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.center = BayZoneCenter;
            box.size = BayZoneSize;
            go.AddComponent<PressurisedZone>().Label = "Wren bay";
        }

        private static void BuildScanVolume(Transform root)
        {
            var go = new GameObject("ScanVolume");
            go.transform.SetParent(root, false);
            go.layer = IgnoreRaycastLayer;
            var box = go.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.center = new Vector3(0f, 3.2f, -0.2f);
            box.size = new Vector3(10.6f, 5.4f, 22f);
            var s = go.AddComponent<Scannable>();
            s.ScanId = DatabankContent.WrenId;
            s.DisplayName = "Dropship Wren";
            s.Volume = box;
        }

        // ---- Fabricator: a stand-in console with an emissive screen ----

        private static GameObject Cube(string name, Transform parent, Vector3 pos, Vector3 scale, Material mat, bool collide)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            go.isStatic = true;
            if (!collide) Object.DestroyImmediate(go.GetComponent<Collider>());
            return go;
        }

        private static void BuildFabricator(Transform root)
        {
            var body = Lit("M_Fab_Body", "#3a4048", 0.5f, 0.55f);
            var panel = Lit("M_Fab_Panel", "#cfccc3", 0.4f, 0.08f);
            var screen = Lit("M_Fab_Screen", "#4fd8ff", 0.6f, 0f, new Color(0.2f, 0.85f, 1.2f) * 2.6f);
            var amber = Lit("M_Fab_Amber", "#ffae5c", 0.5f, 0f, new Color(1f, 0.6f, 0.2f) * 3f);

            var go = new GameObject("Fabricator");
            go.transform.SetParent(root, false);
            go.transform.localPosition = FabricatorPosition;
                        go.transform.localRotation = Quaternion.identity;

            // Built along its own +Z (the front, facing the ramp): a cabinet across the end of the aisle, a sloped screen, a print tray.
            Cube("Base", go.transform, new Vector3(0f, 0.55f, 0f), new Vector3(1.2f, 1.1f, 0.62f), body, true);
            Cube("Top", go.transform, new Vector3(0f, 1.13f, 0f), new Vector3(1.28f, 0.08f, 0.7f), panel, false);
            var scr = Cube("Screen", go.transform, new Vector3(-0.08f, 1.62f, -0.08f), new Vector3(0.95f, 0.62f, 0.05f), screen, false);
            scr.transform.localRotation = Quaternion.Euler(-14f, 0f, 0f);
            Cube("ScreenFrame", go.transform, new Vector3(-0.08f, 1.62f, -0.1f), new Vector3(1.05f, 0.72f, 0.05f), body, false).transform.localRotation = Quaternion.Euler(-14f, 0f, 0f);
            var line = Lit("M_Fab_Line", "#0b3a4a", 0.2f, 0f);
            float[] rows = { 0.3f, 0.12f, -0.06f, -0.24f };
            float[] widths = { 0.7f, 0.5f, 0.8f, 0.35f };
            for (int i = 0; i < rows.Length; i++)
            {
                var l = Cube("ScreenLine", scr.transform, new Vector3(-0.1f + (0.8f - widths[i]) * 0.5f, rows[i], 0.75f), new Vector3(widths[i], 0.05f, 0.4f), line, false);
                l.transform.localRotation = Quaternion.identity;
            }
            Cube("Hinge", go.transform, new Vector3(-0.08f, 1.26f, -0.14f), new Vector3(0.3f, 0.28f, 0.14f), body, false);
            Cube("PrintTray", go.transform, new Vector3(0.45f, 1.19f, 0.18f), new Vector3(0.34f, 0.05f, 0.3f), amber, false);
            Cube("StatusStrip", go.transform, new Vector3(0f, 0.9f, 0.32f), new Vector3(1.0f, 0.05f, 0.02f), amber, false);

            var console = go.AddComponent<FabricatorConsole>();
            console.ScanId = DatabankContent.FabricatorId;
            console.ScreenPoint = scr.transform;
            SetLayerRecursive(go, IgnoreRaycastLayer);
        }
    }
}
