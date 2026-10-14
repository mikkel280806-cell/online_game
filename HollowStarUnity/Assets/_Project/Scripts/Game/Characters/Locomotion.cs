using HollowStar.Core;
using UnityEngine;
using B = HollowStar.Game.Characters.SuitRig.Bone;

namespace HollowStar.Game.Characters
{
    /// <summary>
    /// Procedural animation for the EVA suit, ported from the web version (src/characters/locomotion.ts):
    /// idle (breathing, weight shift, look-around), walk/lope/sprint driven by speed, leaning into turns
    /// and acceleration, springy secondary motion on the backpack and antenna.
    ///
    /// Everything is a continuous function of a smoothed speed, so there are no states to blend:
    /// cadence and stance length are chosen so that cadence x stride = speed (no foot sliding),
    /// planted feet are solved with two-bone IK onto the ground, and boots roll heel-to-toe around
    /// their real heel/toe pivots. Above ~1.7 m/s a flight phase appears: a loping run with a touch of
    /// low-gravity hang time.
    /// </summary>
    public sealed class Locomotion
    {
        private const float Tau = Mathf.PI * 2f;

        private struct Spring
        {
            public float X, V;
        }

        public struct FootState
        {
            /// <summary>Ground anchor (model space): the point under the ankle when the boot is flat.</summary>
            public Vector3 Anchor;
            /// <summary>0 in the air, 1 planted.</summary>
            public float Planted;
            /// <summary>Boot pitch (positive = toes down).</summary>
            public float Pitch;
        }

        /// <summary>Smoothed speed (m/s).</summary>
        public float Speed;
        /// <summary>Gait cycle phase in [0, 1); the left foot touches down at 0.</summary>
        public float Phase;
        public float Time;
        public readonly FootState[] Feet = { new FootState { Planted = 1 }, new FootState { Planted = 1 } };

        private bool init;
        private float lastYaw, lastSpeed, yawRate, accel, exertion;
        private readonly Mulberry32 rng;
        private float lookYaw, lookPitch;
        private float lookTargetYaw, lookTargetPitch = 0.05f;
        private float nextLook = 1.5f;
        private float gesture;
        private float nextGesture;
        private float gestureUntil = -1f;
        private float pelvisY = SuitRig.HipY + 0.03f;
        private float pelvisVY, vertAccel;
        private Spring packPitch, packRoll, antennaPitch, antennaRoll;
        private readonly Vector3[] ankles = new Vector3[2];
        private readonly Quaternion[] footQ = { Quaternion.identity, Quaternion.identity };

        public Locomotion(uint seed)
        {
            rng = new Mulberry32(seed);
            Time = Rand() * 10f;
            nextGesture = Time + 12f + Rand() * 8f;
        }

        private float Rand() => (float)rng.NextDouble();

        private static float Smoothstep(float a, float b, float x)
        {
            float t = Mathf.Clamp01((x - a) / (b - a));
            return t * t * (3f - 2f * t);
        }

        private static float Damp(float cur, float target, float lambda, float dt) => Mathf.Lerp(cur, target, 1f - Mathf.Exp(-lambda * dt));
        private static float WrapAngle(float a) => Mathf.Atan2(Mathf.Sin(a), Mathf.Cos(a));
        private static float Fract(float x) => x - Mathf.Floor(x);

        // Rotations from radians, matching three.js Euler orders (quaternion maths is identical).
        private static Quaternion Ax(float r) => Quaternion.AngleAxis(r * Mathf.Rad2Deg, Vector3.right);
        private static Quaternion Ay(float r) => Quaternion.AngleAxis(r * Mathf.Rad2Deg, Vector3.up);
        private static Quaternion Az(float r) => Quaternion.AngleAxis(r * Mathf.Rad2Deg, Vector3.forward);
        private static Quaternion EulerYXZ(float x, float y, float z) => Ay(y) * Ax(x) * Az(z);
        private static Quaternion EulerXZY(float x, float y, float z) => Ax(x) * Az(z) * Ay(y);
        private static Quaternion EulerXYZ(float x, float y, float z) => Ax(x) * Ay(y) * Az(z);

