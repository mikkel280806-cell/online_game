using System.Collections.Generic;
using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class ItemCatalogTests
    {
        private static readonly string[] SpecIds =
        {
            "ferrite_ore", "copper_ore", "silica_sand", "quartz", "ice_chunk", "fiber_reed", "amber_resin",
            "scrap_metal", "salvaged_wiring", "lumen_bulb", "sporeberry", "ground_tuber",
            "metal_plate", "copper_wire", "glass", "fiber_mesh", "battery", "filtered_water", "baked_tuber",
            "ration_bar", "o2_canister", "medkit",
            "scanner", "cutter", "flashlight", "repair_tool", "hc_o2_tank", "thermal_liner",
        };

        [Test]
        public void HasEveryItemFromTheSpec()
        {
            Assert.AreEqual(SpecIds.Length, ItemCatalog.All.Count);
            foreach (var id in SpecIds) Assert.IsTrue(ItemCatalog.Exists(id), id);
        }

        [Test]
        public void EveryItemIsComplete()
        {
            var seen = new HashSet<string>();
            foreach (var item in ItemCatalog.All)
            {
                Assert.IsTrue(seen.Add(item.Id), "duplicate " + item.Id);
                Assert.IsNotEmpty(item.Name, item.Id);
                Assert.IsNotEmpty(item.Description, item.Id);
                Assert.GreaterOrEqual(item.MaxStack, 1, item.Id);
                if (item.IsTool || item.Category == ItemCategory.Equipment) Assert.AreEqual(1, item.MaxStack, item.Id);
            }
        }

        [Test]
        public void ConsumableEffectsMatchTheSpec()
        {
            var berry = ItemCatalog.Get(ItemIds.Sporeberry);
            Assert.AreEqual(12f, berry.Food);
            Assert.AreEqual(4f, berry.Water);
            Assert.AreEqual(8f, ItemCatalog.Get(ItemIds.GroundTuber).Food);
            Assert.AreEqual(30f, ItemCatalog.Get(ItemIds.BakedTuber).Food);
            Assert.AreEqual(40f, ItemCatalog.Get(ItemIds.RationBar).Food);
            Assert.IsFalse(ItemCatalog.Get(ItemIds.FerriteOre).IsConsumable);
            Assert.IsFalse(ItemCatalog.Get(ItemIds.Cutter).IsConsumable);
        }

        [Test]
        public void UnknownIdsDoNotResolve()
        {
            Assert.IsFalse(ItemCatalog.Exists("nope"));
            Assert.IsFalse(ItemCatalog.Exists(null));
            Assert.IsFalse(ItemCatalog.TryGet(null, out _));
            Assert.Throws<System.ArgumentException>(() => ItemCatalog.Get("nope"));
        }

        [Test]
        public void EveryRecipeUsesRealItemsAndHasASaneCraftTime()
        {
            // Recipes for every crafted item, none for raw ones.
            Assert.AreEqual(16, Recipes.All.Count);
            foreach (var r in Recipes.All)
            {
                Assert.IsTrue(ItemCatalog.Exists(r.Id), r.Id);
                Assert.AreNotEqual(ItemCategory.Raw, r.Output.Category, r.Id);
                Assert.GreaterOrEqual(r.OutputCount, 1, r.Id);
                Assert.IsNotEmpty(r.Inputs, r.Id);
                foreach (var input in r.Inputs)
                {
                    Assert.IsTrue(ItemCatalog.Exists(input.Id), r.Id + " needs " + input.Id);
                    Assert.GreaterOrEqual(input.Count, 1, r.Id);
                }
                Assert.That(r.Seconds, Is.InRange(2f, 4f), r.Id);
            }
        }

        [Test]
        public void SpecRecipesAreExact()
        {
            AssertRecipe(ItemIds.MetalPlate, (ItemIds.FerriteOre, 2));
            AssertRecipe(ItemIds.CopperWire, (ItemIds.CopperOre, 1));
            AssertRecipe(ItemIds.Glass, (ItemIds.SilicaSand, 2));
            AssertRecipe(ItemIds.FiberMesh, (ItemIds.FiberReed, 2));
            AssertRecipe(ItemIds.Battery, (ItemIds.CopperOre, 1), (ItemIds.LumenBulb, 1), (ItemIds.AmberResin, 1));
            AssertRecipe(ItemIds.FilteredWater, (ItemIds.IceChunk, 1));
            AssertRecipe(ItemIds.BakedTuber, (ItemIds.GroundTuber, 2));
            AssertRecipe(ItemIds.RationBar, (ItemIds.GroundTuber, 1), (ItemIds.Sporeberry, 2));
            AssertRecipe(ItemIds.O2Canister, (ItemIds.MetalPlate, 1), (ItemIds.Glass, 1));
            AssertRecipe(ItemIds.Medkit, (ItemIds.FiberMesh, 2), (ItemIds.AmberResin, 1));
            AssertRecipe(ItemIds.Scanner, (ItemIds.Battery, 1), (ItemIds.CopperWire, 1), (ItemIds.Glass, 1));
            AssertRecipe(ItemIds.Cutter, (ItemIds.MetalPlate, 1), (ItemIds.Battery, 1));
            AssertRecipe(ItemIds.Flashlight, (ItemIds.Battery, 1), (ItemIds.Glass, 1));
            AssertRecipe(ItemIds.RepairTool, (ItemIds.MetalPlate, 1), (ItemIds.CopperWire, 1), (ItemIds.Battery, 1));
            AssertRecipe(ItemIds.HcO2Tank, (ItemIds.MetalPlate, 3), (ItemIds.Glass, 1), (ItemIds.SalvagedWiring, 1));
            AssertRecipe(ItemIds.ThermalLiner, (ItemIds.FiberMesh, 3), (ItemIds.AmberResin, 1));
        }

        private static void AssertRecipe(string output, params (string id, int n)[] inputs)
        {
            var r = Recipes.Get(output);
            Assert.AreEqual(inputs.Length, r.Inputs.Length, output);
            for (int i = 0; i < inputs.Length; i++)
            {
                Assert.AreEqual(inputs[i].id, r.Inputs[i].Id, output);
                Assert.AreEqual(inputs[i].n, r.Inputs[i].Count, output);
            }
        }

        [Test]
        public void TankAndLinerChangeTheSuit()
        {
            var inv = new Inventory();
            Assert.AreEqual(Vitals.BaseOxygenCapacity, SuitGear.OxygenCapacity(inv));
            Assert.AreEqual(SuitGear.BaseInsulation, SuitGear.Insulation(inv), 1e-6f);
            inv.Add(ItemIds.HcO2Tank, 1);
            inv.Add(ItemIds.ThermalLiner, 1);
            Assert.AreEqual(2f * Vitals.BaseOxygenCapacity, SuitGear.OxygenCapacity(inv), 1e-4f);
            Assert.Greater(SuitGear.Insulation(inv), SuitGear.BaseInsulation);
            Assert.LessOrEqual(SuitGear.Insulation(inv), SuitGear.MaxInsulation);
        }
    }
}
