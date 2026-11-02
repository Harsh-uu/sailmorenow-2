import Constants from "expo-constants";

/**
 * MOBILE-KB-4 build stamp. BUMP BUILD_ID + BUILD_TIME every time you hand Jenn a
 * new build so she can confirm on her phone which bundle she is running. Shown
 * in two places: the green KB debug strip (behind KB_DEBUG) and a small line at
 * the end of the Profile screen (testID "profile-build-stamp") that must be
 * REMOVED before launch.
 */
export const BUILD_ID = "rv3a-22";
export const BUILD_TIME = "2026-11-02 UTC";
export const APP_VERSION = Constants.expoConfig?.version ?? "?";
export const BUILD_STAMP = `build ${BUILD_ID} \u00b7 ${BUILD_TIME} \u00b7 v${APP_VERSION}`;
