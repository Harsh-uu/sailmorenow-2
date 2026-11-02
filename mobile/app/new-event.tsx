import { useEffect, useState } from "react";
import { Alert, DeviceEventEmitter, PixelRatio, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MotionModal as Modal } from "@/src/components/MotionModal";
import { router, useLocalSearchParams } from "expo-router";
import dayjs from "dayjs";

import { Screen } from "@/src/components/Screen";
import { KeyboardFormScreen, useKbField } from "@/src/components/KeyboardFormScreen";
import { ButtonRow } from "@/src/components/ui";
import { MultiSelectPicker } from "@/src/components/MultiSelectPicker";
import { Icon } from "@/src/components/Icon";
import { api, ApiError } from "@/src/lib/api";
import { CONTENT_CHANGED } from "@/src/lib/events";
import { ptInputToISO, isoToPTDate, isoToPTTime } from "@/src/lib/format";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { handleUpgrade } from "@/src/lib/upgrade";
import { useTheme } from "@/src/theme";

// 30-minute increment time slots (48). value = "HH:mm", label = 12h.
const TIME_SLOTS: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  const value = `${String(h).padStart(2, "0")}:${m}`;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { value, label: `${h12}:${m} ${ampm}` };
});
const timeLabel = (v?: string | null) => (v ? TIME_SLOTS.find((s) => s.value === v)?.label || v : "");

