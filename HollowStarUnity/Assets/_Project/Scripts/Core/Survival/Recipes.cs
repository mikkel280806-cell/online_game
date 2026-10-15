using System;
using System.Collections.Generic;

namespace HollowStar.Core.Survival
{
    /// <summary>Crafting stations in the Wren bay. The fabricator can make anything; the galley only food and water.</summary>
    [Flags]
    public enum CraftStations
    {
        None = 0,
        Fabricator = 1,
        Galley = 2,
        /// <summary>For U3 the two sit side by side in the bay, so the Game treats them as one place.</summary>
        All = Fabricator | Galley,
    }

    public sealed class Recipe
    {
        /// <summary>The output item's id doubles as the recipe id: one recipe per item.</summary>
        public readonly string Id;
        public readonly int OutputCount;
        public readonly ItemStack[] Inputs;
        /// <summary>Which stations can make it (the fabricator is always one of them).</summary>
        public readonly CraftStations Stations;
        /// <summary>How long the craft bar runs; walking away cancels it before anything is consumed.</summary>
        public readonly float Seconds;

        public Recipe(string output, int outputCount, ItemStack[] inputs, float seconds, CraftStations stations = CraftStations.Fabricator)
        {
            Id = output;
            OutputCount = outputCount;
            Inputs = inputs;
            Seconds = seconds;
            Stations = stations | CraftStations.Fabricator;
        }

        public ItemDef Output => ItemCatalog.Get(Id);

        public ItemStack OutputStack => new ItemStack(Id, OutputCount);

        /// <summary>True if any of <paramref name="at"/> can make this.</summary>
        public bool IsAvailableAt(CraftStations at) => (Stations & at) != CraftStations.None;
    }

    /// <summary>Every recipe (spec section 2). Static data.</summary>
    public static class Recipes
    {
        // Craft times (spec: 2 to 4 s): raw processing is quick, tools are slow.
        private const float Quick = 2f;
        private const float Medium = 3f;
        private const float Slow = 4f;

        private static readonly Recipe[] recipes =
        {
            // Processed materials.
            Make(ItemIds.MetalPlate, Quick, In(ItemIds.FerriteOre, 2)),
            Make(ItemIds.CopperWire, Quick, In(ItemIds.CopperOre, 1)),
            Make(ItemIds.Glass, Quick, In(ItemIds.SilicaSand, 2)),
            Make(ItemIds.FiberMesh, Quick, In(ItemIds.FiberReed, 2)),
            Make(ItemIds.Battery, Medium, In(ItemIds.CopperOre, 1), In(ItemIds.LumenBulb, 1), In(ItemIds.AmberResin, 1)),

            // Food and water: also made at the galley.
            Make(ItemIds.FilteredWater, Quick, CraftStations.All, In(ItemIds.IceChunk, 1)),
            Make(ItemIds.BakedTuber, Quick, CraftStations.All, In(ItemIds.GroundTuber, 2)),
            Make(ItemIds.RationBar, Quick, CraftStations.All, In(ItemIds.GroundTuber, 1), In(ItemIds.Sporeberry, 2)),

            // Survival consumables.
            Make(ItemIds.O2Canister, Medium, In(ItemIds.MetalPlate, 1), In(ItemIds.Glass, 1)),
            Make(ItemIds.Medkit, Medium, In(ItemIds.FiberMesh, 2), In(ItemIds.AmberResin, 1)),

            // Tools and equipment.
            Make(ItemIds.Scanner, Slow, In(ItemIds.Battery, 1), In(ItemIds.CopperWire, 1), In(ItemIds.Glass, 1)),
            Make(ItemIds.Cutter, Medium, In(ItemIds.MetalPlate, 1), In(ItemIds.Battery, 1)),
            Make(ItemIds.Flashlight, Medium, In(ItemIds.Battery, 1), In(ItemIds.Glass, 1)),
            Make(ItemIds.RepairTool, Medium, In(ItemIds.MetalPlate, 1), In(ItemIds.CopperWire, 1), In(ItemIds.Battery, 1)),
            Make(ItemIds.HcO2Tank, Slow, In(ItemIds.MetalPlate, 3), In(ItemIds.Glass, 1), In(ItemIds.SalvagedWiring, 1)),
            Make(ItemIds.ThermalLiner, Slow, In(ItemIds.FiberMesh, 3), In(ItemIds.AmberResin, 1)),
        };

        private static readonly Dictionary<string, Recipe> byId = Index();

        public static IReadOnlyList<Recipe> All => recipes;

        public static bool TryGet(string id, out Recipe recipe)
        {
            if (id == null)
            {
                recipe = null;
                return false;
            }
            return byId.TryGetValue(id, out recipe);
        }

        /// <summary>The recipe for <paramref name="id"/>; throws if that item has none.</summary>
        public static Recipe Get(string id)
        {
            if (!TryGet(id, out var recipe)) throw new ArgumentException($"No recipe for '{id}'", nameof(id));
            return recipe;
        }

        private static ItemStack In(string id, int count) => new ItemStack(id, count);

        private static Recipe Make(string output, float seconds, params ItemStack[] inputs) =>
            new Recipe(output, 1, inputs, seconds);

        private static Recipe Make(string output, float seconds, CraftStations stations, params ItemStack[] inputs) =>
            new Recipe(output, 1, inputs, seconds, stations);

        private static Dictionary<string, Recipe> Index()
        {
            var map = new Dictionary<string, Recipe>(recipes.Length);
            foreach (var r in recipes) map.Add(r.Id, r);
            return map;
        }
    }
}
