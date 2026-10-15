using HollowStar.Core.Survival;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>
    /// One gatherable thing in the world. A plain component built into the scene (the scatter is deterministic, so
    /// both machines have the same nodes at the same indices); <see cref="WorldState"/> says which are depleted.
    /// The stand-in model lives under <see cref="Visual"/> and hides while the node is depleted.
    /// </summary>
    public sealed class ResourceNode : Interactable
    {
        public static readonly System.Collections.Generic.List<ResourceNode> Registry = new System.Collections.Generic.List<ResourceNode>();

        /// <summary>Position in the scatter's list; identical on every machine.</summary>
        public int Index;
        public NodeKind Kind;
        /// <summary>Everything that is hidden while depleted (model and collider).</summary>
        public GameObject Visual;

        public bool Depleted { get; private set; }

        public NodeKindDef Def => NodeKinds.Get(Kind);

        public override bool Present => !Depleted;
        public override bool HasAction => true;
        public override float HoldSeconds => NodeKinds.HoldSeconds;
        public override string Title => Def.Name;
        public override Vector3 FocusPoint => transform.position + Vector3.up * 0.5f;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetRegistry() => Registry.Clear();

        protected override void OnEnable()
        {
            base.OnEnable();
            Registry.Add(this);
        }

        protected override void OnDisable()
        {
            base.OnDisable();
            Registry.Remove(this);
        }

        public void SetDepleted(bool depleted)
        {
            if (Depleted == depleted) return;
            Depleted = depleted;
            if (Visual != null) Visual.SetActive(!depleted);
        }

        public override InteractPrompt Prompt(Survivor who)
        {
            var def = Def;
            var p = new InteractPrompt { Text = $"{def.Verb} {def.Name}", Allowed = true };
            if (def.NeedsTool && who.EquippedTool != def.RequiredTool)
            {
                p.Allowed = false;
                string tool = ItemCatalog.Get(def.RequiredTool).Name.ToLowerInvariant();
                p.Detail = who.Inventory.Has(def.RequiredTool) ? who.EquipHint(def.RequiredTool) : $"Requires {tool}";
            }
            else if (who.Inventory.FreeSpaceFor(def.ItemId) < def.MaxYield)
            {
                p.Allowed = false;
                p.Detail = "Pack full";
            }
            return p;
        }

        public override void Activate(Survivor who) => who.RequestGather(this);
    }
}
