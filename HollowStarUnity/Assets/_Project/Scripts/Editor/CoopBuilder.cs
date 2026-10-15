using HollowStar.Game;
using HollowStar.Game.Net;
using HollowStar.Game.Survival;
using HollowStar.Game.UI;
using Unity.Netcode;
using Unity.Netcode.Components;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// The co-op plumbing for the Vigil scene: the networked player prefab, the NetworkManager with
    /// its transport, the session flow and the lobby/HUD panel.
    /// </summary>
    public static class CoopBuilder
    {
        public const string PlayerPrefabPath = "Assets/_Project/Prefabs/NetPlayer.prefab";
        public const string WorldPrefabPath = "Assets/_Project/Prefabs/WorldState.prefab";
        private const string UiFolder = "Assets/_Project/UI";
        private const int IgnoreRaycastLayer = 2;

        private static void SetLayer(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform t in go.transform) SetLayer(t.gameObject, layer);
        }

        /// <summary>
        /// A crew member as both machines see it: the owner simulates it (CharacterController, motor,
        /// local input) and streams the transform; the other side follows. LocalPlayer starts disabled
        /// and is switched on for the owner at spawn.
        /// </summary>
        public static GameObject BuildPlayerPrefab(GameObject astronaut)
        {
            var go = new GameObject("NetPlayer");
            var cc = go.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.radius = 0.4f;
            cc.center = new Vector3(0f, 0.9f, 0f);
            cc.slopeLimit = 50f;
            cc.stepOffset = 0.35f;
            cc.skinWidth = 0.04f;
            go.AddComponent<PlayerMotor>();
            go.AddComponent<LocalPlayer>().enabled = false;
            // Inventory, vitals, interaction: switched on for the owner at spawn, like LocalPlayer.
            go.AddComponent<Survivor>().enabled = false;
            go.AddComponent<NetworkObject>();
            var nt = go.AddComponent<NetworkTransform>();
            nt.AuthorityMode = NetworkTransform.AuthorityModes.Owner;
            // Characters only turn around the vertical axis and never scale.
            nt.SyncRotAngleX = false;
            nt.SyncRotAngleZ = false;
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            go.AddComponent<NetPlayer>();

            var model = (GameObject)PrefabUtility.InstantiatePrefab(astronaut, go.transform);
            model.name = "Avatar";
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.identity;
            // Players aren't scenery: the camera shouldn't pull in when one stands in front of it.
            SetLayer(go, IgnoreRaycastLayer);

            System.IO.Directory.CreateDirectory("Assets/_Project/Prefabs");
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, PlayerPrefabPath);
            Object.DestroyImmediate(go);
            return prefab;
        }

        /// <summary>The shared world state (depleted nodes, game clock): spawned once by whoever hosts.</summary>
        public static GameObject BuildWorldPrefab()
        {
            var go = new GameObject("WorldState");
            go.AddComponent<NetworkObject>();
            go.AddComponent<WorldState>();
            System.IO.Directory.CreateDirectory("Assets/_Project/Prefabs");
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, WorldPrefabPath);
            Object.DestroyImmediate(go);
            return prefab;
        }

        /// <summary>NetworkManager on Unity Transport (Relay data is filled in per session) plus the session flow.</summary>
        public static SessionFlow BuildNetwork(GameObject playerPrefab)
        {
            var go = new GameObject("Network");
            var manager = go.AddComponent<NetworkManager>();
            var transport = go.AddComponent<UnityTransport>();
            manager.NetworkConfig.NetworkTransport = transport;
            manager.NetworkConfig.PlayerPrefab = playerPrefab;
            var worldPrefab = BuildWorldPrefab();
            // (The prefab asset lands in Assets/DefaultNetworkPrefabs on its own; adding it again would register it twice.)
            go.AddComponent<WorldSpawner>().WorldPrefab = worldPrefab.GetComponent<NetworkObject>();
            // The server picks spawn points and turns away a third player (SessionFlow.Approve).
            manager.NetworkConfig.ConnectionApproval = true;
            // Both machines load Vigil themselves; netcode only has to spawn the players.
            manager.NetworkConfig.EnableSceneManagement = false;

            var flowGo = new GameObject("Session");
            var flow = flowGo.AddComponent<SessionFlow>();
            flow.Network = manager;

            // Keep ticking while the other copy (or a chat window) has focus.
            PlayerSettings.runInBackground = true;
            return flow;
        }

        public static void BuildUI(SessionFlow flow)
        {
            var go = new GameObject("UI");
            var doc = go.AddComponent<UIDocument>();
            doc.panelSettings = PanelSettingsAsset();
            var lobby = go.AddComponent<LobbyUI>();
            lobby.Flow = flow;
            SurvivalUiBuilder.PrepareAssets();
            lobby.Theme = SurvivalUiBuilder.Sheet("Theme");
            lobby.Style = SurvivalUiBuilder.Sheet("Lobby");
        }

        /// <summary>Scales the UI with window height, on Unity's default runtime theme (restyled in code).</summary>
        public static PanelSettings PanelSettingsAsset()
        {
            System.IO.Directory.CreateDirectory(UiFolder);
            string themePath = $"{UiFolder}/HollowStarTheme.tss";
            if (!System.IO.File.Exists(themePath))
            {
                System.IO.File.WriteAllText(themePath, "@import url(\"unity-theme://default\");\n");
                AssetDatabase.ImportAsset(themePath);
            }

            string path = $"{UiFolder}/PanelSettings.asset";
            var settings = AssetDatabase.LoadAssetAtPath<PanelSettings>(path);
            if (settings == null)
            {
                settings = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(settings, path);
            }
            settings.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(themePath);
            settings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            settings.referenceResolution = new Vector2Int(1920, 1080);
            settings.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            settings.match = 1f;
            EditorUtility.SetDirty(settings);
            return settings;
        }
    }
}
