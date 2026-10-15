using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.TextCore.Text;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Builds the UI font assets (dynamic SDF) from the TTFs in UI/Fonts, so USS can point at them with
    /// -unity-font-definition and get crisp text plus text-shadow glow. Orbitron ships as one variable font;
    /// FreeType selects its named instances through the face index ((instance + 1) &lt;&lt; 16), which gives
    /// real Medium and Bold cuts instead of a synthesised bold.
    /// </summary>
    public static class UiAssetBuilder
    {
        public const string FontFolder = "Assets/_Project/UI/Fonts";
        private const int SamplingSize = 72;
        // Wide padding so text-shadow glow has room to spread inside the glyph cell.
        private const int Padding = 18;
        private const int AtlasSize = 1024;

        // Everything the UI prints: ASCII plus the Latin-1 symbols used in labels (middle dot, degree, multiply...).
        private const string Characters =
            " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
            " °·×–—…−æøåÆØÅéèüöä";

        private struct FontSpec
        {
            public string Source, Output;
            public int FaceIndex;
            public FontSpec(string source, string output, int faceIndex = 0)
            {
                Source = source;
                Output = output;
                FaceIndex = faceIndex;
            }
        }

        private static readonly FontSpec[] Specs =
        {
            new FontSpec("Orbitron-Variable.ttf", "Orbitron-Medium.asset", 2 << 16),
            new FontSpec("Orbitron-Variable.ttf", "Orbitron-SemiBold.asset", 3 << 16),
            new FontSpec("Orbitron-Variable.ttf", "Orbitron-Bold.asset", 4 << 16),
            new FontSpec("Rajdhani-Regular.ttf", "Rajdhani-Regular.asset"),
            new FontSpec("Rajdhani-Medium.ttf", "Rajdhani-Medium.asset"),
            new FontSpec("Rajdhani-SemiBold.ttf", "Rajdhani-SemiBold.asset"),
            new FontSpec("Rajdhani-Bold.ttf", "Rajdhani-Bold.asset"),
        };

        [MenuItem("Hollow Star/Build UI Assets")]
        public static void BuildAll()
        {
            BuildFonts(force: false);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[HollowStar] UI assets built.");
        }

        /// <summary>
        /// The overload that takes a face index is internal, so reach it by reflection; the public ones always
        /// load face 0 (the variable font's default instance).
        /// </summary>
        private static FontAsset CreateAsset(Font font, int faceIndex)
        {
            if (faceIndex != 0)
            {
                var method = typeof(FontAsset).GetMethod(
                    "CreateFontAsset",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public,
                    null,
                    new[]
                    {
                        typeof(Font), typeof(int), typeof(int), typeof(int), typeof(GlyphRenderMode),
                        typeof(int), typeof(int), typeof(AtlasPopulationMode), typeof(bool),
                    },
                    null);
                if (method != null)
                {
                    return (FontAsset)method.Invoke(null, new object[]
                    {
                        font, faceIndex, SamplingSize, Padding, GlyphRenderMode.SDFAA,
                        AtlasSize, AtlasSize, AtlasPopulationMode.Dynamic, true,
                    });
                }
                Debug.LogWarning("[HollowStar] FontAsset.CreateFontAsset(face index) not found; using the default instance.");
            }
            return FontAsset.CreateFontAsset(
                font, SamplingSize, Padding, GlyphRenderMode.SDFAA, AtlasSize, AtlasSize, AtlasPopulationMode.Dynamic, true);
        }

        /// <summary>Creates any missing font asset. <paramref name="force"/> rebuilds all of them.</summary>
        public static void BuildFonts(bool force)
        {
            bool created = false;
            foreach (var spec in Specs)
            {
                string outPath = $"{FontFolder}/{spec.Output}";
                if (!force && File.Exists(outPath)) continue;
                var font = AssetDatabase.LoadAssetAtPath<Font>($"{FontFolder}/{spec.Source}");
                if (font == null)
                {
                    Debug.LogError($"[HollowStar] Missing font {spec.Source}");
                    continue;
                }

                var asset = CreateAsset(font, spec.FaceIndex);
                if (asset == null)
                {
                    Debug.LogError($"[HollowStar] Could not create a font asset for {spec.Output}");
                    continue;
                }

                asset.TryAddCharacters(Characters, out _);
                string name = Path.GetFileNameWithoutExtension(spec.Output);
                asset.name = name;

                if (File.Exists(outPath)) AssetDatabase.DeleteAsset(outPath);
                AssetDatabase.CreateAsset(asset, outPath);
                if (asset.material != null)
                {
                    asset.material.name = name + " Material";
                    AssetDatabase.AddObjectToAsset(asset.material, asset);
                }
                if (asset.atlasTextures != null)
                {
                    for (int i = 0; i < asset.atlasTextures.Length; i++)
                    {
                        var tex = asset.atlasTextures[i];
                        if (tex == null) continue;
                        tex.name = $"{name} Atlas {i}";
                        AssetDatabase.AddObjectToAsset(tex, asset);
                    }
                }
                EditorUtility.SetDirty(asset);
                created = true;
            }

            if (created)
            {
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
            }
        }
    }
}
