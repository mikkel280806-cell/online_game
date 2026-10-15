using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// Tinted dark glass, painted with Painter2D: soft drop shadow, a vertical gradient with a faint cyan
    /// highlight at the top, a thin cool edge and an inner top highlight, plus an optional outer glow. Children
    /// lay out normally on top. Replaces the web version's CSS panel (no backdrop blur).
    /// </summary>
    public sealed class GlassPanel : VisualElement
    {
        public enum Look { Panel, Slot, Chip, Plain }

        private Color top = UiKit.GlassTop, bottom = UiKit.GlassBottom, edge = UiKit.GlassEdge;
        private Color baseEdge = UiKit.GlassEdge, glowColor = UiKit.Cyan;
        private float radius = 14f, shadow = 1f, highlight = 0.07f, glow, emphasis, emphasisTarget;
        private IVisualElementScheduledItem tween;

        public GlassPanel(Look look = Look.Panel)
        {
            pickingMode = PickingMode.Position;
            switch (look)
            {
                case Look.Slot:
                    top = new Color(0.085f, 0.115f, 0.18f, 0.80f);
                    bottom = new Color(0.04f, 0.056f, 0.095f, 0.86f);
                    baseEdge = edge = new Color(0.55f, 0.78f, 1f, 0.16f);
                    radius = 10f;
                    shadow = 0f;
                    highlight = 0.04f;
                    break;
                case Look.Chip:
                    radius = 10f;
                    shadow = 0.55f;
                    highlight = 0.05f;
                    break;
                case Look.Plain:
                    top = new Color(0.05f, 0.07f, 0.11f, 0.55f);
                    bottom = new Color(0.03f, 0.04f, 0.07f, 0.6f);
                    baseEdge = edge = new Color(0.55f, 0.78f, 1f, 0.12f);
                    radius = 8f;
                    shadow = 0f;
                    highlight = 0f;
                    break;
            }
            AddToClassList("hs-glass");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        public float Radius
        {
            get => radius;
            set { radius = value; MarkDirtyRepaint(); }
        }

        public Color EdgeColor
        {
            get => baseEdge;
            set { baseEdge = value; MarkDirtyRepaint(); }
        }

        public float Glow
        {
            get => glow;
            set
            {
                if (Mathf.Approximately(glow, value)) return;
                glow = value;
                MarkDirtyRepaint();
            }
        }

        public Color GlowColor
        {
            get => glowColor;
            set { glowColor = value; MarkDirtyRepaint(); }
        }

        /// <summary>0..1: how lit the panel is (hover, selection). Brightens the edge and adds a cyan wash.</summary>
        public float Emphasis
        {
            get => emphasis;
            set
            {
                emphasis = emphasisTarget = value;
                MarkDirtyRepaint();
            }
        }

        /// <summary>Eases <see cref="Emphasis"/> to a value over ~120 ms.</summary>
        public void AnimateEmphasis(float target)
        {
            emphasisTarget = target;
            if (tween == null)
            {
                tween = schedule.Execute(() =>
                {
                    emphasis = Mathf.MoveTowards(emphasis, emphasisTarget, 0.14f);
                    MarkDirtyRepaint();
                    if (Mathf.Approximately(emphasis, emphasisTarget)) tween.Pause();
                }).Every(16);
            }
            else
            {
                tween.Resume();
            }
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 2f || h < 2f) return;
            var p = mgc.painter2D;
            float r = radius;

            // Soft drop shadow: stacked, expanding, ever fainter rounded rects.
            if (shadow > 0.01f)
            {
                const int layers = 12;
                for (int i = layers; i >= 1; i--)
                {
                    float k = 1f - (i - 1f) / layers;
                    float spread = i * 2.6f * shadow;
                    p.fillGradient = default;
                    p.fillColor = new Color(0f, 0f, 0f, 0.055f * k * k * shadow);
                    UiKit.RoundedRect(p, -spread, 6f * shadow - spread + 4f, w + spread * 2f, h + spread * 2f, r + spread);
                    p.Fill();
                }
            }

            // Outer glow.
            if (glow > 0.01f)
            {
                const int layers = 9;
                for (int i = layers; i >= 1; i--)
                {
                    float k = 1f - (i - 1f) / layers;
                    float spread = i * 1.9f;
                    p.fillGradient = default;
                    p.fillColor = new Color(glowColor.r, glowColor.g, glowColor.b, 0.15f * k * k * glow);
                    UiKit.RoundedRect(p, -spread, -spread, w + spread * 2f, h + spread * 2f, r + spread);
                    p.Fill();
                }
            }

            // Body: vertical glass gradient.
            UiKit.RoundedRect(p, 0f, 0f, w, h, r);
            p.fillGradient = UiKit.Linear(new Vector2(0f, 0f), new Vector2(0f, h), (0f, top), (1f, bottom));
            p.Fill();

            // Faint cyan radial highlight at the top.
            float hl = highlight + 0.06f * emphasis;
            if (hl > 0.001f)
            {
                var c = new Vector2(w * 0.5f, 0f);
                float rad = Mathf.Max(24f, Mathf.Max(h * 0.95f, Mathf.Min(w * 0.6f, 420f)));
                UiKit.RoundedRect(p, 0f, 0f, w, h, r);
                p.fillGradient = UiKit.Radial(c, rad,
                    (0f, new Color(0.435f, 0.89f, 1f, hl)), (0.45f, new Color(0.435f, 0.89f, 1f, hl * 0.42f)),
                    (0.8f, new Color(0.435f, 0.89f, 1f, hl * 0.08f)), (1f, new Color(0.435f, 0.89f, 1f, 0f)));
                p.Fill();
            }

            // Edge: 1 px cool line, plus a dark inner keyline for depth.
            p.strokeGradient = null;
            p.lineWidth = 1f;
            Color e = Color.Lerp(baseEdge, UiKit.WithAlpha(UiKit.Cyan, 0.85f), emphasis);
            p.strokeColor = e;
            UiKit.RoundedRect(p, 0.5f, 0.5f, w - 1f, h - 1f, Mathf.Max(0f, r - 0.5f));
            p.Stroke();
            if (shadow > 0.01f)
            {
                p.strokeColor = new Color(0f, 0f, 0f, 0.22f);
                UiKit.RoundedRect(p, 1.5f, 1.5f, w - 3f, h - 3f, Mathf.Max(0f, r - 1.5f));
                p.Stroke();
            }

            // Inner top highlight.
            if (w > r * 2f + 8f)
            {
                p.strokeGradient = null;
                p.strokeColor = new Color(1f, 1f, 1f, 0.07f + 0.05f * emphasis);
                p.lineWidth = 1f;
                p.BeginPath();
                p.MoveTo(new Vector2(r * 0.7f, 1.5f));
                p.LineTo(new Vector2(w - r * 0.7f, 1.5f));
                p.Stroke();
            }
        }
    }

    /// <summary>A soft vertical sheen laid over a button or chip, rounded like its parent.</summary>
    public sealed class SheenElement : VisualElement
    {
        public SheenElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("hs-sheen");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 2f || h < 2f || parent == null) return;
            float r = Mathf.Max(0f, parent.resolvedStyle.borderTopLeftRadius - parent.resolvedStyle.borderTopWidth);
            var p = mgc.painter2D;
            UiKit.RoundedRect(p, 0f, 0f, w, h, r);
            p.fillGradient = UiKit.Linear(new Vector2(0f, 0f), new Vector2(0f, h * 0.9f),
                (0f, new Color(1f, 1f, 1f, 0.10f)), (0.5f, new Color(1f, 1f, 1f, 0.025f)), (1f, new Color(1f, 1f, 1f, 0f)));
            p.Fill();
            UiKit.ClearGradients(p);
        }
    }

    /// <summary>
    /// A thin gradient bar. The gradient is anchored to the whole track (so a health bar is red where it is
    /// low and green where it is high), with a glossy top, a glowing head and an optional danger pulse.
    /// In needle mode it draws the full gradient dimmed with a marker instead of a fill (body temperature).
    /// </summary>
    public sealed class BarElement : VisualElement
    {
        private (float t, Color c)[] stops = { (0f, UiKit.Cyan), (1f, UiKit.Cyan) };
        private float value = 1f, pulse;
        private bool needle;
        private float safeFrom = -1f, safeTo = -1f;

        public BarElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("hs-bar");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        public float Value
        {
            get => value;
            set
            {
                value = Mathf.Clamp01(value);
                if (Mathf.Abs(this.value - value) < 0.0004f) return;
                this.value = value;
                MarkDirtyRepaint();
            }
        }

        public float Pulse
        {
            get => pulse;
            set
            {
                if (Mathf.Abs(pulse - value) < 0.004f) return;
                pulse = value;
                MarkDirtyRepaint();
            }
        }

        public bool Needle
        {
            get => needle;
            set { needle = value; MarkDirtyRepaint(); }
        }

        public void SetSafeZone(float from, float to)
        {
            safeFrom = from;
            safeTo = to;
            MarkDirtyRepaint();
        }

        public void SetStops(params (float t, Color c)[] s)
        {
            stops = s;
            MarkDirtyRepaint();
        }

        private (float t, Color c)[] Stops()
        {
            if (pulse < 0.01f) return stops;
            var s = new (float t, Color c)[stops.Length];
            for (int i = 0; i < s.Length; i++) s[i] = (stops[i].t, Color.Lerp(stops[i].c, UiKit.Danger, pulse * 0.75f));
            return s;
        }

        private Color Sample(float t)
        {
            var s = Stops();
            if (t <= s[0].t) return s[0].c;
            for (int i = 1; i < s.Length; i++)
            {
                if (t <= s[i].t)
                {
                    float k = Mathf.InverseLerp(s[i - 1].t, s[i].t, t);
                    return Color.Lerp(s[i - 1].c, s[i].c, k);
                }
            }
            return s[s.Length - 1].c;
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 4f || h < 1f) return;
            var p = mgc.painter2D;
            float r = h * 0.5f;

            // Track.
            UiKit.RoundedRect(p, 0f, 0f, w, h, r);
            if (needle)
            {
                var dim = new (float t, Color c)[stops.Length];
                for (int i = 0; i < dim.Length; i++) dim[i] = (stops[i].t, UiKit.WithAlpha(UiKit.Shade(stops[i].c, 0.8f), 0.62f));
                p.fillGradient = UiKit.Linear(new Vector2(0f, 0f), new Vector2(w, 0f), dim);
            }
            else
            {
                p.fillGradient = default;
                p.fillColor = new Color(1f, 1f, 1f, 0.10f);
            }
            p.Fill();
            // Inner shade along the top of the track.
            UiKit.RoundedRect(p, 0f, 0f, w, h, r);
            p.fillGradient = UiKit.Linear(new Vector2(0f, 0f), new Vector2(0f, h),
                (0f, new Color(0f, 0f, 0f, 0.30f)), (0.55f, new Color(0f, 0f, 0f, 0f)));
            p.Fill();

            if (needle)
            {
                if (safeFrom >= 0f)
                {
                    p.fillGradient = default;
                    p.strokeGradient = null;
                    p.strokeColor = new Color(1f, 1f, 1f, 0.55f);
                    p.lineWidth = 1f;
                    foreach (float s in new[] { safeFrom, safeTo })
                    {
                        float x = Mathf.Round(w * s) + 0.5f;
                        p.BeginPath();
                        p.MoveTo(new Vector2(x, h + 1.5f));
                        p.LineTo(new Vector2(x, h + 4.5f));
                        p.Stroke();
                    }
                }
                float nx = Mathf.Clamp(w * value, 2f, w - 2f);
                var c = Sample(value);
                p.strokeGradient = null;
                p.lineCap = LineCap.Round;
                foreach (var (width, alpha) in new[] { (7f, 0.07f), (5f, 0.10f), (3.6f, 0.16f) })
                {
                    p.strokeColor = UiKit.WithAlpha(Color.Lerp(c, Color.white, 0.5f), alpha);
                    p.lineWidth = width;
                    p.BeginPath();
                    p.MoveTo(new Vector2(nx, -2f));
                    p.LineTo(new Vector2(nx, h + 2f));
                    p.Stroke();
                }
                UiKit.RoundedRect(p, nx - 1.4f, -3f, 2.8f, h + 6f, 1.4f);
                p.fillGradient = default;
                p.fillColor = new Color(1f, 1f, 1f, 0.96f);
                p.Fill();
                return;
            }

            float fw = w * value;
            if (fw < 0.6f) return;
            var head = Sample(value);
            // Neon glow around the fill: a few fat, faint, round-capped strokes behind it.
            float x0 = r, x1 = Mathf.Max(r, fw - r);
            p.strokeGradient = null;
            p.lineCap = LineCap.Round;
            foreach (var (width, alpha) in new[] { (h + 9f, 0.06f), (h + 6f, 0.08f), (h + 3f, 0.11f) })
            {
                p.strokeColor = UiKit.WithAlpha(head, alpha);
                p.lineWidth = width;
                p.BeginPath();
                p.MoveTo(new Vector2(x0, h * 0.5f));
                p.LineTo(new Vector2(x1, h * 0.5f));
                p.Stroke();
            }
            // Fill, gradient anchored to the full track.
            UiKit.RoundedRect(p, 0f, 0f, fw, h, Mathf.Min(r, fw * 0.5f));
            p.fillGradient = UiKit.Linear(new Vector2(0f, 0f), new Vector2(w, 0f), Stops());
            p.Fill();
            // Glossy top half.
            UiKit.RoundedRect(p, 0f, 0f, fw, h, Mathf.Min(r, fw * 0.5f));
            p.fillGradient = UiKit.Linear(new Vector2(0f, 0f), new Vector2(0f, h),
                (0f, new Color(1f, 1f, 1f, 0.34f)), (0.5f, new Color(1f, 1f, 1f, 0.06f)), (1f, new Color(0f, 0f, 0f, 0.10f)));
            p.Fill();
            // Bright head cap.
            if (fw > h)
            {
                UiKit.RoundedRect(p, fw - 3f, 0.5f, 3f, h - 1f, 1.5f);
                p.fillGradient = default;
                p.fillColor = UiKit.WithAlpha(Color.Lerp(head, Color.white, 0.7f), 0.85f);
                p.Fill();
            }
            UiKit.ClearGradients(p);
        }
    }

    /// <summary>The scan reticle: a ring of ticks that light up clockwise as V is held.</summary>
    public sealed class RingElement : VisualElement
    {
        private float progress;

        public RingElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("hs-ring");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        public float Progress
        {
            get => progress;
            set
            {
                value = Mathf.Clamp01(value);
                if (Mathf.Abs(progress - value) < 0.002f) return;
                progress = value;
                MarkDirtyRepaint();
            }
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float size = Mathf.Min(layout.width, layout.height);
            if (size < 8f) return;
            var p = mgc.painter2D;
            var c = new Vector2(layout.width * 0.5f, layout.height * 0.5f);
            float outer = size * 0.5f - 6f;
            const int ticks = 48;

            // Faint guide ring.
            p.strokeGradient = null;
            p.strokeColor = new Color(1f, 1f, 1f, 0.10f);
            p.lineWidth = 1f;
            p.BeginPath();
            p.Arc(c, outer - 11f, 0f, 360f);
            p.Stroke();

            // Glow behind the lit arc.
            if (progress > 0.01f)
            {
                p.strokeColor = UiKit.WithAlpha(UiKit.Cyan, 0.10f);
                p.lineWidth = 12f;
                p.BeginPath();
                p.Arc(c, outer - 5f, -90f, -90f + 360f * progress);
                p.Stroke();
                p.strokeColor = UiKit.WithAlpha(UiKit.Cyan, 0.16f);
                p.lineWidth = 6f;
                p.BeginPath();
                p.Arc(c, outer - 5f, -90f, -90f + 360f * progress);
                p.Stroke();
            }

            p.lineCap = LineCap.Round;
            for (int i = 0; i < ticks; i++)
            {
                float a = (-90f + 360f * i / ticks) * Mathf.Deg2Rad;
                bool major = i % 4 == 0;
                float len = major ? 11f : 7f;
                bool lit = (i + 0.5f) / ticks <= progress;
                p.strokeColor = lit ? UiKit.Lighten(UiKit.Cyan, 0.25f) : new Color(1f, 1f, 1f, major ? 0.38f : 0.22f);
                p.lineWidth = major ? 2.4f : 1.8f;
                var dir = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
                p.BeginPath();
                p.MoveTo(c + dir * (outer - len));
                p.LineTo(c + dir * outer);
                p.Stroke();
            }
        }
    }
}

