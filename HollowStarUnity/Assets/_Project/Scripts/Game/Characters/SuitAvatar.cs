using HollowStar.Core;
using UnityEngine;

namespace HollowStar.Game.Characters
{
    /// <summary>
    /// Poses the astronaut model every frame from its PlayerMotor's heading and speed, using the
    /// procedural <see cref="Locomotion"/>. The model's bones import unrotated (see the Blender build
    /// script), so model-space poses apply directly. For the other player's character, which the
    /// network moves rather than its motor, heading and speed are read back from the transform.
    /// </summary>
    public sealed class SuitAvatar : MonoBehaviour
    {
        public RoleId Role = RoleId.Vanguard;
        public Material VanguardAccent;
        public Material TetherAccent;
        /// <summary>Seed for idle variety (look-arounds, gestures).</summary>
        public uint Seed = 1;

        private readonly Transform[] bones = new Transform[SuitRig.Count];
        private readonly SuitPose pose = new SuitPose();
        private Locomotion loco;
        private PlayerMotor motor;
        private RoleId appliedRole = (RoleId)(-1);
        private Vector3 lastPosition;
        private bool hasLastPosition;
        private float remoteSpeed;

        private void Awake()
        {
            loco = new Locomotion(Seed);
            motor = GetComponentInParent<PlayerMotor>();
            var all = GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < SuitRig.Count; i++)
            {
                foreach (var t in all)
                {
                    if (t.name != SuitRig.Names[i]) continue;
                    bones[i] = t;
                    break;
                }
            }
        }

        private void ApplyRole()
        {
            if (appliedRole == Role) return;
            appliedRole = Role;
            Material accent = Role == RoleId.Vanguard ? VanguardAccent : TetherAccent;
            if (accent == null) return;
            foreach (var r in GetComponentsInChildren<Renderer>())
            {
                var mats = r.sharedMaterials;
                bool changed = false;
                for (int i = 0; i < mats.Length; i++)
                {
                    if (mats[i] == null || !mats[i].name.StartsWith("M_SuitAccent")) continue;
                    mats[i] = accent;
                    changed = true;
                }
                if (changed) r.sharedMaterials = mats;
            }
        }

        /// <summary>
        /// Ground speed from how far the (interpolated) network transform moved this frame, smoothed
        /// so tick-to-tick jitter doesn't show in the gait. Jumps (spawns, teleports) count as standing.
        /// </summary>
        private float EstimateSpeed(Vector3 position, float dt)
        {
            if (hasLastPosition && dt > 0f)
            {
                float v = new Vector2(position.x - lastPosition.x, position.z - lastPosition.z).magnitude / dt;
                if (v > 30f) v = 0f;
                remoteSpeed = Mathf.Lerp(remoteSpeed, v, 1f - Mathf.Exp(-10f * dt));
            }
            lastPosition = position;
            hasLastPosition = true;
            return remoteSpeed;
        }

        private void LateUpdate()
        {
            if (motor != null) Role = motor.Role;
            ApplyRole();
            float yaw, speed;
            if (motor != null && motor.Simulated)
            {
                yaw = motor.Yaw;
                speed = motor.Speed;
                hasLastPosition = false;
            }
            else
            {
                Transform body = motor != null ? motor.transform : transform;
                yaw = body.eulerAngles.y * Mathf.Deg2Rad;
                speed = EstimateSpeed(body.position, Time.deltaTime);
            }
            loco.Update(yaw, speed, Time.deltaTime, pose);
            pose.Solve();
            Transform root = transform;
            for (int i = 0; i < SuitRig.Count; i++)
            {
                if (bones[i] == null) continue;
                bones[i].SetPositionAndRotation(root.TransformPoint(pose.WorldPos[i]), root.rotation * pose.WorldRot[i]);
            }
        }
    }
}
