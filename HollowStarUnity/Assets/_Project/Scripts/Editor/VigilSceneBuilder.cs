using HollowStar.Core;
using HollowStar.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Builds the Chapter 1 scene from code: terrain, outpost greybox, lighting per the art bible,
    /// sky, post-processing, the 3/4 camera, and the co-op setup (network, session flow, lobby and
    /// HUD). Players are spawned by netcode when a room or solo game starts. Re-run it after changing
    /// any of the builders: Hollow Star > Build Vigil Scene.
    /// </summary>
    public static class VigilSceneBuilder
    {
        public const string ScenePath = "Assets/_Project/Scenes/Vigil.unity";
        private const string SettingsFolder = "Assets/_Project/Settings";
        private const int IgnoreRaycastLayer = 2;

        private static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }

        private static Vector3 Dir(double x, double y, double z) => new Vector3((float)x, (float)y, (float)z).normalized;

        [MenuItem("Hollow Star/Build Vigil Scene")]
        public static void BuildScene()
        {
            ProceduralTextures.GenerateAll();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var world = new GameObject("World");
            var vigil = world.AddComponent<VigilWorld>();
            var (near, far) = VigilTerrainBuilder.Build(world.transform);
            vigil.Near = near;
            vigil.Far = far;
            OutpostGreyboxBuilder.Build(world.transform);

            BuildLighting();
            BuildPostProcessing();
            TunePipeline();
            BuildCamera();
            var playerPrefab = CoopBuilder.BuildPlayerPrefab(CharacterImport.Import());
            var flow = CoopBuilder.BuildNetwork(playerPrefab);
            CoopBuilder.BuildUI(flow);

            System.IO.Directory.CreateDirectory("Assets/_Project/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("[HollowStar] Vigil scene built.");
        }

        private static void BuildLighting()
        {
            // Key: the Hollow, a dim red giant ~11 degrees above the west-north-west horizon.
            var sunGo = new GameObject("Sun_Hollow");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = Hex("#ffb27a");
            sun.intensity = 2.4f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.92f;
            sun.shadowBias = 0.05f;
            sun.shadowNormalBias = 0.4f;
            sunGo.transform.rotation = Quaternion.LookRotation(-Dir(Layout.SunDirX, Layout.SunDirY, Layout.SunDirZ));
            RenderSettings.sun = sun;

            // Bounce from the gas giant Orrin: dusty amber from the opposite side, no shadows.
            var orrinGo = new GameObject("Fill_Orrin");
            var orrin = orrinGo.AddComponent<Light>();
            orrin.type = LightType.Directional;
            orrin.color = Hex("#b0895f");
            orrin.intensity = 0.22f;
            orrin.shadows = LightShadows.None;
            orrinGo.transform.rotation = Quaternion.LookRotation(-Dir(Layout.PlanetDirX, Layout.PlanetDirY, Layout.PlanetDirZ));

            // Sky fill: cool blue-violet from above, so shadows stay readable and never go black.
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.16f, 0.17f, 0.26f);
            RenderSettings.ambientEquatorColor = new Color(0.17f, 0.13f, 0.12f);
            RenderSettings.ambientGroundColor = new Color(0.07f, 0.06f, 0.05f);

            // Thin haze: distance fades toward the horizon colour.
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.00016f;
            RenderSettings.fogColor = new Color(0.36f, 0.27f, 0.26f);

            System.IO.Directory.CreateDirectory(SettingsFolder);
            string skyPath = $"{SettingsFolder}/M_Sky_Vigil.mat";
            var sky = AssetDatabase.LoadAssetAtPath<Material>(skyPath);
            if (sky == null)
            {
                sky = new Material(Shader.Find("Skybox/Procedural"));
                AssetDatabase.CreateAsset(sky, skyPath);
            }
            sky.SetFloat("_SunDisk", 2f);
            sky.SetFloat("_SunSize", 0.11f);
            sky.SetFloat("_SunSizeConvergence", 2.2f);
            sky.SetFloat("_AtmosphereThickness", 0.42f);
            sky.SetColor("_SkyTint", new Color(0.34f, 0.3f, 0.42f));
            sky.SetColor("_GroundColor", new Color(0.12f, 0.1f, 0.09f));
            sky.SetFloat("_Exposure", 0.6f);
            EditorUtility.SetDirty(sky);
            RenderSettings.skybox = sky;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
        }

        private static T Add<T>(VolumeProfile profile) where T : VolumeComponent
        {
            var c = profile.Add<T>(true);
            c.name = typeof(T).Name;
            AssetDatabase.AddObjectToAsset(c, profile);
            return c;
        }

        private static void BuildPostProcessing()
        {
            string path = $"{SettingsFolder}/PP_Vigil.asset";
            AssetDatabase.DeleteAsset(path);
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, path);

            Add<Tonemapping>(profile).mode.Override(TonemappingMode.ACES);
            var bloom = Add<Bloom>(profile);
            bloom.threshold.Override(1.1f);
            bloom.intensity.Override(0.55f);
            bloom.scatter.Override(0.68f);
            var grade = Add<ColorAdjustments>(profile);
            grade.postExposure.Override(0.25f);
            grade.contrast.Override(10f);
            grade.saturation.Override(-8f);
            var vignette = Add<Vignette>(profile);
            vignette.intensity.Override(0.24f);
            vignette.smoothness.Override(0.45f);
            EditorUtility.SetDirty(profile);

            var go = new GameObject("PostProcess_Global");
            var vol = go.AddComponent<Volume>();
            vol.isGlobal = true;
            vol.sharedProfile = profile;
        }

        /// <summary>Shadows and HDR for a 3/4 camera on an M4 Air: only the sun casts shadows.</summary>
        private static void TunePipeline()
        {
            void Tune(RenderPipelineAsset a)
            {
                if (!(a is UniversalRenderPipelineAsset urp)) return;
                urp.shadowDistance = 220f;
                urp.shadowCascadeCount = 4;
                urp.supportsHDR = true;
                urp.msaaSampleCount = 1;
                EditorUtility.SetDirty(urp);
            }

            Tune(GraphicsSettings.defaultRenderPipeline);
            for (int i = 0; i < QualitySettings.count; i++) Tune(QualitySettings.GetRenderPipelineAssetAt(i));
        }

        private static void BuildCamera()
        {
            var go = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 42f;
            cam.nearClipPlane = 0.25f;
            cam.farClipPlane = 20000f;
            go.AddComponent<AudioListener>();
            var data = go.AddComponent<UniversalAdditionalCameraData>();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            var rig = go.AddComponent<CameraRig>();
            rig.Obstacles = ~(1 << IgnoreRaycastLayer);
        }
    }
}
