using UnityEngine;
using UnityEngine.InputSystem;

namespace HollowStar.Game
{
    /// <summary>
    /// Keyboard, trackpad and gamepad bindings, built in code so there is no asset to keep in sync.
    /// Layout (spec section 5): WASD/arrows move, Shift sprints, Space dashes, F gathers or interacts (hold),
    /// V scans (hold), R uses the selected item, 1-5 pick a hotbar slot (the d-pad cycles on a gamepad),
    /// Q/E or drag turns the camera, scroll zooms. Tab and Esc belong to the PDA (<see cref="UI.PdaUI"/>).
    /// </summary>
    public sealed class PlayerControls : System.IDisposable
    {
        public readonly InputAction Move;
        public readonly InputAction Sprint;
        public readonly InputAction Dash;
        /// <summary>F (hold) or gamepad X: gather what is in front, or use a station.</summary>
        public readonly InputAction Gather;
        /// <summary>V (hold) or gamepad RB: scan with the scanner.</summary>
        public readonly InputAction Scan;
        /// <summary>R or gamepad LB: use the selected hotbar item.</summary>
        public readonly InputAction Use;
        /// <summary>Keys 1-5, one action each (index = hotbar slot).</summary>
        public readonly InputAction[] Hotbar = new InputAction[5];
        /// <summary>Gamepad d-pad right / left: next and previous hotbar slot.</summary>
        public readonly InputAction HotbarNext;
        public readonly InputAction HotbarPrev;
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

            Gather = map.AddAction("Gather", InputActionType.Button);
            Gather.AddBinding("<Keyboard>/f");
            Gather.AddBinding("<Gamepad>/buttonWest");

            Scan = map.AddAction("Scan", InputActionType.Button);
            Scan.AddBinding("<Keyboard>/v");
            Scan.AddBinding("<Gamepad>/rightShoulder");

            Use = map.AddAction("Use", InputActionType.Button);
            Use.AddBinding("<Keyboard>/r");
            Use.AddBinding("<Gamepad>/leftShoulder");

            string[] digits = { "1", "2", "3", "4", "5" };
            for (int i = 0; i < Hotbar.Length; i++)
            {
                Hotbar[i] = map.AddAction("Hotbar" + digits[i], InputActionType.Button);
                Hotbar[i].AddBinding("<Keyboard>/" + digits[i]);
            }
            HotbarNext = map.AddAction("HotbarNext", InputActionType.Button);
            HotbarNext.AddBinding("<Gamepad>/dpad/right");
            HotbarPrev = map.AddAction("HotbarPrev", InputActionType.Button);
            HotbarPrev.AddBinding("<Gamepad>/dpad/left");

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
