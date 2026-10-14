using HollowStar.Core;
using UnityEngine;

namespace HollowStar.Game
{
    /// <summary>What a player wants to do this frame, in world space. Used by humans and by the bot.</summary>
    public struct PlayerIntent
    {
        /// <summary>Desired direction on the ground (x, z); length 0..1.</summary>
        public Vector2 Move;
        public bool Sprint;
        /// <summary>Pressed this frame.</summary>
        public bool Dash;
    }

    /// <summary>
    /// A walking crew member. Same feel as the web version's LocalPlayer: quick acceleration,
    /// strong friction, sprint, and a short dash. Unity's CharacterController handles slopes,
    /// steps and walls.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class PlayerMotor : MonoBehaviour
    {
        public const float Walk = 5.2f;
        public const float SprintSpeed = 8.4f;
        private const float Accel = 38f;
        private const float Friction = 12f;
        private const float DashSpeed = 15f;
        private const float DashTime = 0.16f;
        private const float DashCooldown = 1.1f;
        private const float Gravity = 9f;

        public RoleId Role = RoleId.Vanguard;
        /// <summary>Knocked out in combat: can't move until revived.</summary>
        public bool Downed;
        /// <summary>
        /// This machine steps the motor. False on the copy of the other player's character, which the
        /// network moves; its avatar then reads speed and heading from the transform instead.
        /// </summary>
        public bool Simulated = true;

        private CharacterController controller;
        private Vector3 velocity;
        private float fall;
        private float dashT;
        private float dashCd;

        public float Yaw { get; private set; }
        public Vector3 Velocity => velocity;
        public float Speed => new Vector2(velocity.x, velocity.z).magnitude;

        private void Awake()
        {
            controller = GetComponent<CharacterController>();
            Yaw = transform.eulerAngles.y * Mathf.Deg2Rad;
        }

        public void Step(PlayerIntent intent, float dt)
        {
            if (dt <= 0f) return;
            if (Downed) intent = default;
            Vector2 input = intent.Move;
            float len = input.magnitude;
            float max = (intent.Sprint ? SprintSpeed : Walk) * Mathf.Min(1f, len);
            dashCd = Mathf.Max(0f, dashCd - dt);
            if (intent.Dash && dashCd <= 0f)
            {
                // Burst along the stick, or straight ahead when standing still.
                Vector2 d = len > 0.01f ? input / len : new Vector2(Mathf.Sin(Yaw), Mathf.Cos(Yaw));
                velocity = new Vector3(d.x * DashSpeed, 0f, d.y * DashSpeed);
                dashT = DashTime;
                dashCd = DashCooldown;
            }
            if (dashT > 0f)
            {
                dashT -= dt;
            }
            else if (len > 0.01f)
            {
                Vector2 d = input / len;
                velocity.x += d.x * Accel * dt;
                velocity.z += d.y * Accel * dt;
                float sp = Speed;
                if (sp > max)
                {
                    velocity.x *= max / sp;
                    velocity.z *= max / sp;
                }
            }
            else
            {
                float k = Mathf.Exp(-Friction * dt);
                velocity.x *= k;
                velocity.z *= k;
            }

            fall = controller.isGrounded ? -1f : fall - Gravity * dt;
            Vector3 before = transform.position;
            controller.Move(new Vector3(velocity.x, fall, velocity.z) * dt);
            // Lose the velocity that went into walls so we slide instead of sticking.
            Vector3 moved = (transform.position - before) / dt;
            velocity.x = moved.x;
            velocity.z = moved.z;

            if (Speed > 0.3f)
            {
                float target = Mathf.Atan2(velocity.x, velocity.z);
                Yaw = Mathf.LerpAngle(Yaw * Mathf.Rad2Deg, target * Mathf.Rad2Deg, 1f - Mathf.Exp(-14f * dt)) * Mathf.Deg2Rad;
            }
            transform.rotation = Quaternion.Euler(0f, Yaw * Mathf.Rad2Deg, 0f);
        }

        /// <summary>Move instantly (spawns, respawns).</summary>
        public void Teleport(Vector3 position, float yaw)
        {
            controller.enabled = false;
            transform.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw * Mathf.Rad2Deg, 0f));
            controller.enabled = true;
            Yaw = yaw;
            velocity = Vector3.zero;
            fall = 0f;
        }
    }
}
