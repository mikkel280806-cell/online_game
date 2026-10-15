using System;

namespace HollowStar.Core.Survival
{
    /// <summary>
    /// A player's backpack: 24 slots (a 6 x 4 grid) plus 5 hotbar slots that point at items in it.
    /// Pure logic; every change bumps <see cref="Version"/> so the UI can refresh by comparing numbers
    /// instead of subscribing to events.
    /// </summary>
    public sealed class Inventory
    {
        public const int Columns = 6;
        public const int Rows = 4;
        public const int SlotCount = Columns * Rows;
        public const int HotbarSize = 5;

        private const int NoSlot = -1;

        private readonly ItemStack[] slots = new ItemStack[SlotCount];
        // Each hotbar entry is an inventory slot index, or NoSlot. Emptying a slot clears the entries
        // that pointed at it, so a key never silently points at a different item later.
        private readonly int[] hotbar = new int[HotbarSize];

        public Inventory()
        {
            for (int i = 0; i < HotbarSize; i++) hotbar[i] = NoSlot;
        }

        /// <summary>Increments on every change to the slots or the hotbar.</summary>
        public int Version { get; private set; }

        public ItemStack this[int slot] => slots[slot];

        /// <summary>Total of <paramref name="id"/> across all slots.</summary>
        public int Count(string id)
        {
            int total = 0;
            for (int i = 0; i < SlotCount; i++)
                if (slots[i].Id == id) total += slots[i].Count;
            return total;
        }

        public bool Has(string id, int count = 1) => Count(id) >= count;

        /// <summary>How many more of <paramref name="id"/> would fit right now.</summary>
        public int FreeSpaceFor(string id)
        {
            int max = ItemCatalog.Get(id).MaxStack;
            int space = 0;
            for (int i = 0; i < SlotCount; i++)
            {
                if (slots[i].IsEmpty) space += max;
                else if (slots[i].Id == id) space += max - slots[i].Count;
            }
            return space;
        }

        /// <summary>Adds items, topping up existing stacks before opening new ones. Returns how many did not fit.</summary>
        public int Add(string id, int count)
        {
            var def = ItemCatalog.Get(id);
            if (count < 0) throw new ArgumentOutOfRangeException(nameof(count));
            int left = count;
            for (int i = 0; i < SlotCount && left > 0; i++)
            {
                if (slots[i].Id != id || slots[i].Count >= def.MaxStack) continue;
                int put = Math.Min(def.MaxStack - slots[i].Count, left);
                slots[i] = new ItemStack(id, slots[i].Count + put);
                left -= put;
            }
            for (int i = 0; i < SlotCount && left > 0; i++)
            {
                if (!slots[i].IsEmpty) continue;
                int put = Math.Min(def.MaxStack, left);
                slots[i] = new ItemStack(id, put);
                left -= put;
            }
            if (left != count) Version++;
            return left;
        }

        /// <summary>Removes exactly <paramref name="count"/> or nothing: returns false if there are too few.</summary>
        public bool Remove(string id, int count)
        {
            if (count < 0) throw new ArgumentOutOfRangeException(nameof(count));
            if (Count(id) < count) return false;
            if (count == 0) return true;
            // Drain from the back so the front stacks stay full.
            int left = count;
            for (int i = SlotCount - 1; i >= 0 && left > 0; i--)
            {
                if (slots[i].Id != id) continue;
                int take = Math.Min(slots[i].Count, left);
                SetSlot(i, slots[i].Count - take > 0 ? new ItemStack(id, slots[i].Count - take) : default);
                left -= take;
            }
            Version++;
            return true;
        }

        /// <summary>Removes up to <paramref name="count"/> from one slot (use, drop). Returns how many were taken.</summary>
        public int RemoveAt(int slot, int count)
        {
            if (count < 0) throw new ArgumentOutOfRangeException(nameof(count));
            var s = slots[slot];
            int take = s.IsEmpty ? 0 : Math.Min(s.Count, count);
            if (take == 0) return 0;
            SetSlot(slot, s.Count - take > 0 ? new ItemStack(s.Id, s.Count - take) : default);
            Version++;
            return take;
        }

