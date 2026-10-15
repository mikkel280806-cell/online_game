using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using HollowStar.Core;
using HollowStar.Core.Survival;
using HollowStar.Core.Terrain;
using NUnit.Framework;
using UnityEngine;

namespace HollowStar.Tests
{
    public class ResourceScatterTests
    {
        [Serializable] private class RawCollider { public bool circle; public float x, z, r, minX, maxX, minZ, maxZ; }
        [Serializable] private class RawLayout { public RawCollider[] colliders; }

        private static TerrainModel terrain;
        private static List<FlatCollider> buildings;
        private static List<NodePlacement> nodes;
        private static readonly ScatterSettings Settings = new ScatterSettings();

        [OneTimeSetUp]
        public void Setup()
        {
            terrain = new TerrainModel(7);
            // The real outpost footprints, exported from the web version.
            string path = Path.Combine(Application.dataPath, "_Project/Data/OutpostLayout.json");
            var raw = JsonUtility.FromJson<RawLayout>(File.ReadAllText(path));
            buildings = raw.colliders.Select(c => c.circle ? FlatCollider.Circle(c.x, c.z, c.r) : FlatCollider.Box(c.minX, c.maxX, c.minZ, c.maxZ)).ToList();
            nodes = ResourceScatter.Generate(terrain, buildings, Settings);
        }

        [Test]
        public void PlacesAboutSeventyNodes()
        {
            Assert.That(nodes.Count, Is.InRange(65, 80));
        }

        [Test]
        public void EveryKindAppearsAndMeetsItsTarget()
        {
            foreach (var def in NodeKinds.All)
            {
                int n = nodes.Count(p => p.Kind == def.Kind);
                Assert.GreaterOrEqual(n, Math.Max(1, def.Target - 1), $"{def.Name}: {n} of {def.Target}");
            }
        }

        [Test]
        public void IsDeterministicForASeedAndDiffersForAnother()
        {
            var again = ResourceScatter.Generate(new TerrainModel(7), buildings, Settings);
            Assert.AreEqual(nodes.Count, again.Count);
            for (int i = 0; i < nodes.Count; i++)
            {
                Assert.AreEqual(nodes[i].Kind, again[i].Kind);
                Assert.AreEqual(nodes[i].X, again[i].X);
                Assert.AreEqual(nodes[i].Z, again[i].Z);
                Assert.AreEqual(nodes[i].Yaw, again[i].Yaw);
            }
            var other = ResourceScatter.Generate(terrain, buildings, Settings, ResourceScatter.WorldSeed + 1u);
            Assert.IsFalse(other.Count == nodes.Count && other.Zip(nodes, (a, b) => a.X == b.X && a.Z == b.Z).All(same => same));
        }

        [Test]
        public void AllNodesLieWithinThePlayRadius()
        {
            foreach (var n in nodes)
                Assert.LessOrEqual(Settings.Origin.DistanceTo(n.X, n.Z), 150f, $"{n.Kind} at {n.X},{n.Z}");
        }

        [Test]
        public void NothingStandsOnTheBuildingsOrThePad()
        {
            foreach (var n in nodes)
            {
                Assert.IsFalse(FlatCollider.InsideAny(n.X, n.Z, buildings), $"{n.Kind} inside a building at {n.X},{n.Z}");
                Assert.GreaterOrEqual(Settings.Pad.DistanceTo(n.X, n.Z), Layout.LandingPadRadius + 1f, $"{n.Kind} on the pad");
            }
        }

        [Test]
        public void NodesDoNotOverlap()
        {
            for (int i = 0; i < nodes.Count; i++)
            for (int j = i + 1; j < nodes.Count; j++)
            {
                float need = NodeKinds.Get(nodes[i].Kind).Footprint + NodeKinds.Get(nodes[j].Kind).Footprint;
                float dx = nodes[i].X - nodes[j].X, dz = nodes[i].Z - nodes[j].Z;
                Assert.GreaterOrEqual(Mathf.Sqrt(dx * dx + dz * dz), need, $"nodes {i} and {j} overlap");
            }
        }

