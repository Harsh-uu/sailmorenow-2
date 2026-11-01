import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/Icon";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import Modal from "@/components/Modal";

// Per-kind icon for the notifications list (review kinds + common ones).
const KIND_ICONS = {
  review_request: "reviews",
  review_withdrawn: "flag",
  review_reply: "message-square",
  review_completed: "verified",
  review_nudge: "hand-heart",
  dm: "message-square",
  comment: "messages-square",
  content_hidden: "shield-alert",
};

export default function NotificationsBell() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.get("/notifications").then(({ data }) => setData(data)).catch((e) => {
      if (e?.response?.status && e.response.status !== 401) console.warn("notif load failed", e);
    });
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, [load]);

  const markAllRead = async () => {
    try { await api.post("/notifications/mark-all-read"); load(); }
    catch (e) { console.warn("mark-all-read failed", e); }
  };
  const openItem = async (n) => {
    try { await api.patch(`/notifications/${n.id}/read`); }
    catch (e) { console.warn("mark-read failed", e); }
    setOpen(false);
    navigate(n.link || "/");
  };

  const [actingId, setActingId] = useState(null);
  const reviewNudge = async (n, action) => {
    setActingId(n.id);
    try {
      await api.post("/review-nudge/preference", { action });
      await api.patch(`/notifications/${n.id}/read`).catch(() => {});
      toast.success(action === "off" ? "Review reminders turned off" : "We'll remind you later");
      load();
    } catch { toast.error("Couldn't update"); }
    finally { setActingId(null); }
  };
  const moderate = async (n, action) => {
    const meta = n.meta || {};
    if (!meta.target_type || !meta.target_id) return;
    setActingId(n.id);
    try {
      const { data } = await api.post(`/admin/moderation/${action}`, { target_type: meta.target_type, target_id: meta.target_id });
      await api.patch(`/notifications/${n.id}/read`).catch(() => {});
      const undo = async () => {
        try {
          if (action === "restore") await api.post("/admin/moderation/hide", { target_type: meta.target_type, target_id: meta.target_id });
          else await api.post("/admin/moderation/restore-doc", { target_type: data.target_type, snapshot: data.snapshot });
          toast.success("Undone");
          load();
        } catch { toast.error("Couldn't undo"); }
      };
      toast.success(action === "restore" ? "Content restored." : "Content removed.", { action: { label: "Undo", onClick: undo } });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setActingId(null); }
  };

  return (
    <>
      <button onClick={() => { setOpen(true); load(); }} data-testid="bell-btn"
              className="relative p-2 rounded-full hover:bg-slate-100" title="Notifications">
        <Icon name="notifications" tone="current" className="h-5 w-5 text-[#1F3F5B]" />
        {data.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#F2A03B] text-white text-[10px] font-bold flex items-center justify-center">
            {data.unread > 9 ? "9+" : data.unread}
          </span>
        )}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notifications" size="sm" testId="notifications-modal">
        <div className="p-4">
          {data.items.length === 0 ? (
            <div className="text-sm text-slate-500 py-6 text-center">No notifications yet.</div>
          ) : (
            <div className="space-y-2">
              {data.items.map((n) => (
                <div key={n.id} data-testid={`notif-${n.id}`}
                     className={`rounded-xl border p-3 ${n.read ? "border-slate-100 bg-white" : "border-[#55B3AD]/40 bg-teal-50/30"}`}>
                  <button onClick={() => openItem(n)} className="w-full text-left flex gap-3">
                    <span className="shrink-0 mt-0.5 h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center" data-testid={`notif-icon-${n.kind}`}>
                      <Icon name={KIND_ICONS[n.kind] || "notifications"} tone="current" className="h-4 w-4 text-[#1F3F5B] dark:text-slate-200" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[#1F3F5B]">{n.title}</div>
                      {n.body && <div className="text-xs text-slate-600 mt-1 line-clamp-2">{n.body}</div>}
                      <div className="text-[10px] text-slate-500 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                    </span>
                  </button>
                  {n.kind === "content_hidden" && n.meta?.target_id && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => moderate(n, "restore")} disabled={actingId === n.id} data-testid={`notif-restore-${n.id}`}
                              className="flex-1 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-bold py-1.5 disabled:opacity-50">Restore</button>
                      <button onClick={() => moderate(n, "remove")} disabled={actingId === n.id} data-testid={`notif-remove-${n.id}`}
                              className="flex-1 rounded-full bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold py-1.5 disabled:opacity-50">Remove</button>
                    </div>
                  )}
                  {n.kind === "review_nudge" && (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => reviewNudge(n, "snooze")} disabled={actingId === n.id} data-testid={`notif-snooze-${n.id}`}
                              className="flex-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-1.5 disabled:opacity-50">Remind me later</button>
                      <button onClick={() => reviewNudge(n, "off")} disabled={actingId === n.id} data-testid={`notif-nudge-off-${n.id}`}
                              className="flex-1 rounded-full bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold py-1.5 disabled:opacity-50">Turn off</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.unread > 0 && (
            <button onClick={markAllRead} data-testid="mark-all-read"
                    className="mt-4 w-full text-xs font-semibold text-[#1F3F5B] hover:text-[#152a3d] py-2">
              Mark all as read
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
