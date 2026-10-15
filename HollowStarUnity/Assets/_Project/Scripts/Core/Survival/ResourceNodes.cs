using System;
using System.Collections.Generic;

namespace HollowStar.Core.Survival
{
    /// <summary>The kinds of gatherable thing scattered over Vigil (spec section 4).</summary>
    public enum NodeKind
    {
        FerriteRock = 0,
        CopperVein = 1,
        SilicaPatch = 2,
        QuartzCluster = 3,
        IceChunk = 4,
        ScrapPile = 5,
        WiringBundle = 6,
        FibreReeds = 7,
        ResinPods = 8,
        LumenBulbs = 9,
        SporeberryBush = 10,
        TuberMound = 11,
    }

    /// <summary>Where the scatter tries to put a kind.</summary>
    public enum NodeRule
    {
        /// <summary>Anywhere in the ring around the outpost.</summary>
        Ring = 0,
        /// <summary>In a depression or in shadow (ice survives where the Hollow's light does not reach).</summary>
        ShadowedOrLow = 1,
        /// <summary>Close to the Wren or the outpost (salvage).</summary>
        NearBase = 2,
        /// <summary>Prefers low ground (lowland plants).</summary>
        Lowland = 3,
        /// <summary>Prefers exposed rock such as crater rims.</summary>
        RockyGround = 4,
    }

    /// <summary>Static data for one kind of node. The Game gives each kind a stand-in model, a prompt and a databank card.</summary>
    public sealed class NodeKindDef
    {
        public readonly NodeKind Kind;
        /// <summary>Id of its databank entry (scanning any node of this kind unlocks it).</summary>
        public readonly string ScanId;
        public readonly string Name;
        /// <summary>The prompt verb: "Gather", "Harvest", "Pick".</summary>
        public readonly string Verb;
        public readonly string ItemId;
        public readonly int MinYield;
        public readonly int MaxYield;
        public readonly float MinRespawnSeconds;
        public readonly float MaxRespawnSeconds;
        /// <summary>Item id of the tool that must be equipped to gather it, or null.</summary>
        public readonly string RequiredTool;
        /// <summary>How many the scatter places.</summary>
        public readonly int Target;
        public readonly NodeRule Rule;
        /// <summary>Distance range from the outpost (ring rules) or from the Wren / outpost (<see cref="NodeRule.NearBase"/>).</summary>
        public readonly float MinRadius;
        public readonly float MaxRadius;
        /// <summary>Rough footprint radius in metres, for spacing and for keeping off buildings.</summary>
        public readonly float Footprint;
        /// <summary>Nodes come in small patches of PatchMin..PatchMax around a centre.</summary>
        public readonly int PatchMin;
        public readonly int PatchMax;

        public NodeKindDef(NodeKind kind, string scanId, string name, string verb, string itemId, int target, NodeRule rule,
            float minRadius, float maxRadius, float footprint, int patchMin, int patchMax, string requiredTool = null,
            int minYield = 1, int maxYield = 2, float minRespawn = 300f, float maxRespawn = 600f)
        {
            Kind = kind;
            ScanId = scanId;
            Name = name;
            Verb = verb;
            ItemId = itemId;
            Target = target;
            Rule = rule;
            MinRadius = minRadius;
            MaxRadius = maxRadius;
            Footprint = footprint;
            PatchMin = patchMin;
            PatchMax = patchMax;
            RequiredTool = requiredTool;
            MinYield = minYield;
            MaxYield = maxYield;
            MinRespawnSeconds = minRespawn;
            MaxRespawnSeconds = maxRespawn;
        }

        public bool NeedsTool => RequiredTool != null;
    }

    /// <summary>Every node kind. Plants that are tough (reeds, bushes, tubers) need the cutter; soft pods (resin, lumen) can be picked by hand, otherwise a battery, which needs both, could never be made.</summary>
    public static class NodeKinds
    {
        public const float HoldSeconds = 1.2f;

