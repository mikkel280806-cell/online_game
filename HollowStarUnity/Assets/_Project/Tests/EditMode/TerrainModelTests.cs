using System;
using HollowStar.Core;
using HollowStar.Core.Terrain;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class TerrainModelTests
    {
        // Reference samples from TerrainModel(7) in the web version (src/env/terrain/heightfield.ts),
        // run in Node: x, z, res, height, rock, bright, drift.
        private static readonly double[][] Reference =
        {
            new[] { 0.0, 0, 0, 0, 0, 0, 0.04723032069970844 },
            new[] { 30.0, 10, 0, 0, 0, 0, 0 },
            new[] { 90.0, -40, 0, 2.200496505473067, 0, 0, 0 },
            new[] { 74.0, -58, 0, 4.276933896584815, 1, 0, 0 },
            new[] { -120.0, 60, 0, -2.2831254587964875, 0.42689998782991717, 0.044516000193156914, 1 },
            new[] { 200.0, 150, 0, 6.552475054075142, 0.053738725425817126, 0, 0 },
            new[] { -70.0, -560, 0, -9.444654334177994, 0, -0.35, 0.8459784839167098 },
            new[] { 150.0, -860, 0, -4.52288403139741, 0.2219283535444036, -0.4, 0.11376368608089207 },
            new[] { -300.0, -200, 0, 0.35426150696853737, 0, 0, 0.9999999825376036 },
            new[] { 600.0, 300, 0, 7.1946498101810406, 0, 0, 0.2644288530019454 },
            new[] { 1500.0, -2200, 0, 36.895271636935476, 0.007606813915574495, 0, 0 },
            new[] { -4000.0, 1500, 0, 69.8948666645613, 0.4192919443779317, 0, 0 },
            new[] { 8000.0, -3000, 0, 309.833826757007, 1, 0, 0.5604347754988548 },
            new[] { 45.0, -20, 1, 0.34348002729780935, 0, 0, 0 },
            new[] { 300.0, 0, 8, 5.032587284035253, 0, 0, 0.9353333312119573 },
            new[] { -2000.0, -2500, 40, 51.277145589813315, 0.06334568142969192, 0, 0.6942430004304717 },
        };

        private static void Near(double expected, double actual, string what)
        {
            Assert.AreEqual(expected, actual, 1e-7 * Math.Max(1, Math.Abs(expected)), what);
        }

        [Test]
        public void MatchesTheWebVersion()
        {
            var m = new TerrainModel(7);
            foreach (var p in Reference)
            {
                string at = $"at ({p[0]}, {p[1]}) res {p[2]}";
                Near(p[3], m.Sample(p[0], p[1], p[2]), "height " + at);
                Near(p[4], m.Rock, "rock " + at);
                Near(p[5], m.Bright, "bright " + at);
                Near(p[6], m.Drift, "drift " + at);
            }
        }

        [Test]
        public void PlacesTheSameFeatures()
        {
            var m = new TerrainModel(7);
            Assert.AreEqual(13, m.Craters.Count);
            Assert.AreEqual(8, m.Outcrops.Count);
            Near(21.26950328967088, m.Craters[0].X, "crater 0 x");
            Near(19.054700491018593, m.Craters[0].R, "crater 0 r");
            Near(-13.854415862842911, m.Outcrops[1].X, "outcrop 1 x");
            Near(2.645821041194722, m.Outcrops[1].Height, "outcrop 1 height");
        }

        [Test]
        public void TheOutpostIsFlat()
        {
            var m = new TerrainModel(7);
            for (double a = 0; a < Math.PI * 2; a += 0.3)
                Assert.AreEqual(0.0, m.Sample(Math.Cos(a) * Layout.OutpostFlatRadius, Math.Sin(a) * Layout.OutpostFlatRadius));
        }
    }
}
