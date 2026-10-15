using System;
using System.Collections.Generic;
using HollowStar.Core.Survival;
using UnityEngine;

namespace HollowStar.Game.Survival
{
    public enum PdaTab { Inventory, Fabricator, Databank, Objectives }

    public enum ToastKind { Item, Databank, Info, Warning }

    /// <summary>A databank card: what the scanner shows and the Databank tab lists.</summary>
    public sealed class DatabankEntry
    {
        public string Id;
        public string Title;
        /// <summary>Short uppercase group, e.g. "MINERAL", "FLORA", "SALVAGE".</summary>
        public string Category;
        public string Description;
        /// <summary>Item ids this thing yields when gathered; may be empty.</summary>
        public string[] Yields = Array.Empty<string>();
        public GlyphId Glyph;
    }

    /// <summary>The other player as the HUD shows them.</summary>
    public struct PartnerView
    {
        public bool Connected;
        public string Name;
        public float Health;
        public float Oxygen;
        public float OxygenCapacity;
        public bool IsDead;
    }

    /// <summary>A marker on the compass strip.</summary>
    public struct CompassMarker
    {
        public string Label;
        public Vector3 Position;
        public Color Color;
    }

    /// <summary>
    /// The seam between gameplay and the UI. There is exactly one local survivor per process, so this is static.
    /// Gameplay (world, interaction, vitals, network) writes the state and raises the "gameplay to UI" events;
    /// the UI only reads the state, sets <see cref="PdaOpen"/>, and calls the Request methods, which gameplay
    /// handles. Neither side references the other's classes.
    /// </summary>
    public static class SurvivorHub
    {
        // ---- State written by gameplay ----

        /// <summary>True while a local survivor exists (in a session). The HUD hides when false.</summary>
        public static bool Active;
        public static Inventory Inventory;
        public static Vitals Vitals;
        public static ScanDatabase Databank;
        /// <summary>The shared clock (host's value).</summary>
        public static GameClock Clock;
        /// <summary>Current suit oxygen capacity (100 base, more with a high-capacity tank).</summary>
        public static float OxygenCapacity = Vitals.BaseOxygenCapacity;
        /// <summary>True while inside a pressurised zone (show "PRESSURISED" next to oxygen).</summary>
        public static bool InPressurisedZone;

        /// <summary>Selected hotbar index, 0..4.</summary>
        public static int SelectedHotbar;

        /// <summary>For the compass: the player's position and the camera's yaw in degrees (0 = +Z).</summary>
        public static Vector3 PlayerPosition;
        public static float CameraYawDeg;
        public static readonly List<CompassMarker> Markers = new List<CompassMarker>();

        /// <summary>Interaction prompt under the crosshair, e.g. Key "F", Text "Gather Ferrite Rock". Null text hides it.</summary>
        public static string PromptKey;
        public static string PromptText;
        /// <summary>Optional second line, e.g. "Requires cutter" (shown dim/danger).</summary>
        public static string PromptDetail;
        /// <summary>Hold progress 0..1 for the prompt (gathering); 0 hides the bar.</summary>
        public static float PromptProgress;
        /// <summary>Scan reticle fill 0..1 while V is held; 0 hides it.</summary>
        public static float ScanProgress;

        /// <summary>True while in reach of a fabricator, so recipes that need it can be crafted.</summary>
        public static bool AtFabricator;
        /// <summary>The recipe being crafted (null when idle) and its progress 0..1.</summary>
        public static string CraftingRecipe;
        public static float CraftProgress;

        public static string ObjectiveText;
        public static readonly List<string> ObjectiveLog = new List<string>();
        public static int ObjectiveVersion;

        /// <summary>Join code of the session (null when solo).</summary>
        public static string RoomCode;
        public static PartnerView Partner;

        /// <summary>Text for every databank entry that exists, by id (filled by gameplay at startup).</summary>
        public static readonly Dictionary<string, DatabankEntry> DatabankEntries = new Dictionary<string, DatabankEntry>();

        // ---- State written by the UI ----

        /// <summary>The PDA is open: gameplay blocks movement, gathering and hotbar input.</summary>
        public static bool PdaOpen;

        // ---- Gameplay to UI ----

        public static event Action<string, ToastKind> ToastRaised;
        /// <summary>A scan finished; the id of the databank entry (show the scan card).</summary>
        public static event Action<string> ScanCompleted;
        /// <summary>Gameplay asks the UI to open the PDA on a tab (e.g. F at the fabricator).</summary>
        public static event Action<PdaTab> PdaOpenRequested;
        /// <summary>A new objective started (pulse the objective panel).</summary>
        public static event Action ObjectiveChanged;

        public static void Toast(string text, ToastKind kind = ToastKind.Info) => ToastRaised?.Invoke(text, kind);
        public static void CompleteScan(string entryId) => ScanCompleted?.Invoke(entryId);
        public static void OpenPda(PdaTab tab) => PdaOpenRequested?.Invoke(tab);

        public static void SetObjective(string text)
        {
            if (text == ObjectiveText) return;
            if (!string.IsNullOrEmpty(ObjectiveText)) ObjectiveLog.Insert(0, ObjectiveText);
            ObjectiveText = text;
            ObjectiveVersion++;
            ObjectiveChanged?.Invoke();
        }

        // ---- UI to gameplay ----

        /// <summary>Use or equip the item in an inventory slot (eat, drink, consumable, tool).</summary>
        public static event Action<int> UseSlotRequested;
        public static event Action<int> DropSlotRequested;
        /// <summary>Start crafting a recipe by id; gameplay checks the station and ingredients.</summary>
        public static event Action<string> CraftRequested;
        public static event Action CraftCancelRequested;
        public static event Action<int> SelectHotbarRequested;

        public static void RequestUse(int slot) => UseSlotRequested?.Invoke(slot);
        public static void RequestDrop(int slot) => DropSlotRequested?.Invoke(slot);
        public static void RequestCraft(string recipeId) => CraftRequested?.Invoke(recipeId);
        public static void RequestCraftCancel() => CraftCancelRequested?.Invoke();
        public static void RequestSelectHotbar(int index) => SelectHotbarRequested?.Invoke(index);

        // The project enters play mode without a domain reload, so statics must be cleared by hand.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Active = false;
            Inventory = null;
            Vitals = null;
            Databank = null;
            Clock = null;
            OxygenCapacity = Vitals.BaseOxygenCapacity;
            InPressurisedZone = false;
            SelectedHotbar = 0;
            PlayerPosition = default;
            CameraYawDeg = 0f;
            Markers.Clear();
            PromptKey = PromptText = PromptDetail = null;
            PromptProgress = ScanProgress = 0f;
            AtFabricator = false;
            CraftingRecipe = null;
            CraftProgress = 0f;
            ObjectiveText = null;
            ObjectiveLog.Clear();
            ObjectiveVersion = 0;
            RoomCode = null;
            Partner = default;
            DatabankEntries.Clear();
            PdaOpen = false;
            ToastRaised = null;
            ScanCompleted = null;
            PdaOpenRequested = null;
            ObjectiveChanged = null;
            UseSlotRequested = null;
            DropSlotRequested = null;
            CraftRequested = null;
            CraftCancelRequested = null;
            SelectHotbarRequested = null;
        }
    }
}
