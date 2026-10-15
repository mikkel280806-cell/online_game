using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading.Tasks;
using HollowStar.Core;
using HollowStar.Game.Survival;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using Unity.Services.Core;
using Unity.Services.Multiplayer;
using UnityEngine;

namespace HollowStar.Game.Net
{
    public enum SessionPhase
    {
        /// <summary>In the menu, nothing running.</summary>
        Menu,
        /// <summary>Signing in, creating, joining or leaving a room.</summary>
        Connecting,
        /// <summary>Hosting a room that has no partner in it (yet, or any more). The host can already play.</summary>
        Waiting,
        /// <summary>Both players are in, or playing solo.</summary>
        Playing,
        /// <summary>Back in the menu after something went wrong; <see cref="SessionFlow.Error"/> says what.</summary>
        Failed,
    }

    /// <summary>
    /// The room lifecycle: create a room, join one by code, play solo, leave. The two players are
    /// equal; <see cref="LocalRole"/> only tells host (orange suit) from guest (teal). Rooms are
    /// Multiplayer Services sessions over Relay, so two Macs on different home networks connect
    /// without port forwarding. Solo runs the same netcode as a host on loopback, so there is one
    /// code path for the game. The lobby and HUD only read the state exposed here.
    /// </summary>
    public sealed class SessionFlow : MonoBehaviour
    {
        public const int MaxPlayers = 2;
        private const float PartnerLogInterval = 2f;
        private const float RttInterval = 0.5f;

        public NetworkManager Network;

        private ISession session;
        /// <summary>Host only: which session player each connected client is, from their connection payload.</summary>
        private readonly Dictionary<ulong, string> playerIds = new Dictionary<ulong, string>();
        private bool leaving;
        private string dropReason;
        private float partnerLogTimer;
        private float rttTimer;
        private float inGameTime;

        public SessionPhase Phase { get; private set; } = SessionPhase.Menu;
        /// <summary>The code to share, while hosting or in a room; null otherwise.</summary>
        public string JoinCode { get; private set; }
        public bool IsSolo { get; private set; }
        public bool IsHost { get; private set; }
        public RoleId LocalRole => NetPlayer.Local != null ? NetPlayer.Local.Role : IsHost ? RoleId.Vanguard : RoleId.Tether;
        public bool PartnerConnected => NetPlayer.Partner != null;
        /// <summary>Hosting, and the partner who was here has gone (the room stays open for them).</summary>
        public bool PartnerLeft { get; private set; }
        /// <summary>How the two machines talk: "Relay" or "Local" (solo); empty in the menu.</summary>
        public string TransportLabel { get; private set; } = "";
        /// <summary>Round trip to the other player in milliseconds; 0 when there is nobody to measure.</summary>
        public int RttMs { get; private set; }
        /// <summary>Menu line while connecting or after leaving ("The host left the room.").</summary>
        public string Status { get; private set; } = "";
        /// <summary>What went wrong, in words a player understands; empty when nothing did.</summary>
        public string Error { get; private set; } = "";
        /// <summary>Short in-game message ("Partner disconnected") and when it was raised (unscaled time).</summary>
        public string Notice { get; private set; } = "";
        public float NoticeTime { get; private set; } = float.NegativeInfinity;

        private void Start()
        {
            if (Network == null) Network = NetworkManager.Singleton;
            Network.ConnectionApprovalCallback = Approve;
            Network.OnClientConnectedCallback += OnClientConnected;
            Network.OnClientDisconnectCallback += OnClientDisconnected;
            Network.OnClientStopped += OnNetworkStopped;

            switch (LaunchArgs.Auto)
            {
                case LaunchArgs.AutoMode.Host:
                    CreateRoom();
                    break;
                case LaunchArgs.AutoMode.Join:
                    JoinRoom(LaunchArgs.AutoJoinCode);
                    break;
                case LaunchArgs.AutoMode.Solo:
                    PlaySolo();
                    break;
            }
        }

        private void OnDestroy()
        {
            if (Network == null) return;
            Network.OnClientConnectedCallback -= OnClientConnected;
            Network.OnClientDisconnectCallback -= OnClientDisconnected;
            Network.OnClientStopped -= OnNetworkStopped;
        }

        public bool CanStart => Phase == SessionPhase.Menu || Phase == SessionPhase.Failed;
        public bool InGame => Phase == SessionPhase.Waiting || Phase == SessionPhase.Playing;

