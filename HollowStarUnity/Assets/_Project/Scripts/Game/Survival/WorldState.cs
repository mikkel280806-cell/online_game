using System;
using System.Collections.Generic;
using HollowStar.Core.Survival;
using HollowStar.Game.Net;
using Unity.Netcode;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>One depleted node: its index and the server time it comes back.</summary>
    public struct Depletion : INetworkSerializable, IEquatable<Depletion>
    {
        public int Index;
        public double RespawnAt;

        public void NetworkSerialize<T>(BufferSerializer<T> serializer) where T : IReaderWriter
        {
            serializer.SerializeValue(ref Index);
            serializer.SerializeValue(ref RespawnAt);
        }

        public bool Equals(Depletion other) => Index == other.Index && RespawnAt.Equals(other.RespawnAt);
    }

    /// <summary>
    /// The shared state of the world, one NetworkObject spawned by the host: which resource nodes are depleted and the
    /// game clock. Solo play runs through the same code (a host on loopback). Gathering is server-authoritative: the
    /// gatherer asks, the server checks the node and the distance, depletes the node for 5 to 10 minutes and tells only
    /// the requester how many items to add.
    /// </summary>
    public sealed class WorldState : NetworkBehaviour
    {
        /// <summary>How far (m, flat) a gatherer may be from a node when the server hears the request; a little over the 3 m of the prompt, for lag.</summary>
        public const double MaxGatherDistance = 7.5;
        /// <summary>The clock is sent this often; guests only step to it when they have drifted further than <see cref="MaxDriftSeconds"/>.</summary>
        private const float ClockSendInterval = 1f;
        private const float MaxDriftSeconds = 1.5f;

        public static WorldState Instance { get; private set; }

        /// <summary>A gather the server decided on: node index and how many items (0 = refused). Raised on the requester's machine only.</summary>
        public static event Action<int, int> GatherResolved;

        /// <summary>The shared clock; the host's value wins.</summary>
        public GameClock Clock { get; } = new GameClock();

        private NetworkList<Depletion> depleted;
        private readonly NetworkVariable<double> days = new NetworkVariable<double>(GameClock.StartDays);
        private ResourceNode[] nodes = Array.Empty<ResourceNode>();
        private System.Random random;
        private float clockSendTimer;
        private float expireTimer;

        public int NodeCount => nodes.Length;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Instance = null;
            GatherResolved = null;
        }

        private void Awake() => depleted = new NetworkList<Depletion>();

        public override void OnNetworkSpawn()
        {
            Instance = this;
            CollectNodes();
            depleted.OnListChanged += OnDepletedChanged;
            if (IsServer)
            {
                random = new System.Random(unchecked((int)ResourceScatter.WorldSeed) ^ Environment.TickCount);
                days.Value = Clock.Days;
            }
            else
            {
                Clock.SyncTo(days.Value);
                days.OnValueChanged += OnDaysChanged;
            }
            ApplyVisibility();
            Debug.Log($"[HollowStar] World ready: {nodes.Length} resource nodes, day {Clock.Days:F3}.");
        }

        public override void OnNetworkDespawn()
        {
            depleted.OnListChanged -= OnDepletedChanged;
            days.OnValueChanged -= OnDaysChanged;
            if (Instance == this) Instance = null;
            foreach (var n in nodes)
                if (n != null) n.SetDepleted(false);
        }

        private void CollectNodes()
        {
            var found = ResourceNode.Registry.ToArray();
            Array.Sort(found, (a, b) => a.Index.CompareTo(b.Index));
            nodes = found;
        }

        private void Update()
        {
            if (!IsSpawned) return;
            Clock.Advance(Time.deltaTime);
            if (!IsServer) return;

            clockSendTimer -= Time.deltaTime;
            if (clockSendTimer <= 0f)
            {
                clockSendTimer = ClockSendInterval;
                days.Value = Clock.Days;
            }

            expireTimer -= Time.deltaTime;
            if (expireTimer <= 0f)
            {
                expireTimer = 0.5f;
                ExpireDue(NetworkManager.ServerTime.Time);
            }
        }

        private void OnDaysChanged(double previous, double current)
        {
            // Keep stepping locally in between; only jump when we have really drifted.
            double driftSeconds = Math.Abs(current - Clock.Days) * GameClock.DayLengthSeconds;
            if (driftSeconds > MaxDriftSeconds) Clock.SyncTo(current);
        }

        private void ExpireDue(double now)
        {
            for (int i = depleted.Count - 1; i >= 0; i--)
                if (depleted[i].RespawnAt <= now) depleted.RemoveAt(i);
        }

        /// <summary>Test hook: bring every depleted node back now (server only).</summary>
        public void ServerExpireAll()
        {
            if (IsServer) ExpireDue(double.MaxValue);
        }

        private void OnDepletedChanged(NetworkListEvent<Depletion> change) => ApplyVisibility();

        private readonly HashSet<int> hidden = new HashSet<int>();

        private void ApplyVisibility()
        {
            hidden.Clear();
            for (int i = 0; i < depleted.Count; i++) hidden.Add(depleted[i].Index);
            for (int i = 0; i < nodes.Length; i++)
            {
                var node = nodes[i];
                if (node == null) continue;
                bool gone = hidden.Contains(node.Index);
                // The unattended two-copy test reads these lines on both machines.
                if (gone != node.Depleted && LaunchArgs.Automated)
                    Debug.Log($"[HollowStar] world: node {node.Index} ({node.Def.Name}) {(gone ? "depleted" : "back")}");
                node.SetDepleted(gone);
            }
        }

        public bool IsDepleted(int index)
        {
            for (int i = 0; i < depleted.Count; i++)
                if (depleted[i].Index == index) return true;
            return false;
        }

        public int DepletedCount => depleted.Count;

        /// <summary>Server only: the time the node comes back, or -1 if it is standing.</summary>
        public double RespawnTimeOf(int index)
        {
            for (int i = 0; i < depleted.Count; i++)
                if (depleted[i].Index == index) return depleted[i].RespawnAt;
            return -1.0;
        }

        // ---- Gathering ----

        /// <summary>Ask the server to take from a node. The answer arrives through <see cref="GatherResolved"/>.</summary>
        public void RequestGather(int nodeIndex) => GatherServerRpc(nodeIndex);

        [Rpc(SendTo.Server, InvokePermission = RpcInvokePermission.Everyone)]
        private void GatherServerRpc(int nodeIndex, RpcParams rpcParams = default)
        {
            ulong sender = rpcParams.Receive.SenderClientId;
            int count = 0;
            if (TryTake(sender, nodeIndex, out int yield)) count = yield;
            GatherResultRpc(nodeIndex, count, RpcTarget.Single(sender, RpcTargetUse.Temp));
        }

        [Rpc(SendTo.SpecifiedInParams)]
        private void GatherResultRpc(int nodeIndex, int count, RpcParams rpcParams = default) => GatherResolved?.Invoke(nodeIndex, count);

        /// <summary>The server's checks: a real node, standing, and the sender close enough. Depletes it on success.</summary>
        private bool TryTake(ulong sender, int nodeIndex, out int yield)
        {
            yield = 0;
            ResourceNode node = nodeIndex >= 0 && nodeIndex < nodes.Length ? nodes[nodeIndex] : null;
            if (node == null || node.Index != nodeIndex || IsDepleted(nodeIndex)) return false;
            if (!NetworkManager.ConnectedClients.TryGetValue(sender, out var client) || client.PlayerObject == null) return false;

            Vector3 a = client.PlayerObject.transform.position, b = node.transform.position;
            double flat = Math.Sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
            if (!GatherRules.InReach(flat, MaxGatherDistance)) return false;

            var def = node.Def;
            yield = GatherRules.RollYield(def, random.NextDouble());
            double back = NetworkManager.ServerTime.Time + GatherRules.RollRespawn(def, random.NextDouble());
            depleted.Add(new Depletion { Index = nodeIndex, RespawnAt = back });
            Debug.Log($"[HollowStar] Node {nodeIndex} ({def.Name}) gathered by client {sender}: +{yield} {def.ItemId}; back in {back - NetworkManager.ServerTime.Time:F0} s.");
            return true;
        }
    }
}
