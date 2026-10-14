using System;
using System.Collections.Generic;

namespace HollowStar.Core
{
    /// <summary>
    /// A blocker on the ground plane, used by the pure gameplay logic (e.g. bolts stop at walls).
    /// Player movement uses Unity physics instead.
    /// </summary>
    public readonly struct FlatCollider
    {
        public readonly bool IsCircle;
        public readonly float X, Z, R;
        public readonly float MinX, MaxX, MinZ, MaxZ;

        private FlatCollider(bool isCircle, float x, float z, float r, float minX, float maxX, float minZ, float maxZ)
        {
            IsCircle = isCircle;
            X = x;
            Z = z;
            R = r;
            MinX = minX;
            MaxX = maxX;
            MinZ = minZ;
            MaxZ = maxZ;
        }

        public static FlatCollider Circle(float x, float z, float r) => new FlatCollider(true, x, z, r, 0, 0, 0, 0);

        public static FlatCollider Box(float minX, float maxX, float minZ, float maxZ) =>
            new FlatCollider(false, 0, 0, 0, minX, maxX, minZ, maxZ);

        public bool Contains(float x, float z) =>
            IsCircle ? MathF.Sqrt((x - X) * (x - X) + (z - Z) * (z - Z)) < R : x > MinX && x < MaxX && z > MinZ && z < MaxZ;

        public static bool InsideAny(float x, float z, IReadOnlyList<FlatCollider> colliders)
        {
            for (int i = 0; i < colliders.Count; i++)
                if (colliders[i].Contains(x, z)) return true;
            return false;
        }
    }
}
