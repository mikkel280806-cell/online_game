using System;

namespace HollowStar.Core.Survival
{
    /// <summary>What surrounds a player this frame. The Game fills it from the zone they stand in, the clock and their gear.</summary>
    public readonly struct VitalsEnvironment
    {
        /// <summary>Inside a pressurised zone (Wren bay, outpost habs): the air is breathable, so oxygen refills.</summary>
        public readonly bool Pressurised;
        /// <summary>Out of the wind. A shelter counts as <see cref="Vitals.ShelterTempC"/> whatever the ambient is.</summary>
        public readonly bool Sheltered;
        /// <summary>Outdoor air temperature in degrees C (from <see cref="GameClock"/>).</summary>
        public readonly float AmbientC;
        /// <summary>How much of the cold the suit keeps out, 0..1 (see <see cref="SuitGear"/>).</summary>
        public readonly float Insulation;
        /// <summary>Size of the oxygen tank (bigger tanks drain no faster, they just last longer).</summary>
        public readonly float OxygenCapacity;

        public VitalsEnvironment(bool pressurised, bool sheltered, float ambientC, float insulation = 0f, float oxygenCapacity = Vitals.BaseOxygenCapacity)
        {
            Pressurised = pressurised;
            Sheltered = sheltered;
            AmbientC = ambientC;
            Insulation = insulation;
            OxygenCapacity = oxygenCapacity;
        }

        public static VitalsEnvironment Outdoors(float ambientC, float insulation = 0f, float oxygenCapacity = Vitals.BaseOxygenCapacity) =>
            new VitalsEnvironment(false, false, ambientC, insulation, oxygenCapacity);

        /// <summary>A pressurised zone is always a shelter too.</summary>
        public static VitalsEnvironment InPressurisedZone(float ambientC, float insulation = 0f, float oxygenCapacity = Vitals.BaseOxygenCapacity) =>
            new VitalsEnvironment(true, true, ambientC, insulation, oxygenCapacity);
    }

    /// <summary>
    /// One player's survival state (spec section 1). The owner steps it every frame and the host shows it to
    /// the partner; nothing here knows about Unity or the network.
    /// </summary>
    public sealed class Vitals
    {
        // Oxygen. The suit tank empties in 5 minutes whatever its size; a pressurised zone refills it fast.
        public const float BaseOxygenCapacity = 100f;
        public const float OxygenDrainPerSecond = 100f / 300f;
        public const float OxygenRefillPerSecond = 25f;
        public const float OxygenDamagePerSecond = 5f;

        // Food and water drain on a timer; at 0 they hurt.
        public const float FoodDrainPerSecond = 100f / (40f * 60f);
        public const float FoodDamagePerSecond = 0.5f;
        public const float WaterDrainPerSecond = 100f / (25f * 60f);
        public const float WaterDamagePerSecond = 0.8f;

        // Body temperature. The target moves TempSensitivity degrees per degree of ambient away from
        // ShelterTempC, scaled down by insulation; the body closes on it over BodyTempTimeConstant seconds.
        public const float NormalBodyTempC = 37f;
        public const float ShelterTempC = 20f;
        public const float TempSensitivity = 0.15f;
        public const float BodyTempTimeConstant = 90f;
        public const float ColdThresholdC = 35f;
        public const float HeatThresholdC = 39.5f;
        public const float TempDamagePerSecond = 1f;

        // Health.
        public const float MaxValue = 100f;
        public const float RegenPerSecond = 0.5f;
        /// <summary>Food and water must be above this (and oxygen and temperature fine) for health to regenerate.</summary>
        public const float RegenMinFoodWater = 20f;

        // Death and respawn at the Wren bay.
        public const float RespawnDelay = 8f;
        public const float RespawnHealth = 50f;
        public const float RespawnOxygen = 100f;
        /// <summary>
        /// Food and water carry over a death, except that they are lifted to this floor so a player who starved
        /// does not come back to die again within seconds. Tuned later with the inventory rules.
        /// </summary>
        public const float RespawnMinFoodWater = 10f;

        public float Oxygen { get; private set; } = BaseOxygenCapacity;
        /// <summary>The tank size of the last step, for the HUD bar (Oxygen / OxygenCapacity).</summary>
        public float OxygenCapacity { get; private set; } = BaseOxygenCapacity;
        public float Food { get; private set; } = MaxValue;
        public float Water { get; private set; } = MaxValue;
        public float BodyTemp { get; private set; } = NormalBodyTempC;
        public float Health { get; private set; } = MaxValue;
        public bool IsDead { get; private set; }
        /// <summary>Seconds since death; 0 while alive.</summary>
        public float TimeDead { get; private set; }

