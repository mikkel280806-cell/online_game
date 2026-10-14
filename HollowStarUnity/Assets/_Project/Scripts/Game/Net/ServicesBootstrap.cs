using System;
using System.Threading.Tasks;
using Unity.Services.Authentication;
using Unity.Services.Core;
using UnityEngine;

namespace HollowStar.Game.Net
{
    /// <summary>
    /// Starts Unity Services and signs in anonymously, once per process. Rooms (sessions over Relay)
    /// need a signed-in player; solo play doesn't touch any of this.
    /// </summary>
    public static class ServicesBootstrap
    {
        private static Task signIn;
        private static string profile;

        /// <summary>
        /// Sign-in profile for this process: <c>-hs-profile</c>, else a random one. Two copies on one Mac
        /// share PlayerPrefs, so with the same profile they would sign in as the same player and the
        /// session service would refuse to let one join the other's room.
        /// </summary>
        public static string Profile => profile ??= string.IsNullOrEmpty(LaunchArgs.Profile)
            ? "p" + Guid.NewGuid().ToString("N").Substring(0, 12)
            : LaunchArgs.Profile;

        /// <summary>This player's id once signed in (the session service's name for them).</summary>
        public static string PlayerId => AuthenticationService.Instance.PlayerId;

        /// <summary>Initialise and sign in, or reuse the sign-in in progress. Retries after a failure.</summary>
        public static Task EnsureSignedInAsync()
        {
            if (signIn == null || signIn.IsFaulted || signIn.IsCanceled) signIn = SignInAsync();
            return signIn;
        }

        private static async Task SignInAsync()
        {
            if (UnityServices.State != ServicesInitializationState.Initialized)
                await UnityServices.InitializeAsync(new InitializationOptions().SetProfile(Profile));
            if (!AuthenticationService.Instance.IsSignedIn)
                await AuthenticationService.Instance.SignInAnonymouslyAsync();
            Debug.Log($"[HollowStar] Signed in as {AuthenticationService.Instance.PlayerId} (profile {Profile}).");
        }
    }
}