        private static void StepSpring(ref Spring s, float target, float omega, float zeta, float dt)
        {
            // Semi-implicit Euler, sub-stepped for stability.
            int n = Mathf.Max(1, Mathf.CeilToInt(dt / (1f / 120f)));
            float h = dt / n;
            for (int i = 0; i < n; i++)
            {
                float a = omega * omega * (target - s.X) - 2f * zeta * omega * s.V;
                s.V += a * h;
                s.X += s.V * h;
            }
        }

        /// <summary>Glance at the wrist computer now (only shows while standing still).</summary>
        public void TriggerGesture()
        {
            gestureUntil = Time + 2.6f;
            nextGesture = Time + 14f + Rand() * 10f;
        }

        public void Update(float yawIn, float speedIn, float dtIn, SuitPose pose)
        {
            float dt = float.IsFinite(dtIn) ? Mathf.Clamp(dtIn, 0f, 0.25f) : 0f;
            float speed = float.IsFinite(speedIn) ? Mathf.Clamp(speedIn, 0f, 14f) : 0f;
            float yaw = float.IsFinite(yawIn) ? yawIn : lastYaw;
            if (!init)
            {
                init = true;
                Speed = speed;
                lastYaw = yaw;
                lastSpeed = speed;
            }

            // ---- state ---------------------------------------------------------------------------
            if (dt > 0f)
            {
                Time += dt;
                float rawRate = Mathf.Clamp(WrapAngle(yaw - lastYaw) / dt, -10f, 10f);
                yawRate = Damp(yawRate, rawRate, 9f, dt);
                float rawAcc = Mathf.Clamp((speed - lastSpeed) / dt, -60f, 60f);
                accel = Damp(accel, rawAcc, 7f, dt);
                Speed = Damp(Speed, speed, 9f, dt);
            }
            lastYaw = yaw;
            lastSpeed = speed;
            float v = Speed;
            float m = Smoothstep(0.12f, 1.1f, v); // moving
            float r = Smoothstep(1.4f, 3.4f, v); // running style
            float sp = Smoothstep(5.6f, 8.2f, v); // sprinting
            float idle = 1f - m;

            // Gait: cadence (cycles/s) rises with speed; stride = speed / cadence.
            float cadence = 0.85f + 0.11f * v;
            float stride = v / cadence;
            float stanceLen = Mathf.Min(Mathf.Lerp(0.76f, 0.9f, sp), 0.62f * stride);
            float duty = stride > 1e-4f ? Mathf.Clamp(stanceLen / stride, 0.12f, 0.62f) : 0.62f;
            Phase = Fract(Phase + cadence * dt);

            exertion = Mathf.Clamp01(exertion + dt * (r * 0.05f + sp * 0.12f - idle * 0.035f));

            // ---- idle life -----------------------------------------------------------------------
            float t = Time;
            float breathRate = Mathf.Lerp(0.24f, 0.5f, exertion);
            float breath = Mathf.Sin(t * Tau * breathRate);
            float breathAmp = 1f + exertion * 1.6f;
            float shift = (Mathf.Sin(t * Tau / 7.3f) * 0.75f + Mathf.Sin(t * Tau / 3.1f + 1.3f) * 0.25f) * idle;

            if (t > nextLook)
            {
                float roll = Rand();
                if (roll < 0.3f)
                {
                    lookTargetYaw = 0f;
                    lookTargetPitch = 0.04f;
                }
                else
                {
                    lookTargetYaw = (Rand() * 2f - 1f) * 0.75f;
                    lookTargetPitch = -0.12f + Rand() * 0.3f;
                }
                nextLook = t + 2.2f + Rand() * 3.8f;
            }
            // Occasional glance at the wrist computer while standing.
            if (idle > 0.95f && t > nextGesture && gestureUntil < t)
            {
                gestureUntil = t + 2.6f;
                nextGesture = t + 14f + Rand() * 10f;
            }
            float wantGesture = idle > 0.9f && t < gestureUntil ? 1f : 0f;
            gesture = dt > 0f ? Damp(gesture, wantGesture, 5f, dt) : wantGesture * idle;
            float g = gesture * idle;

            float tYaw = lookTargetYaw * idle;
            float tPitch = lookTargetPitch * idle;
            tYaw += Mathf.Clamp(yawRate * 0.22f, -0.55f, 0.55f) * m;
            tPitch += 0.06f * m;
            tYaw = Mathf.Lerp(tYaw, 0.42f, g);
            tPitch = Mathf.Lerp(tPitch, 0.62f, g);
            if (dt > 0f)
            {
                lookYaw = Damp(lookYaw, tYaw, 5f, dt);
                lookPitch = Damp(lookPitch, tPitch, 5f, dt);
            }
            else
            {
                lookYaw = tYaw;
                lookPitch = tPitch;
            }

            // ---- feet ----------------------------------------------------------------------------
            float center = -0.1f * r - 0.05f * sp; // stance centre relative to the hips
            float lift = Mathf.Lerp(0.05f + 0.025f * v, 0.08f + 0.04f * v, r) * m;
            float pitchHS = Mathf.Lerp(-0.3f, -0.12f, r);
            float pitchTO = Mathf.Lerp(0.42f, 0.62f, r);
            float pitchMid = Mathf.Lerp(0.12f, 0.85f, r);
            Span2 footZ = default;
            for (int i = 0; i < 2; i++)
            {
                float side = i == 0 ? 1f : -1f;
                float ph = Fract(Phase + i * 0.5f);
                float z, y, pitch, planted;
                if (ph < duty)
                {
                    float s = ph / duty;
                    z = center + stanceLen / 2f - stanceLen * s;
                    y = 0f;
                    pitch = pitchHS * (1f - Smoothstep(0f, Mathf.Lerp(0.2f, 0.12f, r), s)) +
                            pitchTO * Mathf.Pow(Smoothstep(Mathf.Lerp(0.5f, 0.42f, r), 1f, s), 1.5f);
                    planted = 1f;
                }
                else
                {
                    float s = (ph - duty) / (1f - duty);
                    float e = Smoothstep(Mathf.Lerp(0f, 0.1f, r), Mathf.Lerp(1f, 0.9f, r), s);
                    z = center - stanceLen / 2f + stanceLen * e + r * 0.07f * Mathf.Sin(Mathf.PI * Mathf.Clamp01((s - 0.5f) / 0.5f));
                    // Rise fast (heel kick), come down early so the foot skims in for the landing.
                    y = lift * Mathf.Pow(Mathf.Sin(Mathf.PI * Mathf.Pow(s, Mathf.Lerp(1f, 0.62f, r))), Mathf.Lerp(1f, 1.6f, r));
                    pitch = Mathf.Lerp(pitchTO, pitchMid, Smoothstep(0f, 0.3f, s));
                    pitch = Mathf.Lerp(pitch, pitchHS, Smoothstep(0.45f, 0.97f, s));
                    planted = 0f;
                }
                // Blend to the idle stance.
                float idleZ = 0.015f + (side > 0f ? 0.02f : -0.015f);
                Feet[i].Anchor = new Vector3(side * Mathf.Lerp(0.13f, Mathf.Lerp(0.125f, 0.1f, r), m), y * m, Mathf.Lerp(idleZ, z, m));
                Feet[i].Pitch = pitch * m;
                Feet[i].Planted = Mathf.Lerp(1f, planted, m);
                footZ[i] = z;
            }

            // ---- pelvis --------------------------------------------------------------------------
            float stepPhase = Fract(Phase * 2f);
            float duty2 = duty * 2f;
            float bobRun;
            if (duty2 >= 1f) bobRun = 0f;
            else if (stepPhase < duty2) bobRun = -0.018f * Mathf.Sin(Mathf.PI * stepPhase / duty2);
            else bobRun = Mathf.Lerp(0.045f, 0.055f, sp) * Mathf.Sin(Mathf.PI * (stepPhase - duty2) / (1f - duty2));
            float bobWalk = 0.016f * Mathf.Cos(Tau * 2f * (Phase - duty / 2f));
            float bob = Mathf.Lerp(bobWalk, bobRun, r) * m;

            float legDiff = stanceLen > 0f ? Mathf.Clamp((footZ[0] - footZ[1]) / stanceLen, -1.2f, 1.2f) : 0f;
            float pelvisYaw = -Mathf.Lerp(0.09f, 0.14f, r) * legDiff * m;
            float stanceSide = Mathf.Cos(Tau * (Phase - duty / 2f));
            float pelvisRoll = 0.045f * (1f - 0.6f * r) * stanceSide * m + 0.03f * shift;
            float accelLean = Mathf.Clamp(accel * 0.018f, -0.2f, 0.24f);
            float lean = (Mathf.Lerp(0.04f, 0.22f, r) + 0.12f * sp) * m + accelLean;
            float bank = Mathf.Clamp(v * yawRate / 9.81f, -0.4f, 0.4f) * 0.75f;

            int P = (int)B.Pelvis;
            float px = 0.022f * (1f - r) * stanceSide * m + 0.018f * shift + Mathf.Sin(bank) * 0.55f;
            float pz = 0.02f * accelLean;
            float py = SuitRig.Joints[P].y - Mathf.Lerp(0.012f, Mathf.Lerp(0.022f, 0.018f, r), m) - 0.012f * sp + bob +
                       0.0025f * breath * breathAmp * idle;
            py -= (1f - Mathf.Cos(bank)) * 0.5f;
            Quaternion pelvisQ = EulerYXZ(lean * 0.4f, pelvisYaw, pelvisRoll - bank);
            Vector3 pelvisPos = new Vector3(px, py, pz);

            // Feet: ankle positions and boot orientations in model space.
            for (int i = 0; i < 2; i++)
            {
                float side = i == 0 ? 1f : -1f;
                var f = Feet[i];
                float fy = side * Mathf.Lerp(0.1f, 0.02f, m);
                footQ[i] = Ay(fy) * Ax(f.Pitch);
                // Pivot on the toe (toes down) or the heel (toes up) so the boot never cuts the ground.
                float pivotZ = f.Pitch >= 0f ? SuitRig.ToeZ - 0.012f : SuitRig.HeelZ + 0.006f;
                Vector3 pivot = Ay(fy) * new Vector3(0f, 0f, pivotZ) + f.Anchor; // pivot on the ground
                ankles[i] = pivot + footQ[i] * new Vector3(0f, SuitRig.AnkleY, -pivotZ);
            }

            // Keep the planted feet reachable: lower the pelvis if needed.
            float legMax = (SuitRig.Thigh + SuitRig.Shin) * 0.995f;
            for (int i = 0; i < 2; i++)
            {
                float weight = Feet[i].Planted;
                if (weight < 0.01f) continue;
                Vector3 hipOff = pelvisQ * new Vector3(i == 0 ? SuitRig.HipX : -SuitRig.HipX, SuitRig.HipY - SuitRig.Joints[P].y, 0f);
                float hx = pelvisPos.x + hipOff.x - ankles[i].x;
                float hz = pelvisPos.z + hipOff.z - ankles[i].z;
                float h2 = legMax * legMax - hx * hx - hz * hz;
                float limit = ankles[i].y + Mathf.Sqrt(Mathf.Max(h2, 0.01f)) - hipOff.y;
                if (pelvisPos.y > limit) pelvisPos.y = Mathf.Lerp(pelvisPos.y, limit, weight);
            }
            // Track vertical acceleration for secondary motion.
            if (dt > 0f)
            {
                float vy = (pelvisPos.y - pelvisY) / dt;
                float ay = Mathf.Clamp((vy - pelvisVY) / dt, -60f, 60f);
                vertAccel = Damp(vertAccel, ay, 18f, dt);
                pelvisVY = vy;
            }
            pelvisY = pelvisPos.y;
            pose.LocalPos[P] = pelvisPos;
            pose.LocalRot[P] = pelvisQ;

            // Leg IK.
            for (int i = 0; i < 2; i++)
            {
                float side = i == 0 ? 1f : -1f;
                int thigh = i == 0 ? (int)B.ThighL : (int)B.ThighR;
                Vector3 hip = pelvisPos + pelvisQ * pose.LocalPos[thigh];
                float fy = side * Mathf.Lerp(0.1f, 0.02f, m);
                Vector3 pole = (Ay(fy * 0.5f) * new Vector3(side * 0.12f, 0.05f, 1f)).normalized;
                SolveTwoBone(hip, ankles[i], pole, SuitRig.Thigh, SuitRig.Shin, out Quaternion q1, out Quaternion q2);
                // Model space -> local.
                pose.LocalRot[thigh] = Quaternion.Inverse(pelvisQ) * q1;
                pose.LocalRot[thigh + 1] = Quaternion.Inverse(q1) * q2;
                pose.LocalRot[thigh + 2] = Quaternion.Inverse(q2) * footQ[i];
            }

            // ---- spine, head ---------------------------------------------------------------------
            float breathe = breath * breathAmp;
            float runBob = bob / 0.07f * r * m;
            pose.LocalRot[(int)B.Spine] = EulerYXZ(lean * 0.3f - 0.004f * breathe + 0.02f * runBob, -pelvisYaw * 0.55f, -pelvisRoll * 0.55f + bank * 0.15f);
            pose.LocalRot[(int)B.Chest] = EulerYXZ(lean * 0.3f - 0.012f * breathe - 0.025f * runBob + 0.08f * g, -pelvisYaw * 0.8f + 0.12f * g,
                -pelvisRoll * 0.3f + bank * 0.2f);
            float bodyPitch = lean + 0.08f * g;
            float bodyYaw = pelvisYaw * (1f - 0.55f - 0.8f) + 0.12f * g;
            float headPitch = lookPitch - bodyPitch * 0.6f;
            float headYaw = lookYaw - bodyYaw;
            float headRoll = bank * 0.35f - pelvisRoll * 0.2f;
            pose.LocalRot[(int)B.Neck] = EulerYXZ(headPitch * 0.4f, headYaw * 0.4f, headRoll * 0.4f);
            pose.LocalRot[(int)B.Head] = EulerYXZ(headPitch * 0.6f, headYaw * 0.6f, headRoll * 0.6f);

            // ---- arms ----------------------------------------------------------------------------
            float armAmp = m * (Mathf.Lerp(0.3f, 0.62f, r) + 0.26f * sp);
            float elbowBase = Mathf.Lerp(0.3f, Mathf.Lerp(0.42f, 0.95f, r) + 0.35f * sp, m);
            for (int i = 0; i < 2; i++)
            {
                float side = i == 0 ? 1f : -1f;
                int clav = i == 0 ? (int)B.ClavL : (int)B.ClavR;
                // Arm swings opposite the leg on the same side, lagging slightly.
                float fwd = -Mathf.Cos(Tau * (Fract(Phase + i * 0.5f) - 0.04f));
                float swing = armAmp * fwd + 0.06f * r * m;
                float idleSway = 0.02f * Mathf.Sin(t * Tau * 0.21f + i * 1.7f) * idle + 0.01f * breathe * idle;
                float gest = i == 0 ? g : 0f;
                float abd = 0.17f + 0.04f * r + 0.012f * breathe * idle - 0.02f * shift * side;
                // Upper arm: twist about its own axis first, then abduct, then swing (XZY).
                pose.LocalRot[clav + 1] = EulerXZY(
                    Mathf.Lerp(-swing - idleSway - 0.05f, -0.62f, gest),
                    -side * Mathf.Lerp(0.15f + 0.25f * r * m, 0.95f, gest),
                    side * Mathf.Lerp(abd, 0.42f, gest));
                float elbow = elbowBase + Mathf.Lerp(0.12f, 0.45f, r) * Mathf.Max(0f, fwd) * m;
                pose.LocalRot[clav + 2] = EulerXYZ(-Mathf.Lerp(elbow, 1.95f, gest), -side * Mathf.Lerp(0.2f, -0.9f, gest), 0f);
                pose.LocalRot[clav + 3] = EulerXYZ(Mathf.Lerp(-0.08f - 0.12f * r * m, 0.15f, gest), 0f, side * Mathf.Lerp(0.06f, 0f, gest));
                pose.LocalRot[clav] = EulerXYZ(0f, 0f, side * (0.01f * breathe * (0.6f + idle) + 0.03f * r * m * Mathf.Max(0f, fwd)));
            }

            // ---- secondary motion ----------------------------------------------------------------
            if (dt > 0f)
            {
                float latAcc = v * yawRate;
                StepSpring(ref packPitch, Mathf.Clamp(-accel * 0.0012f + vertAccel * 0.0009f, -0.04f, 0.04f), 22f, 0.45f, dt);
                StepSpring(ref packRoll, Mathf.Clamp(latAcc * 0.0015f, -0.03f, 0.03f), 22f, 0.45f, dt);
                StepSpring(ref antennaPitch, Mathf.Clamp(-accel * 0.012f + vertAccel * 0.01f - v * 0.02f, -0.5f, 0.5f), 10f, 0.14f, dt);
                StepSpring(ref antennaRoll, Mathf.Clamp(latAcc * 0.02f, -0.45f, 0.45f), 10f, 0.14f, dt);
            }
            pose.LocalRot[(int)B.Pack] = EulerXYZ(packPitch.X, 0f, packRoll.X);
            pose.LocalRot[(int)B.Antenna] = EulerXYZ(Mathf.Clamp(antennaPitch.X, -0.6f, 0.6f), 0f, Mathf.Clamp(antennaRoll.X, -0.6f, 0.6f));
        }

