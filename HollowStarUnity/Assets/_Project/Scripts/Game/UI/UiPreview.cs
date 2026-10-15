using System;
using HollowStar.Core.Survival;
using HollowStar.Game.Survival;
using UnityEngine;
using UnityEngine.InputSystem;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// A debug driver that fills <see cref="SurvivorHub"/> with convincing fake data so the HUD and PDA can be
    /// shown (and screenshotted) without any gameplay. Start it with the <c>-hs-uipreview</c> launch switch or
    /// the menu Hollow Star / UI Preview in play mode. Keys: 1-5 select the hotbar, R uses the selected item,
    /// F2 toggles "at the fabricator", F3 low vitals, F4 kills the player, F5 a scan, F6 restores normal vitals.
    /// Tab opens the PDA (see <see cref="PdaUI"/>).
    /// </summary>
    public sealed class UiPreview : MonoBehaviour
    {
        private static UiPreview instance;

        private Vitals vitals;
        private GameClock clock;
        private float nextToast, craftSeconds;
        private int toastIndex;
        private bool autoSolo;
        private float? yawOverride;
        private Net.SessionFlow flow;

        private static readonly string[] ToastTexts =
        {
            "+2 Ferrite Ore", "+1 Sporeberry", "Databank: Lumen Bulb", "+3 Silica Sand", "+1 Amber Resin", "Low oxygen",
        };
        private static readonly ToastKind[] ToastKinds =
        {
            ToastKind.Item, ToastKind.Item, ToastKind.Databank, ToastKind.Item, ToastKind.Item, ToastKind.Warning,
        };

        public static bool Running => instance != null;

        // ---- Entry points ----

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => instance = null;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AutoStart()
        {
            foreach (string arg in Environment.GetCommandLineArgs())
            {
                if (arg == "-hs-uipreview")
                {
                    Toggle(true);
                    // Straight into a solo game so the HUD shows over the world, not over the menu.
                    if (instance != null) instance.autoSolo = true;
                    return;
                }
            }
        }

        public static void Toggle(bool on)
        {
            if (on == Running) return;
            if (on)
            {
                var go = new GameObject("UiPreview");
                instance = go.AddComponent<UiPreview>();
            }
            else
            {
                Destroy(instance.gameObject);
                instance = null;
            }
        }

        /// <summary>Named setups for screenshots: normal, low, dead, scan, toast, prompt, and pda:inventory, pda:fabricator, pda:databank, pda:objectives, pda:close.</summary>
        public static void Scenario(string name)
        {
            if (!Running) Toggle(true);
            instance.Apply(name);
        }

        // ---- Lifecycle ----

        private void OnEnable()
        {
            SurvivorHub.UseSlotRequested += OnUse;
            SurvivorHub.DropSlotRequested += OnDrop;
            SurvivorHub.CraftRequested += OnCraft;
            SurvivorHub.CraftCancelRequested += OnCraftCancel;
            SurvivorHub.SelectHotbarRequested += OnSelectHotbar;
            Populate();
        }

        private void OnDisable()
        {
            SurvivorHub.UseSlotRequested -= OnUse;
            SurvivorHub.DropSlotRequested -= OnDrop;
            SurvivorHub.CraftRequested -= OnCraft;
            SurvivorHub.CraftCancelRequested -= OnCraftCancel;
            SurvivorHub.SelectHotbarRequested -= OnSelectHotbar;
            SurvivorHub.Active = false;
            SurvivorHub.PdaOpen = false;
            SurvivorHub.Markers.Clear();
            SurvivorHub.PromptText = null;
        }

        private void Populate()
        {
            flow = FindAnyObjectByType<Net.SessionFlow>();
            clock = new GameClock(0.34);
            vitals = new Vitals();
            vitals.Restore(oxygen: 64f, food: 73f, water: 41f, bodyTemp: 36.6f, health: 88f);

            var inv = new Inventory();
            inv.AddStartingKit();
            inv.Add(ItemIds.FerriteOre, 14);
            inv.Add(ItemIds.CopperOre, 6);
            inv.Add(ItemIds.SilicaSand, 9);
            inv.Add(ItemIds.Quartz, 3);
            inv.Add(ItemIds.IceChunk, 4);
            inv.Add(ItemIds.FiberReed, 7);
            inv.Add(ItemIds.AmberResin, 5);
            inv.Add(ItemIds.ScrapMetal, 11);
            inv.Add(ItemIds.SalvagedWiring, 2);
            inv.Add(ItemIds.LumenBulb, 3);
            inv.Add(ItemIds.Sporeberry, 8);
            inv.Add(ItemIds.GroundTuber, 5);
            inv.Add(ItemIds.MetalPlate, 4);
            inv.Add(ItemIds.Battery, 2);
            inv.Add(ItemIds.Glass, 3);
            inv.Add(ItemIds.Medkit, 1);
            inv.Add(ItemIds.Flashlight, 1);
            inv.Add(ItemIds.ThermalLiner, 1);
            AssignHotbar(inv, 0, ItemIds.Scanner);
            AssignHotbar(inv, 1, ItemIds.RationBar);
            AssignHotbar(inv, 2, ItemIds.FilteredWater);
            AssignHotbar(inv, 3, ItemIds.O2Canister);
            AssignHotbar(inv, 4, ItemIds.Medkit);

            var db = new ScanDatabase();
            SurvivorHub.DatabankEntries.Clear();
            foreach (var e in Entries()) SurvivorHub.DatabankEntries[e.Id] = e;
            foreach (string id in new[] { "ferrite_rock", "fiber_reed", "scrap_pile", "lumen_bulb", "sporeberry_bush" }) db.Unlock(id);

            SurvivorHub.Inventory = inv;
            SurvivorHub.Vitals = vitals;
            SurvivorHub.Databank = db;
            SurvivorHub.Clock = clock;
            SurvivorHub.OxygenCapacity = 100f;
            SurvivorHub.InPressurisedZone = false;
            SurvivorHub.SelectedHotbar = 1;
            SurvivorHub.PlayerPosition = Vector3.zero;
            SurvivorHub.AtFabricator = true;
            SurvivorHub.CraftingRecipe = null;
            SurvivorHub.CraftProgress = 0f;
            SurvivorHub.PromptText = null;
            SurvivorHub.PromptProgress = SurvivorHub.ScanProgress = 0f;
            SurvivorHub.RoomCode = "K7QX2M";
            SurvivorHub.Partner = new PartnerView { Connected = true, Name = "Juno", Health = 76f, Oxygen = 58f, OxygenCapacity = 100f };

            SurvivorHub.ObjectiveLog.Clear();
            SurvivorHub.ObjectiveText = null;
            SurvivorHub.SetObjective("Wake up in the Wren");
            SurvivorHub.SetObjective("Find water");
            SurvivorHub.SetObjective("Craft a cutter");

            SurvivorHub.Markers.Clear();
            SurvivorHub.Markers.Add(new CompassMarker { Label = "Wren", Position = new Vector3(34f, 0f, 78f), Color = UiKit.Cyan });
            SurvivorHub.Markers.Add(new CompassMarker { Label = "Outpost", Position = new Vector3(-138f, 0f, 52f), Color = UiKit.Amber });
            nextToast = Time.unscaledTime + 3f;
        }

        private static void AssignHotbar(Inventory inv, int index, string id)
        {
            for (int i = 0; i < Inventory.SlotCount; i++)
            {
                if (inv[i].Id != id) continue;
                inv.AssignHotbar(index, i);
                return;
            }
        }

        private static DatabankEntry E(string id, string title, string category, string desc, GlyphId glyph, params string[] yields) =>
            new DatabankEntry { Id = id, Title = title, Category = category, Description = desc, Glyph = glyph, Yields = yields };

        private static DatabankEntry[] Entries() => new[]
        {
            E("ferrite_rock", "Ferrite Rock", "MINERAL", "Dense, faintly magnetic outcrops. Breaks cleanly under a cutter and presses into structural plate.", GlyphId.Crystal, ItemIds.FerriteOre),
            E("copper_vein", "Copper Vein", "MINERAL", "Green-streaked seams in the basalt. The conductor behind every wire and cell.", GlyphId.Crystal, ItemIds.CopperOre),
            E("silica_patch", "Silica Patch", "MINERAL", "Pale glassy grains drifted into the crater floors.", GlyphId.Crystal, ItemIds.SilicaSand),
            E("fiber_reed", "Fibre Reed", "FLORA", "Tough, pale stalks that sway in the thin wind. Needs a cutter; weaves into mesh.", GlyphId.Leaf, ItemIds.FiberReed),
            E("scrap_pile", "Scrap Pile", "SALVAGE", "Hull plating from the wreck, bent but usable.", GlyphId.Gear, ItemIds.ScrapMetal, ItemIds.SalvagedWiring),
            E("lumen_bulb", "Lumen Bulb", "FLORA", "A bioluminescent pod that keeps its glow long after it is picked. Cells love it.", GlyphId.Bolt, ItemIds.LumenBulb),
            E("sporeberry_bush", "Sporeberry Bush", "FLORA", "Tart berries, safe to eat raw. One of the few things here that tastes of anything.", GlyphId.Leaf, ItemIds.Sporeberry),
            E("ice_chunk", "Ice Chunk", "MINERAL", "Frozen water from the crater shadows. Filter it before drinking.", GlyphId.Drop, ItemIds.IceChunk),
        };

        // ---- Per frame ----

        private void Update()
        {
            float dt = Time.unscaledDeltaTime;
            clock.Advance(dt);
            var env = SurvivorHub.InPressurisedZone
                ? VitalsEnvironment.InPressurisedZone(clock.AmbientC)
                : VitalsEnvironment.Outdoors(clock.AmbientC);
            if (vitals != null) vitals.Step(dt, env);

            // The HUD shows once a game is running (or at once when there is no lobby in the scene).
            if (autoSolo && flow != null && flow.CanStart)
            {
                autoSolo = false;
                flow.PlaySolo();
            }
            SurvivorHub.Active = flow == null || flow.InGame;

            var cam = Camera.main;
            SurvivorHub.CameraYawDeg = yawOverride ?? (cam != null ? cam.transform.eulerAngles.y : 30f * Mathf.Sin(Time.unscaledTime * 0.25f));

            HandleKeys();

            if (Time.unscaledTime >= nextToast)
            {
                nextToast = Time.unscaledTime + 4f;
                SurvivorHub.Toast(ToastTexts[toastIndex % ToastTexts.Length], ToastKinds[toastIndex % ToastKinds.Length]);
                toastIndex++;
            }

            // Respawn a moment after the countdown ends, like the real game will.
            if (vitals.IsDead && vitals.CanRespawn)
            {
                vitals.Respawn();
            }

            if (SurvivorHub.CraftingRecipe != null)
            {
                SurvivorHub.CraftProgress += dt / Mathf.Max(0.1f, craftSeconds);
                if (SurvivorHub.CraftProgress >= 1f) FinishCraft();
            }
        }

        private void HandleKeys()
        {
            var kb = Keyboard.current;
            if (kb == null || SurvivorHub.PdaOpen) return;
            Key[] keys = { Key.Digit1, Key.Digit2, Key.Digit3, Key.Digit4, Key.Digit5 };
            for (int i = 0; i < keys.Length; i++)
                if (kb[keys[i]].wasPressedThisFrame) SurvivorHub.SelectedHotbar = i;
            if (kb[Key.R].wasPressedThisFrame)
            {
                int slot = SurvivorHub.Inventory.HotbarSlot(SurvivorHub.SelectedHotbar);
                if (slot >= 0) SurvivorHub.RequestUse(slot);
            }
            if (kb[Key.F2].wasPressedThisFrame) SurvivorHub.AtFabricator = !SurvivorHub.AtFabricator;
            if (kb[Key.F3].wasPressedThisFrame) Apply("low");
            if (kb[Key.F4].wasPressedThisFrame) Apply("dead");
            if (kb[Key.F5].wasPressedThisFrame) Apply("scan");
            if (kb[Key.F6].wasPressedThisFrame) Apply("normal");
        }

        private void Apply(string name)
        {
            switch (name)
            {
                case "normal":
                    vitals.Restore(64f, 73f, 41f, 36.6f, 88f);
                    SurvivorHub.PromptText = null;
                    SurvivorHub.PromptProgress = SurvivorHub.ScanProgress = 0f;
                    break;
                case "low":
                    vitals.Restore(14f, 22f, 9f, 34.1f, 24f);
                    SurvivorHub.PromptKey = "F";
                    SurvivorHub.PromptText = "Gather Ferrite Rock";
                    SurvivorHub.PromptDetail = null;
                    SurvivorHub.PromptProgress = 0.55f;
                    SurvivorHub.Toast("+2 Ferrite Ore", ToastKind.Item);
                    SurvivorHub.Toast("Databank: Lumen Bulb", ToastKind.Databank);
                    break;
                case "prompt-blocked":
                    SurvivorHub.PromptKey = "F";
                    SurvivorHub.PromptText = "Harvest Fibre Reed";
                    SurvivorHub.PromptDetail = "Requires cutter";
                    SurvivorHub.PromptProgress = 0f;
                    break;
                case "scan-progress":
                    SurvivorHub.ScanProgress = 0.62f;
                    break;
                case "dead":
                    vitals.Restore(0f, 20f, 15f, 36.5f, 0f);
                    break;
                case "scan":
                    SurvivorHub.CompleteScan("ferrite_rock");
                    break;
                case "objective":
                    SurvivorHub.SetObjective("Restore the outpost power");
                    break;
                case "toast":
                    SurvivorHub.Toast("+2 Ferrite Ore", ToastKind.Item);
                    break;
                case "zone":
                    SurvivorHub.InPressurisedZone = true;
                    break;
                case "away":
                    SurvivorHub.AtFabricator = false;
                    break;
                case "at":
                    SurvivorHub.AtFabricator = true;
                    break;
                case "pda:close":
                    var pda = FindAnyObjectByType<PdaUI>();
                    if (pda != null) pda.Close();
                    break;
                case "yaw:-20": yawOverride = -20f; break;
                case "yaw:free": yawOverride = null; break;
                case "pda:inventory": SurvivorHub.OpenPda(PdaTab.Inventory); break;
                case "pda:fabricator": SurvivorHub.OpenPda(PdaTab.Fabricator); break;
                case "pda:databank": SurvivorHub.OpenPda(PdaTab.Databank); break;
                case "pda:objectives": SurvivorHub.OpenPda(PdaTab.Objectives); break;
            }
        }

        // ---- Handlers for what the UI requests ----

        private void OnSelectHotbar(int index) => SurvivorHub.SelectedHotbar = Mathf.Clamp(index, 0, Inventory.HotbarSize - 1);

        private void OnUse(int slot)
        {
            var inv = SurvivorHub.Inventory;
            var stack = inv[slot];
            var def = stack.Def;
            if (def == null) return;
            if (def.IsConsumable && vitals.Consume(def))
            {
                inv.RemoveAt(slot, 1);
                SurvivorHub.Toast("Used " + def.Name, ToastKind.Info);
            }
            else if (def.IsTool)
            {
                SurvivorHub.Toast("Equipped " + def.Name, ToastKind.Info);
            }
        }

        private void OnDrop(int slot)
        {
            var inv = SurvivorHub.Inventory;
            var stack = inv[slot];
            if (stack.IsEmpty) return;
            int n = inv.RemoveAt(slot, stack.Count);
            SurvivorHub.Toast($"Dropped {n} {stack.Def.Name}", ToastKind.Info);
        }

        private void OnCraft(string recipeId)
        {
            if (SurvivorHub.CraftingRecipe != null) return;
            if (!Recipes.TryGet(recipeId, out var recipe)) return;
            var at = SurvivorHub.AtFabricator ? CraftStations.All : CraftStations.None;
            if (Crafting.Check(recipe, SurvivorHub.Inventory, at) != CraftResult.Ok) return;
            SurvivorHub.CraftingRecipe = recipeId;
            SurvivorHub.CraftProgress = 0f;
            craftSeconds = recipe.Seconds;
        }

        private void OnCraftCancel()
        {
            SurvivorHub.CraftingRecipe = null;
            SurvivorHub.CraftProgress = 0f;
        }

        private void FinishCraft()
        {
            var recipe = Recipes.Get(SurvivorHub.CraftingRecipe);
            SurvivorHub.CraftingRecipe = null;
            SurvivorHub.CraftProgress = 0f;
            var at = SurvivorHub.AtFabricator ? CraftStations.All : CraftStations.None;
            if (Crafting.Craft(recipe, SurvivorHub.Inventory, at) == CraftResult.Ok)
                SurvivorHub.Toast($"+{recipe.OutputCount} {recipe.Output.Name}", ToastKind.Item);
        }
    }
}
