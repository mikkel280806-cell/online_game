using System;
using System.Collections.Generic;

namespace HollowStar.Core.Terrain
{
    public struct CraterDef
    {
        public double X, Z;
        /// <summary>Rim radius (m).</summary>
        public double R;
        public double Depth, Rim;
        /// <summary>0 = old and slumped, 1 = fresh with sharp rim, bright ejecta and exposed rock.</summary>
        public double Fresh;
    }

    public struct OutcropDef
    {
        public double X, Z;
        /// <summary>Semi-axes (m) and orientation (rad).</summary>
        public double A, B, Angle;
        public double Height;
    }

    /// <summary>
    /// Procedural height model for the moon Vigil around Survey Outpost Kestrel-7. A port of
    /// src/env/terrain/heightfield.ts in doubles, so it returns the same heights as the web version.
    /// Deterministic for a given seed. <see cref="Sample"/> returns the height in metres and writes
    /// material hints (rock exposure, albedo bias, drift) to <see cref="Rock"/>, <see cref="Bright"/>
    /// and <see cref="Drift"/>. Not thread-safe: use one instance per thread.
    /// </summary>
    public sealed class TerrainModel
    {
        private const double Tau = Math.PI * 2;
        /// <summary>Radius of the moon, used for a gentle curvature drop toward the horizon.</summary>
        public const double MoonRadius = 350_000;
        /// <summary>Heights are exactly zero out to here (a little past the flat radius).</summary>
        public const double FlatExactRadius = Layout.OutpostFlatRadius + 2.5;

        // Horizontal direction toward the sun.
        private static readonly double SunLen = Math.Sqrt(Layout.SunDirX * Layout.SunDirX + Layout.SunDirY * Layout.SunDirY + Layout.SunDirZ * Layout.SunDirZ);
        private static readonly double SunNx = Layout.SunDirX / SunLen, SunNy = Layout.SunDirY / SunLen, SunNz = Layout.SunDirZ / SunLen;
        private static readonly double SunHLen = Hypot(SunNx, SunNz);
        public static readonly double SunHx = SunNx / SunHLen;
        public static readonly double SunHz = SunNz / SunHLen;
        public static readonly double SunTan = SunNy / SunHLen;

        /// <summary>A mountain range behind the wreck (as seen from the outpost): segment x0, z0, x1, z1.</summary>
        private static readonly double[] Backdrop = { -1700, -2350, 1200, -2800 };

        // The Meridian's frame: forward (bow) and side axes on the ground plane.
        public static readonly double WreckFwdX = -Math.Sin(Layout.Wreck.Yaw);
        public static readonly double WreckFwdZ = -Math.Cos(Layout.Wreck.Yaw);
        private static readonly double WreckSideX = WreckFwdZ;
        private static readonly double WreckSideZ = -WreckFwdX;
        /// <summary>Crater semi-axes: long along the hull so the whole 420 m ship lies in it.</summary>
        private const double WreckCraterA = Layout.Wreck.CraterRadius * 1.55;
        private const double WreckCraterB = Layout.Wreck.CraterRadius;

        private struct CraterLevel
        {
            public double Cell, Prob, RMin, RMax;
            public int Salt;
            public double MinDist, MaxDist;
        }

        /// <summary>Procedural crater fields: one jittered crater per cell (with probability Prob).</summary>
        private static readonly CraterLevel[] CraterLevels =
        {
            new CraterLevel { Cell = 22, Prob = 0.2, RMin = 1.0, RMax = 4.2, Salt = 11, MinDist = 44, MaxDist = 900 },
            new CraterLevel { Cell = 85, Prob = 0.3, RMin = 5, RMax = 19, Salt = 23, MinDist = 70, MaxDist = 3500 },
            new CraterLevel { Cell = 420, Prob = 0.42, RMin = 28, RMax = 120, Salt = 37, MinDist = 360, MaxDist = 12000 },
        };

        public readonly List<CraterDef> Craters = new List<CraterDef>();
        public readonly List<OutcropDef> Outcrops = new List<OutcropDef>();
        public readonly int Seed;

        /// <summary>Side outputs of the last Sample() call: rock exposure 0..1.</summary>
        public double Rock;
        /// <summary>Albedo bias: &gt;0 brighter (fresh ejecta), &lt;0 darker (disturbed, ploughed regolith).</summary>
        public double Bright;
        /// <summary>0..1: how much loose drifted dust (ripples) there is.</summary>
        public double Drift;

