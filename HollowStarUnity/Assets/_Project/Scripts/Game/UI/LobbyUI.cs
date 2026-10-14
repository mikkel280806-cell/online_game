using HollowStar.Core;
using HollowStar.Game.Net;
using UnityEngine;
using UnityEngine.UIElements;

namespace HollowStar.Game.UI
{
    /// <summary>
    /// The lobby menu and the in-game HUD, built in code on a UIDocument so there is no UXML or USS
    /// to keep in sync. It only reads <see cref="SessionFlow"/> state and calls its actions.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class LobbyUI : MonoBehaviour
    {
        public SessionFlow Flow;

        private const float NoticeSeconds = 4f;

        // Suit accents (host orange, guest teal) and the dark translucent panel look.
        private static readonly Color HostColor = Hex("#ff7a1a");
        private static readonly Color GuestColor = Hex("#29d3ff");
        private static readonly Color NeutralColor = Hex("#c9c4b8");
        private static readonly Color PanelColor = new Color(0.035f, 0.045f, 0.06f, 0.84f);
        private static readonly Color TextColor = Hex("#efece6");
        private static readonly Color DimColor = new Color(0.94f, 0.93f, 0.9f, 0.55f);
        private static readonly Color WarnColor = Hex("#ff9473");
        private static readonly Color LineColor = new Color(1f, 1f, 1f, 0.09f);

        private VisualElement root, menu, hud, noticeBox, roleDot;
        private Button createButton, joinButton, soloButton;
        private TextField codeField;
        private Label status, hudCaption, hudCode, hudRole, hudPartner, hudLink, noticeLabel;
        private Button copyButton;
        private SessionPhase shownPhase = (SessionPhase)(-1);

        private static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out Color c);
            return c;
        }

        private static Color Alpha(Color c, float a) => new Color(c.r, c.g, c.b, a);

        private void Start()
        {
            if (Flow == null) Flow = FindAnyObjectByType<SessionFlow>();
            root = GetComponent<UIDocument>().rootVisualElement;
            root.style.flexGrow = 1;
            // Clicks that miss the UI fall through to the game (camera drag).
            root.pickingMode = PickingMode.Ignore;
            root.Add(menu = BuildMenu());
            root.Add(hud = BuildHud());
            root.Add(noticeBox = BuildNotice());
            Refresh();
        }

        // ---------------------------------------------------------------- layout

        private static void Pad(IStyle s, float v, float h)
        {
            s.paddingTop = s.paddingBottom = v;
            s.paddingLeft = s.paddingRight = h;
        }

        private static void Round(IStyle s, float r)
        {
            s.borderTopLeftRadius = s.borderTopRightRadius = s.borderBottomLeftRadius = s.borderBottomRightRadius = r;
        }

        private static void Border(IStyle s, float width, Color c)
        {
            s.borderTopWidth = s.borderBottomWidth = s.borderLeftWidth = s.borderRightWidth = width;
            s.borderTopColor = s.borderBottomColor = s.borderLeftColor = s.borderRightColor = c;
        }

        private static void NoMargin(IStyle s) => s.marginTop = s.marginBottom = s.marginLeft = s.marginRight = 0;

        private static Label Text(string text, float size, Color color, bool bold = false)
        {
            var l = new Label(text);
            l.style.fontSize = size;
            l.style.color = color;
            if (bold) l.style.unityFontStyleAndWeight = FontStyle.Bold;
            NoMargin(l.style);
            Pad(l.style, 0, 0);
            return l;
        }

        private static VisualElement Panel()
        {
            var p = new VisualElement();
            p.style.backgroundColor = PanelColor;
            Round(p.style, 10);
            Border(p.style, 1, LineColor);
            return p;
        }

        /// <summary>A big menu button: a coloured edge for the role it leads to, a title and a one-line hint.</summary>
        private static Button BigButton(string title, string hint, Color accent, System.Action onClick)
        {
            var b = new Button(onClick) { text = "" };
            var s = b.style;
            NoMargin(s);
            s.marginTop = 12;
            Pad(s, 11, 16);
            s.flexDirection = FlexDirection.Column;
            s.alignItems = Align.FlexStart;
            Round(s, 8);
            Border(s, 1, Alpha(accent, 0.35f));
            s.borderLeftWidth = 4;
            s.borderLeftColor = accent;
            Color idle = Alpha(accent, 0.12f), hover = Alpha(accent, 0.24f);
            s.backgroundColor = idle;
            b.RegisterCallback<PointerEnterEvent>(_ => b.style.backgroundColor = hover);
            b.RegisterCallback<PointerLeaveEvent>(_ => b.style.backgroundColor = idle);
            b.Add(Text(title, 18, TextColor, true));
            var h = Text(hint, 13, DimColor);
            h.style.marginTop = 2;
            b.Add(h);
            return b;
        }

        private static Button SmallButton(string text, System.Action onClick)
        {
            var b = new Button(onClick) { text = text, focusable = false };
            var s = b.style;
            NoMargin(s);
            Pad(s, 4, 10);
            s.fontSize = 12;
            s.color = TextColor;
            Round(s, 6);
            Border(s, 1, LineColor);
            Color idle = new Color(1f, 1f, 1f, 0.06f), hover = new Color(1f, 1f, 1f, 0.14f);
            s.backgroundColor = idle;
            b.RegisterCallback<PointerEnterEvent>(_ => b.style.backgroundColor = hover);
            b.RegisterCallback<PointerLeaveEvent>(_ => b.style.backgroundColor = idle);
            return b;
        }

        private VisualElement BuildMenu()
        {
            var overlay = new VisualElement();
            var o = overlay.style;
            o.position = Position.Absolute;
            o.left = o.right = o.top = o.bottom = 0;
            o.justifyContent = Justify.Center;
            o.alignItems = Align.Center;
            o.backgroundColor = new Color(0.01f, 0.012f, 0.02f, 0.5f);

            var card = Panel();
            card.style.width = 460;
            Pad(card.style, 34, 36);
            overlay.Add(card);

            var title = Text("HOLLOW STAR", 40, TextColor, true);
            title.style.letterSpacing = 9;
            // Letter spacing also trails the last letter; pad the left so the word sits centred.
            title.style.paddingLeft = 9;
            title.style.unityTextAlign = TextAnchor.MiddleCenter;
            card.Add(title);
            var sub = Text("Two-player co-op survival", 15, DimColor);
            sub.style.unityTextAlign = TextAnchor.MiddleCenter;
            sub.style.marginTop = 6;
            sub.style.marginBottom = 18;
            card.Add(sub);

            card.Add(createButton = BigButton("Create room", "Host a game and send your partner its code.", HostColor, () => Flow.CreateRoom()));

            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.marginTop = 12;
            codeField = new TextField { maxLength = 12 };
            codeField.textEdition.placeholder = "ROOM CODE";
            codeField.textEdition.hidePlaceholderOnFocus = true;
            NoMargin(codeField.style);
            codeField.style.flexGrow = 1;
            codeField.style.marginRight = 10;
            var input = codeField.Q(className: TextField.inputUssClassName);
            var i = input.style;
            i.backgroundColor = new Color(1f, 1f, 1f, 0.05f);
            Round(i, 8);
            Border(i, 1, Alpha(GuestColor, 0.35f));
            Pad(i, 0, 14);
            NoMargin(i);
            i.fontSize = 22;
            i.letterSpacing = 5;
            i.color = DimColor;
            i.unityFontStyleAndWeight = FontStyle.Bold;
            i.unityTextAlign = TextAnchor.MiddleLeft;
            i.minHeight = 58;
            // Codes are upper case; show what will be sent. The placeholder shares the text colour, so dim it while empty.
            codeField.RegisterValueChangedCallback(e =>
            {
                codeField.SetValueWithoutNotify(e.newValue.ToUpperInvariant());
                input.style.color = string.IsNullOrEmpty(e.newValue) ? DimColor : TextColor;
            });
            codeField.RegisterCallback<KeyDownEvent>(e =>
            {
                if (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter) Flow.JoinRoom(codeField.value);
            }, TrickleDown.TrickleDown);
            // While typing, keys go to the field only, not to the player or the camera.
            codeField.RegisterCallback<FocusInEvent>(_ => PlayerControls.Blocked = true);
            codeField.RegisterCallback<FocusOutEvent>(_ => PlayerControls.Blocked = false);
            row.Add(codeField);
            joinButton = BigButton("Join", "a partner's room", GuestColor, () => Flow.JoinRoom(codeField.value));
            joinButton.style.marginTop = 0;
            joinButton.style.width = 128;
            row.Add(joinButton);
            card.Add(row);

            card.Add(soloButton = BigButton("Play solo", "Explore on your own.", NeutralColor, () => Flow.PlaySolo()));

            status = Text("", 14, DimColor);
            status.style.marginTop = 20;
            status.style.minHeight = 20;
            status.style.whiteSpace = WhiteSpace.Normal;
            status.style.unityTextAlign = TextAnchor.MiddleCenter;
            card.Add(status);

            var keys = Text("WASD move  ·  Shift sprint  ·  Space dash  ·  drag or Q/E to look", 12, Alpha(DimColor, 0.4f));
            keys.style.unityTextAlign = TextAnchor.MiddleCenter;
            keys.style.marginTop = 14;
            card.Add(keys);
            return overlay;
        }

        private VisualElement BuildHud()
        {
            var p = Panel();
            var s = p.style;
            s.position = Position.Absolute;
            s.left = 18;
            s.top = 18;
            s.minWidth = 270;
            Pad(s, 14, 18);

            var top = new VisualElement();
            top.style.flexDirection = FlexDirection.Row;
            top.style.alignItems = Align.Center;
            hudCaption = Text("ROOM", 12, DimColor, true);
            hudCaption.style.letterSpacing = 3;
            hudCaption.style.marginRight = 10;
            top.Add(hudCaption);
            hudCode = Text("", 26, TextColor, true);
            hudCode.style.letterSpacing = 4;
            hudCode.style.flexGrow = 1;
            top.Add(hudCode);
            copyButton = SmallButton("Copy", () => GUIUtility.systemCopyBuffer = Flow.JoinCode);
            copyButton.style.marginLeft = 12;
            top.Add(copyButton);
            p.Add(top);

            var role = new VisualElement();
            role.style.flexDirection = FlexDirection.Row;
            role.style.alignItems = Align.Center;
            role.style.marginTop = 8;
            roleDot = new VisualElement();
            roleDot.style.width = roleDot.style.height = 11;
            Round(roleDot.style, 5.5f);
            roleDot.style.marginRight = 8;
            role.Add(roleDot);
            hudRole = Text("", 17, TextColor, true);
            role.Add(hudRole);
            p.Add(role);

            hudPartner = Text("", 14, TextColor);
            hudPartner.style.marginTop = 6;
            p.Add(hudPartner);
            hudLink = Text("", 13, DimColor);
            hudLink.style.marginTop = 3;
            p.Add(hudLink);

            var leave = SmallButton("Leave", () => Flow.Leave());
            leave.style.marginTop = 10;
            leave.style.alignSelf = Align.FlexStart;
            p.Add(leave);
            return p;
        }

        private VisualElement BuildNotice()
        {
            var strip = new VisualElement { pickingMode = PickingMode.Ignore };
            var s = strip.style;
            s.position = Position.Absolute;
            s.left = s.right = 0;
            s.top = 20;
            s.alignItems = Align.Center;
            noticeLabel = Text("", 16, TextColor, true);
            noticeLabel.pickingMode = PickingMode.Ignore;
            noticeLabel.style.backgroundColor = PanelColor;
            Round(noticeLabel.style, 18);
            Border(noticeLabel.style, 1, LineColor);
            Pad(noticeLabel.style, 8, 20);
            strip.Add(noticeLabel);
            return strip;
        }

        // ---------------------------------------------------------------- state

        private void Update()
        {
            if (root != null && Flow != null) Refresh();
        }

        private static void Show(VisualElement e, bool on) => e.style.display = on ? DisplayStyle.Flex : DisplayStyle.None;

        private static void SetText(Label l, string text)
        {
            if (l.text != text) l.text = text;
        }

        private void Refresh()
        {
            SessionPhase phase = Flow.Phase;
            if (phase != shownPhase)
            {
                shownPhase = phase;
                Show(menu, !Flow.InGame);
                Show(hud, Flow.InGame);
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
                SetText(status, error ? Flow.Error : Flow.Status);
                status.style.color = error ? WarnColor : DimColor;
            }
            else
            {
                RefreshHud();
            }

            float age = Time.unscaledTime - Flow.NoticeTime;
            bool notice = Flow.InGame && !string.IsNullOrEmpty(Flow.Notice) && age < NoticeSeconds;
            Show(noticeBox, notice);
            if (notice)
            {
                SetText(noticeLabel, Flow.Notice);
                noticeBox.style.opacity = Mathf.Clamp01((NoticeSeconds - age) / 0.6f);
            }
        }

        private void RefreshHud()
        {
            bool solo = Flow.IsSolo;
            SetText(hudCaption, solo ? "SOLO" : "ROOM");
            SetText(hudCode, solo ? "" : Flow.JoinCode ?? "");
            Show(copyButton, !solo);

            RoleId role = Flow.LocalRole;
            // RoleId is only identity now: both players are equal, the host wears orange, the guest teal.
            Color accent = role == RoleId.Vanguard ? HostColor : GuestColor;
            SetText(hudRole, solo ? "You" : Flow.IsHost ? "You (host)" : "You (guest)");
            hudRole.style.color = accent;
            roleDot.style.backgroundColor = accent;

            if (solo)
            {
                Show(hudPartner, false);
            }
            else
            {
                Show(hudPartner, true);
                if (Flow.PartnerConnected)
                {
                    SetText(hudPartner, "Partner connected");
                    hudPartner.style.color = TextColor;
                }
                else if (Flow.PartnerLeft)
                {
                    SetText(hudPartner, "Partner disconnected. The code still works.");
                    hudPartner.style.color = WarnColor;
                }
                else
                {
                    SetText(hudPartner, "Waiting for partner: share the code");
                    hudPartner.style.color = DimColor;
                }
            }

            SetText(hudLink, solo || Flow.RttMs <= 0 ? Flow.TransportLabel : $"{Flow.TransportLabel}  ·  {Flow.RttMs} ms");
        }
    }
}
