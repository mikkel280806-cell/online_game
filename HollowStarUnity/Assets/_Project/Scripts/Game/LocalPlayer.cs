using HollowStar.Game.Net;
using UnityEngine;

namespace HollowStar.Game
{
    /// <summary>
    /// Drives a PlayerMotor from this machine's keyboard, trackpad or gamepad, relative to the
    /// camera, and points the camera rig at it. In co-op only the owner's copy has this enabled.
    /// </summary>
    [RequireComponent(typeof(PlayerMotor))]
    public sealed class LocalPlayer : MonoBehaviour
    {
        public CameraRig Rig;

        private PlayerMotor motor;
        private PlayerControls controls;

        private void Awake() => motor = GetComponent<PlayerMotor>();

        private void OnEnable()
        {
            controls = new PlayerControls();
            if (Rig == null) Rig = FindAnyObjectByType<CameraRig>();
            if (Rig != null)
            {
                Rig.Bind(controls);
                Rig.Target = transform;
                Rig.SnapTo(transform.position);
            }
        }

        private void OnDisable()
        {
            // The rig must not keep reading actions that are about to be disposed.
            if (Rig != null && Rig.Target == transform)
            {
                Rig.Bind(null);
                Rig.Target = null;
            }
            controls?.Dispose();
            controls = null;
        }

        /// <summary>Test mode (-hs-autowalk): a slow circle about 9 m across, at half walking speed.</summary>
        private static Vector2 AutoWalkAxis()
        {
            float a = Time.time * 0.6f;
            return new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * 0.5f;
        }

        private void Update()
        {
            bool blocked = PlayerControls.Blocked;
            Vector2 a = blocked ? Vector2.zero : LaunchArgs.AutoWalk ? AutoWalkAxis() : controls.MoveAxis;
            Vector3 fwd = Vector3.forward, right = Vector3.right;
            if (Rig != null)
            {
                fwd = Rig.transform.forward;
                fwd.y = 0f;
                fwd = fwd.sqrMagnitude > 1e-6f ? fwd.normalized : Vector3.forward;
                right = Vector3.Cross(Vector3.up, fwd);
            }
            Vector3 world = right * a.x + fwd * a.y;
            motor.Step(new PlayerIntent
            {
                Move = new Vector2(world.x, world.z),
                Sprint = !blocked && controls.Sprint.IsPressed(),
                Dash = !blocked && controls.Dash.WasPressedThisFrame(),
            }, Time.deltaTime);
        }
    }
}
