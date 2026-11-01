import { Alert, Pressable, Text } from "react-native";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useTheme } from "@/src/theme";

// Delete control shown only to a comment's own author (and not to admins, who
// use AdminControls instead, so no one sees two delete controls). Confirms with
// an Alert (no text input), then calls onDeleted so the parent can drop the
// comment and its replies from the list. Ownership is also enforced server-side.
export function CommentDeleteButton({
  comment,
  onDeleted,
}: {
  comment: { id: string; author_id?: string };
  onDeleted: (id: string) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const { colors } = useTheme();

  if (!user || comment.author_id !== user.user_id || user.platform_role === "admin") return null;

  const confirm = () => {
    Alert.alert("Delete comment?", "This also removes any replies. You cannot undo this.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.del(`/comments/${comment.id}`);
            onDeleted(comment.id);
          } catch (e: any) {
            toast.error(e?.message || "Couldn't delete comment");
          }
        },
      },
    ]);
  };

  return (
    <Pressable testID={`del-comment-${comment.id}`} onPress={confirm} hitSlop={6} style={{ alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.error }}>Delete</Text>
    </Pressable>
  );
}
