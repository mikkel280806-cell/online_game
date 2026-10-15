namespace HollowStar.Core.Survival
{
    // Item data shared by the inventory, crafting and the UI. Pure data: no behaviour beyond lookups.

    public enum ItemCategory
    {
        Raw = 0,
        Material = 1,
        Food = 2,
        Tool = 3,
        Equipment = 4,
        Consumable = 5,
    }

    /// <summary>Icon shapes (spec section 6). The Core only names them; the UI draws them with Painter2D.</summary>
    public enum GlyphId
    {
        Crystal = 0,
        Leaf = 1,
        Drop = 2,
        Flame = 3,
        Bolt = 4,
        Gear = 5,
        Tank = 6,
        Cross = 7,
        Wrench = 8,
        Chip = 9,
    }

    /// <summary>Stable string ids, so recipes, tests and Game code never repeat a literal.</summary>
    public static class ItemIds
    {
        // Raw.
        public const string FerriteOre = "ferrite_ore";
        public const string CopperOre = "copper_ore";
        public const string SilicaSand = "silica_sand";
        public const string Quartz = "quartz";
        public const string IceChunk = "ice_chunk";
        public const string FiberReed = "fiber_reed";
        public const string AmberResin = "amber_resin";
        public const string ScrapMetal = "scrap_metal";
        public const string SalvagedWiring = "salvaged_wiring";
        public const string LumenBulb = "lumen_bulb";
        public const string Sporeberry = "sporeberry";
        public const string GroundTuber = "ground_tuber";

        // Crafted materials, food and consumables.
        public const string MetalPlate = "metal_plate";
        public const string CopperWire = "copper_wire";
        public const string Glass = "glass";
        public const string FiberMesh = "fiber_mesh";
        public const string Battery = "battery";
        public const string FilteredWater = "filtered_water";
        public const string BakedTuber = "baked_tuber";
        public const string RationBar = "ration_bar";
        public const string O2Canister = "o2_canister";
        public const string Medkit = "medkit";

        // Tools and equipment.
        public const string Scanner = "scanner";
        public const string Cutter = "cutter";
        public const string Flashlight = "flashlight";
        public const string RepairTool = "repair_tool";
        public const string HcO2Tank = "hc_o2_tank";
        public const string ThermalLiner = "thermal_liner";
    }

    public sealed class ItemDef
    {
        public readonly string Id;
        public readonly string Name;
        public readonly string Description;
        public readonly ItemCategory Category;
        public readonly int MaxStack;
        public readonly GlyphId Glyph;

        // What using one does to the player's vitals. Zero means no effect.
        public readonly float Food;
        public readonly float Water;
        public readonly float Oxygen;
        public readonly float Health;

        /// <summary>Passive gear: multiplies the oxygen tank capacity while carried (1 = no change).</summary>
        public readonly float OxygenCapacityFactor;
        /// <summary>Passive gear: extra suit insulation while carried, 0..1.</summary>
        public readonly float Insulation;

        public ItemDef(
            string id, string name, string description, ItemCategory category, int maxStack, GlyphId glyph,
            float food = 0f, float water = 0f, float oxygen = 0f, float health = 0f,
            float oxygenCapacityFactor = 1f, float insulation = 0f)
        {
            Id = id;
            Name = name;
            Description = description;
            Category = category;
            MaxStack = maxStack;
            Glyph = glyph;
            Food = food;
            Water = water;
            Oxygen = oxygen;
            Health = health;
            OxygenCapacityFactor = oxygenCapacityFactor;
            Insulation = insulation;
        }

        /// <summary>True if using it (the R key) eats, drinks or restores something.</summary>
        public bool IsConsumable => Food > 0f || Water > 0f || Oxygen > 0f || Health > 0f;

        /// <summary>Tools are equipped from the hotbar and decide what F can gather.</summary>
        public bool IsTool => Category == ItemCategory.Tool;
    }

    /// <summary>An item id with a count: one inventory slot, or one recipe ingredient.</summary>
    public readonly struct ItemStack
    {
        public readonly string Id;
        public readonly int Count;

        public ItemStack(string id, int count)
        {
            Id = id;
            Count = count;
        }

        public bool IsEmpty => Id == null || Count <= 0;

        /// <summary>The definition, or null for an empty stack.</summary>
        public ItemDef Def => IsEmpty ? null : ItemCatalog.Get(Id);
    }
}
