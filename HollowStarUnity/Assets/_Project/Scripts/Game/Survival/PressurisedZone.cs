using System.Collections.Generic;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>
    /// A breathable, sheltered volume: the Wren bay and the outpost habs. Oxygen refills inside and the cold is kept out.
    /// The box is a trigger collider (so it shows in the scene view); the survivor asks <see cref="IsInside"/> every frame
    /// instead of relying on physics callbacks, which makes it work the same on a teleport or a respawn.
    /// </summary>
    [RequireComponent(typeof(BoxCollider))]
    public sealed class PressurisedZone : MonoBehaviour
    {
        private static readonly List<PressurisedZone> zones = new List<PressurisedZone>();

        public string Label = "Zone";

        private BoxCollider box;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => zones.Clear();

        private void Awake() => box = GetComponent<BoxCollider>();

        private void OnEnable() => zones.Add(this);

        private void OnDisable() => zones.Remove(this);

        public bool Contains(Vector3 world)
        {
            if (box == null) box = GetComponent<BoxCollider>();
            Vector3 local = transform.InverseTransformPoint(world) - box.center;
            Vector3 half = box.size * 0.5f;
            return Mathf.Abs(local.x) <= half.x && Mathf.Abs(local.y) <= half.y && Mathf.Abs(local.z) <= half.z;
        }

        /// <summary>True if the point is inside any zone.</summary>
        public static bool IsInside(Vector3 world) => Find(world) != null;

        public static PressurisedZone Find(Vector3 world)
        {
            for (int i = 0; i < zones.Count; i++)
                if (zones[i].Contains(world)) return zones[i];
            return null;
        }
    }
}
