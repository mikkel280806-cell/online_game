using UnityEngine;

namespace HollowStar.Game.Characters
{
    /// <summary>
    /// Joint hierarchy of the EVA suit. Bind pose: standing straight, arms hanging down, every bone
    /// unrotated. Same numbers as the web version (src/characters/rig.ts) and the Blender build script
    /// (art/blender/scripts/build_astronaut.py), so the procedural animation ports one to one.
    /// </summary>
    public static class SuitRig
    {
        public enum Bone
        {
            Pelvis, Spine, Chest, Neck, Head,
            ClavL, ArmL, ForeL, HandL,
            ClavR, ArmR, ForeR, HandR,
            ThighL, ShinL, FootL,
            ThighR, ShinR, FootR,
            Pack, Antenna,
        }

        public const int Count = 21;

        /// <summary>Bone names in the FBX (the web version's keys).</summary>
        public static readonly string[] Names =
        {
            "pelvis", "spine", "chest", "neck", "head",
            "clavL", "armL", "foreL", "handL",
            "clavR", "armR", "foreR", "handR",
            "thighL", "shinL", "footL",
            "thighR", "shinR", "footR",
            "pack", "antenna",
        };

        public static readonly int[] Parent =
        {
            -1, 0, 1, 2, 3,
            2, 5, 6, 7,
            2, 9, 10, 11,
            0, 13, 14,
            0, 16, 17,
            2, 19,
        };

        // Key dimensions (metres). The suited crew member is 1.8 m to the top of the helmet.
        public const float HipY = 0.95f;
        public const float HipX = 0.105f;
        public const float Thigh = 0.43f;
        public const float Shin = 0.42f;
        public const float AnkleY = 0.1f;
        /// <summary>Heel and ball of the foot relative to the ankle, in the foot's frame.</summary>
        public const float HeelZ = -0.085f;
        public const float BallZ = 0.135f;
        public const float ToeZ = 0.205f;
        public const float ShoulderX = 0.235f;
        public const float ShoulderY = 1.425f;
        public const float UpperArm = 0.29f;
        public const float Forearm = 0.26f;

        /// <summary>Bind-pose joint positions in model space.</summary>
        public static readonly Vector3[] Joints =
        {
            new Vector3(0, 0.98f, 0),
            new Vector3(0, 1.08f, -0.01f),
            new Vector3(0, 1.24f, -0.012f),
            new Vector3(0, 1.5f, -0.005f),
            new Vector3(0, 1.535f, 0),
            new Vector3(0.06f, 1.42f, -0.012f),
            new Vector3(ShoulderX, ShoulderY, -0.012f),
            new Vector3(ShoulderX, ShoulderY - UpperArm, -0.012f),
            new Vector3(ShoulderX, ShoulderY - UpperArm - Forearm, -0.008f),
            new Vector3(-0.06f, 1.42f, -0.012f),
            new Vector3(-ShoulderX, ShoulderY, -0.012f),
            new Vector3(-ShoulderX, ShoulderY - UpperArm, -0.012f),
            new Vector3(-ShoulderX, ShoulderY - UpperArm - Forearm, -0.008f),
            new Vector3(HipX, HipY, 0),
            new Vector3(HipX, HipY - Thigh, 0),
            new Vector3(HipX, AnkleY, 0),
            new Vector3(-HipX, HipY, 0),
            new Vector3(-HipX, HipY - Thigh, 0),
            new Vector3(-HipX, AnkleY, 0),
            new Vector3(0, 1.26f, -0.17f),
            new Vector3(-0.15f, 1.53f, -0.3f),
        };
    }

    /// <summary>A bone pose in model space, built up the hierarchy from local rotations.</summary>
    public sealed class SuitPose
    {
        public readonly Vector3[] LocalPos = new Vector3[SuitRig.Count];
        public readonly Quaternion[] LocalRot = new Quaternion[SuitRig.Count];
        public readonly Vector3[] WorldPos = new Vector3[SuitRig.Count];
        public readonly Quaternion[] WorldRot = new Quaternion[SuitRig.Count];

        public SuitPose()
        {
            for (int i = 0; i < SuitRig.Count; i++)
            {
                int p = SuitRig.Parent[i];
                LocalPos[i] = p < 0 ? SuitRig.Joints[i] : SuitRig.Joints[i] - SuitRig.Joints[p];
                LocalRot[i] = Quaternion.identity;
            }
        }

        /// <summary>Compose locals into model-space transforms (parents come before children).</summary>
        public void Solve()
        {
            for (int i = 0; i < SuitRig.Count; i++)
            {
                int p = SuitRig.Parent[i];
                if (p < 0)
                {
                    WorldPos[i] = LocalPos[i];
                    WorldRot[i] = LocalRot[i];
                }
                else
                {
                    WorldPos[i] = WorldPos[p] + WorldRot[p] * LocalPos[i];
                    WorldRot[i] = WorldRot[p] * LocalRot[i];
                }
            }
        }
    }
}