        /// <summary>Seconds until the player may respawn; 0 when alive or already due.</summary>
        public float RespawnCountdown => IsDead ? MathF.Max(0f, RespawnDelay - TimeDead) : 0f;

        /// <summary>Dead and the respawn delay is over: the Game should teleport the player and call <see cref="Respawn"/>.</summary>
        public bool CanRespawn => IsDead && TimeDead >= RespawnDelay;

        public bool IsCold => BodyTemp < ColdThresholdC;
        public bool IsHot => BodyTemp > HeatThresholdC;

        /// <summary>Advances the simulation by <paramref name="dt"/> seconds. While dead only the respawn timer runs.</summary>
        public void Step(float dt, in VitalsEnvironment env)
        {
            if (!(dt > 0f) || float.IsInfinity(dt)) return;
            if (IsDead)
            {
                TimeDead += dt;
                return;
            }

            // Oxygen: fill in a pressurised zone, drain outside. A smaller tank clips what is left.
            OxygenCapacity = MathF.Max(1f, env.OxygenCapacity);
            Oxygen += (env.Pressurised ? OxygenRefillPerSecond : -OxygenDrainPerSecond) * dt;
            Oxygen = Math.Clamp(Oxygen, 0f, OxygenCapacity);

            Food = MathF.Max(0f, Food - FoodDrainPerSecond * dt);
            Water = MathF.Max(0f, Water - WaterDrainPerSecond * dt);

            // Body temperature eases toward a target set by the air (or the shelter) and the suit.
            float air = env.Pressurised || env.Sheltered ? ShelterTempC : env.AmbientC;
            float insulation = Math.Clamp(env.Insulation, 0f, 1f);
            float target = NormalBodyTempC + (air - ShelterTempC) * TempSensitivity * (1f - insulation);
            BodyTemp += (target - BodyTemp) * (1f - MathF.Exp(-dt / BodyTempTimeConstant));

            float damage = 0f;
            if (Oxygen <= 0f) damage += OxygenDamagePerSecond;
            if (Food <= 0f) damage += FoodDamagePerSecond;
            if (Water <= 0f) damage += WaterDamagePerSecond;
            if (IsCold || IsHot) damage += TempDamagePerSecond;

            if (damage > 0f)
                Health -= damage * dt;
            else if (Food > RegenMinFoodWater && Water > RegenMinFoodWater)
                Health += RegenPerSecond * dt;

            Health = Math.Clamp(Health, 0f, MaxValue);
            if (Health <= 0f)
            {
                IsDead = true;
                TimeDead = 0f;
            }
        }

        /// <summary>
        /// Applies an eaten, drunk or used item's effects, clamped to each vital's range. Returns false (and
        /// changes nothing) if the item has no effect or the player is dead; the caller then keeps the item.
        /// </summary>
        public bool Consume(ItemDef item)
        {
            if (IsDead || item == null || !item.IsConsumable) return false;
            Food = Math.Clamp(Food + item.Food, 0f, MaxValue);
            Water = Math.Clamp(Water + item.Water, 0f, MaxValue);
            Oxygen = Math.Clamp(Oxygen + item.Oxygen, 0f, OxygenCapacity);
            Health = Math.Clamp(Health + item.Health, 0f, MaxValue);
            return true;
        }

        /// <summary>
        /// Back on their feet at the Wren bay: health 50, oxygen 100, body temperature normal, food and water kept
        /// (see <see cref="RespawnMinFoodWater"/>). The Game moves the player; this only resets the numbers.
        /// </summary>
        public void Respawn()
        {
            IsDead = false;
            TimeDead = 0f;
            Health = RespawnHealth;
            Oxygen = MathF.Min(RespawnOxygen, OxygenCapacity);
            BodyTemp = NormalBodyTempC;
            Food = MathF.Max(Food, RespawnMinFoodWater);
            Water = MathF.Max(Water, RespawnMinFoodWater);
        }

        /// <summary>Sets every vital directly: loading a save, or a test arranging a situation. Health 0 means dead.</summary>
        public void Restore(float oxygen, float food, float water, float bodyTemp, float health, float oxygenCapacity = BaseOxygenCapacity)
        {
            OxygenCapacity = MathF.Max(1f, oxygenCapacity);
            Oxygen = Math.Clamp(oxygen, 0f, OxygenCapacity);
            Food = Math.Clamp(food, 0f, MaxValue);
            Water = Math.Clamp(water, 0f, MaxValue);
            BodyTemp = bodyTemp;
            Health = Math.Clamp(health, 0f, MaxValue);
            IsDead = Health <= 0f;
            TimeDead = 0f;
        }
    }
}
