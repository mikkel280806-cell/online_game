using System.Collections.Generic;
using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class CraftingTests
    {
        private static Inventory Pack(params (string id, int n)[] items)
        {
            var inv = new Inventory();
            foreach (var (id, n) in items) inv.Add(id, n);
            return inv;
        }

        [Test]
        public void CraftingConsumesTheInputsAndAddsTheOutput()
        {
            var inv = Pack((ItemIds.FerriteOre, 5));
            var recipe = Recipes.Get(ItemIds.MetalPlate);
            Assert.IsTrue(Crafting.CanCraft(recipe, inv));
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(recipe, inv));
            Assert.AreEqual(3, inv.Count(ItemIds.FerriteOre));
            Assert.AreEqual(1, inv.Count(ItemIds.MetalPlate));
        }

        [Test]
        public void MissingIngredientsChangeNothing()
        {
            var inv = Pack((ItemIds.FerriteOre, 1));
            int v = inv.Version;
            var recipe = Recipes.Get(ItemIds.MetalPlate);
            Assert.IsFalse(Crafting.CanCraft(recipe, inv));
            Assert.AreEqual(CraftResult.MissingIngredients, Crafting.Craft(recipe, inv));
            Assert.AreEqual(1, inv.Count(ItemIds.FerriteOre));
            Assert.AreEqual(0, inv.Count(ItemIds.MetalPlate));
            Assert.AreEqual(v, inv.Version);
        }

        [Test]
        public void EveryIngredientMustBeThere()
        {
            // A battery needs copper, a lumen bulb and resin.
            var inv = Pack((ItemIds.CopperOre, 1), (ItemIds.LumenBulb, 1));
            Assert.AreEqual(CraftResult.MissingIngredients, Crafting.Craft(Recipes.Get(ItemIds.Battery), inv));
            inv.Add(ItemIds.AmberResin, 1);
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(Recipes.Get(ItemIds.Battery), inv));
            Assert.AreEqual(1, inv.Count(ItemIds.Battery));
            Assert.AreEqual(0, inv.Count(ItemIds.CopperOre));
        }

        [Test]
        public void FailsCleanlyWhenThereIsNoSpaceForTheOutput()
        {
            // 22 cutters fill slots 2..23; the spare plate and battery keep slots 0 and 1 occupied after the craft.
            var inv = new Inventory();
            inv.Add(ItemIds.MetalPlate, 2);
            inv.Add(ItemIds.Battery, 2);
            inv.Add(ItemIds.Cutter, Inventory.SlotCount - 2);
            Assert.AreEqual(0, inv.FreeSpaceFor(ItemIds.Cutter));
            int v = inv.Version;
            Assert.IsFalse(Crafting.CanCraft(Recipes.Get(ItemIds.Cutter), inv));
            Assert.AreEqual(CraftResult.NoSpace, Crafting.Craft(Recipes.Get(ItemIds.Cutter), inv));
            Assert.AreEqual(2, inv.Count(ItemIds.MetalPlate));
            Assert.AreEqual(2, inv.Count(ItemIds.Battery));
            Assert.AreEqual(v, inv.Version);
        }

        [Test]
        public void UsingUpAWholeStackOfInputsFreesTheSlotForTheOutput()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.MetalPlate, 1);
            inv.Add(ItemIds.Battery, 1);
            inv.Add(ItemIds.Cutter, Inventory.SlotCount - 2);
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(Recipes.Get(ItemIds.Cutter), inv));
            Assert.AreEqual(1, inv.Count(ItemIds.Cutter) - (Inventory.SlotCount - 2));
            Assert.AreEqual(0, inv.Count(ItemIds.MetalPlate));
        }

        [Test]
        public void ANoSpaceCraftLeavesTheHotbarAlone()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Scanner, 1);
            inv.Add(ItemIds.MetalPlate, 2);
            inv.Add(ItemIds.Battery, 2);
            inv.Add(ItemIds.Cutter, Inventory.SlotCount - 3);
            inv.AssignHotbar(0, 0);
            Assert.AreEqual(CraftResult.NoSpace, Crafting.Craft(Recipes.Get(ItemIds.Cutter), inv));
            Assert.AreEqual(0, inv.HotbarSlot(0));
        }

        [Test]
        public void TheOutputTopsUpAnExistingStack()
        {
            var inv = Pack((ItemIds.MetalPlate, 3), (ItemIds.FerriteOre, 2));
            Crafting.Craft(Recipes.Get(ItemIds.MetalPlate), inv);
            Assert.AreEqual(4, inv.Count(ItemIds.MetalPlate));
            Assert.AreEqual(4, inv[0].Count);
        }

        [Test]
        public void OnlyFoodAndWaterCanBeMadeAtTheGalley()
        {
            var galley = new HashSet<string> { ItemIds.FilteredWater, ItemIds.BakedTuber, ItemIds.RationBar };
            foreach (var r in Recipes.All)
            {
                Assert.IsTrue(r.IsAvailableAt(CraftStations.Fabricator), r.Id);
                Assert.AreEqual(galley.Contains(r.Id), r.IsAvailableAt(CraftStations.Galley), r.Id);
            }
        }

        [Test]
        public void TheWrongStationOrNoStationFails()
        {
            var inv = Pack((ItemIds.FerriteOre, 2), (ItemIds.IceChunk, 1));
            Assert.AreEqual(CraftResult.WrongStation, Crafting.Craft(Recipes.Get(ItemIds.MetalPlate), inv, CraftStations.Galley));
            Assert.AreEqual(CraftResult.WrongStation, Crafting.Craft(Recipes.Get(ItemIds.MetalPlate), inv, CraftStations.None));
            Assert.AreEqual(CraftResult.WrongStation, Crafting.Craft(Recipes.Get(ItemIds.FilteredWater), inv, CraftStations.None));
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(Recipes.Get(ItemIds.FilteredWater), inv, CraftStations.Galley));
            Assert.AreEqual(1, inv.Count(ItemIds.FilteredWater));
        }

        [Test]
        public void FilteredWaterGivesWaterAndOxygenCanisterGivesOxygen()
        {
            Assert.AreEqual(30f, ItemCatalog.Get(ItemIds.FilteredWater).Water);
            Assert.AreEqual(50f, ItemCatalog.Get(ItemIds.O2Canister).Oxygen);
            Assert.AreEqual(50f, ItemCatalog.Get(ItemIds.Medkit).Health);
        }

        [Test]
        public void ACutterCanBeBuiltFromRawOres()
        {
            // The U3 goal chain: ore, plate, battery, cutter.
            var inv = Pack((ItemIds.FerriteOre, 2), (ItemIds.CopperOre, 1), (ItemIds.LumenBulb, 1), (ItemIds.AmberResin, 1));
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(Recipes.Get(ItemIds.MetalPlate), inv));
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(Recipes.Get(ItemIds.Battery), inv));
            Assert.AreEqual(CraftResult.Ok, Crafting.Craft(Recipes.Get(ItemIds.Cutter), inv));
            Assert.AreEqual(1, inv.Count(ItemIds.Cutter));
            Assert.AreEqual(0, inv.Count(ItemIds.MetalPlate));
            Assert.AreEqual(0, inv.Count(ItemIds.Battery));
        }
    }
}
