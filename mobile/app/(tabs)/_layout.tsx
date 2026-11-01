import { Tabs, Redirect, router } from "expo-router";
import { Icon } from "@/src/components/Icon";

import { useAuth } from "@/src/context/AuthContext";
import { Loading } from "@/src/components/ui";
import { useTheme } from "@/src/theme";
import { View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VerifyBanner, VerifyLockedScreen } from "@/src/components/VerifyGate";

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.navy }}>
        <Loading />
      </View>
    );
  }
  if (!user) return <Redirect href="/" />;
  if (!user.onboarding_complete) return <Redirect href="/onboarding" />;
  if ((user as any).verification?.locked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <VerifyLockedScreen />
      </View>
    );
  }

  // Bottom nav 3rd slot is now always the Pros/Orgs directory for every role.
  // Role-specific destinations moved off the bar:
  //   • Boat Pro "My Listing"  -> Profile (+ directory page entry)
  //   • Sailor  "Crew Bank"    -> Hub
  //   • Org     "My Events"    -> Profile + top of the Events flow
  const role3 = "directory";
  const href = (name: string) => (name === role3 ? undefined : null);

  // Tab bar height = a fixed base (icon + single-line label) PLUS the device's
  // bottom safe-area inset, so on Android (edge-to-edge: 3-button or gesture
  // nav) the labels are never pushed under the system navigation bar. The total
  // is never hard-coded. iPhone keeps the same icon-over-label look.
  const TAB_BASE = 52;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <VerifyBanner />
      <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: TAB_BASE + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
        },
        // Give each label the full slot width (no item padding) so all five fit.
        tabBarItemStyle: { paddingHorizontal: 0 },
        // One line, no shortening: cap system font scaling AND auto-shrink to fit
        // so even at Android "Display size: Large" the long labels ("Pros/Orgs",
        // "Messages") stay on one line inside their slot.
        tabBarLabel: ({ color, children }) => (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={1.15}
            style={{ fontSize: 11, lineHeight: 14, fontWeight: "600", color, textAlign: "center", width: "100%", paddingHorizontal: 1 }}
          >
            {children}
          </Text>
        ),
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{ title: "Hub", popToTopOnBlur: true, tabBarButtonTestID: "feed-tab", tabBarIcon: ({ color, size }) => <Icon name="hub" size={size} color={color} footprint={size} /> }}
      />
      <Tabs.Screen
        name="events"
        options={{ title: "Events", popToTopOnBlur: true, tabBarButtonTestID: "events-tab", tabBarIcon: ({ color, size }) => <Icon name="events" size={size} color={color} footprint={size} /> }}
      />
      {/* Role-aware 3rd slot — only one of these is shown via href. */}
      <Tabs.Screen
        name="crew"
        options={{ href: href("crew"), title: "Crew Bank", popToTopOnBlur: true, tabBarButtonTestID: "crew-tab", tabBarIcon: ({ color, size }) => <Icon name="crew" size={size} color={color} footprint={size} /> }}
      />
      <Tabs.Screen
        name="directory"
        options={{ href: href("directory"), title: "Pros/Orgs", popToTopOnBlur: true, tabBarButtonTestID: "directory-tab", tabBarIcon: ({ color, size }) => <Icon name="directory" size={size} color={color} footprint={size} /> }}
      />
      <Tabs.Screen
        name="my-listing"
        options={{ href: href("my-listing"), title: "My Listing", popToTopOnBlur: true, tabBarButtonTestID: "my-listing-tab", tabBarIcon: ({ color, size }) => <Icon name="myListing" size={size} color={color} footprint={size} /> }}
      />
      <Tabs.Screen
        name="my-events"
        options={{ href: href("my-events"), title: "My Events", popToTopOnBlur: true, tabBarButtonTestID: "my-events-tab", tabBarIcon: ({ color, size }) => <Icon name="myEvents" size={size} color={color} footprint={size} /> }}
      />
      {/* Following is reachable via the Hub/Events banners, not a tab (keeps the bar short). */}
      <Tabs.Screen name="following" options={{ href: null }} />
      <Tabs.Screen
        name="messages"
        options={{ title: "Messages", popToTopOnBlur: true, tabBarButtonTestID: "messages-tab", tabBarIcon: ({ color, size }) => <Icon name="messages" size={size} color={color} footprint={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", popToTopOnBlur: true, tabBarButtonTestID: "profile-tab", tabBarIcon: ({ color, size }) => <Icon name="profile" size={size} color={color} footprint={size} /> }}
        listeners={{
          // Tapping the Profile tab ALWAYS lands on the Profile menu, from any
          // depth (including while already inside the tab on Reviews). The
          // default focused-tab pop only reaches the root if it is in the stack;
          // this navigate guarantees the menu regardless.
          tabPress: (e) => {
            e.preventDefault();
            router.navigate("/profile");
          },
        }}
      />
    </Tabs>
      </View>
      {/* Paint the Android system-nav (3-button / gesture) strip with the tab
          bar's own surface colour so the deep-navy app background never shows
          through behind the buttons. Sits below the tab bar content, so labels
          are unaffected. */}
      {insets.bottom > 0 ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: insets.bottom, backgroundColor: colors.surface }} />
      ) : null}
    </View>
  );
}