        private readonly SimplexNoise2D nBase, nMid, nFine, nDune, nMask, nHill, nWarp, nRange, nDetail;
        private readonly ValueNoise vn;
        private double segD, segS;
        /// <summary>Slope-ness of the last Eroded() call (accumulated derivative magnitude).</summary>
        private double erodedSlope;
        private double resLog = double.NegativeInfinity;
        private double wreckRock, wreckBright;

        public TerrainModel(int seed = 7)
        {
            Seed = seed;
            var rng = new Mulberry32((uint)(seed * 7919 + 17));
            SimplexNoise2D Mk() => new SimplexNoise2D(new Mulberry32((uint)Math.Floor(rng.NextDouble() * 2147483648.0)).NextDouble);
            nBase = Mk();
            nMid = Mk();
            nFine = Mk();
            nDune = Mk();
            nMask = Mk();
            nHill = Mk();
            nWarp = Mk();
            Mk(); // reserved slot: keeps the seed stream of the noises below stable
            nRange = Mk();
            nDetail = Mk();
            vn = new ValueNoise(new Mulberry32((uint)Math.Floor(rng.NextDouble() * 2147483648.0)));
            PlaceFeatures(new Mulberry32((uint)(seed * 104729 + 3)));
        }

        public static double Smoothstep(double a, double b, double x)
        {
            double t = (x - a) / (b - a);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            return t * t * (3 - 2 * t);
        }

        private static double Smin(double a, double b, double k)
        {
            double h = Math.Max(k - Math.Abs(a - b), 0) / k;
            return Math.Min(a, b) - h * h * k * 0.25;
        }

        private static double Hypot(double x, double z) => Math.Sqrt(x * x + z * z);

        /// <summary>Integer hash: 32 well-mixed bits. Same as hash01 in the web version, times 2^32.</summary>
        public static uint Hash(int ix, int iz, int salt)
        {
            uint h = unchecked((uint)ix * 0x27d4eb2du ^ (uint)iz * 0x165667b1u ^ (uint)salt * 0x9e3779b9u);
            h = unchecked((h ^ (h >> 15)) * 0x85ebca6bu);
            h = unchecked((h ^ (h >> 13)) * 0xc2b2ae35u);
            h ^= h >> 16;
            return h;
        }

        public static double Hash01(int ix, int iz, int salt) => Hash(ix, iz, salt) / 4294967296.0;

        /// <summary>Distance from p to segment ab (segD), and the parameter along it, unclamped (segS).</summary>
        private void SegInfo(double px, double pz, double ax, double az, double bx, double bz)
        {
            double dx = bx - ax;
            double dz = bz - az;
            double l2 = dx * dx + dz * dz;
            double s = ((px - ax) * dx + (pz - az) * dz) / l2;
            double sc = s < 0 ? 0 : s > 1 ? 1 : s;
            double qx = ax + dx * sc - px;
            double qz = az + dz * sc - pz;
            segD = Math.Sqrt(qx * qx + qz * qz);
            segS = s;
        }

        /// <summary>Crater cross-section: t = distance / rim radius. Returns height offset (m).</summary>
        private static double CraterProfile(double t, double depth, double rim, double fresh, double flatFloor)
        {
            if (t >= 2.6) return 0;
            if (t < 0) t = 0;
            if (t < 1)
            {
                // Bowl rising to the rim. Fresh craters have steeper upper walls.
                double e = 1.6 + fresh * 1.4;
                double h = -depth + (depth + rim) * Math.Pow(t, e);
                if (flatFloor > 0)
                {
                    double f = -depth * (1 - flatFloor);
                    h = -Smin(-h, -f, depth * 0.12);
                }
                return h;
            }
            // Ejecta blanket falling away from the rim.
            double u = (t - 1) / 1.6;
            double k = 2.2 + fresh * 1.5;
            return rim * Math.Exp(-(t - 1) * k) * (1 - u) * (1 - u);
        }

        /// <summary>
        /// Fast 2D value noise with analytic derivatives (quintic fade), range about [-1, 1].
        /// Used for the eroded mountain and hill fbm, where derivatives damp detail on slopes.
        /// </summary>
        private sealed class ValueNoise
        {
            private readonly byte[] perm = new byte[512];
            private readonly double[] vals = new double[256];
            public double Dx, Dz;

