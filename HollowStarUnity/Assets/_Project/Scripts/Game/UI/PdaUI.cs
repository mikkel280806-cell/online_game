using System.Collections.Generic;
using HollowStar.Core.Survival;
using HollowStar.Game.Survival;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// The PDA: Tab toggles it, Esc closes it. Four tabs (inventory, fabricator, databank, objectives). It reads
    /// <see cref="SurvivorHub"/> state, sets <see cref="SurvivorHub.PdaOpen"/>, and asks gameplay to act through
    /// the hub's Request methods (hotbar assignment goes straight to the inventory). Layout is for 1920 x 1080.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class PdaUI : MonoBehaviour
    {
        public StyleSheet Theme;
        public StyleSheet Style;

        private static readonly (PdaTab tab, string label)[] Tabs =
        {
            (PdaTab.Inventory, "INVENTORY"),
            (PdaTab.Fabricator, "FABRICATOR"),
            (PdaTab.Databank, "DATABANK"),
            (PdaTab.Objectives, "OBJECTIVES"),
        };

        private static readonly ItemCategory[] RecipeGroups =
        {
            ItemCategory.Material, ItemCategory.Food, ItemCategory.Consumable, ItemCategory.Tool, ItemCategory.Equipment,
        };

        private sealed class InvSlot
        {
            public GlassPanel Panel;
            public GlyphElement Glyph;
            public Label Name, Count, Key;
        }

        private sealed class RecipeRow
        {
            public Recipe Recipe;
            public VisualElement Root;
            public GlyphElement Glyph, Status;
            public Label Name;
        }

        private sealed class DbRow
        {
            public string Id;
            public VisualElement Root;
            public GlyphElement Glyph;
            public Label Title, Category;
        }

        // Shell.
        private VisualElement root, scrim, bodyHost, footerHint;
        private GlassPanel panel;
        private readonly VisualElement[] tabEls = new VisualElement[Tabs.Length];
        private readonly VisualElement[] pages = new VisualElement[Tabs.Length];
        private Label packLabel;

        // Inventory.
        private readonly InvSlot[] invSlots = new InvSlot[Inventory.SlotCount];
        private int selSlot = -1;
        private VisualElement itemDetailBody, itemDetailEmpty, itemEffects, hotbarButtons, useButtonWrap;
        private GlassPanel itemBadge;
        private GlyphElement itemGlyph;
        private Label itemName, itemDesc, itemCount, itemChipText;
        private VisualElement itemChip, useButton, dropButton;
        private readonly VisualElement[] assignButtons = new VisualElement[Inventory.HotbarSize];

        // Fabricator.
        private readonly List<RecipeRow> recipeRows = new List<RecipeRow>();
        private Recipe selRecipe;
        private VisualElement fabBody, fabEmpty, fabIngredients, fabEffects, fabBanner, craftButton, cancelButton, craftProgressWrap;
        private GlassPanel fabBadge;
        private GlyphElement fabGlyph;
        private Label fabName, fabDesc, fabTime, fabStation, fabReason, craftProgressLabel, fabCount;
        private BarElement craftBar;

        // Databank.
        private readonly List<DbRow> dbRows = new List<DbRow>();
        private VisualElement dbList, dbBody, dbEmpty, dbYields, dbChip;
        private string selEntry;
        private GlassPanel dbBadge;
        private GlyphElement dbGlyph;
        private Label dbTitle, dbDesc, dbChipText, dbCount, dbLocked;

        // Objectives.
        private Label objCurrent;
        private VisualElement objLog;
        private GlassPanel objCard;

        // State.
        private bool open;
        private PdaTab current = PdaTab.Inventory;
        private CursorLockMode prevLock;
        private bool prevCursorVisible;
        private bool prevBlocked;
        private int shownInv = -1, shownDb = -1, shownObj = -1, shownHotbar = -1;
        private bool shownAtFab;
        private string shownCraft;
        private bool dirty = true;
        private Inventory shownInventory;
        private ScanDatabase shownDatabank;
        private string shownObjectiveText;

        private void OnEnable() => SurvivorHub.PdaOpenRequested += OnOpenRequested;

        private void OnDisable()
        {
            SurvivorHub.PdaOpenRequested -= OnOpenRequested;
            if (open) Close();
        }

        private void OnOpenRequested(PdaTab tab) => Open(tab);

        public bool IsOpen => open;

        private void Start()
        {
            var doc = GetComponent<UIDocument>();
            root = doc.rootVisualElement;
            root.style.flexGrow = 1;
            root.pickingMode = PickingMode.Ignore;
            if (Theme != null) root.styleSheets.Add(Theme);
            if (Style != null) root.styleSheets.Add(Style);
            root.AddToClassList("hs-root");

            scrim = UiKit.El("pda-scrim");
            scrim.pickingMode = PickingMode.Ignore;
            UiKit.Show(scrim, false);
            root.Add(scrim);

            panel = new GlassPanel { Radius = 16f, Glow = 0.25f };
            panel.AddToClassList("pda-panel");
            panel.AddToClassList("slide-in");
            scrim.Add(panel);

            BuildHeader();
            BuildTabs();
            bodyHost = UiKit.El("pda-body");
            panel.Add(bodyHost);
            BuildFooter();
            panel.Add(new ScanlineElement());

            pages[0] = BuildInventoryPage();
            pages[1] = BuildFabricatorPage();
            pages[2] = BuildDatabankPage();
            pages[3] = BuildObjectivesPage();
            foreach (var p in pages) bodyHost.Add(p);
            SetTab(PdaTab.Inventory, false);
        }

        // ------------------------------------------------------------------ shell

        private void BuildHeader()
        {
            var header = UiKit.El("pda-header");
            header.Add(new GlyphElement(Glyphs.Pda, UiKit.Cyan, 0.8f).With("pda-header__icon"));
            header.Add(UiKit.Text("PDA", "pda-title", "pda-title--cyan"));
            header.Add(UiKit.Text("·", "pda-title", "pda-title--dot"));
            header.Add(UiKit.Text("KESTREL CREW", "pda-title"));
            header.Add(UiKit.El("grow"));
            packLabel = UiKit.Text("", "caps", "pda-pack");
            header.Add(packLabel);
            var close = UiKit.El("hs-btn", "hs-btn--ghost", "hs-btn--small", "pda-close");
            close.Add(new SheenElement());
            close.Add(new GlyphElement(Glyphs.Close, UiKit.InkDim).With("pda-close__icon"));
            close.RegisterCallback<ClickEvent>(_ => Close());
            header.Add(close);
            panel.Add(header);
        }

        private void BuildTabs()
        {
            var bar = UiKit.El("pda-tabs");
            for (int i = 0; i < Tabs.Length; i++)
            {
                int index = i;
                var tab = UiKit.El("pda-tab");
                tab.Add(UiKit.Text(Tabs[i].label, "pda-tab__text"));
                tab.RegisterCallback<ClickEvent>(_ => SetTab(Tabs[index].tab));
                tabEls[i] = tab;
                bar.Add(tab);
            }
            panel.Add(bar);
        }

        private void BuildFooter()
        {
            var footer = UiKit.El("pda-footer");
            footerHint = UiKit.El("pda-footer__row");
            footerHint.Add(UiKit.Text("TAB", "keycap", "keycap--small"));
            footerHint.Add(UiKit.Text("CLOSE", "pda-hint"));
            footerHint.Add(UiKit.Text("Q", "keycap", "keycap--small"));
            footerHint.Add(UiKit.Text("E", "keycap", "keycap--small"));
            footerHint.Add(UiKit.Text("SWITCH TAB", "pda-hint"));
            footer.Add(footerHint);
            panel.Add(footer);
        }

        // ------------------------------------------------------------------ open / close

        public void Open(PdaTab tab)
        {
            if (panel == null || !SurvivorHub.Active) return;
            SetTab(tab, false);
            if (open) return;
            open = true;
            SurvivorHub.PdaOpen = true;
            prevLock = UnityEngine.Cursor.lockState;
            prevCursorVisible = UnityEngine.Cursor.visible;
            prevBlocked = PlayerControls.Blocked;
            UnityEngine.Cursor.lockState = CursorLockMode.None;
            UnityEngine.Cursor.visible = true;
            // Freezes the camera as well as the player while the PDA is up.
            PlayerControls.Blocked = true;
            dirty = true;
            UiKit.Show(scrim, true);
            scrim.pickingMode = PickingMode.Position;
            scrim.schedule.Execute(() =>
            {
                if (!open) return;
                scrim.AddToClassList("is-on");
                panel.AddToClassList("is-on");
            }).StartingIn(20);
            Refresh();
        }

        public void Close()
        {
            if (!open) return;
            open = false;
            SurvivorHub.PdaOpen = false;
            UnityEngine.Cursor.lockState = prevLock;
            UnityEngine.Cursor.visible = prevCursorVisible;
            PlayerControls.Blocked = prevBlocked;
            scrim.pickingMode = PickingMode.Ignore;
            scrim.RemoveFromClassList("is-on");
            panel.RemoveFromClassList("is-on");
            scrim.schedule.Execute(() =>
            {
                if (!open) UiKit.Show(scrim, false);
            }).StartingIn(260);
        }

        public void Toggle()
        {
            if (open) Close();
            else Open(current);
        }

        private void SetTab(PdaTab tab, bool animate = true)
        {
            current = tab;
            for (int i = 0; i < Tabs.Length; i++)
            {
                bool on = Tabs[i].tab == tab;
                UiKit.SetClass(tabEls[i], "is-active", on);
                if (pages[i] == null) continue;
                UiKit.Show(pages[i], on);
                if (on && animate && open)
                {
                    pages[i].RemoveFromClassList("is-on");
                    var page = pages[i];
                    page.schedule.Execute(() => page.AddToClassList("is-on")).StartingIn(16);
                }
                else if (on)
                {
                    pages[i].AddToClassList("is-on");
                }
            }
            dirty = true;
        }

        private void Cycle(int dir)
        {
            int idx = 0;
            for (int i = 0; i < Tabs.Length; i++) if (Tabs[i].tab == current) idx = i;
            idx = (idx + dir + Tabs.Length) % Tabs.Length;
            SetTab(Tabs[idx].tab);
        }

        // ------------------------------------------------------------------ input and refresh

        private void Update()
        {
            if (panel == null) return;
            if (open && !SurvivorHub.Active) Close();

            var kb = Keyboard.current;
            var pad = Gamepad.current;
            bool toggle = (kb != null && kb.tabKey.wasPressedThisFrame) || (pad != null && pad.buttonNorth.wasPressedThisFrame);
            if (toggle && SurvivorHub.Active && (open || !PlayerControls.Blocked)) Toggle();
            if (open)
            {
                if ((kb != null && kb.escapeKey.wasPressedThisFrame) || (pad != null && pad.buttonEast.wasPressedThisFrame)) Close();
                if ((kb != null && kb.qKey.wasPressedThisFrame) || (pad != null && pad.leftShoulder.wasPressedThisFrame)) Cycle(-1);
                if ((kb != null && kb.eKey.wasPressedThisFrame) || (pad != null && pad.rightShoulder.wasPressedThisFrame)) Cycle(1);
            }
            if (open) Refresh();
        }

        private void Refresh()
        {
            var inv = SurvivorHub.Inventory;
            int invV = inv != null ? inv.Version : -1;
            int dbV = SurvivorHub.Databank != null ? SurvivorHub.Databank.Version : -1;
            bool atFab = SurvivorHub.AtFabricator;
            string craft = SurvivorHub.CraftingRecipe;
            if (inv != shownInventory || SurvivorHub.Databank != shownDatabank || SurvivorHub.ObjectiveText != shownObjectiveText) dirty = true;
            shownInventory = inv;
            shownDatabank = SurvivorHub.Databank;
            shownObjectiveText = SurvivorHub.ObjectiveText;
            if (!dirty && invV == shownInv && dbV == shownDb && SurvivorHub.ObjectiveVersion == shownObj
                && atFab == shownAtFab && craft == shownCraft && SurvivorHub.SelectedHotbar == shownHotbar)
            {
                UpdateCraftProgress();
                return;
            }
            dirty = false;
            shownInv = invV;
            shownDb = dbV;
            shownObj = SurvivorHub.ObjectiveVersion;
            shownAtFab = atFab;
            shownCraft = craft;
            shownHotbar = SurvivorHub.SelectedHotbar;

            if (inv != null)
            {
                int used = 0;
                for (int i = 0; i < Inventory.SlotCount; i++) if (!inv[i].IsEmpty) used++;
                UiKit.SetText(packLabel, $"PACK  {used} / {Inventory.SlotCount}");
            }

            switch (current)
            {
                case PdaTab.Inventory: RefreshInventory(); break;
                case PdaTab.Fabricator: RefreshFabricator(); break;
                case PdaTab.Databank: RefreshDatabank(); break;
                case PdaTab.Objectives: RefreshObjectives(); break;
            }
        }

        // ------------------------------------------------------------------ inventory

        private VisualElement BuildInventoryPage()
        {
            var page = UiKit.El("pda-page", "pda-inv", "slide-in");

            var left = UiKit.El("pda-inv__left");
            var grid = UiKit.El("pda-grid");
            for (int r = 0; r < Inventory.Rows; r++)
            {
                var row = UiKit.El("pda-grid__row");
                for (int c = 0; c < Inventory.Columns; c++)
                {
                    int slot = r * Inventory.Columns + c;
                    var s = new InvSlot();
                    s.Panel = new GlassPanel(GlassPanel.Look.Slot);
                    s.Panel.AddToClassList("pda-slot");
                    s.Glyph = new GlyphElement().With("pda-slot__glyph");
                    s.Name = UiKit.Text("", "pda-slot__name");
                    s.Count = UiKit.Text("", "pda-slot__count");
                    s.Key = UiKit.Text("", "pda-slot__key");
                    s.Panel.Add(s.Glyph);
                    s.Panel.Add(s.Name);
                    s.Panel.Add(s.Count);
                    s.Panel.Add(s.Key);
                    s.Panel.RegisterCallback<PointerEnterEvent>(_ =>
                    {
                        if (selSlot != slot) s.Panel.AnimateEmphasis(0.45f);
                    });
                    s.Panel.RegisterCallback<PointerLeaveEvent>(_ =>
                    {
                        if (selSlot != slot) s.Panel.AnimateEmphasis(0f);
                    });
                    s.Panel.RegisterCallback<ClickEvent>(e =>
                    {
                        SelectSlot(slot);
                        if (e.clickCount == 2) UseSelected();
                    });
                    invSlots[slot] = s;
                    row.Add(s.Panel);
                }
                grid.Add(row);
            }
            left.Add(grid);
            page.Add(left);

            // Detail pane.
            var detail = new GlassPanel(GlassPanel.Look.Plain);
            detail.AddToClassList("pda-detail");
            itemDetailEmpty = UiKit.El("pda-empty");
            itemDetailEmpty.Add(new GlyphElement(GlyphId.Crystal, UiKit.Shade(UiKit.InkDim, 0.6f)).With("pda-empty__glyph"));
            itemDetailEmpty.Add(UiKit.Text("SELECT AN ITEM", "caps"));
            detail.Add(itemDetailEmpty);

            itemDetailBody = UiKit.El("pda-detail__body");
            var head = UiKit.El("pda-detail__head");
            itemBadge = new GlassPanel(GlassPanel.Look.Slot) { Glow = 0.55f };
            itemBadge.AddToClassList("pda-badge");
            itemGlyph = new GlyphElement().With("pda-badge__glyph");
            itemBadge.Add(itemGlyph);
            head.Add(itemBadge);
            var titleCol = UiKit.El("pda-detail__titlecol");
            itemName = UiKit.Text("", "pda-h1", "wrap");
            titleCol.Add(itemName);
            var chips = UiKit.El("pda-chips");
            itemChip = UiKit.El("chip");
            itemChipText = UiKit.Text("", "chip__text");
            itemChip.Add(itemChipText);
            chips.Add(itemChip);
            itemCount = UiKit.Text("", "pda-count");
            chips.Add(itemCount);
            titleCol.Add(chips);
            head.Add(titleCol);
            itemDetailBody.Add(head);

            itemDesc = UiKit.Text("", "pda-desc", "wrap");
            itemDetailBody.Add(itemDesc);
            itemEffects = UiKit.El("pda-effects");
            itemDetailBody.Add(itemEffects);
            itemDetailBody.Add(UiKit.El("grow"));

            useButtonWrap = UiKit.El("pda-actions");
            useButton = UiKit.Button("USE", UseSelected, "pda-action");
            useButtonWrap.Add(useButton);
            itemDetailBody.Add(useButtonWrap);

            itemDetailBody.Add(UiKit.Text("ASSIGN TO HOTBAR", "caps", "pda-assign-label"));
            hotbarButtons = UiKit.El("pda-assign");
            for (int i = 0; i < Inventory.HotbarSize; i++)
            {
                int hb = i;
                var b = UiKit.Button((i + 1).ToString(), () => AssignSelected(hb), "hs-btn--small", "pda-assign__btn");
                assignButtons[i] = b;
                hotbarButtons.Add(b);
            }
            itemDetailBody.Add(hotbarButtons);
            dropButton = UiKit.Button("DROP", () =>
            {
                if (selSlot >= 0) SurvivorHub.RequestDrop(selSlot);
            }, "hs-btn--danger", "pda-action", "pda-drop");
            itemDetailBody.Add(dropButton);
            detail.Add(itemDetailBody);
            page.Add(detail);
            return page;
        }

        private void SelectSlot(int slot)
        {
            var inv = SurvivorHub.Inventory;
            if (inv == null || slot < 0 || slot >= Inventory.SlotCount) return;
            selSlot = slot;
            dirty = true;
            RefreshInventory();
        }

        private void UseSelected()
        {
            var inv = SurvivorHub.Inventory;
            if (inv == null || selSlot < 0 || inv[selSlot].IsEmpty) return;
            SurvivorHub.RequestUse(selSlot);
        }

        private void AssignSelected(int hotbarIndex)
        {
            var inv = SurvivorHub.Inventory;
            if (inv == null || selSlot < 0 || inv[selSlot].IsEmpty) return;
            if (inv.HotbarSlot(hotbarIndex) == selSlot) inv.ClearHotbar(hotbarIndex);
            else inv.AssignHotbar(hotbarIndex, selSlot);
        }

        private void RefreshInventory()
        {
            var inv = SurvivorHub.Inventory;
            if (inv == null) return;

            // Keep the selection on something real.
            if (selSlot < 0 || inv[selSlot].IsEmpty)
            {
                int next = -1;
                for (int k = 0; k < Inventory.SlotCount; k++)
                {
                    int i = (Mathf.Max(selSlot, 0) + k) % Inventory.SlotCount;
                    if (!inv[i].IsEmpty) { next = i; break; }
                }
                selSlot = next;
            }

            for (int i = 0; i < Inventory.SlotCount; i++)
            {
                var s = invSlots[i];
                var stack = inv[i];
                var def = stack.Def;
                bool selected = i == selSlot;
                if (def != null)
                {
                    var tint = UiKit.CategoryColor(def.Category);
                    s.Glyph.Set(def.Glyph, tint, selected ? 0.55f : 0.12f);
                    UiKit.SetText(s.Name, def.Name);
                    UiKit.SetText(s.Count, stack.Count > 1 ? "×" + stack.Count : "");
                    int key = -1;
                    for (int h = 0; h < Inventory.HotbarSize; h++) if (inv.HotbarSlot(h) == i) key = h + 1;
                    UiKit.SetText(s.Key, key > 0 ? key.ToString() : "");
                    UiKit.Show(s.Key, key > 0);
                }
                else
                {
                    s.Glyph.Set(-1, UiKit.Ink);
                    UiKit.SetText(s.Name, "");
                    UiKit.SetText(s.Count, "");
                    UiKit.Show(s.Key, false);
                }
                UiKit.SetClass(s.Panel, "is-empty", def == null);
                s.Panel.Emphasis = selected ? 1f : 0f;
                s.Panel.Glow = selected ? 0.8f : 0f;
            }

            bool any = selSlot >= 0;
            UiKit.Show(itemDetailEmpty, !any);
            UiKit.Show(itemDetailBody, any);
            if (!any) return;

            var sel = inv[selSlot];
            var d = sel.Def;
            var color = UiKit.CategoryColor(d.Category);
            itemGlyph.Set(d.Glyph, color, 0.7f);
            itemBadge.GlowColor = color;
            itemBadge.EdgeColor = UiKit.WithAlpha(color, 0.4f);
            UiKit.SetText(itemName, d.Name.ToUpperInvariant());
            StyleChip(itemChip, itemChipText, UiKit.CategoryName(d.Category), color);
            UiKit.SetText(itemCount, sel.Count > 1 || d.MaxStack > 1 ? $"×{sel.Count}  /  {d.MaxStack}" : "");
            UiKit.SetText(itemDesc, d.Description);

            itemEffects.Clear();
            AddEffect(d.Food, "FOOD", UiKit.Amber);
            AddEffect(d.Water, "WATER", UiKit.Water);
            AddEffect(d.Oxygen, "OXYGEN", UiKit.Cyan);
            AddEffect(d.Health, "HEALTH", UiKit.Ok);
            if (d.OxygenCapacityFactor > 1.001f) itemEffects.Add(MakeChip($"OXYGEN CAPACITY ×{d.OxygenCapacityFactor:0.#}", UiKit.Cyan));
            if (d.Insulation > 0.001f) itemEffects.Add(MakeChip($"INSULATION +{Mathf.RoundToInt(d.Insulation * 100f)}%", UiKit.Water));
            UiKit.Show(itemEffects, itemEffects.childCount > 0);

            bool usable = d.IsConsumable || d.IsTool;
            UiKit.Show(useButton, usable);
            if (usable)
            {
                string verb = d.IsTool ? "EQUIP" : d.Food > 0f && d.Water <= 0f ? "EAT" : d.Water > 0f && d.Food <= 0f ? "DRINK" : "USE";
                UiKit.SetButtonText(useButton, verb);
            }
            for (int i = 0; i < Inventory.HotbarSize; i++)
                UiKit.SetClass(assignButtons[i], "is-assigned", inv.HotbarSlot(i) == selSlot);
        }

        private void AddEffect(float amount, string label, Color c) => AddEffectTo(itemEffects, amount, label, c);

        private static void AddEffectTo(VisualElement into, float amount, string label, Color c)
        {
            if (amount > 0.01f) into.Add(MakeChip($"+{Mathf.RoundToInt(amount)} {label}", c));
        }

        private static VisualElement MakeChip(string text, Color c)
        {
            var chip = UiKit.El("chip");
            var l = UiKit.Text(text, "chip__text");
            chip.Add(l);
            StyleChip(chip, l, text, c);
            chip.style.marginRight = 8;
            chip.style.marginTop = 8;
            return chip;
        }

        private static void StyleChip(VisualElement chip, Label label, string text, Color c)
        {
            UiKit.SetText(label, text);
            label.style.color = c;
            chip.style.borderTopColor = chip.style.borderBottomColor = chip.style.borderLeftColor = chip.style.borderRightColor = UiKit.WithAlpha(c, 0.42f);
            chip.style.backgroundColor = UiKit.WithAlpha(c, 0.10f);
        }

        // ------------------------------------------------------------------ fabricator

        private VisualElement BuildFabricatorPage()
        {
            var page = UiKit.El("pda-page", "pda-fab", "slide-in");

            var scroll = new ScrollView(ScrollViewMode.Vertical);
            scroll.AddToClassList("pda-scroll");
            scroll.AddToClassList("pda-fab__list");
            scroll.horizontalScrollerVisibility = ScrollerVisibility.Hidden;
            bool firstGroup = true;
            foreach (var cat in RecipeGroups)
            {
                bool header = false;
                foreach (var recipe in Recipes.All)
                {
                    if (recipe.Output.Category != cat) continue;
                    if (!header)
                    {
                        header = true;
                        var groupLabel = UiKit.Text(GroupName(cat), "caps", "pda-group");
                        if (firstGroup) groupLabel.AddToClassList("is-first");
                        firstGroup = false;
                        scroll.Add(groupLabel);
                    }
                    var row = new RecipeRow { Recipe = recipe };
                    row.Root = UiKit.El("pda-row");
                    row.Glyph = new GlyphElement(recipe.Output.Glyph, UiKit.CategoryColor(cat)).With("pda-row__glyph");
                    row.Name = UiKit.Text(recipe.Output.Name, "pda-row__name");
                    row.Status = new GlyphElement().With("pda-row__status");
                    row.Root.Add(row.Glyph);
                    row.Root.Add(row.Name);
                    row.Root.Add(UiKit.El("grow"));
                    row.Root.Add(row.Status);
                    var r = recipe;
                    row.Root.RegisterCallback<ClickEvent>(_ =>
                    {
                        selRecipe = r;
                        dirty = true;
                        RefreshFabricator();
                    });
                    recipeRows.Add(row);
                    scroll.Add(row.Root);
                }
            }
            page.Add(scroll);

            var detail = new GlassPanel(GlassPanel.Look.Plain);
            detail.AddToClassList("pda-detail");
            detail.AddToClassList("pda-fab__detail");
            fabEmpty = UiKit.El("pda-empty");
            fabEmpty.Add(new GlyphElement(GlyphId.Wrench, UiKit.Shade(UiKit.InkDim, 0.6f)).With("pda-empty__glyph"));
            fabEmpty.Add(UiKit.Text("SELECT A RECIPE", "caps"));
            detail.Add(fabEmpty);

            fabBody = UiKit.El("pda-detail__body");
            var head = UiKit.El("pda-detail__head");
            fabBadge = new GlassPanel(GlassPanel.Look.Slot) { Glow = 0.55f };
            fabBadge.AddToClassList("pda-badge");
            fabGlyph = new GlyphElement().With("pda-badge__glyph");
            fabBadge.Add(fabGlyph);
            head.Add(fabBadge);
            var titleCol = UiKit.El("pda-detail__titlecol");
            fabName = UiKit.Text("", "pda-h1", "wrap");
            titleCol.Add(fabName);
            var chips = UiKit.El("pda-chips");
            fabCount = UiKit.Text("", "pda-count");
            fabTime = UiKit.Text("", "pda-count");
            chips.Add(fabCount);
            chips.Add(fabTime);
            titleCol.Add(chips);
            head.Add(titleCol);
            fabBody.Add(head);

            fabDesc = UiKit.Text("", "pda-desc", "wrap");
            fabBody.Add(fabDesc);
            fabEffects = UiKit.El("pda-effects");
            fabBody.Add(fabEffects);
            fabBody.Add(UiKit.Text("INGREDIENTS", "caps", "pda-section"));
            fabIngredients = UiKit.El("pda-ingredients");
            fabBody.Add(fabIngredients);
            fabBody.Add(UiKit.El("grow"));

            fabBanner = UiKit.El("pda-banner");
            fabBanner.Add(new GlyphElement(Glyphs.Lock, UiKit.Amber).With("pda-banner__icon"));
            fabStation = UiKit.Text("REQUIRES FABRICATOR", "pda-banner__text");
            fabBanner.Add(fabStation);
            fabBody.Add(fabBanner);

            craftProgressWrap = UiKit.El("pda-progress");
            craftProgressLabel = UiKit.Text("FABRICATING", "caps", "caps--cyan");
            craftProgressWrap.Add(craftProgressLabel);
            craftBar = new BarElement().With("pda-progress__bar");
            craftBar.SetStops((0f, UiKit.Hex("#38b6e6")), (1f, UiKit.Hex("#8af0ff")));
            craftProgressWrap.Add(craftBar);
            fabBody.Add(craftProgressWrap);

            var actions = UiKit.El("pda-actions", "pda-actions--row");
            craftButton = UiKit.Button("CRAFT", OnCraftClicked, "pda-action", "pda-craft");
            cancelButton = UiKit.Button("CANCEL", () => SurvivorHub.RequestCraftCancel(), "hs-btn--ghost", "pda-action", "pda-cancel");
            actions.Add(craftButton);
            actions.Add(cancelButton);
            fabBody.Add(actions);
            fabReason = UiKit.Text("", "pda-reason");
            fabBody.Add(fabReason);
            detail.Add(fabBody);
            page.Add(detail);
            return page;
        }

        private static string GroupName(ItemCategory c)
        {
            switch (c)
            {
                case ItemCategory.Material: return "MATERIALS";
                case ItemCategory.Food: return "FOOD";
                case ItemCategory.Consumable: return "SUPPLIES";
                case ItemCategory.Tool: return "TOOLS";
                case ItemCategory.Equipment: return "EQUIPMENT";
                default: return c.ToString().ToUpperInvariant();
            }
        }

        private static CraftStations Station() => SurvivorHub.AtFabricator ? CraftStations.All : CraftStations.None;

        private void OnCraftClicked()
        {
            var inv = SurvivorHub.Inventory;
            if (selRecipe == null || inv == null) return;
            if (Crafting.Check(selRecipe, inv, Station()) != CraftResult.Ok) return;
            SurvivorHub.RequestCraft(selRecipe.Id);
        }

        private void RefreshFabricator()
        {
            var inv = SurvivorHub.Inventory;
            if (inv == null) return;
            bool atFab = SurvivorHub.AtFabricator;
            if (selRecipe == null && recipeRows.Count > 0) selRecipe = recipeRows[0].Recipe;

            foreach (var row in recipeRows)
            {
                var res = Crafting.Check(row.Recipe, inv, Station());
                bool ok = res == CraftResult.Ok;
                UiKit.SetClass(row.Root, "is-selected", row.Recipe == selRecipe);
                UiKit.SetClass(row.Root, "is-dim", !ok);
                if (ok) row.Status.Set(Glyphs.Check, UiKit.Ok);
                else if (res == CraftResult.WrongStation) row.Status.Set(Glyphs.Lock, UiKit.Shade(UiKit.Amber, 0.8f));
                else row.Status.Set(-1, UiKit.Ink);
            }

            bool any = selRecipe != null;
            UiKit.Show(fabEmpty, !any);
            UiKit.Show(fabBody, any);
            if (!any) return;

            var def = selRecipe.Output;
            var color = UiKit.CategoryColor(def.Category);
            fabGlyph.Set(def.Glyph, color, 0.7f);
            fabBadge.GlowColor = color;
            fabBadge.EdgeColor = UiKit.WithAlpha(color, 0.4f);
            UiKit.SetText(fabName, def.Name.ToUpperInvariant());
            UiKit.SetText(fabCount, $"×{selRecipe.OutputCount}   IN PACK  {inv.Count(selRecipe.Id)}");
            UiKit.SetText(fabTime, $"{selRecipe.Seconds:0.0} S");
            UiKit.SetText(fabDesc, def.Description);

            fabEffects.Clear();
            AddEffectTo(fabEffects, def.Food, "FOOD", UiKit.Amber);
            AddEffectTo(fabEffects, def.Water, "WATER", UiKit.Water);
            AddEffectTo(fabEffects, def.Oxygen, "OXYGEN", UiKit.Cyan);
            AddEffectTo(fabEffects, def.Health, "HEALTH", UiKit.Ok);
            if (def.OxygenCapacityFactor > 1.001f) fabEffects.Add(MakeChip($"OXYGEN CAPACITY \u00D7{def.OxygenCapacityFactor:0.#}", UiKit.Cyan));
            if (def.Insulation > 0.001f) fabEffects.Add(MakeChip($"INSULATION +{Mathf.RoundToInt(def.Insulation * 100f)}%", UiKit.Water));
            UiKit.Show(fabEffects, fabEffects.childCount > 0);

            fabIngredients.Clear();
            foreach (var input in selRecipe.Inputs)
            {
                var idef = ItemCatalog.Get(input.Id);
                int have = inv.Count(input.Id);
                bool enough = have >= input.Count;
                var row = UiKit.El("pda-ing");
                row.Add(new GlyphElement(idef.Glyph, UiKit.CategoryColor(idef.Category)).With("pda-ing__glyph"));
                row.Add(UiKit.Text(idef.Name, "pda-ing__name"));
                row.Add(UiKit.El("grow"));
                var count = UiKit.Text($"{have} / {input.Count}", "pda-ing__count", enough ? "is-ok" : "is-danger");
                row.Add(count);
                fabIngredients.Add(row);
            }

            var res2 = Crafting.Check(selRecipe, inv, Station());
            bool craftingThis = SurvivorHub.CraftingRecipe == selRecipe.Id;
            bool craftingOther = SurvivorHub.CraftingRecipe != null && !craftingThis;
            UiKit.Show(fabBanner, !atFab);
            UiKit.Show(craftProgressWrap, craftingThis);
            UiKit.Show(craftButton, !craftingThis);
            UiKit.Show(cancelButton, craftingThis);
            bool canCraft = res2 == CraftResult.Ok && !craftingOther;
            craftButton.SetEnabled(canCraft);
            string reason = "";
            if (craftingOther) reason = "Another item is being fabricated.";
            else if (res2 == CraftResult.WrongStation) reason = "Stand at the fabricator in the Wren bay to craft.";
            else if (res2 == CraftResult.MissingIngredients) reason = "Missing ingredients.";
            else if (res2 == CraftResult.NoSpace) reason = "Your pack is full.";
            UiKit.SetText(fabReason, reason);
            UiKit.Show(fabReason, reason.Length > 0 && !craftingThis);
            UiKit.SetButtonText(craftButton, res2 == CraftResult.WrongStation ? "REQUIRES FABRICATOR" : "CRAFT");
            UpdateCraftProgress();
        }

        private void UpdateCraftProgress()
        {
            if (current != PdaTab.Fabricator || craftBar == null) return;
            float p = SurvivorHub.CraftingRecipe != null ? SurvivorHub.CraftProgress : 0f;
            craftBar.Value = p;
            UiKit.SetText(craftProgressLabel, $"FABRICATING  {Mathf.RoundToInt(p * 100f)}%");
        }

        // ------------------------------------------------------------------ databank

        private VisualElement BuildDatabankPage()
        {
            var page = UiKit.El("pda-page", "pda-fab", "slide-in");
            var left = UiKit.El("pda-fab__list", "pda-db__left");
            dbCount = UiKit.Text("", "caps", "pda-db__count");
            left.Add(dbCount);
            var scroll = new ScrollView(ScrollViewMode.Vertical);
            scroll.AddToClassList("pda-scroll");
            scroll.AddToClassList("pda-db__scroll");
            scroll.horizontalScrollerVisibility = ScrollerVisibility.Hidden;
            dbList = scroll;
            left.Add(scroll);
            dbLocked = UiKit.Text("", "pda-db__locked");
            left.Add(dbLocked);
            page.Add(left);

            var detail = new GlassPanel(GlassPanel.Look.Plain);
            detail.AddToClassList("pda-detail");
            detail.AddToClassList("pda-fab__detail");
            dbEmpty = UiKit.El("pda-empty");
            dbEmpty.Add(new GlyphElement(Glyphs.Scan, UiKit.Shade(UiKit.InkDim, 0.6f)).With("pda-empty__glyph"));
            dbEmpty.Add(UiKit.Text("NO ENTRIES YET", "caps"));
            dbEmpty.Add(UiKit.Text("Hold V with the scanner equipped to log what you find.", "pda-empty__hint", "wrap"));
            detail.Add(dbEmpty);

            dbBody = UiKit.El("pda-detail__body");
            var head = UiKit.El("pda-detail__head");
            dbBadge = new GlassPanel(GlassPanel.Look.Slot) { Glow = 0.55f };
            dbBadge.AddToClassList("pda-badge");
            dbGlyph = new GlyphElement().With("pda-badge__glyph");
            dbBadge.Add(dbGlyph);
            head.Add(dbBadge);
            var titleCol = UiKit.El("pda-detail__titlecol");
            dbTitle = UiKit.Text("", "pda-h1", "wrap");
            titleCol.Add(dbTitle);
            var chips = UiKit.El("pda-chips");
            dbChip = UiKit.El("chip");
            dbChipText = UiKit.Text("", "chip__text");
            dbChip.Add(dbChipText);
            chips.Add(dbChip);
            titleCol.Add(chips);
            head.Add(titleCol);
            dbBody.Add(head);
            dbDesc = UiKit.Text("", "pda-desc", "wrap");
            dbBody.Add(dbDesc);
            dbYields = UiKit.El("pda-effects");
            dbBody.Add(UiKit.Text("YIELDS", "caps", "pda-section"));
            dbBody.Add(dbYields);
            detail.Add(dbBody);
            page.Add(detail);
            return page;
        }

        private void RefreshDatabank()
        {
            var db = SurvivorHub.Databank;
            var ids = new List<string>();
            if (db != null)
                for (int i = db.Unlocked.Count - 1; i >= 0; i--)
                    if (SurvivorHub.DatabankEntries.ContainsKey(db.Unlocked[i])) ids.Add(db.Unlocked[i]);

            dbList.Clear();
            dbRows.Clear();
            foreach (string id in ids)
            {
                var e = SurvivorHub.DatabankEntries[id];
                var row = new DbRow { Id = id };
                row.Root = UiKit.El("pda-row");
                row.Glyph = new GlyphElement(e.Glyph, EntryColor(e)).With("pda-row__glyph");
                var col = UiKit.El("pda-row__col");
                row.Title = UiKit.Text(e.Title, "pda-row__name");
                row.Category = UiKit.Text((e.Category ?? "").ToUpperInvariant(), "pda-row__sub");
                col.Add(row.Title);
                col.Add(row.Category);
                row.Root.Add(row.Glyph);
                row.Root.Add(col);
                string rid = id;
                row.Root.RegisterCallback<ClickEvent>(_ =>
                {
                    selEntry = rid;
                    RefreshDatabank();
                });
                dbRows.Add(row);
                dbList.Add(row.Root);
            }
            int total = SurvivorHub.DatabankEntries.Count;
            UiKit.SetText(dbCount, $"LOGGED  {ids.Count} / {Mathf.Max(total, ids.Count)}");
            int undiscovered = Mathf.Max(0, total - ids.Count);
            UiKit.SetText(dbLocked, undiscovered > 0 ? $"{undiscovered} undiscovered" : "");
            UiKit.Show(dbLocked, undiscovered > 0);

            if (selEntry == null || !ids.Contains(selEntry)) selEntry = ids.Count > 0 ? ids[0] : null;
            foreach (var row in dbRows) UiKit.SetClass(row.Root, "is-selected", row.Id == selEntry);

            bool any = selEntry != null;
            UiKit.Show(dbEmpty, !any);
            UiKit.Show(dbBody, any);
            if (!any) return;
            var entry = SurvivorHub.DatabankEntries[selEntry];
            var color = EntryColor(entry);
            dbGlyph.Set(entry.Glyph, color, 0.7f);
            dbBadge.GlowColor = color;
            dbBadge.EdgeColor = UiKit.WithAlpha(color, 0.4f);
            UiKit.SetText(dbTitle, (entry.Title ?? "").ToUpperInvariant());
            StyleChip(dbChip, dbChipText, (entry.Category ?? "").ToUpperInvariant(), color);
            UiKit.SetText(dbDesc, entry.Description);
            dbYields.Clear();
            foreach (string yid in entry.Yields)
            {
                if (!ItemCatalog.TryGet(yid, out var def)) continue;
                var chip = UiKit.El("pda-yield");
                chip.Add(new GlyphElement(def.Glyph, UiKit.CategoryColor(def.Category)).With("pda-yield__glyph"));
                chip.Add(UiKit.Text(def.Name, "pda-yield__name"));
                dbYields.Add(chip);
            }
            if (entry.Yields.Length == 0) dbYields.Add(UiKit.Text("Nothing to gather.", "pda-reason"));
        }

        private static Color EntryColor(DatabankEntry e)
        {
            if (e.Yields != null && e.Yields.Length > 0 && ItemCatalog.TryGet(e.Yields[0], out var def))
                return UiKit.CategoryColor(def.Category);
            return UiKit.Cyan;
        }

        // ------------------------------------------------------------------ objectives

        private VisualElement BuildObjectivesPage()
        {
            var page = UiKit.El("pda-page", "pda-obj", "slide-in");
            objCard = new GlassPanel { Glow = 0.5f };
            objCard.AddToClassList("pda-obj__card");
            var head = UiKit.El("hud-objective__head");
            head.Add(new GlyphElement(GlyphId.Crystal, UiKit.Cyan).With("hud-objective__icon"));
            head.Add(UiKit.Text("CURRENT OBJECTIVE", "caps", "caps--cyan"));
            objCard.Add(head);
            objCurrent = UiKit.Text("", "pda-obj__text", "wrap");
            objCard.Add(objCurrent);
            page.Add(objCard);

            page.Add(UiKit.Text("LOG", "caps", "pda-section", "pda-obj__loglabel"));
            var scroll = new ScrollView(ScrollViewMode.Vertical);
            scroll.AddToClassList("pda-scroll");
            scroll.AddToClassList("pda-obj__scroll");
            objLog = scroll;
            page.Add(scroll);
            return page;
        }

        private void RefreshObjectives()
        {
            UiKit.SetText(objCurrent, string.IsNullOrEmpty(SurvivorHub.ObjectiveText) ? "No objective." : SurvivorHub.ObjectiveText);
            objLog.Clear();
            foreach (string line in SurvivorHub.ObjectiveLog)
            {
                var row = UiKit.El("pda-logrow");
                row.Add(new GlyphElement(Glyphs.Check, UiKit.Ok).With("pda-logrow__icon"));
                row.Add(UiKit.Text(line, "pda-logrow__text"));
                objLog.Add(row);
            }
            if (SurvivorHub.ObjectiveLog.Count == 0) objLog.Add(UiKit.Text("Nothing completed yet.", "pda-reason"));
        }
    }

    /// <summary>Barely-there horizontal scanlines over the PDA, for a screen feel. Kept very faint.</summary>
    public sealed class ScanlineElement : VisualElement
    {
        public ScanlineElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("pda-scanlines");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 8f || h < 8f) return;
            var p = mgc.painter2D;
            p.strokeGradient = null;
            p.strokeColor = new Color(0.6f, 0.9f, 1f, 0.022f);
            p.lineWidth = 1f;
            p.lineCap = LineCap.Butt;
            p.BeginPath();
            for (float y = 8f; y < h - 8f; y += 4f)
            {
                p.MoveTo(new Vector2(10f, y));
                p.LineTo(new Vector2(w - 10f, y));
            }
            p.Stroke();
        }
    }
}
