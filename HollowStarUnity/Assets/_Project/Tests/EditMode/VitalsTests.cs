using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class VitalsTests
    {
        // A comfortable outdoor day: 20 C means the body target is exactly 37, so only the vital under test moves.
        private static readonly VitalsEnvironment Mild = VitalsEnvironment.Outdoors(Vitals.ShelterTempC);
        private static readonly VitalsEnvironment Bay = VitalsEnvironment.InPressurisedZone(-14f);

        private static void Run(Vitals v, in VitalsEnvironment env, float seconds, float dt = 0.1f)
        {
            int steps = (int)System.Math.Round(seconds / dt);
            for (int i = 0; i < steps; i++) v.Step(dt, env);
        }

        [Test]
        public void StartsFull()
        {
            var v = new Vitals();
            Assert.AreEqual(100f, v.Oxygen);
            Assert.AreEqual(100f, v.Food);
            Assert.AreEqual(100f, v.Water);
            Assert.AreEqual(37f, v.BodyTemp);
            Assert.AreEqual(100f, v.Health);
            Assert.IsFalse(v.IsDead);
        }

        [Test]
        public void OxygenDrainsOutdoorsAndEmptiesInFiveMinutes()
        {
            var v = new Vitals();
            Run(v, Mild, 150f);
            Assert.AreEqual(50f, v.Oxygen, 0.5f);
            Run(v, Mild, 150f);
            Assert.AreEqual(0f, v.Oxygen, 0.5f);
        }

        [Test]
        public void ABiggerTankLastsLonger()
        {
            var v = new Vitals();
            var big = VitalsEnvironment.Outdoors(20f, 0f, 200f);
            v.Restore(200f, 100f, 100f, 37f, 100f, 200f);
            Run(v, big, 300f);
            Assert.AreEqual(100f, v.Oxygen, 0.5f);
            Assert.AreEqual(200f, v.OxygenCapacity);
        }

        [Test]
        public void OxygenRefillsInAPressurisedZone()
        {
            var v = new Vitals();
            v.Restore(0f, 100f, 100f, 37f, 100f);
            Run(v, Bay, 2f);
            Assert.AreEqual(50f, v.Oxygen, 0.5f);
            Run(v, Bay, 10f);
            Assert.AreEqual(100f, v.Oxygen);
        }

        [Test]
        public void RefillStopsAtTheTankCapacity()
        {
            var v = new Vitals();
            var bigBay = VitalsEnvironment.InPressurisedZone(20f, 0f, 200f);
            v.Restore(150f, 100f, 100f, 37f, 100f, 200f);
            Run(v, bigBay, 5f);
            Assert.AreEqual(200f, v.Oxygen);
        }

        [Test]
        public void ADroppedTankClipsTheOxygenToTheSmallerCapacity()
        {
            var v = new Vitals();
            v.Restore(100f, 100f, 100f, 37f, 100f);
            v.Step(0.1f, VitalsEnvironment.Outdoors(20f, 0f, 200f));
            v.Step(0.1f, VitalsEnvironment.Outdoors(20f, 0f, 50f));
            Assert.AreEqual(50f, v.Oxygen, 1e-3f);
        }

        [Test]
        public void SuffocatingHurtsFivePerSecond()
        {
            var v = new Vitals();
            v.Restore(0f, 100f, 100f, 37f, 100f);
            Run(v, Mild, 4f);
            Assert.AreEqual(80f, v.Health, 0.5f);
        }

        [Test]
        public void FoodAndWaterDrainOnTheirTimers()
        {
            var v = new Vitals();
            Run(v, Bay, 20f * 60f);
            Assert.AreEqual(50f, v.Food, 0.1f);   // 100 over 40 min
            Assert.AreEqual(20f, v.Water, 0.1f);  // 100 over 25 min
        }

        [Test]
        public void StarvingHurtsHalfAPointPerSecond()
        {
            var v = new Vitals();
            v.Restore(100f, 0f, 100f, 37f, 100f);
            Run(v, Bay, 10f);
            Assert.AreEqual(95f, v.Health, 0.1f);
        }

        [Test]
        public void ThirstHurtsEightTenthsPerSecond()
        {
            var v = new Vitals();
            v.Restore(100f, 100f, 0f, 37f, 100f);
            Run(v, Bay, 10f);
            Assert.AreEqual(92f, v.Health, 0.1f);
        }

        [Test]
        public void DamageStacksAcrossCauses()
        {
            var v = new Vitals();
            v.Restore(0f, 0f, 0f, 37f, 100f);
            Run(v, Mild, 5f);
            Assert.AreEqual(100f - 5f * (Vitals.OxygenDamagePerSecond + Vitals.FoodDamagePerSecond + Vitals.WaterDamagePerSecond), v.Health, 0.1f);
        }

        [Test]
        public void HealthRegeneratesWhenFedWateredAndWarm()
        {
            var v = new Vitals();
            v.Restore(100f, 100f, 100f, 37f, 50f);
            Run(v, Bay, 10f);
            Assert.AreEqual(55f, v.Health, 0.1f);
            Run(v, Bay, 200f);
            Assert.AreEqual(100f, v.Health);
        }

        [Test]
        public void NoRegenWhenFoodOrWaterIsLow()
        {
            var v = new Vitals();
            v.Restore(100f, 15f, 100f, 37f, 50f);
            Run(v, Bay, 10f);
            Assert.AreEqual(50f, v.Health, 0.01f, "food 15 is above 0 (no damage) but not above 20 (no regen)");
            v.Restore(100f, 100f, 15f, 37f, 50f);
            Run(v, Bay, 10f);
            Assert.AreEqual(50f, v.Health, 0.01f);
        }

        [Test]
        public void NoRegenWhileOutOfBreathOrFreezing()
        {
            var v = new Vitals();
            v.Restore(0f, 100f, 100f, 37f, 50f);
            Run(v, Mild, 2f);
            Assert.Less(v.Health, 50f);
            v.Restore(100f, 100f, 100f, 33f, 50f);
            Run(v, Bay, 1f);
            Assert.Less(v.Health, 50f, "still below 35 C after one second in the warm");
        }

        [Test]
        public void ColdOutdoorsPullsTheBodyTemperatureDownAndHurts()
        {
            var v = new Vitals();
            var night = VitalsEnvironment.Outdoors(GameClock.MidnightTempC);
            Run(v, night, 30f);
            Assert.Less(v.BodyTemp, 37f);
            Assert.GreaterOrEqual(v.BodyTemp, Vitals.ColdThresholdC, "not cold enough to hurt yet");
            Assert.AreEqual(100f, v.Health, 0.01f);

            Run(v, night, 120f);
            Assert.Less(v.BodyTemp, Vitals.ColdThresholdC);
            Assert.IsTrue(v.IsCold);
            Assert.Less(v.Health, 100f);
        }

        [Test]
        public void HypothermiaHurtsOnePointPerSecond()
        {
            var v = new Vitals();
            v.Restore(100f, 100f, 100f, 30f, 100f);
            Run(v, VitalsEnvironment.Outdoors(-14f), 5f);
            Assert.AreEqual(95f, v.Health, 0.1f);
        }

        [Test]
        public void InsulationSlowsTheColdAndShelterStopsIt()
        {
            var bare = new Vitals();
            var liner = new Vitals();
            var cold = VitalsEnvironment.Outdoors(-14f, 0.3f);
            var lined = VitalsEnvironment.Outdoors(-14f, 0.55f);
            Run(bare, cold, 120f);
            Run(liner, lined, 120f);
            Assert.Greater(liner.BodyTemp, bare.BodyTemp);

            var sheltered = new Vitals();
            // A huge tank so the air does not run out during the long run.
            sheltered.Restore(1000f, 100f, 100f, 33f, 100f, 1000f);
            Run(sheltered, new VitalsEnvironment(false, true, -14f, 0f, 1000f), 400f);
            Assert.AreEqual(37f, sheltered.BodyTemp, 0.1f, "a shelter counts as 20 C");
        }

        [Test]
        public void TheBodyWarmsBackUpInTheBay()
        {
            var v = new Vitals();
            v.Restore(100f, 100f, 100f, 33f, 100f);
            Run(v, Bay, 400f);
            Assert.AreEqual(37f, v.BodyTemp, 0.1f);
        }

        [Test]
        public void OverheatingHurts()
        {
            var v = new Vitals();
            v.Restore(100f, 100f, 100f, 41f, 100f);
            Run(v, VitalsEnvironment.Outdoors(80f), 4f);
            Assert.IsTrue(v.IsHot);
            Assert.AreEqual(96f, v.Health, 0.1f);
        }

        [Test]
        public void DiesAtZeroHealthAndStopsSimulating()
        {
            var v = new Vitals();
            v.Restore(0f, 100f, 100f, 37f, 10f);
            Run(v, Mild, 3f);
            Assert.IsTrue(v.IsDead);
            Assert.AreEqual(0f, v.Health);
            float food = v.Food;
            v.Step(1f, Bay);
            Assert.AreEqual(food, v.Food, "a dead player does not eat or breathe");
            Assert.AreEqual(0f, v.Oxygen);
        }

        [Test]
        public void RespawnCountsDownEightSeconds()
        {
            var v = new Vitals();
            v.Restore(0f, 100f, 100f, 37f, 0.4f);
            v.Step(0.1f, Mild);                      // -0.5 health: dead on this step
            Assert.IsTrue(v.IsDead);
            Assert.AreEqual(Vitals.RespawnDelay, v.RespawnCountdown, 0.2f);
            Assert.IsFalse(v.CanRespawn);
            Run(v, Mild, 4f);
            Assert.AreEqual(Vitals.RespawnDelay - 4f, v.RespawnCountdown, 0.2f);
            Run(v, Mild, 4.5f);
            Assert.AreEqual(0f, v.RespawnCountdown);
            Assert.IsTrue(v.CanRespawn);
        }

        [Test]
        public void RespawnRestoresHealthOxygenAndWarmthButKeepsFoodAndWater()
        {
            var v = new Vitals();
            v.Restore(0f, 60f, 45f, 30f, 0f);
            Assert.IsTrue(v.IsDead);
            v.Respawn();
            Assert.IsFalse(v.IsDead);
            Assert.AreEqual(50f, v.Health);
            Assert.AreEqual(100f, v.Oxygen);
            Assert.AreEqual(37f, v.BodyTemp);
            Assert.AreEqual(60f, v.Food);
            Assert.AreEqual(45f, v.Water);
            Assert.AreEqual(0f, v.RespawnCountdown);
        }

        [Test]
        public void ARespawnedPlayerWhoStarvedGetsAFloorOfFoodAndWater()
        {
            var v = new Vitals();
            v.Restore(100f, 0f, 0f, 37f, 0f);
            v.Respawn();
            Assert.AreEqual(Vitals.RespawnMinFoodWater, v.Food);
            Assert.AreEqual(Vitals.RespawnMinFoodWater, v.Water);
            Run(v, Bay, 5f);
            Assert.IsFalse(v.IsDead);
        }

        [Test]
        public void RespawnedPlayerKeepsLivingAndRegenerates()
        {
            var v = new Vitals();
            v.Restore(0f, 80f, 80f, 37f, 1f);
            Run(v, Mild, 1f);
            Assert.IsTrue(v.IsDead);
            Run(v, Mild, 9f);
            Assert.IsTrue(v.CanRespawn);
            v.Respawn();
            Run(v, Bay, 10f);
            Assert.IsFalse(v.IsDead);
            Assert.Greater(v.Health, 50f);
        }

        [Test]
        public void ConsumablesApplyTheirEffectsAndClamp()
        {
            var v = new Vitals();
            v.Restore(20f, 50f, 50f, 37f, 30f);
            Assert.IsTrue(v.Consume(ItemCatalog.Get(ItemIds.RationBar)));
            Assert.AreEqual(90f, v.Food);
            Assert.IsTrue(v.Consume(ItemCatalog.Get(ItemIds.Sporeberry)));
            Assert.AreEqual(100f, v.Food, "clamped");
            Assert.AreEqual(54f, v.Water);
            Assert.IsTrue(v.Consume(ItemCatalog.Get(ItemIds.FilteredWater)));
            Assert.AreEqual(84f, v.Water);
            Assert.IsTrue(v.Consume(ItemCatalog.Get(ItemIds.O2Canister)));
            Assert.AreEqual(70f, v.Oxygen);
            Assert.IsTrue(v.Consume(ItemCatalog.Get(ItemIds.Medkit)));
            Assert.AreEqual(80f, v.Health);
        }

        [Test]
        public void NonConsumablesAndTheDeadCannotConsume()
        {
            var v = new Vitals();
            Assert.IsFalse(v.Consume(ItemCatalog.Get(ItemIds.Cutter)));
            Assert.IsFalse(v.Consume(ItemCatalog.Get(ItemIds.FerriteOre)));
            Assert.IsFalse(v.Consume(null));
            v.Restore(0f, 10f, 10f, 37f, 0f);
            Assert.IsFalse(v.Consume(ItemCatalog.Get(ItemIds.RationBar)));
            Assert.AreEqual(10f, v.Food);
        }

        [Test]
        public void BadTimeStepsAreIgnored()
        {
            var v = new Vitals();
            v.Step(-1f, Mild);
            v.Step(0f, Mild);
            v.Step(float.NaN, Mild);
            v.Step(float.PositiveInfinity, Mild);
            Assert.AreEqual(100f, v.Oxygen);
            Assert.AreEqual(100f, v.Health);
        }
    }
}
