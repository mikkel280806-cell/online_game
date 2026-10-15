using System.Collections.Generic;
using HollowStar.Core;
using UnityEditor;
using UnityEngine;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Procedural low-poly meshes for the resource node stand-ins: lumpy flat-shaded rocks and pointed crystals. They are saved as
    /// assets so the scene keeps them; the Blender models replace them in U4.
    /// </summary>
    public static class NodeMeshes
    {
        private const string Folder = "Assets/_Project/Art/Models/Nodes";

        public const int RockVariants = 4;

        private static readonly Dictionary<string, Mesh> cache = new Dictionary<string, Mesh>();

        public static void ClearCache() => cache.Clear();

        private static Mesh Save(Mesh mesh, string name)
        {
            System.IO.Directory.CreateDirectory(Folder);
            string path = $"{Folder}/{name}.asset";
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(mesh, path);
            cache[name] = mesh;
            return mesh;
        }

        /// <summary>A flat-shaded mesh from shared-vertex triangles: every triangle gets its own vertices so each face is one tone.</summary>
        private static Mesh FlatMesh(string name, List<Vector3> verts, List<int> tris, Vector3 centre)
        {
            var v = new List<Vector3>(tris.Count);
            var t = new List<int>(tris.Count);
            for (int i = 0; i < tris.Count; i += 3)
            {
                Vector3 a = verts[tris[i]], b = verts[tris[i + 1]], c = verts[tris[i + 2]];
                // Wind every face so it looks outward from the centre, whatever order the lists were written in.
                Vector3 n = Vector3.Cross(b - a, c - a);
                bool pointsOut = Vector3.Dot(n, (a + b + c) / 3f - centre) > 0f;
                t.Add(v.Count);
                t.Add(v.Count + 1);
                t.Add(v.Count + 2);
                v.Add(a);
                v.Add(pointsOut ? b : c);
                v.Add(pointsOut ? c : b);
            }
            var mesh = new Mesh { name = name };
            mesh.SetVertices(v);
            mesh.SetTriangles(t, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>A boulder about 1 m across: a subdivided icosahedron with radial noise, squashed, with a flat base on the ground.</summary>
        public static Mesh Rock(int variant, float sharpness = 0.3f)
        {
            string name = $"Rock_{variant}_{Mathf.RoundToInt(sharpness * 100)}";
            if (cache.TryGetValue(name, out var cached) && cached != null) return cached;

            float phi = (1f + Mathf.Sqrt(5f)) * 0.5f;
            var verts = new List<Vector3>
            {
                new Vector3(-1, phi, 0), new Vector3(1, phi, 0), new Vector3(-1, -phi, 0), new Vector3(1, -phi, 0),
                new Vector3(0, -1, phi), new Vector3(0, 1, phi), new Vector3(0, -1, -phi), new Vector3(0, 1, -phi),
                new Vector3(phi, 0, -1), new Vector3(phi, 0, 1), new Vector3(-phi, 0, -1), new Vector3(-phi, 0, 1),
            };
            var tris = new List<int>
            {
                0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
                1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
                3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
                4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
            };
            // One subdivision: 12 -> 42 vertices, 20 -> 80 triangles.
            var mid = new Dictionary<long, int>();
            int Mid(int a, int b)
            {
                long key = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
                if (mid.TryGetValue(key, out int m)) return m;
                verts.Add(((verts[a] + verts[b]) * 0.5f));
                m = verts.Count - 1;
                mid[key] = m;
                return m;
            }
            var sub = new List<int>();
            for (int i = 0; i < tris.Count; i += 3)
            {
                int a = tris[i], b = tris[i + 1], c = tris[i + 2];
                int ab = Mid(a, b), bc = Mid(b, c), ca = Mid(c, a);
                sub.AddRange(new[] { a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca });
            }

            var rng = new Mulberry32((uint)(variant * 7919 + 31));
            var shaped = new List<Vector3>(verts.Count);
            foreach (var p in verts)
            {
                Vector3 dir = p.normalized;
                float lump = 1f + (float)(rng.NextDouble() - 0.5) * 2f * sharpness;
                Vector3 q = dir * lump;
                q = new Vector3(q.x * 0.62f, q.y * 0.5f, q.z * 0.55f);
                if (q.y < -0.28f) q.y = -0.28f;
                shaped.Add(q);
            }
            // Same displaced vertex for shared edges (midpoints were created once per edge), so the mesh stays closed.
            return Save(FlatMesh(name, shaped, sub, Vector3.zero), name);
        }

        /// <summary>A hexagonal crystal with a pointed tip, 1 m tall and 0.5 m wide at the base (scale it).</summary>
        public static Mesh Crystal(float taper = 0.78f)
        {
            string name = $"Crystal_{Mathf.RoundToInt(taper * 100)}";
            if (cache.TryGetValue(name, out var cached) && cached != null) return cached;

            const int sides = 6;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            // Rings: base (y 0), shoulder (y 0.72), tip.
            for (int i = 0; i < sides; i++)
            {
                float a = i * Mathf.PI * 2f / sides;
                verts.Add(new Vector3(Mathf.Cos(a) * 0.5f, 0f, Mathf.Sin(a) * 0.5f));
            }
            for (int i = 0; i < sides; i++)
            {
                float a = i * Mathf.PI * 2f / sides;
                verts.Add(new Vector3(Mathf.Cos(a) * 0.5f * taper, 0.72f, Mathf.Sin(a) * 0.5f * taper));
            }
            verts.Add(new Vector3(0f, 1f, 0f));
            for (int i = 0; i < sides; i++)
            {
                int j = (i + 1) % sides;
                // Side quad (two triangles), facing outward.
                tris.AddRange(new[] { i, sides + i, sides + j, i, sides + j, j });
                // Tip.
                tris.AddRange(new[] { sides + i, 2 * sides, sides + j });
            }
            return Save(FlatMesh(name, verts, tris, new Vector3(0f, 0.4f, 0f)), name);
        }
    }
}
