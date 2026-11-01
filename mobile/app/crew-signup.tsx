import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/src/components/Icon";
import { ButtonRow, Loading } from "@/src/components/ui";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { displayPosition, normalizePositions } from "@/src/lib/crewPositions";
import { api, ApiError } from "@/src/lib/api";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Full-screen crew-signup composer (was a trapping Modal in EventDetailScreen).
// Same fields, labels, validation and server calls; returns to the event on
// save or leave. EventDetailScreen reloads its crew data on focus.
export default function CrewSignupScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string; title?: string }>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [positionsList, setPositionsList] = useState<string[]>([]);
  const [expTypesList, setExpTypesList] = useState<string[]>([]);
  const [styleAxes, setStyleAxes] = useState<any[]>([]);
  const [form, setForm] = useState<{ positions: string[]; experienceTypes: string[]; sailingStyle: Record<string, number>; experience: string; availability: string; notes: string; contactVia: string }>(
    { positions: [], experienceTypes: [], sailingStyle: {}, experience: "", availability: "", notes: "", contactVia: "in-app" },
  );
  const experienceKb = useKbField("crew-experience");
  const availabilityKb = useKbField("crew-availability");
  const notesKb = useKbField("crew-notes");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [crewData, markets, posData] = await Promise.all([
          api.get<any>(`/events/${id}/crew`).catch(() => null),
          api.get<{ experience_types?: string[]; sailing_style_axes?: any[] }>("/markets").catch(() => null),
          api.get<{ positions: string[] }>("/crew-positions").catch(() => ({ positions: [] })),
        ]);
        if (!active) return;
        const posList = posData?.positions || [];
        setPositionsList(posList);
        setExpTypesList(markets?.experience_types || []);
        setStyleAxes(markets?.sailing_style_axes || []);
        const mine = crewData?.mine || null;
        if (mine) {
          setIsEdit(true);
          setForm({
            positions: normalizePositions(mine.positions, posList),
            experienceTypes: mine.experience_types || [],
            sailingStyle: mine.sailing_style || {},
            experience: mine.experience || "",
            availability: mine.availability || "",
            notes: mine.notes || "",
            contactVia: mine.contact_via || "in-app",
          });
        } else {
          let sa: any = null;
          try { sa = (await api.get<any>("/crew-bank/standalone/mine"))?.entry; } catch { /* none */ }
          if (!active) return;
          setForm({
            positions: normalizePositions(sa?.positions, posList),
            experienceTypes: sa?.experience_types || [],
            sailingStyle: sa?.sailing_style || {},
            experience: sa?.experience || "",
            availability: sa?.availability || "",
            notes: sa?.notes || "",
            contactVia: sa?.contact_via || "in-app",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  const saveCrew = async () => {
    if (!id) return;
    if (form.positions.length === 0) { toast.error("Pick at least one position"); return; }
    setBusy(true);
    try {
      await api.post(`/events/${id}/crew`, {
        positions: normalizePositions(form.positions, positionsList),
        experience: form.experience.trim() || undefined,
        availability: form.availability.trim() || undefined,
        experience_types: form.experienceTypes,
        sailing_style: Object.keys(form.sailingStyle).length ? form.sailingStyle : null,
        notes: form.notes.trim() || undefined,
        contact_via: form.contactVia,
      });
      toast.success(isEdit ? "Crew profile updated" : "You're in the crew pool!");
      router.back();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  const leaveCrew = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await api.del(`/events/${id}/crew`);
      toast.info("Left the crew pool");
      router.back();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <KeyboardFormScreen title={isEdit ? "Edit crew profile" : "Join crew pool"} testID="crew-signup-loading">
        <Loading />
      </KeyboardFormScreen>
    );
  }

  return (
    <KeyboardFormScreen
      title={isEdit ? "Edit crew profile" : "Join crew pool"}
      testID="crew-signup-form"
      footer={
        <ButtonRow
          allowStack={false}
          buttons={
            isEdit
              ? [
                  { title: "Leave crew pool", variant: "secondary", testID: "crew-leave-btn", loading: busy, onPress: leaveCrew },
                  { title: "Save changes", weight: 1.4, testID: "crew-save-btn", loading: busy, onPress: saveCrew },
                ]
              : [{ title: "Add me to the bank", testID: "crew-save-btn", loading: busy, onPress: saveCrew }]
          }
        />
      }
    >
      <Text style={[styles.intro, { color: colors.muted }]}>
        Pick the positions you can sail and tell skippers about your experience.
      </Text>

      <Text style={[styles.label, { color: colors.onSurface }]}>Positions</Text>
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        <MultiSelectPicker
          label="Positions"
          title="Select positions"
          testID="crew-positions-picker"
          searchable={false}
          options={positionsList.map((p) => ({ value: p, label: p }))}
          value={form.positions}
          onChange={(next) => setForm((s) => ({ ...s, positions: next }))}
          placeholder="Select positions"
          valueLabel={form.positions.length ? form.positions.map(displayPosition).join(", ") : undefined}
          accessibilityLabel={`Positions: ${form.positions.length ? form.positions.map(displayPosition).join(", ") : "none selected"}`}
        />
      </View>

      <Text style={[styles.label, { color: colors.onSurface }]}>Type of sailing experience</Text>
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        <MultiSelectPicker
          label="Experience types"
          title="Select experience types"
          testID="crew-exp-picker"
          searchable={false}
          options={expTypesList.map((t) => ({ value: t, label: t }))}
          value={form.experienceTypes}
          onChange={(next) => setForm((s) => ({ ...s, experienceTypes: next }))}
          placeholder="Select experience types"
          valueLabel={form.experienceTypes.length ? form.experienceTypes.join(", ") : undefined}
          accessibilityLabel={`Experience types: ${form.experienceTypes.length ? form.experienceTypes.join(", ") : "none selected"}`}
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <Text style={[styles.label, { color: colors.onSurface, marginBottom: 0 }]}>Sailing style (optional)</Text>
        {Object.keys(form.sailingStyle).length > 0 ? (
          <Pressable testID="crew-style-clear" onPress={() => setForm((s) => ({ ...s, sailingStyle: {} }))} hitSlop={8}>
            <Text style={{ color: colors.teal, fontSize: 13, fontWeight: "700" }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 10 }}>Tap a dot (1 to 5) to place yourself between each pair.</Text>
      {(styleAxes || []).map((ax: any) => (
        <View key={ax.key} style={{ marginBottom: 14 }} testID={`crew-style-axis-${ax.key}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 11.5, flex: 1 }}>{ax.low}</Text>
            <Text style={{ color: colors.onSurfaceSecondary, fontSize: 11.5, flex: 1, textAlign: "right" }}>{ax.high}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = form.sailingStyle[ax.key] === n;
              return (
                <Pressable key={n} testID={`crew-style-${ax.key}-${n}`} onPress={() => setForm((s) => ({ ...s, sailingStyle: { ...s.sailingStyle, [ax.key]: n } }))}
                  style={{ flex: 1, height: 34, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
                           borderColor: on ? colors.teal : colors.border, backgroundColor: on ? colors.teal : "transparent" }}>
                  <Text style={{ color: on ? "#10233A" : colors.onSurfaceSecondary, fontWeight: "800", fontSize: 13 }}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View onLayout={experienceKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Experience</Text>
        <TextInput testID="crew-experience-input" value={form.experience} onFocus={experienceKb.onFocus}
          onChangeText={(t) => setForm((s) => ({ ...s, experience: t }))}
          placeholder="e.g. 5 seasons, J/24, foredeck" placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surface }]} />
      </View>

      <View onLayout={availabilityKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Availability around this event</Text>
        <TextInput testID="crew-availability-input" value={form.availability} onFocus={availabilityKb.onFocus}
          onChangeText={(t) => setForm((s) => ({ ...s, availability: t }))}
          placeholder="For example, can help with the delivery after the race." placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surface }]} />
      </View>

      <View onLayout={notesKb.onLayout}>
        <Text style={[styles.label, { color: colors.onSurface }]}>Notes for the skipper</Text>
        <TextInput testID="crew-notes-input" value={form.notes} onFocus={notesKb.onFocus}
          onChangeText={(t) => setForm((s) => ({ ...s, notes: t }))}
          placeholder="Gear, references..." placeholderTextColor={colors.muted} multiline
          style={[styles.input, { color: colors.onSurface, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 90, paddingTop: 12, textAlignVertical: "top" }]} />
      </View>

      <Text style={[styles.label, { color: colors.onSurface }]}>How can organizers reach you?</Text>
      <View style={{ gap: 8 }}>
        {[{ v: "in-app", l: "In-app DM only" }, { v: "email", l: "Share my email with organizers" }].map((o) => {
          const on = form.contactVia === o.v;
          return (
            <Pressable key={o.v} testID={`crew-contact-${o.v}`} onPress={() => setForm((s) => ({ ...s, contactVia: o.v }))}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Icon name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.teal : colors.muted} footprint={20} />
              <Text style={{ color: colors.onSurface, fontSize: 14 }}>{o.l}</Text>
            </Pressable>
          );
        })}
      </View>
    </KeyboardFormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: "800", marginTop: 18, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.7 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  posChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
