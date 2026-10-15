namespace HollowStar.Core.Survival
{
    public enum CraftResult
    {
        Ok = 0,
        /// <summary>The player is not at a station that can make this ("Requires fabricator").</summary>
        WrongStation = 1,
        MissingIngredients = 2,
        /// <summary>The ingredients are there but the output has nowhere to go.</summary>
        NoSpace = 3,
    }

    /// <summary>Turns ingredients into an item. Nothing is consumed unless the whole craft can complete.</summary>
    public static class Crafting
    {
        /// <summary>
        /// Whether <paramref name="recipe"/> can be made now. <paramref name="at"/> is the station the player
        /// stands at; the default is the fabricator, which can make everything.
        /// </summary>
        public static CraftResult Check(Recipe recipe, Inventory inventory, CraftStations at = CraftStations.Fabricator)
        {
            if (!recipe.IsAvailableAt(at)) return CraftResult.WrongStation;
            foreach (var input in recipe.Inputs)
                if (!inventory.Has(input.Id, input.Count)) return CraftResult.MissingIngredients;
            // Plenty of room is the common case; skip the dry run for it.
            if (inventory.FreeSpaceFor(recipe.Id) >= recipe.OutputCount) return CraftResult.Ok;
            // A full pack can still work: using up a whole stack of inputs frees its slot.
            var trial = inventory.Clone();
            RemoveInputs(recipe, trial);
            return trial.Add(recipe.Id, recipe.OutputCount) == 0 ? CraftResult.Ok : CraftResult.NoSpace;
        }

        public static bool CanCraft(Recipe recipe, Inventory inventory, CraftStations at = CraftStations.Fabricator) =>
            Check(recipe, inventory, at) == CraftResult.Ok;

        /// <summary>Removes the inputs and adds the output, or changes nothing and says why not.</summary>
        public static CraftResult Craft(Recipe recipe, Inventory inventory, CraftStations at = CraftStations.Fabricator)
        {
            var result = Check(recipe, inventory, at);
            if (result != CraftResult.Ok) return result;
            RemoveInputs(recipe, inventory);
            inventory.Add(recipe.Id, recipe.OutputCount);
            return CraftResult.Ok;
        }

        private static void RemoveInputs(Recipe recipe, Inventory inventory)
        {
            foreach (var input in recipe.Inputs) inventory.Remove(input.Id, input.Count);
        }
    }
}
