using System;

namespace HollowStar.Core.Survival
{
    /// <summary>
    /// What the carried equipment does to the suit. For U3 gear works while it is in the pack (there is no
    /// equip screen); the Game feeds these numbers into <see cref="VitalsEnvironment"/>.
    /// </summary>
    public static class SuitGear
    {
        /// <summary>The plain suit already keeps out some cold.</summary>
        public const float BaseInsulation = 0.3f;
        /// <summary>Even a liner never makes the player immune.</summary>
        public const float MaxInsulation = 0.9f;

        /// <summary>The best tank carried sets the capacity; two tanks do not stack.</summary>
        public static float OxygenCapacity(Inventory inventory)
        {
            float factor = 1f;
            for (int i = 0; i < Inventory.SlotCount; i++)
            {
                var def = inventory[i].Def;
                if (def != null) factor = MathF.Max(factor, def.OxygenCapacityFactor);
            }
            return Vitals.BaseOxygenCapacity * factor;
        }

        /// <summary>Base suit insulation plus the best liner carried.</summary>
        public static float Insulation(Inventory inventory)
        {
            float extra = 0f;
            for (int i = 0; i < Inventory.SlotCount; i++)
            {
                var def = inventory[i].Def;
                if (def != null) extra = MathF.Max(extra, def.Insulation);
            }
            return MathF.Min(MaxInsulation, BaseInsulation + extra);
        }
    }
}
