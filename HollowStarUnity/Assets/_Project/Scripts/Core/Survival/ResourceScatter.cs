using System;
using System.Collections.Generic;
using HollowStar.Core.Terrain;

namespace HollowStar.Core.Survival
{
    /// <summary>Where one node goes. Heights come from the baked terrain at build time, so only x and z live here.</summary>
    public readonly struct NodePlacement
    {
        public readonly NodeKind Kind;
        public readonly float X, Z;
        /// <summary>Yaw in radians.</summary>
        public readonly float Yaw;
        /// <summary>0.85..1.25: size variation.</summary>
        public readonly float Scale;
        /// <summary>Which of the stand-in model variants to use.</summary>
        public readonly int Variant;

        public NodePlacement(NodeKind kind, float x, float z, float yaw, float scale, int variant)
        {
            Kind = kind;
            X = x;
            Z = z;
            Yaw = yaw;
            Scale = scale;
            Variant = variant;
        }
    }

    /// <summary>What the scatter keeps clear of and where it centres the near-base salvage.</summary>
    public sealed class ScatterSettings
    {
        /// <summary>The outpost: every node lies within <see cref="MaxRadius"/> of this.</summary>
        public GroundPoint Origin = new GroundPoint(0f, 0f);
        public float MaxRadius = Layout.PlayRadius;
        /// <summary>The Wren, for salvage near the wreck.</summary>
        public GroundPoint Wren = new GroundPoint(14f, 2.4f);
        /// <summary>The middle of the buildings, for salvage near the outpost.</summary>
        public GroundPoint Outpost = new GroundPoint(-17f, -1f);
        /// <summary>The landing pad: nothing is placed on it.</summary>
        public GroundPoint Pad = Layout.LandingPad;
        public float PadRadius = 14.8f;
        /// <summary>Clear space kept around buildings, in addition to a node's own footprint.</summary>
        public float BuildingMargin = 1.4f;
        /// <summary>Gap between two nodes' footprints.</summary>
        public float Spacing = 0.9f;
        /// <summary>Steepest ground a node sits on (rise over run).</summary>
        public float MaxSlope = 0.5f;
    }

    /// <summary>
    /// The seeded scatter of resource nodes (spec section 4). Pure: the same seed and terrain give the same list on both
    /// players' machines. Nodes form small patches, stay inside the play radius, off the buildings and the pad, and
    /// ice goes where the ground is low or in shadow.
    /// </summary>
    public static class ResourceScatter
    {
        /// <summary>The fixed world seed ("KEST").</summary>
        public const uint WorldSeed = 0x4B455354u;

        /// <summary>Samples used for the slope and depression tests, in metres from the point.</summary>
        private const float SlopeStep = 1.5f;
        private const float RingRadius = 7f;
        /// <summary>A spot this much lower than the ground around it counts as a hollow.</summary>
        public const float HollowDepth = 0.7f;
        private const float ShadowReach = 70f;
        private const float ShadowStep = 2f;
        /// <summary>Terrain resolution the heights are sampled at (matches the baked near terrain).</summary>
        private const double SampleRes = 1.0;

        public static List<NodePlacement> Generate(TerrainModel terrain, IReadOnlyList<FlatCollider> colliders, ScatterSettings s = null, uint seed = WorldSeed)
        {
            s ??= new ScatterSettings();
            var rng = new Mulberry32(seed);
            var result = new List<NodePlacement>(NodeKinds.TotalTarget);

            foreach (var def in NodeKinds.All)
            {
                int remaining = def.Target;
                int attempts = 0;
                int cap = 3000;
                while (remaining > 0 && attempts < cap)
                {
                    attempts++;
                    // After a long search the ground rule is relaxed so the kind still appears.
                    bool strict = attempts < cap * 2 / 3;
                    PickCentre(def, rng, s, out float cx, out float cz);
                    if (!Accept(def, cx, cz, terrain, colliders, result, s, strict)) continue;

                    int size = Math.Min(remaining, def.PatchMin + (int)(rng.NextDouble() * (def.PatchMax - def.PatchMin + 1)));
                    for (int m = 0; m < size; m++)
                    {
                        float x = cx, z = cz;
                        bool ok = m == 0;
                        for (int t = 0; t < 14 && !ok; t++)
                        {
                            float a = (float)(rng.NextDouble() * Math.PI * 2.0);
                            float d = def.Footprint * 1.8f + 0.8f + (float)(rng.NextDouble() * 2.6);
                            x = cx + MathF.Cos(a) * d;
                            z = cz + MathF.Sin(a) * d;
                            ok = Accept(def, x, z, terrain, colliders, result, s, strict, centre: false);
                        }
                        if (!ok) continue;
                        float yaw = (float)(rng.NextDouble() * Math.PI * 2.0);
                        float scale = 0.85f + (float)rng.NextDouble() * 0.4f;
                        int variant = (int)(rng.NextDouble() * 3.0);
                        result.Add(new NodePlacement(def.Kind, x, z, yaw, scale, variant));
                        remaining--;
                    }
                }
            }
            return result;
        }