        /// <summary>
        /// Drags the stack in <paramref name="from"/> onto <paramref name="to"/>: into an empty slot, merged
        /// into the same item up to the max stack, or swapped with a different item. Hotbar entries follow
        /// their items. Returns false if nothing changed.
        /// </summary>
        public bool Move(int from, int to)
        {
            if (from == to || !InRange(from) || !InRange(to) || slots[from].IsEmpty) return false;
            var a = slots[from];
            var b = slots[to];
            if (b.IsEmpty || b.Id != a.Id)
            {
                slots[to] = a;
                slots[from] = b;
                for (int i = 0; i < HotbarSize; i++)
                {
                    if (hotbar[i] == from) hotbar[i] = to;
                    else if (hotbar[i] == to) hotbar[i] = from;
                }
            }
            else
            {
                int room = ItemCatalog.Get(a.Id).MaxStack - b.Count;
                if (room <= 0) return false;
                int moved = Math.Min(room, a.Count);
                slots[to] = new ItemStack(a.Id, b.Count + moved);
                if (moved == a.Count)
                {
                    slots[from] = default;
                    // The key on the emptied slot follows the item, unless `to` already has a key of its own.
                    int fromKey = IndexOfSlot(from);
                    if (fromKey != NoSlot) hotbar[fromKey] = IndexOfSlot(to) == NoSlot ? to : NoSlot;
                }
                else
                {
                    slots[from] = new ItemStack(a.Id, a.Count - moved);
                }
            }
            Version++;
            return true;
        }

        /// <summary>
        /// Splits <paramref name="count"/> items off a stack into the first empty slot. Returns that slot, or -1
        /// if the split is impossible (bad count, or no empty slot).
        /// </summary>
        public int Split(int slot, int count)
        {
            if (!InRange(slot) || slots[slot].IsEmpty || count < 1 || count >= slots[slot].Count) return NoSlot;
            for (int i = 0; i < SlotCount; i++)
            {
                if (!slots[i].IsEmpty) continue;
                slots[i] = new ItemStack(slots[slot].Id, count);
                slots[slot] = new ItemStack(slots[slot].Id, slots[slot].Count - count);
                Version++;
                return i;
            }
            return NoSlot;
        }

        /// <summary>The inventory slot hotbar key <paramref name="index"/> (0..4) points at, or -1.</summary>
        public int HotbarSlot(int index) => hotbar[index];

        /// <summary>What hotbar key <paramref name="index"/> holds; an empty stack if unassigned.</summary>
        public ItemStack HotbarStack(int index) => hotbar[index] == NoSlot ? default : slots[hotbar[index]];

        /// <summary>Points a hotbar key at a filled slot. An item sits on one key at a time. False if the slot is empty.</summary>
        public bool AssignHotbar(int index, int slot)
        {
            if (index < 0 || index >= HotbarSize || !InRange(slot) || slots[slot].IsEmpty) return false;
            if (hotbar[index] == slot) return false;
            ClearHotbarFor(slot);
            hotbar[index] = slot;
            Version++;
            return true;
        }

        public bool ClearHotbar(int index)
        {
            if (hotbar[index] == NoSlot) return false;
            hotbar[index] = NoSlot;
            Version++;
            return true;
        }

        /// <summary>Gives the starting kit (spec section 2) to a fresh inventory.</summary>
        public void AddStartingKit()
        {
            foreach (var s in ItemCatalog.StartingKit) Add(s.Id, s.Count);
        }

        /// <summary>An independent copy, for trying a change (crafting) before committing it.</summary>
        public Inventory Clone()
        {
            var copy = new Inventory();
            copy.CopyFrom(this);
            return copy;
        }

        /// <summary>Replaces this inventory's contents and hotbar with <paramref name="other"/>'s.</summary>
        public void CopyFrom(Inventory other)
        {
            Array.Copy(other.slots, slots, SlotCount);
            Array.Copy(other.hotbar, hotbar, HotbarSize);
            Version++;
        }

        private static bool InRange(int slot) => slot >= 0 && slot < SlotCount;

        private int IndexOfSlot(int slot)
        {
            for (int i = 0; i < HotbarSize; i++)
                if (hotbar[i] == slot) return i;
            return NoSlot;
        }

        private void ClearHotbarFor(int slot)
        {
            for (int i = 0; i < HotbarSize; i++)
                if (hotbar[i] == slot) hotbar[i] = NoSlot;
        }

        private void SetSlot(int slot, ItemStack value)
        {
            slots[slot] = value;
            if (value.IsEmpty) ClearHotbarFor(slot);
        }
    }
}
