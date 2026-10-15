namespace HollowStar.Core.Survival
{
    /// <summary>
    /// U3's stub objective chain: find water, craft a cutter, then the placeholder "restore the outpost power"
    /// (which becomes the real mission in U5). Steps are checked in order and never go backwards.
    /// </summary>
    public sealed class ObjectiveChain
    {
        public const string FindWater = "Find water";
        public const string CraftCutter = "Craft a cutter";
        public const string RestorePower = "Restore the outpost power";

        private static readonly string[] steps = { FindWater, CraftCutter, RestorePower };

        public int Index { get; private set; }

        public string Current => steps[Index];

        /// <summary>The last step is a placeholder that stays on screen.</summary>
        public bool IsFinalStep => Index == steps.Length - 1;

        public static string TextOf(int index) => steps[index];

        /// <summary>
        /// Moves on past every step that is done and returns how many it advanced. Water counts once you hold an
        /// ice chunk or have made filtered water; the starting kit's bottles do not count, or the step would be
        /// done before the player has moved.
        /// </summary>
        public int Update(Inventory inventory, bool craftedFilteredWater)
        {
            int advanced = 0;
            while (!IsFinalStep && IsDone(Index, inventory, craftedFilteredWater))
            {
                Index++;
                advanced++;
            }
            return advanced;
        }

        private static bool IsDone(int step, Inventory inventory, bool craftedFilteredWater)
        {
            switch (step)
            {
                case 0: return inventory.Has(ItemIds.IceChunk) || craftedFilteredWater;
                case 1: return inventory.Has(ItemIds.Cutter);
                default: return false;
            }
        }
    }
}