            public ValueNoise(Mulberry32 rng)
            {
                var p = new byte[256];
                for (int i = 0; i < 256; i++)
                {
                    p[i] = (byte)i;
                    // Float32Array in the web version: round through float.
                    vals[i] = (float)(rng.NextDouble() * 2 - 1);
                }
                for (int i = 255; i > 0; i--)
                {
                    int j = (int)Math.Floor(rng.NextDouble() * (i + 1));
                    byte t = p[i];
                    p[i] = p[j];
                    p[j] = t;
                }
                for (int i = 0; i < 512; i++) perm[i] = p[i & 255];
            }

            public double Noised(double x, double z)
            {
                double fx0 = Math.Floor(x);
                double fz0 = Math.Floor(z);
                double fx = x - fx0;
                double fz = z - fz0;
                double ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
                double uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
                double dux = 30 * fx * fx * (fx * (fx - 2) + 1);
                double duz = 30 * fz * fz * (fz * (fz - 2) + 1);
                int X = (int)fx0 & 255;
                int Z = (int)fz0 & 255;
                var P = perm;
                var V = vals;
                double a = V[P[P[X] + Z]];
                double b = V[P[P[X + 1] + Z]];
                double c = V[P[P[X] + Z + 1]];
                double d = V[P[P[X + 1] + Z + 1]];
                double k1 = b - a;
                double k2 = c - a;
                double k4 = a - b - c + d;
                Dx = dux * (k1 + k4 * uz);
                Dz = duz * (k2 + k4 * ux);
                return a + k1 * ux + k2 * uz + k4 * ux * uz;
            }
        }

        /// <summary>
        /// "Eroded" fbm (after Inigo Quilez): each octave is damped by the accumulated slope, so
        /// valleys stay smooth and detail gathers on ridges and crests, like weathered ranges.
        /// </summary>
        private double Eroded(double x, double z, int oct)
        {
            double a = 0, b = 1, dx = 0, dz = 0;
            for (int i = 0; i < oct; i++)
            {
                double v = vn.Noised(x, z);
                dx += vn.Dx;
                dz += vn.Dz;
                a += b * v / (1 + dx * dx + dz * dz);
                b *= 0.5;
                double nx = 1.6 * x - 1.2 * z;
                z = 1.2 * x + 1.6 * z + 7.31;
                x = nx + 3.7;
            }
            erodedSlope = Math.Sqrt(dx * dx + dz * dz);
            return a;
        }

        /// <summary>Hand-tuned-by-rules features in the play area: impact craters and rocky outcrops.</summary>
        private void PlaceFeatures(Mulberry32 rng)
        {
            bool OkSpot(double x, double z, double clear)
            {
                double r = Hypot(x, z);
                if (r < Layout.OutpostBlendRadius - 18 + clear * 0.5) return false;
                if (Hypot(x - Layout.LandingPad.X, z - Layout.LandingPad.Z) < Layout.LandingPadRadius + 30) return false;
                foreach (var c in Craters)
                    if (Hypot(x - c.X, z - c.Z) < c.R + clear + 6) return false;
                foreach (var o in Outcrops)
                    if (Hypot(x - o.X, z - o.Z) < o.A + clear + 10) return false;
                return true;
            }

            // A hero outcrop the look-dev "outcrop" view framed, then a few more.
            Outcrops.Add(new OutcropDef { X = 74, Z = -58, A = 17, B = 9, Angle = 0.5, Height = 3.4 });
            int guard = 0;
            while (Outcrops.Count < 8 && guard++ < 500)
            {
                double ang = rng.NextDouble() * Tau;
                double r = 70 + rng.NextDouble() * 85;
                double x = Math.Cos(ang) * r;
                double z = Math.Sin(ang) * r;
                double a = 7 + rng.NextDouble() * 12;
                if (!OkSpot(x, z, a)) continue;
                double b = a * (0.4 + rng.NextDouble() * 0.4);
                double angle = rng.NextDouble() * Math.PI;
                double height = 1.3 + rng.NextDouble() * 2.6;
                Outcrops.Add(new OutcropDef { X = x, Z = z, A = a, B = b, Angle = angle, Height = height });
            }
            // Craters: two large-ish ones, then a spread of small ones.
            guard = 0;
            while (Craters.Count < 13 && guard++ < 800)
            {
                bool big = Craters.Count < 3;
                double ang = rng.NextDouble() * Tau;
                double rr = big ? 95 + rng.NextDouble() * 60 : 62 + rng.NextDouble() * 100;
                double x = Math.Cos(ang) * rr;
                double z = Math.Sin(ang) * rr;
                double r = big ? 14 + rng.NextDouble() * 12 : 3 + rng.NextDouble() * rng.NextDouble() * 10;
                if (!OkSpot(x, z, r)) continue;
                double fresh = big ? 0.25 + rng.NextDouble() * 0.5 : rng.NextDouble();
                Craters.Add(new CraterDef { X = x, Z = z, R = r, Depth = r * (0.13 + 0.17 * fresh), Rim = r * (0.02 + 0.05 * fresh), Fresh = fresh });
            }
        }

