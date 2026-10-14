using System;
using System.Collections.Generic;

namespace HollowStar.Core
{
    public sealed class Drone
    {
        public int Id;
        public float X, Y, Z;
        public float Vx, Vz;
        public int Hp;
        public float Stun;
        public float Cooldown;
        public float Phase;
    }

    public sealed class Bolt
    {
        public float X, Y, Z;
        public float Vx, Vy, Vz;
        public float Life;
    }

    public sealed class Vitals
    {
        public float Hp;
        public bool Downed;
        /// <summary>Revive progress 0..1 while a partner holds interact.</summary>
        public float Revive;
        public float SinceHurt;
        public float AttackCd;
        public float SkillCd;

        public Vitals() => Reset();

        public void Reset()
        {
            Hp = Combat.PlayerHp;
            Downed = false;
            Revive = 0f;
            SinceHurt = 99f;
            AttackCd = 0f;
            SkillCd = 0f;
        }
    }

    /// <summary>A player as combat sees them.</summary>
    public struct Fighter
    {
        public RoleId Role;
        public float X, Z;
        public float Yaw;
        /// <summary>Holding interact (revive).</summary>
        public bool Act;
        /// <summary>Vanguard holding the shield up.</summary>
        public bool Blocking;

        public Fighter(RoleId role, float x, float z, float yaw, bool act = false, bool blocking = false)
        {
            Role = role;
            X = x;
            Z = z;
            Yaw = yaw;
            Act = act;
            Blocking = blocking;
        }
    }

    public enum FxKind
    {
        Strike,
        Shot,
        Pulse,
        Bolt,
        Hit,
        Block,
        Boom,
        Hurt,
    }

    /// <summary>Something to draw or broadcast: the guest replays these. Fields used depend on the kind.</summary>
    public struct CombatFx
    {
        public FxKind Kind;
        public RoleId Role;
        public float X, Y, Z;
        /// <summary>Strike: facing.</summary>
        public float Yaw;
        /// <summary>Shot: where it lands.</summary>
        public float Tx, Ty, Tz;
        /// <summary>Bolt: velocity.</summary>
        public float Vx, Vy, Vz;
    }

    /// <summary>Host to guest: everything the guest needs to draw combat.</summary>
    public sealed class CombatSnapshot
    {
        public struct DroneState
        {
            public int Id;
            public float X, Y, Z;
            public int Hp;
            public bool Stunned;
        }

        public struct VitalsState
        {
            public float Hp;
            public bool Downed;
            public float Revive, AttackCd, SkillCd;
        }

        public bool Active;
        public bool Won;
        public int Killed;
        public DroneState[] Drones;
        /// <summary>Indexed by RoleId.</summary>
        public VitalsState[] Vitals;
    }

    // Combat after the beacon wakes the Meridian: hostile maintenance drones in waves. Pure logic,
    // run by the host (or the solo player); the guest draws the host's state. Both roles have a
    // primary attack and a skill; a downed player is revived by a partner holding interact.
    public sealed class Combat
    {
        public const float PlayerHp = 100f;
        public const int DroneHp = 4;
        private static readonly int[] Waves = { 3, 3, 3 };
        private const float BoltSpeed = 13f;
        private const float BoltDamage = 18f;

        private const float StrikeRange = 2.8f, StrikeArc = MathF.PI * 0.6f, StrikeCooldown = 0.55f;
        private const int StrikeDamage = 2;
        private const float ShotRange = 26f, ShotCone = 0.7f, ShotCooldown = 0.32f;
        private const int ShotDamage = 1;
        private const float PulseRadius = 9f, PulseStun = 2.5f, PulseCooldown = 7f;
        private const int PulseDamage = 1;

        private const float ReviveReach = 2.4f;
        private const float ReviveTime = 2.5f;
        /// <summary>Seconds without damage before health regenerates.</summary>
        private const float RegenDelay = 5f;

        private static readonly Predicate<Drone> IsDead = d => d.Hp <= 0;

