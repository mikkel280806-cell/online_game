using System.Collections.Generic;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>
    /// The fabricator in the Wren bay. F opens the PDA on the Fabricator tab; standing within <see cref="CraftRange"/>
    /// of it lets recipes run. (The galley is the same place for U3.)
    /// </summary>
    public sealed class FabricatorConsole : Interactable
    {
        /// <summary>Crafting works this close (m), so you can step back from the screen and keep the bar running.</summary>
        public const float CraftRange = 4.5f;

        private static readonly List<FabricatorConsole> consoles = new List<FabricatorConsole>();

        /// <summary>The point to aim at and measure from (the screen), if different from the root.</summary>
        public Transform ScreenPoint;

        public override string Title => "Fabricator";
        public override bool HasAction => true;
        public override Vector3 FocusPoint => (ScreenPoint != null ? ScreenPoint : transform).position;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => consoles.Clear();

        protected override void OnEnable()
        {
            base.OnEnable();
            consoles.Add(this);
        }

        protected override void OnDisable()
        {
            base.OnDisable();
            consoles.Remove(this);
        }

        public override InteractPrompt Prompt(Survivor who) => new InteractPrompt { Text = "Use Fabricator", Allowed = true };

        public override void Activate(Survivor who) => SurvivorHub.OpenPda(PdaTab.Fabricator);

        /// <summary>True if a fabricator is within crafting range of a world position.</summary>
        public static bool InRange(Vector3 world)
        {
            for (int i = 0; i < consoles.Count; i++)
                if (Vector3.Distance(world, consoles[i].FocusPoint) <= CraftRange) return true;
            return false;
        }
    }
}
