using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class InventoryTests
    {
        private static int MaxStack(string id) => ItemCatalog.Get(id).MaxStack;

        [Test]
        public void StacksSameItemsUpToTheMaxThenOpensANewSlot()
        {
            var inv = new Inventory();
            int max = MaxStack(ItemIds.FerriteOre);
            Assert.AreEqual(0, inv.Add(ItemIds.FerriteOre, max - 5));
            Assert.AreEqual(0, inv.Add(ItemIds.FerriteOre, 10));
            Assert.AreEqual(max, inv[0].Count);
            Assert.AreEqual(5, inv[1].Count);
            Assert.AreEqual(max + 5, inv.Count(ItemIds.FerriteOre));
        }

        [Test]
        public void ToolsDoNotStack()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Cutter, 2);
            Assert.AreEqual(1, inv[0].Count);
            Assert.AreEqual(1, inv[1].Count);
        }

        [Test]
        public void AddReturnsWhatDidNotFit()
        {
            var inv = new Inventory();
            int capacity = Inventory.SlotCount * MaxStack(ItemIds.ScrapMetal);
            Assert.AreEqual(0, inv.Add(ItemIds.ScrapMetal, capacity - 3));
            Assert.AreEqual(7, inv.Add(ItemIds.ScrapMetal, 10));
            Assert.AreEqual(capacity, inv.Count(ItemIds.ScrapMetal));
            Assert.AreEqual(0, inv.FreeSpaceFor(ItemIds.ScrapMetal));
            Assert.AreEqual(0, inv.FreeSpaceFor(ItemIds.Quartz));
        }

        [Test]
        public void ARejectedAddDoesNotBumpTheVersion()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Cutter, Inventory.SlotCount);
            int v = inv.Version;
            Assert.AreEqual(1, inv.Add(ItemIds.Cutter, 1));
            Assert.AreEqual(v, inv.Version);
        }

        [Test]
        public void UnknownItemsAndNegativeCountsAreBugs()
        {
            var inv = new Inventory();
            Assert.Throws<System.ArgumentException>(() => inv.Add("nope", 1));
            Assert.Throws<System.ArgumentOutOfRangeException>(() => inv.Add(ItemIds.Glass, -1));
        }

        [Test]
        public void RemoveTakesExactlyTheAmountOrNothing()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Glass, 60);
            Assert.IsFalse(inv.Remove(ItemIds.Glass, 61));
            Assert.AreEqual(60, inv.Count(ItemIds.Glass));
            Assert.IsTrue(inv.Remove(ItemIds.Glass, 55));
            Assert.AreEqual(5, inv.Count(ItemIds.Glass));
            Assert.IsTrue(inv.Remove(ItemIds.Glass, 0));
        }

        [Test]
        public void RemoveDrainsFromTheBackSoFrontStacksStayFull()
        {
            var inv = new Inventory();
            int max = MaxStack(ItemIds.Glass);
            inv.Add(ItemIds.Glass, max + 10);
            Assert.IsTrue(inv.Remove(ItemIds.Glass, 10));
            Assert.AreEqual(max, inv[0].Count);
            Assert.IsTrue(inv[1].IsEmpty);
        }

        [Test]
        public void RemoveAtTakesFromOneSlot()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.RationBar, 3);
            Assert.AreEqual(2, inv.RemoveAt(0, 2));
            Assert.AreEqual(1, inv[0].Count);
            Assert.AreEqual(1, inv.RemoveAt(0, 5));
            Assert.IsTrue(inv[0].IsEmpty);
            Assert.AreEqual(0, inv.RemoveAt(0, 1));
        }

        [Test]
        public void MoveGoesIntoAnEmptySlotAndSwapsDifferentItems()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Quartz, 4);
            inv.Add(ItemIds.Cutter, 1);
            Assert.IsTrue(inv.Move(0, 10));
            Assert.IsTrue(inv[0].IsEmpty);
            Assert.AreEqual(ItemIds.Quartz, inv[10].Id);
            Assert.AreEqual(4, inv[10].Count);

            Assert.IsTrue(inv.Move(10, 1));
            Assert.AreEqual(ItemIds.Quartz, inv[1].Id);
            Assert.AreEqual(4, inv[1].Count);
            Assert.AreEqual(ItemIds.Cutter, inv[10].Id);
        }

        [Test]
        public void MoveMergesSameItemsAndKeepsTheRemainder()
        {
            var inv = new Inventory();
            int max = MaxStack(ItemIds.CopperOre);
            inv.Add(ItemIds.CopperOre, max + 20);                  // slot 0 full, slot 1 holds 20
            Assert.IsFalse(inv.Move(1, 0), "slot 0 is full");

            inv.RemoveAt(0, 10);                                   // room for 10
            Assert.IsTrue(inv.Move(1, 0));
            Assert.AreEqual(max, inv[0].Count);
            Assert.AreEqual(10, inv[1].Count);

            inv.RemoveAt(0, 30);                                   // room for 30: the rest fits whole
            Assert.IsTrue(inv.Move(1, 0));
            Assert.AreEqual(max - 20, inv[0].Count);
            Assert.IsTrue(inv[1].IsEmpty);
        }

        [Test]
        public void MoveRejectsBadSlotsAndEmptySources()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Quartz, 1);
            int v = inv.Version;
            Assert.IsFalse(inv.Move(0, 0));
            Assert.IsFalse(inv.Move(5, 6));
            Assert.IsFalse(inv.Move(0, Inventory.SlotCount));
            Assert.IsFalse(inv.Move(-1, 0));
            Assert.AreEqual(v, inv.Version);
        }

        [Test]
        public void SplitOpensTheFirstEmptySlot()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Sporeberry, 10);
            Assert.AreEqual(1, inv.Split(0, 4));
            Assert.AreEqual(6, inv[0].Count);
            Assert.AreEqual(4, inv[1].Count);
            Assert.AreEqual(-1, inv.Split(0, 0));
            Assert.AreEqual(-1, inv.Split(0, 6), "splitting everything is a move, not a split");
        }

        [Test]
        public void SplitFailsWhenThePackIsFull()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Cutter, Inventory.SlotCount - 1);
            inv.Add(ItemIds.Sporeberry, 10);
            Assert.AreEqual(-1, inv.Split(Inventory.SlotCount - 1, 3));
            Assert.AreEqual(10, inv[Inventory.SlotCount - 1].Count);
        }

        [Test]
        public void HotbarKeysPointAtSlotsAndFollowMoves()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.RationBar, 2);
            inv.Add(ItemIds.Scanner, 1);
            Assert.IsTrue(inv.AssignHotbar(0, 1));
            Assert.AreEqual(ItemIds.Scanner, inv.HotbarStack(0).Id);
            Assert.IsTrue(inv.HotbarStack(1).IsEmpty);

            inv.Move(1, 8);
            Assert.AreEqual(8, inv.HotbarSlot(0));
            Assert.AreEqual(ItemIds.Scanner, inv.HotbarStack(0).Id);

            // Swapping two items: each key keeps its item.
            inv.AssignHotbar(2, 0);
            inv.Move(0, 8);
            Assert.AreEqual(0, inv.HotbarSlot(0));
            Assert.AreEqual(8, inv.HotbarSlot(2));
            Assert.AreEqual(ItemIds.RationBar, inv.HotbarStack(2).Id);
        }

        [Test]
        public void AnItemSitsOnOneHotbarKeyAtATime()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Scanner, 1);
            inv.AssignHotbar(0, 0);
            inv.AssignHotbar(3, 0);
            Assert.AreEqual(-1, inv.HotbarSlot(0));
            Assert.AreEqual(0, inv.HotbarSlot(3));
        }

        [Test]
        public void HotbarEntriesClearWhenTheirSlotEmpties()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.RationBar, 2);
            inv.AssignHotbar(4, 0);
            inv.RemoveAt(0, 1);
            Assert.AreEqual(0, inv.HotbarSlot(4));
            inv.Remove(ItemIds.RationBar, 1);
            Assert.AreEqual(-1, inv.HotbarSlot(4));
            Assert.IsTrue(inv.HotbarStack(4).IsEmpty);
            // A new item landing in that slot does not inherit the key.
            inv.Add(ItemIds.Quartz, 1);
            Assert.IsTrue(inv.HotbarStack(4).IsEmpty);
        }

        [Test]
        public void MergingAHotbarStackAwayMovesTheKeyToTheSurvivor()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Sporeberry, MaxStack(ItemIds.Sporeberry));
            inv.Add(ItemIds.Sporeberry, 3);                        // slot 0 full, slot 1 holds 3
            inv.RemoveAt(0, 10);
            inv.AssignHotbar(1, 1);
            Assert.IsTrue(inv.Move(1, 0));
            Assert.IsTrue(inv[1].IsEmpty);
            Assert.AreEqual(0, inv.HotbarSlot(1));

            // If the survivor already has a key, the emptied slot's key is dropped.
            inv.Split(0, 3);
            inv.AssignHotbar(0, 0);
            inv.AssignHotbar(2, 1);
            Assert.IsTrue(inv.Move(1, 0));
            Assert.AreEqual(0, inv.HotbarSlot(0));
            Assert.AreEqual(-1, inv.HotbarSlot(2));
            Assert.AreEqual(-1, inv.HotbarSlot(1));
        }

        [Test]
        public void AssigningAnEmptySlotOrBadKeyFails()
        {
            var inv = new Inventory();
            Assert.IsFalse(inv.AssignHotbar(0, 0));
            inv.Add(ItemIds.Quartz, 1);
            Assert.IsFalse(inv.AssignHotbar(Inventory.HotbarSize, 0));
            Assert.IsTrue(inv.AssignHotbar(0, 0));
            Assert.IsFalse(inv.AssignHotbar(0, 0), "already there");
            Assert.IsTrue(inv.ClearHotbar(0));
            Assert.IsFalse(inv.ClearHotbar(0));
        }

        [Test]
        public void VersionBumpsOnEveryRealChange()
        {
            var inv = new Inventory();
            int v = inv.Version;
            inv.Add(ItemIds.Quartz, 3);
            Assert.Greater(inv.Version, v);
            v = inv.Version;
            inv.Move(0, 4);
            Assert.Greater(inv.Version, v);
            v = inv.Version;
            inv.AssignHotbar(0, 4);
            Assert.Greater(inv.Version, v);
            v = inv.Version;
            inv.Split(4, 1);
            Assert.Greater(inv.Version, v);
            v = inv.Version;
            inv.Remove(ItemIds.Quartz, 1);
            Assert.Greater(inv.Version, v);
            v = inv.Version;
            inv.Remove(ItemIds.Quartz, 99);
            Assert.AreEqual(v, inv.Version, "a failed remove changes nothing");
        }

        [Test]
        public void StartingKitMatchesTheSpec()
        {
            var inv = new Inventory();
            inv.AddStartingKit();
            Assert.AreEqual(1, inv.Count(ItemIds.Scanner));
            Assert.AreEqual(2, inv.Count(ItemIds.RationBar));
            Assert.AreEqual(2, inv.Count(ItemIds.FilteredWater));
            Assert.AreEqual(1, inv.Count(ItemIds.O2Canister));
        }

        [Test]
        public void CloneIsIndependent()
        {
            var inv = new Inventory();
            inv.Add(ItemIds.Quartz, 5);
            inv.AssignHotbar(0, 0);
            var copy = inv.Clone();
            copy.Remove(ItemIds.Quartz, 5);
            Assert.AreEqual(5, inv.Count(ItemIds.Quartz));
            Assert.AreEqual(0, inv.HotbarSlot(0));
            Assert.AreEqual(-1, copy.HotbarSlot(0));
            inv.CopyFrom(copy);
            Assert.AreEqual(0, inv.Count(ItemIds.Quartz));
        }
    }
}