        public bool Active;
        public bool Won;
        public int Killed;
        public readonly List<Drone> Drones = new List<Drone>();
        public readonly List<Bolt> Bolts = new List<Bolt>();

        private readonly Vitals[] vitals = { new Vitals(), new Vitals() };
        /// <summary>Effects since the last Drain().</summary>
        private readonly List<CombatFx> fx = new List<CombatFx>();
        private readonly List<Fighter> alive = new List<Fighter>();
        private int wave;
        private int nextId = 1;
        private float allDownFor;
        private long seed = 7;

        private readonly Func<float, float, float> heightAt;
        private readonly IReadOnlyList<FlatCollider> colliders;
        private readonly GroundPoint spawnFrom;
        private readonly GroundPoint respawnAt;

        /// <param name="heightAt">Ground height at (x, z).</param>
        /// <param name="colliders">Walls that stop bolts.</param>
        /// <param name="spawnFrom">Where waves come from (the wreck's direction).</param>
        /// <param name="respawnAt">Where everyone regroups after all players are down.</param>
        public Combat(
            Func<float, float, float> heightAt,
            IReadOnlyList<FlatCollider> colliders = null,
            GroundPoint? spawnFrom = null,
            GroundPoint? respawnAt = null)
        {
            this.heightAt = heightAt;
            this.colliders = colliders ?? Array.Empty<FlatCollider>();
            this.spawnFrom = spawnFrom ?? Layout.DroneSpawn;
            this.respawnAt = respawnAt ?? new GroundPoint(6f, 16f);
        }

        public Vitals VitalsOf(RoleId role) => vitals[(int)role];

        public int Total
        {
            get
            {
                int n = 0;
                foreach (var w in Waves) n += w;
                return n;
            }
        }

        public string Objective
        {
            get
            {
                if (Won) return "Drones down. The signal came from the Meridian: head for the wreck.";
                if (Active) return $"Hostile drones from the wreck. Destroy them ({Killed}/{Total})";
                return null;
            }
        }

        public void Start()
        {
            if (Active || Won) return;
            Active = true;
            SpawnWave();
        }

        /// <summary>Moves the effects since the last call into <paramref name="into"/>.</summary>
        public void Drain(List<CombatFx> into)
        {
            into.AddRange(fx);
            fx.Clear();
        }

        private float Rand()
        {
            seed = seed * 16807 % 2147483647;
            return seed / 2147483647f;
        }

        private static float Wrap(float a) => MathF.Atan2(MathF.Sin(a), MathF.Cos(a));

        private static float Hypot(float x, float z) => MathF.Sqrt(x * x + z * z);

        private void SpawnWave()
        {
            int n = Waves[wave++];
            for (int i = 0; i < n; i++)
            {
                float x = spawnFrom.X + (i - (n - 1) / 2f) * 7f + (Rand() - 0.5f) * 3f;
                float z = spawnFrom.Z + (Rand() - 0.5f) * 6f;
                Drones.Add(new Drone
                {
                    Id = nextId++,
                    X = x,
                    Y = heightAt(x, z) + 6f,
                    Z = z,
                    Hp = DroneHp,
                    Cooldown = 2f + Rand() * 1.5f,
                    Phase = Rand() * 6f,
                });
            }
        }

