using HollowStar.Game.UI;
using UnityEditor;

namespace HollowStar.EditorTools
{
    /// <summary>Hollow Star > UI Preview: in play mode, toggles the fake-data driver that shows the HUD and PDA.</summary>
    public static class UiPreviewMenu
    {
        private const string Path = "Hollow Star/UI Preview";

        [MenuItem(Path)]
        private static void Toggle() => UiPreview.Toggle(!UiPreview.Running);

        [MenuItem(Path, true)]
        private static bool Validate()
        {
            Menu.SetChecked(Path, UiPreview.Running);
            return EditorApplication.isPlaying;
        }
    }
}
