using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>A scan-only thing: the Wren, the fabricator, the outpost. Its volume is a trigger box.</summary>
    public sealed class Scannable : Interactable
    {
        public string DisplayName = "Scannable";
        public BoxCollider Volume;

        public override string Title => DisplayName;

        public override Vector3 FocusPoint => Volume != null ? Volume.bounds.center : transform.position;

        public override float DistanceTo(Vector3 from) =>
            Volume != null ? Vector3.Distance(from, Volume.ClosestPoint(from)) : base.DistanceTo(from);

        public override Vector3 NearestPoint(Vector3 from) => Volume != null ? Volume.ClosestPoint(from) : FocusPoint;
    }
}
