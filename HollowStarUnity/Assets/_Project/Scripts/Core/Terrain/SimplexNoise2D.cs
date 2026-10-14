using System;

namespace HollowStar.Core.Terrain
{
    /// <summary>
    /// 2D simplex noise, a line-for-line port of createNoise2D from the simplex-noise 4.0.3 npm
    /// package (MIT, Jonas Wagner; after Stefan Gustavson). Same permutation from the same random
    /// stream, so it returns the same values as the web version. Range about [-1, 1].
    /// </summary>
    public sealed class SimplexNoise2D
    {
        private static readonly double F2 = 0.5 * (Math.Sqrt(3.0) - 1.0);
        private static readonly double G2 = (3.0 - Math.Sqrt(3.0)) / 6.0;

        private static readonly double[] Grad2 =
        {
            1, 1, -1, 1, 1, -1, -1, -1,
            1, 0, -1, 0, 1, 0, -1, 0,
            0, 1, 0, -1, 0, 1, 0, -1,
        };

        private readonly byte[] perm = new byte[512];
        private readonly double[] permGradX = new double[512];
        private readonly double[] permGradY = new double[512];

        public SimplexNoise2D(Func<double> random)
        {
            for (int i = 0; i < 256; i++) perm[i] = (byte)i;
            for (int i = 0; i < 255; i++)
            {
                int r = i + (int)(random() * (256 - i));
                byte aux = perm[i];
                perm[i] = perm[r];
                perm[r] = aux;
            }
            for (int i = 256; i < 512; i++) perm[i] = perm[i - 256];
            for (int i = 0; i < 512; i++)
            {
                permGradX[i] = Grad2[perm[i] % 12 * 2];
                permGradY[i] = Grad2[perm[i] % 12 * 2 + 1];
            }
        }

        public double Noise(double x, double y)
        {
            double n0 = 0, n1 = 0, n2 = 0;
            double s = (x + y) * F2;
            int i = (int)Math.Floor(x + s);
            int j = (int)Math.Floor(y + s);
            double t = (i + j) * G2;
            double x0 = x - (i - t);
            double y0 = y - (j - t);
            int i1, j1;
            if (x0 > y0)
            {
                i1 = 1;
                j1 = 0;
            }
            else
            {
                i1 = 0;
                j1 = 1;
            }
            double x1 = x0 - i1 + G2;
            double y1 = y0 - j1 + G2;
            double x2 = x0 - 1.0 + 2.0 * G2;
            double y2 = y0 - 1.0 + 2.0 * G2;
            int ii = i & 255;
            int jj = j & 255;
            double t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 >= 0)
            {
                int gi0 = ii + perm[jj];
                t0 *= t0;
                n0 = t0 * t0 * (permGradX[gi0] * x0 + permGradY[gi0] * y0);
            }
            double t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 >= 0)
            {
                int gi1 = ii + i1 + perm[jj + j1];
                t1 *= t1;
                n1 = t1 * t1 * (permGradX[gi1] * x1 + permGradY[gi1] * y1);
            }
            double t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 >= 0)
            {
                int gi2 = ii + 1 + perm[jj + 1];
                t2 *= t2;
                n2 = t2 * t2 * (permGradX[gi2] * x2 + permGradY[gi2] * y2);
            }
            return 70.0 * (n0 + n1 + n2);
        }
    }
}