        private static double Fbm(SimplexNoise2D n, double x, double z, int oct)
        {
            double s = 0, a = 0.5;
            for (int i = 0; i < oct; i++)
            {
                s += a * n.Noise(x, z);
                double nx = 1.6 * x - 1.2 * z;
                z = 1.2 * x + 1.6 * z;
                x = nx;
                a *= 0.5;
            }
            return s;
        }

        private static double Ridged(SimplexNoise2D n, double x, double z, int oct)
        {
            double s = 0, a = 0.5, w = 1, norm = 0;
            for (int i = 0; i < oct; i++)
            {
                double v = 1 - Math.Abs(n.Noise(x, z));
                v *= v * w;
                w = Math.Min(1, v * 2.2);
                s += a * v;
                norm += a;
                double nx = 1.7 * x - 1.15 * z;
                z = 1.15 * x + 1.7 * z;
                x = nx;
                a *= 0.5;
            }
            return s / norm;
        }

        /// <summary>Octaves of a fractal with base wavelength <paramref name="baseLen"/> worth computing at the current resolution.</summary>
        private int Oct(double baseLen, int max)
        {
            if (double.IsNegativeInfinity(resLog)) return max;
            int o = (int)Math.Floor(Math.Log(baseLen, 2) - resLog) + 2;
            return o < 1 ? 1 : o > max ? max : o;
        }

