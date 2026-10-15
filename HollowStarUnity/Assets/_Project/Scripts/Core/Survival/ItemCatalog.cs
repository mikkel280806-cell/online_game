using System;
using System.Collections.Generic;

namespace HollowStar.Core.Survival
{
    /// <summary>Every item in the game (spec section 2). Static data, identical on both players' machines.</summary>
    public static class ItemCatalog
    {
        // Stack sizes: bulk ore stacks high, food and consumables lower, tools never stack.
        private const int BulkStack = 50;
        private const int FoodStack = 20;
        private const int CellStack = 20;
        private const int PreparedStack = 10;
        private const int ConsumableStack = 5;
        private const int GearStack = 1;

        // Gear numbers live with the item they belong to.
        private const float HcTankCapacityFactor = 2f;
        private const float ThermalLinerInsulation = 0.25f;

        private static readonly ItemDef[] items =
        {
            // Raw: gathered from nodes. The two edibles are eaten as they come, but are bland.
            new ItemDef(ItemIds.FerriteOre, "Ferrite Ore", "Dense, faintly magnetic ore. Pressed into structural plate.", ItemCategory.Raw, BulkStack, GlyphId.Crystal),
            new ItemDef(ItemIds.CopperOre, "Copper Ore", "Green-streaked rock. Draws out into wire.", ItemCategory.Raw, BulkStack, GlyphId.Crystal),
            new ItemDef(ItemIds.SilicaSand, "Silica Sand", "Fine pale grains. Fuses into glass.", ItemCategory.Raw, BulkStack, GlyphId.Crystal),
            new ItemDef(ItemIds.Quartz, "Quartz", "Clear crystal clusters that hum when touched.", ItemCategory.Raw, BulkStack, GlyphId.Crystal),
            new ItemDef(ItemIds.IceChunk, "Ice Chunk", "Frozen water from the crater shadows. Filter it before drinking.", ItemCategory.Raw, BulkStack, GlyphId.Drop),
            new ItemDef(ItemIds.FiberReed, "Fibre Reed", "Tough stalks from the lowlands. Woven into mesh.", ItemCategory.Raw, BulkStack, GlyphId.Leaf),
            new ItemDef(ItemIds.AmberResin, "Amber Resin", "Sticky resin from pods. Binds and seals.", ItemCategory.Raw, BulkStack, GlyphId.Leaf),
            new ItemDef(ItemIds.ScrapMetal, "Scrap Metal", "Bent hull plating from the wreck.", ItemCategory.Raw, BulkStack, GlyphId.Gear),
            new ItemDef(ItemIds.SalvagedWiring, "Salvaged Wiring", "Tangled cable still carrying a charge.", ItemCategory.Raw, BulkStack, GlyphId.Chip),
            new ItemDef(ItemIds.LumenBulb, "Lumen Bulb", "A glowing pod. Holds light long after it is picked.", ItemCategory.Raw, BulkStack, GlyphId.Bolt),
            new ItemDef(ItemIds.Sporeberry, "Sporeberry", "Tart, juicy berries. Safe to eat raw.", ItemCategory.Raw, FoodStack, GlyphId.Leaf, food: 12f, water: 4f),
            new ItemDef(ItemIds.GroundTuber, "Ground Tuber", "A starchy root. Raw, it is bland but filling.", ItemCategory.Raw, FoodStack, GlyphId.Leaf, food: 8f),

            // Crafted materials.
            new ItemDef(ItemIds.MetalPlate, "Metal Plate", "Pressed ferrite plate. The frame of most things.", ItemCategory.Material, BulkStack, GlyphId.Gear),
            new ItemDef(ItemIds.CopperWire, "Copper Wire", "Drawn copper for circuits.", ItemCategory.Material, BulkStack, GlyphId.Bolt),
            new ItemDef(ItemIds.Glass, "Glass", "Clear and tough. Lenses and seals.", ItemCategory.Material, BulkStack, GlyphId.Crystal),
            new ItemDef(ItemIds.FiberMesh, "Fibre Mesh", "Woven reed. Insulates and binds wounds.", ItemCategory.Material, BulkStack, GlyphId.Leaf),
            new ItemDef(ItemIds.Battery, "Battery", "A sealed cell. Powers every tool you carry.", ItemCategory.Material, CellStack, GlyphId.Bolt),

            // Food and consumables.
            new ItemDef(ItemIds.FilteredWater, "Filtered Water", "Clean and cold. Restores water.", ItemCategory.Consumable, PreparedStack, GlyphId.Drop, water: 30f),
            new ItemDef(ItemIds.BakedTuber, "Baked Tuber", "Hot, soft and sweet. Restores food.", ItemCategory.Food, PreparedStack, GlyphId.Flame, food: 30f),
            new ItemDef(ItemIds.RationBar, "Ration Bar", "Dense, filling and lasts forever. Restores food.", ItemCategory.Food, PreparedStack, GlyphId.Flame, food: 40f),
            new ItemDef(ItemIds.O2Canister, "O2 Canister", "A spare breath. Tops up your suit tank.", ItemCategory.Consumable, ConsumableStack, GlyphId.Tank, oxygen: 50f),
            new ItemDef(ItemIds.Medkit, "Medkit", "Sealant, gauze and a stim. Restores health.", ItemCategory.Consumable, ConsumableStack, GlyphId.Cross, health: 50f),

            // Tools and equipment. Never stack.
            new ItemDef(ItemIds.Scanner, "Scanner", "Hold V on a plant, rock or creature to log it in the databank.", ItemCategory.Tool, GearStack, GlyphId.Chip),
            new ItemDef(ItemIds.Cutter, "Cutter", "A thermal blade. Needed to harvest plants.", ItemCategory.Tool, GearStack, GlyphId.Wrench),
            new ItemDef(ItemIds.Flashlight, "Flashlight", "A bright beam for the long nights.", ItemCategory.Tool, GearStack, GlyphId.Bolt),
            new ItemDef(ItemIds.RepairTool, "Repair Tool", "Welds and patches broken machinery.", ItemCategory.Tool, GearStack, GlyphId.Wrench),
            new ItemDef(ItemIds.HcO2Tank, "High-Capacity O2 Tank", "Doubles your oxygen capacity while carried.", ItemCategory.Equipment, GearStack, GlyphId.Tank, oxygenCapacityFactor: HcTankCapacityFactor),
            new ItemDef(ItemIds.ThermalLiner, "Thermal Liner", "A quilted suit lining. Slows the cold while carried.", ItemCategory.Equipment, GearStack, GlyphId.Gear, insulation: ThermalLinerInsulation),
        };

