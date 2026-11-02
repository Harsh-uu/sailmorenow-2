import { useCallback, useRef, useState } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { BottomBarKeyboardView } from "@/src/components/BottomBarKeyboardView";
import { useBottomBarPadding } from "@/src/lib/useBottomBarPadding";
import { Icon } from "@/src/components/Icon";
import { Screen } from "@/src/components/Screen";
import { Avatar, Button } from "@/src/components/ui";
import { api } from "@/src/lib/api";
import { handleUpgrade } from "@/src/lib/upgrade";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/context/ToastContext";

type Person = { user_id: string; name?: string; handle?: string; avatar?: string | null; picture?: string | null };

// Compose one-to-one by default. The recipient picker accepts one or more
// people; the group name field appears only when more than one is selected.
// Business identity is always one-to-one: when "Posting as" is the business the
// picker allows exactly one recipient and the group name field never shows.
export default function NewMessage() {
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const barPad = useBottomBarPadding();
  const canBusiness = user?.account_type === "boat_pro" && !!user?.can_use_business;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [identity, setIdentity] = useState<string>(user?.active_identity || "personal");
  const [bizLine, setBizLine] = useState(false);
  const timer = useRef<any>(null);

  const business = canBusiness && identity === "business";
  const isGroup = selected.length > 1;

  const search = useCallback((text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 1) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const d = await api.get<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(text.trim())}&limit=8`);
        setResults(d.users || []);
      } catch { setResults([]); }
    }, 250);
  }, []);

  const removeSel = (p: Person) => setSelected((prev) => prev.filter((x) => x.user_id !== p.user_id));
  const pick = (p: Person) => {
    setQ(""); setResults([]);
    setSelected((prev) => {
      if (prev.find((x) => x.user_id === p.user_id)) return prev.filter((x) => x.user_id !== p.user_id);
      if (business && prev.length >= 1) { setBizLine(true); return prev; }
      return [...prev, p];
    });
  };
  const changeIdentity = (next: string) => {
    setIdentity(next);
    if (next === "business") {
      setSelected((prev) => {
        if (prev.length > 1) { setBizLine(true); return prev.slice(0, 1); }
        setBizLine(false);
        return prev;
      });
    } else { setBizLine(false); }
  };

  const canSend = !sending && selected.length >= 1 && !!body.trim() && (!isGroup || !!title.trim());

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      if (selected.length === 1) {
        const p = selected[0];
        // Use the thread id the SERVER returns (keeps the "~b" business suffix).
        // Never recompute it on the client, or a business send opens the personal thread.
        const res = await api.post<{ thread_id: string }>(`/messages/${p.user_id}`, { body: body.trim(), identity, to_identity: "personal" });
        toast.success("Message sent");
        router.replace({ pathname: "/messages/[id]", params: { id: p.user_id, thread: res.thread_id, name: p.name || p.handle || "Sailor" } });
      } else {
        const res = await api.post<{ thread_id: string; title?: string; locked_members?: string[] }>("/messages/group", {
          participant_ids: selected.map((p) => p.user_id),
          title: title.trim(),
          body: body.trim(),
          identity: "personal",
        });
        const name = res.title || selected.map((p) => p.name?.split(" ")[0]).filter(Boolean).slice(0, 3).join(", ");
        toast.success("Group chat started");
        if (res.locked_members?.length) toast.info(`On a free plan - won't receive this until they upgrade: ${res.locked_members.join(", ")}.`);
        router.replace({ pathname: "/messages/[id]", params: { id: res.thread_id, name, group: "1" } });
      }
    } catch (e: any) {
      if (!handleUpgrade(e, toast)) toast.error(e?.message || "Couldn't send the message");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen title="New message" showBack padded={false}>
      <BottomBarKeyboardView>
        <Animated.View style={{ padding: 16, paddingBottom: barPad, gap: 12, flex: 1 }}>

          {canBusiness ? (
            <View testID="compose-posting-as" style={{ gap: 6 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>Posting as</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[{ id: "personal", label: "You" }, { id: "business", label: user?.business_name || "Your business" }].map((c) => {
                  const on = identity === c.id;
                  return (
                    <Pressable key={c.id} testID={`compose-posting-as-${c.id}`} onPress={() => changeIdentity(c.id)}
                      style={{ flexDirection: "row", alignItems: "center", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
                               backgroundColor: on ? colors.brandPrimary : colors.surface, borderWidth: 1, borderColor: on ? colors.brandPrimary : colors.border }}>
                      <Text numberOfLines={1} style={{ color: on ? colors.onBrandPrimary : colors.onSurface, fontWeight: "700", fontSize: 13, maxWidth: 140 }}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {selected.length > 0 ? (
            <View style={styles.chips}>
              {selected.map((p) => (
                <Pressable key={p.user_id} testID={`compose-selected-${p.user_id}`} onPress={() => removeSel(p)} style={[styles.chip, { backgroundColor: colors.tealSoft }]}>
                  <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 13 }}>{p.name?.split(" ")[0] || p.handle}</Text>
                  <Icon name="close" size={14} color={colors.teal} footprint={14} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {bizLine ? (
            <Text testID="compose-business-line" style={{ color: colors.onSurface, fontSize: 12.5, fontWeight: "600", backgroundColor: colors.tealSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
              Business messages are one-to-one. Switch to You to start a group.
            </Text>
          ) : null}

          <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="search" size={18} color={colors.muted} footprint={18} />
            <TextInput
              testID="compose-search-input"
              value={q}
              onChangeText={search}
              placeholder="Search people by name or @username"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={{ flex: 1, color: colors.onSurface, fontSize: 15 }}
            />
          </View>

          <FlatList
            data={results}
            keyExtractor={(p) => p.user_id}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = !!selected.find((x) => x.user_id === item.user_id);
              return (
                <Pressable testID={`compose-result-${item.user_id}`} onPress={() => pick(item)} style={[styles.result, { borderColor: colors.border }]}>
                  <Avatar uri={item.avatar || item.picture} name={item.name} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurface, fontWeight: "700" }} numberOfLines={1}>{item.name || item.handle}</Text>
                    {item.handle ? <Text style={{ color: colors.muted, fontSize: 12.5 }}>@{item.handle}</Text> : null}
                  </View>
                  <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.teal : colors.muted} footprint={22} />
                </Pressable>
              );
            }}
            ListEmptyComponent={q.trim() ? <Text style={{ color: colors.muted, textAlign: "center", paddingVertical: 20 }}>No matches</Text> : null}
          />

          {isGroup && !business ? (
            <TextInput
              testID="group-title-input"
              value={title}
              onChangeText={setTitle}
              placeholder="Group name"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.onSurface }]}
            />
          ) : null}

          <TextInput
            testID="compose-message-input"
            value={body}
            onChangeText={setBody}
            placeholder="Write a message…"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.onSurface, minHeight: 60 }]}
          />
          <Button title="Send" icon="send" onPress={submit} loading={sending} disabled={!canSend} testID="compose-send-btn" />
        </Animated.View>
      </BottomBarKeyboardView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 46 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  result: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
