using System.Collections.Generic;
using HollowStar.Core;
using NUnit.Framework;

namespace HollowStar.Tests
{
    // Ported from tests/unit/mission.test.ts in the web version.
    public class MissionTests
    {
        private static Actor At(RoleId role, StationId s, bool act = true)
        {
            var p = Mission.StationOf(s).Position;
            return new Actor(role, p.X, p.Z, act);
        }

        private static void Run(Mission m, IReadOnlyList<Actor> actors, float seconds)
        {
            for (float t = 0; t < seconds; t += 1f / 60f) m.Update(1f / 60f, actors);
        }

        [Test]
        public void NeedsTheRightRoleAtEachStation()
        {
            var m = new Mission();
            Run(m, new[] { At(RoleId.Tether, StationId.Cabinet) }, 5f);
            Assert.AreEqual(0, m.Step);
            var cabinet = Mission.StationOf(StationId.Cabinet).Position;
            Assert.IsFalse(m.PromptFor(RoleId.Tether, cabinet.X, cabinet.Z)?.Allowed ?? true);
            Run(m, new[] { At(RoleId.Vanguard, StationId.Cabinet) }, Mission.Steps[0].Hold + 0.1f);
            Assert.AreEqual(1, m.Step);
            Run(m, new[] { At(RoleId.Tether, StationId.Terminal) }, Mission.Steps[1].Hold + 0.1f);
            Assert.AreEqual(2, m.Step);
        }

        [Test]
        public void TheBreakersNeedBothPlayersAtOnce()
        {
            var m = new Mission();
            m.Apply(2, 0f);
            Run(m, new[] { At(RoleId.Vanguard, StationId.Cabinet), At(RoleId.Tether, StationId.Cabinet, false) }, 5f);
            Assert.AreEqual(2, m.Step);
            Run(m, new[] { At(RoleId.Vanguard, StationId.Cabinet), At(RoleId.Tether, StationId.Terminal) }, Mission.Steps[2].Hold + 0.1f);
            Assert.IsTrue(m.Done);
        }

        [Test]
        public void ProgressDrainsWhenTheKeyIsReleased()
        {
            var m = new Mission();
            Run(m, new[] { At(RoleId.Vanguard, StationId.Cabinet) }, 0.6f);
            float p = m.Progress;
            Run(m, new[] { At(RoleId.Vanguard, StationId.Cabinet, false) }, 0.5f);
            Assert.Less(m.Progress, p);
        }

        [Test]
        public void SendsABotToItsOwnStepOrToTheBreakerItsPartnerIsNotAt()
        {
            var m = new Mission();
            var cabinet = Mission.StationOf(StationId.Cabinet).Position;
            var terminal = Mission.StationOf(StationId.Terminal).Position;
            Assert.IsNull(m.BotStation(RoleId.Tether, cabinet));
            m.Apply(1, 0f);
            Assert.AreEqual(StationId.Terminal, m.BotStation(RoleId.Tether, cabinet));
            m.Apply(2, 0f);
            Assert.AreEqual(StationId.Cabinet, m.BotStation(RoleId.Vanguard, terminal));
        }
    }
}