        /// <summary>Host a new two-player room over Relay; the code appears in <see cref="JoinCode"/>.</summary>
        public async void CreateRoom()
        {
            if (!CanStart) return;
            SetConnecting("Creating room…");
            try
            {
                await WaitForNetworkStopped();
                await ServicesBootstrap.EnsureSignedInAsync();
                var options = new SessionOptions { MaxPlayers = MaxPlayers, IsPrivate = true }.WithRelayNetwork();
                IHostSession created = await MultiplayerService.Instance.CreateSessionAsync(options);
                if (this == null) return;
                Attach(created, host: true);
                Debug.Log($"[HollowStar] JOIN CODE: {JoinCode}");
                SetPhase(PartnerConnected ? SessionPhase.Playing : SessionPhase.Waiting);
            }
            catch (Exception e)
            {
                Fail(e, "Couldn't create a room.");
            }
        }

        /// <summary>Join a partner's room. Codes are upper case; any case is accepted.</summary>
        public async void JoinRoom(string code)
        {
            if (!CanStart) return;
            code = (code ?? "").Trim().ToUpperInvariant();
            if (code.Length == 0)
            {
                Error = "Type the room code your partner sees on their screen.";
                SetPhase(SessionPhase.Failed);
                return;
            }
            SetConnecting($"Joining {code}…");
            try
            {
                await WaitForNetworkStopped();
                await ServicesBootstrap.EnsureSignedInAsync();
                // Tell the host who we are in the session, so it can free our seat if we drop out.
                Network.NetworkConfig.ConnectionData = Encoding.UTF8.GetBytes(ServicesBootstrap.PlayerId);
                ISession joined = await MultiplayerService.Instance.JoinSessionByCodeAsync(code);
                if (this == null) return;
                Attach(joined, host: false);
                Debug.Log($"[HollowStar] Joined room {JoinCode}.");
                SetPhase(SessionPhase.Playing);
            }
            catch (Exception e)
            {
                Fail(e, $"Couldn't join room {code}.", code);
            }
        }

        /// <summary>Play alone: a host on loopback, no Unity Services needed.</summary>
        public async void PlaySolo()
        {
            if (!CanStart) return;
            SetConnecting("Starting…");
            await WaitForNetworkStopped();
            if (this == null) return;
            // Any free loopback port: nobody else can join, and two copies on one Mac don't clash.
            ((UnityTransport)Network.NetworkConfig.NetworkTransport).SetConnectionData(true, "127.0.0.1", 0, "127.0.0.1");
            IsSolo = true;
            IsHost = true;
            TransportLabel = "Local";
            if (!Network.StartHost())
            {
                ResetSession();
                Error = "Couldn't start the game.";
                SetPhase(SessionPhase.Failed);
                return;
            }
            SetPhase(SessionPhase.Playing);
        }

        /// <summary>Back to the menu. A leaving host closes the room, which sends the guest back too.</summary>
        public async void Leave()
        {
            if (!InGame) return;
            leaving = true;
            SetConnecting("Leaving…");
            ISession s = session;
            session = null;
            try
            {
                if (s != null && s.IsHost) await s.AsHost().DeleteAsync();
                else if (s != null) await s.LeaveAsync();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[HollowStar] Leaving the session: {e.Message}");
            }
            if (this == null) return;
            if (Network.IsListening && !Network.ShutdownInProgress) Network.Shutdown();
            await WaitForNetworkStopped();
            if (this == null) return;
            leaving = false;
            ResetSession();
            Status = "";
            SetPhase(SessionPhase.Menu);
        }

        private void Attach(ISession s, bool host)
        {
            session = s;
            IsHost = host;
            IsSolo = false;
            JoinCode = s.Code;
            TransportLabel = "Relay";
            s.Deleted += OnSessionGone;
            s.RemovedFromSession += OnSessionGone;
        }

        /// <summary>The room was closed under us (normally: the host left). Make sure the network follows.</summary>
        private void OnSessionGone()
        {
            if (leaving || !InGame) return;
            dropReason ??= IsHost ? "The room was closed." : "The host left the room.";
            if (Network.IsListening && !Network.ShutdownInProgress) Network.Shutdown();
        }

