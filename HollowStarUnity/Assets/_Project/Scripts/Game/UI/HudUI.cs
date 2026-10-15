using System.Collections.Generic;
using HollowStar.Core.Survival;
using HollowStar.Game.Survival;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// The survival HUD, built in code on its own UIDocument. It only reads <see cref="SurvivorHub"/> state and
    /// reacts to its events; hidden while no local survivor exists. Layout is for a 1920 x 1080 reference.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class HudUI : MonoBehaviour
    {
        public StyleSheet Theme;
        public StyleSheet Style;

        private const float ToastSeconds = 3f;
        private const int MaxToasts = 5;
        private const float ScanCardSeconds = 6f;
        private const float PulsePeriod = 1.2f;

        private sealed class VitalRow
        {
            public VisualElement Root;
            public GlyphElement Glyph;
            public Label Name, Value;
            public BarElement Bar;
            public Color GlyphColor;
            public float Shown = -1f;
            public bool Low;
        }

        private sealed class SlotView
        {
            public GlassPanel Panel;
            public GlyphElement Glyph;
            public Label Count, Key;
        }

        private VisualElement root, hud, toasts, hotbarCaptionRow;
        private GlassPanel objective, session, vitals, prompt, scanCard;
        private Label objectiveText, sessionCode, partnerName, partnerDown, clockLabel, zoneLabel;
        private Label promptText, promptDetail, promptKey, hotbarCaption, hotbarCaptionHint;
        private BarElement promptBar, partnerHp, partnerO2;
        private VisualElement partnerRow, roomRow, partnerBars;
        private CrosshairElement crosshair;
        private RingElement ring;
        private CompassElement compass;
        private Label heading;
        private VisualElement death;
        private Label deathTitle, deathCount;
        private readonly VitalRow[] rows = new VitalRow[5];
        private readonly SlotView[] slots = new SlotView[Inventory.HotbarSize];

        // Scan card parts.
        private GlyphElement scanGlyph;
        private Label scanTitle, scanDesc;
        private VisualElement scanYields, scanChip;
        private Label scanChipText;
        private float scanHideAt = -1f;

        private int shownInventoryVersion = -1, shownHotbar = -1, shownObjectiveVersion = -1;
        private Inventory shownInventory;
        private string shownObjective;
        private float objectivePulseStart = -10f;
        private bool shownDead;
        private int shownDeathSecond = -1;

        private void OnEnable()
        {
            SurvivorHub.ToastRaised += OnToast;
            SurvivorHub.ScanCompleted += OnScan;
            SurvivorHub.ObjectiveChanged += OnObjectiveChanged;
        }

        private void OnDisable()
        {
            SurvivorHub.ToastRaised -= OnToast;
            SurvivorHub.ScanCompleted -= OnScan;
            SurvivorHub.ObjectiveChanged -= OnObjectiveChanged;
        }

        private void Start()
        {
            var doc = GetComponent<UIDocument>();
            root = doc.rootVisualElement;
            root.style.flexGrow = 1;
            root.pickingMode = PickingMode.Ignore;
            if (Theme != null) root.styleSheets.Add(Theme);
            if (Style != null) root.styleSheets.Add(Style);
            root.AddToClassList("hs-root");

            hud = UiKit.El("hud");
            root.Add(hud);
            BuildTopLeft();
            BuildCompass();
            BuildToasts();
            BuildScanCard();
            BuildCentre();
            BuildVitals();
            BuildHotbar();
            BuildDeath();
            UiKit.IgnorePointer(hud);
            UiKit.Show(hud, false);
        }

        // ------------------------------------------------------------------ build

        private void BuildTopLeft()
        {
            var col = UiKit.El("hud-topleft");
            hud.Add(col);

            objective = new GlassPanel();
            objective.AddToClassList("hud-objective");
            var head = UiKit.El("hud-objective__head");
            head.Add(new GlyphElement(GlyphId.Crystal, UiKit.Cyan).With("hud-objective__icon"));
            head.Add(UiKit.Text("OBJECTIVE", "caps", "caps--cyan"));
            objective.Add(head);
            objectiveText = UiKit.Text("", "hud-objective__text", "wrap");
            objective.Add(objectiveText);
            col.Add(objective);

            session = new GlassPanel(GlassPanel.Look.Chip);
            session.AddToClassList("hud-session");
            roomRow = UiKit.El("hud-session__row");
            roomRow.Add(UiKit.El("hud-dot"));
            roomRow.Add(UiKit.Text("ROOM", "caps"));
            sessionCode = UiKit.Text("", "hud-session__code");
            roomRow.Add(sessionCode);
            session.Add(roomRow);

            partnerRow = UiKit.El("hud-session__row", "hud-partner");
            partnerName = UiKit.Text("", "caps", "hud-partner__name");
            partnerRow.Add(partnerName);
            partnerBars = UiKit.El("hud-partner__bars");
            partnerHp = new BarElement().With("hud-partner__bar");
            partnerHp.SetStops((0f, UiKit.Danger), (0.6f, UiKit.Yellow), (1f, UiKit.Mint));
            partnerO2 = new BarElement().With("hud-partner__bar");
            partnerO2.SetStops((0f, Hex("#38b6e6")), (1f, Hex("#8af0ff")));
            var hpLabel = UiKit.Text("HP", "hud-partner__tag");
            var o2Label = UiKit.Text("O2", "hud-partner__tag");
            partnerBars.Add(hpLabel);
            partnerBars.Add(partnerHp);
            partnerBars.Add(o2Label);
            partnerBars.Add(partnerO2);
            partnerRow.Add(partnerBars);
            partnerDown = UiKit.Text("DOWN", "caps", "caps--danger");
            partnerRow.Add(partnerDown);
            session.Add(partnerRow);
            col.Add(session);
        }

        private void BuildCompass()
        {
            var wrap = UiKit.El("hud-compass-wrap");
            hud.Add(wrap);
            var panel = new GlassPanel(GlassPanel.Look.Chip);
            panel.AddToClassList("hud-compass");
            compass = new CompassElement();
            panel.Add(compass);
            wrap.Add(panel);
            heading = UiKit.Text("000°", "hud-heading");
            wrap.Add(heading);
        }

        private void BuildToasts()
        {
            toasts = UiKit.El("hud-toasts");
            hud.Add(toasts);
        }

        private void BuildScanCard()
        {
            var wrap = UiKit.El("hud-scan-wrap");
            hud.Add(wrap);
            scanCard = new GlassPanel { Glow = 0.55f };
            scanCard.AddToClassList("hud-scan");
                        var label = UiKit.El("hud-scan__head");
            label.Add(new GlyphElement(Glyphs.Scan, UiKit.Cyan).With("hud-scan__headicon"));
            label.Add(UiKit.Text("SCAN COMPLETE", "caps", "caps--cyan"));
            scanCard.Add(label);

            var row = UiKit.El("hud-scan__row");
            var badge = new GlassPanel(GlassPanel.Look.Slot) { Glow = 0.4f };
            badge.AddToClassList("hud-scan__badge");
            scanGlyph = new GlyphElement().With("hud-scan__glyph");
            badge.Add(scanGlyph);
            row.Add(badge);
            var titleCol = UiKit.El("hud-scan__titlecol");
            scanTitle = UiKit.Text("", "hud-scan__title");
            titleCol.Add(scanTitle);
            scanChip = UiKit.El("chip", "hud-scan__chip");
            scanChipText = UiKit.Text("", "hud-scan__chiptext");
            scanChip.Add(scanChipText);
            titleCol.Add(scanChip);
            row.Add(titleCol);
            scanCard.Add(row);

            scanDesc = UiKit.Text("", "hud-scan__desc", "wrap");
            scanCard.Add(scanDesc);
            scanYields = UiKit.El("hud-scan__yields");
            scanCard.Add(scanYields);
            wrap.Add(scanCard);
        }

        private void BuildCentre()
        {
            crosshair = new CrosshairElement();
            hud.Add(crosshair);
            ring = new RingElement();
            ring.AddToClassList("hud-reticle");
            hud.Add(ring);

            var wrap = UiKit.El("hud-prompt-wrap");
            hud.Add(wrap);
            prompt = new GlassPanel(GlassPanel.Look.Chip);
            prompt.AddToClassList("hud-prompt");
            prompt.AddToClassList("slide-in");
            var row = UiKit.El("hud-prompt__row");
            promptKey = UiKit.Text("F", "keycap");
            row.Add(promptKey);
            promptText = UiKit.Text("", "hud-prompt__text");
            row.Add(promptText);
            prompt.Add(row);
            promptDetail = UiKit.Text("", "hud-prompt__detail");
            prompt.Add(promptDetail);
            promptBar = new BarElement().With("hud-prompt__bar");
            promptBar.SetStops((0f, Hex("#38b6e6")), (1f, Hex("#8af0ff")));
            prompt.Add(promptBar);
            wrap.Add(prompt);
        }

        private void BuildVitals()
        {
            vitals = new GlassPanel();
            vitals.AddToClassList("hud-vitals");
            var head = UiKit.El("hud-vitals__head");
            clockLabel = UiKit.Text("DAY 1  09:00", "hud-vitals__clock");
            head.Add(clockLabel);
            zoneLabel = UiKit.Text("", "hud-vitals__zone");
            head.Add(zoneLabel);
            vitals.Add(head);
            hud.Add(vitals);

            rows[0] = MakeRow("OXYGEN", GlyphId.Tank, UiKit.Cyan, (0f, Hex("#2aa6d8")), (1f, Hex("#8af0ff")));
            rows[1] = MakeRow("FOOD", GlyphId.Flame, UiKit.Amber, (0f, Hex("#ff8338")), (1f, Hex("#ffc874")));
            rows[2] = MakeRow("WATER", GlyphId.Drop, UiKit.Water, (0f, Hex("#3a7cf5")), (1f, Hex("#86ccff")));
            rows[3] = MakeRow("TEMP", GlyphId.Bolt, Hex("#d6f0ff"),
                (0f, Hex("#4d8dff")), (0.35f, Hex("#9ad8ff")), (0.5f, Hex("#f4fbff")), (0.65f, Hex("#ffc58a")), (1f, Hex("#ff4d3d")));
            rows[3].Glyph.Set(Glyphs.Thermometer, Hex("#d6f0ff"));
            rows[3].Bar.Needle = true;
            rows[3].Bar.SetSafeZone((Vitals.ColdThresholdC - 30f) / 14f, (Vitals.HeatThresholdC - 30f) / 14f);
            rows[4] = MakeRow("HEALTH", GlyphId.Cross, Hex("#ff7d7d"),
                (0f, UiKit.Danger), (0.6f, UiKit.Yellow), (1f, UiKit.Mint));
        }

        private VitalRow MakeRow(string label, GlyphId glyph, Color tint, params (float t, Color c)[] stops)
        {
            var r = new VitalRow { GlyphColor = tint };
            r.Root = UiKit.El("hud-vital");
            r.Glyph = new GlyphElement(glyph, tint, 0.0f).With("hud-vital__glyph");
            r.Name = UiKit.Text(label, "caps", "hud-vital__name");
            r.Bar = new BarElement().With("hud-vital__bar");
            r.Bar.SetStops(stops);
            r.Value = UiKit.Text("100", "hud-vital__value");
            r.Root.Add(r.Glyph);
            r.Root.Add(r.Name);
            r.Root.Add(r.Bar);
            r.Root.Add(r.Value);
            vitals.Add(r.Root);
            return r;
        }

        private void BuildHotbar()
        {
            var wrap = UiKit.El("hud-hotbar-wrap");
            hud.Add(wrap);
            hotbarCaptionRow = UiKit.El("hud-hotbar__caption-row");
            hotbarCaption = UiKit.Text("", "hud-hotbar__caption");
            hotbarCaptionHint = UiKit.Text("", "caps", "hud-hotbar__hint");
            hotbarCaptionRow.Add(hotbarCaption);
            hotbarCaptionRow.Add(hotbarCaptionHint);
            wrap.Add(hotbarCaptionRow);
            var bar = UiKit.El("hud-hotbar");
            wrap.Add(bar);
            for (int i = 0; i < slots.Length; i++)
            {
                var s = new SlotView();
                s.Panel = new GlassPanel(GlassPanel.Look.Slot);
                s.Panel.AddToClassList("hud-slot");
                s.Key = UiKit.Text((i + 1).ToString(), "hud-slot__key");
                s.Glyph = new GlyphElement().With("hud-slot__glyph");
                s.Count = UiKit.Text("", "hud-slot__count");
                s.Panel.Add(s.Glyph);
                s.Panel.Add(s.Key);
                s.Panel.Add(s.Count);
                bar.Add(s.Panel);
                slots[i] = s;
            }
        }

        private void BuildDeath()
        {
            death = UiKit.El("hud-death");
            death.Add(new VignetteElement());
            var col = UiKit.El("hud-death__col");
            deathTitle = UiKit.Text("SUIT FAILURE", "hud-death__title");
            deathCount = UiKit.Text("RESPAWNING IN 8", "hud-death__count");
            col.Add(deathTitle);
            col.Add(UiKit.El("hud-death__rule"));
            col.Add(deathCount);
            death.Add(col);
            hud.Add(death);
        }

        private static Color Hex(string s) => UiKit.Hex(s);

        // ------------------------------------------------------------------ events

        private void OnToast(string text, ToastKind kind)
        {
            if (toasts == null || string.IsNullOrEmpty(text)) return;
            while (toasts.childCount >= MaxToasts) toasts.RemoveAt(0);

            Color accent;
            switch (kind)
            {
                case ToastKind.Item: accent = UiKit.Cyan; break;
                case ToastKind.Databank: accent = UiKit.Amber; break;
                case ToastKind.Warning: accent = UiKit.Danger; break;
                default: accent = UiKit.InkDim; break;
            }

            var t = new GlassPanel(GlassPanel.Look.Chip) { EdgeColor = UiKit.WithAlpha(accent, 0.45f) };
            t.AddToClassList("hud-toast");
            t.Add(new GlyphElement(Glyphs.Diamond, accent, 0.5f).With("hud-toast__icon"));
            t.Add(UiKit.Text(text.ToUpperInvariant(), "hud-toast__text"));
            UiKit.IgnorePointer(t);
            toasts.Add(t);
            t.schedule.Execute(() => t.AddToClassList("is-on")).StartingIn(30);
            t.schedule.Execute(() =>
            {
                t.RemoveFromClassList("is-on");
                t.AddToClassList("is-out");
            }).StartingIn((long)(ToastSeconds * 1000f));
            t.schedule.Execute(() => t.RemoveFromHierarchy()).StartingIn((long)(ToastSeconds * 1000f) + 420);
        }

        private void OnObjectiveChanged() => objectivePulseStart = Time.unscaledTime;

        private void OnScan(string entryId)
        {
            if (scanCard == null) return;
            if (!SurvivorHub.DatabankEntries.TryGetValue(entryId ?? "", out var entry)) return;
            Color tint = entry.Yields.Length > 0 && ItemCatalog.Exists(entry.Yields[0])
                ? UiKit.CategoryColor(ItemCatalog.Get(entry.Yields[0]).Category)
                : UiKit.Cyan;
            scanGlyph.Set(entry.Glyph, tint, 0.6f);
            scanTitle.text = (entry.Title ?? "").ToUpperInvariant();
            scanChipText.text = (entry.Category ?? "").ToUpperInvariant();
            scanDesc.text = entry.Description;
            scanYields.Clear();
            if (entry.Yields.Length > 0)
            {
                scanYields.Add(UiKit.Text("YIELDS", "caps", "hud-scan__yieldlabel"));
                foreach (var id in entry.Yields)
                {
                    if (!ItemCatalog.TryGet(id, out var def)) continue;
                    var chip = UiKit.El("hud-scan__yield");
                    chip.Add(new GlyphElement(def.Glyph, UiKit.CategoryColor(def.Category)).With("hud-scan__yieldglyph"));
                    chip.Add(UiKit.Text(def.Name, "hud-scan__yieldname"));
                    scanYields.Add(chip);
                }
            }
            UiKit.Show(scanYields, entry.Yields.Length > 0);
            UiKit.IgnorePointer(scanCard);
            scanCard.AddToClassList("is-on");
            scanHideAt = Time.unscaledTime + ScanCardSeconds;
        }

        // ------------------------------------------------------------------ update

        private void Update()
        {
            if (hud == null) return;
            bool active = SurvivorHub.Active;
            UiKit.Show(hud, active);
            if (!active) return;

            UiKit.SetClass(hud, "is-pda", SurvivorHub.PdaOpen);
            float dt = Time.unscaledDeltaTime;
            float pulse = 0.5f + 0.5f * Mathf.Sin(Time.unscaledTime * Mathf.PI * 2f / PulsePeriod);

            RefreshVitals(dt, pulse);
            RefreshHotbar();
            RefreshObjective();
            RefreshSession();
            RefreshCompass();
            RefreshCentre();
            RefreshDeath();

            if (scanHideAt > 0f && Time.unscaledTime > scanHideAt)
            {
                scanHideAt = -1f;
                scanCard.RemoveFromClassList("is-on");
            }
        }

        private static float Ease(float shown, float target, float dt) =>
            shown < 0f ? target : Mathf.Lerp(shown, target, 1f - Mathf.Exp(-12f * dt));

        private void SetRow(VitalRow r, float frac, string value, bool low, float pulse, float dt)
        {
            r.Shown = Ease(r.Shown, frac, dt);
            r.Bar.Value = r.Shown;
            UiKit.SetText(r.Value, value);
            if (low != r.Low)
            {
                r.Low = low;
                UiKit.SetClass(r.Value, "is-danger", low);
                UiKit.SetClass(r.Name, "caps--danger", low);
            }
            r.Bar.Pulse = low ? pulse : 0f;
            r.Glyph.Set(r.Glyph.GlyphValue, low ? Color.Lerp(r.GlyphColor, UiKit.Danger, 0.35f + 0.65f * pulse) : r.GlyphColor, low ? 0.5f * pulse : 0f);
        }

        private void RefreshVitals(float dt, float pulse)
        {
            var v = SurvivorHub.Vitals;
            if (v == null) return;
            float cap = Mathf.Max(1f, SurvivorHub.OxygenCapacity);
            SetRow(rows[0], v.Oxygen / cap, Mathf.RoundToInt(v.Oxygen / cap * 100f).ToString(), v.Oxygen / cap < 0.2f, pulse, dt);
            SetRow(rows[1], v.Food / 100f, Mathf.RoundToInt(v.Food).ToString(), v.Food < 15f, pulse, dt);
            SetRow(rows[2], v.Water / 100f, Mathf.RoundToInt(v.Water).ToString(), v.Water < 15f, pulse, dt);
            bool tempBad = v.IsCold || v.IsHot;
            SetRow(rows[3], Mathf.Clamp01((v.BodyTemp - 30f) / 14f), v.BodyTemp.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "°", tempBad, pulse, dt);
            SetRow(rows[4], v.Health / 100f, Mathf.RoundToInt(v.Health).ToString(), v.Health < 30f, pulse, dt);

            var clock = SurvivorHub.Clock;
            if (clock != null)
            {
                int minutes = Mathf.FloorToInt(clock.TimeOfDay * 24f * 60f);
                UiKit.SetText(clockLabel, $"DAY {clock.Day + 1}  \u00B7  {minutes / 60:00}:{minutes % 60:00}");
            }
            bool zone = SurvivorHub.InPressurisedZone;
            UiKit.SetText(zoneLabel, zone ? "PRESSURISED" : clock != null ? FormatTemp(clock.AmbientC) : "EXPOSED");
            UiKit.SetClass(zoneLabel, "is-ok", zone);
            UiKit.SetClass(zoneLabel, "is-amber", !zone);
        }

        private static string FormatTemp(float c) =>
            (c < 0f ? "−" : "") + Mathf.Abs(Mathf.RoundToInt(c)) + "°C";

        private void RefreshHotbar()
        {
            var inv = SurvivorHub.Inventory;
            if (inv == null) return;
            int sel = SurvivorHub.SelectedHotbar;
            if (inv == shownInventory && inv.Version == shownInventoryVersion && sel == shownHotbar) return;
            shownInventory = inv;
            shownInventoryVersion = inv.Version;
            shownHotbar = sel;
            for (int i = 0; i < slots.Length; i++)
            {
                var s = slots[i];
                var stack = inv.HotbarStack(i);
                var def = stack.Def;
                if (def != null)
                {
                    s.Glyph.Set(def.Glyph, UiKit.CategoryColor(def.Category), i == sel ? 0.55f : 0.15f);
                    s.Count.text = def.MaxStack > 1 ? stack.Count.ToString() : "";
                }
                else
                {
                    s.Glyph.Set(-1, UiKit.Ink);
                    s.Count.text = "";
                }
                bool selected = i == sel;
                s.Panel.Emphasis = selected ? 1f : 0f;
                s.Panel.Glow = selected ? 1f : 0f;
                UiKit.SetClass(s.Panel, "is-selected", selected);
                UiKit.SetClass(s.Panel, "is-empty", def == null);
                UiKit.SetClass(s.Key, "is-selected", selected);
            }
            var cur = inv.HotbarStack(sel);
            var cd = cur.Def;
            hotbarCaption.text = cd != null ? cd.Name.ToUpperInvariant() : "";
            string hint = "";
            if (cd != null) hint = cd.IsConsumable ? "R  USE" : cd.IsTool ? "EQUIPPED" : "";
            hotbarCaptionHint.text = hint;
            UiKit.Show(hotbarCaptionRow, cd != null);
        }

        private void RefreshObjective()
        {
            bool has = !string.IsNullOrEmpty(SurvivorHub.ObjectiveText);
            UiKit.Show(objective, has);
            if (SurvivorHub.ObjectiveVersion != shownObjectiveVersion || SurvivorHub.ObjectiveText != shownObjective)
            {
                shownObjectiveVersion = SurvivorHub.ObjectiveVersion;
                shownObjective = SurvivorHub.ObjectiveText;
                objectiveText.text = SurvivorHub.ObjectiveText ?? "";
            }
            // objective-in: a cyan glow that fades over 1.6 s when a new objective starts.
            float k = 1f - Mathf.Clamp01((Time.unscaledTime - objectivePulseStart) / 1.6f);
            objective.Glow = k * k;
            objective.Emphasis = k * k;
        }

        private void RefreshSession()
        {
            string code = SurvivorHub.RoomCode;
            var partner = SurvivorHub.Partner;
            bool hasRoom = !string.IsNullOrEmpty(code);
            bool hasPartner = hasRoom && partner.Connected;
            UiKit.Show(session, hasRoom);
            if (!hasRoom) return;
            UiKit.SetText(sessionCode, code);
            UiKit.Show(partnerRow, hasPartner);
            if (!hasPartner) return;
            UiKit.SetText(partnerName, (string.IsNullOrEmpty(partner.Name) ? "PARTNER" : partner.Name).ToUpperInvariant());
            UiKit.Show(partnerBars, !partner.IsDead);
            UiKit.Show(partnerDown, partner.IsDead);
            partnerHp.Value = partner.Health / 100f;
            partnerO2.Value = partner.Oxygen / Mathf.Max(1f, partner.OxygenCapacity);
        }

        private void RefreshCompass()
        {
            compass.SetView(SurvivorHub.CameraYawDeg, SurvivorHub.PlayerPosition, SurvivorHub.Markers);
            int yaw = Mathf.RoundToInt(Mathf.Repeat(SurvivorHub.CameraYawDeg, 360f)) % 360;
            UiKit.SetText(heading, $"{CompassElement.Cardinal(yaw)}  {yaw:000}°");
        }

        private void RefreshCentre()
        {
            bool hasPrompt = !string.IsNullOrEmpty(SurvivorHub.PromptText);
            UiKit.SetClass(prompt, "is-on", hasPrompt);
            if (hasPrompt)
            {
                UiKit.SetText(promptKey, string.IsNullOrEmpty(SurvivorHub.PromptKey) ? "F" : SurvivorHub.PromptKey);
                UiKit.Show(promptKey, !string.IsNullOrEmpty(SurvivorHub.PromptKey));
                UiKit.SetText(promptText, SurvivorHub.PromptText);
                bool detail = !string.IsNullOrEmpty(SurvivorHub.PromptDetail);
                UiKit.Show(promptDetail, detail);
                if (detail) UiKit.SetText(promptDetail, SurvivorHub.PromptDetail);
                UiKit.Show(promptBar, SurvivorHub.PromptProgress > 0.001f);
                promptBar.Value = SurvivorHub.PromptProgress;
            }
            crosshair.Active = hasPrompt;
            bool scanning = SurvivorHub.ScanProgress > 0.001f;
            UiKit.Show(ring, scanning);
            ring.Progress = SurvivorHub.ScanProgress;
        }

        private void RefreshDeath()
        {
            var v = SurvivorHub.Vitals;
            bool dead = v != null && v.IsDead;
            if (dead != shownDead)
            {
                shownDead = dead;
                UiKit.SetClass(death, "is-on", dead);
                UiKit.SetClass(hud, "is-dead", dead);
            }
            if (dead)
            {
                int sec = Mathf.CeilToInt(v.RespawnCountdown);
                if (sec != shownDeathSecond)
                {
                    shownDeathSecond = sec;
                    deathCount.text = sec > 0 ? $"RESPAWNING IN {sec}" : "RESPAWNING";
                }
            }
        }
    }

    /// <summary>A full-screen radial falloff: clear in the middle, tinted toward the edges (death red, or lobby black).</summary>
    public sealed class VignetteElement : VisualElement
    {
        private readonly Color edge;
        private readonly float edgeAlpha;

        public VignetteElement() : this(new Color(0.45f, 0.03f, 0.06f), 0.72f) { }

        public VignetteElement(Color edge, float edgeAlpha)
        {
            this.edge = edge;
            this.edgeAlpha = edgeAlpha;
            pickingMode = PickingMode.Ignore;
            AddToClassList("hud-vignette");
            style.position = Position.Absolute;
            style.left = style.top = style.right = style.bottom = 0;
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 2f || h < 2f) return;
            var p = mgc.painter2D;
            var c = new Vector2(w * 0.5f, h * 0.5f);
            float r = Mathf.Sqrt(w * w + h * h) * 0.5f;
            p.fillGradient = UiKit.Radial(c, r,
                (0f, UiKit.WithAlpha(edge, 0f)),
                (0.55f, UiKit.WithAlpha(edge, edgeAlpha * 0.14f)),
                (1f, UiKit.WithAlpha(edge, edgeAlpha)));
            p.BeginPath();
            p.MoveTo(Vector2.zero);
            p.LineTo(new Vector2(w, 0f));
            p.LineTo(new Vector2(w, h));
            p.LineTo(new Vector2(0f, h));
            p.ClosePath();
            p.Fill();
            UiKit.ClearGradients(p);
        }
    }

    /// <summary>
    /// The compass strip: ticks every 5 degrees, N/E/S/W and the half-points as labels, markers as diamonds,
    /// all scrolling with the camera yaw over a 180 degree field of view.
    /// </summary>
    public sealed class CompassElement : VisualElement
    {
        private const float Fov = 180f;
        private static readonly string[] Names = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" };

        private float yaw;
        private Vector3 origin;
        private readonly List<CompassMarker> markers = new List<CompassMarker>();
        private readonly Label[] cardinals = new Label[8];
        private readonly List<Label> markerLabels = new List<Label>();
        private int lastHash;

        public CompassElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("hud-compass__strip");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ =>
            {
                Place();
                MarkDirtyRepaint();
            });
            for (int i = 0; i < cardinals.Length; i++)
            {
                var l = UiKit.Text(Names[i], "hud-compass__card", i % 2 == 0 ? "is-major" : "is-minor");
                l.pickingMode = PickingMode.Ignore;
                cardinals[i] = l;
                Add(l);
            }
        }

        public static string Cardinal(float yawDeg)
        {
            int idx = Mathf.RoundToInt(Mathf.Repeat(yawDeg, 360f) / 45f) % 8;
            return Names[idx];
        }

        public void SetView(float yawDeg, Vector3 playerPos, List<CompassMarker> list)
        {
            int hash = Mathf.RoundToInt(yawDeg * 20f) * 31 + list.Count;
            foreach (var m in list) hash = hash * 17 + Mathf.RoundToInt(m.Position.x * 4f) + Mathf.RoundToInt(m.Position.z * 4f) * 7;
            hash = hash * 13 + Mathf.RoundToInt(playerPos.x * 2f) + Mathf.RoundToInt(playerPos.z * 2f) * 5;
            if (hash == lastHash) return;
            lastHash = hash;
            yaw = yawDeg;
            origin = playerPos;
            markers.Clear();
            markers.AddRange(list);
            Place();
            MarkDirtyRepaint();
        }

        private float PxPerDeg => layout.width / Fov;

        private float XFor(float bearing) => layout.width * 0.5f + Mathf.DeltaAngle(yaw, bearing) * PxPerDeg;

        private static float EdgeFade(float x, float w)
        {
            float edge = Mathf.Min(x, w - x);
            return Mathf.Clamp01(edge / (w * 0.16f));
        }

        private void Place()
        {
            float w = layout.width;
            if (w < 10f) return;
            for (int i = 0; i < cardinals.Length; i++)
            {
                float x = XFor(i * 45f);
                float a = EdgeFade(x, w);
                bool vis = x > 0f && x < w && a > 0.02f;
                UiKit.Show(cardinals[i], vis);
                if (!vis) continue;
                cardinals[i].style.left = x - 20f;
                cardinals[i].style.opacity = a;
            }

            while (markerLabels.Count < markers.Count)
            {
                var l = UiKit.Text("", "hud-compass__marker");
                l.pickingMode = PickingMode.Ignore;
                markerLabels.Add(l);
                Add(l);
            }
            for (int i = 0; i < markerLabels.Count; i++)
            {
                if (i >= markers.Count)
                {
                    UiKit.Show(markerLabels[i], false);
                    continue;
                }
                var m = markers[i];
                float bearing = BearingTo(m.Position);
                float x = Mathf.Clamp(XFor(bearing), 14f, w - 14f);
                bool visible = Mathf.Abs(Mathf.DeltaAngle(yaw, bearing)) < Fov * 0.5f - 10f;
                var label = markerLabels[i];
                float dist = Vector2.Distance(new Vector2(origin.x, origin.z), new Vector2(m.Position.x, m.Position.z));
                UiKit.SetText(label, $"{(m.Label ?? "").ToUpperInvariant()}  {Mathf.RoundToInt(dist)}m");
                label.style.color = m.Color;
                label.style.left = x - 60f;
                label.style.opacity = visible ? EdgeFade(x, w) : 0f;
                UiKit.Show(label, visible);
            }
        }

        private float BearingTo(Vector3 pos)
        {
            float dx = pos.x - origin.x, dz = pos.z - origin.z;
            return Mathf.Atan2(dx, dz) * Mathf.Rad2Deg;
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 10f) return;
            var p = mgc.painter2D;
            float baseY = h - 7f;
            p.lineCap = LineCap.Butt;
            p.strokeGradient = null;

            // Ticks.
            int first = Mathf.FloorToInt((yaw - Fov * 0.5f) / 5f) * 5;
            for (int deg = first; deg <= yaw + Fov * 0.5f + 5f; deg += 5)
            {
                float x = w * 0.5f + (deg - yaw) * PxPerDeg;
                if (x < 0f || x > w) continue;
                int m = ((deg % 360) + 360) % 360;
                bool major = m % 45 == 0, mid = m % 15 == 0;
                float len = major ? 13f : mid ? 8f : 4.5f;
                float alpha = (major ? 0.85f : mid ? 0.5f : 0.28f) * EdgeFade(x, w);
                p.strokeColor = major ? UiKit.WithAlpha(UiKit.Lighten(UiKit.Cyan, 0.4f), alpha) : new Color(0.8f, 0.9f, 1f, alpha);
                p.lineWidth = major ? 1.8f : 1.2f;
                p.BeginPath();
                p.MoveTo(new Vector2(x, baseY));
                p.LineTo(new Vector2(x, baseY - len));
                p.Stroke();
            }

            // Marker diamonds.
            foreach (var mk in markers)
            {
                float bearing = BearingTo(mk.Position);
                float x = Mathf.Clamp(XFor(bearing), 14f, w - 14f);
                bool inView = Mathf.Abs(Mathf.DeltaAngle(yaw, bearing)) < Fov * 0.5f - 10f;
                var c = inView ? mk.Color : UiKit.WithAlpha(mk.Color, 0.45f);
                p.fillGradient = UiKit.Radial(new Vector2(x, 15f), 15f, (0f, UiKit.WithAlpha(c, 0.35f)), (1f, UiKit.WithAlpha(c, 0f)));
                p.BeginPath();
                p.Arc(new Vector2(x, 15f), 15f, 0f, 360f);
                p.ClosePath();
                p.Fill();
                UiKit.ClearGradients(p);
                Glyphs.Draw(p, Glyphs.Diamond, new Rect(x - 6f, 9f, 12f, 12f), c);
            }

            // Centre caret and tick.
            var cx = w * 0.5f;
            p.fillGradient = UiKit.Radial(new Vector2(cx, 4f), 18f, (0f, UiKit.WithAlpha(UiKit.Cyan, 0.45f)), (1f, UiKit.WithAlpha(UiKit.Cyan, 0f)));
            p.BeginPath();
            p.Arc(new Vector2(cx, 4f), 18f, 0f, 360f);
            p.ClosePath();
            p.Fill();
            UiKit.ClearGradients(p);
            p.fillColor = UiKit.Cyan;
            p.BeginPath();
            p.MoveTo(new Vector2(cx - 5.5f, 0f));
            p.LineTo(new Vector2(cx + 5.5f, 0f));
            p.LineTo(new Vector2(cx, 7f));
            p.ClosePath();
            p.Fill();
            p.strokeColor = UiKit.WithAlpha(UiKit.Cyan, 0.9f);
            p.lineWidth = 2f;
            p.BeginPath();
            p.MoveTo(new Vector2(cx, baseY));
            p.LineTo(new Vector2(cx, baseY - 16f));
            p.Stroke();
        }
    }
}