namespace HollowStar.Game.UI
{
    /// <summary>The centre dot. It swells and turns cyan with a faint ring when something can be interacted with.</summary>
    public sealed class CrosshairElement : VisualElement
    {
        private float amount, target;
        private IVisualElementScheduledItem tween;

        public CrosshairElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("hud-xhair");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        public bool Active
        {
            set
            {
                float t = value ? 1f : 0f;
                if (Mathf.Approximately(target, t)) return;
                target = t;
                tween ??= schedule.Execute(() =>
                {
                    amount = Mathf.MoveTowards(amount, target, 0.12f);
                    MarkDirtyRepaint();
                    if (Mathf.Approximately(amount, target)) tween.Pause();
                }).Every(16);
                tween.Resume();
            }
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            var p = mgc.painter2D;
            var c = new Vector2(layout.width * 0.5f, layout.height * 0.5f);
            p.fillGradient = default;
            p.strokeGradient = null;
            // Dark halo keeps the dot readable on bright sky.
            p.fillColor = new Color(0f, 0f, 0f, 0.28f);
            p.BeginPath();
            p.Arc(c, 4.6f + 1.5f * amount, 0f, 360f);
            p.ClosePath();
            p.Fill();
            if (amount > 0.01f)
            {
                p.strokeColor = UiKit.WithAlpha(UiKit.Cyan, 0.75f * amount);
                p.lineWidth = 1.5f;
                p.BeginPath();
                p.Arc(c, 8f + 3f * amount, 0f, 360f);
                p.Stroke();
            }
            p.fillColor = Color.Lerp(new Color(1f, 1f, 1f, 0.95f), UiKit.Cyan, amount);
            p.BeginPath();
            p.Arc(c, 2.6f + 0.9f * amount, 0f, 360f);
            p.ClosePath();
            p.Fill();
        }
    }
}