        /// <summary>
        /// Analytic terrain height (m) at a world position. Writes the Rock/Bright/Drift side outputs.
        /// <paramref name="res"/> is the spacing (m) of the grid being sampled: octaves and features
        /// smaller than it are skipped (they would only alias). 0 = full detail.
        /// </summary>
        public double Sample(double x, double z, double res = 0)
        {
            double r = Math.Sqrt(x * x + z * z);
            double rock = 0;
            double bright = 0;
            resLog = res > 0 ? Math.Log(2 * res, 2) : double.NegativeInfinity;

            // ---- rolling plains -------------------------------------------------------------
            double h = 5.0 * Fbm(nBase, x / 640, z / 640, Oct(640, 3));
            h += 1.6 * Fbm(nMid, x / 130, z / 130, Oct(130, 3));
            if (res < 9) h += 0.3 * nFine.Noise(x / 19, z / 19);
            if (res < 3.5) h += 0.12 * nFine.Noise(z / 7.5 + 13.7, x / 7.5 - 3.1);

            // ---- regolith drifts: elongated, sharp-crested dunes in patches --------------------
            double driftMask = Smoothstep(-0.15, 0.55, nMask.Noise(x / 240, z / 240));
            if (driftMask > 0 && res < 12)
            {
                double wu = x * 0.6 + z * 0.8;
                double wv = -x * 0.8 + z * 0.6;
                double warp = 7 * nDune.Noise(x / 80, z / 80);
                double d = 1 - Math.Abs(nDune.Noise((wu + warp) / 27, wv / 110));
                d = d * d * d;
                h += 0.85 * d * driftMask;
            }
            Drift = driftMask;

            // ---- impact craters ---------------------------------------------------------------
            for (int i = 0; r < 320 && i < Craters.Count; i++)
            {
                var c = Craters[i];
                double dx = x - c.X;
                double dz = z - c.Z;
                double lim = c.R * 2.6;
                if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
                double t = Math.Sqrt(dx * dx + dz * dz) / c.R;
                if (t >= 2.6) continue;
                t += 0.07 * nDetail.Noise(x / (c.R * 0.7) + c.X, z / (c.R * 0.7));
                h += CraterProfile(t, c.Depth, c.Rim, c.Fresh, c.R > 12 ? 0.25 : 0);
                rock = Math.Max(rock, 0.6 * c.Fresh * Smoothstep(0.62, 0.95, t) * Smoothstep(1.35, 1.0, t));
                if (t > 0.85) bright += c.Fresh * 0.55 * Math.Exp(-(t - 1) * 1.6) * Smoothstep(0.85, 1.0, t);
            }
            foreach (var L in CraterLevels)
            {
                if (r < L.MinDist - L.Cell * 1.5 || r > L.MaxDist + L.Cell) continue;
                if (res > 0 && L.RMax < res * 0.9) continue;
                double fx = x / L.Cell;
                double fz = z / L.Cell;
                int cx = (int)Math.Floor(fx);
                int cz = (int)Math.Floor(fz);
                double reach = 2.6 * L.RMax / L.Cell;
                double ox = fx - cx;
                double oz = fz - cz;
                int i0 = ox + 0.15 < reach ? -1 : 0;
                int i1 = 1.15 - ox < reach ? 1 : 0;
                int j0 = oz + 0.15 < reach ? -1 : 0;
                int j1 = 1.15 - oz < reach ? 1 : 0;
                for (int j = j0; j <= j1; j++)
                {
                    for (int i = i0; i <= i1; i++)
                    {
                        int ix = cx + i;
                        int iz = cz + j;
                        // One 32-bit hash gives existence, position, size and freshness (8 bits each).
                        uint hv = Hash(ix, iz, L.Salt);
                        if ((hv & 255) / 256.0 > L.Prob) continue;
                        double px = (ix + 0.15 + 0.7 * (((hv >> 8) & 255) / 255.0)) * L.Cell;
                        double pz = (iz + 0.15 + 0.7 * (((hv >> 16) & 255) / 255.0)) * L.Cell;
                        double u = ((hv >> 24) & 255) / 255.0;
                        double cr = L.RMin + (L.RMax - L.RMin) * u * u;
                        double dx = x - px;
                        double dz = z - pz;
                        double d2 = dx * dx + dz * dz;
                        if (d2 >= cr * cr * 6.76) continue;
                        double pr = Math.Sqrt(px * px + pz * pz);
                        if (pr < L.MinDist || pr > L.MaxDist) continue;
                        if (InWreckZone(px, pz, cr)) continue;
                        double fresh = Hash01(ix, iz, L.Salt + 4);
                        double t = Math.Sqrt(d2) / cr;
                        t += 0.06 * nDetail.Noise(x / (cr * 0.8) + ix, z / (cr * 0.8) + iz);
                        double depth = cr * (0.11 + 0.16 * fresh);
                        double rim = cr * (0.015 + 0.045 * fresh);
                        h += CraterProfile(t, depth, rim, fresh, cr > 14 ? 0.3 : 0);
                        if (fresh > 0.55)
                        {
                            rock = Math.Max(rock, (fresh - 0.4) * 0.9 * Smoothstep(0.6, 0.95, t) * Smoothstep(1.3, 1.0, t));
                            if (t > 0.8) bright += (fresh - 0.55) * 0.9 * Math.Exp(-(t - 1) * 1.8) * Smoothstep(0.8, 1.0, t);
                        }
                    }
                }
            }

            // ---- low rocky outcrops: bedrock ledges poking through the dust -------------------
            for (int i = 0; r < 220 && i < Outcrops.Count; i++)
            {
                var o = Outcrops[i];
                double dx = x - o.X;
                double dz = z - o.Z;
                double lim = o.A * 1.8;
                if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
                double ca = Math.Cos(o.Angle);
                double sa = Math.Sin(o.Angle);
                double lu = (dx * ca + dz * sa) / o.A;
                double lv = (-dx * sa + dz * ca) / o.B;
                double d = Math.Sqrt(lu * lu + lv * lv);
                if (d > 1.8) continue;
                d += 0.28 * nDetail.Noise(x / 6 + 40, z / 6) + 0.12 * nFine.Noise(x / 2.6, z / 2.6 + 9);
                double core = Smoothstep(1.0, 0.62, d);
                double apron = Smoothstep(1.7, 0.9, d);
                // A low bedrock rise with terraced ledges (strata) on top.
                double oh = o.Height * 0.6 * core * (0.7 + 0.3 * Ridged(nHill, x / 7, z / 7, 2));
                const double step = 0.75;
                double q = oh / step;
                double fl = Math.Floor(q);
                oh = oh * 0.35 + 0.65 * (fl + Smoothstep(0.25, 0.75, q - fl)) * step;
                h += oh + o.Height * 0.22 * apron;
                rock = Math.Max(rock, Smoothstep(0.95, 0.75, d));
            }

            // Toward the sun the skyline stays low, so the Hollow hangs just above it and lights the outpost.
            double sunCos = r > 1 ? (x * SunHx + z * SunHz) / r : 0;
            double cone = Smoothstep(0.4, 0.82, sunCos);

            // ---- ring of hills enclosing the play area -----------------------------------------
            double ringR = r + 30 * nWarp.Noise(x / 230, z / 230);
            if (ringR > 150 && ringR < 400)
            {
                double band = Smoothstep(150, 230, ringR) * (1 - Smoothstep(262, 395, ringR));
                double ca = r > 0 ? x / r : 1;
                double sa = r > 0 ? z / r : 0;
                double amp = (10 + 25 * Smoothstep(-0.55, 0.55, nHill.Noise(ca * 1.9 + 5, sa * 1.9))) * (1 - 0.5 * cone);
                double e = Eroded(x / 120 + 40, z / 120 - 20, Oct(120, 7));
                double shape = Smoothstep(-0.75, 0.85, e);
                double hh = amp * band * shape;
                // Layered bedrock: partial terraces give ledges and short rocky risers.
                // The layer boundaries wander, so ledges never read as contour lines.
                const double step = 4.5;
                double q = hh / step + 0.45 * nDetail.Noise(x / 45 + 7, z / 45);
                double fl = Math.Floor(q);
                double fr = q - fl;
                double riser = Smoothstep(0.25, 0.75, fr);
                double tw = 0.4 * Smoothstep(-0.3, 0.4, nMask.Noise(x / 90 + 3, z / 90));
                hh += (fl + riser - q) * step * tw;
                hh += 2.2 * band * shape * Ridged(nHill, x / 38, z / 38, Oct(38, 3));
                h += hh;
                double riserRock = 4 * riser * (1 - riser) * Smoothstep(3, 9, hh);
                rock = Math.Max(rock, band * Math.Max(Smoothstep(0.45, 0.85, shape) * Smoothstep(0.5, 1.6, erodedSlope), riserRock) * 0.8);
            }

            // ---- distant mountain ranges ---------------------------------------------------------
            double mr = r + 150 * nWarp.Noise(x / 700 + 11, z / 700) - 650 * cone;
            double mmask = Smoothstep(Layout.MountainStartRadius, Layout.MountainStartRadius + 650, mr);
            if (mmask > 0)
            {
                mmask *= 1 - WreckValley(x, z);
                if (mmask > 0.0005)
                {
                    double wx = x + 260 * nWarp.Noise(x / 2600, z / 2600);
                    double wz = z + 260 * nWarp.Noise(x / 2600 + 31, z / 2600 - 17);
                    double e = Eroded(wx / 1100, wz / 1100, Oct(1100, 8));
                    double m = Smoothstep(-0.7, 0.95, e);
                    m = m * Math.Sqrt(m); // ~ m^1.5: peaky summits, broad valleys
                    // Uplift belts: long ranges rather than isolated massifs, plus the range that
                    // backs the Meridian as seen from the outpost.
                    double belt = Fbm(nRange, wx / 2600, wz / 2600, 2);
                    SegInfo(x, z, Backdrop[0], Backdrop[1], Backdrop[2], Backdrop[3]);
                    double bd = segD / 650;
                    double backdrop = segD < 2200 ? Math.Exp(-(bd * bd)) : 0;
                    double uplift = Math.Max(Smoothstep(-0.35, 0.35, belt), backdrop);
                    double amp = 470 * (1 + 0.4 * Smoothstep(2000, 7000, r)) * (1 - 0.6 * cone);
                    double mh = amp * (0.12 * m + uplift * (0.18 + 0.7 * m));
                    // Jagged crests ride on the uplifted ranges, so the skyline has peaks and saddles.
                    double crest = Ridged(nRange, wx / 1400 + 11, wz / 1400, Oct(1400, 4));
                    mh += amp * uplift * 0.36 * crest * Math.Sqrt(crest) * Smoothstep(-0.1, 0.4, m);
                    // Spurs and gullies on the flanks (the eroded fbm alone leaves slopes too smooth).
                    double steep = Smoothstep(0.25, 1.1, erodedSlope) * Smoothstep(20, 120, mh);
                    if (steep > 0)
                    {
                        double spur = Ridged(nDetail, wx / 520 + 3, wz / 520, Oct(520, 2));
                        double gully = res < 70 ? Ridged(nFine, wx / 150, wz / 150 - 5, Oct(150, 3)) : 0.5;
                        mh += amp * steep * (0.1 * (spur - 0.45) + 0.06 * (gully - 0.5));
                    }
                    // Sedimentary benches: soft terraces on the flanks.
                    double tq = mh / 26 + 0.5 * nDetail.Noise(x / 400, z / 400 + 9);
                    double tf = Math.Floor(tq);
                    mh += (tf + Smoothstep(0.3, 0.7, tq - tf) - tq) * 26 * 0.3 * Smoothstep(-0.2, 0.4, nMask.Noise(x / 1200, z / 1200 - 4));
                    h += mmask * mh;
                    rock = Math.Max(rock, mmask * Smoothstep(40, 160, mh) * Smoothstep(0.35, 1.3, erodedSlope));
                }
            }

            // ---- far rim ranges: the world edge (10 km) is always hidden behind a skyline ----------
            if (r > 6500)
            {
                double rim = Smoothstep(6500, 9700, r);
                // Broad, uneven massifs (features many far-mesh cells wide, so no saw-teeth).
                double mass = Smoothstep(-0.6, 0.8, Eroded(x / 3300 + 17, z / 3300 - 4, Oct(3300, 6)));
                double crest = Ridged(nRange, x / 4200 - 5, z / 4200 + 3, Oct(4200, 3));
                h += rim * (260 + 560 * mass + 220 * crest * Math.Sqrt(crest));
                rock = Math.Max(rock, rim * 0.7);
            }

            // Safety net: never let the sunward skyline climb above ~7 degrees as seen from the outpost.
            if (cone > 0)
            {
                double hmax = 4 + r * 0.125;
                h += (Smin(h, hmax, 60) - h) * cone;
            }

            // ---- the Meridian's crater and trench ---------------------------------------------------
            h += WreckShape(x, z);
            rock = Math.Max(rock, wreckRock);
            bright += wreckBright;

            // ---- keep the view from the outpost to the wreck open ----------------------------------
            SegInfo(x, z, Layout.Vista.FromX, Layout.Vista.FromZ, Layout.Vista.ToX, Layout.Vista.ToZ);
            const double half = Layout.Vista.Width / 2;
            double cm = 1 - Smoothstep(half, half + 60, segD);
            if (cm > 0 && h > Layout.Vista.MaxHeight * 0.5)
            {
                const double k = Layout.Vista.MaxHeight * 0.5;
                double clamped = k + (Layout.Vista.MaxHeight - k) * (1 - Math.Exp(-(h - k) / (Layout.Vista.MaxHeight - k)));
                h += (clamped - h) * cm;
            }

            // ---- flat outpost apron -------------------------------------------------------------------
            if (r < Layout.OutpostBlendRadius)
            {
                double w = Smoothstep(FlatExactRadius, Layout.OutpostBlendRadius, r);
                h *= w;
                rock *= w;
                bright *= w;
                Drift *= 0.4 + 0.6 * w;
            }

            // Planet curvature (subtle, sells distance on the horizon).
            if (r > 60) h -= (r - 60) * (r - 60) / (2 * MoonRadius);

            Rock = rock > 1 ? 1 : rock;
            Bright = bright > 1 ? 1 : bright < -1 ? -1 : bright;
            return h;
        }

