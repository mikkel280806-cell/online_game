namespace HollowStar.Core
{
    /// <summary>
    /// Small seeded PRNG so procedural content is identical on both players' machines. Bit-for-bit
    /// the same sequence as mulberry32 in the web version (src/game/random.ts).
    /// </summary>
    public sealed class Mulberry32
    {
        private uint state;

        public Mulberry32(uint seed)
        {
            state = seed;
        }

        /// <summary>Next value in [0, 1).</summary>
        public double NextDouble()
        {
            state += 0x6D2B79F5u;
            uint t = state;
            t = (t ^ (t >> 15)) * (t | 1u);
            t ^= t + (t ^ (t >> 7)) * (t | 61u);
            return (t ^ (t >> 14)) / 4294967296.0;
        }

        public float NextFloat() => (float)NextDouble();
    }
}
