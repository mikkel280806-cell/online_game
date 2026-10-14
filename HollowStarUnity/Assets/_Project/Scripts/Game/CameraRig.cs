using UnityEngine;

namespace HollowStar.Game
{
    /// <summary>
    /// Third-person 3/4 camera that orbits the player: drag / two-finger swipe / Q-E / right stick
    /// to turn, scroll / pinch / right stick to zoom. Keeps above the ground and pulls in when
    /// scenery blocks the view. Ported from the web version's CameraRig.
    /// </summary>
    public sealed class CameraRig : MonoBehaviour
    {
        private const float MinPitch = 0.05f;
        private const float MaxPitch = 1.35f;
        private const float MinDist = 4f;
        private const float MaxDist = 45f;
        /// <summary>Keep this far in front of whatever blocks the view (m).</summary>
        private const float Clearance = 0.4f;

        public Transform Target;
        /// <summary>Layers the camera must stay in front of (scenery, not players).</summary>
        public LayerMask Obstacles = ~0;

        // Yaw 0 = behind the player looking north (-Z).
        [SerializeField] private float goalYaw;
        [SerializeField] private float goalPitch = 0.5f;
        [SerializeField] private float goalDistance = 13f;
        private float yaw, pitch = 0.5f, distance = 13f;
        private float clipDistance = float.PositiveInfinity;
        private Vector3 focus;
        private bool hasFocus;
        private PlayerControls controls;

        /// <summary>Camera heading, for camera-relative movement. 0 = looking north (-Z).</summary>
        public float ViewYaw => yaw;

        public void Bind(PlayerControls c) => controls = c;

        private static float Damp(float current, float target, float lambda, float dt) =>
            Mathf.Lerp(current, target, 1f - Mathf.Exp(-lambda * dt));

        /// <summary>Jump straight to following the target without smoothing.</summary>
        public void SnapTo(Vector3 target)
        {
            focus = target;
            hasFocus = true;
            yaw = goalYaw;
            pitch = goalPitch;
            distance = goalDistance;
            Apply(0f);
        }

        public void SetView(float newYaw, float newPitch, float newDistance)
        {
            goalYaw = yaw = newYaw;
            goalPitch = pitch = Mathf.Clamp(newPitch, MinPitch, MaxPitch);
            goalDistance = distance = Mathf.Clamp(newDistance, MinDist, MaxDist);
        }

        private void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (controls != null && !PlayerControls.Blocked) ReadInput(dt);
            yaw = Mathf.LerpAngle(yaw * Mathf.Rad2Deg, goalYaw * Mathf.Rad2Deg, 1f - Mathf.Exp(-12f * dt)) * Mathf.Deg2Rad;
            pitch = Damp(pitch, goalPitch, 12f, dt);
            distance = Damp(distance, goalDistance, 10f, dt);
            if (Target != null)
            {
                Vector3 t = Target.position;
                if (!hasFocus) focus = t;
                hasFocus = true;
                focus.x = Damp(focus.x, t.x, 9f, dt);
                focus.y = Damp(focus.y, t.y, 6f, dt);
                focus.z = Damp(focus.z, t.z, 9f, dt);
            }
            Apply(dt);
        }

        private void ReadInput(float dt)
        {
            goalYaw += controls.Turn.ReadValue<float>() * 1.8f * dt;
            if (controls.LookHeld.IsPressed())
            {
                Vector2 d = controls.Look.ReadValue<Vector2>();
                Rotate(d.x * 0.0055f, -d.y * 0.0045f);
            }
            Vector2 scroll = controls.Scroll.ReadValue<Vector2>();
            // Trackpads report small deltas; a mouse wheel reports about 120 per notch on macOS.
            if (Mathf.Abs(scroll.x) > Mathf.Abs(scroll.y)) Rotate(scroll.x * 0.004f, 0f);
            else if (scroll.y != 0f) Zoom(Mathf.Exp(-scroll.y * 0.0015f));
            float pad = controls.GamepadZoom.ReadValue<float>();
            if (Mathf.Abs(pad) > 0.15f) Zoom(Mathf.Exp(-pad * 1.5f * dt));
        }

        private void Rotate(float dYaw, float dPitch)
        {
            goalYaw += dYaw;
            goalPitch = Mathf.Clamp(goalPitch + dPitch, MinPitch, MaxPitch);
        }

        private void Zoom(float factor) => goalDistance = Mathf.Clamp(goalDistance * factor, MinDist, MaxDist);

        private void Apply(float dt)
        {
            float cp = Mathf.Cos(pitch);
            var c = new Vector3(
                focus.x + Mathf.Sin(yaw) * cp * distance,
                focus.y + Mathf.Sin(pitch) * distance + 1.2f,
                focus.z + Mathf.Cos(yaw) * cp * distance);
            c.y = Mathf.Max(c.y, VigilWorld.GroundHeight(c.x, c.z) + 1.2f);
            var look = new Vector3(focus.x, focus.y + 1.3f, focus.z);
            c = AvoidObstacles(look, c, dt);
            transform.SetPositionAndRotation(c, Quaternion.LookRotation(look - c, Vector3.up));
        }

        /// <summary>Pull the camera in along the view line when a wall, hull or crate is in the way.</summary>
        private Vector3 AvoidObstacles(Vector3 look, Vector3 c, float dt)
        {
            Vector3 dir = c - look;
            float full = dir.magnitude;
            if (full < 1e-3f) return c;
            dir /= full;
            float allowed = Physics.SphereCast(look, 0.2f, dir, out RaycastHit hit, full + Clearance, Obstacles, QueryTriggerInteraction.Ignore)
                ? Mathf.Max(0.6f, hit.distance - Clearance)
                : full;
            // Snap in at once (never show the inside of a wall); ease back out when it clears.
            clipDistance = allowed < clipDistance || dt == 0f ? allowed : Damp(clipDistance, allowed, 3f, dt);
            return clipDistance < full ? look + dir * clipDistance : c;
        }
    }
}
