using System.Threading;
using System.Threading.Tasks;
using HollowStar.Core;
using HollowStar.Core.Terrain;
using UnityEditor;
using UnityEngine;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Bakes the moon Vigil from <see cref="TerrainModel"/> (the same maths as the web version) into
    /// two Unity terrains: a detailed 2 km square around the outpost and a coarse 20 km square out
    /// to the mountains, with a hole where the near one sits.
    /// </summary>
    public static class VigilTerrainBuilder
    {
        public const string Folder = "Assets/_Project/Art/Terrain";

        private const float NearSize = 2000f;
        private const int NearRes = 2049;
        private const int NearSplatRes = 1024;
        private const float FarSize = 20480f;
        private const int FarRes = 1025;
        private const int FarSplatRes = 512;

        /// <summary>Layers in splat order.</summary>
        public enum Layer
        {
            Regolith = 0,
            Rock = 1,
            Ejecta = 2,
        }

        public static TerrainLayer[] CreateLayers()
        {
            TerrainLayer Make(string name, float tile, float smooth)
            {
                string path = $"{Folder}/TL_{name}.terrainlayer";
                var l = AssetDatabase.LoadAssetAtPath<TerrainLayer>(path);
                if (l == null)
                {
                    l = new TerrainLayer();
                    AssetDatabase.CreateAsset(l, path);
                }
                l.diffuseTexture = AssetDatabase.LoadAssetAtPath<Texture2D>($"{ProceduralTextures.Folder}/T_{name}_BaseColor.png");
                l.normalMapTexture = AssetDatabase.LoadAssetAtPath<Texture2D>($"{ProceduralTextures.Folder}/T_{name}_Normal.png");
                l.normalScale = 1f;
                l.tileSize = new Vector2(tile, tile);
                l.smoothness = smooth;
                l.metallic = 0f;
                EditorUtility.SetDirty(l);
                return l;
            }

            System.IO.Directory.CreateDirectory(Folder);
            return new[] { Make("Regolith", 3.2f, 0.12f), Make("Rock", 7f, 0.22f), Make("Ejecta", 2.6f, 0.1f) };
        }

        public static Material CreateMaterial()
        {
            string path = $"{Folder}/M_Terrain.mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m != null) return m;
            m = new Material(Shader.Find("Universal Render Pipeline/Terrain/Lit"));
            AssetDatabase.CreateAsset(m, path);
            return m;
        }

        /// <summary>Samples heights in parallel: one TerrainModel per thread (it keeps side outputs).</summary>
        private static float[,] SampleHeights(int res, float originX, float originZ, float spacing, System.Func<int, int, double> resAt, out float min, out float max)
        {
            var h = new float[res, res];
            var models = new ThreadLocal<TerrainModel>(() => new TerrainModel(7));
            Parallel.For(0, res, j =>
            {
                var m = models.Value;
                double z = originZ + j * spacing;
                for (int i = 0; i < res; i++) h[j, i] = (float)m.Sample(originX + i * spacing, z, resAt(i, j));
            });
            min = float.MaxValue;
            max = float.MinValue;
            foreach (float v in h)
            {
                if (v < min) min = v;
                if (v > max) max = v;
            }
            return h;
        }

        /// <summary>Splat weights (regolith, rock, ejecta) from the model's material hints plus slope.</summary>
        private static float[,,] SampleSplat(int res, float originX, float originZ, float size)
        {
            var a = new float[res, res, 3];
            float cell = size / res;
            var models = new ThreadLocal<TerrainModel>(() => new TerrainModel(7));
            Parallel.For(0, res, j =>
            {
                var m = models.Value;
                for (int i = 0; i < res; i++)
                {
                    double x = originX + (i + 0.5) * cell, z = originZ + (j + 0.5) * cell;
                    m.Sample(x, z, cell);
                    // Steepness from the model itself (finite differences), so threads never touch TerrainData.
                    double e = cell * 0.5;
                    double hx = m.Sample(x + e, z, cell) - m.Sample(x - e, z, cell);
                    double hz = m.Sample(x, z + e, cell) - m.Sample(x, z - e, cell);
                    m.Sample(x, z, cell);
                    float slope = Mathf.Atan((float)(System.Math.Sqrt(hx * hx + hz * hz) / (2 * e))) * Mathf.Rad2Deg;
                    float rock = Mathf.Max((float)m.Rock, Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(28f, 42f, slope)));
                    float bright = Mathf.Clamp01((float)m.Bright * 1.4f) * (1f - rock);
                    a[j, i, (int)Layer.Rock] = rock;
                    a[j, i, (int)Layer.Ejecta] = bright;
                    a[j, i, (int)Layer.Regolith] = Mathf.Max(0f, 1f - rock - bright);
                }
            });
            return a;
        }

        private static TerrainData MakeData(string name, int res, float size, float[,] heights, float min, float max, TerrainLayer[] layers, int splatRes, float[,,] splat)
        {
            string path = $"{Folder}/{name}.asset";
            AssetDatabase.DeleteAsset(path);
            var td = new TerrainData { heightmapResolution = res };
            float range = Mathf.Max(1f, max - min);
            td.size = new Vector3(size, range, size);
            for (int j = 0; j < res; j++)
            for (int i = 0; i < res; i++)
                heights[j, i] = (heights[j, i] - min) / range;
            td.SetHeights(0, 0, heights);
            td.terrainLayers = layers;
            td.alphamapResolution = splatRes;
            td.SetAlphamaps(0, 0, splat);
            td.baseMapResolution = 1024;
            AssetDatabase.CreateAsset(td, path);
            return td;
        }

        /// <summary>
        /// World Y for the terrain's transform: places min at the bottom, nudged so a world height of
        /// exactly 0 survives Unity's 16-bit heightmap quantisation (the outpost stands at y = 0).
        /// </summary>
        private static float BaseY(float min, float range)
        {
            const float steps = 32766f;
            float q = Mathf.Round(-min / range * steps) / steps;
            return -(q * range);
        }

        public static (Terrain near, Terrain far) Build(Transform parent)
        {
            var layers = CreateLayers();
            var mat = CreateMaterial();

            // ---- near: 2 km around the outpost, ~1 m grid --------------------------------------------
            float nearSpacing = NearSize / (NearRes - 1);
            float nearOrigin = -NearSize / 2f;
            var nh = SampleHeights(NearRes, nearOrigin, nearOrigin, nearSpacing, (i, j) => nearSpacing, out float nmin, out float nmax);
            var nsplat = SampleSplat(NearSplatRes, nearOrigin, nearOrigin, NearSize);
            var nearData = MakeData("VigilNear", NearRes, NearSize, nh, nmin, nmax, layers, NearSplatRes, nsplat);

            // ---- far: 20 km to the skyline, 20 m grid, with a hole for the near terrain -------------
            float farSpacing = FarSize / (FarRes - 1);
            float farOrigin = -FarSize / 2f;
            int holeLo = Mathf.RoundToInt((nearOrigin - farOrigin) / farSpacing);
            int holeHi = Mathf.RoundToInt((nearOrigin + NearSize - farOrigin) / farSpacing);
            bool OnSeam(int i, int j) =>
                i >= holeLo && i <= holeHi && j >= holeLo && j <= holeHi && (i == holeLo || i == holeHi || j == holeLo || j == holeHi);
            // Seam vertices use the near terrain's detail level, so both meshes meet at the same height.
            var fh = SampleHeights(FarRes, farOrigin, farOrigin, farSpacing, (i, j) => OnSeam(i, j) ? nearSpacing : farSpacing, out float fmin, out float fmax);
            var fsplat = SampleSplat(FarSplatRes, farOrigin, farOrigin, FarSize);
            var farData = MakeData("VigilFar", FarRes, FarSize, fh, fmin, fmax, layers, FarSplatRes, fsplat);
            var holes = new bool[FarRes - 1, FarRes - 1];
            for (int j = 0; j < FarRes - 1; j++)
            for (int i = 0; i < FarRes - 1; i++)
                holes[j, i] = !(i >= holeLo && i < holeHi && j >= holeLo && j < holeHi); // false = hole
            farData.SetHoles(0, 0, holes);
            EditorUtility.SetDirty(farData);
            AssetDatabase.SaveAssets();

            var near = Spawn("Terrain_Near", nearData, mat, parent, new Vector3(nearOrigin, BaseY(nmin, nmax - nmin), nearOrigin), 3f, true);
            var far = Spawn("Terrain_Far", farData, mat, parent, new Vector3(farOrigin, BaseY(fmin, fmax - fmin), farOrigin), 8f, false);
            near.SetNeighbors(null, null, null, null);
            return (near, far);
        }

        private static Terrain Spawn(string name, TerrainData data, Material mat, Transform parent, Vector3 pos, float pixelError, bool collider)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            go.isStatic = true;
            var t = go.AddComponent<Terrain>();
            t.terrainData = data;
            t.materialTemplate = mat;
            t.heightmapPixelError = pixelError;
            t.basemapDistance = collider ? 500f : 20000f;
            t.drawInstanced = true;
            t.drawTreesAndFoliage = false;
            t.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            if (collider) go.AddComponent<TerrainCollider>().terrainData = data;
            return t;
        }
    }
}
