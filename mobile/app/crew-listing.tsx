import { useEffect, useState } from "react";
import { DeviceEventEmitter, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { ButtonRow, Loading } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { displayPosition, normalizePositions } from "@/src/lib/crewPositions";
import { api, ApiError } from "@/src/lib/api";
import { CONTENT_CHANGED } from "@/src/lib/events";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Full-screen Crew Bank listing form (was a trapping MotionModal). Same fields,
// labels, order, validation and server call; the text fields scroll above the
// keyboard via useKbField. Saving returns to Crew Bank, which reloads on focus.
export default function CrewListingScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [positionsList, setPositionsList] = useState<string[]>([]);
  const [expTypesList, setExpTypesList] = useState<string[]>([]);
  const [styleAxes, setStyleAxes] = useState<any[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [existing, setExisting] = useState<any>(null);

  const [positions, setPositions] = useState<string[]>([]);
  const [expTypes, setExpTypes] = useState<string[]>([]);
  const [style, setStyle] = useState<Record<string, number>>({});
  const [mkts, setMkts] = useState<string[]>([]);
  const [experience, setExperience] = useState("");
  const [availability, setAvailability] = useState("");
  const [notes, setNotes] = useState("");
  const [contactVia, setContactVia] = useState("in-app");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expKb = useKbField("crew-experience");
  const availKb = useKbField("crew-availability");
  const notesKb = useKbField("crew-notes");

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ markets: string[]; experience_types?: string[]; sailing_style_axes?: any[] }>("/markets").catch(() => ({ markets: [] } as any)),
      api.get<{ positions: string[] }>("/crew-positions").catch(() => ({ positions: [] })),
      api.get<any>("/crew-bank/standalone/mine").catch(() => null),
    ]).then(([mk, pos, m]) => {
      if (!alive) return;
      setMarkets(mk.markets || []);
      setExpTypesList(mk.experience_types || []);
      setStyleAxes(mk.sailing_style_axes || []);
      setPositionsList(pos.positions || []);
      const mine = m?.entry || m;
      const ex = mine && mine.user_id ? mine : null;
      setExisting(ex);
      const defaultStyle = (user as any)?.sailing_style || null;
      const defaultMarket = user?.primary_market || null;
      setPositions(normalizePositions(ex?.positions, pos.positions || []));
      setExpTypes(ex?.experience_types || []);
      setStyle(ex?.sailing_style || defaultStyle || {});
      setMkts(ex?.markets || (defaultMarket ? [defaultMarket] : []));
      setExperience(ex?.experience || "");
      setAvailability(ex?.availability || "");
      setNotes(ex?.notes || "");
      setContactVia(ex?.contact_via || "in-app");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    if (positions.length === 0) { setError("Pick at least one position"); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/crew-bank/standalone", {
        positions: normalizePositions(positions, positionsList), markets: mkts, experience: experience.trim() || null,
        availability: availability.trim() || null,
        notes: notes.trim() || null, contact_via: contactVia,
        experience_types: expTypes,
        sailing_style: Object.keys(style).length ? style : null,
      });
      toast.success("Saved to the Crew Bank");
      // Crew Bank list already refetches on focus; emit the shared signal too so
      // any mounted list stays consistent with the rest of the app.
      DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "crew", action: existing ? "edit" : "create" });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save listing");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <KeyboardFormScreen
      title={existing ? "Edit crew listing" : "List yourself as crew"}
      testID="crew-listing-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={[
            { title: "Cancel", variant: "ghost", testID: "crew-cancel-btn", onPress: () => router.back() },
            { title: existing ? "Save changes" : "Publish listing", loading: saving, weight: 1.6, testID: "save-listing-btn", onPress: submit },
          ]}
        />
      }
    >
      <Text style={{ color: colors.muted, marginBottom: 16 }}>Skippers browsing the Crew Bank can find and message you.</Text>

      <Text style={[styles.lbl, { color: colors.onSurface }]}>Positions</Text>
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        <MultiSelectPicker
          label="Positions"
          title="Select positions"
          testID="crew-positions-picker"
          searchable={false}
          options={positionsList.map((p) => ({ value: p, label: p }))}
          value={positions}
          onChange={setPositions}
          placeholder="Select positions"
          valueLabel={positions.length ? positions.map(displayPosition).join(", ") : undefined}
          accessibilityLabel={`Positions: ${positions.length ? positions.map(displayPosition).join(", ") : "none selected"}`}
        />
      </View>

      <Text style={[styles.lbl, { color: colors.onSurface, marginTop: 16 }]}>Markets</Text>
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        <MultiSelectPicker
          label="Markets"
          title="Select markets"
          testID="crew-markets-picker"
          searchable={false}
          options={markets.map((m) => ({ value: m, label: m }))}
          value={mkts}
          onChange={setMkts}
          placeholder="Select markets"
          valueLabel={mkts.length ? mkts.join(", ") : undefined}
        />
      </View>

      <Text style={[styles.lbl, { color: colors.onSurface, marginTop: 16 }]}>Type of sailing experience</Text>
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        <MultiSelectPicker
          label="Experience types"
          title="Select experience types"
          testID="crew-exp-picker"
          searchable={false}
          options={(expTypesList || []).map((t) => ({ value: t, label: t }))}
          value={expTypes}
          onChange={setExpTypes}
          placeholder="Select experience types"
          valueLabel={expTypes.length ? expTypes.join(", ") : undefined}
          accessibilityLabel={`Experience types: ${expTypes.length ? expTypes.join(", ") : "none selected"}`}
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 2 }}>
        <Text style={[styles.lbl, { color: colors.onSurface, marginBottom: 0 }]}>Sailing style (optional)</Text>
        {Object.keys(style).length > 0 ? (
          <Pressable testID="crew-style-clear" onPress={() => setStyle({})} hitSlop={8}>
            <Text style={{ color: colors.teal, fontSize: 13, fontWeight: "700" }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 10 }}>Tap a dot (1 to 5) to place yourself between each pair.</Text>
      {(styleAxes || []).map((ax: any) => (
        <View key={ax.key} style={{ marginBottom: 14 }} testID={`style-axis-${ax.key}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 11.5, flex: 1 }}>{ax.low}</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 11.5, flex: 1, textAlign: "right" }}>{ax.high}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = style[ax.key] === n;
              return (
                <Pressable key={n} testID={`style-${ax.key}-${n}`} onPress={() => setStyle((s) => ({ ...s, [ax.key]: n }))}
                  style={{ flex: 1, height: 34, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
                           borderColor: on ? colors.teal : colors.border, backgroundColor: on ? colors.teal : "transparent" }}>
                  <Text style={{ color: on ? colors.onBrandSecondary : colors.onSurfaceSecondary, fontWeight: "800", fontSize: 13 }}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View onLayout={expKb.onLayout}>
        <Text style={[styles.lbl, { color: colors.onSurface, marginTop: 16 }]}>Experience</Text>
        <TextInput testID="crew-experience-input" value={experience} onFocus={expKb.onFocus} onChangeText={setExperience} placeholder="e.g. 5 seasons foredeck on J/24s" placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surface }]} />
      </View>

      <View onLayout={availKb.onLayout}>
        <Text style={[styles.lbl, { color: colors.onSurface, marginTop: 16 }]}>Availability (optional)</Text>
        <TextInput testID="crew-availability-input" value={availability} onFocus={availKb.onFocus} onChangeText={setAvailability} placeholder="e.g. Weeknights & weekends" placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surface }]} />
      </View>

      <View onLayout={notesKb.onLayout}>
        <Text style={[styles.lbl, { color: colors.onSurface, marginTop: 12 }]}>About you (optional)</Text>
        <TextInput testID="crew-notes-input" value={notes} onFocus={notesKb.onFocus} onChangeText={setNotes} placeholder="Experience, certifications, what you're looking for..." placeholderTextColor={colors.muted}
          multiline style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 90, textAlignVertical: "top" }]} />
      </View>

      <Text style={[styles.lbl, { color: colors.onSurface, marginTop: 16 }]}>How can skippers reach you?</Text>
      <View style={{ gap: 8 }}>
        {[{ v: "in-app", l: "In-app DM only" }, { v: "email", l: "Share my email with skippers" }].map((o) => {
          const on = contactVia === o.v;
          return (
            <Pressable key={o.v} testID={`crew-contact-${o.v}`} onPress={() => setContactVia(o.v)}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Icon name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.teal : colors.muted} footprint={20} />
              <Text style={{ color: colors.onSurface, fontSize: 14 }}>{o.l}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text testID="crew-form-error" style={{ color: colors.error, marginTop: 12 }}>{error}</Text> : null}
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  lbl: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15 },
});
