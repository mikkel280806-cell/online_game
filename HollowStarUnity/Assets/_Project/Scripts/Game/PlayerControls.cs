using UnityEngine;
using UnityEngine.InputSystem;

namespace HollowStar.Game
{
    /// <summary>
    /// Keyboard, trackpad and gamepad bindings, built in code so there is no asset to keep in sync.
    /// Layout matches the web version: WASD/arrows move, Shift sprints, Space dashes, F interacts,
    /// R attacks, C uses the role skill, Q/E or drag turns the camera, scroll zooms.
    /// </summary>
    public sealed class PlayerControls : System.IDisposable
    {
        public readonly InputAction Move;
        public readonly InputAction Sprint;
        public readonly InputAction Dash;
        public readonly InputAction Interact;
        public readonly InputAction Attack;
        public readonly InputAction Skill;
        /// <summary>Q/E or the right stick's x: turn the camera.</summary>
        public readonly InputAction Turn;
        /// <summary>Mouse/trackpad drag while the button is held: free look (pixels).</summary>
        public readonly InputAction Look;
        public readonly InputAction LookHeld;
        /// <summary>Scroll wheel or two-finger swipe (y zooms, x turns).</summary>
        public readonly InputAction Scroll;
        public readonly InputAction GamepadZoom;

        /// <summary>
        /// Set while a UI text field has keyboard focus, so typing a room code doesn't walk the player
        /// or turn the camera.
        /// </summary>
        public static bool Blocked;

        // The project enters play mode without a domain reload, so statics must be cleared by hand.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => Blocked = false;

        private readonly InputActionMap map = new InputActionMap("Player");

        public PlayerControls()
        {
            Move = map.AddAction("Move", InputActionType.Value);
            Move.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/w").With("Down", "<Keyboard>/s")
                .With("Left", "<Keyboard>/a").With("Right", "<Keyboard>/d");
            Move.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/upArrow").With("Down", "<Keyboard>/downArrow")
                .With("Left", "<Keyboard>/leftArrow").With("Right", "<Keyboard>/rightArrow");
            Move.AddBinding("<Gamepad>/leftStick");

            Sprint = map.AddAction("Sprint", InputActionType.Button);
            Sprint.AddBinding("<Keyboard>/shift");
            Sprint.AddBinding("<Gamepad>/leftStickPress");

            Dash = map.AddAction("Dash", InputActionType.Button);
            Dash.AddBinding("<Keyboard>/space");
            Dash.AddBinding("<Gamepad>/buttonSouth");

            Interact = map.AddAction("Interact", InputActionType.Button);
            Interact.AddBinding("<Keyboard>/f");
            Interact.AddBinding("<Gamepad>/buttonWest");

            Attack = map.AddAction("Attack", InputActionType.Button);
            Attack.AddBinding("<Keyboard>/r");
            Attack.AddBinding("<Gamepad>/rightTrigger");

            Skill = map.AddAction("Skill", InputActionType.Button);
            Skill.AddBinding("<Keyboard>/c");
            Skill.AddBinding("<Gamepad>/leftTrigger");

            Turn = map.AddAction("Turn", InputActionType.Value);
            // Positive turns the view the same way as dragging right.
            Turn.AddCompositeBinding("1DAxis").With("Negative", "<Keyboard>/q").With("Positive", "<Keyboard>/e");
            Turn.AddBinding("<Gamepad>/rightStick/x");

            Look = map.AddAction("Look", InputActionType.Value);
            Look.AddBinding("<Pointer>/delta");
            LookHeld = map.AddAction("LookHeld", InputActionType.Button);
            LookHeld.AddBinding("<Mouse>/leftButton");
            LookHeld.AddBinding("<Mouse>/rightButton");

            Scroll = map.AddAction("Scroll", InputActionType.Value);
            Scroll.AddBinding("<Mouse>/scroll");

            GamepadZoom = map.AddAction("GamepadZoom", InputActionType.Value);
            GamepadZoom.AddBinding("<Gamepad>/rightStick/y");

            map.Enable();
        }

        public Vector2 MoveAxis => Vector2.ClampMagnitude(Move.ReadValue<Vector2>(), 1f);

        public void Dispose()
        {
            map.Disable();
            map.Dispose();
        }
    }
}
