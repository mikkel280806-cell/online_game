using System;

namespace HollowStar.Core.Survival
{
    /// <summary>
    /// The shared world clock. The host owns the real value and sends <see cref="Days"/>; guests call
    /// <see cref="SyncTo"/> and keep advancing locally in between so the sky does not stutter.
    /// Time of day runs 0..1: 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
    /// </summary>
    public sealed class GameClock
    {
        /// <summary>One full day lasts 20 real minutes.</summary>
        public const float DayLengthSeconds = 20f * 60f;
        /// <summary>A new world starts in the morning.</summary>
        public const double StartDays = 0.30;

        public const float MiddayTempC = 16f;
        public const float MidnightTempC = -14f;
        private const float MeanTempC = (MiddayTempC + MidnightTempC) * 0.5f;
        private const float TempAmplitudeC = (MiddayTempC - MidnightTempC) * 0.5f;

        /// <summary>Sun height at noon in degrees; below 90 so shadows stay long and readable.</summary>
        public const float SunPeakElevationDeg = 75f;
        private const float SunriseTime = 0.25f;

        /// <summary>Days since the world began as one continuous number: whole part is the day, fraction the time of day.</summary>
        public double Days { get; private set; } = StartDays;

        /// <summary>Whole days elapsed (0 on the first day).</summary>
        public int Day => (int)Math.Floor(Days);

        /// <summary>0..1, see the class summary.</summary>
        public float TimeOfDay => (float)(Days - Math.Floor(Days));

        /// <summary>Outdoor air temperature now, in degrees C.</summary>
        public float AmbientC => AmbientAt(TimeOfDay);

        /// <summary>Sun height above the horizon in degrees; negative at night. For U4's sky and sun light.</summary>
        public float SunElevationDeg => SunElevationAt(TimeOfDay);

        public bool IsDaytime => SunElevationDeg > 0f;

        public GameClock() { }

        public GameClock(double days)
        {
            SyncTo(days);
        }

        public void Advance(float dt)
        {
            if (dt > 0f && !float.IsInfinity(dt)) Days += dt / DayLengthSeconds;
        }

        /// <summary>Takes the host's value. Ignores nonsense so a bad packet cannot break the sky.</summary>
        public void SyncTo(double days)
        {
            if (double.IsNaN(days) || double.IsInfinity(days) || days < 0.0) return;
            Days = days;
        }

        /// <summary>A cosine through the day: warmest at noon, coldest at midnight.</summary>
        public static float AmbientAt(float timeOfDay) =>
            MeanTempC - TempAmplitudeC * MathF.Cos(2f * MathF.PI * timeOfDay);

        public static float SunElevationAt(float timeOfDay) =>
            SunPeakElevationDeg * MathF.Sin(2f * MathF.PI * (timeOfDay - SunriseTime));
    }
}
