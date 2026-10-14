using HollowStar.Core;
using Unity.Netcode;
using UnityEngine;

namespace HollowStar.Game.Net
{
    /// <summary>
    /// A crew member in a session. Like the web version, each machine simulates its own character
    /// and streams the result (owner-authoritative NetworkTransform on the same object); the copy of
    /// the other player only follows the network and animates from how it moves. Both players are
    /// equal; the server only hands out an identity for the suit accent (host orange, guest teal).
    /// </summary>
    [RequireComponent(typeof(PlayerMotor), typeof(LocalPlayer), typeof(CharacterController))]
    public sealed class NetPlayer : NetworkBehaviour
    {
        /// <summary>The character this machine controls, while spawned.</summary>
        public static NetPlayer Local { get; private set; }
        /// <summary>The other player's character, while they are connected.</summary>
        public static NetPlayer Partner { get; private set; }

        private readonly NetworkVariable<RoleId> role = new NetworkVariable<RoleId>();
        private PlayerMotor motor;

        public RoleId Role => role.Value;

        // The project enters play mode without a domain reload, so statics must be cleared by hand.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Local = null;
            Partner = null;
        }

        private void Awake() => motor = GetComponent<PlayerMotor>();

        public override void OnNetworkSpawn()
        {
            if (IsServer) role.Value = OwnerClientId == NetworkManager.ServerClientId ? RoleId.Vanguard : RoleId.Tether;
            role.OnValueChanged += OnRoleChanged;
            ApplyRole(role.Value);

            // Only the owner simulates: the other copy must not collide or read this machine's input.
            motor.Simulated = IsOwner;
            GetComponent<CharacterController>().enabled = IsOwner;
            if (IsOwner)
            {
                Local = this;
                // The server chose the spawn point (connection approval); start from rest there.
                motor.Teleport(transform.position, transform.eulerAngles.y * Mathf.Deg2Rad);
                GetComponent<LocalPlayer>().enabled = true;
            }
            else
            {
                Partner = this;
            }
        }

        public override void OnNetworkDespawn()
        {
            role.OnValueChanged -= OnRoleChanged;
            GetComponent<LocalPlayer>().enabled = false;
            if (Local == this) Local = null;
            if (Partner == this) Partner = null;
        }

        private void OnRoleChanged(RoleId previous, RoleId current) => ApplyRole(current);

        private void ApplyRole(RoleId r)
        {
            motor.Role = r;
            name = $"Player_{(r == RoleId.Vanguard ? "Host" : "Guest")}{(IsOwner ? "" : " (remote)")}";
        }
    }
}