        [Test]
        public void IceSitsInHollowsOrShadow()
        {
            var ice = nodes.Where(n => n.Kind == NodeKind.IceChunk).ToList();
            Assert.GreaterOrEqual(ice.Count, 6);
            int good = 0;
            foreach (var n in ice)
            {
                double h = terrain.Sample(n.X, n.Z, 1.0);
                if (ResourceScatter.IsHollow(terrain, n.X, n.Z, h) || ResourceScatter.IsShadowed(terrain, n.X, n.Z, h)) good++;
            }
            // Patch members may step a few metres out of the shade; the great majority sit in it.
            Assert.GreaterOrEqual(good, ice.Count * 3 / 4, $"{good} of {ice.Count} ice nodes are low or shaded");
        }

        [Test]
        public void SalvageLiesNearTheWrenOrTheOutpost()
        {
            foreach (var n in nodes.Where(n => n.Kind == NodeKind.ScrapPile || n.Kind == NodeKind.WiringBundle))
            {
                float d = Mathf.Min(Settings.Wren.DistanceTo(n.X, n.Z), Settings.Outpost.DistanceTo(n.X, n.Z));
                Assert.LessOrEqual(d, 45f, $"{n.Kind} {d} m from the base");
            }
        }

        [Test]
        public void GroundIsNotACliff()
        {
            foreach (var n in nodes)
            {
                double h = terrain.Sample(n.X, n.Z, 1.0);
                Assert.LessOrEqual(ResourceScatter.Slope(terrain, n.X, n.Z, h), 0.8, $"{n.Kind} at {n.X},{n.Z} on a cliff");
            }
        }

        [Test]
        public void PlantsNeedTheCutterButPodsDoNot()
        {
            Assert.AreEqual(ItemIds.Cutter, NodeKinds.Get(NodeKind.FibreReeds).RequiredTool);
            Assert.AreEqual(ItemIds.Cutter, NodeKinds.Get(NodeKind.SporeberryBush).RequiredTool);
            Assert.AreEqual(ItemIds.Cutter, NodeKinds.Get(NodeKind.TuberMound).RequiredTool);
            // A cutter needs a battery, which needs lumen bulbs and resin: those must be hand-picked.
            Assert.IsNull(NodeKinds.Get(NodeKind.LumenBulbs).RequiredTool);
            Assert.IsNull(NodeKinds.Get(NodeKind.ResinPods).RequiredTool);
            Assert.IsNull(NodeKinds.Get(NodeKind.FerriteRock).RequiredTool);
            Assert.IsNull(NodeKinds.Get(NodeKind.ScrapPile).RequiredTool);
        }

        [Test]
        public void EveryKindYieldsAnItemThatExists()
        {
            foreach (var def in NodeKinds.All)
            {
                Assert.IsTrue(ItemCatalog.Exists(def.ItemId), def.Name);
                Assert.IsTrue(NodeKinds.TryGetByScanId(def.ScanId, out var back) && back == def, def.ScanId);
                Assert.That(def.MinYield, Is.InRange(1, 2));
                Assert.That(def.MaxYield, Is.InRange(def.MinYield, 2));
                Assert.That(def.MinRespawnSeconds, Is.GreaterThanOrEqualTo(300f));
                Assert.That(def.MaxRespawnSeconds, Is.LessThanOrEqualTo(600f));
            }
        }

        [Test]
        public void GatherRollsStayInRange()
        {
            var def = NodeKinds.Get(NodeKind.FerriteRock);
            Assert.AreEqual(1, GatherRules.RollYield(def, 0.0));
            Assert.AreEqual(2, GatherRules.RollYield(def, 0.99999));
            Assert.AreEqual(def.MinRespawnSeconds, GatherRules.RollRespawn(def, 0.0), 1e-4);
            Assert.AreEqual(def.MaxRespawnSeconds, GatherRules.RollRespawn(def, 1.0), 1e-4);
            Assert.IsTrue(GatherRules.InReach(3.0, 6.0));
            Assert.IsFalse(GatherRules.InReach(9.0, 6.0));
        }
    }
}
