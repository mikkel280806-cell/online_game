using System.Collections.Generic;
using HollowStar.Core.Survival;

namespace HollowStar.Game.Survival
{
    /// <summary>The text on every databank card: one per node kind, plus the Wren, the fabricator and the outpost.</summary>
    public static class DatabankContent
    {
        public const string WrenId = "wren";
        public const string FabricatorId = "fabricator";
        public const string OutpostId = "outpost";

        private static DatabankEntry E(string id, string title, string category, string description, GlyphId glyph, params string[] yields) =>
            new DatabankEntry { Id = id, Title = title, Category = category, Description = description, Glyph = glyph, Yields = yields };

        private static readonly DatabankEntry[] entries =
        {
            E("ferrite_rock", "Ferrite Rock", "MINERAL",
                "Dense, faintly magnetic outcrops dusted with rust-red regolith. The iron-rich seams glint in the Hollow's low light. Presses into structural plate.",
                GlyphId.Crystal, ItemIds.FerriteOre),
            E("copper_vein", "Copper Vein", "MINERAL",
                "Green-streaked seams where old impacts split the basalt. Soft enough to draw into wire, rare enough to ration.",
                GlyphId.Crystal, ItemIds.CopperOre),
            E("silica_patch", "Silica Patch", "MINERAL",
                "Pale glassy grains drifted against the lee of low ridges. Fused hot and clear, they become windows, lenses and sensor glass.",
                GlyphId.Crystal, ItemIds.SilicaSand),
            E("quartz_cluster", "Quartz Cluster", "MINERAL",
                "Clear crystal spires thrown up around fresh craters. They hum faintly when touched, as if the moon were still listening.",
                GlyphId.Crystal, ItemIds.Quartz),
            E("ice_chunk", "Ice Chunk", "MINERAL",
                "Water ice that has never seen the Hollow, kept in crater shade. Filter it at the fabricator before drinking; the minerals will not agree with you.",
                GlyphId.Drop, ItemIds.IceChunk),
            E("scrap_pile", "Scrap Pile", "SALVAGE",
                "Hull plating torn from the Meridian as she came down, scattered across the plain. Bent and scorched, and still better steel than anything out here.",
                GlyphId.Gear, ItemIds.ScrapMetal),
            E("wiring_bundle", "Wiring Bundle", "SALVAGE",
                "Cable looms ripped out of the wreck, some still carrying a stray charge. Salvage them gently; the insulation is the part you cannot replace.",
                GlyphId.Chip, ItemIds.SalvagedWiring),
            E("fiber_reed", "Fibre Reeds", "FLORA",
                "Pale hollow stalks that lean with the thin wind. Too tough to snap by hand, so bring a cutter. Woven into mesh they insulate and bind wounds.",
                GlyphId.Leaf, ItemIds.FiberReed),
            E("resin_pods", "Resin Pods", "FLORA",
                "Swollen pods that weep a sticky amber. Soft enough to pick by hand. Binds, seals, and goes into every battery cell.",
                GlyphId.Leaf, ItemIds.AmberResin),
            E("lumen_bulb", "Lumen Bulb", "FLORA",
                "A bioluminescent pod that holds its glow long after it is picked. Soft enough to pluck by hand. Cells love it.",
                GlyphId.Bolt, ItemIds.LumenBulb),
            E("sporeberry_bush", "Sporeberry Bush", "FLORA",
                "Dark, bristling shrubs hung with tart red berries. Safe to eat raw, and one of the few things here that tastes of anything. Cut them clean.",
                GlyphId.Leaf, ItemIds.Sporeberry),
            E("tuber_mound", "Tuber Mound", "FLORA",
                "A low mound of loose earth hides a starchy root. Raw it is bland but filling; baked, it is nearly good. A cutter digs it out cleanly.",
                GlyphId.Leaf, ItemIds.GroundTuber),
            E(WrenId, "Dropship Wren", "VESSEL",
                "Short-range lander from the Meridian, parked on the outpost pad. Her bay still holds air, a fabricator and the only bunks for four hundred kilometres. Her flight systems are another matter.",
                GlyphId.Gear),
            E(FabricatorId, "Fabricator", "TECH",
                "The Wren's onboard workshop. Feed it ore, fibre and salvage and it prints plate, cells, tools and rations. Slow, but the only one on Vigil.",
                GlyphId.Wrench),
            E(OutpostId, "Survey Outpost Kestrel-7", "STRUCTURE",
                "Three habs, a comms mast and a solar field, running on backup power since the Meridian went down. Someone needs to turn the lights back on.",
                GlyphId.Bolt),
        };

        public static IReadOnlyList<DatabankEntry> All => entries;

        /// <summary>Puts every card into the hub's dictionary (by id).</summary>
        public static void Fill(Dictionary<string, DatabankEntry> target)
        {
            foreach (var e in entries) target[e.Id] = e;
        }
    }
}
