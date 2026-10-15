using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>
    /// The places that belong to the Wren, as children of the Wren root: where a session starts, where a dead survivor
    /// comes back, and the fabricator. Everything else asks here, so a later milestone can move the whole ship to a
    /// crash site without touching any code.
    /// </summary>
    public sealed class WrenAnchors : MonoBehaviour
    {
        public static WrenAnchors Current { get; private set; }

        /// <summary>Host first, guest second.</summary>
        public Transform[] SessionSpawns;
        public Transform[] RespawnPoints;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => Current = null;

        private void OnEnable() => Current = this;

        private void OnDisable()
        {
            if (Current == this) Current = null;
        }

        public bool TryGetSessionSpawn(int index, out Vector3 position, out Quaternion rotation)
        {
            return TryGet(SessionSpawns, index, out position, out rotation);
        }

        public bool TryGetRespawn(int index, out Vector3 position, out Quaternion rotation)
        {
            return TryGet(RespawnPoints, index, out position, out rotation);
        }

        private static bool TryGet(Transform[] points, int index, out Vector3 position, out Quaternion rotation)
        {
            position = default;
            rotation = Quaternion.identity;
            if (points == null || points.Length == 0) return false;
            var t = points[Mathf.Abs(index) % points.Length];
            if (t == null) return false;
            position = t.position;
            rotation = t.rotation;
            return true;
        }
    }
}
