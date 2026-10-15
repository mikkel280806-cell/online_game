using System;
using HollowStar.Core.Survival;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>Design tokens (mirroring Theme.uss) and small helpers shared by the survival UI.</summary>
    public static class UiKit
    {
        public static readonly Color Ink = Hex("#e8eef6");
        public static readonly Color InkDim = Hex("#9aa8bb");
        public static readonly Color Cyan = Hex("#6fe3ff");
        public static readonly Color Amber = Hex("#ffae5c");
        public static readonly Color Danger = Hex("#ff6b6b");
        public static readonly Color Ok = Hex("#5cff9b");
        public static readonly Color Water = Hex("#5aa9ff");
        public static readonly Color Yellow = Hex("#ffd36b");
        public static readonly Color Mint = Hex("#8dff9a");

        public static readonly Color GlassTop = new Color(17f / 255f, 23f / 255f, 37f / 255f, 0.86f);
        public static readonly Color GlassBottom = new Color(8f / 255f, 11f / 255f, 19f / 255f, 0.9f);
        public static readonly Color GlassEdge = new Color(140f / 255f, 200f / 255f, 1f, 0.2f);

        public static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }

        public static Color WithAlpha(Color c, float a) => new Color(c.r, c.g, c.b, a);

        /// <summary>Multiplies the colour channels (alpha untouched).</summary>
        public static Color Shade(Color c, float mul) => new Color(Mathf.Clamp01(c.r * mul), Mathf.Clamp01(c.g * mul), Mathf.Clamp01(c.b * mul), c.a);

        public static Color Lighten(Color c, float t) => new Color(Mathf.Lerp(c.r, 1f, t), Mathf.Lerp(c.g, 1f, t), Mathf.Lerp(c.b, 1f, t), c.a);

        /// <summary>Item category tint used for glyphs and category chips.</summary>
        public static Color CategoryColor(ItemCategory c)
        {
            switch (c)
            {
                case ItemCategory.Raw: return Amber;
                case ItemCategory.Material: return Cyan;
                case ItemCategory.Food: return Hex("#ff8466");
                case ItemCategory.Tool: return Hex("#c3a2ff");
                case ItemCategory.Equipment: return Water;
                case ItemCategory.Consumable: return Ok;
                default: return Ink;
            }
        }

        public static string CategoryName(ItemCategory c)
        {
            switch (c)
            {
                case ItemCategory.Raw: return "RAW";
                case ItemCategory.Material: return "MATERIAL";
                case ItemCategory.Food: return "FOOD";
                case ItemCategory.Tool: return "TOOL";
                case ItemCategory.Equipment: return "EQUIPMENT";
                case ItemCategory.Consumable: return "CONSUMABLE";
                default: return c.ToString().ToUpperInvariant();
            }
        }

        // ---- Element factories ----

        public static VisualElement El(params string[] classes)
        {
            var e = new VisualElement();
            foreach (var c in classes) e.AddToClassList(c);
            return e;
        }

        public static T With<T>(this T e, params string[] classes) where T : VisualElement
        {
            foreach (var c in classes) e.AddToClassList(c);
            return e;
        }

        public static Label Text(string text, params string[] classes)
        {
            var l = new Label(text);
            l.AddToClassList("hs-text");
            foreach (var c in classes) l.AddToClassList(c);
            return l;
        }

        /// <summary>A USS-styled button: a plain element with a label, so no default theme styling fights ours.</summary>
        public static VisualElement Button(string text, Action onClick, params string[] classes)
        {
            var b = new VisualElement { focusable = false };
            b.AddToClassList("hs-btn");
            foreach (var c in classes) b.AddToClassList(c);
            b.Add(new SheenElement());
            var l = new Label(text) { pickingMode = PickingMode.Ignore };
            l.AddToClassList("hs-text");
            l.AddToClassList("hs-btn__text");
            b.Add(l);
            if (onClick != null)
            {
                b.RegisterCallback<ClickEvent>(e =>
                {
                    if (b.enabledInHierarchy) onClick();
                });
            }
            return b;
        }

        public static void SetButtonText(VisualElement button, string text)
        {
            var l = button.Q<Label>(className: "hs-btn__text");
            if (l != null && l.text != text) l.text = text;
        }

        public static void SetText(Label l, string text)
        {
            if (l.text != text) l.text = text;
        }

        public static void Show(VisualElement e, bool on)
        {
            var d = on ? DisplayStyle.Flex : DisplayStyle.None;
            if (e.style.display != d) e.style.display = d;
        }

        public static void SetClass(VisualElement e, string cls, bool on)
        {
            if (e.ClassListContains(cls) != on) e.EnableInClassList(cls, on);
        }

        /// <summary>Makes a subtree transparent to pointer events (HUD overlays must never eat clicks).</summary>
        public static void IgnorePointer(VisualElement root)
        {
            root.pickingMode = PickingMode.Ignore;
            foreach (var child in root.Children()) IgnorePointer(child);
        }

        // ---- Painter helpers ----

        /// <summary>A rounded-rectangle path (not yet filled or stroked).</summary>
        public static void RoundedRect(Painter2D p, float x, float y, float w, float h, float r)
        {
            r = Mathf.Max(0f, Mathf.Min(r, Mathf.Min(w, h) * 0.5f));
            p.BeginPath();
            if (r < 0.01f)
            {
                p.MoveTo(new Vector2(x, y));
                p.LineTo(new Vector2(x + w, y));
                p.LineTo(new Vector2(x + w, y + h));
                p.LineTo(new Vector2(x, y + h));
                p.ClosePath();
                return;
            }
            p.MoveTo(new Vector2(x + r, y));
            p.LineTo(new Vector2(x + w - r, y));
            p.ArcTo(new Vector2(x + w, y), new Vector2(x + w, y + r), r);
            p.LineTo(new Vector2(x + w, y + h - r));
            p.ArcTo(new Vector2(x + w, y + h), new Vector2(x + w - r, y + h), r);
            p.LineTo(new Vector2(x + r, y + h));
            p.ArcTo(new Vector2(x, y + h), new Vector2(x, y + h - r), r);
            p.LineTo(new Vector2(x, y + r));
            p.ArcTo(new Vector2(x, y), new Vector2(x + r, y), r);
            p.ClosePath();
        }

        public static Gradient MakeGradient(params (float t, Color c)[] stops)
        {
            var colors = new GradientColorKey[stops.Length];
            var alphas = new GradientAlphaKey[stops.Length];
            for (int i = 0; i < stops.Length; i++)
            {
                colors[i] = new GradientColorKey(new Color(stops[i].c.r, stops[i].c.g, stops[i].c.b, 1f), stops[i].t);
                alphas[i] = new GradientAlphaKey(stops[i].c.a, stops[i].t);
            }
            var g = new Gradient();
            g.SetKeys(colors, alphas);
            return g;
        }

        public static FillGradient Linear(Vector2 a, Vector2 b, params (float t, Color c)[] stops) =>
            FillGradient.MakeLinearGradient(MakeGradient(stops), a, b);

        public static FillGradient Radial(Vector2 center, float radius, params (float t, Color c)[] stops) =>
            FillGradient.MakeRadialGradient(MakeGradient(stops), center, radius, center, UnityEngine.UIElements.AddressMode.Clamp);

        /// <summary>Resets fill and stroke back to flat colours after a gradient pass.</summary>
        public static void ClearGradients(Painter2D p)
        {
            p.strokeGradient = null;
            p.fillGradient = default;
        }
    }
}
