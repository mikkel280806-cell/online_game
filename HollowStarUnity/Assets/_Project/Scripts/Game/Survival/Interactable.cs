using System.Collections.Generic;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>What F would do to an <see cref="Interactable"/> right now, as the prompt shows it.</summary>
    public struct InteractPrompt
    {
        public string Text;
        /// <summary>A second line, e.g. "Requires cutter". Null for none.</summary>
        public string Detail;
        /// <summary>False when the action is blocked (the Detail says why).</summary>
        public bool Allowed;
    }

    /// <summary>
    /// Something the local survivor can look at: gather it (F), scan it (V), or both. Registered in a static list
    /// so the survivor's look-at can find the nearest one without physics queries.
    /// </summary>
    public abstract class Interactable : MonoBehaviour
    {
        public static readonly List<Interactable> All = new List<Interactable>();

        /// <summary>Databank entry that scanning this unlocks; null if it cannot be scanned.</summary>
        public string ScanId;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => All.Clear();

        protected virtual void OnEnable() => All.Add(this);

        protected virtual void OnDisable() => All.Remove(this);

        /// <summary>False while hidden (a depleted node): not targetable at all.</summary>
        public virtual bool Present => true;

        /// <summary>The point the look-at aims for, and the label sits at.</summary>
        public virtual Vector3 FocusPoint => transform.position;

        /// <summary>Distance from a point to this thing (for big things, to its nearest surface).</summary>
        public virtual float DistanceTo(Vector3 from) => Vector3.Distance(from, FocusPoint);

        /// <summary>Nearest point, for the facing test.</summary>
        public virtual Vector3 NearestPoint(Vector3 from) => FocusPoint;

        /// <summary>How close the survivor must be for the F prompt.</summary>
        public virtual float Reach => 3f;

        /// <summary>How close for scanning.</summary>
        public virtual float ScanReach => 6f;

        /// <summary>Does F do anything here?</summary>
        public virtual bool HasAction => false;

        /// <summary>Seconds F must be held; 0 means a tap.</summary>
        public virtual float HoldSeconds => 0f;

        /// <summary>Name for prompts and the scan label.</summary>
        public virtual string Title => name;

        public virtual InteractPrompt Prompt(Survivor who) => default;

        /// <summary>F completed (the hold finished, or the tap).</summary>
        public virtual void Activate(Survivor who) { }
    }
}