        /// <summary>Primary attack: Vanguard strikes in front, Tether fires at the drone it faces.</summary>
        public void Attack(Fighter f)
        {
            var v = VitalsOf(f.Role);
            if (v.Downed || v.AttackCd > 0f) return;
            if (f.Role == RoleId.Vanguard)
            {
                v.AttackCd = StrikeCooldown;
                fx.Add(new CombatFx { Kind = FxKind.Strike, Role = f.Role, X = f.X, Z = f.Z, Yaw = f.Yaw });
                foreach (var d in Drones)
                {
                    float dx = d.X - f.X;
                    float dz = d.Z - f.Z;
                    float dy = d.Y - heightAt(f.X, f.Z);
                    if (Hypot(dx, dz) > StrikeRange || dy > 3.2f) continue;
                    if (MathF.Abs(Wrap(MathF.Atan2(dx, dz) - f.Yaw)) > StrikeArc / 2f) continue;
                    // Knock it back and down into reach of the next swing.
                    float l = Hypot(dx, dz);
                    if (l == 0f) l = 1f;
                    d.Vx += dx / l * 6f;
                    d.Vz += dz / l * 6f;
                    d.Y = MathF.Max(heightAt(d.X, d.Z) + 1.4f, d.Y - 0.8f);
                    Damage(d, StrikeDamage);
                }
            }
            else
            {
                v.AttackCd = ShotCooldown;
                var target = Aim(f);
                float gy = heightAt(f.X, f.Z);
                if (target != null)
                {
                    fx.Add(new CombatFx { Kind = FxKind.Shot, Role = f.Role, X = f.X, Z = f.Z, Tx = target.X, Ty = target.Y, Tz = target.Z });
                    Damage(target, ShotDamage);
                }
                else
                {
                    fx.Add(new CombatFx
                    {
                        Kind = FxKind.Shot,
                        Role = f.Role,
                        X = f.X,
                        Z = f.Z,
                        Tx = f.X + MathF.Sin(f.Yaw) * ShotRange,
                        Ty = gy + 1.4f,
                        Tz = f.Z + MathF.Cos(f.Yaw) * ShotRange,
                    });
                }
            }
            Drones.RemoveAll(IsDead);
        }

        /// <summary>Tether's gravity pulse (the Vanguard's skill, the shield, is held: see Fighter.Blocking).</summary>
        public void Skill(Fighter f)
        {
            var v = VitalsOf(f.Role);
            if (f.Role != RoleId.Tether || v.Downed || v.SkillCd > 0f) return;
            v.SkillCd = PulseCooldown;
            fx.Add(new CombatFx { Kind = FxKind.Pulse, Role = f.Role, X = f.X, Z = f.Z });
            foreach (var d in Drones)
            {
                float dx = f.X - d.X;
                float dz = f.Z - d.Z;
                float l = Hypot(dx, dz);
                if (l > PulseRadius) continue;
                d.Stun = PulseStun;
                // Pulled in and dragged down: within the Vanguard's reach.
                float k = l == 0f ? 1f : l;
                d.Vx += dx / k * 7f;
                d.Vz += dz / k * 7f;
                Damage(d, PulseDamage);
            }
            Drones.RemoveAll(IsDead);
        }

        /// <summary>Nearest live drone in front of the fighter (within the cone), else nearest in range.</summary>
        public Drone Aim(Fighter f)
        {
            Drone best = null;
            float bestScore = float.PositiveInfinity;
            foreach (var d in Drones)
            {
                if (d.Hp <= 0) continue;
                float dx = d.X - f.X;
                float dz = d.Z - f.Z;
                float dist = Hypot(dx, dz);
                if (dist > ShotRange) continue;
                float off = MathF.Abs(Wrap(MathF.Atan2(dx, dz) - f.Yaw));
                float score = dist + (off > ShotCone ? 40f : off * 6f);
                if (score < bestScore)
                {
                    bestScore = score;
                    best = d;
                }
            }
            return best;
        }

        /// <summary>Callers remove dead drones afterwards (Drones.RemoveAll), so loops over Drones stay valid.</summary>
        private void Damage(Drone d, int n)
        {
            d.Hp -= n;
            fx.Add(new CombatFx { Kind = FxKind.Hit, X = d.X, Y = d.Y, Z = d.Z });
            if (d.Hp > 0) return;
            fx.Add(new CombatFx { Kind = FxKind.Boom, X = d.X, Y = d.Y, Z = d.Z });
            Killed++;
        }

