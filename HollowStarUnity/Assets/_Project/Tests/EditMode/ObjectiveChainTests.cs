using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class ObjectiveChainTests
    {
        [Test]
        public void StartsWithFindWaterAndTheStartingKitDoesNotFinishIt()
        {
            var inv = new Inventory();
            inv.AddStartingKit();
            var chain = new ObjectiveChain();
            Assert.AreEqual(ObjectiveChain.FindWater, chain.Current);
            Assert.AreEqual(0, chain.Update(inv, false));
            Assert.AreEqual(ObjectiveChain.FindWater, chain.Current);
        }

        [Test]
        public void AnIceChunkFinishesWaterAndACutterFinishesTheNextStep()
        {
            var inv = new Inventory();
            var chain = new ObjectiveChain();
            inv.Add(ItemIds.IceChunk, 1);
            Assert.AreEqual(1, chain.Update(inv, false));
            Assert.AreEqual(ObjectiveChain.CraftCutter, chain.Current);
            // Using the ice up does not undo the step.
            inv.Remove(ItemIds.IceChunk, 1);
            Assert.AreEqual(0, chain.Update(inv, false));
            inv.Add(ItemIds.Cutter, 1);
            Assert.AreEqual(1, chain.Update(inv, false));
            Assert.AreEqual(ObjectiveChain.RestorePower, chain.Current);
            Assert.IsTrue(chain.IsFinalStep);
        }

        [Test]
        public void CraftingFilteredWaterCountsAndStepsChainInOneUpdate()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Cutter, 1);
            var chain = new ObjectiveChain();
            Assert.AreEqual(2, chain.Update(inv, true));
            Assert.AreEqual(ObjectiveChain.RestorePower, chain.Current);
        }

        [Test]
        public void ThePlaceholderNeverCompletes()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.IceChunk, 1);
            inv.Add(ItemIds.Cutter, 1);
            var chain = new ObjectiveChain();
            chain.Update(inv, true);
            Assert.AreEqual(0, chain.Update(inv, true));
            Assert.AreEqual(ObjectiveChain.RestorePower, chain.Current);
        }
    }
}
