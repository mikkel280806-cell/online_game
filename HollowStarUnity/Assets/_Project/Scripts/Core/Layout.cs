namespace HollowStar.Core
{
    // World layout for Chapter 1 ("Vigil"): metres, +Y up, -Z is north. Same numbers as the web
    // version (src/env/layout.ts and src/env/props/layout.ts), so tuned gameplay carries over.
    // Unity is left-handed and three.js right-handed, so the Unity world is a mirror image of the
    // web one; nothing in the game depends on handedness.
    public static class Layout
    {
        /// <summary>The outpost sits on flat ground: terrain height is exactly 0 within this radius.</summary>
        public const float OutpostFlatRadius = 38f;
        /// <summary>Terrain blends from flat back to natural ground out to this radius.</summary>
        public const float OutpostBlendRadius = 75f;
        /// <summary>Where players may walk (soft circular boundary around the origin).</summary>
        public const float PlayRadius = 150f;

        public static readonly GroundPoint LandingPad = new GroundPoint(12f, 6f);
        public const float LandingPadRadius = 13f;

        /// <summary>Players spawn near the dropship's ramp.</summary>
        public static readonly GroundPoint[] SpawnPoints = { new GroundPoint(4.5f, 16f), new GroundPoint(7.5f, 17.5f) };

        /// <summary>The outpost's comms mast; the beacon restarts here.</summary>
        public static readonly GroundPoint Mast = new GroundPoint(-21f, -3f);
        public const float MastHeight = 16f;
        /// <summary>Equipment cabinet beside the mast.</summary>
        public static readonly GroundPoint MastCabinet = new GroundPoint(Mast.X - 1.2f, Mast.Z + 2.2f);
        /// <summary>Ground-power pedestal at the landing pad.</summary>
        public static readonly GroundPoint Pedestal = new GroundPoint(1.8f, 1.2f);

        /// <summary>Drone waves come from the wreck's direction.</summary>
        public static readonly GroundPoint DroneSpawn = new GroundPoint(-6f, -48f);

        // Direction toward the red giant, the Hollow (the key light comes from here): ~11 degrees
        // up, west-north-west. Not normalised; doubles so the terrain matches the web version exactly.
        public const double SunDirX = -0.85, SunDirY = 0.2, SunDirZ = -0.48;
        /// <summary>Direction toward the gas giant Orrin in the sky (not normalised).</summary>
        public const double PlanetDirX = 0.78, PlanetDirY = 0.42, PlanetDirZ = -0.46;

        /// <summary>The crashed Meridian. Its bow points along Yaw (radians around +Y, 0 = facing -Z/north).</summary>
        public static class Wreck
        {
            public const double X = -70, Z = -560;
            /// <summary>Bow toward the south-west, roughly toward the outpost.</summary>
            public const double Yaw = 2.35;
            public const double Length = 420;
            /// <summary>The hull is sunk this far below the local ground at its centre line.</summary>
            public const double Burial = 14;
            public const double CraterRadius = 140, CraterDepth = 9;
        }

        /// <summary>The trench the Meridian ploughed coming in from the north-east: start to the wreck's stern.</summary>
        public static class Trench
        {
            public const double StartX = 260, StartZ = -1020, EndX = 80, EndZ = -700;
            public const double Width = 55, Depth = 7;
        }

        /// <summary>Keeps the view from the outpost to the wreck open: terrain stays low inside this corridor.</summary>
        public static class Vista
        {
            public const double FromX = 0, FromZ = -40, ToX = -70, ToZ = -480;
            public const double Width = 120, MaxHeight = 6;
        }

        /// <summary>Distant mountains start rising beyond this radius.</summary>
        public const double MountainStartRadius = 420;
    }
}
