using HollowStar.Game.Characters;
using UnityEditor;
using UnityEngine;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Sets up the Blender astronaut in Unity: URP suit materials, FBX import settings with the
    /// Blender materials remapped onto them, and the Astronaut prefab with its procedural animator.
    /// </summary>
    public static class CharacterImport
    {
        public const string FbxPath = "Assets/_Project/Art/Models/Characters/SK_Astronaut.fbx";
        public const string PrefabPath = "Assets/_Project/Prefabs/Astronaut.prefab";
        private const string MatFolder = "Assets/_Project/Art/Materials/Suit";

        private static Material Lit(string name, string hex, float smooth, float metal = 0f, Color? emission = null)
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
            return m;
        }

        [MenuItem("Hollow Star/Import Astronaut")]
        public static GameObject Import()
        {
            var fabric = Lit("M_SuitFabric", "#cfcac0", 0.18f);
            var shell = Lit("M_SuitShell", "#dcd9d2", 0.55f);
            var dark = Lit("M_SuitDark", "#33363b", 0.35f, 0.2f);
            var metal = Lit("M_SuitMetal", "#8e9298", 0.65f, 0.9f);
            var vanguard = Lit("M_SuitAccent_Vanguard", "#ff7a1a", 0.45f, 0f, new Color(2.6f, 1.05f, 0.25f) * 0.5f);
            var tether = Lit("M_SuitAccent_Tether", "#29d3ff", 0.45f, 0f, new Color(0.3f, 1.5f, 2.6f) * 0.5f);
            var visor = Lit("M_Visor", "#c99a3c", 0.97f, 1f);
            var lamp = Lit("M_SuitLamp", "#fff2dd", 0.3f, 0f, new Color(1f, 0.95f, 0.87f) * 8f);

            var imp = (ModelImporter)AssetImporter.GetAtPath(FbxPath);
            imp.animationType = ModelImporterAnimationType.Generic;
            imp.avatarSetup = ModelImporterAvatarSetup.NoAvatar;
            imp.importAnimation = false;
            imp.importBlendShapes = false;
            imp.importCameras = false;
            imp.importLights = false;
            imp.importNormals = ModelImporterNormals.Import;
            imp.optimizeGameObjects = false;
            imp.materialImportMode = ModelImporterMaterialImportMode.ImportViaMaterialDescription;
            void Remap(string name, Material m) => imp.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), name), m);
            Remap("M_SuitFabric", fabric);
            Remap("M_SuitShell", shell);
            Remap("M_SuitDark", dark);
            Remap("M_SuitMetal", metal);
            Remap("M_SuitAccent", vanguard);
            Remap("M_Visor", visor);
            Remap("M_SuitLamp", lamp);
            imp.SaveAndReimport();

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(FbxPath);
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(model);
            var avatar = inst.AddComponent<SuitAvatar>();
            avatar.VanguardAccent = vanguard;
            avatar.TetherAccent = tether;
            foreach (var smr in inst.GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                // The procedural pose moves bones far from the bind pose: keep the bounds following them.
                smr.updateWhenOffscreen = true;
                smr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            }
            System.IO.Directory.CreateDirectory("Assets/_Project/Prefabs");
            var prefab = PrefabUtility.SaveAsPrefabAsset(inst, PrefabPath);
            Object.DestroyImmediate(inst);
            AssetDatabase.SaveAssets();
            return prefab;
        }
    }
}