        private static readonly Dictionary<string, ItemDef> byId = Index();

        /// <summary>What each player starts with: scanner, 2 ration bars, 2 filtered water, 1 O2 canister.</summary>
        public static readonly ItemStack[] StartingKit =
        {
            new ItemStack(ItemIds.Scanner, 1),
            new ItemStack(ItemIds.RationBar, 2),
            new ItemStack(ItemIds.FilteredWater, 2),
            new ItemStack(ItemIds.O2Canister, 1),
        };

        public static IReadOnlyList<ItemDef> All => items;

        public static bool Exists(string id) => id != null && byId.ContainsKey(id);

        public static bool TryGet(string id, out ItemDef def)
        {
            if (id == null)
            {
                def = null;
                return false;
            }
            return byId.TryGetValue(id, out def);
        }

        /// <summary>The definition for <paramref name="id"/>; throws on an unknown id, which is always a bug.</summary>
        public static ItemDef Get(string id)
        {
            if (!TryGet(id, out var def)) throw new ArgumentException($"Unknown item id '{id}'", nameof(id));
            return def;
        }

        private static Dictionary<string, ItemDef> Index()
        {
            var map = new Dictionary<string, ItemDef>(items.Length);
            foreach (var item in items) map.Add(item.Id, item);
            return map;
        }
    }
}
