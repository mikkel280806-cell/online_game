using Unity.Netcode;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>
    /// Sits on the Network object: when this machine starts hosting (a room, or solo), it spawns the world state for
    /// everyone. Guests receive it from the host.
    /// </summary>
    public sealed class WorldSpawner : MonoBehaviour
    {
        public NetworkObject WorldPrefab;

        private NetworkManager manager;

        // Subscribe before any Start runs: with -hs-auto the session flow may start hosting during its own Start.
        private void OnEnable()
        {
            manager = GetComponent<NetworkManager>();
            if (manager != null) manager.OnServerStarted += SpawnWorld;
        }

        private void OnDisable()
        {
            if (manager != null) manager.OnServerStarted -= SpawnWorld;
        }

        private void SpawnWorld()
        {
            if (WorldPrefab == null || !manager.IsServer) return;
            var world = Instantiate(WorldPrefab);
            world.name = "WorldState";
            world.Spawn(destroyWithScene: false);
        }
    }
}