        public void Update(float dt, IReadOnlyList<Fighter> fighters)
        {
            foreach (var f in fighters)
            {
                var v = VitalsOf(f.Role);
                v.AttackCd = MathF.Max(0f, v.AttackCd - dt);
                v.SkillCd = MathF.Max(0f, v.SkillCd - dt);
                v.SinceHurt += dt;
                if (!v.Downed && v.SinceHurt > RegenDelay) v.Hp = MathF.Min(PlayerHp, v.Hp + 10f * dt);
            }
            UpdateRevives(dt, fighters);
            if (!Active) return;

            alive.Clear();
            foreach (var f in fighters)
                if (!VitalsOf(f.Role).Downed) alive.Add(f);
            foreach (var d in Drones) UpdateDrone(d, dt, alive);
            Separate();
            UpdateBolts(dt, fighters);

            if (Drones.Count <= 1 && wave < Waves.Length) SpawnWave();
            if (Drones.Count == 0 && wave >= Waves.Length)
            {
                Active = false;
                Won = true;
                Bolts.Clear();
            }
        }

        private void UpdateDrone(Drone d, float dt, List<Fighter> targets)
        {
            d.Phase += dt;
            d.Stun = MathF.Max(0f, d.Stun - dt);
            int target = -1;
            float td = float.PositiveInfinity;
            for (int i = 0; i < targets.Count; i++)
            {
                float l = Hypot(targets[i].X - d.X, targets[i].Z - d.Z);
                if (l < td)
                {
                    td = l;
                    target = i;
                }
            }
            float ground = heightAt(d.X, d.Z);
            // Stunned drones sag toward the ground; otherwise hover and bob.
            float hover = ground + (d.Stun > 0f ? 1.3f : 2.6f + MathF.Sin(d.Phase * 1.7f) * 0.25f);
            d.Y += (hover - d.Y) * MathF.Min(1f, dt * 2.5f);
            float ax = 0f;
            float az = 0f;
            if (target >= 0 && d.Stun <= 0f)
            {
                var t = targets[target];
                float dx = t.X - d.X;
                float dz = t.Z - d.Z;
                float l = td == 0f ? 1f : td;
                // Hold a firing distance and circle the target.
                const float want = 8f;
                float radial = Math.Clamp((l - want) / 4f, -1f, 1f);
                float side = MathF.Sin(d.Phase * 0.4f + d.Id) > 0f ? 1f : -1f;
                ax = dx / l * radial * 9f + -dz / l * side * 3f;
                az = dz / l * radial * 9f + dx / l * side * 3f;
                d.Cooldown -= dt;
                if (d.Cooldown <= 0f && l < 20f)
                {
                    d.Cooldown = 2.2f + Rand() * 1.2f;
                    float ty = heightAt(t.X, t.Z) + 1.2f;
                    float dist = MathF.Sqrt(dx * dx + (ty - d.Y) * (ty - d.Y) + dz * dz);
                    if (dist == 0f) dist = 1f;
                    var b = new Bolt
                    {
                        X = d.X,
                        Y = d.Y,
                        Z = d.Z,
                        Vx = dx / dist * BoltSpeed,
                        Vy = (ty - d.Y) / dist * BoltSpeed,
                        Vz = dz / dist * BoltSpeed,
                        Life = 3f,
                    };
                    Bolts.Add(b);
                    fx.Add(new CombatFx { Kind = FxKind.Bolt, X = b.X, Y = b.Y, Z = b.Z, Vx = b.Vx, Vy = b.Vy, Vz = b.Vz });
                }
            }
            // Damped motion; the drive is capped at 7 m/s.
            d.Vx += ax * dt;
            d.Vz += az * dt;
            float drag = MathF.Exp(-2.2f * dt);
            d.Vx *= drag;
            d.Vz *= drag;
            float sp = Hypot(d.Vx, d.Vz);
            if (sp > 7f)
            {
                d.Vx *= 7f / sp;
                d.Vz *= 7f / sp;
            }
            d.X += d.Vx * dt;
            d.Z += d.Vz * dt;
        }