        /// <summary>1 near the wreck and trench (mountains stay away), fading to 0.</summary>
        public double WreckValley(double x, double z)
        {
            SegInfo(x, z, Layout.Trench.StartX, Layout.Trench.StartZ, Layout.Wreck.X, Layout.Wreck.Z);
            double d = segD;
            SegInfo(x, z, Layout.Wreck.X, Layout.Wreck.Z, Layout.Vista.ToX, Layout.Vista.ToZ);
            d = Math.Min(d, segD);
            return 1 - Smoothstep(330, 760, d);
        }

        /// <summary>True if a procedural crater would land on the wreck crater, trench or hull.</summary>
        private bool InWreckZone(double px, double pz, double cr)
        {
            double dx = px - Layout.Wreck.X;
            double dz = pz - Layout.Wreck.Z;
            double a = (dx * WreckFwdX + dz * WreckFwdZ) / (WreckCraterA + cr);
            double b = (dx * WreckSideX + dz * WreckSideZ) / (WreckCraterB + cr);
            if (a * a + b * b < 1.3) return true;
            SegInfo(px, pz, Layout.Trench.StartX, Layout.Trench.StartZ, Layout.Trench.EndX, Layout.Trench.EndZ);
            return segD < Layout.Trench.Width + cr && segS > -0.1 && segS < 1.2;
        }

