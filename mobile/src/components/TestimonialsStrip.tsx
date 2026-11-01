import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/src/components/Icon";
import { api } from "@/src/lib/api";
import { useTheme } from "@/src/theme";

type Testimonial = { id: string; quote: string; role: string; market: string; attribution: string };

/** Approved-testimonials strip. Renders nothing until at least one is approved. */
export default function TestimonialsStrip({ title = "What sailors are saying" }: { title?: string }) {
  const { colors } = useTheme();
  const [items, setItems] = useState<Testimonial[] | null>(null);

  useEffect(() => {
    api.get<Testimonial[]>("/testimonials").then(setItems).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <View style={{ marginTop: 26 }} testID="testimonials-strip">
      <Text style={{ color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 14 }}>{title}</Text>
      <View style={{ gap: 12 }}>
        {items.slice(0, 6).map((t) => (
          <View key={t.id} testID={`testimonial-${t.id}`} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="reviews" size={16} color="#F2A03B" footprint={16} />
            <Text style={{ color: colors.onSurface, fontSize: 14, lineHeight: 20, marginTop: 6 }}>&ldquo;{t.quote}&rdquo;</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
              {t.attribution ? <Text style={{ fontWeight: "800" }}>{t.attribution}</Text> : null}
              {t.attribution && (t.role || t.market) ? " · " : null}
              {[t.role, t.market].filter(Boolean).join(" · ")}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
});
