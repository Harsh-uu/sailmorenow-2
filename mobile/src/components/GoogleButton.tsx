import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { useTheme } from "@/src/theme";

/**
 * "Continue with Google" button. In light mode it keeps the existing ghost
 * look (navy text, transparent bg). In dark mode it flips to a light, off-white
 * card tone with dark text + a visible border so it stays high-contrast and
 * legible on the dark surface (the plain ghost variant rendered dark navy text
 * on a dark background — effectively invisible).
 */
export function GoogleButton({
  onPress,
  loading,
  testID,
}: {
  onPress?: () => void;
  loading?: boolean;
  testID?: string;
}) {
  const { colors, scheme } = useTheme();
  const dark = scheme === "dark";
  const bg = dark ? colors.surfaceInverse : "transparent";
  const fg = dark ? colors.onSurfaceInverse : colors.brandPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: colors.borderStrong, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          <Icon name="logo-google" size={18} color={fg} footprint={18} />
          <Text style={[styles.text, { color: fg }]}>Continue with Google</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 50, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, borderWidth: 1.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { fontWeight: "700", fontSize: 16 },
});