        private static readonly NodeKindDef[] defs =
        {
            new NodeKindDef(NodeKind.FerriteRock, "ferrite_rock", "Ferrite Rock", "Gather", ItemIds.FerriteOre, 9, NodeRule.Ring, 30f, 125f, 1.3f, 2, 4),
            new NodeKindDef(NodeKind.CopperVein, "copper_vein", "Copper Vein", "Gather", ItemIds.CopperOre, 7, NodeRule.Ring, 45f, 140f, 1.3f, 2, 3),
            new NodeKindDef(NodeKind.SilicaPatch, "silica_patch", "Silica Patch", "Gather", ItemIds.SilicaSand, 7, NodeRule.Ring, 28f, 120f, 1.5f, 2, 3),
            new NodeKindDef(NodeKind.QuartzCluster, "quartz_cluster", "Quartz Cluster", "Gather", ItemIds.Quartz, 5, NodeRule.RockyGround, 60f, 145f, 1.1f, 1, 3),
            new NodeKindDef(NodeKind.IceChunk, "ice_chunk", "Ice Chunk", "Gather", ItemIds.IceChunk, 8, NodeRule.ShadowedOrLow, 35f, 145f, 1.2f, 1, 3),
            new NodeKindDef(NodeKind.ScrapPile, "scrap_pile", "Scrap Pile", "Salvage", ItemIds.ScrapMetal, 7, NodeRule.NearBase, 16f, 38f, 1.3f, 1, 2),
            new NodeKindDef(NodeKind.WiringBundle, "wiring_bundle", "Wiring Bundle", "Salvage", ItemIds.SalvagedWiring, 4, NodeRule.NearBase, 16f, 38f, 0.9f, 1, 2),
            new NodeKindDef(NodeKind.FibreReeds, "fiber_reed", "Fibre Reeds", "Harvest", ItemIds.FiberReed, 6, NodeRule.Lowland, 35f, 135f, 1.0f, 2, 3, ItemIds.Cutter),
            new NodeKindDef(NodeKind.ResinPods, "resin_pods", "Resin Pods", "Pick", ItemIds.AmberResin, 5, NodeRule.Ring, 35f, 135f, 0.9f, 1, 3),
            new NodeKindDef(NodeKind.LumenBulbs, "lumen_bulb", "Lumen Bulb", "Pick", ItemIds.LumenBulb, 5, NodeRule.Ring, 35f, 135f, 0.8f, 1, 3),
            new NodeKindDef(NodeKind.SporeberryBush, "sporeberry_bush", "Sporeberry Bush", "Harvest", ItemIds.Sporeberry, 4, NodeRule.Lowland, 35f, 130f, 1.1f, 1, 2, ItemIds.Cutter),
            new NodeKindDef(NodeKind.TuberMound, "tuber_mound", "Tuber Mound", "Dig", ItemIds.GroundTuber, 5, NodeRule.Lowland, 35f, 130f, 0.9f, 1, 3, ItemIds.Cutter),
        };

        private static readonly Dictionary<string, NodeKindDef> byScanId = Index();

        public static IReadOnlyList<NodeKindDef> All => defs;

        public static NodeKindDef Get(NodeKind kind) => defs[(int)kind];

        public static bool TryGetByScanId(string scanId, out NodeKindDef def)
        {
            if (scanId == null)
            {
                def = null;
                return false;
            }
            return byScanId.TryGetValue(scanId, out def);
        }

        /// <summary>How many nodes the scatter aims for in total.</summary>
        public static int TotalTarget
        {
            get
            {
                int n = 0;
                foreach (var d in defs) n += d.Target;
                return n;
            }
        }

        private static Dictionary<string, NodeKindDef> Index()
        {
            var map = new Dictionary<string, NodeKindDef>(defs.Length);
            foreach (var d in defs) map.Add(d.ScanId, d);
            return map;
        }
    }

    /// <summary>
    /// The server's say on a gather: how many to hand over and when the node comes back. Pure so it is tested;
    /// the Game feeds it the clock and a random value.
    /// </summary>
    public static class GatherRules
    {
        /// <summary>Items yielded for a roll in [0,1).</summary>
        public static int RollYield(NodeKindDef def, double roll)
        {
            int span = def.MaxYield - def.MinYield + 1;
            int n = def.MinYield + (int)Math.Floor(Math.Clamp(roll, 0.0, 0.999999) * span);
            return Math.Clamp(n, def.MinYield, def.MaxYield);
        }

        /// <summary>Seconds until the node is back, for a roll in [0,1).</summary>
        public static float RollRespawn(NodeKindDef def, double roll) =>
            def.MinRespawnSeconds + (def.MaxRespawnSeconds - def.MinRespawnSeconds) * (float)Math.Clamp(roll, 0.0, 1.0);

        /// <summary>The gather is allowed: the node is standing and the gatherer is close enough (metres, flat distance).</summary>
        public static bool InReach(double distance, double maxReach) => distance <= maxReach;
    }
}