        private void Separate()
        {
            for (int i = 0; i < Drones.Count; i++)
            {
                for (int j = i + 1; j < Drones.Count; j++)
                {
                    var a = Drones[i];
                    var b = Drones[j];
                    float dx = b.X - a.X;
                    float dz = b.Z - a.Z;
                    float l = Hypot(dx, dz);
                    if (l > 2.2f || l < 1e-4f) continue;
                    float push = (2.2f - l) / 2f / l;
                    a.X -= dx * push;
                    a.Z -= dz * push;
                    b.X += dx * push;
                    b.Z += dz * push;
                }
            }
        }

        private void UpdateBolts(float dt, IReadOnlyList<Fighter> fighters)
        {
            int keep = 0;
            for (int i = 0; i < Bolts.Count; i++)
            {
                var b = Bolts[i];
                b.X += b.Vx * dt;
                b.Y += b.Vy * dt;
                b.Z += b.Vz * dt;
                b.Life -= dt;
                if (b.Life <= 0f || b.Y < heightAt(b.X, b.Z) || FlatCollider.InsideAny(b.X, b.Z, colliders)) continue;
                if (HitsFighter(b, fighters)) continue;
                Bolts[keep++] = b;
            }
            Bolts.RemoveRange(keep, Bolts.Count - keep);
        }

        /// <summary>True when the bolt hit someone (or their shield) and is used up.</summary>
        private bool HitsFighter(Bolt b, IReadOnlyList<Fighter> fighters)
        {
            foreach (var f in fighters)
            {
                var v = VitalsOf(f.Role);
                if (v.Downed) continue;
                float gy = heightAt(f.X, f.Z);
                if (Hypot(b.X - f.X, b.Z - f.Z) > 0.6f || b.Y < gy || b.Y > gy + 2.1f) continue;
                // The shield stops bolts coming from in front.
                float from = MathF.Atan2(-b.Vx, -b.Vz);
                if (f.Blocking && f.Role == RoleId.Vanguard && MathF.Abs(Wrap(from - f.Yaw)) < 1.25f)
                {
                    fx.Add(new CombatFx { Kind = FxKind.Block, X = b.X, Y = b.Y, Z = b.Z });
                    return true;
                }
                v.Hp -= BoltDamage;
                v.SinceHurt = 0f;
                fx.Add(new CombatFx { Kind = FxKind.Hurt, Role = f.Role });
                if (v.Hp <= 0f)
                {
                    v.Hp = 0f;
                    v.Downed = true;
                    v.Revive = 0f;
                }
                return true;
            }
            return false;
        }

        private void UpdateRevives(float dt, IReadOnlyList<Fighter> fighters)
        {
            for (int i = 0; i < fighters.Count; i++)
            {
                var f = fighters[i];
                var v = VitalsOf(f.Role);
                if (!v.Downed) continue;
                bool helper = false;
                for (int j = 0; j < fighters.Count && !helper; j++)
                {
                    var o = fighters[j];
                    helper = j != i && o.Act && !VitalsOf(o.Role).Downed && Hypot(o.X - f.X, o.Z - f.Z) <= ReviveReach;
                }
                v.Revive = helper ? v.Revive + dt / ReviveTime : MathF.Max(0f, v.Revive - dt);
                if (v.Revive >= 1f)
                {
                    v.Downed = false;
                    v.Revive = 0f;
                    v.Hp = PlayerHp / 2f;
                    v.SinceHurt = 0f;
                }
            }
            // Everyone down: regroup at the pad after a moment.
            bool allDown = fighters.Count > 0;
            foreach (var f in fighters)
                if (!VitalsOf(f.Role).Downed) allDown = false;
            allDownFor = allDown ? allDownFor + dt : 0f;
        }

        /// <summary>True once when everyone has been down long enough to respawn; resets their vitals.</summary>
        public bool TryTakeRespawn(out GroundPoint at)
        {
            at = respawnAt;
            if (allDownFor < 3f) return false;
            allDownFor = 0f;
            foreach (var v in vitals) v.Reset();
            Bolts.Clear();
            return true;
        }

