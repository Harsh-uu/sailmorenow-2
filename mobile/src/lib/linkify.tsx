import React from "react";
import { Text, TextStyle, StyleProp } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";

// Renders text with @mentions, emails and web URLs. Only http(s)/mailto become
// tappable (no javascript:/data:). Web links open in the in-app browser.
const TOKEN_RE =
  /((?:https?:\/\/|www\.)[^\s]+[^\s.,:;"')\]}]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|@[A-Za-z0-9_]{3,20})/g;

export function LinkifiedText({
  text,
  style,
  linkColor = "#2A7871",
  mentionColor = "#0284c7",
  numberOfLines,
}: {
  text?: string | null;
  style?: StyleProp<TextStyle>;
  linkColor?: string;
  mentionColor?: string;
  numberOfLines?: number;
}) {
  if (!text) return null;
  const parts = String(text).split(TOKEN_RE);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) => {
        if (!p) return null;
        if (/^@[A-Za-z0-9_]{3,20}$/.test(p)) {
          return <Text key={i} style={{ color: mentionColor, fontWeight: "700" }}>{p}</Text>;
        }
        if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p)) {
          return <Text key={i} style={{ color: linkColor, textDecorationLine: "underline" }} onPress={() => Linking.openURL(`mailto:${p}`)}>{p}</Text>;
        }
        if (/^(https?:\/\/|www\.)/i.test(p)) {
          const href = /^www\./i.test(p) ? `https://${p}` : p;
          return <Text key={i} style={{ color: linkColor, textDecorationLine: "underline" }} onPress={() => WebBrowser.openBrowserAsync(href).catch(() => {})}>{p}</Text>;
        }
        return <Text key={i}>{p}</Text>;
      })}
    </Text>
  );
}

export default LinkifiedText;
