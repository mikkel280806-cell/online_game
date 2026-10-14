using HollowStar.Core;
using NUnit.Framework;

namespace HollowStar.Tests
{
    public class Mulberry32Tests
    {
        // Reference values from mulberry32 in the web version (src/game/random.ts), run in Node.
        [Test]
        public void MatchesTheWebVersionBitForBit()
        {
            var r = new Mulberry32(99);
            Assert.AreEqual(0.26046581240370870, r.NextDouble(), 1e-15);
            Assert.AreEqual(0.80482276552356780, r.NextDouble(), 1e-15);
            Assert.AreEqual(0.54087153496220708, r.NextDouble(), 1e-15);

            var big = new Mulberry32(4000000000u);
            Assert.AreEqual(0.69190682214684784, big.NextDouble(), 1e-15);
            Assert.AreEqual(0.55119447619654238, big.NextDouble(), 1e-15);
        }
    }
}