        /// <summary>Crater under the Meridian, bow-wave mound, hull trough and the ploughed trench with spoil berms.</summary>
        private double WreckShape(double x, double z)
        {
            wreckRock = 0;
            wreckBright = 0;
            double dx = x - Layout.Wreck.X;
            double dz = z - Layout.Wreck.Z;
            // Quick reject: outside the crater/mound reach and the trench's bounding box.
            if (dx * dx + dz * dz > 640 * 640)
            {
                const double m = Layout.Trench.Width * 2.6;
                if (x < Math.Min(Layout.Trench.StartX, Layout.Trench.EndX) - m || x > Math.Max(Layout.Trench.StartX, Layout.Trench.EndX) + m) return 0;
                if (z < Math.Min(Layout.Trench.StartZ, Layout.Trench.EndZ) - m || z > Math.Max(Layout.Trench.StartZ, Layout.Trench.EndZ) + m) return 0;
            }
            double h = 0;
            double along = dx * WreckFwdX + dz * WreckFwdZ;
            double across = dx * WreckSideX + dz * WreckSideZ;
            double ea = along / WreckCraterA;
            double eb = across / WreckCraterB;
            double t = Math.Sqrt(ea * ea + eb * eb);
            if (t < 2.6)
            {
                t += 0.05 * nDetail.Noise(x / 60, z / 60 + 77) + 0.025 * nFine.Noise(x / 17, z / 17);
                h += CraterProfile(t, Layout.Wreck.CraterDepth, 4.2, 0.55, 0.35);
                wreckRock = Smoothstep(0.75, 0.97, t) * Smoothstep(1.3, 1.0, t) * 0.6;
                wreckBright = -0.35 * Smoothstep(1.25, 0.9, t);
                // Trough the hull lies in.
                double ta = Math.Abs(along) / (Layout.Wreck.Length * 0.5 + 15);
                if (ta < 1.2 && Math.Abs(across) < 70)
                {
                    double tr = 1 - Smoothstep(0.85, 1.2, ta);
                    h -= 3 * tr * Math.Pow(1 - Smoothstep(0, 65, Math.Abs(across)), 1.5);
                }
            }
            // Regolith shoved ahead of the bow: a crescent mound.
            double ma = along - (Layout.Wreck.Length * 0.5 + 18) + across * across / 260;
            if (Math.Abs(across) < 260 && ma > -120 && ma < 160)
            {
                double mq = ma / 30, aq = across / 90;
                double mound = 8.5 * Math.Exp(-(mq * mq)) * Math.Exp(-(aq * aq));
                h += mound * (0.85 + 0.15 * nFine.Noise(x / 9, z / 9));
                wreckBright -= 0.25 * Smoothstep(0.5, 3, mound);
            }
            // Ploughed trench from first touchdown to the stern.
            SegInfo(x, z, Layout.Trench.StartX, Layout.Trench.StartZ, Layout.Trench.EndX, Layout.Trench.EndZ);
            double s = segS;
            if (s > -0.12 && s < 1.25 && segD < Layout.Trench.Width * 2.4)
            {
                double half = Layout.Trench.Width / 2 * (0.5 + 0.5 * Smoothstep(-0.05, 0.45, s));
                double grow = Smoothstep(-0.08, 0.3, s) * (s < 1 ? 1 : Smoothstep(1.22, 1.0, s));
                double lat = segD + 2.5 * nDetail.Noise(s * 14, 3.3) + 1.2 * nFine.Noise(x / 11, z / 11);
                double u = lat / half;
                double depth = Layout.Trench.Depth * grow;
                if (u < 1.05)
                {
                    h -= depth * (1 - Smoothstep(0.45, 1.05, u));
                    // Long grooves gouged by hull plating.
                    h += 0.45 * grow * Math.Sin(lat * 0.85) * (1 - Smoothstep(0.3, 0.95, u));
                }
                double bermH = 4.6 * grow * (0.75 + 0.25 * nDetail.Noise(s * 22, 9.1));
                double bq = (u - 1.28) / 0.42;
                h += bermH * Math.Exp(-(bq * bq));
                double near = 1 - Smoothstep(0.9, 2.0, u);
                wreckRock = Math.Max(wreckRock, grow * Smoothstep(0.55, 1.0, u) * Smoothstep(1.7, 1.15, u) * 0.6);
                wreckBright -= 0.4 * grow * near;
            }
            return h;
        }
    }
}
