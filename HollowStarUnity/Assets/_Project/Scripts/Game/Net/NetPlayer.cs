using HollowStar.Core;
using HollowStar.Game.Survival;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;

namespace HollowStar.Game.Net
{
    /// <summary>
    /// A crew member in a session. Like the web version, each machine simulates its own character
    /// and streams the result (owner-authoritative NetworkTransform on the same object); the copy of
    /// the other player only follows the network and animates from how it moves. Both players are
    /// equal; the server only hands out an identity for the suit accent (host orange, guest teal).
    /// The owner also publishes its health, oxygen and name (owner-write variables) so the partner's HUD can show them.
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

        // What the partner's HUD shows. The owner writes them; everyone reads. Quantised so they only change (and send) a
        // couple of times a second.
        private const NetworkVariableWritePermission OwnerWrites = NetworkVariableWritePermission.Owner;
        private const NetworkVariableReadPermission EveryoneReads = NetworkVariableReadPermission.Everyone;
        private readonly NetworkVariable<float> health = new NetworkVariable<float>(100f, EveryoneReads, OwnerWrites);
        private readonly NetworkVariable<float> oxygen = new NetworkVariable<float>(100f, EveryoneReads, OwnerWrites);
        private readonly NetworkVariable<float> oxygenCapacity = new NetworkVariable<float>(100f, EveryoneReads, OwnerWrites);
        private readonly NetworkVariable<bool> isDead = new NetworkVariable<bool>(false, EveryoneReads, OwnerWrites);
        private readonly NetworkVariable<FixedString32Bytes> displayName = new NetworkVariable<FixedString32Bytes>(default, EveryoneReads, OwnerWrites);

        public RoleId Role => role.Value;
        public float Health => health.Value;
        public float Oxygen => oxygen.Value;
        public float OxygenCapacity => oxygenCapacity.Value;
        public bool IsDead => isDead.Value;
        /// <summary>The name the HUD shows: the sign-in profile when one was given (test copies), else the suit role.</summary>
        public string DisplayName => displayName.Value.IsEmpty ? Roles.Name(Role) : displayName.Value.ToString();

        /// <summary>Owner only: publish this player's vitals for the partner's HUD.</summary>
        public void PublishVitals(float healthValue, float oxygenValue, float capacityValue, bool dead)
        {
            if (!IsSpawned || !IsOwner) return;
            Set(health, Quantise(healthValue));
            Set(oxygen, Quantise(oxygenValue));
            Set(oxygenCapacity, Quantise(capacityValue));
            if (isDead.Value != dead) isDead.Value = dead;
        }

        private static float Quantise(float v) => Mathf.Round(v * 2f) * 0.5f;

        private static void Set(NetworkVariable<float> v, float value)
        {
            if (!Mathf.Approximately(v.Value, value)) v.Value = value;
        }

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
                // The survival state lives with the local character; it reads this machine's input through LocalPlayer.
                var survivor = GetComponent<Survivor>();
                if (survivor != null) survivor.enabled = true;
                if (!string.IsNullOrEmpty(LaunchArgs.Profile)) displayName.Value = new FixedString32Bytes(LaunchArgs.Profile.Length > 24 ? LaunchArgs.Profile.Substring(0, 24) : LaunchArgs.Profile);
            }
            else
            {
                Partner = this;
            }
        }

        public override void OnNetworkDespawn()
        {
            role.OnValueChanged -= OnRoleChanged;
            var survivor = GetComponent<Survivor>();
            if (survivor != null) survivor.enabled = false;
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
