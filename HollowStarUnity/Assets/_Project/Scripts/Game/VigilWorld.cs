using UnityEngine;

namespace HollowStar.Game
{
    /// <summary>
    /// The moon's ground: the detailed near terrain around the outpost and the coarse far terrain
    /// out to the mountains. Gameplay asks it for ground height.
    /// </summary>
    public sealed class VigilWorld : MonoBehaviour
    {
        public Terrain Near;
        public Terrain Far;

        private static VigilWorld instance;

        private void OnEnable() => instance = this;

        private void OnDisable()
        {
            if (instance == this) instance = null;
        }

        private static bool Covers(Terrain t, float x, float z)
        {
            if (t == null) return false;
            Vector3 p = t.transform.position;
            Vector3 s = t.terrainData.size;
            return x >= p.x && x <= p.x + s.x && z >= p.z && z <= p.z + s.z;
        }

        /// <summary>Terrain height (m) at (x, z); 0 when there is no terrain.</summary>
        public static float GroundHeight(float x, float z)
        {
            if (instance == null) return 0f;
            var q = new Vector3(x, 0f, z);
            if (Covers(instance.Near, x, z)) return instance.Near.SampleHeight(q) + instance.Near.transform.position.y;
            if (Covers(instance.Far, x, z)) return instance.Far.SampleHeight(q) + instance.Far.transform.position.y;
            return 0f;
        }
    }
}