        /// <summary>Revive prompt for a player standing at (x, z), if a downed partner is in reach.</summary>
        public Prompt? RevivePrompt(RoleId role, float x, float z, Fighter? partner)
        {
            if (partner == null || VitalsOf(role).Downed) return null;
            var p = partner.Value;
            var v = VitalsOf(p.Role);
            if (!v.Downed || Hypot(p.X - x, p.Z - z) > ReviveReach) return null;
            return new Prompt($"Revive the {Roles.Name(p.Role)}", true, v.Revive);
        }

        // ---- network snapshot (host -> guest) ---------------------------------------------------

        public CombatSnapshot Snapshot()
        {
            var s = new CombatSnapshot
            {
                Active = Active,
                Won = Won,
                Killed = Killed,
                Drones = new CombatSnapshot.DroneState[Drones.Count],
                Vitals = new CombatSnapshot.VitalsState[Roles.Count],
            };
            for (int i = 0; i < Drones.Count; i++)
            {
                var d = Drones[i];
                s.Drones[i] = new CombatSnapshot.DroneState { Id = d.Id, X = d.X, Y = d.Y, Z = d.Z, Hp = d.Hp, Stunned = d.Stun > 0f };
            }
            for (int i = 0; i < Roles.Count; i++)
            {
                var v = vitals[i];
                s.Vitals[i] = new CombatSnapshot.VitalsState { Hp = v.Hp, Downed = v.Downed, Revive = v.Revive, AttackCd = v.AttackCd, SkillCd = v.SkillCd };
            }
            return s;
        }

        public void ApplySnapshot(CombatSnapshot s)
        {
            if (s == null) return;
            Active = s.Active;
            Won = s.Won;
            Killed = s.Killed;
            if (s.Drones != null)
            {
                var prev = new Dictionary<int, float>();
                foreach (var d in Drones) prev[d.Id] = d.Phase;
                Drones.Clear();
                foreach (var a in s.Drones)
                {
                    if (!float.IsFinite(a.X) || !float.IsFinite(a.Y) || !float.IsFinite(a.Z)) continue;
                    Drones.Add(new Drone
                    {
                        Id = a.Id,
                        X = a.X,
                        Y = a.Y,
                        Z = a.Z,
                        Hp = a.Hp,
                        Stun = a.Stunned ? 1f : 0f,
                        Phase = prev.TryGetValue(a.Id, out float phase) ? phase : 0f,
                    });
                }
            }
            if (s.Vitals != null && s.Vitals.Length == Roles.Count)
            {
                for (int i = 0; i < Roles.Count; i++)
                {
                    var a = s.Vitals[i];
                    if (!float.IsFinite(a.Hp) || !float.IsFinite(a.Revive) || !float.IsFinite(a.AttackCd) || !float.IsFinite(a.SkillCd)) continue;
                    var v = vitals[i];
                    v.Hp = a.Hp;
                    v.Downed = a.Downed;
                    v.Revive = a.Revive;
                    v.AttackCd = a.AttackCd;
                    v.SkillCd = a.SkillCd;
                }
            }
        }

        /// <summary>Guest: add a bolt the host fired, for drawing only.</summary>
        public void AddBolt(float x, float y, float z, float vx, float vy, float vz)
        {
            Bolts.Add(new Bolt { X = x, Y = y, Z = z, Vx = vx, Vy = vy, Vz = vz, Life = 3f });
        }

        /// <summary>Guest: move the drawn bolts (no hits; the host decides those).</summary>
        public void AdvanceBolts(float dt)
        {
            int keep = 0;
            for (int i = 0; i < Bolts.Count; i++)
            {
                var b = Bolts[i];
                b.X += b.Vx * dt;
                b.Y += b.Vy * dt;
                b.Z += b.Vz * dt;
                b.Life -= dt;
                if (b.Life > 0f && b.Y > heightAt(b.X, b.Z) && !FlatCollider.InsideAny(b.X, b.Z, colliders)) Bolts[keep++] = b;
            }
            Bolts.RemoveRange(keep, Bolts.Count - keep);
        }
    }
}
