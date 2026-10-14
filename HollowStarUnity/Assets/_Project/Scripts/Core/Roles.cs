using System;

namespace HollowStar.Core
{
    /// <summary>The two crew roles. The host plays the Vanguard, the guest the Tether.</summary>
    public enum RoleId
    {
        Vanguard = 0,
        Tether = 1,
    }

    public static class Roles
    {
        public const int Count = 2;

        public static string Name(RoleId role) => role == RoleId.Vanguard ? "Vanguard" : "Tether";

        public static RoleId Other(RoleId role) => role == RoleId.Vanguard ? RoleId.Tether : RoleId.Vanguard;
    }

    /// <summary>A point on the ground plane (metres).</summary>
    public readonly struct GroundPoint
    {
        public readonly float X;
        public readonly float Z;

        public GroundPoint(float x, float z)
        {
            X = x;
            Z = z;
        }

        public float DistanceTo(float x, float z) => MathF.Sqrt((x - X) * (x - X) + (z - Z) * (z - Z));
    }

    /// <summary>What an interact prompt shows: its text, whether this player may act, and progress 0..1.</summary>
    public readonly struct Prompt
    {
        public readonly string Text;
        public readonly bool Allowed;
        public readonly float Progress;

        public Prompt(string text, bool allowed, float progress = 0f)
        {
            Text = text;
            Allowed = allowed;
            Progress = progress;
        }
    }
}