        /// <summary>The server places each player at a spawn point in the Wren's bay (falling back to the pad if there is no Wren) and keeps the room to two.</summary>
        private void Approve(NetworkManager.ConnectionApprovalRequest request, NetworkManager.ConnectionApprovalResponse response)
        {
            bool host = request.ClientNetworkId == NetworkManager.ServerClientId;
            if (!host && Network.ConnectedClientsIds.Count >= MaxPlayers)
            {
                response.Approved = false;
                response.Reason = "The room is full.";
                return;
            }
            if (!host && request.Payload != null) playerIds[request.ClientNetworkId] = Encoding.UTF8.GetString(request.Payload);
            response.Approved = true;
            response.CreatePlayerObject = true;
            var anchors = WrenAnchors.Current;
            if (anchors != null && anchors.TryGetSessionSpawn(host ? 0 : 1, out Vector3 bay, out Quaternion facing))
            {
                // Inside the bay: a raycast from above would land on the Wren's roof, so the anchor is used as it is.
                response.Position = bay;
                response.Rotation = facing;
                return;
            }
            GroundPoint spawn = Layout.SpawnPoints[host ? 0 : 1];
            response.Position = SpawnPosition(spawn.X, spawn.Z);
            response.Rotation = Quaternion.Euler(0f, 180f, 0f);
        }

        /// <summary>On top of whatever is there (the spawn points are on the landing pad), else on the terrain.</summary>
        private static Vector3 SpawnPosition(float x, float z)
        {
            const int players = 1 << 2; // Ignore Raycast: other characters
            var from = new Vector3(x, VigilWorld.GroundHeight(x, z) + 20f, z);
            float y = Physics.Raycast(from, Vector3.down, out RaycastHit hit, 40f, ~players, QueryTriggerInteraction.Ignore)
                ? hit.point.y
                : VigilWorld.GroundHeight(x, z);
            return new Vector3(x, y + 0.05f, z);
        }

        private void OnClientConnected(ulong clientId)
        {
            if (!Network.IsServer || clientId == Network.LocalClientId) return;
            Debug.Log($"[HollowStar] Partner joined (client {clientId}).");
            PartnerLeft = false;
            ShowNotice("Partner joined");
            if (Phase == SessionPhase.Waiting) SetPhase(SessionPhase.Playing);
        }

        private void OnClientDisconnected(ulong clientId)
        {
            if (Network.IsServer)
            {
                if (clientId == Network.LocalClientId || leaving) return;
                Debug.Log($"[HollowStar] Partner left (client {clientId}).");
                // The room stays open: the partner can come back with the same code.
                FreeSeat(clientId);
                PartnerLeft = true;
                ShowNotice("Partner disconnected");
                if (Phase == SessionPhase.Playing && !IsSolo) SetPhase(SessionPhase.Waiting);
            }
            else
            {
                // A host shutting down sends a reason first; a silent drop means the connection was lost.
                dropReason ??= string.IsNullOrEmpty(Network.DisconnectReason) ? "Lost connection to the host." : "The host left the room.";
            }
        }

        /// <summary>
        /// A guest who quits or crashes stays a member of the session until the service times them out,
        /// and with two seats the room would look full to anyone trying to (re)join. Remove them now.
        /// </summary>
        private async void FreeSeat(ulong clientId)
        {
            if (!playerIds.TryGetValue(clientId, out string playerId)) return;
            playerIds.Remove(clientId);
            ISession s = session;
            if (s == null || !s.IsHost || !s.HasPlayer(playerId)) return;
            try
            {
                await s.AsHost().RemovePlayerAsync(playerId);
                Debug.Log($"[HollowStar] Freed the seat of {playerId}.");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[HollowStar] Couldn't free the partner's seat: {e.Message}");
            }
        }

        private async void OnNetworkStopped(bool wasHost)
        {
            if (leaving || !InGame) return;
            string reason = dropReason ?? (wasHost ? "The game stopped unexpectedly." : "Lost connection to the host.");
            Debug.Log($"[HollowStar] Session ended: {reason}");
            ISession s = session;
            session = null;
            ResetSession();
            Status = reason;
            SetPhase(SessionPhase.Menu);
            // Tidy up the room membership so the next create/join starts clean.
            if (s == null) return;
            try
            {
                await s.LeaveAsync();
            }
            catch (Exception)
            {
                // The room is usually gone already.
            }
        }

