using HollowStar.Core.Survival;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// Vector icons drawn with Painter2D in a 24 x 24 design grid. One per <see cref="GlyphId"/> (items) plus a
    /// few UI-only extras. Each is a faceted fill with a lighter edge, tinted by the caller.
    /// </summary>
    public static class Glyphs
    {
        // UI-only icons, numbered after the item glyphs.
        public const int Thermometer = 100;
        public const int Diamond = 101;
        public const int Check = 102;
        public const int Lock = 103;
        public const int Scan = 104;
        public const int Pda = 105;
        public const int Close = 106;
        public const int Chevron = 107;

        private struct Frame
        {
            public float Ox, Oy, S;
            public Vector2 P(float x, float y) => new Vector2(Ox + x * S, Oy + y * S);
        }

        public static void Draw(Painter2D p, int id, Rect box, Color tint)
        {
            float size = Mathf.Min(box.width, box.height);
            if (size < 2f) return;
            var f = new Frame { S = size / 24f, Ox = box.x + (box.width - size) * 0.5f, Oy = box.y + (box.height - size) * 0.5f };
            p.lineJoin = LineJoin.Round;
            p.lineCap = LineCap.Round;
            switch (id)
            {
                case (int)GlyphId.Crystal: Crystal(p, f, tint); break;
                case (int)GlyphId.Leaf: Leaf(p, f, tint); break;
                case (int)GlyphId.Drop: Drop(p, f, tint); break;
                case (int)GlyphId.Flame: Flame(p, f, tint); break;
                case (int)GlyphId.Bolt: Bolt(p, f, tint); break;
                case (int)GlyphId.Gear: Gear(p, f, tint); break;
                case (int)GlyphId.Tank: Tank(p, f, tint); break;
                case (int)GlyphId.Cross: Cross(p, f, tint); break;
                case (int)GlyphId.Wrench: Wrench(p, f, tint); break;
                case (int)GlyphId.Chip: Chip(p, f, tint); break;
                case Thermometer: Thermo(p, f, tint); break;
                case Diamond: DiamondShape(p, f, tint); break;
                case Check: CheckMark(p, f, tint); break;
                case Lock: LockShape(p, f, tint); break;
                case Scan: ScanShape(p, f, tint); break;
                case Pda: PdaShape(p, f, tint); break;
                case Close: CloseShape(p, f, tint); break;
                case Chevron: ChevronShape(p, f, tint); break;
            }
            UiKit.ClearGradients(p);
        }

        // ---- helpers ----

        private static void Body(Painter2D p, Frame f, Color tint)
        {
            p.fillGradient = UiKit.Linear(f.P(0, 2), f.P(0, 22), (0f, UiKit.Lighten(tint, 0.42f)), (1f, UiKit.Shade(tint, 0.66f)));
        }

        private static void Flat(Painter2D p, Color c)
        {
            p.fillGradient = default;
            p.fillColor = c;
        }

        private static void Edge(Painter2D p, Frame f, Color tint, float width = 1.1f)
        {
            p.strokeGradient = null;
            p.strokeColor = UiKit.Lighten(tint, 0.55f);
            p.lineWidth = width * f.S;
            p.Stroke();
        }

        private static void Poly(Painter2D p, Frame f, params float[] xy)
        {
            p.BeginPath();
            p.MoveTo(f.P(xy[0], xy[1]));
            for (int i = 2; i < xy.Length; i += 2) p.LineTo(f.P(xy[i], xy[i + 1]));
            p.ClosePath();
        }

        private static void Line(Painter2D p, Frame f, float x0, float y0, float x1, float y1, Color c, float width)
        {
            p.strokeGradient = null;
            p.strokeColor = c;
            p.lineWidth = width * f.S;
            p.BeginPath();
            p.MoveTo(f.P(x0, y0));
            p.LineTo(f.P(x1, y1));
            p.Stroke();
        }

        private static Vector2[] HexPoints(Frame f, float cx, float cy, float r)
        {
            var pts = new Vector2[6];
            for (int i = 0; i < 6; i++)
            {
                float a = (-90f + 60f * i) * Mathf.Deg2Rad;
                pts[i] = f.P(cx + Mathf.Cos(a) * r, cy + Mathf.Sin(a) * r);
            }
            return pts;
        }

        // ---- item glyphs ----

        private static void Crystal(Painter2D p, Frame f, Color tint)
        {
            var o = HexPoints(f, 12, 12, 10.4f);
            var n = HexPoints(f, 12, 12, 5.0f);
            p.BeginPath();
            p.MoveTo(o[0]);
            for (int i = 1; i < 6; i++) p.LineTo(o[i]);
            p.ClosePath();
            Body(p, f, tint);
            p.Fill();
            // Facets between the outer and inner hexagon, alternately lit and shadowed.
            for (int i = 0; i < 6; i++)
            {
                int j = (i + 1) % 6;
                p.BeginPath();
                p.MoveTo(o[i]);
                p.LineTo(o[j]);
                p.LineTo(n[j]);
                p.LineTo(n[i]);
                p.ClosePath();
                Flat(p, i % 2 == 0 ? new Color(1f, 1f, 1f, 0.20f) : new Color(0f, 0.02f, 0.06f, 0.26f));
                p.Fill();
            }
            p.BeginPath();
            p.MoveTo(n[0]);
            for (int i = 1; i < 6; i++) p.LineTo(n[i]);
            p.ClosePath();
            Flat(p, new Color(1f, 1f, 1f, 0.30f));
            p.Fill();
            // Facet seams.
            p.strokeGradient = null;
            p.strokeColor = new Color(1f, 1f, 1f, 0.34f);
            p.lineWidth = 0.7f * f.S;
            for (int i = 0; i < 6; i++)
            {
                p.BeginPath();
                p.MoveTo(o[i]);
                p.LineTo(n[i]);
                p.Stroke();
            }
            p.BeginPath();
            p.MoveTo(n[0]);
            for (int i = 1; i < 6; i++) p.LineTo(n[i]);
            p.ClosePath();
            p.Stroke();
            p.BeginPath();
            p.MoveTo(o[0]);
            for (int i = 1; i < 6; i++) p.LineTo(o[i]);
            p.ClosePath();
            Edge(p, f, tint);
        }

        private static void Leaf(Painter2D p, Frame f, Color tint)
        {
            p.BeginPath();
            p.MoveTo(f.P(4.5f, 20f));
            p.BezierCurveTo(f.P(3.2f, 11f), f.P(10.5f, 3f), f.P(20.5f, 3.5f));
            p.BezierCurveTo(f.P(21f, 13f), f.P(14f, 21.5f), f.P(4.5f, 20f));
            p.ClosePath();
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            // Midrib and veins.
            var dark = new Color(0f, 0.05f, 0.08f, 0.38f);
            Line(p, f, 4.5f, 20f, 16.5f, 7.5f, dark, 1.1f);
            Line(p, f, 8.4f, 15.8f, 8.2f, 10.6f, dark, 0.8f);
            Line(p, f, 11.2f, 12.8f, 15.8f, 14.2f, dark, 0.8f);
            Line(p, f, 13.8f, 9.8f, 13.6f, 5.6f, dark, 0.8f);
            Line(p, f, 4.5f, 20f, 2.2f, 22.4f, UiKit.Lighten(tint, 0.4f), 1.6f);
        }

        private static void Drop(Painter2D p, Frame f, Color tint)
        {
            p.BeginPath();
            p.MoveTo(f.P(12f, 2.2f));
            p.BezierCurveTo(f.P(10f, 6f), f.P(5.2f, 10f), f.P(5.2f, 14.8f));
            p.BezierCurveTo(f.P(5.2f, 18.8f), f.P(8.2f, 21.8f), f.P(12f, 21.8f));
            p.BezierCurveTo(f.P(15.8f, 21.8f), f.P(18.8f, 18.8f), f.P(18.8f, 14.8f));
            p.BezierCurveTo(f.P(18.8f, 10f), f.P(14f, 6f), f.P(12f, 2.2f));
            p.ClosePath();
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            // Specular streak on the lit side.
            p.strokeGradient = null;
            p.strokeColor = new Color(1f, 1f, 1f, 0.55f);
            p.lineWidth = 1.5f * f.S;
            p.BeginPath();
            p.MoveTo(f.P(8.2f, 14.6f));
            p.QuadraticCurveTo(f.P(8.2f, 18f), f.P(10.4f, 19.4f));
            p.Stroke();
        }

        private static void Flame(Painter2D p, Frame f, Color tint)
        {
            p.BeginPath();
            p.MoveTo(f.P(12f, 1.8f));
            p.BezierCurveTo(f.P(12.6f, 6.6f), f.P(18.6f, 9.4f), f.P(18.6f, 15.4f));
            p.BezierCurveTo(f.P(18.6f, 19.4f), f.P(15.8f, 22.2f), f.P(12f, 22.2f));
            p.BezierCurveTo(f.P(8.2f, 22.2f), f.P(5.4f, 19.4f), f.P(5.4f, 15.4f));
            p.BezierCurveTo(f.P(5.4f, 12.6f), f.P(6.8f, 10.8f), f.P(8.4f, 9.2f));
            p.BezierCurveTo(f.P(8.6f, 11.4f), f.P(9.6f, 12.6f), f.P(10.8f, 12.8f));
            p.BezierCurveTo(f.P(10.2f, 8.8f), f.P(10.8f, 4.8f), f.P(12f, 1.8f));
            p.ClosePath();
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            p.BeginPath();
            p.MoveTo(f.P(12f, 12.2f));
            p.BezierCurveTo(f.P(13.6f, 14.6f), f.P(15.6f, 15.6f), f.P(15.6f, 18.2f));
            p.BezierCurveTo(f.P(15.6f, 20.2f), f.P(14f, 21.4f), f.P(12f, 21.4f));
            p.BezierCurveTo(f.P(10f, 21.4f), f.P(8.4f, 20.2f), f.P(8.4f, 18.2f));
            p.BezierCurveTo(f.P(8.4f, 16f), f.P(10.8f, 15f), f.P(12f, 12.2f));
            p.ClosePath();
            Flat(p, new Color(1f, 0.93f, 0.7f, 0.92f));
            p.Fill();
        }

        private static void Bolt(Painter2D p, Frame f, Color tint)
        {
            Poly(p, f, 13.8f, 1.6f, 5.2f, 13.4f, 11f, 13.4f, 9.2f, 22.4f, 18.8f, 10f, 12.8f, 10f);
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint, 1.0f);
            // Bright core streak.
            Line(p, f, 12.6f, 5.4f, 9f, 11.6f, new Color(1f, 1f, 1f, 0.5f), 0.9f);
        }

        private static void Gear(Painter2D p, Frame f, Color tint)
        {
            const int teeth = 8;
            const float rootR = 7.4f, tipR = 10.4f;
            p.BeginPath();
            bool first = true;
            for (int k = 0; k < teeth; k++)
            {
                float a = k * (360f / teeth);
                float[] angles = { a - 13f, a - 8f, a + 8f, a + 13f };
                float[] radii = { rootR, tipR, tipR, rootR };
                for (int i = 0; i < 4; i++)
                {
                    float rad = angles[i] * Mathf.Deg2Rad;
                    var pt = f.P(12f + Mathf.Cos(rad) * radii[i], 12f + Mathf.Sin(rad) * radii[i]);
                    if (first) p.MoveTo(pt);
                    else p.LineTo(pt);
                    first = false;
                }
            }
            p.ClosePath();
            // The hub hole: a second subpath cut out with the odd-even rule.
            p.MoveTo(f.P(12f + 3.4f, 12f));
            p.Arc(f.P(12f, 12f), 3.4f * f.S, 0f, 360f);
            p.ClosePath();
            Body(p, f, tint);
            p.Fill(FillRule.OddEven);
            // Edge and hub ring.
            p.BeginPath();
            first = true;
            for (int k = 0; k < teeth; k++)
            {
                float a = k * (360f / teeth);
                float[] angles = { a - 13f, a - 8f, a + 8f, a + 13f };
                float[] radii = { rootR, tipR, tipR, rootR };
                for (int i = 0; i < 4; i++)
                {
                    float rad = angles[i] * Mathf.Deg2Rad;
                    var pt = f.P(12f + Mathf.Cos(rad) * radii[i], 12f + Mathf.Sin(rad) * radii[i]);
                    if (first) p.MoveTo(pt);
                    else p.LineTo(pt);
                    first = false;
                }
            }
            p.ClosePath();
            Edge(p, f, tint, 1.0f);
            p.BeginPath();
            p.Arc(f.P(12f, 12f), 3.4f * f.S, 0f, 360f);
            Edge(p, f, tint, 1.0f);
            p.strokeColor = new Color(1f, 1f, 1f, 0.22f);
            p.lineWidth = 0.8f * f.S;
            p.BeginPath();
            p.Arc(f.P(12f, 12f), 5.6f * f.S, 0f, 360f);
            p.Stroke();
        }

        private static void Tank(Painter2D p, Frame f, Color tint)
        {
            // Cylinder.
            UiKit.RoundedRect(p, f.Ox + 6.6f * f.S, f.Oy + 8f * f.S, 10.8f * f.S, 14.2f * f.S, 4.4f * f.S);
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            // Neck and valve.
            UiKit.RoundedRect(p, f.Ox + 9.8f * f.S, f.Oy + 5f * f.S, 4.4f * f.S, 3.6f * f.S, 0.8f * f.S);
            Flat(p, UiKit.Lighten(tint, 0.25f));
            p.Fill();
            UiKit.RoundedRect(p, f.Ox + 8.2f * f.S, f.Oy + 2.2f * f.S, 7.6f * f.S, 3.2f * f.S, 1.4f * f.S);
            Flat(p, UiKit.Lighten(tint, 0.6f));
            p.Fill();
            // Bands and gloss.
            var band = new Color(0f, 0.05f, 0.1f, 0.40f);
            Line(p, f, 6.8f, 13f, 17.2f, 13f, band, 1.3f);
            Line(p, f, 6.8f, 17f, 17.2f, 17f, band, 1.3f);
            Line(p, f, 9f, 9.8f, 9f, 20f, new Color(1f, 1f, 1f, 0.30f), 1.5f);
        }

        private static void Cross(Painter2D p, Frame f, Color tint)
        {
            UiKit.RoundedRect(p, f.Ox + 2.6f * f.S, f.Oy + 8.6f * f.S, 18.8f * f.S, 6.8f * f.S, 2.4f * f.S);
            Body(p, f, tint);
            p.Fill();
            UiKit.RoundedRect(p, f.Ox + 8.6f * f.S, f.Oy + 2.6f * f.S, 6.8f * f.S, 18.8f * f.S, 2.4f * f.S);
            Body(p, f, tint);
            p.Fill();
            // Outline of the union, then an inner lit plus.
            p.BeginPath();
            p.MoveTo(f.P(11f, 2.6f));
            p.LineTo(f.P(13f, 2.6f));
            p.ArcTo(f.P(15.4f, 2.6f), f.P(15.4f, 5f), 2.4f * f.S);
            p.LineTo(f.P(15.4f, 8.6f));
            p.LineTo(f.P(19f, 8.6f));
            p.ArcTo(f.P(21.4f, 8.6f), f.P(21.4f, 11f), 2.4f * f.S);
            p.LineTo(f.P(21.4f, 13f));
            p.ArcTo(f.P(21.4f, 15.4f), f.P(19f, 15.4f), 2.4f * f.S);
            p.LineTo(f.P(15.4f, 15.4f));
            p.LineTo(f.P(15.4f, 19f));
            p.ArcTo(f.P(15.4f, 21.4f), f.P(13f, 21.4f), 2.4f * f.S);
            p.LineTo(f.P(11f, 21.4f));
            p.ArcTo(f.P(8.6f, 21.4f), f.P(8.6f, 19f), 2.4f * f.S);
            p.LineTo(f.P(8.6f, 15.4f));
            p.LineTo(f.P(5f, 15.4f));
            p.ArcTo(f.P(2.6f, 15.4f), f.P(2.6f, 13f), 2.4f * f.S);
            p.LineTo(f.P(2.6f, 11f));
            p.ArcTo(f.P(2.6f, 8.6f), f.P(5f, 8.6f), 2.4f * f.S);
            p.LineTo(f.P(8.6f, 8.6f));
            p.LineTo(f.P(8.6f, 5f));
            p.ArcTo(f.P(8.6f, 2.6f), f.P(11f, 2.6f), 2.4f * f.S);
            p.ClosePath();
            Edge(p, f, tint);
            Line(p, f, 12f, 6f, 12f, 18f, new Color(1f, 1f, 1f, 0.35f), 1.1f);
            Line(p, f, 6f, 12f, 18f, 12f, new Color(1f, 1f, 1f, 0.35f), 1.1f);
        }

        private static void Wrench(Painter2D p, Frame f, Color tint)
        {
            var light = UiKit.Lighten(tint, 0.2f);
            var mid = UiKit.Shade(tint, 0.85f);
            // Handle.
            Line(p, f, 12.9f, 11.1f, 5.4f, 18.6f, mid, 3.6f);
            Line(p, f, 12.9f, 11.1f, 5.4f, 18.6f, UiKit.Lighten(tint, 0.4f), 0.9f);
            // Open jaw: a ring with a gap facing up-right.
            p.strokeGradient = null;
            p.strokeColor = light;
            p.lineWidth = 3.4f * f.S;
            p.BeginPath();
            p.Arc(f.P(16.2f, 7.8f), 4.2f * f.S, -4f, 274f);
            p.Stroke();
            p.strokeColor = UiKit.Lighten(tint, 0.65f);
            p.lineWidth = 0.9f * f.S;
            p.BeginPath();
            p.Arc(f.P(16.2f, 7.8f), 5.2f * f.S, 40f, 220f);
            p.Stroke();
            // Hang hole.
            Flat(p, new Color(0f, 0.04f, 0.08f, 0.55f));
            p.BeginPath();
            p.Arc(f.P(5.6f, 18.4f), 0.95f * f.S, 0f, 360f);
            p.ClosePath();
            p.Fill();
        }

        private static void Chip(Painter2D p, Frame f, Color tint)
        {
            // Pins.
            p.strokeGradient = null;
            p.strokeColor = UiKit.Lighten(tint, 0.25f);
            p.lineWidth = 1.5f * f.S;
            float[] pos = { 9.6f, 12f, 14.4f };
            foreach (float v in pos)
            {
                Line(p, f, 3.2f, v, 6.8f, v, UiKit.Lighten(tint, 0.25f), 1.5f);
                Line(p, f, 17.2f, v, 20.8f, v, UiKit.Lighten(tint, 0.25f), 1.5f);
                Line(p, f, v, 3.2f, v, 6.8f, UiKit.Lighten(tint, 0.25f), 1.5f);
                Line(p, f, v, 17.2f, v, 20.8f, UiKit.Lighten(tint, 0.25f), 1.5f);
            }
            UiKit.RoundedRect(p, f.Ox + 6.2f * f.S, f.Oy + 6.2f * f.S, 11.6f * f.S, 11.6f * f.S, 2.2f * f.S);
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            // Die and pin-1 marker.
            UiKit.RoundedRect(p, f.Ox + 9.2f * f.S, f.Oy + 9.2f * f.S, 5.6f * f.S, 5.6f * f.S, 0.9f * f.S);
            Flat(p, new Color(0f, 0.04f, 0.08f, 0.35f));
            p.Fill();
            p.strokeColor = new Color(1f, 1f, 1f, 0.55f);
            p.lineWidth = 0.8f * f.S;
            p.Stroke();
            Flat(p, new Color(1f, 1f, 1f, 0.7f));
            p.BeginPath();
            p.Arc(f.P(7.9f, 7.9f), 0.65f * f.S, 0f, 360f);
            p.ClosePath();
            p.Fill();
        }

        // ---- UI-only glyphs ----

        private static void Thermo(Painter2D p, Frame f, Color tint)
        {
            UiKit.RoundedRect(p, f.Ox + 9.4f * f.S, f.Oy + 2.4f * f.S, 5.2f * f.S, 14f * f.S, 2.6f * f.S);
            Flat(p, new Color(1f, 1f, 1f, 0.10f));
            p.Fill();
            p.strokeGradient = null;
            p.strokeColor = UiKit.Lighten(tint, 0.5f);
            p.lineWidth = 1.2f * f.S;
            p.Stroke();
            p.BeginPath();
            p.Arc(f.P(12f, 17.8f), 4.3f * f.S, 0f, 360f);
            p.ClosePath();
            Body(p, f, tint);
            p.Fill();
            p.Stroke();
            Line(p, f, 12f, 8f, 12f, 17.5f, tint, 2.2f);
            Line(p, f, 17.2f, 5f, 19f, 5f, UiKit.Lighten(tint, 0.5f), 1f);
            Line(p, f, 17.2f, 8.4f, 19f, 8.4f, UiKit.Lighten(tint, 0.5f), 1f);
            Line(p, f, 17.2f, 11.8f, 19f, 11.8f, UiKit.Lighten(tint, 0.5f), 1f);
        }

        private static void DiamondShape(Painter2D p, Frame f, Color tint)
        {
            Poly(p, f, 12f, 2f, 21f, 12f, 12f, 22f, 3f, 12f);
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            Poly(p, f, 12f, 2f, 21f, 12f, 12f, 12f);
            Flat(p, new Color(1f, 1f, 1f, 0.24f));
            p.Fill();
        }

        private static void CheckMark(Painter2D p, Frame f, Color tint)
        {
            p.strokeGradient = null;
            p.strokeColor = tint;
            p.lineWidth = 2.6f * f.S;
            p.BeginPath();
            p.MoveTo(f.P(5f, 12.6f));
            p.LineTo(f.P(10f, 17.6f));
            p.LineTo(f.P(19.2f, 6.6f));
            p.Stroke();
        }

        private static void LockShape(Painter2D p, Frame f, Color tint)
        {
            p.strokeGradient = null;
            p.strokeColor = UiKit.Lighten(tint, 0.3f);
            p.lineWidth = 2.2f * f.S;
            p.BeginPath();
            p.MoveTo(f.P(7.6f, 11f));
            p.LineTo(f.P(7.6f, 8f));
            p.Arc(f.P(12f, 8f), 4.4f * f.S, 180f, 360f);
            p.LineTo(f.P(16.4f, 11f));
            p.Stroke();
            UiKit.RoundedRect(p, f.Ox + 4.8f * f.S, f.Oy + 10.6f * f.S, 14.4f * f.S, 10.6f * f.S, 2.6f * f.S);
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint, 1f);
            Flat(p, new Color(0f, 0.04f, 0.08f, 0.6f));
            p.BeginPath();
            p.Arc(f.P(12f, 15.4f), 1.5f * f.S, 0f, 360f);
            p.ClosePath();
            p.Fill();
            Line(p, f, 12f, 15.8f, 12f, 18.4f, new Color(0f, 0.04f, 0.08f, 0.6f), 1.6f);
        }

        private static void ScanShape(Painter2D p, Frame f, Color tint)
        {
            p.strokeGradient = null;
            p.strokeColor = tint;
            p.lineWidth = 1.8f * f.S;
            float a = 3f, b = 9f, c = 15f, d = 21f;
            p.BeginPath(); p.MoveTo(f.P(a, b)); p.LineTo(f.P(a, a)); p.LineTo(f.P(b, a)); p.Stroke();
            p.BeginPath(); p.MoveTo(f.P(c, a)); p.LineTo(f.P(d, a)); p.LineTo(f.P(d, b)); p.Stroke();
            p.BeginPath(); p.MoveTo(f.P(d, c)); p.LineTo(f.P(d, d)); p.LineTo(f.P(c, d)); p.Stroke();
            p.BeginPath(); p.MoveTo(f.P(b, d)); p.LineTo(f.P(a, d)); p.LineTo(f.P(a, c)); p.Stroke();
            Flat(p, tint);
            p.BeginPath();
            p.Arc(f.P(12f, 12f), 2.6f * f.S, 0f, 360f);
            p.ClosePath();
            p.Fill();
        }

        private static void CloseShape(Painter2D p, Frame f, Color tint)
        {
            Line(p, f, 6f, 6f, 18f, 18f, tint, 2.2f);
            Line(p, f, 18f, 6f, 6f, 18f, tint, 2.2f);
        }

        private static void ChevronShape(Painter2D p, Frame f, Color tint)
        {
            p.strokeGradient = null;
            p.strokeColor = tint;
            p.lineWidth = 2.4f * f.S;
            p.BeginPath();
            p.MoveTo(f.P(9f, 5f));
            p.LineTo(f.P(16f, 12f));
            p.LineTo(f.P(9f, 19f));
            p.Stroke();
        }

        private static void PdaShape(Painter2D p, Frame f, Color tint)
        {
            UiKit.RoundedRect(p, f.Ox + 5.4f * f.S, f.Oy + 2.4f * f.S, 13.2f * f.S, 19.2f * f.S, 2.6f * f.S);
            Body(p, f, tint);
            p.Fill();
            Edge(p, f, tint);
            UiKit.RoundedRect(p, f.Ox + 7.8f * f.S, f.Oy + 5f * f.S, 8.4f * f.S, 8.4f * f.S, 1f * f.S);
            Flat(p, new Color(0f, 0.04f, 0.08f, 0.55f));
            p.Fill();
            Line(p, f, 8.4f, 17.4f, 15.6f, 17.4f, new Color(1f, 1f, 1f, 0.4f), 1.3f);
        }
    }

    /// <summary>Draws one glyph, scaled to the element's smaller side.</summary>
    public sealed class GlyphElement : VisualElement
    {
        private int glyph = -1;
        private Color tint = UiKit.Cyan;
        private float glow;

        public int GlyphValue => glyph;

        public GlyphElement()
        {
            pickingMode = PickingMode.Ignore;
            generateVisualContent += OnGenerate;
            AddToClassList("hs-glyph");
        }

        public GlyphElement(GlyphId id, Color tint, float glow = 0f) : this()
        {
            Set((int)id, tint, glow);
        }

        public GlyphElement(int id, Color tint, float glow = 0f) : this()
        {
            Set(id, tint, glow);
        }

        public void Set(GlyphId id, Color tint, float glow = 0f) => Set((int)id, tint, glow);

        public void Set(int id, Color color, float glowAmount = 0f)
        {
            if (glyph == id && tint == color && Mathf.Approximately(glow, glowAmount)) return;
            glyph = id;
            tint = color;
            glow = glowAmount;
            MarkDirtyRepaint();
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            if (glyph < 0) return;
            var p = mgc.painter2D;
            float w = contentRect.width, h = contentRect.height;
            if (w < 2f || h < 2f) return;
            var box = new Rect(contentRect.x, contentRect.y, w, h);
            if (glow > 0.01f)
            {
                float r = Mathf.Min(w, h) * 0.5f;
                var c = new Vector2(box.center.x, box.center.y);
                p.fillGradient = UiKit.Radial(c, r * 1.9f,
                    (0f, UiKit.WithAlpha(tint, 0.34f * glow)), (0.5f, UiKit.WithAlpha(tint, 0.12f * glow)), (1f, UiKit.WithAlpha(tint, 0f)));
                p.BeginPath();
                p.Arc(c, r * 1.9f, 0f, 360f);
                p.ClosePath();
                p.Fill();
                UiKit.ClearGradients(p);
            }
            Glyphs.Draw(p, glyph, box, tint);
        }
    }
}
