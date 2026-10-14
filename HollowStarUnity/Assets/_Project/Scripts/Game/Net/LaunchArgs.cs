using System;

namespace HollowStar.Game.Net
{
    /// <summary>
    /// Command-line switches for running two copies on one Mac and for unattended tests:
    /// <c>-hs-profile name</c> (separate sign-in per copy), <c>-hs-auto host|join:CODE|solo</c>
    /// (skip the menu), <c>-hs-autowalk</c> (the local player walks a slow circle) and
    /// <c>-hs-autoleave seconds</c> (leave the room that long after getting in).
    /// </summary>
    public static class LaunchArgs
    {
        public enum AutoMode { None, Host, Join, Solo }

        /// <summary>Services profile, or null to pick a random one.</summary>
        public static readonly string Profile;
        public static readonly AutoMode Auto;
        /// <summary>Room code for <see cref="AutoMode.Join"/>.</summary>
        public static readonly string AutoJoinCode;
        public static readonly bool AutoWalk;
        /// <summary>Seconds in game before leaving on its own; 0 = never.</summary>
        public static readonly float AutoLeave;

        /// <summary>Any test switch is set: log extra diagnostics for the test scripts to read.</summary>
        public static bool Automated => Auto != AutoMode.None || AutoWalk || AutoLeave > 0f;

        static LaunchArgs()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length; i++)
            {
                string next = i + 1 < args.Length ? args[i + 1] : null;
                switch (args[i])
                {
                    case "-hs-profile":
                        Profile = next;
                        break;
                    case "-hs-autowalk":
                        AutoWalk = true;
                        break;
                    case "-hs-autoleave" when next != null:
                        float.TryParse(next, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out AutoLeave);
                        break;
                    case "-hs-auto" when next != null:
                        if (next == "host") Auto = AutoMode.Host;
                        else if (next == "solo") Auto = AutoMode.Solo;
                        else if (next.StartsWith("join:", StringComparison.OrdinalIgnoreCase))
                        {
                            Auto = AutoMode.Join;
                            AutoJoinCode = next.Substring(5);
                        }
                        break;
                }
            }
        }
    }
}
