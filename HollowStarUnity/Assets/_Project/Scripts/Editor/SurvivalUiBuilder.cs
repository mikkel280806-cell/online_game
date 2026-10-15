using HollowStar.Game.UI;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.EditorTools
{
    /// <summary>
    /// Adds the survival HUD and PDA to the open scene: one UIDocument each on the shared PanelSettings
    /// (the lobby is sort order 0, the HUD above the game, the PDA above the HUD).
    /// </summary>
    public static class SurvivalUiBuilder
    {
        private const string UiFolder = "Assets/_Project/UI";

        public static StyleSheet Sheet(string name) => AssetDatabase.LoadAssetAtPath<StyleSheet>($"{UiFolder}/{name}.uss");

        /// <summary>Makes sure fonts exist and the style sheets are imported against them.</summary>
        public static void PrepareAssets()
        {
            UiAssetBuilder.BuildFonts(force: false);
            foreach (string n in new[] { "Theme", "Hud", "Pda", "Lobby" })
                AssetDatabase.ImportAsset($"{UiFolder}/{n}.uss", ImportAssetOptions.ForceUpdate);
        }

        public static void Build()
        {
            // Idempotent: the menu item can be used on a scene that already has them.
            if (Object.FindFirstObjectByType<HudUI>() != null || Object.FindFirstObjectByType<PdaUI>() != null) return;
            PrepareAssets();
            var settings = CoopBuilder.PanelSettingsAsset();

            var hud = new GameObject("HUD");
            var hudDoc = hud.AddComponent<UIDocument>();
            hudDoc.panelSettings = settings;
            hudDoc.sortingOrder = 10;
            var hudUi = hud.AddComponent<HudUI>();
            hudUi.Theme = Sheet("Theme");
            hudUi.Style = Sheet("Hud");

            var pda = new GameObject("PDA");
            var pdaDoc = pda.AddComponent<UIDocument>();
            pdaDoc.panelSettings = settings;
            pdaDoc.sortingOrder = 20;
            var pdaUi = pda.AddComponent<PdaUI>();
            pdaUi.Theme = Sheet("Theme");
            pdaUi.Style = Sheet("Pda");
        }

        [MenuItem("Hollow Star/Add Survival UI To Open Scene")]
        private static void BuildMenu() => Build();
    }
}