        private void ResetSession()
        {
            if (session != null)
            {
                session.Deleted -= OnSessionGone;
                session.RemovedFromSession -= OnSessionGone;
            }
            session = null;
            JoinCode = null;
            IsSolo = false;
            IsHost = false;
            TransportLabel = "";
            RttMs = 0;
            dropReason = null;
            playerIds.Clear();
            PartnerLeft = false;
            Notice = "";
        }

        private void Update()
        {
            if (!InGame)
            {
                inGameTime = 0f;
                return;
            }

            inGameTime += Time.unscaledDeltaTime;
            if (LaunchArgs.AutoLeave > 0f && inGameTime >= LaunchArgs.AutoLeave)
            {
                Debug.Log("[HollowStar] Auto-leave.");
                Leave();
                return;
            }

            rttTimer -= Time.unscaledDeltaTime;
            if (rttTimer <= 0f)
            {
                rttTimer = RttInterval;
                RttMs = MeasureRtt();
            }

            // For the two-copy test scripts: each side reports where it sees the other player.
            partnerLogTimer -= Time.unscaledDeltaTime;
            if (LaunchArgs.Automated && partnerLogTimer <= 0f)
            {
                partnerLogTimer = PartnerLogInterval;
                if (NetPlayer.Partner != null)
                {
                    Vector3 p = NetPlayer.Partner.transform.position;
                    Debug.LogFormat(LogType.Log, LogOption.NoStacktrace, null, "[HollowStar] partner at ({0}, {1})",
                        p.x.ToString("F2", CultureInfo.InvariantCulture), p.z.ToString("F2", CultureInfo.InvariantCulture));
                }
            }
        }

        private int MeasureRtt()
        {
            if (IsSolo || !Network.IsListening) return 0;
            ulong peer;
            if (Network.IsServer)
            {
                if (NetPlayer.Partner == null) return 0;
                peer = NetPlayer.Partner.OwnerClientId;
            }
            else
            {
                peer = NetworkManager.ServerClientId;
            }
            return (int)Network.NetworkConfig.NetworkTransport.GetCurrentRtt(peer);
        }

        private void SetConnecting(string status)
        {
            Error = "";
            Status = status;
            SetPhase(SessionPhase.Connecting);
        }

        private void SetPhase(SessionPhase phase)
        {
            if (phase == Phase) return;
            Phase = phase;
            if (phase != SessionPhase.Connecting && InGame) Status = "";
            Debug.Log($"[HollowStar] Phase: {phase}");
        }

        private void ShowNotice(string text)
        {
            Notice = text;
            NoticeTime = Time.unscaledTime;
        }

        /// <summary>A previous game may still be shutting down; starting another before it finishes fails.</summary>
        private async Task WaitForNetworkStopped()
        {
            while (Network != null && (Network.ShutdownInProgress || Network.IsListening)) await Task.Yield();
        }

        private void Fail(Exception e, string what, string code = null)
        {
            Debug.LogWarning($"[HollowStar] {what} {e.GetType().Name}: {e.Message}");
            if (this == null) return;
            if (Network.IsListening && !Network.ShutdownInProgress) Network.Shutdown();
            ResetSession();
            Status = "";
            Error = Explain(e, what, code);
            SetPhase(SessionPhase.Failed);
        }

        /// <summary>Turn service and network errors into something a player can act on.</summary>
        private static string Explain(Exception e, string what, string code)
        {
            string m = e.Message ?? "";
            bool Has(string s) => m.IndexOf(s, StringComparison.OrdinalIgnoreCase) >= 0;

            if (e is ServicesInitializationException && Has("link"))
                return "Online rooms aren't set up in this build: the project isn't linked to Unity Cloud (Project Settings > Services). Solo still works.";
            if (e is SessionException se)
            {
                if (se.Error == SessionError.SessionNotFound || Has("not found") || Has("join code"))
                    return $"No room with code {code}. Check the code and try again.";
                if (Has("full"))
                    return $"Room {code} is already full.";
                if (se.Error == SessionError.RateLimitExceeded)
                    return "Too many attempts. Wait a few seconds and try again.";
            }
            if (e is RequestFailedException || Has("network") || Has("connect") || Has("timeout") || Has("resolve"))
                return $"{what} Check your internet connection and try again.";
            return $"{what} Please try again.";
        }
    }
}