// Same categories and order as the web Post event form. Auto-detect is admin-only
// (for scrubbed/imported events) and is prepended at render time for admins.
const CATEGORY_OPTIONS = [
  { value: "racing", label: "Racing" },
  { value: "cruising", label: "Cruising" },
  { value: "social", label: "Social" },
  { value: "education", label: "Education" },
  { value: "volunteering", label: "Volunteering" },
  { value: "other", label: "Other" },
];
const REPEAT_OPTIONS = [
  { value: "none", label: "One-time event" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
];

export default function NewEvent() {
  const { user } = useAuth();
  const toast = useToast();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ edit?: string; title?: string; description?: string; market?: string; starts_at?: string; ends_at?: string; location?: string; is_race?: string; is_volunteer?: string; is_paid?: string; is_free?: string; volunteer_contact_email?: string; volunteer_contact_phone?: string; volunteer_reminder_lead_days?: string; category?: string; registration_url?: string }>();
  const editId = params.edit;
  const isAdmin = user?.platform_role === "admin";
  // At large accessibility text, stack the Start/End time pickers so the longer
  // "End time (optional)" label can wrap without misaligning the two columns and
  // each picker gets full width for its value.
  const stackTimes = PixelRatio.getFontScale() >= 1.2;
  const [markets, setMarkets] = useState<string[]>([]);
  const [title, setTitle] = useState((params.title as string) || "");
  const [description, setDescription] = useState((params.description as string) || "");
  const [market, setMarket] = useState<string | null>((params.market as string) || user?.primary_market || null);
  const [date, setDate] = useState(params.starts_at ? isoToPTDate(params.starts_at as string) : dayjs().add(7, "day").format("YYYY-MM-DD"));
  const [time, setTime] = useState(params.starts_at ? isoToPTTime(params.starts_at as string) : "10:00");
  const [endTime, setEndTime] = useState<string | null>(params.ends_at ? isoToPTTime(params.ends_at as string) : null);
  const [timeTbd, setTimeTbd] = useState<boolean>(!!params.starts_at && !isoToPTTime(params.starts_at as string));
  const [pickerFor, setPickerFor] = useState<"start" | "end" | null>(null);
  const [location, setLocation] = useState((params.location as string) || "");
  const [isRace, setIsRace] = useState(params.is_race === "1");
  const [isVolunteer, setIsVolunteer] = useState(params.is_volunteer === "1");
  const [volEmail, setVolEmail] = useState((params.volunteer_contact_email as string) || "");
  const [volPhone, setVolPhone] = useState((params.volunteer_contact_phone as string) || "");
  const [volLeadDays, setVolLeadDays] = useState(params.volunteer_reminder_lead_days ? Number(params.volunteer_reminder_lead_days) : 1);
  const [isPaid, setIsPaid] = useState(params.is_paid == null ? true : params.is_paid === "1");
  const [isFree, setIsFree] = useState(params.is_free === "1");
  const [freeTouched, setFreeTouched] = useState(false);
  const [category, setCategory] = useState<string>((params.category as string) || (user?.platform_role === "admin" ? "auto" : ""));
  const [catError, setCatError] = useState(false);
  const [regUrl, setRegUrl] = useState((params.registration_url as string) || "");
  const [repeat, setRepeat] = useState<string>("none");
  const [occurrences, setOccurrences] = useState("8");
  const [submitting, setSubmitting] = useState(false);
  const titleKb = useKbField("event-title");
  const descKb = useKbField("event-desc");
  const dateKb = useKbField("event-date");
  const locationKb = useKbField("event-location");
  const volEmailKb = useKbField("event-vol-email");
  const volPhoneKb = useKbField("event-vol-phone");
  const urlKb = useKbField("event-url");
  const occKb = useKbField("event-occurrences");

  useEffect(() => {
    api.get<{ markets: string[] }>("/markets").then((d) => setMarkets(d.markets || [])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!title.trim()) return Alert.alert("Add a title");
    if (!description.trim()) return Alert.alert("Add a description");
    if (!market) return Alert.alert("Pick a market");
    if (!isAdmin && !category) { setCatError(true); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Alert.alert("Date must be YYYY-MM-DD");
    if (!timeTbd && !/^\d{2}:\d{2}$/.test(time)) return Alert.alert("Pick a start time");
    const startsIso = timeTbd ? ptInputToISO(date, "") : ptInputToISO(date, time);
    if (!startsIso) return Alert.alert("Invalid date/time");
    let endsIso: string | null = null;
    if (!timeTbd && endTime) {
      endsIso = ptInputToISO(date, endTime);
      if (!dayjs(endsIso).isValid()) return Alert.alert("Invalid end time");
      if (dayjs(endsIso).isBefore(startsIso) || dayjs(endsIso).isSame(startsIso)) return Alert.alert("End time must be after the start time");
    }
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        market,
        starts_at: startsIso,
        ends_at: endsIso,
        location: location.trim() || undefined,
        category: isAdmin ? (category && category !== "auto" ? category : undefined) : category,
        registration_url: regUrl.trim() || undefined,
        is_race: isRace,
        is_volunteer: isVolunteer,
        is_paid: isPaid,
        ...(freeTouched ? { is_free: isFree } : {}),
        volunteer_contact_email: isVolunteer && volEmail.trim() ? volEmail.trim() : undefined,
        volunteer_contact_phone: isVolunteer && volPhone.trim() ? volPhone.trim() : undefined,
        volunteer_reminder_lead_days: isVolunteer ? volLeadDays : undefined,
      };
      if (editId) {
        await api.patch(`/events/${editId}`, payload);
        DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "event", action: "edit", id: editId });
      } else if (repeat !== "none") {
        await api.post("/events/series", { ...payload, repeat, occurrences: Number(occurrences) || 8 });
        // A whole new series: no single item to prepend, so just signal a reload
        // and the full set of new occurrences shows at once.
        DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "event", action: "create" });
      } else {
        const created = await api.post<any>("/events", payload);
        DeviceEventEmitter.emit(CONTENT_CHANGED, { kind: "event", action: "create", item: created });
      }
      router.back();
    } catch (e) {
      if (handleUpgrade(e, toast)) {
        // Paywall (402 or 403 with upgrade_required) — upgrade prompt shown.
      } else if (e instanceof ApiError && e.code === "event_posting_closed") {
        toast.error(e.message);
      } else {
        Alert.alert(editId ? "Couldn't save event" : "Couldn't create event", e instanceof ApiError ? e.message : "Try again");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardFormScreen
      title={editId ? "Edit event" : "New event"}
      testID="new-event-scroll"
      footer={<ButtonRow allowStack={false} buttons={[{ title: editId ? "Save changes" : "Create event", onPress: submit, loading: submitting, testID: "create-event-submit-btn" }]} />}
    >
        <View onLayout={titleKb.onLayout}>
          <Label>Title</Label>
          <TextInput testID="event-title-input" value={title} onFocus={titleKb.onFocus} onChangeText={setTitle} placeholder="Event name" placeholderTextColor={colors.muted} style={inp(colors)} />
        </View>

        <View onLayout={descKb.onLayout}>
          <Label>Description</Label>
          <TextInput testID="event-desc-input" value={description} onFocus={descKb.onFocus} onChangeText={setDescription} placeholder="What's happening?" placeholderTextColor={colors.muted} multiline style={area(colors)} />
        </View>

        <View onLayout={dateKb.onLayout} style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Label>Date</Label>
            <TextInput testID="event-date-input" value={date} onFocus={dateKb.onFocus} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" style={inp(colors)} />
          </View>
        </View>
        <Pressable testID="event-time-tbd" onPress={() => setTimeTbd((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon name={timeTbd ? "checkbox" : "square-outline"} size={20} color={timeTbd ? colors.brandTertiary : colors.muted} footprint={20} />
          <Text style={{ color: colors.onSurface, fontSize: 14, flex: 1, flexShrink: 1 }}>Time to be decided (show the date only)</Text>
        </Pressable>
        {!timeTbd && (
        <View style={{ flexDirection: stackTimes ? "column" : "row", gap: 12 }}>
          <View style={stackTimes ? { width: "100%" } : { flex: 1 }}>
            <Label>Start time</Label>
            <Pressable testID="event-start-time" onPress={() => setPickerFor("start")} style={[styles.select, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.onSurface, fontSize: 15, flex: 1, flexShrink: 1, marginRight: 8 }}>{timeLabel(time)}</Text>
              <Icon name="chevron-down" size={18} color={colors.muted} footprint={18} />
            </Pressable>
          </View>
          <View style={stackTimes ? { width: "100%" } : { flex: 1 }}>
            <Label>End time (optional)</Label>
            <Pressable testID="event-end-time" onPress={() => setPickerFor("end")} style={[styles.select, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: endTime ? colors.onSurface : colors.muted, fontSize: 15, flex: 1, flexShrink: 1, marginRight: 8 }}>{endTime ? timeLabel(endTime) : "No end time"}</Text>
              <Icon name="chevron-down" size={18} color={colors.muted} footprint={18} />
            </Pressable>
          </View>
        </View>
        )}

        <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
          <Pressable style={styles.backdrop} onPress={() => setPickerFor(null)}>
            <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
              <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: 16, padding: 16, paddingBottom: 8 }}>
                {pickerFor === "end" ? "End time" : "Start time"}
              </Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {pickerFor === "end" ? (
                  <Pressable testID="time-slot-none" onPress={() => { setEndTime(null); setPickerFor(null); }} style={[styles.slot, { borderBottomColor: colors.border }]}>
                    <Text style={{ color: !endTime ? colors.teal : colors.onSurface, fontSize: 15, fontWeight: !endTime ? "800" : "500" }}>No end time</Text>
                  </Pressable>
                ) : null}
                {TIME_SLOTS.map((s) => {
                  const sel = pickerFor === "end" ? endTime === s.value : time === s.value;
                  return (
                    <Pressable key={s.value} testID={`time-slot-${s.value}`} onPress={() => { if (pickerFor === "end") setEndTime(s.value); else setTime(s.value); setPickerFor(null); }} style={[styles.slot, { borderBottomColor: colors.border }]}>
                      <Text style={{ color: sel ? colors.teal : colors.onSurface, fontSize: 15, fontWeight: sel ? "800" : "500" }}>{s.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        <View onLayout={locationKb.onLayout}>
          <Label>Location</Label>
          <TextInput testID="event-location-input" value={location} onFocus={locationKb.onFocus} onChangeText={setLocation} placeholder="Venue / marina" placeholderTextColor={colors.muted} style={inp(colors)} />
        </View>

        <Label>Category</Label>
        <View style={{ flexDirection: "row", marginBottom: catError ? 2 : 4 }}>
          <MultiSelectPicker
            label="Category"
            title="Select category"
            testID="event-category-picker"
            single
            searchable={false}
            placeholder="Choose a category"
            options={isAdmin ? [{ value: "auto", label: "Auto-detect" }, ...CATEGORY_OPTIONS] : CATEGORY_OPTIONS}
            value={category ? [category] : []}
            onChange={(next) => { setCategory(next[0] || ""); setCatError(false); }}
            valueLabel={(isAdmin ? [{ value: "auto", label: "Auto-detect" }, ...CATEGORY_OPTIONS] : CATEGORY_OPTIONS).find((o) => o.value === category)?.label || "Choose a category"}
            accessibilityLabel={`Category: ${category || "none selected"}`}
          />
        </View>
        {catError ? <Text testID="event-category-error" style={{ color: colors.error, fontSize: 12, marginBottom: 2, fontWeight: "600" }}>Choose a category.</Text> : null}

        <Label>Market</Label>
        <View style={{ flexDirection: "row", marginBottom: 4 }}>
          <MultiSelectPicker
            label="Market"
            title="Select market"
            testID="event-market-picker"
            single
            searchable={false}
            placeholder="Pick a market"
            options={markets.map((m) => ({ value: m, label: m }))}
            value={market ? [market] : []}
            onChange={(next) => setMarket(next[0] || null)}
            valueLabel={market || "Pick a market"}
            accessibilityLabel={`Market: ${market || "none selected"}`}
          />
        </View>

        {!editId ? (
          <>
            <Label>Repeats</Label>
            <View style={{ flexDirection: "row", marginBottom: 4 }}>
              <MultiSelectPicker
                label="Repeats"
                title="Repeat schedule"
                testID="event-repeat-picker"
                single
                searchable={false}
                placeholder="One-time event"
                options={REPEAT_OPTIONS}
                value={[repeat]}
                onChange={(next) => setRepeat(next[0] || "none")}
                valueLabel={REPEAT_OPTIONS.find((o) => o.value === repeat)?.label || "One-time event"}
                accessibilityLabel={`Repeats: ${repeat}`}
              />
            </View>
            {repeat !== "none" ? (
              <View onLayout={occKb.onLayout}>
                <Label>Occurrences (max 26)</Label>
                <TextInput testID="event-occurrences-input" value={occurrences} onFocus={occKb.onFocus} onChangeText={setOccurrences} keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.muted} style={inp(colors)} />
              </View>
            ) : null}
          </>
        ) : null}

        <View onLayout={urlKb.onLayout}>
          <Label>Event URL (optional)</Label>
          <TextInput testID="event-url-input" value={regUrl} onFocus={urlKb.onFocus} onChangeText={setRegUrl} placeholder="External registration URL (leave blank for in-app RSVP)" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="url" style={inp(colors)} />
        </View>

        <View style={{ marginTop: 20, gap: 4 }}>
          <ToggleRow label="This is a race" value={isRace} onChange={setIsRace} />
          <ToggleRow label="Volunteers needed" value={isVolunteer} onChange={setIsVolunteer} />
        </View>
        {isVolunteer ? (
          <View onLayout={volEmailKb.onLayout} style={{ marginTop: 8 }}>
            <TextInput testID="volunteer-email" value={volEmail} onFocus={volEmailKb.onFocus} onChangeText={setVolEmail} placeholder="Volunteer contact email (optional)" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" style={inp(colors)} />
          </View>
        ) : null}
        {isVolunteer ? (
          <View onLayout={volPhoneKb.onLayout} style={{ marginTop: 8 }}>
            <TextInput testID="volunteer-phone" value={volPhone} onFocus={volPhoneKb.onFocus} onChangeText={setVolPhone} placeholder="Volunteer contact phone (optional)" placeholderTextColor={colors.muted} keyboardType="phone-pad" style={inp(colors)} />
          </View>
        ) : null}
        {isVolunteer ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 }}>Auto-remind volunteers</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {[{ d: 1, l: "1 day" }, { d: 2, l: "2 days" }, { d: 3, l: "3 days" }, { d: 7, l: "1 week" }].map((o) => (
                <Pressable key={o.d} testID={`vol-lead-${o.d}`} onPress={() => setVolLeadDays(o.d)}
                  style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: volLeadDays === o.d ? colors.teal : colors.border, backgroundColor: volLeadDays === o.d ? colors.tealSoft : colors.surface }}>
                  <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 }}>{o.l} before</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ gap: 4, marginTop: 4 }}>
          <ToggleRow label="Free event" value={!isPaid} onChange={(v) => { setIsPaid(!v); setIsFree(v); setFreeTouched(true); }} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>Paid details are on the event page.</Text>
        </View>
      </KeyboardFormScreen>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggleRow}>
      <Text style={{ color: colors.onSurface, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.teal }} />
    </View>
  );
}

function Label({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.onSurface }]}>{children}</Text>;
}
const inp = (colors: any) => [styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }];
const area = (colors: any) => [styles.textarea, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface }];

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15 },
  textarea: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 90, textAlignVertical: "top", fontSize: 15 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  select: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "70%", paddingBottom: 20 },
  slot: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1 },
});