        private static void PickCentre(NodeKindDef def, Mulberry32 rng, ScatterSettings s, out float x, out float z)
        {
            float ang = (float)(rng.NextDouble() * Math.PI * 2.0);
            // Leaning toward the inner edge of the ring, so the first trips from the Wren are short.
            float r0 = def.MinRadius, r1 = def.MaxRadius;
            float r = r0 + (r1 - r0) * MathF.Pow((float)rng.NextDouble(), 1.5f);
            GroundPoint centre = s.Origin;
            if (def.Rule == NodeRule.NearBase) centre = rng.NextDouble() < 0.5 ? s.Wren : s.Outpost;
            x = centre.X + MathF.Cos(ang) * r;
            z = centre.Z + MathF.Sin(ang) * r;
        }

        private static bool Accept(NodeKindDef def, float x, float z, TerrainModel terrain, IReadOnlyList<FlatCollider> colliders,
            List<NodePlacement> placed, ScatterSettings s, bool strict, bool centre = true)
        {
            // Inside the play radius, off the pad and every building footprint.
            if (s.Origin.DistanceTo(x, z) > s.MaxRadius - def.Footprint) return false;
            if (s.Pad.DistanceTo(x, z) < s.PadRadius + def.Footprint) return false;
            float clear = s.BuildingMargin + def.Footprint;
            for (int i = 0; i < colliders.Count; i++)
                if (Near(colliders[i], x, z, clear)) return false;

            // Not crowding another node.
            for (int i = 0; i < placed.Count; i++)
            {
                var p = placed[i];
                float need = def.Footprint + NodeKinds.Get(p.Kind).Footprint + s.Spacing;
                float dx = p.X - x, dz = p.Z - z;
                if (dx * dx + dz * dz < need * need) return false;
            }

            // Ground: not on a cliff.
            double h = terrain.Sample(x, z, SampleRes);
            double rock = terrain.Rock;
            double slopeLimit = def.Rule == NodeRule.ShadowedOrLow ? s.MaxSlope * 1.4 : s.MaxSlope;
            if (Slope(terrain, x, z, h) > slopeLimit) return false;
            if (!strict || !centre) return true;

            switch (def.Rule)
            {
                case NodeRule.ShadowedOrLow:
                    return IsHollow(terrain, x, z, h) || IsShadowed(terrain, x, z, h);
                case NodeRule.Lowland:
                    return Depth(terrain, x, z, h) > -0.15;
                case NodeRule.RockyGround:
                    return rock > 0.12;
                default:
                    return true;
            }
        }

        private static bool Near(FlatCollider c, float x, float z, float clear)
        {
            if (c.IsCircle)
            {
                float dx = x - c.X, dz = z - c.Z, r = c.R + clear;
                return dx * dx + dz * dz < r * r;
            }
            return x > c.MinX - clear && x < c.MaxX + clear && z > c.MinZ - clear && z < c.MaxZ + clear;
        }

        /// <summary>Largest rise over run to the four neighbours, rise over run.</summary>
        public static double Slope(TerrainModel terrain, float x, float z, double h)
        {
            double best = 0;
            best = Math.Max(best, Math.Abs(terrain.Sample(x + SlopeStep, z, SampleRes) - h));
            best = Math.Max(best, Math.Abs(terrain.Sample(x - SlopeStep, z, SampleRes) - h));
            best = Math.Max(best, Math.Abs(terrain.Sample(x, z + SlopeStep, SampleRes) - h));
            best = Math.Max(best, Math.Abs(terrain.Sample(x, z - SlopeStep, SampleRes) - h));
            return best / SlopeStep;
        }

        /// <summary>How far below the average ground on a ring around the point it lies (metres); negative on a bump.</summary>
        public static double Depth(TerrainModel terrain, float x, float z, double h)
        {
            double sum = 0;
            const int n = 8;
            for (int i = 0; i < n; i++)
            {
                double a = i * Math.PI * 2.0 / n;
                sum += terrain.Sample(x + Math.Cos(a) * RingRadius, z + Math.Sin(a) * RingRadius, SampleRes);
            }
            return sum / n - h;
        }

        public static bool IsHollow(TerrainModel terrain, float x, float z, double h) => Depth(terrain, x, z, h) >= HollowDepth;

        /// <summary>True if higher ground between the point and the Hollow blocks its light.</summary>
        public static bool IsShadowed(TerrainModel terrain, float x, float z, double h)
        {
            for (double d = ShadowStep; d <= ShadowReach; d += ShadowStep)
            {
                double hs = terrain.Sample(x + TerrainModel.SunHx * d, z + TerrainModel.SunHz * d, SampleRes);
                if (hs > h + d * TerrainModel.SunTan + 0.2) return true;
            }
            return false;
        }
    }
}