        /// <summary>Two floats indexed 0..1 (avoids a per-frame array allocation).</summary>
        private struct Span2
        {
            private float a, b;

            public float this[int i]
            {
                get => i == 0 ? a : b;
                set
                {
                    if (i == 0) a = value;
                    else b = value;
                }
            }
        }

        /// <summary>
        /// Two-bone IK in the plane of the pole vector. Gives model-space rotations for the upper and
        /// lower bone (bind pose: bones point down -Y, knee/elbow front is +Z).
        /// </summary>
        public static void SolveTwoBone(Vector3 hip, Vector3 target, Vector3 pole, float a, float b, out Quaternion upper, out Quaternion lower)
        {
            Vector3 d = target - hip;
            float dist = d.magnitude;
            if (dist < 1e-5f)
            {
                d = Vector3.down;
                dist = 1e-5f;
            }
            Vector3 u = d / dist;
            dist = Mathf.Clamp(dist, Mathf.Abs(a - b) + 1e-3f, (a + b) * 0.9999f);
            // In-plane direction toward the pole, perpendicular to the hip->target line.
            Vector3 w = pole - u * Vector3.Dot(pole, u);
            if (w.sqrMagnitude < 1e-8f) w = new Vector3(0f, 0f, 1f) - u * u.z;
            w.Normalize();
            float cosA = Mathf.Clamp((a * a + dist * dist - b * b) / (2f * a * dist), -1f, 1f);
            float sinA = Mathf.Sqrt(1f - cosA * cosA);
            Vector3 knee = hip + u * (a * cosA) + w * (a * sinA);
            Vector3 end = hip + u * dist;
            upper = BasisQuat(knee, hip, w);
            lower = BasisQuat(end, knee, w);
        }

        /// <summary>Rotation whose +Y points from <paramref name="from"/> to <paramref name="to"/> and whose +Z leans toward <paramref name="front"/>.</summary>
        private static Quaternion BasisQuat(Vector3 from, Vector3 to, Vector3 front)
        {
            Vector3 y = (to - from).normalized;
            Vector3 z = front - y * Vector3.Dot(front, y);
            if (z.sqrMagnitude < 1e-8f) z = new Vector3(0f, 0f, 1f) - y * y.z;
            z.Normalize();
            return Quaternion.LookRotation(z, y);
        }
    }
}
