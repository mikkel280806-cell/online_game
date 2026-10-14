using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Tileable stand-in ground textures (regolith, basalt, bright ejecta), generated from periodic
    /// noise and saved as PNGs. Placeholders until the Blender-baked set replaces them in U4.
    /// </summary>
    public static class ProceduralTextures
    {
        public const string Folder = "Assets/_Project/Art/Textures/Generated";
        private const int Size = 512;

        private static float Hash(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)x * 0x27d4eb2du ^ (uint)y * 0x165667b1u ^ (uint)seed * 0x9e3779b9u;
                h = (h ^ (h >> 15)) * 0x85ebca6bu;
                h = (h ^ (h >> 13)) * 0xc2b2ae35u;
                h ^= h >> 16;
                return h / 4294967296f;
            }
        }

        /// <summary>Value noise on a lattice that wraps every <paramref name="period"/> cells, so it tiles.</summary>
        private static float PNoise(float x, float y, int period, int seed)
        {
            int x0 = Mathf.FloorToInt(x), y0 = Mathf.FloorToInt(y);
            float fx = x - x0, fy = y - y0;
            float ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
            int Wrap(int v) => ((v % period) + period) % period;
            float a = Hash(Wrap(x0), Wrap(y0), seed), b = Hash(Wrap(x0 + 1), Wrap(y0), seed);
            float c = Hash(Wrap(x0), Wrap(y0 + 1), seed), d = Hash(Wrap(x0 + 1), Wrap(y0 + 1), seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, ux), Mathf.Lerp(c, d, ux), uy) * 2f - 1f;
        }

        /// <summary>Tileable fbm over the unit square (u, v in 0..1). <paramref name="cells"/> sets the base frequency.</summary>
        private static float Fbm(float u, float v, int cells, int octaves, int seed)
        {
            float s = 0, a = 0.5f, norm = 0;
            for (int i = 0; i < octaves; i++)
            {
                int p = cells << i;
                s += a * PNoise(u * p, v * p, p, seed + i * 31);
                norm += a;
                a *= 0.5f;
            }
            return s / norm;
        }

        /// <summary>Tileable cellular noise: distance to the nearest jittered point (0..~1).</summary>
        private static float Cells(float u, float v, int cells, int seed)
        {
            float x = u * cells, y = v * cells;
            int cx = Mathf.FloorToInt(x), cy = Mathf.FloorToInt(y);
            float best = 9f;
            for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++)
            {
                int gx = cx + i, gy = cy + j;
                int wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
                float px = gx + Hash(wx, wy, seed), py = gy + Hash(wx, wy, seed + 7);
                float d = (px - x) * (px - x) + (py - y) * (py - y);
                if (d < best) best = d;
            }
            return Mathf.Sqrt(best);
        }

        private delegate float HeightFn(float u, float v);
        private delegate Color AlbedoFn(float u, float v, float h);

        private static void Write(string name, HeightFn height, AlbedoFn albedo, float bump)
        {
            var hmap = new float[Size * Size];
            for (int y = 0; y < Size; y++)
            for (int x = 0; x < Size; x++)
                hmap[y * Size + x] = height((x + 0.5f) / Size, (y + 0.5f) / Size);

            var col = new Texture2D(Size, Size, TextureFormat.RGBA32, false);
            var nrm = new Texture2D(Size, Size, TextureFormat.RGBA32, false, true);
            var cpx = new Color[Size * Size];
            var npx = new Color[Size * Size];
            float H(int x, int y) => hmap[((y + Size) % Size) * Size + (x + Size) % Size];
            for (int y = 0; y < Size; y++)
            for (int x = 0; x < Size; x++)
            {
                float h = H(x, y);
                cpx[y * Size + x] = albedo((x + 0.5f) / Size, (y + 0.5f) / Size, h);
                float dx = (H(x + 1, y) - H(x - 1, y)) * bump;
                float dy = (H(x, y + 1) - H(x, y - 1)) * bump;
                var n = new Vector3(-dx, -dy, 1f).normalized;
                npx[y * Size + x] = new Color(n.x * 0.5f + 0.5f, n.y * 0.5f + 0.5f, n.z * 0.5f + 0.5f, 1f);
            }
            col.SetPixels(cpx);
            nrm.SetPixels(npx);
            Save(col, $"T_{name}_BaseColor", false);
            Save(nrm, $"T_{name}_Normal", true);
            UnityEngine.Object.DestroyImmediate(col);
            UnityEngine.Object.DestroyImmediate(nrm);
        }

        private static void Save(Texture2D tex, string name, bool normal)
        {
            Directory.CreateDirectory(Folder);
            string path = $"{Folder}/{name}.png";
            File.WriteAllBytes(path, tex.EncodeToPNG());
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            var imp = (TextureImporter)AssetImporter.GetAtPath(path);
            imp.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            imp.sRGBTexture = !normal;
            imp.wrapMode = TextureWrapMode.Repeat;
            imp.anisoLevel = 8;
            imp.maxTextureSize = Size;
            imp.SaveAndReimport();
        }

        private static Color Srgb(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }

        public static void GenerateAll()
        {
            // Regolith: fine dust with soft clods and scattered pebbles. Base #7d7368 (DUST_COLOR).
            Color dust = Srgb("#7d7368");
            Write("Regolith",
                (u, v) => 0.5f * Fbm(u, v, 4, 6, 1) + 0.6f * Mathf.Max(0, 0.22f - Cells(u, v, 24, 5)) * 4f + 0.15f * Fbm(u, v, 32, 3, 9),
                (u, v, h) =>
                {
                    float k = 1f + 0.10f * Fbm(u, v, 3, 4, 2) + 0.06f * Fbm(u, v, 40, 2, 3);
                    float peb = Mathf.Clamp01((0.18f - Cells(u, v, 24, 5)) * 6f);
                    Color c = dust * k;
                    c = Color.Lerp(c, Srgb("#5c554d"), peb * 0.6f);
                    c.a = 1f;
                    return c;
                }, 6f);

            // Basalt: dark rock with lighter strata and fractures. #3f3a36, strata #5a524b.
            Write("Rock",
                (u, v) => 0.6f * Fbm(u, v, 3, 6, 11) + 0.25f * Mathf.Abs(Mathf.Sin((v + 0.08f * Fbm(u, v, 2, 3, 13)) * Mathf.PI * 12f)) - 0.4f * Mathf.Max(0, 0.06f - Cells(u, v, 6, 17)) * 8f,
                (u, v, h) =>
                {
                    float strata = Mathf.Clamp01(0.5f + 0.5f * Mathf.Sin((v + 0.08f * Fbm(u, v, 2, 3, 13)) * Mathf.PI * 12f));
                    Color c = Color.Lerp(Srgb("#3f3a36"), Srgb("#5a524b"), strata * 0.55f + 0.25f * Fbm(u, v, 5, 4, 12));
                    c.a = 1f;
                    return c;
                }, 10f);

            // Bright ejecta: fresh, finer, lighter regolith thrown out of young craters.
            Write("Ejecta",
                (u, v) => 0.4f * Fbm(u, v, 6, 5, 21) + 0.3f * Mathf.Max(0, 0.15f - Cells(u, v, 40, 23)) * 4f,
                (u, v, h) =>
                {
                    Color c = Srgb("#9a9186") * (1f + 0.07f * Fbm(u, v, 4, 4, 22));
                    c.a = 1f;
                    return c;
                }, 4f);
        }
    }
}
