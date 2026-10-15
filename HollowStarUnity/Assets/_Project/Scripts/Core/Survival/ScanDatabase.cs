using System.Collections.Generic;

namespace HollowStar.Core.Survival
{
    /// <summary>
    /// The databank: which entries (a node kind, creature or prop, by id) this player has scanned. Only the ids
    /// live here; the Game owns the text on each card. Unlock order is kept so the UI can list newest first.
    /// </summary>
    public sealed class ScanDatabase
    {
        private readonly HashSet<string> set = new HashSet<string>();
        private readonly List<string> order = new List<string>();

        /// <summary>Increments on every change, so the UI can refresh by comparing numbers.</summary>
        public int Version { get; private set; }

        public int Count => order.Count;

        /// <summary>Entry ids in the order they were unlocked.</summary>
        public IReadOnlyList<string> Unlocked => order;

        public bool IsUnlocked(string id) => id != null && set.Contains(id);

        /// <summary>Returns true the first time an entry is scanned (show the "DATABANK: ..." toast), false after.</summary>
        public bool Unlock(string id)
        {
            if (string.IsNullOrEmpty(id) || !set.Add(id)) return false;
            order.Add(id);
            Version++;
            return true;
        }

        /// <summary>Replaces the whole set: loading a save.</summary>
        public void Replace(IEnumerable<string> ids)
        {
            set.Clear();
            order.Clear();
            foreach (var id in ids)
                if (!string.IsNullOrEmpty(id) && set.Add(id)) order.Add(id);
            Version++;
        }
    }
}
