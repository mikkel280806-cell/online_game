using System;
using HollowStar.Core;
using NUnit.Framework;

namespace HollowStar.Tests
{
    // Ported from tests/unit/combat.test.ts in the web version.
    public class CombatTests
    {
        private static float Flat(float x, float z) => 0f;

        private static void Step(Combat c, Fighter[] fs, float seconds)
        {
            for (float t = 0; t < seconds; t += 1f / 60f) c.Update(1f / 60f, fs);
        }

        [Test]
        public void StartsAWaveOfDronesThatCloseInAndShoot()
        {
            var c = new Combat(Flat, null, new GroundPoint(0f, -30f));
            c.Start();
            Assert.AreEqual(3, c.Drones.Count);
            Step(c, new[] { new Fighter(RoleId.Vanguard, 0f, 0f, 0f) }, 12f);
            Assert.Less(c.VitalsOf(RoleId.Vanguard).Hp, Combat.PlayerHp);
            var d = c.Drones[0];
            Assert.Less(MathF.Sqrt(d.X * d.X + d.Z * d.Z), 15f);
        }

        [Test]
        public void TheVanguardStrikeHitsOnlyWhatIsInFrontAndInReach()
        {
            var c = new Combat(Flat, null, new GroundPoint(0f, 2f));
            c.Start();
            c.Drones.RemoveRange(1, c.Drones.Count - 1);
            var d = c.Drones[0];
            d.X = 0f;
            d.Y = 1.5f;
            d.Z = 2f;
            c.Attack(new Fighter(RoleId.Vanguard, 0f, 0f, MathF.PI)); // facing away
            Assert.AreEqual(Combat.DroneHp, d.Hp);
            c.VitalsOf(RoleId.Vanguard).AttackCd = 0f; // the swing above started the cooldown
            c.Attack(new Fighter(RoleId.Vanguard, 0f, 0f, 0f));
            Assert.Less(d.Hp, Combat.DroneHp);
        }

        [Test]
        public void TheTetherAutoAimsAndThePulseStunsEverythingNear()
        {
            var c = new Combat(Flat, null, new GroundPoint(0f, 10f));
            c.Start();
            var t = new Fighter(RoleId.Tether, 0f, 0f, 0f);
            var target = c.Aim(t);
            Assert.IsNotNull(target);
            c.Attack(t);
            Assert.AreEqual(Combat.DroneHp - 1, target.Hp);
            foreach (var d in c.Drones)
            {
                d.X *= 0.2f;
                d.Z = 5f;
            }
            c.Skill(t);
            Assert.IsTrue(c.Drones.TrueForAll(d => d.Stun > 0f));
        }

        [Test]
        public void TheShieldBlocksBoltsFromTheFrontOnly()
        {
            var c = new Combat(Flat);
            c.Active = true;
            var blocker = new[] { new Fighter(RoleId.Vanguard, 0f, 0f, 0f, blocking: true) };
            c.AddBolt(0f, 1.2f, 3f, 0f, 0f, -10f);
            // Hand-made bolts live in the drawn list: run them through the host path.
            Step(c, blocker, 0.5f);
            Assert.AreEqual(Combat.PlayerHp, c.VitalsOf(RoleId.Vanguard).Hp);
            c.AddBolt(0f, 1.2f, -3f, 0f, 0f, 10f);
            Step(c, blocker, 0.5f);
            Assert.Less(c.VitalsOf(RoleId.Vanguard).Hp, Combat.PlayerHp);
        }

        [Test]
        public void ADownedPlayerIsRevivedByAPartnerHoldingInteract()
        {
            var c = new Combat(Flat);
            var tether = c.VitalsOf(RoleId.Tether);
            tether.Hp = 0f;
            tether.Downed = true;
            Step(c, new[] { new Fighter(RoleId.Tether, 0f, 0f, 0f), new Fighter(RoleId.Vanguard, 1f, 0f, 0f, act: true) }, 2.7f);
            Assert.IsFalse(tether.Downed);
            Assert.Greater(tether.Hp, 0f);
        }

        [Test]
        public void RoundTripsItsSnapshotForTheGuest()
        {
            var host = new Combat(Flat, null, new GroundPoint(0f, -20f));
            host.Start();
            var guest = new Combat(Flat);
            guest.ApplySnapshot(host.Snapshot());
            Assert.IsTrue(guest.Active);
            CollectionAssert.AreEqual(host.Drones.ConvertAll(d => d.Id), guest.Drones.ConvertAll(d => d.Id));
        }
    }
}
