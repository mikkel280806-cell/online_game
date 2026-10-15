using HollowStar.Core.Survival;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class ScanDatabaseTests
    {
        [Test]
        public void TheFirstScanUnlocksAndLaterOnesDoNot()
        {
            var db = new ScanDatabase();
            Assert.IsFalse(db.IsUnlocked("lumen_bulb"));
            Assert.IsTrue(db.Unlock("lumen_bulb"));
            Assert.IsFalse(db.Unlock("lumen_bulb"));
            Assert.IsTrue(db.IsUnlocked("lumen_bulb"));
            Assert.AreEqual(1, db.Count);
        }

        [Test]
        public void VersionBumpsOnlyOnRealChanges()
        {
            var db = new ScanDatabase();
            int v = db.Version;
            db.Unlock("a");
            Assert.Greater(db.Version, v);
            v = db.Version;
            db.Unlock("a");
            db.Unlock("");
            db.Unlock(null);
            Assert.AreEqual(v, db.Version);
        }

        [Test]
        public void KeepsUnlockOrderAndCanBeReplaced()
        {
            var db = new ScanDatabase();
            db.Unlock("b");
            db.Unlock("a");
            CollectionAssert.AreEqual(new[] { "b", "a" }, db.Unlocked);
            int v = db.Version;
            db.Replace(new[] { "x", "y", "x", null });
            CollectionAssert.AreEqual(new[] { "x", "y" }, db.Unlocked);
            Assert.IsFalse(db.IsUnlocked("a"));
            Assert.Greater(db.Version, v);
        }
    }
}
