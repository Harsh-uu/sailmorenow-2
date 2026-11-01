import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Icon } from "@/src/components/Icon";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { Button, Loading } from "@/src/components/ui";
import { api, LOGO_ROUND } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

const SUBJECTS = ["Billing", "Bug", "Feedback", "Other"];

function HelpContactForm() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const kbName = useKbField("faq-name");
  const kbEmail = useKbField("faq-email");
  const kbSubject = useKbField("faq-subject");
  const kbMessage = useKbField("faq-message");

  const submit = async () => {
    if (busy) return;
    if (!user && (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))) { toast.warning("Please add your name and a valid email"); return; }
    if (user && !subject.trim()) { toast.warning("Please add a subject"); return; }
    if (message.trim().length < 10) { toast.warning("Please add a message of at least 10 characters"); return; }
    setBusy(true);
    try {
      if (user) await api.post("/support/contact", { subject: subject.trim(), message: message.trim() });
      else await api.post("/contact", { name: name.trim(), email: email.trim(), message: subject.trim() ? `[${subject.trim()}] ${message.trim()}` : message.trim() });
      setSent(true); setSubject(""); setMessage("");
    } catch (e: any) { toast.error(e?.message || "Couldn't send your message. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ marginTop: 28 }}>
      <Text style={{ color: colors.onSurface, fontSize: 17, fontWeight: "800", marginBottom: 12, textAlign: "center" }}>Still stuck? Send us a message</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 14 }]}>
        {sent ? (
          <View testID="help-contact-sent" style={{ alignItems: "center", paddingVertical: 10 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Icon name="checkmark-circle" size={26} color={colors.teal} footprint={26} />
            </View>
            <Text style={{ color: colors.onSurface, fontSize: 14.5, textAlign: "center", lineHeight: 21, fontWeight: "600" }}>
              Thank you for contacting us. We will respond to your inquiry within 48 hours.
            </Text>
            <Pressable testID="help-send-another" onPress={() => setSent(false)} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.teal, fontWeight: "700", fontSize: 13.5 }}>Send another message</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {user ? (
              <Text style={{ color: colors.muted, fontSize: 12.5 }}>
                Sending as <Text style={{ fontWeight: "800", color: colors.onSurface }}>{user.name}</Text> ({user.email})
              </Text>
            ) : (
              <>
                <TextInput testID="help-name" value={name} onChangeText={setName} onFocus={kbName.onFocus} placeholder="Your name" placeholderTextColor={colors.muted}
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
                <TextInput testID="help-email" value={email} onChangeText={setEmail} onFocus={kbEmail.onFocus} placeholder="you@example.com" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address"
                  style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
              </>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {SUBJECTS.map((p) => (
                <Pressable key={p} testID={`help-preset-${p.toLowerCase()}`} onPress={() => setSubject(p)}
                  style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1,
                           backgroundColor: subject === p ? colors.brandPrimary : colors.surfaceSecondary,
                           borderColor: subject === p ? colors.brandPrimary : colors.border }}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: subject === p ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput testID="help-subject" value={subject} onChangeText={setSubject} onFocus={kbSubject.onFocus} placeholder="Subject" placeholderTextColor={colors.muted} maxLength={120}
              style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface }]} />
            <TextInput testID="help-message" value={message} onChangeText={setMessage} onFocus={kbMessage.onFocus} placeholder="How can we help? Share as much detail as you can…" placeholderTextColor={colors.muted} multiline maxLength={4000}
              style={[styles.supportInput, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.onSurface, minHeight: 96, textAlignVertical: "top" }]} />
            <Button title="Send message" icon="send" onPress={submit} loading={busy} testID="help-submit" />
          </View>
        )}
      </View>
    </View>
  );
}

type Faq = { id: string; category: string; category_order?: number; question: string; answer: string };

export default function FAQScreen() {
  const { colors } = useTheme();
  const [faqs, setFaqs] = useState<Faq[] | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Faq[]>("/faqs").then(setFaqs).catch(() => setFaqs([]));
  }, []);

  const grouped = useMemo(() => {
    if (!faqs) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? faqs.filter((f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))
      : faqs;
    const byCat = new Map<string, { category: string; order: number; items: Faq[] }>();
    filtered.forEach((f) => {
      if (!byCat.has(f.category)) byCat.set(f.category, { category: f.category, order: f.category_order ?? 99, items: [] });
      byCat.get(f.category)!.items.push(f);
    });
    return [...byCat.values()].sort((a, b) => a.order - b.order);
  }, [faqs, query]);

  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);

  return (
    <KeyboardFormScreen title="Help & FAQ" testID="faq-scroll">
        <Image source={{ uri: LOGO_ROUND }} style={{ width: 64, height: 64, alignSelf: "center", marginBottom: 14 }} contentFit="contain" testID="faq-logo" />
        <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Icon name="search" size={18} color={colors.muted} footprint={18} />
          <TextInput
            testID="faq-search"
            value={query}
            onChangeText={(t) => { setQuery(t); setOpenId(null); }}
            placeholder="Search help articles…"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, color: colors.onSurface, fontSize: 15, marginLeft: 8 }}
          />
        </View>

        {faqs === null ? (
          <Loading />
        ) : grouped.length === 0 ? (
          <Text testID="faq-empty" style={{ color: colors.muted, textAlign: "center", marginTop: 32 }}>
            No articles match &ldquo;{query}&rdquo;. Try another search.
          </Text>
        ) : (
          grouped.map((g) => (
            <View key={g.category} testID={`faq-category-${g.category}`} style={{ marginTop: 20 }}>
              <Text style={{ color: colors.teal, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 8 }}>{g.category.toUpperCase()}</Text>
              <View style={{ gap: 10 }}>
                {g.items.map((f) => {
                  const open = openId === f.id || !!query.trim();
                  return (
                    <View key={f.id} testID={`faq-item-${f.id}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Pressable testID={`faq-question-${f.id}`} onPress={() => toggle(f.id)} style={styles.qRow}>
                        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: 14.5, flex: 1 }}>{f.question}</Text>
                        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={open ? colors.teal : colors.muted} footprint={18} />
                      </Pressable>
                      {open ? (
                        <Text testID={`faq-answer-${f.id}`} style={{ color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 20, paddingHorizontal: 14, paddingBottom: 14 }}>{f.answer}</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}

        <HelpContactForm />
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, height: 46 },
  card: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  qRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 14 },
  supportInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5 },
});
