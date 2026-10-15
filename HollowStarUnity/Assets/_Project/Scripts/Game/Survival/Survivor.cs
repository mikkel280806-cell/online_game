using System.Globalization;
using HollowStar.Core;
using HollowStar.Core.Survival;
using HollowStar.Game.Net;
using HollowStar.Game.UI;
using Unity.Netcode.Components;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    /// <summary>
    /// The local crew member's survival state and everything that acts on it: inventory, vitals, the databank, the
    /// hotbar, look-at and gathering, scanning, crafting, death and respawn, the stub objectives. It lives on the
    /// NetPlayer prefab and is enabled for the owner only, so it runs once per machine. It publishes everything to
    /// <see cref="SurvivorHub"/> every frame and answers the UI's requests; the UI never touches it directly.
    /// </summary>
    [RequireComponent(typeof(LocalPlayer))]
    public sealed class Survivor : MonoBehaviour
    {
        public const float ScanSeconds = 1.5f;
        private const float ChestHeight = 1.1f;
        private const float WarnOxygenFraction = 0.25f;
        private const float WarnFoodWater = 20f;
        private const float PartnerLogInterval = 2f;

        private PlayerMotor motor;
        private LocalPlayer local;
        private NetPlayer net;
        private NetworkTransform netTransform;
        private SessionFlow flow;

        private readonly GameClock fallbackClock = new GameClock();
        private ObjectiveChain objectives;
        private bool craftedWater;

        // Gathering (hold F).
        private Interactable holdTarget;
        private float holdTime;
        private bool gatherLocked;
        private int pendingNode = -1;
        private float pendingUntil;

        // Scanning (hold V).
        private Interactable scanTarget;
        private float scanTime;

        // Crafting.
        private Recipe crafting;
        private float craftTime;
        private bool atFabricator;

        // Death.
        private bool wasDead;
        private int respawnCount;

        // Warnings (toast once when a vital drops, again after it recovers).
        private bool warnedOxygen, warnedFood, warnedWater, warnedCold, warnedHeat;

        // Button edges, read once a frame from the held state (the same on every machine, focused or not).
        private readonly bool[] heldBefore = new bool[Edges];
        private readonly bool[] edge = new bool[Edges];
        private const int EdgeHotbar = 0, EdgeNext = 5, EdgePrev = 6, EdgeUse = 7, EdgeGather = 8, EdgeScan = 9, Edges = 10;

        private float autoGatherAt = -1f;
        private bool autoGatherSent;
        private float logTimer;

        public Inventory Inventory { get; private set; }
        public Vitals Vitals { get; private set; }
        public ScanDatabase Databank { get; private set; }
        /// <summary>The tool in hand: it decides what F can gather and whether V scans.</summary>
        public string EquippedTool { get; private set; }
        public int SelectedHotbar { get; private set; }
        public bool IsDead => Vitals != null && Vitals.IsDead;

        private PlayerControls Controls => local != null ? local.Controls : null;

        /// <summary>The UI preview drives the hub with fake data when it runs; this stays out of its way.</summary>
        private static bool PreviewOwnsHub => UiPreview.Running;

        // ---- Lifecycle ----

        private void OnEnable()
        {
            motor = GetComponent<PlayerMotor>();
            local = GetComponent<LocalPlayer>();
            net = GetComponent<NetPlayer>();
            netTransform = GetComponent<NetworkTransform>();
            flow = FindAnyObjectByType<SessionFlow>();

            Inventory = new Inventory();
            Inventory.AddStartingKit();
            // Scanner on 1, then the consumables in the order the kit lists them.
            AssignHotbarFor(0, ItemIds.Scanner);
            AssignHotbarFor(1, ItemIds.RationBar);
            AssignHotbarFor(2, ItemIds.FilteredWater);
            AssignHotbarFor(3, ItemIds.O2Canister);
            Vitals = new Vitals();
            Databank = new ScanDatabase();
            EquippedTool = ItemIds.Scanner;
            SelectedHotbar = 0;
            objectives = new ObjectiveChain();
            craftedWater = false;
            crafting = null;
            wasDead = false;
            respawnCount = 0;
            warnedOxygen = warnedFood = warnedWater = warnedCold = warnedHeat = false;
            holdTarget = scanTarget = null;
            holdTime = scanTime = 0f;
            pendingNode = -1;
            autoGatherAt = LaunchArgs.AutoGatherNode >= 0 ? Time.unscaledTime + LaunchArgs.AutoGatherDelay : -1f;
            autoGatherSent = false;
            autoGatherNode = null;

            if (LaunchArgs.AutoHealth >= 0f)
                Vitals.Restore(Vitals.BaseOxygenCapacity, Vitals.MaxValue, Vitals.MaxValue, Vitals.NormalBodyTempC, LaunchArgs.AutoHealth);

            DatabankContent.Fill(SurvivorHub.DatabankEntries);
            SurvivorHub.ObjectiveLog.Clear();
            SurvivorHub.ObjectiveText = null;
            SurvivorHub.SetObjective(objectives.Current);

            SurvivorHub.UseSlotRequested += OnUseSlot;
            SurvivorHub.DropSlotRequested += OnDropSlot;
            SurvivorHub.CraftRequested += OnCraftRequested;
            SurvivorHub.CraftCancelRequested += OnCraftCancel;
            SurvivorHub.SelectHotbarRequested += OnSelectHotbar;
            WorldState.GatherResolved += OnGatherResolved;

            PublishLocal();
            SurvivorHub.Active = true;
            Debug.Log("[HollowStar] Survivor ready (starting kit in the pack).");
        }

        private void OnDisable()
        {
            SurvivorHub.UseSlotRequested -= OnUseSlot;
            SurvivorHub.DropSlotRequested -= OnDropSlot;
            SurvivorHub.CraftRequested -= OnCraftRequested;
            SurvivorHub.CraftCancelRequested -= OnCraftCancel;
            SurvivorHub.SelectHotbarRequested -= OnSelectHotbar;
            WorldState.GatherResolved -= OnGatherResolved;

            if (motor != null) motor.Downed = false;
            if (PreviewOwnsHub) return;
            SurvivorHub.Active = false;
            SurvivorHub.PromptKey = SurvivorHub.PromptText = SurvivorHub.PromptDetail = null;
            SurvivorHub.PromptProgress = SurvivorHub.ScanProgress = 0f;
            SurvivorHub.CraftingRecipe = null;
            SurvivorHub.CraftProgress = 0f;
            SurvivorHub.AtFabricator = false;
            SurvivorHub.InPressurisedZone = false;
            SurvivorHub.Partner = default;
            SurvivorHub.RoomCode = null;
            SurvivorHub.Markers.Clear();
        }

        private void AssignHotbarFor(int index, string itemId)
        {
            for (int i = 0; i < Inventory.SlotCount; i++)
            {
                if (Inventory[i].Id != itemId) continue;
                Inventory.AssignHotbar(index, i);
                return;
            }
        }

        // ---- Per frame ----

        private void Update()
        {
            if (PreviewOwnsHub || Inventory == null) return;
            float dt = Time.deltaTime;

            var world = WorldState.Instance;
            GameClock clock = world != null ? world.Clock : fallbackClock;
            if (world == null) fallbackClock.Advance(dt);

            Vector3 pos = transform.position;
            Vector3 chest = pos + Vector3.up * ChestHeight;
            bool inZone = PressurisedZone.IsInside(chest);
            float capacity = SuitGear.OxygenCapacity(Inventory);
            float insulation = SuitGear.Insulation(Inventory);
            var env = inZone
                ? VitalsEnvironment.InPressurisedZone(clock.AmbientC, insulation, capacity)
                : VitalsEnvironment.Outdoors(clock.AmbientC, insulation, capacity);
            Vitals.Step(dt, env);

            if (EquippedTool != null && !Inventory.Has(EquippedTool)) EquippedTool = null;
            atFabricator = !Vitals.IsDead && FabricatorConsole.InRange(chest);

            HandleDeath();

            var controls = Controls;
            ReadEdges(controls);
            bool blocked = PlayerControls.Blocked || SurvivorHub.PdaOpen || Vitals.IsDead || controls == null;
            if (blocked)
            {
                ClearInteraction();
            }
            else
            {
                HandleHotbarInput();
                UpdateInteraction(controls, chest, dt);
            }

            TickCraft(dt);
            UpdateAutoTest();
            WatchObjectives();
            Warn(capacity);

            PublishLocal();
            PublishWorld(clock, inZone, capacity);
        }

        /// <summary>Writes the always-current state the HUD reads.</summary>
        private void PublishLocal()
        {
            SurvivorHub.Inventory = Inventory;
            SurvivorHub.Vitals = Vitals;
            SurvivorHub.Databank = Databank;
            SurvivorHub.SelectedHotbar = SelectedHotbar;
            SurvivorHub.AtFabricator = atFabricator;
            // The UI preview may have shown other text meanwhile; this survivor's objective is the truth.
            if (objectives != null && SurvivorHub.ObjectiveText != objectives.Current) SurvivorHub.SetObjective(objectives.Current);
            SurvivorHub.PlayerPosition = transform.position;
            var cam = Camera.main;
            if (cam != null) SurvivorHub.CameraYawDeg = cam.transform.eulerAngles.y;
            UpdateMarkers();
        }

        private void PublishWorld(GameClock clock, bool inZone, float capacity)
        {
            SurvivorHub.Clock = clock;
            SurvivorHub.InPressurisedZone = inZone;
            SurvivorHub.OxygenCapacity = capacity;
            SurvivorHub.Active = true;
            SurvivorHub.RoomCode = flow != null && !flow.IsSolo ? flow.JoinCode : null;

            // Tell the partner, and show them to us.
            if (net != null) net.PublishVitals(Vitals.Health, Vitals.Oxygen, capacity, Vitals.IsDead);
            var other = NetPlayer.Partner;
            SurvivorHub.Partner = other == null
                ? default
                : new PartnerView
                {
                    Connected = true,
                    Name = other.DisplayName,
                    Health = other.Health,
                    Oxygen = other.Oxygen,
                    OxygenCapacity = other.OxygenCapacity,
                    IsDead = other.IsDead,
                };

            if (LaunchArgs.Automated)
            {
                logTimer -= Time.unscaledDeltaTime;
                if (logTimer <= 0f)
                {
                    logTimer = PartnerLogInterval;
                    var inv = CultureInfo.InvariantCulture;
                    Debug.LogFormat(LogType.Log, LogOption.NoStacktrace, null,
                        "[HollowStar] vitals self: health {0} oxygen {1}/{2} food {3} water {4} temp {5} zone {6} pos ({7}, {8})",
                        Vitals.Health.ToString("F1", inv), Vitals.Oxygen.ToString("F1", inv), capacity.ToString("F0", inv),
                        Vitals.Food.ToString("F1", inv), Vitals.Water.ToString("F1", inv), Vitals.BodyTemp.ToString("F1", inv), inZone,
                        transform.position.x.ToString("F1", inv), transform.position.z.ToString("F1", inv));
                    if (other != null)
                        Debug.LogFormat(LogType.Log, LogOption.NoStacktrace, null,
                            "[HollowStar] vitals partner: name {0} health {1} oxygen {2}/{3} dead {4}",
                            other.DisplayName, other.Health.ToString("F1", inv), other.Oxygen.ToString("F1", inv),
                            other.OxygenCapacity.ToString("F0", inv), other.IsDead);
                }
            }
        }

        private void UpdateMarkers()
        {
            var markers = SurvivorHub.Markers;
            markers.Clear();
            var anchors = WrenAnchors.Current;
            if (anchors != null)
                markers.Add(new CompassMarker { Label = "Wren", Position = anchors.transform.position, Color = UiKit.Cyan });
            markers.Add(new CompassMarker { Label = "Outpost", Position = new Vector3(Layout.Mast.X + 6f, 0f, Layout.Mast.Z + 3f), Color = UiKit.Amber });
        }

        // ---- Death and respawn ----

        private void HandleDeath()
        {
            if (!Vitals.IsDead)
            {
                if (wasDead)
                {
                    wasDead = false;
                    motor.Downed = false;
                }
                return;
            }

            if (!wasDead)
            {
                wasDead = true;
                motor.Downed = true;
                CancelCraft(announce: false);
                SurvivorHub.Toast("Suit failure", ToastKind.Warning);
                Debug.Log("[HollowStar] Survivor died.");
            }

            if (Vitals.CanRespawn) Respawn();
        }

        private void Respawn()
        {
            Vector3 position;
            Quaternion rotation;
            var anchors = WrenAnchors.Current;
            // Alternate between the bay's respawn points so two players do not land on each other.
            int index = (net != null ? (int)net.OwnerClientId : 0) + respawnCount++;
            if (anchors == null || !anchors.TryGetRespawn(index, out position, out rotation))
            {
                var p = Layout.SpawnPoints[0];
                position = new Vector3(p.X, VigilWorld.GroundHeight(p.X, p.Z) + 0.5f, p.Z);
                rotation = Quaternion.identity;
            }
            motor.Teleport(position, rotation.eulerAngles.y * Mathf.Deg2Rad);
            if (netTransform != null && netTransform.CanCommitToTransform) netTransform.Teleport(position, rotation, Vector3.one);
            Vitals.Respawn();
            motor.Downed = false;
            wasDead = false;
            SurvivorHub.Toast("Back in the Wren", ToastKind.Info);
            Debug.Log($"[HollowStar] Survivor respawned at ({position.x:F1}, {position.y:F1}, {position.z:F1}).");
        }

        // ---- Hotbar and items ----

        private void ReadEdges(PlayerControls controls)
        {
            for (int i = 0; i < Edges; i++) edge[i] = false;
            if (controls == null)
            {
                for (int i = 0; i < Edges; i++) heldBefore[i] = false;
                return;
            }
            for (int i = 0; i < Inventory.HotbarSize; i++) Track(EdgeHotbar + i, controls.Hotbar[i]);
            Track(EdgeNext, controls.HotbarNext);
            Track(EdgePrev, controls.HotbarPrev);
            Track(EdgeUse, controls.Use);
            Track(EdgeGather, controls.Gather);
            Track(EdgeScan, controls.Scan);
        }

        private void Track(int index, UnityEngine.InputSystem.InputAction action)
        {
            bool now = action.IsPressed();
            edge[index] = now && !heldBefore[index];
            heldBefore[index] = now;
        }

        private void HandleHotbarInput()
        {
            for (int i = 0; i < Inventory.HotbarSize; i++)
                if (edge[EdgeHotbar + i]) SelectHotbar(i);
            if (edge[EdgeNext]) SelectHotbar((SelectedHotbar + 1) % Inventory.HotbarSize);
            if (edge[EdgePrev]) SelectHotbar((SelectedHotbar + Inventory.HotbarSize - 1) % Inventory.HotbarSize);
            if (edge[EdgeUse])
            {
                int slot = Inventory.HotbarSlot(SelectedHotbar);
                if (slot >= 0) UseSlot(slot);
            }
        }

        public void SelectHotbar(int index)
        {
            SelectedHotbar = Mathf.Clamp(index, 0, Inventory.HotbarSize - 1);
            SurvivorHub.SelectedHotbar = SelectedHotbar;
            var stack = Inventory.HotbarStack(SelectedHotbar);
            if (!stack.IsEmpty && stack.Def.IsTool) Equip(stack.Id);
        }

        private void Equip(string toolId)
        {
            if (EquippedTool == toolId) return;
            EquippedTool = toolId;
            SurvivorHub.Toast("Equipped " + ItemCatalog.Get(toolId).Name, ToastKind.Info);
        }

        /// <summary>How to get a tool into hand, for a prompt line.</summary>
        public string EquipHint(string toolId)
        {
            string name = ItemCatalog.Get(toolId).Name.ToLowerInvariant();
            for (int i = 0; i < Inventory.HotbarSize; i++)
                if (Inventory.HotbarStack(i).Id == toolId) return $"Equip {name} (press {i + 1})";
            return Inventory.Has(toolId) ? $"Put the {name} on the hotbar" : $"Requires {name}";
        }

        public void UseSlot(int slot)
        {
            if (Vitals.IsDead || slot < 0 || slot >= Inventory.SlotCount) return;
            var stack = Inventory[slot];
            var def = stack.Def;
            if (def == null) return;
            if (def.IsConsumable)
            {
                if (!Useful(def))
                {
                    SurvivorHub.Toast("Not needed right now", ToastKind.Info);
                    return;
                }
                if (Vitals.Consume(def))
                {
                    Inventory.RemoveAt(slot, 1);
                    string verb = def.Food > 0f ? "Ate" : def.Water > 0f && def.Food <= 0f ? "Drank" : "Used";
                    SurvivorHub.Toast($"{verb} {def.Name}", ToastKind.Info);
                }
            }
            else if (def.IsTool) Equip(def.Id);
            else if (def.Category == ItemCategory.Equipment) SurvivorHub.Toast(def.Name + " works while carried", ToastKind.Info);
            else SurvivorHub.Toast("Nothing to use it on", ToastKind.Info);
        }

        /// <summary>False when using the item would change nothing (full tank, full belly).</summary>
        private bool Useful(ItemDef def)
        {
            const float slack = 0.5f;
            return (def.Food > 0f && Vitals.Food < Vitals.MaxValue - slack)
                || (def.Water > 0f && Vitals.Water < Vitals.MaxValue - slack)
                || (def.Oxygen > 0f && Vitals.Oxygen < Vitals.OxygenCapacity - slack)
                || (def.Health > 0f && Vitals.Health < Vitals.MaxValue - slack);
        }

        private void OnUseSlot(int slot)
        {
            if (!PreviewOwnsHub) UseSlot(slot);
        }

        private void OnDropSlot(int slot)
        {
            if (PreviewOwnsHub || Vitals.IsDead || slot < 0 || slot >= Inventory.SlotCount) return;
            var stack = Inventory[slot];
            if (stack.IsEmpty) return;
            string name = stack.Def.Name;
            int n = Inventory.RemoveAt(slot, stack.Count);
            SurvivorHub.Toast($"Dropped {n} {name}", ToastKind.Info);
        }

        private void OnSelectHotbar(int index)
        {
            if (!PreviewOwnsHub) SelectHotbar(index);
        }

        // ---- Look-at, gathering and scanning ----

        private void ClearInteraction()
        {
            holdTarget = null;
            holdTime = 0f;
            scanTarget = null;
            scanTime = 0f;
            gatherLocked = false;
            SurvivorHub.PromptKey = SurvivorHub.PromptText = SurvivorHub.PromptDetail = null;
            SurvivorHub.PromptProgress = 0f;
            SurvivorHub.ScanProgress = 0f;
        }

        /// <summary>Finds what the survivor is looking at: nearest thing that is roughly in front of both the player and the camera.</summary>
        private void FindTargets(Vector3 chest, out Interactable act, out Interactable scan)
        {
            act = scan = null;
            Vector3 fwdPlayer = transform.forward;
            fwdPlayer.y = 0f;
            fwdPlayer = fwdPlayer.sqrMagnitude > 1e-4f ? fwdPlayer.normalized : Vector3.forward;
            Vector3 fwdCam = fwdPlayer;
            var cam = Camera.main;
            if (cam != null)
            {
                fwdCam = cam.transform.forward;
                fwdCam.y = 0f;
                fwdCam = fwdCam.sqrMagnitude > 1e-4f ? fwdCam.normalized : fwdPlayer;
            }

            float bestAct = float.MaxValue, bestScan = float.MaxValue;
            var all = Interactable.All;
            for (int i = 0; i < all.Count; i++)
            {
                var it = all[i];
                if (!it.Present) continue;
                float d = it.DistanceTo(chest);
                bool canAct = it.HasAction && d <= it.Reach;
                bool canScan = it.ScanId != null && d <= it.ScanReach;
                if (!canAct && !canScan) continue;

                Vector3 to = it.NearestPoint(chest) - chest;
                to.y = 0f;
                float flat = to.magnitude;
                float dotPlayer = 1f, dotCam = 1f;
                if (flat > 0.9f)
                {
                    to /= flat;
                    dotPlayer = Vector3.Dot(fwdPlayer, to);
                    dotCam = Vector3.Dot(fwdCam, to);
                    if (dotPlayer < 0.2f || dotCam < 0f) continue;
                }
                float score = d - dotCam * 0.6f;
                if (canAct && score < bestAct)
                {
                    bestAct = score;
                    act = it;
                }
                if (canScan && score < bestScan)
                {
                    bestScan = score;
                    scan = it;
                }
            }
        }

        private void UpdateInteraction(PlayerControls controls, Vector3 chest, float dt)
        {
            FindTargets(chest, out Interactable act, out Interactable scan);
            bool scanner = EquippedTool == ItemIds.Scanner;

            // ---- Prompt and the F hold ----
            SurvivorHub.PromptKey = SurvivorHub.PromptText = SurvivorHub.PromptDetail = null;
            float promptProgress = 0f;
            bool pressed = controls.Gather.IsPressed();
            if (!pressed) gatherLocked = false;

            if (act != null)
            {
                var prompt = act.Prompt(this);
                SurvivorHub.PromptKey = "F";
                SurvivorHub.PromptText = prompt.Text;
                SurvivorHub.PromptDetail = prompt.Detail;

                if (act != holdTarget)
                {
                    holdTarget = act;
                    holdTime = 0f;
                }
                bool pending = pendingNode >= 0 && Time.unscaledTime < pendingUntil;
                if (prompt.Allowed && !pending && !gatherLocked)
                {
                    if (act.HoldSeconds <= 0f)
                    {
                        if (edge[EdgeGather])
                        {
                            gatherLocked = true;
                            act.Activate(this);
                        }
                    }
                    else if (pressed)
                    {
                        holdTime += dt;
                        promptProgress = Mathf.Clamp01(holdTime / act.HoldSeconds);
                        if (holdTime >= act.HoldSeconds)
                        {
                            holdTime = 0f;
                            promptProgress = 0f;
                            gatherLocked = true;
                            act.Activate(this);
                        }
                    }
                    else
                    {
                        holdTime = 0f;
                    }
                }
                else
                {
                    holdTime = 0f;
                }
            }
            else
            {
                holdTarget = null;
                holdTime = 0f;
                if (scan != null && scanner && !Databank.IsUnlocked(scan.ScanId))
                {
                    SurvivorHub.PromptKey = "V";
                    SurvivorHub.PromptText = "Scan " + scan.Title;
                }
            }
            SurvivorHub.PromptProgress = promptProgress;

            UpdateScan(controls, scan, scanner, dt);
        }

        private void UpdateScan(PlayerControls controls, Interactable scan, bool scanner, float dt)
        {
            bool pressedNow = edge[EdgeScan];
            if (pressedNow && !scanner)
            {
                SurvivorHub.Toast(Inventory.Has(ItemIds.Scanner) ? EquipHint(ItemIds.Scanner) : "Requires scanner", ToastKind.Info);
            }

            bool canScan = scanner && scan != null && scan.ScanId != null;
            if (canScan && Databank.IsUnlocked(scan.ScanId))
            {
                if (pressedNow) SurvivorHub.Toast("Already in the databank", ToastKind.Info);
                canScan = false;
            }

            if (canScan && controls.Scan.IsPressed())
            {
                if (scan != scanTarget)
                {
                    scanTarget = scan;
                    scanTime = 0f;
                }
                scanTime += dt;
                SurvivorHub.ScanProgress = Mathf.Clamp01(scanTime / ScanSeconds);
                if (scanTime >= ScanSeconds) FinishScan(scan);
            }
            else
            {
                scanTarget = null;
                scanTime = 0f;
                SurvivorHub.ScanProgress = 0f;
            }
        }

        private void FinishScan(Interactable scan)
        {
            string id = scan.ScanId;
            scanTarget = null;
            scanTime = 0f;
            SurvivorHub.ScanProgress = 0f;
            if (!Databank.Unlock(id)) return;
            string title = SurvivorHub.DatabankEntries.TryGetValue(id, out var entry) ? entry.Title : scan.Title;
            SurvivorHub.Toast("Databank: " + title, ToastKind.Databank);
            SurvivorHub.CompleteScan(id);
            Debug.Log($"[HollowStar] Scanned {id}.");
        }

        /// <summary>Called by a resource node when the F hold completes: ask the server.</summary>
        public void RequestGather(ResourceNode node)
        {
            var world = WorldState.Instance;
            if (world == null)
            {
                SurvivorHub.Toast("The world is not ready yet", ToastKind.Warning);
                return;
            }
            pendingNode = node.Index;
            pendingUntil = Time.unscaledTime + 3f;
            world.RequestGather(node.Index);
        }

        private void OnGatherResolved(int nodeIndex, int count)
        {
            if (PreviewOwnsHub || Inventory == null) return;
            pendingNode = -1;
            ResourceNode node = null;
            foreach (var n in ResourceNode.Registry)
                if (n.Index == nodeIndex) node = n;
            if (count <= 0 || node == null)
            {
                SurvivorHub.Toast("Nothing left to take", ToastKind.Info);
                Debug.Log($"[HollowStar] Gather of node {nodeIndex} refused.");
                return;
            }

            var def = node.Def;
            int left = Inventory.Add(def.ItemId, count);
            int got = count - left;
            if (got > 0) SurvivorHub.Toast($"+{got} {ItemCatalog.Get(def.ItemId).Name}", ToastKind.Item);
            if (left > 0) SurvivorHub.Toast("Pack full", ToastKind.Warning);
            Debug.Log($"[HollowStar] Gathered node {nodeIndex} ({def.Name}): +{got} {def.ItemId}.");
        }

        // ---- Crafting ----

        private void OnCraftRequested(string recipeId)
        {
            if (PreviewOwnsHub || Vitals.IsDead || crafting != null) return;
            if (!Recipes.TryGet(recipeId, out var recipe)) return;
            if (!atFabricator)
            {
                SurvivorHub.Toast("Requires fabricator", ToastKind.Warning);
                return;
            }
            // Fabricator and galley are one place for U3.
            var check = Crafting.Check(recipe, Inventory, CraftStations.Fabricator | CraftStations.Galley);
            if (check != CraftResult.Ok)
            {
                SurvivorHub.Toast(check == CraftResult.NoSpace ? "Pack full" : "Missing ingredients", ToastKind.Warning);
                return;
            }
            crafting = recipe;
            craftTime = 0f;
            SurvivorHub.CraftingRecipe = recipe.Id;
            SurvivorHub.CraftProgress = 0f;
        }

        private void OnCraftCancel()
        {
            if (!PreviewOwnsHub) CancelCraft(announce: false);
        }

        private void CancelCraft(bool announce)
        {
            if (crafting == null) return;
            crafting = null;
            craftTime = 0f;
            SurvivorHub.CraftingRecipe = null;
            SurvivorHub.CraftProgress = 0f;
            if (announce) SurvivorHub.Toast("Crafting cancelled: left the fabricator", ToastKind.Warning);
        }

        private void TickCraft(float dt)
        {
            if (crafting == null) return;
            if (!atFabricator || Vitals.IsDead)
            {
                CancelCraft(announce: !Vitals.IsDead);
                return;
            }
            craftTime += dt;
            SurvivorHub.CraftProgress = Mathf.Clamp01(craftTime / Mathf.Max(0.1f, crafting.Seconds));
            if (craftTime >= crafting.Seconds) FinishCraft();
        }

        private void FinishCraft()
        {
            var recipe = crafting;
            crafting = null;
            craftTime = 0f;
            SurvivorHub.CraftingRecipe = null;
            SurvivorHub.CraftProgress = 0f;
            var result = Crafting.Craft(recipe, Inventory, CraftStations.Fabricator | CraftStations.Galley);
            if (result != CraftResult.Ok)
            {
                SurvivorHub.Toast(result == CraftResult.NoSpace ? "Pack full" : "Missing ingredients", ToastKind.Warning);
                return;
            }

            var output = recipe.Output;
            SurvivorHub.Toast("Crafted " + output.Name, ToastKind.Item);
            Debug.Log($"[HollowStar] Crafted {recipe.Id}.");
            if (recipe.Id == ItemIds.FilteredWater) craftedWater = true;

            // New tools and consumables go on a free hotbar key; a new tool is taken in hand.
            if (output.IsTool || output.IsConsumable) PutOnHotbar(recipe.Id);
            if (output.IsTool) Equip(recipe.Id);
        }

        private void PutOnHotbar(string itemId)
        {
            int slot = -1;
            for (int i = 0; i < Inventory.SlotCount; i++)
                if (Inventory[i].Id == itemId) { slot = i; break; }
            if (slot < 0) return;
            for (int h = 0; h < Inventory.HotbarSize; h++)
                if (Inventory.HotbarSlot(h) == slot) return;
            for (int h = 0; h < Inventory.HotbarSize; h++)
            {
                if (Inventory.HotbarSlot(h) >= 0) continue;
                Inventory.AssignHotbar(h, slot);
                return;
            }
        }

        // ---- Objectives and warnings ----

        private void WatchObjectives()
        {
            if (objectives.Update(Inventory, craftedWater) <= 0) return;
            SurvivorHub.Toast("Objective complete", ToastKind.Info);
            SurvivorHub.SetObjective(objectives.Current);
            Debug.Log($"[HollowStar] Objective: {objectives.Current}");
        }

        private void Warn(float capacity)
        {
            if (Vitals.IsDead) return;
            Edge(ref warnedOxygen, Vitals.Oxygen < capacity * WarnOxygenFraction, "Low oxygen");
            Edge(ref warnedFood, Vitals.Food < WarnFoodWater, "Hungry");
            Edge(ref warnedWater, Vitals.Water < WarnFoodWater, "Thirsty");
            Edge(ref warnedCold, Vitals.IsCold, "Body temperature falling");
            Edge(ref warnedHeat, Vitals.IsHot, "Overheating");
        }

        private static void Edge(ref bool warned, bool low, string text)
        {
            if (low && !warned) SurvivorHub.Toast(text, ToastKind.Warning);
            warned = low;
        }

        // ---- Unattended tests (launch switches) ----

        private float autoGatherRequestAt = -1f;
        private ResourceNode autoGatherNode;

        private void UpdateAutoTest()
        {
            if (autoGatherSent || autoGatherAt < 0f || Time.unscaledTime < autoGatherAt) return;
            if (WorldState.Instance == null) return;

            if (autoGatherNode == null)
            {
                foreach (var n in ResourceNode.Registry)
                    if (n.Index == LaunchArgs.AutoGatherNode) autoGatherNode = n;
                if (autoGatherNode == null)
                {
                    autoGatherSent = true;
                    Debug.Log($"[HollowStar] autogather: node {LaunchArgs.AutoGatherNode} not found");
                    return;
                }
                // Step up to the node (outdoors, so the oxygen starts to drain) and give the server a moment to see where we are.
                Vector3 p = autoGatherNode.transform.position + new Vector3(1.5f, 0.2f, 0f);
                motor.Teleport(p, 0f);
                if (netTransform != null && netTransform.CanCommitToTransform) netTransform.Teleport(p, transform.rotation, Vector3.one);
                autoGatherRequestAt = Time.unscaledTime + 1.5f;
                Debug.Log($"[HollowStar] autogather: at node {autoGatherNode.Index} ({autoGatherNode.Def.Name}), depleted before: {autoGatherNode.Depleted}");
                return;
            }

            if (Time.unscaledTime < autoGatherRequestAt) return;
            autoGatherSent = true;
            RequestGather(autoGatherNode);
        }
    }
}
