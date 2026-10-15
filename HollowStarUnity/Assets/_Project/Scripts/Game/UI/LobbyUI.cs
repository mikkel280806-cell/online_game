using HollowStar.Core;
using HollowStar.Game.Net;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// The lobby menu and the in-game session card, built in code on a UIDocument and styled by Theme.uss and
    /// Lobby.uss (the same tinted-glass look as the HUD and PDA). It only reads <see cref="SessionFlow"/> state
    /// and calls its actions.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class LobbyUI : MonoBehaviour
    {
        public SessionFlow Flow;
        public StyleSheet Theme;
        public StyleSheet Style;

        private const float NoticeSeconds = 4f;

        // Suit accents: host orange, guest teal.
        private static readonly Color HostColor = UiKit.Hex("#ff7a1a");
        private static readonly Color GuestColor = UiKit.Hex("#29d3ff");

        private VisualElement root, menu, hud, noticeBox, roleDot, copyButton, createButton, joinButton, soloButton;
        private GlassPanel hudPanel;
        private TextField codeField;
        private Label status, hudCode, hudRole, hudPartner, hudLink, noticeLabel;
        private VisualElement codeRow;
        private SessionPhase shownPhase = (SessionPhase)(-1);

        private void Start()
        {
            if (Flow == null) Flow = FindAnyObjectByType<SessionFlow>();
            root = GetComponent<UIDocument>().rootVisualElement;
            root.style.flexGrow = 1;
            // Clicks that miss the UI fall through to the game (camera drag).
            root.pickingMode = PickingMode.Ignore;
            if (Theme != null) root.styleSheets.Add(Theme);
            if (Style != null) root.styleSheets.Add(Style);
            root.AddToClassList("hs-root");
            root.Add(menu = BuildMenu());
            root.Add(hud = BuildHud());
            root.Add(noticeBox = BuildNotice());
            Refresh();
        }

        // ---------------------------------------------------------------- layout

        /// <summary>A big menu button: a title and a one-line hint, tinted by the role it leads to.</summary>
        private static VisualElement BigButton(string title, string hint, string variant, System.Action onClick)
        {
            var b = UiKit.Button("", onClick, "lobby-btn", variant);
            // Replace the single label with a title and a hint.
            var text = b.Q<Label>(className: "hs-btn__text");
            b.Remove(text);
            var col = UiKit.El("lobby-btn__col");
            col.pickingMode = PickingMode.Ignore;
            var t = UiKit.Text(title, "lobby-btn__title");
            t.pickingMode = PickingMode.Ignore;
            var h = UiKit.Text(hint, "lobby-btn__hint");
            h.pickingMode = PickingMode.Ignore;
            col.Add(t);
            col.Add(h);
            b.Add(col);
            return b;
        }

        private VisualElement BuildMenu()
        {
            var overlay = UiKit.El("lobby");
            overlay.Add(new VignetteElement(Color.black, 0.62f));

            var inner = UiKit.El("lobby__inner");
            overlay.Add(inner);

            var titleWrap = UiKit.El("lobby__titlewrap");
            titleWrap.Add(new TitleGlowElement());
            titleWrap.Add(UiKit.Text("HOLLOW STAR", "lobby__title"));
            inner.Add(titleWrap);
            inner.Add(UiKit.Text("A CO-OP SURVIVAL STORY", "lobby__subtitle"));

            var card = new GlassPanel();
            card.AddToClassList("lobby__card");
            inner.Add(card);

            card.Add(createButton = BigButton("CREATE ROOM", "Host a game and send your partner its code.", "lobby-btn--cyan", () => Flow.CreateRoom()));

            codeRow = UiKit.El("lobby__joinrow");
            codeField = new TextField { maxLength = 12 };
            codeField.AddToClassList("lobby__code");
            codeField.textEdition.placeholder = "ROOM CODE";
            codeField.textEdition.hidePlaceholderOnFocus = true;
            // Codes are upper case; show what will be sent.
            codeField.RegisterValueChangedCallback(e => codeField.SetValueWithoutNotify(e.newValue.ToUpperInvariant()));
            codeField.RegisterCallback<KeyDownEvent>(e =>
            {
                if (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter) Flow.JoinRoom(codeField.value);
            }, TrickleDown.TrickleDown);
            // While typing, keys go to the field only, not to the player or the camera.
            codeField.RegisterCallback<FocusInEvent>(_ => PlayerControls.Blocked = true);
            codeField.RegisterCallback<FocusOutEvent>(_ => PlayerControls.Blocked = false);
            codeRow.Add(codeField);
            joinButton = UiKit.Button("JOIN", () => Flow.JoinRoom(codeField.value), "hs-btn--amber", "lobby__join");
            codeRow.Add(joinButton);
            card.Add(codeRow);

            var divider = UiKit.El("lobby__divider");
            divider.Add(UiKit.El("lobby__rule"));
            divider.Add(UiKit.Text("OR", "lobby__or"));
            divider.Add(UiKit.El("lobby__rule"));
            card.Add(divider);

            card.Add(soloButton = BigButton("PLAY SOLO", "Explore on your own.", "lobby-btn--ghost", () => Flow.PlaySolo()));

            status = UiKit.Text("", "lobby__status", "wrap");
            card.Add(status);

            var keys = UiKit.El("lobby__keys");
            AddKey(keys, "WASD", "move");
            AddKey(keys, "SHIFT", "sprint");
            AddKey(keys, "SPACE", "dash");
            AddKey(keys, "F", "gather");
            AddKey(keys, "R", "use");
            AddKey(keys, "TAB", "PDA");
            inner.Add(keys);
            return overlay;
        }

        private static void AddKey(VisualElement row, string key, string what)
        {
            var item = UiKit.El("lobby__key");
            item.Add(UiKit.Text(key, "keycap", "keycap--small"));
            item.Add(UiKit.Text(what, "lobby__keytext"));
            row.Add(item);
        }

        private VisualElement BuildHud()
        {
            hudPanel = new GlassPanel(GlassPanel.Look.Chip);
            hudPanel.AddToClassList("lobby-hud");

            var role = UiKit.El("lobby-hud__row");
            roleDot = UiKit.El("hud-dot");
            role.Add(roleDot);
            hudRole = UiKit.Text("", "lobby-hud__role");
            role.Add(hudRole);
            role.Add(UiKit.El("grow"));
            hudCode = UiKit.Text("", "lobby-hud__code");
            role.Add(hudCode);
            hudPanel.Add(role);

            hudPartner = UiKit.Text("", "lobby-hud__partner", "wrap");
            hudPanel.Add(hudPartner);
            hudLink = UiKit.Text("", "lobby-hud__link");
            hudPanel.Add(hudLink);

            var buttons = UiKit.El("lobby-hud__buttons");
            copyButton = UiKit.Button("COPY CODE", () => GUIUtility.systemCopyBuffer = Flow.JoinCode, "hs-btn--small");
            buttons.Add(copyButton);
            var leave = UiKit.Button("LEAVE", () => Flow.Leave(), "hs-btn--small", "hs-btn--ghost", "lobby-hud__leave");
            buttons.Add(leave);
            hudPanel.Add(buttons);
            return hudPanel;
        }

        private VisualElement BuildNotice()
        {
            var strip = UiKit.El("lobby-notice");
            strip.pickingMode = PickingMode.Ignore;
            var pill = new GlassPanel(GlassPanel.Look.Chip) { pickingMode = PickingMode.Ignore };
            pill.AddToClassList("lobby-notice__pill");
            noticeLabel = UiKit.Text("", "lobby-notice__text");
            noticeLabel.pickingMode = PickingMode.Ignore;
            pill.Add(noticeLabel);
            strip.Add(pill);
            return strip;
        }

        // ---------------------------------------------------------------- state

        private void Update()
        {
            if (root != null && Flow != null) Refresh();
        }

        private void Refresh()
        {
            SessionPhase phase = Flow.Phase;
            if (phase != shownPhase)
            {
                shownPhase = phase;
                UiKit.Show(menu, !Flow.InGame);
                UiKit.Show(hud, Flow.InGame);
                if (Flow.InGame)
                {
                    // Nothing in the hidden menu may keep focus: Space or Enter would press its buttons.
                    root.focusController?.focusedElement?.Blur();
                    PlayerControls.Blocked = false;
                }
                bool canStart = Flow.CanStart;
                createButton.SetEnabled(canStart);
                joinButton.SetEnabled(canStart);
                soloButton.SetEnabled(canStart);
                codeField.SetEnabled(canStart);
            }

            if (!Flow.InGame)
            {
                bool error = !string.IsNullOrEmpty(Flow.Error);
                UiKit.SetText(status, error ? Flow.Error : Flow.Status);
                UiKit.SetClass(status, "is-error", error);
            }
            else
            {
                RefreshHud();
            }

            float age = Time.unscaledTime - Flow.NoticeTime;
            bool notice = Flow.InGame && !string.IsNullOrEmpty(Flow.Notice) && age < NoticeSeconds;
            UiKit.Show(noticeBox, notice);
            if (notice)
            {
                UiKit.SetText(noticeLabel, Flow.Notice);
                noticeBox.style.opacity = Mathf.Clamp01((NoticeSeconds - age) / 0.6f);
            }
        }

        private void RefreshHud()
        {
            bool solo = Flow.IsSolo;
            UiKit.SetText(hudCode, solo ? "" : Flow.JoinCode ?? "");
            UiKit.Show(copyButton, !solo);

            RoleId role = Flow.LocalRole;
            // RoleId is only identity now: both players are equal, the host wears orange, the guest teal.
            Color accent = role == RoleId.Vanguard ? HostColor : GuestColor;
            UiKit.SetText(hudRole, solo ? "You" : Flow.IsHost ? "You (host)" : "You (guest)");
            hudRole.style.color = accent;
            roleDot.style.backgroundColor = accent;

            if (solo)
            {
                UiKit.Show(hudPartner, false);
            }
            else
            {
                UiKit.Show(hudPartner, true);
                if (Flow.PartnerConnected)
                {
                    UiKit.SetText(hudPartner, "Partner connected");
                    UiKit.SetClass(hudPartner, "is-warn", false);
                    UiKit.SetClass(hudPartner, "is-dim", false);
                }
                else if (Flow.PartnerLeft)
                {
                    UiKit.SetText(hudPartner, "Partner disconnected. The code still works.");
                    UiKit.SetClass(hudPartner, "is-warn", true);
                    UiKit.SetClass(hudPartner, "is-dim", false);
                }
                else
                {
                    UiKit.SetText(hudPartner, "Waiting for partner: share the code");
                    UiKit.SetClass(hudPartner, "is-warn", false);
                    UiKit.SetClass(hudPartner, "is-dim", true);
                }
            }

            UiKit.SetText(hudLink, solo || Flow.RttMs <= 0 ? Flow.TransportLabel : $"{Flow.TransportLabel}  ·  {Flow.RttMs} ms");
        }
    }

    /// <summary>
    /// A soft warm halo behind the big title: a square element with a radial gradient, squashed into a wide
    /// ellipse by the USS scale (Painter2D gradients are circular).
    /// </summary>
    public sealed class TitleGlowElement : VisualElement
    {
        public TitleGlowElement()
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("lobby__titleglow");
            generateVisualContent += OnGenerate;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        private void OnGenerate(MeshGenerationContext mgc)
        {
            float w = layout.width, h = layout.height;
            if (w < 8f || h < 8f) return;
            var p = mgc.painter2D;
            var c = new Vector2(w * 0.5f, h * 0.5f);
            float r = Mathf.Min(w, h) * 0.5f;
            p.fillGradient = UiKit.Radial(c, r,
                (0f, new Color(1f, 0.58f, 0.26f, 0.34f)),
                (0.35f, new Color(1f, 0.55f, 0.24f, 0.15f)),
                (0.7f, new Color(1f, 0.5f, 0.2f, 0.045f)),
                (1f, new Color(1f, 0.5f, 0.2f, 0f)));
            p.BeginPath();
            p.Arc(c, r, 0f, 360f);
            p.ClosePath();
            p.Fill();
            UiKit.ClearGradients(p);
        }
    }
}
