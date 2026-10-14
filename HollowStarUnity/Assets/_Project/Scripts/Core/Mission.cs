using System;
using System.Collections.Generic;

namespace HollowStar.Core
{
    // The first co-op objective: restart the outpost's distress beacon. Each role has a step only
    // it can do, and the last step needs both players at once, 20 m apart. Pure logic: the host (or
    // the solo player) runs it; the guest only displays the host's state.

    public enum StationId
    {
        Cabinet = 0,
        Terminal = 1,
    }

    public readonly struct Station
    {
        public readonly GroundPoint Position;
        public readonly string Name;

        public Station(GroundPoint position, string name)
        {
            Position = position;
            Name = name;
        }
    }

    /// <summary>A player as the mission sees them: role, position, and whether they hold interact.</summary>
    public readonly struct Actor
    {
        public readonly RoleId Role;
        public readonly float X, Z;
        public readonly bool Act;

        public Actor(RoleId role, float x, float z, bool act)
        {
            Role = role;
            X = x;
            Z = z;
            Act = act;
        }
    }

    public sealed class MissionNeed
    {
        public StationId Station;
        /// <summary>Only this role can do it; null: anyone.</summary>
        public RoleId? Role;
        public string Verb;
    }

    public sealed class MissionStep
    {
        public string Objective;
        public MissionNeed[] Needs;
        /// <summary>Seconds of holding the interact key.</summary>
        public float Hold;
    }

    public sealed class Mission
    {
        /// <summary>How close (m, centre to centre) a player must stand to work a station.</summary>
        public const float Reach = 2.6f;

        public const string DoneText = "Beacon online. Something in the Meridian wreck is answering.";

        public static readonly Station[] Stations =
        {
            new Station(Layout.MastCabinet, "mast power cabinet"),
            new Station(Layout.Pedestal, "pad power pedestal"),
        };

        public static readonly MissionStep[] Steps =
        {
            new MissionStep
            {
                Objective = "Force open the jammed power cabinet at the comms mast",
                Needs = new[] { new MissionNeed { Station = StationId.Cabinet, Role = RoleId.Vanguard, Verb = "Force the cabinet open" } },
                Hold = 1.5f,
            },
            new MissionStep
            {
                Objective = "Reroute power to the mast from the power pedestal at the landing pad",
                Needs = new[] { new MissionNeed { Station = StationId.Terminal, Role = RoleId.Tether, Verb = "Reroute power" } },
                Hold = 2.5f,
            },
            new MissionStep
            {
                Objective = "Throw both breakers together: one at the mast, one at the pad pedestal",
                Needs = new[]
                {
                    new MissionNeed { Station = StationId.Cabinet, Role = null, Verb = "Hold the breaker" },
                    new MissionNeed { Station = StationId.Terminal, Role = null, Verb = "Hold the breaker" },
                },
                Hold = 1.5f,
            },
        };

        public int Step { get; private set; }
        /// <summary>Progress of the current step, 0..1.</summary>
        public float Progress { get; private set; }

        public bool Done => Step >= Steps.Length;

        public string Objective => Done ? DoneText : Steps[Step].Objective;

        public static Station StationOf(StationId id) => Stations[(int)id];

        private static bool Near(float x, float z, StationId s) => StationOf(s).Position.DistanceTo(x, z) <= Reach;

        /// <summary>Stations the current step needs.</summary>
        public IEnumerable<StationId> ActiveStations()
        {
            if (Done) yield break;
            foreach (var n in Steps[Step].Needs) yield return n.Station;
        }

        /// <summary>Advance with everyone's position and input. Returns true when a step completes.</summary>
        public bool Update(float dt, IReadOnlyList<Actor> actors)
        {
            if (Done) return false;
            var s = Steps[Step];
            // Every need must be met by a different player.
            int used = 0;
            bool met = true;
            foreach (var n in s.Needs)
            {
                int found = -1;
                for (int k = 0; k < actors.Count; k++)
                {
                    var a = actors[k];
                    if ((used & (1 << k)) != 0 || !a.Act) continue;
                    if (n.Role.HasValue && a.Role != n.Role.Value) continue;
                    if (!Near(a.X, a.Z, n.Station)) continue;
                    found = k;
                    break;
                }
                if (found < 0)
                {
                    met = false;
                    break;
                }
                used |= 1 << found;
            }
            Progress = met ? Progress + dt / s.Hold : MathF.Max(0f, Progress - dt * 0.8f);
            if (Progress < 1f) return false;
            Step++;
            Progress = 0f;
            return true;
        }

        /// <summary>Guest side: take the host's state.</summary>
        public void Apply(int step, float progress)
        {
            if (step < 0 || step > Steps.Length || !float.IsFinite(progress)) return;
            Step = step;
            Progress = Math.Clamp(progress, 0f, 1f);
        }

        /// <summary>What the interact prompt should say for a player of <paramref name="role"/> at (x, z), if anything.</summary>
        public Prompt? PromptFor(RoleId role, float x, float z)
        {
            if (Done) return null;
            foreach (var n in Steps[Step].Needs)
            {
                if (!Near(x, z, n.Station)) continue;
                if (n.Role.HasValue && n.Role.Value != role) return new Prompt($"Only the {Roles.Name(n.Role.Value)} can do this", false);
                return new Prompt(n.Verb, true);
            }
            return null;
        }

        /// <summary>Where a bot of <paramref name="role"/> should go to help, given where its human partner is.</summary>
        public StationId? BotStation(RoleId role, GroundPoint partner)
        {
            if (Done) return null;
            var needs = Steps[Step].Needs;
            foreach (var n in needs)
                if (n.Role == role) return n.Station;
            StationId? first = null, second = null;
            foreach (var n in needs)
            {
                if (n.Role.HasValue) continue;
                if (first == null) first = n.Station;
                else if (second == null) second = n.Station;
            }
            if (first == null || second == null) return null;
            // Take the breaker the human isn't heading for: the one farther from them.
            float d0 = StationOf(first.Value).Position.DistanceTo(partner.X, partner.Z);
            float d1 = StationOf(second.Value).Position.DistanceTo(partner.X, partner.Z);
            return d0 > d1 ? first : second;
        }
    }
}
