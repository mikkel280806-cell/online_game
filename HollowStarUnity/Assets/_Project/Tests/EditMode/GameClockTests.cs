using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class GameClockTests
    {
        [Test]
        public void StartsInTheMorning()
        {
            var c = new GameClock();
            Assert.AreEqual(0.30f, c.TimeOfDay, 1e-5f);
            Assert.AreEqual(0, c.Day);
            Assert.IsTrue(c.IsDaytime);
        }

        [Test]
        public void ADayLastsTwentyMinutes()
        {
            var c = new GameClock();
            c.Advance(GameClock.DayLengthSeconds);
            Assert.AreEqual(1, c.Day);
            Assert.AreEqual(0.30f, c.TimeOfDay, 1e-4f);

            var half = new GameClock();
            half.Advance(GameClock.DayLengthSeconds * 0.5f);
            Assert.AreEqual(0.80f, half.TimeOfDay, 1e-4f);
        }

        [Test]
        public void TimeWrapsPastMidnightIntoTheNextDay()
        {
            var c = new GameClock();
            c.Advance(GameClock.DayLengthSeconds * 0.8f);
            Assert.AreEqual(1, c.Day);
            Assert.AreEqual(0.10f, c.TimeOfDay, 1e-4f);
        }

        [Test]
        public void ItIsWarmAtNoon()
        {
            var c = new GameClock(0.5);
            Assert.AreEqual(16f, c.AmbientC, 1e-3f);
            Assert.AreEqual(16f, GameClock.AmbientAt(0.5f), 1e-3f);
        }

        [Test]
        public void ItIsBitterAtMidnight()
        {
            Assert.AreEqual(-14f, new GameClock(0.0).AmbientC, 1e-3f);
            Assert.AreEqual(-14f, new GameClock(3.0).AmbientC, 1e-3f);
            Assert.AreEqual(-14f, GameClock.AmbientAt(0f), 1e-3f);
        }

        [Test]
        public void TemperatureIsBetweenTheExtremesAndMeetsAtDawnAndDusk()
        {
            for (float t = 0f; t < 1f; t += 0.01f)
                Assert.That(GameClock.AmbientAt(t), Is.InRange(-14.001f, 16.001f));
            Assert.AreEqual(1f, GameClock.AmbientAt(0.25f), 1e-3f);
            Assert.AreEqual(1f, GameClock.AmbientAt(0.75f), 1e-3f);
        }

        [Test]
        public void TheSunRisesAtDawnPeaksAtNoonAndSetsAtDusk()
        {
            Assert.AreEqual(0f, GameClock.SunElevationAt(0.25f), 1e-3f);
            Assert.AreEqual(GameClock.SunPeakElevationDeg, GameClock.SunElevationAt(0.5f), 1e-3f);
            Assert.AreEqual(0f, GameClock.SunElevationAt(0.75f), 1e-3f);
            Assert.Less(GameClock.SunElevationAt(0f), 0f);
            Assert.IsFalse(new GameClock(0.0).IsDaytime);
            Assert.IsTrue(new GameClock(0.5).IsDaytime);
        }

        [Test]
        public void GuestsTakeTheHostsTime()
        {
            var host = new GameClock();
            host.Advance(5000f);
            var guest = new GameClock();
            guest.SyncTo(host.Days);
            Assert.AreEqual(host.Days, guest.Days);
            Assert.AreEqual(host.TimeOfDay, guest.TimeOfDay);
            Assert.AreEqual(host.Day, guest.Day);
        }

        [Test]
        public void NonsenseSyncValuesAreIgnored()
        {
            var c = new GameClock();
            c.SyncTo(double.NaN);
            c.SyncTo(double.PositiveInfinity);
            c.SyncTo(-1.0);
            Assert.AreEqual(GameClock.StartDays, c.Days);
            c.Advance(-5f);
            c.Advance(float.NaN);
            Assert.AreEqual(GameClock.StartDays, c.Days);
        }
    }
}
